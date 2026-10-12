# Flex Layer

生成和渲染分开，中间交接 `.layer` 文本。`.tsx` 用 `canvas.create` 先量再摆，执行后得到同一棵树；`--emit` 写回 `.layer`。验证只出报告，渲染出 PNG。不接 Vue 或 React。

标签、属性和问题码的正文只在 [SPEC.md](SPEC.md)。一页写法见 [docs/CHEATSHEET.md](docs/CHEATSHEET.md)，字体和配色见 [docs/RESOURCES.md](docs/RESOURCES.md)，效果图见 [docs/GALLERY.md](docs/GALLERY.md)。

## 工作流

1. 对照下面的约定写 `.tsx` 或 `.layer`。
2. `npx tsx src/cli.ts check scene.tsx`。有 **error** 时退出码为 1，按报告里的 `path`、`hint` 改，再查。动画不写 `--frames` 时只抽第 0 帧、中间帧和最后一帧。
3. 间距不对时 `npx tsx src/cli.ts render scene.tsx -o scene.png --debug --report scene.json`，看 `box`（布局盒）和 `ink`（转完或投影后的着墨）。`.tsx` 还有 `source`（`scene.tsx:18:5`）。
4. 满意后 `npx tsx src/cli.ts render scene.tsx -o scene.png`。

## 硬性约定

| 规则 | 这样写 | 问题码 |
| --- | --- | --- |
| HTML 用 `style`，layer 和图形用属性 | `<p style="font-size:40px">`、`<circle fill="#fff">` | `invalid-attr` |
| 标签一律小写 | `<circle>`、`<div style="display:flex">`。大写或 `fvg` 不渲染 | `unknown-tag` |
| 嵌套 layer 不写 `background` | 色块用 `<rect fill>`、HTML `background` 或 `<draw>`。根节点的 `background` 才是画布底色 | `invalid-attr` |
| 排布 | `<div style="display:flex; flex-direction:column">` | `unknown-tag` |
| 线条 | `<layer><line x1 y1 x2 y2 /></layer>` | `invalid-child` |
| 文字位置 | `<layer x="120" y="64"><h1>…</h1></layer>` | `invalid-attr` |
| 位置 | `layer`、`use`、`rect`、`box` 用 `x` `y`。圆、椭圆、球用 `cx` `cy` | `invalid-attr` |
| 竖排对齐 | `align-items` 默认 `center`。左对齐写 `align-items:flex-start` | |
| 渐变 | 字形 `style="fill:linear-gradient(...)"`。`color` 只写纯色 | `invalid-attr` |
| 描边 | 只写 `stroke`。形状可加 `stroke-width`；沿墨迹写 `stroke="6 #000 outside"` | `invalid-attr` |
| 整棵子树的效果 | `<layer grade="lomo" overlay="#00000066">` | `invalid-attr` |
| 网格 | `<layer><sphere cx="80" cy="80" r="40" /></layer>`。不写 `camera` 时视距等于 height | `flatten-3d` |
| 结构化数据 | `data={{ values: [1, 2] }}`。`.layer` 写 `data='{"values":[1,2]}'` | `invalid-attr` |
| 故意出现的问题 | `expect="overflow-canvas: 出血图"`。没出现报 `unused-expect` | `unused-expect` |

## 按主题去哪一章

| 要写什么 | 看 |
| --- | --- |
| 蒙版、抠图、`preview`、`derive` | SPEC 第 4.1 节和第 6 章 |
| 透视、镜头、景深、`preserve-3d`、网格 | SPEC 第 3 章 |
| 公式 | SPEC 第 4.1 节 |
| `canvas.create`、动画、`glyph` | SPEC 第 5.4 节、第 13 章、第 15 章 |
| 问题码和报告字段 | SPEC 第 10 章 |

flex 的默认值、文字盒子里不能嵌套块级标签、图标写法，都在 SPEC 第 4、5 章，不要在这里再记一份。

## 仓库

- 字体名用 [docs/RESOURCES.md](docs/RESOURCES.md) 里的，不要编造字体文件地址。
- 实现备注在 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。还没做的点选、作者灯光和 `Scene3D` 在 [docs/proposals/3D.md](docs/proposals/3D.md)。
- 自动化：`npm test`，`npm run gallery`。
- 合并进 `main` 时，把根 `package.json` 和 `package-lock.json` 的 `version` 补丁号加一。删掉还能用的旧写法时升次版本号。
