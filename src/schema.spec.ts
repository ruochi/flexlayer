import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ATTRS,
  ATTR_ORDER,
  EFFECT_ATTRS,
  HTML_STYLE_ATTRS,
  JSX_EFFECT_NAMES,
  JSX_GRADE_NAMES,
  JSX_OVERLAY_NAMES,
  effectCheatLine,
  issueFor,
  jsxFieldBlock,
  ownershipTableBody,
} from './schema.js'

function between(text: string, marker: string, kind: 'html' | 'line' = 'html'): string {
  const begin = kind === 'html' ? `<!-- ${marker}:begin -->` : `// ${marker}:begin`
  const end = kind === 'html' ? `<!-- ${marker}:end -->` : `// ${marker}:end`
  const start = text.indexOf(begin)
  const stop = text.indexOf(end)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(stop).toBeGreaterThan(start)
  return text.slice(start + begin.length, stop).replace(/^\n/, '').replace(/\s+$/, '')
}

describe('属性注册表', () => {
  it('HTML 上应进 style 的属性与原先的名单一致', () => {
    expect(HTML_STYLE_ATTRS).toEqual([
      'width',
      'height',
      'opacity',
      'rotate',
      'rotateX',
      'rotateY',
      'z',
      'scale',
      'origin',
      'background',
      'padding',
      'font-size',
      'color',
      'flex',
      'flex-grow',
      'flex-shrink',
      'gap',
      'border',
      'border-radius',
      'max-width',
      'align-items',
      'align-content',
      'justify-content',
      'flex-wrap',
      'row-gap',
      'column-gap',
      'writing-mode',
      'object-fit',
      'object-position',
      'shadow',
      'glow',
      'inner-shadow',
      'inner-glow',
      'ink-stroke',
      'blur',
      'backdrop-blur',
      'glass',
      'noise',
      'filter',
      'blend',
    ])
  })

  it('SPEC 归属表和速查效果行由注册表生成', () => {
    const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8')
    const cheat = readFileSync(new URL('../docs/CHEATSHEET.md', import.meta.url), 'utf8')
    expect(between(spec, 'attrs:ownership')).toBe(ownershipTableBody())
    expect(between(cheat, 'attrs:effects')).toBe(effectCheatLine())
  })

  it('序列化顺序和 JSX 类型覆盖全部效果名', () => {
    for (const name of EFFECT_ATTRS) {
      expect(ATTR_ORDER).toContain(name)
    }
    for (const file of ['../src/jsx-intrinsics.ts']) {
      const jsx = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(between(jsx, 'jsx-effects', 'line')).toBe(jsxFieldBlock(JSX_EFFECT_NAMES))
      expect(between(jsx, 'jsx-overlay', 'line')).toBe(jsxFieldBlock(JSX_OVERLAY_NAMES))
      expect(between(jsx, 'jsx-grade', 'line')).toBe(jsxFieldBlock(JSX_GRADE_NAMES))
    }
  })

  it('效果属性都有语法、示例和问题码', () => {
    for (const attr of ATTRS.filter((item) => item.effect)) {
      expect(attr.syntax, attr.name).toBeTruthy()
      expect(attr.example, attr.name).toBeTruthy()
      expect(issueFor(attr), attr.name).toBe('invalid-attr')
    }
  })
})
