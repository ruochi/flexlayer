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

The root `<layer width height>` is the canvas, and it is a layer. The delivered picture is `width × scale` by `height × scale`. The picture is painted by the capped addon. That addon refuses the picture when either edge is above 1920, reports `output-limit`, and does not write a PNG. It does not scale the picture down. An input image whose long edge is above 3840 is scaled down at decode and reported as `input-limit`. The unlimited addon, built with the `unlimited` feature, raises both edges to 16384 and is not published. `FLEXLAYER_PAINTER=js` is an error. Internal supersample buffers may be larger than the delivered picture and are not returned.

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
| `width`, `height` | Required on the root. They are the canvas size. A nested layer that sets one is an artboard on that axis, and content stays where it was written. When an axis is omitted, the box is the union of the child boxes on that axis, from the minimum to the maximum, and the children shift so the union starts at 0 inside the box. The default top-left anchor stays the local origin: the box is placed at that origin plus the minimum, so a mark keeps the coordinates it was written with. Any other anchor meets the union. `anchor-box="box"` also meets the union. `ground` does not count. A `model` with no box yet does not count. Once it has `width` and `height`, or `unit`, it does. Content may still draw outside a sized box |
| `background` | Root only. Default transparent |
| `color` | Default text color and default line color. Solid colors only. Default `#111111`. A glyph gradient is `fill` |
| `font-family` | Default `ChillDuanSans`. A catalog name is written directly and downloaded on first use. A file you supply uses `<font>`. See [docs/RESOURCES.md](docs/RESOURCES.md) |
| `safe` | Safe-area inset, `top right bottom left` or one number. Used only for checks. Default is 4% of the canvas's short side |
| `min-font` | Root only. `screen` (the default) is `min(width, height) / 1080 × 24`. `print` replaces 24 with 12. A number is a minimum in screen pixels. `none` turns the check off. Several too-small spots collapse into one `min-font-size` |
| `x`, `y` | The anchor point. Omitted means `0, 0` |
| `anchor` | Which point of the box `(x, y)` lands on. A 3×3 grid. Default `top-left`. A bad value is placed as `top-left` and reports `invalid-attr` |
| `anchor-box` | Default `box`, aligned to the layout box. `ink` aligns to the ink's bounding rectangle before rotation and scale. Together with `rotate` it reports `ink-anchor-rotate`. With no ink it reports `ink-anchor-empty` and falls back to the layout box. `overflow="hidden"` clips first, then aligns. Only on `layer` and `use`. When `anchor-box` is omitted, the anchor sits on the left or right edge, and the glyphs sit at least 2px inside the box and at least 4% of the font size, the report is `ink-inset`. A layer with a camera does not report it |
| `opacity` | 0 to 1. Nested values multiply |
| `rotate`, `scale`, `origin` | Drawing only. They do not change layout. Rotation is around `origin`, default `center`, and that point stays still on the picture. `rotate` is degrees, or the same angle as in style: `30deg`, `0.5rad`, `100grad`, `0.25turn`. A bare number does not report `non-canonical`. An invalid value reports `invalid-attr` and is ignored. One number in `scale` applies to both axes. `scale="1.2 0.8"` is per axis. `scale="-1 1"` mirrors horizontally. With two axes, z scale is the square root of the product of the absolute values. With one number, z uses that number, and the sign is kept. `origin` may also be `120 80`, `30% 40%`, `120 40%`, or `top 80`. A parse failure reports `invalid-attr` and falls back to the center |
| `rotateX`, `rotateY`, `z` | Belong to the same layer as `rotate`, and take the same angle. Positive `z` points toward the viewer. They do not change layout |
| `overflow` | Default `visible`. `hidden` clips children to this layer's box, and follows `border-radius` when the corners differ. A flex container writes `overflow: hidden` or `overflow: clip` in `style` and clips the same way. This layer's own shadow and blur may still draw outside the box. An ancestor's `hidden` clips a child's shadow and glow along with the child |
| `view` | `view="x y w h"`. `width` and `height` are the viewport on screen. `view` is the rectangle taken from the stage, stretched to fill the window. Outside the window is clipped, and that does not report `overflow-canvas`. A text edge cut flush with the window does not report `outside-safe`. If the four corners are not covered by the transformed, scaled quadrilaterals of the direct children, the report is `view-outside`. For `<g>`, each shape's quadrilateral is taken after `transform`. When the aspect ratio differs from the viewport by more than 1%, height is recomputed from the width, keeping the center, and a `warn` is issued. `width` and `height` are required. Write it separately from `camera`. Captions that should not scale on screen are written outside this layer. `zoomView(center, zoom, size)` computes `view`. `bleed` is no longer used. Writing it warns |
| `border`, `border-radius` | Attributes on `layer`. `border-radius` is one to four lengths, in the order top-left, top-right, bottom-right, bottom-left. Two lengths share the diagonals |

`color` and `font-family` on this layer pass to text inside that did not set them. When `width` is set, text inside wraps to that width. When both width and height are set, this layer's `safe` is subtracted as well.

`rotate`, `scale`, and perspective do not change `box` in the report. `ink` is the bounding rectangle after the transform. With perspective it becomes the bounding rectangle after projection, and a `quad` is added. `screenScale` is the factor from stacking `scale` and `view` (the geometric mean of the absolute values of the two axes; omitted when it is 1). Minimum type size compares `font-size × screenScale` with the root `min-font`. The outset of shadow, glow, and blur is multiplied by the same factor.

