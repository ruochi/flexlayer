# Flex Layer

Authoring and rendering are separate. The handoff is `.layer` text. In `.tsx`, `canvas.create` measures first and then places. Running it produces the same tree. `--emit` writes that tree back to `.layer`. Check writes only a report. Render writes a PNG. Vue and React are not part of this.

Tag, attribute, and issue-code prose lives only in [SPEC.md](SPEC.md). One page of syntax is [docs/CHEATSHEET.md](docs/CHEATSHEET.md). Fonts and palettes are in [docs/RESOURCES.md](docs/RESOURCES.md). Sample pictures are in [docs/GALLERY.md](docs/GALLERY.md).

## Workflow

1. Write `.tsx` or `.layer` against the rules below.
2. `npx tsx src/cli.ts check scene.tsx`. An **error** exits with code 1. Fix it from the report's `path` and `hint`, then check again. An animation without `--frames` samples frame 0, the middle frame, and the last frame.
3. When spacing is wrong, `npx tsx src/cli.ts render scene.tsx -o scene.png --debug --report scene.json`. Read `box` (the layout box) and `ink` (the mark after transform or projection). `.tsx` also has `source` (`scene.tsx:18:5`).
4. When it looks right, `npx tsx src/cli.ts render scene.tsx -o scene.png`.

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
| Stroke | Write only `stroke`. Shapes may add `stroke-width`. A stroke along the ink is `stroke="6 #000 outside"` | `invalid-attr` |
| An effect on a whole subtree | `<layer grade="lomo" overlay="#00000066">` | `invalid-attr` |
| Solids | A positive `depth` extrudes a shape along z. `rect` is a box (`rx` rounds the edges). `circle` is a cylinder. `path` keeps holes by `fill-rule`. There are also `sphere`, `torus`, `tube`, and `model` | `flatten-3d` |
| Ground | `<ground y="520" rotateX="70" />` receives shadows. `shadows="none"` turns them off. With no `fill`, only the shadow is drawn | `invalid-attr` |
| Structured data | `data={{ values: [1, 2] }}`. In `.layer`, `data='{"values":[1,2]}'` | `invalid-attr` |
| An issue you expect | `expect="overflow-canvas: full bleed"`. On the root it covers the whole subtree. If it never appears, the report is `unused-expect` | `unused-expect` |
| Minimum type size | On the root, `min-font="print"` or `min-font="16"`. When omitted, screen mode is `min(width, height) / 1080 × 24`. Several too-small spots collapse into one issue | `min-font-size` |

## Where to read

| You are writing | Read |
| --- | --- |
| How to wrap and place a `layer` | SPEC, "layer" |
| Which HTML, SVG, paints, and effects exist | SPEC, "HTML and SVG" |
| Solids, cameras, ground | SPEC, "Solids and cameras" |
| Masks, cutouts, `glyph`, `canvas.create`, animation | SPEC, "Masks and programs" |
| Issue codes and report fields | SPEC, "Report" |
| How one attribute is written | [docs/attrs.json](docs/attrs.json), look up the name |
| A font for a mood | Recommended fonts in [docs/RESOURCES.md](docs/RESOURCES.md). ChillDuanSans (寒蝉端黑体) is the default. Other names need their own font file |

HTML and `display:flex` render as CSS. Defaults are not copied here.

## Repository

- Use font names from [docs/RESOURCES.md](docs/RESOURCES.md). Do not invent font-file URLs.
- Implementation notes are in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md). Picking and author lights are not built yet. See [docs/proposals/3D.md](docs/proposals/3D.md). three.js geometry goes through `<model object>`.
- Automation: `npm test`, `npm run gallery`.
- When merging to `main`, bump the patch version in the root `package.json` and `package-lock.json`. If a still-working old syntax is removed, bump the minor version.
