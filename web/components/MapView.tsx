/**
 * The table surface: map, grid, fog, tokens, measuring and everyone's cursors.
 *
 * Drawing happens in an animation frame reading the client's state directly,
 * not through React. A token dragged across the map by another player is a
 * position change sixteen times a second, and pushing that through a component
 * tree would spend the whole frame budget on reconciliation.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FogMask, FogShape } from '../../shared/fog.js'
import { toCells } from '../../shared/fog.js'
import type { Scene, Token } from '../../shared/state.js'
import type { TableClient } from '../client.js'
import { assetUrl } from '../api.js'
import {
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

export type Tool = 'select' | 'reveal' | 'conceal' | 'measure'

interface Props {
  client: TableClient
  scene: Scene | null
  tool: Tool
  brushRadius: number
  /** GM only: draw the map exactly as the players are seeing it. */
  previewAsPlayer: boolean
  selectedTokenId: string | null
  onSelectToken: (id: string | null) => void
}

interface DragState {
  kind: 'token' | 'pan' | 'fog' | 'measure'
  tokenId?: string
  /** Offset from the token's centre to the grab point, so it does not jump. */
  grabX?: number
  grabY?: number
  fromX: number
  fromY: number
  lastX: number
  lastY: number
}

export function MapView({ client, scene, tool, brushRadius, previewAsPlayer, selectedTokenId, onSelectToken }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 })
  const dragRef = useRef<DragState | null>(null)
  const fogLayerRef = useRef<FogLayer | null>(null)
  const [measurement, setMeasurement] = useState<{
    from: { x: number; y: number }
    to: { x: number; y: number }
  } | null>(null)
  const [fitted, setFitted] = useState<string | null>(null)

  const asPlayer = client.role === 'player' || previewAsPlayer
  const gmKey = client.role === 'gm' ? client.gmKey : null

  // Frame the map the first time a scene appears, and again when it changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!scene || !canvas || fitted === scene.id) return
    viewRef.current = fitToViewport(scene, canvas.clientWidth, canvas.clientHeight)
    setFitted(scene.id)
  }, [scene, fitted])

  // --- Drawing ---------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)

      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      context.fillStyle = '#14100c'
      context.fillRect(0, 0, width, height)

      const current = scene ? client.room.scenes[scene.id] : null
      if (!current) {
        drawEmptyTable(context, width, height)
        return
      }

      const view = viewRef.current
      context.save()
      context.scale(view.scale, view.scale)
      context.translate(-view.x, -view.y)

      drawMapImage(context, current, client.roomCode, gmKey)
      if (current.grid.visible) drawGrid(context, current, view)

      const tokens = Object.values(client.room.tokens).filter((t) => t.sceneId === current.id)
      drawTokens(context, current, tokens, selectedTokenId, view, client.roomCode, gmKey, asPlayer)

      if (current.fog.enabled) {
        drawFog(context, current, fogLayerRef, asPlayer)
      }

      drawCursors(context, client, current.id, view)
      if (measurement) drawMeasurement(context, current, measurement, view)
      if (dragRef.current?.kind === 'fog') {
        drawBrush(context, dragRef.current.lastX, dragRef.current.lastY, brushRadius, tool === 'reveal')
      }

      context.restore()
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [client, scene, selectedTokenId, measurement, asPlayer, gmKey, brushRadius, tool])

  // --- Pointer handling ------------------------------------------------------

  const pointToMap = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return screenToMap(viewRef.current, event.clientX - rect.left, event.clientY - rect.top)
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!scene) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const point = pointToMap(event)

      // Middle or right button pans, whatever tool is selected — so the GM
      // can reposition the map mid-brushstroke without switching tools.
      if (event.button === 1 || event.button === 2) {
        dragRef.current = {
          kind: 'pan',
          fromX: event.clientX,
          fromY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
        }
        return
      }

      if (tool === 'measure') {
        setMeasurement({ from: point, to: point })
        dragRef.current = { kind: 'measure', fromX: point.x, fromY: point.y, lastX: point.x, lastY: point.y }
        return
      }

      if ((tool === 'reveal' || tool === 'conceal') && client.role === 'gm') {
        dragRef.current = { kind: 'fog', fromX: point.x, fromY: point.y, lastX: point.x, lastY: point.y }
        paintFog(client, scene, point.x, point.y, brushRadius, tool === 'reveal')
        return
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
          fromX: point.x,
          fromY: point.y,
          lastX: point.x,
          lastY: point.y,
        }
        return
      }

      onSelectToken(null)
      dragRef.current = {
        kind: 'pan',
        fromX: event.clientX,
        fromY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
      }
    },
    [brushRadius, client, onSelectToken, pointToMap, scene, tool],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!scene) return
      const point = pointToMap(event)
      const drag = dragRef.current

      if (!drag) {
        client.setCursor({ sceneId: scene.id, x: point.x, y: point.y })
        return
      }

      switch (drag.kind) {
        case 'pan': {
          const view = viewRef.current
          viewRef.current = {
            ...view,
            x: view.x - (event.clientX - drag.lastX) / view.scale,
            y: view.y - (event.clientY - drag.lastY) / view.scale,
          }
          drag.lastX = event.clientX
          drag.lastY = event.clientY
          return
        }
        case 'token': {
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
          return
        }
        case 'fog': {
          // Stamp along the segment so a fast drag does not leave gaps.
          stampAlong(client, scene, drag.lastX, drag.lastY, point.x, point.y, brushRadius, tool === 'reveal')
          drag.lastX = point.x
          drag.lastY = point.y
          return
        }
        case 'measure':
          setMeasurement((current) => (current ? { ...current, to: point } : null))
          return
      }
    },
    [brushRadius, client, pointToMap, scene, tool],
  )

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag?.kind === 'token') client.commitMoves()
    if (drag?.kind === 'measure') setMeasurement(null)
  }, [client])

  const onWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const factor = Math.pow(0.999, event.deltaY)
    viewRef.current = zoomAt(viewRef.current, event.clientX - rect.left, event.clientY - rect.top, factor)
  }, [])

  const cursor = tool === 'measure' ? 'crosshair' : tool === 'select' ? 'grab' : 'cell'

  return (
    <canvas
      ref={canvasRef}
      className="map-canvas"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => client.setCursor(null)}
      onWheel={onWheel}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}

