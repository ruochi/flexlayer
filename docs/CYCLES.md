# 第三档：Cycles Standalone

Flex Layer 现在有三档渲染，同一份场景描述，换后端不换写法。

| 档位 | 后端 | 命令 | 耗时（960×640，`examples/meshes.layer`） | 用途 |
| --- | --- | --- | --- | --- |
| 草图 | 原生光栅 | `render scene.layer` | ~2.5 s | 排版预览、迭代 |
| 高质量 | 原生光栅（`--quality final`） | `render scene.layer --quality final` | ~6 s | SSR、折射、软阴影 |
| 超高质量 | **Cycles 路径追踪** | `render scene.layer --engine cycles --samples 128` | ~11 s | 最终出图 |

前两档走的还是 `src/rasterize-native.ts` 和 `flexlayer-render` 里的内核，这次改动一行没碰。

## 为什么是 Standalone 而不是 Blender

`cycles` 可以单独编译成一个命令行程序（`app/cycles_xml.cpp`），只读一个 XML 场景文件，
不需要 Blender 运行时，也不需要 Python。比起「装 Blender + 跑 `bpy` 脚本」：

- **没有 GPL 传染**：只是调用外部可执行文件，没有链接代码。
- **没有 Blender 依赖**：二进制是单个可执行文件。
- **场景是纯文本**：可以存下来、手改、扔到别的机器上渲染。

## 架构

```
              LayerDocument（同一份布局结果）
                        │
      ┌─────────────────┼─────────────────┐
      │                 │                 │
 原生光栅 draft   原生光栅 final     cycles-export.ts
   ~2.5s             ~6s              （场景 → XML + PNG 贴图）
                                          │
                                    cycles.ts（子进程）
                                          │
                                    Cycles 路径追踪
                                    ~11s @ 128 spp
```

新增的文件：

- `src/cycles-export.ts` — `LayerDocument` → Cycles XML。相机、地面、网格、材质、灯光全在这里翻译。
- `src/cycles.ts` — 找二进制、写临时目录、起子进程、读回 PNG。
- `src/render.ts` — `renderLayerWithCycles()` / `exportLayerToCycles()`，和 `renderLayer()` 平级。
- `src/cycles-export.spec.ts` — 17 个单测，覆盖坐标、绕序、UV、灯光、材质、地面跨度、取景。

## 准备二进制

```bash
git clone https://projects.blender.org/blender/cycles ~/cycles-src
cd ~/cycles-src && make update && make
# macOS 上先装 git-lfs，否则拉下来的是 LFS 指针而不是 .a
```

给 Flex Layer 指路，两种都行：

```bash
export FLEXLAYER_CYCLES=~/cycles-src/build/bin/cycles
# 或者把 cycles 放进 PATH
```

找不到二进制时会报一条可照做的错，**原生两档完全不受影响**。

## 用法

```bash
# 出图
npx tsx src/cli.ts render examples/meshes.layer --engine cycles --samples 128 -o out.png

# 只导场景，不渲染（交给别的机器 / 手改）
npx tsx src/cli.ts render examples/meshes.layer --engine cycles --emit-cycles scene.xml

# 指定二进制
npx tsx src/cli.ts render scene.layer --engine cycles --cycles-binary /path/to/cycles
```

代码里：

```ts
import { renderLayerWithCycles } from './render.js'

const { png, scene, elapsedMs } = await renderLayerWithCycles('scene.layer', {
  samples: 512,
  device: 'CPU',
})
```

采样数参考：预览 `128`，出片 `512`，印刷 `2048`。降噪默认开（OpenImageDenoise）。

## 坐标系

这是整条链路最容易错的地方，记在这里免得下次再踩。

| | Flex Layer（层空间） | Cycles |
| --- | --- | --- |
| y 轴 | 向下 | 向上 |
| z 轴 | 朝观众 | 相机看 **+z** |
| 单位 | 1 px | 1 m（这里按 1 px = 1 cm 换算） |

- **点**：`layerToWorld(p) = (x·s, -y·s, -z·s)`，`s = 0.01`。
- **方向**：`layerDirection(d) = (dx, -dy, -dz)`，只做一次翻转。
- **法线**：过姿态矩阵的**线性部分**（不能带平移），再过一次 `layerDirection`。
- **相机**：`cameraItems()` 已经把视图矩阵烘焙进顶点，所以相机只要一个平移。
- **`<transform matrix>` 按行主序**写，导出时先转置。

### 绕序（`layerToWorld` 的坑）

层空间里三角形逆时针朝外。`layerToWorld` 翻掉 y、z 之后，**法线仍然朝外，绕序却朝里**。
Cycles 用绕序定几何法线，结果是每个面都在背面黑掉 —— 整个场景全黑。

