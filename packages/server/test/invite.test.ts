/**
 * Invites, against the real server.
 *
 * `packages/core/test/invite.test.ts` tests what a token looks like. This tests
 * whether one can be forged, reused across tables, or survive a revocation —
 * which is the part a format test cannot reach, because the signing lives here.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { identityForInvite, newCharacter } from '@vtt/core'
import type { ServerHandle } from '../src/server.js'
import { createServer } from '../src/server.js'

const SECRET = 'invite-test-secret-long-enough-to-be-accepted'

let server: ServerHandle
let base: string
let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'vtt-invite-'))
  server = await createServer({
    port: 0,
    dataDir,
    dbPath: join(dataDir, 'tables.db'),
    assetDir: join(dataDir, 'assets'),
    tableSecret: SECRET,
    logLevel: 'error',
    clientDir: null,
  })
  await server.app.listen({ port: 0, host: '127.0.0.1' })
  const address = server.app.server.address()
  if (!address || typeof address === 'string') throw new Error('the server did not bind a port')
  base = `http://127.0.0.1:${address.port}`
}, 30_000)

afterAll(async () => {
  await server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

async function openTable(name: string): Promise<{ code: string; gmKey: string }> {
  const response = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return response.json() as Promise<{ code: string; gmKey: string }>
}

async function mint(code: string, key: string): Promise<{ status: number; invite?: string }> {
  const response = await fetch(`${base}/api/room/${code}/invite?key=${key}`, { method: 'POST' })
  if (!response.ok) return { status: response.status }
  const body = (await response.json()) as { invite: string }
  return { status: response.status, invite: body.invite }
}

/** Tries to join, and says how far it got. */
function tryJoin(
  code: string,
  name: string,
  params: Record<string, string> = {},
): Promise<{ ok: true; hello: { role: string } } | { ok: false }> {
  const query = new URLSearchParams({ name, ...params })
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/api/room/${code}/ws?${query}`)

  return new Promise((resolve) => {
    const finish = (value: { ok: true; hello: { role: string } } | { ok: false }) => {
      clearTimeout(timer)
      socket.close()
      resolve(value)
    }
    const timer = setTimeout(() => finish({ ok: false }), 4_000)
    socket.once('error', () => finish({ ok: false }))
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw))
      if (message.k === 'hello') finish({ ok: true, hello: message })
    })
  })
}

/** Sends one operation and reports whether the server accepted it. */
function attempt(code: string, name: string, params: Record<string, string>, op: unknown): Promise<string | null> {
  const query = new URLSearchParams({ name, ...params })
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/api/room/${code}/ws?${query}`)

  return new Promise((resolve) => {
    let refusal: string | null = null
    const timer = setTimeout(() => {
      socket.close()
      resolve(refusal)
    }, 1_200)
    socket.once('error', () => {
      clearTimeout(timer)
      resolve('could not connect')
    })
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw))
      if (message.k === 'hello') socket.send(JSON.stringify({ k: 'op', op }))
      if (message.k === 'error') refusal = message.message
    })
  })
}

describe('minting', () => {
  it('is the GM’s alone', async () => {
    const { code, gmKey } = await openTable('Minting')
    expect((await mint(code, gmKey)).invite).toBeTruthy()
    expect((await mint(code, 'not-the-key')).status).toBe(403)
    expect((await mint(code, '')).status).toBe(403)
  })

  it('gives every player a different id', async () => {
    const { code, gmKey } = await openTable('Two players')
    const first = (await mint(code, gmKey)).invite
    const second = (await mint(code, gmKey)).invite
    expect(first).not.toBe(second)
  })

  it('refuses a table that does not exist', async () => {
    expect((await mint('ZZZZZ', 'anything')).status).toBe(404)
  })
})

describe('an open table', () => {
  it('still lets anybody in by name, because that is what it is', async () => {
    const { code } = await openTable('Open')
    expect((await tryJoin(code, 'Sam')).ok).toBe(true)
  })

  it('takes a valid invite as well', async () => {
    const { code, gmKey } = await openTable('Open with invites')
    const { invite } = await mint(code, gmKey)
    const joined = await tryJoin(code, 'Sam', { invite: invite! })
    expect(joined.ok).toBe(true)
  })

  it('ignores a forged invite rather than trusting it', async () => {
    // Not refused — an open table takes anyone — but the identity must fall
    // back to the name, or a forged token would be as good as a real one.
    const { code } = await openTable('Forged')
    const joined = await tryJoin(code, 'Sam', { invite: `abcd1234.${'x'.repeat(43)}` })
    expect(joined.ok).toBe(true)
  })
})

