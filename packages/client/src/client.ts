/**
 * The browser's half of the connection.
 *
 * Holds the room state, applies the server's operations with the same reducer
 * the server used, and reconnects when the laptop lid closes mid-session.
 *
 * Subscribers come in two kinds. React panels listen on the structural channel
 * and so are not re-rendered ninety times a second while four people drag
 * tokens; the map canvas reads `room` directly from its own animation frame.
 */

import { reduce } from '@vtt/core'
import type { Op, Presence, Role, RoomState } from '@vtt/core'
import { emptyRoom } from '@vtt/core'
import type { ClientMessage, ServerMessage } from '@vtt/protocol'
import type { RollMode } from '@vtt/dice'

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface Cursor {
  connectionId: string
  name: string
  sceneId: string
  x: number
  y: number
  at: number
}

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000, 15000]
const HEARTBEAT_MS = 25000
/** Enough for the move to look continuous without flooding the room. */
const MOVE_THROTTLE_MS = 60

export class TableClient {
  room: RoomState = emptyRoom()
  status: ConnectionStatus = 'connecting'
  role: Role = 'player'
  connectionId = ''
  presence: Presence[] = []
  cursors = new Map<string, Cursor>()
  lastError: string | null = null
  /** Bumped on every roll so the dice tray knows to animate a new one. */
  rollCount = 0

  #socket: WebSocket | null = null
  #attempt = 0
  #heartbeat: ReturnType<typeof setInterval> | null = null
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null
  #closedByUs = false

  #structuralListeners = new Set<() => void>()
  #liveListeners = new Set<() => void>()
  #structuralVersion = 0
  #liveVersion = 0

  /** Set when the server refused our GM key and we rejoined as a player. */
  demotedFromGm = false
  #usingGmKey: boolean
  #openedOnce = false

  #pendingMoves = new Map<string, { x: number; y: number }>()
  #moveTimer: ReturnType<typeof setTimeout> | null = null
  #cursorTimer: ReturnType<typeof setTimeout> | null = null
  #pendingCursor: Presence['cursor'] = null

  constructor(
    readonly roomCode: string,
    readonly name: string,
    private gmKeyValue: string | null,
  ) {
    this.#usingGmKey = gmKeyValue !== null
  }

  get gmKey(): string | null {
    return this.gmKeyValue
  }

  // --- Subscription ----------------------------------------------------------

  subscribeStructural = (listener: () => void): (() => void) => {
    this.#structuralListeners.add(listener)
    return () => this.#structuralListeners.delete(listener)
  }

  getStructuralVersion = (): number => this.#structuralVersion

  subscribeLive = (listener: () => void): (() => void) => {
    this.#liveListeners.add(listener)
    return () => this.#liveListeners.delete(listener)
  }

  getLiveVersion = (): number => this.#liveVersion

  #emit(structural: boolean): void {
    this.#liveVersion++
    for (const listener of this.#liveListeners) listener()
    if (structural) {
      this.#structuralVersion++
      for (const listener of this.#structuralListeners) listener()
    }
  }

  // --- Connection ------------------------------------------------------------

  connect(): void {
    this.#closedByUs = false
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const params = new URLSearchParams({ name: this.name })
    if (this.#usingGmKey && this.gmKeyValue) {
      params.set('key', this.gmKeyValue)
      params.set('role', 'gm')
    }

    const socket = new WebSocket(
      `${protocol}://${location.host}/api/room/${encodeURIComponent(this.roomCode)}/ws?${params}`,
    )
    this.#socket = socket

    socket.addEventListener('open', () => {
      this.#attempt = 0
      this.#openedOnce = true
      this.status = 'open'
      this.lastError = null
      this.#heartbeat = setInterval(() => this.#send({ k: 'ping' }), HEARTBEAT_MS)
      this.#emit(true)
    })

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      this.#receive(JSON.parse(event.data) as ServerMessage)
    })

    socket.addEventListener('close', () => {
      this.#stopHeartbeat()
      if (this.#closedByUs) {
        this.status = 'closed'
        this.#emit(true)
        return
      }
      // A socket that never opened while we were presenting a GM key means
      // the server refused the key — a stale one left in this browser from a
      // table that has since been reopened. Rejoin as a player rather than
      // locking someone out of their own game night.
      if (!this.#openedOnce && this.#usingGmKey) {
        this.#usingGmKey = false
        this.gmKeyValue = null
        this.demotedFromGm = true
        this.status = 'connecting'
        this.#emit(true)
        this.connect()
        return
      }

      this.status = 'reconnecting'
      this.#emit(true)
      this.#scheduleReconnect()
    })

