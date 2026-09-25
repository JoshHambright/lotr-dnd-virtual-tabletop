import { describe, expect, it } from 'vitest'
import { DEFAULT_PACK_ID, PackNotFound, getPack, hasPack, listPacks, packIds } from '../src/registry.js'
import { evaluate } from '@vtt/formula'

describe('the pack registry', () => {
  it('ships lotr5e and defaults to it', () => {
    expect(packIds()).toContain('lotr5e')
    expect(hasPack(DEFAULT_PACK_ID)).toBe(true)
  })

  it('validates every pack it ships', () => {
    for (const id of packIds()) expect(getPack(id).id).toBe(id)
  })

  it('returns the same object twice rather than revalidating', () => {
    expect(getPack('lotr5e')).toBe(getPack('lotr5e'))
  })

  it('refuses an unknown id instead of quietly handing back the default', () => {
    expect(() => getPack('pathfinder')).toThrow(PackNotFound)
    expect(hasPack('pathfinder')).toBe(false)
  })

  it('lists enough to build a menu', () => {
    const [first] = listPacks()
    expect(first).toMatchObject({ id: 'lotr5e' })
    expect(first?.name).toBeTruthy()
    expect(first?.summary).toBeTruthy()
  })
})

describe('the lotr5e pack', () => {
  const pack = getPack('lotr5e')

  it('carries the Middle-earth layer, not just a 5e sheet', () => {
    const keys = pack.sheet.sections.flatMap((section) => section.fields.map((field) => field.key))
    expect(keys).toEqual(expect.arrayContaining(['shadow', 'shadowPath', 'hope', 'weary', 'miserable', 'valour']))
  })

  it('ships no rules text — conditions are labels only', () => {
    for (const condition of pack.conditions) expect(condition.description).toBeUndefined()
  })

  it('ships no bundled content, because the game it fits is not open', () => {
    expect(pack.content).toBeUndefined()
  })

  it('says in the app that it is unofficial', () => {
    expect(pack.licence.notice).toMatch(/unofficial/i)
    expect(pack.licence.compatibilityLogo).toBeUndefined()
  })

  it('carries the two rules the GM settled, as data rather than as code', () => {
    // Weary: a d20 of 1, 2 or 3 counts as 0 before modifiers.
    const weary = pack.dice.modifiers?.find((modifier) => modifier.id === 'weary')
    expect(weary?.effect).toEqual({ kind: 'treat-below-as', threshold: 3, value: 0 })
    expect(weary?.unverified).toBeUndefined()

    // Shadow path follows the Calling, and is offered rather than imposed.
    const shadowPath = pack.sheet.sections
      .flatMap((section) => section.fields)
      .find((field) => field.key === 'shadowPath')
    expect(shadowPath?.kind).toBe('select')
    if (shadowPath?.kind !== 'select') throw new Error('shadowPath is no longer a select')
    expect(shadowPath.suggest?.map).toEqual({
      Captain: 'Path of Ambition',
      Champion: 'Path of Wrath',
      Messenger: 'Path of Madness',
      Scholar: 'Path of Dark Secrets',
      'Treasure Hunter': 'Dragon-sickness',
      Warden: 'Path of Despair',
    })
    expect(shadowPath.suggest?.unverified).toBeUndefined()
    expect(shadowPath.allowCustom).toBe(true)
  })

  it('offers a path for every Calling it lists, so no Calling is left guessing', () => {
    const fields = pack.sheet.sections.flatMap((section) => section.fields)
    const calling = fields.find((field) => field.key === 'calling')
    const shadowPath = fields.find((field) => field.key === 'shadowPath')
    if (calling?.kind !== 'select' || shadowPath?.kind !== 'select') throw new Error('the fixture has moved')

    expect(Object.keys(shadowPath.suggest?.map ?? {}).sort()).toEqual([...calling.options].sort())
  })

  it('computes a 5e proficiency bonus from its own formula', () => {
    const identity = pack.sheet.sections.find((section) => section.id === 'identity')
    const proficiency = identity?.fields.find((field) => field.key === 'proficiency')
    const formula = proficiency?.kind === 'number' ? proficiency.derived : undefined
    expect(formula).toBeTruthy()

    const bonusAt = (level: number) => evaluate(formula as string, { level })
    expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(bonusAt)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6])
  })

  it('computes an ability modifier from its own formula', () => {
    const block = pack.sheet.sections
      .flatMap((section) => section.fields)
      .find((field) => field.kind === 'abilityBlock')
    expect(block?.kind).toBe('abilityBlock')
    const formula = block?.kind === 'abilityBlock' ? block.modifier : ''
    expect([1, 8, 10, 11, 15, 20].map((score) => evaluate(formula, { score }))).toEqual([-5, -1, 0, 0, 2, 5])
  })

  it('computes a skill modifier that respects proficiency rank', () => {
    const list = pack.sheet.sections.flatMap((section) => section.fields).find((field) => field.kind === 'skillList')
    const formula = list?.kind === 'skillList' ? list.modifier : ''
    expect(evaluate(formula, { mod: 3, rank: 0, proficiency: 3 })).toBe(3)
    expect(evaluate(formula, { mod: 3, rank: 1, proficiency: 3 })).toBe(6)
    expect(evaluate(formula, { mod: 3, rank: 2, proficiency: 3 })).toBe(9)
  })
})
