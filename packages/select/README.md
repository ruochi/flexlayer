# flexlayer-select

从一张本地图片取出前景遮罩，或者抠出主体。渲染器不跑模型，只读这里写出来的文件。版式由调用方自己写。

前景遮罩：

```bash
npx flexlayer-select mask photo.jpg
npx flexlayer-select mask photo.jpg --point 820,640 --point 860,900 --refine
```

默认只跑深度模型 Depth Anything V2 Small 的 q4f16（Apache-2.0，大约 19MB）。不写点，前景从伸进远处的尖往下长，地面留在外面。`--point` 可以写多次，点在要留下的地方。多个点按这些点里最近和最远连成一段，连在一起的留下。一个点落在远处的尖上时，近端放到地面以上，把楼身补上。`--refine` 再跑下面的 BiRefNet，边用抠图模型，深度只去掉没点到的那一段。

写出 `photo.foreground.png` 和 `photo.foreground.json`。遮罩里白的地方是前景。json 带这张遮罩的文件名，前景的 `x`、`y`、`width`、`height`，以及这次的 `points`。没有前景时位置和大小是 `null`。没写点时 `points` 是 `[]`。

程序里用 `foregroundMask('photo.jpg', { points: [{ x: 820, y: 640 }, { x: 860, y: 900 }] })`，返回同一组字段，`mask` 是写出来的路径。标记里用 `<mask><img src="photo.foreground.png" channel="luma" /></mask>` 罩住原图。

---

抠主体：

模型是 [BiRefNet 512](https://huggingface.co/onnx-community/BiRefNet_512x512-ONNX) 的 fp16 ONNX。这个包不在 npm 上，要从本仓库安装。第一次 `cutout` 或 `--refine` 下载 fp16 权重到 `~/.cache/flexlayer/models`，大约 470MB。解码器中间结果大约 3GB，修边前会先放掉深度会话。`@huggingface/transformers` 是可选依赖，`npm install` 会装上。锁文件和 `package.json` 对不上时，`npm ci` 会直接报错，这里用 `npm install`。

```bash
cd packages/select
npm install
npm run build
npx flexlayer-select cutout photo.jpg --preset portrait
```

写到图片旁边：

| 文件 | 内容 |
| --- | --- |
| `photo.subject.png` | 和原图一样大。颜色做过前景去色，alpha 是选区 |
| `photo.mask.png` | 白底，alpha 是同一块选区 |
| `photo.regions.png` | 灰度值就是编号，0 是背景 |
| `photo.questions.json` | 每题有 `id`、`area`、`where`、`now`、`ask` |
| `photo.cutout.json` | 原图哈希、模型、预设、`analyzeImage` 的自检 |
| `photo.cutout.layer` | `<mask>` 和 `<preview>` |

预设：

- `portrait`：留下头发软边，去掉和背景同色的渗色，丢掉脚下的暗影子。
- `product`：和人像一样处理，影子另外写成 `photo.shadow.png`。
- `flat`：按 128 硬切，适合插画和截图。

作答后把编号写回标记：

```bash
npx flexlayer-select apply photo.jpg --add 2 --subtract 1
```

已经装了这个包时，根上的 `flexlayer select` 会转发到这里。
