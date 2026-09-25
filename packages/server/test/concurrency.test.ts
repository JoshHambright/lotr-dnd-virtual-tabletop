/**
 * The same table, over real sockets.
 *
 * `packages/core/test/convergence.test.ts` proves the pipeline converges. This
 * proves the *server* does: a real Fastify instance, real websockets, the real
 * room actor and the real SQLite store, with several clients talking over each
 * other the way a session does.
 *
 * The difference matters. The in-process harness calls `authorize`, `reduce`
 * and `projectOp` in the order the server is supposed to call them. Here the
 * server chooses that order itself, under concurrent traffic, and each client
 * folds only the operations that actually came down its own socket — so a
 * message dropped, misordered or sent to the wrong seat shows up as a view
 * that no longer matches.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import type { Op, Role, RoomState } from '@vtt/core'
import { newScene, newToken, projectState, reduce } from '@vtt/core'
import type { ServerHandle } from '../src/server.js'
import { createServer } from '../src/server.js'

const SECRET = 'concurrency-test-secret-not-a-real-one'

let server: ServerHandle
let base: string
let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'vtt-concurrency-'))
  server = await createServer({
    port: 0,
    dataDir,
    dbPath: join(dataDir, 'tables.db'),
    assetDir: join(dataDir, 'assets'),
    tableSecret: SECRET,
    logLevel: 'error',
    clientDir: null,
  })
  // Port 0 lets the OS pick, so a developer running the real server on 8080
  // does not make this suite fail in a way that looks like a bug.
  await server.app.listen({ port: 0, host: '127.0.0.1' })
  const address = server.app.server.address()
  if (!address || typeof address === 'string') throw new Error('the server did not bind a port')
  base = `http://127.0.0.1:${address.port}`
}, 30_000)

afterAll(async () => {
  await server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

/**
 * A browser, near enough: it folds what it is sent with the same reducer the
 * real client uses, and knows nothing the server did not tell it.
 */
class Client {
  view!: RoomState
  readonly errors: string[] = []
  /** Every place this connection's operation count did not follow on. */
  readonly gaps: string[] = []
  readonly name: string
  #socket: WebSocket
  #seq = 0

  private constructor(name: string, socket: WebSocket) {
    this.name = name
    this.#socket = socket
  }

  static join(code: string, name: string, key?: string): Promise<Client> {
    const params = new URLSearchParams({ name })
    if (key) {
      params.set('key', key)
      params.set('role', 'gm')
    }
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/api/room/${code}/ws?${params}`)
    const client = new Client(name, socket)

    // The handler goes on before the socket opens, not after. `hello` is sent
    // the instant the server accepts the upgrade, and a listener attached in
    // the open callback is late often enough to be a flaky test.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${name} was never greeted`)), 5_000)
      socket.on('error', reject)
      socket.on('message', (raw) => {
        const message = JSON.parse(String(raw))
        if (message.k === 'hello') {
          client.view = message.state
          client.#seq = message.seq
          clearTimeout(timer)
          resolve(client)
          return
        }
        if (message.k === 'ops') {
          const ops = message.ops as Op[]
          // Gapless per connection, so anything else means a batch went
          // missing and this browser is now looking at a different table.
          const expected = client.#seq + ops.length
          if (message.seq !== expected) client.gaps.push(`expected ${expected}, got ${message.seq}`)
          client.#seq = message.seq
          for (const op of ops) client.view = reduce(client.view, op)
        }
        if (message.k === 'error') client.errors.push(message.message)
      })
    })
  }

  /** How many operations this connection has been sent. */
  get seq(): number {
    return this.#seq
  }

  send(op: Op): void {
    this.#socket.send(JSON.stringify({ k: 'op', op }))
  }

  /**
   * Chat is its own message kind, not an operation. `chat.add` and `roll.add`
   * are deliberately absent from the wire schema so that a client cannot forge
   * a log entry — the server writes those itself.
   */
  chat(text: string): void {
    this.#socket.send(JSON.stringify({ k: 'chat', text, visibility: 'public' }))
  }

  close(): void {
    this.#socket.close()
  }
}

let fences = 0

/**
 * Waits for the table to go quiet, by sending something through it.
 *
 * A fixed sleep is either slower than it needs to be or flaky on a loaded
 * machine. One socket delivers in order, so a marker sent last arrives last:
 * once every client has seen it, everything before it has landed too.
 */
async function fence(gm: Client, clients: Client[]): Promise<void> {
  fences += 1
  const marker = `fence-${fences}`
  gm.chat(marker)

  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (clients.every((client) => client.view.chat.some((entry) => entry.text === marker))) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`the table never settled at ${marker}`)
}

async function openTable(name: string): Promise<{ code: string; gmKey: string }> {
  const response = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return response.json() as Promise<{ code: string; gmKey: string }>
}

