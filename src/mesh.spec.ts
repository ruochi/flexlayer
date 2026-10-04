import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { solidBoxGlb } from './glb.js'
import { checkFvg, renderFvg } from './render.js'
import { tessellateSvgPath } from './path.js'

const dir = mkdtempSync(join(tmpdir(), 'flexlayer-mesh-'))
writeFileSync(join(dir, 'box.glb'), solidBoxGlb([0.15, 0.82, 0.35, 1]))

async function pixelAt(png: Buffer, x: number, y: number) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(x, y, 1, 1).data
}

describe('网格布局', () => {
  it('sphere 的盒子是边长 2r 的正方形，box 的布局不计 depth', async () => {
    const report = await checkFvg(`
      <layer width="200" height="120" perspective="400">
        <sphere cx="40" cy="50" r="10">
        <box cx="120" cy="50" width="30" height="20" depth="80" />
      </layer>
    `)
    const sphere = report.elements.find((el) => el.tag === 'sphere')
    const box = report.elements.find((el) => el.tag === 'box')
    expect(sphere).toMatchObject({ box: { x: 30, y: 40, width: 20, height: 20 } })
    expect(box).toMatchObject({ box: { x: 105, y: 40, width: 30, height: 20 } })
    expect(report.issues.some((issue) => issue.code === 'unknown-tag')).toBe(false)
  })

  it('extrude 按路径包围盒居中', async () => {
    const report = await checkFvg(
      `<layer width="640" height="800" perspective="700"><extrude d="M0 0 H140 V36 H90 V80 H0 Z" depth="18" cx="320" cy="640" /></layer>`,
    )
    const extrude = report.elements.find((el) => el.tag === 'extrude')
    expect(extrude).toMatchObject({ box: { x: 250, y: 600, width: 140, height: 80 } })
  })

  it('model 撑满外包 layer，cx 写在 model 上会警告', async () => {
    const report = await checkFvg(
      `<layer width="200" height="120"><model src="missing.glb" cx="10" /></layer>`,
      { baseDir: dir },
    )
    const model = report.elements.find((el) => el.tag === 'model')
    expect(model).toMatchObject({ box: { x: 0, y: 0, width: 200, height: 120 } })
    expect(report.issues.some((issue) => issue.code === 'missing-model')).toBe(true)
    expect(report.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('model'))).toBe(true)
  })

  it('不是 glb、以及没写 depth，会警告', async () => {
    const report = await checkFvg(
      `<layer width="100" height="80" perspective="300"><model src="hero.png" /><box cx="40" cy="40" width="20" height="10" /></layer>`,
      { baseDir: dir },
    )
    expect(report.issues.some((issue) => issue.code === 'missing-model')).toBe(true)
    expect(report.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('depth'))).toBe(true)
  })

  it('没有 perspective 的网格报 flatten-3d，并且不绘制', async () => {
    const source = `<layer width="80" height="80" background="#010203"><sphere cx="40" cy="40" r="20" fill="#ff0000" /></layer>`
    const report = await checkFvg(source)
    expect(report.issues.some((issue) => issue.code === 'flatten-3d')).toBe(true)
    const px = await pixelAt((await renderFvg(source)).png, 40, 40)
    expect(px[0]).toBeLessThan(20)
    expect(px[1]).toBeLessThan(20)
    expect(px[2]).toBeLessThan(20)
  })

  it('路径折线保留矩形的四个角', () => {
    const rings = tessellateSvgPath('M0 0 H10 V10 H0 Z')
    expect(rings).toHaveLength(1)
    expect(rings[0]?.closed).toBe(true)
    expect(rings[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ])
  })
})

describe('网格绘制', () => {
  it('球体中心有颜色，画布角仍是背景', async () => {
    const { png } = await renderFvg(
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
  }, 30000)

  it('更近的球体挡住长方体和平面', async () => {
    const { png } = await renderFvg(`
      <layer width="200" height="200" background="#000000" perspective="600">
        <box cx="100" cy="100" width="120" height="80" depth="40" fill="#2244ff" />
        <rect cx="100" cy="100" width="160" height="120" fill="#22cc44" z="-30" />
        <sphere cx="100" cy="100" r="26" z="50" fill="#ff2244" />
      </layer>
    `)
    const center = await pixelAt(png, 100, 100)
    const onBox = await pixelAt(png, 52, 100)
    expect(center[0]).toBeGreaterThan(center[2] + 20)
    expect(onBox[2]).toBeGreaterThan(onBox[0] + 20)
  }, 30000)

  it('extrude 的剪影跟着路径走', async () => {
    const { png } = await renderFvg(
      `<layer width="220" height="160" background="#101010" perspective="800"><extrude d="M0 0 H140 V36 H90 V80 H0 Z" depth="16" cx="110" cy="80" fill="#f4f1ea" /></layer>`,
    )
    const inside = await pixelAt(png, 60, 60)
    const notch = await pixelAt(png, 160, 100)
    expect(inside[0]).toBeGreaterThan(120)
    expect(inside[0]).toBeGreaterThan(notch[0] + 80)
    expect(notch[0]).toBeLessThan(40)
  }, 30000)

  it('glb 按外包 layer 居中，并使用文件里的颜色', async () => {
    const { png } = await renderFvg(
      `<layer width="180" height="180" background="#000000" perspective="700"><layer cx="90" cy="90" width="70" height="70"><model src="box.glb" /></layer></layer>`,
      { baseDir: dir },
    )
    const center = await pixelAt(png, 90, 90)
    const corner = await pixelAt(png, 4, 4)
    expect(center[1]).toBeGreaterThan(center[0] + 20)
    expect(center[1]).toBeGreaterThan(center[2] + 20)
    expect(corner[0]).toBeLessThan(15)
    expect(corner[1]).toBeLessThan(15)
  }, 30000)
})
