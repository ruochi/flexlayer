# Flex Layer 速查

写法规则见 [AGENTS.md](../AGENTS.md) 的硬性约定。数字都是像素，y 轴向下。根元素 `<layer width height>` 就是一个 layer。推荐用 `.tsx` 的 `canvas.create(<layer>…</layer>)` 先量再摆，见 [examples/poster.tsx](../examples/poster.tsx)。`create` 是同步的，准备好的字体和图片会留在进程里，多帧接着用。自定义字体先 `canvas.font(family, src)`，或写进正在量的那一层。自定义标签用 `canvas.component` 注册，类型用 `declare module 'flexlayer/jsx-runtime'`。声明的属性就是回调参数的类型，返回值可以是一个元素或数组。同一套标签也可以手写进 `.layer`。`flexlayer render file.tsx` 会先执行再渲染。

## 结构

| 标签 | 做什么 |
| --- | --- |
| `layer` | 根画布兼定位容器。根上写 `width` `height` `background`（画布底色，省略则 PNG 透明）`color` `safe`。定位用 `x` `y` `anchor`（默认左上角，没写是 0），还有 `opacity` `rotate` `rotateX` `rotateY` `z` `scale` `origin`。`view="x y w h"` 是镜头：这一层的宽高是屏幕上的取景窗，四个数是舞台上被取的矩形，窗口外裁掉。`perspective` 只写在这一层，是直接子元素共用的视距。可嵌套 |
| `draw` | 子标签。正文是 JS（`ctx`、`el`），画在父元素内容之后 |
| `div` 写 `display:flex` | 排布。默认横向；竖排加 `flex-direction:column`。`gap` `row-gap` `column-gap` `align-items` `align-content` `justify-content` `flex-wrap` `padding` 都在 `style` 里。**`align-items` 默认 `center`（CSS 里是 `stretch`）：column 忘写 `align-items` 会全部居中**。左对齐写 `align-items:flex-start`。横排按文字基线对齐写 `align-items:baseline`，同一行被撑高后 `center` 和 `end` 按新的行盒再排，竖排写了仍按 `flex-start`。`letter-spacing` 可以写 `0.05em`。`align-content` 默认 `flex-start`，管换行后的多行。`justify-content` 只管主轴，改不了这一层在父级交叉轴上的位置 |

没写 `display:flex` 的 `div` 可以直接放 `p`、`h1`–`h3`、另一个 `div`，以及写了宽高的 `layer`，它们从上到下排，文字块拉到这一列的宽度。只写文字时 `div` 仍是一段文字。容器上的字号、颜色和 `text-align` 会传给里面的段落；`h1`–`h3` 仍用自己的默认字号。`em` / `i` 是斜体，`u` 加下划线。`p` 里可以直接放 `<img>`。图标是 `<span class="material-symbols-outlined">home</span>`，字重写 `font-weight`。`p`、`h1`–`h3`、`span` 里不要放 `layer`。`color` 可以写渐变，和 `fill` 同一套写法。行内 `background` 高亮这一段的行盒，例如 `<span style="background:#ffe08a">词</span>`。

要定位一组 HTML，包一层 `layer`，把 `x` `y` `anchor` 写在 `layer` 上。没写坐标时落在 `(0, 0)`。写了宽高的 `layer` 也可以直接放进 `div`，和文字并排；图形用这一层的局部坐标，这一层上不写 `x` `y`。例子见 [examples/html-layer.tsx](../examples/html-layer.tsx)。`anchor-box="ink"` 让 `x` `y` 对准子树着墨，而不是布局盒子。公式用 `<math>`，和文字并排时放进 `display:flex`，不要写进 `<p>`。单独成行的公式写 `display="block"`，`∑`、`∫` 用大号，上下限放到正上方和正下方。字母和运算符只用 `STIXTwoMath`，公式上写别的 `font-family` 不生效。说明文字用 `<mtext>`，跟外面的字体走。`scale` 可以写两个数：`scale="1.2 0.8"` 或 `scale="-1 1"`。文字写 `style="scale:1.2 0.8"`。只写一个数时两轴相同。`origin` 默认 `center`。九宫格之外可以写 `origin="640 420"` 或 `origin="33% 39%"`，镜头绕这一点推近，这一点不动。