`<font family src>` registers a font. It can only be written under the root. `src` is ttf, otf, woff, ttc, or otc. `.ttc` and `.otc` use face 0 when no index is written. The index goes after the path and counts from 0: `src="SourceHanSans.ttc#2"`. `#` is not part of the file name. For Source Han and Noto CJK, face 0 is Japanese. Simplified Chinese uses `#2`. An index past the end of the collection throws `字体集合只有 N 套字形，没有 #index`. A single font file with an index greater than 0 throws `这不是字体集合，不能写 #index`. A missing file still throws `字体文件不存在`, and the path in that message does not include `#`. When both 400 and 700 are registered, the nearest one is used. A family with only one face always uses that face.

A `symbol` defines a reusable picture and is not drawn itself. `use` places it the way a layer is placed: `x`, `y`, `anchor`, `rotate`, `scale`, and `opacity` go on `use`. `href` is written `#id`. When width and height are omitted, the box wraps the content. Coordinates inside a `symbol` are its own local coordinates.

Tags are lowercase. Uppercase or `fvg` on the root is rejected outright. A child reports `unknown-tag` (error). Later siblings paint on top.

Where attributes go (generated from [src/schema.ts](src/schema.ts); do not edit between the markers by hand):

<!-- attrs:ownership:begin -->
| Attribute | Where |
| --- | --- |
| `width`, `height`, `min-font`, `x`, `y`, `anchor`, `anchor-box` | `x` and `y` are the anchor point. Default `anchor` is `top-left`. On an unsized layer that default is the local origin, not the corner of the union. An omitted `width` or `height` is the union of the children. Writing them on HTML warns |
| `opacity`, `rotate`, `rotateX`, `rotateY`, `z`, `scale`, `origin` | Shapes, lines, and `layer` use attributes; text uses `style`. Writing them as attributes on HTML warns |
| `background`, `padding`, `font-size`, `color`, `flex`, `flex-grow`, `flex-shrink`, `flex-basis`, `gap`, `border`, `border-radius`, `max-width`, `align-items`, `align-content`, `justify-content`, `flex-wrap`, `row-gap`, `column-gap`, `writing-mode`, `object-fit`, `object-position` | HTML, rendered as CSS, written in `style`. Initial values are not restated. `style` on `layer` or a shape warns |
| `cx`, `cy`, `x1`, `y1`, `x2`, `y2`, `points`, `d`, `depth`, `fill-rule`, `tube`, `round`, `fill`, `stroke`, `stroke-dasharray`, `stroke-dashoffset`, `hidden`, `halo`, `material`, `cast-shadow`, `receive-shadow`, `shadow-blur`, `shadow-opacity`, `shadow-color`, `transform` | Shape attributes. Coordinates are local to the containing `layer` |
| `src`, `unit`, `object`, `alt` | Only on `img` or `model`. `unit` and `object` are only on `model`. Image width and height still go in `style` |
| `shadow`, `box-shadow`, `glow`, `inner-shadow`, `inner-glow`, `blur`, `backdrop-blur`, `backdrop-filter`, `glass`, `noise`, `filter`, `blend` | Shapes and `layer` use attributes; text uses `style`. Syntax is in attrs.json |
| `camera`, `shadows`, `shading`, `environment`, `tonemap`, `light`, `quality`, `overlay`, `grade`, `grade-mask`, `view` | Only on `layer`. Elsewhere, or in `style`, warns |
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

`style` accepts `flex-direction`, `gap`, `row-gap`, `column-gap`, `flex-wrap`, `padding`, `padding-top`, `padding-right`, `padding-bottom`, `padding-left`, `align-items`, `align-self`, `align-content`, `justify-content`, `flex`, `flex-grow`, `flex-shrink`, `flex-basis`, `width`, `height`, `max-width`, `background`, `background-color`, `border`, `border-top`, `border-right`, `border-bottom`, `border-left`, `border-radius`, `border-top-left-radius`, `border-top-right-radius`, `border-bottom-right-radius`, `border-bottom-left-radius`, `overflow`, `font-size`, `font-weight`, `font-family`, `color`, `letter-spacing`, `fill`, `writing-mode`, `line-height`, `text-align`, `white-space`, `text-wrap`, `object-fit`, `object-position`, `opacity`, `rotate`, `rotateX`, `rotateY`, `scale`, `translate`, `transform`, `transform-origin`, and the names in the effects section. An unknown or mistyped property reports `invalid-attr`, and that property falls back to the CSS initial value. `padding` and `border-radius` take one to four lengths. A later longhand overrides that side or corner; a later shorthand resets the ones it names. `border-radius` does not take an elliptical slash or a percentage. `overflow` is `visible`, `hidden`, or `clip`.

