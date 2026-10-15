import { createCanvas as rawCreateCanvas, loadImage as rawLoadImage } from '@napi-rs/canvas'
import { beforeAll, describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { initFontsForMeasure } from './fonts.js'
import { applyCanvasFont, createCanvas, DEFAULT_FONT_FAMILY, initFonts, loadImage, registerFontPath } from './index.js'
import { layoutSource } from './layout.js'
import { checkLayer, renderLayer } from './render.js'
import { boxBottom } from './types.js'
import type { TextLayoutNode } from './types.js'

const FONT_DIRS = [join(homedir(), '.cache', 'flexlayer', 'fonts'), '/tmp/flexlayer-test']

let hasFont = false

beforeAll(async () => {
  for (const dir of FONT_DIRS) {
    hasFont = await initFontsForMeasure({ fontsCacheDir: dir })
    if (hasFont) break
  }
})

function textNode(doc: Awaited<ReturnType<typeof layoutSource>>): TextLayoutNode {
  const node = doc.root.children.find((child) => child.kind === 'text')
  if (!node || node.kind !== 'text') throw new Error('没有文字节点')
  return node
}

const page = (body: string, attrs = 'width="320" height="160" safe="0"') =>
  `<layer ${attrs} background="#fff">${body}</layer>`

describe('字体导出', () => {
  it('createCanvas 和 loadImage 是排版用的那一份', () => {
    expect(createCanvas).toBe(rawCreateCanvas)
    expect(loadImage).toBe(rawLoadImage)
    expect(DEFAULT_FONT_FAMILY).toBe('ChillDuanSans')
  })

  it('initFonts 之后 applyCanvasFont 把 450 写进 wght', async () => {
    if (!hasFont) return
    await initFonts()
    const ctx = createCanvas(8, 8).getContext('2d')
    applyCanvasFont(ctx, DEFAULT_FONT_FAMILY, 450, 32)
    expect(ctx.fontVariationSettings).toContain('450')
    await expect(initFonts(['没有这款字体'])).rejects.toThrow(/未登记/)
    expect(() => registerFontPath(DEFAULT_FONT_FAMILY, '/no/such/font.ttf')).not.toThrow()
  })
})

describe('行内绘制变换', () => {
  it('不改变行宽、行高和折行', async () => {
    if (!hasFont) return
    const plain = textNode(await layoutSource(page('<p style="font-size:40px; width:80px">你好世界</p>'), process.cwd()))
    const scaled = textNode(
      await layoutSource(
        page('<p style="font-size:40px; width:80px"><span style="scale:2; rotate:30; translate: 0 -12">你好世界</span></p>'),
        process.cwd(),
      ),
    )
    expect(scaled.textLayout.lines.map((line) => line.width)).toEqual(plain.textLayout.lines.map((line) => line.width))
    expect(scaled.textLayout.lines.map((line) => line.height)).toEqual(plain.textLayout.lines.map((line) => line.height))
    expect(scaled.textLayout.lines.length).toBe(plain.textLayout.lines.length)
    expect(scaled.width).toBeCloseTo(plain.width)
    expect(scaled.height).toBeCloseTo(plain.height)
    expect(scaled.rotate).toBe(0)
    expect(scaled.ink.height).toBeGreaterThan(plain.ink.height + 8)
  })

  it('整段的 rotate 仍转盒子，split="chars" 改到每个字上', async () => {
    if (!hasFont) return
    const box = textNode(await layoutSource(page('<p style="font-size:40px; rotate:15">你好</p>'), process.cwd()))
    const split = textNode(await layoutSource(page('<p split="chars" style="font-size:40px; rotate:90">你好</p>'), process.cwd()))
    const group = textNode(
      await layoutSource(page('<p style="font-size:40px"><span style="rotate:90">你好</span></p>'), process.cwd()),
    )
    expect(box.rotate).toBe(15)
    expect(split.rotate).toBe(0)
    expect(split.opacity).toBe(1)
    expect(split.scaleX).toBe(1)
    expect(group.textLayout.lines[0]!.width).toBeCloseTo(split.textLayout.lines[0]!.width)
    expect(group.ink.height).toBeGreaterThan(split.ink.height)
    expect(split.ink.height).toBeGreaterThan(box.ink.height * 0.5)
  })

  it('透明字占位，但不进着墨', async () => {
    if (!hasFont) return
    const shown = textNode(await layoutSource(page('<p style="font-size:40px; white-space:nowrap">你好</p>'), process.cwd()))
    const hidden = textNode(
      await layoutSource(
        page('<p style="font-size:40px; white-space:nowrap"><span style="opacity:0">你</span>好</p>'),
        process.cwd(),
      ),
    )
    expect(hidden.textLayout.lines[0]!.width).toBeGreaterThan(shown.textLayout.lines[0]!.width * 0.6)
    expect(hidden.ink.width).toBeLessThan(shown.ink.width)
  })

  it('标点不和另一组变换粘在一起', async () => {
    if (!hasFont) return
    const node = textNode(
      await layoutSource(
        page('<p style="font-size:40px; white-space:nowrap"><span style="rotate:20">字</span>，<span style="rotate:40">句</span></p>'),
        process.cwd(),
      ),
    )
    const texts = node.textLayout.lines.flatMap((line) => line.segments.map((seg) => seg.text))
    expect(texts.some((text) => text.includes('字') && text.includes('，'))).toBe(false)
  })

  it('角度不同的逗号也不落到下一行行首', async () => {
    if (!hasFont) return
    const stuck = textNode(
      await layoutSource(
        page('<p style="font-size:40px; width:46px"><span style="rotate:12">字</span><span style="rotate:40">，</span>后</p>'),
        process.cwd(),
      ),
    )
    const stuckLines = stuck.textLayout.lines.map((line) => line.segments.map((seg) => seg.text).join(''))
    expect(stuckLines.length).toBeGreaterThan(1)
    expect(stuckLines[0]).toContain('字')
    expect(stuckLines[0]).toContain('，')
    expect(stuckLines.some((line) => line.replace(/^\s+/, '').startsWith('，'))).toBe(false)
    const texts = stuck.textLayout.lines.flatMap((line) => line.segments.map((seg) => seg.text))
    expect(texts.some((text) => text.includes('字') && text.includes('，'))).toBe(false)

    const withImage = textNode(
      await layoutSource(
        page('<p style="font-size:40px; width:50px"><img src="x.png" style="width:40px; height:40px" /><span style="rotate:40">，</span>后</p>'),
        process.cwd(),
      ),
    )
    const imageLines = withImage.textLayout.lines
    expect(imageLines[0]!.width).toBeGreaterThan(70)
    expect(imageLines[0]!.segments.map((seg) => seg.text).join('')).toContain('，')
    expect(imageLines.slice(1).some((line) => line.segments.map((seg) => seg.text).join('').startsWith('，'))).toBe(false)
  })

  it('另一处归属的逗号可以落到下一行行首', async () => {
    if (!hasFont) return
    const node = textNode(
      await layoutSource(
        page(
          '<p style="font-size:40px; width:50px"><img src="x.png" style="width:40px; height:40px" /><span id="c" style="rotate:40">，</span>后</p>',
        ),
        process.cwd(),
      ),
    )
    const lines = node.textLayout.lines
    expect(lines[0]!.segments.map((seg) => seg.text).join('')).not.toContain('，')
    expect(lines.slice(1).some((line) => line.segments.map((seg) => seg.text).join('').startsWith('，'))).toBe(true)
  })

  it('报告里的盒子留在原位，着墨框跟着转', async () => {
    if (!hasFont) return
    const report = await checkLayer(
      page('<p style="font-size:48px; white-space:nowrap">甲<span id="mark" style="rotate:90">乙丙</span>丁</p>'),
    )
    const span = report.elements.find((el) => el.id === 'mark')
    expect(span?.inline).toBe(true)
    expect(span!.ink.height).toBeGreaterThan(span!.box.height + 4)
    expect(span!.ink.width).toBeLessThan(span!.box.width)
  })

  it('转出画布的字报 overflow-canvas', async () => {
    if (!hasFont) return
    const report = await checkLayer(
      page('<p style="font-size:40px"><span style="translate: 0 -80">字</span></p>', 'width="180" height="80" safe="0"'),
    )
    expect(report.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(true)
  })

  it('绘制位置跟着 translate 走', async () => {
    if (!hasFont) return
    const frame = 'width="160" height="240" safe="0"'
    const still = await renderLayer(page('<p style="font-size:48px; padding: 90px 0 0">上</p>', frame))
    const moved = await renderLayer(
      page('<p style="font-size:48px; padding: 90px 0 0"><span style="translate: 0 -28">上</span></p>', frame),
    )
    const a = await alphaBounds(still.png)
    const b = await alphaBounds(moved.png)
    expect(b.top).toBeLessThan(a.top - 16)
    expect(b.bottom).toBeLessThan(a.bottom - 16)
  })

  it('写错的 split 和 translate 会警告', async () => {
    const badSplit = await checkLayer(page('<p split="words">甲</p>'))
    expect(badSplit.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('split'))).toBe(true)
    const badPlace = await checkLayer('<layer width="80" height="80"><rect split="chars" width="20" height="20" fill="#fff" /></layer>')
    expect(badPlace.issues.some((issue) => issue.message.includes('split 只写在文字上'))).toBe(true)
    const badTranslate = await checkLayer(page('<p style="translate: nope">甲</p>'))
    expect(badTranslate.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('translate'))).toBe(true)
  })
})

async function alphaBounds(png: Buffer) {
  const { loadImage } = await import('@napi-rs/canvas')
  const img = await loadImage(png)
  const canvas = rawCreateCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height).data
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      const alpha = data[i + 3] ?? 0
      const ink = alpha > 16 && (data[i]! < 250 || data[i + 1]! < 250 || data[i + 2]! < 250)
      if (!ink) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  expect(maxX).toBeGreaterThanOrEqual(0)
  return { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 }
}
