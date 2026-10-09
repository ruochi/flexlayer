/**
 * Material Symbols Outlined。图标名换成一个码位，字重走目录里的 Symbols。
 * 不把图标名当连字排进文字：排版按码位拆，连字会被拆开。
 */

import { ICON_FONT_FAMILY } from './font-catalog.js'
import { ICON_CODEPOINTS_TEXT } from './icon-codepoints.js'
import type { FvgNode } from './parse.js'
import { parseFontWeight, parsePx, parseStyle } from './style.js'
import type { TextRunStyle } from './types.js'

export { ICON_FONT_FAMILY }

const codepoints = new Map<string, number>()
for (const line of ICON_CODEPOINTS_TEXT.split('\n')) {
  const i = line.indexOf(' ')
  if (i <= 0) continue
  codepoints.set(line.slice(0, i), Number.parseInt(line.slice(i + 1), 16))
}

export type IconIssue = {
  level: 'warn'
  code: 'invalid-attr' | 'invalid-child' | 'missing-icon'
  message: string
  hint: string
}

export function iconCodepoint(name: string): number | undefined {
  return codepoints.get(name.trim())
}

export function treeHasIcon(node: FvgNode): boolean {
  if (node.tag.toLowerCase() === 'icon') return true
  for (const child of node.children) {
    if (typeof child !== 'string' && treeHasIcon(child)) return true
  }
  return false
}

function iconName(node: FvgNode): string {
  return node.attrs.name?.trim() ?? ''
}

/** 字号、字重、颜色。`weight` / `size` 没写就用周围的文字；style 里写了同名项时 style 优先。 */
export function readIcon(node: FvgNode, inherited: TextRunStyle): { text: string; name: string; style: TextRunStyle; issues: IconIssue[] } {
  const issues: IconIssue[] = []
  const styleMap = parseStyle(node.attrs.style)
  const name = iconName(node)

  let fontWeight = inherited.fontWeight
  const weightFromStyle = styleMap['font-weight']
  if (weightFromStyle) {
    const parsed = parseFontWeight(weightFromStyle)
    if (parsed == null) {
      issues.push({
        level: 'warn',
        code: 'invalid-attr',
        message: `无法解析 font-weight: ${weightFromStyle}`,
        hint: '写成 400、700，或 normal、bold',
      })
    } else fontWeight = parsed
  } else if (node.attrs.weight != null && node.attrs.weight !== '') {
    const parsed = parseFontWeight(node.attrs.weight)
    if (parsed == null) {
      issues.push({
        level: 'warn',
        code: 'invalid-attr',
        message: `无法解析 weight: ${node.attrs.weight}`,
        hint: '写成 100 到 700，例如 weight="400"',
      })
    } else fontWeight = parsed
  }

  let fontSize = inherited.fontSize
  const sizeFromStyle = styleMap['font-size']
  if (sizeFromStyle) {
    const parsed = parsePx(sizeFromStyle)
    if (parsed == null) {
      issues.push({
        level: 'warn',
        code: 'invalid-attr',
        message: `无法解析 font-size: ${sizeFromStyle}`,
        hint: '写成 48 或 48px',
      })
    } else fontSize = parsed
  } else if (node.attrs.size != null && node.attrs.size !== '') {
    const parsed = parsePx(node.attrs.size)
    if (parsed == null) {
      issues.push({
        level: 'warn',
        code: 'invalid-attr',
        message: `无法解析 size: ${node.attrs.size}`,
        hint: '写成像素，例如 size="48"',
      })
    } else fontSize = parsed
  }

  if (node.children.some((child) => typeof child !== 'string')) {
    issues.push({
      level: 'warn',
      code: 'invalid-child',
      message: 'icon 不收子元素',
      hint: '图标名写在 name 上，例如 <icon name="home" />',
    })
  }

  let text = ''
  if (!name) {
    issues.push({
      level: 'warn',
      code: 'invalid-attr',
      message: 'icon 缺少 name',
      hint: '写成 <icon name="home" />。名字是 Material Symbols 的图标名，例如 home、search、arrow_back',
    })
  } else {
    const cp = codepoints.get(name)
    if (cp == null) {
      issues.push({
        level: 'warn',
        code: 'missing-icon',
        message: `没有图标 ${name}`,
        hint: '用 Material Symbols 的图标名，例如 home、search、arrow_back',
      })
    } else text = String.fromCodePoint(cp)
  }

  const color = styleMap.color?.trim() || inherited.color
  return {
    text,
    name,
    style: {
      fontFamily: ICON_FONT_FAMILY,
      fontSize,
      fontWeight,
      color,
      letterSpacing: 0,
    },
    issues,
  }
}

/** 单独成块时交给文字排版的 style。后面的声明盖住用户写的字体项，字重和字号已经在 readIcon 里定过。 */
export function iconBoxStyle(node: FvgNode, icon: { style: TextRunStyle }): string {
  const user = node.attrs.style?.trim().replace(/;+\s*$/, '')
  const decls = [
    `font-family:${ICON_FONT_FAMILY}`,
    `font-weight:${icon.style.fontWeight}`,
    `font-size:${icon.style.fontSize}px`,
    `color:${icon.style.color}`,
    'line-height:1',
    'white-space:nowrap',
    'letter-spacing:0',
  ]
  return [user, decls.join(';')].filter((part) => part).join(';')
}
