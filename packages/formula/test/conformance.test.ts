import { describe, expect, it } from 'vitest'
import { EVALUATION_VECTORS, REJECTION_VECTORS, evaluate, parse } from '../src/index.js'

/**
 * The conformance vectors are the contract — frozen in Phase 0, before any of
 * this existed. If a change here needs a vector changed, that is a change to
 * the grammar every pack is written against, not a test that needs relaxing.
 */
describe('the frozen conformance suite', () => {
  it.each(EVALUATION_VECTORS.map((v) => [v.why, v] as const))('%s', (_why, vector) => {
    expect(evaluate(vector.source, vector.scope)).toBeCloseTo(vector.expected, 10)
  })

  it.each(REJECTION_VECTORS.map((v) => [v.why, v] as const))('rejects %s', (_why, vector) => {
    expect(() => evaluate(vector.source, {})).toThrow()
  })

  it('covers every vector, so a shrinking suite is visible', () => {
    expect(EVALUATION_VECTORS.length).toBeGreaterThanOrEqual(24)
    expect(REJECTION_VECTORS.length).toBeGreaterThanOrEqual(15)
  })
})

describe('beyond the vectors', () => {
  it('parses to a tree rather than evaluating eagerly', () => {
    expect(parse('1 + 2')).toEqual({
      kind: 'binary',
      op: '+',
      left: { kind: 'number', value: 1 },
      right: { kind: 'number', value: 2 },
    })
  })

  it('reads a decimal', () => {
    expect(evaluate('1.5 * 2', {})).toBe(3)
  })

  it('nests functions', () => {
    expect(evaluate('max(floor(7 / 2), abs(0 - 1))', {})).toBe(3)
  })

  it('takes a reference as a function argument', () => {
    expect(evaluate('clamp(@score, 1, 20)', { score: 44 })).toBe(20)
  })

  it('applies unary minus to a reference', () => {
    expect(evaluate('-@shadow', { shadow: 3 })).toBe(-3)
  })

  it('does not treat a deep path as an escape hatch', () => {
    // The scope is a plain value bag; prototype walking is not path following.
    expect(evaluate('@constructor.name', {})).toBe(0)
    expect(evaluate('@__proto__.x', {})).toBe(0)
  })

  it('refuses a formula that is only whitespace', () => {
    expect(() => evaluate('   ', {})).toThrow(/empty/i)
  })

  it('says which function it does not know', () => {
    expect(() => evaluate('sqrt(4)', {})).toThrow(/sqrt/)
  })

  it('says when a function got the wrong number of arguments', () => {
    expect(() => evaluate('clamp(1, 2)', {})).toThrow(/3 arguments/)
  })

  it('refuses a result that is not a finite number', () => {
    expect(() => evaluate('1 / (1 - 1)', {})).toThrow(/divides by zero/)
  })
})
