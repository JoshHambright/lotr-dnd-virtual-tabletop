/**
 * The dice everyone watches land.
 *
 * The numbers were decided on the server before this component saw them. What
 * happens here is theatre — but it is *shared* theatre: the tumble is driven by
 * a seed that came down with the roll, so the die that skitters left on the
 * GM's screen skitters left on everyone's, and lands on the same face.
 *
 * They are real solids (see `dice3d.ts`), tumbled as orientations and eased
 * into showing the face the server chose. A physics engine would be the wrong
 * tool: the result is already known, so the die has to *land* on a given face,
 * and easing an orientation is honest about that in a way a rigged simulation
 * would not be.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Roll } from '@vtt/core'
import { criticalKind } from '@vtt/dice'
import { RollDetail } from './RollDetail.js'
import type { Quat, Solid, Vec3 } from '../dice3d.js'
import {
  faceCentroid,
  faceNormal,
  orientationShowing,
  quatFromAxisAngle,
  quatMultiply,
  quatSlerp,
  rotate,
  solidFor,
} from '../dice3d.js'

const TUMBLE_MS = 820
const SETTLE_MS = 420
const HOLD_MS = 4200

/** Struck from above and to the left, so facets separate without a spotlight. */
const LIGHT: Vec3 = [-0.42, -0.72, 0.55]

interface Props {
  roll: Roll | null
  /** Changes whenever a new roll arrives, including a repeat of the same one. */
  nonce: number
}

interface Die {
  sides: number
  value: number
  kept: boolean
  solid: Solid
  /** Which face carries the rolled number. */
  faceIndex: number
  /** Where it enters from, and how it spins on the way in. */
  fromX: number
  fromY: number
  axis: Vec3
  spin: number
  start: Quat
  target: Quat
  delay: number
}

export function DiceTray({ roll, nonce }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dismissedNonce, setDismissedNonce] = useState<number | null>(null)
  const [shownNonce, setShownNonce] = useState(nonce)

  // Adjusting state while rendering is how React wants a prop change handled;
  // doing it in an effect would cascade an extra render for every roll.
  if (nonce !== shownNonce) {
    setShownNonce(nonce)
    setDismissedNonce(null)
  }

  const visible = Boolean(roll) && dismissedNonce !== nonce
  const dice = useMemo(() => (roll ? layOutDice(roll) : []), [roll])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !roll || !visible) return
    const context = canvas.getContext('2d')
    if (!context) return

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const started = performance.now()
    let frame = 0
    let settledFrames = 0

    const draw = () => {
      const elapsed = reduced ? TUMBLE_MS + SETTLE_MS : performance.now() - started

      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)

      const { columns, rows, cell } = layoutDice(dice.length, width)
      const radius = cell * 0.4

      const needed = `${Math.max(58, rows * cell + PAD)}px`
      if (canvas.style.height !== needed) {
        canvas.style.height = needed
        // The element just changed size; next frame measures it correctly.
        frame = requestAnimationFrame(draw)
        return
      }

      let allSettled = true

      dice.forEach((die, index) => {
        const column = index % columns
        const row = Math.floor(index / columns)
        const restX = PAD / 2 + cell / 2 + column * cell
        const restY = PAD / 2 + cell / 2 + row * cell

        const local = elapsed - die.delay
        const tumbleT = Math.max(0, Math.min(1, local / TUMBLE_MS))
        const settleT = Math.max(0, Math.min(1, (local - TUMBLE_MS) / SETTLE_MS))
        if (settleT < 1) allSettled = false

        // Fly in from off-tray, decelerating.
        const eased = 1 - Math.pow(1 - tumbleT, 3)
        const x = die.fromX * width * (1 - eased) + restX * eased
        const y = die.fromY * height * (1 - eased) + restY * eased
        const bounce = settleT > 0 && settleT < 1 ? Math.sin(settleT * Math.PI) * (1 - settleT) * radius * 0.35 : 0

        let orientation: Quat
        if (settleT <= 0) {
          orientation = quatMultiply(quatFromAxisAngle(die.axis, die.spin * local * 0.006), die.start)
        } else {
          const spun = quatMultiply(quatFromAxisAngle(die.axis, die.spin * TUMBLE_MS * 0.006), die.start)
          orientation = quatSlerp(spun, die.target, easeOutBack(settleT))
        }

        drawDie(context, die, orientation, x, y - bounce, radius, settleT >= 1)
      })

      // Once every die is still there is nothing left to animate, so stop
      // asking for frames rather than spinning on a static picture.
      if (allSettled) {
        settledFrames++
        if (settledFrames > 2) return
      }
      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [dice, roll, visible, nonce])

  useEffect(() => {
    if (!roll || !visible) return
    const timer = setTimeout(() => setDismissedNonce(nonce), TUMBLE_MS + SETTLE_MS + HOLD_MS)
    return () => clearTimeout(timer)
  }, [roll, nonce, visible])

  if (!roll || !visible) return null

  const critical = criticalKind(roll.result)

  return (
    <div
      className={`tray${roll.visibility === 'gm' ? ' tray--private' : ''}`}
      onClick={() => setDismissedNonce(nonce)}
      role="status"
    >
      <div className="tray__head">
        <span className="tray__who">{roll.by}</span>
        {roll.label ? <span className="tray__label">{roll.label}</span> : null}
        {roll.visibility === 'gm' ? <span className="tray__private">behind the screen</span> : null}
      </div>

      <canvas ref={canvasRef} className="tray__canvas" style={{ height: trayHeight(dice.length) }} />

      <div className="tray__foot">
        <span className="tray__detail">
          <RollDetail result={roll.result} />
        </span>
        <span className={`tray__total${critical ? ` tray__total--${critical}` : ''}`}>{roll.result.total}</span>
      </div>
    </div>
  )
}

