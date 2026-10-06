# Flex Layer 文档与效果规则统一规划

本分支已按下面的步骤落地。规范正文在 SPEC.md，给模型的入口是 AGENTS.md。

把分散在 8 份文档里的重复规则收敛到 SPEC 一处，用问题码作为规则编号；效果按族归类、用统一模板描述；效果图按族做成网格图并可一键重渲染；最后可选地引入属性注册表，并统一预设语法、做 API 改名。

## 默认决定（可随时改）

- 预设类效果统一成 `预设 [强度], 参数 值, …`：`glass` 新增逗号写法，旧的空格写法继续兼容（放在最后一步，属于代码改动）。
- API 新增 `renderLayer`，保留 `renderFvg` 作为别名；文档只写新名字。
- 入口文件 `AI.md` 改名为 `AGENTS.md`，并更新所有链接。
- 效果图放到 `docs/gallery/`；`examples/` 只保留完整作品。
- 属性注册表放在最后一步，作为可选项。

## 目标结构

```text
AGENTS.md          入口：硬性约定表 + 工作流
  ├─ SPEC.md       唯一规范（问题码表 = 规则编号）
  ├─ CHEATSHEET    一页写法，不重复解释规则
  ├─ EFFECTS.md    只留设计取舍和实现备注
  └─ GALLERY.md    效果 → 代码片段 → 图格
       └─ docs/gallery/*.layer + png

有数据或动画时写 .tsx（examples/）。不再另接 Vue 或 React。
```

规则正文只在 SPEC 里写一次。其它文档只做索引、速查或备注。规则一律通过问题码（如 `invalid-attr`）引用。

## 第 1 步：只修错

- `AI.md`：把「SPEC §9 问题码表」改成正确的章节号（问题码表现在在 §8）。
- `MATHML.md`：移到 `docs/proposals/MATHML.md`，开头标注「未实现」；把 `row`、`column`、`layer` 改成 `<div style="display:flex">` 和 `layer`。
- `SPEC.md` §12：删掉预留名里的 `Image`（`image` 已是 `img` 的别名）。
- `docs/EFFECTS.md`：把「六个参数」改成和 SPEC 一致的八个参数说法。
- `SPEC.md`：把效果表从 §7「线条」里移出来，单独成章。

## 第 2 步：文档去重与重排

重排 `SPEC.md` 章节：

1. 文件结构
2. 元素
3. 通用属性与归属（唯一一张归属总表）
4. 容器
5. 文字
6. 图片
7. 形状与线条
8. 填充 paint
9. 效果
10. 报告与问题码
11. 命令行
12. draw
13. 帧序列
14. 预留名

其它文档：

- `AI.md` 改名为 `AGENTS.md`。写出唯一一份硬性约定表，列：规则、错误写法、正确写法、问题码。原来 §2.1、§5、§6 里重复的内容合并进这张表。
- `docs/CHEATSHEET.md`：保留写法示例，删掉规则解释，改成链接到硬性约定。
- `GENERATE.md`、`generate/COMPONENTS.md` 后来随 Vue / React 生成层一起删除。规则只留在 SPEC 和 AGENTS。
- `README.md`：删掉重复的 layer 背景等规则，改成一句话加链接。
- `docs/EFFECTS.md`：删掉「已实现」表和绘制顺序，只保留算法、取舍和实现触点。
- 全仓替换文档里的 `AI.md` 链接。

## 第 3 步：效果按族归类，套用统一模板

SPEC 第 9 章分四个小节：

- 投影发光：`shadow`、`glow`、`inner-shadow`、`inner-glow`，共用一张语法表。
- 模糊与透视：`blur`、`backdrop-blur`、`glass`，附「选哪个」的对照表。
- 调色：`filter`、`grade` + `grade-mask`、`overlay`，附决策表（简单调亮度或灰度、风格调色、叠一层颜色分别用哪个）。
- 合成与质感：`blend`、`noise`。

每个效果固定写这几项：归属、语法、是否复用 paint、作用范围（按墨迹）、在绘制流水线中的位置、报告回显和问题码、对应图格、保留名。

再加一条总规则「作用于整棵子树的效果只写在 layer 上」，覆盖 `overlay`、`grade`、`grade-mask`。绘制流水线只在第 9 章开头写一次。

## 第 4 步：效果图库

- 新建 `docs/gallery/`，按族各做一张带标注的网格图，样式沿用 `examples/effects-gallery.layer`：`shadow-glow`、`blur-glass`、`color`（grade 五个预设对比同一张图，加一格遮罩）、`paint`（渐变）、`image`（`object-fit` 四种）、`text`。
- glass 从 6 张合并到 2 张：预设对比基于 `glass-compare`，真实场景基于 `glass-ios`。其余的 `glass-clear`、`glass-frost`、`glass-refract`、`effects-liquid-glass` 删除，或并入这两张。
- 新建 `docs/GALLERY.md`：列出效果、最小代码片段、对应哪张图的哪一格。
- `package.json` 增加 `"gallery"` 脚本，重渲染 `docs/gallery/*.layer` 和 `examples/*.layer`。
- 增加一个测试：效果属性（从 `src/style.ts` 或第 5 步的注册表读取）都必须至少在一个 gallery 文件里出现。

## 第 5 步（可选）：属性注册表、语法统一、API 改名

- 新建 `src/schema.ts`，每个属性记录名称、归属、语法、默认值、示例和问题码。`src/rules.ts` 的 `HTML_STYLE_ATTRS` 和「仅 layer」检查改为读取这张表。`src/jsx-intrinsics.ts` 也对齐到这张表。
- 增加一个脚本，从注册表生成 SPEC 归属总表和 CHEATSHEET 效果行（写入标记区块之间）。
- `glass` 支持 `clear, blur 8, tint #fff2` 这种逗号写法，旧写法继续兼容；在 `src/style.ts` 中实现，并补测试。
- 在 `src/index.ts` 导出 `renderLayer`，保留 `renderFvg` 作为别名；文档统一改用新名字。

## 验证

每一步都要通过 `npm test`。第 4 步之后还要跑 `npm run gallery`，并用肉眼核对生成的图。
