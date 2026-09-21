/**
 * Reading desktop pointing devices the way desktop apps do.
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
