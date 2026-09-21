import { describe, expect, it } from 'vitest'
import { cellAt, createMask, fromCells, isRevealed, paint, resize, revealedFraction, setAll, toCells } from '../shared/fog.js'

describe('createMask', () => {
  it('starts fully hidden as a single run', () => {
    const mask = createMask(320, 320, 32)
    expect(mask).toMatchObject({ cols: 10, rows: 10, runs: [100] })
    expect(revealedFraction(mask)).toBe(0)
  })

  it('rounds a partial cell up so the map edge is covered', () => {
    expect(createMask(330, 100, 32)).toMatchObject({ cols: 11, rows: 4 })
  })

  it('can start revealed', () => {
    expect(revealedFraction(createMask(320, 320, 32, true))).toBe(1)
  })
})

describe('run-length encoding', () => {
  it('round-trips through cells unchanged', () => {
    const mask = paint(createMask(320, 320, 32), { kind: 'circle', x: 160, y: 160, radius: 60 }, true)
    const round = fromCells(toCells(mask), mask.cell, mask.cols, mask.rows)
    expect(round.runs).toEqual(mask.runs)
  })

  it('reads a single cell without expanding the mask', () => {
    const mask = paint(createMask(320, 320, 32), { kind: 'rect', x: 0, y: 0, width: 64, height: 32 }, true)
    expect(cellAt(mask, 0, 0)).toBe(true)
    expect(cellAt(mask, 1, 0)).toBe(true)
    expect(cellAt(mask, 2, 0)).toBe(false)
    expect(cellAt(mask, 0, 1)).toBe(false)
  })

  it('drops a trailing hidden run so encodings stay canonical', () => {
    const cells = new Uint8Array(4)
    expect(fromCells(cells, 32, 2, 2).runs).toEqual([4])
  })
})

describe('paint', () => {
  it('reveals a circle and leaves the rest hidden', () => {
    const mask = paint(createMask(320, 320, 32), { kind: 'circle', x: 48, y: 48, radius: 40 }, true)
    expect(isRevealed(mask, 48, 48)).toBe(true)
    expect(isRevealed(mask, 300, 300)).toBe(false)
  })

  it('erases back to hidden, so a GM can take a room back', () => {
    let mask = paint(createMask(320, 320, 32), { kind: 'rect', x: 0, y: 0, width: 320, height: 320 }, true)
    mask = paint(mask, { kind: 'circle', x: 160, y: 160, radius: 40 }, false)
    expect(isRevealed(mask, 160, 160)).toBe(false)
    expect(isRevealed(mask, 16, 16)).toBe(true)
  })

  it('tests the cell centre, so a brush clipping a corner leaves no ragged edge', () => {
    // A tiny brush entirely inside the first cell but away from its centre.
    const mask = paint(createMask(320, 320, 32), { kind: 'circle', x: 2, y: 2, radius: 3 }, true)
    expect(revealedFraction(mask)).toBe(0)
  })

  it('reveals a polygon', () => {
    const mask = paint(
      createMask(320, 320, 32),
      { kind: 'poly', points: [{ x: 0, y: 0 }, { x: 128, y: 0 }, { x: 128, y: 128 }, { x: 0, y: 128 }] },
      true,
    )
    expect(isRevealed(mask, 64, 64)).toBe(true)
    expect(isRevealed(mask, 200, 200)).toBe(false)
  })

  it('clips a brush that runs off the map', () => {
    const mask = paint(createMask(320, 320, 32), { kind: 'rect', x: -500, y: -500, width: 600, height: 600 }, true)
    expect(isRevealed(mask, 16, 16)).toBe(true)
    expect(mask.runs.reduce((a, b) => a + b, 0)).toBe(100)
  })
})

describe('bulk operations', () => {
  it('reveals and hides everything', () => {
    const mask = createMask(320, 320, 32)
    expect(revealedFraction(setAll(mask, true))).toBe(1)
    expect(revealedFraction(setAll(setAll(mask, true), false))).toBe(0)
  })

  it('treats out-of-bounds coordinates as hidden', () => {
    const mask = setAll(createMask(320, 320, 32), true)
    expect(isRevealed(mask, -1, 10)).toBe(false)
    expect(isRevealed(mask, 10, 10_000)).toBe(false)
  })
})

describe('resize', () => {
  it('keeps what was revealed when the resolution changes', () => {
    const mask = paint(createMask(320, 320, 32), { kind: 'rect', x: 0, y: 0, width: 160, height: 160 }, true)
    const finer = resize(mask, 320, 320, 16)
    expect(finer).toMatchObject({ cols: 20, rows: 20 })
    expect(isRevealed(finer, 80, 80)).toBe(true)
    expect(isRevealed(finer, 240, 240)).toBe(false)
  })

  it('grows the mask when the map gets bigger', () => {
    const mask = setAll(createMask(320, 320, 32), true)
    const bigger = resize(mask, 640, 320)
    expect(bigger.cols).toBe(20)
    expect(isRevealed(bigger, 500, 100)).toBe(false)
  })
})
