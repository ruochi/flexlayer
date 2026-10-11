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
| `background` | `transparent` | 画布底色，只收纯色。没写，或写 `transparent`，不铺底色，PNG 里空出来的像素是透明的。要白底写 `#ffffff`。整页渐变用铺满的 `<rect fill="…">` |
| `color` | `#111111` | 全局文字色、线条默认色。只收纯色。字形渐变写 `fill` |
| `font-family` | `ChillDuanSans` | 全局字体。目录里的名字直接写，第一次用到时自动下载。见 [docs/RESOURCES.md](docs/RESOURCES.md) |
| `safe` | 画布短边的 4% | 安全区边距，`上 右 下 左` 或一个数字，只用于检查 |

`<font family="名字" src="路径或网址" />` 注册额外字体，只能写在根元素下。`src` 必须是字体文件。不想自己找文件时，写目录里的名字：`Song` / `宋体`（Noto Serif SC，思源宋体简体子集）、`Kai` / `楷体`（霞鹜文楷）、`Brush` / `书法`（马善政毛笔楷书），以及 `Inter`、`Playfair`、`NotoSans` 等。有 400 和 700 两档的取最近的一档，只登记了一档的字体始终用那一档。

## 2. 元素一览

| 类别 | 标签 |
| --- | --- |
| 容器 | `layer`（嵌套不填背景）。`div` 里放 `p` 或标题时从上到下排；横排和间距用 `display:flex` |
| 绘制 | `draw`（子标签，正文 JS；程序侧也可用 `draw={fn}`） |
| 文字 | `h1`、`h2`、`h3`、`p`、`div`、`span`；行内：`span`、`strong`、`b`、`em`、`br` |
| 图片 | `img`（`image` 是同一个标签） |
| 图标 | 不是单独的标签。`<span class="material-symbols-outlined">home</span>`，字重写 `font-weight` |
| 形状 | `rect`、`circle`、`ellipse` |
| 分组 | `g`（放在 `layer` 里，用 `transform` 平移、旋转、缩放） |
| 线条 | `line`、`arrow`、`polyline`、`polygon`、`path`、`curve`。`arrow` 是内置组件，排版时展开成 `g` |
| 复用 | `symbol`、`use` |
| 蒙版 | `mask`（只作为 `layer` 的直接子元素） |
| 网格 | `sphere`、`box`、`cylinder`、`torus`、`tube`、`extrude`、`model`。放在带 `perspective` 的 `layer` 里 |
| 字体 | `font`（只作为根元素的子元素，`family` 加 `src`） |

- 标签一律小写。写成 `<Circle>` 仍会渲染，并报 `non-canonical`。HTML 只写 `style`，`layer` 和图形只写属性。图片的 `src`、`alt` 仍是属性。
- 后写的元素画在上面。
- 不认识的标签会被忽略，并在报告里给出警告。

## 3. 通用属性与归属

| 属性 | 说明 |
| --- | --- |
| `id` | 报告里用来指认元素 |
| `x`、`y` | 写在 `layer`、`use`、`rect`、`box`、`extrude`、`tube` 和带尺寸的自定义元素上。是定位点，没写是 `0`。默认对应盒子左上角（见 `anchor`） |
| `anchor` | `(x, y)` 落在盒子的哪个点。九宫格：`top-left`（默认）、`top`、`bottom`、`left`、`right`、`center`、`top-right`、`bottom-left`、`bottom-right` |
| `opacity` | 0 到 1。嵌套时逐层相乘 |
| `rotate` | 绕 `origin` 旋转，单位度，顺时针为正。对文字、线条、形状和 layer 都生效；layer 上的旋转作用到整棵子树 |
| `scale` | 绕 `origin` 缩放，同样作用到整棵子树。一个数时两轴相同。`scale="1.2 0.8"` 分轴，`scale="-1 1"` 是水平镜像。文字写 `style="scale:1.2 0.8"`。分轴时三维的 z 缩放是两轴绝对值乘积的平方根；只写一个数时 z 仍用这个数，负号也保留 |
| `origin` | 旋转和缩放的支点，默认 `center`。九宫格和 `anchor` 相同。也可以写成相对盒子左上角的 `120 80`、`30% 40%`，或混用 `120 40%`、`top 80`。只写一个数或百分比时，另一轴是中心。支点可以落在盒子外面 |

`rotate`、`scale` 只影响绘制，不影响布局。支点是 `origin`，绕这一点缩放或旋转，这一点在画面上不动。百分比按这一层的布局盒子，`<layer scale="1.4" origin="33% 39%">`。`top 80` 和 `80 top` 相同。解析失败报 `invalid-attr`，并退回中心。要从舞台上取一块出图，写 `view`，不要靠 `scale` 把整页推近，见第 4.1 节。报告里的 `box` 是变换前的布局盒子（只累加平移），`ink` 是变换后的外接矩形。有透视时 `ink` 改成投影后的外接矩形，并多一个 `quad`（投影后的四个角）。`rotateX`、`rotateY` 和分轴 `scale` 的三维支点也是这个 `origin`。`screenScale` 是这一层落到屏幕上的倍数，见第 4.1 节。

`perspective` 只写在 `layer` 上，单位是像素，是直接子元素共用的视距。灭点是这一层盒子的中心，`z` 正方向朝观众，数值越大看起来越大。写成 `perspective="parallel"` 时是平行投影：视线平行于 z，屏幕位置不随 `z` 放大或缩小，也没有镜头平面，`z` 再大也不报 `behind-camera`、不因此跳过绘制。深度顺序不变，仍是 `z` 越大越靠近观众。`rotateX`、`rotateY` 仍会把侧面压扁。`rotateX`、`rotateY`、`z` 的归属和 `rotate` 相同，写在要转动或推近的那一层上，不改变布局。没有祖先写 `perspective` 时仍按二维绘制，并报 `flatten-3d`；这时 `z` 不改变绘制顺序。子元素的 `z` 大于等于视距时报 `behind-camera`，该元素不绘制。带三维姿态的平面先按 4 倍分辨率绘制，再平均缩回逻辑像素，斜边因此抗锯齿。平面上的 `shadow` 和 `glow` 画在这张位图的外侧，再一起投影，不会被裁在平面自己的框里。没有三维姿态、也没有网格的内容仍走原来的二维绘制。

`z` 的前后只在带 `perspective` 的那一层生效。这一层没有 `sphere`、`box`、`cylinder`、`torus`、`tube`、`extrude`、`model` 时，直接子元素按中心深度从远到近绘制，深度相同保持文档顺序。出现这些网格时，这一层改成一台三维场景，网格和带姿态的平面放进同一个深度缓冲：更靠近观众（`z` 更大）的面盖住更远的面，不透明的面写入深度。嵌套 `layer` 自己没有 `perspective` 时，里面的网格和平面仍算进外层这台场景。

