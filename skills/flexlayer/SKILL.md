---
name: flexlayer
description: "用 Flex Layer 把一帧画面排成 PNG。用户要海报、封面、幻灯、信息图、示意图、社媒图，或提到 flexlayer、.layer 时使用。特色是同一深度里的线框断线、文字按墨迹藏到图片后、按物体景深、绕墨迹描边。写法读当前版本的文档。"
license: MIT
compatibility: Node.js 20 或更高。目录里的字体第一次用到时需要联网，下载到 ~/.cache/flexlayer/fonts。
metadata:
  author: ruochi
---

# Flex Layer

Flex Layer 用标签描述一帧画面，渲染成 PNG，并写出布局报告。文字和排布是 HTML，按 HTML 渲染。图形用 SVG 的写法。生成和渲染分开，中间交接 `.layer` 文本。有数据、循环或动画时写 `.tsx`，执行后得到同一棵树。不接 Vue 或 React。

仓库：https://github.com/ruochi/flexlayer

本技能不记属性、标签、命令参数和例子。那些随版本改。动笔前读和当前渲染器同一份的文档。写错时以报告里的 `path`、`hint` 为准。

## 特色

文字、图片、线框和实体进同一张深度，只有有墨的像素才遮挡。

- 线框遇空白不断，遇实体才断开。被自己挡住的棱是虚线，被别的物体挡住就断开。
- 文字按墨迹藏到图片后面。一个字可以一半在前、一半在后。
- 景深按物体分开糊，糊边不漏出被挡住的颜色。
- 描边绕着合成后的墨迹。重叠的字只有一圈。
- 半透明玻璃不写深度，后面的棱还在。

校验出报告，渲染出 PNG。报告里有路径、布局盒和着墨。字体和配色用资源文档里的名字。

## 超出 HTML 截图的能力

HTML 截图把浏览器里的网页画下来。Flex Layer 的文字排布走同一套 CSS。下面这些能力要打开文档再写：

- **先量再摆。** 量完一块再放下一块，按实际布局盒，以及转完或投影后的着墨对齐。
- **图形和文字在同一棵树。** 矩形、圆、线、路径、箭头用图形属性画在 layer 里。
- **实体和镜头。** 形状可以沿厚度挤出，另有球、环、管、地面和影子。three.js 的几何体可以和文字、线稿放进同一深度。
- **蒙版、抠图、字形轮廓。** 遮罩裁合成后的一层。主体遮罩和单个字的轮廓可以量完再摆回画面。
- **整层效果和自绘像素。** 调色、玻璃、噪点作用整棵子树。像素可以交给画布脚本。
- **帧。** 每个时刻仍是一棵 Flex Layer。随机和时钟按帧固定，同一输入得到同一张图。

## 文档

先找和正在用的那一版相同的文件。仓库的 main 可能比已安装的包新；已经安装时，以包里的文件为准。

当前工作区就是 flexlayer 仓库（有 `src/cli.ts`）时，读仓库里的这些文件，命令用 `npx tsx src/cli.ts`：

| 文件 | 内容 |
| --- | --- |
| `AGENTS.md` | 入口、工作流、硬性约定 |
| `SPEC.md` | 标签、属性、问题码 |
| `docs/CHEATSHEET.md` | 一页写法 |
| `docs/RESOURCES.md` | 字体、图片、配色 |
| `docs/GALLERY.md` | 效果图 |
| `docs/attrs.json` | 按属性名查 |

装在别的项目里时，读 `node_modules/flexlayer/` 下的 `SPEC.md`、`docs/CHEATSHEET.md`、`docs/RESOURCES.md`、`docs/GALLERY.md`、`docs/attrs.json`，命令用 `npx flexlayer`。`AGENTS.md` 不随安装包发布，入口约定在仓库的 `AGENTS.md` 和 SPEC 里。

同一批文档的地址：

- https://github.com/ruochi/flexlayer/blob/main/AGENTS.md
- https://github.com/ruochi/flexlayer/blob/main/SPEC.md
- https://github.com/ruochi/flexlayer/blob/main/docs/CHEATSHEET.md
- https://github.com/ruochi/flexlayer/blob/main/docs/RESOURCES.md
- https://github.com/ruochi/flexlayer/blob/main/docs/GALLERY.md
- https://github.com/ruochi/flexlayer/blob/main/docs/attrs.json

## 开始

需要 Node.js 20 或更高。

```bash
npm install github:ruochi/flexlayer
npx flexlayer check scene.tsx
npx flexlayer render scene.tsx -o scene.png
```

先 `check`。有 error 时退出码为 1，按报告改完再查。通过后再 `render`。其余参数写在 SPEC 和安装包的 README 里。
