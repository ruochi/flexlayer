import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { solidBoxGlb } from './glb.js'
import { checkFvg, renderFvg } from './render.js'
import type { RenderOptions } from './types.js'

const dir = mkdtempSync(join(tmpdir(), 'flexlayer-software-mesh-'))
writeFileSync(join(dir, 'box.glb'), solidBoxGlb([0.15, 0.82, 0.35, 1]))

function render(source: string, options: RenderOptions = {}) {
  return renderFvg(source, options)
}

async function pixelAt(png: Buffer, x: number, y: number) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(x, y, 1, 1).data
}

describe('软件光栅', () => {
  it('球体中心有颜色，画布角仍是背景', async () => {
    const { png } = await render(
      `<layer width="160" height="160" background="#123456" perspective="500"><sphere cx="80" cy="80" r="36" fill="#ff2244" /></layer>`,
    )
    const center = await pixelAt(png, 80, 80)
    const corner = await pixelAt(png, 4, 4)
    expect(center[0]).toBeGreaterThan(140)
    expect(center[0]).toBeGreaterThan(center[1] + 30)
    expect(center[0]).toBeGreaterThan(center[2] + 30)
    expect(corner[0]).toBeGreaterThan(10)
    expect(corner[0]).toBeLessThan(40)
    expect(corner[2]).toBeGreaterThan(70)
  })

  it('更近的球体挡住长方体和平面', async () => {
    const { png } = await render(`
      <layer width="200" height="200" background="#000000" perspective="600">
        <box x="40" y="60" width="120" height="80" depth="40" fill="#2244ff" />
        <rect x="20" y="40" width="160" height="120" fill="#22cc44" z="-30" />
        <sphere cx="100" cy="100" r="26" z="50" fill="#ff2244" />
      </layer>
    `)
    const center = await pixelAt(png, 100, 100)
    const onBox = await pixelAt(png, 52, 100)
    expect(center[0]).toBeGreaterThan(center[2] + 20)
    expect(onBox[2]).toBeGreaterThan(onBox[0] + 20)
  })

  it('extrude 的剪影跟着路径走', async () => {
    const { png } = await render(
      `<layer width="220" height="160" background="#101010" perspective="800"><extrude x="40" y="40" d="M0 0 H140 V36 H90 V80 H0 Z" depth="16" fill="#f4f1ea" /></layer>`,
    )
    const inside = await pixelAt(png, 60, 60)
    const notch = await pixelAt(png, 160, 100)
    expect(inside[0]).toBeGreaterThan(120)
    expect(inside[0]).toBeGreaterThan(notch[0] + 80)
    expect(notch[0]).toBeLessThan(40)
  })

  it('glb 按外包 layer 居中，并使用文件里的颜色', async () => {
    const { png } = await render(
      `<layer width="180" height="180" background="#000000" perspective="700"><layer x="55" y="55" width="70" height="70"><model src="box.glb" /></layer></layer>`,
      { baseDir: dir },
    )
    const center = await pixelAt(png, 90, 90)
    const corner = await pixelAt(png, 4, 4)
    expect(center[1]).toBeGreaterThan(center[0] + 20)
    expect(center[1]).toBeGreaterThan(center[2] + 20)
    expect(corner[0]).toBeLessThan(15)
    expect(corner[1]).toBeLessThan(15)
  })

  it('平面上的深色在有网格时不变浅，正对镜头的白方块达到 fill', async () => {
    const { png } = await render(`
      <layer width="220" height="140" background="#ffffff" perspective="500">
        <rect x="15" y="50" width="70" height="40" fill="#222222" />
        <box x="126" y="46" width="48" height="48" depth="48" fill="#ffffff" />
      </layer>
    `)
    const ink = await pixelAt(png, 50, 70)
    const face = await pixelAt(png, 150, 70)
    expect(ink[0]).toBeGreaterThan(24)
    expect(ink[0]).toBeLessThan(50)
    expect(face[0]).toBeGreaterThan(245)
    expect(face[1]).toBeGreaterThan(245)
    expect(face[2]).toBeGreaterThan(245)
  })

  it('偏离光轴的浅色正面仍是写下的 fill', async () => {
    const { png } = await render(`
      <layer width="220" height="80" background="#ffffff" perspective="500">
        <box x="12" y="16" width="48" height="48" depth="12" fill="#d9ccff" />
        <box x="160" y="16" width="48" height="48" depth="12" fill="#a9dcff" />
      </layer>
    `)
    const left = await pixelAt(png, 36, 40)
    const right = await pixelAt(png, 184, 40)
    expect([left[0], left[1], left[2]]).toEqual([0xd9, 0xcc, 0xff])
    expect([right[0], right[1], right[2]]).toEqual([0xa9, 0xdc, 0xff])
  })

  it('球体沿主光在平面上投下影子，没挡住的地方仍是 fill', async () => {
    const { png } = await render(`
      <layer width="240" height="240" background="#ffffff" perspective="800">
        <rect x="10" y="100" width="220" height="120" fill="#ffffff" />
        <sphere cx="70" cy="70" r="24" z="70" fill="#ff2244" />
      </layer>
    `)
    const shade = await pixelAt(png, 112, 130)
    const open = await pixelAt(png, 210, 200)
    const sphere = await pixelAt(png, 65, 65)
    expect(shade[0]).toBeLessThan(180)
    expect(Math.abs(shade[0] - shade[1])).toBeLessThan(12)
    expect(Math.abs(shade[1] - shade[2])).toBeLessThan(12)
    expect(open[0]).toBeGreaterThan(245)
    expect(open[1]).toBeGreaterThan(245)
    expect(open[2]).toBeGreaterThan(245)
    expect(sphere[0]).toBeGreaterThan(sphere[1] + 30)
    expect(sphere[0]).toBeGreaterThan(140)
  })

  it('球体的影子落在长方体正面，没挡住的正面仍是 fill', async () => {
    const { png } = await render(`
      <layer width="420" height="360" background="#d9d3c7" perspective="800">
        <box x="150" y="115" width="160" height="150" depth="20" fill="#f4f1ea" />
        <sphere cx="130" cy="110" r="28" z="48" fill="#e23d3d" />
      </layer>
    `)
    const shade = await pixelAt(png, 168, 158)
    const open = await pixelAt(png, 280, 240)
    expect(shade[0]).toBeLessThan(open[0] - 40)
    expect(Math.abs(shade[0] - shade[1])).toBeLessThan(12)
    expect([open[0], open[1], open[2]]).toEqual([0xf4, 0xf1, 0xea])
  })

  it('更靠近主光的长方体挡住后面的平面', async () => {
    const { png } = await render(`
      <layer width="240" height="240" background="#ffffff" perspective="800">
        <rect x="50" y="80" width="180" height="140" fill="#ffffff" />
        <box x="52" y="45" width="36" height="70" depth="36" z="48" fill="#3355aa" />
      </layer>
    `)
    const shade = await pixelAt(png, 102, 128)
    const open = await pixelAt(png, 210, 200)
    expect(shade[0]).toBeLessThan(180)
    expect(Math.abs(shade[0] - shade[1])).toBeLessThan(12)
    expect(open[0]).toBeGreaterThan(245)
    expect(open[1]).toBeGreaterThan(245)
    expect(open[2]).toBeGreaterThan(245)
  })

  it('三维场景里的平面颜色保持原色阶', async () => {
    const { png } = await render(`
      <layer width="180" height="80" background="#ffffff" perspective="500">
        <rect x="20" y="20" width="60" height="40" fill="#2b6b5e" />
        <sphere cx="130" cy="40" r="18" fill="#888888" />
      </layer>
    `)
    const ink = await pixelAt(png, 50, 40)
    expect([ink[0], ink[1], ink[2]]).toEqual([0x2b, 0x6b, 0x5e])
  })

  it('extrude 的并排形状都留下，洞仍然是洞', async () => {
    const { png } = await render(`
      <layer width="220" height="120" background="#101010" perspective="800">
        <extrude x="10" y="46" d="M0 0 H28 V28 H0 Z M52 0 H80 V28 H52 Z" depth="12" fill="#f2f2f2" />
        <extrude x="128" y="28" d="M0 0 H64 V64 H0 Z M18 18 H46 V46 H18 Z" depth="12" fill="#f2f2f2" />
      </layer>
    `)
    const left = await pixelAt(png, 28, 60)
    const gap = await pixelAt(png, 50, 60)
    const right = await pixelAt(png, 72, 60)
    const ring = await pixelAt(png, 140, 60)
    const hole = await pixelAt(png, 160, 60)
    expect(left[0]).toBeGreaterThan(180)
    expect(right[0]).toBeGreaterThan(180)
    expect(gap[0]).toBeLessThan(40)
    expect(ring[0]).toBeGreaterThan(180)
    expect(hole[0]).toBeLessThan(40)
  })

  it('网格超出所在 layer 时仍画在父画布上', async () => {
    const spilled = await render(`
      <layer width="200" height="120" background="#000000">
        <layer x="90" y="25" width="80" height="70" perspective="180">
          <sphere cx="16" cy="35" r="14" z="50" fill="#ff2244" />
        </layer>
      </layer>
    `)
    const layerLeft = 130 - 40
    const outside = await pixelAt(spilled.png, layerLeft - 6, 60)
    expect(outside[0]).toBeGreaterThan(80)
    expect(spilled.report.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(false)
    const clipped = await checkFvg(
      `<layer width="80" height="80" background="#000" perspective="160"><sphere cx="14" cy="40" r="12" z="70" fill="#ff2244" /></layer>`,
    )
    expect(clipped.issues.some((issue) => issue.code === 'overflow-canvas' && issue.path.includes('sphere'))).toBe(true)
  })

  it('网格斜边有抗锯齿过渡', async () => {
    const { png } = await render(
      `<layer width="200" height="200" background="#000000" perspective="800"><box x="20" y="93" width="160" height="14" depth="2" rotate="24" fill="#ffffff" /></layer>`,
    )
    const img = await loadImage(png)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, img.width, img.height).data
    const at = (x: number, y: number) => data[(y * img.width + x) * 4] ?? 0
    let hard = 0
    let soft = 0
    for (let x = 30; x < 170; x++) {
      let kind = 'none'
      let prev = at(x, 30)
      for (let y = 31; y < 170; y++) {
        const v = at(x, y)
        if (prev < 12 && v > 243) {
          kind = 'hard'
          break
        }
        if (prev < 12 && v >= 12) {
          kind = 'soft'
          break
        }
        prev = v
      }
      if (kind === 'hard') hard++
      else if (kind === 'soft') soft++
    }
    expect(at(100, 100)).toBeGreaterThan(250)
    expect(at(8, 8)).toBeLessThan(8)
    expect(soft).toBeGreaterThan(80)
    expect(hard).toBeLessThan(8)
  })
})