`rotate`, `rotateX`, and `rotateY` in `style` take an angle: `30deg`, `0.5rad`, `100grad`, `0.25turn`, or `-45deg`. Only `0` may omit the unit. A bare nonzero number, such as `30`, reports `invalid-attr` and does not rotate. An invalid value, such as `30px`, reports `invalid-attr` and is ignored. `transform` accepts `translate()`, `translateX()`, `translateY()`, `rotate()`, `scale()`, `scaleX()`, and `scaleY()`, combined from left to right. `rotate()` inside `transform` needs a unit unless the angle is `0`; a bad function drops the whole `transform`. Together with the individual properties, the order is `translate`, then `rotate`, then `scale`, then `transform`. The center is `transform-origin`, default `50% 50%`. `origin` in `style` names the same point; when both are set, `transform-origin` wins. These change drawing only. The layout box stays where it was. Attributes on shapes, lines, and `layer` take the same angle. `rotate="30"` stays degrees and does not report `non-canonical`. `rotate="30deg"`, `0.5rad`, `100grad`, and `0.25turn` rotate too. An invalid value such as `30px` reports `invalid-attr` and is ignored. The same applies to `rotateX` and `rotateY`.

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
- `translate`, `rotate`, `scale`, and `opacity` on an inline tag change drawing only. `translate` is `0 -12` or `12px 0`. `scale` is `1.2` or `1.2 0.8`. `rotate` is an angle with a unit, for example `12deg`. A bare nonzero number reports `invalid-attr` and does not rotate. Line width, line height, and wrapping use the untransformed advance. The layout box stays where it was. Characters in the same inline tag rotate around the center of the whole run. With `split="chars"`, each character rotates around its own center. `rotate`, `scale`, and `opacity` on a text box still apply to the whole box. When a text box sets `split="chars"`, those four properties move onto each character, and the box itself no longer rotates, scales, or fades as one piece. The transformed quadrilateral joins the ink box of the line and of the text box. A character with opacity below 0.01 still takes space, but it does not join the ink. In vertical text each character is its own line, and the transform is around that character's center. Punctuation at the start or end of a line follows the same inline owner: the innermost inline tag that has an `id`. Tags with no `id` count as one owner. When `translate`, `rotate`, `scale`, or `opacity` differ, a comma does not drop to the start of the next line either. When runs are painted as one string, those four properties must match.

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

A line sits in a layer, and its coordinates are local. `x` and `y` are ignored and report `warn`. The layout box is the pure geometric bounds. `stroke` defaults to `color`. `stroke-width` defaults to 4. `fill` on `polygon`, `path`, and `curve` defaults to `none`. When `fill` is a paint and `stroke` is omitted, the text color is not used as a stroke, and the report is `implicit-stroke`. Write `stroke="none"` for a fill-only shape, or set `stroke` to draw an outline. A `stroke` of `none` does not widen the ink. An open `curve` with `fill` is not filled, and reports `open-curve-fill`. A `curve` passes through every point. Two points degenerate to a straight line. `stroke-linecap`, `stroke-linejoin`, `stroke-dasharray`, and `stroke-dashoffset` are also supported. `stroke-dashoffset` is the phase in px.

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

A syntax failure reports `invalid-attr` and falls back to that attribute's default solid color. A color stop the canvas cannot parse is a syntax failure. It is not dropped, and the picture is still written.

When `stroke` is a color, shapes and lines stroke on center. Written as `6 #000`, `6 #000 outside`, `6 #fff inside`, `8 #fff center`, or `6 #ffffff, 14 #c8321e`, it strokes by distance from the ink. The default side is `outside`. A later layer's width is the total distance. Text, images, `layer`, and flex, when given a color, stroke outside the ink. When the width is omitted, it is 4. `layer` and flex trace one outline of the merged ink of the whole subtree. Background and border count. When a text box or an image has a plate, the stroke goes around the plate. An `inside` or `center` inner width of about 8% of the font size reports `stroke-fill`. `outline` and `-webkit-text-stroke` report `non-canonical`. Rewrite them as `stroke`.

### Effects

Shapes and `layer` use attributes. Text uses `style`. `overlay`, `grade`, and `grade-mask` are only on `layer`. Effects do not change the layout box. They are computed from the ink. Syntax and defaults are in [docs/attrs.json](docs/attrs.json). Pictures are in [docs/GALLERY.md](docs/GALLERY.md). `noise="0.08 @t"` reshuffles the grain from the frame number. Without `@t` the texture stays put.

Paint order: `backdrop-blur` / `backdrop-filter` / `glass` → `shadow` → `glow` → outer `stroke` → the body → inner `stroke` → `inner-shadow` → `inner-glow` → `overlay` → `noise`. When there is `blur`, `filter`, `grade`, or `<mask>`, paint goes to an offscreen buffer first, then pixel filters, then `blur`, then the mask clips. The mask layer's own outer shadow, outer glow, and outer stroke are painted again from the remaining contour after the clip. When `blur` and a `blur()` inside `filter` are both set, `blur` wins and that `blur()` is removed. The other functions stay. When `glass` and `backdrop-blur` or `backdrop-filter` are both set, `glass` wins.

`glass` presets are `clear` (the background stays sharp), `regular`, and `thick` (frosted). To change parameters, append them with commas: `clear, blur 8, tint #fff2`. You can also override `refraction`, `specular`, `bezel`, and `dispersion`.

`filter` accepts `blur()`, `brightness()`, `contrast()`, `drop-shadow()`, `grayscale()`, `hue-rotate()`, `invert()`, `opacity()`, `saturate()`, and `sepia()`. Functions stay in the order written. Lengths are pixels. `url()` is not accepted. `drop-shadow()` has no spread and no inset. A missing color uses the element color. `blur()` and `drop-shadow()` lengths scale with the same supersample as the `blur` attribute. `blend` accepts `source-over`, `multiply`, `screen`, `overlay`, `soft-light`, `lighten`, and `darken`.

