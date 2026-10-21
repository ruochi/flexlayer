export type CurvePoint = { x: number; y: number }

function num(n: number): string {
  const rounded = Math.round(n * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/**
 * Catmull-Rom 穿过每个点，再写成三次贝塞尔。
 * 开口曲线在两端复制端点；闭合曲线绕回起点。
 * 只有两个点时是直线。
 */
export function catmullRomPath(points: CurvePoint[], closed: boolean): string {
  if (points.length < 2) return ''
  const n = points.length
  const first = points[0]!
  if (n === 2) {
    const second = points[1]!
    const line = `M ${num(first.x)} ${num(first.y)} L ${num(second.x)} ${num(second.y)}`
    return closed ? `${line} Z` : line
  }
  const at = (index: number) => {
    if (closed) return points[((index % n) + n) % n]!
    return points[Math.max(0, Math.min(n - 1, index))]!
  }
  let d = `M ${num(first.x)} ${num(first.y)}`
  const count = closed ? n : n - 1
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(p2.x)} ${num(p2.y)}`
  }
  if (closed) d += ' Z'
  return d
}
