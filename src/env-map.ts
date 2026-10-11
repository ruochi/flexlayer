/**
 * 金属、塑料和玻璃共用的一张固定工作室环境。
 * 灯是竖向柔光板：窄边是直的，边上有一圈羽化，长边中间更亮、两头自己淡掉。
 * 轮廓上另有一条窄长的边光板。方位和仰角躲开 0°、90°、180°、270°，板子也从竖直偏开一点。
 * 不按仰角把天顶切掉，否则球的上下会各剩一块黑圆。白、黑和灰过渡都有。
 * 粗糙度只决定取哪一层模糊，一次双线性采样。
 */

const WIDTH = 128
const HEIGHT = 64
const LEVELS = 5
const RADII = [0, 1, 3, 7, 16]

const ROOM = { r: 12, g: 12, b: 14 }

type Panel = {
  /** 方位角，度。0 是正前方，向右增加。 */
  az: number
  /** 仰角，度。正数朝上。 */
  el: number
  /** 窄边半宽，度。这块里是满的。 */
  across: number
  /** 窄边外侧的羽化，度。 */
  feather: number
  /** 长边的衰减半径，度。中间亮，两头淡。 */
  along: number
  /** 相对竖直偏转的角度。0 是正竖直。 */
  lean: number
  r: number
  g: number
  b: number
}

/**
 * 左前方一块竖向柔光板，旁边一块灰板把白和黑接上。
 * 右后一条窄的边缘光板，贴着轮廓。角度都不落在 90° 的整数倍上。
 */
const PANELS: Panel[] = [
  { az: -36, el: 8, across: 11, feather: 16, along: 52, lean: 8, r: 176, g: 178, b: 184 },
  { az: -12, el: 4, across: 4, feather: 12, along: 44, lean: -7, r: 108, g: 110, b: 116 },
  { az: 166, el: 2, across: 2.4, feather: 4.5, along: 46, lean: -4, r: 196, g: 198, b: 204 },
  { az: 82, el: -4, across: 5, feather: 10, along: 30, lean: 9, r: 62, g: 64, b: 70 },
  { az: -78, el: 0, across: 5, feather: 10, along: 34, lean: 7, r: 56, g: 58, b: 64 },
]

const SAMPLE = { r: 0, g: 0, b: 0 }

function clamp01(n: number) {
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function window1d(distance: number, half: number, feather: number) {
  if (distance <= half) return 1
  if (distance >= half + feather) return 0
  const t = (distance - half) / feather
  const s = t * t * (3 - 2 * t)
  return 1 - s
}

function wrapSigned(d: number) {
  let x = d
  while (x > 0.5) x -= 1
  while (x < -0.5) x += 1
  return x
}

/**
 * 柔光板的权重。窄边是直的，外侧羽化。长边中间亮、两头按距离淡掉，不收成圆头，也不在天顶切一刀。
 */
function panelWeight(u: number, v: number, panel: Panel) {
  const elev = (0.5 - v) * 180
  const az = wrapSigned(u - panel.az / 360) * 360
  const el = elev - panel.el
  const lean = (panel.lean * Math.PI) / 180
  const c = Math.cos(lean)
  const s = Math.sin(lean)
  const across = Math.abs(az * c + el * s)
  const along = (-az * s + el * c) / panel.along
  const side = window1d(across, panel.across, panel.feather)
  const axial = Math.exp(-0.5 * along * along)
  return side * axial
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
