/**
 * The table surface: map, grid, fog, tokens, measuring and everyone's cursors.
 *
 * Drawing happens in an animation frame reading the client's state directly,
 * not through React. A token dragged across the map by another player is a
 * position change sixteen times a second, and pushing that through a component
 * tree would spend the whole frame budget on reconciliation.
 *
 * Input is handled the way desktop apps handle it — see `input.ts` for why a
 * wheel event is three different gestures — and the frame loop only redraws
 * when something actually changed, so an idle table costs nothing.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { FogMask, FogShape } from '@vtt/core'
import { toCells } from '@vtt/core'
import type { Scene, Token } from '@vtt/core'
import type { TableClient } from '../client.js'
import { assetUrl } from '../api.js'
import { movedEnough, readWheel, zoomFactor } from '../input.js'
import type { Rect } from '../view.js'
import {
  clampScale,
  contrastingInk,
  fitToViewport,
  getImage,
  measureDistance,
  screenToMap,
  snapToGrid,
  tokenAt,
  tokenRadius,
  zoomAt,
} from '../view.js'
import type { Viewport } from '../view.js'

export type Tool = 'select' | 'reveal' | 'conceal' | 'measure' | 'align'

interface Props {
  client: TableClient
  scene: Scene | null
  tool: Tool
  brushRadius: number
  /** GM only: draw the map exactly as the players are seeing it. */
  previewAsPlayer: boolean
  selectedTokenId: string | null
  onSelectToken: (id: string | null) => void
  /** The box dragged for grid calibration, held by the parent so the panel can read it. */
  alignBox?: Rect | null
  onAlignBox?: (box: Rect | null) => void
  /** Candidate grid drawn over the map while calibrating. */
  gridPreview?: { size: number; offsetX: number; offsetY: number } | null
}

interface DragState {
  kind: 'token' | 'pan' | 'fog' | 'measure' | 'align'
  tokenId?: string
  /** Offset from the token's centre to the grab point, so it does not jump. */
  grabX?: number
  grabY?: number
  /** Screen coordinates of the press, for the drag threshold. */
  pressX: number
  pressY: number
  lastX: number
  lastY: number
  /** False until the pointer has travelled far enough to count as a drag. */
  engaged: boolean
}

/** How quickly the view catches up to where the wheel put it. */
const EASE = 0.28
/** Below this the easing is finished and the view snaps, so it cannot creep. */
const EASE_EPSILON = 0.01

