# Flex Layer 速查

写法规则见 [AGENTS.md](../AGENTS.md) 的硬性约定。数字都是像素，y 轴向下。根元素 `<layer width height>` 就是一个 layer。

## 结构

| 标签 | 做什么 |
| --- | --- |
| `layer` | 根画布兼定位容器。根上写 `width` `height` `background`（画布底色）`color` `safe`；定位用 `cx` `cy` `anchor`，还有 `opacity` `rotate` `rotateX` `rotateY` `z` `scale` `origin`。`perspective` 只写在这一层，是直接子元素共用的视距。可嵌套 |
| `draw` | 子标签。正文是 JS（`ctx`、`el`），画在父元素内容之后 |
| `div` 写 `display:flex` | 排布。默认横向；竖排加 `flex-direction:column`。`gap` `align-items` `justify-content` `padding` 都在 `style` 里 |

要定位一组 HTML，包一层 `layer`，把 `cx` `cy` `anchor` 写在 `layer` 上。

## 叶子怎么定位

| 叶子 | 在 layer 里 | 在 flex 里 |
| --- | --- | --- |
| 文字 `h1` `h2` `h3` `p` `div` `span` | 外包 `layer` 来定位。文字本身只写 `style` | 直接放 |
| 图片 `img`（`image` 相同） | 外包 `layer`。`src` 是属性，宽高和 `object-fit` 写 `style` | 直接放，默认不缩小 |
| `rect` | `cx cy width height`，或 `x1 y1 x2 y2`。`rx` 是圆角，两种都能加 | 包一层有宽高的 layer，或改用 div |
| `ellipse` | `cx cy rx ry`，或两点写法 | 同上 |
| `circle` | `cx cy r` | 同上 |
| `sphere` | `cx cy r`，再加上 `z`。布局盒子是边长 `2r` 的正方形 | 放进有 `perspective` 的 layer |
| `box` | `cx cy width height depth`。布局不计厚度 | 放进有 `perspective` 的 layer |
| `extrude` | `d` 与 `path` 相同，`depth` 是沿 z 的厚度，以平面为中心 | 放进有 `perspective` 的 layer |
| `model` | 只写 `src`（一个 `.glb`）。宽高和 `cx cy z` 写在外包的 layer 上，contain 居中 | 放进有 `perspective` 的 layer |
| `line` `arrow` `polyline` `polygon` `path` `curve` | `x1 y1 x2 y2` / `points` / `d`。`curve` 闭合加 `closed` | 包一层 `<layer>` |
| `symbol` / `use` | `symbol` 不画。`use href="#id"` 用 `cx cy` 摆放 | `use` 按它的宽高排进去 |
| `mask` | 只作为 `layer` 的直接子元素。里面写 `rect` `circle` `ellipse` `polygon` `path` 或 `img`。省略 `fill` 为 `#fff`，只看 alpha | 不排进去，会 `warn` |

色块、圆点、分隔线用 div：`<div style="width:28px; height:28px; border-radius:14px; background:#3ecfc4">`，分隔线用 `flex:1; height:4px`。

`fill` 可以写 `linear-gradient(to bottom, #0c1424, #6e7c72)`、`radial-gradient(at 40% 35%, #fff, #fff0)`，或 `gradient(#000, #fff)`。

<!-- attrs:effects:begin -->
效果：`shadow` `0 8 16 #00000055`（默认 颜色 `#00000066`）、`glow` `56 #f3ead4`（默认 颜色取本体）、`inner-shadow` `0 8 16 #00000055`（默认 同 shadow）、`inner-glow` `28 #7ec8ff`（默认 同 glow）、`blur` `6`、`backdrop-blur` `16`、`glass` `clear`、`noise` `0.08`、`filter` `saturate(1.1)`、`blend` `multiply`（默认 `source-over`）、`overlay` `#00000066`（默认 透明度 1，`source-over`）、`grade` `lomo 0.8, fade 0.1`（默认 强度 1）、`grade-mask` `radial-gradient(#fff0 30%, #fff)`。作用于整棵子树的 `overlay`、`grade`、`grade-mask` 只写在 `layer` 上。
<!-- attrs:effects:end -->

整层裁切用 `<mask>`，和内容并列写在 `layer` 里：`<mask><circle cx="160" cy="90" r="90" /></mask>`。实心是硬边，`fill="linear-gradient(to bottom, #fff, #fff0)"` 是软边。`overflow="hidden"` 只裁子元素。

透视：`<layer perspective="700"><rect rotateY="28" z="40" /></layer>`。`z` 越大越靠近观众。没有 `perspective` 的祖先时，`rotateX`、`rotateY`、`z` 仍按二维画，并报 `flatten-3d`。例子见 [examples/perspective.layer](../examples/perspective.layer)。

网格和透视共用这一层：`<layer perspective="700"><sphere cx="220" cy="340" r="90" z="50" fill="#4CC3D9" /><box cx="430" cy="400" width="150" height="100" depth="60" fill="#EF2D5E" /></layer>`。`extrude` 用 `d` 和 `depth`。`model` 放在有宽高的 layer 里，`src` 指向 `.glb`。没有 `perspective` 时不绘制。默认用 WebGL。`--mesh canvas2d` 改用 `@xsyetopz/easel` 在 Canvas 2D 上光栅。例子见 [examples/meshes.layer](../examples/meshes.layer)。

竖排：`style="writing-mode:vertical-rl"`。字体名 `Song`、`Kai`、`Brush` 不用自带字体文件。

## 例子

```html
<layer width="800" height="400" background="#0e1219" color="#f4f1ea">
  <layer cx="40" cy="40" anchor="top-left">
    <div style="display:flex; gap:16px; align-items:center">
      <div style="width:28px; height:28px; border-radius:14px; background:#3ecfc4"></div>
      <p style="font-size:40px">a² = 9</p>
    </div>
  </layer>
  <layer cx="400" cy="220" width="360" height="200">
    <rect x1="0" y1="0" x2="160" y2="120" fill="#3ecfc4" />
    <circle cx="200" cy="60" r="16" fill="#f4f1ea" />
    <line x1="160" y1="60" x2="184" y2="60" stroke="#f4f1ea" stroke-width="4" />
  </layer>
  <layer width="120" height="80" cx="640" cy="300">
    <draw>
      ctx.fillStyle = '#f5c16c'
      ctx.fillRect(0, 0, el.w, el.h)
    </draw>
  </layer>
</layer>
```

```html
<layer width="800" height="200" background="#0e1219" color="#f4f1ea">
  <layer cx="40" cy="80" anchor="top-left">
    <div style="display:flex; width:720px; gap:16px; align-items:center">
      <p style="font-size:40px">左</p>
      <div style="flex:1; height:4px; background:#f5c16c"></div>
      <p style="font-size:40px">右</p>
    </div>
  </layer>
</layer>
```
