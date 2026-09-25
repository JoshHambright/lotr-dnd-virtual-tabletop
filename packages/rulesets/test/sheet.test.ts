/**
 * What a sheet computes, tested without rendering one.
 */

import { describe, expect, it } from 'vitest'
import { DiceError } from '@vtt/dice'
import { roll } from '@vtt/dice'
import {
  activeModifiers,
  applyRollModifiers,
  deriveSheet,
  formatModifier,
  modifierBonus,
  resolveMacro,
} from '../src/sheet.js'
import { getPack } from '../src/registry.js'
import type { DiceProfile, RollModifier, RulesetPack } from '../src/pack.js'

const pack = getPack('lotr5e')

/** A sheet mid-campaign: level 5, a good dexterity, expertise in stealth. */
function frodo(): Record<string, unknown> {
  return {
    level: 5,
    abilities: { str: 8, dex: 16, con: 12, int: 13, wis: 14, cha: 11 },
    skillProficiency: { stealth: 2, perception: 1 },
    hp: { value: 24, max: 31 },
    hope: { value: 2, max: 3 },
    weary: false,
  }
}

describe('deriveSheet', () => {
  it('computes proficiency from level', () => {
    expect(deriveSheet(pack.sheet, frodo()).derived.proficiency).toBe(3)
  })

  it('computes a modifier for every ability the pack declares', () => {
    const { abilities } = deriveSheet(pack.sheet, frodo())
    expect(abilities.abilities?.map((ability) => [ability.key, ability.modifier])).toEqual([
      ['str', -1],
      ['dex', 3],
      ['con', 1],
      ['int', 1],
      ['wis', 2],
      ['cha', 0],
    ])
  })

  it('adds proficiency to a skill once, and expertise twice', () => {
    const { skills } = deriveSheet(pack.sheet, frodo())
    const by = (key: string) => skills.skillProficiency?.find((skill) => skill.key === key)

    // dex +3, proficiency 3.
    expect(by('stealth')?.modifier).toBe(9)
    expect(by('acrobatics')?.modifier).toBe(3)
    // wis +2, proficient once.
    expect(by('perception')?.modifier).toBe(5)
  })

  it('treats an empty sheet as zeroes rather than failing', () => {
    const sheet = deriveSheet(pack.sheet, {})
    expect(sheet.problems).toEqual([])
    expect(sheet.derived.proficiency).toBe(2)
    expect(sheet.abilities.abilities?.[0]?.modifier).toBe(-5)
  })

  it('clamps a rank the pack does not have, however it got stored', () => {
    const values = { ...frodo(), skillProficiency: { stealth: 99, nature: -4, history: 1.8 } }
    const { skills } = deriveSheet(pack.sheet, values)
    const by = (key: string) => skills.skillProficiency?.find((skill) => skill.key === key)

    expect(by('stealth')?.rank).toBe(2)
    expect(by('nature')?.rank).toBe(0)
    expect(by('history')?.rank).toBe(1)
  })

  it('ignores a value stored with the wrong shape', () => {
    const values = { ...frodo(), abilities: 'sixteen', skillProficiency: [1, 2, 3] }
    const sheet = deriveSheet(pack.sheet, values)
    expect(sheet.abilities.abilities?.every((ability) => ability.score === 0)).toBe(true)
    expect(sheet.problems).toEqual([])
  })

  it('reports a formula it cannot work out instead of throwing', () => {
    const broken = structuredClone(pack) as RulesetPack
    const identity = broken.sheet.sections[0]?.fields[3]
    if (identity?.kind === 'number') identity.derived = '1 / @level'

    const sheet = deriveSheet(broken.sheet, { level: 0 })
    expect(sheet.problems).toHaveLength(1)
    expect(sheet.problems[0]).toMatch(/divides by zero/)
    expect(sheet.derived.level).toBe(0)
  })

  it('resolves derived fields in declaration order, so a later one can use an earlier', () => {
    const { derived } = deriveSheet(pack.sheet, { level: 17 })
    expect(derived.proficiency).toBe(6)
  })
})

