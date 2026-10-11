import { createCanvas } from '@napi-rs/canvas'
import type { DofSpec } from './types.js'

const SLICES = 8

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
 * 按深度分片，每片用自己的半径做预乘高斯模糊，再从远到近叠回去。
 * 近处的糊边因此盖到已经画好的远处，而不是把合成完的整张图糊一遍。
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
  let zMin = Infinity
  let zMax = -Infinity
  let maxCoc = 0
  const covered: number[] = []
  for (let i = 0; i < width * height; i++) {
    if ((pixels[i * 4 + 3] ?? 0) < 8) continue
    const z = depth[i] ?? -1e30
    if (z < -1e20) continue
    covered.push(i)
    if (z < zMin) zMin = z
    if (z > zMax) zMax = z
    const coc = sharp[i] ? 0 : circleOfConfusion(focal, z, dof)
    if (coc > maxCoc) maxCoc = coc
  }
  if (!(maxCoc * pixelScale >= 0.45) || covered.length === 0) {
    return { pixels, width, height, pad: 0 }
  }
  const pad = Math.max(1, Math.ceil(dof.maxBlur * pixelScale))
  const dw = width + pad * 2
  const dh = height + pad * 2
  const span = zMax - zMin
  const sliceOf = (z: number) => (span < 1e-2 ? 0 : Math.min(SLICES - 1, Math.floor(((z - zMin) / span) * SLICES)))
  const soft = Array.from({ length: SLICES }, () => new Uint8ClampedArray(dw * dh * 4))
  const hard = Array.from({ length: SLICES }, () => new Uint8ClampedArray(dw * dh * 4))
  const sumZ = new Float64Array(SLICES)
  const count = new Int32Array(SLICES)
  const hardCount = new Int32Array(SLICES)
  for (const i of covered) {
    const z = depth[i]!
    const slice = sliceOf(z)
    const x = (i % width) + pad
    const y = Math.floor(i / width) + pad
    const di = (y * dw + x) * 4
    const si = i * 4
    const a = pixels[si + 3]!
    const into = sharp[i] ? hard[slice]! : soft[slice]!
    into[di] = Math.round((pixels[si]! * a) / 255)
    into[di + 1] = Math.round((pixels[si + 1]! * a) / 255)
    into[di + 2] = Math.round((pixels[si + 2]! * a) / 255)
    into[di + 3] = a
    if (sharp[i]) hardCount[slice] = (hardCount[slice] ?? 0) + 1
    else {
      sumZ[slice] = (sumZ[slice] ?? 0) + z
      count[slice] = (count[slice] ?? 0) + 1
    }
  }
  const acc = new Float32Array(dw * dh * 4)
  for (let slice = 0; slice < SLICES; slice++) {
    const n = count[slice] ?? 0
    if (n > 0) {
      const sigma = circleOfConfusion(focal, (sumZ[slice] ?? 0) / n, dof) * pixelScale
      compositePremultiplied(acc, blurPremultiplied(soft[slice]!, dw, dh, sigma), dw, dh)
    }
    if ((hardCount[slice] ?? 0) > 0) compositePremultiplied(acc, hard[slice]!, dw, dh)
  }
  return { pixels: unpremultiply(acc), width: dw, height: dh, pad }
}

function blurPremultiplied(pixels: Uint8ClampedArray, width: number, height: number, sigma: number): Uint8ClampedArray {
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

function compositePremultiplied(acc: Float32Array, src: Uint8ClampedArray, width: number, height: number) {
  const n = width * height
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const a = (src[o + 3] ?? 0) / 255
    if (a <= 0) continue
    const inv = 1 - a
    acc[o] = (src[o] ?? 0) / 255 + (acc[o] ?? 0) * inv
    acc[o + 1] = (src[o + 1] ?? 0) / 255 + (acc[o + 1] ?? 0) * inv
    acc[o + 2] = (src[o + 2] ?? 0) / 255 + (acc[o + 2] ?? 0) * inv
    acc[o + 3] = a + (acc[o + 3] ?? 0) * inv
  }
}

function unpremultiply(acc: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(acc.length)
  for (let i = 0; i < acc.length; i += 4) {
    const a = acc[i + 3] ?? 0
    if (a <= 1e-4) continue
    const inv = 255 / a
    out[i] = clampByte((acc[i] ?? 0) * inv)
    out[i + 1] = clampByte((acc[i + 1] ?? 0) * inv)
    out[i + 2] = clampByte((acc[i + 2] ?? 0) * inv)
    out[i + 3] = clampByte(a * 255)
  }
  return out
}

function clampByte(value: number): number {
  if (value <= 0) return 0
  if (value >= 255) return 255
  return Math.round(value)
}
