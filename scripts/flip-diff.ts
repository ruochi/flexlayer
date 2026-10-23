/**
 * LDR-FLIP（Andersson 等，2020）的一个紧凑实现。
 * 用法：npx tsx scripts/flip-diff.ts <reference.png> <candidate.png>
 * 打印平均 ꟻLIP，0 是相同，1 是完全不同。
 */
import { createCanvas, loadImage } from '@napi-rs/canvas'

const leftPath = process.argv[2]
const rightPath = process.argv[3]
if (!leftPath || !rightPath) {
  console.error('usage: npx tsx scripts/flip-diff.ts <reference.png> <candidate.png>')
  process.exit(1)
}

function srgbToLinear(c: number): number {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
}

function hyab(a: number[], b: number[]): number {
  const dL = a[0]! - b[0]!
  const dC = Math.hypot(a[1]! - b[1]!) - Math.hypot(b[1]!, b[2]!)
  return Math.abs(dL) + Math.abs(dC)
}

/** 线性 sRGB 到 Hunt 调整过的 Lab 近似，足够做相对误差，不是完整的色彩管理。 */
function linearToLab(r: number, g: number, b: number): number[] {
  const x = 0.4124 * r + 0.3576 * g + 0.1805 * b
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = 0.0193 * r + 0.1192 * g + 0.9505 * b
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fy = f(y)
  return [116 * fy - 16, 500 * (f(x / 0.95047) - fy), 200 * (fy - f(z / 1.08883))]
}

const ref = await loadImage(leftPath)
const cand = await loadImage(rightPath)
if (ref.width !== cand.width || ref.height !== cand.height) {
  console.error(`size ${ref.width}x${ref.height} vs ${cand.width}x${cand.height}`)
  process.exit(1)
}
const canvas = createCanvas(ref.width, ref.height)
const ctx = canvas.getContext('2d')
ctx.drawImage(ref, 0, 0)
const a = ctx.getImageData(0, 0, ref.width, ref.height).data
ctx.drawImage(cand, 0, 0)
const b = ctx.getImageData(0, 0, cand.width, cand.height).data

const pc = 0.7
const pt = 0.4
const w = ref.width
const h = ref.height
let sum = 0
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    const labA = linearToLab(srgbToLinear(a[i]!), srgbToLinear(a[i + 1]!), srgbToLinear(a[i + 2]!))
    const labB = linearToLab(srgbToLinear(b[i]!), srgbToLinear(b[i + 1]!), srgbToLinear(b[i + 2]!))
    let color = hyab(labA, labB) / 100
    let feature = 0
    if (x > 0 && y > 0 && x + 1 < w && y + 1 < h) {
      const gx = (p: Uint8ClampedArray, ox: number) => {
        const i0 = ((y - 1) * w + (x + ox)) * 4
        const i1 = (y * w + (x + ox)) * 4
        const i2 = ((y + 1) * w + (x + ox)) * 4
        return p[i0]! + 2 * p[i1]! + p[i2]!
      }
      const gy = (p: Uint8ClampedArray, oy: number) => {
        const i0 = ((y + oy) * w + (x - 1)) * 4
        const i1 = ((y + oy) * w + x) * 4
        const i2 = ((y + oy) * w + (x + 1)) * 4
        return p[i0]! + 2 * p[i1]! + p[i2]!
      }
      const ga = Math.hypot(gx(a, 1) - gx(a, -1), gy(a, 1) - gy(a, -1))
      const gb = Math.hypot(gx(b, 1) - gx(b, -1), gy(b, 1) - gy(b, -1))
      feature = Math.min(1, Math.abs(ga - gb) / (255 * 4))
    }
    const value = color ** pc * (1 - feature) + feature ** pt
    sum += Math.min(1, value)
  }
}
const mean = sum / (w * h)
console.log(mean.toFixed(6))
