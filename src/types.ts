import type { Canvas, CanvasRenderingContext2D, Image } from '@napi-rs/canvas'

export type StyleMap = Record<string, string>

export type DrawComputedStyle = {
  color: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  opacity: number
}

export type DrawElSnapshot = {
  tag: string
  id?: string
  text: string
  attr: Record<string, string>
  style: StyleMap
  computed: DrawComputedStyle
  w: number
  h: number
  /** 当前帧的时间，单位秒。单帧渲染缺省为 0。 */
  t: number
}

export type DrawFn = (ctx: CanvasRenderingContext2D, el: DrawElSnapshot) => void

export type Box = {
  x: number
  y: number
  width: number
  height: number
}

export type Rect = Box & {
  left: number
  top: number
  right: number
  bottom: number
  centerX: number
  centerY: number
}

export function boxToRect(b: Box): Rect {
  return {
    ...b,
    left: b.x,
    top: b.y,
    right: b.x + b.width,
    bottom: b.y + b.height,
    centerX: b.x + b.width / 2,
    centerY: b.y + b.height / 2,
  }
}

export function unionBoxes(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}

export function emptyBox(): Box {
  return { x: 0, y: 0, width: 0, height: 0 }
}

export function translateBox(b: Box, dx: number, dy: number): Box {
  return { ...b, x: b.x + dx, y: b.y + dy }
}

export type IssueLevel = 'error' | 'warn' | 'info'

export type Issue = {
  level: IssueLevel
  code: string
  path: string
  message: string
  /** 可直接照做的改法。 */
  hint?: string
  /** 源码位置，例如 `examples/hello.tsx:18:5`。从 `.tsx` 来的节点才有。 */
  source?: string
  /** Composition 抽查时，这条问题第一次出现的帧。 */
  frame?: number
}

export type Anchor =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export type TextLineReport = {
  text: string
  box: Rect
}

export type ShadowSpec = { x: number; y: number; blur: number; spread: number; color: string }
export type GlowSpec = { blur: number; spread: number; color: string }
export type NoiseSpec = { amount: number; color?: string }
/** layer 专用纯色/渐变叠加 */
export type OverlaySpec = { paint: string; opacity: number; blend: BlendMode }
export type GlassSpec = {
  variant: 'regular' | 'clear' | 'thick'
  blur: number
  tint?: string
  refraction: number
  specular: number
  bezel: number
  dispersion: number
}
export type GradePresetName = 'lomo' | 'matte' | 'chrome' | 'bleach' | 'mono'
/** 只取颜色的色相和浓淡；amount 0 到 1。 */
export type GradeTone = { color: string; amount: number }
/** layer 调色。预设已展开，每一项都是最终生效的值。 */
export type GradeSpec = {
  preset?: GradePresetName
  /** 整体强度 0 到 1，和原图混合。 */
  amount: number
  shadows?: GradeTone
  midtones?: GradeTone
  highlights?: GradeTone
  contrast: number
  fade: number
  saturate: number
  warmth: number
  vignette: number
  vignetteColor: string
}
export type ColorFilterSpec =
  | { name: 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'sepia' | 'invert'; value: number }
  | { name: 'hue-rotate'; value: number }
export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'lighten'
  | 'darken'

export type ElementReport = {
  path: string
  id?: string
  tag: string
  /** 源码位置，例如 `examples/hello.tsx:18:5`。 */
  source?: string
  box: Rect
  /** 变换并裁剪后的着墨外接矩形。有透视时是投影后的范围。 */
  ink: Rect
  /** 投影后的四个角，画布坐标，顺序为左上、右上、右下、左下。没有透视投影时不写。 */
  quad?: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
  /** 逐层相乘后的有效透明度。 */
  opacity: number
  fontSize?: number
  lines?: TextLineReport[]
  shadow?: ShadowSpec
  glow?: GlowSpec
  innerShadow?: ShadowSpec
  innerGlow?: GlowSpec
  blur?: number
  backdropBlur?: number
  noise?: NoiseSpec
  overlay?: OverlaySpec
  glass?: GlassSpec
  filter?: ColorFilterSpec[]
  blend?: BlendMode
  /** 预设展开后的调色参数。 */
  grade?: GradeSpec
  gradeMask?: string
}

export type FvgReport = {
  /** 格式版本 */
  flexlayer: string
  width: number
  height: number
  elements: ElementReport[]
  issues: Issue[]
}

export type TextRunStyle = {
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  letterSpacing: number
}

export type TextSegment = {
  text: string
  style: TextRunStyle
  hardBreakBefore?: boolean
}

export type LaidTextLine = {
  segments: Array<{ text: string; style: TextRunStyle; x: number; width: number }>
  width: number
  height: number
  baselineY: number
  ink: Box
}

export type TextLayoutResult = {
  lines: LaidTextLine[]
  contentWidth: number
  contentHeight: number
  minWidth: number
  ink: Box
  fontSize: number
  autoWrap: boolean
  overflowFixed: boolean
}

