# Flex Layer 速查

写法规则见 [SPEC.md](../SPEC.md)，给模型的入口是 [AGENTS.md](../AGENTS.md)。数字都是像素，y 轴向下。根元素 `<layer width height>` 就是一个 layer。推荐用 `.tsx` 的 `canvas.create(<layer>…</layer>)` 先量再摆，见 [examples/poster.tsx](../examples/poster.tsx)。`create` 是同步的，准备好的字体和图片会留在进程里，多帧接着用。自定义字体先 `canvas.font(family, src)`，或写进正在量的那一层。自定义标签用 `canvas.component` 注册，类型用 `declare module 'flexlayer/jsx-runtime'`。声明的属性就是回调参数的类型，返回值可以是一个元素或数组。同一套标签也可以手写进 `.layer`。`flexlayer render file.tsx` 会先执行再渲染。透视里的实体在 `elements` 上还有投影后的 `points`、`edges` 和轮廓 `d`；球只给解析轮廓，不在透视里的实体没有这三项。

## 结构

| 标签 | 做什么 |
| --- | --- |
| `layer` | 根画布兼定位容器。根上写 `width` `height` `background`（画布底色，省略则 PNG 透明）`color` `safe`。定位用 `x` `y` `anchor`（默认左上角，没写是 0），还有 `opacity` `rotate` `rotateX` `rotateY` `z` `scale` `origin`。`view="x y w h"` 是镜头：这一层的宽高是屏幕上的取景窗，四个数是舞台上被取的矩形，窗口外裁掉。`camera` 是这一层的镜头（一个视距，或 `focal` / `fov` / `lens` / `parallel`，以及 `at` `orbit` `roll` `distance` `from` `vanish`；`aperture` `focus` `max` 是景深）。不写时，有实体、`ground` 或 `rotateX`、`rotateY`、`z` 的最外层用自己的 `height` 当视距。`camera="parallel"` 视线平行，没有近大远小。`preserve-3d` 让子元素进入外层镜头。可嵌套 |
| `canvas` | 位图。`width` `height` 是位图尺寸，也是默认布局尺寸，不写是 300×150。`style` 宽高只改布局。`x` `y` 定位 |
| `script` | 排版之后执行。`document.querySelector`、`getContext('2d')`、`getComputedStyle`、`dataset`、`requestAnimationFrame`、`performance.now`。见 SPEC 第 12 章 |
| `div` 写 `display:flex` | 按 HTML 的 flex 排布，`style` 按 CSS，初始值不另写。竖排写 `flex-direction:column` |

`shadows="none"` 写在开了镜头的 `layer` 上，关掉投到 `ground` 上的影子，深度遮挡还在。实体写 `cast-shadow="false"` 不投，`ground` 写 `receive-shadow="false"` 不接。根上 `min-font="print"` 或 `min-font="16"` 放宽最小字号；不写是屏幕档 `min(宽, 高) / 1080 × 24`。同一张图里多处过小的字合并成一条 `min-font-size`。代码字体写 `font-family:JetBrainsMono`。属性逐条在 [attrs.json](attrs.json)。

没写 `display:flex` 的 `div` 可以直接放 `p`、`h1`–`h3`、另一个 `div`，以及写了宽高的 `layer`，从上到下排。只写文字时 `div` 仍是一段文字。`p` 里可以直接放 `<img>`。图标是 `<span class="material-symbols-outlined">home</span>`，字重写 `font-weight`。`p`、`h1`–`h3`、`span` 里不要放 `layer`。字形渐变写 `style="fill:linear-gradient(to right, #2f7bff, #b423c4)"`，没写 `fill` 时用 `color`。盒子渐变写 `background:linear-gradient(...)`，不写 `gradient()`。行内 `background` 高亮这一段的行盒，例如 `<span style="background:#ffe08a">词</span>`。

要定位一组 HTML，包一层 `layer`，把 `x` `y` `anchor` 写在 `layer` 上。没写坐标时落在 `(0, 0)`。写了宽高的 `layer` 也可以直接放进 `div`，和文字并排；图形用这一层的局部坐标，这一层上不写 `x` `y`。例子见 [examples/html-layer.tsx](../examples/html-layer.tsx)。`anchor-box="ink"` 让 `x` `y` 对准子树着墨，而不是布局盒子。公式用 `<math>`，和文字并排时放进 `display:flex`，不要写进 `<p>`。单独成行的公式写 `display="block"`，`∑`、`∫` 用大号，上下限放到正上方和正下方。字母和运算符只用 `STIXTwoMath`，公式上写别的 `font-family` 不生效。说明文字用 `<mtext>`，跟外面的字体走。`scale` 可以写两个数：`scale="1.2 0.8"` 或 `scale="-1 1"`。文字写 `style="scale:1.2 0.8"`。只写一个数时两轴相同。`origin` 默认 `center`。九宫格之外可以写 `origin="640 420"` 或 `origin="33% 39%"`，镜头绕这一点推近，这一点不动。

