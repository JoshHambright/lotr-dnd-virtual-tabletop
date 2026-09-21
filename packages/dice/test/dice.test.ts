import { describe, expect, it } from 'vitest'
import { DiceError, criticalKind, describeResult, parseExpression, roll } from '@vtt/dice'

/** A deterministic stand-in for the CSPRNG: replays the given die faces. */
function sequence(values: number[], sides = 20): () => number {
  let index = 0
  return () => {
    const value = values[index++ % values.length]!
    return (value - 1) / sides + 1e-9
  }
}

describe('parseExpression', () => {
  it('parses a bare modifier', () => {
    expect(parseExpression('5')).toEqual([{ kind: 'const', sign: 1, value: 5, notation: '5' }])
  })

  it('defaults an omitted count to one die', () => {
    const [term] = parseExpression('d20')
    expect(term).toMatchObject({ kind: 'dice', dice: { count: 1, sides: 20 } })
  })

  it('treats d% as a d100', () => {
    const [term] = parseExpression('d%')
    expect(term).toMatchObject({ kind: 'dice', dice: { sides: 100 } })
  })

  it('keeps terms in source order with their signs', () => {
    const terms = parseExpression('2d6+3-1d4')
    expect(terms.map((t) => t.sign)).toEqual([1, 1, -1])
  })

  it('accepts a leading minus', () => {
    expect(parseExpression('-2')[0]).toMatchObject({ sign: -1, value: 2 })
  })

  it.each([
    ['', 'empty'],
    ['1d20+', 'trailing operator'],
    ['d20kh3', 'keeping more dice than are rolled'],
    ['1d1', 'a one-sided die'],
    ['200d6', 'too many dice'],
    ['fireball', 'not dice at all'],
    ['4d6r6', 'a reroll that never ends'],
  ])('rejects %s (%s)', (input) => {
    expect(() => parseExpression(input)).toThrow(DiceError)
  })
})

describe('roll', () => {
  it('sums dice and modifiers', () => {
    const result = roll('2d6+3', 'normal', sequence([4, 5], 6))
    expect(result.total).toBe(12)
  })

  it('subtracts a negative term', () => {
    const result = roll('1d6-2', 'normal', sequence([6], 6))
    expect(result.total).toBe(4)
  })

  it('keeps the highest on advantage and marks the other die dropped', () => {
    const result = roll('1d20+5', 'advantage', sequence([7, 18]))
    expect(result.total).toBe(23)
    const [term] = result.terms
    expect(term).toMatchObject({ kind: 'dice', notation: '2d20kh1' })
    if (term?.kind === 'dice') {
      expect(term.rolls.map((r) => r.kept)).toEqual([false, true])
    }
  })

  it('keeps the lowest on disadvantage', () => {
    expect(roll('1d20', 'disadvantage', sequence([7, 18])).total).toBe(7)
  })

  it('applies advantage only to the first d20 term', () => {
    const result = roll('1d20+1d20', 'advantage', sequence([10, 20, 3]))
    expect(result.terms).toHaveLength(2)
    expect(result.terms[1]).toMatchObject({ notation: '1d20' })
  })

  it('leaves an explicit keep alone rather than doubling it', () => {
    const result = roll('4d6kh3', 'normal', sequence([1, 5, 6, 4], 6))
    expect(result.total).toBe(15)
  })

  it('drops the lowest die of a pool', () => {
    expect(roll('4d6dl1', 'normal', sequence([1, 5, 6, 4], 6)).total).toBe(15)
  })

  it('breaks ties by position so identical faces are not both dropped', () => {
    const result = roll('2d6kh1', 'normal', sequence([4, 4], 6))
    const [term] = result.terms
    if (term?.kind === 'dice') expect(term.rolls.filter((r) => r.kept)).toHaveLength(1)
    expect(result.total).toBe(4)
  })

  it('rerolls a die at or below the threshold exactly once', () => {
    const result = roll('1d6r1', 'normal', sequence([1, 2], 6))
    const [term] = result.terms
    if (term?.kind === 'dice') expect(term.rolls[0]).toEqual({ value: 2, kept: true, rerolledFrom: 1 })
    expect(result.total).toBe(2)
  })

  it('never rolls outside the faces of the die', () => {
    for (let i = 0; i < 500; i++) {
      const value = roll('1d20').total
      expect(value).toBeGreaterThanOrEqual(1)
      expect(value).toBeLessThanOrEqual(20)
    }
  })
})

describe('reporting', () => {
  it('writes a log line showing dropped dice', () => {
    const result = roll('1d20+3', 'advantage', sequence([2, 19]))
    expect(describeResult(result)).toBe('2d20kh1 [(2), 19] + 3')
  })

  it('flags a natural twenty that was kept', () => {
    expect(criticalKind(roll('1d20', 'normal', sequence([20])))).toBe('success')
  })

  it('flags a natural one', () => {
    expect(criticalKind(roll('1d20', 'normal', sequence([1])))).toBe('failure')
  })

  it('ignores a twenty that was dropped by disadvantage', () => {
    expect(criticalKind(roll('1d20', 'disadvantage', sequence([20, 5])))).toBeNull()
  })
})
