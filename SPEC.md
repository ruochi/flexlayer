# Flex Layer specification

Flex Layer describes **one frame** with tags. The only structural tag is `layer`. `div`, `p`, `h1`–`h3`, `span`, `img`, and the inline tags are HTML. They render as HTML. `style` follows CSS, and initial values are not restated. Shapes use SVG attributes. Animation is a program that produces one Flex Layer tree for each instant. `flexlayer` in the report is format version `0.1`. It is not the package version.

1. **Everything is real pixels.** A `px` suffix is allowed. Percent, em, and rem are not used for layout.
2. **Position comes from layer.** HTML with `display:flex` does the arrangement. Shapes draw in a layer with their own coordinates.
3. **The y axis points down.** `y="400"` is 400 pixels from the parent's top.
4. **What you wrote is what is done.** Problems are only pointed out in the report.
5. **What you omitted is decided by the renderer and written into the report.** Automatic wrapping is one example.
6. **A mistake should say how to fix it.** An ambiguous or ignored form is `warn`, with a `hint`. A form whose meaning is clear but not canonical still renders, as `info`. A name within edit distance 2 of a known attribute is `warn`, and the `hint` gives the right attribute. Other unknown names are not reported.

The entry point for models is [AGENTS.md](AGENTS.md). Attributes, one by one, are in [docs/attrs.json](docs/attrs.json). Fonts are in [docs/RESOURCES.md](docs/RESOURCES.md). Sample pictures are in [docs/GALLERY.md](docs/GALLERY.md).

## layer

The root `<layer width height>` is the canvas, and it is a layer.

```html
<layer width="1080" height="1920" background="#0f1115" color="#ffffff">
  <layer x="540" y="700" anchor="center">
    <div style="display:flex; flex-direction:column; gap:32px; align-items:center">
      <h1>Bitcoin halving</h1>
      <p style="color:#f7931a">Once every four years</p>
    </div>
  </layer>
</layer>
```

A nested `layer` is a local coordinate system. `x`, `y`, and `anchor` place that box on the parent. Shapes inside use SVG coordinates. HTML does not take `x` or `y`. To place text, or one flex group, on its own, wrap another `layer`. A `layer` that has a width and height can sit inside a `div` and become one flex item. Its position then comes from layout, and `x`, `y`, or `anchor` on that layer report `invalid-attr`. Wrap a `layer` when things should move or rotate together, or share one camera.

Color blocks use `<rect fill>`, an HTML `background`, or `<canvas>`. `background` is only on the root `layer`. It is the canvas color, and it accepts only a solid color. When it is omitted or `transparent`, no ground is painted, and empty PNG pixels are transparent. A full-page gradient is a `<rect fill>` that covers the page. `background` on a nested `layer` or on `use` warns and is ignored.

| Attribute | Meaning |
| --- | --- |
| `width`, `height` | Required on the root. They are the canvas size. A nested layer that sets them is that size. The origin stays fixed, and content may draw outside the box. When both are omitted, width and height are the distance from the origin to the children's bottom-right. Children in the negative direction draw outside the box. Other children are not shifted |
| `background` | Root only. Default transparent |
| `color` | Default text color and default line color. Solid colors only. Default `#111111`. A glyph gradient is `fill` |
| `font-family` | Default `ChillDuanSans`. A catalog name is written directly and downloaded on first use. A file you supply uses `<font>`. See [docs/RESOURCES.md](docs/RESOURCES.md) |
| `safe` | Safe-area inset, `top right bottom left` or one number. Used only for checks. Default is 4% of the canvas's short side |
| `min-font` | Root only. `screen` (the default) is `min(width, height) / 1080 × 24`. `print` replaces 24 with 12. A number is a minimum in screen pixels. `none` turns the check off. Several too-small spots collapse into one `min-font-size` |
| `x`, `y` | The anchor point. Omitted means `0, 0` |
| `anchor` | Which point of the box `(x, y)` lands on. A 3×3 grid. Default `top-left`. A bad value is placed as `top-left` and reports `invalid-attr` |
| `anchor-box` | Default `box`, aligned to the layout box. `ink` aligns to the ink's bounding rectangle before rotation and scale. Together with `rotate` it reports `ink-anchor-rotate`. With no ink it reports `ink-anchor-empty` and falls back to the layout box. `overflow="hidden"` clips first, then aligns. Only on `layer` and `use`. When `anchor-box` is omitted, the anchor sits on the left or right edge, and the glyphs sit at least 2px inside the box and at least 4% of the font size, the report is `ink-inset`. A layer with a camera does not report it |
| `opacity` | 0 to 1. Nested values multiply |
| `rotate`, `scale`, `origin` | Drawing only. They do not change layout. Rotation is around `origin`, default `center`, and that point stays still on the picture. One number in `scale` applies to both axes. `scale="1.2 0.8"` is per axis. `scale="-1 1"` mirrors horizontally. With two axes, z scale is the square root of the product of the absolute values. With one number, z uses that number, and the sign is kept. `origin` may also be `120 80`, `30% 40%`, `120 40%`, or `top 80`. A parse failure reports `invalid-attr` and falls back to the center |
| `rotateX`, `rotateY`, `z` | Belong to the same layer as `rotate`. Positive `z` points toward the viewer. They do not change layout |
| `overflow` | Default `visible`. `hidden` clips children to this layer's box. This layer's own shadow and blur may still draw outside the box. An ancestor's `hidden` clips a child's shadow and glow along with the child |
| `view` | `view="x y w h"`. `width` and `height` are the viewport on screen. `view` is the rectangle taken from the stage, stretched to fill the window. Outside the window is clipped, and that does not report `overflow-canvas`. A text edge cut flush with the window does not report `outside-safe`. If the four corners are not covered by the transformed, scaled quadrilaterals of the direct children, the report is `view-outside`. For `<g>`, each shape's quadrilateral is taken after `transform`. When the aspect ratio differs from the viewport by more than 1%, height is recomputed from the width, keeping the center, and a `warn` is issued. `width` and `height` are required. Write it separately from `camera`. Captions that should not scale on screen are written outside this layer. `zoomView(center, zoom, size)` computes `view`. `bleed` is no longer used. Writing it warns |
| `border`, `border-radius` | Attributes on `layer` |

