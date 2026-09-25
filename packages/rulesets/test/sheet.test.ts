/**
 * What a sheet computes, tested without rendering one.
 */

import { describe, expect, it } from 'vitest'
import { DiceError } from '@vtt/dice'
import { deriveSheet, formatModifier, resolveMacro } from '../src/sheet.js'
import { getPack } from '../src/registry.js'
import type { RulesetPack } from '../src/pack.js'

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
    expect(deriveSheet(pack, frodo()).derived.proficiency).toBe(3)
  })

  it('computes a modifier for every ability the pack declares', () => {
    const { abilities } = deriveSheet(pack, frodo())
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
    const { skills } = deriveSheet(pack, frodo())
    const by = (key: string) => skills.skillProficiency?.find((skill) => skill.key === key)

    // dex +3, proficiency 3.
    expect(by('stealth')?.modifier).toBe(9)
    expect(by('acrobatics')?.modifier).toBe(3)
    // wis +2, proficient once.
    expect(by('perception')?.modifier).toBe(5)
  })

  it('treats an empty sheet as zeroes rather than failing', () => {
    const sheet = deriveSheet(pack, {})
    expect(sheet.problems).toEqual([])
    expect(sheet.derived.proficiency).toBe(2)
    expect(sheet.abilities.abilities?.[0]?.modifier).toBe(-5)
  })

  it('clamps a rank the pack does not have, however it got stored', () => {
    const values = { ...frodo(), skillProficiency: { stealth: 99, nature: -4, history: 1.8 } }
    const { skills } = deriveSheet(pack, values)
    const by = (key: string) => skills.skillProficiency?.find((skill) => skill.key === key)

    expect(by('stealth')?.rank).toBe(2)
    expect(by('nature')?.rank).toBe(0)
    expect(by('history')?.rank).toBe(1)
  })

  it('ignores a value stored with the wrong shape', () => {
    const values = { ...frodo(), abilities: 'sixteen', skillProficiency: [1, 2, 3] }
    const sheet = deriveSheet(pack, values)
    expect(sheet.abilities.abilities?.every((ability) => ability.score === 0)).toBe(true)
    expect(sheet.problems).toEqual([])
  })

  it('reports a formula it cannot work out instead of throwing', () => {
    const broken = structuredClone(pack) as RulesetPack
    const identity = broken.sheet.sections[0]?.fields[3]
    if (identity?.kind === 'number') identity.derived = '1 / @level'

    const sheet = deriveSheet(broken, { level: 0 })
    expect(sheet.problems).toHaveLength(1)
    expect(sheet.problems[0]).toMatch(/divides by zero/)
    expect(sheet.derived.level).toBe(0)
  })

  it('resolves derived fields in declaration order, so a later one can use an earlier', () => {
    const { derived } = deriveSheet(pack, { level: 17 })
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

describe('formatModifier', () => {
  it('always shows a sign', () => {
    expect([formatModifier(3), formatModifier(0), formatModifier(-2)]).toEqual(['+3', '+0', '-2'])
  })
})
