/**
 * End-to-end smoke test against a running server.
 *
 *   npx wrangler dev --port 8787   # in one shell
 *   node scripts/smoke.mjs         # in another
 *
 * The unit tests prove the filtering functions are right. This proves the
 * wiring is: that a real player socket, talking to a real Durable Object over
 * a real websocket, never receives the GM's material.
 */

const BASE = process.env.VTT_BASE ?? 'http://localhost:8787'
const WS_BASE = BASE.replace(/^http/, 'ws')

let failures = 0
const check = (label, condition) => {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}`)
  if (!condition) failures++
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A socket that records everything it is ever sent. */
function connect(code, name, key, { claimGm = true, invite = null } = {}) {
  const params = new URLSearchParams({ name })
  if (invite) params.set('invite', invite)
  if (key) {
    params.set('key', key)
    if (claimGm) params.set('role', 'gm')
  }
  const socket = new WebSocket(`${WS_BASE}/api/room/${code}/ws?${params}`)
  const received = []
  socket.addEventListener('message', (event) => received.push(JSON.parse(event.data)))
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({ socket, received, send: (m) => socket.send(JSON.stringify(m)) }))
    socket.addEventListener('error', reject)
  })
}

const hello = (peer) => peer.received.find((m) => m.k === 'hello')
const allOps = (peer) => peer.received.filter((m) => m.k === 'ops').flatMap((m) => m.ops)
const everything = (peer) => JSON.stringify(peer.received)

async function main() {
  console.log(`\nSmoke test against ${BASE}\n`)

  // --- Opening a table -------------------------------------------------------
  const created = await (
    await fetch(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke Test Table' }),
    })
  ).json()
  check('a table can be opened', Boolean(created.code && created.gmKey))
  const { code, gmKey } = created

  check(
    'the table reports itself as existing',
    (await (await fetch(`${BASE}/api/room/${code}/exists`)).json()).exists === true,
  )

  // --- Uploading a map -------------------------------------------------------
  // Two 1x1 PNGs of *different* colours. They must differ byte for byte: the
  // self-hosted store is content-addressed, so uploading the same image twice
  // yields one id, and this test's whole point is telling two assets apart.
  //
  // That dedup is safe rather than a hole. An id a player can fetch is one
  // whose bytes are already reachable through something visible, so sharing an
  // id between a staged map and a live one can only ever return a picture they
  // could already see.
  const decode = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const pngRed = decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4oaEBAALUARkFUI+kAAAAAElFTkSuQmCC')
  const pngBlue = decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQCDgBAAHkAUEYgvCnAAAAAElFTkSuQmCC')
  const upload = async (bytes, key = gmKey) =>
    fetch(`${BASE}/api/room/${code}/asset${key ? `?key=${key}` : ''}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    })

  const liveAsset = await (await upload(pngRed)).json()
  const stagedAsset = await (await upload(pngBlue)).json()
  check('the two test maps are genuinely different assets', liveAsset.id !== stagedAsset.id)
  check('the GM can upload a map', Boolean(liveAsset.id))

  const playerUpload = await upload(pngRed, null)
  check('a player cannot upload', playerUpload.status === 403)

  const notAnImage = await fetch(`${BASE}/api/room/${code}/asset?key=${gmKey}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/zip' },
    body: pngRed,
  })
  check('non-images are refused', notAnImage.status === 415)

  // --- Connecting ------------------------------------------------------------
  const gm = await connect(code, 'Gandalf', gmKey)
  const player = await connect(code, 'Josh', null)
  // A wrong key claiming GM is refused outright; the same key without the
  // claim is simply ignored and the connection is seated as a player.
  let refused = false
  try {
    await connect(code, 'Sneak', 'not-the-real-key')
  } catch {
    refused = true
  }
  const impostor = await connect(code, 'Sneak', 'not-the-real-key', { claimGm: false })
  await sleep(300)

  check('the GM is seated as GM', hello(gm)?.role === 'gm')
  check('a player is seated as a player', hello(player)?.role === 'player')
  check('a wrong GM key is refused outright', refused)
  check('a wrong key does not make you GM', hello(impostor)?.role === 'player')
  check('everyone is listed in presence', hello(player)?.presence.length >= 2)

  // --- Staging the session ---------------------------------------------------
  const live = { id: 'scene-live', name: 'The Prancing Pony', assetId: liveAsset.id }
  const staged = { id: 'scene-staged', name: 'Weathertop', assetId: stagedAsset.id }

  const makeScene = (s, gmNotes) => ({
    id: s.id,
    name: s.name,
    assetId: s.assetId,
    width: 640,
    height: 640,
    grid: { size: 70, offsetX: 0, offsetY: 0, visible: true, snap: true, unitsPerSquare: 5, unitLabel: 'ft' },
    fog: { enabled: true, mask: { cell: 32, cols: 20, rows: 20, runs: [400] } },
    gmNotes,
  })

  gm.send({ k: 'op', op: { t: 'scene.create', scene: makeScene(live, 'Strider is watching from the corner') } })
  gm.send({ k: 'op', op: { t: 'scene.create', scene: makeScene(staged, 'SECRET-NAZGUL-AMBUSH') } })
  gm.send({ k: 'op', op: { t: 'scene.setActive', id: live.id } })
  gm.send({
    k: 'op',
    op: {
      t: 'statblock.upsert',
      statBlock: {
        id: 'sb1',
        name: 'SECRET-CAVE-TROLL',
        kind: 'Troll',
        armourClass: 15,
        maxHp: 84,
        speed: '30 ft.',
        abilities: { str: 18 },
        attributeLevel: 5,
        endurance: 84,
        might: 2,
        resolve: 3,
        hateOrDespair: 4,
        attacks: 'Club',
        specials: '',
        notes: '',
        color: '#a33d3d',
        imageAssetId: null,
      },
    },
  })
  gm.send({
    k: 'op',
    op: {
      t: 'encounter.upsert',
      encounter: { id: 'e1', name: 'SECRET-AMBUSH', notes: '', members: [{ statBlockId: 'sb1', count: 2 }] },
    },
  })
  await sleep(300)

  const token = (id, sceneId, extra) => ({
    id,
    sceneId,
    x: 100,
    y: 100,
    squares: 1,
    label: id,
    color: '#c2703d',
    imageAssetId: null,
    hidden: false,
    characterId: null,
    statBlockId: null,
    hp: null,
    maxHp: null,
    showHpToPlayers: true,
    conditions: [],
    locked: false,
    ...extra,
  })

  gm.send({ k: 'op', op: { t: 'token.create', token: token('frodo', live.id, { label: 'Frodo' }) } })
  gm.send({
    k: 'op',
    op: {
      t: 'token.create',
      token: token('lurker', live.id, { label: 'SECRET-BILL-FERNY', hidden: true, statBlockId: 'sb1' }),
    },
  })
  gm.send({
    k: 'op',
    op: { t: 'token.create', token: token('orc', live.id, { label: 'Orc', hp: 7, maxHp: 11, showHpToPlayers: false }) },
  })
  gm.send({
    k: 'op',
    op: { t: 'fog.paint', sceneId: live.id, shape: { kind: 'circle', x: 100, y: 100, radius: 90 }, reveal: true },
  })
  await sleep(400)

  // --- The leak checks -------------------------------------------------------
  const playerSaw = everything(player)
  for (const secret of [
    'SECRET-NAZGUL-AMBUSH',
    'SECRET-CAVE-TROLL',
    'SECRET-AMBUSH',
    'SECRET-BILL-FERNY',
    'Strider is watching',
  ]) {
    check(`a player is never sent "${secret}"`, !playerSaw.includes(secret))
  }

  const playerOps = allOps(player)
  check(
    'a player is told about the visible token',
    playerOps.some((o) => o.t === 'token.create' && o.token.id === 'frodo'),
  )
  check(
    'a player is not told about the hidden one',
    !playerOps.some((o) => o.t === 'token.create' && o.token.id === 'lurker'),
  )
  check(
    'a player gets the orc with its hit points stripped',
    playerOps.some((o) => o.t === 'token.create' && o.token.id === 'orc' && o.token.hp === null),
  )
  check(
    'a player receives fog on the live scene',
    playerOps.some((o) => o.t === 'fog.paint'),
  )
  check('the GM is told about everything', allOps(gm).filter((o) => o.t === 'token.create').length === 3)

  // --- Asset gating ----------------------------------------------------------
  check(
    'a player can fetch the map on the table',
    (await fetch(`${BASE}/api/room/${code}/asset/${liveAsset.id}`)).status === 200,
  )
  check(
    'a player cannot fetch a staged map',
    (await fetch(`${BASE}/api/room/${code}/asset/${stagedAsset.id}`)).status === 404,
  )
  check(
    'the GM can fetch the staged map',
    (await fetch(`${BASE}/api/room/${code}/asset/${stagedAsset.id}?key=${gmKey}`)).status === 200,
  )

  // --- Revealing -------------------------------------------------------------
  const beforeReveal = allOps(player).length
  gm.send({ k: 'op', op: { t: 'token.update', id: 'lurker', patch: { hidden: false } } })
  await sleep(300)
  const revealOps = allOps(player).slice(beforeReveal)
  check(
    'revealing reaches the player as a create',
    revealOps.some((o) => o.t === 'token.create' && o.token.id === 'lurker'),
  )
  check(
    'and still without the stat block link',
    revealOps.every((o) => o.t !== 'token.create' || o.token.statBlockId === null),
  )

  // --- What a player may do --------------------------------------------------
  player.send({ k: 'op', op: { t: 'token.move', id: 'frodo', x: 210, y: 140 } })
  player.send({ k: 'op', op: { t: 'scene.setActive', id: staged.id } })
  player.send({ k: 'op', op: { t: 'statblock.delete', id: 'sb1' } })
  await sleep(400)

  const gmOps = allOps(gm)
  check(
    'a player may move a token',
    gmOps.some((o) => o.t === 'token.move' && o.x === 210),
  )
  check('a player is refused the GM’s operations', player.received.filter((m) => m.k === 'error').length >= 2)
  check(
    'and the table did not switch scenes',
    !allOps(player).some((o) => o.t === 'scene.setActive' && o.id === staged.id),
  )

  // --- Dice ------------------------------------------------------------------
  const rollsBefore = allOps(player).filter((o) => o.t === 'roll.add').length
  player.send({ k: 'roll', expression: '2d20+3', label: 'Stealth', mode: 'advantage', visibility: 'public' })
  gm.send({ k: 'roll', expression: '1d20', label: 'Ambush', mode: 'normal', visibility: 'gm' })
  player.send({ k: 'roll', expression: 'wizardry', label: '', mode: 'normal', visibility: 'public' })
  await sleep(400)

  const publicRolls = allOps(player).filter((o) => o.t === 'roll.add')
  check('a public roll reaches the table', publicRolls.length === rollsBefore + 1)
  check('a GM roll behind the screen does not', !publicRolls.some((o) => o.roll.label === 'Ambush'))
  check(
    'the GM sees their own private roll',
    allOps(gm).some((o) => o.t === 'roll.add' && o.roll.visibility === 'gm'),
  )
  check(
    'every roll carries a seed so clients animate alike',
    publicRolls.every((o) => typeof o.roll.seed === 'number'),
  )
  check(
    'a nonsense expression is refused, not crashed',
    player.received.some((m) => m.k === 'error' && /dice/i.test(m.message)),
  )

  const stealth = publicRolls.at(-1)?.roll
  check('the server rolled the dice, not the client', stealth?.result?.terms?.[0]?.rolls?.length === 2)
  check('and a player cannot claim to have rolled as someone else', stealth?.by === 'Josh')

  // --- Sheets ----------------------------------------------------------------
  // A sheet is a value bag the pack defines; the wire checks shape, not meaning.
  const sheet = {
    id: 'c1',
    name: 'Frodo',
    // Both claims are lies the connection is supposed to overwrite.
    ownerName: 'Gandalf the White',
    ownerId: 'name:gandalf the white',
    values: {
      culture: 'Hobbits of the Shire',
      calling: 'Treasure Hunter',
      level: 3,
      abilities: { str: 8, dex: 16, con: 12, int: 12, wis: 13, cha: 14 },
      skillProficiency: { stealth: 1 },
      hp: { value: 22, max: 22 },
      hope: { value: 3, max: 3 },
      shadow: 1,
      shadowPath: 'Dragon-sickness',
      equipment: 'Sting',
    },
    gmNotes: 'SECRET-TEMPT-HIM',
    portraitAssetId: null,
  }
  player.send({ k: 'op', op: { t: 'character.upsert', character: sheet } })
  await sleep(300)
  const saved = allOps(gm)
    .filter((o) => o.t === 'character.upsert')
    .at(-1)?.character
  check('ownership comes from the connection, not the payload', saved?.ownerName === 'Josh')
  check('and the owner id with it, since that is what permissions read', saved?.ownerId === 'name:josh')
  check('a player cannot write the GM’s private notes', saved?.gmNotes === '')

  gm.send({ k: 'op', op: { t: 'character.upsert', character: { ...saved, gmNotes: 'SECRET-TEMPT-HIM' } } })
  await sleep(300)
  check('and never receives them back', !everything(player).includes('SECRET-TEMPT-HIM'))

  const before = allOps(gm).filter((o) => o.t === 'character.upsert').length
  player.send({
    k: 'op',
    op: {
      t: 'character.upsert',
      character: { ...sheet, values: { nested: { a: { b: 'DEEP-JUNK' } } } },
    },
  })
  await sleep(300)
  check(
    'a sheet nested deeper than a field can store is refused, not saved',
    allOps(gm).filter((o) => o.t === 'character.upsert').length === before,
  )
  check('and nothing from it reached the table', !everything(player).includes('DEEP-JUNK'))

  // --- Invites ---------------------------------------------------------------
  // Both hosts sign or store invites differently; what has to match is the
  // rule, so the same checks run against either.
  const mintInvite = async (key = gmKey) =>
    fetch(`${BASE}/api/room/${code}/invite${key ? `?key=${key}` : ''}`, { method: 'POST' })

  check('a player cannot mint an invite', (await mintInvite(null)).status === 403)
  check('nor can a wrong key', (await mintInvite('not-the-key')).status === 403)

  const invited = await (await mintInvite()).json()
  check('the GM can mint an invite', typeof invited.invite === 'string' && invited.invite.includes('.'))

  const second = await (await mintInvite()).json()
  check('every invite is for a different player', invited.invite !== second.invite)

  // An invited player owns their sheet by the invite, not by the name.
  const invitee = await connect(code, 'Pippin', null, { invite: invited.invite })
  await sleep(200)
  invitee.send({
    k: 'op',
    op: {
      t: 'character.upsert',
      character: { ...sheet, id: 'c-invited', name: 'Pippin', gmNotes: '', values: {} },
    },
  })
  await sleep(300)

  const invitedSheet = allOps(gm)
    .filter((o) => o.t === 'character.upsert')
    .at(-1)?.character
  check('an invited player’s sheet is owned by the invite', invitedSheet?.ownerId?.startsWith('player:') === true)

  // Somebody else typing the same name must not be able to edit it.
  const sameName = await connect(code, 'Pippin', null)
  await sleep(200)
  sameName.send({
    k: 'op',
    op: { t: 'character.upsert', character: { ...invitedSheet, values: { stolen: 'SECRET-STOLEN' } } },
  })
  await sleep(300)
  check(
    'the same name without the invite cannot edit it',
    everything(sameName).includes('belongs to someone else') && !everything(gm).includes('SECRET-STOLEN'),
  )

  // --- Reconnecting ----------------------------------------------------------
  const returning = await connect(code, 'Josh', null)
  await sleep(300)
  const snapshot = hello(returning)
  check('a returning player gets the live scene', Boolean(snapshot?.state.scenes[live.id]))
  check('and not the staged one', !snapshot?.state.scenes[staged.id])
  check('and an empty bestiary', Object.keys(snapshot?.state.bestiary ?? {}).length === 0)
  check(
    'and only public rolls',
    snapshot?.state.rolls.every((r) => r.visibility === 'public'),
  )
  check('and the token that moved is where it was left', snapshot?.state.tokens.frodo?.x === 210)

  for (const peer of [gm, player, impostor, returning]) peer.socket.close()

  console.log(`\n${failures ? `${failures} FAILED` : 'All checks passed'}\n`)
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
