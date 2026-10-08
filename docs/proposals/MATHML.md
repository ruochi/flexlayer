# MathML 实现备注

写法和规则以 [SPEC.md](../../SPEC.md) 为准。本文只记实现在哪、怎么排的。

## 代码在哪

| 文件 | 内容 |
| --- | --- |
| `src/math/layout.ts` | 每种标签怎么排。输出普通的 `flex`、`text`、`shape`（分数线、横线）和 `line`（伸长的字形路径）节点 |
| `src/math/rules.ts` | 标签名单、运算符分类、TeX 原子间距表、`mathvariant` 字母表、重音和撇号 |
| `src/math/font.ts` | 载入 STIX Two Math，MATH 常量换算成像素，挑字形变体，拼接件拼长括号和根号 |
| `src/math/opentype.ts` | 读 woff / sfnt：`cmap`、`hmtx`、`glyf` 轮廓和 MATH 表 |

## 排法

每一块排完是一个盒子，记着宽、基线上方高度 `ascent`、基线下方深度 `descent`、斜体修正和 TeX 原子类别。容器把子块按基线摆好，再把子节点的 `x`、`y` 写成相对容器左上角的坐标。绘制和报告不认识公式，只看到普通节点。

- 普通记号用画布按 STIX Two Math 绘制，盒子贴着着墨。公式不接受别的字体：间距、斜体修正和伸长字形都从这套字体的 MATH 表来，换普通字体会对不上。写了别的 `font-family` 报 `invalid-attr` 并忽略。`mtext` 仍用外面的文字字体。
- 大号求和、积分、伸长的括号、根号和宽重音不用画布字形，而是从字体里取对应变体或拼接件的轮廓，画成填充路径。画布只能按码位取字，取不到这些变体。
- 间距和位移来自 MATH 表：`AxisHeight`、`Fraction*`、`Superscript*`、`Subscript*`、`UpperLimit*`、`LowerLimit*`、`Radical*`、`AccentBaseHeight`、`Overbar*`、`Underbar*`、`DisplayOperatorMinHeight`、`ScriptPercentScaleDown` 等，算法跟 MathML Core 一致。
- 上标沿用 TeX 的做法：基座是单个记号时不看它的高度，所以 `a²` 和 `b²` 的 2 一样高。
- 原子间距用 TeX 的 8×8 表。二元运算符在行首或跟在运算符、关系符、左括号、标点后面时改成普通原子。
- 括号先按栈配对，每对按中间内容的高度伸长。这样 `f(x) = { …表格… }` 里的 `( )` 不会被大括号拉高。

## 还没做

`menclose`、`mpadded`、`mmultiscripts`、`mfenced`、换行、`maligngroup`，以及 MATH 表里的数学字距（`MathKernInfo`）和重音锚点（`MathTopAccentAttachment`）。