`box-shadow` is the CSS spelling of `shadow`. It can be an attribute, or in `style`. `inset` is `inner-shadow`. Several layers paint, and the first is on top. A missing color is `#00000066`. Lengths are pixels. `backdrop-filter` samples the backdrop the same way as `backdrop-blur`, and it accepts the same functions as `filter`. `blur()` sets that radius. The other functions use that same canvas filter string on the sampled pixels. When `shadow` and `box-shadow` are both set, `shadow` wins. When `backdrop-blur` and a `blur()` in `backdrop-filter` are both set, `backdrop-blur` wins. `glass` still wins over both.

`grade` is only on `layer` and applies to the whole subtree. The first item can be a preset plus an overall amount. Later items override the parameter of the same name. Presets: `lomo` (cool shadows, warm highlights), `matte` (lifted blacks), `chrome` (teal and orange), `bleach` (low saturation, high contrast), `mono` (black and white). Parameters: `shadows`, `midtones`, `highlights`, `contrast`, `fade`, `saturate`, `warmth`, `vignette`. The report echoes the expanded parameters. `grade-mask` reuses paint. Alpha is the amount. `grade-mask` without `grade` reports `warn`.

`registerFilter({ name, kind, parse, apply })` registers a new filter. `kind` is `pixel` or `canvas`. `pixel` is written only on `layer` by default. Optional fields are `layerOnly`, `maskAttr`, `includeBackdrop`, `order`, and `pad`. Registering the same name again replaces the implementation. `unregisterFilter` removes only filters that were added later. `grade` and `filter` cannot be removed. Do not register `outer-glow`, `drop-shadow`, `backdrop-filter`, or `texture`. The CSS properties `box-shadow` and `backdrop-filter` are already parsed. `blur()` and `drop-shadow()` belong inside `filter`.

## Solids and cameras

A positive `depth` extrudes a shape along z. Thickness is centered on the shape's plane. Layout sees only width and height. `rect` is a box. `rx` rounds the edges. `circle` is a cylinder with its axis along z. `ellipse`, `polygon`, and `path` extrude along the contour. Holes use `fill-rule` (default `nonzero`, or `evenodd`). With no `depth`, the shape is flat. An open `line`, `polyline`, or `curve` with `depth` reports `invalid-attr`. An unclosed `path` with `depth` warns. `<box>` and `<extrude>` are unknown tags: a box is `<rect depth>`, an extrusion is `<path depth>`.

What extrusion cannot do uses these tags:

| Tag | Form |
| --- | --- |
| `cylinder` | `cx` `cy` `r` `height`. The axis is vertical. The layout box is `2r` wide and `height` tall, centered on `cy`. `rx` rounds the rims. `round` is `top`, `bottom`, or `all` |
| `sphere` | `cx` `cy` `r`. The layout box is a square of side `2r` |
| `torus` | `cx` `cy` `r` `tube`. The ring lies in the plane |
| `tube` | `d` is the center line in layer coordinates, the same as `path`. `x` and `y` are an extra offset. `r` is the tube radius. A turn of more than about 10° is a rounded elbow. `Z` closes it into a ring |
| `model` | `src` points at a `.glb`, or in tsx `object` passes a mesh. The box is its own. `x` `y` `width` `height` contain-fit the model inside that box, centered, keeping its proportions. `unit` with `x` `y` places the model origin at `(x, y)`. The box is then the model bounds times `unit`, and model y points up. Writing neither `width` and `height` nor `unit` reports `invalid-attr` at error level. The hint gives `x="0" y="0" width="W" height="H"` from the parent size when that size is known. When both forms are written, `unit` wins. `object` reads geometry, the world matrix, color, roughness, and metalness. It does not read cameras. When `material` is omitted, Lambert and Toon use `matte`. Phong uses `plastic` after `shininess` is turned into roughness. Transmission of at least 0.5 uses `glass`. Otherwise metalness of at least 0.5 uses `metal`, and the rest uses `plastic`. An in-memory `map` and vertex colors multiply the base color before shading. `emissive` is added after shading and also lights nearby surfaces and the ground. `ShaderMaterial` is not executed. Only a color from its uniforms is taken. `Line`, `LineSegments`, and `LineLoop` draw as segments into the same depth buffer. When `wireframe` is true, only edges are drawn. Lines use the material color. Line width is in screen pixels, and the default is 1. `Points` draw as discs into the same depth buffer. Point size is `PointsMaterial.size` in screen pixels, and the default is 1. |
| `ground` | No width or height. `x` `y` `z` is a point on the plane. A positive `rotateX` sends the top edge away from the viewer. `rotateX="90"` lays it down as a horizontal ground. With no rotation the plane faces the camera. With no `fill` it is transparent and only receives shadows. `shadow-blur` defaults to 0 and is the maximum softness, in layer pixels. `0` stays a hard shadow. A larger value keeps the edge sharp where a caster meets the ground and softens it as the caster rises. `shadow-opacity` defaults to 0.4, and `shadow-color` to `#000000` |

