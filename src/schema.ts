/**
 * 属性注册表。归属检查、序列化顺序和文档里的归属表都从这里来。
 * 不认识的属性不在表里，留给 draw，不报错。
 */

export type DocGroup = 'layer' | 'transform' | 'html' | 'graphic' | 'image' | 'effect' | 'layer-only'

export type AttrDef = {
  name: string
  /** 写在 HTML 标签的属性位（而不是 style）时报 invalid-attr */
  warnOnHtmlAttr?: boolean
  /** 只允许写在 layer 的属性上；写在别的标签上报 invalid-attr */
  layerOnlyAttr?: boolean
  /** 写进任何标签的 style 都报 invalid-attr（grade / grade-mask） */
  forbidInStyle?: boolean
  /** 只在 HTML 的 style 里出现时才报（overlay） */
  forbidInHtmlStyle?: boolean
  docGroup?: DocGroup
  /** 图库覆盖率要检查的效果名 */
  effect?: boolean
  /** 语法，效果属性必填 */
  syntax?: string
  /** 不写某段时的默认，写进速查 */
  defaultValue?: string
  /** 最小示例，不含引号 */
  example?: string
  /** 放错位置时的问题码 */
  issue?: 'invalid-attr'
  /** JSX 字段类型，默认 string */
  jsxType?: string
  /** 写在非 layer 上时的 hint */
  misplacedHint?: string
  /** 写进 style 时的 hint */
  styleHint?: string
}

/** 和 serialize 的属性顺序一致，改顺序会改变生成的 .layer。 */
export const ATTR_ORDER = [
  'id',
  'family',
  'src',
  'href',
  'width',
  'height',
  'background',
  'color',
  'font-family',
  'safe',
  'x',
  'y',
  'cx',
  'cy',
  'anchor',
  'x1',
  'y1',
  'x2',
  'y2',
  'r',
  'rx',
  'ry',
  'points',
  'd',
  'depth',
  'closed',
  'head',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'rotate',
  'rotateX',
  'rotateY',
  'z',
  'perspective',
  'scale',
  'origin',
  'transform',
  'shadow',
  'glow',
  'inner-shadow',
  'inner-glow',
  'blur',
  'backdrop-blur',
  'noise',
  'overlay',
  'grade',
  'grade-mask',
  'glass',
  'filter',
  'blend',
  'border',
  'border-radius',
  'overflow',
] as const

