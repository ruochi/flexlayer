# Flex Layer 规范

Flex Layer 用标签描述**一帧画面**。HTML 标签用 `style`，其余标签用属性。结构标签只有 `layer`。文字用 HTML 写法，排布用 `display:flex`，图形用 SVG 属性。
动画 = 程序为每个时刻生成一份 Flex Layer。报告里的 `flexlayer` 是格式版本 `0.1`，和包版本不是同一个数。

设计原则：

1. **一律实际像素**：所有数字都是像素，可以写 `px` 后缀，不支持百分比、em、rem。
2. **位置由 layer 决定**：`layer` 负责定位，`display:flex` 的 HTML 负责排布。图形用自身坐标画在 layer 里。
3. **y 轴向下**：和 Canvas、HTML 一致，`y="400"` 表示距离父级顶部 400 像素。
4. **显式写了就照做**：写了尺寸、位置就严格使用，不会被悄悄改掉；有问题只在报告里指出。
5. **没写的由渲染器决定，并写进报告**：比如自动换行。
6. **写错了要说怎么改**：有歧义或会被忽略的写法报 `warn` 并给出 `hint`；含义明确但不规范的写法照常渲染，报 `info`。和已知属性编辑距离不超过 2 的名字报 `warn`，`hint` 写出正确属性，例如 `widht` 提示改成 `width`。其余不认识的名字仍留给 `draw`。

给模型的硬性约定见 [AGENTS.md](AGENTS.md)。效果图见 [docs/GALLERY.md](docs/GALLERY.md)。

## 1. 文件结构

```html
<layer width="1080" height="1920" background="#0f1115" color="#ffffff">
  <font family="DeYiHei" src="https://example.com/deyihei.otf" />
  <layer x="540" y="700" anchor="center">
    <div style="display:flex; flex-direction:column; gap:32px; align-items:center">
      <h1>比特币减半</h1>
      <p style="color:#f7931a">每四年一次</p>
    </div>
  </layer>
</layer>
```

根元素 `<layer>` 本身就是一个 `layer`（见下文），属性：

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| `width`、`height` | 必填 | 画布尺寸 |
| `background` | `#ffffff` | 画布背景色，写 `transparent` 输出透明 PNG |
| `color` | `#111111` | 全局文字色、线条默认色 |
| `font-family` | `ChillDuanSans` | 全局字体。目录里的名字直接写，第一次用到时自动下载。见 [docs/RESOURCES.md](docs/RESOURCES.md) |
| `safe` | 画布短边的 4% | 安全区边距，`上 右 下 左` 或一个数字，只用于检查 |

`<font family="名字" src="路径或网址" />` 注册额外字体，只能写在根元素下。`src` 必须是字体文件。不想自己找文件时，写目录里的名字：`Song` / `宋体`（Noto Serif SC，思源宋体简体子集）、`Kai` / `楷体`（霞鹜文楷）、`Brush` / `书法`（马善政毛笔楷书），以及 `Inter`、`Playfair`、`NotoSans` 等。有 400 和 700 两档的取最近的一档，只登记了一档的字体始终用那一档。

## 2. 元素一览

| 类别 | 标签 |
| --- | --- |
| 容器 | `layer`（嵌套不填背景）。横排竖排用带 `display:flex` 的 `div` |
| 绘制 | `draw`（子标签，正文 JS；程序侧也可用 `draw={fn}`） |
| 文字 | `h1`、`h2`、`h3`、`p`、`div`、`span`；行内：`span`、`strong`、`b`、`em`、`br` |
| 图片 | `img`（`image` 是同一个标签） |
| 形状 | `rect`、`circle`、`ellipse` |
| 分组 | `g`（放在 `layer` 里，用 `transform` 平移、旋转、缩放） |
| 线条 | `line`、`arrow`、`polyline`、`polygon`、`path`、`curve`。`arrow` 是内置组件，排版时展开成 `g` |
| 复用 | `symbol`、`use` |
| 蒙版 | `mask`（只作为 `layer` 的直接子元素） |
| 网格 | `sphere`、`box`、`extrude`、`model`。放在带 `perspective` 的 `layer` 里 |
| 字体 | `font`（只作为根元素的子元素，`family` 加 `src`） |

- 标签一律小写。写成 `<Circle>` 仍会渲染，并报 `non-canonical`。HTML 只写 `style`，`layer` 和图形只写属性。图片的 `src`、`alt` 仍是属性。
- 后写的元素画在上面。
- 不认识的标签会被忽略，并在报告里给出警告。

## 3. 通用属性与归属

| 属性 | 说明 |
| --- | --- |
| `id` | 报告里用来指认元素 |
| `x`、`y` | 写在 `layer`、`use`、`rect`、`box`、`extrude` 和带尺寸的自定义元素上。是定位点，没写是 `0`。默认对应盒子左上角（见 `anchor`） |
| `anchor` | `(x, y)` 落在盒子的哪个点。九宫格：`top-left`（默认）、`top`、`bottom`、`left`、`right`、`center`、`top-right`、`bottom-left`、`bottom-right` |
| `opacity` | 0 到 1。嵌套时逐层相乘 |
| `rotate` | 绕 `origin` 旋转，单位度，顺时针为正。对文字、线条、形状和 layer 都生效；layer 上的旋转作用到整棵子树 |
| `scale` | 绕 `origin` 缩放，同样作用到整棵子树 |
| `origin` | 旋转和缩放的支点，取值和 `anchor` 一样，默认 `center` |

`rotate`、`scale` 只影响绘制，不影响布局。报告里的 `box` 是变换前的布局盒子（只累加平移），`ink` 是变换后的外接矩形。有透视时 `ink` 改成投影后的外接矩形，并多一个 `quad`（投影后的四个角）。

`perspective` 只写在 `layer` 上，单位是像素，是直接子元素共用的视距。灭点是这一层盒子的中心，`z` 正方向朝观众，数值越大看起来越大。`rotateX`、`rotateY`、`z` 的归属和 `rotate` 相同，写在要转动或推近的那一层上，不改变布局。没有祖先写 `perspective` 时仍按二维绘制，并报 `flatten-3d`；这时 `z` 不改变绘制顺序。子元素的 `z` 大于等于视距时报 `behind-camera`，该元素不绘制。带三维姿态的平面先按 4 倍分辨率绘制，再平均缩回逻辑像素，斜边因此抗锯齿。平面上的 `shadow` 和 `glow` 画在这张位图的外侧，再一起投影，不会被裁在平面自己的框里。没有三维姿态、也没有网格的内容仍走原来的二维绘制。

`z` 的前后只在带 `perspective` 的那一层生效。这一层没有 `sphere`、`box`、`extrude`、`model` 时，直接子元素按中心深度从远到近绘制，深度相同保持文档顺序。出现这些网格时，这一层改成一台三维场景，网格和带姿态的平面放进同一个深度缓冲：更靠近观众（`z` 更大）的面盖住更远的面，不透明的面写入深度。嵌套 `layer` 自己没有 `perspective` 时，里面的网格和平面仍算进外层这台场景。

