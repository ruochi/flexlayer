# Implementation notes

Syntax and rules follow [SPEC.md](../SPEC.md). This file only records where effects and formulas are implemented, and why they are written this way.

## Load on demand

Paint and layout functions stay synchronous. A module is loaded before those functions run. After the first load, later calls in the same process use it directly.

| Module | When it loads | Entry |
| --- | --- | --- |
| Formulas `math/layout.ts`, OpenType, STIX | The tree has a formula tag, or the source wrote a formula | `author-features.ts`, inside `prepareAssets`. If `layoutSync` / `layer.create` has not loaded it yet, they confirm synchronously |
| Grade `grade.ts` | The tree has `grade` or `grade-mask` | Same as above. Registration still goes into the filter table in `filter.ts` |
| Distance field, stroke along ink, glass, noise | The layout result actually has that effect | `ensurePaintFeatures` at the start of `paintDocument` |
| Icon code points | The first time an icon name is turned into a code point | `icons.ts` reads `icon-codepoints.txt`. With no icon font it does not read the file and does not download a font |
| esbuild, syntax scan | The source is `.tsx` / `.ts` / `.jsx` / `.js` | `load-source.ts`. The syntax scan uses the TypeScript parser. `.layer` does not take this path |
| Type check | `check`, or `render --typecheck` | Loaded later from `cli-main.ts` as `typecheck.ts`. A plain `render` does not run it. Several files are checked in the same process |
| `frame.ts` | The source is a Composition, and several frames or a contact sheet are rendered | Same as above |
| esbuild cache | The same source runs again | `~/.cache/flexlayer/code/<content hash>/entry.mjs`. The entry, relative imports, and the current flexlayer install path are hashed together. A change rebuilds |

`rules.ts` uses only the tag table in `math/rules.ts`. It does not pull in formula layout.

## Effects

Ownership: layer, shapes, and lines use attributes. Text and flex HTML use `style`. `overlay`, `grade`, and `grade-mask` are allowed only on `layer`. `<mask>` is a tag, not an attribute. Paint order is in SPEC, "Effects".

### Ink

Every effect follows ink alpha, not the layout `box`:

| Element | What the ink is |
| --- | --- |
| Text | The glyphs (plus the background block when there is a `background`) |
| Shape / line | Fill and stroke geometry |
| layer | `shadow` / `glow` follow the subtree ink. When this layer is a 3D scene they follow the picture already painted. Other effects count only this layer's own `border` (there is no `background`) |
| flex | `shadow` / `glow` follow the subtree ink (including this node's own `background` / `border`). Other effects count only this node's own background and border |
| `blur` / `filter` / `blend` | Pixels already painted for that node (including the composited subtree) |

A text `shadow` is therefore a glyph shadow. It does not become a rectangular fog. `spread` on text and images (including `inner-shadow` / `inner-glow`) dilates or erodes that alpha by distance: a positive value grows outward, a negative value eats inward by the inner distance. Shapes and box backgrounds still grow by geometry.

### `stroke`

One name, two geometries. A shape or line given a paint uses SVG: the stroke is centered, and the width is `stroke-width`. When the first word is a positive width, the distance field is used: `<width> <color or gradient> [outside | inside | center]`, several layers separated by commas, inner to outer. Width is the total distance from the ink, so `6 #fff, 14 #f00` is white from 0–6 and red from 6–14. The default is `outside`. Text, images, `layer`, and flex have no centered stroke. A paint alone is an outer distance stroke. When `stroke-width` is omitted the width is 4. Gradient coordinates use the element box, the same as `fill`.

The default for text is outside, because a centered `-webkit-text-stroke` eats thin Chinese strokes and spikes the corners. `outline` strokes the box and is left unused.

The distance field is computed only in the ink bounds plus the maximum outer stroke width (Felzenszwalb 2D EDT, shared with `glass` and text `spread`). `outside` takes `0 < d ≤ w` outside the ink. `inside` takes the inside. `center` takes `w / 2` on each side. The outer edge is about a 1px smoothstep at `d = w`. Corners are round. There is no miter. When the fill does not cover the ink, the inner edge follows the ink coverage instead of the half-coverage threshold, so a transparent glyph does not show a stair-stepped hole. When the current transform has rotation or shear, or the ink is uncovered, the distance field is computed in screen pixels at 4×, averaged back, then pasted 1:1, so a positive coverage mask is not nearest-neighbor rotated into place. A scale that is not 1 is rasterized in screen pixels too, so a 2× export is not a nearest-neighbor enlargement of a 1× mask. Mesh polylines are drawn on the supersampled buffer and averaged back with the fill. Slanted edges use the same antialiasing.

On a layer, flex, or `<g>`, the subtree ink is composited first and then the distance is taken. Overlapping characters get one outer contour. Background and border count in that contour. When a text box or an image has a plate, the stroke goes around the plate. When this layer is a 3D scene, stroke, shadow, and glow follow the picture already painted. The contour of `shadow` / `glow` is the body union the outer stroke, then `spread` is applied. `overlay` tints only the body: the mask is the subtree ink, and an inner stroke is cut out of that mask, so a gradient glyph on a layer plus a solid stroke is not covered by the gradient.

When a mesh polyline is cut by the visible range, the raster keeps an extra line-width on the clipped side. A round cap that lands outside the window is cropped flush by the window. Fully transparent pixels in a flat bitmap do not write depth. After a parent rotates, empty space does not eat edges on the far side of the box.

An inner width of `inside` / `center` that is at least about 8% of the font size reports `stroke-fill`. `-webkit-text-stroke` in a text style, or `outline` on HTML, reports `non-canonical`, and the hint points at `stroke`. `ink-stroke` reports `invalid-attr`.

### The `glass` lens

The shared practice of iOS 26 Liquid Glass and community recreations: glass is a thick slab, flat in the center and raised at the edge. Light bends only on the edge arc. The background seen through the center is not distorted. The look comes from the edge lens, not from blur.

Implementation (`paintGlass` in `src/paint.ts`):

1. **Distance field.** An exact Euclidean distance transform (Felzenszwalb EDT) of the ink alpha gives each pixel a distance `d` to the ink edge. A light box blur, then the gradient, is the inward normal. Any ink works. It does not depend on a shape formula.
2. **Bezel band.** `bezel = min(short side × 24%, 64px, inscribed radius)`. Pixels with `d ≥ bezel` copy the background unchanged. Inside the band, displacement is looked up with `t = d / bezel`.
3. **Displacement curve.** `shift = S·(1-t)²`, `S = bezel × 0.5 × refraction`. Displacement and slope both go to zero at the inner edge, so it meets the flat region with no seam. `S ≤ bezel/2` keeps `d + shift` monotonic. The background is magnified continuously at the edge and does not fold or stretch into a line. Snell's law on a squircle surface sends the edge slope toward infinity, and the band almost samples one isoline, so this smooth curve is used instead.
4. **Sampling.** Offset inward along the normal, then bilinear sample. When `dispersion` > 0, R/G/B use slightly different shifts, and a fine fringe appears at the edge.
5. **Highlight.** The side whose outward normal faces the upper-left light is brightest. The opposite side has a weaker return. It is a 1px bright line at the edge plus a soft light inside the arc.
6. **Blur.** The background is blurred before refraction only when `blur > 0`. The `clear` preset is 0.
7. **Shadow.** Sample the background first, then paint the shadow, then paste the glass. The shadow does not show through the glass.

| Preset | blur | refraction | bezel | dispersion | Default tint |
| --- | --- | --- | --- | --- | --- |
| `clear` | 0 | 1 | 0.24 | 0.06 | none |
| `regular` | 6 | 0.85 | 0.22 | 0.04 | `#ffffff14` |
| `thick` | 36 | 0.5 | 0.2 | 0 | `#ffffff2a` |

Not possible: a highlight that follows the device pose in real time, several panes of glass refracting each other, and system-level adaptive light and dark.

### `grade`

The caller gets three things: six parameters (`shadows`, `highlights`, `contrast`, `fade`, `saturate`, `vignette`, plus optional `midtones` and `warmth`), a preset name, and a mask. A preset is only a fixed set of parameter values (`GRADE_PRESETS` in `src/grade.ts`). There is no separate algorithm. The report echoes the expanded values.

`grade` is a pixel filter registered on `src/filter.ts` (`includeBackdrop`, mask attribute `grade-mask`). `apply` calls `applyGrade` in `src/grade.ts` and edits pixels in place on an offscreen buffer:

1. Convert the pixel to OKLab.
2. `contrast`: scale L around the pivot L=0.5. `fade`: `L = f + L·(1-f)`, `f = fade × 0.3`.
3. `saturate`: multiply a and b. This comes before tinting, so black and white can still be warmed or cooled.
4. `warmth`: shift a and b along (0.02, 0.06).
5. Three-band tint: weights `(1-L)²`, `2L(1-L)`, and `L²`, each adding an a/b offset. The offset direction is the color's hue. The size is `0.1 × amount × vividness`, and vividness is `min(1, C / L / 0.25)`. A dark color and a light color written at the same hue shift by about the same amount. L does not change. The color only sets hue and strength.
6. `vignette`: elliptic distance to the box center (1 at the corner), `smoothstep(0.35, 1)` × amount, mixed toward the vignette color.
7. Blend with the original by `overall amount × mask alpha`. Where the mask is transparent, the pixel is kept as it was.

The mask is painted with `paintOf` to an offscreen buffer of the same size, then alpha is read, so a solid color, a CSS gradient, and `gradient()` all work. Coordinates use the layer box. The root layer does not go offscreen: the whole canvas is graded after it is painted, including the canvas color. The preset name is not `fade`, so it does not collide with the parameter `fade 0.2`. The matte preset is called `matte`. Selection by color, and light leaks that are not symmetric in position, are not done inside `grade`.

### Tradeoffs

- `backdrop-blur` / `backdrop-filter` / `glass` sample the main canvas and clip back by ink alpha when pasted.
- `backdrop-filter` reuses the canvas filter string from `filter`. `blur()` is stored as `backdrop-blur`. Each other function calls the registered `filter` `canvasFilter`, with lengths scaled by the backdrop transform.
- `box-shadow` is parsed into `shadow` and `inner-shadow` (`inset`). It is not a canvas `drop-shadow()`, so spread and inset stay on the ink shadow path.
- When `glass` and `backdrop-blur` or `backdrop-filter` are both set, `glass` wins (`info`).
- `filter` accepts the canvas CSS functions, including `blur()`, `drop-shadow()`, and `opacity()`. `url()` is rejected. Pixel lengths scale with the supersample. `pad()` is `blur × 2` plus each drop-shadow's `blur × 2 + |x| + |y|`.
- `shadow` and `filter: drop-shadow()` both paint. `opacity` and `filter: opacity()` both apply.
- When `blur` and a `blur()` inside `filter` are both set, the attribute wins, that `blur()` is removed, and an `info` is reported. A missing drop-shadow color uses the element color.
- Do not register: `outer-glow`, `drop-shadow`, `backdrop-filter`, `texture`, `outline`.

### Open interface

A new filter uses `registerFilter` (`src/filter.ts`). The built-in `grade` (pixels) and `filter` (canvas CSS) sit on that same interface. Paint no longer special-cases them.

Shadow, glow, glass, backdrop blur, noise, and overlay do not go through here. They need the ink contour or the pixels behind, not a change after the layer is finished.

A `pixel` filter's `apply` receives unpremultiplied RGBA, edits pixels at full strength, and uses `frame` to know where the box sits in the buffer. When there is a mask, the engine blends with the mask alpha and the pixels from before `apply`. With `includeBackdrop: true`, a filter on the root layer also processes the canvas color. A `canvas` filter only returns a CSS filter string.

The canonical form is in [SPEC.md](../SPEC.md), "Effects".

### Where to look

- `src/filter.ts` — filter registration, built-in `grade` / `filter`, collecting them from attributes
- `src/style.ts` — parsing CSS functions for `filter`; parsing the other effects
- `src/grade.ts` — `grade` parameters and the pixel algorithm
- `src/types.ts` / `src/layout.ts` — fields and `readEffects`
- `src/paint.ts` — painting; pixel filters go through `applyPixelFilters`
- `src/rules.ts` / `src/jsx-intrinsics.ts` — ownership
- `src/report.ts` — the report and `effect-clipped`

## Font collections

`registerFromPath` cannot choose which face of a collection to use. With no index, the canvas uses face 0. A `#` plus a decimal index at the end of `src` is split off the path before the file is checked. The chosen face is split out of the table into its own sfnt, written into the font cache, and registered as usual. Table offsets in a collection are relative to the start of the file. Shared tables are copied once each.

## Formulas

Paint and the report do not know about formulas. `src/math/` lays MathML out as ordinary `flex`, `text`, `shape` (fraction bars, rules), and `line` (a stretched glyph path) nodes.

| File | Contents |
| --- | --- |
| `src/math/layout.ts` | How each tag is laid out |
| `src/math/rules.ts` | The tag list, operator classes, the TeX atom spacing table, the `mathvariant` alphabet, accents and primes |
| `src/math/font.ts` | Load STIX Two Math, convert MATH constants to pixels, pick glyph variants, assemble stretchy brackets and radicals from parts |
| `src/math/opentype.ts` | Read woff / sfnt: `cmap`, `hmtx`, `glyf` outlines, and the MATH table |

Each finished piece is a box. It records width, height above the baseline `ascent`, depth below the baseline `descent`, italic correction, and the TeX atom class. A container places children on the baseline, then writes each child's `x` and `y` relative to the container's top-left.

- Ordinary tokens are drawn by the canvas in STIX Two Math. The box hugs the ink. A formula does not accept another font: spacing, italic correction, and stretched glyphs all come from this font's MATH table. Another `font-family` reports `invalid-attr` and is ignored. `mtext` still uses the surrounding text font.
- Large sums, integrals, stretched brackets, radicals, and wide accents are not canvas glyphs. The matching variant or assembly parts are taken from the font and drawn as filled paths. The canvas can only fetch a glyph by code point, and it cannot fetch those variants.
- Spacing and shifts come from the MATH table. The algorithm matches MathML Core. Superscripts follow TeX: when the base is a single token, its height is not consulted, so the 2 in `a²` and `b²` sits at the same height.
- Atom spacing uses TeX's 8×8 table. A binary operator at the start of a line, or after an operator, relation, left bracket, or punctuation, becomes an ordinary atom.
- Brackets are paired with a stack first. Each pair stretches to the height of the content between them. That way the `( )` in `f(x) = { …a table… }` are not pulled taller by the braces.

Not built yet: `menclose`, `mpadded`, `mmultiscripts`, `mfenced`, line breaking, `maligngroup`, and the MATH table's math kerning (`MathKernInfo`) and accent anchors (`MathTopAccentAttachment`).

## Inline paint

When `translate`, `rotate`, `scale`, or `opacity` is on an inline tag's `style`, it is not part of the advance width passed to `measureText`. After layout, `planLinePaint` groups characters. Without `split="chars"`, one `paintGroup` rotates around the center of the whole run. With it, characters split by code point, and each rotates around its own center. Ink uses the transformed quadrilateral. `flowInk` keeps the untransformed line box. `box` in the report uses the latter. Opacity below 0.01 is not merged into the ink. Line-break rules look only at the owner path. `glueUnits` also requires those four properties to match when it joins a run, so different angles are not one `fillText`.

`rotate` in `style` parses `deg`, `rad`, `grad`, and `turn`. A bare nonzero number is degrees plus `non-canonical`. On a box, `translate`, `rotate`, `scale`, and `transform` become one local matrix, `T(origin) * translate * rotate * scale * transform * T(-origin)`, resolved after the border box size is known. A pure rotation or axis-aligned scale stays on `node.rotate` and `node.scaleX` / `scaleY`, so the old pivot path is unchanged. Anything with a translation, or a scale that does not commute with the rotation, is `node.motion`. Paint, ink, and the report use that matrix. Layout `x` / `y` / `width` / `height` do not. `transform-origin` wins over `origin`. The default is still the center.

A text box's own `rotate`, `scale`, and `opacity` still turn the whole box. When the box sets `split="chars"`, those four properties are recorded on each character, and the box's rotation, scale, and opacity go back to 0 or 1.

Glow and stroke go through `drawTextNode`, so they follow the pixels that were painted. With `blur` or a pixel filter, the offscreen range is the layout box union the ink. A character that rotates out of the box is not clipped.

## Script subprocess

`.layer` script text runs in a child process. The child loads `@napi-rs/canvas`, so it needs a native addon. Node's permission model blocks addons unless `--allow-addons` is passed, and that flag does not exist before Node 20.12 (and the matching 21.x). Passing it earlier makes Node exit before the script runs. Omitting the permission model on those versions is what lets the canvas paint. On later versions the read list includes the package directory, each file in it, the `node_modules` directories the resolver stats, and `package.json` walked upward. An existing directory is not also listed as `directory/*`. After the list is built, the child is started once; a denied module path from `resource:` is added and the start is repeated. `/etc/passwd` and other paths outside the package are not added.

## Native renderer

`native/flexlayer-render` holds the latest capped addon: the `.node` files, `index.cjs`, and `index.d.ts`. A publish deletes that directory and writes those files. It does not ship `draw/`. The delivered picture is painted inside the addon. `FLEXLAYER_PAINTER=js` throws. Mask measurement, mesh frames, and the `<canvas>` script host live in `src/` and call the addon. `canvas-dom.mjs` sits next to `run-scripts`.

`loadNativeRender` in `src/native.ts` looks for the addon. `FLEXLAYER_RENDER`, when set, is a package directory or a `.node` file, and that path is the only one tried. Otherwise the loader tries `native/flexlayer-render` in this package, then the package `flexlayer-render`, then `@ruochi/flexlayer-render`. The module has to export `engine` and `solidPng`. A missing file, a failed load, or the wrong exports returns `null`. `renderLayer` calls `render` on that addon.

## Models

An external triangle mesh and a three.js Object3D become the same primitives. Later raster, line art, materials, and shadows do not branch.

- Coordinates keep the file's and three's y-up. Author space y-down happens only in `transformPoint` / `transformNormal`. Flipping again here would flip winding twice, and the front would become the back.
- A negative linear determinant (a mirror scale) swaps triangles back to front-facing in `fromThree`. The glb path does not change winding.
- `unit` is pixels per model unit. `(x, y)` is where the model origin lands. The layout box is the bounds times `unit`, with y flipped so model y-up matches layer y-down. Several models with the same `unit` and the same `(x, y)` keep their relative positions. With no `unit`, `width` and `height` contain-fit the mesh in that box, centered. Neither form reports `invalid-attr`.
- When `material` is omitted, the three.js material kind is converted. `MeshLambertMaterial` and `MeshToonMaterial` use `matte`, shading only. `MeshPhongMaterial` uses `plastic`, `roughness = clamp(1 - shininess / 100)`. `shininess` 100 is smooth, and the environment is sharpest. `MeshPhysicalMaterial` with `transmission` of at least 0.5 uses `glass` (fake refraction: a square window, a rim light, one refraction layer). Otherwise metalness of at least 0.5 uses `metal`, and the rest uses `plastic`. Roughness comes from the primitive, default 0.65. That automatic split stays on the older finish. A written `material` applies to the whole model. A bare `clay`, `plastic`, `metal`, `mirror`, or `brushed` is a baked finish. A number after `plastic` or `metal` keeps the older finish. glb has no kind tag and still splits by metalness.
- When a `map`'s pixels are already in memory, they are sampled by uv, multiplied by the material color, then go through the same shading. Metal and plastic still use the studio environment. A texture whose URL has not been decoded counts as absent. Vertex colors multiply the material color and interpolate per vertex. `emissive` is multiplied by `emissiveIntensity`, added after shading, and also lights nearby surfaces and the ground. `lamp` and `neon` are the same path with a halo. `lamp` does not cast. Glass writes a light-space tint instead of a depth shadow: the rim takes `fill`, the center stays white. `ShaderMaterial` is not executed. A color is taken from a uniform such as `color`, `uColor`, or `diffuse` and used as the base color.
- Primitives of an in-memory mesh live in a `WeakMap`. The spec keeps only a content hash. The scene cache invalidates on that hash. The Object3D is not part of the key.
- Segments, points, and primitives share one projection. Line indices are pairs of endpoints. Point indices are single vertices, drawn as discs. They do not enter triangle raster or the shadow map. The depth test is shared with solid meshes. Whatever is closer to the viewer covers what is farther. `wireframe` emits only edges. Line width and point size are spread in output pixels on the supersampled buffer. After it is scaled back, a width of 1 is still about 1 pixel. `PointsMaterial.size` defaults to 1.
- `src/three.ts` does not import `three`. Types look at `isMesh` / `isLine` / `isPoints`. `flexlayer/three` is the same file. A bare package name is resolved upward from the source file that imported it, looking for `node_modules`, and the file is taken from the `import` condition in `package.json`. It does not use `require.resolve`. `lightsFromThree` reads directional, spot, point, hemisphere, and ambient lights. glTF `KHR_materials_transmission`, `KHR_materials_ior`, `KHR_materials_clearcoat`, `KHR_materials_emissive_strength`, and `KHR_materials_unlit` are stored on the primitive.

## Kernel

`flexlayer-render/src/kernel` is the shared CPU path for a draw list, WebGL clip space, and ray queries. Tag solids still enter `mesh_fill::rasterize_fill`, which is the studio shader (`shading`, lamp, neon, glass, contact). That function reads an optional camera `view`. When `light` is `world` (the default) the key and fill are rotated with the camera, so an orbit does not drag the shadow around the object. `light="camera"` skips that rotation. The first `<light type="directional">` replaces the key. `quality` is accepted and does not switch the studio raster off.

`exact_raster`, `native_renderer`, `rasterize`, and `mesh_rasterize` still export napi helpers that tests call. They stay until a later stage has replaced those callers. Deleting them now fails the build.

The picture the package ships is painted from this repository's `src/`, not from `flexlayer-render/draw/`. `src/software-mesh.ts`, `src/webgl-fake.mjs`, `src/tri-raster.mjs`, and `src/canvas-dom.mjs` are the copies `render` and `check` load. The private repository's `draw/` is the esbuild input of `npm run build:draw`, which writes `draw-dist/` for the addon package and is not what this package imports. Edit the `src/` copies when changing the live painter. The two trees still share names; a change in one is not copied to the other.

The kernel raster is tile-parallel, top-left, and hashed the same at 1, 2, and 8 threads. `visbuffer` is the fixed-point (16.8) visibility buffer: each sample stores a primitive id and a depth, shading runs once per covered primitive, and a shared edge is watertight. Scissor, stencil, polygon offset, and a color mask are on that path. Half-transparent fragments composite far-to-near, so submission order does not matter. `sampling` is the fixed Sobol, Owen scramble, and blue-noise tile. `pickRay` walks a BVH. `build_sah` is the binned SAH builder and `build4` collapses it into 4-wide nodes; both return the same closest triangle as the median tree. Transcendentals go through `libm`. GLSL ES is rewritten toward a desktop form and then interpreted. It is not naga and not a SIMD bytecode VM yet. `webglDraw` runs a straight-line fragment shader. `renderDrawList` paints an unlit clip-space mesh. The same `.node` exports all three. Tag solids still use `mesh_fill` until the scene compiler is the default.