describe('a table that requires invites', () => {
  async function lockedTable(name: string) {
    const { code, gmKey } = await openTable(name)
    const gm = new WebSocket(`${base.replace(/^http/, 'ws')}/api/room/${code}/ws?name=Josh&key=${gmKey}&role=gm`)
    await new Promise<void>((resolve, reject) => {
      gm.once('error', reject)
      gm.on('message', (raw) => {
        if (JSON.parse(String(raw)).k === 'hello') {
          gm.send(JSON.stringify({ k: 'op', op: { t: 'settings.update', patch: { requireInvite: true } } }))
          setTimeout(resolve, 150)
        }
      })
    })
    gm.close()
    return { code, gmKey }
  }

  it('turns away a player with no invite', async () => {
    const { code } = await lockedTable('Locked')
    expect((await tryJoin(code, 'Sam')).ok).toBe(false)
  })

  it('turns away a forged invite', async () => {
    const { code } = await lockedTable('Locked forged')
    expect((await tryJoin(code, 'Sam', { invite: `abcd1234.${'x'.repeat(43)}` })).ok).toBe(false)
    expect((await tryJoin(code, 'Sam', { invite: 'nonsense' })).ok).toBe(false)
  })

  it('lets a real invite in', async () => {
    const { code, gmKey } = await lockedTable('Locked real')
    const { invite } = await mint(code, gmKey)
    expect((await tryJoin(code, 'Sam', { invite: invite! })).ok).toBe(true)
  })

  it('still lets the GM in on their key, which is the stronger claim', async () => {
    const { code, gmKey } = await lockedTable('Locked GM')
    const joined = await tryJoin(code, 'Josh', { key: gmKey, role: 'gm' })
    expect(joined.ok).toBe(true)
    expect(joined.ok && joined.hello.role).toBe('gm')
  })

  it('refuses an invite minted for a different table', async () => {
    const { code } = await lockedTable('Locked A')
    const other = await openTable('Table B')
    const { invite } = await mint(other.code, other.gmKey)
    expect((await tryJoin(code, 'Sam', { invite: invite! })).ok).toBe(false)
  })
})

describe('ownership', () => {
  it('follows the invite, so a name cannot claim an invited player’s sheet', async () => {
    const { code, gmKey } = await openTable('Ownership')
    const { invite } = await mint(code, gmKey)
    const playerId = invite!.split('.')[0]!

    // Sam creates a sheet while holding the invite.
    const sheet = newCharacter('c1', 'Sam', 'Sam')
    await attempt(code, 'Sam', { invite: invite! }, { t: 'character.upsert', character: sheet })

    // Someone else types the same name and tries to edit it. The sheet is
    // owned by the invite, not by the word "Sam".
    const refusal = await attempt(
      code,
      'Sam',
      {},
      { t: 'character.upsert', character: { ...sheet, values: { stolen: true } } },
    )
    expect(refusal).toMatch(/belongs to someone else/)

    // And the owner recorded is the invited id, not the name-derived one.
    const state = await (await fetch(`${base}/api/room/${code}/export?key=${gmKey}`)).json()
    expect(state.state.characters.c1.ownerId).toBe(identityForInvite(playerId))
  })

  it('lets the invited player keep editing their own sheet', async () => {
    const { code, gmKey } = await openTable('Own sheet')
    const { invite } = await mint(code, gmKey)
    const sheet = newCharacter('c2', 'Merry', 'Merry')

    await attempt(code, 'Merry', { invite: invite! }, { t: 'character.upsert', character: sheet })
    const refusal = await attempt(
      code,
      'Merry',
      { invite: invite! },
      { t: 'character.upsert', character: { ...sheet, values: { hp: { value: 3, max: 9 } } } },
    )
    expect(refusal).toBeNull()
  })
})

describe('revocation', () => {
  it('stops every invite at once when the epoch moves', async () => {
    const { code, gmKey } = await openTable('Revoke')
    const { invite } = await mint(code, gmKey)
    expect((await tryJoin(code, 'Sam', { invite: invite! })).ok).toBe(true)

    const gm = new WebSocket(`${base.replace(/^http/, 'ws')}/api/room/${code}/ws?name=Josh&key=${gmKey}&role=gm`)
    await new Promise<void>((resolve, reject) => {
      gm.once('error', reject)
      gm.on('message', (raw) => {
        if (JSON.parse(String(raw)).k === 'hello') {
          gm.send(
            JSON.stringify({ k: 'op', op: { t: 'settings.update', patch: { inviteEpoch: 2, requireInvite: true } } }),
          )
          setTimeout(resolve, 150)
        }
      })
    })
    gm.close()

    expect((await tryJoin(code, 'Sam', { invite: invite! })).ok).toBe(false)

    // And a link minted after the bump works again.
    const reissued = await mint(code, gmKey)
    expect((await tryJoin(code, 'Sam', { invite: reissued.invite! })).ok).toBe(true)
  })
})
