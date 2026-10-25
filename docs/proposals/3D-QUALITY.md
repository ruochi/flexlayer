# 3D 渲染质量修复计划

给在 Cursor 里接手的 agent。只读这一份就能开工，需要细节再按文中的 `文件:行号` 去看源码。行号以 2026-10-24 的 main 为准（flexlayer `7a21bc0`，flexlayer-render `f9628c0`），改动后可能偏移。

## 0. 结论先行

0.15 起 3D 默认走 kernel 路径（提交 `180c494`）。结果 `docs/gallery/3d-*.png` 每张都不合格，评分 3–5/10。同一场景用 `FLEXLAYER_3D=legacy` 渲染，toon、manga、draft 三项明显比 kernel 好。

问题不在某个参数，而在三件事：

1. **kernel 没有统一的输出阶段。** draft 和 final 的曝光不一致。tonemap 和 environment 属性虽然被解析，但没传进 kernel。灯光光池直接叠加到 255，被截成纯白。
2. **legacy 的风格化能力没有移植过来。** cel 分阶、贴着表面的 manga 排线、bloom 都还留在旧路径。kernel 里 `post::apply_look` 只是屏幕空间的简化版。
3. **没有能拦住画面退化的检查。** golden 只覆盖一个 64×48 的小球，CI 只看耗时。画面坏了，测试照样全绿。

所以顺序是：**先建度量和对照，再修输出阶段，再修材质和风格，最后清理旧路径。** 每一步都要先有数字标准，再改代码。

## 1. 工作约定

- 两个仓库：`ruochi/flexlayer`（TS，npm 包）和 `ruochi/flexlayer-render`（Rust napi 插件）。flexlayer 只加载 `native/flexlayer-render/*.node` 预编译二进制。改了 Rust，必须重编三份二进制并拷进 flexlayer，否则 TS 侧看不到任何变化。
- 重编三份用 `cd flexlayer-render && npm run build:platforms`，需要 zig 和 cargo-xwin。再用 `npm run export-binary` 拷进 flexlayer。只重编 linux 一份是 Mac 二进制长期落后的根源，禁止这样做。见 P0-3。
- 合入 main 时，按 `AGENTS.md` 升 patch 版本，并写 `CHANGELOG.md`。去掉旧语法要升 minor。
- 一个 PR 只解决一个阶段里的一个问题。PR 描述里贴上改动前后的度量表（见 P0-1），以及改动前后的样张。
- `npm run gallery:3d` 会重写 `docs/gallery/`。只提交 Linux 上渲染的样张。不要用 `expect` 压掉 `overflow-canvas`。
- 改光照或材质，像素测试一定会变。逐个确认后再改目标值，不要整批改。会受影响的测试列在第 4 节。
- legacy 路径（`FLEXLAYER_3D=legacy`，Rust `mesh_fill.rs`）在 P4 完成、达到同等效果之前不能删。它是移植的参照物。

### 看图

验收以 P0-1 的数字为准，但每个 PR 仍然要有人或能看图的模型亲眼看一遍样张。下面这类问题数字不一定抓得到：

- 物体浮在地面上
- 交线缺失
- 莫尔纹

看图时只描述看到了什么。看不清就把那块裁出来放大再看（`sips -c h w --cropOffset y x in.png --out crop.png`，或者用 sharp）。不要凭源码推测画面。

## 2. 诊断

下表的数据在 Mac 上实测，与 Linux 样张的 FLIP 差异在 0.004 以内。

### 2.1 draft 与 final 的曝光不一致（最严重：默认就是 draft）

`3d-quality-draft.layer` 和 `3d-quality-final.layer` 只差 `quality` 一个属性。相机区域（上方 540 行）统计如下：

| | RGB 均值 | R−B（暖度） | 暗像素（Y<40） | 过曝（Y>250） |
| --- | --- | --- | --- | --- |
| draft | 217,214,204 | 13.1 | 2.4% | **9.7%** |
| final | 184,181,173 | 10.8 | 1.1% | 0.0% |

两档的白平衡差不多。真正的差别是 draft 亮了约 33/255，而且有一成像素被截成白色：左侧地面那片青白光斑，和右侧灯下的白斑。

