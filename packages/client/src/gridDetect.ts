/**
 * Finding the grid that is already drawn on a map.
 *
 * Most battle maps have their grid printed on them. Asking someone to measure
 * it — even by dragging a box — is asking them to do work the picture already
 * did. This reads the lines back off the art.
 *
 * The method is a periodicity search, not line-finding. Grid lines show up as
 * a regular comb of edge energy when you sum the image's horizontal gradient
 * down each column, so the question becomes "what spacing and phase best
 * explain this comb", which is cheap and robust to a map whose lines are
 * faint, broken by furniture, or drawn in a colour close to the floor.
 *
 * Everything here is pure and works on a grayscale buffer, so it is testable
 * without a canvas.
 */

export interface Periodicity {
  period: number
  phase: number
  /**
   * How far the winning phase stands above the others, in standard deviations.
   *
   * Used to choose between spacings. Deliberately not normalized: its ceiling
   * rises with the number of phases, and that is the useful part. A grid at 50
   * concentrates just as completely at 25 or 12.5 — every line still lands on
   * one phase — so a normalized measure ties, and the tie has to be broken by
   * a rule. Raw, the wider spacing simply scores higher, because it had more
   * ways to be wrong and was not.
   */
  score: number

  /**
   * The same peak as a fraction of the most it could be, 0 to 1. Comparable
   * between spacings, so this is what confidence is read from — but it is the
   * measure that ties across sub-multiples, so it is not what selects.
   */
  concentration: number
}

export interface DetectedGrid {
  size: number
  offsetX: number
  offsetY: number
  /** Confidence, roughly 0 to 1. Below about 0.25 it is a guess, not a reading. */
  confidence: number
}

/**
 * Sums the absolute gradient along each axis.
 *
 * A vertical grid line is a column where brightness changes sharply from one
 * pixel to the next, all the way down — so summing |dx| per column makes every
 * vertical line a spike, wherever it sits and whatever it is drawn on.
 */
export function edgeProfiles(
  gray: Float32Array,
  width: number,
  height: number,
): { columns: Float32Array; rows: Float32Array } {
  const columns = new Float32Array(width)
  const rows = new Float32Array(height)

  for (let y = 0; y < height; y++) {
    const line = y * width
    for (let x = 1; x < width; x++) {
      const delta = Math.abs(gray[line + x]! - gray[line + x - 1]!)
      columns[x]! += delta
    }
  }

  for (let y = 1; y < height; y++) {
    const line = y * width
    const previous = (y - 1) * width
    let total = 0
    for (let x = 0; x < width; x++) total += Math.abs(gray[line + x]! - gray[previous + x]!)
    rows[y] = total
  }

  return { columns, rows }
}

/**
 * Removes slow variation, leaving only the sharp peaks.
 *
 * Without this, a map that is simply brighter on one side scores as a huge
 * low-frequency hump that drowns the comb we are looking for.
 */
export function highPass(signal: Float32Array, window = 31): Float32Array {
  const out = new Float32Array(signal.length)
  const half = Math.max(1, Math.floor(window / 2))
  let sum = 0
  for (let i = 0; i < Math.min(signal.length, half); i++) sum += signal[i]!

  for (let i = 0; i < signal.length; i++) {
    const entering = i + half
    const leaving = i - half - 1
    if (entering < signal.length) sum += signal[entering]!
    if (leaving >= 0) sum -= signal[leaving]!
    const count = Math.min(signal.length - 1, entering) - Math.max(0, leaving + 1) + 1
    const mean = sum / Math.max(1, count)
    // Only what rises above the local background is a line.
    out[i] = Math.max(0, signal[i]! - mean)
  }
  return out
}

/**
 * Finds the spacing and phase that best explain a comb of peaks.
 *
 * For each candidate spacing, every sample is folded into a bucket by its
 * position modulo that spacing. If the spacing is right, all the line peaks
 * land in the same bucket and it towers over the rest.
 */
