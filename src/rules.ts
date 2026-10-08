import { filterIsLayerOnly, listFilters } from './filter.js'
import type { FvgChild, FvgNode } from './parse.js'
import { ATTRS, ATTR_ORDER, HTML_STYLE_ATTRS, attrByName, issueFor } from './schema.js'
import { parseNumber, parseStyle, readOrigin } from './style.js'
import { MATH_TAGS } from './math/rules.js'
import { isInlineTag, isTextBoxTag } from './text.js'
import type { Issue, IssueLevel } from './types.js'
import { isImageTag, isLineTag, isMeshTag, isShapeTag } from './tags.js'

const BLOCK_IN_TEXT = new Set(['h1', 'h2', 'h3', 'p', 'div'])

const LAYER_ONLY_ATTR_NAMES = ATTRS.filter((attr) => attr.layerOnlyAttr).map((attr) => attr.name)
const GRAPHIC_ATTRS = ATTRS.filter((attr) => attr.docGroup === 'graphic').map((attr) => attr.name)
const FORBID_IN_STYLE = new Set(ATTRS.filter((attr) => attr.forbidInStyle).map((attr) => attr.name))
const FORBID_IN_HTML_STYLE = new Set(ATTRS.filter((attr) => attr.forbidInHtmlStyle).map((attr) => attr.name))

/** 后注册的滤镜。grade / grade-mask 已经在属性表里，这里不再报第二次。 */
function registeredLayerOnlyNames(): string[] {
  const known = new Set(LAYER_ONLY_ATTR_NAMES)
  const names: string[] = []
  for (const def of listFilters()) {
    if (!filterIsLayerOnly(def)) continue
    if (!known.has(def.name)) names.push(def.name)
    if (def.maskAttr && !known.has(def.maskAttr)) names.push(def.maskAttr)
  }
  return names
}

function flagged(level: IssueLevel, code: string, path: string, message: string, hint: string): Issue {
  return { level, code, path, message, hint }
}

function present(attrs: Record<string, string>, key: string): boolean {
  return attrs[key] != null && attrs[key] !== ''
}

export function hasTwoPoint(attrs: Record<string, string>): boolean {
  return ['x1', 'y1', 'x2', 'y2'].every((key) => present(attrs, key))
}

export function isDisplayFlex(style: string | undefined): boolean {
  const display = parseStyle(style).display?.trim().toLowerCase()
  return display === 'flex' || display === 'inline-flex'
}

const FLOW_TEXT_KEYS = [
  'font-size',
  'font-weight',
  'font-family',
  'color',
  'letter-spacing',
  'line-height',
  'text-align',
  'writing-mode',
  'white-space',
  'text-wrap',
  'max-width',
  'max-height',
] as const

/** 没写 display:flex 的 div，只要放了行内标签容不下的子元素，就按块级容器排。 */
export function divHasFlowBreak(node: FvgNode): boolean {
  if (node.tag.toLowerCase() !== 'div') return false
  if (isDisplayFlex(node.attrs.style)) return false
  return node.children.some((child) => typeof child !== 'string' && !isInlineTag(child.tag))
}

function inheritedTextStyle(style: string | undefined): string {
  const parsed = parseStyle(style)
  const parts: string[] = []
  for (const key of FLOW_TEXT_KEYS) {
    const value = parsed[key]
    if (value) parts.push(`${key}:${value}`)
  }
  return parts.join(';')
}

function blockFlowStyle(style: string | undefined): string {
  const parsed = parseStyle(style)
  const extra = ['display:flex', 'flex-direction:column']
  if (!parsed['align-items']) extra.push('align-items:stretch')
  const base = style?.trim().replace(/;+\s*$/, '')
  return [base, ...extra].filter((part) => part).join(';')
}

function anonymousTextBox(run: FvgChild[], style: string): FvgNode {
  const attrs: Record<string, string> = {}
  if (style) attrs.style = style
  return { tag: 'div', attrs, children: run }
}