原因如下：

- 灯光光池在 `paint_grounds` 里按字节直接叠加，然后 `clamp(0,255)`，见 `flexlayer-render/src/kernel/fill.rs:1208-1260`，截断在 1257 行。叠加发生在阴影墨色之后，所以阴影也被抬亮了。叠加时没有软膝，多盏灯或者亮地面都会直接截白。
- final 额外有 `final_rays` 的遮蔽（`0.9+0.1*ao`，`fill.rs:793-830`）和 `apply_contact`（最多压暗 35%，`fill.rs:1814-1855`）。所以 final 看起来"正常"，其实只是被这两步压暗了。draft 没有这两步，过曝就暴露出来了。
- kernel 路径上没有色调映射。`shade_surface`（`kernel/shade.rs:437-518`）在 sRGB 字节空间里混色、加光、截断。`tonemap_neutral` 和 `tonemap_agx`（`shade.rs:161, 426`）只在 `shade_physical`（520 行）里调用，而 `shade_physical` 在 kernel 里没有调用者。
- TS 侧解析了 `tonemap` 和 `environment`（`src/layout.ts:4155-4170, 4426`），也放进了缓存键（`src/mesh-cache.ts:274`），但 `src/rasterize-native.ts:154-190` 没把它们传出去。Rust 的 `FillConfig`（`fill.rs:93-118`）也没有对应字段。`docs/attrs.json` 和 CHANGELOG 0.15.0 写着支持 Neutral/AgX，实际上不生效。

### 2.2 低粗糙度金属在 draft 下发黑

`metal 0.18`、`metal 0.08` 这类带数字的金属在 draft 下接近纯黑。`mirror` 和裸写的 `metal` 走烘焙 matcap，也偏黑。原因如下：

- `env_over`（`shade.rs:348-355`）在环境值低于 0.45 的地方，把 `fill*shade` 乘上 `1 - dark*darken`。金属度为 1、粗糙度低时，`darken = (0.4+0.52*metal)*ease ≈ 0.92`（451 行）。monochrome_studio_01 经过色调曲线后，除了伞灯一块，基本都接近 0。所以只要反射方向没对准伞灯，就只剩约 8% 的亮度。
- 粗糙度带来的提亮是 `rough²*(6+10*metal)`，粗糙度 0.08 时约等于 0.1（474 行），几乎没有作用。
- 默认的主光和补光都是 `LIGHT_DIR`，在 `shade.rs:492` 被跳过，所以没有解析高光。
- 反射其他物体的 `rt::reflect_color` 只在 final 里有。
- 附带一个 bug：`fill.rs:1413` 写了 `roughness: if batch.roughness > 0.0 {..} else {0.65}`，作者写的 `roughness 0` 会变成 0.65。
- 烘焙的 metal 和 brushed 在 `matcap/bake.rs:13-16` 里记录过同样的问题，并且加了 `SPEC_FLOOR`，但 mirror 被排除在外。

### 2.3 toon、manga、technical 退化

同一场景对比 kernel 和 legacy，看图结论是 legacy 在 toon 和 manga 上都明显更好。

- toon：`post::apply_look`（`kernel/post.rs:9-61`）只用 `(v/64)*64` 做量化。暗面判断依据的是 `depth<=0`（19 行），几乎从不成立。所以画面仍然是连续渐变，玻璃上还带着 PBR 反射。legacy 用的是 `cel.rs` 的硬分界：受光、背光、投影三档，加上白色硬高光。
- manga：`halftone`（`post.rs:40-51`）里 `w = 像素总数`，所以 `y` 永远是 0，画出来是按扁平下标排列的竖条纹，是屏幕空间的。颜色也没有去掉。legacy 的 `manga_hatch`（`style.rs:215`，世界坐标）是贴着表面的交叉排线，纸是白色，物体去色。
- technical：只做了去饱和，红盒子变成了深灰。按 README 的描述，technical 应该保留 studio 的质感，再加线。线由 TS 绘制（`src/software-mesh.ts:885-911, 1033-1128`），隐藏线分类在 `mesh_stroke.rs:213`。评审看到有虚线伸到物体外的地面上，需要核实。
- `post::ink_edges` 和 `post::bloom_emissive` 都存在，但没有任何地方调用。

