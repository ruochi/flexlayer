# Flex Layer 规范

Flex Layer 用标签描述**一帧画面**。结构标签只有 `layer`。`div`、`p`、`h1`–`h3`、`span`、`img` 和行内标签是 HTML，按 HTML 渲染，`style` 按 CSS，初始值不另写。图形用 SVG 属性。动画是程序为每个时刻生成一份 Flex Layer。报告里的 `flexlayer` 是格式版本 `0.1`，和包版本不是同一个数。

1. **一律实际像素**。可以写 `px` 后缀。百分比、em、rem 不用于布局。
2. **位置由 layer 决定**。`display:flex` 的 HTML 负责排布。图形用自身坐标画在 layer 里。
3. **y 轴向下**。`y="400"` 是距父级顶部 400 像素。
4. **显式写了就照做**。有问题只在报告里指出。
5. **没写的由渲染器决定，并写进报告**。例如自动换行。
6. **写错了要说怎么改**。有歧义或会被忽略的写法报 `warn` 并给出 `hint`。含义明确但不规范的写法照常渲染，报 `info`。和已知属性编辑距离不超过 2 的名字报 `warn`，`hint` 写出正确属性。其余不认识的名字不报。

给模型的入口见 [AGENTS.md](AGENTS.md)。属性逐条见 [docs/attrs.json](docs/attrs.json)。字体见 [docs/RESOURCES.md](docs/RESOURCES.md)。效果图见 [docs/GALLERY.md](docs/GALLERY.md)。

## layer

根元素 `<layer width height>` 就是画布，也是一个 layer。

```html
<layer width="1080" height="1920" background="#0f1115" color="#ffffff">
  <layer x="540" y="700" anchor="center">
    <div style="display:flex; flex-direction:column; gap:32px; align-items:center">
      <h1>比特币减半</h1>
      <p style="color:#f7931a">每四年一次</p>
    </div>
  </layer>
</layer>
```

嵌套 `layer` 是一块局部坐标系。`x` `y` `anchor` 把这块框放到父级上；里面的图形用 SVG 坐标，HTML 不写 `x` `y`。文字或一组 flex 要单独摆，就再包一层 `layer`。写了宽高的 `layer` 可以放进 `div`，成为 flex 的一格，位置由排布决定，这一层上再写 `x` `y` `anchor` 报 `invalid-attr`。要一起移动、旋转，或共用一台镜头，也包一层 `layer`。

色块用 `<rect fill>`、HTML 的 `background`，或 `<canvas>`。`background` 只写在根 `layer` 上，是画布底色，只收纯色。没写或写 `transparent` 时不铺底，PNG 空出来的像素是透明的。整页渐变用铺满的 `<rect fill>`。嵌套 `layer` 和 `use` 上写 `background` 会警告并忽略。

| 属性 | 说明 |
| --- | --- |
| `width`、`height` | 根上必填，画布尺寸。嵌套层写了就是这么大，原点固定，内容可以画出盒子。都没写时，宽高等于从原点到子元素右下角的距离；负方向的子元素画出盒子，不把其它子元素平移 |
| `background` | 只在根上。默认透明 |
| `color` | 文字色和线条默认色。只收纯色。默认 `#111111`。字形渐变写 `fill` |
| `font-family` | 默认 `ChillDuanSans`。目录里的名字直接写，第一次用到时下载。自带文件用 `<font>`，见 [docs/RESOURCES.md](docs/RESOURCES.md) |
| `safe` | 安全区边距，`上 右 下 左` 或一个数字，只用于检查。默认画布短边的 4% |
| `min-font` | 只写在根上。`screen`（默认）是 `min(宽, 高) / 1080 × 24`，`print` 把 24 换成 12，数字是屏幕像素下限，`none` 关掉。多处过小合并成一条 `min-font-size` |
| `x`、`y` | 定位点，没写是 `0, 0` |
| `anchor` | `(x, y)` 落在盒子的哪个点。九宫格，默认 `top-left`。写错按 `top-left` 摆，报 `invalid-attr` |
| `anchor-box` | 默认 `box`，按布局盒子对齐。`ink` 改为按旋转和缩放之前的着墨外接矩形对齐。和 `rotate` 一起写报 `ink-anchor-rotate`。没有着墨时报 `ink-anchor-empty` 并退回布局盒子。`overflow="hidden"` 先裁再对齐。只写在 `layer` 和 `use` 上。没写 `anchor-box`、锚点贴着左右边、字形比盒子靠里至少 2px 且不小于字号的 4% 时，报 `ink-inset`。开了镜头的 layer 不报 |
| `opacity` | 0 到 1，嵌套时逐层相乘 |
| `rotate`、`scale`、`origin` | 只影响绘制，不改布局。绕 `origin`，默认 `center`，这一点在画面上不动。`scale` 一个数时两轴相同；`scale="1.2 0.8"` 分轴，`scale="-1 1"` 水平镜像。分轴时 z 缩放是两轴绝对值乘积的平方根；只写一个数时 z 用这个数，负号保留。`origin` 还可以写 `120 80`、`30% 40%`、`120 40%`、`top 80`。解析失败报 `invalid-attr` 并退回中心 |
| `rotateX`、`rotateY`、`z` | 和 `rotate` 同一层归属。`z` 正方向朝观众。不改变布局 |
| `overflow` | 默认 `visible`。`hidden` 按这一层的盒子裁子元素。这一层自己的阴影和模糊仍可画出盒子；祖先的 `hidden` 会把子元素的阴影和光晕一起裁掉 |
| `view` | `view="x y w h"`。`width` `height` 是屏幕上的取景窗，`view` 是舞台上被取的矩形，铺满窗口。窗口外裁掉，不报 `overflow-canvas`。裁开后贴着窗口的文字边不报 `outside-safe`。四个角没被直接子元素转完、缩完的四边形盖住时报 `view-outside`。`<g>` 用 `transform` 之后每个形状的四边形。宽高比和取景窗差超过 1% 时按宽度保持中心重算高度，并 `warn`。要写 `width` 和 `height`。和 `camera` 分开写。屏幕上不跟着放大的字幕写在这一层外面。`zoomView(center, zoom, size)` 用来算 `view`。`bleed` 已不再使用，写了会 `warn` |
| `border`、`border-radius` | 写在 `layer` 的属性上 |