`color` and `font-family` on this layer pass to text inside that did not set them. When `width` is set, text inside wraps to that width. When both width and height are set, this layer's `safe` is subtracted as well.

`rotate`, `scale`, and perspective do not change `box` in the report. `ink` is the bounding rectangle after the transform. With perspective it becomes the bounding rectangle after projection, and a `quad` is added. `screenScale` is the factor from stacking `scale` and `view` (the geometric mean of the absolute values of the two axes; omitted when it is 1). Minimum type size compares `font-size × screenScale` with the root `min-font`. The outset of shadow, glow, and blur is multiplied by the same factor.

`<font family src>` registers a font. It can only be written under the root. `src` is ttf, otf, woff, ttc, or otc. `.ttc` and `.otc` use face 0 when no index is written. The index goes after the path and counts from 0: `src="SourceHanSans.ttc#2"`. `#` is not part of the file name. For Source Han and Noto CJK, face 0 is Japanese. Simplified Chinese uses `#2`. An index past the end of the collection throws `字体集合只有 N 套字形，没有 #index`. A single font file with an index greater than 0 throws `这不是字体集合，不能写 #index`. A missing file still throws `字体文件不存在`, and the path in that message does not include `#`. When both 400 and 700 are registered, the nearest one is used. A family with only one face always uses that face.

A `symbol` defines a reusable picture and is not drawn itself. `use` places it the way a layer is placed: `x`, `y`, `anchor`, `rotate`, `scale`, and `opacity` go on `use`. `href` is written `#id`. When width and height are omitted, the box wraps the content. Coordinates inside a `symbol` are its own local coordinates.

Tags are lowercase. Uppercase or `fvg` on the root is rejected outright. A child reports `unknown-tag` (error). Later siblings paint on top.

Where attributes go (generated from [src/schema.ts](src/schema.ts); do not edit between the markers by hand):

<!-- attrs:ownership:begin -->
| Attribute | Where |
| --- | --- |
| `width`, `height`, `min-font`, `x`, `y`, `anchor`, `anchor-box` | `width`, `height`, plus `x`, `y`, and `anchor`. `x` and `y` are the top-left corner, default 0; `anchor` defaults to `top-left`. Writing them on HTML warns |
| `opacity`, `rotate`, `rotateX`, `rotateY`, `z`, `scale`, `origin` | Shapes, lines, and `layer` use attributes; text uses `style`. Writing them as attributes on HTML warns |
| `background`, `padding`, `font-size`, `color`, `flex`, `flex-grow`, `flex-shrink`, `flex-basis`, `gap`, `border`, `border-radius`, `max-width`, `align-items`, `align-content`, `justify-content`, `flex-wrap`, `row-gap`, `column-gap`, `writing-mode`, `object-fit`, `object-position` | HTML, rendered as CSS, written in `style`. Initial values are not restated. `style` on `layer` or a shape warns |
| `cx`, `cy`, `x1`, `y1`, `x2`, `y2`, `points`, `d`, `depth`, `fill-rule`, `tube`, `round`, `fill`, `stroke`, `hidden`, `halo`, `material`, `cast-shadow`, `receive-shadow`, `shadow-blur`, `shadow-opacity`, `shadow-color`, `transform` | Shape attributes. Coordinates are local to the containing `layer` |
| `src`, `unit`, `object`, `alt` | Only on `img` or `model`. `unit` and `object` are only on `model`. Image width and height still go in `style` |
| `shadow`, `box-shadow`, `glow`, `inner-shadow`, `inner-glow`, `blur`, `backdrop-blur`, `backdrop-filter`, `glass`, `noise`, `filter`, `blend` | Shapes and `layer` use attributes; text uses `style`. Syntax is in attrs.json |
| `camera`, `shadows`, `overlay`, `grade`, `grade-mask`, `view` | Only on `layer`. Elsewhere, or in `style`, warns |
| `data` | Any element. The value is JSON and is not a normal attribute. In code, pass an object or array |
| `expect` | Any element. Names issue codes expected on that node or in its subtree; a match is lowered to info. A miss reports `unused-expect` |
<!-- attrs:ownership:end -->

## HTML and SVG

These tags are supported. Parameters that already exist in HTML and SVG follow their own rules. This section only says which ones Flex Layer accepts, and where it differs.

| Kind | Tags |
| --- | --- |
| HTML | `div`, `p`, `h1`, `h2`, `h3`, `span`, `strong`, `b`, `em`, `i`, `u`, `br`, `img` (`image` is the same) |
| Formulas | `math`, and the MathML subset listed below |
| Shapes | `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`, `curve`, `g` |
| Components | `arrow`. Registered on load, expanded to `<g>` before layout: one `line` plus a `polygon` with a 30° spread. `--emit` still writes `<arrow>` |
| Drawing | `canvas`, `script`. See "Masks and programs" |

`style` accepts `flex-direction`, `gap`, `row-gap`, `column-gap`, `flex-wrap`, `padding`, `align-items`, `align-self`, `align-content`, `justify-content`, `flex`, `flex-grow`, `flex-shrink`, `flex-basis`, `width`, `height`, `max-width`, `background`, `background-color`, `border`, `border-radius`, `font-size`, `font-weight`, `font-family`, `color`, `letter-spacing`, `fill`, `writing-mode`, `line-height`, `text-align`, `white-space`, `text-wrap`, `object-fit`, `object-position`, `opacity`, `rotate`, `rotateX`, `rotateY`, `scale`, `translate`, `transform`, `transform-origin`, and the names in the effects section. An unknown or mistyped property reports `invalid-attr`, and that property falls back to the CSS initial value.

