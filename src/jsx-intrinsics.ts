import type { FvgNode } from './parse.js'
import type { DrawFn } from './types.js'

/** HTML 用 style；layer 和图形用属性。 */
type FvgStyle = string | Record<string, string | number | undefined>

type JsxChild = string | number | boolean | null | undefined | FvgNode | JsxChild[]

/**
 * 不认识的属性名留给 draw，和 .layer 一样保留。
 * 属性该写在哪由检查报 invalid-attr，不在这里再用类型禁一遍。
 */
type JsxAttr = string | number | boolean | undefined | FvgStyle | DrawFn | JsxChild

type FvgNodeBase = {
  id?: string
  draw?: DrawFn
  children?: JsxChild
  [name: string]: JsxAttr
}

/** 文字和图片。视觉属性写 style。 */
type FvgHtml = FvgNodeBase & {
  style?: FvgStyle
}

type FvgGraphic = FvgNodeBase

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
  rotate?: number | string
  scale?: number | string
  origin?: string
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
    rotate?: number | string
    rotateX?: number | string
    rotateY?: number | string
    scale?: number | string
    origin?: string
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
