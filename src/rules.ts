import type { FvgNode } from './parse.js'
import { ATTRS, HTML_STYLE_ATTRS, attrByName, issueFor } from './schema.js'
import { parseNumber, parseStyle } from './style.js'
import { isTextBoxTag } from './text.js'
import type { Issue, IssueLevel } from './types.js'
import { isImageTag, isLineTag, isMeshTag, isShapeTag } from './tags.js'

const BLOCK_IN_TEXT = new Set(['h1', 'h2', 'h3', 'p', 'div'])

const LAYER_ONLY_ATTR_NAMES = ATTRS.filter((attr) => attr.layerOnlyAttr).map((attr) => attr.name)
const GRAPHIC_ATTRS = ATTRS.filter((attr) => attr.docGroup === 'graphic').map((attr) => attr.name)
const FORBID_IN_STYLE = new Set(ATTRS.filter((attr) => attr.forbidInStyle).map((attr) => attr.name))
const FORBID_IN_HTML_STYLE = new Set(ATTRS.filter((attr) => attr.forbidInHtmlStyle).map((attr) => attr.name))

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

/** 只检查归属表里的已知属性。不认识的属性留给 draw 使用，不报错。 */
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
  const styleKeys = Object.keys(styleMap)
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
    if (isImageTag(tag)) {
      out.push(
        flagged(
          'warn',
          'invalid-child',
          path,
          '文字盒子里不能放图片',
          '改成 <div style="display:flex">，把 <img src="…"> 放进去',
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
        '改成 <div style="display:flex; flex-direction:column">',
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
