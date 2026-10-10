---
name: flexlayer
description: "用 Flex Layer 把一帧画面排成 PNG。用户要海报、封面、幻灯、信息图、示意图、社媒图，或提到 flexlayer、.layer、canvas.create、flex 排版出图时使用。Lay out one frame with flexbox, HTML text, and SVG-style shapes, then check and render to PNG."
license: MIT
compatibility: Node.js 20 或更高。目录里的字体第一次用到时需要联网，下载到 ~/.cache/flexlayer/fonts。
metadata:
  author: ruochi
  version: "0.2.29"
---

# Flex Layer

用标签描述一帧画面，渲染成 PNG。图形用 SVG 的写法，文字用 HTML 的写法，布局用 CSS flexbox。有数据、循环或动画时写 `.tsx`；静态单帧可以手写 `.layer`。

若当前工作区就是 flexlayer 仓库，以根目录的 `AGENTS.md` 为准，命令用 `npx tsx src/cli.ts`。下面的安装和 `npx flexlayer` 是给别的项目用的。

## 安装并出图

```bash
npm install github:ruochi/flexlayer
npx flexlayer check scene.tsx
npx flexlayer render scene.tsx -o scene.png --report scene.json
```

有 **error** 时进程退出码为 1，必须按报告里的 `path`、`hint` 改对应节点，再跑 check。通过或只剩 warn 之后，间距不对就 `npx flexlayer render scene.tsx -o scene.png --debug --report scene.json`，看 `box` 和 `ink`。满意后再出最终 PNG。

动画：

```bash
npx flexlayer check scene.tsx --frames 0-12 --step 3
npx flexlayer render scene.tsx --frames out/ --from 0 --to 90
```

不写 `--frames` 时，check 只抽第 0 帧、中间一帧和最后一帧。

## 先量再摆

文件头写 `/** @jsxImportSource flexlayer */`。`canvas.create` 的参数必须是 `<layer>`。返回的 `left` `top` `right` `bottom` 是没转之前的布局盒；接着摆下一块用 `rotatedBox.bottom`。贴着某个圆或矩形用 `elements[].box`，躲开转过的图形用 `ink`。

```tsx
/** @jsxImportSource flexlayer */
import { canvas } from 'flexlayer'

const page = { width: 720, height: 540 }

const title = canvas.create(
  <layer x={48} y={48} width={page.width - 96} color="#f4ecdf" font-family="Kai">
    <h1 style="font-size:96px; white-space:nowrap">春眠不觉晓</h1>
  </layer>,
)

export default canvas.create(
  <layer width={page.width} height={page.height} color="#f4ecdf" font-family="Kai" safe="0">
    <rect x="0" y="0" width={page.width} height={page.height} fill="#0c1424" />
    {title}
  </layer>,
)
```

底色用铺满的 `<rect fill>`。根节点上的 `background` 才是画布底色，只有根上可以写；要白底写 `background="#ffffff"`，省略则 PNG 空像素透明。

静态 `.layer` 用同一套标签。动画文件导出 `composition`，`draw={(ctx, el) => ...}` 里只用 `ctx` 和 `el`。可重复的随机数用 `random(seed)` 或 `noise`，不要用 `Math.random` 或 `Date.now`。

## 硬性约定

写错会报下面的问题码。HTML 用 `style`，`layer` 和图形用属性。

| 规则 | 这样写 | 问题码 |
| --- | --- | --- |
| HTML 用 `style`，图形用属性 | `<p style="font-size:40px">`、`<circle fill="#fff">` | `invalid-attr` |
| 标签一律小写 | `<circle>`、`<div style="display:flex">` | `non-canonical` |
| 嵌套 `layer` / `use` 的底色 | `<rect fill="#fff">`、HTML `background`，或 `<draw>`。根节点除外 | `invalid-attr` |
| 排布 | `<div style="display:flex; flex-direction:column">` | `unknown-tag` |
| 线条 | `<layer><line x1 y1 x2 y2 /></layer>` | `invalid-child` |
| 文字位置 | `<layer x="120" y="64"><h1>…</h1></layer>` | `invalid-attr` |
| `layer`、`use`、`rect`、`box` 的位置 | `x` `y`。圆、椭圆、球写 `cx` `cy` | `invalid-attr` |
| 笔画贴齐定位点 | `<layer x="76" y="40" anchor-box="ink">`，只写在 `layer` 和 `use` 上 | `ink-inset` |
| 镜头 | `<layer width="1920" height="1080" view="200 80 960 540">` 包住舞台。章节和标注写在这层外面 | `view-outside` |
| 图片 | `<img src="cover.png" style="width:320px; height:180px">`。`image` 同样可用 | `invalid-attr` |
| 图标 | `<span class="material-symbols-outlined">home</span>`。字重写 `font-weight`，字号和颜色跟周围文字 | `missing-icon` |
| 整棵子树的效果 | `<layer grade="lomo" overlay="#00000066">` | `invalid-attr` |
| 调色 | `<layer grade="lomo 0.8, fade 0.1">` | `invalid-attr` |
| 结构化数据 | `data={{ values: [1, 2] }}`。`.layer` 写 `data='{"values":[1,2]}'`，`draw` 读 `el.data` | `invalid-attr`、`emit-data` |
| 故意出现的问题 | `expect="overflow-canvas: 出血图"`。没出现报 `unused-expect` | `unused-expect` |
| 文字盒子 | `<div><p>…</p></div>`。横排再写 `display:flex` | `invalid-child` |
| 图形和文字并排 | `<div style="display:flex"><layer width="120" height="120"><circle cx="60" cy="60" r="50" /></layer><p>…</p></div>`。这一层不写 `x` `y` | `invalid-child`、`invalid-attr` |
| 公式 | `<div style="display:flex"><span>因此</span><math><mi>x</mi></math></div>` | `invalid-child` |
| 公式字体 | 不写 `font-family`。说明文字用 `<mtext>` | `invalid-attr` |
| 整层裁切 | `<layer><mask><circle cx="160" cy="90" r="90" /></mask>…</layer>` | `invalid-child` |
| 透视 | `<layer perspective="900"><rect rotateY="20" z="40" /></layer>` | `invalid-attr`、`flatten-3d` |
| 球体、长方体、拉伸、glb | `<layer perspective="700"><sphere cx="80" cy="80" r="40" /></layer>`。`model` 只写 `src`，尺寸写在外包 layer | `flatten-3d`、`missing-model` |