同一层里如果出现 `sphere`、`box`、`extrude` 或 `model`，这一层改成一台三维场景，和带姿态的平面共用这一个 `perspective`。没有这些标签时，像素和上面的平面透视一致。`sphere` 写 `cx` `cy` `r`，布局盒子是边长 `2r` 的正方形，圆心就是这个点。`box` 写 `x` `y` `width` `height` `depth`，布局只看宽高，`x` `y` 是左上角。`extrude` 的 `d` 和 `path` 相同，沿 z 挤出 `depth`，厚度以所在平面为中心。`d` 里分开的子路径是分开的实体；包在外圈里面的才是洞。`model` 只写 `src`，指向一个 `.glb`；位置和宽高写在外包的 `layer` 上，模型按 contain 居中放进这个盒子，文件里的相机忽略。单位都是像素。没写 `depth` 时报 `invalid-attr`，并退回宽高里较小的一边。作者只写 `fill`。正对镜头的面就是这个颜色，侧面更暗；`model` 用文件里的底色乘这套明暗。渐变 `fill` 只用第一个颜色，并报 `invalid-attr`。`shadow` 和 `glow` 写在网格上也会报 `invalid-attr`，不绘制。网格可以画出它所在 layer 的盒子，和平面一样；投影后的 `ink` 超出画布时报 `overflow-canvas`。`overflow="hidden"` 仍裁在这一层里。网格没有落在 `perspective` 里时报 `flatten-3d`，并且不绘制。`src` 缺失、不是 `.glb` 或读不到时报 `missing-model`。这一层按 4 倍分辨率绘制，再按预乘 alpha 平均缩回，和透视平面同一套抗锯齿。网格用自带的三角形光栅绘制。同一台透视场景里，不透明的网格和平面会沿内置主光互相投下硬边影子；被挡住时主光不计，只留环境光和补光。这里的同一台场景不限于同一个父标签：没有自己 `perspective` 的嵌套 `layer` 里的 `sphere`、`box`、`extrude`、`model` 和平面，仍算进外层这台场景，影子会投到父层的地板上，也会挡住父层的物体。嵌套 `layer` 自己写了 `perspective` 时是另一台场景，不共用这张影子。属性 `shadow` 仍是平面上的偏移暗边。`Scene3D` 仍不使用。

属性归属（由 [src/schema.ts](src/schema.ts) 生成，不要手改两行标记之间的表）：

<!-- attrs:ownership:begin -->
| 属性 | 写在哪 |
| --- | --- |
| `width`、`height`、`x`、`y`、`anchor` | `width`、`height` 以及 `x`、`y`、`anchor`。`x`、`y` 是左上角，默认 0；`anchor` 默认 `top-left`。HTML 上写了报 `warn` |
| `opacity`、`rotate`、`rotateX`、`rotateY`、`z`、`scale`、`origin` | 图形、线条和 `layer` 写属性；文字写在 `style`。HTML 上写成属性报 `warn` |
| `background`、`padding`、`font-size`、`color`、`flex`、`flex-grow`、`flex-shrink`、`gap`、`border`、`border-radius`、`max-width`、`align-items`、`justify-content`、`writing-mode`、`object-fit`、`object-position` | HTML 的 `style`。`layer` 或图形写了 `style` 报 `warn` |
| `cx`、`cy`、`x1`、`y1`、`x2`、`y2`、`points`、`d`、`depth`、`fill`、`stroke`、`transform` | 图形属性，坐标是所在 `layer` 的局部坐标 |
| `src`、`alt` | 只写在 `img` 或 `model` 上。图片宽高仍放进 `style` |
| `shadow`、`glow`、`inner-shadow`、`inner-glow`、`blur`、`backdrop-blur`、`glass`、`noise`、`filter`、`blend` | 图形和 `layer` 写属性；文字写在 `style`。见第 9 章 |
| `perspective`、`overlay`、`grade`、`grade-mask` | 只写在 `layer` 上。写在别处或写进 `style` 报 `warn` |
<!-- attrs:ownership:end -->

叶子的定位：

| 叶子 | 怎么定位 |
| --- | --- |
| 文字，以及没写宽高的一组 HTML | 外包一层 `layer`，把 `x`、`y`、`anchor` 写在 `layer` 上。HTML 上写 `x`、`y` 会忽略并报 `warn` |
| 图片 `img` | 和文字一样，外包一层 `layer` 来定位 |
| `rect` | `x` `y` `width` `height`，左上角。`rx`、`ry` 是圆角。不用 `anchor`，写了报 `info` |
| `box`、`extrude`、带尺寸的自定义元素 | `x` `y` 加上 `anchor`，默认左上角 |
| `circle`、`ellipse`、`sphere` | 圆心 `cx` `cy`。椭圆再写 `rx` `ry` |
| `g` | 放在 `layer` 里。`transform` 作用到子元素，盒子是变换后的并集 |
| 线条 | 端点、`points`、`d` 本身就是坐标，不写 `x`、`y` |

没写 `x`、`y` 时是 `0, 0`，不再放到父级中心。`layer`、`use`、`rect`、`box`、`extrude` 上的 `cx`、`cy` 已忽略，报 `invalid-attr`，`hint` 给出等价的 `x`、`y`。

`anchor` 示例：`<layer x="60" y="120"><h1>标题</h1></layer>` 表示这一层的左上角在 (60, 120)。要让中心落在这一点，写 `anchor="center"`。

## 4. 容器

### 4.1 layer：自由摆放，也可以当分组

原点是 layer 的左上角。嵌套 `layer`、`use`、`box`、`extrude` 和带尺寸的自定义元素用 `x`、`y` 定位；圆、椭圆和球用圆心。HTML 不写 `x`、`y`，要单独摆放就再包一层 layer。layer 可以嵌套。外层的 `opacity`、`rotate`、`scale` 会作用到里面的全部子元素，所以一组要一起移动、旋转或缩放时，包一层 layer 即可。

- 写了 `width`、`height`：layer 就是这么大，原点固定。内容可以画出盒子。做动画的分组建议写上宽高，这样坐标不会跟着内容变。
- 没写：宽高等于从原点到子元素右下角的距离。坐标在负方向的子元素会画到盒子外面，但不会把其他子元素一起平移。

`overflow="hidden"` 按 layer 的盒子裁剪子元素。默认 `visible`。被裁掉的是子元素；这一层自己的阴影、模糊仍可以画到盒子外面。祖先的 `overflow="hidden"` 会把子元素的阴影和光晕一起裁掉。已经被这样裁掉、画布上看不见的部分不报 `effect-clipped`。

`<mask>` 裁的是这一层合成完的画面，包括阴影、模糊、调色和颗粒。它写在 `layer` 里面，和要裁的内容并列。自己不画出来，不占布局，不把层撑大，不出现在报告里，也不触发 `overflow-canvas`。被它挡住的内容同样不报 `overflow-canvas` 或 `effect-clipped`：报告里的 `ink` 先和 mask 形状的外接范围求交。一层最多一个，多出来的 `warn` 并忽略。坐标和同层的图形一样，原点在 layer 左上角。

里面直接写 `rect`、`circle`、`ellipse`、`polygon`、`path`，也可以放 `img`（用图片自己的 alpha）。`line`、`arrow`、`polyline`、`curve`、文字、`div`、嵌套 `layer` 会 `warn` 并忽略。空的 `mask` 报 `empty-mask`，并且不生效。

没写 `fill` 时按 `#fff` 画满。实心形状是硬边；`fill` 的 alpha 和渐变里的透明处是软边。颜色不算，只看 alpha。没画到的像素藏起来。多个形状按书写顺序叠上，后写的盖住先写的；半透明不会把底下挖空。要挖洞，用带洞的 `path`。形状自己的 `rotate`、`scale` 仍然有效。

画布底色先铺好，不进 `mask`。根 `layer` 的 `grade` 仍作用整幅画布，包括底色。`grade-mask` 只控制调色强度。`mask` 放进 flex、写在图形或 HTML 上、写成属性或写进 `style`，都会 `warn` 并忽略。

```html
<layer width="320" height="180">
  <mask>
    <circle cx="160" cy="90" r="90" />
  </mask>
  <img src="street.png" style="width:320px; height:180px" />
</layer>
```

```html
<mask>
  <rect x="0" y="0" width="320" height="180" fill="linear-gradient(to bottom, #fff, #fff0)" />
</mask>
```