`fill` accepts only a solid color. A gradient uses the first color and reports `invalid-attr`. `material` names a finish with `finish`, then the physical fields: `material="finish metal, color #c6c9ce, roughness 0.28, metalness 1"`. `color` there replaces `fill`. In tsx the same fields are an object, `material={{ finish: "metal", color: "#c6c9ce", roughness: 0.28, metalness: 1 }}`. A bare `material` still names a finish. A bare `clay`, `plastic`, `metal`, `mirror`, or `brushed` is baked. Omit `fill` and the finish uses its own color: clay `#d4cfc4`, plastic `#e4e0d8`, metal `#c2c6cb`, mirror `#e4e7eb`, brushed `#c8ccd1`. A `fill` recolors that finish. A number after `clay`, `mirror`, or `brushed` reports `invalid-attr`. `plastic 0.4` and `metal 0.2` use the metal-roughness shader. The number is roughness, and `metal` is metalness 1. `matte` with a roughness, and an omitted material, stay Lambert, so a camera-facing face is the written fill. `lamp` and `neon` emit. Omit `fill` and lamp is `#ffe6c2`, neon is `#3ad8ff`. Neon keeps a white core and a wider halo. A number after either name reports `invalid-attr`. They do not receive the key shadow and they do not cast one. `glass` and `glass 0.08` stay on the transmission shade, not a baked finish. A model with no `material` still maps three.js kinds onto matte, plastic, metal, or glass. `stroke` on a solid traces the edges. `hidden` is the color of hidden lines. `shadow` and `glow` on a solid report `invalid-attr`.

An SVG element may write `transform="rotateX(40) translateZ(20)"`. That is the same pose as `rotateX` and `z`, and the terms add. Two-dimensional `translate`, `rotate`, `scale`, and `matrix` are still written on `<g>`. On a shape they warn, and the pose is still applied.

`camera` is written on the layer that frames the shot. A solid, a `ground`, or `rotateX`, `rotateY`, or `z` does not open a camera by itself. Without `camera` the picture stays 2D and the report is `flatten-3d`, at error level. A number is the viewing distance, for example `camera="900"`. A nested layer that did not write `camera` uses the outer camera and does not open another one. Write it separately from `view`.

`camera` can be one viewing-distance number, or these fields: `focal`, `fov`, `lens`, `parallel`, `at`, `orbit`, `roll`, `distance`, `from`, `vanish`. `orbit` is yaw and pitch, in degrees. A positive yaw orbits the camera to the right. A positive pitch looks down from above. A positive `roll` turns the picture clockwise around the aim point. When `distance` is omitted it equals the focal length. Depth of field is `aperture` (blur radius at infinity, in output pixels), `focus` (equals `distance` when omitted), and `max`. The layer that should stay sharp writes `sharp="true"`. `parallel` is a parallel projection. There is no foreshortening, and `behind-camera` is not reported. `distance`, `vanish`, and the three depth-of-field fields report `info` and are ignored. `at` defaults to the center of the box at `z=0`. `from` cannot be combined with `orbit` or `distance`. An object and a string are equivalent. `--emit` writes back the fields the author wrote. After the camera leaves the default pose, children with no `z`, `rotateX`, or `rotateY` are projected too. When the center of a plane, or a solid's vertex, has `w` less than or equal to 0 after the camera matrix, the report is `behind-camera` and that element is not drawn. A layer that only wraps solids, and has no paintable texture once the solids are removed, reports `invalid-attr` if it sets `blur`.

Larger `z` is closer to the viewer. When this layer has no solid and no `ground`, direct children paint far to near by center depth. Equal depth keeps document order. When a solid or `ground` is present, painting switches to a depth buffer. A nested `layer` that does not have its own `camera` still counts its solids and planes in the outer scene.

`preserve-3d` on a `layer` or a flex container sends children along the parent chain into the outer camera, and they sort by depth with the direct children. `opacity` below 1, `blur`, `filter`, `grade`, `<mask>`, `overflow="hidden"`, and also `glass`, `backdrop-blur`, `backdrop-filter`, a `blend` other than `source-over`, `noise`, and `overlay`, still flatten the subtree into one picture and report `flattened-3d`. A nested layer that wrote its own `camera` is another camera.

The key light casts onto solids and onto `ground`. On a solid the edge stays hard. On `ground`, `shadow-blur` is the maximum softness. The ground also darkens where a caster sits close, and it picks up a little of that caster's color. A solid does the same from its neighbors. Glass does not write a hard shadow. Light that passes through it keeps the glass color at the rim and stays white at the center. `lamp` and `neon` light what is near them, including the ground, and add a halo. `shadows="none"` on the layer that opened the camera turns shadows off. Depth occlusion stays. `cast-shadow="false"` means this solid does not cast. `receive-shadow` is only on `ground`. Elsewhere, or when `shadows` is not `auto` or `none`, or on a layer that did not open a camera, the report is `invalid-attr`.

`shading` is written on that same layer. Omitted, or `studio`, is the continuous finish and the 1px round. `toon` is two flat colors, a 4px ink outline, and a 2px crease in a darker version of the fill. `technical` keeps the continuous finish and adds a 3px outline, a 2px crease, and a 1px hidden line. `manga` is paper, hatch, or ink, with a 4px outline and a 2px crease. Toon and manga widths scale with the part. Chinese names are `影棚`, `卡通`, `线稿`, and `漫画`, and the longer forms `影棚写实`, `扁平卡通`, `技术线稿`, and `漫画网点`. A solid's own `stroke` keeps its color and widths. `stroke="none"` draws no lines. Without a camera, or with an unknown value, the report is `invalid-attr` and the picture stays `studio`. 2D text, SVG, and HTML are unchanged. `grade` and `noise` still finish the picture.

