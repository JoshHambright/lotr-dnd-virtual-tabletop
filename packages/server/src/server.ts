/**
 * The HTTP and websocket surface, exactly as docs/SERVER_CONTRACT.md fixes it,
 * so one client talks to this or to the Cloudflare adapter without knowing
 * which it reached.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import type { Invite, RoomState, Role } from '@vtt/core'
import { emptyRoom, formatInvite, inviteMessage, migrateRoom, parseInvite } from '@vtt/core'
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '@vtt/protocol'
import type { Config } from './config.js'
import { Room } from './room.js'
import { Store } from './store.js'

const MAX_ASSET_BYTES = 12 * 1024 * 1024
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|avif)$/

export interface ServerHandle {
  app: FastifyInstance
  store: Store
  close(): Promise<void>
}

export async function createServer(config: Config): Promise<ServerHandle> {
  const store = new Store(config.dbPath, config.assetDir)
  const app = Fastify({ logger: { level: config.logLevel } })

  /** Rooms currently in memory. A room is loaded on first use and kept. */
  const live = new Map<string, Room>()

  const roomFor = (code: string): Room | null => {
    const existing = live.get(code)
    if (existing) return existing

    const stored = store.loadRoom(code)
    if (!stored) return null

    const room = new Room(code, stored.state, (state) => store.saveRoom(code, state))
    live.set(code, room)
    return room
  }

  /**
   * GM keys are derived from the table code and the server's secret rather
   * than stored, so a key stays valid across a restart and a leaked database
   * row is not a key by itself.
   */
  const gmKeyFor = (code: string): string => createHmac('sha256', config.tableSecret).update(`gm:${code}`).digest('hex')

  const isGm = (code: string, offered: string | undefined): boolean => {
    if (!offered) return false
    const expected = Buffer.from(gmKeyFor(code))
    const given = Buffer.from(offered)
    // Constant time, so the key cannot be probed byte by byte.
    return expected.length === given.length && timingSafeEqual(expected, given)
  }

  /**
   * Signs an invite for one player at this table.
   *
   * Derived rather than stored, like the GM key: nothing to keep, nothing to
   * lose in a backup, and the link still works after a restart. What it is
   * signed over — the table, the epoch and the player id — is defined in core
   * so that the Worker signs the same thing.
   */
  const inviteFor = (code: string, epoch: number, playerId: string): Invite => ({
    playerId,
    signature: createHmac('sha256', config.tableSecret)
      .update(inviteMessage(code, epoch, playerId))
      .digest('base64url'),
  })

  /**
   * Checks an invite, and says who it is for.
   *
   * Returns null for anything that does not verify, and the caller treats that
   * the same as no invite at all — a forged token must not be distinguishable
   * from a missing one, or it becomes an oracle.
   */
  const playerIdFrom = (code: string, epoch: number, token: string | undefined): string | null => {
    if (!token) return null
    const offered = parseInvite(token)
    if (!offered) return null

    const expected = Buffer.from(inviteFor(code, epoch, offered.playerId).signature)
    const given = Buffer.from(offered.signature)
    // Constant time, so a signature cannot be probed byte by byte.
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
    return offered.playerId
  }

  app.addContentTypeParser(IMAGE_TYPES, { parseAs: 'buffer' }, (_request, body, done) => done(null, body))

  // The app and its websocket on one origin: no CORS, one URL to hand out.
  if (config.clientDir && existsSync(config.clientDir)) {
    await app.register(fastifyStatic, { root: config.clientDir })

    // A single-page app owns its own routing, so anything that is not an API
    // route and not a real file is the app itself.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' })
      return reply.sendFile('index.html')
    })
  }

  // --- Health ----------------------------------------------------------------

  app.get('/healthz', async () => ({ ok: true }))

  // --- Opening and finding a table -------------------------------------------

  app.post('/api/rooms', async (request, reply) => {
    const body = (request.body ?? {}) as { name?: string }

    // Codes are read aloud, so collisions are rare but must not silently
    // hand someone an existing table.
    let code = generateRoomCode()
    for (let attempt = 0; store.roomExists(code) && attempt < 10; attempt++) code = generateRoomCode()
    if (store.roomExists(code)) return reply.code(503).send({ error: 'Could not find a free table code' })

    const state = emptyRoom(typeof body.name === 'string' ? body.name.slice(0, 120) : 'A new table')
    const gmKey = gmKeyFor(code)
    store.createRoom(code, gmKey, state)
    return { code, gmKey }
  })

  /**
   * Mints an invite link for one player. GM only, obviously.
   *
   * The id is generated here rather than taken from the caller so that two
   * players cannot be handed the same one by accident, and so that nothing a
   * GM types ends up inside a signed message.
   */
  app.post<{ Params: { code: string }; Querystring: { key?: string } }>(
    '/api/room/:code/invite',
    async (request, reply) => {
      const code = normalizeRoomCode(request.params.code)
      const room = isValidRoomCode(code) ? roomFor(code) : null
      if (!room) return reply.code(404).send({ error: 'No table with that code' })
      if (!isGm(code, request.query.key)) return reply.code(403).send({ error: 'Only the GM may invite' })

      const playerId = randomUUID().replaceAll('-', '')
      return { invite: formatInvite(inviteFor(code, room.snapshot.settings.inviteEpoch, playerId)) }
    },
  )

  app.get<{ Params: { code: string } }>('/api/room/:code/exists', async (request) => {
    const code = normalizeRoomCode(request.params.code)
    const stored = isValidRoomCode(code) ? store.loadRoom(code) : null
    return { exists: stored !== null, name: stored?.state.settings.name ?? null }
  })

  // --- Assets ----------------------------------------------------------------

  app.put<{ Params: { code: string }; Querystring: { key?: string } }>(
    '/api/room/:code/asset',
    async (request, reply) => {
      const code = normalizeRoomCode(request.params.code)
      const room = isValidRoomCode(code) ? roomFor(code) : null
      if (!room) return reply.code(404).send({ error: 'No table with that code' })
      if (!isGm(code, request.query.key)) return reply.code(403).send({ error: 'Only the GM can upload' })

      const type = request.headers['content-type'] ?? ''
      if (!IMAGE_TYPES.test(type)) {
        return reply.code(415).send({ error: 'Maps and portraits must be images' })
      }

      const bytes = request.body as Buffer
      if (!bytes?.byteLength) return reply.code(400).send({ error: 'That file is empty' })
      if (bytes.byteLength > MAX_ASSET_BYTES) {
        return reply.code(413).send({ error: `Images must be under ${MAX_ASSET_BYTES / 1024 / 1024} MB` })
      }

      const id = store.putAsset(code, bytes, type)
      return { id, size: bytes.byteLength, type }
    },
  )

  app.get<{ Params: { code: string; id: string }; Querystring: { key?: string } }>(
    '/api/room/:code/asset/:id',
    async (request, reply) => {
      const code = normalizeRoomCode(request.params.code)
      const room = isValidRoomCode(code) ? roomFor(code) : null
      if (!room) return reply.code(404).send({ error: 'No table with that code' })

      // A staged map the GM has not put on the table is not fetchable by a
      // player even with its id, so tonight's ambush cannot be previewed.
      if (!isGm(code, request.query.key) && !room.assetVisibleToPlayers(request.params.id)) {
        return reply.code(404).send({ error: 'Not found' })
      }

      const asset = store.getAsset(request.params.id)
      if (!asset) return reply.code(404).send({ error: 'Not found' })

      // Ids are content hashes, so what is behind one never changes.
      return reply
        .header('content-type', asset.type)
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(asset.bytes)
    },
  )

  // --- Export and restore ----------------------------------------------------

  app.get<{ Params: { code: string }; Querystring: { key?: string } }>(
    '/api/room/:code/export',
    async (request, reply) => {
      const code = normalizeRoomCode(request.params.code)
      const room = isValidRoomCode(code) ? roomFor(code) : null
      if (!room) return reply.code(404).send({ error: 'No table with that code' })
      if (!isGm(code, request.query.key)) return reply.code(403).send({ error: 'Only the GM can export' })

      // Flush first: an export that misses the last token move is worse than
      // no export, because it looks complete.
      room.flush()
      return reply
        .header('content-disposition', `attachment; filename="table-${code}.json"`)
        .send({ format: 'virtual-tabletop/table', version: 1, exportedAt: Date.now(), state: room.snapshot })
    },
  )

  app.post('/api/rooms/import', async (request, reply) => {
    const body = request.body as { state?: unknown } | undefined
    if (!body?.state) return reply.code(400).send({ error: 'That file does not contain a table' })

    let state: RoomState
    try {
      // Anything off disk may predate the current shape, and a hand-edited
      // file may be nothing of the sort.
      state = migrateRoom(body.state)
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'That table could not be read' })
    }

    // A restore opens a *new* table rather than overwriting one, so importing
    // a backup can never destroy the campaign you imported it next to.
    let code = generateRoomCode()
    for (let attempt = 0; store.roomExists(code) && attempt < 10; attempt++) code = generateRoomCode()
    const gmKey = gmKeyFor(code)
    store.createRoom(code, gmKey, state)
    return { code, gmKey }
  })

  // --- Websockets ------------------------------------------------------------

  const sockets = new WebSocketServer({ noServer: true })

  app.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const match = /^\/api\/room\/([^/]+)\/ws$/.exec(url.pathname)
    if (!match) return socket.destroy()

    const code = normalizeRoomCode(decodeURIComponent(match[1]!))
    const room = isValidRoomCode(code) ? roomFor(code) : null
    if (!room) return socket.destroy()

    const name = (url.searchParams.get('name') ?? '').trim().slice(0, 40) || 'Someone'
    const key = url.searchParams.get('key') ?? undefined
    const role: Role = isGm(code, key) ? 'gm' : 'player'

    // Claiming to be the GM with the wrong key is refused outright rather
    // than silently demoted, so a mistyped key says so.
    if (url.searchParams.get('role') === 'gm' && role !== 'gm') {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      return socket.destroy()
    }

    const settings = room.snapshot.settings
    const playerId = playerIdFrom(code, settings.inviteEpoch, url.searchParams.get('invite') ?? undefined)

    // A table that asks for invites will not take a name instead. The GM is
    // exempt: they hold the key, which is a stronger claim than any invite.
    if (settings.requireInvite && role !== 'gm' && !playerId) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      return socket.destroy()
    }

    sockets.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      const seat = room.join(ws, name, role, playerId)
      ws.on('message', (data) => room.receive(seat, data.toString()))
      ws.on('close', () => room.leave(seat))
      ws.on('error', () => room.leave(seat))
    })
  })

  return {
    app,
    store,
    async close() {
      for (const room of live.values()) room.flush()
      sockets.close()
      await app.close()
      store.close()
    },
  }
}
