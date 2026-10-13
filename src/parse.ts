/** JSX 自动运行时记下来的位置。行和列都从 1 开始。 */
export type SourceLoc = {
  file: string
  line: number
  column: number
}

export type LayerNode = {
  tag: string
  attrs: Record<string, string>
  children: LayerChild[]
  /** 结构化数据。不进 `attrs`。 */
  data?: unknown
  /** `camera` 写成对象时挂在这里，不进 `attrs`。字符串仍在 `attrs.camera`。 */
  camera?: unknown
  /** h() 收到对象或数组、却没有放进 data 的属性名。 */
  badAttrs?: string[]
  /** `.layer` 里 `data` 不是合法 JSON 时的原文。 */
  dataError?: string
  /** `.tsx` 里这个标签所在的位置。`.layer` 解析出来的节点没有。 */
  loc?: SourceLoc
  /** `<script>` 的闭包。文本子节点仍在 `children` 里。 */
  scriptFns?: Array<() => void>
  /** 程序侧还写了 `draw`。排版时报错，不再执行。 */
  legacyDraw?: boolean
}

export type LayerChild = string | LayerNode

const VOID_TAGS = new Set(['br', 'font', 'img', 'image', 'sphere', 'box', 'cylinder', 'torus', 'tube', 'extrude', 'model', 'ground'])

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

function takeData(node: LayerNode) {
  if (!Object.prototype.hasOwnProperty.call(node.attrs, 'data')) return
  const raw = node.attrs.data ?? ''
  delete node.attrs.data
  try {
    node.data = JSON.parse(raw)
  } catch {
    node.dataError = raw
  }
}

function nodeFor(raw: string, attrs: Record<string, string>, children: LayerChild[]): LayerNode {
  const node: LayerNode = { tag: raw, attrs, children }
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

/** 解析 Flex Layer 标记。标签保持源码里的大小写；不认识的标签也保持原样。 */
export function parseLayer(source: string): LayerNode[] {
  const src = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[\s\S]*?\?>/g, '')
  const lineStarts = [0]
  for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 10) lineStarts.push(i + 1)
  }
  const root: LayerNode = { tag: '#root', attrs: {}, children: [] }
  const stack: LayerNode[] = [root]
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
      const idx = findOpen(stack, close[1])
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
    const tag = raw
    const attrs = parseAttrs(open[2] ?? '')
    // <script> 和已删除的 <draw> 正文是原始 JS，里面的 < 不要当标签解析
    if ((tag === 'script' || tag === 'draw') && !open[3]) {
      const bodyStart = lt + open[0].length
      const closeMatch = new RegExp(`</${tag}\\s*>`, 'i').exec(src.slice(bodyStart))
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

  return root.children.filter((c): c is LayerNode => typeof c !== 'string')
}

function findOpen(stack: LayerNode[], tag: string): number {
  for (let i = stack.length - 1; i > 0; i--) {
    if (stack[i].tag === tag) return i
  }
  return -1
}