export const ATTRS: AttrDef[] = [
  { name: 'width', warnOnHtmlAttr: true, docGroup: 'layer' },
  { name: 'height', warnOnHtmlAttr: true, docGroup: 'layer' },
  { name: 'opacity', warnOnHtmlAttr: true, docGroup: 'transform' },
  { name: 'rotate', warnOnHtmlAttr: true, docGroup: 'transform' },
  { name: 'rotateX', warnOnHtmlAttr: true, docGroup: 'transform' },
  { name: 'rotateY', warnOnHtmlAttr: true, docGroup: 'transform' },
  { name: 'z', warnOnHtmlAttr: true, docGroup: 'transform' },
  {
    name: 'perspective',
    layerOnlyAttr: true,
    forbidInStyle: true,
    docGroup: 'layer-only',
    misplacedHint: '写在父 layer 上，例如 <layer perspective="900">',
    styleHint: '不要写进 style；写在 layer 的属性上，例如 <layer perspective="900">',
  },
  { name: 'scale', warnOnHtmlAttr: true, docGroup: 'transform' },
  { name: 'origin', warnOnHtmlAttr: true, docGroup: 'transform' },
  { name: 'background', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'padding', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'font-size', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'color', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'flex', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'flex-grow', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'flex-shrink', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'gap', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'border', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'border-radius', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'max-width', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'align-items', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'justify-content', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'writing-mode', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'object-fit', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'object-position', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'x', docGroup: 'layer' },
  { name: 'y', docGroup: 'layer' },
  { name: 'cx', docGroup: 'graphic' },
  { name: 'cy', docGroup: 'graphic' },
  { name: 'anchor', docGroup: 'layer' },
  { name: 'x1', docGroup: 'graphic' },
  { name: 'y1', docGroup: 'graphic' },
  { name: 'x2', docGroup: 'graphic' },
  { name: 'y2', docGroup: 'graphic' },
  { name: 'points', docGroup: 'graphic' },
  { name: 'd', docGroup: 'graphic' },
  { name: 'depth', docGroup: 'graphic' },
  { name: 'fill', docGroup: 'graphic' },
  { name: 'stroke', docGroup: 'graphic' },
  { name: 'transform', docGroup: 'graphic' },
  { name: 'src', docGroup: 'image' },
  { name: 'alt', docGroup: 'image' },
  {
    name: 'shadow',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: 'x y [blur] [spread] [color]',
    defaultValue: '颜色 `#00000066`',
    example: '0 8 16 #00000055',
    issue: 'invalid-attr',
  },
  {
    name: 'glow',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: 'blur [spread] [color]',
    defaultValue: '颜色取本体',
    example: '56 #f3ead4',
    issue: 'invalid-attr',
  },
  {
    name: 'inner-shadow',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: '同 shadow',
    defaultValue: '同 shadow',
    example: '0 8 16 #00000055',
    issue: 'invalid-attr',
  },
  {
    name: 'inner-glow',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: '同 glow',
    defaultValue: '同 glow',
    example: '28 #7ec8ff',
    issue: 'invalid-attr',
  },
  {
    name: 'blur',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: '单个非负像素',
    example: '6',
    issue: 'invalid-attr',
    jsxType: 'number | string',
  },
  {
    name: 'backdrop-blur',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: '单个非负像素',
    example: '16',
    issue: 'invalid-attr',
    jsxType: 'number | string',
  },
  {
    name: 'glass',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: 'clear | regular | thick，或 clear, blur 8, tint #fff2',
    example: 'clear',
    issue: 'invalid-attr',
  },
  {
    name: 'noise',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: '强度，或强度加颜色',
    example: '0.08',
    issue: 'invalid-attr',
  },
  {
    name: 'filter',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: 'brightness() contrast() saturate() grayscale() sepia() invert() hue-rotate()',
    example: 'saturate(1.1)',
    issue: 'invalid-attr',
  },
  {
    name: 'blend',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: 'source-over | multiply | screen | overlay | soft-light | lighten | darken',
    defaultValue: '`source-over`',
    example: 'multiply',
    issue: 'invalid-attr',
  },
  {
    name: 'overlay',
    layerOnlyAttr: true,
    forbidInHtmlStyle: true,
    docGroup: 'layer-only',
    effect: true,
    syntax: '<paint> [opacity] [blend]',
    defaultValue: '透明度 1，`source-over`',
    example: '#00000066',
    issue: 'invalid-attr',
    misplacedHint: '外包一层 layer，例如 <layer overlay="#00000066"><rect …/></layer>',
    styleHint: '不要写在 HTML style 里；外包 <layer overlay="…">',
  },
  {
    name: 'grade',
    layerOnlyAttr: true,
    forbidInStyle: true,
    docGroup: 'layer-only',
    effect: true,
    syntax: '预设 [强度], 参数 值',
    defaultValue: '强度 1',
    example: 'lomo 0.8, fade 0.1',
    issue: 'invalid-attr',
    misplacedHint: '外包一层 layer，例如 <layer grade="lomo"><img src="…" style="width:320px" /></layer>',
    styleHint: '不要写进 style；外包 <layer grade="…">',
  },
  {
    name: 'grade-mask',
    layerOnlyAttr: true,
    forbidInStyle: true,
    docGroup: 'layer-only',
    effect: true,
    syntax: '同 fill，alpha 是强度',
    example: 'radial-gradient(#fff0 30%, #fff)',
    issue: 'invalid-attr',
    misplacedHint: '外包一层 layer，例如 <layer grade="lomo" grade-mask="radial-gradient(#fff0 30%, #fff)">',
    styleHint: '不要写进 style；外包 <layer grade="…">',
  },
]