## 叶子怎么定位

| 叶子 | 在 layer 里 | 在 flex 里 |
| --- | --- | --- |
| 文字 `h1` `h2` `h3` `p` `div` `span` | 外包 `layer` 来定位。文字本身只写 `style` | 直接放 |
| 写了宽高的 `layer` | 用 `x` `y` `anchor` 定位整组 | 直接放进 `div`。宽高是属性，里面的图形用局部坐标。这一层不写 `x` `y` |
| 图片 `img`（`image` 相同） | 外包 `layer`。`src` 是属性，宽高和 `object-fit` 写 `style` | 直接放 |
| 图标 | 跟文字一样外包 `layer`。`<span class="material-symbols-outlined">home</span>`，字重写 `font-weight`，字号和颜色跟周围文字 | 直接放。写进 `p` 时跟文字排在同一段 |
| `rect` | `x y width height`，左上角。`rx` 是圆角；写了 `depth` 时 `rx` 是圆棱，沿 z 挤出 | 包一层有宽高的 layer，或改用 div |
| `ellipse` | `cx cy rx ry`，圆心。写了 `depth` 就挤出 | 同上 |
| `g` | 放在 `layer` 里。`transform` 写 `translate` / `rotate` / `scale` / `matrix`。`rotateX()` `translateZ()` 也可以写在形状上。`fill` 和纯色 `stroke` 传给子形状；`stroke="6 #000"` 留在这一组 | 不排进去，会 `warn` |
| `circle` | `cx cy r`，圆心。写了 `depth` 就是轴沿 z 的圆柱 | 同上 |
| `sphere` | `cx cy r`。布局盒子是边长 `2r` 的正方形 | 放进 layer |
| `torus` | `cx cy r tube`。环躺在平面里 | 放进 layer |
| `tube` | `d` 是中心线，`r` 是管半径。`Z` 闭合成环 | 放进 layer |
| `model` | 只写 `src`（一个 `.glb`）。宽高写在外包的 layer 上 | 放进 layer |
| `ground` | 没有大小。`rotateX="90"` 是水平地面。不写 `fill` 时只有影子。`shadow-blur` 默认 0，`shadow-opacity` 默认 0.4 | 放进 layer |
| `line` `arrow` `polyline` `polygon` `path` `curve` | `x1 y1 x2 y2` / `points` / `d`。`curve` 闭合加 `closed`。`arrow` 是组件，展开成线和三角，`head` 默认 `max(12, stroke-width × 4)` | 包一层 `<layer>` |
| `symbol` / `use` | `symbol` 不画。`use href="#id"` 用 `x y` 摆放 | `use` 按它的宽高排进去 |
| `mask` | 只作为 `layer` 的直接子元素。里面写 `rect` `circle` `ellipse` `polygon` `path`、`img` 或 `g`。省略 `fill` 为 `#fff`，只看 alpha。`op` 默认 `add`，还可写 `subtract` `intersect` `xor`。`img` 可写 `channel="luma"`、`pick`、`derive` | 不排进去，会 `warn` |
| `preview` | `<preview of="#id" show="overlay checker black white edges" />`，只作为 `layer` 的直接子元素 | 正常成片不画。`render --preview` 才出拼图 |

色块、圆点、分隔线用 div：`<div style="width:28px; height:28px; border-radius:14px; background:#3ecfc4">`，分隔线用 `flex:1; height:4px`。

形状的 `fill` 和文字的 `style="fill:…"` 共用一套颜料：`linear-gradient(to bottom, #0c1424, #6e7c72)`、`radial-gradient(at 40% 35%, #fff, #fff0)`，或 `gradient(#000, #fff)`。文字写在盒子上按整段取样，写在 `span` 上按这一段的行盒取样。`stroke` 写颜色时，形状和线条居中（`stroke-width`）；写成 `6 #000 outside` 时沿墨迹描。文字、图片和 `layer` 的 `stroke="#000"` 沿外侧描，没写宽度时用 4。写在 `layer` 上时按整组子树墨迹描一圈，背景和边框算进去。文字盒子和图片有底板时，描边绕着底板；这一层是三维场景时，描边和阴影跟着已经画好的画面。

