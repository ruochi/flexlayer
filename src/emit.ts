import { formatCamera } from './camera.js'
import type { FvgNode } from './parse.js'
import { readDrawFunction } from './syntax.js'
import type { DrawFn, Issue } from './types.js'

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

function drawIssue(path: string, message: string, hint: string): Issue {
  return { level: 'warn', code: 'emit-draw', path, message, hint }
}

function emitDraw(fn: DrawFn, path: string, indent: string, issues: Issue[]): string {
  const extracted = readDrawFunction(Function.prototype.toString.call(fn))
  if (!extracted) {
    issues.push(drawIssue(path, '读不出 draw 函数的源码，没有写回 <draw>', '把绘制写进只使用 ctx 和 el 的函数，或手写 <draw>'))
    return ''
  }
  const free = extracted.free
  if (free.length > 0) {
    const listed = free.slice(0, 4).join('、')
    issues.push(
      drawIssue(
        path,
        `draw 引用了外部变量 ${listed}，没有写回 <draw>`,
        'draw 里只用 ctx 和 el。颜色和尺寸写进 el.attr，或继续用 .tsx 渲染',
      ),
    )
    return ''
  }
  const body = extracted.body.replace(/<\//g, '<\\/').replace(/^\n/, '').replace(/\s+$/, '')
  if (!body.trim()) {
    issues.push(drawIssue(path, 'draw 函数体是空的', '写入 canvas 绘制代码，例如 ctx.fillRect(0, 0, el.w, el.h)'))
    return ''
  }
  const pad = `${indent}  `
  const lines = body.split('\n').map((line) => (line.trim() ? `${pad}${line.trimEnd()}` : ''))
  return `${indent}<draw>\n${lines.join('\n')}\n${indent}</draw>\n`
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

function emitData(node: FvgNode, path: string, issues: Issue[]): string {
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

function emitCamera(node: FvgNode): string {
  if (node.camera == null || node.attrs.camera != null) return ''
  const text = formatCamera(node.camera)
  if (text == null) return ''
  return ` camera="${escapeAttr(text)}"`
}

function attrText(node: FvgNode, path: string, issues: Issue[]): string {
  return (
    Object.entries(node.attrs)
      .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
      .join('') +
    emitCamera(node) +
    emitData(node, path, issues)
  )
}

/** 有文本子节点时按源码顺序拼回去，不在标签交界处另加空格或换行。 */
function emitInline(node: FvgNode, path: string, issues: Issue[]): string {
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

function emitNode(node: FvgNode, indent: string, path: string, issues: Issue[]): string {
  const attrs = attrText(node, path, issues)
  const hasText = node.children.some((child) => typeof child === 'string')
  if (hasText && node.tag !== 'draw' && !node.draw) return `${indent}${emitInline(node, path, issues)}\n`
  const childIndent = `${indent}  `
  const parts: string[] = []
  let elementIndex = 0
  let textRun = ''
  const rawDraw = node.tag === 'draw'
  const flushText = () => {
    if (textRun.length === 0) return
    const text = rawDraw ? textRun.replace(/<\//g, '<\\/') : escapeText(textRun)
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
  if (node.draw) parts.push(emitDraw(node.draw, path, childIndent, issues))
  if (parts.length === 0) return `${indent}<${node.tag}${attrs} />\n`
  return `${indent}<${node.tag}${attrs}>\n${parts.join('')}${indent}</${node.tag}>\n`
}

/** 把节点树写回 `.layer` 文本。闭包里的 draw 会留下 warn，不把读不到的函数体写回去。 */
export function emitLayer(node: FvgNode): EmitResult {
  const issues: Issue[] = []
  const source = emitNode(node, '', 'layer', issues).replace(/\n$/, '')
  return { source: `${source}\n`, issues }
}
