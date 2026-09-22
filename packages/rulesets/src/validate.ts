/**
 * Checking that a pack is a pack.
 *
 * A malformed pack should fail a build, not a session. Everything a pack
 * declares is validated here, including every formula it contains — a typo in
 * a derived field is found by CI rather than by a player whose armour class
 * has gone blank mid-fight.
 */

import { z } from 'zod'
import { FormulaError, parse } from '@vtt/formula'
import type { RulesetPack } from './pack.js'

const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/i, 'must start with a letter')
const label = z.string().min(1).max(120)
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour')

/**
 * A formula must parse. Validating it here means the error names the pack and
 * the field, rather than surfacing as a blank box later.
 */
const formula = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    try {
      parse(value)
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof FormulaError ? error.message : 'is not a valid formula',
      })
    }
  })

const rollMacro = z.object({
  label: label,
  expression: z.string().min(1).max(160),
  visibility: z.enum(['public', 'gm']).optional(),
})

const baseField = { key: identifier, label }

// Recursive, because a repeater holds fields of its own.
const field: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), ...baseField, placeholder: z.string().max(120).optional() }),
    z.object({ kind: z.literal('longtext'), ...baseField }),
    z.object({
      kind: z.literal('number'),
      ...baseField,
      min: z.number().optional(),
      max: z.number().optional(),
      derived: formula.optional(),
    }),
    z.object({ kind: z.literal('toggle'), ...baseField }),
    z.object({
      kind: z.literal('select'),
      ...baseField,
      options: z.array(z.string().min(1).max(120)).min(1).max(200),
      allowCustom: z.boolean(),
    }),
    z.object({
      kind: z.literal('abilityBlock'),
      ...baseField,
      abilities: z
        .array(z.object({ key: identifier, label }))
        .min(1)
        .max(12),
      modifier: formula,
      roll: rollMacro.optional(),
    }),
    z.object({
      kind: z.literal('skillList'),
      ...baseField,
      skills: z.array(z.object({ key: identifier, label, ability: identifier })).max(64),
      ranks: z.number().int().min(1).max(5),
      modifier: formula,
      roll: rollMacro.optional(),
    }),
    z.object({
      kind: z.literal('track'),
      ...baseField,
      max: formula.optional(),
      resetOn: z.string().max(64).optional(),
    }),
    z.object({
      kind: z.literal('repeater'),
      ...baseField,
      fields: z.array(field).min(1).max(24),
      roll: rollMacro.optional(),
    }),
  ]),
)

export const packSchema = z.object({
  id: identifier,
  name: label,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'must be a semantic version'),
  summary: z.string().min(1).max(400),

  licence: z.object({
    name: label,
    url: z.string().url().optional(),
    // Never optional: for two of the three packs, displaying this is a
    // condition of the licence.
    notice: z.string().min(1).max(2000),
    compatibilityLogo: z.string().max(200).optional(),
  }),

  theme: z.object({
    colors: z.record(z.string(), z.string().min(1).max(64)),
    fonts: z.object({ display: z.string().min(1), body: z.string().min(1), mono: z.string().min(1) }),
    webfonts: z.array(z.object({ family: z.string().min(1), href: z.string().url() })).optional(),
    radius: z.string().min(1).max(32),
    texture: z.enum(['flat', 'parchment', 'xerox']).optional(),
  }),

  dice: z.object({
    defaultDie: z.number().int().min(2).max(1000),
    advantageModel: z.enum(['keep-highest', 'flat-bonus', 'none']),
    advantageBonus: z.number().optional(),
    targetLabel: z.string().min(1).max(12),
    defaultTarget: z.number().optional(),
    criticalSuccess: z.array(z.number().int()).max(20).optional(),
    criticalFailure: z.array(z.number().int()).max(20).optional(),
    quickDice: z.array(z.string().min(1).max(12)).max(12),
    modifiers: z
      .array(
        z.object({
          id: identifier,
          label,
          whenField: z.string().min(1).max(120),
          effect: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('bonus'), value: z.number() }),
            z.object({ kind: z.literal('treat-below-as'), threshold: z.number(), value: z.number() }),
            z.object({ kind: z.literal('reroll-at-or-below'), threshold: z.number() }),
          ]),
          unverified: z.boolean().optional(),
        }),
      )
      .max(24)
      .optional(),
  }),

  sheet: z.object({
    sections: z
      .array(
        z.object({
          id: identifier,
          title: label,
          tone: z.enum(['default', 'grim', 'highlight']).optional(),
          fields: z.array(field).max(80),
        }),
      )
      .min(1)
      .max(24),
  }),

  conditions: z.array(z.object({ id: identifier, label, description: z.string().max(400).optional() })).max(64),

  tokenDefaults: z.object({
    squares: z.number().min(0.25).max(16),
    colors: z.array(colour).min(1).max(24),
    showHpToPlayers: z.boolean(),
  }),

  content: z
    .object({
      creatures: z.array(z.object({ id: identifier, name: label, data: z.record(z.string(), z.unknown()) })).optional(),
      spells: z.array(z.object({ id: identifier, name: label, data: z.record(z.string(), z.unknown()) })).optional(),
      equipment: z.array(z.object({ id: identifier, name: label, data: z.record(z.string(), z.unknown()) })).optional(),
    })
    .optional(),
})

export class PackError extends Error {}

/**
 * Validates a pack, naming what is wrong and where.
 *
 * Throws rather than returning a result: a pack that does not validate cannot
 * be rendered, so there is nothing sensible for a caller to do with a partial
 * one.
 */
export function validatePack(value: unknown): RulesetPack {
  const result = packSchema.safeParse(value)
  if (!result.success) {
    const where = result.error.issues
      .slice(0, 5)
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    const id = (value as { id?: unknown })?.id
    throw new PackError(`The ruleset pack ${typeof id === 'string' ? `"${id}"` : ''} is not valid:\n${where}`)
  }

  // Keys have to be unique or a sheet silently overwrites its own fields.
  const seen = new Set<string>()
  for (const section of result.data.sheet.sections) {
    for (const key of fieldKeys(section.fields as { key: string; fields?: unknown }[])) {
      if (seen.has(key)) throw new PackError(`The pack "${result.data.id}" uses the field key "${key}" twice`)
      seen.add(key)
    }
  }

  return result.data as RulesetPack
}

function* fieldKeys(fields: { key: string; fields?: unknown }[]): Generator<string> {
  for (const field of fields) {
    yield field.key
    // A repeater's rows are their own namespace, so its inner keys are not
    // compared against the sheet's.
  }
}
