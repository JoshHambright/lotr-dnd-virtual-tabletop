/**
 * The shared table state, and the reducer that advances it.
 *
 * The same reducer runs on the server and in every browser. The server is the
 * authority: it validates an operation, applies it, then broadcasts it, and
 * clients apply the identical function to stay in step. Nothing is ever
 * applied optimistically on a client except token dragging, which is corrected
 * by the echo when it arrives.
 */

import type { FogMask, FogShape } from './fog.js'
import { createMask, paint, resize, setAll } from './fog.js'
import type { RollMode, RollResult } from '@vtt/dice'

export type Role = 'gm' | 'player'

// --- Entities ---------------------------------------------------------------

export interface Scene {
  id: string
  name: string
  /** Key of the uploaded image in the room's asset store; null for a blank battlemat. */
  assetId: string | null
  width: number
  height: number
  grid: {
    size: number
    offsetX: number
    offsetY: number
    visible: boolean
    snap: boolean
    /** Map units one grid square represents, for the measuring tool. */
    unitsPerSquare: number
    unitLabel: string
  }
  fog: {
    enabled: boolean
    mask: FogMask
  }
  /** GM-only staging notes for the scene. */
  gmNotes: string
}

export interface Token {
  id: string
  sceneId: string
  x: number
  y: number
  /** Size in grid squares. A troll is 2, a Nazgûl on horseback 2, a hobbit 1. */
  squares: number
  label: string
  color: string
  imageAssetId: string | null
  /** GM-only: a token staged but not yet revealed to the table. */
  hidden: boolean
  /** Set for a player character token; that player always controls it. */
  characterId: string | null
  /** GM-only link to a bestiary entry, so the GM can open the stat block. */
  statBlockId: string | null
  hp: number | null
  maxHp: number | null
  /** When false, players see the token but not its hit points. */
  showHpToPlayers: boolean
  conditions: string[]
  /** When true only the GM may move it, whatever the room setting says. */
  locked: boolean
}

/**
 * A sheet's value bag.
 *
 * The app does not know what a character *has*; the pack does. Keys are field
 * keys from the pack's `SheetSchema`, and the shape stored under each one is
 * fixed per field kind — see docs/RULESET_PACKS.md, "What a field stores".
 *
 * Deliberately not a union of every pack's shape: the whole point is that a
 * fourth ruleset is a new pack rather than a change to this file.
 */
export type CharacterValues = Record<string, unknown>

/**
 * A character sheet.
 *
 * Only the fields the *app* needs are named here — a name to put on a token, an
 * owner to check, a portrait, and the GM's private annotations. Everything the
 * game defines lives in `values`, keyed by the pack.
 */
export interface Character {
  id: string
  name: string
  /** Display name of the player who owns the sheet; the GM owns NPCs. */
  ownerName: string
  /**
   * Who owns the sheet, for permission checks.
   *
   * Today this is derived from the display name, so it carries no more
   * authority than the name does. It exists anyway so that every ownership
   * check reads an id: issuing real per-player tokens later changes how an id
   * is minted and nothing else. See `identityFor` and DECISIONS D-017.
   */
  ownerId: string
  /** Everything the ruleset defines. See `CharacterValues`. */
  values: CharacterValues
  /** GM-only annotations on a player's sheet. */
  gmNotes: string
  portraitAssetId: string | null
}

/**
 * A creature the GM can put on the map.
 *
 * Same shape of idea as `Character`: the app keeps only what *it* needs — a
 * name for the token, a colour, a picture — and everything the game defines
 * lives in `values`, keyed by the pack's `statBlock` schema.
 */
export interface StatBlock {
  id: string
  name: string
  /** Everything the ruleset defines. See `CharacterValues`. */
  values: CharacterValues
  color: string
  imageAssetId: string | null
}

export interface EncounterMember {
  statBlockId: string
  count: number
}

export interface Encounter {
  id: string
  name: string
  notes: string
  members: EncounterMember[]
}

export interface Roll {
  id: string
  at: number
  by: string
  label: string
  result: RollResult
  /** A gm roll is delivered only to the GM's own connections. */
  visibility: 'public' | 'gm'
  /**
   * The roller's chosen die colour, so everyone at the table sees the same
   * person's dice the same way. Cosmetic, and optional — an older client that
   * does not send one still rolls.
   */
  color?: string
  /** Shared seed so every client animates the same tumble. */
  seed: number
}