同一层里如果出现 `sphere`、`box`、`cylinder`、`torus`、`tube`、`extrude` 或 `model`，这一层改成一台三维场景，和带姿态的平面共用这一个 `perspective`。没有这些标签时，像素和上面的平面透视一致。`sphere` 写 `cx` `cy` `r`，布局盒子是边长 `2r` 的正方形，圆心就是这个点。`box` 写 `x` `y` `width` `height` `depth`，布局只看宽高，`x` `y` 是左上角。`rx` 是棱上的圆角半径。不写 `round` 时 12 条棱都圆。`round` 挑选棱：`all`；`x`、`y`、`z` 是平行于宽、高、厚度的四条；`front`、`back`、`left`、`right`、`top`、`bottom` 是这一面的四条；单条写成 `front-top` 或 `top-front`，两个方向不分先后。`top` 是画面上方。三条棱都圆的角是一块球面。只有两条圆时，圆角收到它们的交线，第三条棱仍是直角。只写 `round` 不写正的 `rx`，名字不认识，或没有选中棱，报 `invalid-attr`，圆角不生效。半径大于棱能让开的距离时收小，并报 `invalid-attr`。布局盒子不因 `rx` 改变。`cylinder` 写 `cx` `cy` `r` `height`，轴沿画面竖直方向，`height` 是这段长度，圆截面在朝向镜头的方向上鼓出 `r`。布局盒子宽 `2r`、高 `height`，`cx` `cy` 是盒子中心。没写 `height` 时报 `invalid-attr`，并退回 `2r`。`rx` 圆两端圆口。不写 `round` 时上下都圆；`round="top"` 或 `"bottom"` 只圆一端。半径要小于 `r`，两端都圆时还不能大于 `height` 的一半，否则收小并报 `invalid-attr`。`torus` 写 `cx` `cy` `r` `tube`，环躺在所在平面里。`r` 是环心到管心的半径，`tube` 是管半径，要小于 `r` 才有孔。布局盒子是边长 `2(r+tube)` 的正方形，圆心是 `cx` `cy`。倾斜之后的 `ink` 按环面取样，不用这个正方形的四个角。没写 `tube`，或 `tube` 不小于 `r`，报 `invalid-attr`，并退回 `r/4`。`tube` 的 `d` 是中心线，语法和 `path` 相同，`r` 是管半径。开口的子路径两端是平的圆盖；写了 `Z` 的闭合成环。分开的子路径是分开的管子。布局盒子是中心线包围盒四边各扩 `r`，`x` `y` 是这个盒子的左上角。没写 `r` 时报 `invalid-attr`，并退回 8。`extrude` 的 `d` 和 `path` 相同，沿 z 挤出 `depth`，厚度以所在平面为中心。`d` 里分开的子路径是分开的实体；包在外圈里面的才是洞。`model` 只写 `src`，指向一个 `.glb`；位置和宽高写在外包的 `layer` 上，模型按 contain 居中放进这个盒子，文件里的相机忽略。单位都是像素。没写 `depth` 时报 `invalid-attr`，并退回宽高里较小的一边。面用 `fill`，默认 `#000000`。`fill="none"` 不填色，深度仍写入，后面的棱不会穿出来。正对镜头的面就是这个颜色，侧面更暗；`model` 的面色来自文件，不看 `fill`，再乘这套明暗。`material` 写在网格上。不写时是 `matte`，磨砂塑料，只有明暗、没有高光。写成 `material="matte"` 是同一个。`plastic` 和 `metal` 都用这套磨砂明暗做底色，再叠同一张工作室环境：比中间灰亮的地方加亮，暗的地方压暗。金属叠得更实，塑料更透。没有会缩成一点的高光。主灯是一块大圆角窗，方位和仰角躲开 90° 的整数倍，板子也从竖直偏开一点。暗面另有一条窄的圆角边缘光，顶边更低，接不到主灯，也不收到天顶。白、黑和灰过渡都有。粗糙度先把这张环境模糊，噪点也写进这张环境，再贴到反射上。越高越糊，噪点越密。`glass` 等不透明的物体画完再叠上，`fill` 的透明度是中心的颜色，掠过边缘映出同一张环境，并且不投主光的影子。粗糙度写在名字后面，0 到 1，例如 `material="metal 0.35"`；不写时塑料 0.4、金属 0.25、玻璃 0.08。磨砂不看粗糙度。层上的 `glass` 仍是平面透镜。`material` 写在别的标签上，或名字不认识，报 `invalid-attr`，并退回磨砂。渐变 `fill` 只用第一个颜色，并报 `invalid-attr`。`stroke` 写在这个网格上时描可见的折棱和轮廓；不写就不描。两只都写了 `stroke` 的网格相互穿过时，描出交界线，算折棱，颜色和宽度跟后写的那只；面贴面的共面接触不描。`stroke-width` 是屏幕像素。写一个数时轮廓、折棱和隐藏线一样粗；`stroke-width="3 2 1"` 依次是轮廓、折棱、隐藏线；写两个数时隐藏线用折棱的宽度。写了 `stroke` 没写宽度时三档都是 2。超过三个数、负数或解析失败报 `invalid-attr`，并退回 2。`halo="3"` 写在网格上：这只网格的可见线从更远的线前面经过时，远处那条线在交叉处两侧各断开 3 个屏幕像素。不写就不断开。没写 `stroke`，或写在别的标签上，报 `invalid-attr`。共用一个角的棱不会被彼此断开。线管端面和自己的轮廓只在端点相接，不是交叉，不会被切开。同一只网格上，前面的棱仍然会在真正交叉的地方把后面的棱断开。`hidden` 是被这只网格自己的面挡住的棱的颜色，按屏幕像素画成 6 实、4 空的虚线，短段接成一条再取相位；被别的网格或平面挡住的部分不画。不写 `hidden` 就不画隐藏线。只写 `hidden` 或 `stroke-width`、没写 `stroke`，报 `invalid-attr`。`hidden` 写在别的标签上同样报 `invalid-attr`。球没有折棱，`stroke` 只画轮廓圆。圆柱描上下圆边和轮廓，圆环描轮廓，线管描轮廓以及两端圆盖的折棱。写了 `rx` 的棱和口缘与相邻面相切，不再是折棱。这些线在 4 倍缩小之后再描。父 `layer` 不负责把整层改成线框。`shadow` 和 `glow` 写在网格上也会报 `invalid-attr`，不绘制。网格可以画出它所在 layer 的盒子，和平面一样；投影后的 `ink` 超出画布时报 `overflow-canvas`。`overflow="hidden"` 仍裁在这一层里。网格没有落在 `perspective` 里时报 `flatten-3d`，并且不绘制。`src` 缺失、不是 `.glb` 或读不到时报 `missing-model`。这一层按 4 倍分辨率绘制，再按预乘 alpha 平均缩回，和透视平面同一套抗锯齿。网格用自带的三角形光栅绘制。同一台透视场景里，不透明的网格和平面会沿内置主光互相投下硬边影子；被挡住时主光不计，只留环境光和补光。这里的同一台场景不限于同一个父标签：没有自己 `perspective` 的嵌套 `layer` 里的 `sphere`、`box`、`cylinder`、`torus`、`tube`、`extrude`、`model` 和平面，仍算进外层这台场景，影子会投到父层的地板上，也会挡住父层的物体。嵌套 `layer` 自己写了 `perspective` 时是另一台场景，不共用这张影子。属性 `shadow` 仍是平面上的偏移暗边。`Scene3D` 仍不使用。

属性归属（由 [src/schema.ts](src/schema.ts) 生成，不要手改两行标记之间的表）：

<!-- attrs:ownership:begin -->
| 属性 | 写在哪 |
| --- | --- |
| `width`、`height`、`x`、`y`、`anchor`、`anchor-box` | `width`、`height` 以及 `x`、`y`、`anchor`。`x`、`y` 是左上角，默认 0；`anchor` 默认 `top-left`。HTML 上写了报 `warn` |
| `opacity`、`rotate`、`rotateX`、`rotateY`、`z`、`scale`、`origin` | 图形、线条和 `layer` 写属性；文字写在 `style`。HTML 上写成属性报 `warn` |
| `background`、`padding`、`font-size`、`color`、`flex`、`flex-grow`、`flex-shrink`、`gap`、`border`、`border-radius`、`max-width`、`align-items`、`align-content`、`justify-content`、`flex-wrap`、`row-gap`、`column-gap`、`writing-mode`、`object-fit`、`object-position` | HTML 的 `style`。`layer` 或图形写了 `style` 报 `warn` |
| `cx`、`cy`、`x1`、`y1`、`x2`、`y2`、`points`、`d`、`depth`、`tube`、`round`、`fill`、`stroke`、`hidden`、`halo`、`material`、`transform` | 图形属性，坐标是所在 `layer` 的局部坐标 |
| `src`、`alt` | 只写在 `img` 或 `model` 上。图片宽高仍放进 `style` |
| `shadow`、`glow`、`inner-shadow`、`inner-glow`、`blur`、`backdrop-blur`、`glass`、`noise`、`filter`、`blend` | 图形和 `layer` 写属性；文字写在 `style`。见第 9 章 |
| `perspective`、`overlay`、`grade`、`grade-mask`、`view` | 只写在 `layer` 上。写在别处或写进 `style` 报 `warn` |
| `data` | 任何元素都可以写。值是 JSON；程序里直接传对象或数组。`draw` 读 `el.data`，不在 `el.attr` |
| `expect` | 任何元素都可以写。声明预期中的问题码，出现在该节点或子树里时降为 info。没出现报 `unused-expect` |
<!-- attrs:ownership:end -->

叶子的定位：

| 叶子 | 怎么定位 |
| --- | --- |
| 文字，以及没写宽高的一组 HTML | 外包一层 `layer`，把 `x`、`y`、`anchor` 写在 `layer` 上。HTML 上写 `x`、`y` 会忽略并报 `warn` |
| 图片 `img` | 和文字一样，外包一层 `layer` 来定位 |
| `rect` | `x` `y` `width` `height`，左上角。`rx`、`ry` 是圆角。不用 `anchor`，写了报 `info` |
| `box`、`extrude`、`tube`、带尺寸的自定义元素 | `x` `y` 加上 `anchor`，默认左上角 |
| `circle`、`ellipse`、`sphere`、`cylinder`、`torus` | 圆心 `cx` `cy`。椭圆再写 `rx` `ry`。圆柱再写 `r` `height`，圆环再写 `r` `tube` |
| `g` | 放在 `layer` 里。`transform` 作用到子元素，盒子是变换后的并集 |
| 线条 | 端点、`points`、`d` 本身就是坐标，不写 `x`、`y` |

没写 `x`、`y` 时是 `0, 0`，不再放到父级中心。`layer`、`use`、`rect`、`box`、`extrude`、`tube` 上的 `cx`、`cy` 已忽略，报 `invalid-attr`，`hint` 给出等价的 `x`、`y`。

`anchor` 示例：`<layer x="60" y="120"><h1>标题</h1></layer>` 表示这一层的左上角在 (60, 120)。要让中心落在这一点，写 `anchor="center"`。写错的值按 `top-left` 摆，并报 `invalid-attr`。

`anchor-box` 默认 `box`，按布局盒子对齐。`anchor-box="ink"` 改为按子树着墨的外接矩形对齐，`x`、`y` 落在这块着墨的九宫格点上。着墨取旋转和缩放之前的范围；同时写了 `rotate` 时报 `ink-anchor-rotate`。没有着墨（空文字或全透明）时退回布局盒子，并报 `ink-anchor-empty`。`overflow="hidden"` 先裁再对齐。没写 `anchor-box`、锚点贴着左边或右边、并且字形比盒子靠里至少 2px、也不小于字号的 4% 时，报 `ink-inset`。只写在 `layer` 和 `use` 上。

## 4. 容器

### 4.1 layer：自由摆放，也可以当分组

原点是 layer 的左上角。嵌套 `layer`、`use`、`box`、`extrude`、`tube` 和带尺寸的自定义元素用 `x`、`y` 定位；圆、椭圆、球、圆柱和圆环用圆心。HTML 不写 `x`、`y`，要单独摆放就再包一层 layer。layer 可以嵌套。外层的 `opacity`、`rotate`、`scale` 会作用到里面的全部子元素，所以一组要一起移动、旋转或缩放时，包一层 layer 即可。嵌套 layer 写了 `width` 时，里面的文字按这个宽度换行；宽高都写了再减去这一层的 `safe`。这一层上的 `color`、`font-family` 会传给里面没写这些的文字，和根 layer 一样。

- 写了 `width`、`height`：layer 就是这么大，原点固定。内容可以画出盒子。做动画的分组建议写上宽高，这样坐标不会跟着内容变。
- 没写：宽高等于从原点到子元素右下角的距离。坐标在负方向的子元素会画到盒子外面，但不会把其他子元素一起平移。

`overflow="hidden"` 按 layer 的盒子裁剪子元素。默认 `visible`。被裁掉的是子元素；这一层自己的阴影、模糊仍可以画到盒子外面。祖先的 `overflow="hidden"` 会把子元素的阴影和光晕一起裁掉。已经被这样裁掉、画布上看不见的部分不报 `effect-clipped`。

