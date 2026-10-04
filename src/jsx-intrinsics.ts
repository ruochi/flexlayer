import type { FvgNode } from './parse.js'
import type { DrawFn } from './types.js'

/** HTML 用 style；layer 和图形用属性。 */
type FvgStyle = string | Record<string, string | number | undefined>

type JsxChild = string | number | boolean | null | undefined | FvgNode | JsxChild[]

/**
 * 不认识的属性名留给 draw，和 .layer 一样保留。
 * 放错位置的已知属性另外标成 never，否则索引签名会把它们也放行。
 */
type JsxAttr = string | number | boolean | undefined | FvgStyle | DrawFn | JsxChild

type FvgNodeBase = {
  id?: string
  draw?: DrawFn
  children?: JsxChild
  [name: string]: JsxAttr
}

type NoStyle = { style?: never }

/**
 * TypeScript 不检查 JSX 里的连字符属性。这些名字属于 style，写成 never 才会报错。
 */
type HtmlHyphenBan = {
  'font-size'?: never
  'font-family'?: never
  'font-weight'?: never
  'line-height'?: never
  'letter-spacing'?: never
  'flex-direction'?: never
  'flex-grow'?: never
  'flex-shrink'?: never
  'align-items'?: never
  'justify-content'?: never
  'writing-mode'?: never
  'object-fit'?: never
  'object-position'?: never
  'max-width'?: never
  'max-height'?: never
  'min-width'?: never
  'min-height'?: never
  'border-radius'?: never
  'white-space'?: never
  'text-align'?: never
}

/** 写在 HTML 属性上会进 style 或只属于图形。标成 never，索引签名才拦得住。 */
type HtmlMisplacedBan = {
  cx?: never
  cy?: never
  anchor?: never
  r?: never
  rx?: never
  ry?: never
  fill?: never
  stroke?: never
  strokeWidth?: never
  'stroke-width'?: never
  width?: never
  height?: never
  opacity?: never
  rotate?: never
  rotateX?: never
  rotateY?: never
  z?: never
  scale?: never
  origin?: never
  perspective?: never
  background?: never
  padding?: never
  gap?: never
  border?: never
  color?: never
  flex?: never
  x1?: never
  y1?: never
  x2?: never
  y2?: never
  points?: never
  d?: never
}

/** 文字和图片。视觉属性写 style，不写 cx、fill。 */
type FvgHtml = FvgNodeBase &
  HtmlHyphenBan &
  HtmlMisplacedBan & {
    style?: FvgStyle
  }

type FvgGraphic = FvgNodeBase & NoStyle

type FvgPositioned = FvgGraphic & {
  cx?: number | string
  cy?: number | string
  anchor?: string
}

/** 线条类。stroke-width 默认 4，fill 默认 none。 */
type FvgLinePaint = {
  fill?: string
  stroke?: string
  strokeWidth?: number | string
  'stroke-width'?: number | string
  'stroke-dasharray'?: string
  'stroke-linecap'?: string
  'stroke-linejoin'?: string
  opacity?: number | string
}

type FvgEffects = {
  // jsx-effects:begin
  /** 0 8 16 #00000055 */
  shadow?: string
  /** 56 #f3ead4 */
  glow?: string
  /** 0 8 16 #00000055 */
  'inner-shadow'?: string
  /** 28 #7ec8ff */
  'inner-glow'?: string
  /** 6 */
  blur?: number | string
  /** 16 */
  'backdrop-blur'?: number | string
  /** clear */
  glass?: string
  /** 0.08 */
  noise?: string
  /** saturate(1.1) */
  filter?: string
  /** multiply */
  blend?: string
// jsx-effects:end
}

/** 仅 layer：纯色/渐变叠加 */
type FvgLayerOverlay = {
  // jsx-overlay:begin
  /** #00000066 */
  overlay?: string
// jsx-overlay:end
}

/** 仅 layer：调色。例如 grade="lomo 0.8, fade 0.1"，grade-mask 的 alpha 是强度 */
type FvgLayerGrade = {
  // jsx-grade:begin
  /** lomo 0.8, fade 0.1 */
  grade?: string
  /** radial-gradient(#fff0 30%, #fff) */
  'grade-mask'?: string
// jsx-grade:end
}

