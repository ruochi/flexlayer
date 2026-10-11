import { createCanvas } from '@napi-rs/canvas'
import type { DofSpec } from './types.js'

/**
 * 薄透镜弥散圆。depth = focal - z，z 是镜头空间里朝观众为正的坐标。
 * aperture 是无限远处的半径。depth 趋近 0 时用 maxBlur 封顶。
 */
export function circleOfConfusion(focal: number, z: number, dof: DofSpec, sharp = false): number {
  if (sharp || !(dof.aperture > 0)) return 0
  const depth = focal - z
  if (!(depth > 1e-3)) return 0
  return Math.min(dof.maxBlur, (dof.aperture * Math.abs(depth - dof.focus)) / depth)
}

export type DofImage = {
  pixels: Uint8ClampedArray
  width: number
  height: number
  /** 四边留出的像素。0 表示没糊，调用方继续用原来的画布。 */
  pad: number
}

/**
 * 糊单独一个物体。整张表面一起进各级高斯，再按每个像素自己的半径取样。
 * 切成深度条再叠会在斜面上留缝，被挡住的颜色也已经不在这张图里。
 * 多个物体从远到近各糊一次再叠，近处的糊边才盖住远处。
 */
export function applyDepthOfField(input: {
  pixels: Uint8ClampedArray
  width: number
  height: number
  depth: Float32Array
  sharp: Uint8Array
  focal: number
  dof: DofSpec
  pixelScale: number
}): DofImage {
  const { pixels, width, height, depth, sharp, focal, dof, pixelScale } = input
  const count = width * height
  const coc = new Float32Array(count).fill(-1)
  let maxCoc = 0
  let minCoc = Infinity
  let sumCoc = 0
  let coveredCount = 0
  for (let i = 0; i < count; i++) {
    if ((pixels[i * 4 + 3] ?? 0) < 8) continue
    const z = depth[i] ?? -1e30
    if (z < -1e20) continue
    const radius = sharp[i] ? 0 : circleOfConfusion(focal, z, dof)
    coc[i] = radius
    if (radius > maxCoc) maxCoc = radius
    if (radius < minCoc) minCoc = radius
    sumCoc += radius
    coveredCount++
  }
  if (!(maxCoc * pixelScale >= 0.45) || coveredCount === 0) {
    return { pixels, width, height, pad: 0 }
  }
  // 画布高斯在大约 3σ 才接近 0。只留 1σ 时，尾巴还亮着就被切掉，边缘有一圈边界。
  const pad = Math.max(1, Math.ceil(maxCoc * pixelScale * 3))
  const dw = width + pad * 2
  const dh = height + pad * 2
  const base = padImage(pixels, width, height, pad)
  if (maxCoc - minCoc < 1) {
    const sigma = (sumCoc / coveredCount) * pixelScale
    return { pixels: blurStraight(base, dw, dh, sigma), width: dw, height: dh, pad }
  }
  const sigmas = blurLevels(maxCoc * pixelScale)
  const levels = sigmas.map((sigma) => (sigma < 0.45 ? base : blurStraight(base, dw, dh, sigma)))
  const nearest = nearestCovered(coc, width, height, pad, dw, dh)
  const out = new Uint8ClampedArray(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const src = nearest[y * dw + x] ?? -1
      if (src < 0) continue
      const sx = (src % dw) - pad
      const sy = Math.floor(src / dw) - pad
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue
      const radiusPx = (coc[sy * width + sx] ?? 0) * pixelScale
      const dx = x - (sx + pad)
      const dy = y - (sy + pad)
      const reach = radiusPx * 3
      if (dx * dx + dy * dy > reach * reach + 1e-6) continue
      writeSample(out, levels, sigmas, dw, x, y, radiusPx)
    }
  }
  return { pixels: out, width: dw, height: dh, pad }
}