function blockFlowChildren(node: FvgNode): FvgChild[] {
  const textStyle = inheritedTextStyle(node.attrs.style)
  const out: FvgChild[] = []
  let run: FvgChild[] = []
  const flush = () => {
    if (run.length === 0) return
    const blank = run.every((child) => typeof child === 'string' && child.trim() === '')
    if (!blank) out.push(anonymousTextBox(run, textStyle))
    run = []
  }
  for (const child of node.children) {
    if (typeof child !== 'string' && !isInlineTag(child.tag)) {
      flush()
      out.push(child)
      continue
    }
    run.push(child)
  }
  flush()
  return out
}

/** 文字盒子里直接放了 img 时，改成横向排布，文字和图片并排。 */
export function textBoxNeedsInlineRow(node: FvgNode): boolean {
  if (!isTextBoxTag(node.tag) || isDisplayFlex(node.attrs.style)) return false
  let image = false
  for (const child of node.children) {
    if (typeof child === 'string') continue
    const tag = child.tag.toLowerCase()
    if (isImageTag(tag)) image = true
    else if (!isInlineTag(tag)) return false
  }
  return image
}

export function asInlineRow(node: FvgNode): FvgNode {
  if (!textBoxNeedsInlineRow(node)) return node
  const textStyle = inheritedTextStyle(node.attrs.style)
  const children: FvgChild[] = []
  let run: FvgChild[] = []
  const flush = () => {
    if (run.length === 0) return
    const blank = run.every((child) => typeof child === 'string' && child.trim() === '')
    if (!blank) {
      const attrs: Record<string, string> = {}
      if (textStyle) attrs.style = textStyle
      children.push({ tag: 'span', attrs, children: run })
    }
    run = []
  }
  for (const child of node.children) {
    if (typeof child !== 'string' && isImageTag(child.tag)) {
      flush()
      children.push(child)
      continue
    }
    run.push(child)
  }
  flush()
  const parsed = parseStyle(node.attrs.style)
  const extra = ['display:flex', 'flex-direction:row']
  if (!parsed['align-items']) extra.push('align-items:center')
  const base = node.attrs.style?.trim().replace(/;+\s*$/, '')
  return {
    ...node,
    attrs: { ...node.attrs, style: [base, ...extra].filter((part) => part).join(';') },
    children,
  }
}

/**
 * 把含块级子元素的 div 收成竖排容器。
 * 等同于补上 display:flex、flex-direction:column，没写 align-items 时把文字块拉到这一列的宽度。
 * 只含文字和行内标签的 div 原样返回，仍是文字盒子。
 */
export function asBlockFlow(node: FvgNode): FvgNode {
  if (!divHasFlowBreak(node)) return node
  return {
    ...node,
    attrs: { ...node.attrs, style: blockFlowStyle(node.attrs.style) },
    children: blockFlowChildren(node),
  }
}

function styleHasFlex(style: string | undefined): boolean {
  if (!style) return false
  return /(?:^|;)\s*(?:flex-grow|flex-shrink|flex)\s*:/.test(style)
}

function hasStyle(attrs: Record<string, string>): boolean {
  return present(attrs, 'style') && attrs.style.trim() !== ''
}

/** 文字和图片都按 HTML：视觉属性进 style，位置写在外包的 layer 上。 */
export function isHtmlTag(tag: string): boolean {
  return isTextBoxTag(tag) || isImageTag(tag)
}

function usesAttributes(node: FvgNode): boolean {
  return (
    node.tag === 'layer' ||
    node.tag === 'symbol' ||
    node.tag === 'use' ||
    node.tag === 'g' ||
    isShapeTag(node.tag) ||
    isLineTag(node.tag) ||
    isMeshTag(node.tag) ||
    Boolean(node.draw)
  )
}

const LEGACY_CENTER_TAGS = new Set(['layer', 'use', 'rect', 'box', 'extrude'])

