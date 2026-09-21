/**
 * Dice expressions, parsed and rolled.
 *
 * Every roll is resolved on the server so the numbers are the same for
 * everyone and nobody can retcon a result. The client is handed the finished
 * dice and only animates them landing on faces that were already decided.
 *
 * Grammar (whitespace-insensitive, case-insensitive):
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := dice | integer
 *   dice   := [count] 'd' (sides | '%') modifier*
 *   modif  := ('kh' | 'kl' | 'dh' | 'dl') [n]   keep/drop highest/lowest
 *           | 'r' [n]                            reroll dice <= n once
 *
 * So `4d6kh3`, `2d20kh1+5`, `d%`, `3d8r1-2` all parse. Advantage and
 * disadvantage are passed separately rather than written into the string,
 * because the UI has buttons for them.
 */

export type RollMode = 'normal' | 'advantage' | 'disadvantage'

export interface DieRoll {
  value: number
  kept: boolean
  /** Set when a reroll replaced an earlier value, so the log can show both. */
  rerolledFrom?: number
}

export type Term =
  | {
      kind: 'dice'
      sign: 1 | -1
      count: number
      sides: number
      rolls: DieRoll[]
      subtotal: number
      notation: string
    }
  | { kind: 'const'; sign: 1 | -1; value: number; notation: string }

export interface RollResult {
  expression: string
  mode: RollMode
  terms: Term[]
  total: number
}

export class DiceError extends Error {}

const MAX_DICE = 100
const MAX_SIDES = 1000

interface ParsedDice {
  count: number
  sides: number
  keep?: { kind: 'kh' | 'kl' | 'dh' | 'dl'; n: number }
  rerollAtOrBelow?: number
}

type ParsedTerm =
  | { kind: 'dice'; sign: 1 | -1; dice: ParsedDice; notation: string }
  | { kind: 'const'; sign: 1 | -1; value: number; notation: string }

/**
 * Splits on top-level + and - and parses each piece. Returns terms in source
 * order so the roll log reads like what the player typed.
 */
export function parseExpression(input: string): ParsedTerm[] {
  const src = input.replace(/\s+/g, '').toLowerCase()
  if (!src) throw new DiceError('Enter a dice expression, for example 1d20+3')
  if (!/^[0-9d%khlr+-]+$/.test(src)) {
    throw new DiceError(`"${input}" has characters that are not part of a dice expression`)
  }

  const terms: ParsedTerm[] = []
  let sign: 1 | -1 = 1
  let cursor = 0

  // A leading sign is allowed; after that every term must be separated by one.
  if (src[0] === '+' || src[0] === '-') {
    sign = src[0] === '-' ? -1 : 1
    cursor = 1
  }

  while (cursor < src.length) {
    let next = cursor
    while (next < src.length && src[next] !== '+' && src[next] !== '-') next++
    const piece = src.slice(cursor, next)
    if (!piece) throw new DiceError(`"${input}" has an operator with nothing after it`)
    terms.push(parseTerm(piece, sign))

    if (next >= src.length) break
    sign = src[next] === '-' ? -1 : 1
    cursor = next + 1
    if (cursor >= src.length) throw new DiceError(`"${input}" ends with an operator`)
  }

  if (!terms.length) throw new DiceError(`"${input}" is not a dice expression`)
  return terms
}

function parseTerm(piece: string, sign: 1 | -1): ParsedTerm {
  if (!piece.includes('d')) {
    if (!/^\d+$/.test(piece)) throw new DiceError(`"${piece}" is not a number`)
    return { kind: 'const', sign, value: Number(piece), notation: piece }
  }

  const match = /^(\d*)d(\d+|%)((?:(?:kh|kl|dh|dl|r)\d*)*)$/.exec(piece)
  if (!match) throw new DiceError(`"${piece}" is not a dice term`)

  const [, rawCount, rawSides, rawMods = ''] = match
  const count = rawCount ? Number(rawCount) : 1
  const sides = rawSides === '%' ? 100 : Number(rawSides)

  if (count < 1) throw new DiceError('A dice term needs at least one die')
  if (count > MAX_DICE) throw new DiceError(`${count} dice is more than the ${MAX_DICE} allowed in one term`)
  if (sides < 2) throw new DiceError('A die needs at least two sides')
  if (sides > MAX_SIDES) throw new DiceError(`d${sides} is larger than the d${MAX_SIDES} allowed`)

  const dice: ParsedDice = { count, sides }

  for (const mod of rawMods.matchAll(/(kh|kl|dh|dl|r)(\d*)/g)) {
    const kind = mod[1] as 'kh' | 'kl' | 'dh' | 'dl' | 'r'
    const n = mod[2] ? Number(mod[2]) : 1
    if (kind === 'r') {
      if (n >= sides) throw new DiceError(`r${n} on a d${sides} would reroll every face`)
      dice.rerollAtOrBelow = n
    } else {
      if (n < 1) throw new DiceError(`${kind}0 keeps or drops nothing`)
      if (n > count) throw new DiceError(`${kind}${n} needs at least ${n} dice, but the term rolls ${count}`)
      dice.keep = { kind, n }
    }
  }

  return { kind: 'dice', sign, dice, notation: piece }
}