`rotate`, `rotateX`, and `rotateY` in `style` take an angle: `30deg`, `0.5rad`, `100grad`, `0.25turn`, or `-45deg`. Only `0` may omit the unit. A bare nonzero number, such as `30`, is still degrees, and reports `non-canonical`. An invalid value, such as `30px`, reports `invalid-attr` and is ignored. `transform` accepts `translate()`, `translateX()`, `translateY()`, `rotate()`, `scale()`, `scaleX()`, and `scaleY()`, combined from left to right. `rotate()` inside `transform` needs a unit unless the angle is `0`; a bad function drops the whole `transform`. Together with the individual properties, the order is `translate`, then `rotate`, then `scale`, then `transform`. The center is `transform-origin`, default `50% 50%`. `origin` in `style` names the same point; when both are set, `transform-origin` wins. These change drawing only. The layout box stays where it was. Attributes on shapes, lines, and `layer` stay bare degrees, for example `rotate="30"`.

Where this differs from CSS:

- A text box (`p`, `h1`–`h3`, `span`, and a `div` that holds only text) may contain only text, inline tags, and `<img>`. A block tag or a `layer` reports `invalid-child`. Several paragraphs are `<div><p>…</p></div>`.
- A `div` without `display:flex`, when it contains children that do not fit in a text box, lays them out as blocks from top to bottom and does not report `invalid-child`. Text beside them becomes its own paragraph.
- Children of `display:flex` are text, images, flex containers, or a `layer` that has a width and height. Wrap a shape in a `layer` with a width and height before putting it there. A line or `g` placed directly inside does not render, and reports `warn`. A shape placed directly inside renders at its size and reports `info`. A flex container inside a layer, with no `width`, can be no wider than the layer (on the root, minus left and right `safe`).
- `color` accepts only a solid color. Glyph paint is `fill` in `style`: a solid color, or `linear-gradient()`, `radial-gradient()`, or `gradient()`. On a text box it samples that box. On an inline tag it samples that run's line box. `fill` is not inherited. A child that omits it keeps using `color`.
- `background` accepts a solid color and CSS `linear-gradient()` or `radial-gradient()`. It does not accept `gradient()`. `background-color` accepts only a solid color. An inline tag's background paints that run's line box and is not inherited from the text box.
- `line-height` is a multiplier or pixels. `%` and `em` report `invalid-attr`. A pixel line height is inherited as pixels.
- `writing-mode` is `horizontal-tb` or `vertical-rl`.
- `text-wrap` is `wrap` or `balance`. `white-space:nowrap` forbids wrapping.
- A set `width` wraps to the content width. A set `max-width` wraps only when the text overflows. When neither is set, the default is one line, and overflow of the available width wraps automatically. The report records `auto-wrap`. A hard break is only `<br>`.
- `ChillDuanSans` draws with a variable weight. The weight axis is about 300 to 800. A family with several faces uses the nearest face. A family with one face keeps that face when another weight is requested.
- `letter-spacing` may be `0`, `2px`, or `0.05em`. `em` is resolved against the font size of the element that wrote the declaration.
- `text-align` is `left`, `center`, or `right`.
- `translate`, `rotate`, `scale`, and `opacity` on an inline tag change drawing only. `translate` is `0 -12` or `12px 0`. `scale` is `1.2` or `1.2 0.8`. `rotate` is an angle with a unit, for example `12deg`. A bare nonzero number is still degrees and reports `non-canonical`. Line width, line height, and wrapping use the untransformed advance. The layout box stays where it was. Characters in the same inline tag rotate around the center of the whole run. With `split="chars"`, each character rotates around its own center. `rotate`, `scale`, and `opacity` on a text box still apply to the whole box. When a text box sets `split="chars"`, those four properties move onto each character, and the box itself no longer rotates, scales, or fades as one piece. The transformed quadrilateral joins the ink box of the line and of the text box. A character with opacity below 0.01 still takes space, but it does not join the ink. In vertical text each character is its own line, and the transform is around that character's center. Punctuation at the start or end of a line follows the same inline owner: the innermost inline tag that has an `id`. Tags with no `id` count as one owner. When `translate`, `rotate`, `scale`, or `opacity` differ, a comma does not drop to the start of the next line either. When runs are painted as one string, those four properties must match.

Icons are `<span class="material-symbols-outlined">home</span>`. Size and color follow the surrounding text. Weight is `font-weight`, snapped to the nearest hundred from 100 to 700. A tie uses the lighter one. `font-family` of `Symbols`, `图标`, or `material-symbols-outlined` selects the same face. `material-symbols-rounded` and `material-symbols-sharp` still use this face, and report `invalid-attr`. A name that does not match reports `missing-icon`.

`src` and `alt` on `img` are attributes. Width, height, `object-fit` (`fill`, `contain`, `cover`, `none`), `object-position`, and corner radius go in `style`. When neither width nor height is set, the image's pixel size is used. When only one side is set, the other keeps the original ratio. Inside a layer it lands at `(0, 0)`. Wrap a `layer` to place it. `src` accepts a relative path, `http(s)`, and a data URL. A file that cannot be read reports `missing-image`. A box that set width and height still occupies its space.

`<math>` may sit in a `layer` or in `display:flex`. It cannot sit in a text box. The default size is 40px. A formula does not wrap. Supported tags are `math`, `mrow`, `mi`, `mn`, `mo`, `mtext`, `mspace`, `mfrac`, `msub`, `msup`, `msubsup`, `msqrt`, `mroot`, `munder`, `mover`, `munderover`, `mtable`, `mtr`, `mtd`, `mstyle`, `mphantom`, and `semantics`. `annotation` is not drawn. Those tags written alone, outside `math`, report `unknown-tag`. Letters, numbers, and operators use only `STIXTwoMath`. Another `font-family` on `math`, `mi`, `mn`, or `mo` reports `invalid-attr`. `mtext` uses the surrounding font. With `display="block"`, fractions are not shrunk, sums and integrals use the large glyphs, and limits sit above and below the base. In a horizontal flex with `align-items:center`, the formula baseline aligns with text of the same size. With `align-items:baseline`, alignment uses the formula's own baseline.

### Shapes