describe('resolveMacro', () => {
  it('fills a reference in', () => {
    expect(resolveMacro('1d20 + @total', { total: 5 })).toBe('1d20+5')
  })

  it('folds a negative modifier into a subtraction the dice parser accepts', () => {
    expect(resolveMacro('1d20 + @total', { total: -1 })).toBe('1d20-1')
  })

  it('folds a double negative back to a plus', () => {
    expect(resolveMacro('1d20 - @total', { total: -2 })).toBe('1d20+2')
  })

  it('drops a modifier that came out as nothing', () => {
    expect(resolveMacro('1d20 + @total', { total: 0 })).toBe('1d20')
  })

  it('leaves a die count alone while dropping a zero modifier', () => {
    expect(resolveMacro('2d6 + @total', { total: 0 })).toBe('2d6')
    expect(resolveMacro('1d10 + @total', { total: 10 })).toBe('1d10+10')
  })

  it('treats a reference to nothing as zero rather than leaving @ in the roll', () => {
    expect(resolveMacro('1d20 + @nowhere', {})).toBe('1d20')
  })

  it('follows a dotted path', () => {
    expect(resolveMacro('1d20 + @abilities.dex', { abilities: { dex: 4 } })).toBe('1d20+4')
  })

  it('takes a macro object as readily as a string', () => {
    expect(resolveMacro({ label: 'check', expression: '1d20 + @total' }, { total: 2 })).toBe('1d20+2')
  })

  it('refuses a macro that fills in to nonsense, rather than sending it to be rolled', () => {
    expect(() => resolveMacro('1d20 @total', { total: 3 })).toThrow(DiceError)
  })

  it('rolls every macro the shipped pack declares', () => {
    const scope = { total: -1, bonus: 2 }
    for (const section of pack.sheet.sections) {
      for (const field of section.fields) {
        const macro = 'roll' in field ? field.roll : undefined
        if (macro) expect(() => resolveMacro(macro, scope)).not.toThrow()
      }
    }
  })
})

describe('roll modifiers', () => {
  const weary = pack.dice.modifiers?.[0] as RollModifier

  const modifier = (effect: RollModifier['effect'], id = 'test'): RollModifier => ({
    id,
    label: id,
    whenField: id,
    effect,
  })

  it('switches a pack modifier on from the field it names', () => {
    expect(activeModifiers(pack, frodo())).toEqual([])
    expect(activeModifiers(pack, { ...frodo(), weary: true })).toEqual([weary])
  })

  it('sums only the modifiers a plain plus can express', () => {
    const modifiers = [modifier({ kind: 'bonus', value: 2 }), weary, modifier({ kind: 'bonus', value: -1 })]
    expect(modifierBonus(modifiers)).toBe(1)
    expect(modifierBonus([weary])).toBe(0)
  })

  it('writes Weary into the expression rather than into a number', () => {
    expect(applyRollModifiers('1d20+9', pack.dice, [weary])).toBe('1d20t3a0+9')
  })

  it('writes a reroll in the same way', () => {
    const lucky = modifier({ kind: 'reroll-at-or-below', threshold: 1 })
    expect(applyRollModifiers('1d20+3', pack.dice, [lucky])).toBe('1d20r1+3')
  })

  it('leaves an expression alone when nothing per-die is active', () => {
    expect(applyRollModifiers('1d20+9', pack.dice, [])).toBe('1d20+9')
    expect(applyRollModifiers('1d20+9', pack.dice, [modifier({ kind: 'bonus', value: 2 })])).toBe('1d20+9')
  })

  // Weary is a rule about the check die. A damage roll sharing the expression
  // is not a check, and flooring its dice would be inventing a rule.
  it('touches the profile die and leaves other dice alone', () => {
    expect(applyRollModifiers('1d20+2d6+4', pack.dice, [weary])).toBe('1d20t3a0+2d6+4')
    expect(applyRollModifiers('2d6+4', pack.dice, [weary])).toBe('2d6+4')
  })

  it('refuses a threshold the die cannot express instead of sending it to be rolled', () => {
    const absurd = modifier({ kind: 'treat-below-as', threshold: 20, value: 0 })
    expect(() => applyRollModifiers('1d20', pack.dice, [absurd])).toThrow()
  })

  it('produces something the server can actually roll', () => {
    const expression = applyRollModifiers(resolveMacro('1d20 + @total', { total: 9 }), pack.dice, [weary])
    const result = roll(expression, 'normal', () => 0)
    // Every face is a 1, so Weary counts it as 0 and only the +9 survives.
    expect(result.total).toBe(9)
  })

  it('carries the floor through a macro that already keeps dice', () => {
    const profile: DiceProfile = { ...pack.dice, defaultDie: 6 }
    expect(applyRollModifiers('4d6kh3', profile, [weary])).toBe('4d6kh3t3a0')
  })
})

describe('formatModifier', () => {
  it('always shows a sign', () => {
    expect([formatModifier(3), formatModifier(0), formatModifier(-2)]).toEqual(['+3', '+0', '-2'])
  })
})
