import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { checkLayer, renderLayer } from './render.js'

async function imageOf(png: Buffer) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx
}

function lumaOf(px: Uint8ClampedArray, i: number) {
  return px[i]! * 0.3 + px[i + 1]! * 0.59 + px[i + 2]! * 0.11
}

/** 边上像素里，亮度落在内暗外亮之间的比例。邻居超出区域的不算。 */
function edgeMidRatio(data: Uint8ClampedArray, width: number, x0: number, y0: number, x1: number, y1: number) {
  const at = (x: number, y: number) => lumaOf(data, (y * width + x) * 4)
  let lo = 999
  let hi = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const v = at(x, y)
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
  }
  const span = hi - lo
  let edge = 0
  let mid = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const v = at(x, y)
      let boundary = false
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue
        if (Math.abs(at(nx, ny) - v) > span * 0.25) boundary = true
      }
      if (!boundary) continue
      edge++
      const t = (v - lo) / span
      if (t > 0.12 && t < 0.88) mid++
    }
  }
  return edge === 0 ? 0 : mid / edge
}

describe('lighting', () => {
  it('灯和霓虹不写数字，没写 fill 用默认色', async () => {
    const bad = await checkLayer(
      `<layer width="120" height="120" camera="400"><sphere cx="60" cy="60" r="20" material="neon 0.4" /></layer>`,
    )
    expect(bad.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('不写粗糙度'))).toBe(true)
    const ok = await checkLayer(
      `<layer width="120" height="120" camera="400"><sphere cx="60" cy="60" r="20" material="lamp" /></layer>`,
    )
    expect(ok.issues.filter((issue) => issue.code === 'invalid-attr')).toEqual([])
  })

  it('红球抬高旁边白球朝向它的一侧', async () => {
    const { png } = await renderLayer(`
      <layer width="240" height="180" background="#101010" camera="500">
        <sphere cx="70" cy="90" r="28" fill="#e02020" material="matte" />
        <sphere cx="150" cy="90" r="28" fill="#f4f4f4" material="matte" />
      </layer>
    `)
    const ctx = await imageOf(png)
    const near = ctx.getImageData(128, 90, 1, 1).data
    const far = ctx.getImageData(172, 90, 1, 1).data
    const bias = (px: Uint8ClampedArray) => px[0]! - px[1]!
    expect(bias(near)).toBeGreaterThan(bias(far) + 10)
  })

  it('灯照亮地面，同一张图再画一次字节相同', async () => {
    const scene = `<layer width="200" height="160" background="#101010" camera="400"><sphere cx="100" cy="62" r="16" material="lamp" /><ground x="100" y="128" rotateX="90" fill="#202228" shadow-opacity="0" /></layer>`
    const first = await renderLayer(scene)
    const second = await renderLayer(scene)
    expect(Buffer.compare(first.png, second.png)).toBe(0)
    const ctx = await imageOf(first.png)
    const luma = (px: Uint8ClampedArray) => px[0]! * 0.3 + px[1]! * 0.59 + px[2]! * 0.11
    const pool = luma(ctx.getImageData(100, 125, 1, 1).data)
    const far = luma(ctx.getImageData(16, 140, 1, 1).data)
    expect(pool).toBeGreaterThan(far + 4)
  })

  it('灯的光池沿一行相邻亮度差不超过 3', async () => {
    const { png } = await renderLayer(`
      <layer width="180" height="120" background="#101014" camera="360">
        <sphere cx="90" cy="48" r="12" material="lamp" />
        <ground y="96" rotateX="82" fill="#24262e" shadow-opacity="0" />
      </layer>
    `)
    const ctx = await imageOf(png)
    const lumaAt = (x: number, y: number) => {
      const px = ctx.getImageData(x, y, 1, 1).data
      return px[0]! * 0.3 + px[1]! * 0.59 + px[2]! * 0.11
    }
    const y = 92
    const line = Array.from({ length: 160 }, (_, i) => lumaAt(10 + i, y))
    const mid = line[80]!
    const edge = Math.min(line[0]!, line[line.length - 1]!)
    expect(mid).toBeGreaterThan(edge + 4)
    let jump = 0
    for (let i = 1; i < line.length; i++) jump = Math.max(jump, Math.abs(line[i]! - line[i - 1]!))
    expect(jump).toBeLessThanOrEqual(3)
  })

  it('扁霓虹圆环下的光池没有台阶', async () => {
    const { png } = await renderLayer(`
      <layer width="360" height="200" background="#101014" camera="640">
        <torus cx="180" cy="78" r="70" tube="10" fill="#3ad8ff" material="neon" rotateX="68" />
        <ground y="168" rotateX="78" fill="#1c1e26" shadow-opacity="0" />
      </layer>
    `)
    const ctx = await imageOf(png)
    const frame = ctx.getImageData(0, 0, 360, 200).data
    const lumaAt = (x: number, y: number) => {
      const i = (y * 360 + x) * 4
      return frame[i]! * 0.3 + frame[i + 1]! * 0.59 + frame[i + 2]! * 0.11
    }
    const y0 = 144
    const y1 = 176
    const x0 = 50
    const x1 = 310
    let brightest = 0
    let dimmest = 255
    let jump = 0
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const L = lumaAt(x, y)
        brightest = Math.max(brightest, L)
        dimmest = Math.min(dimmest, L)
        if (x < x1) jump = Math.max(jump, Math.abs(lumaAt(x + 1, y) - L))
        if (y < y1) jump = Math.max(jump, Math.abs(lumaAt(x, y + 1) - L))
      }
    }
    expect(brightest).toBeGreaterThan(dimmest + 4)
    expect(jump).toBeLessThanOrEqual(3)
  })

  it('硬地面影子的边上多数是中间色', async () => {
    const { png } = await renderLayer(`
      <layer width="240" height="160" background="#efeae2" camera="420">
        <sphere cx="120" cy="48" r="16" fill="#2c5f8a" material="clay" />
        <ground y="118" rotateX="76" fill="#e7e1d6" shadow-blur="0" shadow-opacity="0.8" />
      </layer>
    `)
    const ctx = await imageOf(png)
    const frame = ctx.getImageData(0, 0, 240, 160).data
    expect(edgeMidRatio(frame, 240, 131, 88, 174, 109)).toBeGreaterThanOrEqual(0.6)
  })

  it('投在板上的影子边上多数是中间色', async () => {
    const { png } = await renderLayer(`
      <layer width="360" height="230" background="#cfc8bc" camera="490">
        <box x="150" y="88" width="150" height="115" depth="9" fill="#f7f4ee" />
        <sphere cx="125" cy="82" r="24" z="39" fill="#e23d3d" material="clay" />
      </layer>
    `)
    const ctx = await imageOf(png)
    const frame = ctx.getImageData(0, 0, 360, 230).data
    expect(edgeMidRatio(frame, 360, 150, 88, 180, 148)).toBeGreaterThanOrEqual(0.6)
  })

  it('离地球的软影一列只有一个谷', async () => {
    const { png } = await renderLayer(`
      <layer width="280" height="180" background="#efeae2" camera="520">
        <sphere cx="140" cy="36" r="14" fill="#2c5f8a" material="clay" />
        <ground y="140" rotateX="74" fill="#e7e1d6" shadow-blur="80" shadow-opacity="0.8" />
      </layer>
    `)
    const ctx = await imageOf(png)
    const frame = ctx.getImageData(0, 0, 280, 180).data
    const at = (x: number, y: number) => lumaOf(frame, (y * 280 + x) * 4)
    let center = { x: 0, y: 0, v: 999 }
    for (let y = 80; y <= 150; y++) {
      for (let x = 80; x <= 240; x++) {
        const v = at(x, y)
        if (v < center.v) center = { x, y, v }
      }
    }
    const col: number[] = []
    for (let y = center.y - 36; y <= center.y + 36; y++) col.push(at(center.x, y))
    let jump = 0
    let sign = 0
    let changes = 0
    for (let i = 1; i < col.length; i++) {
      const d = col[i]! - col[i - 1]!
      jump = Math.max(jump, Math.abs(d))
      if (Math.abs(d) < 0.5) continue
      const s = d > 0 ? 1 : -1
      if (sign !== 0 && s !== sign) changes++
      sign = s
    }
    expect(col[0]! - center.v).toBeGreaterThan(8)
    expect(jump).toBeLessThanOrEqual(3)
    expect(changes).toBe(1)
  })
})
