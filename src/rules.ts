import type { FvgNode } from './parse.js'
import { ATTRS, HTML_STYLE_ATTRS, attrByName, issueFor } from './schema.js'
import { parseStyle } from './style.js'
import { isTextBoxTag } from './text.js'
import type { Issue, IssueLevel } from './types.js'
import { isImageTag, isLineTag, isMeshTag, isShapeTag } from './tags.js'

const BLOCK_IN_TEXT = new Set(['h1', 'h2', 'h3', 'p', 'div'])

const LAYER_ONLY_ATTR_NAMES = ATTRS.filter((attr) => attr.layerOnlyAttr).map((attr) => attr.name)
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

/** 文字和图片都按 HTML：视觉属性进 style，不写 cx。 */
export function isHtmlTag(tag: string): boolean {
  return isTextBoxTag(tag) || isImageTag(tag)
}

function usesAttributes(node: FvgNode): boolean {
  return (
    node.tag === 'layer' ||
    node.tag === 'symbol' ||
    node.tag === 'use' ||
    isShapeTag(node.tag) ||
    isLineTag(node.tag) ||
    isMeshTag(node.tag) ||
    Boolean(node.draw)
  )
}

/** 只检查归属表里的已知属性。不认识的属性留给 draw 使用，不报错。 */
export function checkChildAttrs(node: FvgNode, parent: 'layer' | 'flex', path: string): Issue[] {
  const out: Issue[] = []
  const attrs = node.attrs
  const positioned = present(attrs, 'cx') || present(attrs, 'cy') || present(attrs, 'anchor')
  const html = isHtmlTag(node.tag)

  if (html) {
    if (positioned) {
      out.push(
        flagged(
          'warn',
          'invalid-attr',
          path,
          'cx、cy、anchor 只写在 layer 上',
          '外包一层 layer，例如 <layer cx="120" cy="64" anchor="top-left"><div style="display:flex">…</div></layer>',
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
  }

  if (parent === 'flex' && !html && positioned) {
    out.push(
      flagged(
        'warn',
        'invalid-attr',
        path,
          'cx、cy、anchor 只写在 layer 上',
          '定位写在外层 layer 上，flex 子元素跟着排布走',
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
        '例如 <layer cx="320" cy="180" width="200" height="200"><model src="hero.glb" /></layer>',
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
          '线条用自身坐标定位，cx、cy、anchor 无效',
          '删掉 cx、cy、anchor，直接写 x1、y1 或 points',
        ),
      )
    }
    if ((isShapeTag(node.tag) || node.draw) && present(attrs, 'anchor')) {
      out.push(
        flagged(
          'info',
          'non-canonical',
          path,
          '形状不用 anchor',
          '用 cx、cy 表示中心，或改用 x1、y1、x2、y2',
        ),
      )
    }
    if (node.tag === 'rect' && (present(attrs, 'x') || present(attrs, 'y')) && !hasTwoPoint(attrs)) {
      out.push(
        flagged(
          'info',
          'non-canonical',
          path,
          'rect 的 x、y 按左上角理解',
          '改成 cx、cy，或 x1、y1、x2、y2',
        ),
      )
    }
    if ((node.tag === 'rect' || node.tag === 'ellipse') && hasTwoPoint(attrs)) {
      // rect 的 rx 是圆角，可以和两点写法一起用。ellipse 的 rx、ry 才是半径。
      const mixed =
        present(attrs, 'width') ||
        present(attrs, 'height') ||
        present(attrs, 'cx') ||
        present(attrs, 'cy') ||
        (node.tag === 'ellipse' && (present(attrs, 'rx') || present(attrs, 'ry')))
      if (mixed) {
        out.push(
          flagged(
            'warn',
            'invalid-attr',
            path,
            '两点写法和尺寸写法只能选一种，已按两点绘制',
            '只保留 x1、y1、x2、y2，或只保留 cx、cy 和尺寸',
          ),
        )
      }
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