`border`、`border-radius`、`overflow` 写在 `layer` 的属性上，不写 `style`。**`layer` 不填背景**：它只合成子元素画出来的内容。色块用 `rect` 的 `fill`、HTML 的 `style="background: …"`，或子标签 `<draw>` 自己画。`layer` / `use` 上写 `background` 会警告并忽略。画布底色只写在根节点 `<layer background>`。

一组 HTML 要放到画面上，包一层 `layer`，把 `x`、`y`、`anchor` 写在 `layer` 上。

`symbol` 定义一块可复用的图，本身不画出来。`use` 按 layer 的方式摆放它：`x`、`y`、`anchor`、`rotate`、`scale`、`opacity` 都写在 `use` 上。`symbol` 里的坐标是它自己的局部坐标。

```html
<symbol id="dew" width="28" height="28">
  <circle cx="14" cy="14" r="12" fill="radial-gradient(#ffffff, #ffffff00)" />
</symbol>
<use href="#dew" x="180" y="640" anchor="center" />
<use href="#dew" x="240" y="700" scale="0.8" anchor="center" />
```

没写 `width`、`height` 时，`symbol` 的盒子包住内容。`href` 写成 `#id`。

```html
<layer x="120" y="64">
  <div style="display:flex; gap:40px; align-items:center">
    <h2 style="font-size:56px">勾股定理</h2>
  </div>
</layer>
```

### 4.2 flex：HTML 排布

`display:flex` 把 `div`（以及其他文字标签）变成排布容器，不再当文字盒子。默认横向。竖排写 `flex-direction:column`。子元素是文字、图片、flex 容器或 `layer`。

图形要放进 flex，包一层写了宽高的 `layer`，或者改用 `div` 盒子（`width`、`height`、`background`、`border-radius`）。形状直接放进来会照尺寸渲染并报 `info`；线条直接放进来不渲染，报 `warn`。两点坐标写在 flex 里的形状上不渲染，报 `warn`。

`style` 支持的属性：

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| `width`、`height` | 包住内容 | 外框尺寸（含 padding 和 border） |
| `gap` | `0` | 子元素间距 |
| `padding` | `0` | 1 到 4 个值，同 CSS |
| `align-items` | `center` | `start`、`center`、`end`、`stretch`。默认 `center`，CSS 里是 `stretch` |
| `justify-content` | `start` | `start`、`center`、`end`、`space-between`、`space-around`、`space-evenly` |
| `background`、`border`、`border-radius` | 无 | 同 CSS，border 只支持实线 |

子元素可以写的 flex 属性：`flex-grow`、`flex-shrink`、`align-self`、`width`、`height`。

- 文字默认 `flex-shrink:1`，空间不够时会换行变窄，但不会窄过最长的一个不可断开的词。
- 形状和图片默认 `flex-shrink:0`，不会被压扁。
- `align-items` 默认 `center`，CSS 里是 `stretch`。竖排 column 没写时，较窄的子项在交叉轴居中；和容器同宽的子项看起来仍贴着起点。左对齐写 `align-items:flex-start` 或 `start`。交叉轴位置由这一层自己的 `align-items` 决定，在子项上写 `justify-content` 改不了。

**可用宽度**：放在 layer 里、没写 `width` 的 flex 容器，最宽只能到 layer 的宽度（根 layer 要减去左右安全区）。

## 5. 文字

最外层的文字标签是一个**文字盒子**，里面只能放文字和行内标签（`span`、`strong`、`b`、`em`、`br`）。
要排列多段文字，请用 `<div style="display:flex; flex-direction:column">`，不要在普通文字盒子里嵌套 `div`、`p`。

### 5.1 默认样式

| 标签 | 字号 | 字重 |
| --- | --- | --- |
| `h1` | 88px | bold |
| `h2` | 64px | bold |
| `h3` | 48px | bold |
| `p`、`div`、`span` | 40px | normal |

### 5.2 style 属性

| 属性 | 说明 |
| --- | --- |
| `font-size`、`font-weight`、`font-family`、`color`、`letter-spacing` | 同 CSS，行内标签也可以写 |
| （字重规则） | `ChillDuanSans` 按可变字重绘制，字重轴约 300 到 800，中间的字重不会收成 400 和 700 两档。登记了多档文件的字体取最近的一档。只登记了一档的字体，例如 `Brush`、`Bebas`，请求别的字重仍用这一档。自带 `<font>` 且文件没有字重轴的，按 400 |
| `writing-mode` | `horizontal-tb`（默认）或 `vertical-rl`。竖排时字从上到下，列从右到左，`letter-spacing` 是字与字之间的额外间距 |
| `line-height` | 倍数，单行默认 1.2，多行默认 1.4 |
| `text-align` | `left`（默认）、`center`、`right` |
| `width`、`height` | 外框尺寸（含 padding 和 border） |
| `max-width` | 最大外框宽度，超出就换行，盒子贴合最长的一行 |
| `padding`、`background`、`border`、`border-radius` | 同 CSS |
| `white-space: nowrap` | 禁止换行 |
| `text-wrap` | `balance`（默认，各行长度尽量均匀）或 `wrap`（尽量填满每一行） |

### 5.3 换行规则

1. 写了 `width`：按内容宽度换行。
2. 写了 `max-width`：超出才换行。
3. 都没写：默认一行；如果一行超出可用宽度，自动换行，报告里记为 `auto-wrap`。
4. 中文可以在任意两个字之间断行；英文单词和连续数字不会被拆开。
5. 避头尾：`，。、；：？！）」』》】…` 等不会出现在行首，`（「『《【` 等不会出现在行尾。
6. 硬换行只用 `<br>`。源码里的换行和连续空格折成一个空格，每一行的行首行尾空格去掉。行内标签交界处的空格保留，`A <span>B</span> C` 是 `A B C`。`&nbsp;` 不折叠，也不当行首行尾空格去掉。

### 5.4 轮廓 glyph

`.tsx` 里可以从字体取出每个字的轮廓。这是程序接口，不是标签。

```ts
import { glyph } from 'flexlayer'

const chars = await glyph('春眠', { font: 'Kai', size: 120, weight: 700 })
```

`glyph` 按码位拆开，返回数组。每个字有：

| 字段 | 含义 |
| --- | --- |
| `text` | 这一个码位 |
| `d` | SVG 路径。原点在字身盒子的左上角，y 向下，单位是像素 |
| `font` | 实际用的字体名，如 `Kai` |
| `size` | 字号，像素 |
| `weight` | 轮廓实际对应的字重 |
| `width` | 字宽。排版时这一格占多宽，跟路径的外接框无关 |
| `height` | 字身高度，从字体上沿到下沿。同一字体、同一字号的每个字都一样 |
| `baseline` | 基线距盒子顶的距离。同一字体、同一字号的每个字都一样 |
| `ink` | 真实着墨，相对盒子左上角。空格是 `null`。可以稍微探出盒子 |
| `missing` | 字体里没有这个字时为 `true`。`d` 仍是缺字方框，不同的缺字会得到同一条路径 |

`font` 用 [docs/RESOURCES.md](docs/RESOURCES.md) 里的名字，或默认的 `ChillDuanSans`。`楷体` 这类别名也可以。没写 `size` 时是 40。多档字体的 `weight` 取最近的一档。`ChillDuanSans` 是可变字体，轮廓只有默认字重 300，请求其它字重会抛错。没注册的字体名也会抛错。

空格有字宽，`d` 是空字符串，`missing` 是 `false`。字体里没有的字（例如 `😀`、`𠀀`）`missing` 是 `true`，`d` 是同一个缺字方框。

## 6. 图片

