import { describe, expect, it } from 'vitest'
import { movedEnough, readWheel, zoomFactor } from '../src/input.js'

/** A wheel event as the browser would deliver it. */
function wheel(init: Partial<WheelEvent>): WheelEvent {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
  } as WheelEvent
}

describe('reading a wheel event', () => {
  it('treats a pinch as zoom, even though no key is held', () => {
    // The browser synthesises ctrlKey for a trackpad pinch.
    expect(readWheel(wheel({ deltaY: -12, ctrlKey: true }))).toMatchObject({ kind: 'zoom' })
  })

  it('treats a notched mouse wheel as zoom', () => {
    expect(readWheel(wheel({ deltaY: 100 }))).toMatchObject({ kind: 'zoom', amount: 100 })
  })

  it('treats a two-finger trackpad scroll as pan, not zoom', () => {
    expect(readWheel(wheel({ deltaX: 6, deltaY: -14 }))).toMatchObject({ kind: 'pan', dx: 6, dy: -14 })
  })

  it('treats a small vertical trackpad scroll as pan', () => {
    expect(readWheel(wheel({ deltaY: 9 }))).toMatchObject({ kind: 'pan', dy: 9 })
  })

  it('flips a shifted scroll to horizontal', () => {
    expect(readWheel(wheel({ deltaY: 30, shiftKey: true }))).toMatchObject({ kind: 'pan', dx: 30, dy: 0 })
  })

  it('normalizes line-mode deltas, so Firefox does not zoom thirty times faster', () => {
    expect(readWheel(wheel({ deltaY: 3, deltaMode: 1 }))).toMatchObject({ kind: 'zoom', amount: 48 })
  })

  it('normalizes page-mode deltas', () => {
    expect(readWheel(wheel({ deltaY: 1, deltaMode: 2, ctrlKey: true }))).toMatchObject({ kind: 'zoom', amount: 240 })
  })

  it('clamps a violent scroll so the map cannot teleport', () => {
    expect(readWheel(wheel({ deltaY: 5000, ctrlKey: true }))).toMatchObject({ amount: 240 })
    expect(readWheel(wheel({ deltaY: -5000, ctrlKey: true }))).toMatchObject({ amount: -240 })
  })
})

describe('zoomFactor', () => {
  it('scales up when scrolling toward the viewer', () => {
    expect(zoomFactor(-100)).toBeGreaterThan(1)
  })

  it('scales down when scrolling away', () => {
    expect(zoomFactor(100)).toBeLessThan(1)
  })

  it('is symmetric, so a scroll and its reverse return to the same place', () => {
    expect(zoomFactor(100) * zoomFactor(-100)).toBeCloseTo(1, 10)
  })

  it('does nothing at zero', () => {
    expect(zoomFactor(0)).toBe(1)
  })
})

describe('the drag threshold', () => {
  it('ignores the jitter of a click', () => {
    expect(movedEnough(100, 100, 102, 101)).toBe(false)
  })

  it('accepts a deliberate drag', () => {
    expect(movedEnough(100, 100, 108, 100)).toBe(true)
  })
})