`align-items` 默认 `center`。竖排要左对齐时写 `align-items:flex-start`。横排按文字基线对齐写 `align-items:baseline`，竖排写了仍按 `flex-start`。`letter-spacing` 可以写 `em`。`justify-content` 只管这一层的主轴。`align-content` 默认 `flex-start`，管的是 `flex-wrap` 之后的多行。

没写 `display:flex` 的 `div` 里直接放 `p`、`h1`–`h3`、`div`、写了宽高的 `layer` 时，从上到下排。只放文字和行内标签时，`div` 仍是文字盒子。`p`、`h1`–`h3`、`span` 里可以放 `<img>`，不要放块级标签或 `layer`。图标写成 `<span class="material-symbols-outlined">home</span>`。容器上的字号、字重、字体、颜色、字距和 `text-align` 会传给没写这些的 `p`、`div`、`span`；`h1`–`h3` 仍用自己的默认字号和字重。

带 `perspective` 的 layer 里，没有网格时直接子元素按中心深度从远到近画。出现 `sphere`、`box`、`extrude`、`model` 时近的盖住远的。不在透视里时 `z` 不改变顺序，并报 `flatten-3d`。

## 字体、配色、图片

直接写目录里的 `font-family`。默认 `ChillDuanSans`。中文常用 `Song`、`Kai`、`Brush`、`NotoSans`、`XiaoWei`、`KuaiLe`、`MaoCao`。拉丁常用 `Inter`、`Playfair`、`Oswald`、`SpaceGrotesk`、`Fraunces`、`Bebas`。公式字母和运算符用 `STIXTwoMath`。

自己的字体文件才写 `<font family="DeYiHei" src="fonts/deyihei.otf" />`。`src` 必须是 ttf、otf 或 woff。不要编造字体地址，也不要把 `fonts.googleapis.com` 的 CSS 地址写进 `<font src>`。

配色：`night` 底 `#0c1424`、字 `#f4ecdf`、强调 `#e8b04a`；`paper` 底 `#f4f1ea`、字 `#0e1219`、强调 `#3ecfc4`；`halving` 底 `#0f1115`、字 `#ffffff`、强调 `#f7931a`。

样图：`lake`、`valley`、`forest` 的地址在资源文档里。`img` 的宽高和 `object-fit` 写在 `style` 里。

## 报告怎么读

- `path`：如 `layer/layer[0]/div[0]/h1[0]`，和 `issues[].path` 一致。`.tsx` 还有 `source`（`scene.tsx:18:5`），改那一行。
- `box`：布局盒，不含旋转、缩放和透视。`gap` 是相邻 box 之间的空隙。
- `ink`：旋转缩放或透视之后的着墨范围。判断 `overflow-canvas` 看 `ink`。
- `quad`：透视平面投影后的四个角。
- `effect`：阴影、光晕、模糊或玻璃可能占用的范围。`effect-clipped` 表示画出了画布。

元素跑出画布就改位置、缩小，或用 `view` 取景。光晕被裁切就缩小 `glow` 或挪开元素。短行居中、长行看起来贴左，是竖排没写 `align-items:flex-start`。

## 细节

标签、属性、效果和问题码的正文在规范里。当前仓库是 flexlayer 时直接打开这些文件；否则打开 GitHub 上的同一路径。

- 规范：`SPEC.md`，https://github.com/ruochi/flexlayer/blob/main/SPEC.md
- 一页写法：`docs/CHEATSHEET.md`
- 字体、图片、配色、效果名：`docs/RESOURCES.md`
- 例子：`examples/poster.tsx`、`examples/hello.tsx`、`examples/html-layer.tsx`、`examples/slide.tsx`
