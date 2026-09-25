/**
 * The validator earns its place by rejecting things, so most of this file is
 * malformed packs. Each starts from a pack known to be good and breaks exactly
 * one thing, which is what makes a failure here point at a cause.
 */

import { describe, expect, it } from 'vitest'
import { PackError, validatePack } from '../src/validate.js'
import { lotr5e } from '../packs/lotr5e/pack.js'

/** A deep clone, so a mutation in one case cannot leak into the next. */
function draft(): Record<string, unknown> {
  return structuredClone(lotr5e) as unknown as Record<string, unknown>
}

function sectionNamed(pack: Record<string, unknown>, id: string): Record<string, unknown> {
  const sheet = pack.sheet as { sections: Record<string, unknown>[] }
  const section = sheet.sections.find((candidate) => candidate.id === id)
  if (!section) throw new Error(`no section "${id}" — the fixture has moved`)
  return section
}

/**
 * Breaks one thing, by path. Walking a dotted path keeps the cases readable
 * without typing the shape of a pack that is deliberately malformed.
 */
function set(root: Record<string, unknown>, path: string, value: unknown): void {
  const steps = path.split('.')
  const last = steps.pop()
  if (last === undefined) throw new Error('empty path')
  let node: Record<string, unknown> = root
  for (const step of steps) {
    const next = node[step]
    if (next === null || typeof next !== 'object') throw new Error(`"${path}" does not exist — the fixture has moved`)
    node = next as Record<string, unknown>
  }
  node[last] = value
}

describe('validatePack', () => {
  it('accepts a pack that is right', () => {
    expect(validatePack(draft()).id).toBe('lotr5e')
  })

  it('rejects something that is not an object at all', () => {
    expect(() => validatePack(null)).toThrow(PackError)
    expect(() => validatePack('lotr5e')).toThrow(PackError)
    expect(() => validatePack([])).toThrow(PackError)
  })

  it('names the pack and the path when it fails', () => {
    const pack = draft()
    pack.version = 'one'
    expect(() => validatePack(pack)).toThrow(/"lotr5e"[\s\S]*version/)
  })

  it('requires a licence notice, because displaying one can be a condition of use', () => {
    const pack = draft()
    delete (pack.licence as Record<string, unknown>).notice
    expect(() => validatePack(pack)).toThrow(/notice/)
  })

  it('rejects a formula that does not parse', () => {
    const pack = draft()
    set(sectionNamed(pack, 'identity'), 'fields.4.derived', '2 + floor((@level - 1) / ')
    expect(() => validatePack(pack)).toThrow(PackError)
  })

  it('rejects a formula calling a function the grammar does not have', () => {
    const pack = draft()
    set(sectionNamed(pack, 'identity'), 'fields.4.derived', 'sqrt(@level)')
    expect(() => validatePack(pack)).toThrow(PackError)
  })

  it('rejects a duplicated field key', () => {
    const pack = draft()
    set(sectionNamed(pack, 'notes'), 'fields.0.key', 'patron')
    expect(() => validatePack(pack)).toThrow(/"patron" twice/)
  })

  it('allows a repeater to reuse a key, because its rows are their own namespace', () => {
    // 'name' is both the character's name and a column of the attacks table.
    expect(() => validatePack(draft())).not.toThrow()
  })

  it('rejects a skill governed by an ability the pack never declares', () => {
    const pack = draft()
    set(sectionNamed(pack, 'skills'), 'fields.0.skills.0.ability', 'luck')
    expect(() => validatePack(pack)).toThrow(/"luck", which is not an ability/)
  })

  it('rejects a roll modifier keyed to a field that does not exist', () => {
    const pack = draft()
    set(pack, 'dice.modifiers.0.whenField', 'exhausted')
    expect(() => validatePack(pack)).toThrow(/"exhausted"/)
  })

  it('rejects a suggestion drawn from a field that does not exist', () => {
    const pack = draft()
    set(sectionNamed(pack, 'shadow'), 'fields.1.suggest.fromKey', 'vocation')
    expect(() => validatePack(pack)).toThrow(/"vocation", which is not a field/)
  })

  it('rejects a suggestion whose value is not one of the options', () => {
    const pack = draft()
    set(sectionNamed(pack, 'shadow'), 'fields.1.suggest.map.Captain', 'Lure of Pizza')
    expect(() => validatePack(pack)).toThrow(/"Lure of Pizza"/)
  })

  it('rejects a suggestion keyed on a value the source field never offers', () => {
    const pack = draft()
    set(sectionNamed(pack, 'shadow'), 'fields.1.suggest.map.Burglar', 'Path of Ambition')
    expect(() => validatePack(pack)).toThrow(/"Burglar"/)
  })

  it('rejects a token colour that is not a colour', () => {
    const pack = draft()
    set(pack, 'tokenDefaults.colors', ['goldenrod'])
    expect(() => validatePack(pack)).toThrow(PackError)
  })

  it('rejects an advantage model it does not know how to roll', () => {
    const pack = draft()
    set(pack, 'dice.advantageModel', 'roll-twice-vibes')
    expect(() => validatePack(pack)).toThrow(PackError)
  })

  it('rejects a sheet with no sections', () => {
    const pack = draft()
    set(pack, 'sheet.sections', [])
    expect(() => validatePack(pack)).toThrow(PackError)
  })

  it('validates formulas nested inside a repeater', () => {
    const pack = draft()
    set(sectionNamed(pack, 'combat'), 'fields.4.fields.1.derived', '@bonus +')
    expect(() => validatePack(pack)).toThrow(PackError)
  })
})