/** 画布模糊读回来的是直通颜色，调用方按直通叠回去。 */
function blurStraight(pixels: Uint8ClampedArray, width: number, height: number, sigma: number): Uint8ClampedArray {
  if (!(sigma >= 0.45)) return pixels
  const src = createCanvas(width, height)
  const sctx = src.getContext('2d')
  const image = sctx.createImageData(width, height)
  image.data.set(pixels)
  sctx.putImageData(image, 0, 0)
  const out = createCanvas(width, height)
  const octx = out.getContext('2d')
  octx.filter = `blur(${sigma.toFixed(3)}px)`
  octx.drawImage(src, 0, 0)
  return octx.getImageData(0, 0, width, height).data
}

function padImage(pixels: Uint8ClampedArray, width: number, height: number, pad: number): Uint8ClampedArray {
  const dw = width + pad * 2
  const out = new Uint8ClampedArray(dw * (height + pad * 2) * 4)
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * width * 4, (y + 1) * width * 4)
    out.set(row, ((y + pad) * dw + pad) * 4)
  }
  return out
}

function blurLevels(maxSigma: number): number[] {
  // 16 和 32 两档混在一起会留下内圈轮廓。相邻档差两像素，混出来的边是连续的。
  const step = maxSigma <= 16 ? 1 : 2
  const sigmas = [0]
  for (let sigma = step; sigma < maxSigma - 0.25; sigma += step) sigmas.push(sigma)
  sigmas.push(maxSigma)
  return sigmas
}

/** 每个像素指向最近的有颜色的像素，坐标系是补过边的图。没有来源时为 -1。 */
function nearestCovered(coc: Float32Array, width: number, height: number, pad: number, dw: number, dh: number): Int32Array {
  const nearest = new Int32Array(dw * dh).fill(-1)
  const dist = new Float32Array(dw * dh).fill(1e9)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((coc[y * width + x] ?? -1) < 0) continue
      const di = (y + pad) * dw + (x + pad)
      dist[di] = 0
      nearest[di] = di
    }
  }
  const relax = (x: number, y: number, nx: number, ny: number, step: number) => {
    if (nx < 0 || ny < 0 || nx >= dw || ny >= dh) return
    const from = dist[ny * dw + nx] ?? 1e9
    if (from >= 1e8) return
    const next = from + step
    const di = y * dw + x
    if (next < (dist[di] ?? 1e9)) {
      dist[di] = next
      nearest[di] = nearest[ny * dw + nx] ?? -1
    }
  }
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      relax(x, y, x - 1, y, 1)
      relax(x, y, x, y - 1, 1)
      relax(x, y, x - 1, y - 1, 1.4142)
      relax(x, y, x + 1, y - 1, 1.4142)
    }
  }
  for (let y = dh - 1; y >= 0; y--) {
    for (let x = dw - 1; x >= 0; x--) {
      relax(x, y, x + 1, y, 1)
      relax(x, y, x, y + 1, 1)
      relax(x, y, x + 1, y + 1, 1.4142)
      relax(x, y, x - 1, y + 1, 1.4142)
    }
  }
  return nearest
}

function writeSample(
  out: Uint8ClampedArray,
  levels: Uint8ClampedArray[],
  sigmas: number[],
  dw: number,
  x: number,
  y: number,
  sigma: number,
) {
  let level = 0
  while (level < sigmas.length - 2 && (sigmas[level + 1] ?? 0) < sigma) level++
  const s0 = sigmas[level] ?? 0
  const next = Math.min(sigmas.length - 1, level + 1)
  const s1 = sigmas[next] ?? s0
  const t = s1 <= s0 + 1e-6 ? 0 : Math.min(1, (sigma - s0) / (s1 - s0))
  const o = (y * dw + x) * 4
  const a = levels[level] ?? levels[0]!
  const b = levels[next] ?? a
  const inv = 1 - t
  out[o] = clampByte((a[o] ?? 0) * inv + (b[o] ?? 0) * t)
  out[o + 1] = clampByte((a[o + 1] ?? 0) * inv + (b[o + 1] ?? 0) * t)
  out[o + 2] = clampByte((a[o + 2] ?? 0) * inv + (b[o + 2] ?? 0) * t)
  out[o + 3] = clampByte((a[o + 3] ?? 0) * inv + (b[o + 3] ?? 0) * t)
}

function clampByte(value: number): number {
  if (value <= 0) return 0
  if (value >= 255) return 255
  return Math.round(value)
}
