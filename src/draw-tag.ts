import type { FvgChild, FvgNode, SourceLoc } from './parse.js'
import { formatSourceLoc } from './source-loc.js'
import { readDrawFunction } from './syntax.js'
import type { DrawFn, Issue, LayoutNode } from './types.js'

export const DRAW_TAG = 'draw'

/** 把 `<draw>` 正文编译成与程序侧 `draw={(ctx, el) => …}` 相同的函数。 */
export function compileDrawBody(body: string): DrawFn {
  // 仅注入 ctx、el；与 SPEC §10 一致
  return new Function('ctx', 'el', `"use strict";\n${body}`) as DrawFn
}

function drawBodyText(node: FvgNode): string {
  return node.children.map((c) => (typeof c === 'string' ? c : '')).join('')
}

/**
 * 把树上的 `<draw>` 子节点编译进父节点的 `draw`，并从 children 里摘掉。
 * 程序侧已挂的 `draw` 回调优先；多个 `<draw>` 取最后一个并警告。
 */
function withSource(issue: Issue, loc?: SourceLoc): Issue {
  if (!loc) return issue
  return { ...issue, source: formatSourceLoc(loc) }
}

export function attachDrawTags(node: FvgNode, issues: Issue[], path: string): void {
  const kept: FvgChild[] = []
  const bodies: Array<{ body: string; path: string; loc?: SourceLoc }> = []

  let elementIndex = 0
  for (const ch of node.children) {
    if (typeof ch === 'string') {
      kept.push(ch)
      continue
    }
    const childPath = `${path}/${ch.tag}[${elementIndex}]`
    elementIndex += 1
    if (ch.tag === DRAW_TAG) {
      bodies.push({ body: drawBodyText(ch), path: childPath, loc: ch.loc })
      continue
    }
    attachDrawTags(ch, issues, childPath)
    kept.push(ch)
  }
  node.children = kept

  if (bodies.length === 0) return

  if (node.draw) {
    issues.push({
      level: 'warn',
      code: 'invalid-child',
      path,
      message: '已有 draw 回调，忽略 <draw> 标签',
      hint: '程序侧用 draw 属性，.layer 文件用 <draw> 标签，不要同时写',
    })
    return
  }

  if (bodies.length > 1) {
    issues.push({
      level: 'warn',
      code: 'invalid-child',
      path,
      message: '同一个元素只能有一个 <draw>',
      hint: '把代码合并进一个 <draw>…</draw>',
    })
  }

  const last = bodies[bodies.length - 1]!
  if (!last.body.trim()) {
    issues.push(
      withSource(
        {
          level: 'warn',
          code: 'invalid-draw',
          path: last.path,
          message: '<draw> 内容为空',
          hint: '写入 canvas 绘制代码，例如 ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, el.w, el.h)',
        },
        last.loc,
      ),
    )
    return
  }

  const free = readDrawFunction(`(ctx, el) => {\n${last.body}\n}`)?.free ?? []
  if (free.length > 0) {
    const listed = free.slice(0, 4).join('、')
    issues.push(
      withSource(
        {
          level: 'error',
          code: 'invalid-draw',
          path: last.path,
          message: `<draw> 用了外部变量 ${listed}`,
          hint: '可用变量只有 ctx 和 el。颜色和尺寸从 el.attr 读',
        },
        last.loc,
      ),
    )
    return
  }

  try {
    node.draw = compileDrawBody(last.body)
    node.drawLoc = last.loc
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    issues.push(
      withSource(
        {
          level: 'error',
          code: 'invalid-draw',
          path: last.path,
          message: `<draw> 语法错误: ${detail}`,
          hint: '检查 JavaScript 语法；可用变量是 ctx 与 el',
        },
        last.loc,
      ),
    )
  }
}

/** 绘制时 `<draw>` 抛错。排版不执行回调，避免 check 和渲染各跑一遍。 */
export function invalidDrawIssue(node: LayoutNode, err: unknown): Issue {
  const detail = err instanceof Error ? err.message : String(err)
  return {
    level: 'error',
    code: 'invalid-draw',
    path: node.path,
    message: `<draw> 运行出错: ${detail}`,
    hint: '检查 <draw> 里的代码。其余内容仍会绘制',
    ...(node.source ? { source: node.source } : {}),
  }
}
