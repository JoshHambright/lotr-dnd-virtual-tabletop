import { describe, expect, it } from 'vitest'
import { ROOM_SCHEMA_VERSION, emptyRoom, migrateRoom } from '../src/state.js'

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
