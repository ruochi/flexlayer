import { createCanvas, type CanvasRenderingContext2D, type SKRSContext2D } from '@napi-rs/canvas'
import { inkDistanceField } from './distance-field.js'
import type { GlassSpec, LayoutNode } from './types.js'

type PaintCtx = SKRSContext2D

export type GlassHost = {
  transformScale(ctx: CanvasRenderingContext2D): number
  nodeDeviceBounds(
    ctx: PaintCtx,
    node: LayoutNode,
    padDevice: number,
  ): { matrix: { a: number; b: number; c: number; d: number; e: number; f: number }; minX: number; minY: number; sw: number; sh: number }
  drawNodeInk(ctx: CanvasRenderingContext2D, node: LayoutNode, spread: number, ink?: string): void
}

let host: GlassHost | null = null

export function bindGlass(next: GlassHost): void {
  host = next
}

function sampleBilinear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)))
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = x - Math.floor(x)
  const fy = y - Math.floor(y)
  const i00 = (y0 * w + x0) * 4
  const i10 = (y0 * w + x1) * 4
  const i01 = (y1 * w + x0) * 4
  const i11 = (y1 * w + x1) * 4
  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    const v0 = data[i00 + c]! * (1 - fx) + data[i10 + c]! * fx
    const v1 = data[i01 + c]! * (1 - fx) + data[i11 + c]! * fx
    out[c] = v0 * (1 - fy) + v1 * fy
  }
  return out
}

/** 可分离盒式模糊，用来抹平二值距离场的台阶，让法线方向连续 */
function boxBlurField(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const span = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))]!
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / span
      acc += src[row + Math.min(w - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let i = -r; i <= r; i++) acc += tmp[Math.min(h - 1, Math.max(0, i)) * w + x]!
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / span
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!
    }
  }
  return out
}

const GLASS_PROFILE_STEPS = 256

/**
 * 边缘弧面的向内位移表：t∈[0,1]（0=边缘，1=弧面内沿）→ 位移（设备像素）。
 * shift = S·(1-t)²：内沿处位移与斜率都归零，和平坦中心无缝衔接；
 * S ≤ bezel/2 时 d + shift(d) 单调，背景在边缘被连续放大而不会翻折或拉成一条线。
 */
function glassShiftTable(bezel: number, glass: GlassSpec): Float32Array {
  const maxShift = bezel * 0.5 * Math.min(1, Math.max(0, glass.refraction))
  const table = new Float32Array(GLASS_PROFILE_STEPS + 1)
  for (let i = 0; i <= GLASS_PROFILE_STEPS; i++) {
    const u = 1 - i / GLASS_PROFILE_STEPS
    table[i] = maxShift * u * u
  }
  return table
}

/**
 * iOS Liquid Glass：墨迹距离场 → 边缘凸弧面 Snell 折射（中心平坦不变形）→ 色散 → 朝光边缘高光。
 * `blur` 为 0 时背景完全清晰，只有折射。
 * `drawShadow` 在取样之后、玻璃落版之前画，投影不会透过玻璃被看到。
 */