这一层上的 `color`、`font-family` 传给里面没写这些的文字。写了 `width` 时，里面的文字按这个宽度换行；宽高都写了再减去这一层的 `safe`。

`rotate`、`scale` 和透视都不改报告里的 `box`。`ink` 是变换后的外接矩形；有透视时改成投影后的外接矩形，并多一个 `quad`。`screenScale` 是 `scale` 和 `view` 叠出来的倍数（两轴绝对值的几何平均，等于 1 不写）。最小字号拿 `font-size × screenScale` 和根上的 `min-font` 比。阴影、光晕、模糊的外扩同样乘这个倍数。

`<font family src>` 注册字体，只能写在根下。`src` 是 ttf、otf、woff、ttc、otc。`.ttc` 和 `.otc` 不写序号时用第 0 套。序号写在路径后面，从 0 数：`src="SourceHanSans.ttc#2"`。`#` 不是文件名。思源、Noto CJK 的第 0 套是日文，简体用 `#2`。序号超出集合时报 `字体集合只有 N 套字形`。单个字体文件写了大于 0 的序号时报 `这不是字体集合`。文件不存在仍报 `字体文件不存在`，路径里不带 `#`。有 400 和 700 两档的取最近的一档，只登记了一档的始终用那一档。

`symbol` 定义一块可复用的图，本身不画。`use` 按 layer 的方式摆它：`x`、`y`、`anchor`、`rotate`、`scale`、`opacity` 写在 `use` 上。`href` 写成 `#id`。没写宽高时盒子包住内容。`symbol` 里的坐标是它自己的局部坐标。

标签一律小写。根上写了大写或 `fvg`，直接拒绝。子元素报 `unknown-tag`（error）。后写的画在上面。

属性归属（由 [src/schema.ts](src/schema.ts) 生成，不要手改两行标记之间的表）：

<!-- attrs:ownership:begin -->
| 属性 | 写在哪 |
| --- | --- |
| `width`、`height`、`min-font`、`x`、`y`、`anchor`、`anchor-box` | `width`、`height` 以及 `x`、`y`、`anchor`。`x`、`y` 是左上角，默认 0；`anchor` 默认 `top-left`。HTML 上写了报 `warn` |
| `opacity`、`rotate`、`rotateX`、`rotateY`、`z`、`scale`、`origin` | 图形、线条和 `layer` 写属性；文字写在 `style`。HTML 上写成属性报 `warn` |
| `background`、`padding`、`font-size`、`color`、`flex`、`flex-grow`、`flex-shrink`、`flex-basis`、`gap`、`border`、`border-radius`、`max-width`、`align-items`、`align-content`、`justify-content`、`flex-wrap`、`row-gap`、`column-gap`、`writing-mode`、`object-fit`、`object-position` | HTML，按 CSS 渲染，写在 `style` 里。初始值不另写。`layer` 或图形写了 `style` 报 `warn` |
| `cx`、`cy`、`x1`、`y1`、`x2`、`y2`、`points`、`d`、`depth`、`fill-rule`、`tube`、`round`、`fill`、`stroke`、`hidden`、`halo`、`material`、`cast-shadow`、`receive-shadow`、`shadow-blur`、`shadow-opacity`、`shadow-color`、`transform` | 图形属性，坐标是所在 `layer` 的局部坐标 |
| `src`、`unit`、`object`、`alt` | 只写在 `img` 或 `model` 上。`unit`、`object` 只写在 `model` 上。图片宽高仍放进 `style` |
| `shadow`、`glow`、`inner-shadow`、`inner-glow`、`blur`、`backdrop-blur`、`glass`、`noise`、`filter`、`blend` | 图形和 `layer` 写属性；文字写在 `style`。语法在 attrs.json |
| `camera`、`shadows`、`overlay`、`grade`、`grade-mask`、`view` | 只写在 `layer` 上。写在别处或写进 `style` 报 `warn` |
| `data` | 任何元素都可以写。值是 JSON，不进普通属性。程序里直接传对象或数组 |
| `expect` | 任何元素都可以写。声明预期中的问题码，出现在该节点或子树里时降为 info。没出现报 `unused-expect` |
<!-- attrs:ownership:end -->

## HTML 和 SVG

支持这些标签。HTML 和 SVG 里已有的参数按它们自己的规则，这里只写 Flex Layer 收哪些、以及不一样的地方。

| 类别 | 标签 |
| --- | --- |
| HTML | `div`、`p`、`h1`、`h2`、`h3`、`span`、`strong`、`b`、`em`、`i`、`u`、`br`、`img`（`image` 相同） |
| 公式 | `math`，以及下面列出的 MathML 子集 |
| 图形 | `rect`、`circle`、`ellipse`、`line`、`polyline`、`polygon`、`path`、`curve`、`g` |
| 组件 | `arrow`。载入时注册，排版前展开成 `<g>`：一根 `line` 加一个张角 30° 的 `polygon`。`--emit` 仍写 `<arrow>` |
| 绘制 | `canvas`、`script`。见「蒙版和程序」 |

`style` 里认这些属性：`flex-direction`、`gap`、`row-gap`、`column-gap`、`flex-wrap`、`padding`、`align-items`、`align-self`、`align-content`、`justify-content`、`flex`、`flex-grow`、`flex-shrink`、`flex-basis`、`width`、`height`、`max-width`、`background`、`background-color`、`border`、`border-radius`、`font-size`、`font-weight`、`font-family`、`color`、`letter-spacing`、`fill`、`writing-mode`、`line-height`、`text-align`、`white-space`、`text-wrap`、`object-fit`、`object-position`、`opacity`、`rotate`、`scale`、`translate`，以及效果一节里的名字。不认识或写错的报 `invalid-attr`，该项退回 CSS 初始值。

