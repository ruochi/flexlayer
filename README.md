# Flex Layer

Flex Layer 用标签描述一帧画面：图形用 SVG 的写法，文字用 HTML 的写法，布局用 CSS flexbox。渲染器读入 `.layer`，输出 PNG 和一份布局报告。

规范见 [SPEC.md](SPEC.md)。给模型的入口见 [AGENTS.md](AGENTS.md)，一页写法见 [docs/CHEATSHEET.md](docs/CHEATSHEET.md)。当前版本是单帧 v0.1.4。

`layer` 上的 `perspective` 让直接子元素共用一个视距。`rotateX`、`rotateY`、`z` 写在要转动或推近的那一层上。`sphere`、`box`、`extrude`、`model` 和这些平面共用同一台视距。例子：`npx tsx src/cli.ts render examples/perspective.layer -o perspective.png`，`npx tsx src/cli.ts render examples/meshes.layer -o meshes.png`。网格默认走 WebGL。`--mesh canvas2d` 用 `@xsyetopz/easel` 在 Canvas 2D 上光栅同一批物体。

## 安装

需要 Node.js 20 或更高版本。

```bash
npm install
npm run build
```

默认字体是寒蝉端黑体。`Song`（宋体）、`Kai`（楷体）、`Brush`（书法）也是内置的，第一次用到时下载到 `~/.cache/flexlayer/fonts`。

## 命令

```bash
npx tsx src/cli.ts render examples/hello.layer -o hello.png --report hello.json
npx tsx src/cli.ts render examples/draw-layer.layer -o draw-layer.png   # layer + <draw>
npx tsx src/cli.ts render examples/hello.layer --debug --scale 0.5
npx tsx src/cli.ts check examples/hello.layer
```

构建之后也可以：

```bash
node dist/cli.js render examples/hello.layer -o hello.png
```

有 error 级别问题时，命令退出码为 1。

## 代码调用

```ts
import { renderLayer } from '@dc/flexlayer'

const { png, report } = await renderLayer(source, { scale: 0.5 })
```

`renderFvg` 与 `renderLayer` 是同一个函数。嵌套 `layer` 不填背景，色块写法见 [AGENTS.md](AGENTS.md)。`.layer` 里可以用 `<draw>`，程序侧用 `draw={fn}`：

```html
<layer width="400" height="300" background="#0f1115">
  <layer width="160" height="80" cx="200" cy="150">
    <draw>
      ctx.fillStyle = '#3ecfc4'
      ctx.fillRect(0, 0, el.w, el.h)
    </draw>
  </layer>
</layer>
```

用 `h()` 或 JSX 时，任意元素可挂 `draw={(ctx, el) => { ... }}`，再交给 `renderLayer(root)`：

```ts
import { h, renderLayer } from '@dc/flexlayer'

const root = h(
  'layer',
  { width: '400', height: '300', background: '#fff' },
  h(
    'h1',
    {
      cx: '200',
      cy: '150',
      draw: (ctx, el) => {
        ctx.strokeStyle = el.computed.color
        ctx.strokeRect(0, 0, el.w, el.h)
      },
    },
    '标题',
  ),
)

await renderLayer(root)
```

按帧生成一组 PNG 和一张联系表：

```ts
import { h, renderComposition, type Composition } from '@dc/flexlayer'

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
      h('rect', { width: '8', height: '32', cx: String(4 + frame * 8), cy: '16', fill: '#fff' }),
    ),
}

const { frames, contactSheet } = await renderComposition(scene)
```

`draw` 里通过 `el.t` 读取秒数（`frame / fps`）。不传 `t` 的单帧渲染里，`el.t` 为 `0`。

嵌套的 `layer` 可以当分组：外层的 `rotate`、`scale`、`opacity` 作用到整棵子树，子元素用组内坐标。

```tsx
h(
  'layer',
  { cx: '200', cy: '200', width: '120', height: '80', scale: '1.2', origin: 'center' },
  h('rect', { cx: '60', cy: '40', width: '120', height: '80', fill: '#fff' }),
  h('layer', { cx: '30', cy: '20', width: '40', height: '40' }, h('circle', { cx: '20', cy: '20', r: '8', fill: '#3ecfc4' })),
)
```

## 测试

```bash
npm test
```

## 许可

MIT，见 [LICENSE](LICENSE)。
