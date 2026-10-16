# Changelog

## 0.10.0

A bitmap goes through `cutout` before it is placed. `derive`, `analyzeImage`, `cutout --full`, and `apply` are removed. `cutout` still writes `photo.subject.png` and `photo.cutout.json`, and prints the three-layer stack: photo, text, subject.

## 0.9.1

Common Chinese categories use Chill faces. 黑体 is 寒蝉端黑体, and it is still the default when `font-family` is omitted. 宋体 and `Song` are 寒蝉端黑宋. 楷体 and `Kai` are 寒蝉楷体. 仿宋 is 寒蝉活仿宋. 圆体 is 寒蝉全圆体. The first use downloads the file to `~/.cache/flexlayer/fonts`. The files are not in the package. 思源宋体, 思源黑体, and 霞鹜文楷 are no longer catalog faces. The recommendation list is unchanged aside from dropping 霞鹜文楷. Names that are not in the catalog still need `<font family src>`.

A new recommendation group, 英文 (`use` 艺术标题), lists nine artistic Latin title faces: Playfair, Fraunces, Instrument, Cormorant, AbrilFatface, Cinzel, Syne, Monoton, and GreatVibes. AbrilFatface, Cinzel, Syne, Monoton, and GreatVibes are new catalog faces. All nine download on first use.

## 0.9.0

Removed `flexlayer-select mask`, the depth model, and `--point`, `--omit`, `--refine`. `foregroundMask`, `splitLayers`, and `estimateDepth` are gone. `cutout` and `cutout --full` stay. `apply` still needs a `--full` run.

## 0.8.0

`flexlayer-select cutout` writes only `photo.subject.png` and `photo.cutout.json` by default. `--full` writes `photo.mask.png`, `photo.regions.png`, `photo.questions.json`, `photo.cutout.layer`, and the `product` shadow as before. `apply`, `derive="mask"`, and `derive="regions"` need a `--full` run. `cutout` now prints a three-layer snippet, photo, text, `subject.png`, so text can sit behind a subject without `<mask>`.

The model session logs only errors, so the onnxruntime constant-folding warnings are gone. A failed model download says to set `NODE_USE_ENV_PROXY=1` instead of only `fetch failed`.

## 0.7.1

`rotate`, `rotateX`, and `rotateY` on a shape, a line, or a `layer` take the same angle as in `style`. `rotate="30deg"`, `0.5rad`, `100grad`, and `0.25turn` rotate. `rotate="30"` is still degrees and does not report `non-canonical`. An invalid value such as `30px` reports `invalid-attr` and is ignored.

## 0.7.0

Reports are shorter. `box`, `ink`, `effect`, and `mask.ink` write only `x`, `y`, `width`, and `height`. They no longer include `left`, `top`, `right`, `bottom`, `centerX`, or `centerY`. Issues drop `frame` and keep `frames`. `canvas.create` still returns `left` through `height`, and also returns `x` and `y`.

Motion that an animation is expected to produce is lowered to `info`, and the reason is written on the issue. `overflow-canvas`, `outside-safe`, and `effect-clipped` while an element slides in or out are `入场` or `出场`. `text-overlap` of two runs during a crossfade is `交叉淡化`. Text that has already left the canvas does not also report `outside-safe`. The `ink-inset` threshold is 3px and 5% of the font size. An issue that already has `expected` prints the reason on the command line and does not repeat the fix.

## 0.6.22

Chinese font recommendations are three tiers: 最推荐, 推荐, and 其他. `resources.recommendedFonts` no longer groups faces by mood. ChillDuanSans (寒蝉端黑体) is still the default. Kai (霞鹜文楷) is the other name already in the catalog. Every other name is only for choosing a face. You supply `<font family src>` yourself.

## 0.6.21

A gradient color stop the canvas cannot parse makes the whole gradient invalid. The report is `invalid-attr`, and the paint falls back to that attribute's default solid. The stop is not dropped, and rendering still writes the picture.