export function MapView({
  client,
  scene,
  tool,
  brushRadius,
  previewAsPlayer,
  selectedTokenId,
  onSelectToken,
  alignBox = null,
  onAlignBox,
  gridPreview = null,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hudRef = useRef<HTMLSpanElement>(null)

  /** What is drawn. Eases toward `target`. */
  const viewRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 })
  /** Where the view is heading. Pointer panning sets both, so dragging is 1:1. */
  const targetRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 })

  const dragRef = useRef<DragState | null>(null)
  const hoverRef = useRef<string | null>(null)
  const spaceRef = useRef(false)
  const measureRef = useRef<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null)
  const alignRef = useRef<Rect | null>(null)
  const fogLayerRef = useRef<FogLayer | null>(null)

  /** Redraw only when something changed. An idle table should not spin the GPU. */
  const dirtyRef = useRef(true)
  const versionRef = useRef(-1)
  const fittedRef = useRef<string | null>(null)

  const asPlayer = client.role === 'player' || previewAsPlayer
  const gmKey = client.role === 'gm' ? client.gmKey : null

  const invalidate = useCallback(() => {
    dirtyRef.current = true
  }, [])

  const fit = useCallback(() => {
    const canvas = canvasRef.current
    const current = scene ? client.room.scenes[scene.id] : null
    if (!canvas || !current) return
    const next = fitToViewport(current, canvas.clientWidth, canvas.clientHeight)
    viewRef.current = next
    targetRef.current = next
    invalidate()
  }, [client, scene, invalidate])

  // Frame the map the first time a scene appears, and again when it changes.
  useEffect(() => {
    invalidate()
  }, [alignBox, gridPreview, invalidate])

  useEffect(() => {
    if (!scene || fittedRef.current === scene.id) return
    fittedRef.current = scene.id
    fit()
  }, [scene, fit])

  // --- The frame loop --------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)

      // Anything the room changed — someone else's token, fog, a reveal.
      const version = client.getLiveVersion()
      if (version !== versionRef.current) {
        versionRef.current = version
        dirtyRef.current = true
      }

      // Ease toward the target, and keep redrawing while there is distance left.
      const view = viewRef.current
      const target = targetRef.current
      const distance =
        Math.abs(target.x - view.x) + Math.abs(target.y - view.y) + Math.abs(target.scale - view.scale) * 400
      if (distance > EASE_EPSILON) {
        viewRef.current = {
          x: view.x + (target.x - view.x) * EASE,
          y: view.y + (target.y - view.y) * EASE,
          scale: view.scale + (target.scale - view.scale) * EASE,
        }
        dirtyRef.current = true
      } else if (distance > 0) {
        viewRef.current = { ...target }
        dirtyRef.current = true
      }

      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
        dirtyRef.current = true
      }

      if (!dirtyRef.current) return
      dirtyRef.current = false

      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      context.fillStyle = '#0e1116'
      context.fillRect(0, 0, width, height)

      const current = scene ? client.room.scenes[scene.id] : null
      if (!current) {
        drawEmptyTable(context, width, height)
        return
      }

      const drawn = viewRef.current
      if (hudRef.current) hudRef.current.textContent = `${Math.round(drawn.scale * 100)}%`

      context.save()
      context.scale(drawn.scale, drawn.scale)
      context.translate(-drawn.x, -drawn.y)

      drawMapImage(context, current, client.roomCode, gmKey, invalidate)
      if (current.grid.visible) drawGrid(context, current, drawn)

      const tokens = Object.values(client.room.tokens).filter((t) => t.sceneId === current.id)
      drawTokens(
        context,
        current,
        tokens,
        selectedTokenId,
        hoverRef.current,
        drawn,
        client.roomCode,
        gmKey,
        asPlayer,
        invalidate,
      )

      if (current.fog.enabled) drawFog(context, current, fogLayerRef, asPlayer)

      // The candidate grid sits over the art so the GM can see it land on the
      // lines already drawn there.
      if (gridPreview) drawPreviewGrid(context, current, gridPreview, drawn)
      const box = alignRef.current ?? alignBox
      if (tool === 'align' && box) drawAlignBox(context, box, drawn)

      drawCursors(context, client, current.id, drawn)
      if (measureRef.current) drawMeasurement(context, current, measureRef.current, drawn)
      if (dragRef.current?.kind === 'fog') {
        drawBrush(context, dragRef.current.lastX, dragRef.current.lastY, brushRadius, tool === 'reveal')
      }

      context.restore()
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [client, scene, selectedTokenId, asPlayer, gmKey, brushRadius, tool, invalidate, alignBox, gridPreview])

  // Remote cursors fade out on their own, so keep the loop honest for a while
  // after one arrives rather than leaving a stale arrow on screen.
  useEffect(() => {
    const timer = setInterval(() => {
      if (client.cursors.size) invalidate()
    }, 500)
    return () => clearInterval(timer)
  }, [client, invalidate])

  // --- Wheel -----------------------------------------------------------------

  // Attached by hand because React's onWheel is passive: it cannot call
  // preventDefault, so two-finger scrolling over the map would scroll the page.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const gesture = readWheel(event)

      if (gesture.kind === 'zoom') {
        targetRef.current = zoomAt(
          targetRef.current,
          event.clientX - rect.left,
          event.clientY - rect.top,
          zoomFactor(gesture.amount),
        )
      } else {
        const { scale } = targetRef.current
        targetRef.current = {
          ...targetRef.current,
          x: targetRef.current.x + gesture.dx / scale,
          y: targetRef.current.y + gesture.dy / scale,
        }
      }
      invalidate()
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [invalidate])

  // --- Keyboard ---------------------------------------------------------------

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      return Boolean(el?.closest('input, textarea, select, [contenteditable="true"]'))
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return

      if (event.code === 'Space' && !spaceRef.current) {
        spaceRef.current = true
        applyCursor(canvasRef.current, tool, dragRef.current, hoverRef.current, true)
        event.preventDefault()
        return
      }

      const nudge = (dx: number, dy: number) => {
        const current = scene ? client.room.scenes[scene.id] : null
        const token = selectedTokenId ? client.room.tokens[selectedTokenId] : undefined
        if (!current || !token) return
        event.preventDefault()
        // A step is a grid square, because that is the unit the game uses.
        // Alt gives fine control for anything that has to sit off-grid.
        const step = event.altKey ? 1 : current.grid.size
        client.moveToken(token.id, token.x + dx * step, token.y + dy * step)
        client.commitMoves()
      }

      switch (event.key) {
        case 'ArrowLeft':
          return nudge(-1, 0)
        case 'ArrowRight':
          return nudge(1, 0)
        case 'ArrowUp':
          return nudge(0, -1)
        case 'ArrowDown':
          return nudge(0, 1)
        case 'Escape':
          return onSelectToken(null)
        case 'f':
        case 'F':
          event.preventDefault()
          return fit()
        case '0':
          event.preventDefault()
          targetRef.current = { ...targetRef.current, scale: 1 }
          return invalidate()
        case '=':
        case '+':
          event.preventDefault()
          targetRef.current = { ...targetRef.current, scale: clampScale(targetRef.current.scale * 1.2) }
          return invalidate()
        case '-':
        case '_':
          event.preventDefault()
          targetRef.current = { ...targetRef.current, scale: clampScale(targetRef.current.scale / 1.2) }
          return invalidate()
        case 'Delete':
        case 'Backspace': {
          if (client.role !== 'gm' || !selectedTokenId) return
          event.preventDefault()
          client.send({ t: 'token.delete', id: selectedTokenId })
          return onSelectToken(null)
        }
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceRef.current = false
        applyCursor(canvasRef.current, tool, dragRef.current, hoverRef.current, false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [client, scene, selectedTokenId, onSelectToken, fit, invalidate, tool])

  // --- Pointer ----------------------------------------------------------------

  const pointToMap = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return screenToMap(viewRef.current, event.clientX - rect.left, event.clientY - rect.top)
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!scene) return
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      const point = pointToMap(event)

      const startPan = () => {
        dragRef.current = {
          kind: 'pan',
          pressX: event.clientX,
          pressY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          engaged: true,
        }
      }

      // Middle or right button pans, and so does space-drag — all three are
      // what a desktop canvas app does, and they work whatever tool is active.
      if (event.button === 1 || event.button === 2 || spaceRef.current) return startPan()

      if (tool === 'align' && client.role === 'gm') {
        alignRef.current = { x: point.x, y: point.y, width: 0, height: 0 }
        dragRef.current = {
          kind: 'align',
          pressX: event.clientX,
          pressY: event.clientY,
          lastX: point.x,
          lastY: point.y,
          engaged: true,
        }
        return invalidate()
      }

      if (tool === 'measure') {
        measureRef.current = { from: point, to: point }
        dragRef.current = {
          kind: 'measure',
          pressX: event.clientX,
          pressY: event.clientY,
          lastX: point.x,
          lastY: point.y,
          engaged: true,
        }
        return invalidate()
      }

      if ((tool === 'reveal' || tool === 'conceal') && client.role === 'gm') {
        dragRef.current = {
          kind: 'fog',
          pressX: event.clientX,
          pressY: event.clientY,
          lastX: point.x,
          lastY: point.y,
          engaged: true,
        }
        paintFog(client, scene, point.x, point.y, brushRadius, tool === 'reveal')
        return invalidate()
      }

      const tokens = Object.values(client.room.tokens).filter((t) => t.sceneId === scene.id)
      const token = tokenAt(tokens, scene, point.x, point.y)
      if (token) {
        onSelectToken(token.id)
        dragRef.current = {
          kind: 'token',
          tokenId: token.id,
          grabX: point.x - token.x,
          grabY: point.y - token.y,
          pressX: event.clientX,
          pressY: event.clientY,
          lastX: point.x,
          lastY: point.y,
          // Not a drag until the pointer has actually travelled.
          engaged: false,
        }
        return invalidate()
      }

      onSelectToken(null)
      startPan()
    },
    [brushRadius, client, onSelectToken, pointToMap, scene, tool, invalidate],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!scene) return
      const point = pointToMap(event)
      const drag = dragRef.current

      if (!drag) {
        // Hovering: light the token under the pointer so it reads as grabbable.
        const tokens = Object.values(client.room.tokens).filter((t) => t.sceneId === scene.id)
        const hovered = tokenAt(tokens, scene, point.x, point.y)?.id ?? null
        if (hovered !== hoverRef.current) {
          hoverRef.current = hovered
          applyCursor(event.currentTarget, tool, null, hovered, spaceRef.current)
          invalidate()
        }
        client.setCursor({ sceneId: scene.id, x: point.x, y: point.y })
        return
      }

      switch (drag.kind) {
        case 'pan': {
          const view = viewRef.current
          const next = {
            ...view,
            x: view.x - (event.clientX - drag.lastX) / view.scale,
            y: view.y - (event.clientY - drag.lastY) / view.scale,
          }
          // Both, so a drag tracks the pointer exactly rather than trailing it.
          viewRef.current = next
          targetRef.current = next
          drag.lastX = event.clientX
          drag.lastY = event.clientY
          return invalidate()
        }

        case 'token': {
          if (!drag.engaged) {
            if (!movedEnough(drag.pressX, drag.pressY, event.clientX, event.clientY)) return
            drag.engaged = true
          }
          const token = client.room.tokens[drag.tokenId!]
          if (!token) return
          let x = point.x - (drag.grabX ?? 0)
          let y = point.y - (drag.grabY ?? 0)
          if (scene.grid.snap && !event.altKey) {
            const snapped = snapToGrid(scene, x, y, token.squares)
            x = snapped.x
            y = snapped.y
          }
          if (x !== token.x || y !== token.y) client.moveToken(token.id, x, y)
          return invalidate()
        }

        case 'fog': {
          // Stamp along the segment so a fast drag does not leave gaps.
          stampAlong(client, scene, drag.lastX, drag.lastY, point.x, point.y, brushRadius, tool === 'reveal')
          drag.lastX = point.x
          drag.lastY = point.y
          return invalidate()
        }

        case 'measure': {
          if (measureRef.current) measureRef.current = { ...measureRef.current, to: point }
          return invalidate()
        }

        case 'align': {
          const box = alignRef.current
          if (box) alignRef.current = { ...box, width: point.x - box.x, height: point.y - box.y }
          return invalidate()
        }
      }
    },
    [brushRadius, client, pointToMap, scene, tool, invalidate],
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      dragRef.current = null
      if (drag?.kind === 'token' && drag.engaged) client.commitMoves()
      if (drag?.kind === 'measure') measureRef.current = null
      if (drag?.kind === 'align') {
        const box = alignRef.current
        alignRef.current = null
        onAlignBox?.(box && Math.abs(box.width) > 2 && Math.abs(box.height) > 2 ? box : null)
      }
      applyCursor(event.currentTarget, tool, null, hoverRef.current, spaceRef.current)
      invalidate()
    },
    [client, tool, invalidate, onAlignBox],
  )

  return (
    <div className="map-stage">
      <canvas
        ref={canvasRef}
        className="map-canvas"
        tabIndex={0}
        aria-label="The map. Drag to pan, scroll to zoom, arrow keys move the selected token."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          client.setCursor(null)
          if (hoverRef.current) {
            hoverRef.current = null
            invalidate()
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
      />

      <div className="map-hud">
        <span ref={hudRef} className="map-hud__zoom" title="Zoom">
          100%
        </span>
        <button type="button" className="map-hud__button" onClick={fit} title="Fit the map to the window (F)">
          Fit
        </button>
      </div>
    </div>
  )
}