/** The server's own state, as only the GM may fetch it. */
async function serverState(code: string, gmKey: string): Promise<RoomState> {
  const response = await fetch(`${base}/api/room/${code}/export?key=${gmKey}`)
  const body = (await response.json()) as { state: RoomState }
  return body.state
}

function expectAgrees(client: Client, truth: RoomState, role: Role, who: string): void {
  // Both halves matter. A view can be right by luck — a dropped token move
  // overwritten by the next one — while the stream that built it was not, and
  // the next thing that goes missing will not be so forgiving.
  expect({ who, gaps: client.gaps }).toEqual({ who, gaps: [] })
  expect({ who, view: client.view }).toEqual({ who, view: projectState(truth, role) })
}

const scene = (id: string, name: string) => ({
  ...newScene(id, name, 1600, 1200, null),
  gmNotes: `${name} — GM only`,
})

describe('a table over real sockets', () => {
  it('keeps three clients in step while two of them drag at once', async () => {
    const { code, gmKey } = await openTable('The Ring Goes South')
    const gm = await Client.join(code, 'Josh', gmKey)
    const sam = await Client.join(code, 'Sam')
    const merry = await Client.join(code, 'Merry')

    gm.send({ t: 'scene.create', scene: scene('tavern', 'The Prancing Pony') })
    gm.send({ t: 'scene.setActive', id: 'tavern' })
    gm.send({ t: 'token.create', token: newToken('t-sam', 'tavern', 0, 0, { label: 'Sam' }) })
    gm.send({ t: 'token.create', token: newToken('t-merry', 'tavern', 0, 0, { label: 'Merry' }) })
    await fence(gm, [gm, sam, merry])

    // Both players drag without waiting for each other, which is what a real
    // pair of hands on a real map does.
    for (let step = 1; step <= 20; step += 1) {
      sam.send({ t: 'token.move', id: 't-sam', x: step * 10, y: step * 4 })
      merry.send({ t: 'token.move', id: 't-merry', x: 400 - step * 10, y: step * 6 })
    }
    await fence(gm, [gm, sam, merry])

    const truth = await serverState(code, gmKey)
    expectAgrees(gm, truth, 'gm', 'the GM')
    expectAgrees(sam, truth, 'player', 'Sam')
    expectAgrees(merry, truth, 'player', 'Merry')
    expect(truth.tokens['t-sam']).toMatchObject({ x: 200, y: 80 })

    for (const client of [gm, sam, merry]) client.close()
  }, 30_000)

  it('settles two clients dragging the same token on one answer', async () => {
    const { code, gmKey } = await openTable('The barrel')
    const gm = await Client.join(code, 'Josh', gmKey)
    const sam = await Client.join(code, 'Sam')
    const merry = await Client.join(code, 'Merry')

    gm.send({ t: 'scene.create', scene: scene('cellar', 'The Cellar') })
    gm.send({ t: 'scene.setActive', id: 'cellar' })
    gm.send({ t: 'token.create', token: newToken('t1', 'cellar', 0, 0, { label: 'A barrel' }) })
    await fence(gm, [gm, sam, merry])

    // Interleaved on purpose: the server serialises them and the last one it
    // happens to process wins, but all three views must name the same winner.
    for (let step = 0; step < 15; step += 1) {
      sam.send({ t: 'token.move', id: 't1', x: step, y: 0 })
      merry.send({ t: 'token.move', id: 't1', x: 0, y: step })
    }
    await fence(gm, [gm, sam, merry])

    const truth = await serverState(code, gmKey)
    expect(sam.view.tokens.t1).toEqual(merry.view.tokens.t1)
    expectAgrees(sam, truth, 'player', 'Sam')
    expectAgrees(merry, truth, 'player', 'Merry')

    for (const client of [gm, sam, merry]) client.close()
  }, 30_000)

  it('hands a latecomer exactly what the others have built up', async () => {
    const { code, gmKey } = await openTable('Weathertop')
    const gm = await Client.join(code, 'Josh', gmKey)
    const sam = await Client.join(code, 'Sam')

    gm.send({ t: 'scene.create', scene: scene('hill', 'Weathertop') })
    gm.send({ t: 'scene.setActive', id: 'hill' })
    gm.send({ t: 'fog.enable', sceneId: 'hill', enabled: true })
    gm.send({ t: 'token.create', token: newToken('t-sam', 'hill', 10, 10, { label: 'Sam' }) })
    gm.send({
      t: 'token.create',
      token: newToken('t-nazgul', 'hill', 900, 900, { label: 'Nazgûl', hidden: true, statBlockId: 'sb-1' }),
    })
    await fence(gm, [gm, sam])

    sam.send({ t: 'token.move', id: 't-sam', x: 300, y: 200 })
    gm.send({ t: 'fog.paint', sceneId: 'hill', shape: { kind: 'circle', x: 300, y: 200, radius: 120 }, reveal: true })
    await fence(gm, [gm, sam])

    const merry = await Client.join(code, 'Merry')
    expect(merry.view).toEqual(sam.view)
    expect(merry.view.tokens['t-nazgul']).toBeUndefined()

    // And the reveal lands on both of them identically.
    gm.send({ t: 'token.update', id: 't-nazgul', patch: { hidden: false } })
    await fence(gm, [gm, sam, merry])
    expect(merry.view).toEqual(sam.view)
    expect(sam.view.tokens['t-nazgul']?.statBlockId).toBeNull()

    for (const client of [gm, sam, merry]) client.close()
  }, 30_000)

  it('gives a reconnecting player the table as it is now, not as they left it', async () => {
    const { code, gmKey } = await openTable('Moria')
    const gm = await Client.join(code, 'Josh', gmKey)
    let sam = await Client.join(code, 'Sam')

    gm.send({ t: 'scene.create', scene: scene('gate', 'The West-gate') })
    gm.send({ t: 'scene.setActive', id: 'gate' })
    gm.send({ t: 'token.create', token: newToken('t-sam', 'gate', 10, 10, { label: 'Sam' }) })
    await fence(gm, [gm, sam])

    sam.close()

    // The session carries on without him.
    gm.send({ t: 'scene.create', scene: scene('bridge', 'The Bridge of Khazad-dûm') })
    gm.send({ t: 'scene.setActive', id: 'bridge' })
    gm.send({ t: 'token.create', token: newToken('t-balrog', 'bridge', 500, 500, { label: 'Something in the dark' }) })
    await fence(gm, [gm])

    sam = await Client.join(code, 'Sam')
    const truth = await serverState(code, gmKey)
    expectAgrees(sam, truth, 'player', 'Sam')
    expect(sam.view.scenes.gate).toBeUndefined()
    expect(sam.view.tokens['t-balrog']).toBeDefined()

    gm.close()
    sam.close()
  }, 30_000)

  it('counts operations per connection, so a gap can only mean one thing', async () => {
    const { code, gmKey } = await openTable('Counting')
    const gm = await Client.join(code, 'Josh', gmKey)
    const sam = await Client.join(code, 'Sam')

    gm.send({ t: 'scene.create', scene: scene('tavern', 'The Prancing Pony') })
    gm.send({ t: 'scene.setActive', id: 'tavern' })
    // Staged: the GM is told about all of this, and Sam about none of it.
    gm.send({ t: 'scene.create', scene: scene('staged', 'A staged map') })
    gm.send({ t: 'token.create', token: newToken('t-hidden', 'staged', 0, 0, { label: 'Waiting' }) })
    gm.send({ t: 'token.create', token: newToken('t-sam', 'tavern', 10, 10, { label: 'Sam' }) })
    await fence(gm, [gm, sam])

    // A room-wide counter would arrive at Sam full of holes it is not his
    // business to explain. Counted per seat, both of them follow on.
    expect(gm.gaps).toEqual([])
    expect(sam.gaps).toEqual([])
    expect(gm.seq).toBeGreaterThan(sam.seq)

    gm.close()
    sam.close()
  }, 30_000)

  it('refuses a player’s forbidden operation without knocking anyone out of step', async () => {
    const { code, gmKey } = await openTable('The Prancing Pony')
    const gm = await Client.join(code, 'Josh', gmKey)
    const sam = await Client.join(code, 'Sam')

    gm.send({ t: 'scene.create', scene: scene('tavern', 'The Prancing Pony') })
    gm.send({ t: 'scene.setActive', id: 'tavern' })
    gm.send({ t: 'scene.create', scene: scene('staged', 'A staged map') })
    gm.send({ t: 'token.create', token: newToken('t-sam', 'tavern', 10, 10, { label: 'Sam' }) })
    await fence(gm, [gm, sam])

    // A player reaching for the GM's controls, between two legitimate moves.
    sam.send({ t: 'token.move', id: 't-sam', x: 40, y: 40 })
    sam.send({ t: 'scene.setActive', id: 'staged' })
    sam.send({ t: 'token.move', id: 't-sam', x: 80, y: 40 })
    await fence(gm, [gm, sam])

    expect(sam.errors.length).toBeGreaterThan(0)
    const truth = await serverState(code, gmKey)
    expect(truth.activeSceneId).toBe('tavern')
    expectAgrees(sam, truth, 'player', 'Sam')
    expectAgrees(gm, truth, 'gm', 'the GM')

    gm.close()
    sam.close()
  }, 30_000)
})