### 2.4 发光体没有光晕

`lamp` 和 `neon` 在 `shade_frag` 里返回纯填充色（`fill.rs:651`）。kernel 没有 bloom，而 SPEC 和 GALLERY-3D 都说"霓虹有亮芯和光晕"。legacy 在 `mesh_fill.rs:3384, 3562, 3589` 调用了 `crate::bloom`。

### 2.5 接触阴影与漂浮

- 几张样张里，盒子底部缺少接触阴影。圆柱底边和影子之间有缝，`finish-mix` 里每个物体下面都有一道暗缝。
- draft 的地面阴影来自 `ground_contact::build`（`src/ground_contact.rs:126`），在 `paint_grounds` 里合成。AO 的强度上限是 `min(ao*140,160)`（`fill.rs:1199-1201`）。
- 有一条需要核实：盒子和圆柱是贴地的，`AO_HEIGHT=34`、`DIST_REF=110`（`ground_contact.rs:4-6`）对这类贴地物体可能不够。

### 2.6 材质难以区分

- 下面几组相邻材质格看起来几乎一样：
  - `glass 0.06` 与 `glass 0.72`
  - `clearcoat 1` 与 `plastic 0.12`
  - `anisotropy 0.9` 与 `metal 0.08`
  - `matte` 与 `plastic 0.85`
- 具体原因：
  - 玻璃走旧的 `compat::material_bytes`（`fill.rs:711`），粗糙度对它没有影响。`transmission` 和 `ior` 都没传进 kernel。
  - clearcoat、sheen、anisotropy 只对带数字的或 `finish ...` 形式的材质生效，对裸名无效。
  - 低粗糙度金属本来就发黑（见 2.2），所以 anisotropy 拉长的高光几乎看不见。
- 两个附带问题：
  - `brushed` 的纹理像莫尔纹，不像拉丝。
  - 金色圆柱上有密集的竖纹。两者都要查是不是采样不足造成的。
- `kernel/presets.rs`（Physical 表）只有测试在调用，是死代码。

### 2.7 构图与标签（样张本身的问题）

- 物体挤在画面中下部，上方大约四成是空墙，缝隙、铬球、玻璃都太小。
- 标签字小、对比度低，有些格子没有标签。
- 改 `scripts/gallery-3d.ts`，规则在 `docs/GALLERY-3D.md`。

### 2.8 跨平台与 CI

- `native/` 里的 darwin-arm64 和 win32 二进制长期落后于 linux。
- `scripts/addon-hash.mjs` 遇到没有 `renderDrawList` 的二进制会直接 `exit 0`，所以 CI 的 macOS 和 Windows 任务虽然显示绿色，实际上什么都没验证。
- 当前 main 在 Mac 上：
  - 用旧二进制时，5 个测试失败，golden FLIP 0.184。
  - 换成按 main 重编的二进制后，只剩下面两处 TS bug。修复在本地 `mac-fixes` 分支上，尚未推送：
    - `src/mesh.spec.ts:741` 写死了加载 linux 的 `.node`，应改为 `index.cjs`。
    - `src/canvas-dom.mjs:421` 的 `isMain` 拿 `import.meta.url`（真实路径）和 `argv[1]` 比较，而 macOS 的 `/var` 是指向 `/private/var` 的符号链接，所以子进程直接退出、什么都不画。项目路径里只要有符号链接也会这样。`flexlayer-render/draw/canvas-dom.mjs:410` 有同样的问题。
- `src/glyph.spec.ts` 的对勾测试在 Mac 上失败。原因是 Inter 的拉丁子集 woff 里没有 U+2713，Linux 上能过只是因为 fontconfig 回退到了系统字体。

## 3. 分阶段计划

每个阶段写明：要做什么、验收数字是什么、会动到哪些文件。前一阶段验收通过，才能开始下一阶段。P0 必须最先做。P1 完成后，P2 到 P5 可以并行，但每个 PR 都要重新跑全量度量。

### P0 度量、对照和跨平台（先做，不改画面）

**P0-1 样张度量脚本** `scripts/gallery-metrics.mjs`