`quality` on that layer is `draft` when omitted. Draft shades one sample per output pixel and keeps the shadow map. `quality="final"` keeps the map, widens the penumbra, and adds occlusion, one diffuse bounce, a reflection where metalness is above 0.5 and roughness is below 0.25, and a glass tint of up to three refraction steps. Glass and lamps do not cast those rays. A baked finish is not re-shaded by them. `check` and `render` take `--quality draft|final`, which overrides the attribute.

`flexlayer pick scene.tsx --at x,y` hits the layout box. The point is in unscaled canvas pixels, and y points down. `path` matches the report. `localX` and `localY` are local to that box, origin at the top-left. When two depths differ by less than half a pixel, the later element in paint order wins. Opacity below 0.01 is skipped. `overflow="hidden"` clips. A miss prints `{ "hit": null }` and exits 0. An error-level issue exits 1. `flexlayer pick --positions ... --indices ... --from ... --dir ...` still prints the closest triangle index. A solid's screen hit is its layout box. The ray form is the triangle query.

## Masks and programs

### Masks

`<mask>` is only a direct child of `layer`, one per layer. It clips the picture after this layer has been composited, including children's shadows, blur, grade, and grain. This layer's own `shadow`, `glow`, and outer or centered `stroke` are painted from the remaining contour and may extend outside the mask. A stroke or shadow written on a parent follows that contour too. An inner stroke stays inside the mask. The mask itself is not drawn and takes no layout. Shapes inside it do not enter the element table. Covered content does not report `overflow-canvas` or `effect-clipped`. The canvas color is not part of the mask.

Write `rect`, `circle`, `ellipse`, `polygon`, or `path` directly inside, or an `img` or `<g>`. `line`, `arrow`, `polyline`, `curve`, text, `div`, and a nested `layer` warn and are ignored. An empty mask reports `empty-mask`. When `fill` is omitted it paints as `#fff`, and only alpha is read. `op` defaults to `add`. It may also be `subtract`, `intersect`, or `xor`. `<g>` is composited as a group first, then applied. `op` outside the mask reports `invalid-attr`.

An `img` uses its own alpha by default. `channel="luma"` reads luminance instead. `pick="3 5"` keeps only pixels whose gray value is exactly one of those ids.

`<mask feather="8" invert="true">` runs after every step. CSS forms such as `mask-image` report `invalid-attr`.

`<preview of="#person" show="overlay checker black white edges" />` is only a direct child of `layer`. It is not drawn in the normal picture. When `show` is omitted, all five are requested. `flexlayer render scene.layer --preview out.png` writes a separate contact image. `check` and multi-frame renders do not pass `--preview`.

### Images

Flex Layer places an image and renders it. It does not fetch, draw, or cut out a photo, a real object, or a material. Those come from the asset service. The interface is https://nc.fangyitech.com/flex/v1/docs. The public base is `https://nc.fangyitech.com/flex/v1`. Inside the DeepSeek container, `FLEXLAYER_API_URL` is `http://host.docker.internal:8088/flex/v1`.

In that container, run the command. Do not assemble a URL. The `flexlayer` binary in this repository does not fetch materials. `asset`, `cutout`, and `select` print the document URL and exit.

```bash
flexlayer asset "画面里要什么、用在哪" --use subject
flexlayer cutout 本地图片.jpg
```

`asset` takes a description of what the picture needs and where it goes. `--use` is `subject`, `background`, or `texture`. Optional: `--aspect 16:9`, `--cutout auto|product|portrait`, `--plan` (a plan only). `cutout` takes a local file the user already has. Optional: `--preset product|portrait|auto`.

The command waits and prints a JSON report. A picture is a `url`. The command does not download the file. When `status` is `done`, read `items[0].example` first, then the file URLs. `example.code` and `snippet` are the same Flex Layer fragment. Copy `snippet` into the picture. `example.suggestion` is one sentence about the type. `example.placement` of `model` means the position came from that suggestion. `default`, or a warning `sample_placement_default`, means the position is centered on the subject box. Keep `credit.text` when `credit` is set. Fix anything in `warnings`.

`files.background` is the original. `files.foreground` and `files.subject` are the same transparent foreground. `files.sticker` is that foreground cropped to `subjectBox`. On a generated sheet of several objects, each item has `name`, `files.foreground` is cropped to that object, and `files.background` stays the full sheet. Fonts in `example` are catalog faces.

When the report is not done, it has `id`. Then `flexlayer asset status <id>`, `flexlayer asset confirm <id>`, or `flexlayer asset revise <id> "哪里不对"`. A failure uses `unauthorized`, `payment_required`, `bad_request`, `upstream`, `model_unavailable`, or `failed`. `model_unavailable` does not improve on retry.

Text, icons, charts, and layout stay in Flex Layer. An `img` `src` is a relative path, or an https URL that returns image bytes. Write the URL from the report. Do not invent one.

### Outlines