export interface ChatMessage {
  id: string
  at: number
  by: string
  text: string
  visibility: 'public' | 'gm'
}

export interface Presence {
  connectionId: string
  name: string
  role: Role
  /** Cursor position in map coordinates, for the live pointer. */
  cursor: { sceneId: string; x: number; y: number } | null
}

export interface RoomSettings {
  name: string
  /**
   * Which ruleset pack this table plays, by id.
   *
   * A plain string on purpose: core stays free of `@vtt/rulesets`, so a table
   * can record a pack that this build does not ship without the state layer
   * caring. Resolving an id to a pack is the app's job, not the reducer's.
   */
  rulesetId: string
  /** When true any player may drag any unlocked token, not just their own. */
  playersCanMoveAnyToken: boolean
  /** When true players may add and delete tokens as well as move them. */
  playersCanCreateTokens: boolean
}

/**
 * What a table plays when nobody has said.
 *
 * Deliberately duplicated rather than imported from `@vtt/rulesets`: core
 * knowing which packs exist is the dependency this whole indirection avoids.
 */
export const DEFAULT_RULESET_ID = 'lotr5e'

/**
 * Bumped whenever the shape of a stored room changes. Added before there is
 * any data worth migrating, because retrofitting a version field onto rooms
 * already on disk means guessing which shape each one is.
 */
export const ROOM_SCHEMA_VERSION = 5

export interface RoomState {
  /** The schema this room was written with. See `migrateRoom`. */
  schemaVersion: number
  settings: RoomSettings
  scenes: Record<string, Scene>
  /** The scene the players are looking at. The GM may be editing another. */
  activeSceneId: string | null
  tokens: Record<string, Token>
  characters: Record<string, Character>
  bestiary: Record<string, StatBlock>
  encounters: Record<string, Encounter>
  rolls: Roll[]
  chat: ChatMessage[]
}

export const MAX_LOG_ENTRIES = 200

export function emptyRoom(name = 'A new table'): RoomState {
  return {
    schemaVersion: ROOM_SCHEMA_VERSION,
    settings: { name, rulesetId: DEFAULT_RULESET_ID, playersCanMoveAnyToken: true, playersCanCreateTokens: false },
    scenes: {},
    activeSceneId: null,
    tokens: {},
    characters: {},
    bestiary: {},
    encounters: {},
    rolls: [],
    chat: [],
  }
}

// --- Operations -------------------------------------------------------------

export type Op =
  | { t: 'settings.update'; patch: Partial<RoomSettings> }
  | { t: 'scene.create'; scene: Scene }
  | { t: 'scene.update'; id: string; patch: Partial<Omit<Scene, 'id' | 'fog'>> }
  | { t: 'scene.delete'; id: string }
  | { t: 'scene.setActive'; id: string | null }
  | { t: 'fog.paint'; sceneId: string; shape: FogShape; reveal: boolean }
  | { t: 'fog.setAll'; sceneId: string; revealed: boolean }
  | { t: 'fog.enable'; sceneId: string; enabled: boolean }
  | { t: 'fog.resize'; sceneId: string; cell: number }
  | { t: 'token.create'; token: Token }
  | { t: 'token.move'; id: string; x: number; y: number }
  | { t: 'token.update'; id: string; patch: Partial<Omit<Token, 'id' | 'sceneId'>> }
  | { t: 'token.delete'; id: string }
  | { t: 'character.upsert'; character: Character }
  | { t: 'character.delete'; id: string }
  | { t: 'statblock.upsert'; statBlock: StatBlock }
  | { t: 'statblock.delete'; id: string }
  | { t: 'encounter.upsert'; encounter: Encounter }
  | { t: 'encounter.delete'; id: string }
  | { t: 'roll.add'; roll: Roll }
  | { t: 'chat.add'; message: ChatMessage }

/**
 * Applies one operation, returning a new state. Unknown ids are ignored rather
 * than throwing: a delete racing a move is normal traffic, not an error.
 */
