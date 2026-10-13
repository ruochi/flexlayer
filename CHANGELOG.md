# Changelog

## 0.5.3

`.ttc`、`.otc` 可以用 `#` 选择字形。`src="SourceHanSans.ttc#2"` 是第 2 套，从 0 数。以前 `#2` 被当成路径，报「字体文件不存在」，于是用了集合里的第 0 套。思源和 Noto CJK 的第 0 套是日文，简体的「复」会不对。

## 0.5.2

`.layer` 里的 `<script>` 在子进程里跑。`node_modules` 是符号链接时，权限名单以前只放真实目录，加载器读的却是链接上的 `package.json`，于是报 `Access to this API has been restricted`，canvas 是空的。现在链接和真实路径都放行。脚本出错时不再先打出渲染成功。

## 0.5.1

推荐字体按气质列在 `resources.recommendedFonts`，粗黑体在前。寒蝉端黑体仍是默认字体。其余名字只供选型，要自己带 `<font family src>`。

自动窄圆角收到 4px。已经圆滑的边不加，旁边的折棱仍然收，所以圆柱侧面不加、上下口要收。写了 `rx` 或描了 `stroke` 的保持原来的棱。

## 0.5.0

删掉 `<draw>` 和 `draw` 回调。自定义像素改成 `<canvas>` 和 `<script>`。

`width`、`height` 是位图尺寸，也是默认布局尺寸，不写时是 300×150。`style` 里的宽高只改布局。脚本在排版之后、绘制之前执行，绘制顺序是文档顺序。`devicePixelRatio` 等于 `--scale`。每一帧都是新画布，只调用一轮 `requestAnimationFrame`。`performance.now()` 和 `Date.now()` 是这一帧的毫秒，`Math.random` 按帧播种。

`.layer` 里的脚本文本在子进程里跑，文件和网络关掉。`.tsx` 的函数闭包留在本进程。`--no-script` 跳过脚本。子集以外的 DOM 报 `unsupported-dom`。写了 `<draw>` 报 `invalid-child`，写了 `draw` 回调报 `invalid-attr`。

## 0.4.3

开了镜头的那一层可以写 `shadows="none"`，不再给平面和地面投主光的硬边影子，深度遮挡还在。网格、平面和 `ground` 还可以写 `cast-shadow="false"`、`receive-shadow="false"`。不写时和以前一样，不透明表面互相投影子。

根上的 `min-font` 可以写成 `screen`（默认，`min(宽, 高) / 1080 × 24`）、`print`（× 12）、像素，或 `none`。同一张图里多处过小的字合并成一条 `min-font-size`。开了镜头的 layer 不再报 `ink-inset`。

`package.json` 写了 `engines.node >=20`。命令行在加载布局引擎之前检查版本，Node 18 会说明要换到 20 或更高，而不是抛出 yoga-layout 的 `ERR_REQUIRE_ESM`。

内置 `JetBrainsMono`（别名 `jetbrains mono`、`等宽`）。`render` 和 `check` 可以加 `--watch`，源文件和它引用的相对路径一变就再跑一遍。

属性目录在 `docs/attrs.json`，由 `npm run docs:attrs` 从注册表生成。

flex 和文字的默认值改成和 CSS 一致。`align-items`、`align-content` 默认 `stretch`，`flex-shrink` 默认 `1`，`text-wrap` 默认 `wrap`，行高默认 `1.2`。图片和形状的最小尺寸仍是内容尺寸，不会被压到比自身更小。要交叉轴居中写 `align-items:center`。

## 0.4.2

`--refine` 改回 BiRefNet 512。lite 512 在夜里的钟楼上输出全是负的 logits，遮罩是空的，位置也是 `null`。深度会话仍在载入抠图模型之前放掉。

分层只留正向点和反向点，不再按两个点之间的远近收成一段。`--point` 点在要留下的地方，`--omit` 点在不要的地方，都可以写多次，看完遮罩可以再补点重跑。正向点沿着深度连着的一块长出去；没写反向点时，近端停在地面以上，和没点时同一条线。反向点落在这块里面时，和正向点各自往外长，离反向点更近的那一块去掉。没写点时仍从伸进远处的尖往下长。只写 `--omit` 时，从这张遮罩里挖掉点到的那一块。

`packages/select` 的安装说明改成 `npm install`。`package-lock.json` 和 `package.json` 对不上时，`npm ci` 会报错。

## 0.4.1

`ground` 是没有宽高的无限平面，用来接主光的影子。`rotate`、`rotateX`、`rotateY` 和 `box` 一样。不写 `fill` 时地面透明。

