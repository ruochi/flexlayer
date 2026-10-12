export type Box = { x: number; y: number; width: number; height: number }

export type SplitInput = {
  rgba: Uint8ClampedArray
  /** 0 最远，255 最近，和图片一样大。 */
  depth: Uint8ClampedArray
  width: number
  height: number
  /**
   * 抠图模型的选区。有的话边用它，深度只把远处粘上来的部分去掉。
   * 不传就只按深度，从伸进远处的尖往下长。
   */
  matte?: Uint8ClampedArray
}

export type SplitResult = {
  /** 没有一块东西伸进远处，照片当一层。 */
  flat: boolean
  /** 主体选区，0 到 255。 */
  alpha: Uint8ClampedArray
  /** 主体。软边减过原来的背景色，alpha 是选区。 */
  subject: Uint8ClampedArray
  /** 净背景。主体的位置用周围的颜色填上，可以单独模糊。 */
  plate: Uint8ClampedArray
  sky: { y: number; height: number }
  subjectBox: Box | null
  spire: { x: number; y: number } | null
  /** 主体变宽到一半的那一行。没有主体是 null。 */
  roofY: number | null
  /** 每一列主体的顶边。这一列没有主体时等于图高。 */
  skyline: number[]
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

function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const n = width * height
  const tmp = new Uint8Array(n)
  const out = new Uint8Array(n)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      const row = y * width
      for (let xx = x0; xx <= x1; xx++) if (mask[row + xx]) { on = 1; break }
      tmp[row + x] = on
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let on = 0
      const y0 = Math.max(0, y - radius)
      const y1 = Math.min(height - 1, y + radius)
      for (let yy = y0; yy <= y1; yy++) if (tmp[yy * width + x]) { on = 1; break }
      out[y * width + x] = on
    }
  }
  return out
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
  for (let i = 0; i < matte.length; i++) if (matte[i]! >= 128) inside.push(depth[i]!)
  const alpha = new Uint8ClampedArray(matte.length)
  if (inside.length === 0) return alpha
  const cut = otsu(inside)
  const soft = 6
  for (let i = 0; i < matte.length; i++) {
    const t = Math.min(1, Math.max(0, (depth[i]! - (cut - soft)) / (soft * 2)))
    alpha[i] = clampByte(matte[i]! * t)
  }
  return alpha
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

function nearestFill(rgb: Float32Array, hole: Uint8Array, width: number, height: number): Float32Array {
  const n = width * height
  let nearest = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) if (!hole[i]) nearest[i] = i
  const dist2 = (i: number, s: number) => {
    const dx = (i % width) - (s % width)
    const dy = ((i / width) | 0) - ((s / width) | 0)
    return dx * dx + dy * dy
  }
  let step = 1
  while (step < Math.max(width, height)) step <<= 1
  for (; step >= 1; step >>= 1) {
    const next = new Int32Array(nearest)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        let best = nearest[i]!
        let bestD = best < 0 ? Infinity : dist2(i, best)
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox * step
            const ny = y + oy * step
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const s = nearest[ny * width + nx]!
            if (s < 0) continue
            const d = dist2(i, s)
            if (d < bestD) {
              bestD = d
              best = s
            }
          }
        }
        next[i] = best
      }
    }
    nearest = next
  }
  const out = new Float32Array(rgb)
  for (let i = 0; i < n; i++) {
    if (!hole[i]) continue
    const s = nearest[i]! * 3
    out[i * 3] = rgb[s]!
    out[i * 3 + 1] = rgb[s + 1]!
    out[i * 3 + 2] = rgb[s + 2]!
  }
  return out
}

function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const n = width * height
  const tmp = new Float32Array(n * 3)
  const out = new Float32Array(n * 3)
  const pr = new Float64Array(width + 1)
  const pg = new Float64Array(width + 1)
  const pb = new Float64Array(width + 1)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const o = (row + x) * 3
      pr[x + 1] = pr[x]! + src[o]!
      pg[x + 1] = pg[x]! + src[o + 1]!
      pb[x + 1] = pb[x]! + src[o + 2]!
    }
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      const count = x1 - x0 + 1
      const o = (row + x) * 3
      tmp[o] = (pr[x1 + 1]! - pr[x0]!) / count
      tmp[o + 1] = (pg[x1 + 1]! - pg[x0]!) / count
      tmp[o + 2] = (pb[x1 + 1]! - pb[x0]!) / count
    }
  }
  const cr = new Float64Array(height + 1)
  const cg = new Float64Array(height + 1)
  const cb = new Float64Array(height + 1)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const o = (y * width + x) * 3
      cr[y + 1] = cr[y]! + tmp[o]!
      cg[y + 1] = cg[y]! + tmp[o + 1]!
      cb[y + 1] = cb[y]! + tmp[o + 2]!
    }
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - radius)
      const y1 = Math.min(height - 1, y + radius)
      const count = y1 - y0 + 1
      const o = (y * width + x) * 3
      out[o] = (cr[y1 + 1]! - cr[y0]!) / count
      out[o + 1] = (cg[y1 + 1]! - cg[y0]!) / count
      out[o + 2] = (cb[y1 + 1]! - cb[y0]!) / count
    }
  }
  return out
}