type FvgShape = FvgPositioned &
  FvgEffects & {
    r?: number | string
    rx?: number | string
    ry?: number | string
    width?: number | string
    height?: number | string
    fill?: string
    stroke?: string
    strokeWidth?: number | string
    'stroke-width'?: number | string
    opacity?: number | string
  }

export namespace JSX {
  export type Element = FvgNode
  export interface ElementChildrenAttribute {
    children: {}
  }
  export interface IntrinsicAttributes {
    key?: string | number
  }
  export interface IntrinsicElements {
    font: { family?: string; src?: string }
    /**
     * 根画布与定位容器。
     * `background` 只在根上当画布底色；嵌套 layer 不填背景，色块用 rect / HTML / draw。
     */
    layer: FvgPositioned &
      FvgEffects &
      FvgLayerOverlay &
      FvgLayerGrade & {
        width?: number | string
        height?: number | string
        /** 仅根节点：画布底色。嵌套 layer 写了会 warn 并忽略 */
        background?: string
        color?: string
        'font-family'?: string
        safe?: number | string
        opacity?: number | string
        rotate?: number | string
        rotateX?: number | string
        rotateY?: number | string
        /** 像素，正方向朝观众 */
        z?: number | string
        /** 直接子元素的视距，像素 */
        perspective?: number | string
        scale?: number | string
        origin?: string
        overflow?: string
        border?: string
        'border-radius'?: string | number
      }
    /** 子标签：正文 JS，可用 ctx、el；不参与布局 */
    draw: FvgGraphic
    symbol: FvgGraphic & { width?: number | string; height?: number | string }
    /**
     * 蒙版。只作为 layer 的直接子元素。
     * 里面写 rect / circle / ellipse / polygon / path / img；省略 fill 为 #fff，只取 alpha。
     */
    mask: FvgGraphic
    use: FvgPositioned & {
      href?: string
      rotate?: number | string
      scale?: number | string
      /** 忽略；色块用 rect / HTML / draw */
      background?: string
    }
    rect: FvgShape & { x1?: number | string; y1?: number | string; x2?: number | string; y2?: number | string }
    circle: FvgShape
    ellipse: FvgShape & { x1?: number | string; y1?: number | string; x2?: number | string; y2?: number | string }
    line: FvgGraphic &
      FvgLinePaint & {
        x1?: number | string
        y1?: number | string
        x2?: number | string
        y2?: number | string
      }
    arrow: FvgGraphic &
      FvgLinePaint & {
        x1?: number | string
        y1?: number | string
        x2?: number | string
        y2?: number | string
        head?: number | string
      }
    polyline: FvgGraphic & FvgLinePaint & { points?: string }
    polygon: FvgGraphic & FvgLinePaint & { points?: string }
    path: FvgGraphic & FvgLinePaint & { d?: string }
    sphere: FvgPositioned &
      FvgEffects & {
        r?: number | string
        fill?: string
        rotate?: number | string
        rotateX?: number | string
        rotateY?: number | string
        z?: number | string
        scale?: number | string
        opacity?: number | string
      }
    box: FvgPositioned &
      FvgEffects & {
        width?: number | string
        height?: number | string
        depth?: number | string
        fill?: string
        rotate?: number | string
        rotateX?: number | string
        rotateY?: number | string
        z?: number | string
        scale?: number | string
        opacity?: number | string
      }
    extrude: FvgPositioned &
      FvgEffects & {
        d?: string
        depth?: number | string
        fill?: string
        rotate?: number | string
        rotateX?: number | string
        rotateY?: number | string
        z?: number | string
        scale?: number | string
        opacity?: number | string
      }
    /** 外部 glb。位置和宽高写在外包的 layer 上，src 只写在这里。 */
    model: FvgGraphic & { src?: string }
    curve: FvgGraphic & FvgLinePaint & { points?: string; closed?: boolean | string }
    h1: FvgHtml
    h2: FvgHtml
    h3: FvgHtml
    p: FvgHtml
    div: FvgHtml
    span: FvgHtml
    strong: FvgHtml
    b: FvgHtml
    em: FvgHtml
    br: FvgHtml
    /** HTML 图片。src、alt 是属性，宽高写 style。`image` 与 `img` 相同。 */
    img: FvgHtml & { src?: string; alt?: string }
    image: FvgHtml & { src?: string; alt?: string }
  }
}