/**
 * The pointer tells you what a press will do before you commit to it: an open
 * hand over empty map, a closed one while panning, a move cross over a piece.
 */
function applyCursor(
  canvas: HTMLCanvasElement | null,
  tool: Tool,
  drag: DragState | null,
  hovered: string | null,
  spaceHeld: boolean,
): void {
  if (!canvas) return
  if (drag?.kind === 'pan' || spaceHeld) {
    canvas.style.cursor = 'grabbing'
    return
  }
  if (tool === 'measure') {
    canvas.style.cursor = 'crosshair'
    return
  }
  if (tool === 'reveal' || tool === 'conceal') {
    canvas.style.cursor = 'cell'
    return
  }
  if (tool === 'align') {
    canvas.style.cursor = 'crosshair'
    return
  }
  canvas.style.cursor = hovered ? 'move' : 'grab'
}

// --- Drawing helpers ---------------------------------------------------------

function drawEmptyTable(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.fillStyle = '#667381'
  context.font = '15px ui-sans-serif, system-ui, sans-serif'
  context.textAlign = 'center'
  context.fillText('No map on the table yet', width / 2, height / 2)
}

function drawMapImage(
  context: CanvasRenderingContext2D,
  scene: Scene,
  code: string,
  gmKey: string | null,
  onLoad: () => void,
): void {
  context.fillStyle = '#161b21'
  context.fillRect(0, 0, scene.width, scene.height)

  if (!scene.assetId) return
  // The loop no longer redraws every frame, so a late-arriving image has to
  // ask for the frame it needs.
  const image = getImage(assetUrl(code, scene.assetId, gmKey), onLoad)
  if (image) context.drawImage(image, 0, 0, scene.width, scene.height)
}

