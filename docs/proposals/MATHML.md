# MathML 接入说明（未实现）

本文是草案，渲染器还没有公式。不要把 `<math>` 写进当前的 `.layer`：它会被当成不认识的标签丢掉（`unknown-tag`）。

实现时请按 dc 里已经画对的行为来做，不要另写一套间距。文字标签只有 `h1`、`h2`、`h3`、`p`、`div`、`span`，行内只有 `span`、`strong`、`b`、`em`、`br`。图片用 HTML 的 `img`（`image` 同样可用）。

## 参考代码在哪

dc 仓库 `packages/douchart-core/src/htmlBox/math/`：

| 文件 | 用途 |
| --- | --- |
| `tags.ts` | 支持的标签名单 |
| `operatorDict.ts` | 运算符左右空距、求和改上下限、积分号放大、分数线粗细、根号钩宽 |
| `map.ts` | 每种标签变成什么结构。只参考结构，不要引用它的类型 |
| `stretch.ts` | 根号随内容变高 |
| `../paint.ts` 里的 `paintMathSqrtPath` | 根号笔画形状 |

对照用例：

- `packages/douchart-core/src/htmlBox/math/map.spec.ts`
- `packages/client/src/utils/addHtmlBoxTestCases.ts` 里的 math 段

## 不要整个引进 htmlBox

`map.ts` 输出的是 htmlBox 自己的盒子树 `HtmlBoxNode`，不是 Flex Layer 节点。根号拉高和分数线笔画绑着 htmlBox 的测量，以及旧管线的全局间距。

Flex Layer 只复用规则，自己画。建议抽一个两边都能用的小模块：输入 MathML，输出中性结构（横向组、纵向组、文字、分数线、根号）。dc 再把它转成 `HtmlBoxNode`，Flex Layer 把它画成 `layer` 里的 flex、文字和线条。规则只留一份。`.layer` 里不要出现 `row`、`column` 标签。

## 标签子集

`math`、`mrow`、`mi`、`mn`、`mo`、`mtext`、`mfrac`、`msub`、`msup`、`msubsup`、`msqrt`、`mroot`、`munder`、`mover`、`munderover`、`mtable`、`mtr`、`mtd`。

## 映射规则

- `math`、`mrow` 是横向排布，子项居中，间距 0。运算符的空隙由 `mo` 的左右空距决定，不靠 `gap`。空距查 `operatorDict.ts` 的 `moSpacingEm`。
- `mi`、`mn`、`mtext` 是文字。`mo` 是运算符。
- `mfrac` 是纵向排布：分子、分数线、分母。分子分母字号乘 `MFRAC_SCRIPT_SCALE`（0.85）。线上下缝是 `MFRAC_GAP_EM`（0.28em）。线厚用 `mathRuleThicknessPx`，颜色跟公式文字色。
- `msub`、`msup`、`msubsup` 默认是基座旁边的上下标。上下标字号用 htmlBox 的 `SUP_SUB_SIZE_RATIO`，叠在同一列，不是先写上标再写下标。
- 基座是 `∑ ∏ ∐ ⋀ ⋁ ⋂ ⋃` 或 `lim max min sup inf` 时，上下标改到正下方、正上方（`isMovableLimitsOp`）。
- 基座是 `∫ ∬ ∭ ∮ ∯ ∰` 时，限在符号右侧上下，不要和被积式收成同一段文字。积分号字号乘 `INTEGRAL_SIZE_RATIO`（1.35）。
- `msqrt` 左侧是一条随内容变高的根号笔画，不是一个大对勾字符。钩宽见 `MSQRT_SURD_WIDTH_EM`、`MSQRT_SURD_WIDTH_RATIO`。笔画形状抄 `paintMathSqrtPath`：小钩在左下，斜笔收到勾的中部，横线盖住被开方内容。
- `mroot` 是指数（缩小字号）加一个 `msqrt`，指数在左上。
- `munder`、`mover`、`munderover` 是纵向叠放。
- `mtable` 是纵向套若干横向行，行距 `0.2em`，单元格间距 `0.45em`。

## 在 Flex Layer 里怎么写

Flex Layer 的文字盒子里不能再套布局。公式实现之后，`<math>` 是布局节点，放在 `layer` 里，或放进 `display:flex` 的 `div`。和正文同一行时：

```html
<layer x="80" y="120">
  <div style="display:flex; gap:8px; align-items:center">
    <span>因此</span>
    <math>
      <mi>π</mi><mo>≈</mo><mn>4</mn><mo>·</mo>
      <mfrac><mi>N</mi><mi>M</mi></mfrac>
    </math>
  </div>
</layer>
```

## 至少要覆盖的用例

分数、上下标、`msubsup` 叠在同一列、求和改上下限、积分限在右侧、根号、开方指数、极限、矩阵。
