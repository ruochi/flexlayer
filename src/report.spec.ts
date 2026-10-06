import { describe, expect, it } from 'vitest'
import { checkFvg } from './render.js'
import { buildReport } from './report.js'
import type { FvgDocument, LayerLayoutNode, TextLayoutNode } from './types.js'

function minimalDoc(overrides: Partial<FvgDocument> = {}): FvgDocument {
  const text: TextLayoutNode = {
    kind: 'text',
    path: 'layer/h1[0]',
    tag: 'h1',
    x: -5,
    y: 0,
    width: 100,
    height: 40,
    ink: { x: 0, y: 0, width: 100, height: 40 },
    opacity: 1,
    rotate: 0,
    scale: 1,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    attr: {},
    style: {},
    computed: { color: '#111', fontFamily: 'ChillDuanSans', fontSize: 88, fontWeight: 700, opacity: 1 },
    text: 'A',
    textAlign: 'left',
    textLayout: {
      lines: [],
      contentWidth: 100,
      contentHeight: 40,
      minWidth: 40,
      ink: { x: 0, y: 0, width: 100, height: 40 },
      fontSize: 88,
      autoWrap: false,
      overflowFixed: false,
    },
  }
  const root: LayerLayoutNode = {
    kind: 'layer',
    path: 'layer',
    tag: 'layer',
    x: 0,
    y: 0,
    width: 1080,
    height: 1920,
    ink: text.ink,
    opacity: 1,
    rotate: 0,
    scale: 1,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    attr: {},
    style: {},
    computed: { color: '#111', fontFamily: 'ChillDuanSans', fontSize: 40, fontWeight: 400, opacity: 1 },
    text: '',
    children: [text],
  }
  return {
    width: 1080,
    height: 1920,
    background: '#fff',
    color: '#111',
    fontFamily: 'ChillDuanSans',
    safe: { top: 40, right: 40, bottom: 40, left: 40 },
    root,
    issues: [],
    ...overrides,
  }
}