## 0.4.0

删掉 `perspective`。镜头只写 `camera`。需要投影又没写 `camera` 时，有网格、`ground` 或 `rotateX`、`rotateY`、`z` 的最外层用自己的 `height` 当视距。里面没写 `camera` 的层不另开镜头。

## 0.3.0

删掉还能用的旧写法。下面这些现在会报错，或不再导出：

- 标签必须是规范里的小写。`<Layer>`、`<Circle>` 不再归一后照常画。根上写了大写，直接拒绝；子元素报 `unknown-tag`（error），hint 给出小写写法。旧根标签 `fvg` 同样不接受。
- 不再导出 `renderFvg`、`checkFvg`。`parseFvg` 改名为 `parseLayer`。`FvgNode`、`FvgReport` 等类型改成 `LayerNode`、`LayerReport`。
- 不再把旧包名重定向到 `flexlayer`。
- `glass` 只接受预设名，或 `clear, blur 8, tint #fff2` 这种逗号写法。`regular 8 #ffffff22`、单独的像素数不再接受。

`layer` 上的 `cx` / `cy`、`ink-stroke` 仍会指出正确写法。

## 0.2.58

实现提交：`bbbad19239c9ec2956bb48ff758ca58a729af60c`

前景遮罩用 `--point x,y` 指出要留的地方，可以写多个点。远近取这些点里最近和最远，连在一起、落在这段深度里的留下。不写点时仍从伸进远处的尖往下长。`--front` 去掉了。

`--refine` 改用大约 100MB 的 BiRefNet lite。深度会话在载入抠图模型之前放掉，避免和完整模型大约 3GB 的中间结果叠在一起。

比画布大很多的平面，裁完的多边形用一次单应贴图，接缝处的贴图和圆角描边不再折开。

粗糙度 0 是清晰环境、不加噪点，1 是最糊的一层、噪点振幅最大。噪点改成加法，振幅是粗糙度平方的 10 级。金属的压暗随粗糙度减轻，玻璃往中间灰收一截。

图片和字体的相对路径只跳过系统临时目录里打包器写的入口。脚本目录名叫 flexlayer- 时，按这个目录解析。

默认字体从 `DEFAULT_FONT_FAMILY` 读。带 `blur`、`grade` 或 `<mask>` 的层在取景放大后只光栅化落在画面里的一块，并留出模糊和羽化要采样的边。取景窗或 `overflow="hidden"` 裁开的文字边不再报 `outside-safe`；裁完仍露在安全区外的字还是要报。

`analyzeImage` 改成同步返回，和 `glyph` 一样。

`canvas.create` 在数值透视里带回网格投影后的 `points`、`edges` 和轮廓 `d`。球只给圆。渲染时加的窄圆角不进这三项。

面数不超过 200 的网格，渲染时在折棱上向里收一条最多 8px 的窄圆角。写了 `rx`、描了边，或本来就圆的，保持原来的棱。

Material Symbols 的字形停在基线上方。图标着墨放进行盒正中，不再每种图标偏得不一样。

`draw` 回调的 `ctx` 可以 `drawImage`。已经排好的一帧用 `renderLayer(node, { format: 'rgba' })` 拿走不预乘像素和画布宽高。

去掉各平台的插件清单，只留 `skills/flexlayer/SKILL.md` 一份。`AGENTS.md` 收成入口，细则留在 SPEC。删掉已经落地的 `docs/PLAN.md`；效果和公式的实现备注并进 `docs/IMPLEMENTATION.md`。网格基准挪到 `scripts/bench-mesh.mjs`。勾股演示的视频和大图不再入库。

## 0.2.57

实现提交：`ec49b328201f03385ff6b4d26323d05fb07f1309`

`flexlayer-select mask` 取出前景遮罩，写到 `photo.foreground.png`，并返回这块前景的 `x`、`y`、`width`、`height`。`--front` 从 0 到 1，默认 0.5，调大遮罩变大，调小只留更靠近镜头的一段。`--refine` 用抠图模型修边。

## 0.2.56

实现提交：`f902e0acd8496b583d98be6b2aed1273994d21df`

网格的 `material="glass"` 是假玻璃。反射把主灯的方窗留在形体里，掠射边加轮廓光。折射从背面出来，按离开中心的位置轻轻扫过同一张环境，补在方窗和轮廓光还没照亮的地方。

## 0.2.55

实现提交：`8c4fbc361ac37e5fd594e1f9230c7d64435f8812`

