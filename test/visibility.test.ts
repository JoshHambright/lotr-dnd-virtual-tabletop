import { describe, expect, it } from 'vitest'
import { emptyRoom, newCharacter, newScene, newStatBlock, newToken, reduce } from '../shared/state.js'
import type { Op, RoomState } from '../shared/state.js'
import { authorize, projectOpForPlayer, projectStateForPlayer } from '../shared/visibility.js'

/** A table mid-session: one scene live, one staged, and an ambush waiting. */
function table(): RoomState {
  const ops: Op[] = [
    { t: 'scene.create', scene: { ...newScene('live', 'The Prancing Pony', 640, 640, 'asset-live'), gmNotes: 'Strider watches from the corner' } },
    { t: 'scene.create', scene: { ...newScene('staged', 'Weathertop, night', 640, 640, 'asset-staged'), gmNotes: 'Five Nazgûl arrive on turn 3' } },
    { t: 'scene.setActive', id: 'live' },
    { t: 'token.create', token: newToken('frodo', 'live', 70, 70, { label: 'Frodo', characterId: 'c-frodo' }) },
    { t: 'token.create', token: newToken('lurker', 'live', 200, 200, { label: 'Bill Ferny', hidden: true, statBlockId: 'sb-spy' }) },
    { t: 'token.create', token: newToken('wraith', 'staged', 10, 10, { label: 'Nazgûl' }) },
    { t: 'statblock.upsert', statBlock: newStatBlock('sb-spy', 'Bill Ferny') },
    { t: 'encounter.upsert', encounter: { id: 'e1', name: 'Ambush at Weathertop', notes: 'secret', members: [] } },
    { t: 'character.upsert', character: { ...newCharacter('c-frodo', 'Frodo', 'Josh'), gmNotes: 'Bearing the Ring; tempt him' } },
    { t: 'roll.add', roll: { id: 'r1', at: 1, by: 'GM', label: 'Ambush', result: { expression: '1d20', mode: 'normal', terms: [], total: 12 }, visibility: 'gm', seed: 1 } },
    { t: 'roll.add', roll: { id: 'r2', at: 2, by: 'Josh', label: 'Perception', result: { expression: '1d20', mode: 'normal', terms: [], total: 18 }, visibility: 'public', seed: 2 } },
    { t: 'chat.add', message: { id: 'm1', at: 1, by: 'GM', text: 'rolling initiative behind the screen', visibility: 'gm' } },
  ]
  return ops.reduce(reduce, emptyRoom('Fellowship'))
}

describe('what a player is sent', () => {
  const view = projectStateForPlayer(table())

  it('sends only the scene on the table, never a staged one', () => {
    expect(Object.keys(view.scenes)).toEqual(['live'])
  })

  it('strips the GM’s notes from the scene they can see', () => {
    expect(view.scenes['live']?.gmNotes).toBe('')
  })

  it('omits a hidden token entirely rather than marking it hidden', () => {
    expect(view.tokens['lurker']).toBeUndefined()
    expect(JSON.stringify(view)).not.toContain('Bill Ferny')
  })

  it('omits tokens staged on another scene', () => {
    expect(view.tokens['wraith']).toBeUndefined()
  })

  it('sends no bestiary and no encounters at all', () => {
    expect(view.bestiary).toEqual({})
    expect(view.encounters).toEqual({})
    expect(JSON.stringify(view)).not.toContain('Ambush at Weathertop')
  })

  it('strips the GM’s notes from a player’s own sheet', () => {
    expect(view.characters['c-frodo']?.gmNotes).toBe('')
    expect(JSON.stringify(view)).not.toContain('tempt him')
  })

  it('withholds rolls the GM made behind the screen', () => {
    expect(view.rolls.map((r) => r.id)).toEqual(['r2'])
  })

  it('withholds GM-only chat', () => {
    expect(view.chat).toEqual([])
  })

  it('hides hit points on a token whose totals the GM is keeping back', () => {
    let state = table()
    state = reduce(state, { t: 'token.create', token: newToken('orc', 'live', 300, 300, { label: 'Orc', hp: 7, maxHp: 11, showHpToPlayers: false }) })
    const token = projectStateForPlayer(state).tokens['orc']
    expect(token).toMatchObject({ label: 'Orc', hp: null, maxHp: null })
  })
})

