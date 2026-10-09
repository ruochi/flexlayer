import { describe, expect, it } from 'vitest'
import { effectiveFontWeight } from './fonts.js'
import { iconCodepoint } from './icons.js'
import { layoutSource } from './layout.js'
import { renderLayer } from './render.js'
import type { LayoutNode, TextLayoutNode } from './types.js'

function findIcon(node: LayoutNode): TextLayoutNode | undefined {
  if (node.tag === 'icon' && node.kind === 'text') return node
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    for (const child of node.children) {
      const found = findIcon(child)
      if (found) return found
    }
  }
  return undefined
}

describe('图标', () => {
  it('名字对上码位，字重落到最近的整百', () => {
    expect(iconCodepoint('home')).toBe(0xe9b2)
    expect(iconCodepoint('arrow_back')).toBe(0xe5c4)
    expect(iconCodepoint('not-an-icon')).toBeUndefined()
    expect(effectiveFontWeight('Symbols', 240)).toBe(200)
    expect(effectiveFontWeight('Symbols', 660)).toBe(700)
    expect(effectiveFontWeight('图标', 400)).toBe(400)
  })

  it('跟文字排在同一段，并跟周围的字号', async () => {
    const doc = await layoutSource(
      `<layer width="480" height="80" color="#111111">
        <p style="font-size:32px; white-space:nowrap">去 <icon name="home" /> 家</p>
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
    expect(icon.text).toBe(String.fromCodePoint(0xe9b2))
    expect(icon.width).toBeGreaterThan(24)
    expect(icon.width).toBeLessThan(40)
  })

  it('flex 里是一块正方形，字重和字号可以单独写', async () => {
    const doc = await layoutSource(
      `<layer width="200" height="120" color="#111111">
        <div style="display:flex; align-items:center; gap:12px; font-size:48px; font-weight:700">
          <icon name="search" weight="200" size="48" />
          <span>搜索</span>
        </div>
      </layer>`,
      process.cwd(),
    )
    expect(doc.issues.filter((issue) => issue.level === 'error' || issue.level === 'warn')).toEqual([])
    const icon = findIcon(doc.root)
    if (!icon) throw new Error('expected icon')
    expect(icon.text).toBe('search')
    expect(icon.width).toBeGreaterThan(40)
    expect(icon.width).toBeLessThan(56)
    expect(icon.height).toBeGreaterThan(40)
    expect(icon.height).toBeLessThan(56)
    expect(icon.textLayout.lines[0]!.segments[0]!.style.fontWeight).toBe(200)
  })

  it('没有名字或缺名字时报 warn', async () => {
    const missing = await layoutSource(
      `<layer width="80" height="80"><icon name="not_a_real_icon_zzz" /></layer>`,
      process.cwd(),
    )
    expect(missing.issues.some((issue) => issue.code === 'missing-icon')).toBe(true)
    const empty = await layoutSource(`<layer width="80" height="80"><icon /></layer>`, process.cwd())
    expect(empty.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('name'))).toBe(true)
  })

  it('不同字重画出来不一样', async () => {
    const paint = (weight: number) =>
      renderLayer(
        `<layer width="80" height="80" background="#ffffff" color="#111111"><icon name="home" weight="${weight}" size="64" /></layer>`,
        { baseDir: process.cwd() },
      )
    const light = await paint(100)
    const heavy = await paint(700)
    expect(light.report.issues.filter((issue) => issue.level === 'error')).toEqual([])
    expect(heavy.report.issues.filter((issue) => issue.level === 'error')).toEqual([])
    expect(Buffer.compare(light.png, heavy.png)).not.toBe(0)
  }, 60_000)
})
