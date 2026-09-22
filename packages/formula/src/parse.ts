/**
 * Parsing a formula into a tree.
 *
 * Recursive descent over a tiny grammar, written out in `index.ts`. Nothing
 * here is clever on purpose: the value of this module is that it accepts
 * exactly the grammar and rejects everything else, so a pack cannot smuggle
 * behaviour into a sheet field.
 */

import type { Ast, FunctionName } from './index.js'
import { FUNCTION_ARITY, FUNCTION_NAMES, FormulaError } from './index.js'

type Token =
  | { kind: 'number'; value: number; at: number }
  | { kind: 'ref'; path: string[]; at: number }
  | { kind: 'name'; value: string; at: number }
  | { kind: 'op'; value: '+' | '-' | '*' | '/'; at: number }
  | { kind: '('; at: number }
  | { kind: ')'; at: number }
  | { kind: ','; at: number }

const IDENT_START = /[A-Za-z_]/
const IDENT_PART = /[A-Za-z0-9_]/

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < source.length) {
    const char = source[i]!

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      i++
      continue
    }

    if (char === '(' || char === ')' || char === ',') {
      tokens.push({ kind: char, at: i } as Token)
      i++
      continue
    }

    if (char === '+' || char === '-' || char === '*' || char === '/') {
      tokens.push({ kind: 'op', value: char, at: i })
      i++
      continue
    }

    if (char >= '0' && char <= '9') {
      let end = i
      while (end < source.length && source[end]! >= '0' && source[end]! <= '9') end++
      if (source[end] === '.') {
        end++
        while (end < source.length && source[end]! >= '0' && source[end]! <= '9') end++
      }
      tokens.push({ kind: 'number', value: Number(source.slice(i, end)), at: i })
      i = end
      continue
    }

    if (char === '@') {
      i++
      const path: string[] = []
      for (;;) {
        const start = i
        if (i >= source.length || !IDENT_START.test(source[i]!)) {
          throw new FormulaError(`Expected a field name after "@" at position ${start}`)
        }
        while (i < source.length && IDENT_PART.test(source[i]!)) i++
        path.push(source.slice(start, i))
        if (source[i] !== '.') break
        i++
      }
      tokens.push({ kind: 'ref', path, at: i })
      continue
    }

    if (IDENT_START.test(char)) {
      const start = i
      while (i < source.length && IDENT_PART.test(source[i]!)) i++
      tokens.push({ kind: 'name', value: source.slice(start, i), at: start })
      continue
    }

    throw new FormulaError(`"${char}" is not part of a formula (at position ${i})`)
  }

  return tokens
}

export function parse(source: string): Ast {
  if (typeof source !== 'string' || !source.trim()) {
    throw new FormulaError('A formula cannot be empty')
  }

  const tokens = tokenize(source)
  if (!tokens.length) throw new FormulaError('A formula cannot be empty')

  let position = 0
  const peek = (): Token | undefined => tokens[position]
  const next = (): Token | undefined => tokens[position++]

  const expect = (kind: Token['kind'], what: string): Token => {
    const token = next()
    if (!token || token.kind !== kind) {
      throw new FormulaError(`Expected ${what}${token ? ` at position ${token.at}` : ' but the formula ended'}`)
    }
    return token
  }

  // expr := term (('+' | '-') term)*
  const expr = (): Ast => {
    let left = term()
    for (;;) {
      const token = peek()
      if (token?.kind !== 'op' || (token.value !== '+' && token.value !== '-')) return left
      position++
      left = { kind: 'binary', op: token.value, left, right: term() }
    }
  }

  // term := factor (('*' | '/') factor)*
  const term = (): Ast => {
    let left = factor()
    for (;;) {
      const token = peek()
      if (token?.kind !== 'op' || (token.value !== '*' && token.value !== '/')) return left
      position++
      left = { kind: 'binary', op: token.value, left, right: factor() }
    }
  }

  // factor := number | ref | call | '(' expr ')' | '-' factor
  const factor = (): Ast => {
    const token = next()
    if (!token) throw new FormulaError('The formula ends where a value was expected')

    switch (token.kind) {
      case 'number':
        return { kind: 'number', value: token.value }

      case 'ref':
        return { kind: 'ref', path: token.path }

      case '(': {
        const inner = expr()
        expect(')', 'a closing parenthesis')
        return inner
      }

      case 'op': {
        // Unary minus only; a leading '+' or a stray '*' is not a value.
        if (token.value !== '-') {
          throw new FormulaError(`"${token.value}" needs a value before it (at position ${token.at})`)
        }
        return { kind: 'unary', op: '-', operand: factor() }
      }

      case 'name': {
        if (!(FUNCTION_NAMES as readonly string[]).includes(token.value)) {
          throw new FormulaError(
            `"${token.value}" is not one of the functions a formula may use (${FUNCTION_NAMES.join(', ')})`,
          )
        }
        const fn = token.value as FunctionName
        expect('(', `an opening parenthesis after "${fn}"`)

        const args: Ast[] = []
        if (peek()?.kind !== ')') {
          args.push(expr())
          while (peek()?.kind === ',') {
            position++
            args.push(expr())
          }
        }
        expect(')', `a closing parenthesis for "${fn}"`)

        const arity = FUNCTION_ARITY[fn]
        if (args.length < arity.min || args.length > arity.max) {
          const wanted = arity.min === arity.max ? `${arity.min}` : `${arity.min} to ${arity.max}`
          throw new FormulaError(`"${fn}" takes ${wanted} arguments, not ${args.length}`)
        }
        return { kind: 'call', fn, args }
      }

      default:
        throw new FormulaError(`Unexpected "${token.kind}" at position ${token.at}`)
    }
  }

  const tree = expr()
  const trailing = peek()
  if (trailing) {
    throw new FormulaError(`The formula continues past where it should end (position ${trailing.at})`)
  }
  return tree
}
