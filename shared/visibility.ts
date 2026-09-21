/**
 * Role filtering: what a player is sent, and what a player may change.
 *
 * This module is the whole reason the table is trustworthy. It runs on the
 * server. A player's browser is never sent a GM note, a staged scene, a
 * hidden token or a bestiary entry, so there is nothing to uncover in
 * devtools and no honour system holding the screen together.
 */

import type { Character, Op, Role, RoomState, Scene, Token } from './state.js'

export interface ActorContext {
  role: Role
  /** The display name the connection joined under. */
  name: string
}

// --- Projection: what a role may see ----------------------------------------

export function isTokenVisibleToPlayers(state: RoomState, token: Token | undefined): boolean {
  if (!token) return false
  if (token.hidden) return false
  return token.sceneId === state.activeSceneId
}

/** A scene with the GM's staging notes removed. */
export function sanitizeScene(scene: Scene): Scene {
  return { ...scene, gmNotes: '' }
}

/** A token with the GM's private links and concealed hit points removed. */
export function sanitizeToken(token: Token): Token {
  return {
    ...token,
    statBlockId: null,
    hp: token.showHpToPlayers ? token.hp : null,
    maxHp: token.showHpToPlayers ? token.maxHp : null,
  }
}

export function sanitizeCharacter(character: Character): Character {
  return { ...character, gmNotes: '' }
}

/**
 * The state as a player should receive it: the active scene only, its visible
 * tokens only, no bestiary, no encounters, no private rolls or whispers.
 */
export function projectStateForPlayer(state: RoomState): RoomState {
  const active = state.activeSceneId ? state.scenes[state.activeSceneId] : undefined

  const scenes: Record<string, Scene> = {}
  if (active) scenes[active.id] = sanitizeScene(active)

  const tokens: Record<string, Token> = {}
  for (const token of Object.values(state.tokens)) {
    if (isTokenVisibleToPlayers(state, token)) tokens[token.id] = sanitizeToken(token)
  }

  const characters: Record<string, Character> = {}
  for (const character of Object.values(state.characters)) {
    characters[character.id] = sanitizeCharacter(character)
  }

  return {
    settings: state.settings,
    scenes,
    activeSceneId: active ? active.id : null,
    tokens,
    characters,
    bestiary: {},
    encounters: {},
    rolls: state.rolls.filter((r) => r.visibility === 'public'),
    chat: state.chat.filter((m) => m.visibility === 'public'),
  }
}

export function projectState(state: RoomState, role: Role): RoomState {
  return role === 'gm' ? state : projectStateForPlayer(state)
}

// --- Projection: what a role is told changed --------------------------------

/**
 * Translates one applied operation into the operations a player's client
 * should receive, given the state either side of it.
 *
 * Most ops pass through or vanish, but two genuinely change shape. Switching
 * the active scene has to be expanded into "here is a scene you have never
 * seen, and its tokens"; revealing or concealing a token becomes a create or
 * a delete, because the player's copy never held it in the first place.
 */
export function projectOpForPlayer(op: Op, before: RoomState, after: RoomState): Op[] {
  switch (op.t) {
    case 'settings.update':
      return [op]

    case 'scene.setActive':
      return sceneSwitchOps(before, after)

    case 'scene.create':
      // A scene is staged by the GM until it is made active, so this is a no-op
      // for players; the switch that follows will deliver it.
      return []

    case 'scene.update': {
      if (op.id !== after.activeSceneId) return []
      const { gmNotes: _gmNotes, ...patch } = op.patch
      return Object.keys(patch).length ? [{ t: 'scene.update', id: op.id, patch }] : []
    }

    case 'scene.delete':
      return op.id === before.activeSceneId ? [op] : []

    case 'fog.paint':
    case 'fog.setAll':
    case 'fog.enable':
    case 'fog.resize':
      return op.sceneId === after.activeSceneId ? [op] : []

    case 'token.create':
      return isTokenVisibleToPlayers(after, after.tokens[op.token.id])
        ? [{ t: 'token.create', token: sanitizeToken(op.token) }]
        : []

    case 'token.move':
      return isTokenVisibleToPlayers(after, after.tokens[op.id]) ? [op] : []

    case 'token.update': {
      const wasVisible = isTokenVisibleToPlayers(before, before.tokens[op.id])
      const nowVisible = isTokenVisibleToPlayers(after, after.tokens[op.id])
      const token = after.tokens[op.id]

      if (!wasVisible && !nowVisible) return []
      if (!wasVisible && nowVisible && token) return [{ t: 'token.create', token: sanitizeToken(token) }]
      if (wasVisible && !nowVisible) return [{ t: 'token.delete', id: op.id }]
      if (!token) return []

      // Visible throughout: re-derive the patch from the sanitized token so a
      // concealed hit point total cannot slip through in a partial update.
      const sanitized = sanitizeToken(token)
      return [
        {
          t: 'token.update',
          id: op.id,
          patch: {
            x: sanitized.x,
            y: sanitized.y,
            squares: sanitized.squares,
            label: sanitized.label,
            color: sanitized.color,
            imageAssetId: sanitized.imageAssetId,
            characterId: sanitized.characterId,
            statBlockId: null,
            hp: sanitized.hp,
            maxHp: sanitized.maxHp,
            showHpToPlayers: sanitized.showHpToPlayers,
            conditions: sanitized.conditions,
            locked: sanitized.locked,
            hidden: false,
          },
        },
      ]
    }

    case 'token.delete':
      return isTokenVisibleToPlayers(before, before.tokens[op.id]) ? [op] : []

    case 'character.upsert':
      return [{ t: 'character.upsert', character: sanitizeCharacter(op.character) }]

    case 'character.delete':
      return [op]

    case 'statblock.upsert':
    case 'statblock.delete':
    case 'encounter.upsert':
    case 'encounter.delete':
      return []

    case 'roll.add':
      return op.roll.visibility === 'public' ? [op] : []

    case 'chat.add':
      return op.message.visibility === 'public' ? [op] : []
  }
}

