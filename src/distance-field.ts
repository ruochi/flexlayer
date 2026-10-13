const EDT_INF = 1e20

/** Felzenszwalb 一维平方距离变换。墨迹膨胀、描边和玻璃共用。 */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -EDT_INF
  z[1] = EDT_INF
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    while (s <= z[k]!) {
      k--
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = EDT_INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    const dq = q - v[k]!
    d[q] = dq * dq + f[v[k]!]!
  }
}

/** 种子为 0、其余为 EDT_INF 的网格，原地写成到最近种子的平方距离。 */
function edt2d(grid: Float64Array, w: number, h: number) {
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]!
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]!
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]!
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x]!
  }
}

/**
 * 每个像素到最近种子的欧氏距离。
 * bias 从开方结果里减去：玻璃用 0.5，让距离落到像素边界而不是像素中心。
 */
export function distanceToSites(isSite: (index: number) => boolean, w: number, h: number, bias = 0): Float32Array {
  const grid = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) grid[i] = isSite(i) ? 0 : EDT_INF
  edt2d(grid, w, h)
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const g = grid[i]!
    out[i] = g > 0 ? Math.max(0, Math.sqrt(g) - bias) : 0
  }
  return out
}

/** 墨迹内部每个像素到最近墨迹边缘的欧氏距离（设备像素） */
export function inkDistanceField(maskData: Uint8ClampedArray, w: number, h: number): Float32Array {
  return distanceToSites((i) => maskData[i * 4 + 3]! < 128, w, h, 0.5)
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x >= edge1 ? 1 : 0
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** 描边环带。d 为到墨迹边界的距离；在 outer 处约 1px 做 smoothstep。 */
export function bandCoverage(d: number, inner: number, outer: number): number {
  if (!(outer > inner) || d <= 0 || d >= outer + 0.5) return 0
  const outerA = 1 - smoothstep(outer - 0.5, outer + 0.5, d)
  const innerA = inner <= 0 ? 1 : smoothstep(inner - 0.5, inner + 0.5, d)
  return outerA * innerA
}