/** Source of randomness, injected so tests and the server can both control it. */
export type Rng = () => number

export function rollDie(sides: number, rng: Rng): number {
  return Math.floor(rng() * sides) + 1
}

/**
 * Rolls a parsed expression. `mode` applies advantage or disadvantage to the
 * first d20 term found, which is where 5e always wants it.
 */
export function roll(expression: string, mode: RollMode = 'normal', rng: Rng = Math.random): RollResult {
  const parsed = parseExpression(expression)
  const terms: Term[] = []
  let total = 0
  let advantageApplied = mode === 'normal'

  for (const term of parsed) {
    if (term.kind === 'const') {
      total += term.sign * term.value
      terms.push({ kind: 'const', sign: term.sign, value: term.value, notation: term.notation })
      continue
    }

    const { sides, rerollAtOrBelow } = term.dice
    let { count, keep } = term.dice
    let notation = term.notation

    // Advantage on a plain d20: roll two and keep the better (or worse) one.
    if (!advantageApplied && sides === 20 && count === 1 && !keep) {
      count = 2
      keep = { kind: mode === 'advantage' ? 'kh' : 'kl', n: 1 }
      notation = mode === 'advantage' ? '2d20kh1' : '2d20kl1'
      advantageApplied = true
    }

    const rolls: DieRoll[] = []
    for (let i = 0; i < count; i++) {
      let value = rollDie(sides, rng)
      if (rerollAtOrBelow !== undefined && value <= rerollAtOrBelow) {
        const original = value
        value = rollDie(sides, rng)
        rolls.push({ value, kept: true, rerolledFrom: original })
        continue
      }
      rolls.push({ value, kept: true })
    }

    if (keep) markKept(rolls, keep)

    const subtotal = rolls.reduce((sum, r) => (r.kept ? sum + r.value : sum), 0)
    total += term.sign * subtotal
    terms.push({ kind: 'dice', sign: term.sign, count, sides, rolls, subtotal, notation })
  }

  return { expression, mode, terms, total }
}

/**
 * Flags which dice count toward the subtotal. Ties are broken by position so
 * two identical faces never both get dropped by a kh1.
 */
function markKept(rolls: DieRoll[], keep: { kind: 'kh' | 'kl' | 'dh' | 'dl'; n: number }): void {
  const order = rolls
    .map((r, index) => ({ index, value: r.value }))
    .sort((a, b) => (a.value === b.value ? a.index - b.index : b.value - a.value))

  let keptIndices: number[]
  switch (keep.kind) {
    case 'kh':
      keptIndices = order.slice(0, keep.n).map((r) => r.index)
      break
    case 'kl':
      keptIndices = order.slice(order.length - keep.n).map((r) => r.index)
      break
    case 'dh':
      keptIndices = order.slice(keep.n).map((r) => r.index)
      break
    case 'dl':
      keptIndices = order.slice(0, order.length - keep.n).map((r) => r.index)
      break
  }

  const kept = new Set(keptIndices)
  rolls.forEach((r, index) => {
    r.kept = kept.has(index)
  })
}

/**
 * A one-line plain-text summary, e.g. "2d20kh1 [17, (4)] + 3". Dropped dice
 * are parenthesised rather than struck through, because this string goes
 * places that cannot render formatting; the roll log draws its own strikethrough.
 */
export function describeResult(result: RollResult): string {
  return result.terms
    .map((term, index) => {
      const op = index === 0 ? (term.sign === -1 ? '-' : '') : term.sign === -1 ? ' - ' : ' + '
      if (term.kind === 'const') return `${op}${term.value}`
      const faces = term.rolls.map((r) => (r.kept ? `${r.value}` : `(${r.value})`)).join(', ')
      return `${op}${term.notation} [${faces}]`
    })
    .join('')
}

/** True when a kept d20 landed on 20 (or on 1), for highlighting in the log. */
export function criticalKind(result: RollResult): 'success' | 'failure' | null {
  for (const term of result.terms) {
    if (term.kind !== 'dice' || term.sides !== 20) continue
    for (const r of term.rolls) {
      if (!r.kept) continue
      if (r.value === 20) return 'success'
      if (r.value === 1) return 'failure'
    }
  }
  return null
}
