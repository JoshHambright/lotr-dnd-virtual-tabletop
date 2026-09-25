/**
 * TableRoom — one Durable Object per table.
 *
 * It owns the authoritative state, resolves every dice roll, decides what
 * each connection is allowed to see and do, and stores the map images. One
 * object means no cross-instance coordination and no race between two players
 * dragging the same token.
 *
 * Websockets use the hibernation API, so a table left open while everyone
 * talks on Zoom costs nothing until someone moves a piece.
 */

import { identityFor, reduce, emptyRoom, MAX_LOG_ENTRIES } from '@vtt/core'
import type { ChatMessage, Op, Presence, Role, Roll, RoomState } from '@vtt/core'
import { authorize, projectOp, projectState } from '@vtt/core'
import { DiceError, roll as rollDice } from '@vtt/dice'
import type { RollMode } from '@vtt/dice'
import { parseValidatedClientMessage } from '@vtt/protocol/schemas'
import type { ClientMessage, ServerMessage } from '@vtt/protocol'
import type { Env } from './index.js'

/** Per-connection data, kept on the socket so it survives hibernation. */
interface Attachment {
  connectionId: string
  name: string
  role: Role
  cursor: Presence['cursor']
  /**
   * How many operations this socket has been sent.
   *
   * Per socket rather than per room, because the two differ: the GM's staging
   * produces nothing for a player, so a room-wide count arrives at a player
   * full of legitimate gaps and tells them nothing. Counted per socket it is
   * gapless, which makes a gap mean one thing — that browser has missed
   * something — and the client rejoins rather than carrying on with a picture
   * nobody else shares.
   *
   * It rides in the attachment so that it survives hibernation; a counter in
   * memory would reset on wake and every client would rejoin for no reason.
   */
  seq: number
}

const MAX_ASSET_BYTES = 12 * 1024 * 1024
const ASSET_CHUNK = 64 * 1024
const MAX_MESSAGE_BYTES = 256 * 1024
const MAX_CHAT_LENGTH = 2000
const PERSIST_DELAY_MS = 750

export class TableRoom {
  #state: RoomState | null = null
  #gmKey: string | null = null
  #code = ''
  #dirty = false

  constructor(
    private readonly ctx: DurableObjectState,
    _env: Env,
  ) {
    this.ctx.blockConcurrencyWhile(async () => {
      this.#migrate()
      this.#load()
    })
  }

  // --- Storage ---------------------------------------------------------------

