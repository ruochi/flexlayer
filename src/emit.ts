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
        `draw 引用了外部变量 ${listed}，写回的 <draw> 读不到`,
        'draw 里只用 ctx 和 el。颜色和尺寸写进 el.attr，或继续用 .tsx 渲染',
      ),
    )
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

function emitNode(node: FvgNode, indent: string, path: string, issues: Issue[]): string {
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
    .join('')
  const childIndent = `${indent}  `
  const parts: string[] = []
  let elementIndex = 0
  for (const child of node.children) {
    if (typeof child === 'string') {
      if (child.length > 0) parts.push(`${childIndent}${escapeText(child)}\n`)
      continue
    }
    parts.push(emitNode(child, childIndent, `${path}/${child.tag}[${elementIndex}]`, issues))
    elementIndex++
  }
  if (node.draw) parts.push(emitDraw(node.draw, path, childIndent, issues))
  if (parts.length === 0) return `${indent}<${node.tag}${attrs} />\n`
  return `${indent}<${node.tag}${attrs}>\n${parts.join('')}${indent}</${node.tag}>\n`
}

/** 把节点树写回 `.layer` 文本。闭包里的 draw 会留下 warn，仍然写出函数体。 */
export function emitLayer(node: FvgNode): EmitResult {
  const issues: Issue[] = []
  const source = emitNode(node, '', 'layer', issues).replace(/\n$/, '')
  return { source: `${source}\n`, issues }
}
