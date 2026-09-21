import { describe, expect, it } from 'vitest'
import { normalizeRect, solveGrid } from '../src/view.js'

describe('normalizeRect', () => {
  it('leaves a box dragged down and right alone', () => {
    expect(normalizeRect({ x: 10, y: 20, width: 30, height: 40 })).toEqual({ x: 10, y: 20, width: 30, height: 40 })
  })

  it('rights a box dragged up and left', () => {
    expect(normalizeRect({ x: 40, y: 60, width: -30, height: -40 })).toEqual({ x: 10, y: 20, width: 30, height: 40 })
  })
})

describe('solveGrid', () => {
  it('reads a single square off a box drawn around one', () => {
    const grid = solveGrid({ x: 0, y: 0, width: 70, height: 70 }, 1, 1)
    expect(grid).toMatchObject({ size: 70, offsetX: 0, offsetY: 0, skew: 0 })
  })

  it('divides a box drawn across several squares', () => {
    const grid = solveGrid({ x: 0, y: 0, width: 210, height: 140 }, 3, 2)
    expect(grid?.size).toBeCloseTo(70)
  })

  it('recovers a fractional square size, which is the usual case', () => {
    // A 1000px map that is 15.8 squares wide: nobody would type 63.29.
    const grid = solveGrid({ x: 0, y: 0, width: 632.9, height: 632.9 }, 10, 10)
    expect(grid?.size).toBeCloseTo(63.29)
  })

  it('takes the offset from where the box actually starts', () => {
    const grid = solveGrid({ x: 25, y: 12, width: 140, height: 140 }, 2, 2)
    expect(grid?.size).toBeCloseTo(70)
    expect(grid?.offsetX).toBeCloseTo(25)
    expect(grid?.offsetY).toBeCloseTo(12)
  })

  it('wraps an offset larger than one square back into phase', () => {
    const grid = solveGrid({ x: 155, y: 0, width: 70, height: 70 }, 1, 1)
    expect(grid?.offsetX).toBeCloseTo(15)
  })

  it('keeps the offset positive when the box starts left of the origin', () => {
    const grid = solveGrid({ x: -25, y: -25, width: 70, height: 70 }, 1, 1)
    expect(grid?.offsetX).toBeGreaterThanOrEqual(0)
    expect(grid?.offsetX).toBeCloseTo(45)
  })

  it('works from a box dragged up and to the left', () => {
    const grid = solveGrid({ x: 210, y: 210, width: -140, height: -140 }, 2, 2)
    expect(grid?.size).toBeCloseTo(70)
    expect(grid?.offsetX).toBeCloseTo(0)
  })

  it('reports skew when the cells are not square', () => {
    const grid = solveGrid({ x: 0, y: 0, width: 200, height: 100 }, 1, 1)
    expect(grid?.skew).toBeCloseTo(0.5)
  })

  it('reports no skew for a square measurement', () => {
    expect(solveGrid({ x: 0, y: 0, width: 300, height: 300 }, 4, 4)?.skew).toBe(0)
  })

  it('refuses a box too small to be a measurement', () => {
    expect(solveGrid({ x: 0, y: 0, width: 3, height: 3 }, 1, 1)).toBeNull()
  })

  it('refuses a box with no area', () => {
    expect(solveGrid({ x: 10, y: 10, width: 0, height: 0 }, 1, 1)).toBeNull()
  })

  it('rounds a fractional square count rather than dividing by it', () => {
    expect(solveGrid({ x: 0, y: 0, width: 210, height: 210 }, 2.6, 3.2)?.size).toBeCloseTo(70)
  })

  it('treats a zero or negative count as one square', () => {
    expect(solveGrid({ x: 0, y: 0, width: 70, height: 70 }, 0, -4)?.size).toBeCloseTo(70)
  })
})
