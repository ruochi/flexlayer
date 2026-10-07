import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { renderFvg } from './render.js'
import type { ElementReport } from './types.js'

type Bounds = { left: number; top: number; right: number; bottom: number }

async function alphaBounds(png: Buffer, alphaMin = 16): Promise<Bounds> {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height).data
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const alpha = data[(y * img.width + x) * 4 + 3] ?? 0
      if (alpha < alphaMin) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  expect(maxX).toBeGreaterThanOrEqual(0)
  return { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 }
}

function expectNear(actual: number, expected: number, label: string) {
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(1)
}

function expectSameBounds(ink: Bounds, pixels: Bounds) {
  expectNear(ink.left, pixels.left, 'left')
  expectNear(ink.top, pixels.top, 'top')
  expectNear(ink.right, pixels.right, 'right')
  expectNear(ink.bottom, pixels.bottom, 'bottom')
}

const ANCHORS = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const

function anchorPoint(bounds: Bounds, anchor: (typeof ANCHORS)[number]): [number, number] {
  const midX = (bounds.left + bounds.right) / 2
  const midY = (bounds.top + bounds.bottom) / 2
  switch (anchor) {
    case 'top-left':
      return [bounds.left, bounds.top]
    case 'top':
      return [midX, bounds.top]
    case 'top-right':
      return [bounds.right, bounds.top]
    case 'left':
      return [bounds.left, midY]
    case 'right':
      return [bounds.right, midY]
    case 'bottom-left':
      return [bounds.left, bounds.bottom]
    case 'bottom':
      return [midX, bounds.bottom]
    case 'bottom-right':
      return [bounds.right, bounds.bottom]
    default:
      return [midX, midY]
  }
}

function textEl(report: { elements: ElementReport[] }, tag: string) {
  const el = report.elements.find((item) => item.tag === tag)
  expect(el).toBeTruthy()
  return el!
}

describe('字形着墨', () => {
  it('横排 10.1 的报告 ink 与像素误差不超过 1px', async () => {
    const { png, report } = await renderFvg(
      `<layer width="1080" height="400" background="transparent" color="#1b1612" font-family="Song">
        <layer x="76" y="40" anchor="top-left"><h2 style="font-size:190px; font-weight:700; line-height:1; white-space:nowrap">10.1</h2></layer>
      </layer>`,
    )
    const h2 = textEl(report, 'h2')
    expectSameBounds(h2.ink, await alphaBounds(png))
    expect(h2.ink.left).toBeGreaterThan(h2.box.left + 1)
    expect(h2.ink.top).toBeGreaterThan(h2.box.top + 1)
    expect(h2.ink.right).toBeLessThan(h2.box.right - 1)
  })

  it('竖排文字的报告 ink 与像素误差不超过 1px', async () => {
    const { png, report } = await renderFvg(
      `<layer width="600" height="900" background="transparent" color="#1b1612" font-family="Song">
        <h1 style="font-size:180px; font-weight:700; line-height:1; writing-mode:vertical-rl">国庆</h1>
      </layer>`,
    )
    expectSameBounds(textEl(report, 'h1').ink, await alphaBounds(png))
  })

  it('中英数字混排的报告 ink 与像素误差不超过 1px', async () => {
    const { png, report } = await renderFvg(
      `<layer width="900" height="400" background="transparent" color="#1b1612" font-family="Song">
        <h1 style="font-size:120px; font-weight:700; line-height:1; white-space:nowrap">国A10</h1>
      </layer>`,
    )
    expectSameBounds(textEl(report, 'h1').ink, await alphaBounds(png))
  })
})

