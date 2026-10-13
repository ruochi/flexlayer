import type { Canvas, Image, SKRSContext2D } from '@napi-rs/canvas'

export type { SKRSContext2D }

export type StyleMap = Record<string, string>

export type DrawComputedStyle = {
  color: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  opacity: number
}

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
  /** 这条问题出现的帧区间，两端都包含。抽查序列里连续出现的帧合成一段。 */
  frames?: Array<[number, number]>
  /** `expect` 把这条问题降成 info 时，作者写的原因。 */
  expected?: string
  /** `unused-expect` 没有对上的问题码。 */
  expect?: { code: string }
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

/** 盒子内的一根轴。px 从左或上起算，percent 是 0 到 100。 */
export type OriginAxis = { unit: 'px'; value: number } | { unit: 'percent'; value: number }

/** 旋转和缩放的支点，相对布局盒子的左上角。缺省是中心。 */
export type Origin = { x: OriginAxis; y: OriginAxis }

export type TextLineReport = {
  text: string
  box: Rect
}

/** 景深。aperture 是无限远处的模糊半径，成片像素。focus 是从机位沿视线量的对焦距离。 */
export type DofSpec = { aperture: number; focus: number; maxBlur: number }

export type ShadowSpec = { x: number; y: number; blur: number; spread: number; color: string }
export type GlowSpec = { blur: number; spread: number; color: string }
export type InkStrokePosition = 'outside' | 'inside' | 'center'
/** 一层墨迹描边。width 是到墨迹的总距离。 */
export type InkStrokeSpec = { width: number; color: string; position: InkStrokePosition }
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

/** 已经套到某个节点上的滤镜。绘制时按 kind 和 order 排序。 */
export type AppliedFilter = {
  name: string
  kind: 'pixel' | 'canvas'
  order: number
  /** 注册顺序，order 相同时用它。 */
  seq: number
  spec: unknown
  /** 遮罩 paint，alpha 是强度。 */
  mask?: string
  /** 写在根 layer 上时连画布底色一起处理。 */
  includeBackdrop: boolean
}

export type FilterReport = {
  name: string
  mask?: string
  value: unknown
}

/** 着墨相对布局盒子的四边内缩。伸出盒子时为负。 */
export type InkOffset = {
  left: number
  top: number
  right: number
  bottom: number
}

export type MaskOp = 'add' | 'subtract' | 'intersect' | 'xor'

/** 蒙版里的一步运算。`changed` 是这一步改变的面积占这一层布局盒的比例。 */
export type MaskOpReport = {
  op: MaskOp
  changed: number
  path: string
  source?: string
}

/** 按这一层布局盒里的像素量。`area`、`softEdge` 是这一层自己的像素，不乘 `scale`。 */
export type MaskReport = {
  /** 留下的比例，0 到 1。半透明按 alpha 折算。 */
  area: number
  /** 留下来的部分在画布上的外接矩形。全部藏起来时是 null。在透视平面上不写。 */
  ink?: Rect | null
  /** alpha 不低于一半的连通块个数，八连通。 */
  pieces: number
  /** 软边的平均宽度，像素。硬边接近 0 到 1。 */
  softEdge: number
  /** 每一步运算。没有子步骤时不写。 */
  ops?: MaskOpReport[]
}

/** `<preview of="#id">`。正常渲染不画，`--preview` 才出图。 */
export type PreviewSpec = {
  of: string
  show: Array<'overlay' | 'checker' | 'black' | 'white' | 'edges'>
  path: string
  source?: string
}

