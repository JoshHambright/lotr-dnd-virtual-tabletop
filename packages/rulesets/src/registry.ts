/**
 * The packs the app ships with.
 *
 * Statically imported rather than read from disk: the same registry has to work
 * in a browser bundle, in a Worker and in the Node server, and none of those
 * three agree about filesystems. `packages/rulesets/packs/<id>/` is still where
 * a pack lives — adding one is a file and a line here.
 *
 * Every pack is validated the first time it is asked for, and the result is
 * cached. A malformed pack therefore fails a test run, not a session.
 */

import { lotr5e } from '../packs/lotr5e/pack.js'
import type { RulesetPack } from './pack.js'
import { validatePack } from './validate.js'

const SHIPPED: Record<string, unknown> = {
  lotr5e,
}

/** The default when a table does not say. */
export const DEFAULT_PACK_ID = 'lotr5e'

const cache = new Map<string, RulesetPack>()

export function packIds(): string[] {
  return Object.keys(SHIPPED).sort()
}

/** Enough to populate a "which game?" menu without validating every pack. */
export function listPacks(): { id: string; name: string; summary: string }[] {
  return packIds().map((id) => {
    const pack = SHIPPED[id] as { name: string; summary: string }
    return { id, name: pack.name, summary: pack.summary }
  })
}

export function hasPack(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SHIPPED, id)
}

/**
 * Throws for an unknown id rather than falling back to the default: a table
 * silently switching rulesets is worse than a table that will not open.
 */
export function getPack(id: string): RulesetPack {
  const cached = cache.get(id)
  if (cached) return cached
  if (!hasPack(id)) {
    throw new PackNotFound(`There is no ruleset pack called "${id}". Shipped packs: ${packIds().join(', ')}.`)
  }
  const pack = validatePack(SHIPPED[id])
  cache.set(id, pack)
  return pack
}

export class PackNotFound extends Error {}
