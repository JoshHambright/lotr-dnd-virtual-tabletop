/** Viewport maths and an image cache, kept out of the render loop's way. */

import type { Scene, Token } from '../shared/state.js'

export interface Viewport {
  /** Map coordinate drawn at the canvas origin. */
  x: number
  y: number
  scale: number
}

export const MIN_SCALE = 0.08
export const MAX_SCALE = 6

export function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}

export function screenToMap(view: Viewport, screenX: number, screenY: number): { x: number; y: number } {
  return { x: screenX / view.scale + view.x, y: screenY / view.scale + view.y }
}

export function mapToScreen(view: Viewport, mapX: number, mapY: number): { x: number; y: number } {
  return { x: (mapX - view.x) * view.scale, y: (mapY - view.y) * view.scale }
}

/** Zooms about a fixed screen point, so the map does not slide under the cursor. */
export function zoomAt(view: Viewport, screenX: number, screenY: number, factor: number): Viewport {
  const scale = clampScale(view.scale * factor)
  const before = screenToMap(view, screenX, screenY)
  const next = { ...view, scale }
  const after = screenToMap(next, screenX, screenY)
  return { x: view.x + (before.x - after.x), y: view.y + (before.y - after.y), scale }
}

export function fitToViewport(scene: Scene, width: number, height: number): Viewport {
  const scale = clampScale(Math.min(width / scene.width, height / scene.height) * 0.95)
  return {
    x: scene.width / 2 - width / scale / 2,
    y: scene.height / 2 - height / scale / 2,
    scale,
  }
}

export function tokenRadius(token: Token, scene: Scene): number {
  return (token.squares * scene.grid.size) / 2
}

export function tokenAt(tokens: Token[], scene: Scene, mapX: number, mapY: number): Token | null {
  // Reverse order so the piece drawn on top is the one picked up.
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]!
    const radius = tokenRadius(token, scene)
    const dx = mapX - token.x
    const dy = mapY - token.y
    if (dx * dx + dy * dy <= radius * radius) return token
  }
  return null
}

/** Snaps a token's centre to the middle of the nearest grid square. */
export function snapToGrid(scene: Scene, x: number, y: number, squares: number): { x: number; y: number } {
  const { size, offsetX, offsetY } = scene.grid
  // An even-sized piece sits on an intersection; an odd-sized one in a square.
  const half = squares % 2 === 0 ? 0 : size / 2
  return {
    x: Math.round((x - offsetX - half) / size) * size + offsetX + half,
    y: Math.round((y - offsetY - half) / size) * size + offsetY + half,
  }
}

/** Distance between two map points, in the scene's own units. */
export function measureDistance(scene: Scene, ax: number, ay: number, bx: number, by: number): number {
  const squares = Math.hypot(bx - ax, by - ay) / scene.grid.size
  return squares * scene.grid.unitsPerSquare
}

// --- Image cache -------------------------------------------------------------

type CacheEntry = { image: HTMLImageElement; loaded: boolean }

const cache = new Map<string, CacheEntry>()

/**
 * Returns a drawable image, or null while it is still loading. The render loop
 * calls this every frame, so it must never start a second request for the
 * same url or the browser will thrash.
 */
export function getImage(url: string | null, onLoad?: () => void): HTMLImageElement | null {
  if (!url) return null
  const existing = cache.get(url)
  if (existing) return existing.loaded ? existing.image : null

  const image = new Image()
  const entry: CacheEntry = { image, loaded: false }
  cache.set(url, entry)
  image.addEventListener('load', () => {
    entry.loaded = true
    onLoad?.()
  })
  image.addEventListener('error', () => {
    // Leave it unloaded; the map simply draws without it rather than retrying
    // every frame against a url that is not going to start working.
    cache.delete(url)
  })
  image.src = url
  return null
}

/** Readable ink on a given token colour. */
export function contrastingInk(hex: string): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#1b1510' : '#f6efe2'
}