  #migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS asset_meta (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS asset_chunk (
        id TEXT NOT NULL, idx INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (id, idx)
      );
    `)
  }

  #readMeta(key: string): string | null {
    const rows = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()
    return rows.length ? rows[0]!.value : null
  }

  #writeMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value)
  }

  #load(): void {
    const raw = this.#readMeta('state')
    this.#state = raw ? (JSON.parse(raw) as RoomState) : null
    this.#gmKey = this.#readMeta('gmKey')
    this.#code = this.#readMeta('code') ?? ''
  }

  /**
   * Structural changes are written through immediately; a stream of token
   * drags is coalesced behind an alarm, so dragging a piece across the map
   * costs one write rather than thirty.
   */
  #persist(immediate: boolean): void {
    if (!this.#state) return
    if (immediate) {
      this.#writeMeta('state', JSON.stringify(this.#state))
      this.#dirty = false
      return
    }
    this.#dirty = true
    void this.ctx.storage.getAlarm().then((existing) => {
      if (existing === null) void this.ctx.storage.setAlarm(Date.now() + PERSIST_DELAY_MS)
    })
  }

  async alarm(): Promise<void> {
    if (this.#dirty) this.#persist(true)
  }

  // --- HTTP ------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/create' && request.method === 'POST') return this.#create(request)
    if (url.pathname === '/ws') return this.#connect(request, url)
    if (url.pathname === '/asset' && request.method === 'PUT') return this.#uploadAsset(request, url)
    if (url.pathname.startsWith('/asset/') && request.method === 'GET') {
      return this.#downloadAsset(url.pathname.slice('/asset/'.length), url)
    }
    if (url.pathname === '/exists') {
      return respond({ exists: this.#state !== null, name: this.#state?.settings.name ?? null })
    }
    return respond({ error: 'Not found' }, 404)
  }

  async #create(request: Request): Promise<Response> {
    if (this.#state) return respond({ error: 'That table code is already taken' }, 409)
    const body = (await request.json()) as { code: string; gmKey: string; name: string }
    this.#state = emptyRoom(body.name)
    this.#gmKey = body.gmKey
    this.#code = body.code
    this.#writeMeta('gmKey', body.gmKey)
    this.#writeMeta('code', body.code)
    this.#persist(true)
    return respond({ ok: true })
  }

  #connect(request: Request, url: URL): Response {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return respond({ error: 'Expected a websocket' }, 426)
    }
    if (!this.#state) return respond({ error: 'No table with that code' }, 404)

    const name = (url.searchParams.get('name') ?? '').trim().slice(0, 40) || 'Someone'
    const key = url.searchParams.get('key')
    // The GM key is the only credential in the system. Holding it makes you
    // the GM; the table code alone makes you a player.
    const role: Role = key && this.#gmKey && safeEqual(key, this.#gmKey) ? 'gm' : 'player'
    if (url.searchParams.get('role') === 'gm' && role !== 'gm') {
      return respond({ error: 'That GM key is not right for this table' }, 403)
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    const attachment: Attachment = { connectionId: crypto.randomUUID(), name, role, cursor: null, seq: 0 }
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment(attachment)

    this.#send(server, {
      k: 'hello',
      protocol: 1,
      roomCode: this.#code,
      role,
      connectionId: attachment.connectionId,
      name,
      seq: attachment.seq,
      state: projectState(this.#state, role),
      presence: this.#presence(),
    })
    this.#broadcastPresence()

    return new Response(null, { status: 101, webSocket: client })
  }

  // --- Assets ----------------------------------------------------------------

  async #uploadAsset(request: Request, url: URL): Promise<Response> {
    // Refusing an upload still has to consume the body the client is sending,
    // or the runtime raises "can't read from request stream" behind the scenes.
    const refuse = async (body: unknown, status: number): Promise<Response> => {
      await request.body?.cancel().catch(() => {})
      return respond(body, status)
    }

    if (!this.#state) return refuse({ error: 'No table with that code' }, 404)
    if (!this.#isGm(url.searchParams.get('key'))) return refuse({ error: 'Only the GM can upload' }, 403)

    const type = request.headers.get('content-type') ?? 'application/octet-stream'
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(type)) {
      return refuse({ error: 'Maps and portraits must be images' }, 415)
    }

    const bytes = new Uint8Array(await request.arrayBuffer())
    if (!bytes.byteLength) return respond({ error: 'That file is empty' }, 400)
    if (bytes.byteLength > MAX_ASSET_BYTES) {
      return respond({ error: `Images must be under ${Math.floor(MAX_ASSET_BYTES / 1024 / 1024)} MB` }, 413)
    }

    const id = crypto.randomUUID()
    const sql = this.ctx.storage.sql
    sql.exec(
      'INSERT INTO asset_meta (id, type, size, created) VALUES (?, ?, ?, ?)',
      id,
      type,
      bytes.byteLength,
      Date.now(),
    )
    for (let offset = 0, index = 0; offset < bytes.byteLength; offset += ASSET_CHUNK, index++) {
      sql.exec(
        'INSERT INTO asset_chunk (id, idx, bytes) VALUES (?, ?, ?)',
        id,
        index,
        bytes.slice(offset, offset + ASSET_CHUNK),
      )
    }

    return respond({ id, size: bytes.byteLength, type })
  }

  #downloadAsset(id: string, url: URL): Response {
    if (!this.#state) return respond({ error: 'No table with that code' }, 404)

    // A staged map the GM has not put on the table is not fetchable by a
    // player even with its id, so tonight's ambush cannot be previewed.
    if (!this.#isGm(url.searchParams.get('key')) && !this.#assetVisibleToPlayers(id)) {
      return respond({ error: 'Not found' }, 404)
    }

    const sql = this.ctx.storage.sql
    const meta = sql
      .exec<{ type: string; size: number }>('SELECT type, size FROM asset_meta WHERE id = ?', id)
      .toArray()
    if (!meta.length) return respond({ error: 'Not found' }, 404)

    const chunks = sql
      .exec<{ bytes: ArrayBuffer }>('SELECT bytes FROM asset_chunk WHERE id = ? ORDER BY idx', id)
      .toArray()

    const total = meta[0]!.size
    const body = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      const part = new Uint8Array(chunk.bytes)
      body.set(part, offset)
      offset += part.byteLength
    }

    return new Response(body, {
      headers: {
        'content-type': meta[0]!.type,
        // Ids are random and content never changes under one, so this is safe.
        'cache-control': 'private, max-age=31536000, immutable',
      },
    })
  }

  #assetVisibleToPlayers(id: string): boolean {
    const state = this.#state
    if (!state) return false

    const active = state.activeSceneId ? state.scenes[state.activeSceneId] : undefined
    if (active?.assetId === id) return true

    for (const token of Object.values(state.tokens)) {
      if (token.hidden || token.sceneId !== state.activeSceneId) continue
      if (token.imageAssetId === id) return true
    }
    for (const character of Object.values(state.characters)) {
      if (character.portraitAssetId === id) return true
    }
    return false
  }

  #isGm(key: string | null): boolean {
    return Boolean(key && this.#gmKey && safeEqual(key, this.#gmKey))
  }

  // --- Websocket -------------------------------------------------------------

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    if (typeof raw !== 'string') return
    if (raw.length > MAX_MESSAGE_BYTES) {
      this.#send(ws, { k: 'error', message: 'That message is too large' })
      return
    }

    const attachment = this.#attachmentOf(ws)
    const state = this.#state
    if (!attachment || !state) return

    // Validated, not cast: authorization answers "may you do this", this
    // answers "is this even a thing", and both have to be asked.
    const message = parseValidatedClientMessage(raw)
    if (!message) {
      this.#send(ws, { k: 'error', message: 'That message was malformed' })
      return
    }

    switch (message.k) {
      case 'ping':
        this.#send(ws, { k: 'pong' })
        return
      case 'resync':
        this.#send(ws, {
          k: 'hello',
          protocol: 1,
          roomCode: this.#code,
          role: attachment.role,
          connectionId: attachment.connectionId,
          name: attachment.name,
          seq: attachment.seq,
          state: projectState(state, attachment.role),
          presence: this.#presence(),
        })
        return
      case 'cursor':
        this.#handleCursor(ws, attachment, message)
        return
      case 'op':
        this.#handleOp(ws, attachment, message)
        return
      case 'roll':
        this.#handleRoll(ws, attachment, message)
        return
      case 'chat':
        this.#handleChat(attachment, message)
        return
    }
  }

  webSocketClose(ws: WebSocket): void {
    // Flush before the room goes quiet, so nothing is lost if it hibernates.
    if (this.#dirty) this.#persist(true)
    ws.close()
    this.#broadcastPresence()
  }

  webSocketError(): void {
    this.#broadcastPresence()
  }

  /**
   * Reads a socket's attachment, defaulting a count it does not carry.
   *
   * Sockets hibernating across the deploy that added `seq` come back without
   * one. Treating that as 0 makes those clients see a count they did not
   * expect and rejoin, which is exactly right — they get a fresh snapshot and
   * carry on — rather than folding NaN into their arithmetic forever.
   */
  #attachmentOf(socket: WebSocket): Attachment | null {
    const raw = socket.deserializeAttachment() as Attachment | null
    return raw ? { ...raw, seq: raw.seq ?? 0 } : null
  }

  #handleCursor(ws: WebSocket, attachment: Attachment, message: Extract<ClientMessage, { k: 'cursor' }>): void {
    const next: Attachment = { ...attachment, cursor: message.cursor }
    ws.serializeAttachment(next)
    // Cursors are chatter, not state: never stored, and only sent to people
    // looking at the same scene.
    const payload: ServerMessage = { k: 'cursor', connectionId: attachment.connectionId, cursor: message.cursor }
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === ws) continue
      const other = this.#attachmentOf(socket)
      if (!other) continue
      if (other.role === 'player' && message.cursor && message.cursor.sceneId !== this.#state?.activeSceneId) continue
      this.#send(socket, payload)
    }
  }

  #handleOp(ws: WebSocket, attachment: Attachment, message: Extract<ClientMessage, { k: 'op' }>): void {
    const state = this.#state
    if (!state) return

    const decision = authorize(message.op, state, {
      role: attachment.role,
      name: attachment.name,
      id: identityFor(attachment.name),
    })
    if (!decision.ok) {
      this.#send(ws, { k: 'error', message: decision.reason })
      return
    }

    this.#apply([decision.op], isStructural(decision.op))
  }

  #handleRoll(ws: WebSocket, attachment: Attachment, message: Extract<ClientMessage, { k: 'roll' }>): void {
    // Only the GM may roll where the table cannot see it.
    const visibility = message.visibility === 'gm' && attachment.role === 'gm' ? 'gm' : 'public'
    const mode: RollMode = message.mode === 'advantage' || message.mode === 'disadvantage' ? message.mode : 'normal'

    let result
    try {
      result = rollDice(String(message.expression ?? '').slice(0, 120), mode, secureRandom)
    } catch (error) {
      const text = error instanceof DiceError ? error.message : 'That is not a dice expression'
      this.#send(ws, { k: 'error', message: text })
      return
    }

    const entry: Roll = {
      id: crypto.randomUUID(),
      at: Date.now(),
      by: attachment.name,
      label: String(message.label ?? '').slice(0, 80),
      result,
      visibility,
      // Shared so every client tumbles the dice identically before settling
      // on the numbers the server already decided.
      seed: Math.floor(secureRandom() * 0xffffffff),
      ...(message.color ? { color: message.color } : {}),
    }

    this.#apply([{ t: 'roll.add', roll: entry }], true)
  }

  #handleChat(attachment: Attachment, message: Extract<ClientMessage, { k: 'chat' }>): void {
    const text = String(message.text ?? '')
      .trim()
      .slice(0, MAX_CHAT_LENGTH)
    if (!text) return
    const entry: ChatMessage = {
      id: crypto.randomUUID(),
      at: Date.now(),
      by: attachment.name,
      text,
      visibility: message.visibility === 'gm' && attachment.role === 'gm' ? 'gm' : 'public',
    }
    this.#apply([{ t: 'chat.add', message: entry }], true)
  }

  /**
   * Applies operations to the authoritative state, then tells each connection
   * what changed *in its own terms* — a GM hears the truth, a player hears
   * only the part of it they are entitled to.
   */
  #apply(ops: Op[], immediate: boolean): void {
    const state = this.#state
    if (!state) return

    const before = state
    let next = state
    for (const op of ops) next = reduce(next, op)
    this.#state = next

    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.#attachmentOf(socket)
      if (!attachment) continue

      const projected: Op[] = []
      let stepBefore = before
      for (const op of ops) {
        const stepAfter = reduce(stepBefore, op)
        projected.push(...projectOp(op, stepBefore, stepAfter, attachment.role))
        stepBefore = stepAfter
      }
      if (!projected.length) continue
      const next = { ...attachment, seq: attachment.seq + projected.length }
      socket.serializeAttachment(next)
      this.#send(socket, { k: 'ops', seq: next.seq, ops: projected })
    }

    this.#persist(immediate)
  }

  #presence(): Presence[] {
    const list: Presence[] = []
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.#attachmentOf(socket)
      if (attachment) {
        list.push({
          connectionId: attachment.connectionId,
          name: attachment.name,
          role: attachment.role,
          cursor: attachment.cursor,
        })
      }
    }
    return list
  }

  #broadcastPresence(): void {
    const presence = this.#presence()
    for (const socket of this.ctx.getWebSockets()) this.#send(socket, { k: 'presence', presence })
  }

  #send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message))
    } catch {
      // A socket that closed mid-broadcast is normal; presence will catch up.
    }
  }
}

/** Rolls and seeds come from the platform CSPRNG, not Math.random. */
function secureRandom(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0]! / 0x100000000
}

/** Constant-time-ish compare so the GM key cannot be probed byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Log entries and structural edits are worth a write; a token drag is not. */
function isStructural(op: Op): boolean {
  return op.t !== 'token.move'
}

export { MAX_LOG_ENTRIES }

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