function fmtHint(n: number): string {
  const rounded = Math.round(n * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

function topLeftFromPoint(x: number, y: number, w: number, h: number, anchor: string): { x: number; y: number } | null {
  switch (anchor) {
    case 'top-left':
      return { x, y }
    case 'top':
      return { x: x - w / 2, y }
    case 'top-right':
      return { x: x - w, y }
    case 'left':
      return { x, y: y - h / 2 }
    case 'center':
      return { x: x - w / 2, y: y - h / 2 }
    case 'right':
      return { x: x - w, y: y - h / 2 }
    case 'bottom-left':
      return { x, y: y - h }
    case 'bottom':
      return { x: x - w / 2, y: y - h }
    case 'bottom-right':
      return { x: x - w, y: y - h }
    default:
      return null
  }
}

function legacyCenterHint(attrs: Record<string, string>): string {
  const cx = parseNumber(attrs.cx)
  const cy = parseNumber(attrs.cy)
  const w = parseNumber(attrs.width)
  const h = parseNumber(attrs.height)
  const anchor = (attrs.anchor ?? 'center').trim().toLowerCase()
  if (cx != null && cy != null && anchor === 'top-left') return `改成 x="${fmtHint(cx)}" y="${fmtHint(cy)}"`
  if (cx != null && cy != null && w != null && h != null && w > 0 && h > 0) {
    const tl = topLeftFromPoint(cx, cy, w, h, anchor)
    if (tl) return `改成 x="${fmtHint(tl.x)}" y="${fmtHint(tl.y)}"`
  }
  return '改成 x、y，表示左上角。原先的 cx、cy 是定位点，anchor 默认 center'
}

/** layer、use、rect、box、extrude 上的 cx、cy 已忽略。hint 给出等价的 x、y。 */
export function legacyCenterIssues(node: FvgNode, path: string): Issue[] {
  if (!LEGACY_CENTER_TAGS.has(node.tag)) return []
  if (!present(node.attrs, 'cx') && !present(node.attrs, 'cy')) return []
  return [
    flagged(
      'warn',
      'invalid-attr',
      path,
      'cx、cy 已不再使用，已忽略',
      legacyCenterHint(node.attrs),
    ),
  ]
}

const KNOWN_ATTRS = new Set<string>([...ATTR_ORDER, ...ATTRS.map((attr) => attr.name), 'style'])

/** 超过 2 的距离直接记成 3，调用方只关心是否落在阈值里。 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 2) return 3
  const m = a.length
  const n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let cur = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    let rowMin = cur[0]!
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
      if (cur[j]! < rowMin) rowMin = cur[j]!
    }
    if (rowMin > 2) return 3
    const swap = prev
    prev = cur
    cur = swap
  }
  return prev[n]! > 2 ? 3 : prev[n]!
}

/** 和某个已知属性编辑距离不超过 2 时，返回最近的名字。并列超过 3 个就不当成拼写。 */
export function suggestAttrs(raw: string): string[] {
  const name = raw.trim().toLowerCase()
  if (!name || KNOWN_ATTRS.has(raw)) return []
  let best = 3
  let hits: string[] = []
  for (const known of KNOWN_ATTRS) {
    const dist = editDistance(name, known)
    if (dist === 0) return [known]
    if (dist > 2) continue
    if (dist < best) {
      best = dist
      hits = [known]
    } else if (dist === best) hits.push(known)
  }
  if (best > 2 || hits.length === 0 || hits.length > 3) return []
  return hits
}

/** 拼写接近已知属性时报 warn。完全对不上的名字仍留给 draw。 */
export function typoAttrIssues(node: FvgNode, path: string): Issue[] {
  const out: Issue[] = []
  for (const key of Object.keys(node.attrs)) {
    if (!present(node.attrs, key)) continue
    const suggestions = suggestAttrs(key)
    if (suggestions.length === 0) continue
    out.push(
      flagged(
        'warn',
        'invalid-attr',
        path,
        `不认识的属性 ${key}`,
        `是不是想写 ${suggestions.join('、')}？`,
      ),
    )
  }
  return out
}

export function originValueIssues(raw: string | undefined, path: string): Issue[] {
  if (raw == null || raw.trim() === '') return []
  if (!readOrigin(raw).invalid) return []
  return [
    flagged(
      'warn',
      'invalid-attr',
      path,
      `无法解析 origin: ${raw}`,
      '九宫格如 center、top-left；或相对盒子左上角写 120 80、30% 40%。只写一个数时另一轴是中心',
    ),
  ]
}

/** 只检查归属表里的已知属性。拼写接近已知属性的名字会 warn，其余留给 draw。 */
export function checkChildAttrs(node: FvgNode, parent: 'layer' | 'flex', path: string): Issue[] {
  const out: Issue[] = []
  const attrs = node.attrs
  const positioned =
    present(attrs, 'x') || present(attrs, 'y') || present(attrs, 'cx') || present(attrs, 'cy') || present(attrs, 'anchor')
  const html = isHtmlTag(node.tag)
  out.push(...legacyCenterIssues(node, path))

  if (html) {
    if (positioned) {
      out.push(
        flagged(
          'warn',
          'invalid-attr',
          path,
          '定位写在外包的 layer 上',
          '例如 <layer x="120" y="64"><h1>…</h1></layer>',
        ),
      )
    }
    const misplaced = HTML_STYLE_ATTRS.filter((key) => present(attrs, key))
    if (misplaced.length > 0) {
      out.push(
        flagged(
          'warn',
          'invalid-attr',
          path,
          `${misplaced.join('、')} 应写在 style 里`,
          'HTML 只用 style，例如 <p style="opacity:0.5; font-size:40px">',
        ),
      )
    }
    const graphic = GRAPHIC_ATTRS.filter((key) => key !== 'cx' && key !== 'cy' && present(attrs, key))
    if (graphic.length > 0) {
      out.push(
        flagged(
          'warn',
          'invalid-attr',
          path,
          `${graphic.join('、')} 是图形属性，写在 HTML 上不会画出来`,
          '文字颜色写在 style 里；形状用 circle、rect、path 的属性，例如 <circle fill="#fff">',
        ),
      )
    }
  }

  if (present(attrs, 'anchor-box') && node.tag !== 'layer' && node.tag !== 'use') {
    out.push(
      flagged(
        'warn',
        'invalid-attr',
        path,
        'anchor-box 只写在 layer 和 use 上',
        '外包一层 layer，例如 <layer x="76" y="40" anchor="top-left" anchor-box="ink"><h1>标题</h1></layer>',
      ),
    )
  }

  if (parent === 'flex' && !html && positioned) {
    out.push(
      flagged(
        'warn',
        'invalid-attr',
        path,
          '定位写在外层 layer 上',
          'flex 子元素跟着排布走，不要写 x、y、cx、cy、anchor',
      ),
    )
  }

  if (node.tag === 'model' && (positioned || present(attrs, 'width') || present(attrs, 'height'))) {
    out.push(
      flagged(
        'warn',
        'invalid-attr',
        path,
        'model 的位置和尺寸写在外包的 layer 上',
        '例如 <layer x="220" y="80" width="200" height="200"><model src="hero.glb" /></layer>',
      ),
    )
  }

  if (parent === 'flex' && isMeshTag(node.tag)) {
    out.push(
      flagged(
        'info',
        'non-canonical',
        path,
        '网格放在 flex 里不是规范写法',
        '包一层有 perspective 的 layer，例如 <layer perspective="700"><sphere cx="80" cy="80" r="40" /></layer>',
      ),
    )
  }

  if (parent === 'flex' && isShapeTag(node.tag)) {
    const circlePoints = node.tag === 'circle' && (present(attrs, 'x1') || present(attrs, 'y1'))
    if (hasTwoPoint(attrs) || circlePoints) {
      out.push(
        flagged(
          'warn',
          'invalid-attr',
          path,
          '形状的坐标只能写在 layer 里',
          '包一层 <layer width height>，或改用 <div style="width:…; height:…; background:…">',
        ),
      )
    } else if (!positioned) {
      out.push(
        flagged(
          'info',
          'non-canonical',
          path,
          '形状放在 flex 里不是规范写法',
          '包一层 <layer width height>，或改用 div 盒子',
        ),
      )
    }
  }

  if (parent === 'layer') {
    if (styleHasFlex(attrs.style)) {
      out.push(
        flagged(
          'warn',
          'invalid-attr',
          path,
          'flex、flex-grow、flex-shrink 只在 display:flex 的子元素上有效',
          '把该元素放进 <div style="display:flex">',
        ),
      )
    }
    if (isLineTag(node.tag) && positioned) {
      out.push(
        flagged(
          'warn',
          'invalid-attr',
          path,
          '线条用自身坐标定位，x、y、cx、cy、anchor 无效',
          '删掉这些属性，直接写 x1、y1 或 points',
        ),
      )
    }
    if (isShapeTag(node.tag) && present(attrs, 'anchor')) {
      out.push(
        flagged(
          'info',
          'non-canonical',
          path,
          '形状不用 anchor',
          'rect 用 x、y 表示左上角；circle、ellipse 用 cx、cy 表示圆心',
        ),
      )
    }
    if ((node.tag === 'rect' || node.tag === 'ellipse') && (present(attrs, 'x1') || present(attrs, 'y1') || present(attrs, 'x2') || present(attrs, 'y2'))) {
      out.push(
        flagged(
          'warn',
          'invalid-attr',
          path,
          node.tag === 'rect' ? 'rect 用 x、y、width、height' : 'ellipse 用 cx、cy、rx、ry',
          node.tag === 'rect' ? '删掉 x1、y1、x2、y2，写成 x、y、width、height' : '删掉 x1、y1、x2、y2，写成 cx、cy、rx、ry',
        ),
      )
    }
    if (node.tag === 'circle' && (present(attrs, 'x1') || present(attrs, 'y1') || present(attrs, 'x2') || present(attrs, 'y2'))) {
      out.push(
        flagged(
          'warn',
          'invalid-attr',
          path,
          'circle 只支持 cx、cy、r',
          '删掉 x1、y1、x2、y2',
        ),
      )
    }
  }

  if (present(attrs, 'transform') && node.tag !== 'g') {
    out.push(
      flagged(
        'warn',
        'invalid-attr',
        path,
        'transform 只写在 g 上',
        '分组用 <g transform="translate(12,8)">',
      ),
    )
  }

  if (attrs.bleed != null) {
    out.push(
      flagged(
        'warn',
        'invalid-attr',
        path,
        'bleed 已不再使用',
        '舞台写得比成片大，用 view="x y w h" 取出要出的那一块',
      ),
    )
  }

  if ((node.tag === 'layer' || node.tag === 'use') && present(attrs, 'background')) {
    out.push(
      flagged(
        'warn',
        'invalid-attr',
        path,
        'layer 不使用 background',
        '色块用 <rect fill="...">、HTML 的 style="background:..."，或 <draw> 自己画。画布底色只写在根 <layer background>',
      ),
    )
  }

  const layerOnlyKeys = LAYER_ONLY_ATTR_NAMES.filter((key) => present(attrs, key))
  if (node.tag !== 'layer' && layerOnlyKeys.length > 0) {
    const first = attrByName(layerOnlyKeys[0]!)
    out.push(
      flagged(
        'warn',
        first ? (issueFor(first) ?? 'invalid-attr') : 'invalid-attr',
        path,
        `${layerOnlyKeys.join('、')} 只写在 layer 上`,
        first?.misplacedHint ?? '外包一层 layer',
      ),
    )
  }
  const styleMap = parseStyle(attrs.style)
  const originRaw = html ? styleMap.origin : attrs.origin
  out.push(...originValueIssues(originRaw, path))
  const styleKeys = Object.keys(styleMap)
  const registeredOnly = registeredLayerOnlyNames()
  const misplacedRegistered = registeredOnly.filter((key) => present(attrs, key))
  if (node.tag !== 'layer' && misplacedRegistered.length > 0) {
    out.push(
      flagged(
        'warn',
        'invalid-attr',
        path,
        `${misplacedRegistered.join('、')} 只写在 layer 上`,
        `外包一层 layer，例如 <layer ${misplacedRegistered[0]}="…">`,
      ),
    )
  }
  const registeredInStyle = styleKeys.filter((key) => registeredOnly.includes(key))
  if (registeredInStyle.length > 0) {
    out.push(
      flagged(
        'warn',
        'invalid-attr',
        path,
        `${registeredInStyle.join('、')} 只写在 layer 的属性上`,
        `不要写进 style；外包 <layer ${registeredInStyle[0]}="…">`,
      ),
    )
  }
  const forbiddenStyle = styleKeys.filter((key) => FORBID_IN_STYLE.has(key))
  if (forbiddenStyle.length > 0) {
    const first = attrByName(forbiddenStyle[0]!)
    out.push(
      flagged(
        'warn',
        first ? (issueFor(first) ?? 'invalid-attr') : 'invalid-attr',
        path,
        `${forbiddenStyle.join('、')} 只写在 layer 的属性上`,
        first?.styleHint ?? '不要写进 style；外包 <layer grade="…">',
      ),
    )
  }
  if (html) {
    const webkitStroke = styleMap['-webkit-text-stroke']
    const outline = styleMap.outline ?? (present(attrs, 'outline') ? attrs.outline : undefined)
    const wantsBrowserStroke =
      (webkitStroke != null && webkitStroke.trim() !== '' && webkitStroke.trim().toLowerCase() !== 'none') ||
      (outline != null && outline.trim() !== '' && outline.trim().toLowerCase() !== 'none' && outline.trim() !== '0')
    if (wantsBrowserStroke) {
      out.push(
        flagged(
          'info',
          'non-canonical',
          path,
          'outline 与 -webkit-text-stroke 不会按墨迹描边',
          '改用 ink-stroke，例如 style="ink-stroke:6 #000 outside"',
        ),
      )
    }
    const htmlStyleForbidden = styleKeys.filter((key) => FORBID_IN_HTML_STYLE.has(key))
    if (htmlStyleForbidden.length > 0) {
      const first = attrByName(htmlStyleForbidden[0]!)
      out.push(
        flagged(
          'warn',
          first ? (issueFor(first) ?? 'invalid-attr') : 'invalid-attr',
          path,
          `${htmlStyleForbidden.join('、')} 只写在 layer 上`,
          first?.styleHint ?? '不要写在 HTML style 里；外包 <layer overlay="…">',
        ),
      )
    }
  }

  if (node.tag !== 'layer' && present(attrs, 'mask')) {
    out.push(
      flagged(
        'warn',
        'invalid-attr',
        path,
        '遮罩要写成 <mask> 标签，不要写成属性',
        '在 layer 里写 <mask><circle cx="160" cy="90" r="90" /></mask>',
      ),
    )
  }
  const styleMask = styleMap.mask
  if (node.tag !== 'layer' && styleMask != null && styleMask.trim() !== '') {
    out.push(
      flagged(
        'warn',
        'invalid-attr',
        path,
        'mask 不要写在 style 里',
        '在 layer 里写 <mask>…</mask>，不要写进 style',
      ),
    )
  }

  if (usesAttributes(node) && hasStyle(attrs)) {
    out.push(
      flagged(
        'warn',
        'invalid-attr',
        path,
        'layer 和图形不使用 style',
        '把 width、opacity 写成属性。色块用 rect / HTML / <draw>',
      ),
    )
  }

  return out
}

export function checkTextBoxChildren(node: FvgNode, path: string): Issue[] {
  const out: Issue[] = []
  for (const child of node.children) {
    if (typeof child === 'string') continue
    const tag = child.tag.toLowerCase()
    if (tag === 'g') {
      out.push(
        flagged(
          'warn',
          'invalid-child',
          path,
          'g 不能放在文字盒子里',
          '包一层 layer，例如 <layer><g>…</g></layer>',
        ),
      )
      continue
    }
    if (tag === 'layer') {
      out.push(
        flagged(
          'warn',
          'invalid-child',
          path,
          '文字盒子里不能放 layer',
          '和文字并排放进 <div>，例如 <div style="display:flex"><layer width="120" height="120">…</layer><p>…</p></div>',
        ),
      )
      continue
    }
    if (MATH_TAGS.has(tag)) {
      out.push(
        flagged(
          'warn',
          'invalid-child',
          path,
          '文字盒子里不能放 math',
          '上下排放进 <div>，和文字并排再写 display:flex',
        ),
      )
      continue
    }
    if (isImageTag(tag)) {
      out.push(
        flagged(
          'warn',
          'invalid-child',
          path,
          '文字盒子里不能放图片',
          '把 <img src="…"> 放进 <div>。要并排再写 display:flex',
        ),
      )
      continue
    }
    if (!BLOCK_IN_TEXT.has(tag)) continue
    out.push(
      flagged(
        'warn',
        'invalid-child',
        path,
        `文字盒子里不能放 <${tag}>`,
        '改成 <div>。要横排或间距再写 display:flex',
      ),
    )
  }
  return out
}

export function rowColumnHint(tag: string): string {
  return tag === 'Column'
    ? '<div style="display:flex; flex-direction:column">'
    : '<div style="display:flex">'
}