describe('what a player is told changed', () => {
  it('turns revealing a hidden token into a create, since they never held it', () => {
    const before = table()
    const op: Op = { t: 'token.update', id: 'lurker', patch: { hidden: false } }
    const ops = projectOpForPlayer(op, before, reduce(before, op))
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ t: 'token.create', token: { id: 'lurker', label: 'Bill Ferny' } })
  })

  it('never leaks the stat block link when a token is revealed', () => {
    const before = table()
    const op: Op = { t: 'token.update', id: 'lurker', patch: { hidden: false } }
    const [created] = projectOpForPlayer(op, before, reduce(before, op))
    expect(created).toMatchObject({ t: 'token.create', token: { statBlockId: null } })
  })

  it('turns concealing a token into a delete', () => {
    const before = table()
    const op: Op = { t: 'token.update', id: 'frodo', patch: { hidden: true } }
    expect(projectOpForPlayer(op, before, reduce(before, op))).toEqual([{ t: 'token.delete', id: 'frodo' }])
  })

  it('says nothing about a token that was hidden before and after', () => {
    const before = table()
    const op: Op = { t: 'token.update', id: 'lurker', patch: { label: 'Bill Ferny, informant' } }
    expect(projectOpForPlayer(op, before, reduce(before, op))).toEqual([])
  })

  it('re-derives a visible token’s patch so concealed hit points cannot slip through', () => {
    let before = table()
    before = reduce(before, { t: 'token.create', token: newToken('orc', 'live', 10, 10, { hp: 7, maxHp: 11, showHpToPlayers: false }) })
    const op: Op = { t: 'token.update', id: 'orc', patch: { hp: 3 } }
    const [projected] = projectOpForPlayer(op, before, reduce(before, op))
    expect(projected).toMatchObject({ t: 'token.update', patch: { hp: null, maxHp: null } })
  })

  it('expands a scene switch into a teardown, the new scene and its visible tokens', () => {
    const before = table()
    const op: Op = { t: 'scene.setActive', id: 'staged' }
    const ops = projectOpForPlayer(op, before, reduce(before, op))
    expect(ops.map((o) => o.t)).toEqual(['scene.delete', 'scene.create', 'token.create', 'scene.setActive'])
    expect(JSON.stringify(ops)).not.toContain('Five Nazgûl arrive')
  })

  it('says nothing when the GM stages a scene they have not put on the table', () => {
    const before = table()
    const op: Op = { t: 'scene.create', scene: newScene('later', 'Rivendell', 100, 100, null) }
    expect(projectOpForPlayer(op, before, reduce(before, op))).toEqual([])
  })

  it('says nothing about fog painted on a scene that is not on the table', () => {
    const before = table()
    const op: Op = { t: 'fog.paint', sceneId: 'staged', shape: { kind: 'circle', x: 1, y: 1, radius: 5 }, reveal: true }
    expect(projectOpForPlayer(op, before, reduce(before, op))).toEqual([])
  })

  it('passes fog on the live scene straight through', () => {
    const before = table()
    const op: Op = { t: 'fog.paint', sceneId: 'live', shape: { kind: 'circle', x: 1, y: 1, radius: 5 }, reveal: true }
    expect(projectOpForPlayer(op, before, reduce(before, op))).toEqual([op])
  })

  it('withholds bestiary and encounter changes', () => {
    const before = table()
    for (const op of [
      { t: 'statblock.upsert', statBlock: newStatBlock('sb2', 'Cave Troll') },
      { t: 'encounter.delete', id: 'e1' },
    ] as Op[]) {
      expect(projectOpForPlayer(op, before, reduce(before, op))).toEqual([])
    }
  })

  it('withholds a roll the GM made behind the screen', () => {
    const before = table()
    const op: Op = { t: 'roll.add', roll: { id: 'r3', at: 3, by: 'GM', label: '', result: { expression: '1d20', mode: 'normal', terms: [], total: 4 }, visibility: 'gm', seed: 3 } }
    expect(projectOpForPlayer(op, before, reduce(before, op))).toEqual([])
  })
})