`img` 是 HTML 标签，不是图形。`image` 和 `img` 是同一个标签。尺寸、圆角、透明度和效果写在 `style` 里；`src` 和 `alt` 写属性。

```html
<img src="cover.png" alt="封面" style="width:320px; height:180px; object-fit:cover; border-radius:16px" />
```

| 项 | 说明 |
| --- | --- |
| `src` | 必填属性。相对路径相对 `.layer` 所在目录，也支持 `http(s)` 和 data URL |
| `alt` | 属性，不绘制 |
| `width`、`height` | 外框尺寸，含 padding 和 border。都没写时用图片像素尺寸；只写一边时另一边按原比例 |
| `object-fit` | `fill`（默认，拉伸铺满）、`contain`（整张放进盒子）、`cover`（铺满并裁切）、`none`（原始像素，不缩放） |
| `object-position` | 默认 `center`。可写 `top`、`left`、`top-left`、`left top`，或相对图片盒子的 `0%`–`100%`（例如 `50% 0%`） |
| `border-radius`、`opacity`、`padding`、`background`、`border` | 同其它 HTML。圆角会裁切图片 |

图片可以放进 `display:flex`，默认不缩小。在 layer 里默认落在 `(0, 0)`；要指定位置就外包一层 `layer`，把 `x`、`y`、`anchor` 写在那一层上。`canvas.create` 会按 `src` 准备图片。读不到文件时报 `missing-image`，`hint` 说明路径。写了宽高的盒子仍然占位。缺 `src` 报 `invalid-attr`。

## 7. 形状与线条

### 7.1 形状

几何只用 SVG 自己的属性。`rect`、`ellipse` 上的 `x1` `y1` `x2` `y2` 报 `invalid-attr` 并忽略。

| 标签 | 写法 |
| --- | --- |
| `rect` | `x` `y` `width` `height`。`x` `y` 是左上角。`rx` 是圆角；`ry` 没写时跟 `rx` |
| `ellipse` | `cx` `cy` `rx` `ry`，圆心 |
| `circle` | `cx` `cy` `r`，圆心 |

`rect`、`circle`、`ellipse` 上的 `anchor` 忽略并报 `info`。`rect`、`box`、`extrude` 上的 `cx`、`cy` 忽略并报 `warn`。

绘制属性和 SVG 一致：`fill`（默认 `#000000`，写 `none` 不填充）、`stroke`（默认 `none`）、`stroke-width`（默认 1）、`stroke-dasharray`（像素长度，空格或逗号分隔；奇数段会再重复一遍；写错报 `invalid-attr` 并画成实线）。

### 7.2 线条

| 标签 | 属性 |
| --- | --- |
| `line` | `x1`、`y1`、`x2`、`y2` |
| `arrow` | `x1`、`y1`、`x2`、`y2`、`head`（箭头长度，默认 `max(12, stroke-width × 4)`） |
| `polyline`、`polygon` | `points="x,y x,y …"` |
| `path` | `d`（SVG 路径语法） |
| `curve` | `points="x,y x,y …"`，可选 `closed` |

- 线条只能放在 layer 里，坐标是 **layer 的局部坐标**（和 SVG 一样，不用 `x`、`y`）。写了 `x`、`y` 会忽略并报 `warn`。
- 布局盒子是纯几何范围，水平线的高度可以是 0。描边只算进报告的 `ink`。
- `stroke` 默认是全局 `color`，`stroke-width` 默认 4（注意和 SVG 不同：SVG 默认不描边，线条会看不见）。
- `polygon`、`path`、`curve` 的 `fill` 默认 `none`。开口的 `curve` 写了 `fill` 也不填，并给出警告；要色块就加 `closed`。
- `curve` 穿过 `points` 里的每个点，绘制时转成贝塞尔。两个点退化为直线。
- 还支持 `stroke-linecap`、`stroke-linejoin`、`stroke-dasharray`。
- `arrow` 是载入时注册的组件，不是单独的绘制种类。排版前展开成 `<g>`：一根 `<line>`，加一个张角 30° 的 `<polygon>`。`--emit` 仍写 `<arrow>`。同名再注册会换掉这一支。见第 15 章。

### 7.3 分组 `g`

`<g>` 放在 `layer` 里面，把几笔收成一组。它没有宽高，不建立新坐标系，子元素仍用 SVG 坐标。允许嵌套的形状、线条、`path`、`curve` 和 `<g>`。放进文字盒子或 flex 报 `invalid-child`。

平移、旋转、缩放写 SVG 的 `transform`（`translate`、`rotate`、`scale`、`matrix`），只写在 `<g>` 上。`layer` 继续用 `x`、`y`、`rotate`、`scale`，不收成一条 `transform`。`fill`、`stroke` 从 `<g>` 传到子形状，子元素自己写了的优先。`opacity` 乘在这一组上。布局盒子是变换后的并集；父 `layer` 没写宽高时把这个范围算进去。

```html
<g transform="translate(12,8)" fill="#e8b04a">
  <circle cx="0" cy="0" r="20" />
</g>
```

## 8. 填充 paint

`fill`、`stroke`、画布 `background`、HTML 的 `background`，以及第 9 章里的 `overlay`、`grade-mask`，共用这一套写法。色标位置是元素自己的 0 到 1，也可以写百分比，不是布局用的百分比。文字的 `color` 仍是纯色。

```html
<rect x="0" y="0" width="720" height="960" fill="linear-gradient(to bottom, #0c1424, #1a3352 55%, #6e7c72)" />
<circle cx="520" cy="220" r="70" fill="radial-gradient(at 40% 35%, #fff, #f4efe4 40%, #d9d0c0)" />
```

`linear-gradient` 默认从上到下，可以写 `to top`、`to right` 或 `180deg`。`radial-gradient` 默认从中心散开，`at 40% 35%` 把高光挪到左上。

`gradient()` 是同一类填充的另一种写法，能画线性、径向、锥形和矩阵渐变。颜色是一张矩阵：列沿参数 `u`，行沿参数 `v`，行与行用 `/` 分开。像素先映射成 `(u, v)`，再在 OKLab 里做双线性插值（透明按预乘）。超出 0 到 1 的部分钳制在两端。只有一行时忽略 `v`。

```
gradient( [映射 ,] 颜色行 [ / 颜色行 ]* )
颜色行 = 颜色 [位置] [, 颜色 [位置]]*
```

位置是 0 到 1，不是像素。省略时第一个是 0，最后一个是 1，中间均匀排开。坐标是元素盒子里的像素，原点在这个盒子的左上角，y 向下，跟元素放在图层的哪里无关。颜色可以是 `#rgb`、`#rgba`、`#rrggbb`、`#rrggbbaa`、`rgb()`、`rgba()`、`transparent`。

| 映射 | u | v |
| --- | --- | --- |
| 省略，或 `box` | 从左到右 | 从上到下 |
| `linear x1 y1 x2 y2` | 线段起点到终点 | 线段的左手侧，距离按线段长度计；第一行贴在线段上 |
| `radial cx cy r` | 圆心到半径 `r` | 从正上方起顺时针一圈 |
| `radial cx cy r0 r1` | 内半径到外半径 | 同上 |
| `conic cx cy [角度]` | 从正上方起、再加起始角度，顺时针一圈 | 圆心到盒子最远角 |

```html
<rect x="0" y="0" width="400" height="240" fill="gradient(#0f1115, #f7931a)" />
<rect x="0" y="0" width="400" height="240" fill="gradient(#0f1115 / #f7931a)" />
<rect x="0" y="0" width="400" height="240" fill="gradient(#ff0000 #00ff00 / #0000ff #ffffff)" />
<circle cx="400" cy="500" r="120" fill="gradient(radial 120 120 120, #ffffff, #f7931a 0.45, #0f1115)" />
<rect x="340" y="500" width="400" height="400" fill="gradient(conic 200 200, #ff0000, #00ff00, #0000ff, #ff0000)" />
```