`view="x y w h"` 把这一层变成镜头。`width` `height` 是屏幕上的取景窗，`x` `y` 是窗口在父层里的位置。`view` 是舞台坐标里被取的矩形，铺满取景窗：窗口上的一点是舞台上对应点乘 `取景窗 / view` 的宽高。窗口外的内容裁掉，和 `overflow="hidden"` 一样，不报 `overflow-canvas`。`view` 没被直接子元素转完、缩完的四边形盖住时报 `view-outside`（error），成片会露底。四边形是这一层直接子元素的布局盒子，绕它自己的 `origin` 做了 `rotate` 和 `scale`。直接子元素是 `<g>` 时，用 `transform` 之后里面每个形状的四边形，不用这一组的外接矩形。镜头四个角都落在这些四边形里才算盖住；多个子元素时，每个角落在其中一块里即可，角都盖住但中间有缝时可能不报。宽高比和取景窗差超过 1% 时不拉伸，按宽度保持中心重算高度，并 `warn`。要写 `width` 和 `height`。不要和 `perspective` 写在同一层。屏幕上不跟着镜头放大的章节、字幕、标注，写在这一层外面，用成片像素。`zoomView(center, zoom, size)` 用来算推到某一点的 `view`。`bleed` 已不再使用，写了会 `warn`。

检查和绘制都按屏幕上的实际大小。`scale` 和 `view` 叠出来的倍数写在报告的 `screenScale`（两轴绝对值的几何平均，等于 1 不写）。最小字号拿 `font-size × screenScale` 和 `min(画布宽, 画布高) / 1080 × 24` 比。1080p 横屏和竖屏都是 24px。阴影、光晕、模糊的外扩同样乘这个倍数。`--debug` 的布局框和着墨框保持 1 屏幕像素，不跟着放大。网格光栅按这个倍数提高分辨率，推近后笔画仍然清楚。

`<mask>` 裁的是这一层合成完的画面，包括子元素的阴影、模糊、调色和颗粒。这一层自己的 `shadow`、`glow` 和外侧或居中的 `stroke` 按蒙版留下的轮廓来画，可以伸出蒙版，用来做贴纸边和发光轮廓。写在父层上的描边和阴影也跟着这块轮廓，不跟着没抠过的矩形。内侧描边仍留在蒙版里面。它写在 `layer` 里面，和要裁的内容并列。自己不画出来，不占布局，不把层撑大，里面的形状不进报告的元素表，也不触发 `overflow-canvas`。蒙版画成位图之后量出来的面积、外接矩形、碎片数、软边宽度，以及每一步运算，写在这一层的 `mask` 字段上，见第 10 章和第 15 章。被它挡住的内容同样不报 `overflow-canvas` 或 `effect-clipped`：报告里的 `ink` 先和 mask 形状的外接范围求交。一层最多一个，多出来的 `warn` 并忽略。坐标和同层的图形一样，原点在 layer 左上角。

里面直接写 `rect`、`circle`、`ellipse`、`polygon`、`path`，也可以放 `img` 或 `<g>`。`line`、`arrow`、`polyline`、`curve`、文字、`div`、嵌套 `layer` 会 `warn` 并忽略。空的 `mask` 报 `empty-mask`，并且不生效。

没写 `fill` 时按 `#fff` 画满。实心形状是硬边；`fill` 的 alpha 和渐变里的透明处是软边。颜色不算，只看 alpha。没画到的像素藏起来。每一项先画进自己的缓冲，再按 `op` 合成。默认 `add`，后写的盖住先写的，和以前只叠形状一样；半透明不会把底下挖空。`subtract` 从已有选区里挖掉，`intersect` 只留重叠，`xor` 留下只出现在一边的部分。要挖洞也可以用带洞的 `path`。`<g>` 先把里面的步骤合成一组，再按这一组自己的 `op` 贴上。形状自己的 `rotate`、`scale` 仍然有效。`op` 写在 mask 外面报 `invalid-attr`。

`img` 默认用自己的 alpha。`channel="luma"` 改读亮度，用来认黑白蒙版。`pick="3 5"` 只留下灰度值正好是这些编号的像素，0 是背景；写了 `pick` 又没写 `channel` 时按亮度读，并且不做平滑，避免边上冒出别的编号。这两个属性只写在 mask 里的 `img` 上。`derive="subject"`、`derive="mask"` 或 `derive="regions"` 不直接画 `src`，改读旁边的缓存：`photo.jpg` 对应 `photo.subject.png` 和 `photo.cutout.json`。缓存没有时报 `missing-mask`（error），`hint` 是要跑的命令。原图哈希和配方对不上时报 `stale-mask`（warn），文件还在就先画出来。网址和 data URL 不能 `derive`。

`<mask feather="8" invert="true">` 在全部步骤之后做。`feather` 是羽化半径，单位像素。`invert` 反选。写在别的标签上会 `warn`。

`mask-image`、`mask-mode`、`mask-composite` 这类 CSS 写法报 `invalid-attr`，不生效。蒙版写成 `<mask>`，加减用 `op`，读黑白图用 `channel="luma"`。

写了画布底色就先铺好，不进 `mask`。没写 `background` 时不铺色，空出来的像素在 PNG 里是透明的。根 `layer` 的 `grade` 仍作用整幅画布，包括已经铺上的底色；完全透明的像素不参与调色。`grade-mask` 只控制调色强度。`mask` 放进 flex、写在图形或 HTML 上、写成属性或写进 `style`，都会 `warn` 并忽略。

`<preview of="#person" show="overlay checker black white edges" />` 和 `symbol` 一样，正常成片里不画，也不进元素表。它只能作为 `layer` 的直接子元素。`of` 指向带 `id` 的 `layer`，`#` 可以不写。`show` 不写就是这五项都要。`flexlayer render scene.layer --preview out.png` 另写一张拼图：叠色图把没选中的地方盖上半透明红，并画上坐标格；成片分别放在棋盘格、黑底和白底上；`edges` 把软边最宽的几处放大。`check` 和多帧不要带 `--preview`。

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

`border`、`border-radius`、`overflow` 写在 `layer` 的属性上，不写 `style`。**`layer` 不填背景**：它只合成子元素画出来的内容。色块用 `rect` 的 `fill`、HTML 的 `style="background: …"`，或子标签 `<draw>` 自己画。`layer` / `use` 上写 `background` 会警告并忽略。画布底色只写在根节点 `<layer background>`。根上没写时不铺底色，输出的 PNG 背景是透明的。

一组 HTML 要放到画面上，包一层 `layer`，把 `x`、`y`、`anchor` 写在 `layer` 上。写了宽高的 `layer` 也可以放进 `div`，和文字、图片排在一起，见 4.2。图形用这一层的局部坐标。这一层作为 flex 或块级子项时，位置由排布决定。

`symbol` 定义一块可复用的图，本身不画出来。`use` 按 layer 的方式摆放它：`x`、`y`、`anchor`、`rotate`、`scale`、`opacity` 都写在 `use` 上。`symbol` 里的坐标是它自己的局部坐标。

`<math>` 排 MathML 子集，可以放在 `layer` 里，也可以和文字一起放进 `display:flex`。不能放进文字盒子。字号默认 40px，可用 `style="font-size:…"`。公式不换行。单独成行的公式写 `display="block"`：分数不缩小，求和、积分换成大号字形。

支持 `math`、`mrow`、`mi`、`mn`、`mo`、`mtext`、`mspace`、`mfrac`、`msub`、`msup`、`msubsup`、`msqrt`、`mroot`、`munder`、`mover`、`munderover`、`mtable`、`mtr`、`mtd`、`mstyle`、`mphantom`、`semantics`。`annotation` 不画。单独写这些标签、不包在 `math` 里，报 `unknown-tag`。

公式按 TeX 和 MathML Core 的规矩排，间距取自数学字体 STIX Two Math 的 MATH 表：

- 字体：字母、数字和运算符只用带 OpenType MATH 表的字体。目前只有 `STIXTwoMath`，在 `<math>`、`mi`、`mn`、`mo` 上写别的 `font-family` 不生效，报 `invalid-attr`。`mtext` 用外面文字的字体，也可以自己写 `font-family`。
- 字母：单个字母的 `mi` 是斜体（拉丁字母和小写希腊字母），多个字母的 `mi`（`sin`、`lim`）直立。`mathvariant` 可写 `normal`、`italic`、`bold`、`bold-italic`、`double-struck`、`script`、`fraktur`、`sans-serif`、`monospace`。`mo` 里的 `-` 画成减号 `−`。
- 基线：一行里的记号按基线对齐。分数线、大运算符和伸长的括号以数学轴为中心。
- 间距：按 TeX 的原子类别（普通、运算符、二元、关系、开、闭、标点）补空隙：`=` 两侧 5/18em，`+` 两侧 4/18em，`,` 后 3/18em，`sin x` 中间 3/18em。行首或跟在运算符后面的 `-`、`+` 是正负号，不加空。上下标里只留细空。`mo` 写 `lspace`、`rspace` 时用写的值。积分后的 `<mi>d</mi><mi>x</mi>` 前面补一个细空。
- 分数：行内公式分子分母 0.85 倍字号，`display="block"` 的最外层分数不缩小。`linethickness="0"` 去掉分数线（二项式）。
- 上下标：0.7 倍字号，第二层 0.55 倍。同一行里的上标高度一致；上下标同时出现时叠在同一列，中间留缝。斜体字母的上标往右让出斜体修正，积分的下标往左收。`′` 写成上标时按原字号、不再抬高。
- 上下限：`display="block"` 时求和、连乘、`lim`、`max` 等的限在基座正上方、正下方（`msub`、`msup` 也一样）。行内公式里这些限放到右侧，`munder`、`mover`、`munderover` 也一样；`mo` 写 `movablelimits="false"` 时始终在上下方。积分的限在右侧。
- 重音：`mover` 的 `^`、`~`、`→`、`˙` 等默认是重音，贴着基座；底下是多个字母时加宽。`¯`、`‾`、`_` 画成和基座一样宽的线。`⏞`、`⏟` 和箭头横向伸长。
- 括号：`( ) [ ] { } | ‖ ⟨ ⟩ ⌈ ⌉ ⌊ ⌋` 按配对伸长到中间内容的高度，没配对的跟整行一样高。`stretchy="false"` 不伸长。
- 根号：`msqrt` 的根号随内容变高，`mroot` 的指数是 0.55 倍字号，放在根号左上的勾里。
- 矩阵：同一列对齐，列间距 0.8em，每行至少 1.2em 高、行间再留 0.2em，整张表以数学轴居中。`columnalign`（`left`、`center`、`right`）写在 `mtable`、`mtr` 或 `mtd` 上，`rowspacing`、`columnspacing` 写在 `mtable` 上。

