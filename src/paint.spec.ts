import { beforeAll, describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { h } from './h.js'
import { initFontsForMeasure } from './fonts.js'
import { posePoint, project } from './perspective.js'
import { renderFvg } from './render.js'
import type { LayoutNode } from './types.js'

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

describe('paint containers', () => {
  it('竖向 flex 的子元素画在容器中间', async () => {
    const root = h(
      'layer',
      { width: '200', height: '200', background: '#000000' },
      h(
        'layer',
        { cx: '100', cy: '100' },
        h('div', { style: 'display:flex; flex-direction:column; width:80px' }, h('div', { style: 'width:80px; height:40px; background:#ffffff' }, 'A')),
      ),
    )
    const { png } = await renderFvg(root)
    const mid = await pixelAt(png, 100, 100)
    const origin = await pixelAt(png, 10, 10)
    expect(mid[0]).toBeGreaterThan(200)
    expect(origin[0]).toBeLessThan(20)
  })

  it('stroke="none" 的多边形只填充，不描边', async () => {
    const root = h(
      'layer',
      { width: '100', height: '100', background: '#ffffff' },
      h('polygon', { points: '20,20 80,20 80,80 20,80', fill: '#ff0000', stroke: 'none', 'stroke-width': '12' }),
    )
    const { png } = await renderFvg(root)
    const outside = await pixelAt(png, 16, 50)
    const inside = await pixelAt(png, 50, 50)
    expect(outside[0]).toBeGreaterThan(240)
    expect(outside[1]).toBeGreaterThan(240)
    expect(inside[0]).toBeGreaterThan(240)
    expect(inside[1]).toBeLessThan(20)
  })

  it('perspective 里 rotateY 把方块压窄，中心仍在', async () => {
    const flat = h(
      'Layer',
      { width: '200', height: '200', background: '#000000' },
      h('Rect', { cx: '100', cy: '100', width: '80', height: '80', fill: '#ffffff' }),
    )
    const turned = h(
      'Layer',
      { width: '200', height: '200', background: '#000000', perspective: '300' },
      h('Rect', { cx: '100', cy: '100', width: '80', height: '80', fill: '#ffffff', rotateY: '70' }),
    )
    const flatPx = await pixelAt((await renderFvg(flat)).png, 62, 100)
    const center = await pixelAt((await renderFvg(turned)).png, 100, 108)
    const edge = await pixelAt((await renderFvg(turned)).png, 62, 100)
    expect(flatPx[0]).toBeGreaterThan(200)
    expect(center[0]).toBeGreaterThan(200)
    expect(edge[0]).toBeLessThan(30)
  })

  it('二维方块保持硬边', async () => {
    const root = h(
      'Layer',
      { width: '80', height: '80', background: '#000000' },
      h('Rect', { cx: '40', cy: '40', width: '40', height: '40', fill: '#ffffff' }),
    )
    const png = (await renderFvg(root)).png
    expect((await pixelAt(png, 22, 40))[0]).toBe(255)
    expect((await pixelAt(png, 18, 40))[0]).toBe(0)
  })

  it('透视平面的斜边有抗锯齿过渡', async () => {
    const root = h(
      'Layer',
      { width: '200', height: '200', background: '#000000', perspective: '500' },
      h('Rect', { cx: '100', cy: '100', width: '120', height: '80', fill: '#ffffff', rotateY: '32' }),
    )
    const png = (await renderFvg(root)).png
    const box = { x: 40, y: 60, width: 120, height: 80, rotateY: 32, scale: 1, rotate: 0 } as LayoutNode
    const tl = project(100, 100, 500, posePoint(box, 0, 0))!
    const tr = project(100, 100, 500, posePoint(box, 120, 0))!
    const x = Math.round((tl.x + tr.x) / 2)
    const yEdge = (tl.y + tr.y) / 2
    let partial = 0
    let solid = false
    for (let y = Math.floor(yEdge) - 3; y <= Math.ceil(yEdge) + 8; y++) {
      const v = (await pixelAt(png, x, y))[0] ?? 0
      if (v > 15 && v < 240) partial++
      if (v > 250) solid = true
    }
    expect(partial).toBeGreaterThan(0)
    expect(solid).toBe(true)
    expect((await pixelAt(png, x, Math.floor(yEdge) - 6))[0]).toBeLessThan(8)
  })

  it('透视平面的发光和阴影画到平面外面', async () => {
    const glow = h(
      'layer',
      { width: '180', height: '180', background: '#000000', perspective: '400' },
      h('rect', { cx: '90', cy: '90', width: '50', height: '50', fill: '#ffffff', rotateX: '14', glow: '16 #00ff00' }),
    )
    const glowPng = (await renderFvg(glow)).png
    const plane = { x: 65, y: 65, width: 50, height: 50, rotateX: 14, scale: 1, rotate: 0 } as LayoutNode
    const glowAt = project(90, 90, 400, posePoint(plane, -8, 25))!
    const bodyAt = project(90, 90, 400, posePoint(plane, 25, 25))!
    const glowPx = await pixelAt(glowPng, Math.round(glowAt.x), Math.round(glowAt.y))
    const bodyPx = await pixelAt(glowPng, Math.round(bodyAt.x), Math.round(bodyAt.y))
    expect(glowPx[1]).toBeGreaterThan(25)
    expect(bodyPx[0]).toBeGreaterThan(220)
    expect(bodyPx[1]).toBeGreaterThan(220)

    const grid = h(
      'layer',
      { width: '640', height: '400', background: '#000000', perspective: '900' },
      h('rect', { cx: '320', cy: '200', width: '360', height: '200', fill: '#000000', rotateY: '32', glow: '36 #ffffff' }),
    )
    const gridPng = (await renderFvg(grid)).png
    const gridImg = await loadImage(gridPng)
    const gridCanvas = createCanvas(gridImg.width, gridImg.height)
    const gridCtx = gridCanvas.getContext('2d')
    gridCtx.drawImage(gridImg, 0, 0)
    const row = gridCtx.getImageData(0, 150, 640, 1).data
    let spikes = 0
    for (let x = 2; x < 638; x++) {
      const v = row[x * 4] ?? 0
      const left = row[(x - 2) * 4] ?? 0
      const right = row[(x + 2) * 4] ?? 0
      if (v > 12 && v > left + 18 && v > right + 18) spikes++
    }
    expect(spikes).toBe(0)

    const shadow = h(
      'layer',
      { width: '180', height: '180', background: '#000000', perspective: '400' },
      h('rect', { cx: '90', cy: '90', width: '50', height: '50', fill: '#ffffff', rotateX: '14', shadow: '18 0 4 #ff0000' }),
    )
    const shadowPng = (await renderFvg(shadow)).png
    const shadowAt = project(90, 90, 400, posePoint(plane, 62, 25))!
    const cornerAt = project(90, 90, 400, posePoint(plane, 4, 4))!
    const shadowPx = await pixelAt(shadowPng, Math.round(shadowAt.x), Math.round(shadowAt.y))
    const cornerPx = await pixelAt(shadowPng, Math.round(cornerAt.x), Math.round(cornerAt.y))
    expect(shadowPx[0]).toBeGreaterThan(40)
    expect(cornerPx[0]).toBeGreaterThan(220)
    expect(cornerPx[1]).toBeGreaterThan(220)
    expect(cornerPx[2]).toBeGreaterThan(220)
  })

  it('z 大的平面盖住后写但更远的平面', async () => {
    const root = h(
      'Layer',
      { width: '120', height: '120', background: '#000000', perspective: '400' },
      h('Rect', { cx: '60', cy: '60', width: '50', height: '50', fill: '#ff0000', z: '40' }),
      h('Rect', { cx: '60', cy: '60', width: '50', height: '50', fill: '#0000ff', z: '-30' }),
    )
    const px = await pixelAt((await renderFvg(root)).png, 60, 68)
    expect(px[0]).toBeGreaterThan(200)
    expect(px[2]).toBeLessThan(40)
  })

  it('layer 的 rotate 带着子元素绕中心转', async () => {
    const root = h(
      'layer',
      { width: '200', height: '200', background: '#000000' },
      h(
        'layer',
        { cx: '100', cy: '100', width: '100', height: '100', rotate: '90' },
        h('rect', { x1: '0', y1: '10', x2: '100', y2: '30', fill: '#ffffff' }),
      ),
    )
    const { png } = await renderFvg(root)
    // 层中心 (100,100)，顶边横条顺时针 90° 后落到 x=120..140
    const moved = await pixelAt(png, 130, 100)
    const vacated = await pixelAt(png, 100, 70)
    expect(moved[0]).toBeGreaterThan(200)
    expect(vacated[0]).toBeLessThan(20)
  })

  it('layer 的 scale 带着子元素一起缩放', async () => {
    const root = h(
      'layer',
      { width: '200', height: '200', background: '#000000' },
      h(
        'layer',
        { cx: '100', cy: '100', width: '100', height: '100', scale: '2' },
        h('rect', { cx: '50', cy: '50', width: '20', height: '20', fill: '#ffffff' }),
      ),
    )
    const { png } = await renderFvg(root)
    // 20px 方块绕 (100,100) 放大 2 倍，覆盖到 x=80
    const grown = await pixelAt(png, 85, 100)
    const stillOut = await pixelAt(png, 70, 100)
    expect(grown[0]).toBeGreaterThan(200)
    expect(stillOut[0]).toBeLessThan(20)
  })

  it('origin=top-left 时绕左上角旋转', async () => {
    const root = h(
      'layer',
      { width: '220', height: '160', background: '#000000' },
      h(
        'layer',
        { cx: '100', cy: '20', anchor: 'top-left', width: '100', height: '100', rotate: '90', origin: 'top-left' },
        h('rect', { x1: '0', y1: '40', x2: '10', y2: '80', fill: '#ffffff' }),
      ),
    )
    const { png } = await renderFvg(root)
    // 绕层的左上角 (100,20) 顺时针 90° 后，竖条变成 y=20 处的横条
    const moved = await pixelAt(png, 40, 25)
    const vacated = await pixelAt(png, 105, 80)
    expect(moved[0]).toBeGreaterThan(200)
    expect(vacated[0]).toBeLessThan(20)
  })

  it('overflow=hidden 裁掉超出 layer 的部分', async () => {
    const root = h(
      'layer',
      { width: '200', height: '100', background: '#000000' },
      h(
        'layer',
        { cx: '0', cy: '0', anchor: 'top-left', width: '100', height: '100', overflow: 'hidden' },
        h('rect', { cx: '90', cy: '50', width: '40', height: '40', fill: '#ffffff' }),
      ),
    )
    const { png } = await renderFvg(root)
    const inside = await pixelAt(png, 95, 50)
    const clipped = await pixelAt(png, 105, 50)
    expect(inside[0]).toBeGreaterThan(200)
    expect(clipped[0]).toBeLessThan(20)
  })

  it('文字和线条的 rotate、scale 生效', async () => {
    const text = h(
      'layer',
      { width: '200', height: '200', background: '#000000' },
      h('div', { style: 'width:120px; height:20px; background:#ffffff; rotate:90' }, 'A'),
    )
    const textPng = await renderFvg(text)
    expect((await pixelAt(textPng.png, 100, 50))[0]).toBeGreaterThan(200)
    expect((await pixelAt(textPng.png, 50, 100))[0]).toBeLessThan(20)

    const line = h(
      'layer',
      { width: '200', height: '200', background: '#000000' },
      h('line', { x1: '70', y1: '100', x2: '130', y2: '100', stroke: '#ffffff', 'stroke-width': '2', scale: '5' }),
    )
    const linePng = await renderFvg(line)
    expect((await pixelAt(linePng.png, 100, 96))[0]).toBeGreaterThan(200)
  })

  it('空 div 色块不报 text-overflow', async () => {
    const root = h(
      'layer',
      { width: '120', height: '80', background: '#000000' },
      h('layer', { cx: '10', cy: '10', anchor: 'top-left' }, h('div', { style: 'display:flex; gap:8px' }, h('div', { style: 'width:28px; height:28px; background:#ffffff' }))),
    )
    const { png, report } = await renderFvg(root)
    expect(report.issues.some((issue) => issue.code === 'text-overflow')).toBe(false)
    expect((await pixelAt(png, 20, 24))[0]).toBeGreaterThan(200)
  })

  it('flex:1 的分隔线占满剩余宽度', async () => {
    const root = h(
      'layer',
      { width: '300', height: '80', background: '#000000' },
      h(
        'layer',
        { cx: '10', cy: '30', anchor: 'top-left' },
        h(
          'div',
          { style: 'display:flex; width:280px; gap:8px; align-items:center' },
          h('p', { style: 'font-size:32px; color:#ffffff' }, '左'),
          h('div', { style: 'flex:1; height:4px; background:#ffffff' }),
          h('p', { style: 'font-size:32px; color:#ffffff' }, '右'),
        ),
      ),
    )
    const { png, report } = await renderFvg(root)
    expect(report.issues.filter((issue) => issue.level === 'error')).toEqual([])
    expect((await pixelAt(png, 150, 48))[0]).toBeGreaterThan(200)
  })

  it('flex 放进 layer 后位置由 layer 决定', async () => {
    const row = () => h('div', { style: 'display:flex; gap:12px; align-items:center' }, h('p', { style: 'font-size:32px; color:#ffffff' }, '甲乙'))
    const wrapped = h('layer', { width: '400', height: '120', background: '#000000' }, h('layer', { cx: '20', cy: '30', anchor: 'top-left' }, row()))
    const bare = h('layer', { width: '400', height: '120', background: '#000000' }, row())
    const placed = await renderFvg(wrapped)
    const centered = await renderFvg(bare)
    const placedBox = placed.report.elements.find((element) => element.tag === 'div')!.box
    const centeredBox = centered.report.elements.find((element) => element.tag === 'div')!.box
    expect(placedBox.left).toBeCloseTo(20, 0)
    expect(placedBox.top).toBeCloseTo(30, 0)
    expect(centeredBox.left).toBeGreaterThan(placedBox.left + 20)
  })
})