## 叶子怎么定位

| 叶子 | 在 layer 里 | 在 flex 里 |
| --- | --- | --- |
| 文字 `h1` `h2` `h3` `p` `div` `span` | 外包 `layer` 来定位。文字本身只写 `style` | 直接放 |
| 写了宽高的 `layer` | 用 `x` `y` `anchor` 定位整组 | 直接放进 `div`。宽高是属性，里面的图形用局部坐标。这一层不写 `x` `y` |
| 图片 `img`（`image` 相同） | 外包 `layer`。`src` 是属性，宽高和 `object-fit` 写 `style` | 直接放，默认不缩小 |
| 图标 | 跟文字一样外包 `layer`。`<span class="material-symbols-outlined">home</span>`，字重写 `font-weight`，字号和颜色跟周围文字 | 直接放。写进 `p` 时跟文字排在同一段 |
| `rect` | `x y width height`，左上角。`rx` 是圆角，`ry` 没写时跟 `rx` | 包一层有宽高的 layer，或改用 div |
| `ellipse` | `cx cy rx ry`，圆心 | 同上 |
| `g` | 放在 `layer` 里。`transform` 写 `translate` / `rotate` / `scale` / `matrix`。`fill`、`stroke` 传给子形状 | 不排进去，会 `warn` |
| `circle` | `cx cy r`，圆心 | 同上 |
| `sphere` | `cx cy r`，圆心，再加上 `z`。布局盒子是边长 `2r` 的正方形 | 放进有 `perspective` 的 layer |
| `box` | `x y width height depth`。`rx` 圆棱，`round` 选边（不写是 12 条都圆，如 `front`、`x`、`front-top`）。`x y` 是左上角，布局不计厚度 | 放进有 `perspective` 的 layer |
| `cylinder` | `cx cy r height`。轴竖直，`height` 是长度，圆截面朝镜头鼓出 `r`。`rx` 圆上下口，`round` 可写 `top` 或 `bottom`。盒子宽 `2r`、高 `height`，中心是 `cx cy` | 放进有 `perspective` 的 layer |
| `torus` | `cx cy r tube`。环躺在平面里，`r` 是环心到管心，`tube` 是管半径。盒子边长 `2(r+tube)` | 放进有 `perspective` 的 layer |
| `tube` | `d` 是中心线，`r` 是管半径。`Z` 闭合成环，开口两端封平盖。`x y` 是包围盒（四边各扩 `r`）的左上角 | 放进有 `perspective` 的 layer |
| `extrude` | `d` 与 `path` 相同，`depth` 是沿 z 的厚度，以平面为中心。位置用 `x y` | 放进有 `perspective` 的 layer |
| `model` | 只写 `src`（一个 `.glb`）。宽高和 `x y z` 写在外包的 layer 上，contain 居中 | 放进有 `perspective` 的 layer |
| `line` `arrow` `polyline` `polygon` `path` `curve` | `x1 y1 x2 y2` / `points` / `d`。`curve` 闭合加 `closed`。`arrow` 是组件，展开成线和三角，`head` 默认 `max(12, stroke-width × 4)` | 包一层 `<layer>` |
| `symbol` / `use` | `symbol` 不画。`use href="#id"` 用 `x y` 摆放 | `use` 按它的宽高排进去 |
| `mask` | 只作为 `layer` 的直接子元素。里面写 `rect` `circle` `ellipse` `polygon` `path`、`img` 或 `g`。省略 `fill` 为 `#fff`，只看 alpha。`op` 默认 `add`，还可写 `subtract` `intersect` `xor`。`img` 可写 `channel="luma"`、`pick`、`derive` | 不排进去，会 `warn` |
| `preview` | `<preview of="#id" show="overlay checker black white edges" />`，只作为 `layer` 的直接子元素 | 正常成片不画。`render --preview` 才出拼图 |

