# Flex Layer

TSX describes one frame and renders to a deterministic PNG. HTML, SVG, and solids share one tree. Vue and React are not part of this.

`.tsx` runs into a tree. `layer.create` measures, then you place. The renderer paints that tree. `--emit` writes it back as `.layer`. `check` writes a report. `render` writes a PNG.

The default export is a root `<layer>`. Attributes are strings. In this repo, `npx tsx src/cli.ts render scene.tsx -o out.png`. After install, `npx flexlayer render scene.tsx -o out.png`.

```tsx
export default (
  <layer width="800" height="600" background="#000">
    <layer x="400" y="300" anchor="center">
      <h1 style="font-size:64px; color:#fff">Hello</h1>
    </layer>
  </layer>
)
```

Three differences from a web page:

- `<layer>` places a box with `x`, `y`, and `anchor`. HTML does not take `x` or `y`.
- HTML writes `style`. `layer` and shapes write attributes.
- Tags are lowercase. Layout lengths are pixels. The y axis points down.

HTML, flex, and SVG geometry follow their own standards. Below, only the deviations. Full prose is in [SPEC.md](SPEC.md). One page of syntax is [docs/CHEATSHEET.md](docs/CHEATSHEET.md). Fonts and palettes are in [docs/RESOURCES.md](docs/RESOURCES.md). Sample pictures are in [docs/GALLERY.md](docs/GALLERY.md). Attribute syntax, one name at a time, is [docs/attrs.json](docs/attrs.json).

## What it can do beyond a web page

Plain HTML and CSS work too, so they are not listed here. Reach for these when a picture should look designed, not just laid out.

| Want | Write | Note |
| --- | --- | --- |
| Optical alignment | `anchor="bottom" anchor-box="ink"` | Aligns the glyphs' ink, not the line box |
| Sticker or poster title | `stroke="6 #fff, 14 #c8321e"` | Stacked strokes along the ink, on shapes, images, and a whole `layer`. On text it goes in `style` |
| Multi-color glyphs | `style="fill:gradient(conic 200 100, #f0f, #0ff, #ff0, #f0f)"` | A color matrix, also `linear` and `radial` mappings, mixed in OKLab |
| Scattered, tilted letters | `<h1 split="chars">` with `translate`, `rotate`, `opacity` on inline tags | Each character turns around its own center. The line still wraps as text |
| Frosted or clear glass | `glass="clear"`, `regular`, `thick` | Refraction, specular edge, dispersion. Tune it as `clear, blur 8, tint #fff2` |
| Neon and light | `glow="40 #7ec8ff"`, `inner-glow`, `blend="screen"` | Glow follows the ink of text and shapes |
| Film look | `<layer grade="lomo 0.8, vignette 0.3" grade-mask="radial-gradient(...)">` | Also `matte`, `chrome`, `bleach`, `mono`. `noise="0.08"` adds grain. `noise="0.08 @t"` reshuffles it each frame |
| Text behind a subject | Copy `items[0].snippet` from the asset report | The service returns the images and the fragment. See SPEC, "Images" |
| Knockout | `<mask>` with `op="subtract"`, `feather`, `invert` | Shapes or image alpha. The layer's shadow follows the cut contour |
| 3D objects in a 2D page | `depth="40"` on `rect`, `circle`, `path`; `sphere`, `torus`, `tube` | Same coordinates as 2D. `material="clay"` or `metal`. A bare name is a baked finish and `fill` recolors it. `metal 0.35` is the older roughness form |
| 3D lettering | `glyph()` outlines into `<path d depth>` | Any catalog font becomes an extruded solid |
| Product shot | `camera="fov 40, orbit 35 18, aperture 12"` plus `<ground>` | Orbit, soft shadows on the ground, depth of field. `sharp="true"` keeps a layer in focus |
| Technical line art | Solid with `stroke` and `hidden="#999"` | Visible edges solid, hidden edges in another color |
| three.js scenes | `<model x y width height>` or `<model unit x y>` | Contain-fit in its own box, or put the model origin at `(x, y)`. Meshes, lines, and points share one depth buffer |
| Tilted cards and cover flow | `rotateY="-30"`, `z="80"` on a `layer` | Real perspective. `preserve-3d` sorts nested layers by depth |
| Zoom into a detail | `view="x y w h"` on a `layer` | Crop and enlarge a region of the stage |
| Formulas | `<math display="block">` | Typeset with STIXTwoMath, aligned to text baselines |
| Chinese typography | `font-family="Kai"`, `Brush`, `XiaoWei`, `writing-mode:vertical-rl` | Catalog fonts download by name. See [docs/RESOURCES.md](docs/RESOURCES.md) |
| Generative art | `<canvas>` with `<script>`, `random(seed)`, `noise()` | Deterministic, so every render matches |
| Measure, then place | `layer.create(<layer>…</layer>)` returns boxes, lines, and characters | Lay out by real text width, ink, or a character's position |
| Animation | A `Composition` with `spring`, `interpolate`, `sequence` | Frames render to PNG. `check` samples frames |