逐个渲染 `docs/gallery/3d/*.layer`，输出 JSON。阈值放在 `test/golden/gallery-metrics.json`，加 `--check` 参数时，超出阈值就以非零状态退出。物体区域用 `render --report` 输出里的 `elements[].ink` 定位。定位不准时，给 `scripts/gallery-3d.ts` 里的实体加 `id`。

至少要有以下指标：

- 每格的过曝比例（Y>250），排除 lamp 和 neon 本体的像素。
- draft 和 final 的平均亮度差。
- 两格去掉缝隙、铬球、玻璃三块区域后的 FLIP。
- 每个金属物体区域的亮度均值，以及其中 Y<40 的像素比例。
- 每个贴地物体底边下方 6px 条带的亮度，和远处地面的比值。这是接触阴影强度。
- 材质格两两相邻时，物体区域的 FLIP。这是可区分度。
- toon 每个物体区域内的亮度级数，排除边缘 2px 和线条像素。
- manga 纸面的亮度和色度。
- technical 和 studio 之间同一物体的色度比。

P0 只记录当前值，作为基线写进 PR 描述，先不设门槛。从 P1 开始，每个阶段把自己负责的指标改成门槛。

**P0-2 legacy 参照图**

用 `FLEXLAYER_3D=legacy` 渲染整套 bench，放进 `test/reference/legacy/`。P5 移植风格时以它为对照，P7 时删除。

**P0-3 二进制一致性**

- 在 flexlayer-render 的 CI 里，分别在 ubuntu、macos-14、windows 的原生 runner 上 `napi build`，产物作为 artifact 上传。
- 在 `native/flexlayer-render/` 里加一个 `BUILD.json`，记录每份 `.node` 对应的 flexlayer-render 提交和 `engine()`。
- flexlayer 的 `scripts/addon-hash.mjs` 在缺 `renderDrawList`、或者三份二进制的提交不一致时，必须失败，不能 `exit 0`。
- 不在 Mac 或 Windows 上实际跑一遍，就不能声称"已支持"。

**P0-4 已知的跨平台 bug**

- `src/mesh.spec.ts:741` 改为通过 `index.cjs` 加载。
- `src/canvas-dom.mjs` 和 `flexlayer-render/draw/canvas-dom.mjs` 里的 `isMain`，两边都先 `realpathSync` 再比较。补一个测试：在临时目录下用符号链接路径跑一遍。
- 对勾的来源不能依赖系统字体回退。先用 fontTools 找一个 catalog 里确实包含 U+2713 的字面。如果没有，就把对勾写成一条固定的路径常量。

验收：

- Linux、macOS 两个平台上 `npm test`、`check-golden`、`addon-hash` 全部通过。Windows 至少要通过 `addon-hash`。
- 度量 JSON 在三个平台之间的差异写进 PR 描述。

### P1 统一的输出阶段（曝光的根因）

目标：draft 和 final 共用一个"线性光累加 → 曝光 → 色调映射 → sRGB 编码"的出口。地面、灯光光池、发光体都在线性空间里叠加，不在字节空间里截断。

- 先评估 `shade_physical`（`shade.rs:520`）能不能直接替换 `shade_surface`。它本来就在线性空间里，并且调用了 `tonemap_neutral`。如果不行，就把 `shade_surface` 的累加改到线性空间。
- 把 `paint_grounds` 的光池（`fill.rs:1208-1260`）、`apply_contact`、`final_rays` 都改成在线性缓冲上操作。最后由一个函数统一做色调映射和编码。
- 把 `tonemap` 和 `environment` 从 `src/rasterize-native.ts` 传进 `FillConfig`。默认用 Neutral，`tonemap="none"` 时保留线性截断。要么实现 attrs.json 和 CHANGELOG 里写的功能，要么改文档，不能两边不一致。
- 烘焙的 matcap 是 sRGB 字节。先转成线性再参与累加，否则烘焙的那几种材质会整体变色。

验收：

- bench 的 draft 过曝 ≤ 0.5%。
- draft 和 final 的平均亮度差 ≤ 6/255。
- 两格去掉缝隙、铬球、玻璃三块后，FLIP ≤ 0.03。
- `examples/` 里所有带 camera 的例子都能渲染出来。逐张看图，确认没有整体偏色。