describe('outside-safe 按真实着墨', () => {
  const scene = (x: number) =>
    `<layer width="1080" height="1000" background="transparent" color="#1b1612" font-family="Song" safe="64">
      <layer x="${x}" y="80" anchor="top-left"><h2 style="font-size:190px; font-weight:700; line-height:1; white-space:nowrap">10.1</h2></layer>
    </layer>`

  it('盒子在安全区外、笔画在安全区内时不误报', async () => {
    const { report } = await renderFvg(scene(56))
    const h2 = textEl(report, 'h2')
    expect(h2.box.left).toBeCloseTo(56, 3)
    expect(h2.ink.left).toBeGreaterThanOrEqual(64)
    expect(report.issues.some((issue) => issue.code === 'outside-safe')).toBe(false)
  })

  it('真实笔画推到 60 时仍会报', async () => {
    const first = await renderFvg(scene(56))
    const inset = textEl(first.report, 'h2').ink.left - 56
    const { report } = await renderFvg(scene(60 - inset))
    const h2 = textEl(report, 'h2')
    expect(h2.ink.left).toBeCloseTo(60, 3)
    expect(report.issues.some((issue) => issue.code === 'outside-safe' && issue.path.includes('h2'))).toBe(true)
  })
})

describe('anchor-box=ink', () => {
  const placed = (anchor: string, x: number, y: number, extra = '') =>
    `<layer width="1000" height="1000" background="transparent" color="#111111" font-family="Song">
      <layer x="${x}" y="${y}" anchor="${anchor}" anchor-box="ink" ${extra}>
        <h2 style="font-size:160px; font-weight:700; line-height:1; white-space:nowrap">10.1</h2>
      </layer>
    </layer>`

  it('top-left 时笔画左上角落在 x y', async () => {
    const { png, report } = await renderFvg(placed('top-left', 76, 560))
    const pixels = await alphaBounds(png)
    expectNear(pixels.left, 76, 'left')
    expectNear(pixels.top, 560, 'top')
    const layer = report.elements.find((el) => el.anchorBox === 'ink')
    expect(layer?.inkOffset).toBeTruthy()
    expectNear(layer!.ink.left - layer!.box.left, layer!.inkOffset!.left, 'offset-left')
    expectNear(layer!.box.right - layer!.ink.right, layer!.inkOffset!.right, 'offset-right')
    expectNear(layer!.ink.top - layer!.box.top, layer!.inkOffset!.top, 'offset-top')
    expectNear(layer!.box.bottom - layer!.ink.bottom, layer!.inkOffset!.bottom, 'offset-bottom')
  })

  it.each(ANCHORS.filter((anchor) => anchor !== 'top-left'))('%s 的着墨九宫格点落在 x y', async (anchor) => {
    const { png } = await renderFvg(placed(anchor, 500, 500))
    const [x, y] = anchorPoint(await alphaBounds(png), anchor)
    expectNear(x, 500, 'x')
    expectNear(y, 500, 'y')
  })

  it('外层取两个子 layer 的着墨并集', async () => {
    const { png } = await renderFvg(
      `<layer width="800" height="800" background="transparent" color="#111111" font-family="Song">
        <layer x="120" y="140" anchor="top-left" anchor-box="ink">
          <layer x="30" y="20" anchor="top-left"><h1 style="font-size:100px; font-weight:700; line-height:1">甲</h1></layer>
          <layer x="220" y="90" anchor="top-left"><h2 style="font-size:64px; font-weight:700; line-height:1">乙</h2></layer>
        </layer>
      </layer>`,
    )
    const pixels = await alphaBounds(png)
    expectNear(pixels.left, 120, 'left')
    expectNear(pixels.top, 140, 'top')
  })

  it('use 也按着墨定位', async () => {
    const { png, report } = await renderFvg(
      `<layer width="600" height="400" background="transparent" color="#111111" font-family="Song">
        <symbol id="mark"><h1 style="font-size:120px; font-weight:700; line-height:1">国</h1></symbol>
        <use href="#mark" x="80" y="60" anchor="top-left" anchor-box="ink" />
      </layer>`,
    )
    const pixels = await alphaBounds(png)
    expectNear(pixels.left, 80, 'left')
    expectNear(pixels.top, 60, 'top')
    expect(report.elements.some((el) => el.tag === 'use' && el.anchorBox === 'ink')).toBe(true)
  })

  it('同时写 rotate 时说明对齐点是旋转前的着墨', async () => {
    const { report } = await renderFvg(
      `<layer width="400" height="400" background="transparent" font-family="Song">
        <layer x="200" y="200" anchor-box="ink" rotate="12"><h1 style="font-size:80px">国</h1></layer>
      </layer>`,
    )
    const hit = report.issues.find((issue) => issue.code === 'ink-anchor-rotate')
    expect(hit?.level).toBe('info')
    expect(hit?.message).toContain('旋转前的着墨')
    expect(report.elements.some((el) => el.anchorBox === 'ink')).toBe(true)
  })

  it('空文字退回盒子并报 info', async () => {
    const { report } = await renderFvg(
      `<layer width="400" height="300" background="transparent">
        <layer x="80" y="90" anchor="top-left" anchor-box="ink"><h1></h1></layer>
      </layer>`,
    )
    const hit = report.issues.find((issue) => issue.code === 'ink-anchor-empty')
    expect(hit?.level).toBe('info')
    const layer = report.elements.find((el) => el.path.includes('layer['))
    expect(layer?.box.left).toBeCloseTo(80, 3)
    expect(layer?.box.top).toBeCloseTo(90, 3)
    expect(layer?.anchorBox).toBeUndefined()
  })

  it('全透明子树退回盒子', async () => {
    const { report } = await renderFvg(
      `<layer width="400" height="300" background="transparent" font-family="Song">
        <layer x="80" y="90" anchor="top-left" anchor-box="ink"><h1 style="opacity:0; font-size:120px">国</h1></layer>
      </layer>`,
    )
    expect(report.issues.some((issue) => issue.code === 'ink-anchor-empty')).toBe(true)
    const layer = report.elements.find((el) => el.tag === 'layer' && el.path !== 'layer')
    expect(layer?.box.left).toBeCloseTo(80, 3)
    expect(layer?.anchorBox).toBeUndefined()
  })

  it('overflow=hidden 按裁剪后的着墨定位', async () => {
    const { png } = await renderFvg(
      `<layer width="500" height="300" background="transparent">
        <layer x="40" y="40" anchor="top-left" anchor-box="ink" width="120" height="80" overflow="hidden">
          <rect x="-30" y="10" width="80" height="40" fill="#000000" />
        </layer>
      </layer>`,
    )
    const pixels = await alphaBounds(png)
    expectNear(pixels.left, 40, 'left')
    expectNear(pixels.top, 40, 'top')
  })
})