// --- Drawing helpers ---------------------------------------------------------

function drawEmptyTable(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.fillStyle = '#6b5c46'
  context.font = '16px ui-serif, Georgia, serif'
  context.textAlign = 'center'
  context.fillText('No map on the table yet', width / 2, height / 2)
}

function drawMapImage(context: CanvasRenderingContext2D, scene: Scene, code: string, gmKey: string | null): void {
  context.fillStyle = '#211a13'
  context.fillRect(0, 0, scene.width, scene.height)

  if (!scene.assetId) return
  const image = getImage(assetUrl(code, scene.assetId, gmKey))
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
  view: Viewport,
  code: string,
  gmKey: string | null,
  asPlayer: boolean,
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

    const portrait = token.imageAssetId ? getImage(assetUrl(code, token.imageAssetId, gmKey)) : null
    if (portrait) {
      context.save()
      context.clip()
      context.drawImage(portrait, token.x - radius, token.y - radius, radius * 2, radius * 2)
      context.restore()
    }

    context.lineWidth = Math.max(1.5, radius * 0.06)
    context.strokeStyle = token.id === selectedId ? '#e8c87a' : 'rgba(0, 0, 0, 0.55)'
    context.stroke()
    context.setLineDash([])

    if (!portrait && token.label) {
      context.fillStyle = contrastingInk(token.color)
      context.font = `600 ${Math.max(9, radius * 0.6)}px ui-serif, Georgia, serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(initials(token.label), token.x, token.y)
    }

    if (token.hp !== null && token.maxHp) drawHealthBar(context, token, radius)
    if (token.conditions.length) drawConditionPips(context, token, radius)

    // Names are drawn at a constant screen size, so they stay readable when
    // the GM zooms out to see the whole valley.
    if (token.label && view.scale > 0.25) {
      context.font = `${12 / view.scale}px ui-serif, Georgia, serif`
      context.textAlign = 'center'
      context.textBaseline = 'top'
      context.lineWidth = 3 / view.scale
      context.strokeStyle = 'rgba(0, 0, 0, 0.75)'
      context.strokeText(token.label, token.x, token.y + radius + 3 / view.scale)
      context.fillStyle = '#f2e7d2'
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
  context.fillStyle = fraction > 0.5 ? '#5b9c52' : fraction > 0.25 ? '#c39b3a' : '#b04a3f'
  context.fillRect(x, y, width * fraction, height)
}

function drawConditionPips(context: CanvasRenderingContext2D, token: Token, radius: number): void {
  const size = Math.max(3, radius * 0.18)
  token.conditions.slice(0, 5).forEach((_condition, index) => {
    context.beginPath()
    context.arc(token.x + radius * 0.75, token.y - radius * 0.7 + index * size * 2.4, size, 0, Math.PI * 2)
    context.fillStyle = '#d8a13a'
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
    context.fillStyle = '#e8c87a'
    context.strokeStyle = 'rgba(0,0,0,0.7)'
    context.lineWidth = 1.5
    context.fill()
    context.stroke()

    context.font = '11px ui-sans-serif, system-ui, sans-serif'
    context.textAlign = 'left'
    context.textBaseline = 'top'
    context.lineWidth = 3
    context.strokeText(cursor.name, 13, 9)
    context.fillStyle = '#f2e7d2'
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
  context.strokeStyle = '#e8c87a'
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
  context.fillStyle = '#f2e7d2'
  context.fillText(label, (from.x + to.x) / 2, (from.y + to.y) / 2 - 8 / view.scale)
  context.restore()
}

function drawBrush(context: CanvasRenderingContext2D, x: number, y: number, radius: number, reveal: boolean): void {
  context.save()
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.strokeStyle = reveal ? 'rgba(232, 200, 122, 0.9)' : 'rgba(176, 74, 63, 0.9)'
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