色块、圆点、分隔线用 div：`<div style="width:28px; height:28px; border-radius:14px; background:#3ecfc4">`，分隔线用 `flex:1; height:4px`。

`fill` 可以写 `linear-gradient(to bottom, #0c1424, #6e7c72)`、`radial-gradient(at 40% 35%, #fff, #fff0)`，或 `gradient(#000, #fff)`。`ink-stroke` 按墨迹描边，例如 `6 #000 outside`。写在 `layer` 上时按整组子树墨迹描一圈。

<!-- attrs:effects:begin -->
效果：`shadow` `0 8 16 #00000055`（默认 颜色 `#00000066`）、`glow` `56 #f3ead4`（默认 颜色取本体）、`inner-shadow` `0 8 16 #00000055`（默认 同 shadow）、`inner-glow` `28 #7ec8ff`（默认 同 glow）、`ink-stroke` `6 #000 outside`（默认 outside）、`blur` `6`、`backdrop-blur` `16`、`glass` `clear`、`noise` `0.08`、`filter` `saturate(1.1)`、`blend` `multiply`（默认 `source-over`）、`overlay` `#00000066`（默认 透明度 1，`source-over`）、`grade` `lomo 0.8, fade 0.1`（默认 强度 1）、`grade-mask` `radial-gradient(#fff0 30%, #fff)`。作用于整棵子树的 `overlay`、`grade`、`grade-mask` 只写在 `layer` 上。
<!-- attrs:effects:end -->

整层裁切用 `<mask>`，和内容并列写在 `layer` 里：`<mask><circle cx="160" cy="90" r="90" /></mask>`。实心是硬边，`fill="linear-gradient(to bottom, #fff, #fff0)"` 是软边。挖掉一块写 `op="subtract"`。羽化写 `<mask feather="8">`，反选写 `invert="true"`。黑白蒙版用 `<img channel="luma">`，编号区域用 `pick="3 5"`。缓存写 `<img src="photo.jpg" derive="subject">`。不要写 `mask-image`。`overflow="hidden"` 只裁子元素。预览写在标记里：`<preview of="#cut" show="overlay checker" />`，正常成片不包含它。

透视：`<layer perspective="700"><rect rotateY="28" z="40" /></layer>`。`z` 越大越靠近观众。没有网格时，直接子元素按中心深度从远到近画，深度相同按文档顺序。有 `sphere`、`box`、`cylinder`、`torus`、`tube`、`extrude`、`model` 时改用深度缓冲，近的盖住远的。没有 `perspective` 的祖先时，`rotateX`、`rotateY`、`z` 仍按二维画，`z` 不改变顺序，并报 `flatten-3d`。例子见 [examples/perspective.layer](../examples/perspective.layer)。

