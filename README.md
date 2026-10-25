# Flex Layer

**中文：** 用标签描述一帧画面，渲染成 PNG。文字和排布按 HTML，图形按 SVG。本仓库其余说明都是英文。

**English:** Describe one frame with tags and render it to PNG. Text and layout follow HTML; shapes follow SVG. The rest of this repository is in English.

Send the picture you want, and the repo https://github.com/ruochi/flexlayer, to Codex, Cursor, Grok, Claude Code, WorkBuddy, GitHub Copilot, Devin, Jules, Google Antigravity, JetBrains Junie, Cline, Replit Agent, CodeBuddy, Tongyi Lingma, Qoder, TRAE, or Wenxin Kuaima, then wait for the result.

Flex Layer describes one frame with tags. Shapes use the SVG form. Text and layout are HTML, rendered as HTML, and the initial values of `style` are the CSS ones. The renderer reads `.layer` and writes a PNG plus a layout report.

The spec is [SPEC.md](SPEC.md). The entry point for models is [AGENTS.md](AGENTS.md). A one-page syntax sheet is [docs/CHEATSHEET.md](docs/CHEATSHEET.md). Fonts, images, and palettes are in [docs/RESOURCES.md](docs/RESOURCES.md). The current version is 0.6.15.

`camera` is written on the layer that frames the shot. A number is the viewing distance, for example `camera="900"`. Omitting it leaves the picture in 2D and reports `flatten-3d`. `shading`, `environment`, `tonemap`, and `quality` belong on that layer. The default tonemap is neutral. `environment="none"` drops the studio panorama. `quality` defaults to draft and uses the shadow map. `final` keeps that map, does not widen it, mixes a 4-tap ray in the penumbra, and adds a bounce, a sharp-metal reflection, and a glass tint. `lamp` and `neon` add a halo that falls off. The rules are in [SPEC.md](SPEC.md). A positive `depth` on a shape extrudes it along z. `cylinder` stands upright. There are also `sphere`, `torus`, `tube`, and `model`. `<model x y width height>` contain-fits in that box. `<model unit x y>` puts the model origin at `(x, y)`. Try `npx tsx src/cli.ts render examples/perspective.layer -o perspective.png`, `npx tsx src/cli.ts render examples/meshes.layer -o meshes.png`, `npx tsx src/cli.ts render examples/solids.layer -o solids.png`, and `npx tsx src/cli.ts render examples/rounded.layer -o rounded.png`.

## For an agent in another project

Send the repo URL to the agent. It reads [AGENTS.md](AGENTS.md) at the root. Install the skill into another project with:

```bash
npx skills add ruochi/flexlayer
```

The skill only introduces the project, the repo, the doc URLs, and the features that go beyond an HTML screenshot. The syntax lives in `node_modules/flexlayer/SPEC.md` after install. The skill text is [skills/flexlayer/SKILL.md](skills/flexlayer/SKILL.md).

## Install

Node.js 20 or newer. `package.json` sets `engines` to `>=20`. On Node 18 the entry says to switch versions, instead of throwing yoga-layout's `ERR_REQUIRE_ESM`.

```bash
npm install
npm run build
```

Installing from git runs `prepare` and compiles for you. You do not build first:

```bash
npm install github:ruochi/flexlayer
```

The default font is ChillDuanSans (寒蝉端黑体). `黑体`, `宋体` (`Song`), `楷体` (`Kai`), `仿宋`, and `圆体` are Chill faces too. `JetBrainsMono` (`等宽`) and `SpaceMono` are the monospace faces. `Brush` and a set of Latin fonts can be named directly. The first use downloads them to `~/.cache/flexlayer/fonts`. The files are not in the package. The list is in [docs/RESOURCES.md](docs/RESOURCES.md).

## Commands

```bash
npx tsx src/cli.ts render examples/hello.layer -o hello.png --report hello.json
npx tsx src/cli.ts render examples/draw-layer.layer -o draw-layer.png   # layer + canvas
npx tsx src/cli.ts render examples/hello.layer --debug --scale 0.5
npx tsx src/cli.ts check examples/hello.layer
npx tsx src/cli.ts render examples/hello.layer -o hello.png --watch
npx tsx src/cli.ts render examples/hello.tsx -o hello.png --emit hello.out.layer
npx tsx src/cli.ts render examples/slide.tsx --frame 1 -o slide.png
npx tsx src/cli.ts render a.tsx b.tsx -o out/ --scale 1 --scale 2
npx tsx src/cli.ts check a.tsx b.tsx
npx tsx src/cli.ts check scene.tsx --frames 600-660 --step 20
```

