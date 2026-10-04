import { readFileSync, writeFileSync } from 'node:fs'
import {
  JSX_EFFECT_NAMES,
  JSX_GRADE_NAMES,
  JSX_OVERLAY_NAMES,
  effectCheatLine,
  jsxFieldBlock,
  ownershipTableBody,
} from '../src/schema.js'

function fill(path: string, marker: string, body: string, kind: 'html' | 'line' = 'html') {
  const begin = kind === 'html' ? `<!-- ${marker}:begin -->` : `// ${marker}:begin`
  const end = kind === 'html' ? `<!-- ${marker}:end -->` : `// ${marker}:end`
  const text = readFileSync(path, 'utf8')
  const start = text.indexOf(begin)
  const stop = text.indexOf(end)
  if (start < 0 || stop < 0 || stop < start) {
    throw new Error(`${path} 缺少 ${begin} / ${end}`)
  }
  const next = `${text.slice(0, start + begin.length)}\n${body}\n${text.slice(stop)}`
  writeFileSync(path, next)
}

fill('SPEC.md', 'attrs:ownership', ownershipTableBody())
fill('docs/CHEATSHEET.md', 'attrs:effects', effectCheatLine())
for (const file of ['generate/react/jsx.d.ts', 'src/jsx-intrinsics.ts']) {
  fill(file, 'jsx-effects', jsxFieldBlock(JSX_EFFECT_NAMES), 'line')
  fill(file, 'jsx-overlay', jsxFieldBlock(JSX_OVERLAY_NAMES), 'line')
  fill(file, 'jsx-grade', jsxFieldBlock(JSX_GRADE_NAMES), 'line')
}
