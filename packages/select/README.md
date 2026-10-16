# flexlayer-select

Cut out the subject of a local picture. The renderer does not run a model. It only reads the files written here. The caller writes the layout.

Subject cutout uses [BiRefNet 512](https://huggingface.co/onnx-community/BiRefNet_512x512-ONNX) fp16 through the optional `@huggingface/transformers`. The first run downloads about 470MB to `~/.cache/flexlayer/models`. This package is not on npm.

```bash
cd packages/select
npm install && npm run build
npx flexlayer-select cutout photo.jpg
```

That writes `photo.subject.png` beside the photo. Stack the photo, the text, then the subject. Both images use the photo's width and height.

```html
<layer width="800" height="600" background="#000">
  <img src="photo.jpg" style="width:800px; height:600px" />
  <layer x="400" y="335" anchor="bottom" anchor-box="ink">
    <h1 style="font-size:230px; color:#ffffffee">TITLE</h1>
  </layer>
  <img src="photo.subject.png" style="width:800px; height:600px" />
</layer>
```

`y` sits a little below the top of the subject. Lower text is covered by more of the subject.

Presets are `portrait` (default), `product`, and `flat`. `portrait` and `product` keep the soft edge of hair, remove spill that matches the background, and drop the dark shadow under the feet. `flat` is a hard cut at 128. `cutout.json` carries the source hash, model, and preset.

When this package is installed, `flexlayer select` at the root forwards here.
