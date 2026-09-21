/**
 * A table server running in the same tab as the client.
 *
 * It is not a mock: it calls the same `authorize`, `reduce`, `projectOp` and
 * dice roller the real server calls, over the same wire protocol. What it
 * leaves out is the network, storage and other people — so the demo shows real
 * behaviour rather than a mimed version of it.
 *
 * The one thing it adds is `setRole`, which lets a single viewer flip between
 * the GM's chair and a player's seat. That is the most useful thing to see,
 * because the difference is not a UI toggle: the player is genuinely sent less.
 */

import { identityFor, reduce } from '@vtt/core'
import type { Op, Presence, Role, RoomState } from '@vtt/core'
import { authorize, projectOp, projectState } from '@vtt/core'
import { roll as rollDice } from '@vtt/dice'
import type { RollMode } from '@vtt/dice'
import type { ClientMessage, ServerMessage } from '@vtt/protocol'
import type { Transport, TransportHandlers } from '../transport.js'

export class LoopbackTransport implements Transport {
  #handlers: TransportHandlers | null = null
  #role: Role = 'gm'
  #name = 'You'
  #seq = 0

  constructor(private room: RoomState) {}

  // --- Transport ------------------------------------------------------------

  open(handlers: TransportHandlers): void {
    this.#handlers = handlers
    // A tick of delay so the client sees a real connecting → open transition.
    setTimeout(() => {
      handlers.onOpen()
      this.#hello()
    }, 60)
  }

  send(raw: string): void {
    const message = JSON.parse(raw) as ClientMessage
    this.#handle(message)
  }

  close(): void {
    this.#handlers?.onClose()
    this.#handlers = null
  }

  // --- The demo's one addition ----------------------------------------------

  /** Reseat the viewer. The client is simply told hello again, as on a resync. */
  setRole(role: Role, name: string): void {
    this.#role = role
    this.#name = name
    this.#hello()
  }

  // --- Server behaviour ------------------------------------------------------

  #handle(message: ClientMessage): void {
    switch (message.k) {
      case 'ping':
        return this.#emit({ k: 'pong' })

      case 'resync':
        return this.#hello()

      case 'cursor':
        // Nobody else is here to see it.
        return

      case 'op':
        return this.#applyRequested(message.op)

      case 'roll':
        return this.#roll(message)

      case 'chat': {
        const visibility = message.visibility === 'gm' && this.#role === 'gm' ? 'gm' : 'public'
        return this.#apply([
          {
            t: 'chat.add',
            message: {
              id: crypto.randomUUID(),
              at: Date.now(),
              by: this.#name,
              text: message.text,
              visibility,
            },
          },
        ])
      }
    }
  }

  #applyRequested(op: Op): void {
    const decision = authorize(op, this.room, { role: this.#role, name: this.#name, id: identityFor(this.#name) })
    if (!decision.ok) {
      this.#emit({ k: 'error', message: decision.reason })
      return
    }
    this.#apply([decision.op])
  }

  #roll(message: Extract<ClientMessage, { k: 'roll' }>): void {
    const visibility = message.visibility === 'gm' && this.#role === 'gm' ? 'gm' : 'public'
    const mode: RollMode = message.mode === 'advantage' || message.mode === 'disadvantage' ? message.mode : 'normal'

    let result
    try {
      result = rollDice(message.expression, mode, secureRandom)
    } catch (error) {
      this.#emit({ k: 'error', message: error instanceof Error ? error.message : 'Not a dice expression' })
      return
    }

    this.#apply([
      {
        t: 'roll.add',
        roll: {
          id: crypto.randomUUID(),
          at: Date.now(),
          by: this.#name,
          label: message.label,
          result,
          visibility,
          seed: Math.floor(secureRandom() * 0xffffffff),
          ...(message.color ? { color: message.color } : {}),
        },
      },
    ])
  }

  /** Applies to the authoritative state, then tells the viewer what they may know. */
  #apply(ops: Op[]): void {
    const before = this.room
    let next = before
    for (const op of ops) next = reduce(next, op)
    this.room = next
    this.#seq += ops.length

    const projected: Op[] = []
    let stepBefore = before
    for (const op of ops) {
      const stepAfter = reduce(stepBefore, op)
      projected.push(...projectOp(op, stepBefore, stepAfter, this.#role))
      stepBefore = stepAfter
    }
    if (projected.length) this.#emit({ k: 'ops', seq: this.#seq, ops: projected })
  }

  #hello(): void {
    this.#emit({
      k: 'hello',
      protocol: 1,
      roomCode: 'DEMO',
      role: this.#role,
      connectionId: 'demo',
      name: this.#name,
      seq: this.#seq,
      state: projectState(this.room, this.#role),
      presence: this.#presence(),
    })
  }

  /** Enough seats to make the header look like a table rather than a test. */
  #presence(): Presence[] {
    return [
      { connectionId: 'demo', name: this.#name, role: this.#role, cursor: null },
      { connectionId: 'a', name: 'Sam', role: 'player', cursor: null },
      { connectionId: 'b', name: 'Merry', role: 'player', cursor: null },
    ]
  }

  #emit(message: ServerMessage): void {
    this.#handlers?.onMessage(JSON.stringify(message))
  }
}

function secureRandom(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0]! / 0x100000000
}
