/**
 * Reading pointing devices the way native apps do — a wheel, a trackpad, or
 * two fingers.
 *
 * A wheel event is not one gesture. On a mouse it is a notched wheel meaning
 * "zoom"; on a trackpad the same event is a two-finger scroll meaning "pan",
 * and a pinch arrives as a wheel event with `ctrlKey` set — which the browser
 * synthesises, so it is set even though no key is held. Treating all three as
 * zoom is the main reason a canvas feels wrong on a laptop.
 *
 * Deltas also arrive in three units depending on the browser, so they are
 * normalised to pixels before anything reads them.
 */

export type Gesture = { kind: 'zoom'; amount: number } | { kind: 'pan'; dx: number; dy: number }

/** Roughly one line of text, used to convert line-mode deltas to pixels. */
const LINE_HEIGHT = 16
const PAGE_HEIGHT = 800

/** Beyond this, a single event is a jump rather than a gesture — usually a
 *  page-mode scroll or a wheel spun hard. Clamped so the map cannot teleport. */
const MAX_DELTA = 240

function toPixels(delta: number, mode: number): number {
  const scaled = mode === 1 ? delta * LINE_HEIGHT : mode === 2 ? delta * PAGE_HEIGHT : delta
  return Math.max(-MAX_DELTA, Math.min(MAX_DELTA, scaled))
}

export function readWheel(event: WheelEvent): Gesture {
  const dx = toPixels(event.deltaX, event.deltaMode)
  const dy = toPixels(event.deltaY, event.deltaMode)

  // A pinch on a trackpad, or a deliberate ctrl+wheel, which every desktop app
  // treats as zoom.
  if (event.ctrlKey || event.metaKey) {
    return { kind: 'zoom', amount: dy }
  }

  // A mouse wheel reports no horizontal movement and moves in coarse steps; a
  // trackpad produces fine-grained deltas, usually on both axes. The threshold
  // is what separates "notched wheel, so zoom" from "two fingers, so pan".
  const isMouseWheel = dx === 0 && Math.abs(dy) >= 40 && Number.isInteger(dy)
  if (isMouseWheel) {
    return { kind: 'zoom', amount: dy }
  }

  // Shift flips a vertical scroll to horizontal, as it does everywhere else.
  if (event.shiftKey && dx === 0) {
    return { kind: 'pan', dx: dy, dy: 0 }
  }

  return { kind: 'pan', dx, dy }
}

/** Turns a zoom delta into a scale multiplier. Exponential, so zooming feels
 *  the same whether the map is at 10% or 400%. */
export function zoomFactor(amount: number, sensitivity = 0.0022): number {
  return Math.exp(-amount * sensitivity)
}

/**
 * How far a pointer must travel before a press becomes a drag. Without it, a
 * click that shifts by a pixel nudges a token — and with grid snapping on,
 * that pixel can move the piece a whole square.
 */
export const DRAG_THRESHOLD_PX = 4

export function movedEnough(fromX: number, fromY: number, toX: number, toY: number): boolean {
  return Math.hypot(toX - fromX, toY - fromY) >= DRAG_THRESHOLD_PX
}

// --- Touch ------------------------------------------------------------------

/**
 * Two fingers on a map mean the same thing in every application anyone has
 * used: move it and scale it. That convention is worth more than any cleverness
 * here, because it is the one gesture nobody has to be taught.
 *
 * It also settles an awkward question. The map has tools — paint fog, measure,
 * drag a grid box — and on a desktop those live on the left button while panning
 * lives on the middle button, the right button and space-drag. A finger has no
 * buttons. Reserving *two* fingers for moving the map leaves the single finger
 * free for whatever tool is active, so a GM painting fog on a tablet can still
 * get around the map without putting the brush down.
 */

/** A pointer on the surface, in client coordinates. */
export interface Touch {
  id: number
  x: number
  y: number
}

/** How two fingers moved between one frame and the next. */
export interface PinchGesture {
  /** Movement of the midpoint, in client pixels. */
  dx: number
  dy: number
  /** Ratio of the new spread to the old. 1 is no change. */
  scale: number
  /** Midpoint now, which is the point the zoom should hold still. */
  centreX: number
  centreY: number
}

/**
 * Below this the fingers are close enough together that the distance between
 * them is mostly noise, and dividing by it produces a scale that leaps.
 */
const MIN_SPREAD_PX = 24

/** A pinch cannot plausibly scale by more than this in a single frame. */
const MAX_FRAME_SCALE = 4

export function midpoint(a: Touch, b: Touch): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function spread(a: Touch, b: Touch): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/**
 * Works out the pan and zoom between two frames of a two-finger gesture.
 *
 * Pure, and takes the pointers rather than events, because the interesting part
 * is the arithmetic and it should be testable without a touchscreen.
 *
 * When the fingers are too close together to measure a spread reliably the
 * gesture degrades to a pan rather than reporting a wild scale — a pinch that
 * suddenly jumps the map by 8× is worse than one that briefly only moves it.
 */
export function readPinch(before: [Touch, Touch], after: [Touch, Touch]): PinchGesture {
  const from = midpoint(before[0], before[1])
  const to = midpoint(after[0], after[1])

  const wasSpread = spread(before[0], before[1])
  const isSpread = spread(after[0], after[1])

  const measurable = wasSpread >= MIN_SPREAD_PX && isSpread >= MIN_SPREAD_PX
  const raw = measurable ? isSpread / wasSpread : 1
  const scale = Math.max(1 / MAX_FRAME_SCALE, Math.min(MAX_FRAME_SCALE, raw))

  return { dx: to.x - from.x, dy: to.y - from.y, scale, centreX: to.x, centreY: to.y }
}

/**
 * Picks the two pointers a pinch should follow.
 *
 * A third finger landing on the map is usually a hand resting on the bezel, not
 * an instruction. Following the two that arrived first means the gesture carries
 * on rather than jumping to whichever pointer the browser happened to report
 * last.
 */
export function pinchPair(touches: Touch[]): [Touch, Touch] | null {
  return touches.length >= 2 ? [touches[0]!, touches[1]!] : null
}
