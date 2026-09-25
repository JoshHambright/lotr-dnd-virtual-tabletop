/**
 * Several people at one table, changing things at once.
 *
 * Everything else in this suite tests one actor at a time. These tests run a
 * table the way a session actually runs — a GM staging a scene while two
 * players drag tokens across it — and check the one property that decides
 * whether anybody's screen can be trusted:
 *
 *   a client that was here the whole time, having applied every operation it
 *   was sent, holds exactly what a client joining *right now* would be handed.
 *
 * If those two ever differ, someone is looking at a stale ambusher, a token
 * that is not there, or fog that has already lifted. Nothing else in the suite
 * would notice: `projectState` and `projectOp` are each correct on their own,
 * and the bug is that they disagree.
 *
 * The harness mirrors `RoomActor.apply` deliberately rather than importing it.
 * The server package brings Fastify, SQLite and a filesystem; this is the same
 * three-line pipeline (authorize, reduce, projectOp) and it runs in a
 * millisecond. What it does not cover — sockets, ordering under real latency,
 * reconnection — is what `scripts/concurrency.mjs` covers against the running
 * server.
 */

import { describe, expect, it } from 'vitest'
import type { Op, Role, RoomState } from '../src/state.js'
import { emptyRoom, identityFor, newCharacter, newScene, newStatBlock, newToken, reduce } from '../src/state.js'
import { authorize, projectOp, projectState } from '../src/visibility.js'

interface Seat {
  name: string
  role: Role
  /** What this seat's browser believes, built only from what it was sent. */
  view: RoomState
  /** Everything the seat was refused, so a test can assert on it. */
  refusals: string[]
}

class Table {
  state: RoomState
  readonly seats: Seat[] = []

  constructor(state: RoomState = emptyRoom('The Ring Goes South')) {
    this.state = state
  }

  /** Joins mid-session: the snapshot is whatever is true at this moment. */
  join(name: string, role: Role): Seat {
    const seat: Seat = { name, role, view: projectState(this.state, role), refusals: [] }
    this.seats.push(seat)
    return seat
  }

  /** One seat sends one operation. Mirrors `RoomActor.#operate` + `apply`. */
  send(seat: Seat, op: Op): void {
    const decision = authorize(op, this.state, { role: seat.role, name: seat.name, id: identityFor(seat.name) })
    if (!decision.ok) {
      seat.refusals.push(decision.reason)
      return
    }

    const before = this.state
    const after = reduce(before, decision.op)
    this.state = after

    for (const other of this.seats) {
      for (const projected of projectOp(decision.op, before, after, other.role)) {
        other.view = reduce(other.view, projected)
      }
    }
  }
}

/**
 * The invariant. Stated as a function because every test ends with it, and a
 * test that forgets to check it is a test that proves nothing.
 */
function expectEveryoneAgrees(table: Table): void {
  for (const seat of table.seats) {
    expect({ seat: seat.name, view: seat.view }).toEqual({
      seat: seat.name,
      view: projectState(table.state, seat.role),
    })
  }
}

function scene(id: string, name: string) {
  return { ...newScene(id, name, 1600, 1200, null), gmNotes: `${name} — GM only` }
}

