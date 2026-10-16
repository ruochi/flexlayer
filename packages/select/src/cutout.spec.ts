import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkLayer } from 'flexlayer'
import { describe, expect, it } from 'vitest'
import { runSelect } from './cli.js'
import { cutout } from './cutout.js'
import { readRgba, writePng } from './pixels.js'
import { birefnetSegment } from './segment.js'
import type { Segmenter } from './cutout.js'

function paintPng(file: string, width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]) {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y)
      const o = (y * width + x) * 4
      rgba[o] = r
      rgba[o + 1] = g
      rgba[o + 2] = b
      rgba[o + 3] = a
    }
  }
  writePng(file, rgba, width, height)
}

function matteOf(width: number, height: number, fill: (x: number, y: number) => number): Uint8ClampedArray {
  const matte = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) matte[y * width + x] = fill(x, y)
  }
  return matte
}

async function pixel(file: string, x: number, y: number) {
  const { rgba, width } = await readRgba(file)
  const o = (y * width + x) * 4
  return [rgba[o]!, rgba[o + 1]!, rgba[o + 2]!, rgba[o + 3]!] as const
}

describe('预设', () => {
  it('flat 按 128 硬切，不改颜色', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-flat-'))
    const src = join(dir, 'photo.png')
    paintPng(src, 8, 8, (x, y) => (x >= 2 && x <= 5 && y >= 2 && y <= 5 ? [100, 180, 0, 255] : [0, 255, 0, 255]))
    const segment: Segmenter = () => matteOf(8, 8, (x, y) => {
      if (x === 1 && y === 1) return 100
      if (x >= 2 && x <= 5 && y >= 2 && y <= 5) return 200
      return 0
    })
    const result = await cutout(src, { preset: 'flat', segment })
    const kept = await pixel(result.subject, 3, 3)
    const dropped = await pixel(result.subject, 1, 1)
    expect(kept[3]).toBe(255)
    expect(kept[0]).toBe(100)
    expect(kept[1]).toBeGreaterThan(150)
    expect(dropped[3]).toBe(0)
    expect(existsSync(join(dir, 'photo.shadow.png'))).toBe(false)
  })

  it('portrait 去掉背景渗色和脚下的影子，头发颜色留在软边上', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-portrait-'))
    const src = join(dir, 'photo.png')
    paintPng(src, 16, 24, (x, y) => {
      if (x === 4 && y === 8) return [100, 100, 0, 255]
      if ((x === 6 && y === 15) || (x === 6 && y === 3)) return [10, 10, 10, 255]
      if (x >= 3 && x <= 10 && y >= 2 && y <= 14) return [220, 20, 20, 255]
      return [0, 200, 0, 255]
    })
    const segment: Segmenter = () => matteOf(16, 24, (x, y) => {
      if (x === 1 && y === 1) return 80
      if (x === 4 && y === 8) return 128
      if (x === 6 && y === 15) return 90
      if (x === 6 && y === 3) return 100
      if (x >= 3 && x <= 10 && y >= 2 && y <= 14) return 255
      return 0
    })
    const result = await cutout(src, { preset: 'portrait', segment })
    const fringe = await pixel(result.subject, 1, 1)
    const hair = await pixel(result.subject, 4, 8)
    const foot = await pixel(result.subject, 6, 15)
    const top = await pixel(result.subject, 6, 3)
    expect(fringe[3]).toBe(0)
    expect(hair[3]).toBe(128)
    expect(hair[0]).toBeGreaterThan(180)
    expect(hair[1]).toBeLessThan(20)
    expect(foot[3]).toBe(0)
    expect(top[3]).toBe(100)
    expect(result.model).toBe('segment')
  })

  it('product 去掉脚下的影子，不另写文件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-product-'))
    const src = join(dir, 'photo.png')
    paintPng(src, 16, 24, (x, y) => {
      if (x === 6 && (y === 15 || y === 3)) return [10, 10, 10, 255]
      if (x >= 3 && x <= 10 && y >= 2 && y <= 14) return [220, 20, 20, 255]
      return [0, 200, 0, 255]
    })
    const segment: Segmenter = () => matteOf(16, 24, (x, y) => {
      if (x === 6 && y === 15) return 90
      if (x === 6 && y === 3) return 100
      if (x >= 3 && x <= 10 && y >= 2 && y <= 14) return 255
      return 0
    })
    const result = await cutout(src, { preset: 'product', segment })
    const subjectFoot = await pixel(result.subject, 6, 15)
    const subjectTop = await pixel(result.subject, 6, 3)
    expect(subjectFoot[3]).toBe(0)
    expect(subjectTop[3]).toBe(100)
    expect(readdirSync(dir).sort()).toEqual(['photo.cutout.json', 'photo.png', 'photo.subject.png'])
  })
})