和 CSS 不一样的地方：

- 文字盒子（`p`、`h1`–`h3`、`span`，以及只放文字的 `div`）里只能放文字、行内标签和 `<img>`。块级标签和 `layer` 报 `invalid-child`。多段写成 `<div><p>…</p></div>`。
- 没写 `display:flex` 的 `div`，里面有放不进文字盒子的子元素时，按块级从上到下排，不报 `invalid-child`。夹在旁边的文字单独成段。
- `display:flex` 的子元素是文字、图片、flex 容器或写了宽高的 `layer`。图形放进去先包一层有宽高的 `layer`。线条和 `g` 直接放进来不渲染，报 `warn`。形状直接放进来照尺寸渲染并报 `info`。放在 layer 里、没写 `width` 的 flex，最宽只能到 layer 的宽度（根上减去左右 `safe`）。
- `color` 只收纯色。字形颜料写 `style` 的 `fill`：纯色，或 `linear-gradient()`、`radial-gradient()`、`gradient()`。写在文字盒子上按这一层的盒子取样；写在行内标签上按这一段的行盒取样。`fill` 不继承，没写的子元素继续用 `color`。
- `background` 收纯色和 CSS 的 `linear-gradient()`、`radial-gradient()`，不收 `gradient()`。`background-color` 只收纯色。行内标签的背景铺在这一段的行盒上，不从文字盒子继承。
- `line-height` 是倍数或像素。`%`、`em` 报 `invalid-attr`。像素行高按像素继承。
- `writing-mode` 是 `horizontal-tb` 或 `vertical-rl`。
- `text-wrap` 是 `wrap` 或 `balance`。`white-space:nowrap` 禁止换行。
- 写了 `width` 按内容宽度换行；写了 `max-width` 超出才换行；都没写时默认一行，超出可用宽度则自动换行，报告记 `auto-wrap`。硬换行只用 `<br>`。
- `ChillDuanSans` 按可变字重绘制，字重轴约 300 到 800。登记了多档的取最近一档。只登记了一档的，请求别的字重仍用这一档。
- `letter-spacing` 可以写 `0`、`2px` 或 `0.05em`。`em` 按写这条声明的元素自己的字号换算。
- `text-align` 是 `left`、`center`、`right`。
- 行内标签的 `translate`、`rotate`、`scale`、`opacity` 只改绘制。`translate` 写成 `0 -12` 或 `12 0`，`scale` 写成 `1.2` 或 `1.2 0.8`，`rotate` 是纯数字角度，例如 `12`。行宽、行高和折行按没变换的前进宽度，布局盒留在原位。同一行内标签里的字绕整段字心；`split="chars"` 时每个字绕自己的字心。文字盒子上的 `rotate`、`scale`、`opacity` 仍作用在整块盒子上。文字盒子写了 `split="chars"` 时，这四项改到每个字上，盒子不再整块转动、缩放或变透明。转完的四边形并进这一行和文字盒子的着墨框。透明度低于 0.01 的字占位，但不进着墨。竖排时每个字独占一行，变换绕这个字的字心。行首行尾的标点跟着同一处行内归属：最内层写了 `id` 的行内标签，没写 `id` 的算同一处。`translate`、`rotate`、`scale`、`opacity` 不同，逗号也不落到下一行行首。拼成同一段再绘制时，这四项必须相同。

图标写 `<span class="material-symbols-outlined">home</span>`。字号和颜色跟周围的文字，字重写 `font-weight`，按 100 到 700 的整百取最近一档，两边一样近时用较轻的。`font-family` 写成 `Symbols`、`图标` 或 `material-symbols-outlined` 同样换。`material-symbols-rounded` 和 `material-symbols-sharp` 仍用这一套，并报 `invalid-attr`。对不上的名字报 `missing-icon`。

`img` 的 `src`、`alt` 是属性。宽高、`object-fit`（`fill`、`contain`、`cover`、`none`）、`object-position`、圆角写在 `style`。都没写宽高时用图片像素尺寸；只写一边时另一边按原比例。在 layer 里落在 `(0, 0)`，要指定位置就外包 `layer`。`src` 支持相对路径、`http(s)` 和 data URL。读不到报 `missing-image`，写了宽高的盒子仍然占位。

`<math>` 可以放在 `layer` 里，也可以放进 `display:flex`，不能放进文字盒子。字号默认 40px。公式不换行。支持 `math`、`mrow`、`mi`、`mn`、`mo`、`mtext`、`mspace`、`mfrac`、`msub`、`msup`、`msubsup`、`msqrt`、`mroot`、`munder`、`mover`、`munderover`、`mtable`、`mtr`、`mtd`、`mstyle`、`mphantom`、`semantics`。`annotation` 不画。这些标签单独写、不包在 `math` 里，报 `unknown-tag`。字母、数字和运算符只用 `STIXTwoMath`，在 `math`、`mi`、`mn`、`mo` 上写别的 `font-family` 报 `invalid-attr`。`mtext` 用外面的字体。`display="block"` 时分数不缩小，求和、积分用大号字形，上下限放到基座上下方。横排 flex 写了 `align-items:center` 时，公式基线和同字号文字对齐；写了 `align-items:baseline` 时按公式自己的基线对齐。

### 图形

几何用 SVG 自己的属性。`rect`、`ellipse` 上的 `x1` `y1` `x2` `y2` 报 `invalid-attr`。`rect`、`circle`、`ellipse` 上的 `anchor` 忽略并报 `info`。`rect`、`tube` 上的 `cx`、`cy` 忽略并报 `warn`。

