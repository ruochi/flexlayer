# 3D 渲染质量：这一轮怎么验收

给写 3D 代码的人。这里只写可验收的约定和判定方法；这一轮具体测了什么、哪张样张哪里坏了、门槛怎么标定，都在 `flexlayer-render` 的 `docs/quality/`，不在这份文件里。

## 1. 判定标准

一张 3D 样张算合格，要同时满足三条：

1. `docs/GALLERY-3D.md` 里对应那一行写的每一条都成立。
2. `gallery-metrics --check` 通过，而且每项实测值和门槛之间有余量，不是刚好压线。
3. 实测数字和肉眼结论不冲突。冲突时先怀疑度量，再下结论。

`docs/GALLERY-3D.md` 是白纸黑字的标准：每张图看的是哪几件事，写成句子。改标准要改那份文件，不能只在 PR 里口头说明。

## 2. 度量和门槛

- 门槛写在 `test/golden/gallery-metrics.json`，判断逻辑在 `scripts/metrics-gates.mjs`，测量在 `scripts/gallery-metrics.mjs` 和它引用的 `scripts/metrics-image.mjs`、`scripts/metrics-seat.mjs`。
- 每加一项度量，先在 PR 里拿一个已知有问题的提交跑一遍，必须失败。证明它抓得到问题，再谈门槛定在哪。
- 门槛只能收紧。确实测得不对，就修测量方法，并在 PR 里写明为什么原来的测法不成立。
- 度量要留余量：至少比门槛好两个跨平台码值余量（`platformSlack`）。实测值刚好等于门槛不算过。
- 物体级的度量用 `render --report` 里 `elements[].ink` 定位，所以 bench 里的每个实体都要写 `id`。

## 3. 对照

- 对照基准用提交号取，例如 `git show <commit>:docs/gallery/3d-still.png`，不要用 `HEAD`，也不要用工作区里的文件。看图前确认没有别的 agent 正在提交。
- 对照图一律左右拼接：左边参照，右边新图，下面附 FLIP 热图。`scripts/gallery-compare.mjs <refDir> <newDir> <outDir>`。
- 旧渲染器的对照图放在 `flexlayer-render` 的 `docs/quality/legacy-reference/`。CI 需要它时去那个仓库取，不在本仓库留副本。
- 看不清就裁剪放大再看，不要根据源码推测画面。

## 4. 输出阶段的约定

draft 和 final 走同一个出口：线性累加 → 曝光 → 色调映射 → sRGB。整帧只编码一次，不存在"某个矩形里走色调映射、矩形外走字节截断"的分叉。`tonemap="none"` 和 `"legacy"` 是整帧一致的字节截断。

`CHANGELOG.md` 里关于默认 tonemap 的说法必须和实际行为一致。

## 5. 二进制

- `flexlayer` 只加载 `native/flexlayer-render/*.node`。改了 Rust 就必须重编，否则 TS 侧看不到任何变化。
- 三份二进制来自同一个提交，且在干净的工作区编出。`node scripts/addon-hash.mjs` 会检查这一点。
- 合并顺序：先合 `flexlayer-render`，再合 `flexlayer`，后者用已经合进前者的提交来编。
