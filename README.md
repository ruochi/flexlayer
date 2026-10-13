# Flex Layer

把画面要求和仓库地址 https://github.com/ruochi/flexlayer 发给 Codex、Cursor、Grok、Claude Code、WorkBuddy、GitHub Copilot、Devin、Jules、Google Antigravity、JetBrains Junie、Cline、Replit Agent、CodeBuddy、通义灵码、Qoder、TRAE 或文心快码，就可以等结果。

Flex Layer 用标签描述一帧画面：图形用 SVG 的写法。文字和排布是 HTML，按 HTML 渲染，`style` 的初始值就是 CSS 的。渲染器读入 `.layer`，输出 PNG 和一份布局报告。

规范见 [SPEC.md](SPEC.md)。给模型的入口见 [AGENTS.md](AGENTS.md)，一页写法见 [docs/CHEATSHEET.md](docs/CHEATSHEET.md)，字体、图片和配色见 [docs/RESOURCES.md](docs/RESOURCES.md)。当前版本是 0.6.12。

`layer` 上的 `camera` 是这一层的镜头。不写时，有实体、`ground` 或 `rotateX`、`rotateY`、`z` 的最外层用自己的 `height` 当视距。形状写了正的 `depth` 就沿 z 挤出。另有 `sphere`、`torus`、`tube`、`model`。例子：`npx tsx src/cli.ts render examples/perspective.layer -o perspective.png`，`npx tsx src/cli.ts render examples/meshes.layer -o meshes.png`，`npx tsx src/cli.ts render examples/solids.layer -o solids.png`，`npx tsx src/cli.ts render examples/rounded.layer -o rounded.png`。

## 给别的项目里的 agent

把仓库地址发给 agent，它读根目录的 [AGENTS.md](AGENTS.md)。别的项目安装 skill：

```bash
npx skills add ruochi/flexlayer
```

Skill 只介绍项目、仓库和文档地址，以及超出 HTML 截图的能力。写法在安装后的 `node_modules/flexlayer/SPEC.md`。正文是 [skills/flexlayer/SKILL.md](skills/flexlayer/SKILL.md)。

## 安装

需要 Node.js 20 或更高版本。`package.json` 的 `engines` 写了 `>=20`。用 Node 18 跑命令时，入口会直接说明要换版本，而不是抛出 yoga-layout 的 `ERR_REQUIRE_ESM`。

```bash
npm install
npm run build
```

从 git 安装时会跑 `prepare`，自动编译，不用事先构建：

```bash
npm install github:ruochi/flexlayer
```

默认字体是寒蝉端黑体。`Song`、`Kai`、`Brush` 和一批 Google 字体也可以直接写名字，第一次用到时下载到 `~/.cache/flexlayer/fonts`。名单见 [docs/RESOURCES.md](docs/RESOURCES.md)。

## 命令

```bash
npx tsx src/cli.ts render examples/hello.layer -o hello.png --report hello.json
npx tsx src/cli.ts render examples/draw-layer.layer -o draw-layer.png   # layer + canvas
npx tsx src/cli.ts render examples/hello.layer --debug --scale 0.5
npx tsx src/cli.ts check examples/hello.layer
npx tsx src/cli.ts render examples/hello.layer -o hello.png --watch
npx tsx src/cli.ts render examples/hello.tsx -o hello.png --emit hello.out.layer
npx tsx src/cli.ts render examples/slide.tsx --frame 1 -o slide.png
```

构建之后也可以：

```bash
node dist/cli.js render examples/hello.layer -o hello.png
```

有 error 级别问题时，命令退出码为 1。

## 代码调用

推荐先量再摆。`canvas.create` 同步准备字体和图片，并在进程里记住。参数是一棵 `<layer>`，返回量好的盒子。子元素的位置在 `elements` 里，和 `text` 用同一套坐标：

```tsx
import { canvas } from 'flexlayer'

const page = { width: 720, height: 540 }
const title = canvas.create(
  <layer x={48} y={48} width={page.width - 96} color="#f4ecdf" font-family="Kai">
    <h1 style="font-size:160px; white-space:nowrap">春眠不觉晓</h1>
  </layer>,
)
export default canvas.create(
  <layer width={page.width} height={page.height} color="#f4ecdf" font-family="Kai" safe="0">
    <rect x="0" y="0" width={page.width} height={page.height} fill="#0c1424" />
    {title}
  </layer>,
)
```

文件头写 `/** @jsxImportSource flexlayer */`。先量再摆见 `examples/poster.tsx`。HTML 里并排放图形见 `examples/html-layer.tsx`：`div` 里放写了宽高的 `layer`，圆和矩形用这一层的局部坐标。也可以直接把节点交给渲染器：

