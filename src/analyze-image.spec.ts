import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeImage } from './analyze-image.js'
import { renderFvg } from './render.js'

function png(width: number, height: number, paint: (ctx: SKRSContext2D) => void): Buffer {
  const canvas = createCanvas(width, height)
  paint(canvas.getContext('2d'))
  return canvas.toBuffer('image/png')
}

function dataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`
}

describe('analyzeImage', () => {
  it('透明底上的两块：面积、碎片按大小排、轮廓两段', async () => {
    const src = dataUrl(
      png(100, 50, (ctx) => {
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, 20, 50)
        ctx.fillRect(60, 10, 30, 20)
      }),
    )
    const info = analyzeImage(src)
    expect(info).toMatchObject({ width: 100, height: 50, channel: 'alpha', hasAlpha: true, pieces: 2, holes: 0 })
    expect(info.area).toBeCloseTo(1600 / 5000, 3)
    expect(info.ink).toEqual({ x: 0, y: 0, width: 90, height: 50 })
    expect(info.parts.map((part) => part.ink)).toEqual([
      { x: 0, y: 0, width: 20, height: 50 },
      { x: 60, y: 10, width: 30, height: 20 },
    ])
    expect(info.d.match(/M/g)).toHaveLength(2)
    expect(info.d.match(/Z/g)).toHaveLength(2)
  })

  it('环形算一块、一个洞', async () => {
    const src = dataUrl(
      png(60, 60, (ctx) => {
        ctx.fillStyle = '#fff'
        ctx.fillRect(10, 10, 40, 40)
        ctx.clearRect(20, 20, 20, 20)
      }),
    )
    const info = analyzeImage(src)
    expect(info.pieces).toBe(1)
    expect(info.holes).toBe(1)
  })

  it('不透明的黑白图自动看亮度', async () => {
    const src = dataUrl(
      png(80, 80, (ctx) => {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, 80, 80)
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.arc(40, 40, 25, 0, Math.PI * 2)
        ctx.fill()
      }),
    )
    const info = analyzeImage(src)
    expect(info.channel).toBe('luma')
    expect(info.hasAlpha).toBe(false)
    expect(info.pieces).toBe(1)
    expect(info.area).toBeCloseTo((Math.PI * 25 * 25) / 6400, 2)
    expect(info.softEdge).toBeLessThan(2)
    const alpha = analyzeImage(src, { channel: 'alpha' })
    expect(alpha.area).toBe(1)
  })

  it('对角相连的两个像素算一块，轮廓也只有一圈', async () => {
    const src = dataUrl(
      png(4, 4, (ctx) => {
        ctx.fillStyle = '#fff'
        ctx.fillRect(1, 1, 1, 1)
        ctx.fillRect(2, 2, 1, 1)
      }),
    )
    const info = analyzeImage(src, { tolerance: 0 })
    expect(info.pieces).toBe(1)
    expect(info.holes).toBe(0)
    expect(info.d.match(/M/g)).toHaveLength(1)
  })

  it('d 画回去和原图几乎重合', async () => {
    const original = png(120, 90, (ctx) => {
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.ellipse(45, 45, 35, 25, 0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillRect(85, 10, 25, 70)
      ctx.clearRect(92, 30, 10, 20)
    })
    const info = analyzeImage(dataUrl(original))
    expect(info.pieces).toBe(2)
    expect(info.holes).toBe(1)
    const { png: redrawn } = await renderFvg(`<layer width="120" height="90"><path d="${info.d}" fill="#fff" stroke="none" /></layer>`)
    const again = analyzeImage(dataUrl(redrawn))
    expect(again.pieces).toBe(2)
    expect(again.holes).toBe(1)
    expect(Math.abs(again.area - info.area)).toBeLessThan(0.005)
    expect(again.ink).toEqual(info.ink)
  })

  it('d 直接写进 mask，留下的面积和原图一致', async () => {
    const src = dataUrl(
      png(60, 40, (ctx) => {
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.arc(30, 20, 15, 0, Math.PI * 2)
        ctx.fill()
      }),
    )
    const info = analyzeImage(src)
    const { report } = await renderFvg(
      `<layer width="60" height="40"><layer id="cut" width="60" height="40"><mask><path d="${info.d}" /></mask><rect width="60" height="40" fill="#fff" /></layer></layer>`,
    )
    const cut = report.elements.find((el) => el.id === 'cut')
    expect(Math.abs((cut?.mask?.area ?? 0) - info.area)).toBeLessThan(0.01)
    expect(cut?.mask?.pieces).toBe(1)
  })

  it('相对路径按 baseDir 找，读不到时抛错', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-analyze-'))
    writeFileSync(
      join(dir, 'cut.png'),
      png(10, 10, (ctx) => {
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, 5, 10)
      }),
    )
    const info = analyzeImage('cut.png', { baseDir: dir })
    expect(info.area).toBeCloseTo(0.5, 3)
    const nearby = analyzeImage('../examples/math.png')
    expect(nearby.width).toBeGreaterThan(0)
    expect(() => analyzeImage('missing.png', { baseDir: dir })).toThrow(/missing\.png/)
  })

  it('参数写错时抛错，缓存的结果改了也不影响下一次', async () => {
    const src = dataUrl(png(8, 8, (ctx) => ctx.fillRect(0, 0, 4, 4)))
    expect(() => analyzeImage(src, { threshold: 0 })).toThrow(/threshold/)
    expect(() => analyzeImage(src, { tolerance: -1 })).toThrow(/tolerance/)
    expect(() => analyzeImage(src, { channel: 'red' as never })).toThrow(/channel/)
    const first = analyzeImage(src)
    first.parts.length = 0
    first.ink!.x = 99
    const second = analyzeImage(src)
    expect(second.parts).toHaveLength(1)
    expect(second.ink!.x).toBe(0)
  })
})