`glyph(text, { font, size, weight })` returns an array, one entry per code point. Each character has `text`, `d`, `font`, `size`, `weight`, `width`, `height`, `baseline`, `ink`, and `missing`. The origin of `d` is the top-left of the glyph box, and y points down. When `size` is omitted it is 40. `ChillDuanSans` outlines follow its weight axis, about 300 to 800. Omitting `weight` uses 300. A weight outside the axis is clamped. Other variable fonts do the same. A static family uses the nearest face. A space has an empty `d`. A character missing from the font has `missing` of `true`, and `d` is the missing-glyph box. A mark the font does draw, including `—`, `…`, and `「` on a variable face, has a real outline. If that outline cannot be read, `glyph` throws instead of returning an empty `d`.

Place it on a path with `fill` and `stroke="none"`. Omitting `stroke` reports `implicit-stroke` and does not stroke in the text color.

To place it back in layout: `x` is `x` from `chars` on the value returned by `layer.create`. `y` is `line.baseline - glyph.baseline`.

`createCanvas`, `loadImage`, `initFonts`, `applyCanvasFont`, `registerFontPath`, and `DEFAULT_FONT_FAMILY` are exported from the main entry. They use the `@napi-rs/canvas` instance that layout uses. `initFonts()` prepares the default font. `initFonts(['Kai'])` also prepares catalog names. An unregistered name throws. `registerFontPath(family, filePath)` registers one custom font file. A name that is already registered is not swapped for another file. `applyCanvasFont(ctx, family, weight, size)` writes variable weight onto the `wght` axis. Measurement and drawing share it. If you set only `ctx.font`, `450` is treated as the font size.

### canvas and script

Custom pixels use `<canvas>` and `<script>`. `<draw>` reports `invalid-child` (error). A `draw` callback reports `invalid-attr` (error).

`width` and `height` are the bitmap size and the default layout size. When omitted they are 300×150. Width and height in `style` change only layout. `devicePixelRatio` equals the render `--scale`. The script runs after layout and before paint. Every frame is a new canvas. The script runs once, then one round of `requestAnimationFrame` is called. `performance.now()` and `Date.now()` return this frame's time in milliseconds. A single frame is 0. In `.layer`, `Math.random` is seeded per frame. Script text in `.layer` runs in a subprocess. A function closure in `.tsx` stays in this process. When this Node has `--allow-addons`, the subprocess uses the permission model and can read the canvas package plus the paths the loader stats. A script still cannot read arbitrary files. Node 20.11 and earlier cannot allow a native addon under that model, so the subprocess runs without it; otherwise the canvas stays blank. `--no-script` skips it and records an info.

The available surface is `document.querySelector`, `document.getElementById`, `canvas.getContext('2d')`, `canvas.getContext('webgl')`, `canvas.getContext('webgl2')`, `getComputedStyle`, `canvas.dataset`, `requestAnimationFrame`, `performance.now`, `getBoundingClientRect`, and `devicePixelRatio`. Selectors support only `#id`, `canvas`, and `canvas#id`. Any other DOM reports `unsupported-dom`. `data-*` in `.layer` appears on `dataset`. Structured data is `data`, and the value is JSON. A thrown script records `invalid-script`. The rest of the picture still paints.

`getContext('webgl')` and `getContext('webgl2')` are the same context. The method names match WebGL, so three.js `WebGLRenderer` can draw into this canvas. Draws and clears are recorded and run when the canvas is read: `readPixels`, `flush`, `finish`, or `getImageData`. `drawArrays` and `drawElements` read attributes `position`, `normal`, `uv`, and `color`, and uniforms `modelViewMatrix`, `projectionMatrix`, `normalMatrix`, `diffuse`, `opacity`, `roughness`, `metalness`, `emissive`, `shininess`, `transmission`, and `map`. A program marked `#define SHADER_TYPE` as `MeshBasicMaterial`, `MeshLambertMaterial`, `MeshPhongMaterial`, `MeshStandardMaterial`, `MeshPhysicalMaterial`, `MeshToonMaterial`, or `MeshMatcapMaterial`, from three.js r160 or with no revision, uses the same matte, plastic, metal, and glass kind table as a `model`. A builtin from before r160 reports `unsupported-webgl`. Light and shadow uniforms are recorded with the draw. They do not replace that kind table. A straight-line fragment shader that writes `gl_FragColor` runs on the CPU. A shader that uses `dFdx`, `dFdy`, `fwidth`, a fixed `for`, or `discard` runs on a register machine, four lanes at a time, so a derivative is the difference across a 2×2 quad. `while` reports `unsupported-webgl` and a reason. `mediump` and `lowp` stay 32-bit. Transcendentals use libm. With a matrix, positions are clip space. With no matrix, coordinates inside -1 to 1 are still clip space and are projected through the viewport. Anything else is a pixel position, y down, and attribute 1 is a flat color. A draw that covers none of the default framebuffer reports `unsupported-webgl`. Triangles on the canvas are drawn into a 4× buffer and averaged back, so a silhouette is not a stair step. The pixels stay in the canvas bitmap.

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

