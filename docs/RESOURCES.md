# Resources

Use these names and URLs when generating a picture. Fonts, images, palettes, and effect names match the current implementation. In code, `import { resources } from 'flexlayer'`, then `resources.font('楷体')`, `resources.recommendedFont('得意黑')`, `resources.image('lake')`, `resources.palettes.night`.

## Fonts

Write `font-family="Song"` or `style="font-family:Inter"`. The default is `ChillDuanSans`. The first time a name is used, the font file downloads to `~/.cache/flexlayer/fonts`.

`<font src>` wants a font file (ttf, otf, woff, ttc, otc). A `fonts.googleapis.com` CSS URL is not a font file, and using it fails the download. Google fonts in this catalog already point at files on jsDelivr. Write the name.

`.ttc` and `.otc` are collections with several faces. With no index, face 0 is used. For Source Han and Noto CJK, face 0 is Japanese, so a character that differs between simplified, traditional, and Japanese (such as 复) comes out wrong. Simplified Chinese is `src="SourceHanSans.ttc#2"`. The number after `#` is a zero-based index, not part of the file name.

When both 400 and 700 are registered, the nearest one is used. A family with only one face keeps that face for a bold title. `Symbols` is the icon font. Weight snaps to the nearest hundred from 100 to 700. Write `<span class="material-symbols-outlined">home</span>` and set the weight with `font-weight`. `ChillDuanSans` is a variable font, with a weight axis of about 300 to 800. Its outlines exist only at the default weight 300.

When a simplified-Chinese subset has no complete Latin glyphs, missing characters fall back to `ChillDuanSans`. Latin subsets do not contain Han characters.

The Alias column is text you can pass to `font-family`. Those strings are part of the API.

| Name | Aliases | Weights | Coverage | Use | Source |
| --- | --- | --- | --- | --- | --- |
| `ChillDuanSans` | 寒蝉端黑体 | variable 300–800 | Simplified Chinese, Latin | Default body text | ChillDuanSans |
| `Song` | 宋体, 思源宋体 | 400, 700 | Simplified Chinese | Song body text | Noto Serif SC |
| `Kai` | 楷体, 霞鹜文楷 | 400, 700 | Simplified Chinese | Kai | LXGW WenKai |
| `Brush` | 书法, 毛笔 | 400 | Simplified Chinese | Calligraphic titles | Ma Shan Zheng |
| `Inter` | | 400, 700 | Latin | English body text | Inter |
| `JetBrainsMono` | jetbrains mono, 等宽 | 400, 700 | Latin | Code and monospace | JetBrains Mono |
| `Playfair` | Playfair Display | 400, 700 | Latin | English titles | Playfair Display |
| `Baskerville` | Libre Baskerville | 400, 700 | Latin | English body serif | Libre Baskerville |
| `Oswald` | | 400, 700 | Latin | Condensed titles | Oswald |
| `SpaceGrotesk` | Space Grotesk | 400, 700 | Latin | Geometric sans | Space Grotesk |
| `Cormorant` | Cormorant Garamond | 400, 700 | Latin | Light serif | Cormorant Garamond |
| `Bebas` | Bebas Neue | 400 | Latin | All-caps display | Bebas Neue |
| `Newsreader` | | 400, 700 | Latin | Reading serif | Newsreader |
| `Fraunces` | | 400, 700 | Latin | Soft serif titles | Fraunces |
| `Instrument` | Instrument Serif | 400 | Latin | Display serif | Instrument Serif |
| `STIXTwoMath` | STIX Two Math | 400 | Latin, Greek, math symbols | Formulas only. It has a MATH table. Other fonts cannot set formulas | STIX Two Math |
| `NotoSans` | 思源黑体 | 400, 700 | Simplified Chinese | Gothic body text | Noto Sans SC |
| `XiaoWei` | 站酷小薇 | 400 | Simplified Chinese | Song-like titles | ZCOOL XiaoWei |
| `KuaiLe` | 站酷快乐体 | 400 | Simplified Chinese | Lively titles | ZCOOL KuaiLe |
| `MaoCao` | 刘建毛草 | 400 | Simplified Chinese | Handwriting | Liu Jian Mao Cao |
| `Symbols` | 图标 | 100–700 | Icons | Icons | Material Symbols Outlined |