锥形的 `u`、径向的 `v` 走到 1 就回到起点。要无缝接上，把第一个颜色或第一行在末尾再写一次。铺满整个盒子用矩阵；多行的 `linear` 只向线段左侧展开。盒子在某个方向上长度为 0 时（比如水平线没有高度），这一维没有变化：沿竖线变色写成两行，不要写成一行。

语法解析失败时报 `invalid-attr`，并退回该属性的默认纯色。线条上的渐变坐标相对线条的几何外框。

## 9. 效果

图形和 `layer` 把效果写在属性上。文字把同一项写在 `style` 里。**作用于整棵子树的效果只写在 `layer` 上**：`overlay`、`grade`、`grade-mask`。写在图形、文字或 `style` 里报 `invalid-attr` 并忽略。

效果只影响绘制，不改变布局盒子。**一律按着墨（墨迹 / alpha）计算，不按布局盒子**：文字跟字形，形状跟实际画出来的填充和描边，`fill="none"` 只留描边，不把中间填上。`layer` / `flex` 的 `shadow` 和 `glow` 跟着这一层实际画出来的子树，不跟空的布局盒子；这一层若是三维场景，就跟着已经画好的那张画面。其余效果里，layer 只算自身边框，flex 只算自身背景和边框。`blur` / `filter` / `blend` 作用在已绘制像素上。

绘制顺序只此一份：`backdrop-blur` / `glass` 取样 → `shadow` → `glow` → 本体（`overflow="hidden"` 在这里裁子元素）→ `inner-shadow` → `inner-glow` → `overlay` → `noise`。若有 `blur`、`filter`、`grade` 或 `<mask>`，先画进离屏，依次做 `grade`、`blur` / `filter`，有 `grade` 时再叠 `noise`，然后按 `<mask>` 的 alpha 裁掉，再贴回。画布底色不进 `<mask>`。写了 `grade` 时颗粒不被染色。同时写了 `blur` 与 `filter` 时，图层模糊以 `blur` 为准，并报 `info`。`glass` 与 `backdrop-blur` 同时出现时以 `glass` 为准，并报 `info`。

每个效果都按同一套字段描述：归属、语法、是否复用 paint、作用范围、在上面这条顺序里的位置、报告与问题码、图格。实现取舍见 [docs/EFFECTS.md](docs/EFFECTS.md)。图在 [docs/GALLERY.md](docs/GALLERY.md)。

不要占用这些名字：`outer-glow`、`drop-shadow`、`backdrop-filter`、`texture`。`filter` 里不要写 `blur()` / `drop-shadow()`。

### 9.1 投影发光

`shadow`、`glow`、`inner-shadow`、`inner-glow` 共用一套长度语法。外发光没有偏移。

| 属性 | 语法 | 默认 | 位置 |
| --- | --- | --- | --- |
| `shadow` | `x y [blur] [spread] [color]` | blur 0、spread 0、颜色 `#00000066` | 本体之前，外扩 |
| `glow` | `blur [spread] [color]` | 颜色取本体，按加光（screen）绘制 | 本体之前，外扩 |
| `inner-shadow` | 同 `shadow` | 同 shadow | 本体之后，不外扩 |
| `inner-glow` | 同 `glow` | 同 glow | 本体之后，不外扩 |

| 项 | 说明 |
| --- | --- |
| 归属 | 图形、线条、`layer` 写属性；文字写 `style` |
| paint | 颜色是一个色值，不是渐变 |
| 作用范围 | 该元素的墨迹 |
| 报告 | 可能占用的范围在 `effect`；超出画布报 `effect-clipped` |
| 图 | [docs/gallery/shadow-glow.png](docs/gallery/shadow-glow.png) |

### 9.2 模糊与透视

| 想要 | 写 |
| --- | --- |
| 糊掉这个元素自己 | `blur` |
| 后面的画面变糊，本体半透明盖在上面 | `backdrop-blur` |
| 边缘折射的玻璃，中心不变形 | `glass`。`clear` 完全不糊，`thick` 才是毛玻璃 |

| 属性 | 语法 | 说明 |
| --- | --- | --- |
| `blur` | 单个非负像素 | 图层模糊：糊本元素（含 layer 子树）已绘制像素；外扩计入 `effect-clipped` |
| `backdrop-blur` | 单个非负像素 | 背景模糊：糊元素背后已画内容，再透过半透明本体看见 |
| `glass` | 见下 | 边缘凸弧面透镜折射 + 色散 + 朝光高光。与 `backdrop-blur` 同时写时以 `glass` 为准 |

`glass` 有两种写法，都有效：

- 空格：`clear` / `regular` / `thick`，后可跟模糊像素与色调，如 `clear #a8c8ff20`、`regular 8 #ffffff22`、`0`。
- 逗号（和 `grade` 同一套：预设在前，后面按名字覆盖）：`clear, blur 8, tint #fff2`。可覆盖的名字还有 `refraction`、`specular`、`bezel`、`dispersion`。

三档预设：`clear` 模糊 0（背景完全清晰，只有折射）、`regular` 模糊 6、`thick` 模糊 36（毛玻璃）。折射只发生在墨迹边缘的弧面带（宽约短边 24%，最多 64px）：背景向内取样、在边缘被放大弯折，中心平坦区原样透出。glass 的投影不会透过玻璃被看到。

| 项 | 说明 |
| --- | --- |
| 归属 | 图形和 `layer` 写属性；文字写 `style` |
| paint | `glass` 的色调是一个色值 |
| 作用范围 | `blur` 作用于已绘制像素；`backdrop-blur` / `glass` 取样背后的画面，再按墨迹贴回 |
| 图 | [docs/gallery/blur-glass.png](docs/gallery/blur-glass.png)、[docs/gallery/glass-scene.png](docs/gallery/glass-scene.png) |

### 9.3 调色

| 想要 | 写 |
| --- | --- |
| 整块提亮、去色、偏色相 | `filter` |
| 胶片风格：暗部高光分色、发灰、暗角 | `layer` 的 `grade`，局部再加 `grade-mask` |
| 在画面上罩一层纯色或渐变 | `layer` 的 `overlay` |

#### filter

| 项 | 说明 |
| --- | --- |
| 归属 | 图形和 `layer` 写属性；文字写 `style` |
| 语法 | `brightness()`、`contrast()`、`saturate()`、`grayscale()`、`sepia()`、`invert()`、`hue-rotate()`，空格分隔。比例写 `0–1` 或百分比；`hue-rotate` 用度（`15` 或 `15deg`） |
| paint | 否 |
| 作用范围 | 已绘制像素 |
| 位置 | 离屏里，在 `grade` 之后，和 `blur` 一起 |
| 图 | [docs/gallery/color.png](docs/gallery/color.png) |

#### grade 与 grade-mask

`grade` 只写在 `layer` 上，作用于整个子树：文字、图片、色块一起调。图片要调色就外包一层 `layer`。根 `layer` 写 `grade` 时连画布底色一起调。

```html
<layer grade="lomo 0.8, fade 0.1" grade-mask="radial-gradient(#fff0 30%, #fff)">
  <img src="street.png" style="width:640px; height:800px; object-fit:cover" />
</layer>
```

`grade` 是逗号分开的几项。第一项可以是预设名，后面可跟整体强度 0–1（和原图混合）。后面的项覆盖预设里的同名参数，没写的参数保持预设值。

