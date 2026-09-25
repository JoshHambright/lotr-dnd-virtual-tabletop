import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RULESET_ID,
  ROOM_SCHEMA_VERSION,
  emptyRoom,
  identityFor,
  migrateRoom,
  newCharacter,
  newStatBlock,
} from '../src/state.js'

describe('migrateRoom', () => {
  it('passes a current room through unchanged', () => {
    const room = emptyRoom('Fellowship')
    expect(migrateRoom(room)).toMatchObject({ schemaVersion: ROOM_SCHEMA_VERSION, settings: { name: 'Fellowship' } })
  })

  it('treats a room with no version as the first schema', () => {
    const { schemaVersion: _omitted, ...unversioned } = emptyRoom()
    expect(migrateRoom(unversioned).schemaVersion).toBe(ROOM_SCHEMA_VERSION)
  })

  it('refuses a room from a newer server rather than reinterpreting it', () => {
    const room = { ...emptyRoom(), schemaVersion: ROOM_SCHEMA_VERSION + 1 }
    expect(() => migrateRoom(room)).toThrow(/newer version/)
  })

  it('refuses something that is not a room at all', () => {
    for (const value of [null, undefined, 42, 'a table']) {
      expect(() => migrateRoom(value)).toThrow(/not readable/)
    }
  })

  it('gives a table written before packs the one pack there was', () => {
    const room = emptyRoom('Old table')
    const settings = room.settings as Partial<typeof room.settings>
    delete settings.rulesetId
    const stored = { ...room, settings, schemaVersion: 2 }

    const migrated = migrateRoom(stored)
    expect(migrated.settings.rulesetId).toBe(DEFAULT_RULESET_ID)
    expect(migrated.schemaVersion).toBe(ROOM_SCHEMA_VERSION)
  })

  it('leaves a table that already names a pack alone', () => {
    const stored = { ...emptyRoom(), schemaVersion: 2 }
    stored.settings.rulesetId = 'morkborg'
    expect(migrateRoom(stored).settings.rulesetId).toBe('morkborg')
  })

  it('carries a sheet across both migrations at once', () => {
    const character = newCharacter('c9', 'Bilbo', 'Bilbo')
    const owned = character as Partial<typeof character>
    delete owned.ownerId
    const stored = {
      ...emptyRoom(),
      schemaVersion: 1,
      settings: { name: 'Bag End', playersCanMoveAnyToken: true, playersCanCreateTokens: false },
      characters: { [character.id]: owned },
    }

    const migrated = migrateRoom(stored)
    expect(migrated.schemaVersion).toBe(ROOM_SCHEMA_VERSION)
    expect(migrated.settings.rulesetId).toBe(DEFAULT_RULESET_ID)
    expect(migrated.characters[character.id]?.ownerId).toBe(identityFor('Bilbo'))
  })

  it('carries a stat block into the value bag without losing a field', () => {
    const stored = {
      ...emptyRoom(),
      schemaVersion: 4,
      bestiary: {
        'sb-orc': {
          id: 'sb-orc',
          name: 'Orc of the White Hand',
          kind: 'Orc',
          armourClass: 14,
          maxHp: 15,
          speed: '30 ft.',
          abilities: { str: 14, dex: 12 },
          attributeLevel: 2,
          might: 1,
          resolve: 1,
          hateOrDespair: 2,
          attacks: 'Scimitar +4 (1d6+2)\nBow +3 (1d8)',
          specials: 'Sunlight sensitivity',
          notes: 'Retreats at half',
          color: '#a33d3d',
          imageAssetId: null,
        },
      },
    }

    const migrated = migrateRoom(stored)
    const orc = migrated.bestiary['sb-orc']
    expect(orc?.name).toBe('Orc of the White Hand')
    expect(orc?.color).toBe('#a33d3d')
    expect(orc?.values).toMatchObject({
      kind: 'Orc',
      armourClass: 14,
      hp: { value: 15, max: 15 },
      speed: '30 ft.',
      abilities: { str: 14, dex: 12 },
      attributeLevel: 2,
      might: 1,
      resolve: 1,
      hateOrDespair: 2,
      specials: 'Sunlight sensitivity',
      notes: 'Retreats at half',
    })
  })

  it('keeps every line of a free-text attack list, without guessing at it', () => {
    // "Scimitar +4 (1d6+2)" could be parsed into a to-hit bonus, and would be
    // wrong often enough to be worse than leaving the GM a line they can read.
    const stored = {
      ...emptyRoom(),
      schemaVersion: 4,
      bestiary: {
        sb1: { id: 'sb1', name: 'Warg', attacks: 'Bite +5 (2d6+3)\n\n  Pounce  \n', color: '#a33d3d' },
      },
    }

    expect(migrateRoom(stored).bestiary.sb1?.values.attacks).toEqual([{ name: 'Bite +5 (2d6+3)' }, { name: 'Pounce' }])
  })

  it('leaves a stat block already in the new shape alone', () => {
    const stored = {
      ...emptyRoom(),
      schemaVersion: 4,
      bestiary: { sb1: { ...newStatBlock('sb1', 'Troll'), values: { armourClass: 15 } } },
    }
    expect(migrateRoom(stored).bestiary.sb1?.values).toEqual({ armourClass: 15 })
  })

  it('does not mutate what it was given', () => {
    const { schemaVersion: _omitted, ...unversioned } = emptyRoom()
    const before = JSON.stringify(unversioned)
    migrateRoom(unversioned)
    expect(JSON.stringify(unversioned)).toBe(before)
  })
})

describe('identity', () => {
  it('derives the same id however the name was typed', () => {
    expect(identityFor('Sam')).toBe(identityFor(' sam '))
  })

  it('keeps different people apart', () => {
    expect(identityFor('Sam')).not.toBe(identityFor('Merry'))
  })

  it('marks name-derived ids, so a real token can never be mistaken for one', () => {
    expect(identityFor('Sam')).toMatch(/^name:/)
  })

  it('gives a sheet written before owner ids the id its name implies', () => {
    const legacy = {
      ...emptyRoom(),
      schemaVersion: 1,
      characters: {
        c1: { ...newCharacter('c1', 'Frodo', 'Josh'), ownerId: undefined as unknown as string },
      },
    }
    const migrated = migrateRoom(legacy)
    expect(migrated.characters['c1']?.ownerId).toBe(identityFor('Josh'))
    expect(migrated.schemaVersion).toBe(ROOM_SCHEMA_VERSION)
  })
})