describe('ink-inset', () => {
  it('190px 左对齐文字提示按着墨贴齐', async () => {
    const { report } = await renderFvg(
      `<layer width="800" height="400" background="transparent" color="#111" font-family="Song">
        <layer x="76" y="40" anchor="top-left"><h2 style="font-size:190px; font-weight:700; line-height:1; white-space:nowrap">10.1</h2></layer>
      </layer>`,
    )
    const hit = report.issues.find((issue) => issue.code === 'ink-inset')
    expect(hit?.level).toBe('info')
    expect(hit?.message).toMatch(/字形比盒子靠里 \d+px（左）/)
    expect(hit?.hint).toContain('anchor-box="ink"')
  })

  it('24px 小字不提示', async () => {
    const { report } = await renderFvg(
      `<layer width="400" height="200" background="transparent" color="#111">
        <layer x="40" y="40" anchor="top-left"><p style="font-size:24px; line-height:1">小字</p></layer>
      </layer>`,
    )
    expect(report.issues.some((issue) => issue.code === 'ink-inset')).toBe(false)
  })
})

describe('anchor-box 归属', () => {
  it('写在 HTML 上报 warn', async () => {
    const { report } = await renderFvg(`<layer width="200" height="100"><h1 anchor-box="ink">甲</h1></layer>`)
    const hit = report.issues.find((issue) => issue.message.includes('anchor-box'))
    expect(hit?.level).toBe('warn')
    expect(hit?.hint).toContain('layer')
  })
})