```html
<layer width="720" height="360" background="#0c1424" color="#f4ecdf" font-family="Song">
  <layer x="48" y="64">
    <h1 style="font-family:XiaoWei; font-size:96px">春眠不觉晓</h1>
    <p style="font-family:Inter; font-size:28px">Hello</p>
  </layer>
</layer>
```

## Recommended fonts

Pick by mood. The heavy gothic group comes first. In code, `resources.recommendedFonts`. `resources.recommendedFont('得意黑')` returns that group and the name.

`group` and `title` are the strings the API returns. They stay in Chinese because `recommendedFont` looks them up that way. ChillDuanSans is already in the catalog above and is used when `font-family` is omitted. The other names are for choosing a face. You supply the file under the root. `src` can be a relative path or a URL of a font file.

| Group | Mood | Name | Title you can pass | Use |
| --- | --- | --- | --- | --- |
| 粗黑体 | Heavy gothic | `ChillDuanSans` | 寒蝉端黑体 | Main titles. Default font. API `use` is 主标题 |
| 瘦黑体 | Condensed gothic | `DeYiHei` | 得意黑 | Tall condensed gothic. API `use` is 细长黑体 |
| 瘦黑体 | Condensed gothic | `ZhuoTeQingYaTi` | 卓特清雅体 | Tall condensed gothic. API `use` is 细长黑体 |
| 圆体 | Rounded | `JingNanBoBoHei` | 荆南波波黑体 | Rounded titles. API `use` is 圆角标题 |
| 圆体 | Rounded | `JingNanYuanTi` | 荆南圆体 | Rounded titles. API `use` is 圆角标题 |
| 圆体 | Rounded | `MaoKenZhuYuanTi` | 猫啃珠圆体 | Rounded titles. API `use` is 圆角标题 |
| 圆体 | Rounded | `TangYuanTi` | 猫啃糖圆体 | Rounded titles. API `use` is 圆角标题 |
| 宋体 | Song | `FengYaSong` | 猫啃风雅宋体 | Song titles and body. API `use` is 宋体标题与正文 |
| 宋体 | Song | `NaXiChuXiaSong` | 南西初夏宋体 | Song titles and body. API `use` is 宋体标题与正文 |
| 手写体 | Handwriting | `YeZiGongChangXiaoShiTou` | 也字工厂小石头体 | Handwriting. API `use` is 手写 |
| 广告体 | Advertising | `DouYuZhuiGuangTi` | 斗鱼追光体 | Advertising titles. API `use` is 广告标题 |

```html
<font family="DeYiHei" src="fonts/deyihei.otf" />
```

Icons use `class="material-symbols-outlined"` and an icon name inside. Set the weight with `font-weight`. When omitted, it follows the surrounding weight. When the size is omitted, it follows the surrounding `font-size`. Set the color in `style`. This is the outlined set.

```html
<div style="display:flex; align-items:center; gap:12px; font-size:40px; color:#f4ecdf">
  <span class="material-symbols-outlined">home</span>
  <span>Home</span>
</div>
```

## Images

`img` `src` can be a relative path, or an http(s) URL that returns image bytes directly. These three are cropped samples, about 960 wide.

| Name | Picture | URL |
| --- | --- | --- |
| `lake` | Mountain lake | `https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=960&q=80` |
| `valley` | Valley | `https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=960&q=80` |
| `forest` | Forest | `https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=960&q=80` |

```html
<img src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=960&q=80" style="width:640px; height:360px; object-fit:cover" />
```

Credits are in `resources.images[].credit`. The Unsplash license is whatever that site's terms were at the time.

## Palettes

| Name | Use |
| --- | --- |
| `night` | Ground `#0c1424`, type `#f4ecdf`, accent `#e8b04a` |
| `paper` | Ground `#f4f1ea`, type `#0e1219`, accent `#3ecfc4`, line `#f5c16c` |
| `halving` | Ground `#0f1115`, type `#ffffff`, accent `#f7931a` |

## Effect names

These are attribute values, not tags.

| Attribute | You can write |
| --- | --- |
| `grade` | `lomo`, `matte`, `chrome`, `bleach`, `mono`. Amount and single-parameter overrides follow, as in `lomo 0.8, fade 0.1` |
| `glass` | `clear`, `regular`, `thick`, or `clear, blur 8, tint #fff2` |
| `blend` | `source-over`, `multiply`, `screen`, `overlay`, `soft-light`, `lighten`, `darken` |

`grade` and `grade-mask` are written only on `layer`.
