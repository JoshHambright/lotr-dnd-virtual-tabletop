/**
 * The shape of an invite.
 *
 * Signing is each host's business — a Worker and a Node process do not agree
 * about crypto — so what is tested here is the part they have to agree on: what
 * gets signed, and what a token is allowed to look like coming back.
 */

import { describe, expect, it } from 'vitest'
import {
  formatInvite,
  identityFor,
  identityForInvite,
  inviteMessage,
  isInvitedIdentity,
  parseInvite,
} from '../src/state.js'

describe('inviteMessage', () => {
  it('binds the table, the epoch and the player', () => {
    const message = inviteMessage('ABCDE', 3, 'p1')
    expect(message).toContain('ABCDE')
    expect(message).toContain('3')
    expect(message).toContain('p1')
  })

  it('changes when any part of it changes, so nothing can be swapped', () => {
    const base = inviteMessage('ABCDE', 1, 'p1')
    expect(inviteMessage('FGHIJ', 1, 'p1')).not.toBe(base)
    expect(inviteMessage('ABCDE', 2, 'p1')).not.toBe(base)
    expect(inviteMessage('ABCDE', 1, 'p2')).not.toBe(base)
  })

  it('cannot be made ambiguous by a player id that looks like a separator', () => {
    // Two different players must never produce the same message, however their
    // ids are punctuated. `parseInvite` refuses such ids, and this is the
    // reason it does.
    expect(parseInvite('a:1:b.aaaaaaaaaaaaaaaa')).toBeNull()
  })
})

describe('parseInvite', () => {
  const valid = 'a1b2c3d4.' + 'x'.repeat(43)

  it('reads a well-formed token', () => {
    expect(parseInvite(valid)).toEqual({ playerId: 'a1b2c3d4', signature: 'x'.repeat(43) })
  })

  it('round-trips through formatInvite', () => {
    const invite = { playerId: 'abcd1234', signature: 'y'.repeat(43) }
    expect(parseInvite(formatInvite(invite))).toEqual(invite)
  })

  it('refuses a token with no signature', () => {
    expect(parseInvite('a1b2c3d4')).toBeNull()
    expect(parseInvite('a1b2c3d4.')).toBeNull()
  })

  it('refuses a token with no player', () => {
    expect(parseInvite('.' + 'x'.repeat(43))).toBeNull()
  })

  it('refuses characters that do not belong in an id or a URL', () => {
    for (const token of [
      'a b c d.' + 'x'.repeat(43),
      'a/b/c/d.' + 'x'.repeat(43),
      '<script>.' + 'x'.repeat(43),
      'a1b2c3d4.' + 'x'.repeat(20) + '/',
      'a1b2c3d4.' + 'x'.repeat(20) + '=',
    ]) {
      expect(parseInvite(token)).toBeNull()
    }
  })

  it('refuses a player id or signature that is absurdly short or long', () => {
    expect(parseInvite('ab.' + 'x'.repeat(43))).toBeNull()
    expect(parseInvite('a'.repeat(65) + '.' + 'x'.repeat(43))).toBeNull()
    expect(parseInvite('a1b2c3d4.xxx')).toBeNull()
    expect(parseInvite('a1b2c3d4.' + 'x'.repeat(129))).toBeNull()
  })

  it('refuses nothing at all', () => {
    expect(parseInvite('')).toBeNull()
    expect(parseInvite('.')).toBeNull()
  })
})

describe('identities', () => {
  it('keeps an invited id apart from a typed one', () => {
    // The whole point: a table that switches invites on must not find
    // yesterday's `name:sam` satisfying a check meant for a real invite.
    expect(identityForInvite('sam')).not.toBe(identityFor('sam'))
    expect(isInvitedIdentity(identityForInvite('sam'))).toBe(true)
    expect(isInvitedIdentity(identityFor('sam'))).toBe(false)
  })

  it('cannot be forged by typing a name that looks like a prefix', () => {
    // `identityFor` lowercases and prefixes, so a player calling themselves
    // "player:abc" becomes "name:player:abc" and owns nothing of anyone's.
    expect(isInvitedIdentity(identityFor('player:abc'))).toBe(false)
  })
})
