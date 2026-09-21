/**
 * The dice everyone watches land.
 *
 * The numbers were decided on the server before this component ever saw them.
 * What happens here is theatre — but it is *shared* theatre: the tumble is
 * driven by a seed that came down with the roll, so the die that skitters left
 * on the GM's screen skitters left on everyone's, and lands on the same face.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Roll } from '@vtt/core'
import { RollDetail } from './RollDetail.js'
import { criticalKind } from '@vtt/dice'

const TUMBLE_MS = 900
const SETTLE_MS = 350
const HOLD_MS = 4200

interface Props {
  roll: Roll | null
  /** Changes whenever a new roll arrives, including a repeat of the same one. */
  nonce: number
}

interface Die {
  sides: number
  value: number
  kept: boolean
  startX: number
  startY: number
  spin: number
  wobble: number
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

  useEffect(() => {
    if (!roll || !visible) return
    // Setting state from a timer is asynchronous, so it does not cascade.
    const timer = setTimeout(() => setDismissedNonce(nonce), TUMBLE_MS + SETTLE_MS + HOLD_MS)
    return () => clearTimeout(timer)
  }, [roll, nonce, visible])

  const dice = useMemo(() => (roll ? layOutDice(roll) : []), [roll])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !roll || !visible) return
    const context = canvas.getContext('2d')
    if (!context) return

    const started = performance.now()
    let frame = 0

    const draw = () => {
      frame = requestAnimationFrame(draw)
      const elapsed = performance.now() - started

      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== Math.round(width * ratio)) {
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)

      const columns = Math.min(dice.length, Math.max(1, Math.floor(width / 54)))
      const size = Math.min(44, (width - 16) / columns - 8)

      dice.forEach((die, index) => {
        const column = index % columns
        const row = Math.floor(index / columns)
        const restX = 12 + size / 2 + column * (size + 8)
        const restY = 12 + size / 2 + row * (size + 8)

        // Ease from the die's seeded entry point to its place in the row.
        const t = Math.min(1, elapsed / TUMBLE_MS)
        const eased = 1 - Math.pow(1 - t, 3)
        const x = die.startX * width * (1 - eased) + restX * eased
        const y = die.startY * height * (1 - eased) + restY * eased

        // A short overshoot as it hits the felt, then still.
        const settle = Math.max(0, Math.min(1, (elapsed - TUMBLE_MS) / SETTLE_MS))
        const bounce = settle < 1 ? Math.sin(settle * Math.PI * 2) * (1 - settle) * size * 0.12 : 0

        const angle = t < 1 ? die.spin * (1 - eased) * 8 : die.wobble * (1 - settle) * 0.4
        const face = t < 1 ? faceDuring(die, elapsed) : die.value

        drawDie(context, x, y - bounce, size, angle, die.sides, face, die.kept, t >= 1)
      })
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [dice, roll, visible, nonce])

  if (!roll || !visible) return null

  const critical = criticalKind(roll.result)

  return (
    <div
      className={`dice-tray${roll.visibility === 'gm' ? ' dice-tray--private' : ''}`}
      onClick={() => setDismissedNonce(nonce)}
    >
      <div className="dice-tray__header">
        <strong>{roll.by}</strong>
        {roll.label ? <span className="dice-tray__label">{roll.label}</span> : null}
        {roll.visibility === 'gm' ? <span className="dice-tray__badge">behind the screen</span> : null}
      </div>
      <canvas ref={canvasRef} className="dice-tray__canvas" style={{ height: trayHeight(dice.length) }} />
      <div className="dice-tray__detail">
        <RollDetail result={roll.result} />
      </div>
      <div className={`dice-tray__total${critical ? ` dice-tray__total--${critical}` : ''}`}>{roll.result.total}</div>
    </div>
  )
}

/** Four dice to a row at the tray's width; enough height for the rows needed. */
function trayHeight(count: number): number {
  return Math.min(168, Math.max(56, Math.ceil(Math.max(1, count) / 4) * 52 + 8))
}

/**
 * Expands a result into individual dice, seeding each one's entry point from
 * the roll's seed so every client animates the same throw.
 */
function layOutDice(roll: Roll): Die[] {
  const random = mulberry32(roll.seed)
  const dice: Die[] = []
  for (const term of roll.result.terms) {
    if (term.kind !== 'dice') continue
    for (const die of term.rolls) {
      dice.push({
        sides: term.sides,
        value: die.value,
        kept: die.kept,
        // Enter from off the left or right edge, above the tray.
        startX: random() < 0.5 ? -0.4 - random() * 0.3 : 1.4 + random() * 0.3,
        startY: -0.6 - random() * 0.5,
        spin: (random() - 0.5) * 4,
        wobble: (random() - 0.5) * 2,
      })
    }
  }
  return dice.slice(0, 40)
}

/** A face that flickers while the die is in the air. */
function faceDuring(die: Die, elapsed: number): number {
  const random = mulberry32(Math.floor(elapsed / 70) * 9176 + die.sides * 31 + Math.floor(die.startX * 1000))
  return Math.floor(random() * die.sides) + 1
}

function drawDie(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  sides: number,
  face: number,
  kept: boolean,
  settled: boolean,
): void {
  context.save()
  context.translate(x, y)
  context.rotate(angle)
  // A dropped die still has to be readable — it is evidence that advantage
  // was taken, and a blank disc with a line through it proves nothing.
  context.globalAlpha = kept ? 1 : 0.62

  const radius = size / 2
  tracePolygon(context, radius, cornersFor(sides))

  const gradient = context.createLinearGradient(-radius, -radius, radius, radius)
  gradient.addColorStop(0, kept ? '#3c3529' : '#2a2620')
  gradient.addColorStop(1, kept ? '#241f18' : '#1d1a15')
  context.fillStyle = gradient
  context.fill()

  context.lineWidth = Math.max(1, size * 0.045)
  context.strokeStyle = settled && kept ? '#e8c87a' : 'rgba(232, 200, 122, 0.4)'
  context.stroke()

  context.rotate(-angle)
  context.fillStyle = kept ? '#f4e9d4' : '#c4b79f'
  context.font = `600 ${size * 0.42}px ui-serif, Georgia, serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(String(face), 0, size * 0.02)

  // A struck-through die is one advantage or a keep-highest discarded.
  if (!kept && settled) {
    context.strokeStyle = '#b04a3f'
    context.lineWidth = Math.max(1, size * 0.06)
    context.beginPath()
    context.moveTo(-radius * 0.6, radius * 0.6)
    context.lineTo(radius * 0.6, -radius * 0.6)
    context.stroke()
  }

  context.restore()
}

/** Enough of a silhouette to read the die type at a glance. */
function cornersFor(sides: number): number {
  switch (sides) {
    case 4:
      return 3
    case 6:
      return 4
    case 8:
      return 4
    case 10:
    case 100:
      return 5
    case 12:
      return 5
    default:
      return 6
  }
}

function tracePolygon(context: CanvasRenderingContext2D, radius: number, corners: number): void {
  context.beginPath()
  for (let i = 0; i < corners; i++) {
    const angle = (i / corners) * Math.PI * 2 - Math.PI / 2
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    if (i === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.closePath()
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
