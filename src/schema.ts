/**
 * Attribute registry. Ownership checks, serialization order, and the docs'
 * ownership table all come from here.
 * Unknown attributes stay out of the table and are left for draw, with no report.
 */

export type DocGroup = 'layer' | 'transform' | 'html' | 'graphic' | 'image' | 'effect' | 'layer-only' | 'data' | 'expect'

export type AttrDef = {
  name: string
  /** On an HTML tag as an attribute (not in style): report invalid-attr */
  warnOnHtmlAttr?: boolean
  /** Allowed only as an attribute on layer; other tags report invalid-attr */
  layerOnlyAttr?: boolean
  /** In any tag's style: report invalid-attr (grade / grade-mask) */
  forbidInStyle?: boolean
  /** Report only when it appears in an HTML style (overlay) */
  forbidInHtmlStyle?: boolean
  docGroup?: DocGroup
  /** Effect name the gallery coverage check looks for */
  effect?: boolean
  /** Syntax. Required for effect attributes */
  syntax?: string
  /** Default when a part is omitted. Shown in the cheat sheet */
  defaultValue?: string
  /** Shortest example, without quotes */
  example?: string
  /** Issue code when the attribute is in the wrong place */
  issue?: 'invalid-attr'
  /** JSX field type. Default string */
  jsxType?: string
  /** Hint when written on a tag that is not layer */
  misplacedHint?: string
  /** Hint when written into style */
  styleHint?: string
  /** Catalog note for lookup by name. Use when this differs from CSS, or is easy to misplace */
  note?: string
}