`check` on a Composition samples about every 0.5s, at most 96 frames, and prints how many it saw. `--frames ends` is the first, middle, and last. `--frames 600-660 --step 20` checks that span.

`render` does not type-check. Type checking is `check`. To check while rendering, add `--typecheck`. Several files and several `--scale` values finish in one process. The same `.tsx` runs once. When there are several files or scales, `-o`, `--report`, and `--emit` are directories.

After a build:

```bash
node dist/cli.js render examples/hello.layer -o hello.png
```

If any issue is at error level, the command exits with code 1.

## From code

Measure first, then place. `layer.create` prepares fonts and images synchronously and remembers them for the process. The argument is one `<layer>`. It returns the measured box. Child positions are in `elements`, in the same coordinates as `text`:

```tsx
import { layer } from 'flexlayer'

const page = { width: 720, height: 540 }
const title = layer.create(
  <layer x={48} y={48} width={page.width - 96} color="#f4ecdf" font-family="Kai">
    <h1 style="font-size:160px; white-space:nowrap">春眠不觉晓</h1>
  </layer>,
)
export default layer.create(
  <layer width={page.width} height={page.height} color="#f4ecdf" font-family="Kai" safe="0">
    <rect x="0" y="0" width={page.width} height={page.height} fill="#0c1424" />
    {title}
  </layer>,
)
```

Put `/** @jsxImportSource flexlayer */` at the top of the file. Measure-then-place is in `examples/poster.tsx`. Shapes beside HTML are in `examples/html-layer.tsx`: a `layer` with a width and height sits inside a `div`, and circles and rectangles use that layer's local coordinates. You can also hand the node to the renderer:

```ts
import { renderLayer } from 'flexlayer'

const { png, report } = await renderLayer(source, { scale: 0.5 })
```

A nested `layer` does not take a background. Color blocks are described in [AGENTS.md](AGENTS.md). Register a new pixel filter with `registerFilter`. The built-in `grade` and `filter` use that same interface. See [SPEC.md](SPEC.md), "Effects". Custom pixels use `<canvas>` and `<script>`:

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

In `.tsx`, `<script>` can be a closure, and it runs after layout. `performance.now()` is this frame's time in milliseconds.

`glyph` returns an array of outlines for the characters you ask for. The origin of `d` is the top-left of the glyph box. Width and body height come from the font:

```ts
import { glyph, h, renderLayer } from 'flexlayer'

const [chun] = glyph('春', { font: 'Kai', size: 200, weight: 700 })
const root = h(
  'layer',
  { width: '640', height: '360', background: '#111111' },
  h(
    'layer',
    { x: '320', y: '180', anchor: 'center', width: String(chun.width), height: String(chun.height) },
    h('path', { d: chun.d, fill: '#f4ecdf', stroke: 'none' }),
  ),
)
await renderLayer(root)
```

For offscreen measurement, use `createCanvas`, `loadImage`, and `applyCanvasFont` from the main entry, after `await initFonts()`. Register a custom font file with `registerFontPath(family, filePath)`. A name that is already registered is not swapped for another file. This is the same canvas layout uses. Variable weight is written on the `wght` axis. An unregistered font name throws.

A photo, a real object, or a material comes from the asset service, https://nc.fangyitech.com/flex/v1/docs. Flex Layer lays out and renders. In the DeepSeek container, `flexlayer asset "画面里要什么、用在哪" --use subject` prints a JSON report. When `status` is `done`, copy `items[0].snippet` into the picture. An `img` `src` is a relative path or an https URL from that report.

Render a set of PNGs and a contact sheet:

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

Inside `draw`, read seconds from `el.t` (`frame / fps`). A single frame rendered without `t` has `el.t` of `0`.

A nested `layer` can be a group. The outer `rotate`, `scale`, and `opacity` apply to the whole subtree. Children use coordinates inside the group.

```tsx
h(
  'layer',
  { x: '140', y: '160', width: '120', height: '80', scale: '1.2', origin: 'center' },
  h('rect', { x: '0', y: '0', width: '120', height: '80', fill: '#fff' }),
  h('layer', { x: '10', y: '0', width: '40', height: '40' }, h('circle', { cx: '20', cy: '20', r: '8', fill: '#3ecfc4' })),
)
```

## Tests

```bash
npm test
```

## License

MIT. See [LICENSE](LICENSE).