## 0.6.20

CSS `box-shadow` and `backdrop-filter` paint. `box-shadow` follows the ink shadow. `inset` is an inner shadow, and several layers paint with the first on top. `backdrop-filter` samples the backdrop. `blur()` is `backdrop-blur`. The other functions use the same canvas filter string as `filter`.

`filter` accepts the canvas functions `blur()`, `brightness()`, `contrast()`, `drop-shadow()`, `grayscale()`, `hue-rotate()`, `invert()`, `opacity()`, `saturate()`, and `sepia()`. Lengths are pixels and scale with the supersample. `url()` is not accepted. When `blur` is also set, that radius wins and `blur()` is removed. A missing `drop-shadow()` color uses the element color. `backdrop-filter` accepts the same functions.

## 0.6.19

`rotate`, `rotateX`, and `rotateY` in `style` take a CSS angle: `deg`, `rad`, `grad`, or `turn`. `0` may omit the unit. A bare nonzero number is still degrees, and reports `non-canonical`. An invalid angle reports `invalid-attr` and is ignored.

`transform` accepts `translate()`, `rotate()`, and `scale()`, including the axis-specific forms, and they combine left to right. With the individual properties, the order is `translate`, then `rotate`, then `scale`, then `transform`. The center is `transform-origin`, default `50% 50%`. These change drawing only. The layout box stays put. Attributes such as `rotate="30"` are unchanged.

`.layer` `<script>` no longer enables the permission model on Node versions without `--allow-addons` (Node 20.11 and earlier). On those versions the flag is rejected, or the native canvas library cannot load, and the canvas stays blank. Later Node versions also allow the `node_modules` directories and the canvas package files the loader stats, including `index.js`. If startup is still denied on one of those paths, that path is added and the subprocess is tried again. A script still cannot read arbitrary files such as `/etc/passwd`.

## 0.6.18

`radial-gradient()` accepts `circle` or `ellipse`, a size keyword, and `at` a position. `radial-gradient(circle, #fff, #000)` paints. A bad color stop no longer aborts the process, so the PNG and the report are still written.

`.layer` `<script>` grants every `package.json` from the host file up to the package root. Node 20 reads those paths while resolving the canvas module, including ones that are not there yet. Without the grant the subprocess exits with `Access to this API has been restricted` and the canvas stays empty.

three.js `Points` draw into the same depth buffer as meshes and lines. The disc diameter is `PointsMaterial.size` in screen pixels. The default is 1.

## 0.6.17

`AGENTS.md` now opens with what a frame is, then a lookup of the places Flex Layer differs from HTML, CSS, and SVG, then the frequent issue codes and the change that clears each one. The hard rules and the workflow are unchanged. The full issue list stays in SPEC, "Report".

## 0.6.16

`render` no longer type-checks on every run. Type checking stays in `check`. To check while rendering, add `--typecheck`. A type error is still `type-error`. The picture is still written, and the exit code is 1. `check --no-typecheck` skips type checking.

`render` and `check` can take several files. `render` can repeat `--scale`. The same source runs once, and every picture is drawn in that process. When there are several files or scales, `-o`, `--report`, and `--emit` are directories. File names include `@1x` and `@2x`.

## 0.6.15

The repository docs are in English. The README keeps one short note in Chinese and English. The attribute catalog, the ownership table in SPEC, and the effects line in the cheat sheet are generated in English from the registry.

Checker sentences in the engine, and the Chinese names you can pass as font aliases, are unchanged.

## 0.6.14

The main entry also exports `loadImage` and `registerFontPath`. Both use the same `@napi-rs/canvas` instance as `createCanvas`, the one layout uses. `registerFontPath(family, filePath)` registers a custom font file. A name that is already registered is not swapped for another file.

