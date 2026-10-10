/**
 * Material Symbols Outlined。
 * 写法与网页一致：`<span class="material-symbols-outlined">home</span>`。
 * 排版按码位拆开，连字留不住，所以这里把图标名换成一个码位再量、再画。
 */

import { ICON_FONT_FAMILY } from './font-catalog.js'
import { builtinFont } from './fonts.js'
import { ICON_CODEPOINTS_TEXT } from './icon-codepoints.js'
import type { TextRunStyle } from './types.js'

export { ICON_FONT_FAMILY }

const codepoints = new Map<string, number>()
for (const line of ICON_CODEPOINTS_TEXT.split('\n')) {
  const i = line.indexOf(' ')
  if (i <= 0) continue
  codepoints.set(line.slice(0, i), Number.parseInt(line.slice(i + 1), 16))
}

const TOKEN = /[a-z0-9_]+/g

export type SymbolsNote = {
  level: 'warn'
  code: 'missing-icon' | 'invalid-attr'
  message: string
  hint: string
}

export function iconCodepoint(name: string): number | undefined {
  return codepoints.get(name.trim())
}

export function isSymbolsFamily(family: string): boolean {
  const name = family.trim().replace(/^['"]|['"]$/g, '')
  if (!name) return false
  return builtinFont(name)?.cssFamily === ICON_FONT_FAMILY
}

/** `.layer` 写 `class`，JSX 里也可以写 `className`。rounded、sharp 仍用 outlined。 */
export function classAttr(attrs: Record<string, string | undefined>): string | undefined {
  return attrs.class || attrs.className
}

export function symbolsClassOf(className: string | undefined): 'outlined' | 'rounded' | 'sharp' | null {
  if (!className) return null
  const names = className.trim().toLowerCase().split(/\s+/)
  if (names.includes('material-symbols-rounded')) return 'rounded'
  if (names.includes('material-symbols-sharp')) return 'sharp'
  if (names.includes('material-symbols-outlined')) return 'outlined'
  return null
}

export function symbolsClassNotes(className: string | undefined): SymbolsNote[] {
  const kind = symbolsClassOf(className)
  if (kind !== 'rounded' && kind !== 'sharp') return []
  return [
    {
      level: 'warn',
      code: 'invalid-attr',
      message: `目前只有 material-symbols-outlined`,
      hint: '写成 class="material-symbols-outlined"。字重写 style="font-weight:400"',
    },
  ]
}

/** 类名把字体换成 Symbols，并去掉斜体和字距。style 里已经写了字体或字距的，不盖掉。 */
export function applySymbolsClass(
  style: TextRunStyle,
  className: string | undefined,
  declared: { family: boolean; spacing: boolean },
): TextRunStyle {
  if (!symbolsClassOf(className)) return style
  const next: TextRunStyle = { ...style, fontStyle: 'normal' }
  if (!declared.family) next.fontFamily = ICON_FONT_FAMILY
  if (!declared.spacing) next.letterSpacing = 0
  return next
}

/** 图标名换成一个码位。对不上的名字留在 missing 里。 */
export function rewriteIconLigatures(text: string, family: string): { text: string; missing: string[] } {
  if (!isSymbolsFamily(family)) return { text, missing: [] }
  const missing: string[] = []
  const next = text.replace(TOKEN, (token) => {
    const cp = codepoints.get(token)
    if (cp == null) {
      missing.push(token)
      return token
    }
    return String.fromCodePoint(cp)
  })
  return { text: next, missing }
}
