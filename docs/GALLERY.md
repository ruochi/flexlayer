# 效果图

每张图是一张网格，格子下面是属性名。源文件在 [docs/gallery/](gallery/)。`npm run gallery` 检测这些图和 examples 里的 `.layer`，有 error 则失败，并重渲染说明里的图。

| 图 | 格子 |
| --- | --- |
| [shadow-glow.png](gallery/shadow-glow.png) | `shadow`、`glow`、`inner-shadow`、`inner-glow`、`noise`、`blend` |
| [blur-glass.png](gallery/blur-glass.png) | 同一组条纹上对比 `glass="clear"`、`regular`、`thick`；另有 `blur`、`backdrop-blur`、逗号写法 |
| [glass-scene.png](gallery/glass-scene.png) | `glass="clear"` 放在锁屏式背景上 |
| [color.png](gallery/color.png) | `filter`、`overlay`；`grade` 五档预设和 `grade-mask` 用同一张 `scene.png` |
| [paint.png](gallery/paint.png) | `linear-gradient`、`radial-gradient`、`gradient()` 矩阵与锥形 |
| [image.png](gallery/image.png) | `object-fit` 的 `fill`、`contain`、`cover`、`none` |
| [text.png](gallery/text.png) | 标题字号、`max-width` 换行、flex 间距、`writing-mode:vertical-rl` |
| [flex.png](gallery/flex.png) | `flex-wrap` 的标签云，以及 `column-gap` / `row-gap` 的卡片网格 |

最小写法：

```html
<rect x="20" y="20" width="200" height="120" rx="16" fill="#3ecfc4" shadow="0 12 20 #00000088" />
<rect x="20" y="20" width="200" height="120" rx="16" fill="#ffffff18" glass="clear, blur 8, tint #a8c8ff55" />
<layer grade="lomo 0.8, fade 0.1" grade-mask="radial-gradient(#fff0 30%, #fff)">
  <img src="cover.png" style="width:320px; height:200px; object-fit:cover" />
</layer>
```

语法以 [SPEC.md 第 8、9 章](../SPEC.md) 为准。