function drawGrid(context: CanvasRenderingContext2D, scene: Scene, view: Viewport): void {
  const { size, offsetX, offsetY } = scene.grid
  // Below about four screen pixels a square, the grid is just noise.
  if (size * view.scale < 4) return

  context.save()
  context.strokeStyle = 'rgba(0, 0, 0, 0.28)'
  context.lineWidth = Math.max(0.5, 1 / view.scale)
  context.beginPath()
  for (let x = offsetX % size; x <= scene.width; x += size) {
    context.moveTo(x, 0)
    context.lineTo(x, scene.height)
  }
  for (let y = offsetY % size; y <= scene.height; y += size) {
    context.moveTo(0, y)
    context.lineTo(scene.width, y)
  }
  context.stroke()
  context.restore()
}

/**
 * Fog is drawn by painting the mask into a tiny offscreen canvas — one pixel
 * per cell — and scaling it up with smoothing on. That costs almost nothing
 * and gives soft edges for free, where stroking thousands of rectangles would
 * not.
 */
function drawFog(
  context: CanvasRenderingContext2D,
  scene: Scene,
  cache: React.MutableRefObject<FogLayer | null>,
  asPlayer: boolean,
): void {
  const mask = scene.fog.mask
  let layer = cache.current

  if (!layer) {
    layer = { canvas: document.createElement('canvas'), mask: null, asPlayer }
    cache.current = layer
  }

  // The mask is replaced wholesale whenever fog changes, so its identity is a
  // sound cache key. Without this the layer would be re-expanded and a fresh
  // ImageData allocated sixty times a second for fog that is not moving.
  if (layer.mask !== mask || layer.asPlayer !== asPlayer) {
    const { canvas } = layer
    if (canvas.width !== mask.cols || canvas.height !== mask.rows) {
      canvas.width = mask.cols
      canvas.height = mask.rows
    }

    const offContext = canvas.getContext('2d')
    if (!offContext) return

    const cells = toCells(mask)
    const image = offContext.createImageData(mask.cols, mask.rows)
    // Players get a wall of near-black. The GM gets a cool slate veil instead:
    // dark enough to read as "covered" at a glance, but tinted away from the
    // map's own browns so the difference is obvious even on an unlit battlemat,
    // and sheer enough to keep working through.
    const [r, g, b, alpha] = asPlayer ? [6, 5, 4, 255] : [38, 44, 58, 168]
    for (let i = 0; i < cells.length; i++) {
      if (cells[i]) continue
      const p = i * 4
      image.data[p] = r!
      image.data[p + 1] = g!
      image.data[p + 2] = b!
      image.data[p + 3] = alpha!
    }
    offContext.putImageData(image, 0, 0)

    layer.mask = mask
    layer.asPlayer = asPlayer
  }

  context.save()
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(layer.canvas, 0, 0, scene.width, scene.height)
  context.restore()
}