export function reduce(state: RoomState, op: Op): RoomState {
  switch (op.t) {
    case 'settings.update':
      return { ...state, settings: { ...state.settings, ...op.patch } }

    case 'scene.create':
      return { ...state, scenes: { ...state.scenes, [op.scene.id]: op.scene } }

    case 'scene.update': {
      const scene = state.scenes[op.id]
      if (!scene) return state
      const next: Scene = { ...scene, ...op.patch, id: scene.id, fog: scene.fog }
      if (op.patch.grid) next.grid = { ...scene.grid, ...op.patch.grid }
      return { ...state, scenes: { ...state.scenes, [op.id]: next } }
    }

    case 'scene.delete': {
      if (!state.scenes[op.id]) return state
      const scenes = { ...state.scenes }
      delete scenes[op.id]
      const tokens = Object.fromEntries(Object.entries(state.tokens).filter(([, token]) => token.sceneId !== op.id))
      return {
        ...state,
        scenes,
        tokens,
        activeSceneId: state.activeSceneId === op.id ? null : state.activeSceneId,
      }
    }

    case 'scene.setActive':
      return { ...state, activeSceneId: op.id }

    case 'fog.paint': {
      const scene = state.scenes[op.sceneId]
      if (!scene) return state
      const mask = paint(scene.fog.mask, op.shape, op.reveal)
      return withFog(state, scene, { ...scene.fog, mask })
    }

    case 'fog.setAll': {
      const scene = state.scenes[op.sceneId]
      if (!scene) return state
      return withFog(state, scene, { ...scene.fog, mask: setAll(scene.fog.mask, op.revealed) })
    }

    case 'fog.enable': {
      const scene = state.scenes[op.sceneId]
      if (!scene) return state
      return withFog(state, scene, { ...scene.fog, enabled: op.enabled })
    }

    case 'fog.resize': {
      // Re-cut the mask at a new cell size, carrying over what is uncovered.
      // A scene patch cannot do this: the reducer deliberately refuses to let
      // a patch overwrite fog, so the mask can only change through fog ops.
      const scene = state.scenes[op.sceneId]
      if (!scene) return state
      const mask = resize(scene.fog.mask, scene.width, scene.height, op.cell)
      return withFog(state, scene, { ...scene.fog, mask })
    }

    case 'token.create':
      return { ...state, tokens: { ...state.tokens, [op.token.id]: op.token } }

    case 'token.move': {
      const token = state.tokens[op.id]
      if (!token) return state
      return { ...state, tokens: { ...state.tokens, [op.id]: { ...token, x: op.x, y: op.y } } }
    }

    case 'token.update': {
      const token = state.tokens[op.id]
      if (!token) return state
      const next: Token = { ...token, ...op.patch, id: token.id, sceneId: token.sceneId }
      return { ...state, tokens: { ...state.tokens, [op.id]: next } }
    }

    case 'token.delete': {
      if (!state.tokens[op.id]) return state
      const tokens = { ...state.tokens }
      delete tokens[op.id]
      return { ...state, tokens }
    }

    case 'character.upsert':
      return { ...state, characters: { ...state.characters, [op.character.id]: op.character } }

    case 'character.delete': {
      if (!state.characters[op.id]) return state
      const characters = { ...state.characters }
      delete characters[op.id]
      return { ...state, characters }
    }

    case 'statblock.upsert':
      return { ...state, bestiary: { ...state.bestiary, [op.statBlock.id]: op.statBlock } }

    case 'statblock.delete': {
      if (!state.bestiary[op.id]) return state
      const bestiary = { ...state.bestiary }
      delete bestiary[op.id]
      return { ...state, bestiary }
    }

    case 'encounter.upsert':
      return { ...state, encounters: { ...state.encounters, [op.encounter.id]: op.encounter } }

    case 'encounter.delete': {
      if (!state.encounters[op.id]) return state
      const encounters = { ...state.encounters }
      delete encounters[op.id]
      return { ...state, encounters }
    }

    case 'roll.add':
      return { ...state, rolls: appendCapped(state.rolls, op.roll) }

    case 'chat.add':
      return { ...state, chat: appendCapped(state.chat, op.message) }
  }
}

function withFog(state: RoomState, scene: Scene, fog: Scene['fog']): RoomState {
  return { ...state, scenes: { ...state.scenes, [scene.id]: { ...scene, fog } } }
}

function appendCapped<T>(list: T[], item: T): T[] {
  const next = [...list, item]
  return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next
}

// --- Construction helpers ---------------------------------------------------

export const TOKEN_COLORS = ['#c2703d', '#5b7f52', '#3f6b8f', '#8a4f6d', '#b8912f', '#6a5a8c', '#a33d3d', '#3f7f77']