| 标签 | 写法 |
| --- | --- |
| `rect` | `x` `y` `width` `height`，左上角。`rx` 是圆角；`ry` 没写时跟 `rx` |
| `circle` | `cx` `cy` `r` |
| `ellipse` | `cx` `cy` `rx` `ry` |
| `line`、`arrow` | `x1` `y1` `x2` `y2`。`arrow` 的 `head` 默认 `max(12, stroke-width × 4)` |
| `polyline`、`polygon`、`curve` | `points`。`curve` 可写 `closed` |
| `path` | `d` |

线条放在 layer 里，坐标就是局部坐标。写了 `x`、`y` 会忽略并报 `warn`。布局盒子是纯几何范围。`stroke` 默认是 `color`，`stroke-width` 默认 4。`polygon`、`path`、`curve` 的 `fill` 默认 `none`。开口的 `curve` 写了 `fill` 也不填，报 `open-curve-fill`。`curve` 穿过每个点，两个点退化为直线。还支持 `stroke-linecap`、`stroke-linejoin`、`stroke-dasharray`。

形状没写 `depth` 时，`fill` 默认 `#000000`，`stroke` 默认 `none`，`stroke-width` 默认 1。`stroke-dasharray` 奇数段会再重复一遍；写错报 `invalid-attr` 并画成实线。

`<g>` 放在 `layer` 里。它没有宽高，不建立新坐标系。子元素仍用 SVG 坐标。允许形状、线条、`path`、`curve` 和 `<g>`。放进文字盒子或 flex 报 `invalid-child`。`transform` 的 `translate`、`rotate`、`scale`、`matrix` 只写在 `<g>` 上。`fill` 和纯色 `stroke` 传到子形状，子元素自己写了的优先。写成宽度加颜料的 `stroke` 留在这一组，按合并后的墨迹描一圈。布局盒子是变换后的并集。

### 颜料

纯色、`linear-gradient()`、`radial-gradient()` 按 CSS。`gradient()` 是 Flex Layer 的写法：颜色是一张矩阵，列沿 `u`，行沿 `v`，行与行用 `/` 分开，在 OKLab 里做双线性插值。只有一行时忽略 `v`。

```
gradient( [映射 ,] 颜色行 [ / 颜色行 ]* )
```

位置是 0 到 1。省略时两端是 0 和 1，中间均匀。坐标是元素盒子里的像素，原点在左上角。

| 映射 | u | v |
| --- | --- | --- |
| 省略，或 `box` | 从左到右 | 从上到下 |
| `linear x1 y1 x2 y2` | 线段起点到终点 | 线段的左手侧，距离按线段长度计 |
| `radial cx cy r` | 圆心到半径 | 从正上方起顺时针一圈 |
| `radial cx cy r0 r1` | 内半径到外半径 | 同上 |
| `conic cx cy [角度]` | 从正上方起再加起始角度，顺时针 | 圆心到盒子最远角 |

语法失败报 `invalid-attr`，退回该属性的默认纯色。

`stroke` 写颜色时，形状和线条居中描边。写成 `6 #000`、`6 #000 outside`、`6 #fff inside`、`8 #fff center`，或 `6 #ffffff, 14 #c8321e` 时，按到墨迹的距离描边，默认 `outside`，后一层的宽度是总距离。文字、图片、`layer` 和 flex 写颜色时沿墨迹外侧描，没写宽度时用 4。`layer` 和 flex 按整棵子树合并后的墨迹描一圈，背景和边框算进去。文字盒子和图片有底板时，描边绕着底板。`inside` / `center` 的内侧宽度达到字号的约 8% 时报 `stroke-fill`。`outline` 和 `-webkit-text-stroke` 报 `non-canonical`，改写 `stroke`。

### 效果

图形和 `layer` 写属性，文字写在 `style` 里。`overlay`、`grade`、`grade-mask` 只写在 `layer` 上。效果不改变布局盒子，按着墨计算。语法和默认值在 [docs/attrs.json](docs/attrs.json)，图在 [docs/GALLERY.md](docs/GALLERY.md)。

绘制顺序：`backdrop-blur` / `glass` → `shadow` → `glow` → 外侧 `stroke` → 本体 → 内侧 `stroke` → `inner-shadow` → `inner-glow` → `overlay` → `noise`。有 `blur`、`filter`、`grade` 或 `<mask>` 时先画进离屏，再按像素滤镜、`blur`，然后按蒙版裁。蒙版层自己的外阴影、外发光和外侧描边在裁完之后按留下的轮廓再画。同时写了 `blur` 与 `filter` 时以 `blur` 为准。`glass` 与 `backdrop-blur` 同时出现时以 `glass` 为准。

`glass` 的预设是 `clear`（背景保持清楚）、`regular`、`thick`（毛玻璃）。要改参数就逗号接在后面：`clear, blur 8, tint #fff2`。可覆盖的还有 `refraction`、`specular`、`bezel`、`dispersion`。

`filter` 收 `brightness()`、`contrast()`、`saturate()`、`grayscale()`、`sepia()`、`invert()`、`hue-rotate()`。`blend` 收 `source-over`、`multiply`、`screen`、`overlay`、`soft-light`、`lighten`、`darken`。

`grade` 只写在 `layer` 上，作用整棵子树。第一项可以是预设加整体强度，后面的项覆盖同名参数。预设：`lomo`（暗部青、高光暖）、`matte`（黑位发灰）、`chrome`（青橙）、`bleach`（低饱和高对比）、`mono`（黑白）。参数：`shadows`、`midtones`、`highlights`、`contrast`、`fade`、`saturate`、`warmth`、`vignette`。报告里回显展开后的参数。`grade-mask` 复用颜料，alpha 是强度。只写 `grade-mask` 不写 `grade` 时报 `warn`。

