# Gallery diff

Both engines were rendered on this machine. Left is `origin/main` (`0e64bdd`) via a worktree. Right is this branch. `scripts/png-diff.ts` compares `docs/gallery` and `examples`.

| file | status | pixels | max delta |
| --- | --- | ---: | ---: |
| docs/gallery/blur-glass.png | same | 0 | 0 |
| docs/gallery/color.png | same | 0 | 0 |
| docs/gallery/flex.png | same | 0 | 0 |
| docs/gallery/glass-scene.png | same | 0 | 0 |
| docs/gallery/image.png | same | 0 | 0 |
| docs/gallery/paint.png | same | 0 | 0 |
| docs/gallery/scene.png | same | 0 | 0 |
| docs/gallery/shadow-glow.png | same | 0 | 0 |
| docs/gallery/swatch.png | same | 0 | 0 |
| docs/gallery/text.png | same | 0 | 0 |
| examples/draw-layer.png | same | 0 | 0 |
| examples/math.png | same | 0 | 0 |
| examples/three-assembly.png | same | 0 | 0 |

changed: 0 / 13

The PNG bytes committed earlier on this branch differed from `main`, but rendering both engines here produces the same pixels. That difference was the font environment, not the layout rules. Those files are restored to the `main` bytes. No gallery picture uses an unsized layer whose content starts away from 0, a tube, or an implicit camera, so a zero diff is the expected result.
