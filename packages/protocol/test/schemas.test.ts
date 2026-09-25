import { describe, expect, it } from 'vitest'
import { opSchema, parseValidatedClientMessage } from '../src/schemas.js'

const token = {
  id: 't1',
  sceneId: 's1',
  x: 10,
  y: 10,
  squares: 1,
  label: 'Frodo',
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
}

describe('operations off the wire', () => {
  it('accepts a well-formed move', () => {
    expect(opSchema.safeParse({ t: 'token.move', id: 't1', x: 70, y: 140 }).success).toBe(true)
  })

  it('accepts a well-formed token', () => {
    expect(opSchema.safeParse({ t: 'token.create', token }).success).toBe(true)
  })

  it.each([
    ['a coordinate that is a string', { t: 'token.move', id: 't1', x: 'over there', y: 0 }],
    ['a coordinate that is NaN', { t: 'token.move', id: 't1', x: Number.NaN, y: 0 }],
    ['a coordinate that is Infinity', { t: 'token.move', id: 't1', x: Number.POSITIVE_INFINITY, y: 0 }],
    ['a coordinate far outside any map', { t: 'token.move', id: 't1', x: 1e12, y: 0 }],
    ['a missing id', { t: 'token.move', x: 1, y: 1 }],
    ['an empty id', { t: 'token.move', id: '', x: 1, y: 1 }],
    ['an operation that does not exist', { t: 'token.teleport', id: 't1' }],
    ['a colour that is not a colour', { t: 'token.create', token: { ...token, color: 'javascript:alert(1)' } }],
    ['a grid size of zero', { t: 'scene.update', id: 's1', patch: { grid: { size: 0 } } }],
    [
      'a polygon with two points',
      {
        t: 'fog.paint',
        sceneId: 's1',
        reveal: true,
        shape: {
          kind: 'poly',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      },
    ],
    ['a fog shape that is not a shape', { t: 'fog.paint', sceneId: 's1', reveal: true, shape: { kind: 'blob' } }],
  ])('rejects %s', (_label, op) => {
    expect(opSchema.safeParse(op).success).toBe(false)
  })

  it('refuses to let a client write its own roll into the log', () => {
    const forged = {
      t: 'roll.add',
      roll: {
        id: 'r1',
        at: 1,
        by: 'Someone else',
        label: '',
        result: { expression: '1d20', mode: 'normal', terms: [], total: 20 },
        visibility: 'public',
        seed: 1,
      },
    }
    expect(opSchema.safeParse(forged).success).toBe(false)
  })

  it('refuses to let a client write its own chat entry', () => {
    const forged = { t: 'chat.add', message: { id: 'm1', at: 1, by: 'The GM', text: 'you win', visibility: 'public' } }
    expect(opSchema.safeParse(forged).success).toBe(false)
  })

  it('strips unknown keys from a settings patch rather than passing them on', () => {
    const parsed = opSchema.safeParse({
      t: 'settings.update',
      patch: { playersCanMoveAnyToken: false, secretBackdoor: true },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.t === 'settings.update') {
      expect(parsed.data.patch).not.toHaveProperty('secretBackdoor')
    }
  })
})

describe('frames off the wire', () => {
  it('reads a valid frame', () => {
    expect(parseValidatedClientMessage('{"k":"ping"}')).toEqual({ k: 'ping' })
  })

  it('reads a roll request', () => {
    const message = parseValidatedClientMessage(
      '{"k":"roll","expression":"2d6+3","label":"Axe","mode":"advantage","visibility":"public"}',
    )
    expect(message).toMatchObject({ k: 'roll', expression: '2d6+3' })
  })

  it.each([
    ['not json', 'nonsense'],
    ['a truncated frame', '{"k":"op","op":'],
    ['a kind that does not exist', '{"k":"sudo"}'],
    ['a roll with no expression', '{"k":"roll","label":"x","mode":"normal","visibility":"public"}'],
    [
      'a roll mode that does not exist',
      '{"k":"roll","expression":"1d20","label":"","mode":"guaranteed","visibility":"public"}',
    ],
    ['a visibility that does not exist', '{"k":"chat","text":"hi","visibility":"everyone-but-dave"}'],
    ['an empty chat message', '{"k":"chat","text":"","visibility":"public"}'],
    ['an op frame carrying a malformed op', '{"k":"op","op":{"t":"token.move","id":"t1","x":"NaN","y":0}}'],
  ])('returns null for %s', (_label, raw) => {
    expect(parseValidatedClientMessage(raw)).toBeNull()
  })

  it('caps a chat message rather than accepting any length', () => {
    const huge = JSON.stringify({ k: 'chat', text: 'x'.repeat(5000), visibility: 'public' })
    expect(parseValidatedClientMessage(huge)).toBeNull()
  })

  it('caps a dice expression, so the parser is never handed a novel', () => {
    const huge = JSON.stringify({
      k: 'roll',
      expression: '1d20+'.repeat(200),
      label: '',
      mode: 'normal',
      visibility: 'public',
    })
    expect(parseValidatedClientMessage(huge)).toBeNull()
  })
})

/**
 * A sheet's values are the one place the wire cannot check meaning — the app
 * does not know what the pack declares. So it checks shape and size instead,
 * and these are the bounds. What this replaced was a `.passthrough()`: any
 * client could write unbounded arbitrary JSON into room storage, and every
 * other browser would be sent it.
 */
describe('character values', () => {
  const sheet = (values: unknown) => ({
    t: 'character.upsert',
    character: {
      id: 'c1',
      name: 'Frodo',
      ownerName: 'Josh',
      ownerId: 'name:josh',
      values,
      gmNotes: '',
      portraitAssetId: null,
    },
  })

  const accepts = (values: unknown) => opSchema.safeParse(sheet(values)).success

  it('accepts the four shapes a field stores', () => {
    expect(
      accepts({
        culture: 'Hobbits of the Shire',
        level: 3,
        weary: true,
        shadowPath: null,
        abilities: { str: 8, dex: 16 },
        hp: { value: 17, max: 22 },
        attacks: [{ name: 'Sting', bonus: 5, damage: '1d6+3' }],
      }),
    ).toBe(true)
  })

  it('accepts a key no pack in this build declares', () => {
    // Dropping it would delete a sheet's data the moment someone opened the
    // table on a build with an older pack.
    expect(accepts({ somethingFromAFuturePack: 'kept' })).toBe(true)
  })

  it('refuses a value nested deeper than a field can store', () => {
    expect(accepts({ abilities: { str: { base: 8, bonus: 1 } } })).toBe(false)
    expect(accepts({ attacks: [{ damage: { dice: '1d6' } }] })).toBe(false)
    expect(accepts({ attacks: [[{ name: 'nested' }]] })).toBe(false)
  })

  it('refuses a number that is not one', () => {
    expect(accepts({ level: Number.POSITIVE_INFINITY })).toBe(false)
    expect(accepts({ abilities: { str: Number.NaN } })).toBe(false)
  })

  it('caps how many fields one sheet may carry', () => {
    const many = Object.fromEntries(Array.from({ length: 401 }, (_, index) => [`k${index}`, 1]))
    expect(accepts(many)).toBe(false)
    expect(accepts(Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`k${index}`, 1])))).toBe(true)
  })

  it('caps how many rows a repeater may carry', () => {
    expect(accepts({ attacks: Array.from({ length: 201 }, () => ({ name: 'x' })) })).toBe(false)
    expect(accepts({ attacks: Array.from({ length: 200 }, () => ({ name: 'x' })) })).toBe(true)
  })

  it('caps how long a stored string may be', () => {
    expect(accepts({ notes: 'x'.repeat(20_001) })).toBe(false)
    expect(accepts({ abilities: { str: 'x'.repeat(401) } })).toBe(false)
  })

  it('caps how long a key may be', () => {
    expect(accepts({ ['k'.repeat(65)]: 1 })).toBe(false)
  })

  it('still requires the fields the app itself owns', () => {
    const { ownerId: _omitted, ...missing } = sheet({}).character
    expect(opSchema.safeParse({ t: 'character.upsert', character: missing }).success).toBe(false)
  })
})