### P2 地面、接触阴影和"漂浮"

- 盒子、圆柱这类贴地物体的接触线：检查 `ground_contact.rs` 的 `AO_HEIGHT`、`DIST_REF`，以及 `fill.rs:1199-1201` 的上限，在 draft 里给贴地的底边一条紧贴、发暗的接触线。
- 查清圆柱底边与影子之间那道缝、`finish-mix` 每个物体下面那道暗缝分别是哪一步造成的。可能是 `kiss_edges`、`soften_binary_edges`（`fill.rs:1706-1729`）的边缘处理，也可能是地面的深度测试。
- 悬空物体的影子要和接触阴影分开，现有测试 `lighting.spec.ts:111-308` 要保持。

验收：

- bench 里每个贴地物体的接触阴影强度比值 ≤ 0.75。地面亮度按 P1 之后的值计算。
- 悬空蓝球的影子和红盒的接触阴影之间，要有一段亮度回到地面值 90% 以上的间隔。
- 看图时不能再有物体看起来浮着。

### P3 材质

- **draft 下的金属**：默认的主光和补光（`LIGHT_DIR`）也要参与解析高光，不要在 `shade.rs:492` 跳过。`env_over` 的压暗要和能量守恒一致。粗糙度低的金属在环境暗的方向上，应该显示环境本身的暗色，而不是被乘到接近 0。
- `mirror` 也加上 `SPEC_FLOOR`，或者改走带数字的路径。
- 修复 `fill.rs:1413` 里 `roughness 0` 变成 0.65 的 bug，并补一个单元测试。
- **玻璃**：把 `transmission`、`ior`、`roughness` 传进 kernel。粗糙度要影响透过的背景的模糊程度。`compat::material_bytes` 这条旧路径要么替换掉，要么写明原因保留。
- 让 clearcoat、sheen、anisotropy 在材质格里看得出来。如果裸名也应该支持这三个参数，就在 `layout.ts:1856-2108` 里说清楚规则。
- 查 brushed 的莫尔纹和金色圆柱上的竖纹，先确认是不是采样不足、或者高光没有抗锯齿。
- `kernel/presets.rs` 要么接上，要么删掉。

验收：

- 每个金属区域的 Y<40 像素比例 ≤ 30%。
- draft 和 final 同一金属区域的亮度均值差 ≤ 15%。
- 16 个材质格两两相邻时，物体区域的 FLIP 都 ≥ 0.05。具体阈值先用 P0 的数据标定。
- 看图时能说出每一格是什么材质。

### P4 发光体

- 在 kernel 的后处理里调用 `post::bloom_emissive`，或者移植 legacy `crate::bloom` 的用法（`mesh_fill.rs:3384, 3562, 3589`）。lamp 和 neon 要有亮芯和光晕。
- 光晕在 P1 的线性缓冲里叠加，再统一做色调映射。

验收：

- neon 和 lamp 的本体核心 Y ≥ 240。
- 光晕沿半径单调衰减。
- 本体以外不出现截断（Y>250 的像素只在核心里）。

### P5 风格：把 legacy 移植进 kernel

以 `test/reference/legacy/` 为对照，把下面三项移植进 `post.rs` 或者着色阶段：

- `cel.rs` 的受光、背光、投影三档硬分界和硬高光；
- `style.rs:215` 在世界坐标下的 `manga_hatch`；
- 纸色和去色。

删掉屏幕空间的 `halftone`。

- toon 要读到真实的受光和投影信息（法线点乘主光、阴影图），而不是 `depth<=0`。
- technical 保留 studio 的颜色和质感，只加线，不做去饱和。
- 核实 technical 那些伸出物体外的虚线：隐藏线必须落在某个实体的轮廓里面。补一个测试，把线条像素和实体覆盖遮罩做比较。
- 线稿图（`3d-lines`）里圆柱穿过盒子的交线：先放大裁剪看清楚，再决定要不要修 `mesh_intersect`。

验收：

- toon 每个物体区域的亮度级数 ≤ 4。
- manga 纸面 Y ≥ 235，色度 ≤ 0.02（OKLab）。
- 排线和 legacy 对照图之间，物体区域的 FLIP ≤ 0.15。
- technical 和 studio 之间的色度比 ≥ 0.9。
- 看图结论必须是："kernel 不比 legacy 差"。