const TRAY_INNER_WIDTH = 220
const MAX_TRAY_HEIGHT = 208
const PAD = 12

/**
 * Fits the dice in the tray rather than letting them run off the bottom.
 * A handful of d6 stays large; rolling a fistful shrinks them until the whole
 * throw is visible, because a die you cannot see is not evidence of anything.
 */
function layoutDice(count: number, width: number): { columns: number; rows: number; cell: number } {
  const n = Math.max(1, count)
  // A few dice get to be large; a fistful shrinks to fit.
  let cell = Math.max(34, Math.min(64, Math.floor((width - PAD) / Math.min(n, 4))))
  const columnsFor = (c: number) => Math.max(1, Math.min(n, Math.floor((width - PAD) / c)))

  let columns = columnsFor(cell)
  let rows = Math.ceil(n / columns)
  while (rows * cell + PAD > MAX_TRAY_HEIGHT && cell > 20) {
    cell -= 3
    columns = columnsFor(cell)
    rows = Math.ceil(n / columns)
  }
  return { columns, rows, cell }
}

function trayHeight(count: number): number {
  const { rows, cell } = layoutDice(count, TRAY_INNER_WIDTH)
  return Math.max(58, rows * cell + PAD)
}

/**
 * Expands a result into individual dice, seeding each one from the roll's seed
 * so every client animates the same throw.
 */
function layOutDice(roll: Roll): Die[] {
  const random = mulberry32(roll.seed)
  const dice: Die[] = []

  for (const term of roll.result.terms) {
    if (term.kind !== 'dice') continue
    for (const die of term.rolls) {
      const solid = solidFor(term.sides)
      // Faces carry 1..n in order; which face is which only has to be stable.
      const faceIndex = (die.value - 1) % solid.faces.length
      const axis: Vec3 = [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1]

      dice.push({
        sides: term.sides,
        value: die.value,
        kept: die.kept,
        solid,
        faceIndex,
        fromX: random() < 0.5 ? -0.45 - random() * 0.35 : 1.45 + random() * 0.35,
        fromY: -0.7 - random() * 0.6,
        axis: axis[0] === 0 && axis[1] === 0 && axis[2] === 0 ? [1, 0.3, 0.2] : axis,
        spin: 2.2 + random() * 2.6,
        start: quatFromAxisAngle([random() * 2 - 1, random() * 2 - 1, random() * 2 - 1], random() * Math.PI * 2),
        target: orientationShowing(faceNormal(solid, solid.faces[faceIndex]!), random() * Math.PI * 2),
        // A stagger, so a handful of dice lands like a handful rather than a block.
        delay: random() * 130,
      })
    }
  }

  return dice.slice(0, 40)
}

