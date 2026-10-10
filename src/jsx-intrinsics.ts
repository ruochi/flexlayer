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
  /** 结构化数据。`draw` 里读 `el.data`，不要把对象塞进别的属性。 */
  data?: unknown
  /** 预期中的问题码，例如 `overflow-canvas: 出血图`。 */
  expect?: string
  children?: JsxChild
  [name: string]: JsxAttr | unknown
}

/** 文字和图片。视觉属性写 style。 */
type FvgHtml = FvgNodeBase & {
  style?: FvgStyle
}

type FvgGraphic = FvgNodeBase & {
  /** 只在 mask 里：add、subtract、intersect、xor */
  op?: string
}

type FvgPositioned = FvgGraphic & {
  x?: number | string
  y?: number | string
  anchor?: string
  /** ink 时按子树着墨对齐，box 时按布局盒子。 */
  'anchor-box'?: string
}

/** circle、ellipse、sphere、cylinder、torus 的圆心。 */
type FvgCenter = {
  cx?: number | string
  cy?: number | string
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
     * 根画布与定位容器。`x`、`y` 是左上角，没写是 0。
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
        /** 舞台坐标里被取的矩形 `x y w h`。这一层的宽高是屏幕上的取景窗 */
        view?: string
        opacity?: number | string
        rotate?: number | string
        rotateX?: number | string
        rotateY?: number | string
        /** 像素，正方向朝观众 */
        z?: number | string
        /** 直接子元素的视距，像素 */
        perspective?: number | string
        scale?: number | string
        /** 支点。九宫格，或 `120 80`、`30% 40%` */
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
     * 里面写 rect / circle / ellipse / polygon / path / img / g。运算用 op，不沿用 CSS。
     */
    mask: FvgGraphic & {
      /** 羽化半径，像素 */
      feather?: number | string
      /** true 时反选 */
      invert?: string | boolean
    }
    /** 正常渲染不画。render --preview 才出选区预览 */
    preview: FvgGraphic & {
      /** #id，指向要预览的 layer */
      of?: string
      /** overlay checker black white edges */
      show?: string
    }
    use: FvgPositioned & {
      href?: string
      rotate?: number | string
      scale?: number | string
      /** 忽略；色块用 rect / HTML / draw */
      background?: string
    }
    rect: FvgShape
    circle: FvgShape & FvgCenter
    ellipse: FvgShape & FvgCenter
    g: FvgGraphic & {
      transform?: string
      fill?: string
      stroke?: string
      opacity?: number | string
      'stroke-width'?: number | string
    }
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
      FvgCenter &
      FvgEffects & {
        r?: number | string
        fill?: string
        /** 可见折棱和轮廓。球只画轮廓圆 */
        stroke?: string
        'stroke-width'?: number | string
        /** 被这只球自己挡住的棱。要和 stroke 一起写 */
        hidden?: string
        /** 可见线在交叉处把更远的线断开，屏幕像素 */
        halo?: number | string
        /** matte、plastic、metal、glass。不写是磨砂。粗糙度跟在名字后面 */
        material?: string
        rotate?: number | string
        rotateX?: number | string
        rotateY?: number | string
        z?: number | string
        scale?: number | string
        opacity?: number | string
      }
    /** 竖直圆柱。轴沿画面上下，圆截面朝镜头鼓出 r。 */
    cylinder: FvgPositioned &
      FvgCenter &
      FvgEffects & {
        r?: number | string
        /** 沿画面竖直方向的长度 */
        height?: number | string
        /** 上下圆口的圆角半径。不写 round 时两端都圆 */
        rx?: number | string
        /** top、bottom 或 all。不写是两端 */
        round?: string
        fill?: string
        stroke?: string
        'stroke-width'?: number | string
        hidden?: string
        /** 可见线在交叉处把更远的线断开，屏幕像素 */
        halo?: number | string
        /** matte、plastic、metal、glass。不写是磨砂。粗糙度跟在名字后面 */
        material?: string
        rotate?: number | string
        rotateX?: number | string
        rotateY?: number | string
        z?: number | string
        scale?: number | string
        opacity?: number | string
      }
    /** 躺在所在平面里的圆环。r 是环心到管心，tube 是管半径。 */
    torus: FvgPositioned &
      FvgCenter &
      FvgEffects & {
        r?: number | string
        tube?: number | string
        fill?: string
        stroke?: string
        'stroke-width'?: number | string
        hidden?: string
        /** 可见线在交叉处把更远的线断开，屏幕像素 */
        halo?: number | string
        /** matte、plastic、metal、glass。不写是磨砂。粗糙度跟在名字后面 */
        material?: string
        rotate?: number | string
        rotateX?: number | string
        rotateY?: number | string
        z?: number | string
        scale?: number | string
        opacity?: number | string
      }
    /** 沿路径扫出的圆管。d 是中心线，r 是管半径。 */
    tube: FvgPositioned &
      FvgEffects & {
        d?: string
        r?: number | string
        fill?: string
        stroke?: string
        'stroke-width'?: number | string
        hidden?: string
        /** 可见线在交叉处把更远的线断开，屏幕像素 */
        halo?: number | string
        /** matte、plastic、metal、glass。不写是磨砂。粗糙度跟在名字后面 */
        material?: string
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
        /** 棱的圆角半径。不写 round 时 12 条棱都圆 */
        rx?: number | string
        /** 哪些棱。front、x、front-top；不写是全部 */
        round?: string
        fill?: string
        stroke?: string
        'stroke-width'?: number | string
        /** 被挡住的棱。要和 stroke 一起写 */
        hidden?: string
        /** 可见线在交叉处把更远的线断开，屏幕像素 */
        halo?: number | string
        material?: string
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
        stroke?: string
        'stroke-width'?: number | string
        hidden?: string
        /** 可见线在交叉处把更远的线断开，屏幕像素 */
        halo?: number | string
        material?: string
        rotate?: number | string
        rotateX?: number | string
        rotateY?: number | string
        z?: number | string
        scale?: number | string
        opacity?: number | string
      }
    /** 外部 glb。位置和宽高写在外包的 layer 上，src 只写在这里。面色来自文件。 */
    model: FvgGraphic & {
      src?: string
      fill?: string
      stroke?: string
      'stroke-width'?: number | string
      hidden?: string
      /** 可见线在交叉处把更远的线断开，屏幕像素 */
      halo?: number | string
      material?: string
    }
    curve: FvgGraphic & FvgLinePaint & { points?: string; closed?: boolean | string }
    h1: FvgHtml
    h2: FvgHtml
    h3: FvgHtml
    p: FvgHtml
    /** 排布容器。可以直接放文字、图片，以及写了宽高的 layer。 */
    div: FvgHtml
    span: FvgHtml
    strong: FvgHtml
    b: FvgHtml
    em: FvgHtml
    i: FvgHtml
    u: FvgHtml
    br: FvgHtml
    /** HTML 图片。src、alt 是属性，宽高写 style。`image` 与 `img` 相同。 */
    img: FvgHtml & {
      src?: string
      alt?: string
      /** 只在 mask 里：alpha 或 luma */
      channel?: string
      /** 只在 mask 里：编号，例如 "3 5" */
      pick?: string
      /** 只在 mask 里：subject、mask 或 regions，读缓存不跑模型 */
      derive?: string
    }
    image: FvgHtml & { src?: string; alt?: string }
    math: FvgHtml
    mrow: FvgHtml
    mi: FvgHtml
    mn: FvgHtml
    mo: FvgHtml
    mtext: FvgHtml
    mfrac: FvgHtml
    msub: FvgHtml
    msup: FvgHtml
    msubsup: FvgHtml
    msqrt: FvgHtml
    mroot: FvgHtml
    munder: FvgHtml
    mover: FvgHtml
    munderover: FvgHtml
    mtable: FvgHtml
    mtr: FvgHtml
    mtd: FvgHtml
  }
}
