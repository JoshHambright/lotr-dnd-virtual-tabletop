import { describe, expect, it } from 'vitest'
import { DiceError, criticalKind, describeResult, faceOf, formatExpression, parseExpression, roll } from '@vtt/dice'

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
    ['1d20t20a0', 'a floor that swallows every face'],
    ['1d20t0a0', 'a floor that catches nothing'],
    ['1d20t3', 'a floor with nothing to floor to'],
    ['1d20a0', 'a value with no threshold'],
  ])('rejects %s (%s)', (input) => {
    expect(() => parseExpression(input)).toThrow(DiceError)
  })

  it('parses a treat-as floor', () => {
    const [term] = parseExpression('1d20t3a0')
    expect(term).toMatchObject({ kind: 'dice', dice: { sides: 20, treatAtOrBelow: { threshold: 3, value: 0 } } })
  })

  it('takes a floor alongside the other modifiers, in either order', () => {
    const [term] = parseExpression('2d20kh1t3a0')
    expect(term).toMatchObject({ dice: { keep: { kind: 'kh', n: 1 }, treatAtOrBelow: { threshold: 3, value: 0 } } })
    expect(parseExpression('2d20t3a0kh1')[0]).toMatchObject({
      dice: { keep: { kind: 'kh', n: 1 }, treatAtOrBelow: { threshold: 3, value: 0 } },
    })
  })
})

describe('formatExpression', () => {
  it('round-trips an expression through the parser', () => {
    expect(formatExpression(parseExpression('2d20kh1t3a0+5'))).toBe('2d20kh1t3a0+5')
  })

  it('normalises an omitted count and a percentile die', () => {
    expect(formatExpression(parseExpression('d20-d%'))).toBe('1d20-1d100')
  })

  it('writes out a term a caller added a floor to', () => {
    const terms = parseExpression('1d20+9')
    const [first] = terms
    if (first?.kind === 'dice') first.dice.treatAtOrBelow = { threshold: 3, value: 0 }
    expect(formatExpression(terms)).toBe('1d20t3a0+9')
    expect(() => parseExpression(formatExpression(terms))).not.toThrow()
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

  it('counts a die at or below the threshold as the given value', () => {
    const result = roll('1d20t3a0+9', 'normal', sequence([2]))
    const [term] = result.terms
    if (term?.kind === 'dice') expect(term.rolls[0]).toEqual({ value: 0, kept: true, treatedFrom: 2 })
    expect(result.total).toBe(9)
  })

  it('leaves a die above the threshold alone', () => {
    const result = roll('1d20t3a0', 'normal', sequence([4]))
    const [term] = result.terms
    if (term?.kind === 'dice') expect(term.rolls[0]).toEqual({ value: 4, kept: true })
    expect(result.total).toBe(4)
  })

  // The whole point of the rule: a 1 that counts as 0 has to be a 0 while the
  // pool is choosing, or advantage would keep it for a face that no longer is.
  it('floors a die before keep/drop decides which one counts', () => {
    const result = roll('2d20kh1t3a0', 'normal', sequence([2, 1]))
    const [term] = result.terms
    if (term?.kind === 'dice') {
      expect(term.rolls.map((r) => [r.treatedFrom, r.value, r.kept])).toEqual([
        [2, 0, true],
        [1, 0, false],
      ])
    }
    expect(result.total).toBe(0)
  })

  it('keeps the die that survives the floor over the one that does not', () => {
    const result = roll('2d20kh1t3a0', 'normal', sequence([3, 11]))
    expect(result.total).toBe(11)
  })

  it('applies the floor to a die advantage produced rather than skipping it', () => {
    const result = roll('1d20t3a0', 'advantage', sequence([1, 2]))
    const [term] = result.terms
    expect(term).toMatchObject({ notation: '2d20kh1t3a0' })
    expect(result.total).toBe(0)
  })

  it('rerolls first, then judges the face the die settled on', () => {
    const result = roll('1d20r1t3a0', 'normal', sequence([1, 2]))
    const [term] = result.terms
    if (term?.kind === 'dice') expect(term.rolls[0]).toEqual({ value: 0, kept: true, rerolledFrom: 1, treatedFrom: 2 })
    expect(result.total).toBe(0)
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

  it('writes a floored die as the face it showed and the number it counted for', () => {
    const result = roll('1d20t3a0+2', 'normal', sequence([1]))
    expect(describeResult(result)).toBe('1d20t3a0 [1->0] + 2')
  })

  // Weary changes what the roll totals, not what the die did. The table still
  // wants to hear that it came up 1.
  it('still calls a natural one a fumble when it was counted as zero', () => {
    expect(criticalKind(roll('1d20t3a0', 'normal', sequence([1])))).toBe('failure')
  })

  it('reads the face a die landed on through the rule that reinterpreted it', () => {
    const result = roll('1d20t3a0', 'normal', sequence([2]))
    const [term] = result.terms
    if (term?.kind === 'dice') expect(term.rolls.map(faceOf)).toEqual([2])
  })
})
