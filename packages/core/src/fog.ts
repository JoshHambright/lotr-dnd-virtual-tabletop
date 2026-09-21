/**
 * Fog of war as a grid of revealed/hidden cells.
 *
 * The mask is the authority and it lives on the server. Players are sent the
 * mask itself — which only ever says what *is* revealed — so there is nothing
 * in a player's browser describing the parts they haven't found yet, and no
 * client-side toggle that could turn the fog off.
 *
 * The map image is still delivered whole, so a player who goes looking in
 * devtools can find the unexplored corners of the picture. Closing that gap
 * needs server-gated image tiles; see docs/FOG_OF_WAR.md.
 */

export interface FogMask {
  /** Cell size in map pixels. Smaller is finer and costs more to store. */
  cell: number
  cols: number
  rows: number
  /**
   * Run-length encoded cells in row-major order, alternating hidden/revealed
   * and always starting with a hidden run (which may be length 0). A fresh
   * mask is therefore one run, and a fully explored one is two.
   */
  runs: number[]
}

export type FogShape =
  | { kind: 'circle'; x: number; y: number; radius: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'poly'; points: { x: number; y: number }[] }

export const DEFAULT_FOG_CELL = 32

export function createMask(width: number, height: number, cell = DEFAULT_FOG_CELL, revealed = false): FogMask {
  const cols = Math.max(1, Math.ceil(width / cell))
  const rows = Math.max(1, Math.ceil(height / cell))
  const total = cols * rows
  return { cell, cols, rows, runs: revealed ? [0, total] : [total] }
}

/** Expands the runs into one byte per cell for reading and painting. */
export function toCells(mask: FogMask): Uint8Array {
  const cells = new Uint8Array(mask.cols * mask.rows)
  let index = 0
  let value = 0
  for (const run of mask.runs) {
    if (value) cells.fill(1, index, Math.min(index + run, cells.length))
    index += run
    value ^= 1
  }
  return cells
}

/** Re-encodes a cell array back into runs, dropping any trailing hidden run. */
export function fromCells(cells: Uint8Array, cell: number, cols: number, rows: number): FogMask {
  const runs: number[] = []
  let current = 0
  let length = 0
  for (const byte of cells) {
    const value = byte ? 1 : 0
    if (value === current) {
      length++
    } else {
      runs.push(length)
      current = value
      length = 1
    }
  }
  if (length > 0 || runs.length === 0) runs.push(length)
  while (runs.length > 1 && runs[runs.length - 1] === 0) runs.pop()
  return { cell, cols, rows, runs }
}

export function isRevealed(mask: FogMask, mapX: number, mapY: number): boolean {
  const col = Math.floor(mapX / mask.cell)
  const row = Math.floor(mapY / mask.cell)
  if (col < 0 || row < 0 || col >= mask.cols || row >= mask.rows) return false
  return cellAt(mask, col, row)
}

/** Reads a single cell without expanding the whole mask. */
export function cellAt(mask: FogMask, col: number, row: number): boolean {
  const target = row * mask.cols + col
  let index = 0
  let value = false
  for (const run of mask.runs) {
    index += run
    if (target < index) return value
    value = !value
  }
  return false
}

/**
 * Paints a shape into the mask. `reveal` false erases back to hidden, which is
 * how a GM takes back a room the company has left.
 */
export function paint(mask: FogMask, shape: FogShape, reveal: boolean): FogMask {
  const cells = toCells(mask)
  const value = reveal ? 1 : 0
  const bounds = shapeBounds(shape)

  const minCol = Math.max(0, Math.floor(bounds.minX / mask.cell))
  const maxCol = Math.min(mask.cols - 1, Math.floor(bounds.maxX / mask.cell))
  const minRow = Math.max(0, Math.floor(bounds.minY / mask.cell))
  const maxRow = Math.min(mask.rows - 1, Math.floor(bounds.maxY / mask.cell))

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      // Test the cell's centre: a brush edge that clips a corner shouldn't
      // flip the whole cell, or dragging leaves a ragged outline.
      const cx = col * mask.cell + mask.cell / 2
      const cy = row * mask.cell + mask.cell / 2
      if (containsPoint(shape, cx, cy)) cells[row * mask.cols + col] = value
    }
  }

  return fromCells(cells, mask.cell, mask.cols, mask.rows)
}

export function setAll(mask: FogMask, revealed: boolean): FogMask {
  const total = mask.cols * mask.rows
  return { ...mask, runs: revealed ? [0, total] : [total] }
}

/** Fraction of the map the company has uncovered, for the GM's status line. */
export function revealedFraction(mask: FogMask): number {
  const total = mask.cols * mask.rows
  if (!total) return 0
  let revealed = 0
  let value = false
  for (const run of mask.runs) {
    if (value) revealed += run
    value = !value
  }
  return revealed / total
}

/** Rebuilds a mask at a new size or resolution, keeping what was revealed. */
export function resize(mask: FogMask, width: number, height: number, cell = mask.cell): FogMask {
  const next = createMask(width, height, cell)
  const cells = new Uint8Array(next.cols * next.rows)
  for (let row = 0; row < next.rows; row++) {
    for (let col = 0; col < next.cols; col++) {
      const x = col * cell + cell / 2
      const y = row * cell + cell / 2
      if (isRevealed(mask, x, y)) cells[row * next.cols + col] = 1
    }
  }
  return fromCells(cells, cell, next.cols, next.rows)
}

function shapeBounds(shape: FogShape): { minX: number; minY: number; maxX: number; maxY: number } {
  switch (shape.kind) {
    case 'circle':
      return {
        minX: shape.x - shape.radius,
        minY: shape.y - shape.radius,
        maxX: shape.x + shape.radius,
        maxY: shape.y + shape.radius,
      }
    case 'rect':
      return {
        minX: Math.min(shape.x, shape.x + shape.width),
        minY: Math.min(shape.y, shape.y + shape.height),
        maxX: Math.max(shape.x, shape.x + shape.width),
        maxY: Math.max(shape.y, shape.y + shape.height),
      }
    case 'poly': {
      const xs = shape.points.map((p) => p.x)
      const ys = shape.points.map((p) => p.y)
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      }
    }
  }
}

function containsPoint(shape: FogShape, x: number, y: number): boolean {
  switch (shape.kind) {
    case 'circle': {
      const dx = x - shape.x
      const dy = y - shape.y
      return dx * dx + dy * dy <= shape.radius * shape.radius
    }
    case 'rect': {
      const b = shapeBounds(shape)
      return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY
    }
    case 'poly':
      return pointInPolygon(shape.points, x, y)
  }
}

/** Standard ray-crossing test. */
function pointInPolygon(points: { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!
    const b = points[j]!
    const straddles = a.y > y !== b.y > y
    if (straddles && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
