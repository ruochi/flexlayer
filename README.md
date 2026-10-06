# Flex Layer

Flex Layer 用标签描述一帧画面：图形用 SVG 的写法，文字用 HTML 的写法，布局用 CSS flexbox。渲染器读入 `.layer`，输出 PNG 和一份布局报告。

规范见 [SPEC.md](SPEC.md)。给模型的入口见 [AGENTS.md](AGENTS.md)，一页写法见 [docs/CHEATSHEET.md](docs/CHEATSHEET.md)，字体、图片和配色见 [docs/RESOURCES.md](docs/RESOURCES.md)。当前版本是 0.2.4。

`layer` 上的 `perspective` 让直接子元素共用一个视距。`rotateX`、`rotateY`、`z` 写在要转动或推近的那一层上。`sphere`、`box`、`extrude`、`model` 和这些平面共用同一台视距。例子：`npx tsx src/cli.ts render examples/perspective.layer -o perspective.png`，`npx tsx src/cli.ts render examples/meshes.layer -o meshes.png`。

## 安装

需要 Node.js 20 或更高版本。

```bash
npm install
npm run build
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

推荐先量再摆。`canvas.create` 同步准备字体和图片，并在进程里记住。参数是一棵 `<layer>`，返回量好的盒子：

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

文件头写 `/** @jsxImportSource flexlayer */`。例子见 `examples/poster.tsx`。也可以直接把节点交给渲染器：

```ts
import { renderLayer } from 'flexlayer'

const { png, report } = await renderLayer(source, { scale: 0.5 })
```

`renderFvg` 与 `renderLayer` 是同一个函数。嵌套 `layer` 不填背景，色块写法见 [AGENTS.md](AGENTS.md)。`.layer` 里可以用 `<draw>`，程序侧用 `draw={fn}`：

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

从字体取出某个字的轮廓。`d` 的原点在字身左上角，字宽和字身高度来自字体：

```ts
import { glyph, h, renderLayer } from 'flexlayer'

const [chun] = await glyph('春', { font: 'Kai', size: 200, weight: 700 })
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
