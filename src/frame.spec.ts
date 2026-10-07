import { beforeAll, describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { h } from './h.js'
import { initFontsForMeasure } from './fonts.js'
import { mergeFrameIssues, sampleFrames } from './check-frames.js'
import { Easing, interpolate, noise, random, renderComposition, renderFrames, sequence, spring, type Composition } from './frame.js'
import { formatIssueLine } from './report.js'
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

describe('renderFrames', () => {
  it('from、to、step 含端点，rgba 长度是像素数乘 4', async () => {
    const seen: Array<{ frame: number; fps: number; t: number }> = []
    const comp: Composition = {
      id: 'clock',
      width: 8,
      height: 8,
      fps: 10,
      durationInFrames: 6,
      component: () =>
        h(
          'layer',
          { width: '8', height: '8', background: '#000000' },
          h('rect', {
            width: '4',
            height: '4',
            fill: '#ffffff',
            draw: (_ctx, el) => {
              seen.push({ frame: el.frame, fps: el.fps, t: el.t })
            },
          }),
        ),
    }
    const rendered = []
    for await (const frame of renderFrames(comp, { from: 1, to: 4, step: 3, format: 'rgba' })) rendered.push(frame)
    expect(rendered.map((frame) => frame.frame)).toEqual([1, 4])
    expect(seen).toEqual([
      { frame: 1, fps: 10, t: 0.1 },
      { frame: 4, fps: 10, t: 0.4 },
    ])
    expect(rendered[0]!.width).toBe(8)
    expect(rendered[0]!.height).toBe(8)
    expect(rendered[0]!.rgba!.length).toBe(8 * 8 * 4)
    expect(rendered[0]!.png).toBeUndefined()
    expect(rendered[0]!.rgba![0]).toBe(255)
    expect(rendered[0]!.rgba![28]).toBe(0)
    expect(rendered[0]!.rgba![3]).toBe(255)
  })

  it('renderComposition 和逐帧 PNG 一致', async () => {
    const once = await renderComposition(slide)
    const streamed = []
    for await (const frame of renderFrames(slide)) streamed.push(frame.png!)
    expect(streamed).toHaveLength(once.frames.length)
    for (let i = 0; i < streamed.length; i++) expect(streamed[i]!.equals(once.frames[i]!)).toBe(true)
  })
})

describe('抽查帧', () => {
  it('默认三帧，all 和区间可以带 step', () => {
    expect(sampleFrames(5)).toEqual([0, 2, 4])
    expect(sampleFrames(5, 3)).toEqual([3])
    expect(sampleFrames(10, { all: true, step: 3 })).toEqual([0, 3, 6, 9])
    expect(sampleFrames(10, { range: [2, 8], step: 3 })).toEqual([2, 5, 8])
  })

  it('抽查序列里连续出现的合成一个区间，中间断开就分开', () => {
    const issue = { level: 'error' as const, code: 'overflow-canvas', path: 'layer/rect[0]', message: '着墨超出画布' }
    const merged = mergeFrameIssues([
      { frame: 120, issues: [issue] },
      { frame: 125, issues: [issue] },
      { frame: 130, issues: [issue] },
      { frame: 140, issues: [] },
      { frame: 145, issues: [issue] },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      frame: 120,
      message: '着墨超出画布',
      frames: [
        [120, 130],
        [145, 145],
      ],
    })
    expect(formatIssueLine(merged[0]!)).toContain('第120–130帧、第145帧')
  })

  it('有一帧用上 expect 时，不再报 unused-expect', () => {
    const unused = {
      level: 'warn' as const,
      code: 'unused-expect',
      path: 'layer',
      message: '没有出现 overflow-canvas',
      expect: { code: 'overflow-canvas' },
    }
    const hit = {
      level: 'info' as const,
      code: 'overflow-canvas',
      path: 'layer/circle[0]',
      message: '着墨超出画布',
      expected: '出血图',
    }
    const used = mergeFrameIssues([
      { frame: 0, issues: [unused] },
      { frame: 1, issues: [hit] },
    ])
    expect(used.map((issue) => issue.code)).toEqual(['overflow-canvas'])
    const missed = mergeFrameIssues([
      { frame: 0, issues: [unused] },
      { frame: 1, issues: [unused] },
    ])
    expect(missed.map((issue) => issue.code)).toEqual(['unused-expect'])
    expect(missed[0]?.frames).toEqual([[0, 1]])
  })
})

describe('interpolate / spring / sequence', () => {
  it('interpolate 线性映射并钳制', () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50)
    expect(interpolate(-5, [0, 10], [0, 100])).toBe(0)
    expect(interpolate(20, [0, 10], [0, 100])).toBe(100)
    expect(interpolate(20, [0, 10], [0, 100], { extrapolateRight: 'extend' })).toBe(200)
  })

  it('interpolate 多点区间和 easing', () => {
    expect(interpolate(15, [0, 30, 60], [0, 1, 0])).toBe(0.5)
    expect(interpolate(45, [0, 30, 60], [0, 1, 0])).toBe(0.5)
    expect(interpolate(30, [0, 30, 60], [0, 1, 0])).toBe(1)
    expect(interpolate(-10, [0, 30, 60], [0, 1, 0])).toBe(0)
    expect(interpolate(90, [0, 30, 60], [0, 1, 0])).toBe(0)
    expect(interpolate(90, [0, 30, 60], [0, 1, 0], { extrapolateRight: 'extend' })).toBeCloseTo(-1)
    expect(interpolate(5, [0, 10], [0, 100], { easing: Easing.quad })).toBe(25)
    expect(interpolate(5, [0, 10], [0, 100], { easing: Easing.out(Easing.quad) })).toBe(75)
    expect(interpolate(5, [0, 10], [0, 100], { easing: Easing.bezier(0, 0, 1, 1) })).toBeCloseTo(50)
    expect(interpolate(0, [0, 10], [0, 100])).toBe(0)
    expect(() => interpolate(1, [0, 1], [0])).toThrow(/长度必须一致/)
    expect(() => interpolate(1, [0], [0])).toThrow(/至少需要两个点/)
    expect(() => interpolate(1, [0, 2, 1], [0, 1, 0])).toThrow(/单调递增/)
  })

  it('random 和 noise 由 seed 决定', () => {
    expect(random('flex')).toBe(random('flex'))
    expect(random(7)).toBe(random(7))
    expect(random('flex')).not.toBe(random('layer'))
    expect(random('flex')).toBeGreaterThanOrEqual(0)
    expect(random('flex')).toBeLessThan(1)
    expect(noise('a', 1.25, 0.5)).toBe(noise('a', 1.25, 0.5))
    expect(noise('a', 1.25, 0.5)).not.toBe(noise('b', 1.25, 0.5))
    const near = Math.abs(noise('a', 0.2) - noise('a', 0.21))
    expect(near).toBeLessThan(0.05)
    expect(near).toBeGreaterThan(0)
    for (let i = 0; i < 20; i++) {
      const value = noise('a', i * 0.37, i * 0.13, i * 0.07)
      expect(value).toBeGreaterThanOrEqual(-1)
      expect(value).toBeLessThanOrEqual(1)
    }
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