`<math>` 的盒子至少有一行文字高（基线上方 0.95em，下方 0.25em）。放进横排 flex 且交叉轴居中（`align-items` 默认 `center`）时，盒子上下补齐，基线落在盒子中心下方 0.35em，和居中放着的同字号文字基线对齐。公式很高时，补齐会在一侧留出空白。横排写了 `align-items:baseline` 时不再补白，公式自己的基线和旁边文字的第一行基线对齐。例子见 [examples/math.layer](examples/math.layer)。

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

没写 `display:flex` 的 `div`，只要里面有行内标签放不下的子元素（`h1`–`h3`、`p`、`div`、图片、`math`、`layer`、形状等），就按块级从上到下排，等同于补上 `display:flex; flex-direction:column`。没写 `align-items` 时，文字块拉到这一列的内容宽度：写了 `width` 就用这个宽，没写就跟最宽的一块。文字的高度按这个宽度换行后再往下排，下一块从换行后的底边开始。已经写了 `align-items` 就沿用。这些子元素会画出来，不报 `invalid-child`。夹在旁边的文字单独成段。只放文字和行内标签时，`div` 仍是文字盒子。

`div` 和 `display:flex` 上写的 `font-size`、`font-weight`、`font-family`、`color`、`letter-spacing`、`line-height`、`text-align` 会传给里面没写这些的 `p`、`div`、`span`。`h1`–`h3` 仍用自己的默认字号和字重，颜色和字体照样继承。子元素自己写了的优先。

图形要放进 flex，包一层写了宽高的 `layer`，或者改用 `div` 盒子（`width`、`height`、`background`、`border-radius`）。这一层就是 flex 的一格：宽高用属性，里面的圆、矩形用这一层的局部坐标。位置由 flex 决定，这一层上的 `x`、`y`、`anchor` 会报 `invalid-attr`。`.tsx` 里同样写，见 [examples/html-layer.tsx](examples/html-layer.tsx)。形状直接放进来会照尺寸渲染并报 `info`；线条直接放进来不渲染，报 `warn`。两点坐标写在 flex 里的形状上不渲染，报 `warn`。`p`、`h1`–`h3`、`span` 里放 `layer` 不参与排版，报 `invalid-child`。

```html
<div style="display:flex; gap:24px; align-items:center">
  <layer width="120" height="120">
    <circle cx="60" cy="60" r="50" fill="#e8b04a" />
  </layer>
  <p style="font-size:40px">标题</p>
</div>
```

`style` 里不认识的属性，或认识但写错的值，报 `invalid-attr`。布局仍用该项的默认值。支持的属性：

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| `width`、`height` | 包住内容 | 外框尺寸（含 padding 和 border） |
| `gap` | `0` | 子元素间距。`row-gap`、`column-gap` 可以分开写，没写的那边沿用 `gap` |
| `flex-wrap` | `nowrap` | `nowrap`、`wrap`、`wrap-reverse`。主轴放不下时换行 |
| `padding` | `0` | 1 到 4 个值，同 CSS |
| `align-items` | `center` | `start`、`center`、`end`、`stretch`、`baseline`。默认 `center`，CSS 里是 `stretch`。管一行里的交叉轴。`baseline` 在横排把第一行文字基线对齐；图片、`layer`、形状对齐到下边缘。竖排没有这条基线，按 `flex-start` |
| `align-content` | `flex-start` | `start`、`center`、`end`、`stretch`、`space-between`、`space-around`、`space-evenly`。多行在交叉轴上怎么排。默认贴起点，不是 `align-items` 的 `center` |
| `justify-content` | `start` | `start`、`center`、`end`、`space-between`、`space-around`、`space-evenly` |
| `background`、`border`、`border-radius` | 无 | 同 CSS，border 只支持实线 |

子元素可以写的 flex 属性：`flex-grow`、`flex-shrink`、`align-self`、`width`、`height`。

- 文字默认 `flex-shrink:1`，空间不够时会换行变窄，但不会窄过最长的一个不可断开的词。
- 形状和图片默认 `flex-shrink:0`，不会被压扁。
- `align-items` 默认 `center`，CSS 里是 `stretch`。竖排 column 没写时，较窄的子项在交叉轴居中；和容器同宽的子项看起来仍贴着起点。左对齐写 `align-items:flex-start` 或 `start`。交叉轴位置由这一层自己的 `align-items` 决定，在子项上写 `justify-content` 改不了。横排要按文字基线对齐写 `align-items:baseline`，`align-self` 同样可以写 `baseline`。同一行被基线撑高后，`center` 和 `end` 的子项按新的行盒再排，`start` 仍贴着行的起点。竖排写了 `baseline` 按 `flex-start`。
- `align-content` 默认 `flex-start`。它排的是换行以后的多行，不是一行里面的子项。容器写死了高度、行又没占满时，行贴着起点；要居中写 `align-content:center`。
- `flex-wrap:wrap` 之后，`flex-overflow` 看的是换行后的子元素有没有超出写死的宽高。换行能放下就不报；容器高度不够、下一行仍探出去，才报。

**可用宽度**：放在 layer 里、没写 `width` 的 flex 容器，最宽只能到 layer 的宽度（根 layer 要减去左右安全区）。

## 5. 文字

最外层的文字标签是一个**文字盒子**，里面只能放文字和行内标签（`span`、`strong`、`b`、`em`、`i`、`u`、`br`），也可以直接放 `<img>`。图片和文字排在同一段里，宽度不够时跟着一起换行。图标是带 `class="material-symbols-outlined"` 的文字，见第 6 章。
`div` 里有块级子元素时不是文字盒子，见 4.2。
`p`、`h1`–`h3`、`span` 里不要嵌套 `div`、`p`，也不要放 `layer`。多段上下排写成 `<div><p>…</p></div>`。图形和文字并排时，把写了宽高的 `layer` 放进 `<div style="display:flex">`。
`em` 和 `i` 是斜体，`strong` 和 `b` 是粗体，`u` 加下划线。没写字号时，它们和 `span` 一样继承外层。

### 5.1 默认样式

| 标签 | 字号 | 字重 |
| --- | --- | --- |
| `h1` | 88px | bold |
| `h2` | 64px | bold |
| `h3` | 48px | bold |
| `p`、`div`、`span`、`em`、`strong` | 40px | `em` / `i` 斜体，`strong` / `b` 粗体；没写时字号继承外层，不写外层就是 40px |

### 5.2 style 属性

| 属性 | 说明 |
| --- | --- |
| `font-size`、`font-weight`、`font-family`、`color`、`letter-spacing` | 同 CSS，行内标签也可以写。`color` 只收纯色，会继承。渐变写在 `color` 上报 `invalid-attr`，退回继承来的纯色。`letter-spacing` 可以写 `0`、`2px` 或 `0.05em`。`em` 按写这条声明的元素自己的字号换算，再按像素继承；子元素改了字号不会把父级的 `em` 重算 |
| `fill` | 字形的颜料，写在 `style` 里。没写时用 `color`。可以是纯色，或第 8 章的 `linear-gradient()`、`radial-gradient()`、`gradient()`。写在文字盒子上时，整段按这一层的盒子取样；写在行内标签上时，只铺这一段的行盒，这一段里的汉字和英文单词共用这一段。不继承：没写的子元素继续用 `color`。形状的 `fill` 仍是属性，见第 7 章 |
| （字重规则） | `ChillDuanSans` 按可变字重绘制，字重轴约 300 到 800，中间的字重不会收成 400 和 700 两档。登记了多档文件的字体取最近的一档。只登记了一档的字体，例如 `Brush`、`Bebas`，请求别的字重仍用这一档。自带 `<font>` 且文件没有字重轴的，按 400 |
| `writing-mode` | `horizontal-tb`（默认）或 `vertical-rl`。竖排时字从上到下，列从右到左，`letter-spacing` 是字与字之间的额外间距 |
| `line-height` | 倍数（`1.4`）或像素（`24px`）。`normal` 按 1.2。单行默认 1.2，多行默认 1.4。`%`、`em` 等报 `invalid-attr`。像素行高按像素继承，不跟子元素的字号再乘一次 |
| `text-align` | `left`（默认）、`center`、`right` |
| `width`、`height` | 外框尺寸（含 padding 和 border） |
| `max-width` | 最大外框宽度，超出就换行，盒子贴合最长的一行 |
| `padding`、`background`、`background-color`、`border`、`border-radius` | `background-color` 只收纯色。`background` 收纯色，以及 CSS 的 `linear-gradient()`、`radial-gradient()`，不收 `gradient()`。文字盒子的 `background` 铺满外框。行内 `span`、`strong`、`b`、`em`、`i`、`u` 的 `background` 或 `background-color` 铺在这一段的行盒上，用来高亮一个词。行内背景不从文字盒子继承；嵌在里面的行内标签没写时，沿用包着它的那一层 |
| `white-space: nowrap` | 禁止换行 |
| `text-wrap` | `balance`（默认，各行长度尽量均匀）或 `wrap`（尽量填满每一行） |

### 5.3 换行规则

1. 写了 `width`：按内容宽度换行。
2. 写了 `max-width`：超出才换行。
3. 都没写：默认一行；如果一行超出可用宽度，自动换行，报告里记为 `auto-wrap`。
4. 断行机会按 Unicode 换行规则取。中文可以在任意两个字之间断行；英文单词和连续数字不会被拆开。
5. 避头尾：`，。、；：？！）」』》】…` 等不会出现在行首，`（「『《【` 等不会出现在行尾。库允许、但这条禁止的断点仍然禁止。
6. 硬换行只用 `<br>`。源码里的换行和连续空格折成一个空格，每一行的行首行尾空格去掉。行内标签交界处的空格保留，`A <span>B</span> C` 是 `A B C`。`&nbsp;` 不折叠，也不当行首行尾空格去掉。

带 `id` 的行内标签（`span`、`strong`、`b`、`em`）会在报告的元素表里多一条，`inline` 为 true。`path` 像 `layer/p[0]/span[0]`，序号按元素子节点计，和布局路径一样，`<br>` 也占一个序号。`lines` 是每一行里属于它的那一段。`box` 和 `ink` 都是这些段合起来、再乘上父文字元素的变换（含祖先的 `rotate`、`scale` 和透视）之后的外接矩形；行内标签没有单独的布局盒。最内层写了 `id` 的那段拥有这些字，里面没写 `id` 的行内标签沿用外层。没写 `id` 的行内标签不进元素表。这些 `inline` 元素不参与 `outside-safe`、`min-font-size` 和 `text-overlap`，避免和父段落各报一次。

