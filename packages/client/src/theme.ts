/**
 * Wearing a pack's clothes.
 *
 * A pack restyles the whole app by declaring custom properties; the client
 * writes them onto the root element and the cascade does the rest. No per-pack
 * stylesheet, no conditional class names in components — which is what makes a
 * fourth ruleset a new pack rather than a change to the app.
 *
 * `styles.css` still declares every property on `:root`. Those are the
 * fallback, not the truth: a pack that omits a token keeps the default rather
 * than rendering something with no colour at all.
 *
 * Pack data is treated as untrusted throughout. A pack is data today and a
 * GM-supplied one is a plausible future, and a theme value goes straight into
 * a CSS declaration — so a value that could close that declaration and open
 * something else is dropped, not escaped. Dropping keeps `styles.css` in
 * force; escaping would ship whatever was left after the escaping.
 */

import type { RulesetPack, ThemeTokens } from '@vtt/rulesets'

/** What a pack's theme comes to, ready to be written. */
export interface ResolvedTheme {
  /** Custom properties, keys already prefixed with `--`. */
  properties: Record<string, string>
  ruleset: string
  texture: Texture
  /** Tokens that were refused, for a test or a console to name. */
  rejected: string[]
}

export type Texture = 'flat' | 'parchment' | 'xerox'

const TEXTURES: Texture[] = ['flat', 'parchment', 'xerox']

/**
 * A custom property name a pack may declare.
 *
 * Restricted so that a crafted key cannot close its own declaration and start
 * a rule of its own — `--x: red; } body {` as a *key* is as dangerous as it is
 * as a value, and it is easy to guard only the half you thought of.
 */
const SAFE_KEY = /^[a-z][a-z0-9-]*$/i

/**
 * A value a pack may declare.
 *
 * An allowlist rather than a blacklist of dangerous characters: the set of
 * things a colour, a length or a font stack legitimately needs is small and
 * known, and the set of things a browser will do with a CSS value is neither.
 * Letters, digits, whitespace, and the punctuation of a font stack and a
 * colour function. No braces, no semicolons, no backslash escapes, no angle
 * brackets.
 *
 * Quotes *are* allowed, because a font stack genuinely needs them — a family
 * whose name has a space in it has to be quoted, and refusing that would mean
 * refusing the stack this app already ships. They have to balance (see
 * `quotesBalanced`), so a value cannot leave a string open for whatever comes
 * after it.
 */
const SAFE_VALUE = /^[a-z0-9\s#%.,()+*/_'"-]+$/i

/** Functions that fetch or evaluate something, whatever else is allowed. */
const FORBIDDEN = /\b(url|image|image-set|expression|element|attr|var)\s*\(/i

export function isSafeValue(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 200) return false
  if (!SAFE_VALUE.test(trimmed)) return false
  if (FORBIDDEN.test(trimmed)) return false
  if (!quotesBalanced(trimmed)) return false
  // A comment sequence could hide what follows it from the parser.
  return !trimmed.includes('/*') && !trimmed.includes('*/')
}

/**
 * Whether every quote in a value is closed.
 *
 * An unbalanced quote leaves a string open, and what a browser then does with
 * the rest depends on where the value ended up. Counting is enough here
 * because the characters that would make an open string dangerous — braces and
 * semicolons — are already refused.
 */
function quotesBalanced(value: string): boolean {
  const singles = (value.match(/'/g) ?? []).length
  const doubles = (value.match(/"/g) ?? []).length
  return singles % 2 === 0 && doubles % 2 === 0
}

/**
 * Works out what a pack's theme means, without touching the document.
 *
 * Kept separate from applying it so the interesting half — which tokens
 * survive, and under what names — is testable without a DOM.
 */
export function resolveTheme(pack: RulesetPack): ResolvedTheme {
  const theme: ThemeTokens = pack.theme
  const properties: Record<string, string> = {}
  const rejected: string[] = []

  const take = (key: string, value: unknown): void => {
    if (!SAFE_KEY.test(key) || !isSafeValue(value)) {
      rejected.push(key)
      return
    }
    properties[`--${key}`] = value.trim()
  }

  for (const [key, value] of Object.entries(theme.colors ?? {})) take(key, value)

  // The stylesheet's own names, so a pack describes fonts by role rather than
  // having to know what the app calls them.
  take('serif', theme.fonts?.display)
  take('sans', theme.fonts?.body)
  take('mono', theme.fonts?.mono)
  take('radius', theme.radius)

  const texture: Texture = TEXTURES.includes(theme.texture as Texture) ? (theme.texture as Texture) : 'flat'
  const ruleset = SAFE_KEY.test(pack.id) ? pack.id : 'unknown'

  return { properties, ruleset, texture, rejected }
}

/**
 * Writes a resolved theme onto an element, and takes back anything a previous
 * pack left behind.
 *
 * Removing first matters: a pack that declares fewer colours than the last one
 * would otherwise inherit the difference, and the app would wear half of each.
 */
export function applyTheme(pack: RulesetPack, root: HTMLElement): ResolvedTheme {
  const resolved = resolveTheme(pack)

  for (const name of readApplied(root)) root.style.removeProperty(name)

  for (const [name, value] of Object.entries(resolved.properties)) root.style.setProperty(name, value)

  root.dataset.ruleset = resolved.ruleset
  root.dataset.texture = resolved.texture
  root.dataset.themed = Object.keys(resolved.properties).join(' ')

  return resolved
}

/** Which properties this module set last time, so it can unset them. */
function readApplied(root: HTMLElement): string[] {
  const previous = root.dataset.themed
  return previous ? previous.split(' ').filter(Boolean) : []
}
