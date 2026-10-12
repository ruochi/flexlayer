export type Box = { x: number; y: number; width: number; height: number }

export type SplitInput = {
  /** 0 最远，255 最近，和图片一样大。 */
  depth: Uint8ClampedArray
  width: number
  height: number
  /**
   * 抠图模型的选区。有的话边用它，深度只把远处粘上来的部分去掉。
   * 不传就只按深度，从伸进远处的尖往下长。
   */
  matte?: Uint8ClampedArray
  /**
   * 前景收到多远，0 到 1，默认 0.5。
   * 调大遮罩变大，调小只留更靠近镜头的一段。
   */
  front?: number
}

export type SplitResult = {
  /** 没有一块东西伸进远处。遮罩是空的。 */
  flat: boolean
  /** 前景遮罩，0 到 255。 */
  alpha: Uint8ClampedArray
  /** 前景外接矩形。flat 时是 null。 */
  box: Box | null
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const copy = values.slice().sort((a, b) => a - b)
  return copy[copy.length >> 1]!
}

function clampByte(n: number): number {
  if (n <= 0) return 0
  if (n >= 255) return 255
  return Math.round(n)
}

function blurGray(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const n = width * height
  const tmp = new Float32Array(n)
  const out = new Float32Array(n)
  const prefix = new Float64Array(width + 1)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) prefix[x + 1] = prefix[x]! + src[row + x]!
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      tmp[row + x] = (prefix[x1 + 1]! - prefix[x0]!) / (x1 - x0 + 1)
    }
  }
  const column = new Float64Array(height + 1)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) column[y + 1] = column[y]! + tmp[y * width + x]!
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - radius)
      const y1 = Math.min(height - 1, y + radius)
      out[y * width + x] = (column[y1 + 1]! - column[y0]!) / (y1 - y0 + 1)
    }
  }
  return out
}

function otsu(values: number[]): number {
  const hist = new Array<number>(256).fill(0)
  for (const value of values) hist[clampByte(value)]! += 1
  const total = values.length
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]!
  let background = 0
  let sumBackground = 0
  let best = 0
  let start = 0
  let end = 0
  for (let t = 0; t < 256; t++) {
    background += hist[t]!
    if (!background) continue
    const foreground = total - background
    if (!foreground) break
    sumBackground += t * hist[t]!
    const meanBackground = sumBackground / background
    const meanForeground = (sum - sumBackground) / foreground
    const between = background * foreground * (meanBackground - meanForeground) ** 2
    if (between > best + 1e-6) {
      best = between
      start = t
      end = t
    } else if (Math.abs(between - best) <= 1e-6) {
      end = t
    }
  }
  return Math.round((start + end) / 2)
}

/** 抠图选区里，按深度留下近的一块。远处粘上来的楼会掉下去，边还是抠图的边。 */
function keepNear(matte: Uint8ClampedArray, depth: Uint8ClampedArray, front: number): Uint8ClampedArray {
  const inside: number[] = []
  let lo = 255
  let hi = 0
  for (let i = 0; i < matte.length; i++) {
    if (matte[i]! < 128) continue
    const value = depth[i]!
    inside.push(value)
    if (value < lo) lo = value
    if (value > hi) hi = value
  }
  const alpha = new Uint8ClampedArray(matte.length)
  if (inside.length === 0) return alpha
  const cut = otsu(inside)
  const threshold = front >= 0.5
    ? cut + (lo - cut) * ((front - 0.5) / 0.5)
    : hi + (cut - hi) * (front / 0.5)
  const soft = 6
  for (let i = 0; i < matte.length; i++) {
    const t = Math.min(1, Math.max(0, (depth[i]! - (threshold - soft)) / (soft * 2)))
    alpha[i] = clampByte(matte[i]! * t)
  }
  return alpha
}

