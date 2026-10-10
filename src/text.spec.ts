import { createCanvas } from '@napi-rs/canvas'
import { beforeAll, describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { applyCanvasFont, initFontsForMeasure } from './fonts.js'
import { layoutSource } from './layout.js'
import { layoutText } from './text.js'
import type { TextSegment } from './types.js'

const FONT_DIRS = [join(homedir(), '.cache', 'flexlayer', 'fonts'), '/tmp/flexlayer-test']

let hasFont = false

beforeAll(async () => {
  for (const dir of FONT_DIRS) {
    hasFont = await initFontsForMeasure({ fontsCacheDir: dir })
    if (hasFont) break
  }
})

const baseStyle = {
  fontFamily: 'ChillDuanSans',
  fontSize: 40,
  fontWeight: 400,
  color: '#000',
  letterSpacing: 0,
}

describe('layoutText', () => {
  it('英文单词不拆开', () => {
    if (!hasFont) return
    const segments: TextSegment[] = [{ text: 'Bitcoin halving', style: baseStyle }]
    const r = layoutText({ segments, maxWidth: 200, lineHeightRatio: 1.2, fontSize: 40, textWrap: 'wrap' })
    expect(r.lines.some((l) => l.segments.some((s) => s.text === 'Bitcoin'))).toBe(true)
  })

  it('补充平面的字不从中间拆开', () => {
    if (!hasFont) return
    const r = layoutText({ segments: [{ text: '𝑥𝑦', style: baseStyle }], nowrap: true, lineHeightRatio: 1.2, fontSize: 40 })
    expect(r.lines[0]!.segments.map((s) => s.text)).toEqual(['𝑥', '𝑦'])
  })

  it('行内保留空格，行首行尾去掉', () => {
    if (!hasFont) return
    const oneLine = layoutText({
      segments: [{ text: 'a² + b² = c²', style: baseStyle }],
      nowrap: true,
      lineHeightRatio: 1.2,
      fontSize: 40,
    })
    expect(oneLine.lines).toHaveLength(1)
    expect(oneLine.lines[0]!.segments.map((s) => s.text).join('')).toBe('a² + b² = c²')

    const wrapped = layoutText({
      segments: [{ text: 'Bitcoin halving', style: baseStyle }],
      maxWidth: 200,
      lineHeightRatio: 1.2,
      fontSize: 40,
      textWrap: 'wrap',
    })
    for (const line of wrapped.lines) {
      const text = line.segments.map((s) => s.text).join('')
      expect(text).toBe(text.trim())
    }
  })

  it('br 硬换行', () => {
    if (!hasFont) return
    const segments: TextSegment[] = [
      { text: '第一行', style: baseStyle },
      { text: '第二行', style: baseStyle, hardBreakBefore: true },
    ]
    const r = layoutText({ segments, maxWidth: 1000, lineHeightRatio: 1.2, fontSize: 40 })
    expect(r.lines.length).toBeGreaterThanOrEqual(2)
  })

  it('最窄宽度', () => {
    if (!hasFont) return
    const segments: TextSegment[] = [{ text: '比特币', style: baseStyle }]
    const r = layoutText({ segments, maxWidth: 1000, lineHeightRatio: 1.2, fontSize: 40 })
    expect(r.minWidth).toBeGreaterThan(0)
  })

  it('不换行空格不被当成可折叠空白', () => {
    if (!hasFont) return
    const r = layoutText({
      segments: [{ text: '\u00A0\u00A0if', style: baseStyle }],
      nowrap: true,
      lineHeightRatio: 1.2,
      fontSize: 40,
    })
    expect(r.lines[0]!.segments.map((seg) => seg.text).join('')).toBe('\u00A0\u00A0if')
  })
})

async function inlineText(body: string) {
  const doc = await layoutSource(
    `<layer width="800" height="160"><p style="font-size:32px; white-space:nowrap">${body}</p></layer>`,
    process.cwd(),
  )
  const node = doc.root.children[0]
  if (!node || node.kind !== 'text') throw new Error('expected text')
  return {
    text: node.textLayout.lines.map((line) => line.segments.map((seg) => seg.text).join('')).join('\n'),
    width: node.width,
    colors: node.textLayout.lines.flatMap((line) => line.segments.map((seg) => `${seg.text}:${seg.style.color}`)),
  }
}

describe('行内空白', () => {
  it('span 交界、span 内和单独的空格都保留', async () => {
    if (!hasFont) return
    const spaced = await inlineText('A <span style="color:#00ffff">B</span> C')
    const glued = await inlineText('ABC')
    expect(spaced.text).toBe('A B C')
    expect(spaced.width).toBeGreaterThan(glued.width)

    expect((await inlineText('A<span style="color:#00ffff">B </span>C')).text).toBe('AB C')
    expect((await inlineText('A<span> </span>B')).text).toBe('A B')
    expect((await inlineText('A  B')).text).toBe('A B')
    expect((await inlineText('  A B  ')).text).toBe('A B')
  })

  it('不换行空格留在高亮片段里', async () => {
    if (!hasFont) return
    const between = await inlineText('A<span style="color:#c084fc">&nbsp;</span>B')
    expect(between.text).toBe('A\u00A0B')
    expect(between.colors).toContain('\u00A0:#c084fc')
    expect(between.width).toBeGreaterThan((await inlineText('AB')).width)

    const indent = await inlineText('<span style="color:#f5c16c">&nbsp;&nbsp;</span><span>if</span>')
    expect(indent.text).toBe('\u00A0\u00A0if')

    const tail = await inlineText('<span style="color:#5eead4">const&nbsp;</span><span>x</span>')
    expect(tail.text).toBe('const\u00A0x')
    expect(tail.colors[0]).toBe('const:#5eead4')
  })

  it('换行折成一个空格，br 两侧空格不进正文', async () => {
    if (!hasFont) return
    expect((await inlineText('A\n<span>B</span>')).text).toBe('A B')
    expect((await inlineText('A <br/> B')).text).toBe('A\nB')
  })

  it('可变字体的中间字重不是只有两档', () => {
    if (!hasFont) return
    const ink = (weight: number) => {
      const canvas = createCanvas(160, 64)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, 160, 64)
      ctx.fillStyle = '#000000'
      applyCanvasFont(ctx, 'ChillDuanSans', weight, 42)
      ctx.fillText('黑8', 4, 48)
      const data = ctx.getImageData(0, 0, 160, 64).data
      let sum = 0
      for (let i = 0; i < data.length; i += 4) sum += 255 - data[i]!
      return sum
    }
    const light = ink(300)
    const mid = ink(500)
    const bold = ink(700)
    const heavy = ink(800)
    expect(mid).toBeGreaterThan(light + 1000)
    expect(bold).toBeGreaterThan(mid + 1000)
    expect(heavy).toBeGreaterThan(bold + 1000)
    expect(ink(600)).not.toBe(ink(400))
    expect(ink(600)).not.toBe(ink(700))
  })

  it('行内背景记在片段上，段落背景不抄进去', async () => {
    if (!hasFont) return
    const doc = await layoutSource(
      `<layer width="400" height="80" safe="0"><p style="background:#eeeeee">AA<span style="background-color:#ff0000"><em>BB</em></span>CC</p></layer>`,
      process.cwd(),
    )
    const node = doc.root.children[0]
    expect(node?.kind).toBe('text')
    if (!node || node.kind !== 'text') return
    const line = node.textLayout.lines[0]!
    expect(line.y).toBe(0)
    const bb = line.segments.find((seg) => seg.text.includes('B'))
    expect(bb?.style.background).toBe('#ff0000')
    expect(line.segments.find((seg) => seg.text.includes('A'))?.style.background).toBeUndefined()
    expect(node.background).toBe('#eeeeee')
  })

  it('竖排字距算进行顶', () => {
    if (!hasFont) return
    const r = layoutText({
      segments: [{ text: '竖排', style: { ...baseStyle, letterSpacing: 10 } }],
      writingMode: 'vertical-rl',
      lineHeightRatio: 1,
      fontSize: 40,
    })
    expect(r.lines[0]!.y).toBe(0)
    expect(r.lines[1]!.y).toBeCloseTo(r.lines[0]!.height + 10)
  })

  it('解析不了的行内渐变降回纯色，并丢掉背景', async () => {
    if (!hasFont) return
    const doc = await layoutSource(
      `<layer width="240" height="80" safe="0" color="#112233"><p>A<span style="color:gradient(nope); background:gradient(nope)">B</span></p></layer>`,
      process.cwd(),
    )
    const node = doc.root.children[0]
    expect(node?.kind).toBe('text')
    if (!node || node.kind !== 'text') return
    const bb = node.textLayout.lines[0]!.segments.find((seg) => seg.text.includes('B'))
    expect(bb?.style.color).toBe('#112233')
    expect(bb?.style.background).toBeUndefined()
    expect(doc.issues.filter((issue) => issue.code === 'invalid-attr').length).toBeGreaterThanOrEqual(2)
  })

  it('不是 100 倍数的字重仍按这个字号排', () => {
    if (!hasFont) return
    const width = (weight: number) => {
      const canvas = createCanvas(10, 10)
      const ctx = canvas.getContext('2d')
      applyCanvasFont(ctx, 'ChillDuanSans', weight, 40)
      return ctx.measureText('字重四五').width
    }
    const w400 = width(400)
    const w450 = width(450)
    expect(w450).toBeGreaterThan(w400 * 0.8)
    expect(w450).toBeLessThan(w400 * 1.25)
    expect(w450).toBeLessThan(200)
  })
})