/** The rendered fog, kept until the mask it was built from is replaced. */
interface FogLayer {
  canvas: HTMLCanvasElement
  mask: FogMask | null
  asPlayer: boolean
}

function drawTokens(
  context: CanvasRenderingContext2D,
  scene: Scene,
  tokens: Token[],
  selectedId: string | null,
  hoveredId: string | null,
  view: Viewport,
  code: string,
  gmKey: string | null,
  asPlayer: boolean,
  onLoad: () => void,
): void {
  for (const token of tokens) {
    // In the GM's player preview, a staged token disappears exactly as it
    // would from a player's screen.
    if (token.hidden && asPlayer) continue

    const radius = tokenRadius(token, scene)
    context.save()

    if (token.hidden) {
      context.globalAlpha = 0.45
      context.setLineDash([radius / 4, radius / 6])
    }

    context.beginPath()
    context.arc(token.x, token.y, radius, 0, Math.PI * 2)
    context.fillStyle = token.color
    context.fill()

    const portrait = token.imageAssetId ? getImage(assetUrl(code, token.imageAssetId, gmKey), onLoad) : null
    if (portrait) {
      context.save()
      context.clip()
      context.drawImage(portrait, token.x - radius, token.y - radius, radius * 2, radius * 2)
      context.restore()
    }

    const selected = token.id === selectedId
    const hovered = token.id === hoveredId

    context.lineWidth = Math.max(1.5, radius * (selected ? 0.09 : 0.06))
    context.strokeStyle = selected ? '#6f9bd1' : hovered ? 'rgba(111, 155, 209, 0.75)' : 'rgba(0, 0, 0, 0.55)'
    context.stroke()
    context.setLineDash([])

    // A faint halo under the pointer, so a piece reads as grabbable before
    // anyone presses anything.
    if (hovered && !selected) {
      context.beginPath()
      context.arc(token.x, token.y, radius * 1.12, 0, Math.PI * 2)
      context.strokeStyle = 'rgba(111, 155, 209, 0.3)'
      context.lineWidth = Math.max(1, radius * 0.05)
      context.stroke()
    }

    if (!portrait && token.label) {
      context.fillStyle = contrastingInk(token.color)
      context.font = `600 ${Math.max(9, radius * 0.6)}px ui-sans-serif, system-ui, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(initials(token.label), token.x, token.y)
    }

    if (token.hp !== null && token.maxHp) drawHealthBar(context, token, radius)
    if (token.conditions.length) drawConditionPips(context, token, radius)

    // Names are drawn at a constant screen size, so they stay readable when
    // the GM zooms out to see the whole valley.
    if (token.label && view.scale > 0.25) {
      context.font = `${12 / view.scale}px ui-sans-serif, system-ui, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'top'
      context.lineWidth = 3 / view.scale
      context.strokeStyle = 'rgba(0, 0, 0, 0.75)'
      context.strokeText(token.label, token.x, token.y + radius + 3 / view.scale)
      context.fillStyle = '#e7eaee'
      context.fillText(token.label, token.x, token.y + radius + 3 / view.scale)
    }

    context.restore()
  }
}

