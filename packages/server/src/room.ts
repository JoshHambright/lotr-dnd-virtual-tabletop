/**
 * A table, live in memory, owned by exactly one process.
 *
 * The same guarantee the Durable Object gave us: every operation on a table
 * serializes through one place, so two players grabbing the same token cannot
 * race. Scaling this out would need a shared log and is deliberately not in
 * scope (DECISIONS D-009).
 *
 * The rules are not reimplemented here. `authorize`, `reduce` and `projectOp`
 * come from `@vtt/core` — the same functions the Cloudflare adapter calls and
 * the same ones the leak assertions are written against.
 */

import { randomUUID } from 'node:crypto'
import type { WebSocket } from 'ws'
import type { ChatMessage, Op, Presence, Role, Roll, RoomState } from '@vtt/core'
import { authorize, identityFor, identityForInvite, projectOp, projectState, reduce } from '@vtt/core'
import { roll as rollDice } from '@vtt/dice'
import type { RollMode } from '@vtt/dice'
import type { ClientMessage, ServerMessage } from '@vtt/protocol'
import { parseValidatedClientMessage } from '@vtt/protocol/schemas'

interface Seat {
  socket: WebSocket
  connectionId: string
  name: string
  role: Role
  id: string
  cursor: Presence['cursor']
  /**
   * How many operations this seat has been sent.
   *
   * Per seat, not per room, because the two numbers differ: the GM's staging
   * produces nothing for a player, so a room-wide counter arrives at a player
   * full of legitimate gaps and tells them nothing. Counted per seat it is
   * gapless by construction, which makes a gap mean exactly one thing — the
   * browser has missed something and its picture of the table is wrong.
   */
  seq: number
}

const PERSIST_DELAY_MS = 750
const MAX_FRAME_BYTES = 256 * 1024

export class Room {
  #seats = new Set<Seat>()
  #dirty = false
  #flushTimer: NodeJS.Timeout | null = null

  readonly code: string
  #state: RoomState
  #persist: (state: RoomState) => void

  constructor(code: string, state: RoomState, persist: (state: RoomState) => void) {
    this.code = code
    this.#state = state
    this.#persist = persist
  }

  get playerCount(): number {
    return this.#seats.size
  }

  get snapshot(): RoomState {
    return this.#state
  }

  // --- Seats -----------------------------------------------------------------

  /**
   * Seats somebody.
   *
   * `playerId` is present when they arrived with an invite the server verified,
   * and it is what ownership is then checked against. Without one the id comes
   * from the name they typed, which is worth exactly what a typed name is worth
   * — see D-017, and the table setting that refuses it.
   */
  join(socket: WebSocket, name: string, role: Role, playerId?: string | null): Seat {
    const seat: Seat = {
      socket,
      connectionId: randomUUID(),
      name,
      role,
      id: playerId ? identityForInvite(playerId) : identityFor(name),
      cursor: null,
      // A new connection starts its own count at zero; `hello` says so, and
      // every batch after it follows on.
      seq: 0,
    }
    this.#seats.add(seat)

    this.#send(seat, this.#hello(seat))
    this.#broadcastPresence()
    return seat
  }