Line-break rules for punctuation look only at inline ownership. When `translate`, `rotate`, `scale`, or `opacity` differ, a comma does not drop to the start of the next line either. Joining into one text run still requires those four to match. An unregistered font name throws. A character with opacity below 0.01 does not join the ink. `rotate` is still a bare number of degrees, for example `12`.

## 0.6.13

The main entry exports `createCanvas`, `initFonts`, `applyCanvasFont`, and `DEFAULT_FONT_FAMILY`. This is the `@napi-rs/canvas` instance layout uses. `initFonts()` prepares the default font first, and can also take catalog font names. `applyCanvasFont` writes variable weight onto the `wght` axis.

`translate`, `rotate`, `scale`, and `opacity` on an inline tag change drawing only. Line width, line height, and wrapping still use the original advance. The layout box stays where it was. The transformed bounds join the ink box of the line and of the text box. `split="chars"` makes each character rotate around its own center. When a text box sets it, those four properties no longer turn the whole box.

## 0.6.12

The skill's distinctive features now include what happens in one depth buffer: a wireframe does not break on empty space, text layers by ink, depth of field blurs per object, a stroke follows the ink, and translucent glass does not hide edges behind it.

## 0.6.11

`<model object>` maps three.js material kinds onto the existing shading. Lambert and Toon use matte. Phong `shininess` becomes roughness. 100 is smooth. Transmission of at least 0.5 uses glass. Glass is still fake refraction. Anything else still splits into metal and plastic by metalness.

An in-memory `map` tints the base color by uv, then goes through the same shading. Vertex colors multiply the material color. `emissive` is added after shading and does not light neighboring objects. `ShaderMaterial` is not executed. One color from the uniforms is the base color.

## 0.6.10

The skill is now a project introduction, the repo and doc URLs, and the features that go beyond an HTML screenshot. Attributes, commands, and examples stay in SPEC. They are no longer written into the skill.

## 0.6.9

The `<script>` subprocess for `.layer` no longer puts an existing directory, `directory/*`, and `directory/**` into the read permission list together. Node collapses an existing directory to `directory/*`. Writing that same prefix again makes Node 20's permission tree insert an empty prefix on a leaf, assert `!path_prefix.empty()`, and the subprocess exits. The canvas is empty. When the directory does not exist yet, only one `directory/*` is added. `**` is not a recursive wildcard.

## 0.6.8

three.js `Line`, `LineSegments`, and `LineLoop` draw into the same depth buffer as `<model object>`. A material with `wireframe: true` draws only edges. It is no longer filled solid, and it is no longer skipped entirely. Lines use the material color. Line width is in screen pixels, and the default is 1. `Points` are still not drawn.

The `<script>` subprocess for `.layer` also allows files in the catalog directory, outside the canvas package directory. Giving only the directory, with no wildcard, makes some Node versions report `Access to this API has been restricted`, and the canvas is empty.

## 0.6.7

The docs are four blocks: `layer`, supported HTML and SVG, solids and cameras, and masks and programs. General CSS, SVG, and formula spacing are no longer spelled out in the prose. Issue codes, masks, `glyph`, and `canvas.create` stay in SPEC. No syntax was removed.

## 0.6.6

Formulas, grade, stroke along ink, glass, noise, and the command-line toolchain load when they are used. Paint and layout stay synchronous. The esbuild result of one `.tsx` is cached on the machine, and the cache key includes the current flexlayer install path.

## 0.6.5

`<model>` in tsx can write `object` and pass a three.js Object3D. The geometry enters Flex Layer's own scene and shares depth with text, line art, and labels. `unit` keeps the original coordinates. One model unit equals that many pixels. When `material` is omitted, the primitive's metalness and roughness map to `metal` / `plastic`.

`three` is an optional peer dependency. The adapter is `flexlayer/three`. The core does not import it. A bare package name resolves upward from the source file as ESM, the same path type-checking uses.

## 0.6.4