`registerFilter({ name, kind, parse, apply })` 登记新滤镜。`kind` 是 `pixel` 或 `canvas`。`pixel` 默认只写在 `layer` 上。可选 `layerOnly`、`maskAttr`、`includeBackdrop`、`order`、`pad`。同名再登记会换掉原来的实现。`unregisterFilter` 只卸后加的。`grade` 和 `filter` 不能卸。不要占用 `outer-glow`、`drop-shadow`、`backdrop-filter`、`texture`。`filter` 里不写 `blur()` / `drop-shadow()`。

## 实体和镜头

形状写了正的 `depth` 就沿 z 挤出，厚度以所在平面为中心，布局只看宽高。`rect` 是盒子，`rx` 是圆棱。`circle` 是圆柱，轴沿 z。`ellipse`、`polygon`、`path` 按轮廓挤出，洞用 `fill-rule`（默认 `nonzero`，也可 `evenodd`）。没写 `depth` 就是平面。开口的 `line`、`polyline`、`curve` 写 `depth` 报 `invalid-attr`。没闭合的 `path` 写 `depth` 会警告。`box`、`cylinder`、`extrude` 仍可用，报 `non-canonical`。

挤出做不到的用这些标签：

| 标签 | 写法 |
| --- | --- |
| `sphere` | `cx` `cy` `r`。布局盒子是边长 `2r` 的正方形 |
| `torus` | `cx` `cy` `r` `tube`。环躺在平面里 |
| `tube` | `d` 是中心线，`r` 是管半径。`Z` 闭合成环 |
| `model` | `src` 指向 `.glb`，或在 tsx 里写 `object` 传入网格。放进有宽高的 layer。不写 `unit` 时 contain 居中。`unit` 是 1 个模型单位对应的像素，原点落在外包 layer 的 `origin`。坐标保持 y 向上。`object` 读几何体、世界矩阵、颜色、粗糙度和金属度，不读相机。不写 `material` 时，Lambert 和 Toon 用 `matte`，Phong 按 `shininess` 收成粗糙度后用 `plastic`，透射不小于 0.5 用 `glass`，其余金属度不小于 0.5 用 `metal`，否则用 `plastic`。内存里的 `map` 和顶点色乘上底色后再明暗，`emissive` 加在明暗之后。`ShaderMaterial` 不执行，只取 uniforms 里的颜色。`Line`、`LineSegments`、`LineLoop` 按线段画进同一深度缓冲；`wireframe` 为真时只画边。线用材质颜色，线宽是屏幕像素，不写是 1。`Points` 不画 |
| `ground` | 没有宽高。`x` `y` `z` 是平面上的一点。正的 `rotateX` 让上边远离观众，`rotateX="90"` 放成水平地面。不写旋转时平面正对镜头。不写 `fill` 时透明，只接影子。`shadow-blur` 默认 0，`shadow-opacity` 默认 0.4，`shadow-color` 默认 `#000000` |

`fill` 只收纯色，渐变用第一个颜色并报 `invalid-attr`。`material` 是 `matte`、`plastic`、`metal`、`glass`，可跟粗糙度，不写是磨砂。实体上的 `stroke` 描棱线，`hidden` 是隐藏线的颜色。`shadow` 和 `glow` 写在实体上报 `invalid-attr`。

SVG 元素可以写 `transform="rotateX(40) translateZ(20)"`，和 `rotateX`、`z` 是同一套姿态，各项相加。二维的 `translate`、`rotate`、`scale`、`matrix` 仍写在 `<g>` 上；写在形状上报 `warn`，姿态仍会加上。

同一层里出现这些实体、`ground`，或 `rotateX`、`rotateY`、`z`，就开镜头。`camera` 写在取景的 `layer` 上。不写时，有这些线索的最外层用自己的 `height` 当视距，里面没写 `camera` 的层不另开镜头。这一层没有正的 `height`、又没有写出视距时，仍按二维绘制，报 `flatten-3d`。和 `view` 分开写。

`camera` 可以是一个视距数字，或这些字段：`focal`、`fov`、`lens`、`parallel`、`at`、`orbit`、`roll`、`distance`、`from`、`vanish`。`orbit` 是 yaw、pitch，度：yaw 正数机位往右绕，pitch 正数从上往下看。`roll` 正数让画面绕对准点顺时针转。`distance` 不写时等于焦距。景深是 `aperture`（无限远处的模糊半径，成片像素）、`focus`（不写时等于 `distance`）、`max`。要保持清楚的那一层写 `sharp="true"`。`parallel` 是平行投影，没有近大远小，也不报 `behind-camera`；`distance`、`vanish` 和景深三个字段报 `info` 并忽略。`at` 默认盒子中心、`z=0`。`from` 不能再写 `orbit` 或 `distance`。对象和字符串等价，`--emit` 按作者写的字段写回。机位偏离默认之后，没有 `z` / `rotateX` / `rotateY` 的子元素也要投影。平面中心或实体顶点乘过镜头矩阵之后 `w` 小于等于 0 时报 `behind-camera`，该元素不绘制。只包住实体、去掉实体后没有可画纹理的层写了 `blur`，报 `invalid-attr`。

`z` 越大越靠近观众。这一层没有实体或 `ground` 时，直接子元素按中心深度从远到近绘制，深度相同保持文档顺序。出现实体或 `ground` 时改成深度缓冲。嵌套 `layer` 自己没有 `camera` 时，里面的实体和平面仍算进外层这台场景。

`preserve-3d` 写在 `layer` 或 flex 上时，子元素沿着父链进入外层这台镜头，和直接子元素一起按深度排序。`opacity` 小于 1、`blur`、`filter`、`grade`、`<mask>`、`overflow="hidden"`，以及 `glass`、`backdrop-blur`、非 `source-over` 的 `blend`、`noise`、`overlay`，仍然把子树收成一张图，报 `flattened-3d`。自己写了 `camera` 的嵌套层是另一台镜头。