export function detectPeriod(signal: Float32Array, minPeriod: number, maxPeriod: number): Periodicity | null {
  const length = signal.length
  if (length < minPeriod * MIN_REPEATS) return null

  // A spacing has to repeat several times across the image before it is
  // evidence of anything rather than an accident of framing.
  const largest = Math.min(maxPeriod, length / MIN_REPEATS)
  const candidates: Periodicity[] = []

  for (let period = minPeriod; period <= largest; period += 0.5) {
    // Spread each sample across the two phases it falls between, rather than
    // rounding it into one. Rounding leaves half-integer spacings with
    // lopsided bucket counts, and those artifacts score higher than the real
    // grid — a comb every 30px was being read as 187.5 purely because .5
    // spacings bin unevenly.
    const buckets = new Float32Array(Math.ceil(period))
    const counts = new Float32Array(buckets.length)
    for (let i = 0; i < length; i++) {
      const position = i % period
      const low = Math.floor(position)
      const fraction = position - low
      const a = low % buckets.length
      const b = (low + 1) % buckets.length
      const value = signal[i]!
      buckets[a]! += value * (1 - fraction)
      buckets[b]! += value * fraction
      counts[a]! += 1 - fraction
      counts[b]! += fraction
    }

    // Normalize by how many samples a phase *should* have caught, not how many
    // it did. Dividing by the actual count lets a bucket that happened to
    // collect a single bright pixel report the same energy as one that
    // collected fifty — which is how a meaningless spacing can outscore the
    // real grid.
    const expected = length / buckets.length
    const floor = expected * 0.5
    const means = new Float32Array(buckets.length)
    let best = 0
    let bestIndex = 0
    let total = 0
    for (let i = 0; i < buckets.length; i++) {
      // Divide by how many samples the phase actually caught, but never by
      // fewer than half what it should have: a bucket that collected one
      // bright pixel must not report the same energy as one that collected
      // fifty, and a uniform signal must come out uniform.
      const value = buckets[i]! / Math.max(counts[i]!, floor)
      means[i] = value
      total += value
      if (value > best) {
        best = value
        bestIndex = i
      }
    }
    if (buckets.length < 2) continue

    const mean = total / buckets.length
    let variance = 0
    for (const value of means) variance += (value - mean) * (value - mean)
    const deviation = Math.sqrt(variance / buckets.length)
    if (deviation <= 1e-6) continue

    // At twice the true spacing the lines fall alternately into two phases,
    // each about as hot as the other; at the true spacing there is one hot
    // phase and the rest are background. Scores barely separate the two — half
    // the peak but twice the phases to stand above — so the giveaway is the
    // runner-up. Neighbours are skipped because a one-pixel line always warms
    // the phase beside it.
    const gap = Math.max(2, Math.floor(buckets.length * 0.15))
    let runnerUp = 0
    for (let i = 0; i < buckets.length; i++) {
      const distance = Math.abs(i - bestIndex)
      const circular = Math.min(distance, buckets.length - distance)
      if (circular <= gap) continue
      const value = buckets[i]! / Math.max(counts[i]!, floor)
      if (value > runnerUp) runnerUp = value
    }
    if (best > 0 && runnerUp / best > MAX_RUNNER_UP) continue

    // One spike satisfies every spacing. A single dark border down the left
    // edge lands in phase 0 whatever the period, so it scores as a perfect
    // grid at every one of them — which is exactly what a gridless map with a
    // frame around it used to report. A grid is many lines, so the winning
    // phase has to be carried by many of them.
    const { lines, dominance } = supportFor(signal, period, bestIndex)
    if (lines < MIN_REPEATS || dominance > MAX_DOMINANCE) continue

    const ceiling = Math.sqrt(buckets.length - 1)
    const z = (best - mean) / deviation
    candidates.push({ period, phase: bestIndex, score: z, concentration: ceiling > 0 ? z / ceiling : 0 })
  }

  // Discard spacings whose peak is within the ordinary spread of a textured
  // image before choosing between the rest. Judging the field's best candidate
  // and then rejecting it would throw away a good answer sitting behind a
  // wide, diffuse one that happened to score a fraction higher.
  const credible = candidates.filter((c) => c.score >= MIN_SCORE && c.concentration >= MIN_CONCENTRATION)
  if (!credible.length) return null

  const strongest = credible.reduce((a, b) => (b.score > a.score ? b : a))

  // Multiples of the true spacing score the same, not worse: at 100 a grid of
  // 50 splits across two phases, but there are twice as many phases to stand
  // above, and the two effects cancel. Sub-multiples do lose — at 25 there are
  // half as many phases, so the peak has less to tower over. So among spacings
  // that score alike the smallest is the grid, and the ones below it have
  // already been ruled out by scoring worse.
  const answer = credible
    .filter((c) => c.score >= strongest.score * 0.96)
    .reduce((a, b) => (b.period < a.period ? b : a))

  return answer
}

/** Repeats of the spacing that must fit across the image. */
const MIN_REPEATS = 4
/** Standard deviations the winning phase must clear to count as a grid. */
const MIN_SCORE = 4.2
/** The most of a phase's energy a single line may contribute. */
const MAX_DOMINANCE = 0.6

/**
 * How hot a second, well-separated phase may be before the spacing is taken to
 * be a multiple of the real one rather than the real one.
 */
