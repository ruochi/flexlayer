/** 文档根与定位容器都是小写的 layer。大小写不同的标签不归一。 */
const KNOWN_TAGS = new Set([
  'layer',
  'rect',
  'circle',
  'ellipse',
  'line',
  'arrow',
  'polyline',
  'polygon',
  'path',
  'curve',
  'g',
  'font',
  'draw',
  'symbol',
  'use',
  'mask',
  'preview',
  'div',
  'h1',
  'h2',
  'h3',
  'p',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'br',
  'img',
  'image',
  'sphere',
  'box',
  'cylinder',
  'torus',
  'tube',
  'extrude',
  'model',
  'math',
  'mrow',
  'mi',
  'mn',
  'mo',
  'mtext',
  'mfrac',
  'msub',
  'msup',
  'msubsup',
  'msqrt',
  'mroot',
  'munder',
  'mover',
  'munderover',
  'mtable',
  'mtr',
  'mtd',
])

export const ROOT_TAGS = new Set(['layer'])
export const SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse'])
export const LINE_TAGS = new Set(['line', 'polyline', 'polygon', 'path', 'curve'])
export const MESH_TAGS = new Set(['sphere', 'box', 'cylinder', 'torus', 'tube', 'extrude', 'model'])
export const FONT_TAG = 'font'

/** HTML 图片。`image` 与 `img` 是同一个标签。 */
const IMAGE_TAGS = new Set(['img', 'image'])

/** 标签必须已经是规范里的小写。不认识的、以及只是大小写不同的，保持原样。 */
export function canonicalTag(tag: string): string {
  return tag
}

/** 大写或旧根标签 fvg 写成了已知标签时，给出对应的小写写法。 */
export function tagSpellingHint(tag: string): string | undefined {
  const lower = tag.toLowerCase()
  if (lower === 'fvg') return '改成 <layer>'
  if (lower !== tag && KNOWN_TAGS.has(lower)) return `改成 <${lower}>`
  return undefined
}

export function isImageTag(tag: string): boolean {
  return IMAGE_TAGS.has(tag)
}

export function isRootTag(tag: string): boolean {
  return canonicalTag(tag) === 'layer'
}

export function isLineTag(tag: string): boolean {
  return LINE_TAGS.has(canonicalTag(tag))
}

export function isShapeTag(tag: string): boolean {
  return SHAPE_TAGS.has(canonicalTag(tag))
}

export function isMeshTag(tag: string): boolean {
  return MESH_TAGS.has(canonicalTag(tag))
}

/** mask 里允许的内容：有面积的形状，以及带 alpha 的图片。 */
const MASK_CONTENT_TAGS = new Set(['rect', 'circle', 'ellipse', 'polygon', 'path'])

export function isMaskContentTag(tag: string): boolean {
  const canonical = canonicalTag(tag)
  return MASK_CONTENT_TAGS.has(canonical) || isImageTag(canonical)
}