/** Same order as serialize. Changing it changes generated .layer files. */
export const ATTR_ORDER = [
  'id',
  'family',
  'src',
  'unit',
  'object',
  'href',
  'width',
  'height',
  'background',
  'color',
  'font-family',
  'min-font',
  'safe',
  'view',
  'x',
  'y',
  'cx',
  'cy',
  'anchor',
  'anchor-box',
  'x1',
  'y1',
  'x2',
  'y2',
  'r',
  'rx',
  'round',
  'ry',
  'points',
  'd',
  'depth',
  'tube',
  'closed',
  'head',
  'fill',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'hidden',
  'halo',
  'material',
  'shadows',
  'cast-shadow',
  'receive-shadow',
  'shadow-blur',
  'shadow-opacity',
  'shadow-color',
  'opacity',
  'rotate',
  'rotateX',
  'rotateY',
  'z',
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
    name: 'camera',
    layerOnlyAttr: true,
    forbidInStyle: true,
    docGroup: 'layer-only',
    jsxType: 'string | Record<string, unknown>',
    example: 'fov 40, orbit 35 18, aperture 12',
    misplacedHint: 'Put this on the layer that frames the shot, for example <layer camera="900">. When omitted, the viewing distance is that layer\'s height. Do not combine it with view on the same layer',
    styleHint: 'Do not put this in style. Write it as an attribute on layer, for example <layer camera="900">',
  },
  {
    name: 'shadows',
    layerOnlyAttr: true,
    forbidInStyle: true,
    docGroup: 'layer-only',
    syntax: 'auto | none',
    defaultValue: 'auto',
    example: 'none',
    note: 'On a layer that has a camera. none turns off shadows cast onto ground. Depth occlusion stays',
    misplacedHint: 'Put this on the layer that frames the shot, for example <layer camera="900" shadows="none">',
    styleHint: 'Do not put this in style. Write it as an attribute on layer',
  },
  {
    name: 'min-font',
    layerOnlyAttr: true,
    forbidInStyle: true,
    docGroup: 'layer',
    syntax: 'screen | print | none | px',
    defaultValue: 'screen',
    example: 'print',
    note: 'Root only. screen is min(width, height) / 1080 × 24. print uses × 12. A number is the minimum size in screen pixels. none turns min-font-size off',
    misplacedHint: 'Root layer only, for example <layer width="1240" height="1754" min-font="print">',
    styleHint: 'Do not put this in style. Write it as an attribute on the root layer',
  },
  {
    name: 'preserve-3d',
    forbidInStyle: true,
    example: 'true',
    issue: 'invalid-attr',
    misplacedHint: 'Only on layer, or on a div with display:flex',
  },
  {
    name: 'sharp',
    forbidInStyle: true,
    example: 'true',
    issue: 'invalid-attr',
    misplacedHint: 'On a layer, flex container, shape, or solid that should stay sharp',
  },
  { name: 'scale', warnOnHtmlAttr: true, docGroup: 'transform' },
  { name: 'origin', warnOnHtmlAttr: true, docGroup: 'transform' },
  {
    name: 'split',
    syntax: 'chars',
    example: 'chars',
    note: 'On a text box or an inline tag. Each character gets its own translate, rotate, scale, and opacity. Line width and wrapping stay the same, so the text box no longer rotates, scales, or fades as one piece',
    misplacedHint: 'On p, h1, or span, for example <p split="chars">',
  },
  { name: 'background', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'padding', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'font-size', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'color', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'flex', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'flex-grow', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'flex-shrink', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'flex-basis', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'gap', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'border', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'border-radius', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'max-width', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'align-items', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'align-content', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'justify-content', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'flex-wrap', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'row-gap', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'column-gap', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'writing-mode', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'object-fit', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'object-position', warnOnHtmlAttr: true, docGroup: 'html' },
  { name: 'x', docGroup: 'layer' },
  { name: 'y', docGroup: 'layer' },
  { name: 'cx', docGroup: 'graphic' },
  { name: 'cy', docGroup: 'graphic' },
  { name: 'anchor', docGroup: 'layer' },
  {
    name: 'anchor-box',
    docGroup: 'layer',
    syntax: 'ink | box',
    defaultValue: 'box',
    example: 'ink',
    issue: 'invalid-attr',
  },
  { name: 'x1', docGroup: 'graphic' },
  { name: 'y1', docGroup: 'graphic' },
  { name: 'x2', docGroup: 'graphic' },
  { name: 'y2', docGroup: 'graphic' },
  { name: 'points', docGroup: 'graphic' },
  { name: 'd', docGroup: 'graphic' },
  {
    name: 'depth',
    docGroup: 'graphic',
    syntax: 'px',
    example: '40',
    note: 'On rect, circle, ellipse, polygon, or path, extrude along z. Thickness is centered on the plane and is not part of layout. Omit it for a flat shape',
  },
  {
    name: 'fill-rule',
    docGroup: 'graphic',
    syntax: 'nonzero | evenodd',
    defaultValue: 'nonzero',
    example: 'evenodd',
    note: 'How holes are decided when extruding. nonzero needs the inner contour wound the other way. evenodd uses nesting parity',
  },
  { name: 'tube', docGroup: 'graphic' },
  { name: 'round', docGroup: 'graphic' },
  { name: 'fill', docGroup: 'graphic' },
  { name: 'stroke', docGroup: 'graphic' },
  { name: 'hidden', docGroup: 'graphic' },
  { name: 'halo', docGroup: 'graphic', syntax: 'px', example: '3' },
  { name: 'material', docGroup: 'graphic', syntax: 'matte | plastic | metal | glass [roughness]', example: 'metal 0.35' },
  {
    name: 'cast-shadow',
    forbidInStyle: true,
    docGroup: 'graphic',
    syntax: 'true | false',
    defaultValue: 'true',
    example: 'false',
    note: 'When false, this solid does not cast a shadow onto ground. Glass never casts one',
  },
  {
    name: 'receive-shadow',
    forbidInStyle: true,
    docGroup: 'graphic',
    syntax: 'true | false',
    defaultValue: 'true',
    example: 'false',
    note: 'Only on ground. When false, the ground does not receive shadows',
  },
  {
    name: 'shadow-blur',
    docGroup: 'graphic',
    syntax: 'px',
    defaultValue: '0',
    example: '16',
    issue: 'invalid-attr',
  },
  {
    name: 'shadow-opacity',
    docGroup: 'graphic',
    syntax: '0–1',
    defaultValue: '0.4',
    example: '0.45',
    issue: 'invalid-attr',
  },
  {
    name: 'shadow-color',
    docGroup: 'graphic',
    syntax: 'color',
    defaultValue: '`#000000`',
    example: '#000000',
    issue: 'invalid-attr',
  },
  { name: 'transform', docGroup: 'graphic' },
  { name: 'src', docGroup: 'image' },
  {
    name: 'unit',
    docGroup: 'image',
    syntax: 'px',
    example: '40',
    note: 'Only on model. Pixels per model unit. When set, original coordinates are kept and the origin sits on the wrapping layer\'s origin (center by default), instead of contain-centering',
  },
  {
    name: 'object',
    docGroup: 'image',
    jsxType: 'object',
    note: 'Only on model in tsx. Pass a three.js Object3D. A .layer file cannot write this',
  },
  { name: 'data', docGroup: 'data', jsxType: 'unknown', example: '{"values":[3,5,8]}' },
  { name: 'expect', docGroup: 'expect', example: 'overflow-canvas: full bleed' },
  { name: 'alt', docGroup: 'image' },
  {
    name: 'shadow',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: 'x y [blur] [spread] [color]',
    defaultValue: 'color `#00000066`',
    example: '0 8 16 #00000055',
    issue: 'invalid-attr',
  },
  {
    name: 'glow',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: 'blur [spread] [color]',
    defaultValue: 'color from the mark',
    example: '56 #f3ead4',
    issue: 'invalid-attr',
  },
  {
    name: 'inner-shadow',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: 'same as shadow',
    defaultValue: 'same as shadow',
    example: '0 8 16 #00000055',
    issue: 'invalid-attr',
  },
  {
    name: 'inner-glow',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: 'same as glow',
    defaultValue: 'same as glow',
    example: '28 #7ec8ff',
    issue: 'invalid-attr',
  },
  {
    name: 'blur',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: 'one non-negative length in px',
    example: '6',
    issue: 'invalid-attr',
    jsxType: 'number | string',
  },
  {
    name: 'backdrop-blur',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: 'one non-negative length in px',
    example: '16',
    issue: 'invalid-attr',
    jsxType: 'number | string',
  },
  {
    name: 'glass',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: 'clear | regular | thick, or clear, blur 8, tint #fff2',
    example: 'clear',
    issue: 'invalid-attr',
  },
  {
    name: 'noise',
    warnOnHtmlAttr: true,
    docGroup: 'effect',
    effect: true,
    syntax: 'amount, or amount plus a color',
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
    defaultValue: 'opacity 1, `source-over`',
    example: '#00000066',
    issue: 'invalid-attr',
    misplacedHint: 'Wrap a layer, for example <layer overlay="#00000066"><rect …/></layer>',
    styleHint: 'Do not put this in an HTML style. Wrap <layer overlay="…">',
  },
  {
    name: 'grade',
    layerOnlyAttr: true,
    forbidInStyle: true,
    docGroup: 'layer-only',
    effect: true,
    syntax: 'preset [amount], param value',
    defaultValue: 'amount 1',
    example: 'lomo 0.8, fade 0.1',
    issue: 'invalid-attr',
    misplacedHint: 'Wrap a layer, for example <layer grade="lomo"><img src="…" style="width:320px" /></layer>',
    styleHint: 'Do not put this in style. Wrap <layer grade="…">',
  },
  {
    name: 'grade-mask',
    layerOnlyAttr: true,
    forbidInStyle: true,
    docGroup: 'layer-only',
    effect: true,
    syntax: 'same as fill; alpha is the amount',
    example: 'radial-gradient(#fff0 30%, #fff)',
    issue: 'invalid-attr',
    misplacedHint: 'Wrap a layer, for example <layer grade="lomo" grade-mask="radial-gradient(#fff0 30%, #fff)">',
    styleHint: 'Do not put this in style. Wrap <layer grade="…">',
  },
  {
    name: 'view',
    layerOnlyAttr: true,
    forbidInStyle: true,
    docGroup: 'layer-only',
    example: '200 80 960 540',
    issue: 'invalid-attr',
    misplacedHint: 'Only on layer, for example <layer width="1920" height="1080" view="200 80 960 540">',
    styleHint: 'Do not put this in style. Write it as an attribute on layer',
  },
  // No longer changes checks. Kept so it is not treated as a typo for blend.
  { name: 'bleed' },
]

