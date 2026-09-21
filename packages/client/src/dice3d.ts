/**
 * Actual dice: real polyhedra, rotated in three dimensions and projected.
 *
 * The previous tray drew a flat hexagon with a digit in the middle, which is a
 * shape with a number on it rather than a die. These are the real solids — a
 * tetrahedron, a cube, an octahedron, a pentagonal trapezohedron, a
 * dodecahedron, an icosahedron — so a d20 reads as a d20 from across the room
 * and tumbling shows facets catching the light.
 *
 * No library. Orthographic projection, back-face culling and flat shading are
 * a few dozen lines each, and a physics engine would be the wrong tool anyway:
 * the result is decided by the server before the animation starts, so the die
 * has to *land* on a given face. Easing an orientation is honest about that;
 * rigging a simulation to fake it would not be.
 */

export type Vec3 = readonly [number, number, number]
export interface Solid {
  vertices: Vec3[]
  /** Each face is a loop of vertex indices, wound counter-clockwise from outside. */
  faces: number[][]
}

const PHI = (1 + Math.sqrt(5)) / 2

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

const tetrahedron: Solid = {
  vertices: [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ],
  faces: [
    [0, 1, 2],
    [0, 3, 1],
    [0, 2, 3],
    [1, 3, 2],
  ],
}

const cube: Solid = {
  vertices: [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ],
  faces: [
    [4, 5, 6, 7],
    [1, 0, 3, 2],
    [0, 4, 7, 3],
    [5, 1, 2, 6],
    [7, 6, 2, 3],
    [0, 1, 5, 4],
  ],
}

const octahedron: Solid = {
  vertices: [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ],
  faces: [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ],
}

const icosahedron: Solid = (() => {
  const vertices: Vec3[] = [
    [0, 1, PHI],
    [0, -1, PHI],
    [0, 1, -PHI],
    [0, -1, -PHI],
    [1, PHI, 0],
    [-1, PHI, 0],
    [1, -PHI, 0],
    [-1, -PHI, 0],
    [PHI, 0, 1],
    [PHI, 0, -1],
    [-PHI, 0, 1],
    [-PHI, 0, -1],
  ]
  const faces = [
    [0, 1, 8],
    [0, 8, 4],
    [0, 4, 5],
    [0, 5, 10],
    [0, 10, 1],
    [1, 10, 7],
    [1, 7, 6],
    [1, 6, 8],
    [8, 6, 9],
    [8, 9, 4],
    [4, 9, 2],
    [4, 2, 5],
    [5, 2, 11],
    [5, 11, 10],
    [10, 11, 7],
    [3, 7, 11],
    [3, 11, 2],
    [3, 2, 9],
    [3, 9, 6],
    [3, 6, 7],
  ]
  return { vertices, faces }
})()

const dodecahedron: Solid = (() => {
  const inverse = 1 / PHI
  const vertices: Vec3[] = [
    [1, 1, 1],
    [1, 1, -1],
    [1, -1, 1],
    [1, -1, -1],
    [-1, 1, 1],
    [-1, 1, -1],
    [-1, -1, 1],
    [-1, -1, -1],
    [0, inverse, PHI],
    [0, inverse, -PHI],
    [0, -inverse, PHI],
    [0, -inverse, -PHI],
    [inverse, PHI, 0],
    [inverse, -PHI, 0],
    [-inverse, PHI, 0],
    [-inverse, -PHI, 0],
    [PHI, 0, inverse],
    [PHI, 0, -inverse],
    [-PHI, 0, inverse],
    [-PHI, 0, -inverse],
  ]
  const faces = [
    [0, 8, 10, 2, 16],
    [0, 16, 17, 1, 12],
    [0, 12, 14, 4, 8],
    [8, 4, 18, 6, 10],
    [10, 6, 15, 13, 2],
    [2, 13, 3, 17, 16],
    [1, 17, 3, 11, 9],
    [1, 9, 5, 14, 12],
    [14, 5, 19, 18, 4],
    [18, 19, 7, 15, 6],
    [15, 7, 11, 3, 13],
    [9, 11, 7, 19, 5],
  ]
  return { vertices, faces }
})()

