import { formatCamera } from './camera.js'
import type { LayerNode } from './parse.js'
import type { Issue } from './types.js'

export type EmitResult = {
  source: string
  issues: Issue[]
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

function noteLegacyDraw(node: LayerNode, path: string, issues: Issue[]) {
  if (!node.legacyDraw) return
  issues.push({
    level: 'warn',
    code: 'emit-draw',
    path,
    message: '不再写出 draw',
    hint: '改成 <canvas> 和 <script>。闭包留在 .tsx 里渲染',
  })
}

function jsonReady(value: unknown, seen: WeakSet<object>): boolean {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  const proto = Object.getPrototypeOf(value)
  const ok =
    Array.isArray(value)
      ? value.every((item) => jsonReady(item, seen))
      : (proto === Object.prototype || proto === null) &&
        Object.values(value as Record<string, unknown>).every((item) => jsonReady(item, seen))
  seen.delete(value)
  return ok
}

function emitData(node: LayerNode, path: string, issues: Issue[]): string {
  if (node.data === undefined) return ''
  if (!jsonReady(node.data, new WeakSet())) {
    issues.push({
      level: 'warn',
      code: 'emit-data',
      path,
      message: 'data 不能写成 JSON，没有写回',
      hint: 'data 只用对象、数组、字符串和数字。函数、Map 和循环引用写不回去',
    })
    return ''
  }
  const json = JSON.stringify(node.data)
  if (json == null) {
    issues.push({
      level: 'warn',
      code: 'emit-data',
      path,
      message: 'data 不能写成 JSON，没有写回',
      hint: 'data 只用对象、数组、字符串和数字。函数、Map 和循环引用写不回去',
    })
    return ''
  }
  const quoted = json.replace(/&/g, '&amp;').replace(/'/g, '&apos;')
  return ` data='${quoted}'`
}

function emitCamera(node: LayerNode): string {
  if (node.camera == null || node.attrs.camera != null) return ''
  const text = formatCamera(node.camera)
  if (text == null) return ''
  return ` camera="${escapeAttr(text)}"`
}

function attrText(node: LayerNode, path: string, issues: Issue[]): string {
  return (
    Object.entries(node.attrs)
      .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
      .join('') +
    emitCamera(node) +
    emitData(node, path, issues)
  )
}

/** 有文本子节点时按源码顺序拼回去，不在标签交界处另加空格或换行。 */
function emitInline(node: LayerNode, path: string, issues: Issue[]): string {
  noteLegacyDraw(node, path, issues)
  const attrs = attrText(node, path, issues)
  let elementIndex = 0
  let inner = ''
  for (const child of node.children) {
    if (typeof child === 'string') {
      inner += escapeText(child)
      continue
    }
    inner += emitInline(child, `${path}/${child.tag}[${elementIndex}]`, issues)
    elementIndex++
  }
  if (inner.length === 0) return `<${node.tag}${attrs} />`
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`
}

function emitNode(node: LayerNode, indent: string, path: string, issues: Issue[]): string {
  const attrs = attrText(node, path, issues)
  noteLegacyDraw(node, path, issues)
  if (node.tag === 'script' && node.scriptFns?.length) {
    issues.push({
      level: 'warn',
      code: 'emit-script',
      path,
      message: 'script 闭包写不回 .layer',
      hint: '把脚本写成 <script> 里的文本，或继续用 .tsx 渲染',
    })
  }
  const hasText = node.children.some((child) => typeof child === 'string')
  if (hasText && node.tag !== 'script' && node.tag !== 'draw') return `${indent}${emitInline(node, path, issues)}\n`
  const childIndent = `${indent}  `
  const parts: string[] = []
  let elementIndex = 0
  let textRun = ''
  const rawScript = node.tag === 'script' || node.tag === 'draw'
  const flushText = () => {
    if (textRun.length === 0) return
    const text = rawScript ? textRun.replace(/<\//g, '<\\/') : escapeText(textRun)
    parts.push(`${childIndent}${text}\n`)
    textRun = ''
  }
  for (const child of node.children) {
    if (typeof child === 'string') {
      textRun += child
      continue
    }
    flushText()
    parts.push(emitNode(child, childIndent, `${path}/${child.tag}[${elementIndex}]`, issues))
    elementIndex++
  }
  flushText()
  if (parts.length === 0) return `${indent}<${node.tag}${attrs} />\n`
  return `${indent}<${node.tag}${attrs}>\n${parts.join('')}${indent}</${node.tag}>\n`
}

/** 把节点树写回 `.layer` 文本。闭包里的 script 会留下 warn，不把函数体写回去。 */
export function emitLayer(node: LayerNode): EmitResult {
  const issues: Issue[] = []
  const source = emitNode(node, '', 'layer', issues).replace(/\n$/, '')
  return { source: `${source}\n`, issues }
}
