import { describe, expect, it } from 'vitest'
import { ROOM_SCHEMA_VERSION, emptyRoom, identityFor, migrateRoom, newCharacter } from '../src/state.js'

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
