# flexlayer-select

从一张本地图片里抠出主体，写成 Flex Layer 能直接用的蒙版。渲染器不跑模型，只读这里写出来的缓存。

模型是 [BiRefNet](https://huggingface.co/onnx-community/BiRefNet_512x512-ONNX) 的 ONNX 版（MIT）。这个包不在 npm 上，要从本仓库安装。第一次 `cutout` 下载 fp16 权重到 `~/.cache/flexlayer/models`，大约 470MB。fp32 大约 940MB，这里不用。`@huggingface/transformers` 是可选依赖，`npm ci` 会装上。

```bash
cd packages/select
npm ci
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