比画布大很多的平面先按视锥裁出可见的一块再光栅化，分辨率跟着屏幕密度。纯色地面不再分配整张布局尺寸的位图。完全落在画面里的小平面仍走原来的投影。

## 0.2.54

实现提交：`d3cf69c60c70da2dea7e0dc9ed30eff3a75010e1`

取景层的 `camera` 写 `aperture` 时按每个像素的深度做景深。半径是 `aperture × |深度 − focus| / 深度`，近处的糊边盖到远处。`sharp="true"` 的表面保持清楚。

## 0.2.53

实现提交：`f9c392d55d7509a73dfffb1e351fe0d19a9dcb81`

普通文字盒同时写 `background` 和 `stroke` 时，描边绕着底板，贴出画布报 `effect-clipped`。`preserve-3d` 穿过没有姿态的 flex 时，没写 `preserve-3d` 的旋转卡片仍是一张图，里面的文字跟着色块一起投影。

## 0.2.52

实现提交：`780c328b65e051a52707d806f65888ccb3678a42`

金属和塑料用磨砂明暗做底，再叠同一张工作室环境，不再加会缩成一点的高光。主灯是左上方一块大圆角正方形，从正左向中间偏 30°。暗面另有一条窄的边缘光，顶部互不相接。粗糙度先把环境高斯模糊，噪点写进这张图再取样，越高越糊，噪点越密。

## 0.2.51

实现提交：`36e36c95e72b76d220920d3a559f9259080d30c6`

父层 `rotateX` 里的平面，贴图上全透明的像素不再挡住后面的棱。`scale` 或 `view` 放大后，贴边的网格描边画到边上，不再在窗口里面收成圆头。有背景的盒子按背景外框描边。三维场景的 `stroke` 和 `shadow` 跟着已经画好的画面。

## 0.2.50

实现提交：`bb230b0bf0a5ea2e73c155c831c9cec1b6e36a7e`

取景层可以写 `camera`。`preserve-3d` 让子元素沿着父链进入同一台镜头。

## 0.2.49

实现提交：`2a31f7c400057282fd518266a6ae912f1397c528`

旋转后的距离描边改在屏幕像素里按 4 倍采样再平均，斜边不再跟着最近邻变成台阶，外侧描边垫进填充的抗锯齿边。网格折线画在超采样缓冲上，和填充一起平均缩回。

## 0.2.48

实现提交：`4627e8654dc32743dac694af66655ca7e5bd55e0`

金属和玻璃的固定工作室环境从横条灯带改成竖向柔光板。方位和仰角躲开 90° 的整数倍，板子也从正竖直偏开一点。白、黑和灰过渡都留着，圆柱上是偏斜的亮带和暗带。

## 0.2.47

实现提交：`f81a78ddb8e7a4d1c3d5fd07bea768c86805e4d0`

合进 `main` 时，0.2.46 已经是「颜料改走 fill、描边并入 stroke」那一版，所以这次网格提速记为 0.2.47。

网格渲染按物体实际占的屏幕范围光栅化，并缓存完全静止的场景。

- 光栅缓冲区只覆盖投影顶点（和平面四边形）与可见区域的交集。可见区域是文档画布换算到该 layer 后的范围，有裁剪时再交上裁剪盒。返回的画面带 `x` / `y` 偏移。
- 采样数固定为 `meshSamples`（`1` | `2` | `4`，默认 `4`），不再因为视口含有画面外的部分而降级。原先因此落到 2×2 的场景现在保持 4×4，画质只会更好。`overflow-canvas` 等报告仍按完整投影外框，阴影贴图仍在光源空间。
- 进程级场景缓存按内容哈希，不按对象引用。浮点数量化到 `1e-4`。`draw`、玻璃、`grade`、读背景的滤镜等无法稳定哈希的内容不缓存。命中时像素逐字节相同。上限默认 256MB，渲染选项 `meshCache` 或环境变量 `FLEXLAYER_MESH_CACHE`（字节数，或 `0` / `off` / `false`）可改、可关。
- 挤出、圆角和 `model` 的几何按参数另做缓存，物体在转、形状不变时不必重建。
- 颜色、深度、所有者和阴影深度缓冲按进程复用，只填本帧的矩形。
- `meshSamples` 接到 `renderLayer`、`renderFrames`、`renderToCanvas` 和命令行 `--mesh-samples`。

基准（`node bench-mesh.mjs`，1920×1080，单进程，默认 4× 采样）：地面加挤出字静止约 19 ms/帧，只有字静止约 23 ms/帧，字在转约 280 ms/帧。
