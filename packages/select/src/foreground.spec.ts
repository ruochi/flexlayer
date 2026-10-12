import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runSelect } from './cli.js'
import { foregroundMask } from './foreground.js'
import { readRgba, writePng } from './pixels.js'

function paint(file: string) {
  const width = 48
  const height = 36
  const rgba = new Uint8ClampedArray(width * height * 4)
  const depth = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inTower = x >= 18 && x <= 30 && y >= 8 && y <= 24
      const ground = y >= 26
      const o = (y * width + x) * 4
      rgba[o] = inTower ? 220 : 16
      rgba[o + 1] = inTower ? 160 : 18
      rgba[o + 2] = inTower ? 40 : 28
      rgba[o + 3] = 255
      depth[y * width + x] = inTower ? 140 : ground ? 220 : y >= 14 ? 48 : 0
    }
  }
  writePng(file, rgba, width, height)
  return depth
}

describe('foregroundMask', () => {
  it('写出遮罩，并返回前景的位置和大小', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-mask-'))
    const src = join(dir, 'photo.png')
    const depth = paint(src)
    const result = await foregroundMask(src, { depth: () => depth })
    expect(result.mask).toBe(join(dir, 'photo.foreground.png'))
    expect(result.x).toBeGreaterThanOrEqual(17)
    expect(result.y).toBeLessThan(12)
    expect(result.width).toBeGreaterThan(8)
    expect(result.height).toBeGreaterThan(8)
    const record = JSON.parse(readFileSync(join(dir, 'photo.foreground.json'), 'utf8')) as {
      mask: string
      x: number
      y: number
      width: number
      height: number
    }
    expect(record).toEqual({ mask: 'photo.foreground.png', x: result.x, y: result.y, width: result.width, height: result.height })
    const image = await readRgba(result.mask)
    expect(image.width).toBe(48)
    expect(image.height).toBe(36)
    const inside = (result.y! + 4) * 48 + (result.x! + 4)
    expect(image.rgba[inside * 4 + 3]).toBeGreaterThan(200)
    expect(image.rgba[3]).toBe(0)
  })

  it('命令行打印遮罩和位置', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-mask-cli-'))
    const src = join(dir, 'photo.png')
    const depth = paint(src)
    const logs: string[] = []
    const log = console.log
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    }
    try {
      await runSelect(['mask', src], { depth: () => depth })
    } finally {
      console.log = log
    }
    const printed = JSON.parse(logs.join('\n')) as { mask: string; x: number; y: number; width: number; height: number }
    expect(printed.mask).toBe('photo.foreground.png')
    expect(printed.x).toBeGreaterThanOrEqual(17)
    expect(printed.width).toBeGreaterThan(8)
    expect(printed.height).toBeGreaterThan(8)
  })
})
