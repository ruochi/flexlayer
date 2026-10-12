export type Box = { x: number; y: number; width: number; height: number }

/** 图片像素。点在要留下的那一块上。 */
export type KeepPoint = { x: number; y: number }

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
   * 要点中的主体，可以多个。不传就从伸进远处的尖往下长。
   * 多个点取最近和最远。一个点落在远处的尖上时，近端放到地面以上，把楼身补上。
   */
  points?: KeepPoint[]
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
function keepNear(matte: Uint8ClampedArray, depth: Uint8ClampedArray): Uint8ClampedArray {
  const inside: number[] = []
  for (let i = 0; i < matte.length; i++) {
    if (matte[i]! < 128) continue
    inside.push(depth[i]!)
  }
  const alpha = new Uint8ClampedArray(matte.length)
  if (inside.length === 0) return alpha
  const threshold = otsu(inside)
  const soft = 6
  for (let i = 0; i < matte.length; i++) {
    const t = Math.min(1, Math.max(0, (depth[i]! - (threshold - soft)) / (soft * 2)))
    alpha[i] = clampByte(matte[i]! * t)
  }
  return alpha
}

/** 选区里，深度落在这段里的留下。两端各留 6 级软边。 */
function keepBand(matte: Uint8ClampedArray, depth: Uint8ClampedArray, floor: number, cap: number): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(matte.length)
  const soft = 6
  for (let i = 0; i < matte.length; i++) {
    const value = depth[i]!
    const into = Math.min(1, Math.max(0, (value - (floor - soft)) / (soft * 2)))
    const outof = Math.min(1, Math.max(0, (cap + soft - value) / (soft * 2)))
    alpha[i] = clampByte(matte[i]! * into * outof)
  }
  return alpha
}

function pixelOf(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return {
    x: Math.min(width - 1, Math.max(0, Math.floor(x))),
    y: Math.min(height - 1, Math.max(0, Math.floor(y))),
  }
}

/**
 * 点击处的深度。周围 5×5 里，和中心差过 24 的细边不算进来。
 * 中心自己落在缝上、和周围差太多时，用周围的中位数，免得点到一条天空。
 */
function depthAt(depth: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
  const centerPx = pixelOf(x, y, width, height)
  const center = depth[centerPx.y * width + centerPx.x]!
  const window: number[] = []
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = centerPx.x + dx
      const ny = centerPx.y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      window.push(depth[ny * width + nx]!)
    }
  }
  const mid = median(window)
  if (Math.abs(center - mid) > 24) return mid
  const close = window.filter((value) => Math.abs(value - center) <= 24)
  return median(close)
}

function bandOf(samples: number[]): { floor: number; cap: number } {
  let near = 0
  let far = 255
  for (const value of samples) {
    if (value > near) near = value
    if (value < far) far = value
  }
  const pad = Math.max(12, (near - far) * 0.12)
  return { floor: Math.max(0, far - pad), cap: Math.min(255, near + pad) }
}

/** 画面最下面一截的深度，和天际线那条一样取样。 */
function groundDepth(depth: Uint8ClampedArray, width: number, height: number): number {
  const groundBand: number[] = []
  const groundStart = Math.floor(height * 0.88)
  const step = Math.max(1, Math.floor(width / 32))
  for (let y = groundStart; y < height; y++) {
    for (let x = 0; x < width; x += step) groundBand.push(depth[y * width + x]!)
  }
  return median(groundBand)
}

/**
 * 多个点：远近取这些点里最近和最远。
 * 一个点落在远处的尖上时，只留 ±12 会切出一圈等高线，楼身更近、落在圈外面。
 * 近端放到地面以上（地面深度的 0.72），把连在一起的楼身补上。点已经靠近地面时不放宽。
 */
function bandFor(depth: Uint8ClampedArray, width: number, height: number, points: KeepPoint[]): { floor: number; cap: number } {
  const samples = points.map((point) => depthAt(depth, width, height, point.x, point.y))
  const band = bandOf(samples)
  if (points.length !== 1) return band
  const ground = groundDepth(depth, width, height)
  const skyCut = Math.max(8, ground * 0.16)
  const seed = samples[0]!
  const nearCut = ground * 0.72
  if (seed > skyCut && band.cap < nearCut) return { floor: band.floor, cap: Math.min(255, nearCut) }
  return band
}

function growFromSkyline(depth: Uint8ClampedArray, width: number, height: number): Uint8Array | null {
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

  const cap = ground * 0.72
  const floor = Math.max(skyCut, cap * 0.45)
  const margin = Math.max(8, ground * 0.1)
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
  let count = 0
  for (let i = 0; i < n; i++) count += grown[i]!
  if (count < Math.max(8, n * 0.002)) return null
  return grown
}

/** 从点下去的地方长出遮罩。只走深度落在这段里的、和点连着的像素。 */
function growFromPoints(depth: Uint8ClampedArray, width: number, height: number, points: KeepPoint[]): Uint8Array | null {
  const n = width * height
  const { floor, cap } = bandFor(depth, width, height, points)
  const grown = new Uint8Array(n)
  const stack = new Int32Array(n)
  let head = 0
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = y * width + x
    if (grown[i]) return
    const value = depth[i]!
    if (value < floor || value > cap) return
    grown[i] = 1
    stack[head++] = i
  }
  for (const point of points) {
    const pixel = pixelOf(point.x, point.y, width, height)
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) push(pixel.x + dx, pixel.y + dy)
    }
  }
  while (head > 0) {
    const i = stack[--head]!
    const x = i % width
    const y = (i / width) | 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        push(x + dx, y + dy)
      }
    }
  }
  let count = 0
  for (let i = 0; i < n; i++) count += grown[i]!
  if (count < Math.max(8, n * 0.002)) return null
  return grown
}

function paintMask(grown: Uint8Array | null, width: number, height: number): Uint8ClampedArray {
  const n = width * height
  const alpha = new Uint8ClampedArray(n)
  if (!grown) return alpha
  const hard = new Float32Array(n)
  for (let i = 0; i < n; i++) hard[i] = grown[i] ? 255 : 0
  const soft = blurGray(hard, width, height, 1)
  for (let i = 0; i < n; i++) alpha[i] = clampByte(soft[i]!)
  return alpha
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
  const points = input.points ?? []
  if (depth.length !== n) throw new Error('深度图和图片不一样大')
  if (input.matte && input.matte.length !== n) throw new Error('选区和图片不一样大')
  for (const point of points) {
    if (!(Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.y >= 0 && point.x < width && point.y < height)) {
      throw new Error('点要落在图片里面')
    }
  }

  let alpha: Uint8ClampedArray
  if (input.matte && points.length > 0) {
    const band = bandFor(depth, width, height, points)
    alpha = keepBand(input.matte, depth, band.floor, band.cap)
  } else if (input.matte) {
    alpha = keepNear(input.matte, depth)
  } else if (points.length > 0) {
    alpha = paintMask(growFromPoints(depth, width, height, points), width, height)
  } else {
    alpha = paintMask(growFromSkyline(depth, width, height), width, height)
  }

  const box = bounds(alpha, width, height)
  if (!box) alpha = new Uint8ClampedArray(n)
  return { flat: box == null, alpha, box }
}