Geometry uses SVG's own attributes. `x1` `y1` `x2` `y2` on `rect` or `ellipse` report `invalid-attr`. `anchor` on `rect`, `circle`, or `ellipse` is ignored and reports `info`. `cx` and `cy` on `rect` or `tube` are ignored and report `warn`.

| Tag | Form |
| --- | --- |
| `rect` | `x` `y` `width` `height`, top-left. `rx` is the corner radius. When `ry` is omitted it follows `rx` |
| `circle` | `cx` `cy` `r` |
| `ellipse` | `cx` `cy` `rx` `ry` |
| `line`, `arrow` | `x1` `y1` `x2` `y2`. `head` on `arrow` defaults to `max(12, stroke-width × 4)` |
| `polyline`, `polygon`, `curve` | `points`. `curve` may set `closed` |
| `path` | `d` |

A line sits in a layer, and its coordinates are local. `x` and `y` are ignored and report `warn`. The layout box is the pure geometric bounds. `stroke` defaults to `color`. `stroke-width` defaults to 4. `fill` on `polygon`, `path`, and `curve` defaults to `none`. An open `curve` with `fill` is not filled, and reports `open-curve-fill`. A `curve` passes through every point. Two points degenerate to a straight line. `stroke-linecap`, `stroke-linejoin`, and `stroke-dasharray` are also supported.

When a shape has no `depth`, `fill` defaults to `#000000`, `stroke` defaults to `none`, and `stroke-width` defaults to 1. An odd-length `stroke-dasharray` is repeated once more. A bad value reports `invalid-attr` and draws solid.

`<g>` sits in a `layer`. It has no width or height and does not create a new coordinate system. Children still use SVG coordinates. Shapes, lines, `path`, `curve`, and `<g>` are allowed. Inside a text box or a flex container it reports `invalid-child`. `transform` values `translate`, `rotate`, `scale`, and `matrix` are written only on `<g>`. `fill` and a solid `stroke` pass to child shapes. A child that sets its own wins. A `stroke` written as a width plus a paint stays on the group and traces one outline of the merged ink. The layout box is the union after the transform.

### Paint

Solid colors, `linear-gradient()`, and `radial-gradient()` follow CSS. `radial-gradient()` may start with `circle` or `ellipse`, a size keyword (`closest-side`, `farthest-side`, `closest-corner`, `farthest-corner`), and `at` followed by a position. The default size is `farthest-corner`. The paint is a circle. `ellipse` uses that same covering circle. `gradient()` is Flex Layer's form. The color is a matrix. Columns run along `u`, rows along `v`, rows are separated by `/`, and interpolation is bilinear in OKLab. A single row ignores `v`.

```
gradient( [mapping ,] color-row [ / color-row ]* )
```

Positions are 0 to 1. When omitted, the ends are 0 and 1 and the middle is even. Coordinates are pixels in the element's box. The origin is the top-left.

| Mapping | u | v |
| --- | --- | --- |
| Omitted, or `box` | Left to right | Top to bottom |
| `linear x1 y1 x2 y2` | From the start of the segment to the end | The left-hand side of the segment. Distance is measured in segment lengths |
| `radial cx cy r` | From the center out to the radius | One clockwise turn starting from straight up |
| `radial cx cy r0 r1` | From the inner radius to the outer radius | Same as above |
| `conic cx cy [angle]` | Clockwise from straight up, plus the start angle | From the center to the farthest corner of the box |

A syntax failure reports `invalid-attr` and falls back to that attribute's default solid color.

When `stroke` is a color, shapes and lines stroke on center. Written as `6 #000`, `6 #000 outside`, `6 #fff inside`, `8 #fff center`, or `6 #ffffff, 14 #c8321e`, it strokes by distance from the ink. The default side is `outside`. A later layer's width is the total distance. Text, images, `layer`, and flex, when given a color, stroke outside the ink. When the width is omitted, it is 4. `layer` and flex trace one outline of the merged ink of the whole subtree. Background and border count. When a text box or an image has a plate, the stroke goes around the plate. An `inside` or `center` inner width of about 8% of the font size reports `stroke-fill`. `outline` and `-webkit-text-stroke` report `non-canonical`. Rewrite them as `stroke`.

### Effects

Shapes and `layer` use attributes. Text uses `style`. `overlay`, `grade`, and `grade-mask` are only on `layer`. Effects do not change the layout box. They are computed from the ink. Syntax and defaults are in [docs/attrs.json](docs/attrs.json). Pictures are in [docs/GALLERY.md](docs/GALLERY.md).

Paint order: `backdrop-blur` / `backdrop-filter` / `glass` → `shadow` → `glow` → outer `stroke` → the body → inner `stroke` → `inner-shadow` → `inner-glow` → `overlay` → `noise`. When there is `blur`, `filter`, `grade`, or `<mask>`, paint goes to an offscreen buffer first, then pixel filters, then `blur`, then the mask clips. The mask layer's own outer shadow, outer glow, and outer stroke are painted again from the remaining contour after the clip. When `blur` and a `blur()` inside `filter` are both set, `blur` wins and that `blur()` is removed. The other functions stay. When `glass` and `backdrop-blur` or `backdrop-filter` are both set, `glass` wins.

`glass` presets are `clear` (the background stays sharp), `regular`, and `thick` (frosted). To change parameters, append them with commas: `clear, blur 8, tint #fff2`. You can also override `refraction`, `specular`, `bezel`, and `dispersion`.

`filter` accepts `blur()`, `brightness()`, `contrast()`, `drop-shadow()`, `grayscale()`, `hue-rotate()`, `invert()`, `opacity()`, `saturate()`, and `sepia()`. Functions stay in the order written. Lengths are pixels. `url()` is not accepted. `drop-shadow()` has no spread and no inset. A missing color uses the element color. `blur()` and `drop-shadow()` lengths scale with the same supersample as the `blur` attribute. `blend` accepts `source-over`, `multiply`, `screen`, `overlay`, `soft-light`, `lighten`, and `darken`.