影子只落在 `ground` 上。`shadows="none"` 写在开了镜头的那一层，关掉影子，深度遮挡还在。`cast-shadow="false"` 这只实体不投。`receive-shadow` 只写在 `ground` 上。写在别处，或 `shadows` 不是 `auto` / `none`，或写在没开镜头的层上，报 `invalid-attr`。

## 蒙版和程序

### 蒙版

`<mask>` 只作为 `layer` 的直接子元素，一层一个。它裁的是这一层合成完的画面，包括子元素的阴影、模糊、调色和颗粒。这一层自己的 `shadow`、`glow` 和外侧或居中的 `stroke` 按留下的轮廓来画，可以伸出蒙版。写在父层上的描边和阴影也跟着这块轮廓。内侧描边留在蒙版里面。蒙版自己不画、不占布局，里面的形状不进元素表。被挡住的内容不报 `overflow-canvas` 或 `effect-clipped`。画布底色不进蒙版。

里面直接写 `rect`、`circle`、`ellipse`、`polygon`、`path`，也可以放 `img` 或 `<g>`。`line`、`arrow`、`polyline`、`curve`、文字、`div`、嵌套 `layer` 会 `warn` 并忽略。空的报 `empty-mask`。没写 `fill` 时按 `#fff` 画满，只看 alpha。`op` 默认 `add`，还可写 `subtract`、`intersect`、`xor`。`<g>` 先合成一组再贴上。`op` 写在 mask 外面报 `invalid-attr`。

`img` 默认用自己的 alpha。`channel="luma"` 改读亮度。`pick="3 5"` 只留下灰度正好是这些编号的像素。`derive="subject"`、`derive="mask"` 或 `derive="regions"` 改读旁边的缓存：`photo.jpg` 对应 `photo.subject.png` 和 `photo.cutout.json`。缓存没有时报 `missing-mask`。原图哈希对不上时报 `stale-mask`，文件还在就先画。网址和 data URL 不能 `derive`。

`<mask feather="8" invert="true">` 在全部步骤之后做。`mask-image` 这类 CSS 写法报 `invalid-attr`。

`<preview of="#person" show="overlay checker black white edges" />` 只作为 `layer` 的直接子元素，正常成片里不画。`show` 不写就是这五项都要。`flexlayer render scene.layer --preview out.png` 另写一张拼图。`check` 和多帧不带 `--preview`。

### 图片和抠图

`analyzeImage(src, options?)` 是同步接口，量一张已经存在的图，不生成遮罩。返回 `width`、`height`、`channel`、`hasAlpha`、`area`、`ink`、`pieces`、`parts`、`holes`、`softEdge`、`d`。`channel` 默认 `auto`，`threshold` 默认 128，`tolerance` 默认 0.5。`d` 写进 `<mask><path d /></mask>` 就是同一块蒙版。

生成遮罩在 `flexlayer-select`，不在 npm 上。仓库里进入 `packages/select`，执行 `npm install && npm run build`。

```bash
npx flexlayer-select cutout photo.jpg --preset portrait
npx flexlayer-select apply photo.jpg --add 2 --subtract 1
npx flexlayer-select mask photo.jpg --point 820,640 --omit 900,1100 --refine
```

`cutout` 的预设是 `portrait`、`product`、`flat`。旁边得到 `photo.subject.png`、`photo.mask.png`、`photo.regions.png`、`photo.cutout.json`。`mask` 写出 `photo.foreground.png` 和 `photo.foreground.json`，字段是 `mask`、`x`、`y`、`width`、`height`、`points`、`omit`。`--point` 点在要留下的地方，`--omit` 点在不要的地方。程序里调用 `foregroundMask`。没装这个包时，`flexlayer select` 只提示在 `packages/select` 里安装。

### 轮廓

`glyph(text, { font, size, weight })` 按码位返回数组。每个字有 `text`、`d`、`font`、`size`、`weight`、`width`、`height`、`baseline`、`ink`、`missing`。`d` 的原点在字身盒子左上角，y 向下。没写 `size` 时是 40。`ChillDuanSans` 的轮廓只有默认字重 300，请求其它字重会抛错。空格的 `d` 是空字符串。字体里没有的字 `missing` 为 `true`，`d` 是缺字方框。

摆回排版位置：`x` 用 `canvas.create` 返回的 `chars` 里的 `x`，`y` 用 `line.baseline - glyph.baseline`。

`createCanvas`、`loadImage`、`initFonts`、`applyCanvasFont`、`registerFontPath`、`DEFAULT_FONT_FAMILY` 从主入口导出，用的是排版那一份 `@napi-rs/canvas`。`initFonts()` 准备默认字体。`initFonts(['Kai'])` 再按目录里的名字准备，没登记的名字会抛错。`registerFontPath(family, filePath)` 登记一份自定义字体文件；这个名字已经登记过就不再换文件。`applyCanvasFont(ctx, family, weight, size)` 把可变字重写进 `wght` 轴，测量和绘制共用。只写 `ctx.font` 时，`450` 会被当成字号。

### canvas 和 script

自定义像素用 `<canvas>` 和 `<script>`。`<draw>` 报 `invalid-child`（error），`draw` 回调报 `invalid-attr`（error）。

`width`、`height` 是位图尺寸，也是默认布局尺寸，不写是 300×150。`style` 里的宽高只改布局。`devicePixelRatio` 等于渲染的 `--scale`。脚本在排版之后、绘制之前执行。每一帧都是新画布。脚本先跑一遍，然后只调用一轮 `requestAnimationFrame`。`performance.now()` 和 `Date.now()` 返回这一帧的毫秒，单帧是 0。`.layer` 里的 `Math.random` 按帧播种。`.layer` 的脚本文本在子进程里执行。`.tsx` 里的函数闭包留在本进程。`--no-script` 跳过，记一条 info。