export function attrByName(name: string): AttrDef | undefined {
  return ATTRS.find((attr) => attr.name === name)
}

/** 放错位置时的问题码。没单写的，归属类检查都是 invalid-attr。 */
export function issueFor(attr: AttrDef): 'invalid-attr' | undefined {
  if (attr.issue) return attr.issue
  if (attr.warnOnHtmlAttr || attr.layerOnlyAttr || attr.forbidInStyle || attr.forbidInHtmlStyle) return 'invalid-attr'
  return undefined
}

/** 这些属性在 HTML 上应写进 style。顺序与历史检查一致。 */
export const HTML_STYLE_ATTRS: string[] = ATTRS.filter((attr) => attr.warnOnHtmlAttr).map((attr) => attr.name)

export const LAYER_ONLY_ATTRS: string[] = ATTRS.filter((attr) => attr.layerOnlyAttr).map((attr) => attr.name)

export const EFFECT_ATTRS: string[] = ATTRS.filter((attr) => attr.effect).map((attr) => attr.name)

const DOC_GROUP_ORDER: DocGroup[] = ['layer', 'transform', 'html', 'graphic', 'image', 'effect', 'layer-only']

const DOC_GROUP_LABEL: Record<DocGroup, string> = {
  layer: '`width`、`height` 以及 `x`、`y`、`anchor`。`x`、`y` 是左上角，默认 0；`anchor` 默认 `top-left`。HTML 上写了报 `warn`',
  transform: '图形、线条和 `layer` 写属性；文字写在 `style`。HTML 上写成属性报 `warn`',
  html: 'HTML 的 `style`。`layer` 或图形写了 `style` 报 `warn`',
  graphic: '图形属性，坐标是所在 `layer` 的局部坐标',
  image: '只写在 `img` 或 `model` 上。图片宽高仍放进 `style`',
  effect: '图形和 `layer` 写属性；文字写在 `style`。见第 9 章',
  'layer-only': '只写在 `layer` 上。写在别处或写进 `style` 报 `warn`',
}

function namesIn(group: DocGroup): string {
  return ATTRS.filter((attr) => attr.docGroup === group)
    .map((attr) => `\`${attr.name}\``)
    .join('、')
}

/** SPEC 归属总表（不含表头）。 */
export function ownershipTableBody(): string {
  const rows = DOC_GROUP_ORDER.map(
    (group) => `| ${namesIn(group)} | ${DOC_GROUP_LABEL[group]} |`,
  )
  return ['| 属性 | 写在哪 |', '| --- | --- |', ...rows].join('\n')
}

/** CHEATSHEET 里的效果一行。示例和默认值来自注册表。 */
export function effectCheatLine(): string {
  const parts = ATTRS.filter((attr) => attr.effect).map((attr) => {
    const sample = attr.example ? `\`${attr.example}\`` : ''
    const def = attr.defaultValue ? `（默认 ${attr.defaultValue}）` : ''
    return `\`${attr.name}\` ${sample}${def}`.trim()
  })
  return `效果：${parts.join('、')}。作用于整棵子树的 \`overlay\`、\`grade\`、\`grade-mask\` 只写在 \`layer\` 上。`
}

/** JSX 效果字段。`names` 决定写进哪一个类型。 */
export function jsxFieldBlock(names: readonly string[]): string {
  return names
    .map((name) => {
      const attr = attrByName(name)
      if (!attr) throw new Error(`注册表没有 ${name}`)
      const key = name.includes('-') ? `'${name}'` : name
      const note = attr.example ? `  /** ${attr.example} */\n` : ''
      return `${note}  ${key}?: ${attr.jsxType ?? 'string'}`
    })
    .join('\n')
}

export const JSX_EFFECT_NAMES = ATTRS.filter((attr) => attr.effect && attr.docGroup === 'effect').map((attr) => attr.name)
export const JSX_OVERLAY_NAMES = ['overlay'] as const
export const JSX_GRADE_NAMES = ['grade', 'grade-mask'] as const