| 参数 | 写法 | 默认 | 说明 |
| --- | --- | --- | --- |
| `shadows` | `<颜色> [强度]` | 不染色 | 暗部颜色。只取颜色的色相和浓淡，不改亮度。强度 0–1，默认 1 |
| `midtones` | 同上 | 不染色 | 中间调颜色 |
| `highlights` | 同上 | 不染色 | 高光颜色 |
| `contrast` | `0`–`2` | `1` | 大于 1 更硬，小于 1 更软 |
| `fade` | `0`–`1` | `0` | 抬高黑位，胶片的发灰感 |
| `saturate` | `0`–`2` | `1` | `0` 是黑白 |
| `warmth` | `-1`–`1` | `0` | 正数偏暖，负数偏冷 |
| `vignette` | `<0–1> [颜色]` | `0` | 四角压向该颜色，默认黑色 |

| 预设 | 效果 | 展开后 |
| --- | --- | --- |
| `lomo` | 暗部青、高光暖、四角压暗 | `shadows #1f5a6e 0.8, highlights #ffd59a 0.6, contrast 1.2, saturate 1.15, vignette 0.55` |
| `matte` | 哑光、黑位发灰 | `highlights #fff0d8 0.3, contrast 0.9, fade 0.35, saturate 0.85` |
| `chrome` | 青橙 | `shadows #1a6a7a 0.8, highlights #ffb070 0.7, contrast 1.1, saturate 1.1` |
| `bleach` | 低饱和高对比 | `contrast 1.25, fade 0.05, saturate 0.55` |
| `mono` | 黑白 | `contrast 1.1, saturate 0` |

计算在 OKLab 里进行，顺序是：`contrast` → `fade` → `saturate` → `warmth` → 三段染色 → `vignette` → 按强度和原图混合。染色排在 `saturate` 之后，所以 `mono, shadows #1f5a6e 0.4` 是冷调黑白。暗角的中心和遮罩都按这个 layer 的盒子计算，和渐变的坐标一样。

`grade-mask` 复用第 8 章的 paint：纯色、`linear-gradient`、`radial-gradient` 或 `gradient()`。alpha 是强度：不透明处满强度，透明处保持原图。只写 `grade-mask` 不写 `grade` 时报 `warn`。

不同区域用不同效果：内外两层 `layer` 各写一个 `grade`，各自用遮罩只盖自己那一块。

```html
<layer grade="mono" grade-mask="linear-gradient(to right, #fff0 50%, #fff 50%)">
  <layer grade="lomo" grade-mask="linear-gradient(to right, #fff 50%, #fff0 50%)">
    <img src="street.png" style="width:640px; height:400px" />
  </layer>
</layer>
```

| 项 | 说明 |
| --- | --- |
| 归属 | 只写在 `layer` 的属性上 |
| paint | `grade-mask` 复用 paint |
| 作用范围 | 该 layer 整棵子树的已绘制像素 |
| 位置 | 离屏里、`blur` / `filter` 之前 |
| 报告 | `grade` 回显预设展开后的完整参数 |
| 图 | [docs/gallery/color.png](docs/gallery/color.png) |

#### overlay

| 项 | 说明 |
| --- | --- |
| 归属 | 只写在 `layer` 上 |
| 语法 | `<paint> [opacity] [blend]`。opacity 为 `0–1` 或百分比，与混合模式顺序可互换 |
| paint | 复用第 8 章 |
| 作用范围 | 按该 layer 子树墨迹裁切 |
| 位置 | 内发光之后、噪点之前 |
| 图 | [docs/gallery/color.png](docs/gallery/color.png) |

示例：`overlay="#00000066"`、`overlay="#ff8800 0.4 multiply"`、`overlay="linear-gradient(to bottom, #ffffff00, #00000088) soft-light"`。

`blend` 的取值见 9.4，`overlay` 使用同一集合。

### 9.4 合成与质感

| 属性 | 语法 | 说明 |
| --- | --- | --- |
| `blend` | 见下 | 本元素整段绘制与背后的混合模式 |
| `noise` | `强度` 或 `强度 颜色` | 噪点，强度 0 到 1，叠在本体上。绘制顺序的最后一步 |

`blend` 取值：`source-over`（默认）、`multiply`、`screen`、`overlay`、`soft-light`、`lighten`、`darken`。

| 项 | 说明 |
| --- | --- |
| 归属 | 图形和 `layer` 写属性；文字写 `style` |
| paint | `noise` 的颜色是一个色值 |
| 作用范围 | 已绘制像素 / 该元素墨迹 |
| 图 | [docs/gallery/shadow-glow.png](docs/gallery/shadow-glow.png) 里的 noise、blend 格 |

## 10. 报告与问题码

渲染时同时输出一份 JSON 报告：

```json
{
  "flexlayer": "0.1",
  "width": 1080,
  "height": 1920,
  "elements": [
    {
      "path": "layer/layer[0]/div[0]/h1[0]",
      "id": "title",
      "tag": "h1",
      "box": { "x": 330, "y": 600, "width": 420, "height": 106, "left": 330, "top": 600, "right": 750, "bottom": 706, "centerX": 540, "centerY": 653 },
      "ink": { "...": "旋转、缩放、透视之后的着墨外接矩形。像素对位看 ink，box 仍是没转之前的布局盒" },
      "opacity": 1,
      "fontSize": 88,
      "lines": [{ "text": "比特币减半", "box": { "...": "..." } }]
    }
  ],
  "issues": [
    { "level": "warn", "code": "invalid-child", "path": "layer/div[0]/line[0]", "message": "线条不能放在 flex 容器内", "hint": "包一层 layer，例如 <layer><line …/></layer>" }
  ]
}
```

- `box`：布局盒子（含 padding 和 border），只累加平移。`rotate`、`scale` 和透视都不改变它。旋转之后 `box.x` 仍是没转之前的左上角。
- `ink`：同一元素转完、缩完之后真正落在画布上的着墨外接矩形。落在带 `perspective` 的平面上时，改成投影后的外接矩形。并和祖先里 `overflow="hidden"` 的 layer、以及 `<mask>` 的外接范围求过交集。文字是字形的真实边界，形状是布局盒子变换后的范围。做像素对位看 `ink`，不要看 `box`。`overflow-canvas` 看的也是这个投影后的 `ink`。线条的中心线落在画布边上时，描边半径探出去不算超出；中心线本身越出画布仍然算。
- `effect`：阴影、光晕、图层模糊或玻璃可能占用的范围，字段同 `box`。没有这些外扩效果时不写。已经被 `overflow="hidden"` 或 `<mask>` 裁掉的部分不算在里面。这个范围画出画布时报 `effect-clipped`。
- `quad`：有透视投影时才有。投影后的四个角，画布坐标，顺序为左上、右上、右下、左下。用来看斜着的平面实际落在哪儿。
- `opacity`：从根到该元素逐层相乘后的透明度。

`opacity` 小于 0.01 的元素仍会出现在 `elements` 里，但不参与下面的越界、安全区、重叠和最小字号检查。最小字号按声明的 `font-size` 判断，不乘 `scale`。

检查项：

