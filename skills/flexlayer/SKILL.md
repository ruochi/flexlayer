---
name: flexlayer
description: "用 Flex Layer 把一帧画面排成 PNG。用户要海报、封面、幻灯、信息图、示意图、社媒图，或提到 flexlayer、.layer、canvas.create、flex 排版出图时使用。Lay out one frame with flexbox, HTML text, and SVG-style shapes, then check and render to PNG."
license: MIT
compatibility: Node.js 20 或更高。目录里的字体第一次用到时需要联网，下载到 ~/.cache/flexlayer/fonts。
metadata:
  author: ruochi
---

# Flex Layer

用标签描述一帧画面，渲染成 PNG。图形用 SVG 的写法。文字和排布是 HTML，按 HTML 渲染，`style` 的初始值就是 CSS 的。有数据、循环或动画时写 `.tsx`；静态单帧可以手写 `.layer`。

若当前工作区就是 flexlayer 仓库，以根目录的 `AGENTS.md` 为准，命令用 `npx tsx src/cli.ts`，规范是仓库里的 `SPEC.md`。下面是给别的项目用的。

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

文件头写 `/** @jsxImportSource flexlayer */`。`canvas.create` 的参数必须是 `<layer>`。返回的 `left` `top` `right` `bottom` 是没转之前的布局盒；接着摆下一块用 `rotatedBox.bottom`。

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
  <layer width={page.width} height={page.height} background="#0c1424" color="#f4ecdf" font-family="Kai">
    {title}
  </layer>,
)
```

底色写在根节点的 `background` 上。嵌套 `layer` 不写 `background`，色块用 `<rect fill>`。

## 选字体

中文画面按气质从 `docs/RESOURCES.md` 的推荐字体里挑，粗黑体在前。没写字体时用 `ChillDuanSans`。其余推荐名要自己带 `<font family src>`。不要编造字体名，也不要编造字体文件地址。

## 规范在哪

不要在对话里复述规范。写法、问题码和效果以安装包里的文件为准：

- `node_modules/flexlayer/SPEC.md`
- `node_modules/flexlayer/docs/CHEATSHEET.md`
- `node_modules/flexlayer/docs/RESOURCES.md`
- `node_modules/flexlayer/docs/attrs.json` 逐个属性，按名字查

同一份也在 https://github.com/ruochi/flexlayer 的 `SPEC.md`。写错时以报告里的问题码和 `hint` 为准。
