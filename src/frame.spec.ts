import { beforeAll, describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { h } from './h.js'
import { initFontsForMeasure } from './fonts.js'
import { interpolate, renderComposition, sequence, spring, type Composition } from './frame.js'
import { renderFvg } from './render.js'

beforeAll(async () => {
  for (const dir of [join(homedir(), '.cache', 'flexlayer', 'fonts'), '/tmp/flexlayer-test']) {
    if (await initFontsForMeasure({ fontsCacheDir: dir })) break
  }
})

async function pixelAt(png: Buffer, x: number, y: number): Promise<[number, number, number, number]> {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(x, y, 1, 1).data
  return [d[0]!, d[1]!, d[2]!, d[3]!]
}

const slide: Composition = {
  id: 'slide',
  width: 32,
  height: 32,
  fps: 4,
  durationInFrames: 4,
  component: ({ frame }) =>
    h(
      'layer',
      { width: '32', height: '32', background: '#000000' },
      h('rect', { width: '8', height: '32', x: String(frame * 8), y: '0', fill: '#ffffff' }),
    ),
}

describe('el.t', () => {
  it('不传 t 时为 0，传入后 draw 读到同一个数', async () => {
    const seen: number[] = []
    const root = h(
      'layer',
      { width: '40', height: '40', background: '#ffffff' },
      h('rect', {
        width: '10',
        height: '10',
        x: '15',
        y: '15',
        fill: '#000000',
        draw: (_ctx, el) => {
          seen.push(el.t)
        },
      }),
    )
    await renderFvg(root)
    await renderFvg(root, { t: 1.5 })
    expect(seen).toEqual([0, 1.5])
  })
})

describe('renderComposition', () => {
  it('4 帧首尾像素不同，联系表是 PNG', async () => {
    const { frames, reports, contactSheet } = await renderComposition(slide)
    expect(frames).toHaveLength(4)
    expect(reports).toHaveLength(4)
    expect(reports[0]!.elements.some((e) => e.tag === 'rect')).toBe(true)
    const [r0, g0, b0] = await pixelAt(frames[0]!, 4, 16)
    const [r3, g3, b3] = await pixelAt(frames[3]!, 4, 16)
    expect(r0 + g0 + b0).toBeGreaterThan(700)
    expect(r3 + g3 + b3).toBeLessThan(30)
    expect(contactSheet[0]).toBe(0x89)
    expect(contactSheet[1]).toBe(0x50)
    const sheet = await loadImage(contactSheet)
    expect(sheet.width).toBe(64)
    expect(sheet.height).toBe(64)
  })

  it('同一帧渲染两次，PNG 字节相同', async () => {
    const once: Composition = { ...slide, durationInFrames: 1 }
    const a = await renderComposition(once)
    const b = await renderComposition(once)
    expect(a.frames[0]!.equals(b.frames[0]!)).toBe(true)
  })

  it('fps 或时长非法时抛出', async () => {
    await expect(renderComposition({ ...slide, fps: 0 })).rejects.toThrow(/fps/)
    await expect(renderComposition({ ...slide, durationInFrames: 0 })).rejects.toThrow(/durationInFrames/)
  })
})

describe('interpolate / spring / sequence', () => {
  it('interpolate 线性映射并钳制', () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50)
    expect(interpolate(-5, [0, 10], [0, 100])).toBe(0)
    expect(interpolate(20, [0, 10], [0, 100])).toBe(100)
    expect(interpolate(20, [0, 10], [0, 100], { extrapolateRight: 'extend' })).toBe(200)
  })

  it('spring 从 0 趋近 1', () => {
    expect(spring({ frame: 0, fps: 30 })).toBe(0)
    expect(spring({ frame: 1, fps: 30 })).toBeGreaterThan(0)
    expect(spring({ frame: 300, fps: 30 })).toBeGreaterThan(0.99)
    expect(spring({ frame: 300, fps: 30 })).toBeLessThan(1.01)
  })

  it('sequence 区间外为 null，区间内使用局部时间', () => {
    const input = { frame: 10, fps: 10, t: 1 }
    expect(sequence(input, { from: 5, durationInFrames: 4 }, (local) => local)).toBeNull()
    expect(sequence(input, { from: 8, durationInFrames: 4 }, (local) => local)).toEqual({
      frame: 2,
      fps: 10,
      t: 0.2,
    })
    const node = h(
      'layer',
      { width: '10', height: '10' },
      sequence({ frame: 0, fps: 10, t: 0 }, { from: 5, durationInFrames: 2 }, () =>
        h('rect', { width: '4', height: '4' }),
      ),
    )
    expect(node.children).toEqual([])
  })
})
