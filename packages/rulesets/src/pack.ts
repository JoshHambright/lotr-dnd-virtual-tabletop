/**
 * The ruleset pack contract.
 *
 * A pack is data, not code. The client renders whatever a pack declares, so a
 * fourth system is a new pack rather than a change to the app — and a pack has
 * no way to execute anything, which is what keeps GM-supplied packs a possible
 * future rather than a sandboxing problem.
 *
 * Frozen at the end of Phase 0. Append-only during a phase: six workstreams
 * code against this at once, and a breaking change mid-phase invalidates work
 * already in flight. See docs/RULESET_PACKS.md and DECISIONS.md D-005/D-012.
 */

import type { Formula } from '@vtt/formula'

export interface RulesetPack {
  id: string
  name: string
  version: string
  summary: string

  licence: Licence
  theme: ThemeTokens
  dice: DiceProfile
  sheet: SheetSchema
  conditions: Condition[]
  tokenDefaults: TokenDefaults
  content?: ContentIndex
}

/**
 * Never optional: for two of the three launch packs, displaying attribution is
 * a condition of the licence, so it is rendered in the app rather than buried
 * in a repository file.
 */
export interface Licence {
  name: string
  url?: string
  /** Verbatim text the licence obliges us to display. */
  notice: string
  /** Set only where a licence explicitly grants a compatibility logo we ship. */
  compatibilityLogo?: string
}

export interface ThemeTokens {
  /** CSS custom properties, without the leading '--'. */
  colors: Record<string, string>
  fonts: { display: string; body: string; mono: string }
  /** Openly licensed families only. We ship no commercial typefaces. */
  webfonts?: { family: string; href: string }[]
  radius: string
  texture?: 'flat' | 'parchment' | 'xerox'
}

export interface DiceProfile {
  defaultDie: number
  advantageModel: 'keep-highest' | 'flat-bonus' | 'none'
  advantageBonus?: number
  /** 'DC' in 5e, 'DR' in MÖRK BORG. */
  targetLabel: string
  defaultTarget?: number
  criticalSuccess?: number[]
  criticalFailure?: number[]
  quickDice: string[]
  modifiers?: RollModifier[]
}

export interface RollModifier {
  id: string
  label: string
  /** Applies when this sheet field is truthy. */
  whenField: string
  effect:
    | { kind: 'bonus'; value: number }
    | { kind: 'treat-below-as'; threshold: number; value: number }
    | { kind: 'reroll-at-or-below'; threshold: number }
  /**
   * Set when the rule could not be confirmed against the book, so the app can
   * say it is unsure rather than quietly asserting a rule at the table.
   */
  unverified?: boolean
}

export interface SheetSchema {
  sections: Section[]
}

export interface Section {
  id: string
  title: string
  tone?: 'default' | 'grim' | 'highlight'
  fields: Field[]
}

export type Field =
  | { kind: 'text'; key: string; label: string; placeholder?: string }
  | { kind: 'longtext'; key: string; label: string }
  | { kind: 'number'; key: string; label: string; min?: number; max?: number; derived?: Formula }
  | { kind: 'toggle'; key: string; label: string }
  | {
      kind: 'select'
      key: string
      label: string
      options: string[]
      allowCustom: boolean
      /** Optional: fill this field from another field's value. */
      suggest?: Suggestion
    }
  | {
      kind: 'abilityBlock'
      key: string
      abilities: { key: string; label: string }[]
      modifier: Formula
      roll?: RollMacro
    }
  | {
      kind: 'skillList'
      key: string
      skills: { key: string; label: string; ability: string }[]
      /** How many proficiency steps the system has; 5e has three (none, proficient, expertise). */
      ranks: number
      modifier: Formula
      roll?: RollMacro
    }
  | { kind: 'track'; key: string; label: string; max?: Formula; resetOn?: string }
  | { kind: 'repeater'; key: string; label: string; fields: Field[]; roll?: RollMacro }

/**
 * "When Calling is Champion, the Shadow path is usually Lure of Secrets."
 *
 * A suggestion, not a rule: the field stays editable and the mapping is data,
 * so a table that plays it differently is a one-line pack edit rather than an
 * argument with the app. `unverified` is the honest case — we could not check
 * the mapping against the book, and the sheet says so instead of asserting it.
 */
export interface Suggestion {
  /** The field whose value drives the suggestion. */
  fromKey: string
  /** That field's value -> the value suggested here. */
  map: Record<string, string>
  unverified?: boolean
}

export interface RollMacro {
  label: string
  /** Dice template; '@' references resolve against the character's values. */
  expression: string
  visibility?: 'public' | 'gm'
}

export interface Condition {
  id: string
  label: string
  description?: string
}

export interface TokenDefaults {
  squares: number
  colors: string[]
  showHpToPlayers: boolean
}

/** Bundled game content, where a licence allows it to ship. */
export interface ContentIndex {
  creatures?: ContentEntry[]
  spells?: ContentEntry[]
  equipment?: ContentEntry[]
}

export interface ContentEntry {
  id: string
  name: string
  /** Free-form, shaped by the pack; rendered as a stat block. */
  data: Record<string, unknown>
}

/** A character's values. Shape is the pack's business, not the app's. */
export type CharacterValues = Record<string, unknown>
