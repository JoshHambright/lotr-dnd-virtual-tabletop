/**
 * Walking a parsed formula over a character's values.
 *
 * Two rules worth stating, because both are deliberate and neither is obvious:
 *
 * A reference to something absent is 0, not an error. Sheets are half-filled
 * most of the time, and a derived field that throws while someone is still
 * typing their character is worse than one that reads zero.
 *
 * Division by zero throws. There is no number a sheet can show for it, and
 * quietly producing Infinity would put "Infinity" in an armour class box.
 */

import type { Ast, Scope } from './index.js'
import { FormulaError } from './index.js'
import { parse } from './parse.js'

export function evaluateAst(node: Ast, scope: Scope): number {
  switch (node.kind) {
    case 'number':
      return node.value

    case 'ref':
      return coerce(read(scope, node.path))

    case 'unary':
      return -evaluateAst(node.operand, scope)

    case 'binary': {
      const left = evaluateAst(node.left, scope)
      const right = evaluateAst(node.right, scope)
      switch (node.op) {
        case '+':
          return left + right
        case '-':
          return left - right
        case '*':
          return left * right
        case '/':
          if (right === 0) throw new FormulaError('This formula divides by zero')
          return left / right
      }
      break
    }

    case 'call': {
      const args = node.args.map((argument) => evaluateAst(argument, scope))
      switch (node.fn) {
        case 'floor':
          return Math.floor(args[0]!)
        case 'ceil':
          return Math.ceil(args[0]!)
        case 'abs':
          return Math.abs(args[0]!)
        case 'min':
          return Math.min(...args)
        case 'max':
          return Math.max(...args)
        case 'clamp':
          return Math.min(Math.max(args[0]!, args[1]!), args[2]!)
      }
    }
  }

  throw new FormulaError('This formula could not be worked out')
}

export function evaluate(source: string, scope: Scope): number {
  const result = evaluateAst(parse(source), scope)
  if (!Number.isFinite(result)) {
    throw new FormulaError('This formula does not come out to a number')
  }
  return result
}

/** Follows a dotted path, stopping at the first thing that is not an object. */
function read(scope: Scope, path: string[]): unknown {
  let current: unknown = scope
  for (const step of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[step]
  }
  return current
}

/**
 * What a sheet value is worth as a number.
 *
 * A tick-box reads as 1 or 0, which is what makes `@weary` usable in a
 * formula. Anything that is not a number or a boolean — a name, a note, a
 * missing field — is 0 rather than NaN, so one unfilled box cannot turn a
 * whole sheet into nonsense.
 */
function coerce(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  return 0
}
