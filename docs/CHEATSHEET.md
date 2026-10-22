# Flex Layer cheat sheet

The rules are in [SPEC.md](../SPEC.md). This page is only examples you can edit.

<!-- attrs:effects:begin -->
Effects: `shadow` `0 8 16 #00000055` (default color `#00000066`), `box-shadow` `0 8px 16px #00000055` (default color `#00000066`), `glow` `56 #f3ead4` (default color from the mark), `inner-shadow` `0 8 16 #00000055` (default same as shadow), `inner-glow` `28 #7ec8ff` (default same as glow), `blur` `6`, `backdrop-blur` `16`, `backdrop-filter` `blur(16px)`, `glass` `clear`, `noise` `0.08 @t`, `filter` `saturate(1.1)`, `blend` `multiply` (default `source-over`), `overlay` `#00000066` (default opacity 1, `source-over`), `grade` `lomo 0.8, fade 0.1` (default amount 1), `grade-mask` `radial-gradient(#fff0 30%, #fff)`. `overlay`, `grade`, and `grade-mask` apply to the whole subtree and belong only on `layer`.
<!-- attrs:effects:end -->

`box-shadow` paints as `shadow`. `inset` is `inner-shadow`. `backdrop-filter` uses the same functions as `filter`, and `blur(16px)` paints as `backdrop-blur`. `filter` itself accepts `blur()`, `drop-shadow()`, and `opacity()` along with the color functions. Lengths are pixels. `url()` is not accepted.

```html
<layer width="800" height="400" background="#0e1219" color="#f4f1ea">
  <layer x="40" y="40">
    <div style="display:flex; gap:16px; align-items:center">
      <div style="width:28px; height:28px; border-radius:14px; background:#3ecfc4"></div>
      <p style="font-size:40px">a² = 9</p>
    </div>
  </layer>
  <layer x="220" y="120" width="360" height="200">
    <rect x="0" y="0" width="160" height="120" fill="#3ecfc4" />
    <circle cx="200" cy="60" r="16" fill="#f4f1ea" />
    <line x1="160" y1="60" x2="184" y2="60" stroke="#f4f1ea" stroke-width="4" />
  </layer>
  <layer width="120" height="80" x="580" y="260">
    <canvas id="bar" width="120" height="80"></canvas>
    <script>
      const canvas = document.querySelector('#bar')
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#f5c16c'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    </script>
  </layer>
</layer>
```

```html
<layer width="800" height="200" background="#0e1219" color="#f4f1ea">
  <layer x="40" y="80">
    <div style="display:flex; width:720px; gap:16px; align-items:center">
      <p style="font-size:40px">Left</p>
      <div style="flex:1; height:4px; background:#f5c16c"></div>
      <p style="font-size:40px">Right</p>
    </div>
  </layer>
</layer>
```

```html
<layer width="1080" height="1080" camera="900">
  <rect x="80" y="80" width="160" height="120" depth="60" rx="8" fill="#e8b04a" />
  <circle cx="420" cy="160" r="70" depth="40" fill="#c23b22" />
  <sphere cx="700" cy="180" r="80" fill="#2f6fed" />
  <ground y="520" rotateX="70" />
</layer>
```

In tsx, `<model x y width height object={mesh} />` contain-fits a mesh in that box. `<model unit x y object={mesh} />` puts the model origin at `(x, y)`. Lambert and Toon become `matte`. Phong becomes `plastic` after `shininess` is turned into roughness. Transmission of at least 0.5 becomes `glass`. Anything else is `metal` or `plastic` by metalness, on the older shading. An in-memory `map` and vertex colors tint the base color. `emissive` is added after shading. `ShaderMaterial` contributes only a color from its uniforms. `Line` and `wireframe` draw into the same depth buffer.

`material="clay"`, `plastic`, `metal`, `mirror`, or `brushed` is a baked finish. Omit `fill` and it uses the finish color. A `fill` recolors it. `metal 0.35` and `plastic 0.4` stay on the older shading. `glass` does too.

An unsized `layer` box is the union of its children, and the children shift so that union starts at 0 inside the box. The default top-left anchor stays the local origin, so the box moves with the minimum and marks stay where they were written. Other anchors meet the union, and so does `anchor-box="box"`. A sized axis stays an artboard. `tube` `d` is already in layer coordinates. A solid, a `ground`, or a 3D pose needs `camera` on the layer that frames the shot. Omitting it reports `flatten-3d`.

```html
<layer width="320" height="180">
  <mask>
    <circle cx="160" cy="90" r="90" />
  </mask>
  <img src="street.png" style="width:320px; height:180px" />
</layer>
```

A photo, a real object, or a material comes from the asset service, https://nc.fangyitech.com/flex/v1/docs. In the container, `flexlayer asset "画面里要什么、用在哪" --use subject`. The command prints JSON. When `status` is `done`, copy `items[0].snippet` into the picture. Text, icons, charts, and layout stay here. An `img` `src` is a relative path or an https URL from that report.

```tsx
const title = layer.create(
  <layer x={48} y={48}>
    <h1 style="font-size:72px">Title</h1>
  </layer>,
)
```

`data={{ values: [1, 2] }}`. An issue you expect is `expect="overflow-canvas: full bleed"`. A frame window is `expect="text-overlap@800-846: 叠印"` or `@26.7s-28.2s`.

```html
<p style="font-size:64px">
  <span style="translate: 0 -8; rotate: 8deg">A</span><span style="opacity: 0.35">B</span>
</p>
<p split="chars" style="font-size:64px; rotate: 6deg">Wave</p>
```

```bash
flexlayer render scene.tsx -o scene.png
flexlayer check scene.tsx
flexlayer render a.tsx b.tsx -o out/ --scale 1 --scale 2
flexlayer render scene.tsx --frames out/ --from 0 --to 90
flexlayer check scene.tsx --frames 600-660 --step 20
```

`check` on a Composition samples about every 0.5s, at most 96 frames, and prints the coverage. `--frames ends` is the first, middle, and last.
