/**
 * Derived sheet values — the contract.
 *
 * A formula computes a number from a character's values: a 5e ability modifier,
 * a proficiency bonus, a hit point maximum. It is deliberately not a scripting
 * language, and the failure mode being guarded against is it becoming one a
 * feature at a time until an untested interpreter is embedded in a game tool.
 *
 * Grammar (the whole of it):
 *
 *   expr    := term (('+' | '-') term)*
 *   term    := factor (('*' | '/') factor)*
 *   factor  := number | ref | call | '(' expr ')' | '-' factor
 *   ref     := '@' identifier ('.' identifier)*
 *   call    := ('floor'|'ceil'|'min'|'max'|'abs'|'clamp') '(' expr (',' expr)* ')'
 *
 * No assignment, no conditionals, no loops, no property access beyond the value
 * bag, and no `eval` anywhere near it. Anything needing more power is a
 * code-level pack hook, reviewed as code.
 *
 * Frozen in Phase 0; implemented by workstream B against the conformance
 * vectors in `./conformance.js`, which are executable and currently red.
 */

/** A formula is source text. It is parsed, never evaluated as JavaScript. */
export type Formula = string

export type Ast =
  | { kind: 'number'; value: number }
  | { kind: 'ref'; path: string[] }
  | { kind: 'unary'; op: '-'; operand: Ast }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Ast; right: Ast }
  | { kind: 'call'; fn: FunctionName; args: Ast[] }

export const FUNCTION_NAMES = ['floor', 'ceil', 'min', 'max', 'abs', 'clamp'] as const
export type FunctionName = (typeof FUNCTION_NAMES)[number]

/** Arity per function; `min` and `max` are variadic with at least two arguments. */
export const FUNCTION_ARITY: Record<FunctionName, { min: number; max: number }> = {
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  min: { min: 2, max: 16 },
  max: { min: 2, max: 16 },
  clamp: { min: 3, max: 3 },
}

/** The bag a formula reads from. Missing references resolve to 0, not an error. */
export type Scope = Record<string, unknown>

export class FormulaError extends Error {}

export type ParseFormula = (source: Formula) => Ast
export type EvaluateFormula = (source: Formula, scope: Scope) => number

export * from './conformance.js'
export { parse } from './parse.js'
export { evaluate, evaluateAst } from './evaluate.js'