function growFromSkyline(depth: Uint8ClampedArray, width: number, height: number, front: number): Uint8Array | null {
  const n = width * height
  let lo = 255
  let hi = 0
  for (let i = 0; i < n; i++) {
    const value = depth[i]!
    if (value < lo) lo = value
    if (value > hi) hi = value
  }
  if (hi - lo < 24) return null

  const groundBand: number[] = []
  const groundStart = Math.floor(height * 0.88)
  const step = Math.max(1, Math.floor(width / 32))
  for (let y = groundStart; y < height; y++) {
    for (let x = 0; x < width; x += step) groundBand.push(depth[y * width + x]!)
  }
  const ground = median(groundBand)
  const skyCut = Math.max(8, ground * 0.16)
  const horizon = new Int32Array(width).fill(height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (depth[y * width + x]! > skyCut) {
        horizon[x] = y
        break
      }
    }
  }
  const peak = Math.min(...horizon)
  const rise = median(Array.from(horizon)) - peak
  if (rise < Math.max(2, height * 0.03)) return null

  const window = Math.max(2, rise * 0.35)
  const seed = new Uint8Array(n)
  for (let x = 0; x < width; x++) {
    if (horizon[x]! > peak + window) continue
    const y1 = Math.min(height, horizon[x]! + Math.max(4, Math.round(height * 0.028)))
    for (let y = horizon[x]!; y < y1; y++) seed[y * width + x] = 1
  }

  const strip = Math.max(2, Math.round(width * 0.14))
  const rowFar = new Float32Array(height)
  for (let y = 0; y < height; y++) {
    const band: number[] = []
    for (let x = 0; x < strip; x++) band.push(depth[y * width + x]!)
    for (let x = width - strip; x < width; x++) band.push(depth[y * width + x]!)
    rowFar[y] = median(band)
  }

  const capMid = ground * 0.72
  const floorMid = Math.max(skyCut, capMid * 0.45)
  const marginMid = Math.max(8, ground * 0.1)
  const widen = Math.max(0, (front - 0.5) / 0.5)
  const cap = capMid + (hi - capMid) * widen
  const floor = floorMid + (skyCut - floorMid) * widen
  const margin = marginMid * (1 - widen)
  const grown = new Uint8Array(n)
  const stack = new Int32Array(n)
  let head = 0
  for (let i = 0; i < n; i++) if (seed[i]) { grown[i] = 1; stack[head++] = i }
  while (head > 0) {
    const i = stack[--head]!
    const x = i % width
    const y = (i / width) | 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const ni = ny * width + nx
        if (grown[ni]) continue
        const value = depth[ni]!
        if (value < floor || value > cap) continue
        if (value < rowFar[ny]! + margin) continue
        grown[ni] = 1
        stack[head++] = ni
      }
    }
  }
  if (front < 0.5) {
    let near = 0
    let far = 255
    let seen = 0
    for (let i = 0; i < n; i++) {
      if (!grown[i]) continue
      const value = depth[i]!
      if (value > near) near = value
      if (value < far) far = value
      seen += 1
    }
    if (seen > 0) {
      const cut = near - (front / 0.5) * (near - far)
      for (let i = 0; i < n; i++) if (grown[i] && depth[i]! < cut) grown[i] = 0
    }
  }
  let count = 0
  for (let i = 0; i < n; i++) count += grown[i]!
  if (count < Math.max(8, n * 0.002)) return null
  return grown
}

function bounds(alpha: Uint8ClampedArray, width: number, height: number): Box | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let area = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x]! < 128) continue
      area += 1
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (area < Math.max(8, width * height * 0.002)) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/**
 * 从远近图里取出前景遮罩。
 * 深度没有一块伸进远处时 `flat` 为真，遮罩是空的。
 */
export function splitLayers(input: SplitInput): SplitResult {
  const { depth, width, height } = input
  const n = width * height
  const front = input.front ?? 0.5
  if (!(front >= 0 && front <= 1)) throw new Error('front 要在 0 到 1 之间')
  if (depth.length !== n) throw new Error('深度图和图片不一样大')
  if (input.matte && input.matte.length !== n) throw new Error('选区和图片不一样大')

  let alpha: Uint8ClampedArray
  if (input.matte) {
    alpha = keepNear(input.matte, depth, front)
  } else {
    const grown = growFromSkyline(depth, width, height, front)
    alpha = new Uint8ClampedArray(n)
    if (grown) {
      const hard = new Float32Array(n)
      for (let i = 0; i < n; i++) hard[i] = grown[i] ? 255 : 0
      const soft = blurGray(hard, width, height, 1)
      for (let i = 0; i < n; i++) alpha[i] = clampByte(soft[i]!)
    }
  }

  const box = bounds(alpha, width, height)
  if (!box) alpha = new Uint8ClampedArray(n)
  return { flat: box == null, alpha, box }
}
