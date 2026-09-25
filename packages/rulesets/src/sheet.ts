/**
 * Turning a pack plus a bag of values into the numbers a sheet shows.
 *
 * Pure and free of React on purpose: what a skill modifier comes to is the
 * thing most worth testing on this screen, and it should be testable without
 * rendering anything. The client draws what this returns.
 *
 * Nothing here throws. A sheet that a divide-by-zero can blank out mid-fight is
 * worse than one showing 0 next to a quiet complaint, so formula failures are
 * collected in `problems` and the number falls back to 0.
 */

import { FormulaError, evaluate } from '@vtt/formula'
import { DiceError, parseExpression } from '@vtt/dice'
import type { CharacterValues, Field, RollMacro, RulesetPack, Section } from './pack.js'

export interface AbilityView {
  key: string
  label: string
  score: number
  modifier: number
}

export interface SkillView {
  key: string
  label: string
  ability: string
  rank: number
  modifier: number
}

/** What a `track` field stores: a current value and a maximum. */
export interface TrackValue {
  value: number
  max: number
}

export interface DerivedSheet {
  /** Every `number` field that declares a `derived` formula, by field key. */
  derived: Record<string, number>
  /** By field key, then in the order the pack declares them. */
  abilities: Record<string, AbilityView[]>
  skills: Record<string, SkillView[]>
  /** Only for tracks whose maximum is a formula. */
  trackMax: Record<string, number>
  /** Formulas that could not be worked out, in plain words. */
  problems: string[]
}

/**
 * Computes everything derived, once.
 *
 * Order is part of the contract: derived `number` fields resolve first, in the
 * order the pack declares them and each feeding the next, then ability
 * modifiers, then skill modifiers, then track maxima. That is what lets a skill
 * formula say `@proficiency` and mean the field two sections above it.
 */
export function deriveSheet(pack: RulesetPack, values: CharacterValues): DerivedSheet {
  const problems: string[] = []
  const scope: Record<string, unknown> = { ...values }

  const compute = (formula: string, where: string, extra?: Record<string, unknown>): number => {
    try {
      return evaluate(formula, extra ? { ...scope, ...extra } : scope)
    } catch (error) {
      problems.push(`${where}: ${error instanceof FormulaError ? error.message : 'could not be worked out'}`)
      return 0
    }
  }

  const derived: Record<string, number> = {}
  const abilities: Record<string, AbilityView[]> = {}
  const skills: Record<string, SkillView[]> = {}
  const trackMax: Record<string, number> = {}

  for (const field of allFields(pack.sheet.sections)) {
    if (field.kind === 'number' && field.derived) {
      const value = compute(field.derived, field.label)
      derived[field.key] = value
      // Feeds the next formula: '@proficiency' has to mean something.
      scope[field.key] = value
    }
  }

  for (const field of allFields(pack.sheet.sections)) {
    if (field.kind === 'abilityBlock') {
      const scores = readRecord(values[field.key])
      abilities[field.key] = field.abilities.map((ability) => {
        const score = numberOr(scores[ability.key], 0)
        return {
          key: ability.key,
          label: ability.label,
          score,
          modifier: compute(field.modifier, ability.label, { score }),
        }
      })
    }
  }

  for (const field of allFields(pack.sheet.sections)) {
    if (field.kind === 'skillList') {
      const ranks = readRecord(values[field.key])
      skills[field.key] = field.skills.map((skill) => {
        const rank = clampRank(numberOr(ranks[skill.key], 0), field.ranks)
        return {
          key: skill.key,
          label: skill.label,
          ability: skill.ability,
          rank,
          modifier: compute(field.modifier, skill.label, {
            mod: abilityModifierOf(abilities, skill.ability),
            rank,
          }),
        }
      })
    }

    if (field.kind === 'track' && field.max) {
      trackMax[field.key] = compute(field.max, field.label)
    }
  }

  return { derived, abilities, skills, trackMax, problems }
}

/**
 * Fills a roll macro in and hands back something the dice parser accepts.
 *
 * The dice grammar has no parentheses, so a negative modifier cannot simply be
 * pasted in — `1d20 + -1` is not an expression. Signs are folded instead, which
 * is the same `1d20-1` a person would have typed.
 */
export function resolveMacro(macro: RollMacro | string, scope: Record<string, unknown>): string {
  const source = typeof macro === 'string' ? macro : macro.expression

  // Every piece between operators has to be a single token. '1d20 @total' is
  // two, and stripping the space would turn it into '1d203' — a valid roll,
  // and not the one anybody wrote.
  for (const piece of source.split(/[+-]/)) {
    if (/\S\s+\S/.test(piece.trim())) {
      throw new DiceError(`"${source}" is missing a + or - between two parts of the roll`)
    }
  }

  const filled = source.replace(/@[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/g, (reference) => {
    try {
      return String(evaluate(reference, scope))
    } catch {
      return '0'
    }
  })

  // '+ -1' -> '-1', '- -1' -> '+1', and so on, until no sign pairs are left.
  let folded = filled.replace(/\s+/g, '')
  let previous = ''
  while (folded !== previous) {
    previous = folded
    folded = folded.replace(/\+-/g, '-').replace(/--/g, '+').replace(/-\+/g, '-').replace(/\+\+/g, '+')
  }
  // A term that came out as zero is noise in the log: '1d20+0' reads as a bug.
  folded = folded.replace(/([+-])0(?![\d.])/g, '')

  parseExpression(folded)
  return folded
}

/** Depth-first over every field, stepping into repeater rows. */
export function* allFields(sections: Section[]): Generator<Field> {
  for (const section of sections) yield* walk(section.fields)
}

function* walk(fields: Field[]): Generator<Field> {
  for (const field of fields) {
    yield field
    if (field.kind === 'repeater') yield* walk(field.fields)
  }
}

function abilityModifierOf(abilities: Record<string, AbilityView[]>, key: string): number {
  for (const views of Object.values(abilities)) {
    const match = views.find((view) => view.key === key)
    if (match) return match.modifier
  }
  return 0
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clampRank(rank: number, ranks: number): number {
  return Math.max(0, Math.min(ranks - 1, Math.trunc(rank)))
}

/** '+3' or '-1'. Every system that has modifiers writes them with a sign. */
export function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`
}