export function newScene(id: string, name: string, width: number, height: number, assetId: string | null): Scene {
  return {
    id,
    name,
    assetId,
    width,
    height,
    grid: { size: 70, offsetX: 0, offsetY: 0, visible: true, snap: true, unitsPerSquare: 5, unitLabel: 'ft' },
    fog: { enabled: false, mask: createMask(width, height) },
    gmNotes: '',
  }
}

export function newToken(id: string, sceneId: string, x: number, y: number, overrides: Partial<Token> = {}): Token {
  return {
    id,
    sceneId,
    x,
    y,
    squares: 1,
    label: 'Token',
    color: TOKEN_COLORS[0]!,
    imageAssetId: null,
    hidden: false,
    characterId: null,
    statBlockId: null,
    hp: null,
    maxHp: null,
    showHpToPlayers: true,
    conditions: [],
    locked: false,
    ...overrides,
  }
}

/**
 * A blank sheet.
 *
 * Blank really is blank: the pack decides what a field starts at, and a core
 * that pre-filled six ability scores at 10 would be quietly asserting 5e.
 */
export function newCharacter(id: string, name: string, ownerName: string): Character {
  return {
    id,
    name,
    ownerName,
    ownerId: identityFor(ownerName),
    values: {},
    gmNotes: '',
    portraitAssetId: null,
  }
}

export function newStatBlock(id: string, name: string): StatBlock {
  return {
    id,
    name,
    values: {},
    // Adversaries default to a warning red so a creature dropped on the map is
    // never mistaken for somebody's character.
    color: '#a33d3d',
    imageAssetId: null,
  }
}

export type { RollMode }

/**
 * Brings a stored room up to the current schema.
 *
 * Migrations run in order and each one moves a room forward exactly one
 * version, so a room written by any past release reaches the present by
 * replaying the chain rather than by a special case per origin. A room with no
 * version at all predates versioning and is treated as version 1.
 *
 * Throws rather than guesses when a room is from the future: a server that has
 * been rolled back should refuse the data, not silently reinterpret it.
 */
export function migrateRoom(stored: unknown): RoomState {
  if (!stored || typeof stored !== 'object') {
    throw new Error('That table is not readable')
  }

  const room = stored as RoomState & { schemaVersion?: number }
  let version = typeof room.schemaVersion === 'number' ? room.schemaVersion : 1

  if (version > ROOM_SCHEMA_VERSION) {
    throw new Error(
      `That table was written by a newer version (schema ${version}; this server understands ${ROOM_SCHEMA_VERSION})`,
    )
  }

  let migrated: RoomState = { ...room, schemaVersion: version }
  while (version < ROOM_SCHEMA_VERSION) {
    const step = ROOM_MIGRATIONS[version]
    if (!step) throw new Error(`No migration from schema ${version}`)
    migrated = step(migrated)
    version += 1
    migrated.schemaVersion = version
  }

  return migrated
}

/** Keyed by the version each one migrates *from*. */
const ROOM_MIGRATIONS: Record<number, (room: RoomState) => RoomState> = {
  // Sheets gained an owner id. Derive it from the name they were owned by,
  // which is exactly what a name-based identity would have produced.
  1: (room) => ({
    ...room,
    characters: Object.fromEntries(
      Object.entries(room.characters).map(([id, character]) => [
        id,
        { ...character, ownerId: character.ownerId || identityFor(character.ownerName) },
      ]),
    ),
  }),

  // Tables gained a ruleset. Every table written before this one was playing
  // the Middle-earth sheet, because it was the only one there was.
  2: (room) => ({
    ...room,
    settings: { ...room.settings, rulesetId: room.settings.rulesetId || DEFAULT_RULESET_ID },
  }),

  // Sheets stopped being LotR-shaped and became a value bag the pack defines.
  // Every field is carried across under the key the `lotr5e` pack gives it, so
  // a campaign written against the old sheet opens with nothing missing.
  3: (room) => ({
    ...room,
    characters: Object.fromEntries(
      Object.entries(room.characters).map(([id, character]) => [id, toValueBag(character)]),
    ),
  }),

  // And then the bestiary followed. A GM's monsters are usually the part of a
  // campaign with the most work in them, so this carries every field across
  // rather than asking anyone to retype a stat block.
  4: (room) => ({
    ...room,
    bestiary: Object.fromEntries(
      Object.entries(room.bestiary).map(([id, statBlock]) => [id, toStatBlockBag(statBlock)]),
    ),
  }),
}