`box-shadow` is the CSS spelling of `shadow`. It can be an attribute, or in `style`. `inset` is `inner-shadow`. Several layers paint, and the first is on top. A missing color is `#00000066`. Lengths are pixels. `backdrop-filter` samples the backdrop the same way as `backdrop-blur`, and it accepts the same functions as `filter`. `blur()` sets that radius. The other functions use that same canvas filter string on the sampled pixels. When `shadow` and `box-shadow` are both set, `shadow` wins. When `backdrop-blur` and a `blur()` in `backdrop-filter` are both set, `backdrop-blur` wins. `glass` still wins over both.

`grade` is only on `layer` and applies to the whole subtree. The first item can be a preset plus an overall amount. Later items override the parameter of the same name. Presets: `lomo` (cool shadows, warm highlights), `matte` (lifted blacks), `chrome` (teal and orange), `bleach` (low saturation, high contrast), `mono` (black and white). Parameters: `shadows`, `midtones`, `highlights`, `contrast`, `fade`, `saturate`, `warmth`, `vignette`. The report echoes the expanded parameters. `grade-mask` reuses paint. Alpha is the amount. `grade-mask` without `grade` reports `warn`.

`registerFilter({ name, kind, parse, apply })` registers a new filter. `kind` is `pixel` or `canvas`. `pixel` is written only on `layer` by default. Optional fields are `layerOnly`, `maskAttr`, `includeBackdrop`, `order`, and `pad`. Registering the same name again replaces the implementation. `unregisterFilter` removes only filters that were added later. `grade` and `filter` cannot be removed. Do not register `outer-glow`, `drop-shadow`, `backdrop-filter`, or `texture`. The CSS properties `box-shadow` and `backdrop-filter` are already parsed. `blur()` and `drop-shadow()` belong inside `filter`.

## Solids and cameras

A positive `depth` extrudes a shape along z. Thickness is centered on the shape's plane. Layout sees only width and height. `rect` is a box. `rx` rounds the edges. `circle` is a cylinder with its axis along z. `ellipse`, `polygon`, and `path` extrude along the contour. Holes use `fill-rule` (default `nonzero`, or `evenodd`). With no `depth`, the shape is flat. An open `line`, `polyline`, or `curve` with `depth` reports `invalid-attr`. An unclosed `path` with `depth` warns. `box`, `cylinder`, and `extrude` still work and report `non-canonical`.

What extrusion cannot do uses these tags:

| Tag | Form |
| --- | --- |
| `sphere` | `cx` `cy` `r`. The layout box is a square of side `2r` |
| `torus` | `cx` `cy` `r` `tube`. The ring lies in the plane |
| `tube` | `d` is the center line. `r` is the tube radius. `Z` closes it into a ring |
| `model` | `src` points at a `.glb`, or in tsx `object` passes a mesh. Place it in a layer that has a width and height. With no `unit`, it is contain-centered. `unit` is the pixels per model unit, and the origin sits on the wrapping layer's `origin`. Coordinates keep y pointing up. `object` reads geometry, the world matrix, color, roughness, and metalness. It does not read cameras. When `material` is omitted, Lambert and Toon use `matte`. Phong uses `plastic` after `shininess` is turned into roughness. Transmission of at least 0.5 uses `glass`. Otherwise metalness of at least 0.5 uses `metal`, and the rest uses `plastic`. An in-memory `map` and vertex colors multiply the base color before shading. `emissive` is added after shading. `ShaderMaterial` is not executed. Only a color from its uniforms is taken. `Line`, `LineSegments`, and `LineLoop` draw as segments into the same depth buffer. When `wireframe` is true, only edges are drawn. Lines use the material color. Line width is in screen pixels, and the default is 1. `Points` draw as discs into the same depth buffer. Point size is `PointsMaterial.size` in screen pixels, and the default is 1. |
| `ground` | No width or height. `x` `y` `z` is a point on the plane. A positive `rotateX` sends the top edge away from the viewer. `rotateX="90"` lays it down as a horizontal ground. With no rotation the plane faces the camera. With no `fill` it is transparent and only receives shadows. `shadow-blur` defaults to 0, `shadow-opacity` to 0.4, and `shadow-color` to `#000000` |

`fill` accepts only a solid color. A gradient uses the first color and reports `invalid-attr`. `material` is `matte`, `plastic`, `metal`, or `glass`, optionally followed by roughness. The default is matte. `stroke` on a solid traces the edges. `hidden` is the color of hidden lines. `shadow` and `glow` on a solid report `invalid-attr`.

An SVG element may write `transform="rotateX(40) translateZ(20)"`. That is the same pose as `rotateX` and `z`, and the terms add. Two-dimensional `translate`, `rotate`, `scale`, and `matrix` are still written on `<g>`. On a shape they warn, and the pose is still applied.

A camera opens when the same layer contains one of these solids, a `ground`, or `rotateX`, `rotateY`, or `z`. `camera` is written on the layer that frames the shot. When it is omitted, the outermost layer that has those clues uses its own `height` as the viewing distance. Layers inside that did not write `camera` do not open another camera. When this layer has no positive `height` and no viewing distance was written, it still draws in 2D and reports `flatten-3d`. Write it separately from `view`.

`camera` can be one viewing-distance number, or these fields: `focal`, `fov`, `lens`, `parallel`, `at`, `orbit`, `roll`, `distance`, `from`, `vanish`. `orbit` is yaw and pitch, in degrees. A positive yaw orbits the camera to the right. A positive pitch looks down from above. A positive `roll` turns the picture clockwise around the aim point. When `distance` is omitted it equals the focal length. Depth of field is `aperture` (blur radius at infinity, in output pixels), `focus` (equals `distance` when omitted), and `max`. The layer that should stay sharp writes `sharp="true"`. `parallel` is a parallel projection. There is no foreshortening, and `behind-camera` is not reported. `distance`, `vanish`, and the three depth-of-field fields report `info` and are ignored. `at` defaults to the center of the box at `z=0`. `from` cannot be combined with `orbit` or `distance`. An object and a string are equivalent. `--emit` writes back the fields the author wrote. After the camera leaves the default pose, children with no `z`, `rotateX`, or `rotateY` are projected too. When the center of a plane, or a solid's vertex, has `w` less than or equal to 0 after the camera matrix, the report is `behind-camera` and that element is not drawn. A layer that only wraps solids, and has no paintable texture once the solids are removed, reports `invalid-attr` if it sets `blur`.