function drawHealthBar(context: CanvasRenderingContext2D, token: Token, radius: number): void {
  const fraction = Math.max(0, Math.min(1, (token.hp ?? 0) / (token.maxHp || 1)))
  const width = radius * 1.7
  const height = Math.max(3, radius * 0.16)
  const x = token.x - width / 2
  const y = token.y - radius - height * 1.6

  context.fillStyle = 'rgba(0, 0, 0, 0.6)'
  context.fillRect(x, y, width, height)
  context.fillStyle = fraction > 0.5 ? '#6f9f6a' : fraction > 0.25 ? '#c9a227' : '#c2564a'
  context.fillRect(x, y, width * fraction, height)
}

function drawConditionPips(context: CanvasRenderingContext2D, token: Token, radius: number): void {
  const size = Math.max(3, radius * 0.18)
  token.conditions.slice(0, 5).forEach((_condition, index) => {
    context.beginPath()
    context.arc(token.x + radius * 0.75, token.y - radius * 0.7 + index * size * 2.4, size, 0, Math.PI * 2)
    context.fillStyle = '#c9a227'
    context.fill()
    context.lineWidth = size * 0.3
    context.strokeStyle = 'rgba(0,0,0,0.6)'
    context.stroke()
  })
}

function drawCursors(context: CanvasRenderingContext2D, client: TableClient, sceneId: string, view: Viewport): void {
  const now = Date.now()
  for (const cursor of client.cursors.values()) {
    if (cursor.sceneId !== sceneId) continue
    if (now - cursor.at > 8000) continue

    context.save()
    context.translate(cursor.x, cursor.y)
    context.scale(1 / view.scale, 1 / view.scale)

    context.beginPath()
    context.moveTo(0, 0)
    context.lineTo(0, 16)
    context.lineTo(5, 12)
    context.lineTo(11, 11)
    context.closePath()
    context.fillStyle = '#6f9bd1'
    context.strokeStyle = 'rgba(0,0,0,0.7)'
    context.lineWidth = 1.5
    context.fill()
    context.stroke()

    context.font = '11px ui-sans-serif, system-ui, sans-serif'
    context.textAlign = 'left'
    context.textBaseline = 'top'
    context.lineWidth = 3
    context.strokeText(cursor.name, 13, 9)
    context.fillStyle = '#e7eaee'
    context.fillText(cursor.name, 13, 9)

    context.restore()
  }
}