```ts
import { renderLayer } from 'flexlayer'

const { png, report } = await renderLayer(source, { scale: 0.5 })
```

嵌套 `layer` 不填背景，色块写法见 [AGENTS.md](AGENTS.md)。新的像素滤镜用 `registerFilter` 登记，内置的 `grade` 和 `filter` 也在这个接口上，见 [SPEC.md](SPEC.md)「效果」。自定义像素用 `<canvas>` 和 `<script>`：

```html
<layer width="400" height="300" background="#0f1115">
  <layer x="120" y="110">
    <canvas id="bar" width="160" height="80"></canvas>
    <script>
      const canvas = document.querySelector('#bar')
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#3ecfc4'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    </script>
  </layer>
</layer>
```

`.tsx` 里的 `<script>` 可以是闭包，排版之后执行。`performance.now()` 是这一帧的毫秒。

从字体取出某个字的轮廓，调用后直接得到数组。`d` 的原点在字身左上角，字宽和字身高度来自字体：

```ts
import { glyph, h, renderLayer } from 'flexlayer'

const [chun] = glyph('春', { font: 'Kai', size: 200, weight: 700 })
const root = h(
  'layer',
  { width: '640', height: '360', background: '#111111' },
  h(
    'layer',
    { x: '320', y: '180', anchor: 'center', width: String(chun.width), height: String(chun.height) },
    h('path', { d: chun.d, fill: '#f4ecdf' }),
  ),
)
await renderLayer(root)
```

离屏量字用主入口的 `createCanvas`、`loadImage` 和 `applyCanvasFont`，先 `await initFonts()`。自定义字体文件用 `registerFontPath(family, filePath)`，同名已经登记过就不再换文件。这是排版那一份画布，可变字重写在 `wght` 轴上。没登记的字体名会抛错。

分析一张抠图结果：留下多少、碎成几块、有几个洞、边有多软，并描出轮廓 `d`。坐标是图片像素：

```ts
import { analyzeImage, h, renderLayer } from 'flexlayer'

const cut = analyzeImage('photo.subject.png')
if (cut.pieces > 1) console.warn(`主体碎成了 ${cut.pieces} 块`, cut.parts)
const root = h(
  'layer',
  { width: String(cut.width), height: String(cut.height) },
  h('mask', {}, h('path', { d: cut.d })),
  h('img', { src: 'photo.jpg', style: `width:${cut.width}px; height:${cut.height}px` }),
)
await renderLayer(root)
```

抠主体和前景遮罩都在仓库里的 `packages/select`，不在 npm 上，渲染器只读它写出的文件。进入这个目录执行 `npm install && npm run build`。`npx flexlayer-select mask photo.jpg` 先跑大约 19MB 的深度模型，写出 `photo.foreground.png`，并返回这块前景的 `x`、`y`、`width`、`height`。不写点，从伸进远处的尖往下长。要留下的地方写 `--point x,y`，不要的地方写 `--omit x,y`，都可以写多次，看完遮罩可以再补点重跑。边要跟抠图模型走时加 `--refine`，那一次才下载大约 470MB 的 BiRefNet 512 fp16。深度模型会先放掉，再载入抠图模型。只抠主体时仍用 `npx flexlayer-select cutout photo.jpg --preset portrait`。

按帧生成一组 PNG 和一张联系表：

```ts
import { h, renderComposition, type Composition } from 'flexlayer'

const scene: Composition = {
  id: 'slide',
  width: 32,
  height: 32,
  fps: 4,
  durationInFrames: 4,
  component: ({ frame }) =>
    h(
      'layer',
      { width: '32', height: '32', background: '#000' },
      h('rect', { width: '8', height: '32', x: String(frame * 8), y: '0', fill: '#fff' }),
    ),
}

const { frames, contactSheet } = await renderComposition(scene)
```

`draw` 里通过 `el.t` 读取秒数（`frame / fps`）。不传 `t` 的单帧渲染里，`el.t` 为 `0`。

嵌套的 `layer` 可以当分组：外层的 `rotate`、`scale`、`opacity` 作用到整棵子树，子元素用组内坐标。

```tsx
h(
  'layer',
  { x: '140', y: '160', width: '120', height: '80', scale: '1.2', origin: 'center' },
  h('rect', { x: '0', y: '0', width: '120', height: '80', fill: '#fff' }),
  h('layer', { x: '10', y: '0', width: '40', height: '40' }, h('circle', { cx: '20', cy: '20', r: '8', fill: '#3ecfc4' })),
)
```

## 测试

```bash
npm test
```

## 许可

MIT，见 [LICENSE](LICENSE)。