export type ElementReport = {
  path: string
  id?: string
  tag: string
  /** 源码位置，例如 `examples/hello.tsx:18:5`。 */
  source?: string
  box: Rect
  /** 变换并裁剪后的着墨外接矩形。有透视时是投影后的范围。 */
  ink: Rect
  /** anchor-box="ink" 生效时为 ink。 */
  anchorBox?: 'box' | 'ink'
  /** 着墨相对布局盒子的四边内缩，取旋转和缩放之前的值。 */
  inkOffset?: InkOffset
  /** 投影后的四个角，画布坐标，顺序为左上、右上、右下、左下。没有透视投影时不写。 */
  quad?: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
  /** 这一层是镜头时，舞台坐标里被取的矩形。 */
  view?: ViewRect
  /**
   * 声明尺寸到屏幕尺寸的倍数，两轴缩放绝对值的几何平均。
   * 含祖先的 `scale` 和 `view`。等于 1 时不写。最小字号和效果外扩乘这个数。
   */
  screenScale?: number
  /** 阴影、光晕、图层模糊或玻璃可能占用的范围。没有外扩效果时不写。 */
  effect?: Rect
  /** 这一层写了 `<mask>` 时，蒙版画成位图之后量出来的数。 */
  mask?: MaskReport
  /** 逐层相乘后的有效透明度。 */
  opacity: number
  fontSize?: number
  lines?: TextLineReport[]
  /**
   * 带 id 的行内标签。没有单独的布局盒：`box` 和 `ink` 都是这段文字乘上父元素变换后的外接矩形。
   * 不参与 `outside-safe`、`min-font-size` 和 `text-overlap`。
   */
  inline?: boolean
  shadow?: ShadowSpec
  glow?: GlowSpec
  innerShadow?: ShadowSpec
  innerGlow?: GlowSpec
  /** 按墨迹距离描边，从内到外。 */
  inkStroke?: InkStrokeSpec[]
  blur?: number
  /** 这一层镜头在采样点上的景深模糊半径，成片像素。没开景深或不糊时不写。 */
  defocus?: number
  backdropBlur?: number
  noise?: NoiseSpec
  overlay?: OverlaySpec
  glass?: GlassSpec
  filter?: ColorFilterSpec[]
  blend?: BlendMode
  /** 预设展开后的调色参数。 */
  grade?: GradeSpec
  gradeMask?: string
  /** 已套用的滤镜，像素滤镜在前，画布滤镜在后。 */
  filters?: FilterReport[]
}

export type LayerReport = {
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
  /** 字形颜料。写了就盖过 color。纯色、渐变或矩阵渐变。 */
  fill?: string
  /** 省略是 normal。em / i 为 italic。 */
  fontStyle?: 'normal' | 'italic'
  /** u 加下划线。 */
  underline?: boolean
  /** 行内标签自己的背景。不继承。铺在这一段文字的行盒上。 */
  background?: string
  /** 行内背景来自 background 还是 background-color。排版后去掉。 */
  backgroundProp?: 'background' | 'background-color'
  /** 只影响绘制。1 是不透明。低于 0.01 不进着墨。 */
  opacity?: number
  /** 绘制时平移，像素。不改前进宽度。 */
  translateX?: number
  translateY?: number
  /** 绘制时绕字心旋转，角度。 */
  rotate?: number
  /** 绘制时绕字心缩放。 */
  scaleX?: number
  scaleY?: number
  /** 每个字单独绕自己的字心。 */
  splitChars?: boolean
  /** 不拆字时，同一组绕整段字心画一次。 */
  paintGroup?: string
}

/** 带 id 的行内标签。最内层有 id 的那段拥有这些字；里面没写 id 的行内标签沿用外层。 */
export type InlineOwner = {
  id: string
  /** 如 `layer/p[0]/span[0]`，序号是元素子节点的序号。 */
  path: string
  tag: string
}

export type TextSegment = {
  text: string
  style: TextRunStyle
  hardBreakBefore?: boolean
  owner?: InlineOwner
  /** 行内替换元素（图片）。宽度参与断行，不参与 fillText。 */
  atom?: { width: number; height: number; key: number }
}

export type LaidTextSegment = {
  text: string
  style: TextRunStyle
  x: number
  width: number
  owner?: InlineOwner
  /** 变换后的着墨，坐标和这一行的 ink 相同。没变换时不写。透明度低于 0.01 时宽高为 0。 */
  paintInk?: Box
}