/** The old fixed stat block, in the one place that still needs to know it. */
function toStatBlockBag(stored: StatBlock): StatBlock {
  const old = stored as StatBlock & Record<string, unknown>
  if (old.values && typeof old.values === 'object') return stored

  const take = <T>(key: string, fallback: T): T => (old[key] === undefined ? fallback : (old[key] as T))
  return {
    id: stored.id,
    name: stored.name,
    values: {
      kind: take('kind', ''),
      armourClass: take('armourClass', 10),
      // Hit points become a track, the same as they did on the character sheet.
      // A stored stat block has only a maximum, which is also where it starts.
      hp: { value: take('maxHp', 0), max: take('maxHp', 0) },
      speed: take('speed', ''),
      abilities: take('abilities', {}),
      attributeLevel: take('attributeLevel', 0),
      might: take('might', 0),
      resolve: take('resolve', 0),
      hateOrDespair: take('hateOrDespair', 0),
      attacks: attacksToRows(take('attacks', '')),
      specials: take('specials', ''),
      notes: take('notes', ''),
    },
    color: take('color', '#a33d3d'),
    imageAssetId: take('imageAssetId', null),
  }
}

/**
 * Attacks were one free-text box and are now rows that roll.
 *
 * Each line becomes a row's name, and nothing is parsed out of it. Guessing a
 * to-hit bonus out of "Scimitar +4 (1d8+2)" would be wrong often enough to be
 * worse than leaving the GM to fill in a number they can see on the line in
 * front of them — and losing what they wrote would be worse still.
 */
function attacksToRows(text: string): Record<string, unknown>[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((line) => ({ name: line }))
}

/**
 * The one place that still knows the old LotR-shaped sheet.
 *
 * Kept deliberately explicit rather than looping over the leftover keys: two of
 * them change shape (hit points and Hope become tracks) and three are the app's
 * own, so a generic "move everything across" would get them wrong and only show
 * it at somebody's table.
 */
function toValueBag(stored: Character): Character {
  const old = stored as Character & Record<string, unknown>
  if (old.values && typeof old.values === 'object') return stored

  const take = <T>(key: string, fallback: T): T => (old[key] === undefined ? fallback : (old[key] as T))
  const values: CharacterValues = {
    culture: take('culture', ''),
    calling: take('calling', ''),
    level: take('level', 1),
    proficiency: 2 + Math.floor((Math.max(1, take('level', 1)) - 1) / 4),
    standardOfLiving: take('standardOfLiving', ''),
    patron: take('patron', ''),
    journeyRole: take('journeyRole', ''),
    abilities: take('abilities', {}),
    skillProficiency: take('skillProficiency', {}),
    hp: { value: take('currentHp', 0), max: take('maxHp', 0) },
    tempHp: take('tempHp', 0),
    armourClass: take('armourClass', 10),
    speed: take('speed', 30),
    attacks: [],
    hope: { value: take('hope', 0), max: take('maxHope', 0) },
    shadow: take('shadow', 0),
    shadowPath: take('shadowPath', ''),
    weary: take('weary', false),
    miserable: take('miserable', false),
    valour: take('valour', 0),
    wisdom: take('wisdom', 0),
    virtues: take('virtues', ''),
    rewards: take('rewards', ''),
    equipment: take('equipment', ''),
    treasure: take('treasure', ''),
    features: take('features', ''),
    notes: take('notes', ''),
  }

  return {
    id: stored.id,
    name: stored.name,
    ownerName: stored.ownerName,
    ownerId: stored.ownerId,
    values,
    gmNotes: take('gmNotes', ''),
    portraitAssetId: take('portraitAssetId', null),
  }
}

/**
 * Turns a display name into the id ownership is checked against.
 *
 * The single place a person becomes an identity. Case and surrounding
 * whitespace are ignored, so "sam " and "Sam" are the same player — which is
 * the behaviour a name-based scheme should have, and one fewer surprise when
 * someone retypes their name after a reconnect.
 *
 * Deliberately prefixed: when real tokens arrive they mint ids of a different
 * shape, and a stored `name:sam` must never be mistaken for one.
 */
export function identityFor(displayName: string): string {
  return `name:${displayName.trim().toLowerCase()}`
}
