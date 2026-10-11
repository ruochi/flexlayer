# Flex Layer 滤镜 / 效果

现行规范见 [SPEC.md 第 9 章](../SPEC.md)。本文记录设计取舍与实现备注。

## 已实现

| 属性 | 说明 |
| --- | --- |
| `shadow` / `glow` | 外阴影 / 外发光 |
| `inner-shadow` / `inner-glow` | 内阴影 / 内发光（clip + 离屏挖空） |
| `stroke` | 纯色在形状和线条上居中；`宽度 颜色 [outside\|inside\|center]` 按墨迹距离描，可多层 |
| `blur` | 图层模糊（含 layer 子树合成后再糊） |
| `backdrop-blur` | 背景模糊（采样主画布已有像素） |
| `glass` | iOS Liquid Glass：边缘弧面折射 + 色散 + 朝光高光，`clear` 零模糊 |
| `noise` | 确定性噪点，`soft-light` 叠加 |
| `overlay` | **仅 layer**：纯色 / 渐变叠加，`paint [opacity] [blend]`，按子树墨迹裁切 |
| `filter` | 色彩滤镜（brightness / contrast / saturate / grayscale / hue-rotate / sepia / invert） |
| `blend` | 混合模式子集 |
| `grade` / `grade-mask` | **仅 layer**：调色（六参数 + `warmth` 或预设），遮罩 alpha 控制各处强度 |
| `<mask>` | **仅 layer 的直接子元素**：用里面形状 / `img` 的 alpha 裁整层合成结果。`grade-mask` 不是这个 |

归属：layer / 图形 / 线条 → 属性；文字 / flex HTML → `style`。**`overlay`、`grade`、`grade-mask` 例外：只允许写在 `layer` 上。** `<mask>` 是标签，不是属性。

绘制顺序：`backdrop-blur` / `glass` 取样 → `shadow` → `glow` → 外描边（`stroke` 的 outside 与 center 外半）→ 本体（`overflow="hidden"` 在这里裁子元素）→ 内描边（inside 与 center 内半）→ `inner-shadow` → `inner-glow` → `overlay` → `noise`；若有 `blur`、`filter`、`grade`、其它已注册滤镜或 `<mask>`，先画进离屏，依次做像素滤镜（含 `grade`）、`blur` / 画布滤镜（含 `filter`），有像素滤镜时再叠 `noise`，然后按 `<mask>` 的 alpha 裁掉，再贴回。画布底色不进 `<mask>`。

## 墨迹原则

所有效果跟**着墨 alpha**，不跟布局 `box`：

| 元素 | 墨迹是什么 |
| --- | --- |
| 文字 | 字形（若有 `background` 则加上背景块） |
| 形状 / 线 | 填充与描边几何 |
| layer | `shadow` / `glow` 跟着子树墨迹；这一层是三维场景时跟着已经画好的画面。其余效果只算自身 `border` / `<draw>`（**无** `background`） |
| flex | `shadow` / `glow` 跟着子树墨迹（含自身 `background` / `border`）。其余效果只算自身背景和边框 |
| `blur` / `filter` / `blend` | 该节点已绘制像素（含子树合成） |

因此文字 `shadow` 是字形投影，不会落成一块矩形雾斑。文字和图片的 `spread`（含 `inner-shadow` / `inner-glow`）按这份 alpha 做距离膨胀或收缩：正数外扩，负数用内侧距离吃进去。形状和盒子背景仍按几何外扩。

## `stroke` 描边

同一个名字两套几何。形状和线条写颜料时走 SVG：描边居中，宽度是 `stroke-width`。第一个词是正的宽度时走距离场：`<宽度> <颜色或渐变> [outside | inside | center]`，逗号分隔多层，从内到外。宽度是到墨迹的总距离，所以 `6 #fff, 14 #f00` 是 0–6 白、6–14 红。默认 `outside`。文字、图片、`layer` 和 flex 没有居中描边，只写颜料时当成外侧距离描边，没写 `stroke-width` 时宽度是 4。渐变坐标按元素盒子，与 `fill` 一样。

文字默认外侧，是因为居中的 `-webkit-text-stroke` 会吃细中文笔画、转角出尖刺。`outline` 按盒子描，留着不用。

