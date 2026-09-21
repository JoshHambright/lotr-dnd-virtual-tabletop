import { describe, expect, it } from 'vitest'
import { generateGmKey, generateRoomCode, isValidRoomCode, normalizeRoomCode, parseClientMessage } from '@vtt/protocol'

describe('room codes', () => {
  it('is six characters long', () => {
    expect(generateRoomCode()).toHaveLength(6)
  })

  it('never contains a character that can be misheard over a call', () => {
    // The alphabet drops 0/O, 1/I/L on purpose: these are read aloud on Zoom.
    const confusable = /[01OIL]/
    for (let i = 0; i < 400; i++) {
      expect(generateRoomCode()).not.toMatch(confusable)
    }
  })

  it('draws from the whole alphabet rather than a corner of it', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 400; i++) for (const c of generateRoomCode()) seen.add(c)
    expect(seen.size).toBeGreaterThan(20)
  })

  it('is driven by the random source it is given', () => {
    expect(generateRoomCode(() => 0)).toBe('AAAAAA')
  })

  it('normalizes what a player actually types', () => {
    expect(normalizeRoomCode('  a b-c d e f ')).toBe('ABCDEF')
    expect(normalizeRoomCode('7n3-pq2')).toBe('7N3PQ2')
  })

  it('accepts a generated code', () => {
    for (let i = 0; i < 50; i++) expect(isValidRoomCode(generateRoomCode())).toBe(true)
  })

  it('accepts a code however the player typed it', () => {
    expect(isValidRoomCode(' 7n3-pq2 ')).toBe(true)
  })

  it.each([
    ['', 'empty'],
    ['ABC', 'too short'],
    ['ABCDEFGHIJKLM', 'too long'],
    ['ABCDE0', 'a zero, which is not in the alphabet'],
    ['ABCDEI', 'an I, which is not in the alphabet'],
  ])('rejects %s (%s)', (input) => {
    expect(isValidRoomCode(input)).toBe(false)
  })
})

describe('GM keys', () => {
  it('is 128 bits of hex', () => {
    expect(generateGmKey()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('does not repeat', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateGmKey()))
    expect(keys.size).toBe(200)
  })
})

describe('parsing what arrives on the wire', () => {
  it('reads a well-formed message', () => {
    expect(parseClientMessage('{"k":"ping"}')).toEqual({ k: 'ping' })
  })

  it.each([
    ['not json at all', 'nonsense'],
    ['json that is not an object', '42'],
    ['null', 'null'],
    ['an object with no kind', '{"op":{}}'],
    ['a kind that is not a string', '{"k":7}'],
    ['a truncated frame', '{"k":"op","op":'],
  ])('returns null for %s rather than throwing', (_label, raw) => {
    expect(parseClientMessage(raw)).toBeNull()
  })
})
