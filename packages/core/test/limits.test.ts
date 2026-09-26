/**
 * What one connection is allowed to ask for.
 *
 * Time is passed in rather than waited for, so the behaviour over a minute is
 * testable in a millisecond — and so the awkward cases (a clock that goes
 * backwards, a gap of an hour) can be asked about at all.
 */

import { describe, expect, it } from 'vitest'
import { ConnectionLimits, FAST_LIMIT, SLOW_LIMIT, TokenBucket, costOf } from '../src/limits.js'

describe('TokenBucket', () => {
  it('starts full, so a burst at the start of a session is not punished', () => {
    const bucket = new TokenBucket({ perSecond: 10, burst: 25 }, 0)
    for (let i = 0; i < 25; i += 1) expect(bucket.take(0)).toBe(true)
    expect(bucket.take(0)).toBe(false)
  })

  it('refills at the rate it was given', () => {
    const bucket = new TokenBucket({ perSecond: 10, burst: 25 }, 0)
    while (bucket.take(0)) {
      /* drain */
    }

    expect(bucket.take(100)).toBe(true) // 0.1s buys one token
    expect(bucket.take(100)).toBe(false)
    expect(bucket.take(1000)).toBe(true) // a whole second buys ten
  })

  it('never refills past its burst, so idling does not bank a flood', () => {
    const bucket = new TokenBucket({ perSecond: 10, burst: 25 }, 0)
    // An hour away from the table.
    let allowed = 0
    for (let i = 0; i < 100; i += 1) if (bucket.take(3_600_000)) allowed += 1
    expect(allowed).toBe(25)
  })

  it('does not hand out tokens when the clock goes backwards', () => {
    // A system clock stepping back is not an allowance.
    const bucket = new TokenBucket({ perSecond: 10, burst: 3 }, 1000)
    expect(bucket.take(1000)).toBe(true)
    expect(bucket.take(1000)).toBe(true)
    expect(bucket.take(1000)).toBe(true)
    expect(bucket.take(0)).toBe(false)
    expect(bucket.take(0)).toBe(false)
  })

  it('lets a steady stream through for ever', () => {
    const bucket = new TokenBucket({ perSecond: 10, burst: 25 }, 0)
    let refused = 0
    // Ten a second for a minute is exactly the allowance.
    for (let i = 0; i < 600; i += 1) if (!bucket.take(i * 100)) refused += 1
    expect(refused).toBe(0)
  })

  it('refuses a stream that is twice the allowance, but only once the burst is spent', () => {
    const bucket = new TokenBucket({ perSecond: 10, burst: 25 }, 0)
    let allowed = 0
    for (let i = 0; i < 600; i += 1) if (bucket.take(i * 50)) allowed += 1
    // 30 seconds of traffic at 20/s: roughly 300 allowed plus the initial burst.
    expect(allowed).toBeGreaterThan(300)
    expect(allowed).toBeLessThan(340)
  })
})

describe('costOf', () => {
  it('calls the frequent, disposable traffic cheap', () => {
    expect(costOf('cursor')).toBe('fast')
    expect(costOf('ping')).toBe('fast')
    expect(costOf('op', 'token.move')).toBe('fast')
  })

  it('calls everything that costs a write or is seen by the table expensive', () => {
    for (const [kind, op] of [
      ['roll', undefined],
      ['chat', undefined],
      ['op', 'token.create'],
      ['op', 'token.delete'],
      ['op', 'scene.setActive'],
      ['op', 'fog.paint'],
      ['op', 'character.upsert'],
      ['op', 'settings.update'],
    ] as const) {
      expect(costOf(kind, op)).toBe('slow')
    }
  })

  it('does not take a token.move-shaped thing on trust', () => {
    // A creation dressed up as a move must not buy the cheap bucket.
    expect(costOf('op', 'token.create')).toBe('slow')
    expect(costOf('somethingelse', 'token.move')).toBe('slow')
  })
})

describe('ConnectionLimits', () => {
  it('keeps the two buckets apart, so a drag cannot starve a roll', () => {
    const limits = new ConnectionLimits(0)
    // Spend the whole fast allowance.
    for (let i = 0; i < FAST_LIMIT.burst; i += 1) expect(limits.allow('fast', 0)).toBe(true)
    expect(limits.allow('fast', 0)).toBe(false)
    // The slow bucket is untouched.
    expect(limits.allow('slow', 0)).toBe(true)
  })

  it('and a chat flood cannot stop the map moving', () => {
    const limits = new ConnectionLimits(0)
    for (let i = 0; i < SLOW_LIMIT.burst; i += 1) limits.allow('slow', 0)
    expect(limits.allow('slow', 0)).toBe(false)
    expect(limits.allow('fast', 0)).toBe(true)
  })

  it('allows a real token drag without complaint', () => {
    // The client throttles moves to roughly 25 a second; two tokens dragged at
    // once is 50, which is the whole point of the fast limit being 50.
    const limits = new ConnectionLimits(0)
    let refused = 0
    for (let i = 0; i < 500; i += 1) if (!limits.allow('fast', i * 20)) refused += 1
    expect(refused).toBe(0)
  })

  it('warns at most occasionally, so the answer to a flood is not a flood', () => {
    const limits = new ConnectionLimits(0)
    expect(limits.shouldWarn(0)).toBe(true)
    expect(limits.shouldWarn(1)).toBe(false)
    expect(limits.shouldWarn(1999)).toBe(false)
    expect(limits.shouldWarn(2000)).toBe(true)
  })
})