| code | 级别 | 含义 |
| --- | --- | --- |
| `overflow-canvas` | error | 着墨超出画布 |
| `outside-safe` | warn | 文字超出安全区 |
| `text-overflow` | error | 文字超出了写死的宽度或高度 |
| `flex-overflow` | warn | 子元素超出了写死尺寸的 flex 容器 |
| `text-overlap` | warn | 两段文字的着墨区域重叠 |
| `min-font-size` | warn | 字号小于 `画布宽度 / 1080 × 24` |
| `auto-wrap` | info | 文字超出可用宽度，被自动换行 |
| `non-canonical` | info | 含义明确，但不是规范写法。照常渲染，`hint` 里是规范写法 |
| `unknown-tag` | warn | 不认识的标签 |
| `invalid-attr` | warn | 属性放错了位置，或两种写法混用。和已知属性编辑距离不超过 2 的名字也记在这里，`hint` 给出正确写法。其余不认识的属性名不报，留给 `draw` |
| `invalid-child` | warn | 非法子元素：线条或 `g` 放进 flex 容器，文字盒子里放了 `h1`–`h3`、`p`、`div`、`g` 或图片，`mask` 放错位置或一层写了多个 |
| `empty-mask` | warn | `mask` 里没有可用的形状或图片，不生效 |
| `invalid-draw` | error / warn | `<draw>` 语法错误（error）或内容为空（warn） |
| `missing-image` | warn | `img` 的 `src` 读不到 |
| `missing-model` | warn | `model` 的 `src` 缺失、不是 `.glb`，或文件读不到；没有可放入的宽高时也是这个码 |
| `missing-symbol` | warn | `use` 的 `href` 没有对应的 `symbol` |
| `symbol-cycle` | warn | `symbol` 通过 `use` 引用了自己 |
| `open-curve-fill` | warn | 开口的 `curve` 写了 `fill`，没有填充 |
| `effect-clipped` | warn | 本体在画布内，阴影、光晕或图层模糊超出画布 |
| `flatten-3d` | warn | `rotateX`、`rotateY`、`z` 没有落在带 `perspective` 的 layer 里，仍按二维绘制。`sphere`、`box`、`extrude`、`model` 同样报这个码，并且不绘制 |
| `behind-camera` | warn | 平面或网格的 `z` 大于等于所在 layer 的 `perspective`，不绘制 |
| `emit-draw` | warn | `--emit` 时 `draw` 函数用了外部变量，或读不出函数体。按语法判断：字符串、注释，以及同一条声明里的多个名字，都不算外部变量。这种 `<draw>` 不会写进 `.layer` |
| `nondeterministic` | warn | `.tsx` 里调用了 `Math.random()`、`Date.now()`、`crypto.randomUUID()` 或 `crypto.getRandomValues()`。字符串、注释和类型里的同名文字不算。同一帧可能得到不同的图 |
| `type-error` | error | `.tsx` 等源文件的 TypeScript 诊断。`.layer` 不跑类型检查 |
| `measure-mismatch` | warn | `canvas.create` 量到的宽高和最终排版不一致。消息里带上两个尺寸。常见原因是 `width`、`safe` 或字号和最终画布不一样 |

每条问题都可以带 `hint`，是可以直接照做的改法。从 `.tsx` 来的节点，问题和元素还可以带 `source`，形如 `examples/hello.tsx:18:5`。`.layer` 解析出来的节点没有这个字段。Composition 抽查出来的问题带 `frame`，是这条问题第一次出现的帧号。同一条问题出现在多帧时合并，其余帧号写在消息末尾。

## 11. 命令行

```bash
flexlayer render scene.layer -o scene.png --report scene.json   # 渲染 PNG + 报告
flexlayer render scene.layer --debug                             # 叠加画出盒子（蓝）和着墨范围（红）
flexlayer render scene.layer --scale 0.5                         # 缩小输出，方便 AI 快速查看
flexlayer check scene.layer                                      # 只输出检查结果，不出图。没有问题时打印 ✓ 0 issues
flexlayer render scene.tsx -o scene.png --emit scene.layer       # 执行 JSX，再渲染；--emit 写回 .layer
flexlayer render scene.tsx --frame 12 -o frame.png               # Composition 的第 12 帧
flexlayer render scene.tsx --frames out/                         # Composition 的每一帧
```

`.tsx`、`.jsx`、`.ts`、`.js` 会先执行，并做类型检查，类型错误记为 `type-error`。标准库和 Node 的类型由渲染器自带，不依赖文件旁边的 `node_modules`。`import ... from 'node:fs'` 可以类型检查。不认识的属性名和 `.layer` 一样保留给 `draw`，不算 `type-error`。属性放错位置同样由检查报 `invalid-attr`，不记成类型错误。`import './x.tsx'` 这种带扩展名的引用可以通过。有类型错误时仍然出图，退出码为 1。文件里写 `/** @jsxImportSource flexlayer */`，标签和属性与 `.layer` 相同。默认导出一个 `<layer>` 节点，或返回该节点的函数。命名导出 `composition`（或默认导出）可以是第 13 章的 `Composition`。执行结果是同一棵节点树，后面的布局、问题码和绘制都不变。推荐用 `canvas.create(<layer>…</layer>)` 量好再摆。`create` 是同步的，准备在进程里记住，多帧不会重新开始。见第 15 章。`check` 在没有 `--frame` 时抽查第 0 帧、中间一帧和最后一帧。`--emit` 把树写回 `.layer`；`draw` 函数若用了外部变量，记 `emit-draw`，并且不写出 `<draw>`。帧数超过 300 且没有 `--frame` 或 `--frames` 时不渲染联系表。

默认字体寒蝉端黑体，以及 [docs/RESOURCES.md](docs/RESOURCES.md) 里的其它字体，首次使用时自动下载到 `~/.cache/flexlayer/fonts`。

## 12. 自定义绘制 draw

程序调用（`.tsx` 或 `h()`）时，任意元素可挂 `draw={(ctx, el) => { ... }}`。

在 `.layer` 文件里用子标签 `<draw>…</draw>`，正文是 JavaScript，可用变量只有 `ctx` 与 `el`（与回调参数相同）。`<draw>` 不参与布局，画在父元素默认内容之后；同一个元素只能有一个 `<draw>`。程序侧已挂 `draw` 回调时，忽略标签并警告。

```html
<layer width="200" height="120" x="0" y="0">
  <draw>
    ctx.fillStyle = '#3ecfc4'
    ctx.fillRect(0, 0, el.w, el.h)
    ctx.strokeStyle = el.computed.color
    ctx.strokeRect(4, 4, el.w - 8, el.h - 8)
  </draw>
</layer>
```

绘制顺序：先画该元素默认内容（文字、形状、线条、子节点），再调用 `draw`。`ctx` 原点在元素盒子的左上角，坐标范围 `(0,0)` 到 `(el.w, el.h)`，并且已经包含该元素和所有祖先 `layer` 的 `rotate`、`scale`（绕各自的 `origin`）。线条的盒子是纯几何范围，所以水平线的 `el.h` 是 0。尺寸用 `el.w`、`el.h`，不要从 `el.attr` 推算。`opacity` 由外层统一乘到 `globalAlpha`。自定义属性原样出现在 `el.attr` 里。

`el` 字段：

| 字段 | 说明 |
| --- | --- |
| `tag`、`id` | 标签名与 `id` |
| `text` | 该节点直接文本子节点（不含行内标签内的字） |
| `attr` | 标签原始属性（含 `x`、`y`、`anchor`、`style` 字符串等） |
| `style` | 本标签 `style` 解析后的键值 |
| `computed` | `color`、`fontFamily`、`fontSize`、`fontWeight`、`opacity`（继承根上的 `color` / `font-family` 与文字默认字号） |
| `w`、`h` | 布局外框宽高 |

未知标签若同时带有 `draw` 以及 `width` 与 `height`（属性或 `style`），会当作自定义盒子参与布局，不再报 `unknown-tag`；缺少尺寸时仍警告并跳过。

```ts
import { h, renderLayer } from 'flexlayer'

const root = h('layer', { width: '1080', height: '1920', background: '#0f1115', color: '#ffffff' },
  h('layer', { x: '540', y: '700', anchor: 'center' },
    h('h1', {
      style: 'font-size:96px; color:#f7931a',
      draw: (ctx, el) => {
        ctx.strokeStyle = el.computed.color
        ctx.lineWidth = 8
        ctx.beginPath()
        ctx.moveTo(0, el.h - 6)
        ctx.lineTo(el.w, el.h - 6)
        ctx.stroke()
      },
    }, '比特币减半'),
  ),
)

await renderLayer(root)
```

