# flexlayer-select

Take a foreground mask from a local picture, or cut out the subject. The renderer does not run a model. It only reads the files written here. The caller writes the layout.

Foreground mask:

```bash
npx flexlayer-select mask photo.jpg
npx flexlayer-select mask photo.jpg --point 820,640 --omit 900,1100 --refine
```

By default only the depth model runs: Depth Anything V2 Small, q4f16 (Apache-2.0, about 19MB). With no points, the foreground grows downward from tips that reach into the distance, and the ground stays outside. `--point` marks what to keep. `--omit` marks what to drop. Both can be repeated. After you look at the mask, add points and run it again. A positive point grows along the connected piece. The near end stops on the same ground line as a run with no points. When a negative point falls inside that piece, the part closer to it is removed. `--refine` then runs BiRefNet, below. The edge comes from the matting model. Depth only removes the stretch that no point touched.

This writes `photo.foreground.png` and `photo.foreground.json`. White in the mask is foreground. The json carries the mask file name, the foreground `x`, `y`, `width`, and `height`, and this run's `points` and `omit`. When there is no foreground, position and size are `null`. When no points were written, both arrays are `[]`.

In code, `foregroundMask('photo.jpg', { points: [{ x: 820, y: 640 }], omit: [{ x: 900, y: 1100 }] })` returns the same fields. `mask` is the path that was written. In markup, cover the source with `<mask><img src="photo.foreground.png" channel="luma" /></mask>`.

---

Subject cutout:

The model is fp16 ONNX of [BiRefNet 512](https://huggingface.co/onnx-community/BiRefNet_512x512-ONNX). This package is not on npm. Install it from this repo. The first `cutout` or `--refine` downloads the fp16 weights to `~/.cache/flexlayer/models`, about 470MB. Decoder intermediates are about 3GB. The depth session is released before the edge is refined. `@huggingface/transformers` is an optional dependency, and `npm install` installs it. When the lockfile and `package.json` disagree, `npm ci` fails, so this package uses `npm install`.

```bash
cd packages/select
npm install
npm run build
npx flexlayer-select cutout photo.jpg --preset portrait
```

Written beside the picture by default: `photo.subject.png` and `photo.cutout.json`. Add `--full` for the rest:

| File | Contents |
| --- | --- |
| `photo.subject.png` | Always written. The same size as the source. Color is decontaminated against the foreground. Alpha is the selection |
| `photo.mask.png` | `--full` only. White plate. Alpha is the same selection |
| `photo.regions.png` | `--full` only. The gray value is the id. 0 is background |
| `photo.questions.json` | `--full` only. Each question has `id`, `area`, `where`, `now`, and `ask` |
| `photo.cutout.json` | Always written. Source hash, model, preset, and the `analyzeImage` self-check |
| `photo.cutout.layer` | `--full` only. `<mask>` and `<preview>` |

Presets:

- `portrait`: keep the soft edge of hair, remove spill that matches the background, and drop the dark shadow under the feet.
- `product`: the same treatment as a portrait. The shadow is also written as `photo.shadow.png`.
- `flat`: a hard cut at 128. Fits illustration and screenshots.

After answering, write the ids back into the markup. This needs a `--full` run first:

```bash
npx flexlayer-select apply photo.jpg --add 2 --subtract 1
```

When this package is installed, `flexlayer select` at the root forwards here.