export type LaidTextLine = {
  segments: LaidTextSegment[]
  width: number
  height: number
  /** 相对文字内容区顶部。竖排的字距加在行与行之间，不在 height 里。 */
  y: number
  baselineY: number
  /** 变换后的着墨。没变换时就是字形本身。 */
  ink: Box
  /** 没变换时的着墨。只在和 ink 不同时写上，行盒仍按这个排。 */
  flowInk?: Box
  /** 这一行里的图片，坐标相对文字内容区左上角。 */
  atoms?: Array<{ x: number; y: number; width: number; height: number; key: number }>
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
  /** anchor-box="ink" 生效时为 ink。 */
  anchorBox?: 'box' | 'ink'
  /** 着墨相对布局盒子的四边内缩，取旋转和缩放之前的值。 */
  inkOffset?: InkOffset
  opacity: number
  /** 蒙版里这一笔和已有结果的运算。不在蒙版里时没有。 */
  maskOp?: MaskOp
  rotate: number
  /** 绕水平轴，度。正角度让盒子上边远离观众。没有祖先 perspective 时不投影。 */
  rotateX?: number
  /** 绕竖直轴，度。没有祖先 perspective 时不投影。 */
  rotateY?: number
  /** 沿平面法线，像素。正方向朝观众。 */
  z?: number
  scaleX: number
  scaleY: number
  /** 变换支点，缺省为盒子中心。 */
  origin?: Origin
  background?: string
  border?: { width: number; color: string }
  borderRadius?: number
  padding: { top: number; right: number; bottom: number; left: number }
  /** `data` 属性。没有时是 undefined。 */
  data?: unknown
  attr: Record<string, string>
  style: StyleMap
  computed: DrawComputedStyle
  text: string
  shadow?: ShadowSpec
  glow?: GlowSpec
  innerShadow?: ShadowSpec
  innerGlow?: GlowSpec
  inkStroke?: InkStrokeSpec[]
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
  /** grade、filter 以及 registerFilter 登记的滤镜。 */
  filters?: AppliedFilter[]
  /** 报告里的源码位置。脚本运行出错时用它。 */
  source?: string
  /** 子元素沿父链进入外层镜头。压平效果仍会把子树收成一张图。 */
  preserve3d?: boolean
  /** 不吃景深。这一层表面保持清楚，仍挡住后面的东西。 */
  sharp?: boolean
  /** 不写入这台场景的主光阴影图。不写时不透明表面会投影子。 */
  castShadow?: false
  /** 主光被挡住时不变暗。不写时接影子。 */
  receiveShadow?: false
}

export type LayerLayoutNode = LayoutNodeBase & {
  kind: 'layer'
  children: LayoutNode[]
  /** 缺省为 visible。hidden 时按盒子裁剪子元素。 */
  overflow?: 'visible' | 'hidden'
  /** 直接子元素共用的视距，像素。灭点是这一层盒子的中心。`parallel` 是平行投影。 */
  perspective?: number | 'parallel'
  /** 列主序视图矩阵。缺省是单位矩阵，不乘。 */
  cameraView?: number[]
  /** 灭点相对盒子中心的偏移，像素。不写是 0。 */
  vanishX?: number
  vanishY?: number
  /** 机位不是「只有焦距、对准盒子中心」时为真。没有三维姿态的子元素也要投影。 */
  cameraMoved?: boolean
  /** 写了 aperture 才有。平行投影没有。 */
  dof?: DofSpec
  /** 这台镜头不建主光阴影图。深度遮挡仍在。不写时不透明表面互相投影子。 */
  shadows?: 'none'
  /**
   * 蒙版内容，坐标系是这一层的局部像素。
   * 绘制时只取 alpha，不进入 children，不参与布局。
   */
  mask?: LayoutNode[]
  /** 蒙版羽化半径，像素。 */
  maskFeather?: number
  /** 蒙版反选。 */
  maskInvert?: boolean
  /** 舞台坐标里被取的矩形。这一层的宽高是屏幕上的取景窗。 */
  view?: ViewRect
}

export type FlexLayoutNode = LayoutNodeBase & {
  kind: 'flex'
  direction: 'row' | 'column'
  children: LayoutNode[]
  /** 边框盒顶部到基线的距离。公式用来参加横排的 baseline 对齐。 */
  baseline?: number
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
  /** 跟文字排在同一段里的图片。坐标相对这个文字盒子。 */
  inlines?: ImageLayoutNode[]
}