Larger `z` is closer to the viewer. When this layer has no solid and no `ground`, direct children paint far to near by center depth. Equal depth keeps document order. When a solid or `ground` is present, painting switches to a depth buffer. A nested `layer` that does not have its own `camera` still counts its solids and planes in the outer scene.

`preserve-3d` on a `layer` or a flex container sends children along the parent chain into the outer camera, and they sort by depth with the direct children. `opacity` below 1, `blur`, `filter`, `grade`, `<mask>`, `overflow="hidden"`, and also `glass`, `backdrop-blur`, `backdrop-filter`, a `blend` other than `source-over`, `noise`, and `overlay`, still flatten the subtree into one picture and report `flattened-3d`. A nested layer that wrote its own `camera` is another camera.

Shadows fall only on `ground`. `shadows="none"` on the layer that opened the camera turns shadows off. Depth occlusion stays. `cast-shadow="false"` means this solid does not cast. `receive-shadow` is only on `ground`. Elsewhere, or when `shadows` is not `auto` or `none`, or on a layer that did not open a camera, the report is `invalid-attr`.

## Masks and programs

### Masks

`<mask>` is only a direct child of `layer`, one per layer. It clips the picture after this layer has been composited, including children's shadows, blur, grade, and grain. This layer's own `shadow`, `glow`, and outer or centered `stroke` are painted from the remaining contour and may extend outside the mask. A stroke or shadow written on a parent follows that contour too. An inner stroke stays inside the mask. The mask itself is not drawn and takes no layout. Shapes inside it do not enter the element table. Covered content does not report `overflow-canvas` or `effect-clipped`. The canvas color is not part of the mask.

Write `rect`, `circle`, `ellipse`, `polygon`, or `path` directly inside, or an `img` or `<g>`. `line`, `arrow`, `polyline`, `curve`, text, `div`, and a nested `layer` warn and are ignored. An empty mask reports `empty-mask`. When `fill` is omitted it paints as `#fff`, and only alpha is read. `op` defaults to `add`. It may also be `subtract`, `intersect`, or `xor`. `<g>` is composited as a group first, then applied. `op` outside the mask reports `invalid-attr`.

An `img` uses its own alpha by default. `channel="luma"` reads luminance instead. `pick="3 5"` keeps only pixels whose gray value is exactly one of those ids. `derive="subject"`, `derive="mask"`, or `derive="regions"` reads the cache next to the file: `photo.jpg` corresponds to `photo.subject.png` and `photo.cutout.json`. A missing cache reports `missing-mask`. A hash that does not match the source reports `stale-mask`. If the file is still there, it is drawn anyway. A URL or a data URL cannot `derive`.

`<mask feather="8" invert="true">` runs after every step. CSS forms such as `mask-image` report `invalid-attr`.

`<preview of="#person" show="overlay checker black white edges" />` is only a direct child of `layer`. It is not drawn in the normal picture. When `show` is omitted, all five are requested. `flexlayer render scene.layer --preview out.png` writes a separate contact image. `check` and multi-frame renders do not pass `--preview`.

### Images and cutouts

`analyzeImage(src, options?)` is synchronous. It measures a picture that already exists. It does not generate a mask. It returns `width`, `height`, `channel`, `hasAlpha`, `area`, `ink`, `pieces`, `parts`, `holes`, `softEdge`, and `d`. `channel` defaults to `auto`, `threshold` to 128, and `tolerance` to 0.5. Putting `d` in `<mask><path d /></mask>` is that same mask.

Generating a mask is `flexlayer-select`, which is not on npm. In the repo, enter `packages/select` and run `npm install && npm run build`.

```bash
npx flexlayer-select cutout photo.jpg --preset portrait
npx flexlayer-select apply photo.jpg --add 2 --subtract 1
npx flexlayer-select mask photo.jpg --point 820,640 --omit 900,1100 --refine
```

`cutout` presets are `portrait`, `product`, and `flat`. Beside the photo you get `photo.subject.png`, `photo.mask.png`, `photo.regions.png`, and `photo.cutout.json`. `mask` writes `photo.foreground.png` and `photo.foreground.json`. The fields are `mask`, `x`, `y`, `width`, `height`, `points`, and `omit`. `--point` marks what to keep. `--omit` marks what to drop. In code, call `foregroundMask`. When the package is not installed, `flexlayer select` only says to install it from `packages/select`.

### Outlines

`glyph(text, { font, size, weight })` returns an array, one entry per code point. Each character has `text`, `d`, `font`, `size`, `weight`, `width`, `height`, `baseline`, `ink`, and `missing`. The origin of `d` is the top-left of the glyph box, and y points down. When `size` is omitted it is 40. `ChillDuanSans` outlines exist only at the default weight 300. Requesting another weight throws. A space has an empty `d`. A character missing from the font has `missing` of `true`, and `d` is the missing-glyph box.

To place it back in layout: `x` is `x` from `chars` on the value returned by `canvas.create`. `y` is `line.baseline - glyph.baseline`.

`createCanvas`, `loadImage`, `initFonts`, `applyCanvasFont`, `registerFontPath`, and `DEFAULT_FONT_FAMILY` are exported from the main entry. They use the `@napi-rs/canvas` instance that layout uses. `initFonts()` prepares the default font. `initFonts(['Kai'])` also prepares catalog names. An unregistered name throws. `registerFontPath(family, filePath)` registers one custom font file. A name that is already registered is not swapped for another file. `applyCanvasFont(ctx, family, weight, size)` writes variable weight onto the `wght` axis. Measurement and drawing share it. If you set only `ctx.font`, `450` is treated as the font size.

### canvas and script

Custom pixels use `<canvas>` and `<script>`. `<draw>` reports `invalid-child` (error). A `draw` callback reports `invalid-attr` (error).

