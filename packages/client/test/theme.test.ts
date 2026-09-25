/**
 * A pack's theme, before it reaches a stylesheet.
 *
 * Most of this file is about refusing things. A theme value goes straight into
 * a CSS declaration, a pack is data, and a GM-supplied pack is a plausible
 * future — so the interesting question is not whether a good pack renders but
 * whether a bad one can reach past its own declaration.
 */

import { describe, expect, it } from 'vitest'
import { getPack } from '@vtt/rulesets'
import type { RulesetPack } from '@vtt/rulesets'
import { isSafeValue, resolveTheme } from '../src/theme.js'

const lotr5e = getPack('lotr5e')

function themed(theme: Partial<RulesetPack['theme']>): RulesetPack {
  return { ...lotr5e, theme: { ...lotr5e.theme, ...theme } } as RulesetPack
}

describe('resolveTheme', () => {
  it('turns a pack’s colours into custom properties under the app’s own names', () => {
    const { properties } = resolveTheme(lotr5e)
    expect(properties['--ink']).toBe(lotr5e.theme.colors.ink)
    expect(properties['--accent']).toBe(lotr5e.theme.colors.accent)
    expect(properties['--line-soft']).toBe(lotr5e.theme.colors['line-soft'])
  })

  it('maps fonts by role, so a pack need not know what the stylesheet calls them', () => {
    const { properties } = resolveTheme(lotr5e)
    expect(properties['--serif']).toBe(lotr5e.theme.fonts.display)
    expect(properties['--sans']).toBe(lotr5e.theme.fonts.body)
    expect(properties['--mono']).toBe(lotr5e.theme.fonts.mono)
  })

  it('carries the radius and the texture', () => {
    const resolved = resolveTheme(lotr5e)
    expect(resolved.properties['--radius']).toBe(lotr5e.theme.radius)
    expect(resolved.texture).toBe('parchment')
    expect(resolved.ruleset).toBe('lotr5e')
  })

  it('rejects nothing in the pack we ship', () => {
    expect(resolveTheme(lotr5e).rejected).toEqual([])
  })

  it('falls back to a flat surface for a texture it does not know', () => {
    expect(resolveTheme(themed({ texture: 'holographic' as never })).texture).toBe('flat')
  })

  it('drops a value that would close its own declaration', () => {
    const attack = themed({ colors: { ...lotr5e.theme.colors, ink: '#fff; } body { display: none' } })
    const resolved = resolveTheme(attack)

    // Dropped, not escaped: what is left keeps the stylesheet's default, where
    // an escaped value would ship whatever survived the escaping.
    expect(resolved.properties['--ink']).toBeUndefined()
    expect(resolved.rejected).toContain('ink')
  })

  it('drops a key that would close its own declaration', () => {
    const attack = themed({ colors: { 'ink: red; } body { display: none; --x': '#fff' } })
    const resolved = resolveTheme(attack)
    expect(Object.keys(resolved.properties).every((name) => /^--[a-z][a-z0-9-]*$/i.test(name))).toBe(true)
    expect(resolved.rejected.length).toBeGreaterThan(0)
  })

  it('refuses a value that would fetch something', () => {
    for (const value of ['url(https://example.com/x.png)', 'URL("x")', 'image-set(x)', 'var(--secret)']) {
      expect(isSafeValue(value)).toBe(false)
    }
  })

  it('refuses braces, semicolons, backslashes, angle brackets and comment sequences', () => {
    for (const value of ['#fff}', '#fff;', '#fff{', '\\0031', '#fff/*', '*/red', '<script>']) {
      expect(isSafeValue(value)).toBe(false)
    }
  })

  it('allows a quoted font family, because one with a space in it needs quotes', () => {
    expect(isSafeValue('ui-serif, "Iowan Old Style", "Palatino Linotype", serif')).toBe(true)
    expect(isSafeValue("system-ui, 'Segoe UI', sans-serif")).toBe(true)
  })

  it('refuses a quote it never closes, which would leave a string hanging open', () => {
    expect(isSafeValue('ui-serif, "Iowan Old Style')).toBe(false)
    expect(isSafeValue("system-ui, 'Segoe UI")).toBe(false)
  })

  it('refuses a newline, which could carry a whole rule on its own', () => {
    expect(isSafeValue('#fff\n} body { display: none')).toBe(false)
  })

  it('accepts what a real theme actually needs', () => {
    for (const value of [
      '#c8a45c',
      'rgb(200 164 92 / 40%)',
      'color-mix(in srgb, #fff 20%, transparent)',
      '6px',
      'ui-serif, Georgia, Iowan Old Style, serif',
      '0.5rem 1rem',
    ]) {
      expect(isSafeValue(value)).toBe(true)
    }
  })

  it('refuses something that is not a string at all', () => {
    for (const value of [null, undefined, 42, {}, ['#fff']]) expect(isSafeValue(value)).toBe(false)
  })

  it('refuses an empty value and a preposterously long one', () => {
    expect(isSafeValue('   ')).toBe(false)
    expect(isSafeValue('a'.repeat(201))).toBe(false)
  })

  it('names an id it would not put in an attribute', () => {
    expect(resolveTheme({ ...lotr5e, id: 'evil" onload="x' } as RulesetPack).ruleset).toBe('unknown')
  })
})