### 5.4 轮廓 glyph

`.tsx` 里可以从字体取出每个字的轮廓。它是同步的程序接口，不是标签。目录里的字体第一次用时会下载，下完直接返回数组，所以可以写在 `canvas.create` 前面。

```ts
import { glyph } from 'flexlayer'

const chars = glyph('春眠', { font: 'Kai', size: 120, weight: 700 })
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

### 分析 analyzeImage

`.tsx` 里可以先读一张图，量出它留下了多少、碎成几块，并描出轮廓。和 `glyph` 一样是程序接口，不是标签，也不进渲染：先拿到数和路径，再决定怎么摆、怎么裁。常用来检查抠图结果或黑白蒙版。

```ts
import { analyzeImage } from 'flexlayer'

const cut = await analyzeImage('photo.subject.png')
```

| 字段 | 含义 |
| --- | --- |
| `src` | 传进来的路径 |
| `width`、`height` | 图片像素尺寸 |
| `channel` | 实际分析的通道，`alpha` 或 `luma` |
| `hasAlpha` | 图里有没有不透明度低于 255 的像素 |
| `area` | 留下的比例，0 到 1。半透明按值折算 |
| `ink` | 值大于 0 的外接矩形，字段是 `x`、`y`、`width`、`height`。整张为 0 时是 `null` |
| `pieces` | 实心部分的八连通块个数 |
| `parts` | 最大的几块，按面积从大到小，最多 64 块。每块有 `area` 和 `ink` |
| `holes` | 实心部分里的洞的个数 |
| `softEdge` | 软边平均宽度，像素。等于半透明像素数除以实心区域的边界长度，硬边接近 0 到 1 |
| `d` | 实心部分的轮廓，SVG 路径。外圈和洞的绕向相反 |

坐标都是图片像素，原点在左上角，y 向下。值不低于 `threshold` 的像素算实心，碎片、洞和轮廓都按它切。轮廓用移动方块描出，交点按值插值，再按 `tolerance` 化简；对角相连的两个实心像素算同一块，和 `pieces` 一致。

| 选项 | 说明 |
| --- | --- |
| `channel` | `auto`（默认）：图里有透明像素时看 alpha，否则看亮度。抠图结果用 `alpha`，没有透明通道的黑白蒙版用 `luma`。亮度乘过 alpha |
| `threshold` | 1 到 255，默认 128 |
| `tolerance` | 化简允许偏离的像素，默认 0.5。写 0 不化简 |
| `baseDir` | 相对路径从这里找。默认是调用方源文件所在目录，和 `<img src>` 一样 |

`d` 写进 `<mask><path d /></mask>` 就是同一块蒙版，`mask` 里的 `path` 不描边。单独画出来时写 `<path d fill="#fff" stroke="none">`，因为 `path` 默认带 4 像素描边。图片画在页面上时如果缩放过，把 `d` 放进写了 `scale` 的 `layer`，或者按显示尺寸换算 `ink`。

同一张图、同一组选项在一个进程里只算一次，返回的是副本，改了不影响下一次。读不到图片、或选项写错时抛错。

### 抠图 flexlayer-select

渲染器不跑模型。`analyzeImage` 只量一张已经抠好的图，不生成遮罩。生成遮罩在单独的包 `flexlayer-select` 里：用 BiRefNet 的 ONNX 版（`onnx-community/BiRefNet_512x512-ONNX`，MIT）写出和原图一样大的缓存，再用上面的 `analyzeImage` 自检。这个包不在 npm 上。在仓库里进入 `packages/select`，执行 `npm ci && npm run build`。模型第一次使用时下载到 `~/.cache/flexlayer/models`，用的是 fp16，大约 470MB；fp32 大约 940MB，这里不用。`@huggingface/transformers` 是这个包的可选依赖，根包不加。

```bash
npx flexlayer-select cutout photo.jpg --preset portrait
```

`photo.jpg` 旁边得到 `photo.subject.png`（前景去色，alpha 是选区）、`photo.mask.png`、`photo.regions.png`（灰度值就是编号，0 是背景）、`photo.questions.json`、`photo.cutout.json`（原图哈希、模型、预设和自检）和 `photo.cutout.layer`。预设：`portrait` 留下头发软边并丢掉脚下的暗影子，`product` 把影子写成 `photo.shadow.png`，`flat` 按 128 硬切。编号题记着 `id`、`area`、`where`、`now`、`ask`。作答后：

```bash
npx flexlayer-select apply photo.jpg --add 2 --subtract 1
```

这会在 `<mask>` 里加上 `derive="regions"` 的 `img`，`pick` 是编号，`op` 是 `add` 或 `subtract`。标记里的 `<preview>` 不进成片，用 `--preview` 才出拼图。缓存给第 4 章的 `derive` 读。没装这个包时，`flexlayer select` 只提示在 `packages/select` 里安装，不指向 npm。

### 图标

图标不是单独的标签，写法和网页一样。`class="material-symbols-outlined"` 把这一段换成 Material Symbols Outlined，里面写图标名。字号和颜色跟周围的文字走，用 `style` 里的 `font-size` 和 `color`，不会单独变成 24px。字重写 `font-weight`，按 100、200、300、400、500、600、700 取最近的一档；两边一样近时用较轻的那一档。没写就跟周围的字重，默认 400。`.tsx` 里也可以写 `className`。这个 class 写在 `i` 上时仍是正体。

```html
<div style="display:flex; align-items:center; gap:12px; font-size:40px">
  <span class="material-symbols-outlined" style="font-weight:400">home</span>
  <span>首页</span>
</div>
```

字体第一次用到时下载。不要把 `fonts.googleapis.com` 的地址写进 `<font>`。排版按码位拆开，字体里的连字留不住，所以图标名会换成一个码位再量、再画。`font-family` 写成 `Symbols`、`图标` 或 `material-symbols-outlined` 时同样换。

这个 class 写在文字盒子上、又没写 `line-height` 和 `white-space` 时，行高是 1，并且不换行。写在行内标签上时，只改这一段的字体，字距收成 0，除非 `style` 里写了 `letter-spacing`。

`material-symbols-rounded` 和 `material-symbols-sharp` 仍用这一套空心字体，并报 `invalid-attr`。对不上的名字报 `missing-icon`，这些字留在原处。普通字体里的英文单词不报。这是空心的一套，没有单独的实心轴。

放进 `p` 时跟文字排在同一段。单独放进 `display:flex` 或 `layer` 时，边长跟字号走。

## 7. 形状与线条

### 7.1 形状

几何只用 SVG 自己的属性。`rect`、`ellipse` 上的 `x1` `y1` `x2` `y2` 报 `invalid-attr` 并忽略。

| 标签 | 写法 |
| --- | --- |
| `rect` | `x` `y` `width` `height`。`x` `y` 是左上角。`rx` 是圆角；`ry` 没写时跟 `rx` |
| `ellipse` | `cx` `cy` `rx` `ry`，圆心 |
| `circle` | `cx` `cy` `r`，圆心 |

`rect`、`circle`、`ellipse` 上的 `anchor` 忽略并报 `info`。`rect`、`box`、`extrude`、`tube` 上的 `cx`、`cy` 忽略并报 `warn`。

绘制属性和 SVG 一致：`fill`（默认 `#000000`，写 `none` 不填充）、`stroke`（默认 `none`）、`stroke-width`（默认 1）、`stroke-dasharray`（像素长度，空格或逗号分隔；奇数段会再重复一遍；写错报 `invalid-attr` 并画成实线）。`stroke` 写成 `6 #000` 这种「宽度 + 颜料」时改为沿墨迹描边，见第 8 章。

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

平移、旋转、缩放写 SVG 的 `transform`（`translate`、`rotate`、`scale`、`matrix`），只写在 `<g>` 上。`layer` 继续用 `x`、`y`、`rotate`、`scale`，不收成一条 `transform`。`fill` 和纯色 `stroke` 从 `<g>` 传到子形状，子元素自己写了的优先。写成宽度加颜料的 `stroke` 留在这一组，按合并后的墨迹描一圈。`opacity` 乘在这一组上。布局盒子是变换后的并集；父 `layer` 没写宽高时把这个范围算进去。

```html
<g transform="translate(12,8)" fill="#e8b04a">
  <circle cx="0" cy="0" r="20" />
</g>
```

## 8. 填充 paint

颜料值只定义一次：纯色、`linear-gradient()`、`radial-gradient()`、`gradient()`。色标位置是元素自己的 0 到 1，也可以写百分比，不是布局用的百分比。渲染倍率不是 1 时（例如导出 `@2x`），渐变文字仍落在同一套用户坐标上。

谁能写哪种值：

| 槽 | 收什么 | 画在哪 |
| --- | --- | --- |
| `fill` | 全部 | 字形或形状内部。文字写 `style="fill:…"`，形状写属性 |
| `stroke` | 全部 | 形状和线条的居中描边；或任何元素沿墨迹的距离描边 |
| `overlay`、`grade-mask` | 全部 | 整层，只写在 `layer` 上 |
| `background` | 纯色、`linear-gradient()`、`radial-gradient()` | 盒子或行盒。不收 `gradient()` |
| `background-color`、`color`、画布 `background` | 纯色 | 底板、字形的默认色、画布清屏色 |

文字盒子上的 `fill` 按这一层的盒子取样，行内标签自己的 `fill` 按这一段的行盒取样，这一段里的汉字和英文单词共用这一段。没写 `fill` 时字形用 `color`。

`stroke` 用同一套颜料。形状和线条写颜色时居中描边，宽度是 `stroke-width`（形状默认 1，线条默认 4）。写成 `6 #000`、`6 #000 outside`、`6 #fff inside`、`8 #fff center`，或 `6 #ffffff, 14 #c8321e` 时，按到墨迹的距离描边，默认 `outside`，后一层的宽度是总距离。文字、图片、`layer` 和 flex 写颜色时沿墨迹外侧描：`style="stroke:#000"` 或 `stroke="#000"`，没写宽度时用 4，写了 `stroke-width` 用那个宽度。`layer` 和 flex 按整棵子树合并后的墨迹描一圈。网格的 `stroke` 仍是折线颜色。`inside` / `center` 的内侧宽度达到字号的约 8% 时报 `stroke-fill`。

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