<!-- attrs:effects:begin -->
效果：`shadow` `0 8 16 #00000055`（默认 颜色 `#00000066`）、`glow` `56 #f3ead4`（默认 颜色取本体）、`inner-shadow` `0 8 16 #00000055`（默认 同 shadow）、`inner-glow` `28 #7ec8ff`（默认 同 glow）、`blur` `6`、`backdrop-blur` `16`、`glass` `clear`、`noise` `0.08`、`filter` `saturate(1.1)`、`blend` `multiply`（默认 `source-over`）、`overlay` `#00000066`（默认 透明度 1，`source-over`）、`grade` `lomo 0.8, fade 0.1`（默认 强度 1）、`grade-mask` `radial-gradient(#fff0 30%, #fff)`。作用于整棵子树的 `overlay`、`grade`、`grade-mask` 只写在 `layer` 上。
<!-- attrs:effects:end -->

整层裁切用 `<mask>`，和内容并列写在 `layer` 里：`<mask><circle cx="160" cy="90" r="90" /></mask>`。实心是硬边，`fill="linear-gradient(to bottom, #fff, #fff0)"` 是软边。挖掉一块写 `op="subtract"`。羽化写 `<mask feather="8">`，反选写 `invert="true"`。黑白蒙版用 `<img channel="luma">`，编号区域用 `pick="3 5"`。缓存写 `<img src="photo.jpg" derive="subject">`。前景遮罩是 `npx flexlayer-select mask photo.jpg`，返回 `photo.foreground.png` 和前景的 `x` `y` `width` `height`。要留下的地方写 `--point x,y`，不要的地方写 `--omit x,y`，都可以写多次。不要写 `mask-image`。`overflow="hidden"` 只裁子元素。蒙版裁掉子元素的阴影和模糊；这一层自己的 `shadow`、`glow`、外侧 `stroke` 按留下的轮廓伸出蒙版，父层的描边和阴影也跟着这块轮廓。预览写在标记里：`<preview of="#cut" show="overlay checker" />`，`show` 是合法属性，正常成片不包含它。

透视：`<layer camera="700"><rect rotateY="28" z="40" /></layer>`。`z` 越大越靠近观众。平行投影写 `<layer camera="parallel">`。没有实体时，直接子元素按中心深度从远到近画。有实体或 `ground` 时用深度缓冲。没落到镜头里报 `flatten-3d`。

实体就是 SVG 形状加 `depth`：`<rect width="150" height="100" depth="60" rx="8" />` 是圆棱盒子，`<circle r="40" depth="80" />` 是轴沿 z 的圆柱，`<path d="…" depth="18" />` 按 `fill-rule` 挤出。另有 `sphere`、`torus`、`tube`、`model`。`material` 是 `matte`、`plastic`、`metal`、`glass`。`stroke` 描棱线，`hidden` 是隐藏线的颜色。影子只落在 `ground` 上。`box`、`cylinder`、`extrude` 是别名。

竖排：`style="writing-mode:vertical-rl"`。字体名见 [docs/RESOURCES.md](RESOURCES.md)，直接写 `font-family`，不用自带字体文件。自带的 `.ttc` 要选字形就写 `src="字体.ttc#2"`，从 0 数；不写序号用第 0 套。

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
    <canvas id="bar" width="120" height="80"></canvas>
    <script>
      const canvas = document.querySelector('#bar')
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#f5c16c'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    </script>
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

结构化数据：`data={{ values: [1, 2] }}`，`.layer` 里 `data='{"values":[1,2]}'`。脚本要字符串时用 `data-*`，读 `canvas.dataset`。

故意越界或叠字：`expect="overflow-canvas: 出血图; text-overlap"`。对得上的问题降为 info。没出现报 `unused-expect`。镜头用 `view`，被取景窗裁掉的不报 `overflow-canvas`，裁开的文字边也不报 `outside-safe`。

## 帧

`renderFrames(comp, { from, to, step, format: 'png' })` 逐帧产出，`to` 含端点。`format: 'rgba'` 是不预乘的原始像素。已经排好的一帧用 `renderLayer(node, { format: 'rgba' })`，同样给出 `rgba` 和画布宽高。`renderComposition` 仍一次返回全部 PNG 和联系表。脚本里的 `ctx` 可以 `drawImage`。`performance.now()` 是毫秒，单帧时是 0。

`random(seed)` 固定在 `[0, 1)`。`noise(seed, x, y, z)` 在 `[-1, 1]`。`interpolate` 可以写多点区间，`easing` 用 `Easing.quad`、`Easing.out(Easing.quad)`、`Easing.bezier(x1, y1, x2, y2)`。只写两个点时和以前一样。

带 `id` 的行内 `span`、`strong`、`b`、`em` 会出现在报告里，标 `inline`。最内层有 `id` 的那段拥有这些字。

```bash
flexlayer render scene.tsx --frames out/ --from 0 --to 90
flexlayer render scene.tsx --rgba -   # 标准输出是像素，自己接 ffmpeg
flexlayer check scene.tsx --frames 0-90 --step 5
```