距离场只在元素墨迹外框加上最大外描边宽度的范围内计算（Felzenszwalb 二维 EDT，与 `glass`、文字 `spread` 共用）。`outside` 取墨迹外侧 `0 < d ≤ w`，`inside` 取内侧，`center` 两侧各 `w / 2`。外缘在 `d = w` 处约 1px smoothstep。转角是圆角，没有 miter。当前变换带了旋转或错切时，距离场改在屏幕像素里按 4 倍采样，平均缩回后再 1:1 贴上，避免把正的覆盖蒙版最近邻转上去。网格折线画在超采样缓冲上，和填充一起平均缩回，斜边用同一套抗锯齿。

写在 layer、flex 或 `<g>` 上时，先把子树墨迹合成一张再求距离，重叠的字只有一圈外轮廓。flex 的背景和边框算进这圈。这一层是三维场景时，描边、阴影和发光跟着已经画好的画面。`shadow` / `glow` 的轮廓是本体并上外侧描边，再应用 `spread`。`overlay` 只染本体：蒙版是子树墨迹，内侧描边会从蒙版里挖掉，所以 Layer 渐变字加纯色描边时，描边不会被渐变盖住。

网格折线被可见范围裁断时，光栅在裁掉的那一边多留出线宽。圆头落在窗口外面，贴边的线被窗口裁齐。平面位图里全透明的像素不写深度，父层转了以后，空的地方不会把盒子远侧的棱吃掉。

`inside` / `center` 的内侧宽度 ≥ 字号约 8% 时报告 `stroke-fill`。文字 style 里写 `-webkit-text-stroke`，或 HTML 上写 `outline`，报 `non-canonical`，hint 指向 `stroke`。写 `ink-stroke` 报 `invalid-attr`。

## `glass` 透镜

参照 iOS 26 Liquid Glass 与社区复刻（LiquidLens、liquid-glass-js、Outpace 等）的共同做法：玻璃是一块**中心平坦、边缘凸起**的厚片，光线只在边缘弧面发生弯折，中心看到的背景不变形。Liquid Glass 的辨识度来自「边缘透镜」，不是模糊。

实现（`src/paint.ts` `paintGlass`）：

1. **距离场**：对墨迹 alpha 做精确欧氏距离变换（Felzenszwalb EDT），得到每个像素到墨迹边缘的距离 `d`；轻微盒式平滑后取梯度作为向内法线。任何墨迹（圆角矩形、圆、文字）都能用，不依赖形状公式。
2. **弧面带**：`bezel = min(短边 × 24%, 64px, 内切半径)`。`d ≥ bezel` 的像素原样复制背景；弧面带内按 `t = d / bezel` 查位移表。
3. **位移曲线**：`shift = S·(1-t)²`，`S = bezel × 0.5 × refraction`。内沿处位移与斜率都归零，和平坦区无缝；`S ≤ bezel/2` 保证 `d + shift` 单调，背景在边缘被连续放大，不会翻折或被拉成一条线。
   - 试过按 squircle 表面 + Snell 定律（n=1.5）直接算位移：边缘斜率趋于无穷，整条弧面带几乎取同一条等距线，单帧里表现为放射状拉丝；故改用上面的平滑曲线，保留「边缘放大、中心清晰」的观感。
4. **取样**：沿法线向内偏移后双线性取样。`dispersion` > 0 时 R/G/B 用略不同的位移，边缘出现细微色散。
5. **高光**：外法线朝左上光源的一侧最亮，对侧有较弱回光；由边缘 1px 亮线 + 弧面内的柔光组成。
6. **模糊**：只有 `blur > 0` 才先糊背景再折射；`clear` 预设为 0。
7. **投影**：先取样背景，再画投影，最后贴玻璃，投影不会被玻璃「透」出来。

| 预设 | blur | refraction | bezel | dispersion | 默认色调 |
| --- | --- | --- | --- | --- | --- |
| `clear` | 0 | 1 | 0.24 | 0.06 | 无 |
| `regular` | 6 | 0.85 | 0.22 | 0.04 | `#ffffff14` |
| `thick` | 36 | 0.5 | 0.2 | 0 | `#ffffff2a` |

