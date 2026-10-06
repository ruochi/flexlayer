import { initFontsForMeasure } from './fonts.js'
import { h } from './h.js'
import { measureLayer, noteMeasuredSize, parseSafe, prepareAssets, type MeasureEnv } from './layout.js'
import type { FvgChild, FvgNode, SourceLoc } from './parse.js'
import type { Anchor, Box, Issue, LayoutNode } from './types.js'
import { emptyBox, translateBox, unionBoxes } from './types.js'

const SPEC_COLOR = '#111111'
const SPEC_FONT = 'ChillDuanSans'
/** 不换行时的可用宽度。Yoga 不接受 Infinity。 */
const UNLIMITED = 1_000_000

const ANCHORS = new Set<Anchor>([
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
])

export type CanvasOptions = {
  width: number
  height: number
  background?: string
  color?: string
  fontFamily?: string
  /** 没写时按画布短边的 4% 计算，和排版一致 */
  safe?: number | string
  fonts?: Record<string, string>
  images?: string[]
  baseDir?: string
}

export type LayerMeasureOptions = {
  /** 文字换行宽度。没写时用画布去掉 safe 之后的宽度 */
  maxWidth?: number
  perspective?: number | string
  glow?: string
  shadow?: string
  grade?: string
  'grade-mask'?: string
  overlay?: string
  opacity?: number | string
  rotate?: number | string
  rotateX?: number | string
  rotateY?: number | string
  overflow?: string
  width?: number | string
  height?: number | string
  id?: string
  z?: number | string
  blur?: number | string
  filter?: string
  blend?: string
  noise?: string
  glass?: string
}

export type MeasuredLayer = {
  /** 布局宽，已经乘过 scale */
  width: number
  /** 布局高，已经乘过 scale */
  height: number
  scale: number
  ink: Box
  effect: Box
  issues: Issue[]
  fit(opts: { width?: number; height?: number; by?: 'box' | 'effect' }): MeasuredLayer
  scaled(k: number): MeasuredLayer
  at(pos: { x: number; y: number; anchor?: Anchor }): PlacedLayer
}

export type PlacedLayer = FvgNode & {
  left: number
  top: number
  right: number
  bottom: number
  cx: number
  cy: number
  width: number
  height: number
}

type Metrics = {
  width: number
  height: number
  ink: Box
  effect: Box
}

function scaleBox(box: Box, k: number): Box {
  return { x: box.x * k, y: box.y * k, width: box.width * k, height: box.height * k }
}