function drawDie(
  context: CanvasRenderingContext2D,
  die: Die,
  orientation: Quat,
  cx: number,
  cy: number,
  radius: number,
  settled: boolean,
): void {
  const { solid } = die
  const scale = radius / 1.5

  const projected = solid.vertices.map((v) => {
    const r = rotate(v, orientation)
    return { x: cx + r[0] * scale, y: cy - r[1] * scale, z: r[2] }
  })

  // Visible faces only, painted back to front so shared edges meet cleanly.
  const visible = solid.faces
    .map((face, index) => {
      const normal = rotate(faceNormal(solid, face), orientation)
      const centroid = rotate(faceCentroid(solid, face), orientation)
      return { face, index, normal, depth: centroid[2] }
    })
    .filter((f) => f.normal[2] > 0.001)
    .sort((a, b) => a.depth - b.depth)

  context.save()
  context.globalAlpha = die.kept ? 1 : 0.5

  // A real die shows one number. Painting every face that happens to be
  // turned this way gave a d20 reading "18 17 13" at once, which is clutter,
  // not a die — so only the face most squarely facing the viewer is numbered.
  const front = visible.reduce<(typeof visible)[number] | null>(
    (best, f) => (best === null || f.normal[2] > best.normal[2] ? f : best),
    null,
  )

  for (const { face, index, normal } of visible) {
    context.beginPath()
    face.forEach((vertexIndex, i) => {
      const p = projected[vertexIndex]!
      if (i === 0) context.moveTo(p.x, p.y)
      else context.lineTo(p.x, p.y)
    })
    context.closePath()

    const lit = Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2])
    context.fillStyle = shade(die.kept, lit)
    context.fill()

    context.lineWidth = Math.max(0.6, radius * 0.035)
    context.strokeStyle = die.kept ? 'rgba(12, 14, 20, 0.85)' : 'rgba(12, 14, 20, 0.5)'
    context.stroke()

    if (front && index === front.index) {
      const centre = rotate(faceCentroid(solid, face), orientation)
      const size = radius * (die.sides >= 20 ? 0.52 : die.sides >= 12 ? 0.58 : 0.7)
      context.save()
      context.globalAlpha = die.kept ? 1 : 0.5
      context.fillStyle = die.kept ? '#f4f6f8' : '#aab3bd'
      context.font = `650 ${size}px ui-sans-serif, system-ui, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      // Once settled the front face *is* the rolled one, because that is the
      // orientation the die was eased into.
      const shown = settled ? die.value : index + 1
      context.fillText(String(shown), cx + centre[0] * scale, cy - centre[1] * scale + size * 0.06)
      context.restore()
    }
    void normal
  }

  // A dropped die is struck through once it has stopped, so the log and the
  // tray agree about which dice counted.
  if (!die.kept && settled) {
    context.globalAlpha = 1
    context.strokeStyle = '#c2564a'
    context.lineWidth = Math.max(1.2, radius * 0.12)
    context.beginPath()
    context.moveTo(cx - radius * 0.72, cy + radius * 0.72)
    context.lineTo(cx + radius * 0.72, cy - radius * 0.72)
    context.stroke()
  }

  context.restore()
}

/** Cool slate faces so the lit edges read; a dropped die desaturates. */
function shade(kept: boolean, lit: number): string {
  // A wider range than looks right on paper: on a small die the facets have
  // only a few pixels each, so gentle shading reads as one flat blob.
  const curved = Math.pow(lit, 0.72)
  const base = kept ? 38 : 32
  const range = kept ? 132 : 58
  const value = Math.round(base + curved * range)
  return `rgb(${value}, ${Math.round(value * 1.04)}, ${Math.round(value * 1.16)})`
}

/** Overshoots a little on landing, the way a die rocks before it settles. */
function easeOutBack(t: number): number {
  const c1 = 1.2
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/** Small, fast, seedable PRNG — identical output for identical seeds. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