所以 `meshPrimGeometries()` 默认把每个三角形的后两个索引换一次序。但作者显式
翻转了法线的图元（马克杯内壁）不能再翻，否则整圈内壁变背面、渲成死黑——按图元
多数票决定是否换序。`cycles-export.spec.ts` 里有一条测试拿几何叉积和 `N` 逐面比对。

**地面不需要换序**：地面的四个角是手工按 `-span,-span → span,-span → span,span` 排的，
换算后本来就是朝上的。

### 取景（Standalone 覆盖 viewplane）

`cycles_standalone.cpp` 读完 XML 后会无条件调用 `compute_auto_viewplane()`，把窗口
重算成「**长边**半径 1」。场景文件里写的 `viewplane_*` 在 Standalone 下不生效。

因此 `fov` 必须对着**短边**算：`tan(fov/2) = (短边/2) / focal`（`shortSideFov`）。
竖幅画布若仍用竖直 fov，物体会被横向、纵向各缩到 80%。

### UV（按角点，不是按顶点）

Cycles 的 `UV` 属性按**角点**索引：`xml_read_mesh` 用角的序号去取 `UV[2i]`，
不是 `verts` 里的顶点号。`chunk.uvs` 是每顶点一对，导出时要按三角形索引摊开成
每角一对，长度 = 三角数 × 6。条件写错会让贴图全丢（杯子印花、AirTag 刻字）。

贴图的 `flipY`：光栅器按 `y = (flipY ? 1-v : v)` 取样；Cycles 的 v=0 在图像底边。
`flipY` 为真时数组原样写出，为假时再翻一次——反过来印花会上下颠倒。

### 灯光

三个必须知道的点：

1. **每盏灯都要挂 self-emission shader。** `Light::copy_to_kernel` 拿 `used_shaders[0]`
   当灯的光谱，没挂就落到 `scene->default_light` —— 那是 `strength = 0` 的 emission，
   `has_contribution()` 直接判它不出光。所以每盏灯都包在 `<state shader="light-bulb">`
   里，`light-bulb` 是一段 strength 为 1 的白色 emission。**强弱仍由 `<light strength>` 决定。**
2. **`<light>` 必须写 `light_type`**，否则 `xml_read_light` 直接 return。
3. **太阳和面光的方向约定相反。**
   - 面光 / 聚光灯：照向 = `-column(2)`。
   - 太阳：`co = -column(2)` 是「指向光源」，光线沿 `-co` 前进，也就是 `column(2)`。

光强校准（三个系数，都在 `src/cycles-export.ts` 顶部）：

- **平行光**：光栅器把作者的 `intensity` 直接当照度 `E` 用，Cycles 的 sun
  `strength` 也是 `E`，所以**不乘 π**。Lambert 表面两边读到的都是 `albedo · E / π`。
- **点光 / 面光**：光栅器按 `LIGHT_HALF_DISTANCE = 200` 像素半衰，Cycles 的面光
  `strength` 是辐射功率、按 1/r² 铺在米制场景上。`AUTHOR_LIGHT_POWER` 把作者强度
  换到瓦特；另外补一盏同方向、弱得多的太阳（`FLAT_FALLOFF_FILL`）顶上远处那份
  没衰减掉的亮度，地面才不会出现假地平线。
- **天空分两层**：摄影机看到的是画布底色（`seen`）；照明默认挂影棚全景
  `monochrome_studio_01_1k.hdr`（和光栅器同一张 Poly Haven CC0），伞灯旋到主光
  方向，并加一点中性灰托底（对应光栅器柔光板）。`environment="none"` 或找不到
  文件时退回中性灰。用 `light_path.is_camera_ray` 混两层，避免画布米色染机身。

## 相机平面

屏幕墙纸、键盘井、触控板这类二维平面不再跳过：剥掉网格子树后画成位图，做成
带 emission 贴图的四边形（对应光栅器的 unshaded `planeBatch`）。否则 Cycles 里
屏幕是空的、按键和甲板糊成同一种灰。

## 材质

`surfaceFor()` 把 `material` 的 finish 映射到 Principled BSDF。数字不写在这里：
`src/finishes.ts` 是唯一来源，和 native 内核的 `material.rs` 逐项对齐，改一处两边
一起动（`finishes.spec.ts` 会拦住漂移）。

| finish | 映射到 Cycles |
| --- | --- |
| `matte`（默认） | 固有色 + roughness |
| `plastic` | 加 coat / coat_roughness |
| `metal` / `mirror` / `brushed` | metallic 1，`brushed` 另写 anisotropy |
| `glass` | `transmission_weight`, `ior` |
| `clay` | roughness + sheen |
| `lamp` / `neon` | emission，不从环境取光 |