export function attrByName(name: string): AttrDef | undefined {
  return ATTRS.find((attr) => attr.name === name)
}

/** Issue code when the attribute is in the wrong place. Ownership checks that do not set one use invalid-attr. */
export function issueFor(attr: AttrDef): 'invalid-attr' | undefined {
  if (attr.issue) return attr.issue
  if (attr.warnOnHtmlAttr || attr.layerOnlyAttr || attr.forbidInStyle || attr.forbidInHtmlStyle) return 'invalid-attr'
  return undefined
}

/** Attributes that belong in style on HTML. Order matches the historical check. */
export const HTML_STYLE_ATTRS: string[] = ATTRS.filter((attr) => attr.warnOnHtmlAttr).map((attr) => attr.name)

export const LAYER_ONLY_ATTRS: string[] = ATTRS.filter((attr) => attr.layerOnlyAttr).map((attr) => attr.name)

export const EFFECT_ATTRS: string[] = ATTRS.filter((attr) => attr.effect).map((attr) => attr.name)

const DOC_GROUP_ORDER: DocGroup[] = ['layer', 'transform', 'html', 'graphic', 'image', 'effect', 'layer-only', 'data', 'expect']

const DOC_GROUP_LABEL: Record<DocGroup, string> = {
  layer: '`width`, `height`, plus `x`, `y`, and `anchor`. `x` and `y` are the top-left corner, default 0; `anchor` defaults to `top-left`. Writing them on HTML warns',
  transform: 'Shapes, lines, and `layer` use attributes; text uses `style`. Writing them as attributes on HTML warns',
  html: 'HTML, rendered as CSS, written in `style`. Initial values are not restated. `style` on `layer` or a shape warns',
  graphic: 'Shape attributes. Coordinates are local to the containing `layer`',
  image: 'Only on `img` or `model`. `unit` and `object` are only on `model`. Image width and height still go in `style`',
  effect: 'Shapes and `layer` use attributes; text uses `style`. Syntax is in attrs.json',
  'layer-only': 'Only on `layer`. Elsewhere, or in `style`, warns',
  data: 'Any element. The value is JSON and is not a normal attribute. In code, pass an object or array',
  expect: 'Any element. Names issue codes expected on that node or in its subtree; a match is lowered to info. A miss reports `unused-expect`',
}