绘制顺序只此一份：`backdrop-blur` / `glass` 取样 → `shadow` → `glow` → `stroke` 的外侧（`outside` 与 `center` 的外半）→ 本体（`overflow="hidden"` 在这里裁子元素）→ `stroke` 的内侧（`inside` 与 `center` 的内半）→ `inner-shadow` → `inner-glow` → `overlay` → `noise`。若有 `blur`、`filter`、`grade`、其它已注册滤镜或 `<mask>`，先画进离屏，依次做像素滤镜（含 `grade`，`order` 小的在前）、`blur` / 画布滤镜（含 `filter`），有像素滤镜时再叠 `noise`，然后按 `<mask>` 的 alpha 裁掉。蒙版层自己的外阴影、外发光和外侧描边不进这次裁切，裁完之后按留下的轮廓再画；子元素的阴影仍在离屏里，会被蒙版裁掉。最后贴回。画布底色不进 `<mask>`。写了像素滤镜时颗粒不被染色。同时写了 `blur` 与 `filter` 时，图层模糊以 `blur` 为准，并报 `info`。`glass` 与 `backdrop-blur` 同时出现时以 `glass` 为准，并报 `info`。

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

沿墨迹的 `stroke` 见第 8 章。`shadow` / `glow` 的轮廓带上它的外侧。文字和图片的 `spread` 按墨迹 alpha 膨胀或收缩。`outline` 和 `-webkit-text-stroke` 报 `non-canonical`，改写 `stroke`。

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

#### 注册滤镜

`grade` 和 `filter` 走同一套滤镜接口，新滤镜也登记在这里。名字就是属性名。像素滤镜（`kind: "pixel"`）在离屏里、`blur` 之前按 `order` 从小到大执行，相同则按注册顺序。画布滤镜（`kind: "canvas"`）返回一段 canvas filter CSS，和 `blur` 合成一条，`blur` 在前。

```ts
import { registerFilter, renderLayer } from 'flexlayer'

registerFilter({
  name: 'wash',
  kind: 'pixel',
  parse(value) {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0 || n > 1) return { error: '强度要在 0 到 1 之间' }
    return { spec: n }
  },
  apply(pixels, amount) {
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] === 0) continue
      pixels.data[i] = pixels.data[i]! + (255 - pixels.data[i]!) * amount
    }
  },
})
```

```html
<layer width="200" height="200" wash="0.4">
  <rect x="0" y="0" width="200" height="200" fill="#808080" />
</layer>
```

| 项 | 说明 |
| --- | --- |
| `name` | 小写属性名。不能占用已有属性。同名再登记会换掉原来的实现，`grade` 和 `filter` 也一样 |
| `kind` | `pixel` 原地改 RGBA；`canvas` 返回一段 canvas filter CSS |
| `layerOnly` | 缺省时 `pixel` 只写在 `layer` 上，`canvas` 可以写在图形属性或文字 `style` 里，和 `filter` 一样 |
| `maskAttr` | 可选。配套属性，paint 的 alpha 是强度，坐标按这一层的盒子。`apply` 按满强度写，引擎再用遮罩和原图混合 |
| `includeBackdrop` | 写在根 `layer` 上时连画布底色一起处理。`grade` 为 true |
| `order` | 同 kind 里越小越先，缺省 0 |
| `pad` | 可选。离屏要额外留出的逻辑像素 |
| 报告 | `filters` 按绘制顺序列出。`grade` 和 `filter` 仍单独回显 |
| 卸下 | `unregisterFilter` 只卸后加的滤镜。`grade` 和 `filter` 不能卸 |

写在图形或文字 `style` 上的像素滤镜报 `invalid-attr` 并忽略。遮罩单独出现、或遮罩 paint 无法解析，同样报 `invalid-attr`。

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
- `mask`：写了 `<mask>` 的 `layer` 才有。先用和绘制相同的形状、图片、运算、羽化和反选把蒙版画成位图，只看这一层的布局盒里面，再量这几个数：`area` 是留下的比例（0 到 1，半透明按 alpha 折算）；`ink` 是 alpha 大于 0 的部分在画布上的外接矩形，全部藏起来时是 `null`，在透视平面上不写；`pieces` 是 alpha 不低于一半的连通块个数（八连通）；`softEdge` 是软边的平均宽度，等于半透明像素数除以实心区域的边界长度，硬边接近 0 到 1，羽化越宽越大。`ops` 是每一步：`op`、`changed`（这一步改变的面积占布局盒的比例）、`path`，写了 `source` 时也带上。没有子步骤时不写 `ops`。`changed` 为 0 时报 `mask-op-noop`。`area` 和 `softEdge` 按这一层自己的像素算，不乘 `scale`。布局盒超过四百万像素时缩小来画，结果换算回原来的像素。
- `quad`：有透视投影时才有。投影后的四个角，画布坐标，顺序为左上、右上、右下、左下。用来看斜着的平面实际落在哪儿。
- `opacity`：从根到该元素逐层相乘后的透明度。
- `inline`：带 `id` 的行内标签才有，为 true。`box` 和 `ink` 都是这段文字变换后的外接矩形，见第 5 章。不参与安全区、最小字号和文字重叠检查。

`opacity` 小于 0.01 的元素仍会出现在 `elements` 里，但不参与下面的越界、安全区、重叠和最小字号检查。最小字号按屏幕上的字号判断，也就是声明的 `font-size` 乘 `screenScale`。

检查项：

| code | 级别 | 含义 |
| --- | --- | --- |
| `overflow-canvas` | error | 着墨超出画布。镜头用 `view` 裁在取景窗里的部分不算。`bleed` 不再关掉这条 |
| `outside-safe` | warn | 文字超出安全区 |
| `text-overflow` | error | 文字超出了写死的宽度或高度 |
| `flex-overflow` | warn | 子元素超出了写死尺寸的 flex 容器 |
| `text-overlap` | warn | 两段文字的着墨区域重叠 |
| `min-font-size` | warn | 屏幕上的字号小于 `min(画布宽, 画布高) / 1080 × 24`。屏幕字号是 `font-size × screenScale`。1080p 横屏和竖屏都是 24px |
| `auto-wrap` | info | 文字超出可用宽度，被自动换行 |
| `non-canonical` | info | 含义明确，但不是规范写法。照常渲染，`hint` 里是规范写法 |
| `unknown-tag` | warn | 不认识的标签 |
| `invalid-attr` | warn | 属性放错了位置，或两种写法混用。和已知属性编辑距离不超过 2 的名字也记在这里，`hint` 给出正确写法；候选按标签收窄，过短或没有共同开头的不推荐。其余不认识的属性名不报，留给 `draw`。`style` 里不支持或写错的声明也记在这里。`anchor` 写错、路径 `d` 无法解析同样是这个码；路径失败时跳过这一笔，不中断整张图 |
| `invalid-child` | warn | 非法子元素：线条或 `g` 放进 flex 容器，文字盒子（`h1`–`h3`、`p`、`span`，以及只含文字的 `div`）里放了 `h1`–`h3`、`p`、`div`、`layer`、`g` 或 `math`，`mask` 放错位置或一层写了多个。含这些子元素的 `div` 按块级竖排，不报这条。文字盒子里的 `<img>` 跟文字排在同一段里，不报这条 |
| `empty-mask` | warn | `mask` 里没有可用的形状或图片，不生效 |
| `mask-op-noop` | warn | 蒙版的某一步没有改变选区。`changed` 为 0 |
| `missing-mask` | error | `derive` 的缓存不存在，或 `src` 不是本地图片，或缓存文件读不了 |
| `stale-mask` | warn | 缓存还在，但原图哈希和 `*.cutout.json` 里的 `srcHash` 对不上。先按现有文件画 |
| `invalid-draw` | error / warn | `<draw>` 语法错误或运行出错（error），或内容为空（warn）。运行出错带上源码位置，其余内容照常绘制 |
| `missing-image` | warn | `img` 的 `src` 读不到 |
| `missing-icon` | warn | `class="material-symbols-outlined"`（或 `font-family` 指到 `Symbols`）里的名字不是 Material Symbols 的图标名 |
| `missing-model` | warn | `model` 的 `src` 缺失、不是 `.glb`，或文件读不到；没有可放入的宽高时也是这个码 |
| `missing-symbol` | warn | `use` 的 `href` 没有对应的 `symbol` |
| `symbol-cycle` | warn | `symbol` 通过 `use` 引用了自己 |
| `open-curve-fill` | warn | 开口的 `curve` 写了 `fill`，没有填充 |
| `effect-clipped` | warn | 本体在画布内，阴影、光晕、描边或图层模糊超出画布。外扩按屏幕像素，乘 `screenScale` |
| `view-outside` | error | `view` 没有被这一层直接子元素转完、缩完的四边形盖住，成片会露底。`<g>` 按 transform 后的形状算，不用外接矩形 |
| `stroke-fill` | warn | `inside` / `center` 的内侧宽度达到字号的约 8%，容易填死字内空白 |
| `ink-inset` | info | 锚点贴着左边或右边，字形比布局盒子靠里至少 2px，且不小于字号的 4%。想让笔画贴齐就写 `anchor-box="ink"` |
| `ink-anchor-empty` | info | `anchor-box="ink"` 的子树没有着墨，已按布局盒子定位 |
| `ink-anchor-rotate` | info | `anchor-box="ink"` 和 `rotate` 同时存在，对齐点是旋转前的着墨 |
| `flatten-3d` | warn | `rotateX`、`rotateY`、`z` 没有落在带 `perspective` 的 layer 里，仍按二维绘制。`sphere`、`box`、`cylinder`、`torus`、`tube`、`extrude`、`model` 同样报这个码，并且不绘制 |
| `behind-camera` | warn | 平面或网格的 `z` 大于等于所在 layer 的数值 `perspective`，不绘制。`perspective="parallel"` 没有镜头平面，不报这个码 |
| `emit-draw` | warn | `--emit` 时 `draw` 函数用了外部变量，或读不出函数体。按语法判断：字符串、注释，以及同一条声明里的多个名字，都不算外部变量。这种 `<draw>` 不会写进 `.layer` |
| `emit-data` | warn | `--emit` 时 `data` 含函数、`Map`、循环引用或其它不能写成 JSON 的值，没有写回这个属性 |
| `unused-expect` | warn | 节点写了 `expect`，但该节点和子树里没有这个问题码。多帧检查时，只要有一帧用上就不报。字段 `expect.code` 是没对上的问题码 |
| `nondeterministic` | warn | `.tsx` 里调用了 `Math.random()`、`Date.now()`、`crypto.randomUUID()` 或 `crypto.getRandomValues()`。字符串、注释和类型里的同名文字不算。同一帧可能得到不同的图 |
| `type-error` | error | `.tsx` 等源文件的 TypeScript 诊断。`.layer` 不跑类型检查 |
| `measure-mismatch` | warn | `canvas.create` 量到的宽高和最终排版不一致。消息里带上两个尺寸。常见原因是 `width`、`safe` 或字号和最终画布不一样 |