做不到：设备姿态实时高光、多层玻璃互相折射、系统级自适应明暗。

## `grade` 调色

给 AI 的入口只有三样：六个参数（`shadows`、`highlights`、`contrast`、`fade`、`saturate`、`vignette`，加上可选的 `midtones`、`warmth`）、一个预设名、一个遮罩。预设只是参数的一套固定值（`src/grade.ts` `GRADE_PRESETS`），没有单独的算法；报告回显展开后的值。

`grade` 是登记在 `src/filter.ts` 上的像素滤镜（`includeBackdrop`，遮罩属性 `grade-mask`）。`apply` 调用 `src/grade.ts` 的 `applyGrade`，在离屏缓冲上原地改像素：

1. 像素转 OKLab。
2. `contrast`：以 L=0.5 为支点缩放 L。`fade`：`L = f + L·(1-f)`，`f = fade × 0.3`。
3. `saturate`：a、b 乘系数。排在染色之前，黑白也能再染冷暖。
4. `warmth`：a、b 沿 (0.02, 0.06) 方向平移。
5. 三段染色：权重 `(1-L)²`、`2L(1-L)`、`L²`，各加一个 a/b 偏移。偏移方向取颜色的色相，大小 = `0.1 × 强度 × 鲜艳度`，鲜艳度 = `min(1, C / L / 0.25)`。这样深色（如 `#1a3040`）和浅色写同一色相时偏得差不多，不会因为颜色暗就失效；L 不变，颜色只管色相和浓淡。
6. `vignette`：到盒子中心的椭圆距离（角上为 1），`smoothstep(0.35, 1)` × 强度，混向暗角颜色。
7. 与原图按 `整体强度 × 遮罩 alpha` 混合；遮罩透明处像素原样保留。

- 遮罩用 `paintOf` 画到同尺寸离屏后取 alpha，所以纯色、CSS 渐变、`gradient()` 都能用，坐标按 layer 盒子。
- 根 layer 不走离屏：整幅画布画完后直接调色，画布底色也一起调。
- 预设名不用 `fade`，避免和参数 `fade 0.2` 撞名；哑光预设叫 `matte`。
- 按颜色选区（只调天空）和位置不对称的漏光不在 `grade` 里做：前者需要按色相取遮罩，后者用 `grade-mask` 或 `overlay`。

## 取舍

- `backdrop-blur` / `glass` 在主画布上采样，贴回时按墨迹 alpha 裁切。
- `glass` 与 `backdrop-blur` 同时出现时以 `glass` 为准（`info`）。
- `filter` 不含 `blur()` / `drop-shadow()`，避免与 `blur` / `shadow` 双通道。
- 同时写 `blur` 与 `filter`：模糊以 `blur` 为准，报 `info`。
- 勿占用：`outer-glow`、`drop-shadow`、`backdrop-filter`、`texture`、`outline`。

## 开放接口

新滤镜用 `registerFilter`（`src/filter.ts`）。内置的 `grade`（像素）和 `filter`（画布 CSS）也在这个接口上，绘制不再单独分支。

阴影、发光、玻璃、背景模糊、噪点、叠加不走这里：它们要墨迹轮廓或背后的像素，不是「这一层画完再改」。

`pixel` 滤镜的 `apply` 拿到非预乘 RGBA，按满强度改像素，用 `frame` 知道盒子在缓冲里的位置。有遮罩时，引擎在 `apply` 之后用遮罩 alpha 和调用前的像素混合。`includeBackdrop: true` 时，写在根 layer 上会连画布底色一起处理。`canvas` 滤镜只返回一段 CSS filter 字符串。

规范写法见 [SPEC.md 第 9.3 节](../SPEC.md)。

## 实现触点

- `src/filter.ts` — 滤镜注册、内置 `grade` / `filter`、从属性收集
- `src/style.ts` — `filter` 的 CSS 函数解析；其余效果的解析
- `src/grade.ts` — `grade` 的参数和像素算法
- `src/types.ts` / `src/layout.ts` — 字段与 `readEffects`
- `src/paint.ts` — 绘制；像素滤镜走 `applyPixelFilters`
- `src/rules.ts` / `src/jsx-intrinsics.ts` — 归属
- `src/report.ts` — 报告与 `effect-clipped`
