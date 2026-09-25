/**
 * Runtime validation for everything that arrives from a browser.
 *
 * The prototype cast incoming JSON straight to `ClientMessage` and trusted it.
 * Permissions were checked, shapes were not — so a player could send
 * `{ t: 'token.move', x: 'over there' }` and put a string where the reducer
 * expected a number. Authorization answers "may you do this"; these schemas
 * answer "is this even a thing", and both have to be asked.
 *
 * Parsing happens once, at the edge. Past this point the types are honest.
 */

import { z } from 'zod'
import type { ClientMessage } from './protocol.js'

const finite = z.number().finite()
/** Map coordinates and sizes; rejects NaN and Infinity, which break the canvas. */
const coordinate = finite.min(-1_000_000).max(1_000_000)
const id = z.string().min(1).max(200)
const shortText = z.string().max(200)
const longText = z.string().max(20_000)
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/)

const fogShape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('circle'), x: coordinate, y: coordinate, radius: finite.min(0).max(100_000) }),
  z.object({ kind: z.literal('rect'), x: coordinate, y: coordinate, width: coordinate, height: coordinate }),
  z.object({
    kind: z.literal('poly'),
    points: z
      .array(z.object({ x: coordinate, y: coordinate }))
      .min(3)
      .max(500),
  }),
])

const grid = z.object({
  size: finite.min(4).max(4000),
  offsetX: coordinate,
  offsetY: coordinate,
  visible: z.boolean(),
  snap: z.boolean(),
  unitsPerSquare: finite.min(0),
  unitLabel: z.string().max(12),
})

const fogMask = z.object({
  cell: finite.min(1).max(1024),
  cols: z.number().int().min(1).max(10_000),
  rows: z.number().int().min(1).max(10_000),
  runs: z.array(z.number().int().min(0)).max(200_000),
})

const scene = z.object({
  id,
  name: shortText,
  assetId: id.nullable(),
  width: finite.min(1).max(100_000),
  height: finite.min(1).max(100_000),
  grid,
  fog: z.object({ enabled: z.boolean(), mask: fogMask }),
  gmNotes: longText,
})

const token = z.object({
  id,
  sceneId: id,
  x: coordinate,
  y: coordinate,
  squares: finite.min(0.25).max(64),
  label: shortText,
  color: colour,
  imageAssetId: id.nullable(),
  hidden: z.boolean(),
  characterId: id.nullable(),
  statBlockId: id.nullable(),
  hp: finite.nullable(),
  maxHp: finite.nullable(),
  showHpToPlayers: z.boolean(),
  conditions: z.array(shortText).max(32),
  locked: z.boolean(),
})

/**
 * A sheet's values — a character's or a creature's.
 *
 * The app cannot know what a pack declares, so this validates *shape and size*
 * rather than meaning: the four shapes a field can store, bounded at every
 * level. That matters more than it sounds — the schema this replaces was a
 * `.passthrough()`, so any client could write unbounded arbitrary JSON into
 * room storage and every other browser would be sent it.
 *
 * A value the active pack does not recognise still validates. The renderer
 * ignores keys no field claims, and dropping them here would delete a sheet's
 * data the moment a table opened on a build with an older pack.
 */
const valueKey = z.string().min(1).max(64)
const scalar = z.union([z.string().max(20_000), finite, z.boolean(), z.null()])

/** abilityBlock scores, skillList ranks, and a track's { value, max }. */
const valueMap = z
  .record(valueKey, z.union([finite, z.boolean(), z.string().max(400)]))
  .refine((record) => Object.keys(record).length <= 200, 'has too many entries')

/** A repeater's rows: attacks, gear, powers. */
const valueRows = z
  .array(z.record(valueKey, scalar).refine((row) => Object.keys(row).length <= 40, 'has too many columns'))
  .max(200)

const sheetValues = z
  .record(valueKey, z.union([scalar, valueMap, valueRows]))
  .refine((values) => Object.keys(values).length <= 400, 'has too many fields')

const character = z.object({
  id,
  name: shortText,
  ownerName: shortText,
  ownerId: shortText,
  values: sheetValues,
  gmNotes: longText,
  portraitAssetId: id.nullable(),
})

const statBlock = z.object({
  id,
  name: shortText,
  values: sheetValues,
  color: colour,
  imageAssetId: id.nullable(),
})
const encounter = z.object({
  id,
  name: shortText,
  notes: longText,
  members: z.array(z.object({ statBlockId: id, count: z.number().int().min(1).max(100) })).max(100),
})

/** Only fields a client may legitimately send are accepted. */
const tokenPatch = token.partial().omit({ id: true, sceneId: true })
const scenePatch = scene.partial().omit({ id: true, fog: true })

export const opSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('settings.update'),
    patch: z
      .object({
        name: shortText,
        rulesetId: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z][a-z0-9-]*$/i),
        playersCanMoveAnyToken: z.boolean(),
        playersCanCreateTokens: z.boolean(),
      })
      .partial(),
  }),

  z.object({ t: z.literal('scene.create'), scene }),
  z.object({ t: z.literal('scene.update'), id, patch: scenePatch }),
  z.object({ t: z.literal('scene.delete'), id }),
  z.object({ t: z.literal('scene.setActive'), id: id.nullable() }),

  z.object({ t: z.literal('fog.paint'), sceneId: id, shape: fogShape, reveal: z.boolean() }),
  z.object({ t: z.literal('fog.setAll'), sceneId: id, revealed: z.boolean() }),
  z.object({ t: z.literal('fog.enable'), sceneId: id, enabled: z.boolean() }),
  z.object({ t: z.literal('fog.resize'), sceneId: id, cell: finite.min(1).max(1024) }),

  z.object({ t: z.literal('token.create'), token }),
  z.object({ t: z.literal('token.move'), id, x: coordinate, y: coordinate }),
  z.object({ t: z.literal('token.update'), id, patch: tokenPatch }),
  z.object({ t: z.literal('token.delete'), id }),

  z.object({ t: z.literal('character.upsert'), character }),
  z.object({ t: z.literal('character.delete'), id }),

  z.object({ t: z.literal('statblock.upsert'), statBlock }),
  z.object({ t: z.literal('statblock.delete'), id }),
  z.object({ t: z.literal('encounter.upsert'), encounter }),
  z.object({ t: z.literal('encounter.delete'), id }),

  // Rolls and chat messages are minted by the server, never accepted from a
  // client — a client asks with 'roll'/'chat' below. Listing them here would
  // let a player write their own entry into the log.
])

export const clientMessageSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('op'), op: opSchema }),
  z.object({
    k: z.literal('roll'),
    expression: z.string().min(1).max(120),
    label: z.string().max(80),
    mode: z.enum(['normal', 'advantage', 'disadvantage']),
    visibility: z.enum(['public', 'gm']),
    color: colour.optional(),
  }),
  z.object({
    k: z.literal('chat'),
    text: z.string().min(1).max(2000),
    visibility: z.enum(['public', 'gm']),
  }),
  z.object({
    k: z.literal('cursor'),
    cursor: z.object({ sceneId: id, x: coordinate, y: coordinate }).nullable(),
  }),
  z.object({ k: z.literal('resync') }),
  z.object({ k: z.literal('ping') }),
])

export type ValidatedClientMessage = z.infer<typeof clientMessageSchema>

/**
 * Parses and validates one frame. Returns null for anything malformed — a
 * client sending nonsense is not an exceptional condition, it is Tuesday.
 */
export function parseValidatedClientMessage(raw: string): ClientMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const result = clientMessageSchema.safeParse(value)
  return result.success ? (result.data as ClientMessage) : null
}