Combine two or three per picture. A cover usually needs one strong type treatment, one depth cue (shadow, glass, or a solid), and one finish (`grade` or `noise`).

## Where it differs

### Place

- `anchor` is a 3×3 grid, default `top-left`. `(x, y)` is that point of the box. `anchor-box="ink"` aligns to the ink before rotation.
- When `width` or `height` is omitted, that axis is the union of the child boxes, and the children shift so the union starts at 0 inside the box. The default top-left anchor stays the local origin: the box moves by that minimum, and marks stay where they were written. Other anchors meet the union. `anchor-box="box"` does too. A sized axis stays an artboard.
- A `layer` with width and height inside `display:flex` is a flex item. `x`, `y`, or `anchor` on it reports `invalid-attr`.
- `background` is the canvas color, on the root only, and solid only. A page gradient is a `<rect fill>`.
- `color` is a solid, and the default line color. Glyph paint is `fill` in `style`: a solid, `linear-gradient()`, `radial-gradient()`, or `gradient()`. `gradient()` is a color matrix, not CSS. `fill` is not inherited.
- `rotate`, `scale`, and perspective do not move `box`. `ink` is the mark after transform or projection.

### Text

- A text box holds text, inline tags, and `<img>`. A block child reports `invalid-child`. Several paragraphs are `<div><p>`.
- `split="chars"` moves `translate`, `rotate`, `scale`, and `opacity` onto each character. `rotate` is a bare number of degrees.
- Icons are `<span class="material-symbols-outlined">home</span>`. `math` uses only `STIXTwoMath`.
- The default face is ChillDuanSans. Other catalog names are in [docs/RESOURCES.md](docs/RESOURCES.md). A file you supply is `<font family src>` under the root.

### Stroke and effects

- `stroke="6 #000 outside"` traces the ink. The default side is `outside`. A bare color strokes on center, as in SVG. `outline` and `-webkit-text-stroke` report `non-canonical`.
- On shapes and `layer`, effects are attributes. On text they go in `style`. Names: `shadow`, `glow`, `inner-shadow`, `inner-glow`, `blur`, `backdrop-blur`, `glass`, `noise`, `filter`, `blend`. `filter` accepts `blur()`, `brightness()`, `contrast()`, `drop-shadow()`, `grayscale()`, `hue-rotate()`, `invert()`, `opacity()`, `saturate()`, and `sepia()`. Lengths are pixels. `url()` is not accepted. When `blur` and `blur()` inside `filter` are both set, `blur` wins.
- CSS `box-shadow` and `backdrop-filter` paint. `box-shadow` is `shadow`, and `inset` is `inner-shadow`. `backdrop-filter` uses the same functions as `filter`. `blur()` is `backdrop-blur`.
- `overlay`, `grade`, and `grade-mask` belong only on `layer` and cover the subtree. `grade` presets: `lomo`, `matte`, `chrome`, `bleach`, `mono`.

### Solids

- A positive `depth` extrudes along z. `rect` is a box (`rx` rounds the edges). `circle` is a cylinder. Also `sphere`, `torus`, `tube`, and `model`. `tube` `d` is the centerline in layer coordinates, the same as `path`. `<model x y width height>` contain-fits in that box. `<model unit x y>` puts the model origin at `(x, y)`. Omitting both is an error. `<model object={mesh} />` reads a three.js mesh. `unit` is pixels per model unit. Model space keeps y pointing up.
- Write `camera` on the layer that frames the shot. A number is the viewing distance, for example `camera="900"`. Omitting it leaves the picture in 2D and reports `flatten-3d`. Do not combine `camera` and `view` on the same layer.
- `<ground>` receives shadows. With no `fill`, only the shadow is drawn. `shadows="none"` on the camera layer turns shadows off.
- `shading` on that same layer is `studio` when omitted, or `toon`, `technical`, or `manga`. It covers every solid under the camera. An authored `stroke` still wins.

