import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Path2D } from '@napi-rs/canvas'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyCanvasFont, ensureBuiltinFonts, ensureDefaultFont, getFontsCacheDir, registerFontPath } from './fonts.js'
import { glyph } from './glyph.js'
import { layoutText } from './text.js'
import { layoutSource } from './layout.js'
import { loadLayerFile } from './load-source.js'
import { getMeasureCtx } from './measureCtx.js'
import { translateSvgPath } from './path.js'
import { renderLayer } from './render.js'
import { typecheckLayerFile } from './typecheck.js'

let ready = false

beforeAll(async () => {
  try {
    await ensureDefaultFont()
    await ensureBuiltinFonts(['Kai', 'Inter'])
    ready = true
  } catch {
    ready = false
  }
})

describe('glyph', () => {
  it('从楷体取出春的轮廓，原点在字身顶上', async () => {
    if (!ready) return
    const [chun] = glyph('春', { font: 'Kai', size: 200 })
    expect(chun).toBeDefined()
    if (!chun) return
    expect(chun.text).toBe('春')
    expect(chun.font).toBe('ChillKai')
    expect(chun.size).toBe(200)
    expect(chun.weight).toBe(400)
    expect(chun.width).toBe(200)
    expect(chun.height).toBeGreaterThanOrEqual(chun.size)
    expect(chun.baseline).toBeGreaterThan(0)
    expect(chun.baseline).toBeLessThan(chun.height)
    expect(chun.missing).toBe(false)
    expect(chun.d).toMatch(/^M /)
    expect(chun.d).not.toMatch(/[mlhvcsqtaz]/)
    expect(chun.ink).not.toBeNull()
    expect(chun.ink!.y).toBeGreaterThan(0)
    expect(chun.ink!.y).toBeLessThan(chun.baseline)
    expect(chun.ink!.y + chun.ink!.height).toBeGreaterThan(chun.baseline)

    const ctx = getMeasureCtx()
    applyCanvasFont(ctx, 'Kai', 400, 200)
    const measured = ctx.measureText('春')
    const atBaseline = translateSvgPath(chun.d, 0, -chun.baseline)
    const [left, top, right, bottom] = new Path2D(atBaseline).computeTightBounds()
    const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(2)
    near(left, -measured.actualBoundingBoxLeft)
    near(top, -measured.actualBoundingBoxAscent)
    near(right, measured.actualBoundingBoxRight)
    near(bottom, measured.actualBoundingBoxDescent)
  })

  it('同一字体的字身一样高，标点的着墨更小', async () => {
    if (!ready) return
    const [chun, comma, latin] = glyph('春，A', { font: 'Kai', size: 200 })
    expect([chun, comma, latin].map((item) => item?.text)).toEqual(['春', '，', 'A'])
    expect(comma!.height).toBe(chun!.height)
    expect(comma!.baseline).toBe(chun!.baseline)
    expect(comma!.width).toBeGreaterThan(0)
    expect(comma!.width).toBeLessThan(chun!.width)
    expect(latin!.width).toBeLessThan(chun!.width)
    expect(comma!.ink!.height).toBeLessThan(chun!.ink!.height / 2)
  })

  it('没有 en dash 的默认字体用数字短横，不再是缺字方框', async () => {
    if (!ready) return
    const [en, em, figure, hyphen] = [
      glyph('–', { size: 200 })[0]!,
      glyph('—', { size: 200 })[0]!,
      glyph('‒', { size: 200 })[0]!,
      glyph('-', { size: 200 })[0]!,
    ]
    expect(en.missing).toBe(false)
    expect(en.d).toBe(figure.d)
    expect(en.width).toBe(figure.width)
    expect(en.ink).not.toBeNull()
    expect(Math.abs(en.ink!.height - em.ink!.height)).toBeLessThanOrEqual(1)
    expect(en.ink!.width).toBeLessThan(em.ink!.width)
    expect(en.ink!.width).toBeGreaterThan(hyphen.ink!.width)
    expect(en.ink!.y + en.ink!.height).toBeLessThanOrEqual(en.baseline + 1)
  })

  it('细长的对勾用固定路径，楷体自己的勾留着', async () => {
    if (!ready) return
    const [check, root, spring] = glyph('✓√春', { size: 200 })
    const [inter] = glyph('✓', { font: 'Inter', size: 200 })
    expect(check!.missing).toBe(false)
    expect(check!.font).toBe('ChillDuanSans')
    expect(check!.height).toBe(spring!.height)
    expect(check!.baseline).toBe(spring!.baseline)
    expect(check!.width).toBeCloseTo(200 * 1.02, 5)
    expect(check!.ink!.width).toBeGreaterThan(check!.ink!.height)
    expect(check!.d).not.toBe(root!.d)
    expect(check!.ink!.y + check!.ink!.height).toBeCloseTo(check!.baseline + 200 * 0.04, 0)
    expect(inter!.missing).toBe(false)
    expect(inter!.width).toBe(check!.width)
    expect(inter!.ink!.width).toBeCloseTo(check!.ink!.width, 5)
    expect(inter!.ink!.height).toBeCloseTo(check!.ink!.height, 5)
    expect(translateSvgPath(check!.d, 0, inter!.baseline - check!.baseline)).toBe(inter!.d)
    const [varied] = glyph('✓', { size: 200, weight: 500 })
    expect(varied!.width).toBe(check!.width)
    expect(varied!.ink!.width).toBeGreaterThan(varied!.ink!.height)
    expect(translateSvgPath(check!.d, 0, varied!.baseline - check!.baseline)).toBe(varied!.d)

    const [kai] = glyph('✓', { font: 'Kai', size: 160 })
    expect(kai!.font).toBe('ChillKai')
    expect(kai!.missing).toBe(false)
    expect(kai!.ink!.height).toBeGreaterThan(kai!.ink!.width)
    expect(kai!.d).not.toBe(translateSvgPath(check!.d, 0, kai!.baseline - check!.baseline))
  })

  it('非默认字重也能取出整段都在基线上方的破折号', async () => {
    if (!ready) return
    const [em] = glyph('—', { size: 120, weight: 500 })
    const [en] = glyph('–', { size: 120, weight: 500 })
    expect(em!.missing).toBe(false)
    expect(em!.ink!.width).toBeGreaterThan(em!.ink!.height * 4)
    expect(en!.missing).toBe(false)
    expect(en!.ink!.width).toBeGreaterThan(en!.ink!.height * 4)
    expect(en!.ink!.width).toBeLessThan(em!.ink!.width)
  })

  it('正文里的 en dash 和对勾走同一套替身', async () => {
    if (!ready) return
    const laid = layoutText({
      segments: [{ text: '10–20✓', style: { fontFamily: 'ChillDuanSans', fontSize: 40, fontWeight: 300, color: '#111', letterSpacing: 0 } }],
      nowrap: true,
      lineHeightRatio: 1.2,
      fontSize: 40,
    })
    const segments = laid.lines[0]!.segments
    expect(segments.map((seg) => seg.text)).toEqual(['10', '‒', '20', '✓'])
    const tick = segments.find((seg) => seg.text === '✓')!
    expect(tick.style.fontFamily).toBe('ChillDuanSans')
    expect(tick.width).toBeCloseTo(40 * 1.02, 5)
    const kai = layoutText({
      segments: [{ text: '–✓', style: { fontFamily: 'Kai', fontSize: 40, fontWeight: 400, color: '#111', letterSpacing: 0 } }],
      nowrap: true,
      lineHeightRatio: 1.2,
      fontSize: 40,
    })
    expect(kai.lines[0]!.segments.map((seg) => seg.text)).toEqual(['–', '✓'])
    expect(kai.lines[0]!.segments.every((seg) => seg.style.fontFamily === 'Kai')).toBe(true)
  })

  it('可变字体也能取出破折号、省略号和引号', async () => {
    if (!ready) return
    const marks = glyph('—…「」', { size: 120 })
    expect(marks.map((item) => item.text)).toEqual(['—', '…', '「', '」'])
    for (const item of marks) {
      expect(item.font).toBe('ChillDuanSans')
      expect(item.missing).toBe(false)
      expect(item.d).toMatch(/^M /)
      expect(item.ink).not.toBeNull()
      expect(item.ink!.width).toBeGreaterThan(0)
      expect(item.ink!.height).toBeGreaterThan(0)
    }
    const [dash] = marks
    expect(dash!.ink!.y + dash!.ink!.height).toBeLessThanOrEqual(dash!.baseline + 1)
  })

  it('空格有字宽，没有轮廓', async () => {
    if (!ready) return
    const [space] = glyph(' ', { font: 'Kai', size: 200 })
    expect(space!.d).toBe('')
    expect(space!.missing).toBe(false)
    expect(space!.ink).toBeNull()
    expect(space!.width).toBeGreaterThan(0)
    expect(space!.height).toBeGreaterThan(0)
  })

  it('寒蝉楷体请求别的字重时仍用这一档', async () => {
    if (!ready) return
    const chars = glyph('春眠', { font: 'Kai', size: 120, weight: 700 })
    const [regular] = glyph('春', { font: '楷体', size: 120 })
    expect(chars.map((item) => item.text)).toEqual(['春', '眠'])
    expect(chars.every((item) => item.font === 'ChillKai' && item.size === 120 && item.weight === 400)).toBe(true)
    expect(chars[0]!.d).toBe(regular!.d)
    expect(chars[0]!.height).toBe(chars[1]!.height)
  })

  it('寒蝉楷体只有一档，请求粗体仍用这一档', async () => {
    if (!ready) return
    const [regular] = glyph('春', { font: '楷体', size: 160 })
    const [bold] = glyph('春', { font: 'Kai', size: 160, weight: 700 })
    expect(regular!.font).toBe('ChillKai')
    expect(regular!.weight).toBe(400)
    expect(bold!.weight).toBe(400)
    expect(bold!.d).toBe(regular!.d)
    expect(bold!.height).toBe(regular!.height)
  })

  it('默认字号是 40，再取一次得到同一条路径', async () => {
    if (!ready) return
    const [first] = glyph('春', { font: 'Kai' })
    const [second] = glyph('春', { font: 'Kai', size: 40 })
    expect(first!.size).toBe(40)
    expect(first!.width).toBe(40)
    expect(second!.d).toBe(first!.d)
  })

  it('可变字体按字重轴取轮廓，轴外夹到两端', async () => {
    if (!ready) return
    const [regular] = glyph('春', { size: 120 })
    const [named] = glyph('春', { size: 120, weight: 300 })
    const [mid] = glyph('春', { size: 120, weight: 500 })
    const [bold] = glyph('春', { size: 120, weight: 800 })
    const [low] = glyph('春', { size: 120, weight: 100 })
    const [high] = glyph('春', { size: 120, weight: 900 })
    expect(regular!.font).toBe('ChillDuanSans')
    expect(regular!.weight).toBe(300)
    expect(named!.d).toBe(regular!.d)
    expect(mid!.weight).toBe(500)
    expect(bold!.weight).toBe(800)
    expect(mid!.d).not.toBe(regular!.d)
    expect(bold!.d).not.toBe(regular!.d)
    expect(bold!.d).not.toBe(mid!.d)
    expect(bold!.ink!.width * bold!.ink!.height).toBeGreaterThan(regular!.ink!.width * regular!.ink!.height)
    expect(low!.weight).toBe(300)
    expect(low!.d).toBe(regular!.d)
    expect(high!.weight).toBe(800)
    expect(high!.d).toBe(bold!.d)

    const ctx = getMeasureCtx()
    applyCanvasFont(ctx, 'ChillDuanSans', 800, 120)
    const measured = ctx.measureText('春')
    const atBaseline = translateSvgPath(bold!.d, 0, -bold!.baseline)
    const [left, top, right, bottom] = new Path2D(atBaseline).computeTightBounds()
    const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(2)
    near(left, -measured.actualBoundingBoxLeft)
    near(top, -measured.actualBoundingBoxAscent)
    near(right, measured.actualBoundingBoxRight)
    near(bottom, measured.actualBoundingBoxDescent)
  })

  it('用 <font> 注册的可变字体也按轴取轮廓', async () => {
    if (!ready) return
    registerFontPath('PosterSans', join(getFontsCacheDir(), 'ChillDuanSansVF.ttf'))
    const [regular] = glyph('春', { font: 'PosterSans', size: 80 })
    const [bold] = glyph('春', { font: 'PosterSans', size: 80, weight: 800 })
    expect(regular!.weight).toBe(300)
    expect(bold!.weight).toBe(800)
    expect(bold!.d).not.toBe(regular!.d)
    expect(bold!.missing).toBe(false)
  })

  it('不认识的字体直接报错', async () => {
    if (!ready) return
    expect(() => glyph('春', { font: 'NoSuchFont' })).toThrow(/字体未注册: NoSuchFont/)
    expect(() => glyph('春', { font: 'Kai', size: 0 })).toThrow(/size 要是正数/)
  })

  it('一个 emoji 算一个字，缺字可以看出来', async () => {
    if (!ready) return
    const emoji = glyph('😀', { font: 'Kai', size: 100 })
    const rare = glyph('𠀀', { font: 'Kai', size: 100 })
    const [chun] = glyph('春', { font: 'Kai', size: 100 })
    expect(emoji).toHaveLength(1)
    expect(emoji[0]!.text).toBe('😀')
    expect(emoji[0]!.missing).toBe(true)
    expect(rare[0]!.missing).toBe(true)
    expect(emoji[0]!.d).toBe(rare[0]!.d)
    expect(emoji[0]!.d).not.toBe(chun!.d)
    expect(chun!.missing).toBe(false)
    const [bad] = glyph('\uFFFE', { font: 'Kai', size: 100 })
    expect(bad!.missing).toBe(true)
    expect(bad!.d).toBe(emoji[0]!.d)
  })

  it('没写宽高的 layer 不把 ·、句号和拉丁小写推到字身左上角', async () => {
    if (!ready) return
    const chars = glyph('国·。ay', { size: 80 })
    const place = async (em: boolean) => {
      let cursor = 0
      const parts = chars.map((g) => {
        const size = em ? ` width="${g.width}" height="${g.height}"` : ''
        const part = `<layer x="${cursor}" y="12"${size}><path d="${g.d}" fill="#111111" stroke="none" /></layer>`
        cursor += g.width
        return part
      })
      const doc = await layoutSource(`<layer width="800" height="240">${parts.join('')}</layer>`, process.cwd())
      return (doc.root.children as Array<{ x: number; y: number; children: Array<{ x: number; y: number; width: number; height: number }> }>).map(
        (layer) => {
          const path = layer.children[0]!
          return { x: layer.x + path.x, y: layer.y + path.y, width: path.width, height: path.height }
        },
      )
    }
    const bare = await place(false)
    const fitted = await place(true)
    expect(bare.map((box) => box.x)).toEqual(fitted.map((box) => box.x))
    expect(bare.map((box) => box.y)).toEqual(fitted.map((box) => box.y))
    const dot = chars[1]!
    const period = chars[2]!
    const lowercase = chars[3]!
    // 着墨不在字身顶上。被推到左上角时，y 会贴着层的 y。
    expect(bare[1]!.y).toBeGreaterThan(12 + dot.ink!.y * 0.5)
    expect(bare[2]!.y).toBeCloseTo(12 + period.ink!.y, 3)
    expect(bare[3]!.y).toBeCloseTo(12 + lowercase.ink!.y, 3)
    expect(bare[1]!.y - 12).toBeCloseTo(dot.ink!.y, 3)
  })

  it('胶囊字按 g.ink.y 贴 pad，不按 HTML line-height 基线去减', async () => {
    // Issue #27: inkOf used line.baseline (includes leading) + g.ink.y, then
    // placed at inkTop - m.top. That sits the outlines high. Place by ink only.
    if (!ready) return
    const size = 40
    const weight = 500
    const pad = 10
    const text = '杭州西湖'
    const gs = glyph(text, { size, weight })
    const inkTop = pad
    let cursor = 0
    const parts = gs.map((g) => {
      const y = inkTop - g.ink!.y
      const part = `<layer x="${cursor}" y="${y}"><path d="${g.d}" fill="#111111" stroke="none" /></layer>`
      cursor += g.width
      return part
    })
    const { report } = await renderLayer(`<layer width="400" height="120">${parts.join('')}</layer>`)
    const paths = report.elements.filter((el) => el.tag === 'path')
    expect(paths.length).toBe(gs.length)
    const top = Math.min(...paths.map((el) => el.ink.y))
    expect(top).toBeCloseTo(inkTop, 1)
  })

  it('取出来的路径可以画进 layer', async () => {
    if (!ready) return
    const [chun] = glyph('春', { font: 'Kai', size: 120 })
    const { report } = await renderLayer(
      `<layer width="200" height="240" background="#111111"><path d="${chun!.d}" fill="#f4ecdf" stroke="none" /></layer>`,
    )
    expect(report.issues.filter((issue) => issue.level === 'error')).toEqual([])
    const path = report.elements.find((el) => el.tag === 'path')
    expect(path?.ink.width).toBeGreaterThan(80)
    expect(path?.ink.height).toBeGreaterThan(80)
  })

  it('tsx 里可以 import glyph', async () => {
    if (!ready) return
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-glyph-'))
    const file = join(dir, 'chun.tsx')
    await writeFile(
      file,
      `import { glyph } from 'flexlayer'
      const [chun] = glyph('春', { font: 'Kai', size: 80 })
      export default (
        <layer width="200" height="200" background="#111111">
          <path d={chun.d} fill="#f4ecdf" stroke="none" />
        </layer>
      )
      `,
    )
    expect(typecheckLayerFile(file)).toEqual([])
    const loaded = await loadLayerFile(file)
    expect(loaded.kind).toBe('node')
    if (loaded.kind !== 'node') return
    const path = loaded.node.children.find((child) => typeof child !== 'string' && child.tag === 'path')
    expect(typeof path !== 'string' && path && path.attrs.d.startsWith('M ')).toBe(true)
  })

  it('tsx 里只靠 <font> 加载的字体，glyph() 也能用', async () => {
    if (!ready) return
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-font-'))
    const src = join(getFontsCacheDir(), 'ChillDuanSansVF.ttf')
    const file = join(dir, 'poster.tsx')
    await writeFile(
      file,
      `import { glyph } from 'flexlayer'
      const [chun] = glyph('春', { font: 'PosterKai', size: 48 })
      export default (
        <layer width="80" height="80" background="#111111">
          <font family="PosterKai" src="${src}" />
          <path d={chun.d} fill="#f4ecdf" stroke="none" />
        </layer>
      )
      `,
    )
    const loaded = await loadLayerFile(file)
    expect(loaded.kind).toBe('node')
    if (loaded.kind !== 'node') return
    const path = loaded.node.children.find((child) => typeof child !== 'string' && child.tag === 'path')
    expect(typeof path !== 'string' && path && path.attrs.d.startsWith('M ')).toBe(true)
    expect(path && typeof path !== 'string' && path.attrs.d.length).toBeGreaterThan(20)
  })
})