describe('several people at one table', () => {
  it('keeps two players and the GM in step while tokens move', () => {
    const table = new Table()
    const gm = table.join('Josh', 'gm')
    const sam = table.join('Sam', 'player')
    const merry = table.join('Merry', 'player')

    table.send(gm, { t: 'scene.create', scene: scene('tavern', 'The Prancing Pony') })
    table.send(gm, { t: 'scene.setActive', id: 'tavern' })
    table.send(gm, { t: 'token.create', token: newToken('t-sam', 'tavern', 100, 100, { label: 'Sam' }) })
    table.send(gm, { t: 'token.create', token: newToken('t-merry', 'tavern', 200, 100, { label: 'Merry' }) })

    // Both players drag at once, and their moves interleave.
    table.send(sam, { t: 'token.move', id: 't-sam', x: 140, y: 100 })
    table.send(merry, { t: 'token.move', id: 't-merry', x: 240, y: 100 })
    table.send(sam, { t: 'token.move', id: 't-sam', x: 180, y: 120 })
    table.send(merry, { t: 'token.move', id: 't-merry', x: 280, y: 140 })

    expectEveryoneAgrees(table)
    expect(table.state.tokens['t-sam']).toMatchObject({ x: 180, y: 120 })
    expect(sam.view.tokens['t-merry']).toMatchObject({ x: 280, y: 140 })
  })

  it('shows two players dragging the same token the same last position', () => {
    const table = new Table()
    const gm = table.join('Josh', 'gm')
    const sam = table.join('Sam', 'player')
    const merry = table.join('Merry', 'player')

    table.send(gm, { t: 'scene.create', scene: scene('tavern', 'The Prancing Pony') })
    table.send(gm, { t: 'scene.setActive', id: 'tavern' })
    table.send(gm, { t: 'token.create', token: newToken('t1', 'tavern', 0, 0, { label: 'The barrel' }) })

    // The server serialises them; last writer wins, and everyone sees the
    // same winner. There is no merge to get wrong because a position is not
    // a mergeable thing.
    table.send(sam, { t: 'token.move', id: 't1', x: 50, y: 50 })
    table.send(merry, { t: 'token.move', id: 't1', x: 90, y: 10 })

    expectEveryoneAgrees(table)
    expect(sam.view.tokens.t1).toMatchObject({ x: 90, y: 10 })
    expect(merry.view.tokens.t1).toMatchObject({ x: 90, y: 10 })
  })

  it('reveals an ambusher to everyone at the same moment, and not before', () => {
    const table = new Table()
    const gm = table.join('Josh', 'gm')
    const sam = table.join('Sam', 'player')

    table.send(gm, { t: 'scene.create', scene: scene('weathertop', 'Weathertop') })
    table.send(gm, { t: 'scene.setActive', id: 'weathertop' })
    table.send(gm, {
      t: 'token.create',
      token: newToken('t-nazgul', 'weathertop', 400, 400, { label: 'Nazgûl', hidden: true, statBlockId: 'sb-nazgul' }),
    })

    expect(sam.view.tokens['t-nazgul']).toBeUndefined()
    expectEveryoneAgrees(table)

    table.send(gm, { t: 'token.update', id: 't-nazgul', patch: { hidden: false } })

    expect(sam.view.tokens['t-nazgul']).toBeDefined()
    // Revealed, but the link to the stat block is still the GM's business.
    expect(sam.view.tokens['t-nazgul']?.statBlockId).toBeNull()
    expectEveryoneAgrees(table)
  })

  it('takes an ambusher back out of the players’ world when the GM hides it again', () => {
    const table = new Table()
    const gm = table.join('Josh', 'gm')
    const sam = table.join('Sam', 'player')

    table.send(gm, { t: 'scene.create', scene: scene('weathertop', 'Weathertop') })
    table.send(gm, { t: 'scene.setActive', id: 'weathertop' })
    table.send(gm, { t: 'token.create', token: newToken('t-nazgul', 'weathertop', 400, 400, { label: 'Nazgûl' }) })
    expect(sam.view.tokens['t-nazgul']).toBeDefined()

    table.send(gm, { t: 'token.update', id: 't-nazgul', patch: { hidden: true } })

    // Not greyed out, not left behind — gone.
    expect(sam.view.tokens['t-nazgul']).toBeUndefined()
    expectEveryoneAgrees(table)
  })

  it('swaps the whole table onto a new scene at once, staging and all', () => {
    const table = new Table()
    const gm = table.join('Josh', 'gm')
    const sam = table.join('Sam', 'player')
    const merry = table.join('Merry', 'player')

    table.send(gm, { t: 'scene.create', scene: scene('tavern', 'The Prancing Pony') })
    table.send(gm, { t: 'scene.setActive', id: 'tavern' })
    table.send(gm, { t: 'token.create', token: newToken('t-sam', 'tavern', 10, 10, { label: 'Sam' }) })

    // Staged while the table is still looking somewhere else.
    table.send(gm, { t: 'scene.create', scene: scene('weathertop', 'Weathertop') })
    table.send(gm, { t: 'token.create', token: newToken('t-fire', 'weathertop', 50, 50, { label: 'Campfire' }) })
    expect(sam.view.scenes.weathertop).toBeUndefined()
    expect(sam.view.tokens['t-fire']).toBeUndefined()
    expectEveryoneAgrees(table)

    table.send(gm, { t: 'scene.setActive', id: 'weathertop' })

    expect(sam.view.scenes.tavern).toBeUndefined()
    expect(sam.view.scenes.weathertop).toBeDefined()
    expect(sam.view.tokens['t-sam']).toBeUndefined()
    expect(merry.view.tokens['t-fire']).toBeDefined()
    expectEveryoneAgrees(table)
  })

  it('keeps fog in step while a player is moving through it', () => {
    const table = new Table()
    const gm = table.join('Josh', 'gm')
    const sam = table.join('Sam', 'player')

    table.send(gm, { t: 'scene.create', scene: scene('mine', 'Moria') })
    table.send(gm, { t: 'scene.setActive', id: 'mine' })
    table.send(gm, { t: 'fog.enable', sceneId: 'mine', enabled: true })
    table.send(gm, { t: 'token.create', token: newToken('t-sam', 'mine', 10, 10, { label: 'Sam' }) })

    table.send(sam, { t: 'token.move', id: 't-sam', x: 60, y: 10 })
    table.send(gm, {
      t: 'fog.paint',
      sceneId: 'mine',
      shape: { kind: 'circle', x: 60, y: 10, radius: 80 },
      reveal: true,
    })
    table.send(sam, { t: 'token.move', id: 't-sam', x: 110, y: 10 })
    table.send(gm, {
      t: 'fog.paint',
      sceneId: 'mine',
      shape: { kind: 'circle', x: 110, y: 10, radius: 80 },
      reveal: true,
    })

    expectEveryoneAgrees(table)
  })

  it('lets someone join in the middle and see what everyone else sees', () => {
    const table = new Table()
    const gm = table.join('Josh', 'gm')
    const sam = table.join('Sam', 'player')

    table.send(gm, { t: 'scene.create', scene: scene('tavern', 'The Prancing Pony') })
    table.send(gm, { t: 'scene.setActive', id: 'tavern' })
    table.send(gm, { t: 'token.create', token: newToken('t-sam', 'tavern', 10, 10, { label: 'Sam' }) })
    table.send(gm, {
      t: 'token.create',
      token: newToken('t-spy', 'tavern', 20, 20, { label: 'A watcher', hidden: true }),
    })
    table.send(sam, { t: 'token.move', id: 't-sam', x: 300, y: 200 })

    // Merry arrives late. What he is handed has to match what Sam has built
    // up, or the two of them are looking at different tables.
    const merry = table.join('Merry', 'player')
    expect(merry.view).toEqual(sam.view)
    expect(merry.view.tokens['t-spy']).toBeUndefined()

    table.send(gm, { t: 'token.update', id: 't-spy', patch: { hidden: false } })
    expect(merry.view).toEqual(sam.view)
    expectEveryoneAgrees(table)
  })

  it('never lets a player’s view accumulate GM material, however long the session runs', () => {
    const table = new Table()
    const gm = table.join('Josh', 'gm')
    const sam = table.join('Sam', 'player')

    table.send(gm, { t: 'scene.create', scene: scene('tavern', 'The Prancing Pony') })
    table.send(gm, { t: 'scene.setActive', id: 'tavern' })
    table.send(gm, {
      t: 'statblock.upsert',
      statBlock: { ...newStatBlock('sb-orc', 'Orc'), values: { notes: 'SECRET-WEAKNESS' } },
    })
    table.send(gm, {
      t: 'encounter.upsert',
      encounter: { id: 'e1', name: 'Ambush', notes: 'SECRET-PLAN', members: [{ statBlockId: 'sb-orc', count: 3 }] },
    })
    table.send(gm, { t: 'scene.create', scene: scene('staged', 'SECRET-MAP') })
    table.send(gm, {
      t: 'token.create',
      token: newToken('t-orc', 'tavern', 5, 5, { label: 'SECRET-ORC', hidden: true, statBlockId: 'sb-orc' }),
    })
    table.send(gm, { t: 'chat.add', message: { id: 'm1', at: 1, by: 'Josh', text: 'SECRET-ASIDE', visibility: 'gm' } })

    // Ordinary play carries on around all of it.
    table.send(gm, { t: 'token.create', token: newToken('t-sam', 'tavern', 10, 10, { label: 'Sam' }) })
    table.send(sam, { t: 'token.move', id: 't-sam', x: 50, y: 50 })
    table.send(sam, {
      t: 'chat.add',
      message: { id: 'm2', at: 2, by: 'Sam', text: 'I check the door', visibility: 'public' },
    })

    expect(JSON.stringify(sam.view)).not.toMatch(/SECRET/)
    expect(Object.keys(sam.view.bestiary)).toEqual([])
    expect(Object.keys(sam.view.encounters)).toEqual([])
    expectEveryoneAgrees(table)
  })

  it('keeps everyone in step through a long interleaved run', () => {
    const table = new Table()
    const gm = table.join('Josh', 'gm')
    const players = ['Sam', 'Merry', 'Pippin'].map((name) => table.join(name, 'player'))

    table.send(gm, { t: 'scene.create', scene: scene('road', 'The Road') })
    table.send(gm, { t: 'scene.setActive', id: 'road' })
    table.send(gm, { t: 'fog.enable', sceneId: 'road', enabled: true })
    for (const player of players) {
      table.send(gm, { t: 'token.create', token: newToken(`t-${player.name}`, 'road', 0, 0, { label: player.name }) })
    }
    table.send(gm, {
      t: 'token.create',
      token: newToken('t-lurker', 'road', 900, 900, { label: 'Something following', hidden: true }),
    })

    // Deterministic, but interleaved the way a session is: everybody acting
    // between each of the GM's decisions.
    for (let round = 0; round < 12; round += 1) {
      for (const [index, player] of players.entries()) {
        table.send(player, { t: 'token.move', id: `t-${player.name}`, x: round * 40 + index * 7, y: round * 25 })
      }
      table.send(gm, {
        t: 'fog.paint',
        sceneId: 'road',
        shape: { kind: 'circle', x: round * 40, y: round * 25, radius: 90 },
        reveal: true,
      })
      if (round === 5) table.send(gm, { t: 'token.update', id: 't-lurker', patch: { hidden: false } })
      if (round === 9) table.send(gm, { t: 'token.update', id: 't-lurker', patch: { hidden: true } })
      expectEveryoneAgrees(table)
    }

    // And a latecomer at the end still lands on the same picture.
    const late = table.join('Frodo', 'player')
    expect(late.view).toEqual(players[0]?.view)
  })

  it('refuses a player’s edit to someone else’s sheet without disturbing anyone’s view', () => {
    const table = new Table()
    const gm = table.join('Josh', 'gm')
    const sam = table.join('Sam', 'player')
    const merry = table.join('Merry', 'player')

    table.send(gm, { t: 'character.upsert', character: newCharacter('c-sam', 'Sam', 'Sam') })

    const sheet = { ...newCharacter('c-sam', 'Sam', 'Sam'), values: { hp: { value: 1, max: 20 } } }
    table.send(merry, { t: 'character.upsert', character: sheet })

    expect(merry.refusals).toHaveLength(1)
    expect(table.state.characters['c-sam']?.values).toEqual({})
    expectEveryoneAgrees(table)

    // Sam's own edit goes through, and everyone sees it.
    table.send(sam, { t: 'character.upsert', character: sheet })
    expect(sam.refusals).toHaveLength(0)
    expect(merry.view.characters['c-sam']?.values).toEqual({ hp: { value: 1, max: 20 } })
    expectEveryoneAgrees(table)
  })
})