### P6 样张和文档

- 改 `scripts/gallery-3d.ts`：让物体占据画面主体，缝隙、铬球、玻璃要放大到能看清；标签要可读（对比度、字号），每格都有标签。
- 改完后同步更新 `docs/GALLERY-3D.md`。
- 让 `SPEC.md`、`docs/attrs.json`、`docs/IMPLEMENTATION.md`、`README` 和实现保持一致，逐条核对。比如光晕、tonemap、environment、"draft 只用阴影图"这些说法。
- CI 在 Linux 上跑 `gallery:3d` 和 `gallery-metrics --check`，把样张作为 artifact 上传。提交进仓库的样张以 CI 产物为准。

### P7 清理

所有指标都达标、看图也通过之后：

- 删除 legacy 路径：`FLEXLAYER_3D=legacy`、`mesh_fill.rs` 中只有 legacy 用到的部分、`test/reference/legacy/`。
- 清理死代码：
  - 没有被用到的 `tonemap_*`
  - `presets.rs`
  - `visbuffer.rs`（如果仍然没有调用）
  - 没人引用的 `renderMeshNative` 包装
- 重新标定 `scripts/check-budget.mjs` 的预算。线性管线可能更慢，不能用放宽预算来掩盖。

## 4. 会受影响的测试

按阶段列出。改完一个阶段，逐个确认失败原因是"画面变好了"，然后才能改目标值。

- **P1、P3**
  - `test/golden/kernel-draft.png`，由 `scripts/check-golden.mjs` 检查：64×48 的 `metal 0.2` 球，FLIP 阈值 0.02。重新生成时，要在 PR 里贴新旧对比。
  - `src/mesh.spec.ts`：
    - 515 matte
    - 540 plastic
    - 563 金属伞灯（亮度大于 500、小于 140，以及偏红）
    - 608 金属边缘
    - 625 粗糙度提亮
    - 689 玻璃
    - 794 brushed
    - 828 掌托
    - 913 抗锯齿
- **P1、P2、P4**：`src/lighting.spec.ts`（43–111 灯光光池，111–308 阴影与接触）、`src/ground.spec.ts`、`src/software-mesh.spec.ts`。
- **P5**：`src/mesh.spec.ts:1310-1360`（shading）、`flexlayer-render/src/kernel/post.rs` 里的 4 个测试（toon `%64`、bloom、bokeh、ink）。
- **P3**：`flexlayer-render/src/matcap/bake.rs` 的 7 个测试会和打包进去的 PNG 做比对，改了烘焙就得重新烘焙。
- **始终要保持**：`test/golden/drawlist.sha256`（`renderDrawList`）、`src/gallery.spec.ts`（无错误）、`src/three.spec.ts`。

## 5. 风险

- **全局色调变化**：P1 会改变所有 3D 画面，包括用户已有的作品。
  - 在 CHANGELOG 里写明。
  - 升 minor 版本。
  - 考虑临时提供 `tonemap="legacy"`，保留旧的字节截断，并标注为将要移除。
- **性能**：线性缓冲是 f32，内存会涨到 4 倍。
  - 1920 长边约 14 MB，可以接受。
  - 每阶段都要跑 `bench-3d` 和 `check-budget`。
- **烘焙 matcap 的色彩空间**：PNG 是在 sRGB 下烘焙的。在线性空间里叠加，可能和 legacy 的外观不一致，需要逐种看图。
- **跨平台浮点差异**：`check-golden` 用 FLIP 阈值，而不是 sha。度量的门槛也必须是区间，不能是精确值。

## 6. 第一步

1. 新建分支，完成 P0-4 的三处修复，补测试，提 PR。
2. 写 `scripts/gallery-metrics.mjs`，在 Linux 上跑出基线，把表贴进 PR 描述。
3. 生成 `test/reference/legacy/` 下的对照图。
4. 在 flexlayer-render 的 CI 里加上三平台原生构建，实现 `BUILD.json` 和 addon-hash 的检查。

这四项都不改画面。合入之后再开始 P1。
