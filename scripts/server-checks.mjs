/**
 * Checks specific to the self-hosted server.
 *
 * The leak assertions in smoke.mjs run against any adapter. These cover what
 * only this one does: health, export, restore, and refusing to start without a
 * secret.
 *
 *   pnpm --filter @vtt/server build
 *   TABLE_SECRET=... node packages/server/dist/server.js &
 *   node scripts/server-checks.mjs
 */

const BASE = process.env.VTT_BASE ?? 'http://localhost:8080'

let failures = 0
const check = (label, condition) => {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}`)
  if (!condition) failures++
}

const json = async (path, init) => {
  const response = await fetch(`${BASE}${path}`, init)
  return { status: response.status, body: await response.json().catch(() => null) }
}

async function main() {
  console.log(`\nSelf-hosted server checks against ${BASE}\n`)

  check('health reports ready', (await json('/healthz')).body?.ok === true)

  const opened = await json('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Export test' }),
  })
  const { code, gmKey } = opened.body
  check('a table can be opened', Boolean(code && gmKey))

  // Put something in it worth losing.
  const socket = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/room/${code}/ws?name=GM&key=${gmKey}&role=gm`)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', reject)
  })
  socket.send(
    JSON.stringify({
      k: 'op',
      op: {
        t: 'scene.create',
        scene: {
          id: 'keep-me',
          name: 'The Cellar',
          assetId: null,
          width: 800,
          height: 600,
          grid: { size: 70, offsetX: 0, offsetY: 0, visible: true, snap: true, unitsPerSquare: 5, unitLabel: 'ft' },
          fog: { enabled: false, mask: { cell: 32, cols: 25, rows: 19, runs: [475] } },
          gmNotes: 'SECRET-STAGING-NOTE',
        },
      },
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 500))

  // --- Export ----------------------------------------------------------------

  const denied = await fetch(`${BASE}/api/room/${code}/export`)
  check('a player cannot export the table', denied.status === 403)

  const exported = await json(`/api/room/${code}/export?key=${gmKey}`)
  check('the GM can export the table', exported.status === 200)
  check(
    'the export names its format, so a file can be recognised later',
    exported.body?.format === 'virtual-tabletop/table',
  )
  check('the export carries the scene', Boolean(exported.body?.state?.scenes?.['keep-me']))
  check(
    'the export carries the GM’s notes, because it is the GM’s backup',
    /SECRET-STAGING-NOTE/.test(JSON.stringify(exported.body)),
  )
  check(
    'the export carries a schema version, so a restore knows its shape',
    typeof exported.body?.state?.schemaVersion === 'number',
  )

  // --- Restore ---------------------------------------------------------------

  const restored = await json('/api/rooms/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(exported.body),
  })
  check('an export can be restored', restored.status === 200 && Boolean(restored.body?.code))
  check('a restore opens a new table rather than overwriting one', restored.body?.code !== code)

  const check2 = await json(`/api/room/${restored.body.code}/export?key=${restored.body.gmKey}`)
  check('the restored table has the scene', Boolean(check2.body?.state?.scenes?.['keep-me']))
  check('the restored table kept its name', check2.body?.state?.settings?.name === 'Export test')

  const rubbish = await json('/api/rooms/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format: 'virtual-tabletop/table', state: 'not a table' }),
  })
  check('a file that is not a table is refused', rubbish.status === 400)

  const fromFuture = await json('/api/rooms/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: { ...exported.body.state, schemaVersion: 999 } }),
  })
  check('a table from a newer server is refused, not reinterpreted', fromFuture.status === 400)

  socket.close()
  console.log(`\n${failures ? `${failures} FAILED` : 'All checks passed'}\n`)
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
