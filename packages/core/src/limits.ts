/**
 * What one connection is allowed to ask for.
 *
 * The table is about to live behind a public tunnel, where the URL is the only
 * thing standing between the game and whoever finds it. None of this stops a
 * determined attacker — it stops a stuck client, a runaway script and a bored
 * stranger from taking the session down, which is the failure that would
 * actually happen on a Tuesday evening.
 *
 * Two buckets, because the traffic is genuinely two kinds. Dragging a token
 * and moving a cursor are frequent, cheap and thrown away; a roll, a chat line
 * or a scene change is rare, costs a write, and goes in a log everyone reads.
 * One limit for both would either throttle a drag or wave through a thousand
 * chat messages a second.
 *
 * Pure and isomorphic on purpose: a Worker and a Node process disagree about
 * almost everything except arithmetic, and this is arithmetic. Both hosts use
 * it so that "what is allowed" has one answer.
 */

/** The cheap, frequent traffic: cursors and token drags. */
export const FAST_LIMIT = { perSecond: 50, burst: 100 } as const

/** Everything else: rolls, chat, and any structural change to the table. */
export const SLOW_LIMIT = { perSecond: 10, burst: 25 } as const

/**
 * How many people may be at one table.
 *
 * Far above any real group, and far below what it would take to exhaust a
 * server. It exists so that a link posted somewhere public cannot turn into a
 * thousand open sockets.
 */
export const MAX_SEATS = 24

export interface Limit {
  perSecond: number
  burst: number
}

/**
 * A token bucket.
 *
 * Chosen over a fixed window because a fixed window lets a client send its
 * whole allowance in the last millisecond of one window and again in the first
 * of the next — which is exactly the burst the limit was meant to prevent, and
 * exactly what a client retrying on a timer produces.
 */
export class TokenBucket {
  #tokens: number
  #last: number

  constructor(
    private readonly limit: Limit,
    now = Date.now(),
  ) {
    this.#tokens = limit.burst
    this.#last = now
  }

  /**
   * Takes one token if there is one, and says whether there was.
   *
   * `now` is passed in rather than read, so the behaviour over time is
   * testable without waiting for any.
   */
  take(now = Date.now()): boolean {
    // Refill first: a bucket only ever gains tokens by the passage of time.
    const elapsed = Math.max(0, now - this.#last) / 1000
    this.#last = now
    this.#tokens = Math.min(this.limit.burst, this.#tokens + elapsed * this.limit.perSecond)

    if (this.#tokens < 1) return false
    this.#tokens -= 1
    return true
  }

  /** What is left, for a test or a log line. */
  get available(): number {
    return this.#tokens
  }
}

/**
 * The two buckets one connection gets, and the rule for which applies.
 *
 * Kept together so a host cannot use one and forget the other, which would
 * leave the cheap path unlimited — the one that matters most, since it is the
 * one a client sends thirty times a second by design.
 */
export class ConnectionLimits {
  readonly fast: TokenBucket
  readonly slow: TokenBucket
  /**
   * When this connection was last told it was going too fast.
   *
   * Starts at negative infinity rather than zero so the *first* warning always
   * gets through. Zero looks harmless next to a `Date.now()` but is a real
   * timestamp, and a test that passed one straightened this out.
   */
  #warnedAt = Number.NEGATIVE_INFINITY

  constructor(now = Date.now()) {
    this.fast = new TokenBucket(FAST_LIMIT, now)
    this.slow = new TokenBucket(SLOW_LIMIT, now)
  }

  /** Whether a message of this kind may be handled now. */
  allow(kind: MessageCost, now = Date.now()): boolean {
    return (kind === 'fast' ? this.fast : this.slow).take(now)
  }

  /**
   * Whether to bother telling them.
   *
   * A client that is over the limit is usually over it for thousands of
   * messages, and an error for each is a second flood answering the first.
   */
  shouldWarn(now = Date.now()): boolean {
    if (now - this.#warnedAt < WARN_INTERVAL_MS) return false
    this.#warnedAt = now
    return true
  }
}

const WARN_INTERVAL_MS = 2000

export type MessageCost = 'fast' | 'slow'

/**
 * Which bucket a message draws from.
 *
 * A cursor and a token drag are the frequent, disposable ones. Everything else
 * — including a token being created or deleted, which look like drags and are
 * not — costs a write and goes in front of everyone.
 */
export function costOf(kind: string, opType?: string): MessageCost {
  if (kind === 'cursor' || kind === 'ping') return 'fast'
  if (kind === 'op' && opType === 'token.move') return 'fast'
  return 'slow'
}