/**
 * Tears down the scene a player was looking at and builds the new one. The old
 * scene is deleted last-but-one so a client never holds two at once.
 */
function sceneSwitchOps(before: RoomState, after: RoomState): Op[] {
  const ops: Op[] = []
  const previousId = before.activeSceneId
  const nextId = after.activeSceneId

  if (previousId === nextId) return ops
  if (previousId) ops.push({ t: 'scene.delete', id: previousId })

  if (nextId) {
    const scene = after.scenes[nextId]
    if (scene) {
      ops.push({ t: 'scene.create', scene: sanitizeScene(scene) })
      for (const token of Object.values(after.tokens)) {
        if (isTokenVisibleToPlayers(after, token)) {
          ops.push({ t: 'token.create', token: sanitizeToken(token) })
        }
      }
    }
  }

  ops.push({ t: 'scene.setActive', id: nextId })
  return ops
}

export function projectOp(op: Op, before: RoomState, after: RoomState, role: Role): Op[] {
  return role === 'gm' ? [op] : projectOpForPlayer(op, before, after)
}

// --- Authorization: what a role may do --------------------------------------

export type Authorization = { ok: true; op: Op } | { ok: false; reason: string }

const DENIED = (reason: string): Authorization => ({ ok: false, reason })

/**
 * Decides whether an incoming operation is allowed, and rewrites it where a
 * player may change some fields of a thing but not others. Returning a
 * rewritten op rather than a boolean means the caller cannot forget to
 * sanitize: whatever comes back is what gets applied.
 */
export function authorize(op: Op, state: RoomState, actor: ActorContext): Authorization {
  if (actor.role === 'gm') return { ok: true, op }

  switch (op.t) {
    case 'token.move': {
      const token = state.tokens[op.id]
      if (!isTokenVisibleToPlayers(state, token)) return DENIED('That token is not on the table')
      if (!canPlayerMove(state, token!, actor)) return DENIED('That token is not yours to move')
      return { ok: true, op }
    }

    case 'token.update': {
      const token = state.tokens[op.id]
      if (!isTokenVisibleToPlayers(state, token)) return DENIED('That token is not on the table')
      if (!canPlayerMove(state, token!, actor)) return DENIED('That token is not yours to change')
      // Players may mark damage and conditions. Everything else about a token
      // — what it is, whether it is hidden, what it is linked to — is the GM's.
      const patch: Op = {
        t: 'token.update',
        id: op.id,
        patch: {
          ...(op.patch.conditions !== undefined ? { conditions: op.patch.conditions } : {}),
          ...(op.patch.hp !== undefined && token!.showHpToPlayers ? { hp: op.patch.hp } : {}),
          ...(op.patch.x !== undefined ? { x: op.patch.x } : {}),
          ...(op.patch.y !== undefined ? { y: op.patch.y } : {}),
        },
      }
      return { ok: true, op: patch }
    }

    case 'token.create': {
      if (!state.settings.playersCanCreateTokens) return DENIED('The GM has not opened token creation')
      if (op.token.sceneId !== state.activeSceneId) return DENIED('That scene is not on the table')
      return {
        ok: true,
        op: {
          t: 'token.create',
          token: { ...op.token, hidden: false, statBlockId: null, locked: false },
        },
      }
    }

    case 'token.delete': {
      if (!state.settings.playersCanCreateTokens) return DENIED('The GM has not opened token creation')
      const token = state.tokens[op.id]
      if (!isTokenVisibleToPlayers(state, token)) return DENIED('That token is not on the table')
      if (token!.locked || token!.statBlockId) return DENIED('That token is the GM’s')
      return { ok: true, op }
    }

    case 'character.upsert': {
      const existing = state.characters[op.character.id]
      if (existing && existing.ownerName !== actor.name) return DENIED('That sheet belongs to someone else')
      // The owner is taken from the connection, never from the payload, and
      // the GM's private notes on the sheet are preserved untouched.
      return {
        ok: true,
        op: {
          t: 'character.upsert',
          character: {
            ...op.character,
            ownerName: existing ? existing.ownerName : actor.name,
            gmNotes: existing ? existing.gmNotes : '',
          },
        },
      }
    }

    case 'character.delete': {
      const existing = state.characters[op.id]
      if (!existing) return DENIED('No such sheet')
      if (existing.ownerName !== actor.name) return DENIED('That sheet belongs to someone else')
      return { ok: true, op }
    }

    default:
      return DENIED('Only the GM can do that')
  }
}

function canPlayerMove(state: RoomState, token: Token, actor: ActorContext): boolean {
  if (token.locked) return false
  if (state.settings.playersCanMoveAnyToken) return true
  const character = token.characterId ? state.characters[token.characterId] : undefined
  return character?.ownerName === actor.name
}
