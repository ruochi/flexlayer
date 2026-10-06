import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Path2D } from '@napi-rs/canvas'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyCanvasFont, ensureBuiltinFonts, ensureDefaultFont } from './fonts.js'
import { glyph } from './glyph.js'
import { loadLayerFile } from './load-source.js'
import { getMeasureCtx } from './measureCtx.js'
import { translateSvgPath } from './path.js'
import { renderLayer } from './render.js'
import { typecheckLayerFile } from './typecheck.js'

let ready = false

beforeAll(async () => {
  try {
    await ensureDefaultFont()
    await ensureBuiltinFonts(['Kai'])
    ready = true
  } catch {
    ready = false
  }
})

describe('glyph', () => {
  it('从楷体取出春的轮廓，原点在字身顶上', async () => {
    if (!ready) return
    const [chun] = await glyph('春', { font: 'Kai', size: 200 })
    expect(chun).toBeDefined()
    if (!chun) return
    expect(chun.text).toBe('春')
    expect(chun.font).toBe('Kai')
    expect(chun.size).toBe(200)
    expect(chun.weight).toBe(400)
    expect(chun.width).toBe(200)
    expect(chun.height).toBeGreaterThan(chun.size)
    expect(chun.baseline).toBeGreaterThan(0)
    expect(chun.baseline).toBeLessThan(chun.height)
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
    const [chun, comma, latin] = await glyph('春，A', { font: 'Kai', size: 200 })
    expect([chun, comma, latin].map((item) => item?.text)).toEqual(['春', '，', 'A'])
    expect(comma!.height).toBe(chun!.height)
    expect(comma!.baseline).toBe(chun!.baseline)
    expect(comma!.width).toBe(chun!.width)
    expect(latin!.width).toBeLessThan(chun!.width)
    expect(comma!.ink!.height).toBeLessThan(chun!.ink!.height / 2)
  })

  it('空格有字宽，没有轮廓', async () => {
    if (!ready) return
    const [space] = await glyph(' ', { font: 'Kai', size: 200 })
    expect(space!.d).toBe('')
    expect(space!.ink).toBeNull()
    expect(space!.width).toBeGreaterThan(0)
    expect(space!.height).toBeGreaterThan(0)
  })

  it('春眠可以指定字重', async () => {
    if (!ready) return
    const chars = await glyph('春眠', { font: 'Kai', size: 120, weight: 700 })
    const [regular] = await glyph('春', { font: 'Kai', size: 120 })
    expect(chars.map((item) => item.text)).toEqual(['春', '眠'])
    expect(chars.every((item) => item.font === 'Kai' && item.size === 120 && item.weight === 700)).toBe(true)
    expect(chars[0]!.d).not.toBe(regular!.d)
    expect(chars[0]!.height).toBe(chars[1]!.height)
  })

  it('粗楷和常规楷的轮廓不同', async () => {
    if (!ready) return
    const [regular] = await glyph('春', { font: '楷体', size: 160 })
    const [bold] = await glyph('春', { font: 'Kai', size: 160, weight: 700 })
    expect(regular!.font).toBe('Kai')
    expect(regular!.weight).toBe(400)
    expect(bold!.weight).toBe(700)
    expect(bold!.d).not.toBe(regular!.d)
    expect(bold!.height).toBe(regular!.height)
  })

  it('默认字号是 40，再取一次得到同一条路径', async () => {
    if (!ready) return
    const [first] = await glyph('春', { font: 'Kai' })
    const [second] = await glyph('春', { font: 'Kai', size: 40 })
    expect(first!.size).toBe(40)
    expect(first!.width).toBe(40)
    expect(second!.d).toBe(first!.d)
  })

  it('可变字体只出默认字重', async () => {
    if (!ready) return
    const [chun] = await glyph('春')
    expect(chun!.font).toBe('ChillDuanSans')
    expect(chun!.weight).toBe(300)
    await expect(glyph('春', { weight: 800 })).rejects.toThrow(/默认字重 300/)
  })

  it('不认识的字体直接报错', async () => {
    if (!ready) return
    await expect(glyph('春', { font: 'NoSuchFont' })).rejects.toThrow(/字体未注册: NoSuchFont/)
    await expect(glyph('春', { font: 'Kai', size: 0 })).rejects.toThrow(/size 要是正数/)
  })

  it('一个 emoji 算一个字', async () => {
    if (!ready) return
    const chars = await glyph('😀', { font: 'Kai', size: 100 })
    expect(chars).toHaveLength(1)
    expect(chars[0]!.text).toBe('😀')
  })

  it('取出来的路径可以画进 layer', async () => {
    if (!ready) return
    const [chun] = await glyph('春', { font: 'Kai', size: 120 })
    const { report } = await renderLayer(
      `<layer width="200" height="240" background="#111111"><path d="${chun!.d}" fill="#f4ecdf" /></layer>`,
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
      `import { glyph } from '@dc/flexlayer'
      const [chun] = await glyph('春', { font: 'Kai', size: 80 })
      export default (
        <layer width="200" height="200" background="#111111">
          <path d={chun.d} fill="#f4ecdf" />
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
})