作者写的 `roughness` / `metalness` / `clearcoat` / `transmission` / `ior` /
`sheen` / `anisotropy` 逐项盖过预设行，和 native 一致。这里不再夹
`Math.max(0.22, ...)` 这类补偿值：那会让作者写下的粗糙度在 Cycles 里失效。

`env_lod` 和 `detail` 纹理（clay 的颗粒、brushed 的条纹）是 native 内核私有的，
Cycles 里没有对应槽位，只能靠 `roughness` / `anisotropy` 近似。

模型的 `baseColorFactor` 会盖过缺省的 `fill="#000000"`。不这么做，glb 里的金色机身
会被涂黑 —— 这是 `MeshPrim.baseColor` 存在的原因。

`meshPrims()` 还会透传 `transmission` / `ior` / `clearcoat` / `sheen` / `anisotropy`：
钻石的透射、马克杯的清漆都靠它们；少传一项，玻璃会变成不透光的多面体。

贴图会从 glb 里解码成 PNG 落到临时目录，再挂到 `image_texture` 上。

## 一像素倒角

光栅器在 `paintGeometry()` 里给硬边切一条约 1 屏幕像素的窄面，让金属机身和塑料
件能接住一条细高光；Cycles 这边由 `bevelChunk()` 做同一件事，半径同样按**输出
像素**算：

- 几何在导出前已经折进层镜头空间，相机是单位旋转、只有平移，所以每世界单位的
  像素数就是 `focal / (focal - z)` —— 和 `perspective.ts` 的 `project` 同一个式子。
- 判据跟光栅器一致：写了描边、`shading` 是 toon / manga、材质是 glass、`tube`、
  以及厚度不到圆角半径一半的薄盖板，都不倒角。
- 带贴图的图元跳过：uv 是按原顶点下标铺的，倒角增删顶点后对不上。

`bevelFewFaces` 要求平面数在 4–800 之间（`mesh_bevel.rs` 的 `MAX_FACES`）。MacBook
的机身路径有 11 万顶点，两边都进不了倒角，所以它的边缘高光来自材质和反射，不是
几何 —— 这一点 Cycles 和 native 表现一致。

## 假地板与阴影

`<ground>` 不写 `fill` 就是「只留影子、不画地板」。Cycles 里用**原生的
shadow catcher** 一趟渲完，不再靠两遍渲染相减。

场景侧只要两件事（`cycles-export.ts` 自动生成，作者不用手写）：

- 地面物体标 `is_shadow_catcher="true"`，材质用**和实体地板一致的** principled
  （默认地面色 `#efe8df` + roughness 0.85）——不能写纯白，原因见下文；
- `<film use_approximate_shadow_catcher="true">`。

然后 Cycles 会把这个平面从可见通道里拿掉，用「穿过平面后看到的背景 × 阴影比」
补上，直射阴影、间接光、接触处的过渡都由路径追踪本身算出来。

实测（MacBook 场景，256 spp，720×900）同一像素点上，捕捉器与真实地板逐点对齐：

阴影剖面（穿过投影的一行，x 为像素列）：

| x | 假地板 | 真实地板 |
| --- | --- | --- |
| 270（阴影外） | 175 | 175 |
| 290（阴影中段） | 63 | 63 |
| 310 | 52 | 52 |
| 330 | 29 | 29 |
| 340（阴影核心） | 24 | 24 |

前景物体对比用**权威物体掩膜**统计：另渲一张「只有物体、白色自发光、纯黑背景」
的图，凡是亮度 >200 的像素就是物体本体（占全图 18.2%），再向内腐蚀 3px 剔除
1px 抗锯齿轮廓，只比较纯粹的物体内部。

| 区域 | 平均差 /255 | 95 分位 |
| --- | --- | --- |
| 上盖 / 屏幕 | 0.03 | 0.33 |
| 机身中段 | 0.14 | 0.67 |
| 机身下部（近地） | 0.50 | 2.00 |
| **物体合计** | **0.11** | **0.67** |

中位数为 **0.00**（一半像素逐位相同），差 >2 的像素只占 **0.5%**，最大差 37。

（256 spp 实测；不同采样数下合计值在 0.11–0.16 之间浮动。）

结论：**前景物体与实体地板那版肉眼不可辨**（目标 <2/255，实测 0.11）。残差
集中在两处，都不是物体本体受光的问题：

1. 物体轮廓 1px 抗锯齿边——两侧「背后的东西」不同（天空 235 vs 白地板 248），
   边缘混合像素必然有差，属于像素级几何效应。
2. 机身金属斜面的窄反射带（最大差约 46）——机身映出的地面被换成了背景，这是
   「地面必须消失」的物理取舍，无法两全。

阴影本体（深度、轮廓、颜色）与实体地板相同。

