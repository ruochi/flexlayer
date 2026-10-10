import { rasterizeMask } from './paint.js'
import type { Box, LayoutNode } from './types.js'

/**
 * `<mask>` 画成位图之后量出来的数。坐标相对这一层布局盒左上角，单位是这一层的局部像素。
 * 只看布局盒里面，探出盒子的形状不算。
 */
export type MaskStats = {
  /** 留下的比例，0 到 1。半透明按 alpha 折算。 */
  area: number
  /** alpha 大于 0 的外接矩形。全部藏起来时是 null。 */
  ink: Box | null
  /** alpha 不低于一半的连通块个数，八连通。一块都没有时是 0。 */
  pieces: number
  /** 软边的平均宽度，像素。硬边接近 0 到 1，羽化越宽越大。没有边时是 0。 */
  softEdge: number
}

const SOLID = 128
const SOFT_LOW = 8
const SOFT_HIGH = 247

function round(n: number, digits: number): number {
  const k = 10 ** digits
  const rounded = Math.round(n * k) / k
  return Object.is(rounded, -0) ? 0 : rounded
}

function countPieces(alpha: Uint8ClampedArray, width: number, height: number): number {
  const seen = new Uint8Array(alpha.length)
  const stack = new Int32Array(alpha.length)
  let pieces = 0
  for (let start = 0; start < alpha.length; start++) {
    if (seen[start] || alpha[start]! < SOLID) continue
    pieces += 1
    let top = 0
    stack[top++] = start
    seen[start] = 1
    while (top > 0) {
      const at = stack[--top]!
      const x = at % width
      const y = (at - x) / width
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue
          const next = ny * width + nx
          if (seen[next] || alpha[next]! < SOLID) continue
          seen[next] = 1
          stack[top++] = next
        }
      }
    }
  }
  return pieces
}

/** 软边宽度 = 半透明像素数 / 实心区域的边界长度。贴着布局盒四边的不算边界。 */
function softEdgeWidth(alpha: Uint8ClampedArray, width: number, height: number): number {
  let soft = 0
  let boundary = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = alpha[y * width + x]!
      if (a >= SOFT_LOW && a <= SOFT_HIGH) soft += 1
      if (a < SOLID) continue
      const open =
        (x > 0 && alpha[y * width + x - 1]! < SOLID) ||
        (x < width - 1 && alpha[y * width + x + 1]! < SOLID) ||
        (y > 0 && alpha[(y - 1) * width + x]! < SOLID) ||
        (y < height - 1 && alpha[(y + 1) * width + x]! < SOLID)
      if (open) boundary += 1
    }
  }
  return boundary > 0 ? soft / boundary : 0
}

/** 先把 mask 画成位图，再量。layer 布局盒为空时返回 null。 */
export function maskStats(shapes: LayoutNode[], width: number, height: number): MaskStats | null {
  const raster = rasterizeMask(shapes, width, height)
  if (!raster) return null
  const { alpha, width: pw, height: ph, scale } = raster
  let sum = 0
  let minX = pw
  let minY = ph
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const a = alpha[y * pw + x]!
      if (a === 0) continue
      sum += a
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const ink =
    maxX < 0
      ? null
      : {
          x: round(minX / scale, 3),
          y: round(minY / scale, 3),
          width: round(Math.min(width, (maxX + 1) / scale) - minX / scale, 3),
          height: round(Math.min(height, (maxY + 1) / scale) - minY / scale, 3),
        }
  return {
    area: round(sum / 255 / (pw * ph), 4),
    ink,
    pieces: countPieces(alpha, pw, ph),
    softEdge: round(softEdgeWidth(alpha, pw, ph) / scale, 2),
  }
}