    socket.addEventListener('error', () => {
      // 'close' always follows, and that is where reconnection is handled.
    })
  }

  disconnect(): void {
    this.#closedByUs = true
    this.#stopHeartbeat()
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#socket?.close()
    this.#socket = null
    this.status = 'closed'
    this.#emit(true)
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat) clearInterval(this.#heartbeat)
    this.#heartbeat = null
  }

  #scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS[Math.min(this.#attempt, RECONNECT_DELAYS.length - 1)]!
    this.#attempt++
    this.#reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  #receive(message: ServerMessage): void {
    switch (message.k) {
      case 'hello':
        // A fresh snapshot replaces everything: after a reconnect the local
        // copy may have missed operations, and the server's view is the truth.
        this.room = message.state
        this.role = message.role
        this.connectionId = message.connectionId
        this.presence = message.presence
        this.#emit(true)
        return

      case 'ops': {
        let structural = false
        for (const op of message.ops) {
          this.room = reduce(this.room, op)
          if (op.t !== 'token.move') structural = true
          if (op.t === 'roll.add') this.rollCount++
        }
        this.#emit(structural)
        return
      }

      case 'presence':
        this.presence = message.presence
        for (const id of [...this.cursors.keys()]) {
          if (!message.presence.some((p) => p.connectionId === id)) this.cursors.delete(id)
        }
        this.#emit(true)
        return

      case 'cursor': {
        if (!message.cursor) {
          this.cursors.delete(message.connectionId)
        } else {
          const who = this.presence.find((p) => p.connectionId === message.connectionId)
          this.cursors.set(message.connectionId, {
            connectionId: message.connectionId,
            name: who?.name ?? 'Someone',
            sceneId: message.cursor.sceneId,
            x: message.cursor.x,
            y: message.cursor.y,
            at: Date.now(),
          })
        }
        this.#emit(false)
        return
      }

      case 'error':
        this.lastError = message.message
        this.#emit(true)
        return

      case 'pong':
        return
    }
  }

  #send(message: ClientMessage): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message))
  }

  // --- Sending intents -------------------------------------------------------

  /**
   * Sends an operation, and for the GM applies it locally at once.
   *
   * Without this a GM's own checkbox visibly flips back for the length of one
   * round trip before the server's echo restores it, because the control is
   * driven by room state rather than by local state. Applying first is safe
   * here for two reasons: every operation a client can send is idempotent, so
   * the echo re-applying it changes nothing; and the GM is authorized for all
   * of them, so there is no refusal to roll back. Players' operations are
   * rewritten server-side before they are allowed, so they wait for the echo —
   * except token drags, which have their own optimistic path.
   */
  send(op: Op): void {
    if (this.role === 'gm') {
      this.room = reduce(this.room, op)
      this.#emit(op.t !== 'token.move')
    }
    this.#send({ k: 'op', op })
  }

  /**
   * Moves a token optimistically and lets the throttle catch the server up.
   * The piece follows the pointer at full frame rate locally while the room
   * gets a steady trickle; the server's echo corrects anything refused.
   */
  moveToken(id: string, x: number, y: number): void {
    const token = this.room.tokens[id]
    if (!token) return
    this.room = reduce(this.room, { t: 'token.move', id, x, y })
    this.#emit(false)

    this.#pendingMoves.set(id, { x, y })
    if (this.#moveTimer) return
    this.#moveTimer = setTimeout(() => {
      this.#moveTimer = null
      for (const [tokenId, position] of this.#pendingMoves) {
        this.#send({ k: 'op', op: { t: 'token.move', id: tokenId, x: position.x, y: position.y } })
      }
      this.#pendingMoves.clear()
    }, MOVE_THROTTLE_MS)
  }

  /** Flushes any throttled move immediately — called when the drag ends. */
  commitMoves(): void {
    if (this.#moveTimer) {
      clearTimeout(this.#moveTimer)
      this.#moveTimer = null
    }
    for (const [tokenId, position] of this.#pendingMoves) {
      this.#send({ k: 'op', op: { t: 'token.move', id: tokenId, x: position.x, y: position.y } })
    }
    this.#pendingMoves.clear()
  }

  setCursor(cursor: Presence['cursor']): void {
    this.#pendingCursor = cursor
    if (this.#cursorTimer) return
    this.#cursorTimer = setTimeout(() => {
      this.#cursorTimer = null
      this.#send({ k: 'cursor', cursor: this.#pendingCursor })
    }, MOVE_THROTTLE_MS)
  }

  roll(expression: string, label: string, mode: RollMode, visibility: 'public' | 'gm'): void {
    this.#send({ k: 'roll', expression, label, mode, visibility })
  }

  chat(text: string, visibility: 'public' | 'gm'): void {
    this.#send({ k: 'chat', text, visibility })
  }

  resync(): void {
    this.#send({ k: 'resync' })
  }

  clearError(): void {
    if (this.lastError === null) return
    this.lastError = null
    this.#emit(true)
  }
}