describe('buildReport', () => {
  it('线条端点贴着画布边不算 overflow-canvas，中心线越出去仍然算', async () => {
    const onEdge = await checkFvg(
      `<layer width="200" height="80"><line x1="0" y1="40" x2="200" y2="40" stroke="#000" stroke-width="4" /></layer>`,
    )
    expect(onEdge.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(false)
    const past = await checkFvg(
      `<layer width="200" height="80"><line x1="10" y1="40" x2="210" y2="40" stroke="#000" stroke-width="4" /></layer>`,
    )
    expect(past.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(true)
  })

  it('overflow-canvas', () => {
    const rep = buildReport(minimalDoc())
    expect(rep.issues.some((i) => i.code === 'overflow-canvas')).toBe(true)
  })

  it('outside-safe', () => {
    const rep = buildReport(minimalDoc())
    expect(rep.issues.some((i) => i.code === 'outside-safe')).toBe(true)
  })

  it('旋转后的 ink 是外接矩形', async () => {
    const rep = await checkFvg(
      `<layer width="400" height="400" background="#000"><rect x="150" y="190" width="100" height="20" rotate="90" fill="#fff" /></layer>`,
    )
    const rect = rep.elements.find((e) => e.tag === 'rect')
    expect(rect).toBeTruthy()
    expect(rect!.ink.width).toBeGreaterThan(18)
    expect(rect!.ink.width).toBeLessThan(24)
    expect(rect!.ink.height).toBeGreaterThan(98)
    expect(rect!.ink.height).toBeLessThan(104)
    expect(rect!.ink.centerX).toBeCloseTo(200, 0)
    expect(rect!.ink.centerY).toBeCloseTo(200, 0)
    expect(rect!.box.width).toBeCloseTo(100, 0)
    expect(rect!.box.height).toBeCloseTo(20, 0)
  })

  it('完全透明的重叠文字不报 text-overlap', async () => {
    const rep = await checkFvg(
      `<layer width="400" height="200"><h1 style="opacity:0">勾股</h1><h1 style="opacity:0">勾股</h1></layer>`,
    )
    expect(rep.issues.some((i) => i.code === 'text-overlap')).toBe(false)
    expect(rep.elements.filter((e) => e.tag === 'h1')).toHaveLength(2)
  })

  it('嵌套 layer 的透明度相乘', async () => {
    const rep = await checkFvg(
      `<layer width="200" height="200"><layer x="50" y="50" width="100" height="100" opacity="0.5"><rect x="40" y="40" width="20" height="20" opacity="0.4" fill="#fff" /></layer></layer>`,
    )
    const rect = rep.elements.find((e) => e.tag === 'rect')
    expect(rect?.opacity).toBeCloseTo(0.2, 5)
  })

  it('被 overflow=hidden 裁掉的内容不报 overflow-canvas', async () => {
    const clipped = await checkFvg(
      `<layer width="100" height="100"><layer x="0" y="0" width="80" height="80" overflow="hidden"><rect x="70" y="10" width="50" height="20" fill="#fff" /></layer></layer>`,
    )
    expect(clipped.issues.some((i) => i.code === 'overflow-canvas')).toBe(false)
    const rect = clipped.elements.find((e) => e.tag === 'rect')
    expect(rect!.ink.right).toBeLessThanOrEqual(80 + 1e-6)

    const visible = await checkFvg(
      `<layer width="100" height="100"><layer x="0" y="0" width="80" height="80"><rect x="70" y="10" width="50" height="20" fill="#fff" /></layer></layer>`,
    )
    expect(visible.issues.some((i) => i.code === 'overflow-canvas')).toBe(true)
  })

  it('overflow=hidden 裁掉的光晕不报 effect-clipped', async () => {
    const clipped = await checkFvg(
      `<layer width="140" height="140" background="#fff"><layer x="20" y="20" width="100" height="100" overflow="hidden"><rect x="15" y="15" width="70" height="70" fill="#000" glow="48 #fff" /></layer></layer>`,
    )
    expect(clipped.issues.some((issue) => issue.code === 'effect-clipped')).toBe(false)
    const inside = await checkFvg(
      `<layer width="140" height="140" background="#fff"><layer x="20" y="20" width="100" height="100"><rect x="15" y="15" width="70" height="70" fill="#000" glow="28 #fff" /></layer></layer>`,
    )
    expect(inside.issues.some((issue) => issue.code === 'effect-clipped')).toBe(false)
    const open = await checkFvg(
      `<layer width="140" height="140" background="#fff"><layer x="20" y="20" width="100" height="100"><rect x="15" y="15" width="70" height="70" fill="#000" glow="80 #fff" /></layer></layer>`,
    )
    expect(open.issues.some((issue) => issue.code === 'effect-clipped')).toBe(true)
    const glow = open.elements.find((el) => el.tag === 'rect')
    expect(glow?.effect).toBeDefined()
    expect(glow!.effect!.width).toBeGreaterThan(glow!.ink.width)
    const plain = await checkFvg(`<layer width="80" height="80"><rect x="10" y="10" width="40" height="20" fill="#000" /></layer>`)
    expect(plain.elements.find((el) => el.tag === 'rect')?.effect).toBeUndefined()
    const margin = await checkFvg(
      `<layer width="160" height="160" background="#fff"><rect x="40" y="40" width="80" height="80" fill="#000" glow="40 #fff" /></layer>`,
    )
    expect(margin.issues.some((issue) => issue.code === 'effect-clipped')).toBe(false)
  })

  it('倾斜平面的光晕还在画布里时不报 effect-clipped', async () => {
    const inside = await checkFvg(
      `<layer width="480" height="320" background="#000"><layer perspective="700"><rect x="150" y="105" width="180" height="110" fill="#222" rotateY="36" shadow="0 8 16 #fff" /></layer></layer>`,
    )
    expect(inside.issues.some((issue) => issue.code === 'effect-clipped')).toBe(false)
    const clipped = await checkFvg(
      `<layer width="480" height="240" background="#000" perspective="700"><rect x="150" y="150" width="180" height="80" fill="#222" rotateY="36" shadow="0 8 20 #fff" /></layer>`,
    )
    expect(clipped.issues.some((issue) => issue.code === 'effect-clipped')).toBe(true)
  })
})