### Checks and programs

- `data={{ values: [1, 2] }}` in `.tsx`. In `.layer`, `data='{"values":[1,2]}'`.
- `expect="overflow-canvas: full bleed"` names an issue you want. On the root it covers the subtree. A match drops to `info`. A miss reports `unused-expect`. A window is `expect="text-overlap@800-846: 叠印"` or `@26.7s-28.2s`. Outside it the issue stays. A window this check misses does not report `unused-expect`.
- On the root, `min-font` is `screen` (default, `min(width, height) / 1080 × 24`), `print` (× 12), a pixel number, or `none`.
- Repeatable randomness is `random` or `noise`. `Math.random()` and `Date.now()` in `.tsx` report `nondeterministic`.

## Hard rules

| Rule | Write it this way | Issue |
| --- | --- | --- |
| HTML uses `style`. `layer` and shapes use attributes | `<p style="font-size:40px">`, `<circle fill="#fff">` | `invalid-attr` |
| Tags are lowercase | `<circle>`, `<div style="display:flex">`. Uppercase or `fvg` does not render | `unknown-tag` |
| A nested layer has no `background` | Color blocks use `<rect fill>`, an HTML `background`, or `<canvas>`. Only the root `background` is the canvas color | `invalid-attr` |
| Layout | `<div style="display:flex; flex-direction:column">` | `unknown-tag` |
| Lines | `<layer><line x1 y1 x2 y2 /></layer>` | `invalid-child` |
| Text position | `<layer x="120" y="64"><h1>…</h1></layer>` | `invalid-attr` |
| Position | `layer`, `use`, and `rect` use `x` `y`. Circles, ellipses, and spheres use `cx` `cy` | `invalid-attr` |
| Gradients | Glyphs use `style="fill:linear-gradient(...)"`. `color` is a solid color only | `invalid-attr` |
| Stroke | Write only `stroke`. Shapes may add `stroke-width`. A stroke along the ink is `stroke="6 #000 outside"`. A filled `path` writes `stroke="none"` | `invalid-attr` |
| An effect on a whole subtree | `<layer grade="lomo" overlay="#00000066">` | `invalid-attr` |
| Solids | A positive `depth` extrudes a shape along z. `rect` is a box (`rx` rounds the edges). `circle` is a cylinder. `path` keeps holes by `fill-rule`. There are also `sphere`, `torus`, `tube`, and `model`. `model` writes `x` `y` `width` `height`, or `unit` with `x` `y` | `flatten-3d` |
| Ground | `<ground y="520" rotateX="70" />` receives shadows. `shadows="none"` turns them off. With no `fill`, only the shadow is drawn | `invalid-attr` |
| Structured data | `data={{ values: [1, 2] }}`. In `.layer`, `data='{"values":[1,2]}'` | `invalid-attr` |
| An issue you expect | `expect="overflow-canvas: full bleed"`. On the root it covers the whole subtree. A window is `text-overlap@800-846` or `@26.7s-28.2s`. If it never appears, the report is `unused-expect` | `unused-expect` |
| Minimum type size | On the root, `min-font="print"` or `min-font="16"`. When omitted, screen mode is `min(width, height) / 1080 × 24`. Several too-small spots collapse into one issue | `min-font-size` |

## Common issues

Fix from the report's `path` and `hint`. An error exits with code 1. A warn still renders. This table is the frequent cases. The full list is SPEC, "Report".

| Code | Cause | Change |
| --- | --- | --- |
| `invalid-attr` | The attribute is on the wrong tag, or the value is bad | Move `x` and `y` onto `<layer>`. Put graphic paint on a shape. A nested `background` becomes `<rect fill>` |
| `invalid-child` | The child is not allowed there | `<p><div>` becomes `<div><p>`. A line sits in `<layer>`, not in a text box |
| `unknown-tag` | The tag is unknown, or a known tag is uppercase | `<Circle>` becomes `<circle>`. Uppercase of a known tag is an error |
| `flatten-3d` | A solid or a 3D pose never entered a camera | Write `camera` on the layer that frames the shot, for example `camera="900"` |
| `overflow-canvas` | Ink is outside the canvas | Move or shrink it. When the bleed is intentional, add `expect="overflow-canvas"` |
| `min-font-size` | The on-screen size is under the root minimum | Raise `font-size`, or set root `min-font` to a number, `print`, or `none` |
| `stroke-fill` | An `inside` or `center` stroke reaches about 8% of the font size | Narrow it, or use `outside` |
| `implicit-stroke` | A filled `path`, `polygon`, or `curve` omitted `stroke` | Write `stroke="none"` for a fill-only shape, or set `stroke` to draw an outline. The text color is not used |

