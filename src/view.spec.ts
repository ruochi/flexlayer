import { createCanvas, loadImage } from '@napi-rs/canvas'
import { beforeAll, describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { initFontsForMeasure } from './fonts.js'
import { checkFvg, renderFvg } from './render.js'
import { zoomView } from './view.js'

beforeAll(async () => {
  for (const dir of [join(homedir(), '.cache', 'flexlayer', 'fonts'), '/tmp/flexlayer-test']) {
    if (await initFontsForMeasure({ fontsCacheDir: dir })) break
  }
})

async function pixelAt(png: Buffer, x: number, y: number) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(x, y, 1, 1).data
}

const page = (body: string, attrs = 'width="100" height="100" safe="0"') =>
  `<layer ${attrs} background="#000000">${body}</layer>`

describe('view', () => {
  it('zoomView 以中心推近', () => {
    expect(zoomView([100, 50], 2, [200, 100])).toBe('50 25 100 50')
    expect(zoomView([360, 200], 1, [640, 360])).toBe('40 20 640 360')
  })

  it('取景窗铺满 view 指定的舞台矩形，窗外的不画', async () => {
    const { png, report } = await renderFvg(
      page(`
        <layer width="40" height="40" view="20 0 20 20">
          <rect x="0" y="0" width="40" height="20" fill="#ff0000" />
          <rect x="20" y="0" width="20" height="20" fill="#00ff00" />
        </layer>
        <rect x="0" y="32" width="8" height="8" fill="#0000ff" />
      `, 'width="40" height="40" safe="0"'),
    )
    const green = report.elements.find((el) => el.tag === 'rect' && el.view == null && (el.ink.width ?? 0) > 20)
    expect(green?.screenScale).toBeCloseTo(2, 2)
    expect(green?.ink.left).toBeCloseTo(0, 0)
    expect(green?.ink.top).toBeCloseTo(0, 0)
    expect(green?.ink.width).toBeCloseTo(40, 0)
    expect(green?.ink.height).toBeCloseTo(40, 0)
    expect(report.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(false)
    expect(report.issues.some((issue) => issue.code === 'view-outside')).toBe(false)
    const mid = await pixelAt(png, 20, 20)
    expect(mid[1]).toBeGreaterThan(200)
    expect(mid[0]).toBeLessThan(40)
    const hud = await pixelAt(png, 2, 36)
    expect(hud[2]).toBeGreaterThan(200)
    expect(hud[1]).toBeLessThan(40)
  })

  it('舞台盖不住 view 时报 view-outside，比例不对就重算高度', async () => {
    const outside = await checkFvg(
      page(`<layer width="100" height="100" view="-10 0 50 50"><layer width="80" height="80"><rect x="0" y="0" width="80" height="80" fill="#fff" /></layer></layer>`),
    )
    expect(outside.issues.some((issue) => issue.code === 'view-outside' && issue.level === 'error')).toBe(true)

    const fitted = await checkFvg(
      page(`<layer width="100" height="50" view="0 0 40 40"><rect x="0" y="0" width="80" height="80" fill="#fff" /></layer>`, 'width="100" height="50" safe="0"'),
    )
    const view = fitted.elements.find((el) => el.view)?.view
    expect(view?.width).toBeCloseTo(40)
    expect(view?.height).toBeCloseTo(20)
    expect(fitted.issues.some((issue) => issue.message.includes('宽高比'))).toBe(true)
  })

  it('转过的矩形盖不住镜头时报 view-outside，放大后的矩形盖住就不报', async () => {
    const turned = await checkFvg(
      page(
        `<layer width="100" height="100" view="0 0 100 100"><rect x="0" y="0" width="100" height="100" rotate="45" fill="#fff" /></layer>`,
        'width="120" height="120" safe="0"',
      ),
    )
    expect(turned.issues.some((issue) => issue.code === 'view-outside' && issue.level === 'error')).toBe(true)

    const grown = await checkFvg(
      page(
        `<layer width="100" height="100" view="0 0 100 100"><rect x="0" y="0" width="50" height="50" scale="2" origin="top-left" fill="#fff" /></layer>`,
        'width="100" height="100" safe="0"',
      ),
    )
    expect(grown.issues.some((issue) => issue.code === 'view-outside')).toBe(false)

    const bare = await checkFvg(
      page(
        `<layer width="100" height="100" view="0 0 100 100"><rect x="0" y="0" width="50" height="50" fill="#fff" /></layer>`,
        'width="100" height="100" safe="0"',
      ),
    )
    expect(bare.issues.some((issue) => issue.code === 'view-outside')).toBe(true)
  })

  it('g 旋转后露出的角报 view-outside，转完仍盖住就不报', async () => {
    const turned = await checkFvg(
      page(
        `<layer width="100" height="100" view="0 0 100 100"><g transform="rotate(45 50 50)"><rect x="0" y="0" width="100" height="100" fill="#fff" /></g></layer>`,
        'width="120" height="120" safe="0"',
      ),
    )
    expect(turned.issues.some((issue) => issue.code === 'view-outside' && issue.level === 'error')).toBe(true)

    const nested = await checkFvg(
      page(
        `<layer width="100" height="100" view="0 0 100 100"><g transform="rotate(45 50 50)"><g><rect x="0" y="0" width="100" height="100" fill="#fff" /></g></g></layer>`,
        'width="120" height="120" safe="0"',
      ),
    )
    expect(nested.issues.some((issue) => issue.code === 'view-outside' && issue.level === 'error')).toBe(true)

    const attr = await checkFvg(
      page(
        `<layer width="100" height="100" view="0 0 100 100"><g rotate="45"><rect x="0" y="0" width="100" height="100" fill="#fff" /></g></layer>`,
        'width="120" height="120" safe="0"',
      ),
    )
    expect(attr.issues.some((issue) => issue.code === 'view-outside' && issue.level === 'error')).toBe(true)

    const covered = await checkFvg(
      page(
        `<layer width="100" height="100" view="0 0 100 100"><g transform="rotate(45 50 50)"><rect x="-50" y="-50" width="200" height="200" fill="#fff" /></g></layer>`,
        'width="100" height="100" safe="0"',
      ),
    )
    expect(covered.issues.some((issue) => issue.code === 'view-outside')).toBe(false)

    const plain = await checkFvg(
      page(
        `<layer width="100" height="100" view="0 0 100 100"><g><rect x="0" y="0" width="100" height="100" fill="#fff" /></g></layer>`,
        'width="100" height="100" safe="0"',
      ),
    )
    expect(plain.issues.some((issue) => issue.code === 'view-outside')).toBe(false)
  })

  it('最小字号按短边，横竖屏同一档', async () => {
    const wide = await checkFvg(`<layer width="1920" height="1080" safe="0"><p style="font-size:28px; white-space:nowrap">正文</p></layer>`)
    expect(wide.issues.some((issue) => issue.code === 'min-font-size')).toBe(false)
    const wideSmall = await checkFvg(`<layer width="1920" height="1080" safe="0"><p style="font-size:20px; white-space:nowrap">正文</p></layer>`)
    expect(wideSmall.issues.find((issue) => issue.code === 'min-font-size')?.message).toContain('24.0px')
    const tall = await checkFvg(`<layer width="1080" height="1920" safe="0"><p style="font-size:20px; white-space:nowrap">正文</p></layer>`)
    expect(tall.issues.find((issue) => issue.code === 'min-font-size')?.message).toContain('24.0px')
  })

  it('最小字号和模糊外扩按屏幕尺寸', async () => {
    const shrunk = await checkFvg(
      `<layer width="1080" height="1080" safe="0"><p style="font-size:30px; white-space:nowrap; scale:0.5">字</p></layer>`,
    )
    const small = shrunk.issues.find((issue) => issue.code === 'min-font-size')
    expect(small?.message).toContain('屏幕上的字号 15.0px')

    const zoomed = await checkFvg(
      `<layer width="1080" height="400" safe="0"><layer width="1080" height="400" view="0 0 540 200"><layer width="540" height="200"><p style="font-size:16px; white-space:nowrap">字</p></layer></layer></layer>`,
    )
    expect(zoomed.issues.some((issue) => issue.code === 'min-font-size')).toBe(false)
    const text = zoomed.elements.find((el) => el.tag === 'p')
    expect(text?.screenScale).toBeCloseTo(2, 2)

    const glow = await checkFvg(
      page(`<rect x="30" y="30" width="20" height="20" fill="#fff" blur="8" scale="2" origin="top-left" />`),
    )
    expect(glow.issues.some((issue) => issue.code === 'effect-clipped')).toBe(true)
    const plain = await checkFvg(
      page(`<rect x="30" y="30" width="20" height="20" fill="#fff" blur="8" />`),
    )
    expect(plain.issues.some((issue) => issue.code === 'effect-clipped')).toBe(false)
  })

  it('取景窗外的着墨不报 overflow-canvas', async () => {
    const report = await checkFvg(
      page(
        `<layer width="100" height="50" view="0 0 100 50"><layer width="200" height="100"><circle cx="-20" cy="25" r="30" fill="#fff" /><rect x="0" y="0" width="200" height="100" fill="#fff" /></layer></layer>`,
        'width="100" height="50" safe="0"',
      ),
    )
    expect(report.issues.some((issue) => issue.code === 'overflow-canvas' || issue.code === 'view-outside')).toBe(false)
  })
})
