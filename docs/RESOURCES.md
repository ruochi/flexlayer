# 可用资源

生成画面时用这里的名字和地址。字体、图片、配色、效果名都对得上当前实现。程序里 `import { resources } from '@dc/flexlayer'`，`resources.font('楷体')`、`resources.image('lake')`、`resources.palettes.night`。

## 字体

写 `font-family="Song"` 或 `style="font-family:Inter"`。没写是 `ChillDuanSans`。第一次用到某个名字时，字体文件下载到 `~/.cache/flexlayer/fonts`。

`<font src>` 要的是字体文件（ttf、otf、woff）。`fonts.googleapis.com` 的 CSS 地址不是字体文件，写进去会下载失败。目录里的 Google 字体已经换成 jsDelivr 上的文件，直接写名字即可。

多档字体在 400 和 700 里取最近的一档。只登记了一档的，标题的 bold 仍用这一档。`ChillDuanSans` 是可变字体，字重轴约 300 到 800；轮廓只有默认字重 300。

简体子集不含完整拉丁字形时，缺的字回退到 `ChillDuanSans`。拉丁子集不含汉字。

| 名字 | 别名 | 字重 | 覆盖 | 适合 | 来源 |
| --- | --- | --- | --- | --- | --- |
| `ChillDuanSans` | 寒蝉端黑体 | 可变 300–800 | 简体、拉丁 | 默认正文 | 寒蝉端黑体 |
| `Song` | 宋体、思源宋体 | 400、700 | 简体 | 正文宋体 | Noto Serif SC |
| `Kai` | 楷体、霞鹜文楷 | 400、700 | 简体 | 楷体 | 霞鹜文楷 |
| `Brush` | 书法、毛笔 | 400 | 简体 | 书法标题 | Ma Shan Zheng |
| `Inter` | | 400、700 | 拉丁 | 英文正文 | Inter |
| `Playfair` | Playfair Display | 400、700 | 拉丁 | 英文标题 | Playfair Display |
| `Baskerville` | Libre Baskerville | 400、700 | 拉丁 | 英文正文衬线 | Libre Baskerville |
| `Oswald` | | 400、700 | 拉丁 | 窄标题 | Oswald |
| `SpaceGrotesk` | Space Grotesk | 400、700 | 拉丁 | 几何无衬线 | Space Grotesk |
| `Cormorant` | Cormorant Garamond | 400、700 | 拉丁 | 细衬线 | Cormorant Garamond |
| `Bebas` | Bebas Neue | 400 | 拉丁 | 全大写展示字 | Bebas Neue |
| `Newsreader` | | 400、700 | 拉丁 | 阅读衬线 | Newsreader |
| `Fraunces` | | 400、700 | 拉丁 | 软衬线标题 | Fraunces |
| `Instrument` | Instrument Serif | 400 | 拉丁 | 展示衬线 | Instrument Serif |
| `NotoSans` | 思源黑体 | 400、700 | 简体 | 黑体正文 | Noto Sans SC |
| `XiaoWei` | 站酷小薇 | 400 | 简体 | 宋意标题 | ZCOOL XiaoWei |
| `KuaiLe` | 站酷快乐体 | 400 | 简体 | 活泼标题 | ZCOOL KuaiLe |
| `MaoCao` | 刘建毛草 | 400 | 简体 | 手写 | Liu Jian Mao Cao |

```html
<layer width="720" height="360" background="#0c1424" color="#f4ecdf" font-family="Song">
  <layer x="48" y="64">
    <h1 style="font-family:XiaoWei; font-size:96px">春眠不觉晓</h1>
    <p style="font-family:Inter; font-size:28px">Hello</p>
  </layer>
</layer>
```

自己的字体文件仍写在根下：`<font family="DeYiHei" src="fonts/deyihei.otf" />`。`src` 可以是相对路径或字体文件的网址。

## 图片

`img` 的 `src` 可以是相对路径，或直接返回图片字节的 http(s) 地址。下面三张是裁好的样图，宽约 960。

| 名字 | 画面 | 地址 |
| --- | --- | --- |
| `lake` | 山湖 | `https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=960&q=80` |
| `valley` | 山谷 | `https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=960&q=80` |
| `forest` | 森林 | `https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=960&q=80` |

```html
<img src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=960&q=80" style="width:640px; height:360px; object-fit:cover" />
```

来源记在 `resources.images[].credit`。Unsplash 许可以该站当时的条款为准。

## 配色

| 名字 | 用途 |
| --- | --- |
| `night` | 底 `#0c1424`，字 `#f4ecdf`，强调 `#e8b04a` |
| `paper` | 底 `#f4f1ea`，字 `#0e1219`，强调 `#3ecfc4`，线条 `#f5c16c` |
| `halving` | 底 `#0f1115`，字 `#ffffff`，强调 `#f7931a` |

## 效果名

这些是属性的取值，不是标签。

| 属性 | 可以写 |
| --- | --- |
| `grade` | `lomo`、`matte`、`chrome`、`bleach`、`mono`。强度和单项改动写在后面，如 `lomo 0.8, fade 0.1` |
| `glass` | `clear`、`regular`、`thick`，或 `clear, blur 8, tint #fff2` |
| `blend` | `source-over`、`multiply`、`screen`、`overlay`、`soft-light`、`lighten`、`darken` |

`grade` 和 `grade-mask` 只写在 `layer` 上。