export function paintGlass(ctx: PaintCtx, node: LayoutNode, glass: GlassSpec, drawShadow?: () => void) {
  const api = host
  if (!api) throw new Error('玻璃模块还没接上绘制')
  if (node.width <= 0 || node.height <= 0) {
    drawShadow?.()
    return
  }
  const k = api.transformScale(ctx)
  const samplePad = Math.ceil(glass.blur * 2 * k) + 2
  const { matrix, minX, minY, sw, sh } = api.nodeDeviceBounds(ctx, node, samplePad)
  if (sw <= 0 || sh <= 0) {
    drawShadow?.()
    return
  }

  const snapshot = ctx.getImageData(minX, minY, sw, sh)
  let srcData = snapshot.data
  if (glass.blur > 0) {
    const src = createCanvas(sw, sh)
    ;(src.getContext('2d') as PaintCtx).putImageData(snapshot, 0, 0)
    const blurred = createCanvas(sw, sh)
    const bctx = blurred.getContext('2d') as PaintCtx
    bctx.filter = `blur(${glass.blur * k}px) saturate(1.15) brightness(1.04)`
    bctx.drawImage(src, 0, 0)
    bctx.filter = 'none'
    srcData = bctx.getImageData(0, 0, sw, sh).data
  }

  const mask = createCanvas(sw, sh)
  const mctx = mask.getContext('2d') as PaintCtx
  mctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - minX, matrix.f - minY)
  api.drawNodeInk(mctx, node, 0, '#ffffff')
  const maskData = mctx.getImageData(0, 0, sw, sh).data

  const rawDist = inkDistanceField(maskData, sw, sh)
  let inradius = 0
  for (let i = 0; i < rawDist.length; i++) if (rawDist[i]! > inradius) inradius = rawDist[i]!
  const dist = boxBlurField(rawDist, sw, sh, Math.max(1, Math.round(1.5 * k)))

  const bezelLogic = Math.min(64, Math.max(3, Math.min(node.width, node.height) * glass.bezel))
  const bezel = Math.max(1, Math.min(bezelLogic * k, inradius))
  const shiftTable = glassShiftTable(bezel, glass)
  if (process.env.GLASS_DEBUG) console.log({ sw, sh, inradius, bezel, k, mid: rawDist[Math.floor(sh / 2) * sw + Math.floor(sw / 2)], table: [shiftTable[0], shiftTable[64], shiftTable[128], shiftTable[192], shiftTable[256]] })
  const disp = glass.dispersion
  const lineWidth = Math.max(0.8, 1.1 * k)
  const lightX = -0.55
  const lightY = -0.835

  const out = createCanvas(sw, sh)
  const octx = out.getContext('2d') as PaintCtx
  const outImg = octx.createImageData(sw, sh)
  const outData = outImg.data

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x
      const mi = i * 4
      const a = maskData[mi + 3]!
      if (a < 1) continue
      const d = rawDist[i]!
      if (d >= bezel) {
        outData[mi] = srcData[mi]!
        outData[mi + 1] = srcData[mi + 1]!
        outData[mi + 2] = srcData[mi + 2]!
        outData[mi + 3] = (srcData[mi + 3]! * a) / 255
        continue
      }
      const gx = dist[Math.min(sw - 1, x + 1) + y * sw]! - dist[Math.max(0, x - 1) + y * sw]!
      const gy = dist[x + Math.min(sh - 1, y + 1) * sw]! - dist[x + Math.max(0, y - 1) * sw]!
      const gl = Math.hypot(gx, gy)
      const nx = gl > 1e-6 ? gx / gl : 0
      const ny = gl > 1e-6 ? gy / gl : 0
      const t = d / bezel
      const shift = shiftTable[Math.min(GLASS_PROFILE_STEPS, Math.round(t * GLASS_PROFILE_STEPS))]!

      let r: number
      let g: number
      let b: number
      let sa: number
      if (disp > 0) {
        const sr = shift * (1 + disp)
        const sb = shift * (1 - disp)
        const cr = sampleBilinear(srcData, sw, sh, x + nx * sr, y + ny * sr)
        const cg = sampleBilinear(srcData, sw, sh, x + nx * shift, y + ny * shift)
        const cb = sampleBilinear(srcData, sw, sh, x + nx * sb, y + ny * sb)
        r = cr[0]
        g = cg[1]
        b = cb[2]
        sa = cg[3]
      } else {
        ;[r, g, b, sa] = sampleBilinear(srcData, sw, sh, x + nx * shift, y + ny * shift)
      }

      if (glass.specular > 0) {
        // 外法线 = -梯度；朝光一侧亮，对侧有一道较弱的回光
        const facing = -(nx * lightX + ny * lightY)
        const lit = Math.pow(Math.max(0, facing), 1.3) + 0.45 * Math.pow(Math.max(0, -facing), 1.3) + 0.12
        const u = 1 - t
        const line = Math.exp(-d / lineWidth)
        const hl = Math.min(1, (0.85 * line + 0.3 * u * u * u) * lit * glass.specular)
        r += (255 - r) * hl
        g += (255 - g) * hl
        b += (255 - b) * hl
        sa += (255 - sa) * hl
      }
      outData[mi] = r
      outData[mi + 1] = g
      outData[mi + 2] = b
      outData[mi + 3] = (sa * a) / 255
    }
  }
  octx.putImageData(outImg, 0, 0)

  const tint = glass.tint ?? (glass.variant === 'thick' ? '#ffffff2a' : glass.variant === 'regular' ? '#ffffff14' : undefined)
  if (tint) {
    octx.save()
    octx.globalCompositeOperation = 'source-atop'
    octx.fillStyle = tint
    octx.fillRect(0, 0, sw, sh)
    octx.restore()
  }

  drawShadow?.()
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(out, minX, minY)
  ctx.restore()
}