`width` and `height` are the bitmap size and the default layout size. When omitted they are 300×150. Width and height in `style` change only layout. `devicePixelRatio` equals the render `--scale`. The script runs after layout and before paint. Every frame is a new canvas. The script runs once, then one round of `requestAnimationFrame` is called. `performance.now()` and `Date.now()` return this frame's time in milliseconds. A single frame is 0. In `.layer`, `Math.random` is seeded per frame. Script text in `.layer` runs in a subprocess. A function closure in `.tsx` stays in this process. When this Node has `--allow-addons`, the subprocess uses the permission model and can read the canvas package plus the paths the loader stats. A script still cannot read arbitrary files. Node 20.11 and earlier cannot allow a native addon under that model, so the subprocess runs without it; otherwise the canvas stays blank. `--no-script` skips it and records an info.

The available surface is `document.querySelector`, `document.getElementById`, `canvas.getContext('2d')`, `getComputedStyle`, `canvas.dataset`, `requestAnimationFrame`, `performance.now`, `getBoundingClientRect`, and `devicePixelRatio`. Selectors support only `#id`, `canvas`, and `canvas#id`. Any other DOM reports `unsupported-dom`. `data-*` in `.layer` appears on `dataset`. Structured data is `data`, and the value is JSON. A thrown script records `invalid-script`. The rest of the picture still paints.

### Frames

`t` is in seconds. A `Composition` has `width`, `height`, `fps`, `durationInFrames`, and `component({ frame, fps, t })`.

| Function | Role |
| --- | --- |
| `renderLayer(node, options?)` | Render one frame. `format: 'rgba'` returns unpremultiplied raw pixels |
| `renderFrames(comp, { from, to, step, format })` | An async iterator, one frame at a time. `to` is inclusive |
| `renderComposition(comp)` | Returns every PNG, the reports, and the contact sheet at once |
| `random(seed)` | A fixed value in `[0, 1)` |
| `noise(seed, x, y?, z?)` | Smooth noise in `[-1, 1]` |
| `interpolate(value, input, output, options?)` | A multi-point map. `easing` uses `Easing` |
| `Easing.linear` / `quad` / `cubic` / `in` / `out` / `inOut` / `bezier` | Progress curves |
| `spring({ frame, fps })` | Approaches 1 from 0 |
| `sequence(input, { from, durationInFrames }, render)` | When the current frame falls in the range, passes the local `frame` to `render` |

Calling `Math.random()`, `Date.now()`, `crypto.randomUUID()`, or `crypto.getRandomValues()` in `.tsx` reports `nondeterministic`. Repeatable randomness uses `random` or `noise`.

```bash
flexlayer render scene.layer -o scene.png --report scene.json
flexlayer render scene.tsx -o scene.png --emit scene.layer
flexlayer render scene.tsx --frames out/ --from 0 --to 90
flexlayer render scene.tsx --rgba -
flexlayer check scene.tsx --frames 0-90 --step 5
flexlayer render scene.layer --preview out.png
flexlayer render a.tsx b.tsx -o out/ --scale 1 --scale 2
flexlayer check a.tsx b.tsx
```

`.tsx` runs first. Type checking happens in `check`. A type error is recorded as `type-error`, and the exit code is 1. `render` does not type-check by default. `render --typecheck` records type errors in the report, still writes the picture, and exits with code 1. `check --no-typecheck` skips type checking. Several files can be named in one command and finish in one process. `render` may repeat `--scale`. The same source runs once, and the file names gain `@1x` and `@2x`. In that case `-o`, `--report`, and `--emit` are directories. Put `/** @jsxImportSource flexlayer */` at the top of the file. The default export is a `<layer>`, or a function that returns that node. A named export `composition` may be a `Composition`. `check` without `--frames` samples frame 0, the middle frame, and the last frame. `--emit` writes `.layer` back. A closure records `emit-script`. `data` that cannot be written as JSON records `emit-data`. When the frame count is over 300 and there is no `--frame`, `--frames`, or `--rgba`, the contact sheet is not rendered. flexlayer does not call ffmpeg.

### canvas.create

The argument to `canvas.create` must already be a `<layer>`. It returns that `<layer>` with measured `left`, `top`, `right`, `bottom`, `width`, and `height`. Those six numbers are the layout box. They do not include `rotate` or `scale`. The bounding rectangle after the transform is `rotatedBox`. To keep the next block clear of rotated content, use `rotatedBox.bottom`. `create` is synchronous. Fonts and images it prepared stay in the process.

`text` is an array of text nodes. Coordinates are relative to the top-left of this layer's layout box. Each item has `path` and `lines`. Each line has `x`, `y`, `width`, `height`, `baseline`, and `chars`. Each character has `text`, `x`, and `width`. When the innermost inline tag that owns those characters has an `id`, the character also has `id`. In vertical text each character is its own line.

`elements` follows document order. A parent comes before its children. The root layer itself is not in the list. `mask`, `symbol`, and `script` are not in the table.

| Field | Meaning |
| --- | --- |
| `path`, `tag`, `id` | Path relative to this layer. `id` is present only when one was written |
| `box` | The layout box. It does not include this element's own `rotate` |
| `ink` | The bounding rectangle after this element's own `rotate` and `scale`. Lines include the stroke |
| `mask` | Present only on a `layer` that wrote `<mask>`. Fields match `mask` in the report |
| `points`, `edges`, `d` | Present only on a solid that landed in the camera. Projected vertices, edges, and the visible contour. A sphere gives only the analytic contour and does not write `points` |

When the root layer itself wrote `<mask>`, the return value has `mask` too.

When only `width` or only `height` is set, and nothing inside wraps, the other side scales in proportion, and the ratio is multiplied into the existing `scale`. Text that wraps is different: `width` is the line width, and the height is whatever layout produces. When both are set, that is the box. When neither is set, the measured size is kept. A handwritten `.layer` does not go through this proportional scale. When the final layout does not match the measured box, the report is `measure-mismatch`.

A custom font is `<font family src>`, or `canvas.font(family, src)` first. A relative path resolves against the source file's directory. `create` before the font is registered throws. When the root omits `safe`, render uses 4% of the short side. A page that does not want it writes `safe="0"`.