function fillPlate(rgba: Uint8ClampedArray, hole: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const n = width * height
  const rgb = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = rgba[i * 4]!
    rgb[i * 3 + 1] = rgba[i * 4 + 1]!
    rgb[i * 3 + 2] = rgba[i * 4 + 2]!
  }
  let filled = nearestFill(rgb, hole, width, height)
  const radius = Math.max(1, Math.round(Math.min(width, height) * 0.012))
  if (radius >= 2) {
    for (const pass of [radius * 2, radius]) {
      const blurred = boxBlur(filled, width, height, pass)
      for (let i = 0; i < n; i++) {
        if (!hole[i]) continue
        filled[i * 3] = blurred[i * 3]!
        filled[i * 3 + 1] = blurred[i * 3 + 1]!
        filled[i * 3 + 2] = blurred[i * 3 + 2]!
      }
    }
  }
  const plate = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    plate[i * 4] = clampByte(filled[i * 3]!)
    plate[i * 4 + 1] = clampByte(filled[i * 3 + 1]!)
    plate[i * 4 + 2] = clampByte(filled[i * 3 + 2]!)
    plate[i * 4 + 3] = 255
  }
  return plate
}

function describe(alpha: Uint8ClampedArray, depth: Uint8ClampedArray, width: number, height: number) {
  const skyline = new Array<number>(width).fill(height)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let area = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x]! < 128) continue
      area += 1
      if (y < skyline[x]!) skyline[x] = y
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  const flat = area < Math.max(8, width * height * 0.002)
  const subjectBox = flat ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  let spire: { x: number; y: number } | null = null
  let roofY: number | null = null
  if (subjectBox) {
    let sx = 0
    let sn = 0
    for (let x = 0; x < width; x++) {
      if (skyline[x]! <= minY + 2) {
        sx += x
        sn += 1
      }
    }
    spire = { x: sn ? Math.round(sx / sn) : minX + Math.floor(subjectBox.width / 2), y: minY }
    for (let y = minY; y <= maxY; y++) {
      let run = 0
      for (let x = minX; x <= maxX; x++) if (alpha[y * width + x]! >= 128) run += 1
      if (run > subjectBox.width * 0.5) {
        roofY = y
        break
      }
    }
  }
  let skyBottom = 0
  for (let y = 0; y < height; y++) {
    let far = 0
    let seen = 0
    for (let x = 0; x < width; x += 2) {
      seen += 1
      if (depth[y * width + x]! < 24) far += 1
    }
    if (far < seen * 0.85) break
    skyBottom = y
  }
  return {
    flat,
    skyline: flat ? new Array<number>(width).fill(height) : skyline,
    subjectBox,
    spire,
    roofY,
    sky: { y: 0, height: skyBottom + 1 },
  }
}

/**
 * 分成两层。主体盖在字前面，净背景留在后面。
 * 深度没有一块伸进远处时 `flat` 为真，主体是空的，背景就是原图。
 */
export function splitLayers(input: SplitInput): SplitResult {
  const { rgba, depth, width, height } = input
  const n = width * height
  if (rgba.length !== n * 4) throw new Error('图片尺寸不对')
  if (depth.length !== n) throw new Error('深度图和图片不一样大')
  if (input.matte && input.matte.length !== n) throw new Error('选区和图片不一样大')

  let alpha: Uint8ClampedArray
  if (input.matte) {
    alpha = keepNear(input.matte, depth)
  } else {
    const grown = growFromSkyline(depth, width, height)
    alpha = new Uint8ClampedArray(n)
    if (grown) {
      const hard = new Float32Array(n)
      for (let i = 0; i < n; i++) hard[i] = grown[i] ? 255 : 0
      const soft = blurGray(hard, width, height, 1)
      for (let i = 0; i < n; i++) alpha[i] = clampByte(soft[i]!)
    }
  }

  const info = describe(alpha, depth, width, height)
  if (info.flat) alpha = new Uint8ClampedArray(n)

  const holeMask = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (alpha[i]! > 16) holeMask[i] = 1
  const hole = info.flat ? holeMask : dilate(holeMask, width, height, Math.max(1, Math.round(Math.min(width, height) * 0.012)))
  const plate = info.flat ? new Uint8ClampedArray(rgba) : fillPlate(rgba, hole, width, height)
  if (info.flat) {
    for (let i = 0; i < n; i++) plate[i * 4 + 3] = 255
  }

  const subject = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const a = alpha[i]! / 255
    const o = i * 4
    subject[o + 3] = alpha[i]!
    if (a <= 0.02) continue
    if (a >= 0.98) {
      subject[o] = rgba[o]!
      subject[o + 1] = rgba[o + 1]!
      subject[o + 2] = rgba[o + 2]!
      continue
    }
    const keep = 1 - a
    subject[o] = clampByte((rgba[o]! - plate[o]! * keep) / a)
    subject[o + 1] = clampByte((rgba[o + 1]! - plate[o + 1]! * keep) / a)
    subject[o + 2] = clampByte((rgba[o + 2]! - plate[o + 2]! * keep) / a)
  }

  return { ...info, alpha, subject, plate }
}