每条问题都可以带 `hint`，是可以直接照做的改法。从 `.tsx` 来的节点，问题和元素还可以带 `source`，形如 `examples/hello.tsx:18:5`。`.layer` 解析出来的节点没有这个字段。Composition 抽查出来的问题带 `frame`，是这一段第一次出现的帧号，并带 `frames`：含两端的区间，例如 `[[120, 180]]`。抽查序列里连续出现的合成一段；`--step` 大于 1 时，相邻的抽查帧也算连续，所以 120、125、130 合成 `[120, 130]`。中间有一帧抽到了、但这条问题没出现，就另起一段。区间里没被抽到的帧不表示检查过。帧号不写进 `message`。

任何元素可以写 `expect="overflow-canvas: 出血图; text-overlap"`。分号分开，冒号后面是原因，可以不写。问题的 `path` 等于这个节点或在它子树里、并且 `code` 对得上时，级别降成 `info`，并带上 `expected`（原因原文）。没对上的报 `unused-expect`（warn），`expect.code` 是那个问题码。不认识的问题码报 `invalid-attr`。多帧合并时，只要有一帧用上了这句 `expect`，就不报 `unused-expect`。

## 11. 命令行

```bash
flexlayer render scene.layer -o scene.png --report scene.json   # 渲染 PNG + 报告
flexlayer render scene.layer --debug                             # 叠加画出盒子（蓝）和着墨范围（红）
flexlayer render scene.layer --scale 0.5                         # 缩小输出，方便 AI 快速查看
flexlayer check scene.layer                                      # 只输出检查结果，不出图。没有问题时打印 ✓ 0 issues
flexlayer render scene.tsx -o scene.png --emit scene.layer       # 执行 JSX，再渲染；--emit 写回 .layer
flexlayer render scene.tsx --frame 12 -o frame.png               # Composition 的第 12 帧
flexlayer render scene.tsx --frames out/ --from 0 --to 90        # 边渲染边写 PNG。--to 含端点
flexlayer render scene.tsx --rgba -                              # 原始像素写到标准输出
flexlayer check scene.tsx --frames 120-300 --step 5              # 检查这一段，每 5 帧一抽
flexlayer check scene.tsx --frames all                           # 检查每一帧
flexlayer render scene.layer --preview out.png                  # 按 <preview> 另写一张选区拼图
flexlayer select cutout photo.jpg --preset portrait             # 转给 flexlayer-select。没安装时提示在 packages/select 里构建
```

`.tsx`、`.jsx`、`.ts`、`.js` 会先执行，并做类型检查，类型错误记为 `type-error`。标准库和 Node 的类型由渲染器自带，不依赖文件旁边的 `node_modules`。`import ... from 'node:fs'` 可以类型检查。不认识的属性名和 `.layer` 一样保留给 `draw`，不算 `type-error`。属性放错位置同样由检查报 `invalid-attr`，不记成类型错误。`import './x.tsx'` 这种带扩展名的引用可以通过。有类型错误时仍然出图，退出码为 1。文件里写 `/** @jsxImportSource flexlayer */`，标签和属性与 `.layer` 相同。默认导出一个 `<layer>` 节点，或返回该节点的函数。命名导出 `composition`（或默认导出）可以是第 13 章的 `Composition`。执行结果是同一棵节点树，后面的布局、问题码和绘制都不变。推荐用 `canvas.create(<layer>…</layer>)` 量好再摆。`create` 是同步的，准备在进程里记住，多帧不会重新开始。见第 15 章。`check` 在没有 `--frame` 和 `--frames` 时抽查第 0 帧、中间一帧和最后一帧。`--frames all` 检查每一帧，`--frames 120-300` 检查这一段（含两端），`--frames 12` 只检查这一帧，`--step N` 是步长。`--emit` 把树写回 `.layer`；`draw` 函数若用了外部变量，记 `emit-draw`，并且不写出 `<draw>`。帧数超过 300 且没有 `--frame`、`--frames` 或 `--rgba` 时不渲染联系表。`--frames <目录>` 边渲染边写 `frame-0000.png` 这种文件，文件名是帧号。`--from`、`--to` 含端点。`--rgba -` 按帧把不预乘的原始像素连续写到标准输出，日志改走标准错误，并在标准错误打出一行 `ffmpeg -f rawvideo -pix_fmt rgba -s WxH -r fps -i -`。`--rgba` 后面写成文件路径时，像素写入该文件。flexlayer 不调用 ffmpeg。多帧渲染打印的问题是全部帧合并后的结果。

`--preview` 只用于单帧。文档里没有 `<preview>` 时报错，不改已经写出的成片。`flexlayer select` 把后面的参数转给 `flexlayer-select`，见第 6 章。

默认字体寒蝉端黑体，以及 [docs/RESOURCES.md](docs/RESOURCES.md) 里的其它字体，首次使用时自动下载到 `~/.cache/flexlayer/fonts`。

## 12. 自定义绘制 draw

程序调用（`.tsx` 或 `h()`）时，任意元素可挂 `draw={(ctx, el) => { ... }}`。

在 `.layer` 文件里用子标签 `<draw>…</draw>`，正文是 JavaScript，可用变量只有 `ctx` 与 `el`（与回调参数相同）。`<draw>` 不参与布局，画在父元素默认内容之后；同一个元素只能有一个 `<draw>`。程序侧已挂 `draw` 回调时，忽略标签并警告。运行时抛错记为 `invalid-draw`，带上 `<draw>` 的位置，不让整张图退出。

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

绘制顺序：先画该元素默认内容（文字、形状、线条、子节点），再调用 `draw`。`ctx` 原点在元素盒子的左上角，坐标范围 `(0,0)` 到 `(el.w, el.h)`，并且已经包含该元素和所有祖先 `layer` 的 `rotate`、`scale`（绕各自的 `origin`）。线条的盒子是纯几何范围，所以水平线的 `el.h` 是 0。尺寸用 `el.w`、`el.h`，不要从 `el.attr` 推算。`opacity` 由外层统一乘到 `globalAlpha`。自定义属性原样出现在 `el.attr` 里。结构化数据写 `data`，不进 `attr`：程序里 `data={{ values: [3, 5, 8] }}`，`.layer` 里 `data='{"values":[3,5,8]}'`。`JSON.parse` 失败报 `invalid-attr`（error）。别的属性传了对象或数组也报 `invalid-attr`，不会变成 `"[object Object]"`。`--emit` 把 `data` 写成 JSON、放在单引号属性里；函数、`Map` 和循环引用报 `emit-data`，并且不写出这个属性。

`el` 字段：

| 字段 | 说明 |
| --- | --- |
| `tag`、`id` | 标签名与 `id` |
| `text` | 该节点直接文本子节点（不含行内标签内的字） |
| `attr` | 标签原始属性（含 `x`、`y`、`anchor`、`style` 字符串等） |
| `style` | 本标签 `style` 解析后的键值 |
| `computed` | `color`、`fontFamily`、`fontSize`、`fontWeight`、`opacity`（继承根上的 `color` / `font-family` 与文字默认字号） |
| `w`、`h` | 布局外框宽高 |
| `t` | 当前秒数。单帧缺省为 0 |
| `frame`、`fps` | 当前帧号和每秒帧数。单帧缺省为 0 |
| `data` | `data` 属性解析后的值。没有这个属性时是 `undefined`。不在 `attr` 里 |

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

`renderComposition` 对 `frame = 0 .. durationInFrames - 1` 调用 `component({ frame, fps, t: frame / fps })`，再渲染。`fps` 必须大于 0，`durationInFrames` 为不小于 1 的整数。返回每一帧的 PNG 和布局报告（`frames`、`reports`），以及一张白色底的联系表：列数约为帧数的平方根，单元格按比例缩小、不放大，最长边不超过 480px，整张宽度不超过 3840px。它在 `renderFrames` 上实现，返回值和以前一样。

`renderFrames(comp, { from, to, step, format })` 是异步迭代器，逐帧产出，不把整段留在内存里。`to` 含端点，缺省从 0 到最后一帧，`step` 缺省为 1。`format` 缺省 `'png'`；`'rgba'` 时 `rgba` 是不预乘的原始像素，长度为 `width × height × 4`，`width` 和 `height` 是这一帧画布的像素尺寸。每一项还有 `frame`、`t` 和 `report`。

```ts
for await (const { frame, png, report } of renderFrames(scene, { from: 0, to: 30 })) {
  // png 是这一帧
}
```

`createContactSheet({ count, width, height })` 可以逐帧 `add` PNG 或画布，最后 `toPng()`。尺寸规则和 `renderComposition` 的联系表相同。`contactSheetFromPngs` 仍一次吃进全部 PNG。

随时间变化的位置、尺寸和文字写在 `component` 里，布局每一帧重新计算。`draw` 里用 `el.t` 读取秒数，用 `el.frame` 和 `el.fps` 读取帧号和帧率。单帧渲染不传这两个数时，它们是 `0`。

这几个纯函数不绘制画面：

