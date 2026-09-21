import { describe, expect, it } from 'vitest'
import {
  ABILITIES,
  CALLINGS,
  HEROIC_CULTURES,
  SHADOW_PATHS,
  SKILLS,
  abilityModifier,
  formatModifier,
  proficiencyBonus,
} from '@vtt/rulesets'

describe('abilityModifier', () => {
  it.each([
    [1, -5],
    [8, -1],
    [9, -1],
    [10, 0],
    [11, 0],
    [12, 1],
    [20, 5],
    [30, 10],
  ])('a score of %i gives %i', (score, expected) => {
    expect(abilityModifier(score)).toBe(expected)
  })

  it('rounds down for odd scores, including below ten', () => {
    expect(abilityModifier(7)).toBe(-2)
    expect(abilityModifier(13)).toBe(1)
  })
})

describe('proficiencyBonus', () => {
  it.each([
    [1, 2],
    [4, 2],
    [5, 3],
    [8, 3],
    [9, 4],
    [13, 5],
    [17, 6],
    [20, 6],
  ])('level %i gives %i', (level, expected) => {
    expect(proficiencyBonus(level)).toBe(expected)
  })

  it('clamps a level outside the table rather than extrapolating', () => {
    expect(proficiencyBonus(0)).toBe(2)
    expect(proficiencyBonus(-3)).toBe(2)
    expect(proficiencyBonus(99)).toBe(6)
  })
})

describe('formatModifier', () => {
  it('signs a modifier the way a sheet does', () => {
    expect(formatModifier(3)).toBe('+3')
    expect(formatModifier(0)).toBe('+0')
    expect(formatModifier(-2)).toBe('-2')
  })
})

describe('ruleset data', () => {
  it('has a Shadow path for every Calling', () => {
    for (const calling of CALLINGS) {
      expect(SHADOW_PATHS[calling], `no Shadow path for ${calling}`).toBeTruthy()
    }
  })

  it('has six Callings and six Heroic Cultures', () => {
    expect(CALLINGS).toHaveLength(6)
    expect(HEROIC_CULTURES).toHaveLength(6)
  })

  it('gives every skill an ability that exists', () => {
    for (const skill of SKILLS) {
      expect(ABILITIES).toContain(skill.ability)
    }
  })

  it('has no duplicate skill keys', () => {
    expect(new Set(SKILLS.map((s) => s.key)).size).toBe(SKILLS.length)
  })
})
