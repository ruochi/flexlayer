# Gallery

Each picture is a grid. The label under a cell is the attribute name. Sources are in [docs/gallery/](gallery/). `npm run gallery` checks these pictures and the `.layer` files in examples. An error fails the run, and the pictures named here are rendered again.

| Picture | Cells |
| --- | --- |
| [shadow-glow.png](gallery/shadow-glow.png) | `shadow`, `glow`, `inner-shadow`, `inner-glow`, `noise`, `blend` |
| [blur-glass.png](gallery/blur-glass.png) | `glass="clear"`, `regular`, and `thick` on the same stripes, plus `blur`, `backdrop-blur`, and the comma form |
| [glass-scene.png](gallery/glass-scene.png) | `glass="clear"` on a lock-screen background |
| [color.png](gallery/color.png) | `filter` and `overlay`. The five `grade` presets and `grade-mask` share one `scene.png` |
| [paint.png](gallery/paint.png) | `linear-gradient`, `radial-gradient`, and a `gradient()` matrix and cone |
| [image.png](gallery/image.png) | `object-fit` values `fill`, `contain`, `cover`, `none` |
| [text.png](gallery/text.png) | Title size, wrapping at `max-width`, flex gap, `writing-mode:vertical-rl` |
| [flex.png](gallery/flex.png) | A tag cloud with `flex-wrap`, and a card grid with `column-gap` / `row-gap` |
| [matcaps.png](gallery/matcaps.png) | `clay`, `plastic`, `metal`, `mirror`, `brushed`. The top row is the finish color. The bottom row is the same finish with `fill` |
| [finish-mix.png](gallery/finish-mix.png) | One table. `clay`, `plastic`, `brushed`, and `mirror` are baked. The box with no `material` is matte. `plastic 0.22`, `glass 0.1`, and `metal 0.72` stay on the older shading |
| [finish-pairs.png](gallery/finish-pairs.png) | The same `fill` on both sides of a pair. The bare name is the baked finish. A roughness number stays on the older shading |

The smallest forms:

```html
<rect x="20" y="20" width="200" height="120" rx="16" fill="#3ecfc4" shadow="0 12 20 #00000088" />
<rect x="20" y="20" width="200" height="120" rx="16" fill="#ffffff18" glass="clear, blur 8, tint #a8c8ff55" />
<layer grade="lomo 0.8, fade 0.1" grade-mask="radial-gradient(#fff0 30%, #fff)">
  <img src="cover.png" style="width:320px; height:200px; object-fit:cover" />
</layer>
```

Syntax follows "Paint" and "Effects" in [SPEC.md](../SPEC.md).