Extruded edges take a small round of 1/40 of the thickness. Boxes and paths use `depth`. Cylinders use the axial length. A concave contour such as a five-pointed star, and a glyph with holes, take the round too. A shape that wrote `rx` or stroked with `stroke` keeps its original edges.

## 0.6.3

`<script>` in `.layer` reads `@napi-rs/canvas` in a subprocess. A whole `node_modules` directory, or a pnpm virtual directory, is a symlink. `realpath` also has to read the link itself and its parent. Those were not on the allow list, so the report was `Access to this API has been restricted`, and the canvas was empty.

A horizontal flex child with no `height` stretches to the container height under `align-items:stretch`. An empty `flex:1` also fills the row. A set height, or an `align-items` other than `stretch`, still uses the content height.

## 0.6.2

A positive `depth` extrudes a shape along z. `rect` is a box. `circle` is a cylinder with its axis along z. `ellipse`, `polygon`, and `path` extrude along the contour. Holes use `fill-rule`, default `nonzero`. `sphere`, `torus`, `tube`, `model`, and `ground` stay separate tags. `box`, `cylinder`, and `extrude` still paint and report `non-canonical`.

An SVG element may write `transform="rotateX() rotateY() rotateZ() translateZ()"`. Two-dimensional `translate`, `rotate`, `scale`, and `matrix` are still written on `<g>`.

Shadows fall only on `ground`. `shadows="none"` turns them off. `cast-shadow="false"` means this solid does not cast. `receive-shadow` is only on `ground`.

## 0.6.1

`.ttc` and `.otc` can select a face with `#`. `src="SourceHanSans.ttc#2"` is face 2, counting from 0. `#2` used to be treated as part of the path, the error was `字体文件不存在`, and face 0 of the collection was used. For Source Han and Noto CJK, face 0 is Japanese, so the simplified character 复 came out wrong.

## 0.6.0

HTML tags render as HTML. `style` follows CSS. Alignment, flex, gap, wrapping, inheritance, font size, and the initial values of the box are no longer restated in the spec.

The initial font size is 16px. `h1` is 2em, `h2` is 1.5em, `h3` is 1.17em, and the weight is bold. `width` and `height` are the content box. Padding and border are added outside. `flex` uses the CSS shorthand. `flex:1` is `1 1 0`.

## 0.5.2

`<script>` in `.layer` runs in a subprocess. When `node_modules` is a symlink, the permission list used to contain only the real directory, while the loader read `package.json` through the link. The report was `Access to this API has been restricted`, and the canvas was empty. The link and the real path are both allowed now. A script error no longer prints a successful render first.

## 0.5.1

Recommended fonts are listed by mood in `resources.recommendedFonts`, heavy gothic first. ChillDuanSans (寒蝉端黑体) is still the default. The other names are only for choosing a face. You supply `<font family src>` yourself.

The automatic narrow round is capped at 4px. An edge that is already smooth does not get one. A crease beside it still does, so a cylinder's side does not, and the top and bottom rims do. A shape that wrote `rx` or stroked with `stroke` keeps its original edges.

## 0.5.0

`<draw>` and the `draw` callback are removed. Custom pixels are `<canvas>` and `<script>`.

`width` and `height` are the bitmap size and the default layout size. When omitted they are 300×150. Width and height in `style` change only layout. The script runs after layout and before paint. Paint order is document order. `devicePixelRatio` equals `--scale`. Every frame is a new canvas, and only one round of `requestAnimationFrame` is called. `performance.now()` and `Date.now()` are this frame's milliseconds. `Math.random` is seeded per frame.

Script text in `.layer` runs in a subprocess, with files and the network closed. A function closure in `.tsx` stays in this process. `--no-script` skips the script. DOM outside the subset reports `unsupported-dom`. `<draw>` reports `invalid-child`. A `draw` callback reports `invalid-attr`.

## 0.4.3

