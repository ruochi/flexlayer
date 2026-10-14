# Flex Layer

生成和渲染分开，中间交接 `.layer` 文本。`.tsx` 用 `canvas.create` 先量再摆，执行后得到同一棵树；`--emit` 写回 `.layer`。验证只出报告，渲染出 PNG。不接 Vue 或 React。

标签、属性和问题码的正文只在 [SPEC.md](SPEC.md)。一页写法见 [docs/CHEATSHEET.md](docs/CHEATSHEET.md)，字体和配色见 [docs/RESOURCES.md](docs/RESOURCES.md)，效果图见 [docs/GALLERY.md](docs/GALLERY.md)。

## 工作流

1. 对照下面的约定写 `.tsx` 或 `.layer`。
2. `npx tsx src/cli.ts check scene.tsx`。有 **error** 时退出码为 1，按报告里的 `path`、`hint` 改，再查。类型检查只在 `check` 里做。动画不写 `--frames` 时只抽第 0 帧、中间帧和最后一帧。多个文件可以写在同一个命令里。
3. 间距不对时 `npx tsx src/cli.ts render scene.tsx -o scene.png --debug --report scene.json`，看 `box`（布局盒）和 `ink`（转完或投影后的着墨）。`.tsx` 还有 `source`（`scene.tsx:18:5`）。
4. 满意后 `npx tsx src/cli.ts render scene.tsx -o scene.png`。`render` 不查类型。多张图、多个倍率一次写完：`npx tsx src/cli.ts render a.tsx b.tsx -o out/ --scale 1 --scale 2`。

## 硬性约定

| 规则 | 这样写 | 问题码 |
| --- | --- | --- |
| HTML 用 `style`，layer 和图形用属性 | `<p style="font-size:40px">`、`<circle fill="#fff">` | `invalid-attr` |
| 标签一律小写 | `<circle>`、`<div style="display:flex">`。大写或 `fvg` 不渲染 | `unknown-tag` |
| 嵌套 layer 不写 `background` | 色块用 `<rect fill>`、HTML `background` 或 `<canvas>`。根节点的 `background` 才是画布底色 | `invalid-attr` |
| 排布 | `<div style="display:flex; flex-direction:column">` | `unknown-tag` |
| 线条 | `<layer><line x1 y1 x2 y2 /></layer>` | `invalid-child` |
| 文字位置 | `<layer x="120" y="64"><h1>…</h1></layer>` | `invalid-attr` |
| 位置 | `layer`、`use`、`rect` 用 `x` `y`。圆、椭圆、球用 `cx` `cy` | `invalid-attr` |
| 渐变 | 字形 `style="fill:linear-gradient(...)"`。`color` 只写纯色 | `invalid-attr` |
| 描边 | 只写 `stroke`。形状可加 `stroke-width`；沿墨迹写 `stroke="6 #000 outside"` | `invalid-attr` |
| 整棵子树的效果 | `<layer grade="lomo" overlay="#00000066">` | `invalid-attr` |
| 实体 | 形状写 `depth` 就沿 z 挤出。`rect` 是盒子（`rx` 是圆棱），`circle` 是圆柱，`path` 按 `fill-rule` 留洞。另有 `sphere`、`torus`、`tube`、`model` | `flatten-3d` |
| 地面 | `<ground y="520" rotateX="70" />` 接影子。`shadows="none"` 关掉。不写 `fill` 时只有影子 | `invalid-attr` |
| 结构化数据 | `data={{ values: [1, 2] }}`。`.layer` 写 `data='{"values":[1,2]}'` | `invalid-attr` |
| 故意出现的问题 | `expect="overflow-canvas: 出血图"`。写在根上覆盖整棵子树。没出现报 `unused-expect` | `unused-expect` |
| 最小字号 | 根上 `min-font="print"` 或 `min-font="16"`。不写按屏幕 `min(宽, 高) / 1080 × 24`。多处过小合并成一条 | `min-font-size` |

## 按主题去哪一节

| 要写什么 | 看 |
| --- | --- |
| `layer` 怎么包、怎么定位 | SPEC「layer」 |
| 支持哪些 HTML、SVG、颜料、效果 | SPEC「HTML 和 SVG」 |
| 实体、镜头、地面 | SPEC「实体和镜头」 |
| 蒙版、抠图、`glyph`、`canvas.create`、动画 | SPEC「蒙版和程序」 |
| 问题码和报告字段 | SPEC「报告」 |
| 某个属性怎么写 | [docs/attrs.json](docs/attrs.json)，按名字查 |
| 按气质选字体 | [docs/RESOURCES.md](docs/RESOURCES.md) 的推荐字体。寒蝉端黑体是默认字体。其余名字自己带字体文件 |

HTML 和 `display:flex` 按 CSS 渲染，默认值不在这里记。

## 仓库

- 字体名用 [docs/RESOURCES.md](docs/RESOURCES.md) 里的，不要编造字体文件地址。
- 实现备注在 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。还没做的点选和作者灯光在 [docs/proposals/3D.md](docs/proposals/3D.md)。three.js 的几何体走 `<model object>`。
- 自动化：`npm test`，`npm run gallery`。
- 合并进 `main` 时，把根 `package.json` 和 `package-lock.json` 的 `version` 补丁号加一。删掉还能用的旧写法时升次版本号。