可用的只有 `document.querySelector`、`document.getElementById`、`canvas.getContext('2d')`、`getComputedStyle`、`canvas.dataset`、`requestAnimationFrame`、`performance.now`、`getBoundingClientRect`、`devicePixelRatio`。选择器只支持 `#id`、`canvas`、`canvas#id`。别的 DOM 报 `unsupported-dom`。`.layer` 的 `data-*` 出现在 `dataset` 里。结构化数据写 `data`，值是 JSON。脚本抛错记 `invalid-script`，其余内容照常绘制。

### 帧

`t` 的单位是秒。`Composition` 有 `width`、`height`、`fps`、`durationInFrames` 和 `component({ frame, fps, t })`。

| 函数 | 作用 |
| --- | --- |
| `renderLayer(node, options?)` | 渲染一帧。`format: 'rgba'` 返回不预乘的原始像素 |
| `renderFrames(comp, { from, to, step, format })` | 异步迭代器，逐帧产出。`to` 含端点 |
| `renderComposition(comp)` | 一次返回全部 PNG、报告和联系表 |
| `random(seed)` | 固定的 `[0, 1)` |
| `noise(seed, x, y?, z?)` | 平滑噪声，`[-1, 1]` |
| `interpolate(value, input, output, options?)` | 多点映射。`easing` 用 `Easing` |
| `Easing.linear` / `quad` / `cubic` / `in` / `out` / `inOut` / `bezier` | 进度曲线 |
| `spring({ frame, fps })` | 从 0 趋近 1 |
| `sequence(input, { from, durationInFrames }, render)` | 当前帧落在区间内时把局部 `frame` 交给 `render` |

`.tsx` 里调用 `Math.random()`、`Date.now()`、`crypto.randomUUID()` 或 `crypto.getRandomValues()` 报 `nondeterministic`。可重复的随机数用 `random` 或 `noise`。

```bash
flexlayer render scene.layer -o scene.png --report scene.json
flexlayer render scene.tsx -o scene.png --emit scene.layer
flexlayer render scene.tsx --frames out/ --from 0 --to 90
flexlayer render scene.tsx --rgba -
flexlayer check scene.tsx --frames 0-90 --step 5
flexlayer render scene.layer --preview out.png
flexlayer render a.tsx b.tsx -o out/ --scale 1 --scale 2
flexlayer check a.tsx b.tsx
```

`.tsx` 会先执行。类型检查在 `check` 里做，类型错误记为 `type-error`，退出码为 1。`render` 默认不查类型。`render --typecheck` 把类型错误记入报告，照常出图，退出码为 1。`check --no-typecheck` 跳过类型检查。多个文件可以写在同一个命令里，一次进程做完。`render` 可以重复 `--scale`，同一份源只执行一次，文件名加上 `@1x`、`@2x`。这时 `-o`、`--report`、`--emit` 是目录。文件头写 `/** @jsxImportSource flexlayer */`。默认导出一个 `<layer>`，或返回该节点的函数。命名导出 `composition` 可以是 `Composition`。`check` 不写 `--frames` 时抽第 0 帧、中间帧和最后一帧。`--emit` 写回 `.layer`；闭包记 `emit-script`，不能写成 JSON 的 `data` 记 `emit-data`。帧数超过 300 且没有 `--frame`、`--frames` 或 `--rgba` 时不渲染联系表。flexlayer 不调用 ffmpeg。

### canvas.create

`canvas.create` 的参数必须已经是 `<layer>`。返回这棵 `<layer>`，并带上量完的 `left`、`top`、`right`、`bottom`、`width`、`height`。这六个数是布局盒，不含 `rotate` 和 `scale`。转完之后的外接矩形在 `rotatedBox`。下一块要避开转过的内容，用 `rotatedBox.bottom`。`create` 是同步的，备好的字体和图片留在进程里。

`text` 是文字节点数组，坐标相对这一层布局盒的左上角。每一项有 `path` 和 `lines`。每一行有 `x`、`y`、`width`、`height`、`baseline`、`chars`。每个字有 `text`、`x`、`width`；最内层写了 `id` 的行内标签拥有这些字时，字上还有 `id`。竖排时每个字自己占一行。

`elements` 按文档顺序，父元素在子元素前面。根层自己不在里面。`mask`、`symbol`、`script` 不进这张表。

| 字段 | 含义 |
| --- | --- |
| `path`、`tag`、`id` | 相对这一层的路径。写了 `id` 才有 `id` |
| `box` | 布局盒。不含这一元素自己的 `rotate` |
| `ink` | 这一元素自己的 `rotate`、`scale` 之后的外接矩形。线条含描边 |
| `mask` | 写了 `<mask>` 的 `layer` 才有。字段和报告里的 `mask` 相同 |
| `points`、`edges`、`d` | 落在镜头里的实体才有。投影后的顶点、棱和看得见的轮廓。球只给解析轮廓，不写 `points` |

根层自己写了 `<mask>` 时，返回值上也有 `mask`。

只写 `width` 或只写 `height`，且里面没有会换行的文字时，另一边按比例放缩，比例乘进已有的 `scale`。会换行的文字：`width` 是行宽，高度是排出来的。宽高都写了就是盒子。都没写则保持量出来的大小。手写的 `.layer` 不走这套比例放缩。最终排版和量到的盒子不一致时报 `measure-mismatch`。

自定义字体写 `<font family src>`，或先 `canvas.font(family, src)`。相对路径按源文件所在目录解析。字体还没注册就 `create` 会抛错。根上没写 `safe` 时，渲染按短边的 4%；页面不想要就写 `safe="0"`。

`canvas.component(name, render)` 按标签名注册组件。返回一个元素或数组。排版前展开，`--emit` 仍写原来的标签。同名再注册会替换。类型写在 jsx 运行时上：

```tsx
declare module 'flexlayer/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      badge: { r: number; fill?: string }
    }
  }
}
```