The layer that opened a camera can write `shadows="none"`. Planes and the ground no longer receive a hard shadow from the key light. Depth occlusion stays. A mesh, a plane, and `ground` can also write `cast-shadow="false"` and `receive-shadow="false"`. When omitted, behavior matches before: opaque surfaces cast on each other.

Root `min-font` can be `screen` (the default, `min(width, height) / 1080 × 24`), `print` (× 12), a pixel size, or `none`. Several too-small spots in one picture collapse into one `min-font-size`. A layer with a camera no longer reports `ink-inset`.

`package.json` sets `engines.node >=20`. The command line checks the version before loading the layout engine. Node 18 says to switch to 20 or newer, instead of throwing yoga-layout's `ERR_REQUIRE_ESM`.

`JetBrainsMono` is built in (aliases `jetbrains mono` and `等宽`). `render` and `check` can add `--watch`. When the source or a relative path it references changes, they run again.

The attribute catalog is `docs/attrs.json`, generated from the registry by `npm run docs:attrs`.

Flex and text defaults now match CSS. `align-items` and `align-content` default to `stretch`. `flex-shrink` defaults to `1`. `text-wrap` defaults to `wrap`. Line height defaults to `1.2`. The minimum size of an image or a shape is still the content size. It is not squeezed smaller than itself. Cross-axis centering is `align-items:center`.

## 0.4.2

`--refine` is BiRefNet 512 again. lite 512 emitted all-negative logits on a clock tower at night. The mask was empty, and the position was `null`. The depth session is still released before the matting model loads.

Layering keeps only positive points and negative points. It no longer collapses the span between two points into one segment. `--point` marks what to keep. `--omit` marks what to drop. Both can be repeated. After you look at the mask, add points and run it again. A positive point grows along the piece connected in depth. With no negative point, the near end stops above the ground, on the same line as a run with no points. When a negative point falls inside that piece, it and the positive point each grow outward, and the part closer to the negative point is removed. With no points, growth is still downward from tips that reach into the distance. `--omit` alone cuts the touched piece out of the mask.

The install note for `packages/select` is `npm install`. When `package-lock.json` and `package.json` disagree, `npm ci` errors.

## 0.4.1

`ground` is an infinite plane with no width or height. It receives the key light's shadow. `rotate`, `rotateX`, `rotateY`, and `box` match the other elements. With no `fill`, the ground is transparent.

## 0.4.0

`perspective` is removed. The camera is only `camera`. When projection is needed and `camera` was not written, the outermost layer that has a mesh, a `ground`, or `rotateX`, `rotateY`, or `z` uses its own `height` as the viewing distance. Layers inside that did not write `camera` do not open another camera.

## 0.3.0

Old syntax that still worked is removed. These now error, or are no longer exported:

- Tags must be the lowercase forms in the spec. `<Layer>` and `<Circle>` are no longer normalized and painted. Uppercase on the root is rejected outright. A child reports `unknown-tag` (error), and the hint gives the lowercase form. The old root tag `fvg` is not accepted either.
- `renderFvg` and `checkFvg` are no longer exported. `parseFvg` is renamed `parseLayer`. Types such as `FvgNode` and `FvgReport` are `LayerNode` and `LayerReport`.
- The old package name is no longer redirected to `flexlayer`.
- `glass` accepts only a preset name, or a comma form such as `clear, blur 8, tint #fff2`. `regular 8 #ffffff22`, and a bare pixel count, are no longer accepted.

`cx` / `cy` on `layer`, and `ink-stroke`, still point at the right form.

## 0.2.58

Implementation commit: `bbbad19239c9ec2956bb48ff758ca58a729af60c`

A foreground mask uses `--point x,y` to mark what to keep. Several points are allowed. Near and far are the nearest and farthest of those points. What is connected and falls in that depth range is kept. With no points, growth is still downward from tips that reach into the distance. `--front` is removed.

