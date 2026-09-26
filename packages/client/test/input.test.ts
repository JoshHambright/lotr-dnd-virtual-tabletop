import { describe, expect, it } from 'vitest'
import { movedEnough, pinchPair, readPinch, readWheel, zoomFactor } from '../src/input.js'

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

/**
 * Two fingers on the map.
 *
 * The arithmetic is separated from the canvas so it can be tested without a
 * touchscreen, which is just as well: there is no touchscreen here, and a
 * gesture that scales the map by 8× because two fingers brushed together is
 * exactly the sort of thing that is obvious on a device and invisible in code.
 */
describe('readPinch', () => {
  const at = (id: number, x: number, y: number) => ({ id, x, y })

  it('reports no movement when neither finger moves', () => {
    const fingers: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 100, 100), at(2, 300, 100)]
    expect(readPinch(fingers, fingers)).toMatchObject({ dx: 0, dy: 0, scale: 1 })
  })

  it('pans by the movement of the midpoint', () => {
    const before: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 100, 100), at(2, 300, 100)]
    const after: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 150, 140), at(2, 350, 140)]

    expect(readPinch(before, after)).toMatchObject({ dx: 50, dy: 40, scale: 1 })
  })

  it('scales by the ratio of the spread', () => {
    const before: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 100, 100), at(2, 200, 100)]
    const opened: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 50, 100), at(2, 250, 100)]

    expect(readPinch(before, opened).scale).toBeCloseTo(2)
    expect(readPinch(opened, before).scale).toBeCloseTo(0.5)
  })

  it('holds the midpoint still, so the map zooms about the fingers', () => {
    const before: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 100, 200), at(2, 300, 200)]
    const opened: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 50, 200), at(2, 350, 200)]

    expect(readPinch(before, opened)).toMatchObject({ centreX: 200, centreY: 200, dx: 0, dy: 0 })
  })

  it('pans and scales at once, because a real hand does both', () => {
    const before: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 100, 100), at(2, 200, 100)]
    const after: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 150, 150), at(2, 350, 150)]

    const gesture = readPinch(before, after)
    expect(gesture.scale).toBeCloseTo(2)
    expect(gesture).toMatchObject({ dx: 100, dy: 50 })
  })

  it('does not scale when the fingers are too close together to measure', () => {
    // Two fingertips 8px apart: the spread is mostly noise, and dividing by it
    // makes the map leap. It pans instead.
    const pressed: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 100, 100), at(2, 108, 100)]
    const moved: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 120, 100), at(2, 132, 100)]

    // Midpoint 104 -> 126.
    const gesture = readPinch(pressed, moved)
    expect(gesture.scale).toBe(1)
    expect(gesture.dx).toBeCloseTo(22)
  })

  it('clamps a scale that could only be a glitch', () => {
    const together: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 100, 100), at(2, 130, 100)]
    const flung: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 0, 100), at(2, 4000, 100)]

    expect(readPinch(together, flung).scale).toBeLessThanOrEqual(4)
    expect(readPinch(flung, together).scale).toBeGreaterThanOrEqual(0.25)
  })

  it('is symmetrical about which finger the browser lists first', () => {
    const before: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 100, 100), at(2, 300, 100)]
    const after: [ReturnType<typeof at>, ReturnType<typeof at>] = [at(1, 120, 100), at(2, 340, 100)]

    const forwards = readPinch(before, after)
    const backwards = readPinch([before[1], before[0]], [after[1], after[0]])
    expect(forwards).toEqual(backwards)
  })
})

describe('pinchPair', () => {
  const at = (id: number, x: number, y: number) => ({ id, x, y })

  it('needs two fingers', () => {
    expect(pinchPair([])).toBeNull()
    expect(pinchPair([at(1, 0, 0)])).toBeNull()
    expect(pinchPair([at(1, 0, 0), at(2, 10, 0)])).toHaveLength(2)
  })

  it('follows the two that arrived first, so a resting hand does not hijack it', () => {
    const touches = [at(1, 0, 0), at(2, 10, 0), at(3, 500, 500)]
    expect(pinchPair(touches)?.map((touch) => touch.id)).toEqual([1, 2])
  })
})
