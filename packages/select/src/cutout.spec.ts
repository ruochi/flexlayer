import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { checkLayer, renderLayer } from 'flexlayer'
import { describe, expect, it } from 'vitest'
import { runSelect } from './cli.js'
import { cutout, writeAnswers } from './cutout.js'
import { answersFromChoices } from './markup.js'
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

async function pngPixel(png: Buffer, x: number, y: number) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(x, y, 1, 1).data
  return [data[0]!, data[1]!, data[2]!, data[3]!] as const
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
    expect(result.shadow).toBeUndefined()
    expect(existsSync(join(dir, 'photo.shadow.png'))).toBe(false)
    expect(result.analysis.pieces).toBe(1)
    expect(result.analysis.softEdge).toBeLessThan(1.5)
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

  it('product 把脚下的影子单独写成一层', async () => {
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
    expect(result.shadow).toBeTruthy()
    const subjectFoot = await pixel(result.subject, 6, 15)
    const shadowFoot = await pixel(result.shadow!, 6, 15)
    const shadowTop = await pixel(result.shadow!, 6, 3)
    expect(subjectFoot[3]).toBe(0)
    expect(shadowFoot[3]).toBe(90)
    expect(shadowFoot[0]).toBe(0)
    expect(shadowTop[3]).toBe(0)
    expect(result.markup).toContain('photo.shadow.png')
  })
})

describe('编号选择题', () => {
  const segment: Segmenter = () => matteOf(40, 40, (x, y) => {
    if (x >= 1 && x <= 4 && y >= 1 && y <= 4) return 255
    if (x >= 16 && x <= 23 && y >= 16 && y <= 23) return 0
    if (x >= 8 && x <= 31 && y >= 8 && y <= 31) return 255
    if (x >= 34 && x <= 37 && y >= 28 && y <= 39) return 40
    return 0
  })

  async function scene() {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-questions-'))
    const src = join(dir, 'photo.png')
    paintPng(src, 40, 40, (x, y) => {
      if (x >= 16 && x <= 23 && y >= 16 && y <= 23) return [255, 255, 0, 255]
      if (x >= 8 && x <= 31 && y >= 8 && y <= 31) return [255, 0, 0, 255]
      if (x >= 34 && x <= 37 && y >= 28 && y <= 39) return [0, 0, 255, 255]
      return [0, 200, 0, 255]
    })
    const result = await cutout(src, { preset: 'portrait', segment, baseDir: dir })
    return { dir, src, result }
  }

  it('碎片、洞和软边各有一题，灰度值就是编号', async () => {
    const { result } = await scene()
    expect(result.questions.map((question) => question.ask)).toEqual([
      '这块离开主体的小块，要不要从选区里去掉？',
      '主体上的这个洞，要不要补进选区？',
      '这条软边现在大部分还没选上，要不要收进选区？',
    ])
    expect(result.questions.map((question) => question.where)).toEqual(['左上', '中间', '右下'])
    expect(result.questions.map((question) => question.now)).toEqual(['已选', '未选', '未选'])
    expect(result.questions.every((question) => question.area > 0)).toBe(true)
    const fragment = await pixel(result.regions, 2, 2)
    const hole = await pixel(result.regions, 18, 18)
    const soft = await pixel(result.regions, 35, 30)
    const body = await pixel(result.regions, 10, 10)
    expect(fragment[0]).toBe(1)
    expect(hole[0]).toBe(2)
    expect(soft[0]).toBe(3)
    expect(body[0]).toBe(0)
    const saved = JSON.parse(readFileSync(result.questionsFile, 'utf8')) as { questions: unknown[] }
    expect(saved.questions).toEqual(result.questions)
  })

  it('答案写回 pick，补上的洞在成片里能看见', async () => {
    const { dir, result } = await scene()
    const answers = answersFromChoices(result.questions, [
      { id: 1, keep: false },
      { id: 2, keep: true },
      { id: 3, keep: false },
    ])
    expect(answers).toEqual([
      { id: 1, op: 'subtract' },
      { id: 2, op: 'add' },
    ])
    const markup = writeAnswers(result, answers)
    expect(markup).toContain('pick="2" op="add"')
    expect(markup).toContain('pick="1" op="subtract"')
    const report = await checkLayer(markup, { baseDir: dir })
    expect(report.issues.filter((issue) => issue.level === 'error')).toEqual([])
    const before = await renderLayer(result.markup, { baseDir: dir })
    const after = await renderLayer(markup, { baseDir: dir })
    const holeBefore = await pngPixel(before.png, 18, 18)
    const holeAfter = await pngPixel(after.png, 18, 18)
    const body = await pngPixel(after.png, 10, 10)
    expect(holeBefore[3]).toBe(0)
    expect(holeAfter[0]).toBeGreaterThan(200)
    expect(holeAfter[1]).toBeGreaterThan(200)
    expect(body[0]).toBeGreaterThan(200)
  })
})

describe('配方', () => {
  it('记下原图哈希，analyzeImage 的自检写进 json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-meta-'))
    const src = join(dir, 'photo.png')
    paintPng(src, 8, 8, () => [255, 0, 0, 255])
    const segment: Segmenter = () => matteOf(8, 8, (x, y) => (x < 4 ? 255 : 0))
    const result = await cutout(src, { preset: 'flat', segment })
    const meta = JSON.parse(readFileSync(result.meta, 'utf8')) as { srcHash: string; preset: string; model: string; analysis: { pieces: number } }
    expect(meta.srcHash).toBe(createHash('sha256').update(readFileSync(src)).digest('hex'))
    expect(meta.preset).toBe('flat')
    expect(meta.model).toBe('segment')
    expect(meta.analysis.pieces).toBe(result.analysis.pieces)
    expect(result.analysis.area).toBeGreaterThan(0.4)
    expect(result.analysis.area).toBeLessThan(0.6)
  })
})

describe('命令行', () => {
  it('cutout 和 apply 写出标记', async () => {
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
      await runSelect(['apply', src, '--subtract', '1', '--add', '2,3'])
    } finally {
      console.log = log
    }
    const layer = readFileSync(join(dir, 'photo.cutout.layer'), 'utf8')
    expect(layer).toContain('derive="subject"')
    expect(layer).toContain('pick="2 3" op="add"')
    expect(layer).toContain('pick="1" op="subtract"')
    expect(logs.some((line) => line.includes('<preview'))).toBe(true)
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
