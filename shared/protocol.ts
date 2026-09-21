/**
 * The wire protocol between a browser and the room's Durable Object.
 *
 * Clients send intents, not facts. A dice roll is a request; the server rolls
 * it. A token move is a request; the server checks it is yours to move. The
 * only thing a client ever states outright is where its cursor is.
 */

import type { Op, Presence, Role, RoomState } from './state.js'
import type { RollMode } from './dice.js'

export const PROTOCOL_VERSION = 1

export type ClientMessage =
  | { k: 'op'; op: Op }
  | {
      k: 'roll'
      expression: string
      label: string
      mode: RollMode
      visibility: 'public' | 'gm'
    }
  | { k: 'chat'; text: string; visibility: 'public' | 'gm' }
  | { k: 'cursor'; cursor: Presence['cursor'] }
  | { k: 'resync' }
  | { k: 'ping' }

export type ServerMessage =
  | {
      k: 'hello'
      protocol: number
      roomCode: string
      role: Role
      connectionId: string
      name: string
      seq: number
      state: RoomState
      presence: Presence[]
    }
  /** A batch of operations to apply in order. `seq` is the server's count after them. */
  | { k: 'ops'; seq: number; ops: Op[] }
  | { k: 'presence'; presence: Presence[] }
  | { k: 'cursor'; connectionId: string; cursor: Presence['cursor'] }
  | { k: 'error'; message: string }
  | { k: 'pong' }

/** Room codes are read aloud over Zoom, so no 0/O or 1/I/L to mishear. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateRoomCode(random: () => number = Math.random): string {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  }
  return code
}

export function normalizeRoomCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function isValidRoomCode(input: string): boolean {
  const code = normalizeRoomCode(input)
  return code.length >= 4 && code.length <= 12 && [...code].every((c) => CODE_ALPHABET.includes(c))
}

/** Long enough that guessing it is not worth anyone's evening. */
export function generateGmKey(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || typeof (value as { k?: unknown }).k !== 'string') return null
    return value as ClientMessage
  } catch {
    return null
  }
}

export type { Op, Presence, Role, RoomState, RollMode }
