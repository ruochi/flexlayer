import { parseNumber } from './style.js'
import type { BoxEdge, CylinderRim } from './types.js'
// Thin wrapper - uses host-injected addon in sandbox, direct import otherwise
import { getNativeAddon } from './native-loader.mjs'
const addon = await getNativeAddon()

/**
 * 棱上的圆角。`rx` 是半径，`round` 选择哪些棱。
 * 长方体：没写 `round` 时 12 条都圆。圆柱：没写 `round` 时上下两个圆口都圆。
 * 圆角和相邻的平面相切，布局盒子不变。
 */

export type RoundIssue = { message: string; hint: string }

type Axis = 'x' | 'y' | 'z'

type EdgeRec = { id: BoxEdge; axis: Axis; sx: number; sy: number; sz: number }

const AXES: Axis[] = ['x', 'y', 'z']

export const BOX_EDGES: readonly BoxEdge[] = [
  'front-top',
  'front-bottom',
  'front-left',
  'front-right',
  'back-top',
  'back-bottom',
  'back-left',
  'back-right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]

const EDGE_TABLE: readonly EdgeRec[] = [
  { id: 'front-top', axis: 'x', sx: 0, sy: 1, sz: 1 },
  { id: 'front-bottom', axis: 'x', sx: 0, sy: -1, sz: 1 },
  { id: 'back-top', axis: 'x', sx: 0, sy: 1, sz: -1 },
  { id: 'back-bottom', axis: 'x', sx: 0, sy: -1, sz: -1 },
  { id: 'front-right', axis: 'y', sx: 1, sy: 0, sz: 1 },
  { id: 'front-left', axis: 'y', sx: -1, sy: 0, sz: 1 },
  { id: 'back-right', axis: 'y', sx: 1, sy: 0, sz: -1 },
  { id: 'back-left', axis: 'y', sx: -1, sy: 0, sz: -1 },
  { id: 'top-right', axis: 'z', sx: 1, sy: 1, sz: 0 },
  { id: 'top-left', axis: 'z', sx: -1, sy: 1, sz: 0 },
  { id: 'bottom-right', axis: 'z', sx: 1, sy: -1, sz: 0 },
  { id: 'bottom-left', axis: 'z', sx: -1, sy: -1, sz: 0 },
]

const EDGE_BY_ID = new Map(EDGE_TABLE.map((edge) => [edge.id, edge]))

const GROUPS: Record<string, readonly BoxEdge[]> = {
  all: BOX_EDGES,
  x: ['front-top', 'front-bottom', 'back-top', 'back-bottom'],
  y: ['front-left', 'front-right', 'back-left', 'back-right'],
  z: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  front: ['front-top', 'front-bottom', 'front-left', 'front-right'],
  back: ['back-top', 'back-bottom', 'back-left', 'back-right'],
  left: ['front-left', 'back-left', 'top-left', 'bottom-left'],
  right: ['front-right', 'back-right', 'top-right', 'bottom-right'],
  top: ['front-top', 'back-top', 'top-left', 'top-right'],
  bottom: ['front-bottom', 'back-bottom', 'bottom-left', 'bottom-right'],
}

const BOX_HINT = '可用 all、x、y、z、front、back、left、right、top、bottom，或 front-top 这种棱'
const CYLINDER_HINT = '口缘用 top、bottom 或 all。不写 round 时上下都圆'

function formatPx(n: number) {
  const rounded = Math.round(n * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

function tokensOf(raw: string | undefined): string[] | null {
  if (raw == null || raw.trim() === '') return null
  return raw
    .split(/[\s,]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)
}

function xEdge(sy: number, sz: number): BoxEdge {
  if (sz > 0) return sy > 0 ? 'front-top' : 'front-bottom'
  return sy > 0 ? 'back-top' : 'back-bottom'
}

function yEdge(sx: number, sz: number): BoxEdge {
  if (sz > 0) return sx > 0 ? 'front-right' : 'front-left'
  return sx > 0 ? 'back-right' : 'back-left'
}

function zEdge(sx: number, sy: number): BoxEdge {
  if (sy > 0) return sx > 0 ? 'top-right' : 'top-left'
  return sx > 0 ? 'bottom-right' : 'bottom-left'
}

function edgeAlong(axis: Axis, sx: number, sy: number, sz: number): BoxEdge {
  if (axis === 'x') return xEdge(sy, sz)
  if (axis === 'y') return yEdge(sx, sz)
  return zEdge(sx, sy)
}

function pairEdge(a: string, b: string): BoxEdge | null {
  const z = a === 'front' || a === 'back' ? a : b === 'front' || b === 'back' ? b : null
  const y = a === 'top' || a === 'bottom' ? a : b === 'top' || b === 'bottom' ? b : null
  const x = a === 'left' || a === 'right' ? a : b === 'left' || b === 'right' ? b : null
  const hits = [z, y, x].filter((item) => item != null).length
  if (hits !== 2 || (z && y && x)) return null
  if (z && y) return xEdge(y === 'top' ? 1 : -1, z === 'front' ? 1 : -1)
  if (z && x) return yEdge(x === 'right' ? 1 : -1, z === 'front' ? 1 : -1)
  if (x && y) return zEdge(x === 'right' ? 1 : -1, y === 'top' ? 1 : -1)
  return null
}

function tokenEdges(token: string): readonly BoxEdge[] | null {
  const group = GROUPS[token]
  if (group) return group
  const parts = token.split('-')
  if (parts.length !== 2) return null
  const edge = pairEdge(parts[0]!, parts[1]!)
  return edge ? [edge] : null
}

function positiveRadius(raw: string | undefined, issues: RoundIssue[]): number | null {
  if (raw == null || raw.trim() === '') return null
  const parsed = parseNumber(raw)
  if (parsed == null || !(parsed > 0)) {
    issues.push({ message: `无法解析 rx: ${raw}`, hint: '写成正的像素半径，例如 rx="12"' })
    return null
  }
  return parsed
}

function maxBoxRadius(width: number, height: number, depth: number, edges: ReadonlySet<BoxEdge>): number {
  const half = { x: width / 2, y: height / 2, z: depth / 2 }
  let limit = Infinity
  for (const id of edges) {
    const edge = EDGE_BY_ID.get(id)
    if (!edge) continue
    for (const axis of AXES) {
      if (axis !== edge.axis) limit = Math.min(limit, half[axis])
    }
    let insets = 0
    for (const end of [-1, 1]) {
      const signs = {
        x: edge.axis === 'x' ? end : edge.sx,
        y: edge.axis === 'y' ? end : edge.sy,
        z: edge.axis === 'z' ? end : edge.sz,
      }
      const others = AXES.filter((axis) => axis !== edge.axis)
      if (others.some((axis) => edges.has(edgeAlong(axis, signs.x, signs.y, signs.z)))) insets++
    }
    if (insets > 0) limit = Math.min(limit, (half[edge.axis] * 2) / insets)
  }
  return Number.isFinite(limit) ? Math.max(0, limit) : 0
}

/** 解析 box 的 rx / round。rx 为 0 或 edges 为空时保持直角。 */
export function readBoxFillet(
  rxRaw: string | undefined,
  roundRaw: string | undefined,
  width: number,
  height: number,
  depth: number,
): { rx: number; edges: BoxEdge[]; issues: RoundIssue[] } {
  const issues: RoundIssue[] = []
  const tokens = tokensOf(roundRaw)
  const rx = positiveRadius(rxRaw, issues)
  if (rx == null) {
    if (tokens) {
      issues.push({
        message: 'box 写了 round 但没有正的 rx，圆角不生效',
        hint: '例如 rx="12" round="front"',
      })
    }
    return { rx: 0, edges: [], issues }
  }
  const selected = new Set<BoxEdge>()
  if (!tokens) {
    for (const edge of BOX_EDGES) selected.add(edge)
  } else {
    for (const token of tokens) {
      const edges = tokenEdges(token)
      if (!edges) {
        issues.push({ message: `box 的 round 不认识「${token}」`, hint: BOX_HINT })
        continue
      }
      for (const edge of edges) selected.add(edge)
    }
  }
  const edges = BOX_EDGES.filter((edge) => selected.has(edge))
  if (edges.length === 0) {
    issues.push({ message: 'box 的 round 没有选中棱，圆角不生效', hint: BOX_HINT })
    return { rx: 0, edges: [], issues }
  }
  const limit = maxBoxRadius(width, height, depth, selected)
  if (rx > limit + 1e-6) {
    issues.push({
      message: `box 的 rx 放不下，已从 ${formatPx(rx)} 收到 ${formatPx(limit)}`,
      hint: '半径不能大于相邻棱能让开的距离',
    })
    return { rx: limit, edges, issues }
  }
  return { rx, edges, issues }
}

/** 解析 cylinder 的 rx / round。圆的是上下两个圆口。 */
export function readCylinderFillet(
  rxRaw: string | undefined,
  roundRaw: string | undefined,
  radius: number,
  height: number,
): { rx: number; rims: CylinderRim[]; issues: RoundIssue[] } {
  const issues: RoundIssue[] = []
  const tokens = tokensOf(roundRaw)
  const rx = positiveRadius(rxRaw, issues)
  if (rx == null) {
    if (tokens) {
      issues.push({
        message: 'cylinder 写了 round 但没有正的 rx，圆角不生效',
        hint: '例如 rx="12" round="top"',
      })
    }
    return { rx: 0, rims: [], issues }
  }
  const selected = new Set<CylinderRim>()
  if (!tokens) {
    selected.add('top')
    selected.add('bottom')
  } else {
    for (const token of tokens) {
      if (token === 'all') {
        selected.add('top')
        selected.add('bottom')
      } else if (token === 'top' || token === 'bottom') {
        selected.add(token)
      } else {
        issues.push({ message: `cylinder 的 round 不认识「${token}」`, hint: CYLINDER_HINT })
      }
    }
  }
  const rims: CylinderRim[] = (['top', 'bottom'] as const).filter((rim) => selected.has(rim))
  if (rims.length === 0) {
    issues.push({ message: 'cylinder 的 round 没有选中口缘，圆角不生效', hint: CYLINDER_HINT })
    return { rx: 0, rims: [], issues }
  }
  const along = rims.length === 2 ? height / 2 : height
  const limit = Math.max(0, Math.min(radius, along))
  if (rx > limit + 1e-6) {
    issues.push({
      message: `cylinder 的 rx 放不下，已从 ${formatPx(rx)} 收到 ${formatPx(limit)}`,
      hint: '要小于 r；两端都圆时还不能大于 height 的一半',
    })
    return { rx: limit, rims, issues }
  }
  return { rx, rims, issues }
}

/** 直角盒子在 rx 为 0 时不走这里。坐标以盒子中心为原点，y 向上。 */
export function roundedBoxGeometry(
  hw: number,
  hh: number,
  hd: number,
  rx: number,
  edges: readonly BoxEdge[],
): { positions: number[]; normals: number[]; indices: number[] } {
  if (!addon) throw new Error('Native mesh-round addon not loaded - cannot call roundedBoxGeometry')
  
  const result = addon.roundedBoxGeometry(hw, hh, hd, rx, Array.from(edges))
  return {
    positions: Array.from(result.positions),
    normals: Array.from(result.normals),
    indices: Array.from(result.indices),
  }
}

/** 竖直圆柱。rx 圆掉选中的口，侧面半径仍是 radius。 */
export function roundedCylinderGeometry(
  radius: number,
  half: number,
  rx: number,
  rims: readonly CylinderRim[],
): { positions: number[]; normals: number[]; indices: number[] } {
  if (!addon) throw new Error('Native mesh-round addon not loaded - cannot call roundedCylinderGeometry')
  
  const result = addon.roundedCylinderGeometry(radius, half, rx, Array.from(rims))
  return {
    positions: Array.from(result.positions),
    normals: Array.from(result.normals),
    indices: Array.from(result.indices),
  }
}
