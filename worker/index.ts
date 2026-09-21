/**
 * The Worker: a thin router. Everything stateful belongs to the room's
 * Durable Object, so this file only decides which room a request is for and
 * hands it over.
 */

import { TableRoom } from './room.js'
import { generateGmKey, generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../shared/protocol.js'

export { TableRoom }

export interface Env {
  TABLE: DurableObjectNamespace
  STATIC: Fetcher
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (!url.pathname.startsWith('/api/')) {
      return env.STATIC.fetch(request)
    }

    try {
      return await route(request, env, url)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error'
      return json({ error: message }, 500)
    }
  },
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  // POST /api/rooms — open a new table and hand back its code and GM key.
  if (url.pathname === '/api/rooms' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { name?: string }
    const code = generateRoomCode()
    const gmKey = generateGmKey()
    const room = roomStub(env, code)

    const created = await room.fetch(
      new Request('https://room/create', {
        method: 'POST',
        body: JSON.stringify({ code, gmKey, name: body.name ?? 'A new table' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    if (!created.ok) return created

    return json({ code, gmKey })
  }

  const match = /^\/api\/room\/([^/]+)(\/.*)?$/.exec(url.pathname)
  if (!match) return json({ error: 'Not found' }, 404)

  const code = normalizeRoomCode(decodeURIComponent(match[1]!))
  if (!isValidRoomCode(code)) return json({ error: 'That is not a table code' }, 400)

  const rest = match[2] ?? '/'
  const room = roomStub(env, code)

  // Everything under a room — the websocket, asset upload, asset download —
  // is the Durable Object's business. Forward with the path it expects.
  const forwarded = new Request(`https://room${rest}${url.search}`, request)
  return room.fetch(forwarded)
}

function roomStub(env: Env, code: string): DurableObjectStub {
  return env.TABLE.get(env.TABLE.idFromName(`room:${code}`))
}