  leave(seat: Seat): void {
    this.#seats.delete(seat)
    // Flush before the table goes quiet, so nothing is lost if the process
    // is stopped while nobody is connected.
    if (this.#dirty) this.flush()
    this.#broadcastPresence()
  }

  // --- Messages --------------------------------------------------------------

  receive(seat: Seat, raw: string): void {
    if (raw.length > MAX_FRAME_BYTES) {
      this.#send(seat, { k: 'error', message: 'That message is too large' })
      return
    }

    // Validated, not cast: authorization answers "may you do this", this
    // answers "is this even a thing", and both have to be asked.
    const message = parseValidatedClientMessage(raw)
    if (!message) {
      this.#send(seat, { k: 'error', message: 'That message was malformed' })
      return
    }

    switch (message.k) {
      case 'ping':
        return this.#send(seat, { k: 'pong' })
      case 'resync':
        return this.#send(seat, this.#hello(seat))
      case 'cursor':
        return this.#cursor(seat, message)
      case 'op':
        return this.#operate(seat, message.op)
      case 'roll':
        return this.#roll(seat, message)
      case 'chat':
        return this.#chat(seat, message)
    }
  }

  #operate(seat: Seat, op: Op): void {
    const decision = authorize(op, this.#state, { role: seat.role, name: seat.name, id: seat.id })
    if (!decision.ok) {
      this.#send(seat, { k: 'error', message: decision.reason })
      return
    }
    this.apply([decision.op], op.t !== 'token.move')
  }

  #roll(seat: Seat, message: Extract<ClientMessage, { k: 'roll' }>): void {
    // Only the GM may roll where the table cannot see it.
    const visibility = message.visibility === 'gm' && seat.role === 'gm' ? 'gm' : 'public'
    const mode: RollMode = message.mode === 'advantage' || message.mode === 'disadvantage' ? message.mode : 'normal'

    let result
    try {
      result = rollDice(message.expression, mode, secureRandom)
    } catch (error) {
      this.#send(seat, {
        k: 'error',
        message: error instanceof Error ? error.message : 'That is not a dice expression',
      })
      return
    }

    const entry: Roll = {
      id: randomUUID(),
      at: Date.now(),
      by: seat.name,
      label: message.label,
      result,
      visibility,
      // Shared, so every client tumbles the same dice before settling on the
      // numbers this server already decided.
      seed: Math.floor(secureRandom() * 0xffffffff),
      ...(message.color ? { color: message.color } : {}),
    }
    this.apply([{ t: 'roll.add', roll: entry }], true)
  }

  #chat(seat: Seat, message: Extract<ClientMessage, { k: 'chat' }>): void {
    const entry: ChatMessage = {
      id: randomUUID(),
      at: Date.now(),
      by: seat.name,
      text: message.text,
      visibility: message.visibility === 'gm' && seat.role === 'gm' ? 'gm' : 'public',
    }
    this.apply([{ t: 'chat.add', message: entry }], true)
  }

  #cursor(seat: Seat, message: Extract<ClientMessage, { k: 'cursor' }>): void {
    seat.cursor = message.cursor
    // Cursors are chatter, not state: never stored, and only sent to people
    // looking at the same scene.
    for (const other of this.#seats) {
      if (other === seat) continue
      if (other.role === 'player' && message.cursor && message.cursor.sceneId !== this.#state.activeSceneId) continue
      this.#send(other, { k: 'cursor', connectionId: seat.connectionId, cursor: message.cursor })
    }
  }

  /**
   * Applies operations, then tells each seat what changed *in its own terms* —
   * a GM hears the truth, a player hears only their entitled part of it.
   */
  apply(ops: Op[], immediate: boolean): void {
    const before = this.#state
    let next = before
    for (const op of ops) next = reduce(next, op)
    this.#state = next

    for (const seat of this.#seats) {
      const projected: Op[] = []
      let stepBefore = before
      for (const op of ops) {
        const stepAfter = reduce(stepBefore, op)
        projected.push(...projectOp(op, stepBefore, stepAfter, seat.role))
        stepBefore = stepAfter
      }
      if (!projected.length) continue
      seat.seq += projected.length
      this.#send(seat, { k: 'ops', seq: seat.seq, ops: projected })
    }

    this.#schedulePersist(immediate)
  }

  // --- Persistence -----------------------------------------------------------

  /**
   * Structural changes are written through; a stream of token drags is
   * coalesced, so dragging a piece across the map costs one write rather
   * than thirty.
   */
  #schedulePersist(immediate: boolean): void {
    if (immediate) return this.flush()
    this.#dirty = true
    if (this.#flushTimer) return
    this.#flushTimer = setTimeout(() => this.flush(), PERSIST_DELAY_MS)
    // A pending write must never hold the process open on shutdown.
    this.#flushTimer.unref?.()
  }

  flush(): void {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer)
      this.#flushTimer = null
    }
    this.#dirty = false
    this.#persist(this.#state)
  }

  // --- Sending ---------------------------------------------------------------

  #hello(seat: Seat): ServerMessage {
    return {
      k: 'hello',
      protocol: 1,
      roomCode: this.code,
      role: seat.role,
      connectionId: seat.connectionId,
      name: seat.name,
      seq: seat.seq,
      state: projectState(this.#state, seat.role),
      presence: this.#presence(),
    }
  }

  #presence(): Presence[] {
    return [...this.#seats].map((seat) => ({
      connectionId: seat.connectionId,
      name: seat.name,
      role: seat.role,
      cursor: seat.cursor,
    }))
  }

  #broadcastPresence(): void {
    const presence = this.#presence()
    for (const seat of this.#seats) this.#send(seat, { k: 'presence', presence })
  }

  #send(seat: Seat, message: ServerMessage): void {
    if (seat.socket.readyState !== seat.socket.OPEN) return
    try {
      seat.socket.send(JSON.stringify(message))
    } catch {
      // A socket that closed mid-broadcast is normal; presence catches up.
    }
  }

  /** Whether a player may fetch a given asset. Mirrors the adapter exactly. */
  assetVisibleToPlayers(id: string): boolean {
    const active = this.#state.activeSceneId ? this.#state.scenes[this.#state.activeSceneId] : undefined
    if (active?.assetId === id) return true

    for (const token of Object.values(this.#state.tokens)) {
      if (token.hidden || token.sceneId !== this.#state.activeSceneId) continue
      if (token.imageAssetId === id) return true
    }
    for (const character of Object.values(this.#state.characters)) {
      if (character.portraitAssetId === id) return true
    }
    return false
  }
}

/** Rolls and seeds come from the platform CSPRNG, not Math.random. */
function secureRandom(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0]! / 0x100000000
}