JSX 可将 `jsxImportSource` 设为 `flexlayer`，使用 `flexlayer/jsx-runtime`。

带 `draw` 且写了尺寸的自定义元素，定位和形状相同。根节点 `<layer>` 的 `draw` / `<draw>` 和其它元素一样，在画布底色和子元素画完之后执行。`el.w`、`el.h` 是画布尺寸，`el.t` 是当前秒数。`opacity`、`rotate`、`scale` 作用到整幅画面。

## 13. 帧序列

动画由程序按时间生成一棵 Flex Layer 节点，再交给渲染器。`t` 的单位是秒。单帧 `renderLayer` 不传 `t` 时，`el.t` 为 `0`。

```ts
import { h, renderComposition, type Composition } from 'flexlayer'

const scene: Composition = {
  id: 'halving',
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 90,
  component: ({ frame, fps, t }) =>
    h('layer', { width: '1080', height: '1920', background: '#0f1115' },
      h('layer', { x: '540', y: String(700 + Math.sin(t) * 40), anchor: 'center' },
        h('h1', {}, '比特币减半'),
      ),
    ),
}

const { frames, contactSheet } = await renderComposition(scene)
```

`renderComposition` 对 `frame = 0 .. durationInFrames - 1` 调用 `component({ frame, fps, t: frame / fps })`，再 `renderLayer(node, { t })`。`fps` 必须大于 0，`durationInFrames` 为不小于 1 的整数。返回每一帧的 PNG 和布局报告（`frames`、`reports`），以及一张白色底的联系表：列数约为帧数的平方根，单元格按比例缩小、不放大，最长边不超过 480px，整张宽度不超过 3840px。

随时间变化的位置、尺寸和文字写在 `component` 里，布局每一帧重新计算。`draw` 里用 `el.t` 读取同一个秒数。

三个纯函数不绘制画面：

| 函数 | 作用 |
| --- | --- |
| `interpolate(value, inputRange, outputRange)` | 线性映射，默认超出区间时钳制 |
| `spring({ frame, fps })` | 阻尼弹簧，从 0 趋近 1。`frame` 为 0 时是 0 |
| `sequence(input, { from, durationInFrames }, render)` | 当前帧落在区间内时，把减去 `from` 的局部 `frame` 和 `t` 交给 `render`；否则返回 `null` |

同一 `frame` 调用两次，得到同一张 PNG。命令行对 `.layer` 渲染这一帧；对导出 `Composition` 的 `.tsx`，用 `--frame` 取一帧，或输出联系表和 `--frames` 目录里的帧序列。`.tsx` 里不要调用 `Math.random()` 或 `Date.now()`，否则报 `nondeterministic`。字符串和注释里写到这两个名字不会报。

## 14. 预留

- 把帧序列编码成视频，以及时间轴预览。
- 墨迹布局：按着墨范围计算间距、居中、包裹。
- `Icon`。
- `Scene3D` 这个名字仍保留，不要挪作他用。`sphere`、`box`、`extrude`、`model` 画在父 `layer` 的 `perspective` 里，见第 3 章。单独的视口、作者灯光和阴影还没有，讨论见 [docs/proposals/3D.md](docs/proposals/3D.md)。
- 滤镜设计说明见 [docs/EFFECTS.md](docs/EFFECTS.md)。勿占用：`outer-glow`、`drop-shadow`、`backdrop-filter`、`texture`。

## 15. 用 tsx 写 layer

每一块都是 `canvas.create(<layer>…</layer>)`。参数必须已经是 `<layer>`，传入 `<h1>` 或 `<rect>` 会抛错。返回值就是这棵 `<layer>`，并带上量完之后的 `left`、`top`、`right`、`bottom`、`width`、`height`，供下一块的 `x`、`y` 使用。这六个数是布局盒，不含 `rotate` 和 `scale`。转完之后的外接矩形在 `rotatedBox`（同样有 `left`、`top`、`right`、`bottom`、`width`、`height`）。下一块要避开转过的内容，用 `rotatedBox.bottom`，不要用 `bottom`。位置写在 `<layer>` 的 `x`、`y`、`anchor` 上。`.layer` 仍是渲染器读的格式，`--emit` 把展开结果写回去。

`create` 是同步的。字体、图片和 Yoga 在这一次调用里备好，并在进程里记住。后面再写一帧，或渲染一段视频，已经备过的直接接着用，不会重新下载、重新解码。`composition` 的 `component` 里可以调用。

```tsx
/** @jsxImportSource flexlayer */
import { canvas } from 'flexlayer'

const page = { width: 720, height: 540 }

const title = canvas.create(
  <layer x={48} y={48} width={page.width - 96} color="#f4ecdf" font-family="Kai">
    <h1 style="font-size:160px; white-space:nowrap">春眠不觉晓</h1>
  </layer>,
)
const ball = canvas.create(
  <layer x={title.left + 40} y={title.bottom + 32} perspective="700" glow="40 #e8b04a88">
    <sphere cx="90" cy="90" r="90" fill="#e8b04a" />
  </layer>,
)

export default canvas.create(
  <layer width={page.width} height={page.height} color="#f4ecdf" font-family="Kai" safe="0">
    <rect x="0" y="0" width={page.width} height={page.height} fill="#0c1424" />
    {title}
    {ball}
  </layer>,
)
```

完整例子见 [examples/poster.tsx](examples/poster.tsx)、[examples/hello.tsx](examples/hello.tsx)。

- 底色用铺满的 `<rect fill>`。`color`、`font-family` 写在 `<layer>` 上。没写 `color` 是 `#111111`，没写 `font-family` 是 `ChillDuanSans`。自定义字体写 `<font family src>`，放在正在 `create` 的那一层里，或先调用 `canvas.font(family, src)`。字体还没注册就 `create`，会抛错，避免用备用字体量出另一套尺寸。`canvas({...})` 已去掉，调用时抛出同样的改法。
- `<font src>` 和 `<img src>` 的相对路径按源文件所在目录解析，不按当前运行目录。
- 根上没写 `safe` 时，渲染按短边的 4%。页面不想要这条边距就写 `safe="0"`。`create` 和最终渲染用同一条可用宽度，避免 `measure-mismatch`。
- 只写 `width` 或只写 `height`，且里面没有会换行的文字：另一边按比例放缩，放大缩小都做。`scale` 写回节点，`origin` 为 `top-left`。返回的宽高是缩放后的。
- 会换行的文字：`width` 是行宽，高度是排出来的，不缩放。
- 宽高都写了：就是盒子。子元素按自己的 `x`、`y` 摆，不整层缩放。页面用这个。
- 都没写：保持量出来的大小。
- 手写的 `.layer` 不走这套比例放缩。写了 `width` 仍是盒子。
- `canvas.component(name, render)` 按标签名注册组件。`render` 收到属性，返回 `<g>`、形状或它们的数组。排版前展开，`.layer` 和 JSX 走同一条路。`--emit` 仍写原来的标签。未注册的标签报 `unknown-tag`。同名再注册会替换。JSX 里大写函数组件在 `jsx()` 里展开，和这个注册表互不替代。内置 `arrow` 用这个注册。自定义标签的类型写在 jsx 运行时上：

```tsx
declare module 'flexlayer/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      badge: { fill?: string }
    }
  }
}
```

最终排版和量到的盒子不一致时，报 `measure-mismatch`（warn），消息里带上两个尺寸。常见原因是 `width`、`safe` 或字号和最终画布不一样。