`--refine` uses BiRefNet lite, about 100MB. The depth session is released before the matting model loads, so it does not stack with the full model's intermediates of about 3GB.

A plane much larger than the canvas pastes the clipped polygon with one homography. The texture and the rounded stroke at the seam no longer fold open.

Roughness 0 is a sharp environment with no noise. 1 is the blurriest layer, and the noise amplitude is largest. Noise is additive. The amplitude is 10 steps of roughness squared. Metal darkens less as roughness rises. Glass pulls a step toward middle gray.

Relative paths for images and fonts skip only the entry the bundler wrote inside the system temp directory. When the script directory name starts with flexlayer-, paths resolve against that directory.

The default font is read from `DEFAULT_FONT_FAMILY`. A layer with `blur`, `grade`, or `<mask>`, after the view is enlarged, rasters only the part that lands in the picture, and keeps the margin that blur and feather need to sample. A text edge cut by the viewport or by `overflow="hidden"` no longer reports `outside-safe`. Text that is still outside the safe area after the clip is still reported.

`analyzeImage` now returns synchronously, like `glyph`.

`canvas.create` brings back a mesh's projected `points`, `edges`, and contour `d` under numeric perspective. A sphere gives only the circle. The narrow round added at render time is not part of those three.

A mesh of at most 200 faces takes a narrow round of at most 8px inward on creases at render time. A shape that wrote `rx`, stroked an edge, or was already round keeps its original edges.

Material Symbols glyphs sit above the baseline. Icon ink is centered in the line box. Icons no longer sit at a different offset each.

A `draw` callback's `ctx` can `drawImage`. A frame that is already laid out can be taken as unpremultiplied pixels plus canvas width and height with `renderLayer(node, { format: 'rgba' })`.

Per-platform plugin manifests are gone. Only `skills/flexlayer/SKILL.md` remains. `AGENTS.md` is the entry. The details stay in SPEC. `docs/PLAN.md`, which had already landed, is deleted. Implementation notes for effects and formulas are merged into `docs/IMPLEMENTATION.md`. The mesh benchmark moved to `scripts/bench-mesh.mjs`. The Pythagorean demo video and the large pictures are no longer in the repo.

## 0.2.57

Implementation commit: `ec49b328201f03385ff6b4d26323d05fb07f1309`

`flexlayer-select mask` takes a foreground mask, writes `photo.foreground.png`, and returns that foreground's `x`, `y`, `width`, and `height`. `--front` is from 0 to 1, default 0.5. Larger makes the mask larger. Smaller keeps only a stretch closer to the camera. `--refine` cleans the edge with the matting model.

## 0.2.56

Implementation commit: `f902e0acd8496b583d98be6b2aed1273994d21df`

A mesh with `material="glass"` is fake glass. The reflection leaves the key light's square window on the form, and a grazing edge adds a rim light. Refraction comes out the back, sweeps the same environment lightly by how far it is from the center, and fills where the window and the rim light have not lit yet.

## 0.2.55

Implementation commit: `8c4fbc361ac37e5fd594e1f9230c7d64435f8812`

A plane much larger than the canvas is clipped to the visible piece of the view frustum before it is rasterized. Resolution follows screen density. A solid-color ground no longer allocates a bitmap of the whole layout size. A small plane that falls entirely inside the picture still uses the old projection.

## 0.2.54

Implementation commit: `d3cf69c60c70da2dea7e0dc9ed30eff3a75010e1`

When the framing layer's `camera` writes `aperture`, depth of field follows each pixel's depth. The radius is `aperture × |depth − focus| / depth`. A near blurred edge covers what is far. A surface with `sharp="true"` stays sharp.

## 0.2.53

Implementation commit: `f9c392d55d7509a73dfffb1e351fe0d19a9dcb81`

When an ordinary text box sets both `background` and `stroke`, the stroke goes around the plate. Sticking out of the canvas reports `effect-clipped`. When `preserve-3d` passes through a flex container that has no pose, a rotated card that did not write `preserve-3d` is still one picture, and the text inside projects with the color block.