网格和透视共用这一层：`<layer perspective="700"><sphere cx="220" cy="340" r="90" z="50" fill="#4CC3D9" /><box x="355" y="350" width="150" height="100" depth="60" fill="#EF2D5E" /></layer>`。`cylinder` 是竖直圆柱，`torus` 是躺着的圆环，`tube` 沿 `d` 扫出圆管。`box` 的 `rx` 圆棱，`round` 不写就是 12 条都圆；圆柱的 `rx` 圆上下口。`extrude` 用 `d` 和 `depth`，`d` 里并排的形状各自挤出，套在里面的才是洞。`model` 放在有宽高的 layer 里，`src` 指向 `.glb`。网格的 `fill` 是纯色，渐变、`shadow`、`glow` 会警告。`material="matte"` 是默认的磨砂塑料，只有明暗。`material="plastic"` 加白色高光，`material="metal 0.35"` 用 fill 给固定的横向工作室环境染色，`material="glass"` 透出后面的画面，边缘映出同一张环境。棱线写在网格上：`stroke="#1c1915" stroke-width="3 2 1"` 依次描轮廓、折棱和隐藏线，只写一个数时三档一样粗。`hidden="#8a8175"` 把被自己挡住的棱画成虚线。`halo="3"` 让这只网格的可见线在交叉处把更远的线断开。`fill="none"` 只留线。球没有折棱，`stroke` 只画轮廓圆。没有 `perspective` 时不绘制。例子见 [examples/meshes.layer](../examples/meshes.layer)、[examples/solids.layer](../examples/solids.layer)、[examples/rounded.layer](../examples/rounded.layer)、[examples/wire.layer](../examples/wire.layer)。

竖排：`style="writing-mode:vertical-rl"`。字体名见 [docs/RESOURCES.md](RESOURCES.md)，直接写 `font-family`，不用自带字体文件。

## 例子

```html
<layer width="800" height="400" background="#0e1219" color="#f4f1ea">
  <layer x="40" y="40">
    <div style="display:flex; gap:16px; align-items:center">
      <div style="width:28px; height:28px; border-radius:14px; background:#3ecfc4"></div>
      <p style="font-size:40px">a² = 9</p>
    </div>
  </layer>
  <layer x="220" y="120" width="360" height="200">
    <rect x="0" y="0" width="160" height="120" fill="#3ecfc4" />
    <circle cx="200" cy="60" r="16" fill="#f4f1ea" />
    <line x1="160" y1="60" x2="184" y2="60" stroke="#f4f1ea" stroke-width="4" />
  </layer>
  <layer width="120" height="80" x="580" y="260">
    <draw>
      ctx.fillStyle = '#f5c16c'
      ctx.fillRect(0, 0, el.w, el.h)
    </draw>
  </layer>
</layer>
```

```html
<layer width="800" height="200" background="#0e1219" color="#f4f1ea">
  <layer x="40" y="80">
    <div style="display:flex; width:720px; gap:16px; align-items:center">
      <p style="font-size:40px">左</p>
      <div style="flex:1; height:4px; background:#f5c16c"></div>
      <p style="font-size:40px">右</p>
    </div>
  </layer>
</layer>
```

结构化数据：`data={{ values: [1, 2] }}`，`.layer` 里 `data='{"values":[1,2]}'`。`draw` 读 `el.data`。别的属性不要传对象或数组。

故意越界或叠字：`expect="overflow-canvas: 出血图; text-overlap"`。对得上的问题降为 info。没出现报 `unused-expect`。镜头用 `view`，被取景窗裁掉的不报 `overflow-canvas`。

## 帧

`renderFrames(comp, { from, to, step, format: 'png' })` 逐帧产出，`to` 含端点。`format: 'rgba'` 是不预乘的原始像素。`renderComposition` 仍一次返回全部 PNG 和联系表。`draw` 里 `el.t` 是秒，`el.frame` 和 `el.fps` 在单帧时是 0。

`random(seed)` 固定在 `[0, 1)`。`noise(seed, x, y, z)` 在 `[-1, 1]`。`interpolate` 可以写多点区间，`easing` 用 `Easing.quad`、`Easing.out(Easing.quad)`、`Easing.bezier(x1, y1, x2, y2)`。只写两个点时和以前一样。

带 `id` 的行内 `span`、`strong`、`b`、`em` 会出现在报告里，标 `inline`。最内层有 `id` 的那段拥有这些字。

```bash
flexlayer render scene.tsx --frames out/ --from 0 --to 90
flexlayer render scene.tsx --rgba -   # 标准输出是像素，自己接 ffmpeg
flexlayer check scene.tsx --frames 0-90 --step 5
```
