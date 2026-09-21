/**
 * The conformance suite for the formula grammar.
 *
 * These vectors *are* the frozen contract — a specification prose can drift
 * from, but these cannot. Workstream B implements `parse` and `evaluate` until
 * every one passes; any later change to the grammar starts by changing a vector
 * here, which makes the blast radius visible before a line is written.
 */

export interface EvaluationVector {
  source: string
  scope: Record<string, unknown>
  expected: number
  why: string
}

export interface RejectionVector {
  source: string
  why: string
}

export const EVALUATION_VECTORS: EvaluationVector[] = [
  { source: '3', scope: {}, expected: 3, why: 'a bare number' },
  { source: '-3', scope: {}, expected: -3, why: 'unary minus' },
  { source: '2 + 3 * 4', scope: {}, expected: 14, why: 'multiplication binds tighter than addition' },
  { source: '(2 + 3) * 4', scope: {}, expected: 20, why: 'parentheses override precedence' },
  { source: '10 - 4 - 3', scope: {}, expected: 3, why: 'subtraction is left-associative' },
  { source: '100 / 10 / 2', scope: {}, expected: 5, why: 'division is left-associative' },

  { source: '@str', scope: { str: 16 }, expected: 16, why: 'a top-level reference' },
  { source: '@abilities.agility', scope: { abilities: { agility: 2 } }, expected: 2, why: 'a nested reference' },
  { source: '@missing', scope: {}, expected: 0, why: 'an absent reference is zero, not an error' },
  { source: '@a.b.c', scope: { a: {} }, expected: 0, why: 'an absent nested reference is zero' },
  { source: '@flag', scope: { flag: true }, expected: 1, why: 'a boolean reads as one' },
  { source: '@flag', scope: { flag: false }, expected: 0, why: 'a false boolean reads as zero' },
  { source: '@name', scope: { name: 'Frodo' }, expected: 0, why: 'a non-numeric value reads as zero' },

  { source: 'floor(7 / 2)', scope: {}, expected: 3, why: 'floor' },
  { source: 'ceil(7 / 2)', scope: {}, expected: 4, why: 'ceil' },
  { source: 'abs(0 - 5)', scope: {}, expected: 5, why: 'abs' },
  { source: 'min(3, 7)', scope: {}, expected: 3, why: 'min' },
  { source: 'max(3, 7, 5)', scope: {}, expected: 7, why: 'max is variadic' },
  { source: 'clamp(15, 1, 10)', scope: {}, expected: 10, why: 'clamp to the upper bound' },
  { source: 'clamp(-4, 1, 10)', scope: {}, expected: 1, why: 'clamp to the lower bound' },

  {
    source: 'floor((@str - 10) / 2)',
    scope: { str: 7 },
    expected: -2,
    why: 'a 5e ability modifier rounds down below ten as well as above',
  },
  {
    source: '2 + floor((@level - 1) / 4)',
    scope: { level: 5 },
    expected: 3,
    why: 'a 5e proficiency bonus',
  },
  {
    source: '@abilities.toughness',
    scope: { abilities: { toughness: -1 } },
    expected: -1,
    why: 'in MÖRK BORG the ability is the modifier',
  },
  { source: '  2   +   2  ', scope: {}, expected: 4, why: 'whitespace is insignificant' },
]

export const REJECTION_VECTORS: RejectionVector[] = [
  { source: '', why: 'empty' },
  { source: '2 +', why: 'a trailing operator' },
  { source: '(2 + 3', why: 'an unclosed parenthesis' },
  { source: '2 + 3)', why: 'an unopened parenthesis' },
  { source: '@', why: 'a reference to nothing' },
  { source: 'floor()', why: 'too few arguments' },
  { source: 'floor(1, 2)', why: 'too many arguments' },
  { source: 'clamp(1, 2)', why: 'clamp needs three arguments' },
  { source: 'sqrt(4)', why: 'a function outside the allowed set' },
  { source: 'process.exit(1)', why: 'not arithmetic' },
  { source: '@a["b"]', why: 'bracket access is not in the grammar' },
  { source: '1 ? 2 : 3', why: 'no conditionals' },
  { source: '@a = 3', why: 'no assignment' },
  { source: '2 ** 8', why: 'no exponentiation' },
  { source: '1 / 0', why: 'division by zero is not a number a sheet can show' },
]