describe('what a player may do', () => {
  const josh = { role: 'player' as const, name: 'Josh' }
  const sam = { role: 'player' as const, name: 'Sam' }

  it('lets the GM do anything, unchanged', () => {
    const state = table()
    const op: Op = { t: 'scene.setActive', id: 'staged' }
    expect(authorize(op, state, { role: 'gm', name: 'GM' })).toEqual({ ok: true, op })
  })

  it('lets a player move a token on the table', () => {
    expect(authorize({ t: 'token.move', id: 'frodo', x: 140, y: 70 }, table(), josh).ok).toBe(true)
  })

  it('refuses to move a token the players cannot see', () => {
    expect(authorize({ t: 'token.move', id: 'lurker', x: 0, y: 0 }, table(), josh)).toMatchObject({ ok: false })
  })

  it('refuses to move a token staged on another scene', () => {
    expect(authorize({ t: 'token.move', id: 'wraith', x: 0, y: 0 }, table(), josh)).toMatchObject({ ok: false })
  })

  it('refuses to move a locked token', () => {
    const state = reduce(table(), { t: 'token.update', id: 'frodo', patch: { locked: true } })
    expect(authorize({ t: 'token.move', id: 'frodo', x: 0, y: 0 }, state, josh)).toMatchObject({ ok: false })
  })

  it('restricts a player to their own token when the GM closes free movement', () => {
    const state = reduce(table(), { t: 'settings.update', patch: { playersCanMoveAnyToken: false } })
    expect(authorize({ t: 'token.move', id: 'frodo', x: 0, y: 0 }, state, josh).ok).toBe(true)
    expect(authorize({ t: 'token.move', id: 'frodo', x: 0, y: 0 }, state, sam)).toMatchObject({ ok: false })
  })

  it('narrows a token update to damage and conditions', () => {
    const decision = authorize(
      { t: 'token.update', id: 'frodo', patch: { conditions: ['Weary'], hidden: true, statBlockId: 'sb-spy', label: 'Sauron' } },
      table(),
      josh,
    )
    expect(decision).toMatchObject({ ok: true, op: { patch: { conditions: ['Weary'] } } })
    if (decision.ok && decision.op.t === 'token.update') {
      expect(decision.op.patch).not.toHaveProperty('hidden')
      expect(decision.op.patch).not.toHaveProperty('label')
      expect(decision.op.patch).not.toHaveProperty('statBlockId')
    }
  })

  it('drops a hit point edit on a token whose totals are concealed', () => {
    let state = table()
    state = reduce(state, { t: 'token.create', token: newToken('orc', 'live', 10, 10, { hp: 7, showHpToPlayers: false }) })
    const decision = authorize({ t: 'token.update', id: 'orc', patch: { hp: 0 } }, state, josh)
    expect(decision).toMatchObject({ ok: true, op: { patch: {} } })
  })

  it('refuses token creation until the GM opens it', () => {
    const state = table()
    const op: Op = { t: 'token.create', token: newToken('new', 'live', 0, 0) }
    expect(authorize(op, state, josh)).toMatchObject({ ok: false })

    const opened = reduce(state, { t: 'settings.update', patch: { playersCanCreateTokens: true } })
    expect(authorize(op, opened, josh).ok).toBe(true)
  })

  it('forces a player-made token to be visible and unlinked', () => {
    const state = reduce(table(), { t: 'settings.update', patch: { playersCanCreateTokens: true } })
    const decision = authorize(
      { t: 'token.create', token: newToken('new', 'live', 0, 0, { hidden: true, statBlockId: 'sb-spy', locked: true }) },
      state,
      josh,
    )
    expect(decision).toMatchObject({ ok: true, op: { token: { hidden: false, statBlockId: null, locked: false } } })
  })

  it('lets a player edit their own sheet but not someone else’s', () => {
    const state = table()
    const edit: Op = { t: 'character.upsert', character: { ...newCharacter('c-frodo', 'Frodo', 'Josh'), currentHp: 3 } }
    expect(authorize(edit, state, josh).ok).toBe(true)
    expect(authorize(edit, state, sam)).toMatchObject({ ok: false })
  })

  it('preserves the GM’s notes when the owner saves their sheet', () => {
    const state = table()
    const decision = authorize(
      { t: 'character.upsert', character: { ...newCharacter('c-frodo', 'Frodo', 'Josh'), gmNotes: 'wiped' } },
      state,
      josh,
    )
    expect(decision).toMatchObject({ ok: true, op: { character: { gmNotes: 'Bearing the Ring; tempt him' } } })
  })

  it('takes ownership from the connection, not the payload', () => {
    const decision = authorize(
      { t: 'character.upsert', character: newCharacter('c-new', 'Merry', 'Gandalf the Grey') },
      table(),
      sam,
    )
    expect(decision).toMatchObject({ ok: true, op: { character: { ownerName: 'Sam' } } })
  })

  it('refuses everything structural', () => {
    const state = table()
    const forbidden: Op[] = [
      { t: 'scene.setActive', id: 'staged' },
      { t: 'scene.delete', id: 'live' },
      { t: 'fog.setAll', sceneId: 'live', revealed: true },
      { t: 'fog.paint', sceneId: 'live', shape: { kind: 'circle', x: 0, y: 0, radius: 9999 }, reveal: true },
      { t: 'statblock.upsert', statBlock: newStatBlock('sb9', 'Balrog') },
      { t: 'statblock.delete', id: 'sb-spy' },
      { t: 'encounter.delete', id: 'e1' },
      { t: 'settings.update', patch: { playersCanMoveAnyToken: false } },
    ]
    for (const op of forbidden) expect(authorize(op, state, josh)).toMatchObject({ ok: false })
  })
})
