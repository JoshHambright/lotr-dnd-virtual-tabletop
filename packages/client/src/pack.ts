/**
 * Which pack a table is playing.
 *
 * `getPack` throws for an id it does not ship, which is right for a server
 * refusing to open a table and wrong for a browser that has already joined
 * one. Here the fallback is deliberate and visible: draw the default sheet and
 * say plainly that the table asked for something this build does not have,
 * rather than showing a blank panel.
 */

import type { RulesetPack } from '@vtt/rulesets'
import { DEFAULT_PACK_ID, getPack } from '@vtt/rulesets'

export interface ResolvedPack {
  pack: RulesetPack
  /** The id the table asked for, when this build could not supply it. */
  missing: string | null
}

export function packFor(rulesetId: string): ResolvedPack {
  try {
    return { pack: getPack(rulesetId), missing: null }
  } catch {
    return { pack: getPack(DEFAULT_PACK_ID), missing: rulesetId }
  }
}