/** A d10 is a pentagonal trapezohedron: two apexes and two offset rings of five. */
const trapezohedron10: Solid = (() => {
  const vertices: Vec3[] = [
    [0, 0, 1.4],
    [0, 0, -1.4],
  ]
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    vertices.push([Math.cos(a), Math.sin(a), 0.32])
  }
  for (let i = 0; i < 5; i++) {
    const a = ((i + 0.5) / 5) * Math.PI * 2
    vertices.push([Math.cos(a), Math.sin(a), -0.32])
  }

  const faces: number[][] = []
  for (let i = 0; i < 5; i++) {
    const upper = 2 + i
    const nextUpper = 2 + ((i + 1) % 5)
    const lower = 7 + i
    const prevLower = 7 + ((i + 4) % 5)
    faces.push([0, upper, lower, nextUpper])
    faces.push([1, nextUpper, lower, upper].reverse())
    void prevLower
  }
  return { vertices, faces }
})()

export function solidFor(sides: number): Solid {
  switch (sides) {
    case 4:
      return tetrahedron
    case 6:
      return cube
    case 8:
      return octahedron
    case 10:
    case 100:
      return trapezohedron10
    case 12:
      return dodecahedron
    default:
      return icosahedron
  }
}

// --- Face geometry -----------------------------------------------------------

export function faceCentroid(solid: Solid, face: number[]): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  for (const index of face) {
    const v = solid.vertices[index]!
    x += v[0]
    y += v[1]
    z += v[2]
  }
  return [x / face.length, y / face.length, z / face.length]
}

export function faceNormal(solid: Solid, face: number[]): Vec3 {
  // For these solids the centroid direction is the outward normal, which is
  // cheaper and steadier than a cross product on near-degenerate winding.
  return normalize(faceCentroid(solid, face))
}

// --- Quaternions -------------------------------------------------------------

export type Quat = readonly [number, number, number, number]

export const IDENTITY: Quat = [0, 0, 0, 1]

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const [x, y, z] = normalize(axis)
  const half = angle / 2
  const s = Math.sin(half)
  return [x * s, y * s, z * s, Math.cos(half)]
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  let end = b
  // Take the short way round, or a die can spin most of a turn to settle.
  if (dot < 0) {
    dot = -dot
    end = [-b[0], -b[1], -b[2], -b[3]]
  }
  if (dot > 0.9995) {
    return normalizeQuat([
      a[0] + (end[0] - a[0]) * t,
      a[1] + (end[1] - a[1]) * t,
      a[2] + (end[2] - a[2]) * t,
      a[3] + (end[3] - a[3]) * t,
    ])
  }
  const theta = Math.acos(dot)
  const sin = Math.sin(theta)
  const wa = Math.sin((1 - t) * theta) / sin
  const wb = Math.sin(t * theta) / sin
  return [a[0] * wa + end[0] * wb, a[1] * wa + end[1] * wb, a[2] * wa + end[2] * wb, a[3] * wa + end[3] * wb]
}

function normalizeQuat(q: Quat): Quat {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length]
}

export function rotate(v: Vec3, q: Quat): Vec3 {
  // v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
  const [x, y, z] = v
  const [qx, qy, qz, qw] = q
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)]
}

/**
 * The orientation that brings a face's normal to face the viewer, so a die can
 * be eased into showing the number the server already rolled.
 */
export function orientationShowing(normal: Vec3, roll = 0): Quat {
  const target: Vec3 = [0, 0, 1]
  const n = normalize(normal)
  const dot = n[0] * target[0] + n[1] * target[1] + n[2] * target[2]

  let base: Quat
  if (dot > 0.99999) {
    base = IDENTITY
  } else if (dot < -0.99999) {
    // Antipodal: any perpendicular axis will do for the half turn.
    base = quatFromAxisAngle([1, 0, 0], Math.PI)
  } else {
    const axis: Vec3 = [
      n[1] * target[2] - n[2] * target[1],
      n[2] * target[0] - n[0] * target[2],
      n[0] * target[1] - n[1] * target[0],
    ]
    base = quatFromAxisAngle(axis, Math.acos(Math.max(-1, Math.min(1, dot))))
  }

  // A little spin about the view axis so identical rolls don't look stamped.
  return quatMultiply(quatFromAxisAngle([0, 0, 1], roll), base)
}