## Materials

Flex Layer lays out and renders. It does not draw or cut out a photo, a real object, or a material. Get those from the asset service. The interface is [https://nc.fangyitech.com/flex/v1/docs](https://nc.fangyitech.com/flex/v1/docs).

In the DeepSeek container, run the command. Do not assemble a URL. This repository only lays out and renders. Running `asset`, `cutout`, or `select` here prints the document URL and exits.

```bash
flexlayer asset "画面里要什么、用在哪" --use subject
flexlayer cutout 本地图片.jpg
```

Optional on `asset`: `--aspect 16:9`, `--cutout auto|product|portrait`, `--plan`. Optional on `cutout`: `--preset product|portrait|auto`.

The command waits and prints a JSON report. Pictures are `url`s. When `status` is `done`, read `items[0].example`, then the file URLs. `example.code` and `snippet` are the same fragment. Copy `snippet` into the picture. Keep `credit.text` when it is set. Fix anything in `warnings`. `files.background` is the original. `files.foreground` and `files.subject` are the same transparent foreground. `files.sticker` is that foreground cropped to the subject.

When the report is not done, it has `id`:

```bash
flexlayer asset status <id>
flexlayer asset confirm <id>
flexlayer asset revise <id> "哪里不对"
```

Text, icons, charts, and layout stay here.

## Workflow

1. When the picture needs a photo, a real object, or a material, take it from the asset service and copy `items[0].snippet`. Then write `.tsx` or `.layer` against the rules above.
2. `npx tsx src/cli.ts check scene.tsx`. An **error** exits with code 1. Fix it from the report's `path` and `hint`, then check again. Type checking happens only in `check`. An animation without `--frames` samples about every 0.5s, at most 96 frames, and prints the coverage. `--frames ends` samples the first, middle, and last frame. `--frames 600-660 --step 20` checks that span. Several files can be named in one command.
3. When spacing is wrong, `npx tsx src/cli.ts render scene.tsx -o scene.png --debug --report scene.json`. Read `box` (the layout box) and `ink` (the mark after transform or projection). `.tsx` also has `source` (`scene.tsx:18:5`).
4. When it looks right, `npx tsx src/cli.ts render scene.tsx -o scene.png`. `render` does not type-check. Several pictures and scales are written in one command: `npx tsx src/cli.ts render a.tsx b.tsx -o out/ --scale 1 --scale 2`.

## Where to read

| You are writing | Read |
| --- | --- |
| How to wrap and place a `layer` | SPEC, "layer" |
| Which HTML, SVG, paints, and effects exist | SPEC, "HTML and SVG" |
| Solids, cameras, ground | SPEC, "Solids and cameras" |
| A photo, object, or material | [https://nc.fangyitech.com/flex/v1/docs](https://nc.fangyitech.com/flex/v1/docs), then SPEC, "Images" |
| Masks, `glyph`, `layer.create`, animation | SPEC, "Masks and programs" |
| Issue codes and report fields | SPEC, "Report" |
| How one attribute is written | [docs/attrs.json](docs/attrs.json), look up the name |
| A Chinese face | 黑体, 宋体, 楷体, 仿宋, and 圆体 are Chill faces in the catalog: 寒蝉端黑体, 寒蝉端黑宋, 寒蝉楷体, 寒蝉活仿宋, 寒蝉全圆体. They download on first use and are not packaged. The wider list is in [docs/RESOURCES.md](docs/RESOURCES.md), in the order 最推荐, 推荐, 其他, 英文, 等宽. 等宽 is JetBrains Mono and Space Mono. Other names need their own font file |

HTML and `display:flex` render as CSS. Defaults are not copied here.

## Repository

- Use font names from [docs/RESOURCES.md](docs/RESOURCES.md). Do not invent font-file URLs. A photo, a real object, or a material comes from the asset service, not from a URL you make up.
- Implementation notes are in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md). Picking and author lights are not built yet. See [docs/proposals/3D.md](docs/proposals/3D.md). three.js geometry goes through `<model object>`.
- Automation: `npm test`, `npm run gallery`.
- When merging to `main`, bump the patch version in the root `package.json` and `package-lock.json`. If a still-working old syntax is removed, bump the minor version.