对照示例：`examples/macbook-pro-shadow-catcher.tsx` 与 `examples/macbook-pro.tsx`
只差地面的一处 `fill`（前者没有），是干净的单变量对照，随手可复现：

```
npx tsx src/cli.ts render examples/macbook-pro-shadow-catcher.tsx --engine cycles -o a.png
npx tsx src/cli.ts render examples/macbook-pro.tsx            --engine cycles -o b.png
```

对比图在 `compare/`：

| 文件 | 内容 |
| --- | --- |
| `macbook-cycles-transparent-ground.png` | 假地板成品（1440×1800） |
| `macbook-cycles-solid-ground-ref.png` | 实体地板参照 |
| `macbook-cycles-tri-compare.png` | 假地板 / 实体地板 / 差异×5 三联 |
| `macbook-cycles-fg-verify.png` | 差异×30 只在物体内部显示，验证前景一致 |

### 捕捉器材质不能写纯白

`ground-shadow-catcher` 这块材质虽然不进可见通道，但它仍是场景里唯一一块地面，
物体底部收到的**反弹补光**全来自它。写纯白（1.0）会比真实地板亮，把物体底部
照亮，金属机身一项就差到 9.6/255。改成和实体地板一致的 principled（默认地面色
`#efe8df` + roughness 0.85）后，机身核心降到 1.8/255。

逐档扫过灰度反照率 0.6 / 0.7 / 0.8 / 0.9 / 1.0，0.8 附近前景差最小（1.35/255），
正好对应 `#efe8df` 的线性值——这也是 `SHADOW_CATCHER_FILL` 取那个色的原因。

### 对 Cycles 源码的三处必要修改

官方 Standalone（我们用 `/Users/ruochi/cycles-src` 自编）跑不出这个效果，
查下来是三个独立缺陷：

1. **`src/app/cycles_xml.cpp`** — `<object>` 里嵌的 `<mesh>` 会重新建一个
   object，于是 `<object is_shadow_catcher="true">` 上的标记落在了一个**空
   mesh** 上，真正带三角形的那个物体没标记。修法是解析完 object 后把它写回
   `state.object`，让内层 `<mesh>` 复用它。
2. **`src/app/cycles_standalone.cpp`** — 输出 pass 写死成 `combined`，没有
   命令行入口；而且它总会 `create_node<Pass>()` 一个 combined 类型、名字却取自
   `--output-pass` 的节点，污染按名查找。现在 `--output-pass` 会解析成真实
   `PassType`，并且总会补一个名叫 `combined` 的 pass。
3. **`src/session/buffers.cpp`** — `get_actual_display_pass` 把任何 combined
   都重定向到 `shadow_catcher_matte`，导致按名取任何 pass 都拿到同一张图。
   现在只对名为 `combined`（或匿名）的 pass 做重定向。

`src/scene/film.cpp` 里顺带给 catcher 相关的 auto pass 补了名字，输出驱动才
能按名取到 `shadow_catcher` / `shadow_catcher_matte` / `background`。

### 一个容易踩的坑

`src/scene/light.cpp` 会把**非 shadow catcher 物体**上的光源标成
`SHADER_EXCLUDE_SHADOW_CATCHER`，也就是不进捕捉器路径。给光源事后加
`is_shadow_catcher` 看似能补上直射阴影，实测会让地面出现一块亮斑：光源能量
进了 `color_catcher`，但 matte 路径又看不到它，除法结果直接大于 1。**别这么做。**
阴影靠背景光与间接光已经足够，作者灯只负责造型。

有 `fill` 的地面是一块真实地板，不进这条路径。

## CLI 选项

```
--engine native|cycles   选后端。native 是默认
--samples N              路径追踪采样数，缺省 256
--device CPU|GPU         缺省 CPU
--emit-cycles <path>     只写场景 XML，不渲染
--cycles-binary <path>   显式指定 cycles 可执行文件
```

`--engine cycles` 不能和 `--frames`、`--watch`、`--rgba`、多文件一起用（每帧起一个
子进程代价太高）。

## 已知边界

- 相机层里的**二维平面不导进 Cycles**（文字、描边、渐变、键盘/触控板那层 2D）。
  它们按设计留给光栅路径，之后在原位合成 —— 这样文字仍然是矢量级的清晰度。
  目前成片里屏幕是黑的、键盘只有键帽挤出，就是因为还没做这层合成。
- `ambient` / `hemisphere` 灯不写成光源，改由天空背景承担。
- 目前只在 macOS arm64 上验证过（Cycles 5.3.0）。Linux / Windows 用同一套源码，
  `WITH_USD=OFF`、`WITH_CYCLES_HYDRA_RENDER_DELEGATE=OFF` 就能编出来。