function drawMeasurement(
  context: CanvasRenderingContext2D,
  scene: Scene,
  measurement: { from: { x: number; y: number }; to: { x: number; y: number } },
  view: Viewport,
): void {
  const { from, to } = measurement
  context.save()
  context.strokeStyle = '#6f9bd1'
  context.lineWidth = 2 / view.scale
  context.setLineDash([8 / view.scale, 6 / view.scale])
  context.beginPath()
  context.moveTo(from.x, from.y)
  context.lineTo(to.x, to.y)
  context.stroke()
  context.setLineDash([])

  const distance = measureDistance(scene, from.x, from.y, to.x, to.y)
  const label = `${Math.round(distance)} ${scene.grid.unitLabel}`
  context.font = `${13 / view.scale}px ui-sans-serif, system-ui, sans-serif`
  context.textAlign = 'center'
  context.lineWidth = 4 / view.scale
  context.strokeStyle = 'rgba(0,0,0,0.8)'
  context.strokeText(label, (from.x + to.x) / 2, (from.y + to.y) / 2 - 8 / view.scale)
  context.fillStyle = '#e7eaee'
  context.fillText(label, (from.x + to.x) / 2, (from.y + to.y) / 2 - 8 / view.scale)
  context.restore()
}

/** The candidate grid, drawn over the art so it can be judged against it. */
function drawPreviewGrid(
  context: CanvasRenderingContext2D,
  scene: Scene,
  grid: { size: number; offsetX: number; offsetY: number },
  view: Viewport,
): void {
  const { size, offsetX, offsetY } = grid
  if (!(size > 1) || size * view.scale < 3) return

  context.save()
  context.strokeStyle = 'rgba(111, 155, 209, 0.85)'
  context.lineWidth = Math.max(0.6, 1 / view.scale)
  context.beginPath()
  for (let x = offsetX % size; x <= scene.width; x += size) {
    context.moveTo(x, 0)
    context.lineTo(x, scene.height)
  }
  for (let y = offsetY % size; y <= scene.height; y += size) {
    context.moveTo(0, y)
    context.lineTo(scene.width, y)
  }
  context.stroke()
  context.restore()
}

