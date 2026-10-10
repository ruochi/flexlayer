import { describe, expect, it } from 'vitest'
import { effectiveFontWeight } from './fonts.js'
import { iconCodepoint } from './icons.js'
import { layoutSource } from './layout.js'
import { renderLayer } from './render.js'
import type { LayoutNode, TextLayoutNode } from './types.js'

function findSpan(node: LayoutNode, text: string): TextLayoutNode | undefined {
  if (node.kind === 'text' && node.tag === 'span' && node.text === text) return node
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    for (const child of node.children) {
      const found = findSpan(child, text)
      if (found) return found
    }
  }
  return undefined
}

describe('图标', () => {
  it('名字对上码位，字重落到最近的整百', () => {
    expect(iconCodepoint('home')).toBe(0xe9b2)
    expect(iconCodepoint('arrow_back')).toBe(0xe5c4)
    expect(iconCodepoint('search')).toBe(0xe8b6)
    expect(iconCodepoint('not-an-icon')).toBeUndefined()
    expect(effectiveFontWeight('Symbols', 240)).toBe(200)
    expect(effectiveFontWeight('Symbols', 660)).toBe(700)
    expect(effectiveFontWeight('图标', 400)).toBe(400)
    expect(effectiveFontWeight('material-symbols-outlined', 400)).toBe(400)
  })

  it('跟文字排在同一段，并跟周围的字号', async () => {
    const doc = await layoutSource(
      `<layer width="480" height="80" color="#111111">
        <p style="font-size:32px; white-space:nowrap">去 <span class="material-symbols-outlined">home</span> 家</p>
      </layer>`,
      process.cwd(),
    )
    expect(doc.issues.filter((issue) => issue.level !== 'info')).toEqual([])
    const text = doc.root.children.find((node) => node.kind === 'text')
    if (!text || text.kind !== 'text') throw new Error('expected text')
    const line = text.textLayout.lines[0]!
    expect(line.segments.map((seg) => seg.style.fontFamily)).toContain('Symbols')
    const icon = line.segments.find((seg) => seg.style.fontFamily === 'Symbols')!
    expect(icon.style.fontSize).toBe(32)
    expect(icon.style.fontWeight).toBe(400)
    expect(icon.style.fontStyle).toBe('normal')
    expect(icon.text).toBe(String.fromCodePoint(0xe9b2))
    expect(icon.width).toBeGreaterThan(24)
    expect(icon.width).toBeLessThan(40)
  })

  it('flex 里是一块正方形，字重和字号写在 style 里', async () => {
    const doc = await layoutSource(
      `<layer width="200" height="120" color="#111111">
        <div style="display:flex; align-items:center; gap:12px; font-size:48px; font-weight:700">
          <span class="material-symbols-outlined" style="font-weight:200; font-size:48px">search</span>
          <span>搜索</span>
        </div>
      </layer>`,
      process.cwd(),
    )
    expect(doc.issues.filter((issue) => issue.level === 'error' || issue.level === 'warn')).toEqual([])
    const icon = findSpan(doc.root, 'search')
    if (!icon) throw new Error('expected icon')
    const seg = icon.textLayout.lines[0]!.segments[0]!
    expect(seg.text).toBe(String.fromCodePoint(0xe8b6))
    expect(icon.width).toBeGreaterThan(40)
    expect(icon.width).toBeLessThan(56)
    expect(icon.height).toBeGreaterThan(40)
    expect(icon.height).toBeLessThan(56)
    expect(seg.style.fontWeight).toBe(200)
    expect(seg.style.fontSize).toBe(48)
  })

  it('className 和 i 上也换成这个字体，并且不是斜体', async () => {
    const doc = await layoutSource(
      `<layer width="160" height="80" color="#111111">
        <i className="material-symbols-outlined" style="font-size:32px">home</i>
      </layer>`,
      process.cwd(),
    )
    expect(doc.issues.filter((issue) => issue.level === 'error' || issue.level === 'warn')).toEqual([])
    const text = doc.root.children.find((node) => node.kind === 'text')
    if (!text || text.kind !== 'text') throw new Error('expected text')
    const seg = text.textLayout.lines[0]!.segments[0]!
    expect(seg.style.fontFamily).toBe('Symbols')
    expect(seg.style.fontStyle).toBe('normal')
    expect(seg.text).toBe(String.fromCodePoint(0xe9b2))
  })

  it('没有这个名字时报 missing-icon，空的和普通文字不报', async () => {
    const missing = await layoutSource(
      `<layer width="240" height="80"><span class="material-symbols-outlined">not_a_real_icon_zzz</span></layer>`,
      process.cwd(),
    )
    expect(missing.issues.some((issue) => issue.code === 'missing-icon')).toBe(true)
    const empty = await layoutSource(
      `<layer width="80" height="80"><span class="material-symbols-outlined"></span></layer>`,
      process.cwd(),
    )
    expect(empty.issues.some((issue) => issue.code === 'missing-icon')).toBe(false)
    const plain = await layoutSource(`<layer width="200" height="80"><p>home</p></layer>`, process.cwd())
    expect(plain.issues.some((issue) => issue.code === 'missing-icon')).toBe(false)
  })

  it('rounded 仍画出 outlined，并报 invalid-attr', async () => {
    const doc = await layoutSource(
      `<layer width="80" height="80"><span class="material-symbols-rounded" style="font-size:32px">home</span></layer>`,
      process.cwd(),
    )
    expect(doc.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('outlined'))).toBe(true)
    const text = doc.root.children.find((node) => node.kind === 'text')
    if (!text || text.kind !== 'text') throw new Error('expected text')
    const seg = text.textLayout.lines[0]!.segments[0]!
    expect(seg.style.fontFamily).toBe('Symbols')
    expect(seg.text).toBe(String.fromCodePoint(0xe9b2))
  })

  it('不同字重画出来不一样', async () => {
    const paint = (weight: number) =>
      renderLayer(
        `<layer width="80" height="80" background="#ffffff" color="#111111"><span class="material-symbols-outlined" style="font-weight:${weight}; font-size:64px">home</span></layer>`,
        { baseDir: process.cwd() },
      )
    const light = await paint(100)
    const heavy = await paint(700)
    expect(light.report.issues.filter((issue) => issue.level === 'error')).toEqual([])
    expect(heavy.report.issues.filter((issue) => issue.level === 'error')).toEqual([])
    expect(Buffer.compare(light.png, heavy.png)).not.toBe(0)
  }, 60_000)
})