| 函数 | 作用 |
| --- | --- |
| `random(seed)` | 同一个 seed（数字或字符串）永远得到同一个 `[0, 1)` 里的数 |
| `noise(seed, x, y?, z?)` | 平滑噪声，结果在 `[-1, 1]`。同一个 seed 和坐标永远得到同一个数 |
| `interpolate(value, inputRange, outputRange, options?)` | 把 value 从输入区间映射到输出区间。可以写多点，例如 `[0, 30, 60]` 到 `[0, 1, 0]`。输入必须单调递增，两边长度一样，否则抛错。两点重合时仍取端点。`options.easing` 用 `Easing`，只作用在当前这一段、进度在 0 到 1 里的时候。默认超出区间时钳制 |
| `Easing.linear` / `quad` / `cubic` | 进度曲线。`quad` 是 `t²`，`cubic` 是 `t³` |
| `Easing.in` / `out` / `inOut` | 包一层已有曲线。`in` 就是这条曲线本身，`out` 是反过来，`inOut` 前半段进入、后半段离开 |
| `Easing.bezier(x1, y1, x2, y2)` | 三次贝塞尔。两个 x 必须在 0 到 1 |
| `spring({ frame, fps })` | 阻尼弹簧，从 0 趋近 1。`frame` 为 0 时是 0 |
| `sequence(input, { from, durationInFrames }, render)` | 当前帧落在区间内时，把减去 `from` 的局部 `frame` 和 `t` 交给 `render`；否则返回 `null` |

只写两个点时，`interpolate(value, [0, 10], [0, 100])` 和以前一样。同一 `frame` 调用两次，得到同一张 PNG。命令行对 `.layer` 渲染这一帧；对导出 `Composition` 的 `.tsx`，用 `--frame` 取一帧，用 `--frames` 目录边写边出 PNG，或用 `--rgba` 把原始像素交给调用方。`.tsx` 里不要调用 `Math.random()` 或 `Date.now()`，否则报 `nondeterministic`。需要可重复的随机数时用 `random(seed)` 或 `noise`。字符串和注释里写到 `Math.random` 或 `Date.now` 不会报。

## 14. 预留

- 把帧序列编码成视频。原始像素已经可以从 `renderFrames` 的 `rgba` 或命令行 `--rgba` 拿走，编码由调用方完成，flexlayer 不依赖 ffmpeg。时间轴预览还没有。
- 墨迹布局：按着墨范围计算间距、居中、包裹。
- `Icon`。
- `Scene3D` 这个名字仍保留，不要挪作他用。`sphere`、`box`、`cylinder`、`torus`、`tube`、`extrude`、`model` 画在父 `layer` 的 `perspective` 里，见第 3 章。单独的视口、作者灯光和阴影还没有，讨论见 [docs/proposals/3D.md](docs/proposals/3D.md)。
- 滤镜设计说明见 [docs/EFFECTS.md](docs/EFFECTS.md)。勿占用：`outer-glow`、`drop-shadow`、`backdrop-filter`、`texture`、`outline`。

## 15. 用 tsx 写 layer

每一块都是 `canvas.create(<layer>…</layer>)`。参数必须已经是 `<layer>`，传入 `<h1>` 或 `<rect>` 会抛错。返回值就是这棵 `<layer>`，并带上量完之后的 `left`、`top`、`right`、`bottom`、`width`、`height`，供下一块的 `x`、`y` 使用。这六个数是布局盒，不含 `rotate` 和 `scale`。转完之后的外接矩形在 `rotatedBox`（同样有 `left`、`top`、`right`、`bottom`、`width`、`height`）。下一块要避开转过的内容，用 `rotatedBox.bottom`，不要用 `bottom`。位置写在 `<layer>` 的 `x`、`y`、`anchor` 上。`.layer` 仍是渲染器读的格式，`--emit` 把展开结果写回去。

返回值上还有 `text`。没有文字时是空数组。每一项是一个文字节点，坐标相对这一层布局盒的左上角，和 `left`、`top` 同一套。

| 字段 | 含义 |
| --- | --- |
| `path` | 相对这一层的路径，如 `h1[0]`、`div[0]/p[0]` |
| `lines` | 排出来的行。一个字是只有一个字的一行；一行字是一条；换行之后几行就几条 |

每一行：

| 字段 | 含义 |
| --- | --- |
| `x`、`y`、`width`、`height` | 这一行的盒子 |
| `baseline` | 这一行基线的 y。同一行只有一个 |
| `chars` | 这一行里的字。每个字有 `text`、`x`、`width`。`width` 是到下一笔的距离，最后一个字不加多余字距。基线用所在行的 `baseline`。最内层写了 `id` 的行内标签拥有这些字时，字上还有 `id`；没写 `id` 的字没有这个字段 |

竖排时每个字自己占一行，列从右往左。两段文字各有自己的 `lines`，用 `path` 分开。

只写了宽或只写了高、从而整层按比例缩放时，这些坐标已经乘上缩放，落在返回的宽高里面。这一层自己的 `rotate` 不算进去。嵌套层的位置和缩放算在里面。

`glyph()` 的轮廓原点在字身左上角。把一个字摆回去：`x` 用 `chars` 里的 `x`，`y` 用 `line.baseline - glyph.baseline`。

返回值上还有 `elements`。这一层里每个排进去的元素一条，按文档顺序，父元素在子元素前面。根层自己不在里面，它的盒子就是 `left`、`top`、`right`、`bottom`。`mask`、`symbol`、`draw` 不进这张表。没有子元素时是空数组。坐标和 `text` 同一套：相对这一层布局盒的左上角，嵌套层的位置和缩放已经算进去，这一层和祖先的旋转不算。下一块要贴着某个圆或矩形，用这里的 `box`，再加上这一层的 `left`、`top`。

| 字段 | 含义 |
| --- | --- |
| `path` | 相对这一层的路径，如 `rect[0]`、`div[0]/p[0]`、`layer[0]/circle[0]` |
| `tag` | 标签名 |
| `id` | 写了 `id` 才有 |
| `box` | 布局盒，字段是 `left`、`top`、`right`、`bottom`、`width`、`height`。不含这一元素自己的 `rotate` |
| `ink` | 这一元素自己的 `rotate`、`scale` 之后的外接矩形，字段和 `box` 相同。线条含描边。没有旋转、缩放和描边外扩时与 `box` 重合。`layer` 的 `ink` 是子树着墨。`flex` 的 `ink` 是 padding 里面的内容区 |
| `mask` | 写了 `<mask>` 的 `layer` 才有。`area`、`pieces`、`softEdge`、`ops` 和报告里的 `mask` 相同（第 10 章）。`ink` 是留下来的部分的外接矩形，字段和 `box` 相同，全部藏起来时是 `null` |

根层自己写了 `<mask>` 时，返回值上也有 `mask`，字段同上，坐标和 `elements` 同一套。和 `glyph()` 一样，这些数来自先画出来的结果：蒙版先画成位图再量，所以图片的 alpha、渐变和形状的 `rotate` 都算在里面。

```tsx
const cut = canvas.create(
  <layer width={1080} height={1350}>
    <mask><img src="photo.subject.png" style="width:1080px; height:1350px" /></mask>
    <img src="photo.jpg" style="width:1080px; height:1350px; object-fit:cover" />
  </layer>,
)
if (cut.mask && cut.mask.pieces > 1) {
  // 主体碎成了几块，回去修蒙版
}
const title = canvas.create(<layer x={60} y={(cut.mask?.ink?.top ?? 0) + 40}>…</layer>)
```

要躲开转过的图形，用 `ink`，不要用 `box`。圆的圆心是 `box` 的中心。只写了宽或只写了高、从而整层按比例缩放时，这些坐标已经乘上缩放，落在返回的宽高里面。

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

完整例子见 [examples/poster.tsx](examples/poster.tsx)、[examples/hello.tsx](examples/hello.tsx)。HTML 里并排放图形见 [examples/html-layer.tsx](examples/html-layer.tsx)。

- 底色用铺满的 `<rect fill>`。`color`、`font-family` 写在 `<layer>` 上。没写 `color` 是 `#111111`，没写 `font-family` 是 `ChillDuanSans`。自定义字体写 `<font family src>`，放在正在 `create` 的那一层里，或先调用 `canvas.font(family, src)`。字体还没注册就 `create`，会抛错，避免用备用字体量出另一套尺寸。`canvas({...})` 已去掉，调用时抛出同样的改法。
- `<font src>` 和 `<img src>` 的相对路径按源文件所在目录解析，不按当前运行目录。
- 根上没写 `safe` 时，渲染按短边的 4%。页面不想要这条边距就写 `safe="0"`。`create` 和最终渲染用同一条可用宽度，避免 `measure-mismatch`。
- 只写 `width` 或只写 `height`，且里面没有会换行的文字：另一边按比例放缩，放大缩小都做。这个比例乘进已有的 `scale` 再写回：原来只有一个数时仍写回一个数，原来是 `scale="-1 1"` 这种两个数时两个都乘，不会盖掉镜像。`origin` 为 `top-left`。返回的宽高是缩放后的布局盒，`rotatedBox` 按分轴计算。
- 会换行的文字：`width` 是行宽，高度是排出来的，不缩放。
- 宽高都写了：就是盒子。子元素按自己的 `x`、`y` 摆，不整层缩放。页面用这个。
- 都没写：保持量出来的大小。
- 手写的 `.layer` 不走这套比例放缩。写了 `width` 仍是盒子。
- `canvas.component(name, render)` 按标签名注册组件。`render` 的参数类型来自下面的 `declare module`：声明了 `r: number`，回调里的 `a.r` 就是 `number`，可以直接做算术。返回一个 `<g>` 或形状，也可以返回它们的数组（排版时收成一个 `<g>`）。排版前展开，`.layer` 和 JSX 走同一条路。`--emit` 仍写原来的标签。未注册的标签报 `unknown-tag`。同名再注册会替换。JSX 里大写函数组件在 `jsx()` 里展开，和这个注册表互不替代。内置 `arrow` 用这个注册。自定义标签的类型写在 jsx 运行时上：

```tsx
declare module 'flexlayer/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      badge: { r: number; fill?: string }
    }
  }
}

canvas.component('badge', (a) => {
  const d = a.r * 2
  return [
    <circle cx="0" cy="0" r={a.r} fill={a.fill} />,
    <circle cx={d} cy="0" r={a.r} fill={a.fill} />,
  ]
})
```

最终排版和量到的盒子不一致时，报 `measure-mismatch`（warn），消息里带上两个尺寸。常见原因是 `width`、`safe` 或字号和最终画布不一样。
