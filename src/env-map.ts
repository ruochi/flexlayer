/**
 * 金属、塑料和玻璃共用的一张固定工作室环境。
 * 主灯是左上方一块大圆角正方形，方向和头顶偏左的柔光箱一致。暗面另有一条窄长的边缘光条。
 * 几块板的顶部停在不同高度，互不相接，也不收到天顶。
 * 方位和仰角躲开 0°、90°、180°、270°，板子也从竖直偏开一点。
 * 白、黑和灰过渡都有。粗糙度先把这张环境模糊好再取样，越高越糊，并叠上越密的噪点。
 */

const WIDTH = 128
const HEIGHT = 64
const LEVELS = 5
/** 各层相对清晰环境的高斯标准差，单位是贴图像素。从清晰图各模糊一次，不在天顶把方框模糊叠成尖角。 */
const SIGMAS = [0, 0.7, 1.5, 2.6, 4]

const ROOM = { r: 12, g: 12, b: 14 }

type Panel = {
  /** 方位角，度。0 是正前方，向右增加。 */
  az: number
  /** 仰角，度。正数朝上。 */
  el: number
  /** 半宽、半高，度。不含圆角外的羽化。 */
  across: number
  along: number
  /** 圆角半径，度。不超过短边的一半。 */
  radius: number
  /** 形状外侧的羽化，度。 */
  feather: number
  /** 相对竖直偏转的角度。0 是正竖直。 */
  lean: number
  r: number
  g: number
  b: number
}

/**
 * 左上方一块大圆角正方形，底边仍盖住地平线，顶边不到天顶。
 * 左后一条窄长圆角条，顶边更低，接不到主灯。
 * 右下一块很暗的灰板，只把暗谷从肢体上挪开。角度都不落在 90° 的整数倍上。
 */
const PANELS: Panel[] = [
  { az: -54, el: 36, across: 38, along: 38, radius: 18, feather: 12, lean: -3, r: 200, g: 202, b: 208 },
  { az: -150, el: -6, across: 8, along: 28, radius: 7, feather: 5, lean: -2, r: 214, g: 216, b: 220 },
  { az: 108, el: -14, across: 22, along: 14, radius: 10, feather: 16, lean: 4, r: 32, g: 34, b: 38 },
]

const SAMPLE = { r: 0, g: 0, b: 0 }

function clamp01(n: number) {
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function wrapSigned(d: number) {
  let x = d
  while (x > 0.5) x -= 1
  while (x < -0.5) x += 1
  return x
}

/** 圆角矩形的有符号距离。负值在内部。 */
function roundedRect(x: number, y: number, halfW: number, halfH: number, radius: number) {
  const rad = Math.min(Math.max(radius, 0), halfW, halfH)
  const qx = Math.abs(x) - (halfW - rad)
  const qy = Math.abs(y) - (halfH - rad)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad
}

function feathered(distance: number, feather: number) {
  if (distance <= 0) return 1
  if (feather <= 0 || distance >= feather) return 0
  const t = distance / feather
  const s = t * t * (3 - 2 * t)
  return 1 - s
}

/**
 * 圆角矩形柔光板。顶边由 along 决定，不到天顶，几块板的顶也不会接到一起。
 */
function panelWeight(u: number, v: number, panel: Panel) {
  const elev = (0.5 - v) * 180
  const az = wrapSigned(u - panel.az / 360) * 360
  const el = elev - panel.el
  const lean = (panel.lean * Math.PI) / 180
  const c = Math.cos(lean)
  const s = Math.sin(lean)
  const across = az * c + el * s
  const along = -az * s + el * c
  const dist = roundedRect(across, along, panel.across, panel.along, panel.radius)
  return feathered(dist, panel.feather)
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
      for (const panel of PANELS) {
        const w = panelWeight(u, v, panel)
        if (w <= 0) continue
        r = Math.max(r, ROOM.r + (panel.r - ROOM.r) * w)
        g = Math.max(g, ROOM.g + (panel.g - ROOM.g) * w)
        b = Math.max(b, ROOM.b + (panel.b - ROOM.b) * w)
      }
      const i = (y * WIDTH + x) * 3
      data[i] = Math.round(r)
      data[i + 1] = Math.round(g)
      data[i + 2] = Math.round(b)
    }
  }
  return data
}

/** 纬度过了天顶就翻到对面那条经线。 */
function wrapLatLong(x: number, y: number) {
  let xx = x
  let yy = y
  if (yy < 0 || yy >= HEIGHT) {
    xx += WIDTH >> 1
    yy = yy < 0 ? -yy - 1 : HEIGHT * 2 - 1 - yy
  }
  xx %= WIDTH
  if (xx < 0) xx += WIDTH
  if (yy < 0) yy = 0
  if (yy >= HEIGHT) yy = HEIGHT - 1
  return (yy * WIDTH + xx) * 3
}