describe('默认输出', () => {
  it('只写 subject.png 和 cutout.json，三层写法抄原图的宽高', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-default-'))
    const src = join(dir, 'photo.png')
    paintPng(src, 8, 8, () => [255, 0, 0, 255])
    const result = await cutout(src, { preset: 'product', segment: () => matteOf(8, 8, (x) => (x < 4 ? 255 : 0)) })
    expect(readdirSync(dir).sort()).toEqual(['photo.cutout.json', 'photo.png', 'photo.subject.png'])
    const meta = JSON.parse(readFileSync(result.meta, 'utf8')) as Record<string, unknown>
    expect(meta.subject).toBe('photo.subject.png')
    expect(meta.mask).toBeUndefined()
    expect(result.sandwich).toContain('<img src="photo.png" style="width:8px; height:8px" />')
    expect(result.sandwich).toContain('<img src="photo.subject.png" style="width:8px; height:8px" />')
    expect(result.sandwich.indexOf('photo.png')).toBeLessThan(result.sandwich.indexOf('photo.subject.png'))
    const report = await checkLayer(result.sandwich, { baseDir: dir })
    expect(report.issues.filter((issue) => issue.level === 'error')).toEqual([])
  })

})

describe('配方', () => {
  it('记下原图哈希', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-meta-'))
    const src = join(dir, 'photo.png')
    paintPng(src, 8, 8, () => [255, 0, 0, 255])
    const segment: Segmenter = () => matteOf(8, 8, (x, y) => (x < 4 ? 255 : 0))
    const result = await cutout(src, { preset: 'flat', segment })
    const meta = JSON.parse(readFileSync(result.meta, 'utf8')) as { srcHash: string; preset: string; model: string; analysis?: unknown }
    expect(meta.srcHash).toBe(createHash('sha256').update(readFileSync(src)).digest('hex'))
    expect(meta.preset).toBe('flat')
    expect(meta.model).toBe('segment')
    expect(meta.analysis).toBeUndefined()
  })
})

describe('命令行', () => {
  it('cutout 打印三层写法', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-cli-'))
    const src = join(dir, 'photo.png')
    paintPng(src, 8, 8, () => [20, 20, 20, 255])
    const logs: string[] = []
    const log = console.log
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    }
    try {
      await runSelect(['cutout', src, '--preset', 'flat'], {
        segment: () => matteOf(8, 8, (x) => (x < 4 ? 255 : 0)),
      })
    } finally {
      console.log = log
    }
    const printed = logs.join('\n')
    expect(printed).toContain('<img src="photo.png"')
    expect(printed).toContain('<img src="photo.subject.png"')
    expect(printed).not.toContain('derive=')
    await expect(runSelect(['apply', src])).rejects.toThrow(/cutout/)
  })

  it('没装 transformers 时说明安装命令', async () => {
    let present = true
    try {
      await import('@huggingface/transformers')
      present = true
    } catch {
      present = false
    }
    if (present) return
    await expect(birefnetSegment(new Uint8ClampedArray(16), 2, 2)).rejects.toThrow(/@huggingface\/transformers/)
  })
})
