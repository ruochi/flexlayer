import { serializeSvgPath } from './path.js'
import type { Box } from './types.js'

/** 不低于这个值算实心。碎片、洞和轮廓都按它切。 */
export const SOLID = 128
const SOFT_LOW = 8
const SOFT_HIGH = 247

export function round(n: number, digits: number): number {
  const k = 10 ** digits
  const rounded = Math.round(n * k) / k
  return Object.is(rounded, -0) ? 0 : rounded
}

export type BitmapSummary = {
  /** 所有值之和除以 255，等于折算后的不透明像素数。 */
  coverage: number
  /** 值大于 0 的外接矩形，位图像素。全为 0 时是 null。 */
  ink: Box | null
  /** 软边的平均宽度，位图像素。半透明像素数除以实心区域的边界长度，贴着四边的不算边界。 */
  softEdge: number
}

export function summarize(values: Uint8ClampedArray, width: number, height: number, solid = SOLID): BitmapSummary {
  let sum = 0
  let soft = 0
  let boundary = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x
      const a = values[at]!
      if (a === 0) continue
      sum += a
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (a >= SOFT_LOW && a <= SOFT_HIGH) soft += 1
      if (a < solid) continue
      const open =
        (x > 0 && values[at - 1]! < solid) ||
        (x < width - 1 && values[at + 1]! < solid) ||
        (y > 0 && values[at - width]! < solid) ||
        (y < height - 1 && values[at + width]! < solid)
      if (open) boundary += 1
    }
  }
  return {
    coverage: sum / 255,
    ink: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    softEdge: boundary > 0 ? soft / boundary : 0,
  }
}

export type BitmapPart = {
  /** 实心像素数。 */
  pixels: number
  /** 外接矩形，位图像素。 */
  box: Box
}

/** 实心像素的八连通块，按像素数从大到小。 */
export function labelParts(values: Uint8ClampedArray, width: number, height: number, solid = SOLID): BitmapPart[] {
  const seen = new Uint8Array(values.length)
  const stack = new Int32Array(values.length)
  const parts: BitmapPart[] = []
  for (let start = 0; start < values.length; start++) {
    if (seen[start] || values[start]! < solid) continue
    let pixels = 0
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    let top = 0
    stack[top++] = start
    seen[start] = 1
    while (top > 0) {
      const at = stack[--top]!
      const x = at % width
      const y = (at - x) / width
      pixels += 1
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue
          const next = ny * width + nx
          if (seen[next] || values[next]! < solid) continue
          seen[next] = 1
          stack[top++] = next
        }
      }
    }
    parts.push({ pixels, box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } })
  }
  return parts.sort((a, b) => b.pixels - a.pixels)
}

type Pt = [number, number]

export type Contour = {
  points: Pt[]
  /** 外圈为正，洞为负。y 向下。 */
  area: number
}

function signedArea(points: Pt[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!
    const [x1, y1] = points[(i + 1) % points.length]!
    sum += x0 * y1 - x1 * y0
  }
  return sum / 2
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

function simplifyOpen(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const spans: Array<[number, number]> = [[0, points.length - 1]]
  while (spans.length) {
    const [from, to] = spans.pop()!
    let worst = -1
    let far = 0
    for (let i = from + 1; i < to; i++) {
      const d = distanceToSegment(points[i]!, points[from]!, points[to]!)
      if (d > far) {
        far = d
        worst = i
      }
    }
    if (worst >= 0 && far > tolerance) {
      keep[worst] = 1
      spans.push([from, worst], [worst, to])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** 闭合折线：从离起点最远的点切成两段，各自化简再接回去。 */
function simplifyClosed(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 3 || tolerance <= 0) return points
  let far = 0
  let split = 0
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i]![0] - points[0]![0], points[i]![1] - points[0]![1])
    if (d > far) {
      far = d
      split = i
    }
  }
  if (split === 0) return points
  const first = simplifyOpen(points.slice(0, split + 1), tolerance)
  const second = simplifyOpen([...points.slice(split), points[0]!], tolerance)
  return [...first.slice(0, -1), ...second.slice(0, -1)]
}

// 格点在像素中心，四周补一圈 0，轮廓总能闭合。四个角：左上 8、右上 4、右下 2、左下 1。
const CORNER_EDGES: Array<[number, number]> = [
  [0, 3],
  [0, 1],
  [1, 2],
  [2, 3],
]

