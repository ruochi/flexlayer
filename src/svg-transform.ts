/** SVG 变换矩阵。点按列向量，矩阵是 [a c e; b d f]。 */

export type SvgMatrix = { a: number; b: number; c: number; d: number; e: number; f: number }

export const IDENTITY: SvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export function multiply(left: SvgMatrix, right: SvgMatrix): SvgMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

export function applyPoint(m: SvgMatrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
}

export function boundsOf(m: SvgMatrix, box: { x: number; y: number; width: number; height: number }) {
  const pts = [
    applyPoint(m, box.x, box.y),
    applyPoint(m, box.x + box.width, box.y),
    applyPoint(m, box.x + box.width, box.y + box.height),
    applyPoint(m, box.x, box.y + box.height),
  ]
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}

function translate(tx: number, ty: number): SvgMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }
}

function scale(sx: number, sy: number): SvgMatrix {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }
}

function rotate(angleDeg: number, cx = 0, cy = 0): SvgMatrix {
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const r: SvgMatrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
  if (cx === 0 && cy === 0) return r
  return multiply(multiply(translate(cx, cy), r), translate(-cx, -cy))
}

function fromArgs(name: string, nums: number[]): SvgMatrix | null {
  if (name === 'translate' && (nums.length === 1 || nums.length === 2)) return translate(nums[0]!, nums[1] ?? 0)
  if (name === 'scale' && (nums.length === 1 || nums.length === 2)) return scale(nums[0]!, nums[1] ?? nums[0]!)
  if (name === 'rotate' && (nums.length === 1 || nums.length === 3)) return rotate(nums[0]!, nums[1] ?? 0, nums[2] ?? 0)
  if (name === 'matrix' && nums.length === 6) {
    return { a: nums[0]!, b: nums[1]!, c: nums[2]!, d: nums[3]!, e: nums[4]!, f: nums[5]! }
  }
  return null
}

/** 从左到右读函数，作用顺序是从右到左，和 SVG 一致。 */
export function parseSvgTransform(raw: string | undefined): { matrix: SvgMatrix; error?: string } {
  const text = (raw ?? '').trim()
  if (!text) return { matrix: IDENTITY }
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g
  const parts: SvgMatrix[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const between = text.slice(last, match.index).trim()
    if (between && between !== ',') return { matrix: IDENTITY, error: raw }
    last = match.index + match[0].length
    const body = match[2]!.trim()
    const nums = body === '' ? [] : body.split(/[\s,]+/).map(Number)
    if (nums.some((n) => !Number.isFinite(n))) return { matrix: IDENTITY, error: raw }
    const part = fromArgs(match[1]!.toLowerCase(), nums)
    if (!part) return { matrix: IDENTITY, error: raw }
    parts.push(part)
  }
  if (text.slice(last).trim()) return { matrix: IDENTITY, error: raw }
  let matrix = IDENTITY
  for (const part of parts) matrix = multiply(matrix, part)
  return { matrix }
}