export type ImageLayoutNode = LayoutNodeBase & {
  kind: 'image'
  bitmap: Canvas | Image | null
  objectFit: 'fill' | 'contain' | 'cover' | 'none'
  objectPosition: { x: number; y: number }
  /** 蒙版里读这张图的哪个通道。 */
  maskChannel?: 'alpha' | 'luma'
  /** 蒙版里只保留这些编号。编号图的灰度值就是编号。 */
  maskPick?: number[]
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

/** `<canvas>`。`width`/`height` 是布局尺寸。脚本画完后 `bitmap` 才有像素。 */
export type CanvasLayoutNode = LayoutNodeBase & {
  kind: 'canvas'
  bitmapWidth: number
  bitmapHeight: number
  bitmap: Canvas | null
}

/** 长方体 12 条棱。名字是两个面，不分先后；`top` 是画面上方。 */
export type BoxEdge =
  | 'front-top'
  | 'front-bottom'
  | 'front-left'
  | 'front-right'
  | 'back-top'
  | 'back-bottom'
  | 'back-left'
  | 'back-right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export type CylinderRim = 'top' | 'bottom'

export type MeshSpec =
  | { type: 'sphere'; r: number }
  | { type: 'box'; depth: number; rx: number; edges: readonly BoxEdge[] }
  | { type: 'extrude'; d: string; depth: number; fillRule: 'nonzero' | 'evenodd' }
  | { type: 'cylinder'; r: number; height: number; rx: number; rims: readonly CylinderRim[]; axis?: 'z' }
  | { type: 'torus'; r: number; tube: number }
  | { type: 'tube'; d: string; r: number }
  | {
      type: 'model'
      src: string
      file?: string
      span?: { x: number; y: number; z: number }
      /** 1 个模型单位对应的像素。写了就保留原始坐标，不再 contain。 */
      unit?: number
      /** 模型空间里的包围盒。只在写了 `unit` 时留下，给着墨范围用。 */
      bounds?: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
      /** 内存网格的内容哈希。文件模型不写。 */
      revision?: string
    }

/** 网格表面。不写时是 matte：磨砂塑料，主光乘 fill，没有高光。粗糙度 0 到 1，越大高光和反射越散。磨砂不看粗糙度。 */
export type MeshMaterial = {
  kind: 'matte' | 'plastic' | 'metal' | 'glass'
  roughness: number
}

/** 无限平面。不写 fill 时透明，只接网格沿主光投下的影子。旋转和 box 同一套。 */
export type GroundLayoutNode = LayoutNodeBase & {
  kind: 'ground'
  /** 不写、`none`、`transparent` 时没有地面颜色。 */
  fill: string | null
  shadowBlur: number
  shadowOpacity: number
  shadowColor: string
}

export type MeshLayoutNode = LayoutNodeBase & {
  kind: 'mesh'
  mesh: MeshSpec
  fill: string
  material?: MeshMaterial
  /** 可见折棱和轮廓。`none` 不描。 */
  stroke: string
  /** 屏幕像素，依次是轮廓、折棱、隐藏线。只写一个数时三档相同。 */
  strokeWidths: [number, number, number]
  /** 可见线压过更远的线时，交叉处两侧断开的屏幕像素。0 不断开。 */
  halo: number
  /** 被这只网格自己挡住的棱。`none` 不画。 */
  hidden: string
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
  | CanvasLayoutNode
  | MeshLayoutNode
  | GroundLayoutNode

/** `view="x y w h"`。x y 是舞台坐标，w h 是被取的宽高。 */
export type ViewRect = { x: number; y: number; width: number; height: number }

/** 根上的 `min-font`。`screen` 是 min(宽, 高) / 1080 × 24，`print` 是 × 12。 */
export type MinFontSpec = { mode: 'screen' | 'print' | 'none' } | { mode: 'px'; px: number }

export type LayerScript = {
  path: string
  source?: string
  /** `.layer` 里的脚本文本。 */
  body?: string
  /** `.tsx` 里的闭包。不能跨进子进程。 */
  fn?: () => void
}

export type LayerDocument = {
  width: number
  height: number
  background: string
  color: string
  fontFamily: string
  /** 不写时按 screen。 */
  minFont?: MinFontSpec
  safe: { top: number; right: number; bottom: number; left: number }
  root: LayerLayoutNode
  issues: Issue[]
  scripts: LayerScript[]
  /** `<preview>`。正常渲染不画。 */
  previews?: PreviewSpec[]
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
  /** 当前帧号。缺省为 0。 */
  frame?: number
  /** 每秒帧数。缺省为 0。 */
  fps?: number
  /** 跳过 `<script>`。画布保持透明。 */
  noScript?: boolean
  /** 网格超采样。1、2 或 4，缺省 4。草稿可以传 1 或 2。 */
  meshSamples?: 1 | 2 | 4
  /**
   * 网格场景缓存上限，字节。false 关闭。
   * 缺省 256MB，也可用环境变量 FLEXLAYER_MESH_CACHE（字节数，或 0 / off）。
   */
  meshCache?: number | false
  /**
   * 缺省 `'png'`。`'rgba'` 时单帧渲染返回不预乘的原始像素，不编码 PNG。
   * 节点已经在手边时直接交给 `renderLayer`。
   */
  format?: 'png' | 'rgba'
}