/**
 * 移动方块描出实心区域的轮廓，交点按值线性插值。对角相连的两个实心像素算连在一起，和八连通块一致。
 * 坐标是位图像素，原点在左上角。`tolerance` 是化简允许偏离的像素。
 */
export function traceContours(values: Uint8ClampedArray, width: number, height: number, solid = SOLID, tolerance = 0.5): Contour[] {
  const cols = width + 2
  const rows = height + 2
  const at = (i: number, j: number) => (i <= 0 || j <= 0 || i > width || j > height ? 0 : values[(j - 1) * width + (i - 1)]!)
  // 边编号：横边 (i, j)→(i+1, j) 是偶数，竖边 (i, j)→(i, j+1) 是奇数
  const hEdge = (i: number, j: number) => (j * cols + i) * 2
  const vEdge = (i: number, j: number) => (j * cols + i) * 2 + 1
  const next = new Map<number, number>()
  const position = (edge: number): Pt => {
    const vertical = edge & 1
    const node = edge >> 1
    const i = node % cols
    const j = (node - i) / cols
    const a = at(i, j)
    const b = vertical ? at(i, j + 1) : at(i + 1, j)
    const t = a === b ? 0.5 : (solid - 0.5 - a) / (b - a)
    const k = Math.max(0, Math.min(1, t))
    return vertical ? [i - 0.5, j - 0.5 + k] : [i - 0.5 + k, j - 0.5]
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const tl = at(i, j) >= solid
      const tr = at(i + 1, j) >= solid
      const br = at(i + 1, j + 1) >= solid
      const bl = at(i, j + 1) >= solid
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0)
      if (code === 0 || code === 15) continue
      const edges = [hEdge(i, j), vEdge(i + 1, j), hEdge(i, j + 1), vEdge(i, j)]
      const corners: Pt[] = [
        [i - 0.5, j - 0.5],
        [i + 0.5, j - 0.5],
        [i + 0.5, j + 0.5],
        [i - 0.5, j + 0.5],
      ]
      const solidCorner = [tl, tr, br, bl]
      const link = (e0: number, e1: number, toward: Pt) => {
        const p = position(e0)
        const q = position(e1)
        const cross = (q[0] - p[0]) * (toward[1] - p[1]) - (q[1] - p[1]) * (toward[0] - p[0])
        if (cross >= 0) next.set(e0, e1)
        else next.set(e1, e0)
      }
      if (code === 5 || code === 10) {
        // 鞍点：两个实心角总连在一起，各切掉一个空角
        for (let c = 0; c < 4; c++) {
          if (solidCorner[c]) continue
          const [ea, eb] = CORNER_EDGES[c]!
          link(edges[ea]!, edges[eb]!, corners[(c + 2) % 4]!)
        }
        continue
      }
      const crossing: number[] = []
      for (let e = 0; e < 4; e++) {
        if (solidCorner[e] !== solidCorner[(e + 1) % 4]) crossing.push(e)
      }
      const toward = corners[solidCorner.indexOf(true)]!
      link(edges[crossing[0]!]!, edges[crossing[1]!]!, toward)
    }
  }
  const contours: Contour[] = []
  const visited = new Set<number>()
  for (const start of next.keys()) {
    if (visited.has(start)) continue
    const points: Pt[] = []
    let edge: number | undefined = start
    while (edge != null && !visited.has(edge)) {
      visited.add(edge)
      points.push(position(edge))
      edge = next.get(edge)
    }
    if (points.length < 3) continue
    const simple = simplifyClosed(points, tolerance)
    if (simple.length < 3) continue
    contours.push({ points: simple, area: signedArea(simple) })
  }
  return contours
}

/** 每条轮廓一段 M…Z。外圈和洞的绕向相反，按默认的 nonzero 填充也能留出洞。 */
export function contoursToPath(contours: Contour[], scale = 1, digits = 2): string {
  const commands: Array<{ op: string; args: number[] }> = []
  for (const contour of contours) {
    contour.points.forEach(([x, y], i) => {
      commands.push({ op: i === 0 ? 'M' : 'L', args: [round(x / scale, digits), round(y / scale, digits)] })
    })
    commands.push({ op: 'Z', args: [] })
  }
  return serializeSvgPath(commands)
}