export type ShapeKind = 'rect' | 'circle' | 'ellipse'

export type LineGeometry =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'polyline' | 'polygon'; points: Array<{ x: number; y: number }> }
  | { kind: 'path'; d: string }

export type LayoutNodeBase = {
  path: string
  id?: string
  tag: string
  x: number
  y: number
  width: number
  height: number
  ink: Box
  opacity: number
  rotate: number
  /** 绕水平轴，度。正角度让盒子上边远离观众。没有祖先 perspective 时不投影。 */
  rotateX?: number
  /** 绕竖直轴，度。没有祖先 perspective 时不投影。 */
  rotateY?: number
  /** 沿平面法线，像素。正方向朝观众。 */
  z?: number
  scale: number
  /** 变换支点，缺省为盒子中心。 */
  origin?: Anchor
  background?: string
  border?: { width: number; color: string }
  borderRadius?: number
  padding: { top: number; right: number; bottom: number; left: number }
  draw?: DrawFn
  attr: Record<string, string>
  style: StyleMap
  computed: DrawComputedStyle
  text: string
  shadow?: ShadowSpec
  glow?: GlowSpec
  innerShadow?: ShadowSpec
  innerGlow?: GlowSpec
  blur?: number
  backdropBlur?: number
  noise?: NoiseSpec
  overlay?: OverlaySpec
  glass?: GlassSpec
  colorFilter?: ColorFilterSpec[]
  blend?: BlendMode
  grade?: GradeSpec
  /** 纯色或渐变，alpha 是调色强度。 */
  gradeMask?: string
}

export type LayerLayoutNode = LayoutNodeBase & {
  kind: 'layer'
  children: LayoutNode[]
  /** 缺省为 visible。hidden 时按盒子裁剪子元素。 */
  overflow?: 'visible' | 'hidden'
  /** 直接子元素共用的视距，像素。灭点是这一层盒子的中心。 */
  perspective?: number
  /**
   * 蒙版内容，坐标系是这一层的局部像素。
   * 绘制时只取 alpha，不进入 children，不参与布局。
   */
  mask?: LayoutNode[]
}

export type FlexLayoutNode = LayoutNodeBase & {
  kind: 'flex'
  direction: 'row' | 'column'
  children: LayoutNode[]
}

export type GroupLayoutNode = LayoutNodeBase & {
  kind: 'group'
  children: LayoutNode[]
  /** SVG 变换，把子元素的局部坐标变到父级。 */
  svg: { a: number; b: number; c: number; d: number; e: number; f: number }
}

export type TextLayoutNode = LayoutNodeBase & {
  kind: 'text'
  textLayout: TextLayoutResult
  textAlign: 'left' | 'center' | 'right'
}

export type ImageLayoutNode = LayoutNodeBase & {
  kind: 'image'
  bitmap: Canvas | Image | null
  objectFit: 'fill' | 'contain' | 'cover' | 'none'
  objectPosition: { x: number; y: number }
}

export type ShapeLayoutNode = LayoutNodeBase & {
  kind: 'shape'
  shape: ShapeKind
  fill: string
  stroke: string
  strokeWidth: number
  rx?: number
  r?: number
  rxEllipse?: number
  ry?: number
  dash?: number[]
}

export type LineLayoutNode = LayoutNodeBase & {
  kind: 'line'
  geometry: LineGeometry
  stroke: string
  strokeWidth: number
  fill: string
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'round' | 'bevel' | 'miter'
  dash?: number[]
}

export type CustomLayoutNode = LayoutNodeBase & {
  kind: 'custom'
}

export type MeshSpec =
  | { type: 'sphere'; r: number }
  | { type: 'box'; depth: number }
  | { type: 'extrude'; d: string; depth: number }
  | { type: 'model'; src: string; file?: string; span?: { x: number; y: number; z: number } }

export type MeshLayoutNode = LayoutNodeBase & {
  kind: 'mesh'
  mesh: MeshSpec
  fill: string
}

export type LayoutNode =
  | LayerLayoutNode
  | FlexLayoutNode
  | GroupLayoutNode
  | TextLayoutNode
  | ImageLayoutNode
  | ShapeLayoutNode
  | LineLayoutNode
  | CustomLayoutNode
  | MeshLayoutNode

export type FvgDocument = {
  width: number
  height: number
  background: string
  color: string
  fontFamily: string
  safe: { top: number; right: number; bottom: number; left: number }
  /** 根 layer 写了 bleed。着墨超出画布不报 overflow-canvas。 */
  bleed?: boolean
  root: LayerLayoutNode
  issues: Issue[]
  /** path → `file:line:column`。只有从 JSX 进来的树才有。 */
  sources?: Map<string, string>
}

export type RenderOptions = {
  scale?: number
  debug?: boolean
  baseDir?: string
  fontsCacheDir?: string
  /** 当前帧的时间，单位秒。缺省为 0。 */
  t?: number
}
