import { canonicalTag } from './tags.js'
import type { DrawFn } from './types.js'

/** JSX 自动运行时记下来的位置。行和列都从 1 开始。 */
export type SourceLoc = {
  file: string
  line: number
  column: number
}

export type FvgNode = {
  tag: string
  attrs: Record<string, string>
  children: FvgChild[]
  draw?: DrawFn
  /** 结构化数据。不进 `attrs`，`draw` 里从 `el.data` 读。 */
  data?: unknown
  /** h() 收到对象或数组、却没有放进 data 的属性名。 */
  badAttrs?: string[]
  /** `.layer` 里 `data` 不是合法 JSON 时的原文。 */
  dataError?: string
  /** 源码里的标签名。仅当和规范小写不同时记下，用来报 non-canonical。 */
  writtenTag?: string
  /** `.tsx` 里这个标签所在的位置。`.layer` 解析出来的节点没有。 */
  loc?: SourceLoc
  /** `<draw>` 正文所在的位置。运行出错时报告用它，而不是父标签的位置。 */
  drawLoc?: SourceLoc
}

export type FvgChild = string | FvgNode

const VOID_TAGS = new Set(['br', 'font', 'img', 'image', 'sphere', 'box', 'cylinder', 'torus', 'tube', 'extrude', 'model'])

const CLOSE_TAG_RE = /<\s*\/\s*([a-zA-Z][\w-]*)\s*>/y
const OPEN_TAG_RE = /<\s*([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/)?\s*>/y
const ATTR_RE = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  times: '\u00D7',
  divide: '\u00F7',
  middot: '\u00B7',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  deg: '\u00B0',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

function parseAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR_RE.exec(text)) !== null) {
    attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return attrs
}

function takeData(node: FvgNode) {
  if (!Object.prototype.hasOwnProperty.call(node.attrs, 'data')) return
  const raw = node.attrs.data ?? ''
  delete node.attrs.data
  try {
    node.data = JSON.parse(raw)
  } catch {
    node.dataError = raw
  }
}

function nodeFor(raw: string, attrs: Record<string, string>, children: FvgChild[]): FvgNode {
  const tag = canonicalTag(raw)
  const node: FvgNode = { tag, attrs, children }
  if (raw !== tag) node.writtenTag = raw
  takeData(node)
  return node
}

function lineColAt(lineStarts: number[], index: number): { line: number; column: number } {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid]! <= index) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, column: index - lineStarts[lo]! + 1 }
}

/** 解析 Flex Layer 标记。已知标签归一成小写；不认识的标签保持原样。 */
export function parseFvg(source: string): FvgNode[] {
  const src = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[\s\S]*?\?>/g, '')
  const lineStarts = [0]
  for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 10) lineStarts.push(i + 1)
  }
  const root: FvgNode = { tag: '#root', attrs: {}, children: [] }
  const stack: FvgNode[] = [root]
  let pos = 0

  const pushText = (text: string) => {
    if (text) stack[stack.length - 1].children.push(decodeEntities(text))
  }

  while (pos < src.length) {
    const lt = src.indexOf('<', pos)
    if (lt === -1) {
      pushText(src.slice(pos))
      break
    }
    pushText(src.slice(pos, lt))

    CLOSE_TAG_RE.lastIndex = lt
    const close = CLOSE_TAG_RE.exec(src)
    if (close) {
      const idx = findOpen(stack, canonicalTag(close[1]))
      if (idx > 0) stack.length = idx
      pos = lt + close[0].length
      continue
    }

    OPEN_TAG_RE.lastIndex = lt
    const open = OPEN_TAG_RE.exec(src)
    if (!open) {
      pushText('<')
      pos = lt + 1
      continue
    }
    const raw = open[1]
    const tag = canonicalTag(raw)
    const attrs = parseAttrs(open[2] ?? '')
    // <draw> 正文是原始 JS，里面的 < 不要当标签解析
    if (tag === 'draw' && !open[3]) {
      const bodyStart = lt + open[0].length
      const closeMatch = /<\/draw\s*>/i.exec(src.slice(bodyStart))
      const body = closeMatch ? src.slice(bodyStart, bodyStart + closeMatch.index) : src.slice(bodyStart)
      const node = nodeFor(raw, attrs, body ? [body] : [])
      node.loc = { file: '', ...lineColAt(lineStarts, lt) }
      stack[stack.length - 1].children.push(node)
      pos = closeMatch ? bodyStart + closeMatch.index + closeMatch[0].length : src.length
      continue
    }
    const node = nodeFor(raw, attrs, [])
    stack[stack.length - 1].children.push(node)
    if (!open[3] && !VOID_TAGS.has(tag)) stack.push(node)
    pos = lt + open[0].length
  }

  return root.children.filter((c): c is FvgNode => typeof c !== 'string')
}

function findOpen(stack: FvgNode[], tag: string): number {
  for (let i = stack.length - 1; i > 0; i--) {
    if (stack[i].tag === tag) return i
  }
  return -1
}