## 0.2.52

Implementation commit: `780c328b65e051a52707d806f65888ccb3678a42`

Metal and plastic use matte shading as the base, then the same studio environment. The highlight that used to shrink to a point is gone. The key light is a large rounded square at the upper left, 30° in from straight left toward the center. The dark side has a narrow rim light. The two do not meet at the top. Roughness Gaussian-blurs the environment first. Noise is written into that image and then sampled. Higher roughness is blurrier, and the noise is denser.

## 0.2.51

Implementation commit: `36e36c95e72b76d220920d3a559f9259080d30c6`

On a plane inside a parent's `rotateX`, a fully transparent pixel in the texture no longer hides edges behind it. After `scale` or `view` enlarges, a mesh stroke on the edge draws to the edge. It no longer closes into a round cap inside the window. A box with a background strokes the background's outer frame. `stroke` and `shadow` in a 3D scene follow the picture already painted.

## 0.2.50

Implementation commit: `bb230b0bf0a5ea2e73c155c831c9cec1b6e36a7e`

The framing layer can write `camera`. `preserve-3d` sends children along the parent chain into the same camera.

## 0.2.49

Implementation commit: `2a31f7c400057282fd518266a6ae912f1397c528`

A rotated distance stroke is sampled at 4× in screen pixels and then averaged. A slanted edge no longer turns into stairs with nearest-neighbor, and the outer stroke sits in the fill's antialiased edge. Mesh polylines are drawn on the supersampled buffer and averaged back with the fill.

## 0.2.48

Implementation commit: `4627e8654dc32743dac694af66655ca7e5bd55e0`

The fixed studio environment for metal and glass changes from a horizontal light bar to a vertical soft panel. Azimuth and elevation avoid integer multiples of 90°. The panel is also tilted a little off straight vertical. White, black, and the gray transition all remain. A cylinder shows slanted bright and dark bands.

## 0.2.47

Implementation commit: `f81a78ddb8e7a4d1c3d5fd07bea768c86805e4d0`

When this merged to `main`, 0.2.46 was already the release that moved paint to `fill` and merged stroke into `stroke`, so this mesh speedup is recorded as 0.2.47.

Mesh rendering rasters the screen area the object actually occupies, and caches a scene that is completely still.

- The raster buffer covers only the intersection of the projected vertices (and plane quads) with the visible region. The visible region is the document canvas mapped into that layer, intersected with the clip box when there is a clip. The returned picture carries an `x` / `y` offset.
- The sample count is fixed at `meshSamples` (`1` | `2` | `4`, default `4`). It no longer drops because the viewport contains area outside the picture. Scenes that used to fall to 2×2 stay at 4×4, so quality only improves. Reports such as `overflow-canvas` still use the full projected bounds. The shadow map stays in light space.
- The process-level scene cache keys on a content hash, not an object reference. Floats quantize to `1e-4`. Content that cannot be hashed stably, such as `draw`, glass, `grade`, and filters that read the background, is not cached. A hit matches pixels byte for byte. The default cap is 256MB. The render option `meshCache`, or the environment variable `FLEXLAYER_MESH_CACHE` (a byte count, or `0` / `off` / `false`), can change it or turn it off.
- Extrusion, rounding, and `model` geometry are cached separately by parameters. An object that is turning, with the same shape, does not have to be rebuilt.
- Color, depth, owner, and shadow-depth buffers are reused per process. Only this frame's rectangle is filled.
- `meshSamples` is wired to `renderLayer`, `renderFrames`, `renderToCanvas`, and the command-line `--mesh-samples`.

Benchmark (`node bench-mesh.mjs`, 1920×1080, one process, default 4× sampling): a still ground plus extruded type is about 19 ms/frame, still type alone is about 23 ms/frame, and type that is turning is about 280 ms/frame.