/** The box being dragged across a known number of squares. */
function drawAlignBox(context: CanvasRenderingContext2D, box: Rect, view: Viewport): void {
  const x = Math.min(box.x, box.x + box.width)
  const y = Math.min(box.y, box.y + box.height)
  const width = Math.abs(box.width)
  const height = Math.abs(box.height)

  context.save()
  context.fillStyle = 'rgba(111, 155, 209, 0.12)'
  context.fillRect(x, y, width, height)

  context.strokeStyle = '#6f9bd1'
  context.lineWidth = Math.max(1, 1.5 / view.scale)
  context.setLineDash([6 / view.scale, 4 / view.scale])
  context.strokeRect(x, y, width, height)
  context.setLineDash([])

  // Corner ticks, so the exact edges are visible against busy map art.
  const tick = Math.min(width, height) * 0.18
  context.lineWidth = Math.max(1.2, 2.5 / view.scale)
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + width, y, -1, 1],
    [x, y + height, 1, -1],
    [x + width, y + height, -1, -1],
  ] as const) {
    context.beginPath()
    context.moveTo(cx + dx * tick, cy)
    context.lineTo(cx, cy)
    context.lineTo(cx, cy + dy * tick)
    context.stroke()
  }
  context.restore()
}

function drawBrush(context: CanvasRenderingContext2D, x: number, y: number, radius: number, reveal: boolean): void {
  context.save()
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.strokeStyle = reveal ? 'rgba(111, 155, 209, 0.9)' : 'rgba(194, 86, 74, 0.9)'
  context.lineWidth = 2
  context.stroke()
  context.restore()
}

// --- Fog painting ------------------------------------------------------------

function paintFog(client: TableClient, scene: Scene, x: number, y: number, radius: number, reveal: boolean): void {
  const shape: FogShape = { kind: 'circle', x, y, radius }
  client.send({ t: 'fog.paint', sceneId: scene.id, shape, reveal })
}

/** Walks the pointer's path in brush-sized steps so quick strokes stay solid. */
function stampAlong(
  client: TableClient,
  scene: Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number,
  reveal: boolean,
): void {
  const distance = Math.hypot(toX - fromX, toY - fromY)
  const step = Math.max(radius * 0.6, 1)
  const steps = Math.min(24, Math.floor(distance / step))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    paintFog(client, scene, fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, radius, reveal)
  }
  if (steps === 0 && distance > 0) paintFog(client, scene, toX, toY, radius, reveal)
}

function initials(label: string): string {
  return label
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase()
}
