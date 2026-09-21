import { describe, expect, it } from 'vitest'
import { detectGrid, detectPeriod, edgeProfiles, highPass } from '../src/gridDetect.js'

/**
 * Paints a synthetic battle map: a textured floor with a grid ruled over it.
 * `noise` stands in for the furniture, rubble and shading of real map art.
 */
function drawMap(options: {
  width: number
  height: number
  spacing: number
  offsetX?: number
  offsetY?: number
  contrast?: number
  noise?: number
  /** A brightness ramp, as a map lit from one side would have. */
  gradient?: boolean
}): Float32Array {
  const { width, height, spacing, offsetX = 0, offsetY = 0, contrast = 90, noise = 0, gradient = false } = options
  const gray = new Float32Array(width * height)
  // Deterministic pseudo-noise, so a failure is reproducible.
  let seed = 12345
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 170
      if (gradient) value += (x / width) * 60 - 30
      if (noise) value += (random() - 0.5) * noise
      const onVertical = Math.abs(((x - offsetX) % spacing) + spacing) % spacing < 1
      const onHorizontal = Math.abs(((y - offsetY) % spacing) + spacing) % spacing < 1
      if (onVertical || onHorizontal) value -= contrast
      gray[y * width + x] = Math.max(0, Math.min(255, value))
    }
  }
  return gray
}

describe('edgeProfiles', () => {
  it('spikes on the columns and rows that carry a line', () => {
    const gray = drawMap({ width: 200, height: 200, spacing: 40 })
    const { columns, rows } = edgeProfiles(gray, 200, 200)
    // A line at x=40 makes a gradient at x=40 and again where it ends.
    expect(columns[40]!).toBeGreaterThan(columns[20]!)
    expect(rows[40]!).toBeGreaterThan(rows[20]!)
  })
})

describe('highPass', () => {
  it('flattens a slow ramp', () => {
    const ramp = Float32Array.from({ length: 200 }, (_, i) => i)
    const flat = highPass(ramp)
    // The window is truncated at the ends, so the first and last half-window
    // keep a little slope. What matters is that the body goes flat.
    expect(Math.max(...flat.slice(20, 180))).toBeLessThan(1)
  })

  it('keeps a sharp spike', () => {
    const signal = new Float32Array(200)
    signal[100] = 500
    expect(highPass(signal)[100]!).toBeGreaterThan(400)
  })

  it('never returns a negative', () => {
    const signal = Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? 0 : 100))
    expect(Math.min(...highPass(signal))).toBeGreaterThanOrEqual(0)
  })
})

describe('detectPeriod', () => {
  it('finds the spacing of a clean comb', () => {
    const signal = new Float32Array(600)
    for (let x = 7; x < 600; x += 43) signal[x] = 100
    const found = detectPeriod(signal, 12, 120)
    expect(found?.period).toBeCloseTo(43, 0)
    expect(found?.phase).toBeCloseTo(7, 0)
  })

  it('prefers the true spacing over its harmonics', () => {
    // A comb every 30px also lines up at 60, 90, 120.
    const signal = new Float32Array(900)
    for (let x = 0; x < 900; x += 30) signal[x] = 100
    expect(detectPeriod(signal, 12, 200)?.period).toBeCloseTo(30, 0)
  })

  it('gives up on a signal with no periodicity', () => {
    const flat = new Float32Array(400).fill(5)
    const found = detectPeriod(flat, 12, 100)
    expect(found === null || found.score < 1.4).toBe(true)
  })

  it('gives up when the signal is shorter than a few periods', () => {
    expect(detectPeriod(new Float32Array(20), 12, 60)).toBeNull()
  })
})

describe('detectGrid', () => {
  it('reads a clean grid off a map', () => {
    const gray = drawMap({ width: 600, height: 400, spacing: 50 })
    const grid = detectGrid(gray, 600, 400)
    expect(grid?.size).toBeCloseTo(50, 0)
    expect(grid!.confidence).toBeGreaterThan(0.3)
  })

  it('recovers the offset when the grid does not start at the corner', () => {
    const gray = drawMap({ width: 600, height: 400, spacing: 50, offsetX: 17, offsetY: 9 })
    const grid = detectGrid(gray, 600, 400)
    expect(grid?.size).toBeCloseTo(50, 0)
    // A one-pixel line produces a gradient spike on entering it and another on
    // leaving, so the phase can land on either side of the line itself.
    expect(Math.abs(grid!.offsetX - 17)).toBeLessThanOrEqual(1)
    expect(Math.abs(grid!.offsetY - 9)).toBeLessThanOrEqual(1)
  })

  it('still reads a grid through heavy noise', () => {
    const gray = drawMap({ width: 600, height: 400, spacing: 40, noise: 70 })
    expect(detectGrid(gray, 600, 400)?.size).toBeCloseTo(40, 0)
  })

  it('still reads a grid whose lines are faint', () => {
    const gray = drawMap({ width: 600, height: 400, spacing: 45, contrast: 22 })
    expect(detectGrid(gray, 600, 400)?.size).toBeCloseTo(45, 0)
  })

  it('is not fooled by a map lit from one side', () => {
    const gray = drawMap({ width: 600, height: 400, spacing: 36, gradient: true })
    expect(detectGrid(gray, 600, 400)?.size).toBeCloseTo(36, 0)
  })

  it('refuses a textured map with no grid on it', () => {
    const gray = drawMap({ width: 600, height: 400, spacing: 10_000, noise: 60 })
    const grid = detectGrid(gray, 600, 400)
    expect(grid === null || grid.confidence < 0.3).toBe(true)
  })

  it('refuses pure noise', () => {
    let seed = 99
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const gray = Float32Array.from({ length: 600 * 400 }, () => random() * 255)
    const grid = detectGrid(gray, 600, 400)
    expect(grid === null || grid.confidence < 0.3).toBe(true)
  })

  it('refuses a flat, featureless image', () => {
    const gray = new Float32Array(600 * 400).fill(180)
    expect(detectGrid(gray, 600, 400)).toBeNull()
  })
})