function namesIn(group: DocGroup): string {
  return ATTRS.filter((attr) => attr.docGroup === group)
    .map((attr) => `\`${attr.name}\``)
    .join(', ')
}

/** One entry per attribute, for lookup. Order matches the registry. */
export function attrCatalog(): Array<Record<string, string | boolean | null>> {
  return ATTRS.map((attr) => ({
    name: attr.name,
    group: attr.docGroup ?? null,
    syntax: attr.syntax ?? null,
    default: attr.defaultValue ?? null,
    example: attr.example ?? null,
    layerOnly: attr.layerOnlyAttr === true,
    htmlUsesStyle: attr.warnOnHtmlAttr === true,
    note: attr.note ?? null,
    misplacedHint: attr.misplacedHint ?? null,
  }))
}

/** SPEC ownership table, including the header row. */
export function ownershipTableBody(): string {
  const rows = DOC_GROUP_ORDER.map(
    (group) => `| ${namesIn(group)} | ${DOC_GROUP_LABEL[group]} |`,
  )
  return ['| Attribute | Where |', '| --- | --- |', ...rows].join('\n')
}

/** The effects line in the cheat sheet. Examples and defaults come from the registry. */
export function effectCheatLine(): string {
  const parts = ATTRS.filter((attr) => attr.effect).map((attr) => {
    const sample = attr.example ? `\`${attr.example}\`` : ''
    const def = attr.defaultValue ? ` (default ${attr.defaultValue})` : ''
    return `\`${attr.name}\` ${sample}${def}`.trim()
  })
  return `Effects: ${parts.join(', ')}. \`overlay\`, \`grade\`, and \`grade-mask\` apply to the whole subtree and belong only on \`layer\`.`
}

/** JSX effect fields. `names` picks which type they are written into. */
export function jsxFieldBlock(names: readonly string[]): string {
  return names
    .map((name) => {
      const attr = attrByName(name)
      if (!attr) throw new Error(`registry has no ${name}`)
      const key = name.includes('-') ? `'${name}'` : name
      const note = attr.example ? `  /** ${attr.example} */\n` : ''
      return `${note}  ${key}?: ${attr.jsxType ?? 'string'}`
    })
    .join('\n')
}

export const JSX_EFFECT_NAMES = ATTRS.filter((attr) => attr.effect && attr.docGroup === 'effect').map((attr) => attr.name)
export const JSX_OVERLAY_NAMES = ['overlay'] as const
export const JSX_GRADE_NAMES = ['grade', 'grade-mask'] as const
