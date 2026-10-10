# Flex Layer

把画面要求和仓库地址 https://github.com/ruochi/flexlayer 发给 Codex、Cursor、Grok、Claude Code、WorkBuddy、GitHub Copilot、Devin、Jules、Google Antigravity、JetBrains Junie、Cline、Replit Agent、CodeBuddy、通义灵码、Qoder、TRAE 或文心快码，就可以等结果。

Flex Layer 用标签描述一帧画面：图形用 SVG 的写法，文字用 HTML 的写法，布局用 CSS flexbox。渲染器读入 `.layer`，输出 PNG 和一份布局报告。

规范见 [SPEC.md](SPEC.md)。给模型的入口见 [AGENTS.md](AGENTS.md)，一页写法见 [docs/CHEATSHEET.md](docs/CHEATSHEET.md)，字体、图片和配色见 [docs/RESOURCES.md](docs/RESOURCES.md)。当前版本是 0.2.46。

`layer` 上的 `perspective` 让直接子元素共用一个视距。`rotateX`、`rotateY`、`z` 写在要转动或推近的那一层上。`sphere`、`box`、`cylinder`、`torus`、`tube`、`extrude`、`model` 和这些平面共用同一台视距。例子：`npx tsx src/cli.ts render examples/perspective.layer -o perspective.png`，`npx tsx src/cli.ts render examples/meshes.layer -o meshes.png`，`npx tsx src/cli.ts render examples/solids.layer -o solids.png`，`npx tsx src/cli.ts render examples/rounded.layer -o rounded.png`。

## 给别的项目里的 agent

Skill 正文在 [skills/flexlayer/SKILL.md](skills/flexlayer/SKILL.md)，插件包里有同一份。公开的 `main` 包含它之后可以安装：

```bash
npx skills add ruochi/flexlayer
```

Claude Code 用 `/plugin marketplace add ruochi/flexlayer`，再 `/plugin install flexlayer@flexlayer`。Codex 用 `codex plugin marketplace add ruochi/flexlayer`。Cursor 在 Customize 里从 GitHub 仓库导入这个仓库。

Qoder、通义灵码：`qodercn plugins marketplace add ruochi/flexlayer`。CodeBuddy：`/plugin marketplace add ruochi/flexlayer`。WorkBuddy 加 [`.workbuddy-plugin/marketplace.json`](.workbuddy-plugin/marketplace.json) 的原始地址。TRAE 读仓库根的 `.trae-plugin/plugin.json`。DeepSeek Harness 读 [`.dsh/skills/flexlayer/SKILL.md`](.dsh/skills/flexlayer/SKILL.md)。在本仓库里写画面仍看 [AGENTS.md](AGENTS.md)。安装命令见 [plugins/flexlayer/README.md](plugins/flexlayer/README.md)。

## 安装

需要 Node.js 20 或更高版本。

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
npx tsx src/cli.ts render examples/draw-layer.layer -o draw-layer.png   # layer + <draw>
npx tsx src/cli.ts render examples/hello.layer --debug --scale 0.5
npx tsx src/cli.ts check examples/hello.layer
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

`renderFvg` 与 `renderLayer` 是同一个函数。嵌套 `layer` 不填背景，色块写法见 [AGENTS.md](AGENTS.md)。新的像素滤镜用 `registerFilter` 登记，内置的 `grade` 和 `filter` 也在这个接口上，见 [SPEC.md](SPEC.md) 第 9.3 节。`.layer` 里可以用 `<draw>`，程序侧用 `draw={fn}`：

```html
<layer width="400" height="300" background="#0f1115">
  <layer width="160" height="80" x="120" y="110">
    <draw>
      ctx.fillStyle = '#3ecfc4'
      ctx.fillRect(0, 0, el.w, el.h)
    </draw>
  </layer>
</layer>
```

用 `h()` 或 JSX 时，任意元素可挂 `draw={(ctx, el) => { ... }}`，再交给 `renderLayer(root)`：

```ts
import { h, renderLayer } from 'flexlayer'

const root = h(
  'layer',
  { width: '400', height: '300', background: '#fff' },
  h(
    'layer',
    { x: '120', y: '110' },
    h(
      'h1',
      {
        draw: (ctx, el) => {
          ctx.strokeStyle = el.computed.color
          ctx.strokeRect(0, 0, el.w, el.h)
        },
      },
      '标题',
    ),
  ),
)

await renderLayer(root)
```

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

分析一张抠图结果：留下多少、碎成几块、有几个洞、边有多软，并描出轮廓 `d`。坐标是图片像素：

```ts
import { analyzeImage, h, renderLayer } from 'flexlayer'

const cut = await analyzeImage('photo.subject.png')
if (cut.pieces > 1) console.warn(`主体碎成了 ${cut.pieces} 块`, cut.parts)
const root = h(
  'layer',
  { width: String(cut.width), height: String(cut.height) },
  h('mask', {}, h('path', { d: cut.d })),
  h('img', { src: 'photo.jpg', style: `width:${cut.width}px; height:${cut.height}px` }),
)
await renderLayer(root)
```

抠主体在仓库里的 `packages/select`，不在 npm 上，渲染器只读它写出的缓存。进入这个目录执行 `npm ci && npm run build`，第一次会下载大约 470MB 的 fp16 模型。然后 `npx flexlayer-select cutout photo.jpg --preset portrait` 得到 `photo.subject.png`。标记里写 `<img src="photo.jpg" derive="subject" />`，不要改原图。

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
