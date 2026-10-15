import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { builtinFont, effectiveFontWeight } from './fonts.js'
import { CATALOG_FONTS, DEFAULT_FONT, REGISTERED_FONTS } from './font-catalog.js'
import { RECOMMENDED_FONTS } from './recommended-fonts.js'
import { GRADE_PRESETS } from './grade.js'
import { layoutSource } from './layout.js'
import { resources } from './resources.js'
import { BLEND_MODES, parseGlass } from './style.js'

describe('可用资源', () => {
  it('每个字体名和别名都能查到，而且会注册', () => {
    const seen = new Set<string>()
    for (const font of CATALOG_FONTS) {
      expect(resources.font(font.family)?.family).toBe(font.family)
      for (const alias of font.aliases) {
        const key = alias.trim().toLowerCase()
        expect(seen.has(key), alias).toBe(false)
        seen.add(key)
        expect(resources.font(alias)?.family).toBe(font.family)
      }
      if (font.role === 'default') {
        expect(builtinFont(font.family)).toBeUndefined()
        continue
      }
      expect(builtinFont(font.family)?.cssFamily).toBe(font.family)
      expect(builtinFont(font.aliases[0]!)?.cssFamily).toBe(font.family)
    }
  })

  it('字重落到最近的已登记档', () => {
    expect(effectiveFontWeight('Inter', 650)).toBe(700)
    expect(effectiveFontWeight('Inter', 500)).toBe(400)
    expect(effectiveFontWeight('Bebas', 700)).toBe(400)
    expect(effectiveFontWeight('楷体', 600)).toBe(400)
    expect(effectiveFontWeight('黑体', 450)).toBe(450)
    expect(effectiveFontWeight('宋体', 700)).toBe(400)
    expect(effectiveFontWeight('JetBrainsMono', 650)).toBe(700)
    expect(effectiveFontWeight('等宽', 400)).toBe(400)
    expect(effectiveFontWeight('ChillDuanSans', 450)).toBe(450)
  })

  it('手册列出全部字体、配色、图片和效果名', () => {
    const doc = readFileSync(new URL('../docs/RESOURCES.md', import.meta.url), 'utf8')
    for (const font of REGISTERED_FONTS) expect(doc).toContain(`\`${font.family}\``)
    expect(doc).toContain('`ChillDuanSans`')
    for (const name of Object.keys(resources.palettes)) expect(doc).toContain(`\`${name}\``)
    for (const image of resources.images) expect(doc).toContain(image.src)
    expect([...resources.grades].sort()).toEqual(Object.keys(GRADE_PRESETS).sort())
    expect([...resources.blends]).toEqual([...BLEND_MODES])
    for (const name of resources.grades) expect(doc).toContain(`\`${name}\``)
    for (const name of resources.glass) {
      expect(doc).toContain(`\`${name}\``)
      expect(parseGlass(name)?.variant).toBe(name)
    }
    expect(doc).not.toContain('fonts.googleapis.com/css')
  })

  it('推荐字体按档列出，目录里已有的不必再带文件', () => {
    const doc = readFileSync(new URL('../docs/RESOURCES.md', import.meta.url), 'utf8')
    expect(RECOMMENDED_FONTS.map((group) => [group.name, group.use])).toEqual([
      ['最推荐', '优先选用'],
      ['推荐', '常用'],
      ['其他', '备选'],
    ])
    expect(resources.recommendedFonts).toBe(RECOMMENDED_FONTS)
    const fonts = RECOMMENDED_FONTS.flatMap((group) => group.fonts)
    const families = fonts.map((font) => font.family)
    const titles = fonts.map((font) => font.title.trim().toLowerCase())
    expect(new Set(families).size).toBe(families.length)
    expect(new Set(titles).size).toBe(titles.length)
    expect(fonts.filter((font) => font.builtin).map((font) => font.family)).toEqual([
      DEFAULT_FONT.family,
      'ChillDuanHeiSong',
      'ChillKai',
      'ChillHuoFangSong',
      'ChillRoundF',
    ])
    expect(resources.recommendedFont('寒蝉端黑体')?.group).toBe('最推荐')
    expect(resources.recommendedFont('ChillDuanHeiSong')).toEqual({
      group: '最推荐',
      font: { family: 'ChillDuanHeiSong', title: '寒蝉端黑宋', builtin: true },
    })
    expect(resources.font('黑体')?.family).toBe('ChillDuanSans')
    expect(resources.font('宋体')?.family).toBe('ChillDuanHeiSong')
    expect(resources.font('Song')?.family).toBe('ChillDuanHeiSong')
    expect(resources.font('楷体')?.family).toBe('ChillKai')
    expect(resources.font('Kai')?.family).toBe('ChillKai')
    expect(resources.font('仿宋')?.family).toBe('ChillHuoFangSong')
    expect(resources.font('圆体')?.family).toBe('ChillRoundF')
    expect(resources.font('思源宋体')).toBeUndefined()
    expect(resources.font('思源黑体')).toBeUndefined()
    expect(resources.font('霞鹜文楷')).toBeUndefined()
    expect(resources.recommendedFont('霞鹜文楷')).toBeUndefined()
    for (const group of RECOMMENDED_FONTS) {
      expect(doc).toContain(group.name)
      expect(doc).toContain(group.use)
    }
    for (const font of fonts) {
      expect(doc).toContain(`\`${font.family}\``)
      expect(doc).toContain(font.title)
      const inCatalog = CATALOG_FONTS.some((item) => item.family === font.family)
      if (font.builtin) {
        expect(inCatalog).toBe(true)
        continue
      }
      expect(builtinFont(font.family)).toBeUndefined()
      expect(inCatalog).toBe(false)
    }
  })

  it('Inter 写上名字就能排版', async () => {
    const doc = await layoutSource(
      `<layer width="320" height="80" font-family="Inter"><p style="font-size:32px; white-space:nowrap">Hello</p></layer>`,
      process.cwd(),
    )
    const text = doc.root.children.find((node) => node.kind === 'text')
    expect(text && text.kind === 'text' ? text.textLayout.contentWidth : 0).toBeGreaterThan(40)
    expect(doc.issues.filter((issue) => issue.level === 'error')).toEqual([])
  })
})