function expandBox(box: Box, pad: number): Box {
  if (pad === 0) return box
  return { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
}

function effectPad(node: LayoutNode): number {
  return Math.max(
    node.shadow ? node.shadow.blur * 2 + node.shadow.spread + Math.max(Math.abs(node.shadow.x), Math.abs(node.shadow.y)) : 0,
    node.glow ? node.glow.blur * 2 + node.glow.spread : 0,
    node.blur != null ? node.blur * 2 : 0,
    node.glass ? node.glass.blur * 2 : 0,
  )
}

function localEffect(node: LayoutNode): Box {
  const base = node.ink.width > 0 || node.ink.height > 0 ? node.ink : { x: 0, y: 0, width: node.width, height: node.height }
  let box = expandBox(base, effectPad(node))
  if (node.kind === 'layer' || node.kind === 'flex') {
    for (const child of node.children) box = unionBoxes(box, translateBox(localEffect(child), child.x, child.y))
  }
  return box
}

function parseAnchor(raw: string | undefined): Anchor {
  const value = (raw ?? 'top-left').trim().toLowerCase() as Anchor
  return ANCHORS.has(value) ? value : 'top-left'
}

/** (x, y) 是盒子上 anchor 那一点，返回缩放后盒子的左上角。 */
function topLeft(x: number, y: number, w: number, h: number, anchor: Anchor): { x: number; y: number } {
  switch (anchor) {
    case 'top-left':
      return { x, y }
    case 'top':
      return { x: x - w / 2, y }
    case 'top-right':
      return { x: x - w, y }
    case 'left':
      return { x, y: y - h / 2 }
    case 'right':
      return { x: x - w, y: y - h / 2 }
    case 'bottom-left':
      return { x, y: y - h }
    case 'bottom':
      return { x: x - w / 2, y: y - h }
    case 'bottom-right':
      return { x: x - w, y: y - h }
    default:
      return { x: x - w / 2, y: y - h / 2 }
  }
}

function cloneTree(node: FvgNode): FvgNode {
  const copy: FvgNode = {
    tag: node.tag,
    attrs: { ...node.attrs },
    children: node.children.map((child) => (typeof child === 'string' ? child : cloneTree(child))),
  }
  if (node.draw) copy.draw = node.draw
  if (node.writtenTag) copy.writtenTag = node.writtenTag
  if (node.loc) copy.loc = node.loc
  return copy
}

function fittedScale(scale: number, metrics: Metrics, opts: { width?: number; height?: number; by?: 'box' | 'effect' }): number {
  const bounds = opts.by === 'effect' ? metrics.effect : { width: metrics.width, height: metrics.height }
  let next = scale
  if (opts.width != null && bounds.width > 0) next = Math.min(next, opts.width / bounds.width)
  if (opts.height != null && bounds.height > 0) next = Math.min(next, opts.height / bounds.height)
  return next
}

function createMeasured(node: FvgNode, metrics: Metrics, scale: number, issues: Issue[]): MeasuredLayer {
  const measured: MeasuredLayer = {
    width: metrics.width * scale,
    height: metrics.height * scale,
    scale,
    ink: scaleBox(metrics.ink, scale),
    effect: scaleBox(metrics.effect, scale),
    issues,
    fit(opts) {
      return createMeasured(node, metrics, fittedScale(scale, metrics, opts), issues)
    },
    scaled(k) {
      return createMeasured(node, metrics, scale * k, issues)
    },
    at(pos) {
      const anchor = parseAnchor(pos.anchor)
      const copy = cloneTree(node)
      copy.attrs.x = String(pos.x)
      copy.attrs.y = String(pos.y)
      if (anchor === 'top-left') delete copy.attrs.anchor
      else copy.attrs.anchor = anchor
      if (scale !== 1) {
        copy.attrs.scale = String(scale)
        copy.attrs.origin = anchor
      }
      noteMeasuredSize(copy, metrics.width, metrics.height)
      const width = metrics.width * scale
      const height = metrics.height * scale
      const origin = topLeft(pos.x, pos.y, width, height, anchor)
      return Object.assign(copy, {
        left: origin.x,
        top: origin.y,
        right: origin.x + width,
        bottom: origin.y + height,
        cx: origin.x + width / 2,
        cy: origin.y + height / 2,
        width,
        height,
      })
    },
  }
  return measured
}

function layerAttrs(opts: LayerMeasureOptions | undefined): Record<string, string> {
  const attrs: Record<string, string> = {}
  if (!opts) return attrs
  for (const [key, value] of Object.entries(opts)) {
    if (key === 'maxWidth' || value == null) continue
    attrs[key] = String(value)
  }
  return attrs
}

function contentLoc(content: FvgChild | FvgChild[]): SourceLoc | undefined {
  const list = Array.isArray(content) ? content : [content]
  for (const item of list) {
    if (typeof item !== 'string' && item.loc) return item.loc
  }
  return undefined
}

function measureContent(content: FvgChild | FvgChild[], opts: LayerMeasureOptions | undefined, env: MeasureEnv): MeasuredLayer {
  const node = h('layer', layerAttrs(opts), ...(Array.isArray(content) ? content : [content]))
  const loc = contentLoc(content)
  if (loc && !node.loc) node.loc = loc
  const maxWidth = opts?.maxWidth ?? env.maxContentWidth
  const { laid, issues } = measureLayer(node, { ...env, maxContentWidth: maxWidth })
  const ink = laid.ink.width > 0 || laid.ink.height > 0 ? laid.ink : emptyBox()
  return createMeasured(node, { width: laid.width, height: laid.height, ink, effect: localEffect(laid) }, 1, issues)
}

/**
 * 不经过 canvas() 时用规范默认值，并且不按画布宽度换行。
 * 字体、图片和 Yoga 仍要先准备好，一般先 `await canvas()`。
 */
export function layer(content: FvgChild | FvgChild[], opts?: LayerMeasureOptions): MeasuredLayer {
  return measureContent(content, opts, {
    baseDir: process.cwd(),
    color: SPEC_COLOR,
    fontFamily: SPEC_FONT,
    maxContentWidth: opts?.maxWidth ?? UNLIMITED,
  })
}

export class Graphic {
  readonly width: number
  readonly height: number
  readonly color: string
  readonly fontFamily: string
  readonly background?: string
  private readonly baseDir: string
  private readonly safeRaw?: number | string
  private readonly fonts: Record<string, string>
  private readonly maxContentWidth: number

  constructor(options: CanvasOptions, maxContentWidth: number) {
    this.width = options.width
    this.height = options.height
    this.color = options.color ?? SPEC_COLOR
    this.fontFamily = options.fontFamily ?? SPEC_FONT
    this.background = options.background
    this.baseDir = options.baseDir ?? process.cwd()
    this.safeRaw = options.safe
    this.fonts = options.fonts ?? {}
    this.maxContentWidth = maxContentWidth
  }

  /** 同步量一块内容。元素自己的样式优先，否则用 canvas() 的颜色和字体。 */
  layer(content: FvgChild | FvgChild[], opts?: LayerMeasureOptions): MeasuredLayer {
    return measureContent(content, opts, {
      baseDir: this.baseDir,
      color: this.color,
      fontFamily: this.fontFamily,
      maxContentWidth: this.maxContentWidth,
    })
  }

  /** 拼成根 `<layer>`。字体声明写在最前面。 */
  root(...children: Array<FvgChild | null | undefined | false>): FvgNode {
    const attrs: Record<string, string> = {
      width: String(this.width),
      height: String(this.height),
      color: this.color,
      'font-family': this.fontFamily,
    }
    if (this.background != null) attrs.background = this.background
    if (this.safeRaw != null) attrs.safe = String(this.safeRaw)
    const fontNodes = Object.entries(this.fonts).map(([family, src]) => h('font', { family, src }))
    const body = children.filter((child): child is FvgChild => child != null && child !== false)
    return h('layer', attrs, ...fontNodes, ...body)
  }
}

/** 唯一的异步步骤：注册字体、加载图片、初始化 Yoga。 */
export async function canvas(options: CanvasOptions): Promise<Graphic> {
  const baseDir = options.baseDir ?? process.cwd()
  await initFontsForMeasure()
  const fontFamily = options.fontFamily ?? SPEC_FONT
  const fonts = Object.entries(options.fonts ?? {}).map(([family, src]) => ({ family, src }))
  await prepareAssets(null, baseDir, { fonts, images: options.images, fontFamily })
  const safe = parseSafe(options.safe == null ? undefined : String(options.safe), options.width, options.height)
  const graphic = new Graphic({ ...options, baseDir, fontFamily }, options.width - safe.left - safe.right)
  return graphic
}