`.tsx` runs first. Type checking happens in `check`. A type error is recorded as `type-error`, and the exit code is 1. `render` does not type-check by default. `render --typecheck` records type errors in the report, still writes the picture, and exits with code 1. `check --no-typecheck` skips type checking. Several files can be named in one command and finish in one process. `render` may repeat `--scale`. The same source runs once, and the file names gain `@1x` and `@2x`. In that case `-o`, `--report`, and `--emit` are directories. Put `/** @jsxImportSource flexlayer */` at the top of the file. The default export is a `<layer>`, or a function that returns that node. A named export `composition` may be a `Composition`. `check` without `--frames` samples about every 0.5s, at most 96 frames, and prints the coverage. `--frames ends` samples the first, middle, and last frame. `--emit` writes `.layer` back. A closure records `emit-script`. `data` that cannot be written as JSON records `emit-data`. When the frame count is over 300 and there is no `--frame`, `--frames`, or `--rgba`, the contact sheet is not rendered. flexlayer does not call ffmpeg.

### layer.create

The argument to `layer.create` must already be a `<layer>`. It returns that `<layer>` with measured `left`, `top`, `right`, `bottom`, `width`, and `height`, and also `x` and `y`, the same point as `left` and `top`. Those numbers are the layout box. They do not include `rotate` or `scale`. The bounding rectangle after the transform is `rotatedBox`. To keep the next block clear of rotated content, use `rotatedBox.bottom`. `create` is synchronous. Fonts and images it prepared stay in the process.

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

A custom font is `<font family src>`, or `layer.font(family, src)` first. A relative path resolves against the source file's directory. `create` before the font is registered throws. When the root omits `safe`, render uses 4% of the short side. A page that does not want it writes `safe="0"`.

`layer.component(name, render)` registers a component by tag name. It returns an element or an array. It expands before layout. `--emit` still writes the original tag. Registering the same name again replaces it. Types go on the jsx runtime:

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

- A rectangle (`box`, `ink`, `effect`, `mask.ink`) writes only `x`, `y`, `width`, and `height`. The right edge is `x + width`. The bottom edge is `y + height`.
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
| `invalid-script` | error / warn / info | The script failed, the content is empty, or `--no-script` skipped it |
| `missing-image` | warn | An `img` `src` could not be read |
| `missing-icon` | warn | The icon name does not match |
| `missing-model` | warn | A `model` `src` or `object` is unusable |
| `missing-symbol` | warn | A `use` `href` has no matching `symbol` |
| `symbol-cycle` | warn | A `symbol` refers to itself through `use` |
| `open-curve-fill` | warn | An open `curve` set `fill` |
| `implicit-stroke` | warn | A `path`, `polygon`, or `curve` has a fill and no `stroke`, so it is not stroked with the text color |
| `effect-clipped` | warn | The body is inside the canvas, but a shadow, glow, stroke, or blur extends outside |
| `view-outside` | error | `view` is not covered by the direct children |
| `stroke-fill` | warn | An inner stroke reaches about 8% of the font size |
| `ink-inset` | info | The anchor sits on the left or right edge, and the glyphs sit inside the box by at least 3px and 5% of the font size. A layer with a camera does not report this |
| `ink-anchor-empty` | info | `anchor-box="ink"` has no ink |
| `ink-anchor-rotate` | info | `anchor-box="ink"` and `rotate` are both set |
| `flatten-3d` | error | A 3D pose or a solid did not land in a camera |
| `output-limit` | error | The delivered picture, `width × scale` by `height × scale`, is past the addon’s long-edge cap. No PNG is written |
| `input-limit` | info | An input image was scaled down because its long edge was past the addon’s input cap |
| `flattened-3d` | info | `preserve-3d` is set, but this layer flattens the subtree into one picture |
| `behind-camera` | warn | After projection, `w` is less than or equal to 0. `parallel` does not report this |
| `unsupported-dom` | error | The script used DOM outside the subset |
| `emit-draw` | warn | A `draw` callback is still present at `--emit` |
| `emit-script` | warn | A `<script>` is a closure at `--emit` |
| `emit-data` | warn | `data` cannot be written as JSON at `--emit` |
| `unused-expect` | warn | `expect` was written, but that issue code is not in the subtree |
| `nondeterministic` | warn | `.tsx` called randomness or time that cannot be repeated |
| `type-error` | error | A TypeScript diagnostic in `.tsx`. Produced by `check` and by `render --typecheck` |
| `measure-mismatch` | warn | The width and height measured by `layer.create` do not match the final layout |

Any element may write `expect="overflow-canvas: full bleed; text-overlap"`. A matching issue is lowered to `info` and carries `expected`. A miss reports `unused-expect`. A window is `expect="text-overlap@800-846: 叠印"` or `@26.7s-28.2s`. Outside the window the issue keeps its level. If the sample misses the window, `unused-expect` is not reported. During a multi-frame check, one frame that uses it is enough to avoid the report. Issues sampled from a Composition carry `frames`, an inclusive range of frames.

Motion an animation is expected to produce is lowered to `info` with `expected` written, without an `expect`:

- `入场` and `出场`: `overflow-canvas`, `outside-safe`, and `effect-clipped` on the frames where an element is just entering or just leaving. The ink is moving, and a neighboring sample shows the element inside the frame or already invisible. An element that stays outside, sits still, or jumps out only on the last frame keeps its original level. Neighboring frames have to be in the sample, for example `--frames all`.
- `交叉淡化`: two text runs overlap, each effective `opacity` is below 1, and the two add up to at most 1.05. An overlap of two opaque runs stays `warn`.
- Text that is already outside the canvas does not also report `outside-safe`.