内置 `arrow` 用这个注册。未注册的标签报 `unknown-tag`。

还没做的：把帧序列编码成视频、按着墨范围排版、`Icon`。`Scene3D` 这个名字留着。点选和作者灯光见 [docs/proposals/3D.md](docs/proposals/3D.md)。滤镜和公式的实现备注见 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。

### 报告

渲染同时输出 JSON。`elements` 里每个节点有 `path`、`id`、`tag`、`box`、`ink`。从 `.tsx` 来的还可以有 `source`，形如 `examples/hello.tsx:18:5`。

- `box`：布局盒子，只累加平移。
- `ink`：转完、缩完、投影之后的着墨外接矩形，并和祖先的 `overflow="hidden"`、`<mask>` 求过交。像素对位看 `ink`。线条的中心线落在画布边上时，描边半径探出去不算超出。
- `effect`：阴影、光晕、图层模糊或玻璃可能占用的范围。没有外扩时不写。画出画布时报 `effect-clipped`。
- `mask`：写了 `<mask>` 的 `layer` 才有。`area` 是留下的比例，`ink` 是 alpha 大于 0 的外接矩形，`pieces` 是八连通块个数，`softEdge` 是软边平均宽度，`ops` 是每一步的 `op`、`changed`、`path`。`changed` 为 0 时报 `mask-op-noop`。
- `quad`：投影后的四个角，顺序为左上、右上、右下、左下。
- `opacity`：从根乘下来的透明度。小于 0.01 的元素仍出现在表里，但不参与越界、安全区、重叠和最小字号检查。
- `inline`：带 `id` 的行内标签才有。不参与 `outside-safe`、`min-font-size` 和 `text-overlap`。
- `screenScale`、`defocus`、`filters`：有内容才写。

| code | 级别 | 含义 |
| --- | --- | --- |
| `overflow-canvas` | error | 着墨超出画布。`view` 裁在取景窗里的部分不算 |
| `outside-safe` | warn | 文字超出安全区。被取景窗或 `overflow="hidden"` 裁掉的边不算 |
| `text-overflow` | error | 文字超出了写死的宽度或高度 |
| `flex-overflow` | warn | 子元素超出了写死尺寸的 flex 容器 |
| `text-overlap` | warn | 两段文字的着墨重叠。两段都有 `quad` 时看凸四边形是否相交 |
| `min-font-size` | warn | 屏幕上的字号小于根上的 `min-font`。多处合并成一条 |
| `auto-wrap` | info | 文字超出可用宽度，被自动换行 |
| `non-canonical` | info | 含义明确，但不是规范写法。照常渲染 |
| `unknown-tag` | warn | 不认识的标签。写成已知标签的大写时是 error |
| `invalid-attr` | warn | 属性放错位置，或值写错。`anchor` 写错、路径 `d` 无法解析也是这个码。`draw` 回调是 error |
| `invalid-child` | warn | 非法子元素。含块级子元素的 `div` 按块级竖排，不报这条。文字盒子里的 `<img>` 不报这条。`<draw>` 是 error |
| `empty-mask` | warn | `mask` 里没有可用的形状或图片 |
| `mask-op-noop` | warn | 蒙版的某一步没有改变选区 |
| `missing-mask` | error | `derive` 的缓存不存在，或 `src` 不是本地图片 |
| `stale-mask` | warn | 缓存还在，但原图哈希对不上 |
| `invalid-script` | error / warn / info | 脚本出错、内容为空，或 `--no-script` 跳过 |
| `missing-image` | warn | `img` 的 `src` 读不到 |
| `missing-icon` | warn | 图标名对不上 |
| `missing-model` | warn | `model` 的 `src` 或 `object` 不可用，或没有可放入的宽高 |
| `missing-symbol` | warn | `use` 的 `href` 没有对应的 `symbol` |
| `symbol-cycle` | warn | `symbol` 通过 `use` 引用了自己 |
| `open-curve-fill` | warn | 开口的 `curve` 写了 `fill` |
| `effect-clipped` | warn | 本体在画布内，阴影、光晕、描边或模糊超出画布 |
| `view-outside` | error | `view` 没有被直接子元素盖住 |
| `stroke-fill` | warn | 内侧描边达到字号的约 8% |
| `ink-inset` | info | 锚点贴着左右边，字形比盒子靠里。开了镜头的 layer 不报 |
| `ink-anchor-empty` | info | `anchor-box="ink"` 没有着墨 |
| `ink-anchor-rotate` | info | `anchor-box="ink"` 和 `rotate` 同时存在 |
| `flatten-3d` | warn | 三维姿态或实体没有落在镜头里 |
| `flattened-3d` | info | 写了 `preserve-3d`，但这层会把子树收成一张图 |
| `behind-camera` | warn | 投影后 `w` 小于等于 0。`parallel` 不报 |
| `unsupported-dom` | error | 脚本用了子集以外的 DOM |
| `emit-draw` | warn | `--emit` 时还写着 `draw` 回调 |
| `emit-script` | warn | `--emit` 时 `<script>` 是闭包 |
| `emit-data` | warn | `--emit` 时 `data` 写不成 JSON |
| `unused-expect` | warn | 写了 `expect`，但子树里没有这个问题码 |
| `nondeterministic` | warn | `.tsx` 里调用了不可重复的随机或时间 |
| `type-error` | error | `.tsx` 的 TypeScript 诊断。`check` 和 `render --typecheck` 才产生 |
| `measure-mismatch` | warn | `canvas.create` 量到的宽高和最终排版不一致 |

任何元素可以写 `expect="overflow-canvas: 出血图; text-overlap"`。对得上的问题降成 `info`，并带上 `expected`。没对上的报 `unused-expect`。多帧检查时，只要有一帧用上就不报。Composition 抽查出来的问题带 `frame` 和 `frames`。
