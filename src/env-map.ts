/**
 * 金属和玻璃共用的一张固定工作室环境。
 * 灯是横条：正面一条，左侧一条更亮，右侧一条更弱。上下两极是暗的，没有上亮下暗的渐变。
 * 粗糙度只决定取哪一层模糊，一次双线性采样。
 */

const WIDTH = 128
const HEIGHT = 64
const LEVELS = 5
const RADII = [0, 1, 3, 7, 16]

const ROOM = { r: 18, g: 20, b: 24 }

type Strip = { u: number; v: number; hu: number; hv: number; feather: number; r: number; g: number; b: number }

/** u 从正前方起算，向右增加。v 0 是上方，0.5 是地平线。横条的 hu 大于 hv。 */
const STRIPS: Strip[] = [
  { u: 0, v: 0.5, hu: 0.22, hv: 0.11, feather: 0.03, r: 250, g: 250, b: 252 },
  { u: 0.75, v: 0.5, hu: 0.12, hv: 0.1, feather: 0.028, r: 255, g: 248, b: 238 },
  { u: 0.25, v: 0.5, hu: 0.1, hv: 0.08, feather: 0.024, r: 110, g: 118, b: 130 },
]

const SAMPLE = { r: 0, g: 0, b: 0 }

function clamp01(n: number) {
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function wrapDist(a: number, b: number) {
  const d = Math.abs(a - b)
  return Math.min(d, 1 - d)
}

function window1d(distance: number, half: number, feather: number) {
  if (distance <= half) return 1
  if (distance >= half + feather) return 0
  const t = (distance - half) / feather
  const s = t * t * (3 - 2 * t)
  return 1 - s
}

function paintStudio(): Uint8Array {
  const data = new Uint8Array(WIDTH * HEIGHT * 3)
  for (let y = 0; y < HEIGHT; y++) {
    const v = (y + 0.5) / HEIGHT
    for (let x = 0; x < WIDTH; x++) {
      const u = (x + 0.5) / WIDTH
      let r = ROOM.r
      let g = ROOM.g
      let b = ROOM.b
      for (const strip of STRIPS) {
        const w = window1d(wrapDist(u, strip.u), strip.hu, strip.feather) * window1d(Math.abs(v - strip.v), strip.hv, strip.feather)
        if (w <= 0) continue
        r = Math.max(r, ROOM.r + (strip.r - ROOM.r) * w)
        g = Math.max(g, ROOM.g + (strip.g - ROOM.g) * w)
        b = Math.max(b, ROOM.b + (strip.b - ROOM.b) * w)
      }
      const i = (y * WIDTH + x) * 3
      data[i] = Math.round(r)
      data[i + 1] = Math.round(g)
      data[i + 2] = Math.round(b)
    }
  }
  return data
}

function blur(src: Uint8Array, radius: number): Uint8Array {
  if (radius <= 0) return src
  const span = radius * 2 + 1
  const horizontal = new Uint8Array(src.length)
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let k = -radius; k <= radius; k++) {
        const sx = (x + k + WIDTH) % WIDTH
        const i = (y * WIDTH + sx) * 3
        r += src[i]!
        g += src[i + 1]!
        b += src[i + 2]!
      }
      const o = (y * WIDTH + x) * 3
      horizontal[o] = Math.round(r / span)
      horizontal[o + 1] = Math.round(g / span)
      horizontal[o + 2] = Math.round(b / span)
    }
  }
  const out = new Uint8Array(src.length)
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(HEIGHT - 1, Math.max(0, y + k))
        const i = (sy * WIDTH + x) * 3
        r += horizontal[i]!
        g += horizontal[i + 1]!
        b += horizontal[i + 2]!
      }
      const o = (y * WIDTH + x) * 3
      out[o] = Math.round(r / span)
      out[o + 1] = Math.round(g / span)
      out[o + 2] = Math.round(b / span)
    }
  }
  return out
}

const maps: Uint8Array[] = []
{
  let level = paintStudio()
  for (let i = 0; i < LEVELS; i++) {
    maps.push(i === 0 ? level : blur(level, RADII[i]!))
    level = maps[i]!
  }
}

function read(map: Uint8Array, x: number, y: number) {
  const i = (y * WIDTH + x) * 3
  return [map[i]!, map[i + 1]!, map[i + 2]!] as const
}

function sample(map: Uint8Array, u: number, v: number) {
  let uu = u % 1
  if (uu < 0) uu += 1
  const x = uu * WIDTH
  const y = clamp01(v) * (HEIGHT - 1)
  const x0 = Math.floor(x) % WIDTH
  const y0 = Math.min(HEIGHT - 1, Math.floor(y))
  const x1 = (x0 + 1) % WIDTH
  const y1 = Math.min(HEIGHT - 1, y0 + 1)
  const tx = x - Math.floor(x)
  const ty = y - Math.floor(y)
  const a = read(map, x0, y0)
  const b = read(map, x1, y0)
  const c = read(map, x0, y1)
  const d = read(map, x1, y1)
  const mix = (i: number) => a[i] + (b[i] - a[i]) * tx + (c[i] - a[i]) * ty + (a[i] - b[i] - c[i] + d[i]) * tx * ty
  SAMPLE.r = mix(0)
  SAMPLE.g = mix(1)
  SAMPLE.b = mix(2)
}

/**
 * 反射方向在着色空间：y 朝上，z 朝镜头。
 * 返回值是共用的，调用方要马上把三个通道读走。
 */
export function studioAt(x: number, y: number, z: number, roughness: number) {
  const len = Math.hypot(x, y, z) || 1
  const dx = x / len
  const dy = y / len
  const dz = z / len
  let u = Math.atan2(dx, dz) / (Math.PI * 2)
  if (u < 0) u += 1
  const v = 0.5 - Math.asin(Math.min(1, Math.max(-1, dy))) / Math.PI
  const t = clamp01(roughness) * (LEVELS - 1)
  const i0 = Math.floor(t)
  const i1 = Math.min(LEVELS - 1, i0 + 1)
  const f = t - i0
  sample(maps[i0]!, u, v)
  if (f <= 1e-4 || i0 === i1) return SAMPLE
  const r0 = SAMPLE.r
  const g0 = SAMPLE.g
  const b0 = SAMPLE.b
  sample(maps[i1]!, u, v)
  SAMPLE.r = r0 + (SAMPLE.r - r0) * f
  SAMPLE.g = g0 + (SAMPLE.g - g0) * f
  SAMPLE.b = b0 + (SAMPLE.b - b0) * f
  return SAMPLE
}