`canvas.component(name, render)` registers a component by tag name. It returns an element or an array. It expands before layout. `--emit` still writes the original tag. Registering the same name again replaces it. Types go on the jsx runtime:

```tsx
declare module 'flexlayer/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      badge: { r: number; fill?: string }
    }
  }
}
```

The built-in `arrow` is registered this way. An unregistered tag reports `unknown-tag`.

Not built yet: encoding a frame sequence as video, layout by ink bounds, and `Icon`. The name `Scene3D` is reserved. Picking and author lights are in [docs/proposals/3D.md](docs/proposals/3D.md). Implementation notes for filters and formulas are in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

### Report

Rendering also writes JSON. Each node in `elements` has `path`, `id`, `tag`, `box`, and `ink`. A node that came from `.tsx` may also have `source`, such as `examples/hello.tsx:18:5`.

- `box`: the layout box. Only translation is accumulated.
- `ink`: the ink's bounding rectangle after transform, scale, and projection, intersected with ancestors' `overflow="hidden"` and `<mask>`. Pixel alignment reads `ink`. When a line's centerline sits on the canvas edge, the stroke radius sticking out does not count as overflow.
- `effect`: the area a shadow, glow, layer blur, or glass may occupy. Omitted when there is no outset. Drawing outside the canvas reports `effect-clipped`.
- `mask`: present only on a `layer` that wrote `<mask>`. `area` is the fraction kept. `ink` is the bounding rectangle of alpha greater than 0. `pieces` is the number of 8-connected components. `softEdge` is the average soft-edge width. `ops` is each step's `op`, `changed`, and `path`. `changed` of 0 reports `mask-op-noop`.
- `quad`: the four corners after projection, in order top-left, top-right, bottom-right, bottom-left.
- `opacity`: opacity multiplied down from the root. An element below 0.01 still appears in the table, but it is left out of overflow, safe-area, overlap, and minimum-size checks.
- `inline`: present only on an inline tag that has an `id`. It does not take part in `outside-safe`, `min-font-size`, or `text-overlap`.
- `screenScale`, `defocus`, `filters`: written only when they have content.

| code | Level | Meaning |
| --- | --- | --- |
| `overflow-canvas` | error | Ink is outside the canvas. The part `view` clips inside the viewport does not count |
| `outside-safe` | warn | Text is outside the safe area. An edge clipped by the viewport or by `overflow="hidden"` does not count |
| `text-overflow` | error | Text is outside a width or height that was set explicitly |
| `flex-overflow` | warn | A child is outside a flex container whose size was set explicitly |
| `text-overlap` | warn | The ink of two text runs overlaps. When both have a `quad`, the test is whether the convex quads intersect |
| `min-font-size` | warn | The on-screen size is below the root `min-font`. Several spots collapse into one issue |
| `auto-wrap` | info | Text overflowed the available width and was wrapped automatically |
| `non-canonical` | info | The meaning is clear, but the form is not the canonical one. It still renders |
| `unknown-tag` | warn | An unknown tag. Uppercase of a known tag is an error |
| `invalid-attr` | warn | An attribute is in the wrong place, or the value is wrong. A bad `anchor` and a `d` that cannot be parsed are this code too. A `draw` callback is an error |
| `invalid-child` | warn | An illegal child. A `div` that contains a block child lays out as a vertical block and does not report this. An `<img>` in a text box does not report this. `<draw>` is an error |
| `empty-mask` | warn | A `mask` has no usable shape or image |
| `mask-op-noop` | warn | One mask step did not change the selection |
| `missing-mask` | error | The `derive` cache does not exist, or `src` is not a local image |
| `stale-mask` | warn | The cache is still there, but the source hash does not match |
| `invalid-script` | error / warn / info | The script failed, the content is empty, or `--no-script` skipped it |
| `missing-image` | warn | An `img` `src` could not be read |
| `missing-icon` | warn | The icon name does not match |
| `missing-model` | warn | A `model` `src` or `object` is unusable, or there is no width and height to place it in |
| `missing-symbol` | warn | A `use` `href` has no matching `symbol` |
| `symbol-cycle` | warn | A `symbol` refers to itself through `use` |
| `open-curve-fill` | warn | An open `curve` set `fill` |
| `effect-clipped` | warn | The body is inside the canvas, but a shadow, glow, stroke, or blur extends outside |
| `view-outside` | error | `view` is not covered by the direct children |
| `stroke-fill` | warn | An inner stroke reaches about 8% of the font size |
| `ink-inset` | info | The anchor sits on the left or right edge, and the glyphs sit inside the box. A layer with a camera does not report this |
| `ink-anchor-empty` | info | `anchor-box="ink"` has no ink |
| `ink-anchor-rotate` | info | `anchor-box="ink"` and `rotate` are both set |
| `flatten-3d` | warn | A 3D pose or a solid did not land in a camera |
| `flattened-3d` | info | `preserve-3d` is set, but this layer flattens the subtree into one picture |
| `behind-camera` | warn | After projection, `w` is less than or equal to 0. `parallel` does not report this |
| `unsupported-dom` | error | The script used DOM outside the subset |
| `emit-draw` | warn | A `draw` callback is still present at `--emit` |
| `emit-script` | warn | A `<script>` is a closure at `--emit` |
| `emit-data` | warn | `data` cannot be written as JSON at `--emit` |
| `unused-expect` | warn | `expect` was written, but that issue code is not in the subtree |
| `nondeterministic` | warn | `.tsx` called randomness or time that cannot be repeated |
| `type-error` | error | A TypeScript diagnostic in `.tsx`. Produced by `check` and by `render --typecheck` |
| `measure-mismatch` | warn | The width and height measured by `canvas.create` do not match the final layout |

Any element may write `expect="overflow-canvas: full bleed; text-overlap"`. A matching issue is lowered to `info` and carries `expected`. A miss reports `unused-expect`. During a multi-frame check, one frame that uses it is enough to avoid the report. Issues sampled from a Composition carry `frame` and `frames`.