/** 高斯模糊。经度绕回，纬度跨过天顶，避免方框模糊在极点夹住后收成尖角。 */
function blur(src: Uint8Array, sigma: number): Uint8Array {
  if (sigma <= 0) return src
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const weight = new Float64Array(radius * 2 + 1)
  let sum = 0
  for (let k = -radius; k <= radius; k++) {
    const g = Math.exp(-0.5 * (k / sigma) ** 2)
    weight[k + radius] = g
    sum += g
  }
  for (let i = 0; i < weight.length; i++) weight[i]! /= sum
  const horizontal = new Float64Array(src.length)
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let k = -radius; k <= radius; k++) {
        const i = (y * WIDTH + ((x + k) % WIDTH + WIDTH) % WIDTH) * 3
        const w = weight[k + radius]!
        r += src[i]! * w
        g += src[i + 1]! * w
        b += src[i + 2]! * w
      }
      const o = (y * WIDTH + x) * 3
      horizontal[o] = r
      horizontal[o + 1] = g
      horizontal[o + 2] = b
    }
  }
  const out = new Uint8Array(src.length)
  const lat = (row: number) => {
    const el = (0.5 - (row + 0.5) / HEIGHT) * Math.PI
    return Math.max(0.05, Math.cos(el))
  }
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let r = 0
      let g = 0
      let b = 0
      let wsum = 0
      for (let k = -radius; k <= radius; k++) {
        const row = y + k
        const i = wrapLatLong(x, row)
        const wrappedRow = row < 0 ? -row - 1 : row >= HEIGHT ? HEIGHT * 2 - 1 - row : row
        const w = weight[k + radius]! * lat(Math.max(0, Math.min(HEIGHT - 1, wrappedRow)))
        r += horizontal[i]! * w
        g += horizontal[i + 1]! * w
        b += horizontal[i + 2]! * w
        wsum += w
      }
      const o = (y * WIDTH + x) * 3
      out[o] = Math.max(0, Math.min(255, Math.round(r / wsum)))
      out[o + 1] = Math.max(0, Math.min(255, Math.round(g / wsum)))
      out[o + 2] = Math.max(0, Math.min(255, Math.round(b / wsum)))
    }
  }
  return out
}

function grain(dx: number, dy: number, dz: number) {
  const freq = 26
  const x = dx * freq
  const y = dy * freq
  const z = dz * freq
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const fade = (t: number) => t * t * (3 - 2 * t)
  const tx = fade(x - x0)
  const ty = fade(y - y0)
  const tz = fade(z - z0)
  const at = (ix: number, iy: number, iz: number) => {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1440671489)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 2 - 1
  }
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const x00 = lerp(at(x0, y0, z0), at(x0 + 1, y0, z0), tx)
  const x10 = lerp(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), tx)
  const x01 = lerp(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), tx)
  const x11 = lerp(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), tx)
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz)
}

/** 模糊层在靠近天顶时收回亮度。天顶在球上是一个点，亮部伸到那里会收成尖角。 */
function settlePole(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(src)
  for (let y = 0; y < HEIGHT; y++) {
    const el = Math.abs((0.5 - (y + 0.5) / HEIGHT) * 180)
    const over = (el - 66) / 16
    if (over <= 0) continue
    const t = over >= 1 ? 1 : over * over * (3 - 2 * over)
    const keep = 1 - t
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3
      out[i] = Math.round(ROOM.r + (out[i]! - ROOM.r) * keep)
      out[i + 1] = Math.round(ROOM.g + (out[i + 1]! - ROOM.g) * keep)
      out[i + 2] = Math.round(ROOM.b + (out[i + 2]! - ROOM.b) * keep)
    }
  }
  return out
}

const maps: Uint8Array[] = []
{
  const sharp = paintStudio()
  for (let i = 0; i < LEVELS; i++) {
    const sigma = SIGMAS[i]!
    maps.push(sigma <= 0 ? sharp : settlePole(blur(sharp, sigma)))
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
  if (f > 1e-4 && i0 !== i1) {
    const r0 = SAMPLE.r
    const g0 = SAMPLE.g
    const b0 = SAMPLE.b
    sample(maps[i1]!, u, v)
    SAMPLE.r = r0 + (SAMPLE.r - r0) * f
    SAMPLE.g = g0 + (SAMPLE.g - g0) * f
    SAMPLE.b = b0 + (SAMPLE.b - b0) * f
  }
  const rough = clamp01(roughness)
  if (rough > 0.02) {
    const speck = grain(dx, dy, dz) * rough * rough * 0.55
    const scale = 1 + speck
    SAMPLE.r = Math.max(0, Math.min(255, SAMPLE.r * scale))
    SAMPLE.g = Math.max(0, Math.min(255, SAMPLE.g * scale))
    SAMPLE.b = Math.max(0, Math.min(255, SAMPLE.b * scale))
  }
  return SAMPLE
}