const MAX_RUNNER_UP = 0.45

/**
 * And the share of its possible peak it must reach, so noise cannot pass.
 *
 * Not near 1: a drawn line one pixel wide makes a gradient spike on entering
 * it and another on leaving, so even a perfectly clean map puts its energy in
 * two adjacent phases and tops out around 0.7.
 */
const MIN_CONCENTRATION = 0.35

/**
 * Measures how many distinct lines hold up a phase, and whether one of them is
 * doing all the work.
 */
function supportFor(signal: Float32Array, period: number, phase: number): { lines: number; dominance: number } {
  let total = 0
  let strongest = 0
  const contributions: number[] = []

  for (let position = phase; position < signal.length; position += period) {
    const value = signal[Math.round(position)] ?? 0
    contributions.push(value)
    total += value
    if (value > strongest) strongest = value
  }

  if (total <= 0) return { lines: 0, dominance: 1 }
  // A line counts if it carries a real share, not a rounding crumb.
  const lines = contributions.filter((value) => value >= strongest * 0.2).length
  return { lines, dominance: strongest / total }
}

export interface DetectOptions {
  /** Smallest and largest spacing to consider, in buffer pixels. */
  minPeriod?: number
  maxPeriod?: number
}

/**
 * Reads a square grid off a grayscale image.
 *
 * Both axes are searched independently and then reconciled: a grid is square,
 * so agreement between the two is itself evidence, and disagreement is a good
 * reason to report low confidence rather than a confident wrong answer.
 */
export function detectGrid(
  gray: Float32Array,
  width: number,
  height: number,
  options: DetectOptions = {},
): DetectedGrid | null {
  const minPeriod = options.minPeriod ?? 12
  const maxPeriod = options.maxPeriod ?? Math.max(minPeriod + 1, Math.floor(Math.min(width, height) / MIN_REPEATS))

  const { columns, rows } = edgeProfiles(gray, width, height)
  const horizontal = detectPeriod(highPass(columns), minPeriod, maxPeriod)
  const vertical = detectPeriod(highPass(rows), minPeriod, maxPeriod)
  if (!horizontal && !vertical) return null

  // With both axes, a square grid means they should agree.
  if (horizontal && vertical) {
    const agreement = Math.min(horizontal.period, vertical.period) / Math.max(horizontal.period, vertical.period)
    const size = agreement > 0.94 ? (horizontal.period + vertical.period) / 2 : horizontal.period
    const strength = Math.min(horizontal.concentration, vertical.concentration)
    return {
      size,
      offsetX: horizontal.phase % size,
      offsetY: vertical.phase % size,
      confidence: clamp01(((strength - MIN_CONCENTRATION) / 0.3) * (agreement > 0.94 ? 1 : 0.4)),
    }
  }

  const only = (horizontal ?? vertical)!
  return {
    size: only.period,
    offsetX: horizontal ? only.phase % only.period : 0,
    offsetY: vertical ? only.phase % only.period : 0,
    confidence: clamp01((only.concentration - MIN_CONCENTRATION) / 0.3) * 0.5,
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Pulls a grayscale buffer out of an image, downscaled for speed. */
export function grayscaleFrom(
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge = 1100,
): { gray: Float32Array; width: number; height: number; scale: number } | null {
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  context.drawImage(image, 0, 0, width, height)

  let pixels: ImageData
  try {
    pixels = context.getImageData(0, 0, width, height)
  } catch {
    // A cross-origin image taints the canvas. Ours are same-origin, but a
    // future adapter might not be, and a failed reading is not a crash.
    return null
  }

  const gray = new Float32Array(width * height)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * pixels.data[p]! + 0.587 * pixels.data[p + 1]! + 0.114 * pixels.data[p + 2]!
  }
  return { gray, width, height, scale }
}

/**
 * Reads the grid off a scene's map image, in scene coordinates.
 *
 * Detection runs on a downscaled copy for speed, so the spacing it finds is in
 * the smaller image's pixels and has to be scaled back out.
 */
export function detectGridInImage(
  image: CanvasImageSource,
  sceneWidth: number,
  sceneHeight: number,
): DetectedGrid | null {
  const sampled = grayscaleFrom(image, sceneWidth, sceneHeight)
  if (!sampled) return null

  const found = detectGrid(sampled.gray, sampled.width, sampled.height)
  if (!found) return null

  return {
    size: found.size / sampled.scale,
    offsetX: found.offsetX / sampled.scale,
    offsetY: found.offsetY / sampled.scale,
    confidence: found.confidence,
  }
}
