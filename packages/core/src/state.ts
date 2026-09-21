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

export interface Character {
  id: string
  name: string
  /** Display name of the player who owns the sheet; the GM owns NPCs. */
  ownerName: string
  culture: string
  calling: string
  level: number
  abilities: Record<string, number>
  /** Skill key -> 0 none, 1 proficient, 2 expertise. */
  skillProficiency: Record<string, number>
  saveProficiency: Record<string, boolean>
  maxHp: number
  currentHp: number
  tempHp: number
  armourClass: number
  speed: number
  /** The Middle-earth layer. */
  shadow: number
  shadowPath: string
  hope: number
  maxHope: number
  weary: boolean
  miserable: boolean
  standardOfLiving: string
  patron: string
  journeyRole: string
  valour: number
  wisdom: number
  virtues: string
  rewards: string
  equipment: string
  treasure: string
  features: string
  notes: string
  /** GM-only annotations on a player's sheet. */
  gmNotes: string
  portraitAssetId: string | null
}

export interface StatBlock {
  id: string
  name: string
  kind: string
  armourClass: number
  maxHp: number
  speed: string
  abilities: Record<string, number>
  attributeLevel: number
  endurance: number
  might: number
  resolve: number
  hateOrDespair: number
  attacks: string
  specials: string
  notes: string
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
  /** When true any player may drag any unlocked token, not just their own. */
  playersCanMoveAnyToken: boolean
  /** When true players may add and delete tokens as well as move them. */
  playersCanCreateTokens: boolean
}

/**
 * Bumped whenever the shape of a stored room changes. Added before there is
 * any data worth migrating, because retrofitting a version field onto rooms
 * already on disk means guessing which shape each one is.
 */
export const ROOM_SCHEMA_VERSION = 1

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
    settings: { name, playersCanMoveAnyToken: true, playersCanCreateTokens: false },
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

export function newCharacter(id: string, name: string, ownerName: string): Character {
  return {
    id,
    name,
    ownerName,
    culture: '',
    calling: '',
    level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    skillProficiency: {},
    saveProficiency: {},
    maxHp: 10,
    currentHp: 10,
    tempHp: 0,
    armourClass: 10,
    speed: 30,
    shadow: 0,
    shadowPath: '',
    hope: 1,
    maxHope: 1,
    weary: false,
    miserable: false,
    standardOfLiving: '',
    patron: '',
    journeyRole: '',
    valour: 1,
    wisdom: 1,
    virtues: '',
    rewards: '',
    equipment: '',
    treasure: '',
    features: '',
    notes: '',
    gmNotes: '',
    portraitAssetId: null,
  }
}

export function newStatBlock(id: string, name: string): StatBlock {
  return {
    id,
    name,
    kind: 'Orc',
    armourClass: 12,
    maxHp: 11,
    speed: '30 ft.',
    abilities: { str: 12, dex: 12, con: 12, int: 8, wis: 9, cha: 7 },
    attributeLevel: 2,
    endurance: 11,
    might: 1,
    resolve: 1,
    hateOrDespair: 2,
    attacks: '',
    specials: '',
    notes: '',
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
  // No migrations yet — version 1 is the first schema. The next entry will be
  // `1: (room) => ...` when the shape first changes.
}
