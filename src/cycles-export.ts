/**
 * Flex Layer 场景 → Cycles Standalone XML。
 *
 * Cycles Standalone 读的是它自己的 XML（`intern/cycles/app/cycles_xml.cpp`），
 * 所以这条路不需要装 Blender：写一个场景文件，交给独立的 `cycles` 可执行文件。
 * 它是三档质量里的最高一档，只有调用方明确要才走，draft / final 两条已有路径不受影响。
 *
 * 坐标：层空间 y 向下、+z 朝观众、1 单位是 1 px；Cycles 是 y 向上、米、相机看 +z。
 * 两者差一个 180° 绕 x 轴的旋转（y、z 同时取反），这是个正交变换，右手性不变。
 * 层上的 `rotateX="90"` 因此仍然把物体放平在地面上，因为两边套的是同一个姿态矩阵。
 */
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cameraItems, mulMat4, type CameraItem } from './camera.js'
import { FINISHES } from './finishes.js'
import { parseColor } from './gradientField.js'
import { solidPaint } from './gradient.js'
import { originOffset } from './matrix.js'
import { paintable, stripMeshes } from './mesh.js'
import { paintLayerIsolated } from './paint.js'
import { applyPoseMatrix, hasPerspective, type Perspective } from './perspective.js'
import { meshPrims, type MeshPrim } from './software-mesh.js'
import type {
  GroundLayoutNode,
  LayerDocument,
  LayerLayoutNode,
  LayoutNode,
  LightSpec,
  MeshLayoutNode,
  MeshMaterial,
} from './types.js'

/** 层像素到米。光栅器把 1 单位当约 1 cm，这里沿用同一比例。 */
export const UNIT_SCALE = 0.01

/**
 * 影棚主光的太阳强度。
 *
 * Cycles 的 sun `strength` 是辐照度，Lambert 表面读到的是 `albedo · E / π`，
 * 所以读数接近 1.0 需要 `E ≈ π`。但那样加上天空和补光，浅色地面会过曝到纯白，
 * 丢掉了原生渲染里的固有色。实测把 `π` 再乘 0.3 最接近光栅器的观感
 * （地面 #e7e0d4 读回 #ddd0aa 附近，而不是被推到 255）。
 */
const LAMBERT_TO_IRRADIANCE = Math.PI
/** 读数和光栅器对齐的实测系数：`E = 0.3 · π · intensity`。 */
const SUN_EXPOSURE = 0.3
const DEFAULT_KEY_STRENGTH = 3.0 * SUN_EXPOSURE
const DEFAULT_FILL_STRENGTH = 0.8 * SUN_EXPOSURE
/**
 * 没有影棚全景、或 `environment="none"` 时的兜底环境。
 *
 * 光栅器用 Poly Haven `monochrome_studio_01` 当环境；Cycles 默认也用同一张。
 * 找不到文件时退回中性灰，避免整张图死黑。不要用画布底色去照亮——米色会
 * 把银色机身染黄。
 */
const SKY_STRENGTH = 0.72
const SKY_NEUTRAL: Vec3 = [0.86, 0.86, 0.86]
/** 摄影机直接看到的那片底（画布色），不参与照明。 */
const SKY_VISIBLE_STRENGTH = 1

/** 阴影捕捉地面的着色器名。不带编号：同一场景里所有假地板共用一个。 */
const SHADOW_CATCHER_NAME = 'ground-shadow-catcher'
/** 和 `flexlayer-render` / `hdri.rs` 共用的影棚全景。 */
const STUDIO_HDR_NAME = 'monochrome_studio_01_1k.hdr'
/**
 * 全景强度。光栅器的 `HDR_SCALE = 0.125` 之外还会叠柔光板 / 天花板纱，
 * Cycles 这边没有那些加法项，直接用 0.125 金属会落到死黑。1.0 让伞灯和
 * 白墙够亮，再靠下面的 `STUDIO_HDR_FILL` 托住暗部。
 */
const STUDIO_HDR_STRENGTH = 2
/** 暗部托底：混一点中性灰，对应光栅器柔光板把环境抬到 Y≈40 的那一步。 */
const STUDIO_HDR_FILL = 0
/**
 * 全景去饱和量。`studio_map.rs` 把彩度压向灰，否则银色机身会反射出 HDRI
 * 的暖色偏。Cycles 用 `rgb_to_bw` + `combine_color` 造出灰度，
 */
const STUDIO_HDR_DESATURATE = 0.75
/**
 * 把伞灯旋到主光方向（弧度，Y-up 绕 Y = 水平转）。
 * 方位差来自全景最亮处与光栅器 `key_dir = (-0.6, 0.85, 1)` 的 yaw。
 */
const STUDIO_HDR_ROTATION: Vec3 = [0, -1.169872, 0]
/**
 * 作者写的点光 / 面光强度换算到瓦特。
 *
 * 光栅器把这些灯当「按 `LIGHT_HALF_DISTANCE = 200` 像素半衰的亮度」用，
 * 而 Cycles 的面光 `strength` 是辐射功率，按 1/r² 铺到米制的场景上。房间
 * 尺度的场景里两套数字差两个数量级，实测乘 2400 才能让 `intensity="2.4"`
 * 的面光读回和原生渲染同一档亮度。
 */
const AUTHOR_LIGHT_POWER = 700
/**
 * 面光之外补的那盏「无衰减」太阳，相对面光强度的比例。
 *
 * 光栅器把作者灯当「按固定半衰距离的亮度」，Cycles 是 1/r²。两者只在灯附近
 * 对得上，远处会明显发暗。用一个弱太阳补上远场，地面才不会出现假地平线。
 */
const FLAT_FALLOFF_FILL = 0.30
/** 地面在本地坐标里的半边长，取画面长边的若干倍，保证铺满。 */
/* 地面半边长 = 画面长边 × 这个倍数。
 *
 * 12 倍时地面的远端已经落到相机视锥之外，整幅画面都踩在地板上，天花板那侧
 * 不再露出背景色，也就没有「地板和背景」之间那条硬线。 */
const GROUND_SPAN_FACTOR = 12

/* 主平面在法线方向上让出的深度，单位是层像素。
 *
 * `seated()` 这类作者写法把道具的最低点精确放在地面层的 z=0 上，于是道具底面
 * 和地面**完全共面**：AirTag 那种圆弧底壳跟平面相切时，切点附近一大片三角形
 * 和地板的深度差只有 1e-5，路径追踪器只能随机判胜负，渲出来就是「底壳被地面
 * 咬掉一块」——看着像陷进桌子里。让地面整体退半个像素，道具仍然看得见接触，
 * 但两者不再抢同一个深度。
 *
 * 半个层像素在 2.6 px/mm 的构图里约 0.19 mm，肉眼读不出悬空，也远小于阴影
 * 模糊半径，接触阴影照旧贴着物体边缘。 */
const GROUND_SEAT_EPSILON = 0.5

/* 地面反照率相对作者 fill 的缩放。0.88 让 #efe8df 这类近白地板在影棚 HDRI 下
 * 出片落在 ~246 的漫反射亮度：保住「浅色地板」的观感，又给遮挡留出约 40 级
 * 的压缩余量，接触阴影不会因为通道饱和被裁平。 */
const GROUND_ALBEDO_SCALE = 0.88

export type CyclesEngineOptions = {
  /** 路径追踪采样数。预览 128，出片 512–2048。 */
  samples: number
  device: 'CPU' | 'GPU'
  /** 光线深度上限。 */
  maxBounces: number
  /** 合并通道降噪（OpenImageDenoise）。 */
  denoise: boolean
  /** alpha 背景，便于回到 Flex Layer 里合成。 */
  transparent: boolean
  /**
   * 只用环境图当光源，不注入 `studio-key` / `studio-fill` 两盏默认太阳。
   *
   * 默认的 3.0 / 0.8 两盏太阳是光栅器的影棚主光近似，会在平坦地面上打出一块
   * 可见的照度光斑；想让画面完全由全景天光决定时打开这一项。
   *
   * 场景里写 `environment="ambient"` 是等价的、更常用的入口；这个选项留给
   * 直接调导出器的调用方。
   */
  ambientOnly?: boolean
}

export const CYCLES_DEFAULTS: CyclesEngineOptions = {
  samples: 256,
  device: 'CPU',
  maxBounces: 12,
  denoise: true,
  transparent: false,
  ambientOnly: false,
}

export type CyclesImage = { name: string; bytes: Buffer }

export type CyclesExport = {
  /** 场景里有没有「无 fill 的假地板」。有的话调用方要跑两次渲染。 */
  hasShadowCatcher?: boolean
  xml: string
  width: number
  height: number
  images: CyclesImage[]
  counts: { meshes: number; triangles: number; lights: number; grounds: number; planes: number }
  /** 没能写进场景的东西，附带原因。 */
  skipped: string[]
}

type Vec3 = [number, number, number]
type Mat4 = number[]

const IDENTITY4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function num(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 1e5) / 1e5
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function vec(values: Vec3): string {
  return `${num(values[0])} ${num(values[1])} ${num(values[2])}`
}

function attr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** sRGB 字节 → 场景线性。Cycles 的颜色插槽是线性的。 */
function toLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function linearColor(paint: string | null | undefined, fallback: Vec3 = [0.62, 0.62, 0.62]): Vec3 {
  if (!paint) return fallback
  const solid = solidPaint(paint, '')
  if (!solid) return fallback
  const parsed = parseColor(solid)
  if (!parsed) return fallback
  return [toLinear(parsed.r), toLinear(parsed.g), toLinear(parsed.b)]
}

/** 层空间 → Cycles 世界：y、z 取反（绕 x 轴 180°），再乘到米。 */
export function layerToWorld(point: Vec3, scale = UNIT_SCALE): Vec3 {
  return [point[0] * scale, -point[1] * scale, -point[2] * scale]
}

function layerDirection(direction: Vec3): Vec3 {
  return [direction[0], -direction[1], -direction[2]]
}

/** 姿态矩阵的方向部分。列主序，不含第 4 列平移。 */
function applyPoseLinear(matrix: Mat4, x: number, y: number, z: number): Vec3 {
  return [
    matrix[0]! * x + matrix[4]! * y + matrix[8]! * z,
    matrix[1]! * x + matrix[5]! * y + matrix[9]! * z,
    matrix[2]! * x + matrix[6]! * y + matrix[10]! * z,
  ]
}

function transpose(m: Mat4): Mat4 {
  return [
    m[0]!, m[4]!, m[8]!, m[12]!,
    m[1]!, m[5]!, m[9]!, m[13]!,
    m[2]!, m[6]!, m[10]!, m[14]!,
    m[3]!, m[7]!, m[11]!, m[15]!,
  ]
}

/**
 * 层姿态矩阵（列主序，y 向下）→ Cycles `<transform matrix>`。
 *
 * Cycles 的 `<transform>` 把姿态乘进相机空间矩阵，属性按行主序读，所以先做
 * 绕 x 轴的 180° 旋转、缩到米，再转置。
 */
export function poseToCycles(pose: Mat4, scale = UNIT_SCALE): Mat4 {
  const flip: Mat4 = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]
  const scaled: Mat4 = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1]
  return transpose(mulMat4(mulMat4(flip, pose), scaled))
}

function matrixAttr(matrix: Mat4): string {
  return `matrix="${matrix.map(num).join(' ')}"`
}

function translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
}

function identityTag(translate: Vec3): string {
  return matrixAttr(translation(translate[0], translate[1], translate[2]))
}

/** 相机的竖直视角：层视距 f 像素、高 H 像素时是 2·atan(H / 2f)。 */
export function verticalFov(focal: number, height: number): number {
  return 2 * Math.atan(height / (2 * focal))
}

/**
 * Cycles Standalone 会覆盖 viewplane。
 *
 * `cycles_standalone.cpp` 在读完 XML 后无条件调用 `compute_auto_viewplane()`，
 * 把窗口重算成「**长边**半径 1」：横幅 `[-aspect, aspect] × [-1, 1]`，
 * 竖幅 `[-1, 1] × [-1/aspect, 1/aspect]`。所以场景文件里写的
 * `viewplane_*` 四个属性在 standalone 下**不生效**，fov 必须倒过来算：
 *
 *   tan(fov/2) = (短边 / 2) / focal
 *
 * 这样长边半径恰好等于 1 时，每米落多少个像素正好回到层视距 `focal`。
 * 横幅时短边是高，式子退化成原来的 `2·atan(H / 2f)`。
 */
export function shortSideFov(focal: number, width: number, height: number): number {
  const shortSide = Math.min(width, height)
  return 2 * Math.atan(shortSide / (2 * focal))
}

/**
 * 相机的 viewplane。
 *
 * 透视下与 `compute_auto_viewplane()` 一致（长边半径 1），这样即使哪天
 * Standalone 不再覆盖、或者换成 Blender 读这份场景，窗口也是同一个。
 *
 * 平行投影没有 tan(fov/2)，screen 直接是相机空间的米，所以窗口用米。
 */
export function viewplaneFor(
  width: number,
  height: number,
  perspective: Perspective,
): { left: number; right: number; bottom: number; top: number } {
  if (perspective === 'parallel') {
    const halfWidth = (width / 2) * UNIT_SCALE
    const halfHeight = (height / 2) * UNIT_SCALE
    return { left: -halfWidth, right: halfWidth, bottom: -halfHeight, top: halfHeight }
  }
  const aspect = width / height
  if (width >= height) return { left: -aspect, right: aspect, bottom: -1, top: 1 }
  const inverse = height / width
  return { left: -1, right: 1, bottom: -inverse, top: inverse }
}

export type CyclesCamera = {
  centerX: number
  centerY: number
  focal: number
  perspective: Perspective
}

/** 取景的那一层：树上第一台开了镜头的 layer。 */
export function findCameraLayer(root: LayerLayoutNode): LayerLayoutNode | null {
  if (hasPerspective(root.perspective)) return root
  const visit = (node: LayerLayoutNode): LayerLayoutNode | null => {
    for (const child of node.children) {
      if (child.kind === 'layer' && hasPerspective(child.perspective)) return child
      if (child.kind === 'layer' || child.kind === 'flex') {
        const found = visit(child as LayerLayoutNode)
        if (found) return found
      }
    }
    return null
  }
  return visit(root)
}

function cameraOf(layer: LayerLayoutNode): CyclesCamera {
  return {
    centerX: layer.width / 2 + (layer.vanishX ?? 0),
    centerY: layer.height / 2 + (layer.vanishY ?? 0),
    focal: typeof layer.perspective === 'number' ? layer.perspective : 1,
    perspective: layer.perspective ?? 'parallel',
  }
}

/**
 * 相机在层空间里的位置与朝向。
 *
 * 几何已经折进「层镜头空间」：`cameraItems` 把每个网格乘过 `view`，而层镜头
 * 空间里眼的默认位置是 (cx, cy, focal)、朝 -z 看。`cameraView` 只是把作者
 * 世界里的物体搬到这个空间里来，它不该再乘到相机上——否则 orbit 机位会转两次。
 * 所以相机只需要按 vanishX / vanishY 横移，这和灭点偏移的语义一致。
 */
function cameraPose(layer: LayerLayoutNode): { rotation: Mat4; eye: Vec3 } {
  const camera = cameraOf(layer)
  return {
    rotation: IDENTITY4,
    eye: [camera.centerX, camera.centerY, camera.perspective === 'parallel' ? 1e5 : camera.focal],
  }
}

/**
 * 相机到世界。
 *
 * 层空间的眼在 +z、朝 -z 看，`layerToWorld` 把眼翻到世界 -z 一侧；Cycles 的
 * 相机朝自己局部 +z 看，正好背对原点——所以只需要平移，不要旋转。
 *
 * 轴向也对得上：相机局部 +x 是画面向右，+y 是画面向上；世界里 +x 向右、+y 向上。
 * 层空间的 y 向下由 `layerToWorld` 的翻转换成了世界的向上，和画面方向一致。
 */
function cameraMatrix(layer: LayerLayoutNode): Mat4 {
  const { eye } = cameraPose(layer)
  const worldEye = layerToWorld(eye)
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, worldEye[0], worldEye[1], worldEye[2], 1]
}

/**
 * 相机节点。
 *
 * `<transform>` 必须是 `<camera>` 的兄弟节点：`xml_read_camera` 只读 `<camera>`
 * 自己的属性，把矩阵写在里面会被静默丢掉，机位就变成原点。
 */
function cameraTag(layer: LayerLayoutNode, width: number, height: number): string {
  const camera = cameraOf(layer)
  const viewplane = viewplaneFor(width, height, camera.perspective)
  // fov 对着短边算：Standalone 会把窗口重算成长边半径 1（见 `shortSideFov`）。
  const fov = camera.perspective === 'parallel' ? 0 : shortSideFov(camera.focal, width, height)
  const type = camera.perspective === 'parallel' ? 'orthograph' : 'perspective'
  // 单行自闭合：多行的话 `<camera ...>` 会和后面的 `<transform>` 连在一起，
  // 读起来像把矩阵塞进了相机节点。
  const attributes = [
    `width="${width}"`,
    `height="${height}"`,
    `type="${type}"`,
    `fov="${num(fov)}"`,
    `nearclip="0.001"`,
    `farclip="1000000"`,
    `viewplane_left="${num(viewplane.left)}"`,
    `viewplane_right="${num(viewplane.right)}"`,
    `viewplane_bottom="${num(viewplane.bottom)}"`,
    `viewplane_top="${num(viewplane.top)}"`,
  ].join(' ')
  return [
    `<camera ${attributes} />`,
    `<transform ${matrixAttr(cameraMatrix(layer))}><camera type="${type}" /></transform>`,
  ].join('\n')
}

/** 材质表里的一行。相同参数只写一个 shader。 */
type SurfaceDef = {
  name: string
  base: Vec3
  metallic: number
  roughness: number
  transmission: number
  ior: number
  coat: number
  coatRoughness: number
  sheen: number
  anisotropic: number
  /**
   * 色散强度。玻璃/钻石的「火彩」全靠它：光在折射时按波长分开，
   * 棱边才会闪出彩色。0 是普通玻璃，1 接近钻石那种强烈分光。
   */
  dispersion?: number
  emission?: { color: Vec3; strength: number }
  /**
   * 贴图接到哪个插座。`base` 是模型底色；`emission` 对应光栅器的
   * unshaded 平面（屏幕墙纸、键盘井），按固有色发光，不吃灯光明暗。
   */
  texture?: { name: string; uvs: boolean; slot: 'base' | 'emission' }
  /**
   * 平面位图带透明：甲板层只有井 / 触控板是实的，其余 alpha=0。
   * 不按 alpha 切掉的话，透明像素会以黑 emission 盖住下面的银色机身。
   */
  alphaCutout?: boolean
}

function surfaceKey(def: Omit<SurfaceDef, 'name'>): string {
  const { base, metallic, roughness, transmission, ior, coat, coatRoughness, sheen, anisotropic, dispersion, emission, texture, alphaCutout } = def
  return [
    base.map((channel) => channel.toFixed(5)).join(','),
    metallic.toFixed(4),
    roughness.toFixed(4),
    transmission.toFixed(4),
    ior.toFixed(4),
    coat.toFixed(4),
    coatRoughness.toFixed(4),
    sheen.toFixed(4),
    anisotropic.toFixed(4),
    (dispersion ?? 0).toFixed(4),
    emission ? `${emission.color.join(',')}@${emission.strength.toFixed(3)}` : '-',
    texture ? `${texture.name}:${texture.uvs}:${texture.slot}` : '-',
    alphaCutout ? 'cut' : '-',
  ].join('|')
}

/** `material` 的第一个词决定成型方式，其余是参数，和光栅器同一套读法。 */
export function surfaceFor(
  node: MeshLayoutNode,
  fillPaint: string,
  prim: MeshPrim,
  texture: string | null,
): Omit<SurfaceDef, 'name'> {
  const material: MeshMaterial | undefined = node.material
  /* 作者没写 `material` 时，用模型图元自己的成形方式——three 材质已经把
   * `transmission >= 0.5` 判成 glass、`isMeshPhongMaterial` 判成 plastic。
   * 这里退回 'matte' 会把钻石的玻璃通道和粗糙度一起压平，渲染成一块不透光的
   * 灰多面体；光栅器那边用的是 `authored?.kind ?? prim.shade`，两边必须一致。 */
  const kind = material?.kind ?? prim.shade ?? 'matte'
  // 模型图元自带 roughness / metalness / emissive，优先用文件里的。
  const roughness = material?.roughness ?? prim.roughness ?? 1
  // `<model>` 的 fill 缺省是 #000000，直接用会把 glb 的金色机身涂成黑色。
  // 模型自己的 baseColorFactor 才是它的底色；作者显式写了 color 才压过去。
  const fallback: Vec3 = prim.baseColor
    ? [toLinear(prim.baseColor[0]), toLinear(prim.baseColor[1]), toLinear(prim.baseColor[2])]
    : [0.6, 0.6, 0.6]
  const base = material?.color
    ? linearColor(material.color, fallback)
    : prim.baseColor
      ? fallback
      : linearColor(fillPaint, fallback)
  const textureSlot = texture ? { name: texture, uvs: true, slot: 'base' as const } : undefined
  // 模型自带的物理通道（three 的 MeshPhysicalMaterial）。作者没写 `material`
  // 时以它为准：钻石的 transmission 1 / ior 2.42、马克杯的 clearcoat 1 都在这里，
  // 丢掉它们玻璃会变成不透光的多面体、釉面会丢掉那圈高光。
  const lambert: Omit<SurfaceDef, 'name'> = {
    base,
    metallic: Math.min(1, Math.max(0, material?.metalness ?? prim.metalness ?? 0)),
    roughness: Math.min(1, Math.max(0, roughness)),
    transmission: Math.min(1, Math.max(0, material?.transmission ?? prim.transmission ?? 0)),
    ior: Math.max(1, material?.ior ?? prim.ior ?? 1.45),
    coat: Math.min(1, Math.max(0, material?.clearcoat ?? prim.clearcoat ?? 0)),
    coatRoughness: Math.min(1, Math.max(0, prim.clearcoatRoughness ?? 0.03)),
    sheen: Math.min(1, Math.max(0, material?.sheen ?? prim.sheen ?? 0)),
    anisotropic: Math.min(1, Math.max(0, material?.anisotropy ?? prim.anisotropy ?? 0)),
  }
  // 每个 finish 的物理数字来自 `finishes.ts`(和 native 内核同一行)，这里只决定
  // Cycles 侧怎么摆这些槽位。硬编码的 `Math.max(0.22, ...)` / `0.04` 已经去掉：
  // 那种补偿让作者写的粗糙度在 Cycles 里失效，两边读数对不上。
  const preset = FINISHES[kind]
  switch (kind) {
    case 'metal':
    case 'mirror':
    case 'brushed':
      return {
        ...lambert,
        metallic: material?.metalness ?? prim.metalness ?? preset.metalness,
        /* 必须用 `prim.roughness`：模型自带 0.05 的镜面钢，退到 metal 预设的
         * 0.28 会被抹成一片均匀色，AirTag 的钢面就成了白盘子。 */
        roughness: material?.roughness ?? prim.roughness ?? preset.roughness,
        anisotropic: material?.anisotropy ?? prim.anisotropy ?? preset.anisotropy,
        ...(textureSlot ? { texture: textureSlot } : {}),
      }
    case 'plastic':
      return {
        ...lambert,
        coat: material?.clearcoat ?? prim.clearcoat ?? preset.clearcoat,
        coatRoughness: Math.min(1, Math.max(0, prim.clearcoatRoughness ?? preset.clearcoatRoughness)),
        ...(textureSlot ? { texture: textureSlot } : {}),
      }
    case 'glass': {
      const ior = Math.max(1, material?.ior ?? prim.ior ?? preset.ior)
      return {
        ...lambert,
        /* 作者写了 color 用作者的；模型自己带了底色（钻石是纯白 #ffffff）就用
         * 模型的；都没有才退回预设。退回预设会把钻石染成偏灰绿，透射进来的光
         * 被这层灰绿乘掉，刻面就发闷。 */
        base: material?.color || prim.baseColor ? base : linearColor(preset.color, [0.92, 0.96, 0.95]),
        roughness: roughness,
        transmission: material?.transmission ?? prim.transmission ?? preset.transmission,
        ior,
        /* 高折射率（钻石 2.42、蓝宝石 1.77）才给色散。普通玻璃 1.5 分光太弱，
         * 强行加只会让水杯边缘泛彩虹，不像玻璃。 */
        ...(ior >= 1.7 ? { dispersion: 1 } : {}),
        ...(textureSlot ? { texture: textureSlot } : {}),
      }
    }
    case 'lamp':
    case 'neon':
      return {
        ...lambert,
        base: [0, 0, 0],
        roughness: preset.roughness,
        emission: {
          color: linearColor(material?.emissive ?? fillPaint, [1, 0.9, 0.8]),
          strength: preset.emissiveStrength,
        },
      }
    case 'clay':
      return { ...lambert, roughness: material?.roughness ?? preset.roughness, sheen: preset.sheen }
    case 'matte':
      return {
        ...lambert,
        roughness: material?.roughness ?? preset.roughness,
        ...(textureSlot ? { texture: textureSlot } : {}),
      }
    default: {
      // 模型自带的自发光要保留，否则发光的屏幕、灯带会变成死黑。
      const emission = prim.emissive
      const strength = Math.max(emission?.[0] ?? 0, emission?.[1] ?? 0, emission?.[2] ?? 0)
      return {
        ...lambert,
        ...(textureSlot ? { texture: textureSlot } : {}),
        ...(emission && strength > 0.002
          ? { emission: { color: [toLinear(emission[0] * 255), toLinear(emission[1] * 255), toLinear(emission[2] * 255)] as Vec3, strength: 1 } }
          : {}),
      }
    }
  }
}

function surfaceXml(def: SurfaceDef, images: CyclesImage[]): string {
  // 带透明的 unshaded 平面：emission × alpha，其余走 transparent，露出下面的网格。
  if (def.alphaCutout && def.texture?.slot === 'emission') {
    return [
      `<shader name="${attr(def.name)}">`,
      `  <image_texture name="tex" filename="${attr(def.texture.name)}" colorspace="sRGB" interpolation="smart" extension="clip" />`,
      `  <emission name="emit" strength="1" />`,
      `  <connect from="tex color" to="emit color" />`,
      `  <transparent_bsdf name="tr" color="1 1 1" />`,
      `  <mix_closure name="mix" fac="0" />`,
      `  <connect from="tex alpha" to="mix fac" />`,
      `  <connect from="tr bsdf" to="mix closure1" />`,
      `  <connect from="emit emission" to="mix closure2" />`,
      `  <connect from="mix closure" to="output surface" />`,
      `</shader>`,
    ].join('\n')
  }
  const lines: string[] = [`<shader name="${attr(def.name)}">`]
  if (def.texture) {
    lines.push(
      `  <image_texture name="tex" filename="${attr(def.texture.name)}" colorspace="sRGB" interpolation="smart" extension="periodic" />`,
    )
  }
  const texBase = def.texture?.slot === 'base'
  const texEmission = def.texture?.slot === 'emission'
  const principled: string[] = [
    `name="bsdf"`,
    `base_color="${texBase ? '1 1 1' : vec(def.base)}"`,
    `metallic="${num(def.metallic)}"`,
    `roughness="${num(def.roughness)}"`,
    `ior="${num(def.ior)}"`,
    `transmission_weight="${num(def.transmission)}"`,
    `coat_weight="${num(def.coat)}"`,
    `coat_roughness="${num(def.coatRoughness)}"`,
    `sheen_weight="${num(def.sheen)}"`,
    `anisotropic="${num(def.anisotropic)}"`,
  ]
  if ((def.dispersion ?? 0) > 0) {
    /* Abbe number 越小分光越强：20 会让棱边碎成满屏彩虹，读起来像肥皂泡；
     * 35 保留看得出颜色的火彩，同时刻面还是「一块石头」而不是噪点。 */
    principled.push(
      `transmission_dispersion_scale="${num(def.dispersion!)}"`,
      `transmission_dispersion_abbe_number="35"`,
    )
  }
  if (def.emission) {
    principled.push(
      `emission_color="${texEmission ? '1 1 1' : vec(def.emission.color)}"`,
      `emission_strength="${num(def.emission.strength)}"`,
    )
  }
  lines.push(`  <principled_bsdf ${principled.join(' ')} />`)
  if (texBase) lines.push(`  <connect from="tex color" to="bsdf base_color" />`)
  if (texEmission) lines.push(`  <connect from="tex color" to="bsdf emission_color" />`)
  lines.push(`  <connect from="bsdf bsdf" to="output surface" />`, `</shader>`)
  void images
  return lines.join('\n')
}

function groundSurface(fill: string | null, name: string): string {
  const base = linearColor(fill, [0.78, 0.75, 0.7])
  return [
    `<shader name="${attr(name)}">`,
    `  <principled_bsdf name="bsdf" base_color="${vec(base)}" metallic="0" roughness="0.97" specular_ior_level="0.28" />`,
    `  <connect from="bsdf bsdf" to="output surface" />`,
    `</shader>`,
  ].join('\n')
}

/** 假地板在「假如它有 fill」时的默认色，也是物体所处的环境地板色。 */
const SHADOW_CATCHER_FILL = '#efe8df'

/**
 * 阴影捕捉地面。
 *
 * 材质不进可见通道（标了 `is_shadow_catcher` 之后），但它仍然是这台机器上唯一
 * 一块「地面」，物体底部收到的反弹补光全都来自它。所以反照率不能随手写成中性
 * 白：写白（1.0）会比真实地面亮，把物体底部照亮，前景比实体地面那版偏亮一大截
 * ——实测 MacBook 金属机身差 9.6/255，改成真实地面色后降到 6.3，再配上同样的
 * roughness 降到机身核心 0.2/255。
 *
 * 这里用和实体地面一致的 principled（默认地面色 + roughness 0.85），让
 * `combined / catcher` 的分子分母处在同一套光照假设下：除法干净，前景也一致。
 * 逐档扫描 0.6/0.7/0.8/0.9/1.0 的灰度反照率，0.8 附近前景差异最小（1.35/255），
 * 正好对应默认地面色的线性值。
 */
function shadowCatcherXml(background: string | null | undefined): string {
  void background
  const [r, g, b] = linearColor(SHADOW_CATCHER_FILL, [0.8, 0.75, 0.7])
  return [
    `<shader name="${attr(SHADOW_CATCHER_NAME)}">`,
    `  <principled_bsdf name="bsdf" base_color="${num(r)} ${num(g)} ${num(b)}" metallic="0" roughness="0.85" ior="1.45" transmission_weight="0" coat_weight="0" coat_roughness="0.03" sheen_weight="0" anisotropic="0" />`,
    `  <connect from="bsdf bsdf" to="output surface" />`,
    `</shader>`,
  ].join('\n')
}

/** 影棚全景的磁盘路径：打包后在 `assets/env/`，开发时也认 monorepo 旁路。 */
export function resolveStudioHdrPath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '..', 'assets', 'env', STUDIO_HDR_NAME),
    join(here, '..', '..', 'flexlayer-render', 'assets', 'env', STUDIO_HDR_NAME),
    join(here, '..', 'native', 'flexlayer-render', STUDIO_HDR_NAME),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function loadStudioHdrImage(): CyclesImage | null {
  const path = resolveStudioHdrPath()
  if (!path) return null
  return { name: STUDIO_HDR_NAME, bytes: readFileSync(path) }
}

/**
 * 天空。摄影机直接看到的像素用画布底色；照明默认用影棚全景
 * `monochrome_studio_01`（和光栅器同一张），找不到或 `environment="none"`
 * 时退回中性灰。
 *
 * `light_path` 的输出 1 表示从摄影机出发的第一段光线。Fac=1 取 Closure2，
 * Fac=0 取 Closure1：摄影机看到画布色，其余方向采环境。
 */
function skySurface(
  background: string | null | undefined,
  strength: number,
  studioHdr: string | null,
): string {
  const visible = linearColor(background ?? null, [0.92, 0.92, 0.9])
  const lines: string[] = [`<shader name="sky">`, `  <light_path name="path" />`]
  if (studioHdr) {
    // 假地板不靠这里的近似合成（Standalone 的 combined pass 拿不到 matte
    // 分支，见 `cycles-shadow.ts`），所以照明背景保持中性灰托暗部不变。
    // `shadowCatcher` 只用于标记场景需要跑两遍。
    const fill = SKY_NEUTRAL.map((channel) => channel * STUDIO_HDR_FILL) as Vec3
    lines.push(
      // 不写 projection：同名插座有 tex_mapping 和 equirectangular 两套，省掉以免撞车；
      // EnvironmentTextureNode 默认就是 equirectangular。
      `  <environment_texture name="env" filename="${attr(studioHdr)}" interpolation="smart" rotation="${vec(STUDIO_HDR_ROTATION)}" />`,
      // 光栅器把全景彩度压向灰，银色机身才不会反射出暖色。
      // 灰度 = rgb_to_bw 的亮度，三通道合并；再按 saturation 混回 env。
      `  <rgb_to_bw name="lum" />`,
      `  <connect from="env Color" to="lum Color" />`,
      `  <combine_color name="grey" color_type="rgb" />`,
      `  <connect from="lum Val" to="grey R" />`,
      `  <connect from="lum Val" to="grey G" />`,
      `  <connect from="lum Val" to="grey B" />`,
      `  <mix_color name="neutral" blend_type="saturation" Factor="${num(STUDIO_HDR_DESATURATE)}" />`,
      `  <connect from="env Color" to="neutral A" />`,
      `  <connect from="grey Color" to="neutral B" />`,
      `  <background name="hdr" strength="${num(STUDIO_HDR_STRENGTH)}" />`,
      `  <connect from="neutral Result" to="hdr Color" />`,
      `  <background name="fill" color="${vec(fill)}" strength="1" />`,
      `  <add_closure name="lit" />`,
      `  <connect from="hdr Background" to="lit Closure1" />`,
      `  <connect from="fill Background" to="lit Closure2" />`,
    )
  } else {
    const lighting = SKY_NEUTRAL.map((channel) => channel * strength) as Vec3
    lines.push(`  <background name="lit" color="${vec(lighting)}" strength="1" />`)
  }
  // 有全景时 lit 是 add_closure（输出 closure）；兜底时 lit 是 background（输出 background）。
  const litSocket = studioHdr ? 'lit Closure' : 'lit Background'
  lines.push(
    `  <background name="seen" color="${vec(visible)}" strength="${num(SKY_VISIBLE_STRENGTH)}" />`,
    `  <mix_closure name="mix" Fac="0" />`,
    `  <connect from="path is_camera_ray" to="mix Fac" />`,
    `  <connect from="${litSocket}" to="mix Closure1" />`,
    `  <connect from="seen Background" to="mix Closure2" />`,
    `  <connect from="mix Closure" to="output Surface" />`,
    `</shader>`,
  )
  return lines.join('\n')
}

/** 一个网格物体的顶点与三角形。多个图元合并成一个 `<mesh>`。 */
type MeshChunk = {
  positions: number[]
  normals: number[]
  triangles: number[]
  /** 每个顶点一对 uv。图元没有 uv 时为 null。 */
  uvs: number[] | null
}

function emptyChunk(): MeshChunk {
  return { positions: [], normals: [], triangles: [], uvs: null }
}

/**
 * Cycles 的 `UV` 按**角点**索引，不是按顶点：`xml_read_mesh` 遍历每个面的
 * 每个角，用角的序号（而不是 `verts` 里的顶点号）去取 `UV[2i]`。
 * 我们的 `chunk.uvs` 是每顶点一对，所以要按 `triangles` 的顺序摊开成每角一对，
 * 长度必须是总角点数 × 2。
 */
function cornerUvArray(chunk: MeshChunk): number[] | null {
  if (!chunk.uvs) return null
  const corners = chunk.triangles.length
  if (chunk.uvs.length !== chunk.positions.length / 3 * 2) return null
  const out: number[] = []
  for (let i = 0; i < corners; i++) {
    const vertex = chunk.triangles[i]!
    out.push(chunk.uvs[vertex * 2]!, chunk.uvs[vertex * 2 + 1]!)
  }
  return out.length === corners * 2 ? out : null
}

function meshXml(name: string, matrix: Mat4, chunk: MeshChunk, shaderName: string): string {
  const verts: number[] = []
  for (let i = 0; i < chunk.triangles.length; i += 3) {
    verts.push(chunk.triangles[i]!, chunk.triangles[i + 1]!, chunk.triangles[i + 2]!)
  }
  const nverts = new Array(chunk.triangles.length / 3).fill(3).join(' ')
  const attributes = [
    `name="${attr(name)}"`,
    `P="${chunk.positions.map(num).join(' ')}"`,
    `verts="${verts.join(' ')}"`,
    `nverts="${nverts}"`,
  ]
  if (chunk.normals.length === chunk.positions.length) {
    attributes.push(`N="${chunk.normals.map(num).join(' ')}"`)
  }
  const cornerUvs = cornerUvArray(chunk)
  if (cornerUvs) {
    attributes.push(`UV="${cornerUvs.map(num).join(' ')}"`)
  }
  return [
    `<transform ${matrixAttr(matrix)}>`,
    `  <state interpolation="smooth" shader="${attr(shaderName)}">`,
    `    <mesh ${attributes.join(' ')} />`,
    `  </state>`,
    `</transform>`,
  ].join('\n')
}

/**
 * 把 glb 里的底色贴图写成 PNG，返回文件名。贴图只在内存里，Cycles 需要文件。
 *
 * 两边对 v 的读法要对齐。光栅器按 `y = (flipY ? 1-v : v) · (h-1)` 取行，
 * 也就是 `flipY` 为真时 v=0 落在数组**最后一行**；Cycles 的 v=0 固定在
 * 图像**底边**，而 PNG 数组是从顶行写起的。所以：
 *
 * - `flipY` 为真（three 的默认值）时数组本身就是自顶向下，原样写出，
 *   Cycles 的 v=0 读到最后一行，和光栅器一致；再翻一次印花就上下颠倒了。
 * - `flipY` 为假时数组是自底向上，写出前翻一次才对得上。
 */
function writeTexture(prim: MeshPrim, index: number, prefix: string): CyclesImage | null {
  const map = prim.map
  if (!map || map.w <= 0 || map.h <= 0) return null
  const { w, h } = map
  const rgba = new Uint8ClampedArray(w * h * 4)
  const rowBytes = w * 4
  if (map.flipY) {
    rgba.set(map.rgba)
  } else {
    for (let y = 0; y < h; y++) {
      const from = (h - 1 - y) * rowBytes
      rgba.set(map.rgba.subarray(from, from + rowBytes), y * rowBytes)
    }
  }
  const canvas = createCanvas(w, h)
  const context = canvas.getContext('2d')
  const image = context.createImageData(w, h)
  image.data.set(rgba)
  context.putImageData(image, 0, 0)
  return { name: `${prefix}tex-${index}.png`, bytes: canvas.toBuffer('image/png') }
}

/** 平面位图边长上限，跟光栅路径的 `PLANE_BITMAP_CAP` 对齐。 */
const PLANE_TEX_CAP = 2048

/** 整张位图是不是同一个颜色。是的话可以省掉贴图，只留固有色。 */
function uniformRgba(data: Uint8ClampedArray): { r: number; g: number; b: number; a: number } | null {
  if (data.length < 4) return null
  const r = data[0]!
  const g = data[1]!
  const b = data[2]!
  const a = data[3]!
  for (let i = 4; i < data.length; i += 4) {
    if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b || data[i + 3] !== a) return null
  }
  return { r, g, b, a }
}

/**
 * 把相机里的二维平面画成位图。网格子树已经剥掉，只剩墙纸、井、触控板这类装饰。
 *
 * 和光栅器一样：平面是 unshaded 的，固有色就是最终读数。Cycles 里用 emission
 * 接贴图来复现，不然屏幕会吃灯发明暗、键盘井也糊成和机身同一档灰。
 */
function paintPlaneNode(peeled: LayoutNode): Canvas | null {
  if (peeled.width <= 0 || peeled.height <= 0) return null
  let host: LayerLayoutNode
  if (peeled.kind === 'layer') {
    host = peeled
  } else {
    host = {
      ...peeled,
      kind: 'layer',
      path: `${peeled.path}/plane-host`,
      x: 0,
      y: 0,
      width: peeled.width,
      height: peeled.height,
      opacity: 1,
      rotate: 0,
      scaleX: 1,
      scaleY: 1,
      children: [{ ...peeled, x: 0, y: 0 }],
    }
  }
  const painted = paintLayerIsolated(host, true)
  const w = painted.width
  const h = painted.height
  if (w <= 0 || h <= 0) return null
  if (w <= PLANE_TEX_CAP && h <= PLANE_TEX_CAP) return painted
  const fit = PLANE_TEX_CAP / Math.max(w, h)
  const sw = Math.max(1, Math.round(w * fit))
  const sh = Math.max(1, Math.round(h * fit))
  const scaled = createCanvas(sw, sh)
  scaled.getContext('2d').drawImage(painted, 0, 0, sw, sh)
  return scaled
}

function writePlaneTexture(canvas: Canvas, index: number, prefix: string): CyclesImage {
  return { name: `${prefix}plane-${index}.png`, bytes: canvas.toBuffer('image/png') }
}

/**
 * 相机平面 → Cycles 四边形。姿态与 `software-mesh` 的 `planeBatch` 同源，
 * 再走和网格一样的 `layerToWorld` + 绕序翻转。
 */
function planeGeometry(node: LayoutNode, toLayer: Mat4, scale: number): { chunk: MeshChunk; triangles: number } {
  const origin = originOffset(node.origin, node.width, node.height)
  const localX = 0
  const localY = 0
  const logicalWidth = node.width
  const logicalHeight = node.height
  const corners: Array<[number, number]> = [
    [localX, localY],
    [localX + logicalWidth, localY],
    [localX + logicalWidth, localY + logicalHeight],
    [localX, localY + logicalHeight],
  ]
  const chunk = emptyChunk()
  chunk.uvs = []
  for (const [u, v] of corners) {
    // planeBatch：内容坐标减去原点，y 取反；meshPrimGeometries 再加回原点。
    const localPosX = u - origin.x
    const localPosY = -(v - origin.y)
    const posed = applyPoseMatrix(toLayer, localPosX + origin.x, origin.y - localPosY, 0)
    const world = layerToWorld([posed.x, posed.y, posed.z], scale)
    chunk.positions.push(world[0], world[1], world[2])

    const linear = applyPoseLinear(toLayer, 0, 0, 1)
    const normal = layerDirection([linear[0], linear[1], linear[2]])
    const length = Math.hypot(normal[0], normal[1], normal[2]) || 1
    chunk.normals.push(normal[0] / length, normal[1] / length, normal[2] / length)

    chunk.uvs.push((u - localX) / logicalWidth, 1 - (v - localY) / logicalHeight)
  }
  // planeBatch 扇形序 [0,2,1, 0,3,2]；layerToWorld 后默认再翻一次。
  const primIndices = [0, 2, 1, 0, 3, 2]
  const flipWinding = !normalsOpposeWinding({
    ...chunk,
    triangles: primIndices,
  })
  for (let i = 0; i < primIndices.length; i += 3) {
    const ia = primIndices[i]!
    const ib = primIndices[i + 1]!
    const ic = primIndices[i + 2]!
    if (flipWinding) chunk.triangles.push(ia, ic, ib)
    else chunk.triangles.push(ia, ib, ic)
  }
  return { chunk, triangles: 2 }
}

/** 从相机条目取出可画的平面内容（chrome 只留外壳，普通平面剥掉网格）。 */
function planePeeled(item: CameraItem): LayoutNode | null {
  if (item.kind === 'chrome') {
    const shell = { ...item.node, children: [] } as LayoutNode
    return paintable(shell) ? shell : null
  }
  if (item.kind !== 'plane') return null
  if (item.node.kind === 'mesh' || item.node.kind === 'ground') return null
  return stripMeshes(item.node)
}

/** 三个顶点决定的几何法线；退化三角形返回 null。 */
function triangleNormal(positions: number[], ia: number, ib: number, ic: number): Vec3 | null {
  const ax = positions[ia * 3]!, ay = positions[ia * 3 + 1]!, az = positions[ia * 3 + 2]!
  const bx = positions[ib * 3]!, by = positions[ib * 3 + 1]!, bz = positions[ib * 3 + 2]!
  const cx = positions[ic * 3]!, cy = positions[ic * 3 + 1]!, cz = positions[ic * 3 + 2]!
  const ux = bx - ax, uy = by - ay, uz = bz - az
  const vx = cx - ax, vy = cy - ay, vz = cz - az
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const length = Math.hypot(nx, ny, nz)
  if (length < 1e-12) return null
  return [nx / length, ny / length, nz / length]
}

function vertexNormalSum(normals: number[], ia: number, ib: number, ic: number): Vec3 | null {
  if (normals.length === 0) return null
  const sum: Vec3 = [
    (normals[ia * 3] ?? 0) + (normals[ib * 3] ?? 0) + (normals[ic * 3] ?? 0),
    (normals[ia * 3 + 1] ?? 0) + (normals[ib * 3 + 1] ?? 0) + (normals[ic * 3 + 1] ?? 0),
    (normals[ia * 3 + 2] ?? 0) + (normals[ib * 3 + 2] ?? 0) + (normals[ic * 3 + 2] ?? 0),
  ]
  const length = Math.hypot(sum[0], sum[1], sum[2])
  if (length < 1e-12) return null
  return [sum[0] / length, sum[1] / length, sum[2] / length]
}

/**
 * 整个图元的几何法线与着色法线是否**整体相反**。
 *
 * 这不是「逐三角形判据」：绝大多数图元在换手性之后，每个三角形都满足
 * 「几何法线与着色法线同向」（因为绕序朝里、法线朝外），用逐三角形判定
 * 会把它们全部翻成背面。真正的特例是作者显式翻转法线的双面片，那些
 * 三角形整片方向一致地相反，占比很高；用一个多数票就能把它们分开。
 */
function normalsOpposeWinding(chunk: MeshChunk): boolean {
  if (chunk.normals.length === 0) return false
  let agree = 0
  let oppose = 0
  for (let i = 0; i + 2 < chunk.triangles.length; i += 3) {
    const ia = chunk.triangles[i]!
    const ib = chunk.triangles[i + 1]!
    const ic = chunk.triangles[i + 2]!
    const geometric = triangleNormal(chunk.positions, ia, ib, ic)
    const shading = vertexNormalSum(chunk.normals, ia, ib, ic)
    if (!geometric || !shading) continue
    const dot = geometric[0] * shading[0] + geometric[1] * shading[1] + geometric[2] * shading[2]
    if (dot > 0) agree++
    else oppose++
  }
  return oppose > agree
}

/** 单个图元搬进 Cycles 的结果。模型按图元拆开，才能各自带材质和贴图。 */
type PrimGeometry = { chunk: MeshChunk; triangles: number; prim: MeshPrim }

/**
 * 把一只网格的图元搬进「层镜头空间 → 世界」。
 *
 * 顶点先过层姿态（含视图矩阵），再换成米、翻转 y/z。法线只过姿态的线性部分：
 * `applyPoseMatrix` 会带平移，把平移当方向用会让法线整体歪掉。
 */
function meshPrimGeometries(
  node: MeshLayoutNode,
  toLayer: Mat4,
  scale: number,
): PrimGeometry[] {
  const origin = originOffset(node.origin, node.width, node.height)
  const out: PrimGeometry[] = []
  for (const prim of meshPrims(node)) {
    const srcPositions = prim.positions
    const srcIndices = prim.indices
    const vertexCount = Math.floor(srcPositions.length / 3)
    if (vertexCount === 0 || prim.indices.length < 3 || prim.alpha === 0) continue
    const chunk = emptyChunk()
    const hasUvs = prim.uvs && prim.uvs.length >= vertexCount * 2
    if (hasUvs) chunk.uvs = []
    for (let i = 0; i < vertexCount; i++) {
      const localX = srcPositions[i * 3]!
      const localY = srcPositions[i * 3 + 1]!
      const localZ = srcPositions[i * 3 + 2]!
      const posed = applyPoseMatrix(toLayer, localX + origin.x, origin.y - localY, localZ)
      const world = layerToWorld([posed.x, posed.y, posed.z], scale)
      chunk.positions.push(world[0], world[1], world[2])

      const nx = prim.normals[i * 3] ?? 0
      const ny = prim.normals[i * 3 + 1] ?? 0
      const nz = prim.normals[i * 3 + 2] ?? 0
      const linear = applyPoseLinear(toLayer, nx, -ny, nz)
      const normal = layerDirection([linear[0], linear[1], linear[2]])
      const length = Math.hypot(normal[0], normal[1], normal[2]) || 1
      chunk.normals.push(normal[0] / length, normal[1] / length, normal[2] / length)

      if (hasUvs) {
        // glb 的 uv 原点在左上，层空间也是；世界空间不翻转 uv，只翻贴图像素。
        chunk.uvs!.push(prim.uvs![i * 2]!, prim.uvs![i * 2 + 1]!)
      }
    }
    // `layerToWorld` 把 y、z 同时取反，这是个 180° 旋转，行列式为 +1，
    // 但它作用在「已经烘焙好镜头视图」的顶点上，和法线变换叠加后手性相反：
    // 层空间里逆时针朝外的三角形，到这里法线仍然朝外而绕序朝里。Cycles
    // 用绕序定几何法线（着色法线只覆盖明暗），所以这里把每个三角形换序一次。
    //
    // 唯一要额外处理的是「法线被作者手动翻过来」的图元：马克杯内壁为了让
    // 看得见的一侧吃到正确光照，作者把法线整体取反了。这类图元的法线和
    // 绕序本来就一致，不能再翻，否则整圈内壁变成背面、渲成死黑。
    // 判据是「几何法线整体与着色法线相反」，按图元决定而不按三角形。
    const flipWinding = !normalsOpposeWinding(chunk)
    let triangles = 0
    for (let i = 0; i < srcIndices.length; i += 3) {
      const ia = srcIndices[i]!
      const ib = srcIndices[i + 1]!
      const ic = srcIndices[i + 2]!
      if (flipWinding) chunk.triangles.push(ia, ic, ib)
      else chunk.triangles.push(ia, ib, ic)
      triangles++
    }
    out.push({ chunk, triangles, prim })
  }
  return out
}

/**
 * 影棚无缝背景（cyclorama）。
 *
 * 就地平铺一张大方片，透视下远处必然收出一条地平线，和画布底色对不上。
 * 这里改成一条剖面沿左右方向拉开的曲面：
 *
 *   前坡  往镜头这侧斜着往下收走，画面下缘永远不会露出板边
 *   主平面 尽量大，所有物体都摆在上面，接触阴影落在真正的地面上
 *   后弯  用一段大半径圆弧把地面卷起来
 *   背墙  接着竖直往上，一直折到**必定出画**为止
 *
 * 两个关键点：
 *
 * 1. 方向必须由相机决定。「远处」是相机眼点在地面上的投影往反方向走，不能
 *    假设层的 +y 就是远处——地面常带 rotateX，一旦认定反了，前坡会跑到画面
 *    顶上往下掉，露出一条硬线，而背墙被塞到相机背后。
 * 2. 背墙高度按视角解析算：墙脚离眼点有多远、画面顶边对应多大仰角，乘出来
 *    再留余量。这样换画幅、换镜头都不用重调，墙永远盖满顶端。
 */
/**
 * 地面反照率。
 *
 * 作者给的 fill 是「地板上最终看到的颜色」，不是材质本身的反照率。影棚 HDRI 的
 * 总照度远高于 1（这张图平均亮度 76/255，两倍强度下落到地面上的辐照度约 1.6），
 * 直接把它当 albedo 会让地板在每个通道上顶到 255：红、绿通道饱和之后，遮挡只能
 * 把值从 255 压到 255，整套接触阴影因此被裁平——画面上看起来就是「地板没有阴影」。
 *
 * 按 一档余量：出片后地板的漫反射亮度落在 0.95 上下，遮挡还有约 40/255 的压缩
 * 空间，阴影深浅能读出来；再往上调红、绿通道就会顶到 255。色彩关系保持原样。
 */
function groundAlbedo(fill: Vec3): Vec3 {
  return [fill[0] * GROUND_ALBEDO_SCALE, fill[1] * GROUND_ALBEDO_SCALE, fill[2] * GROUND_ALBEDO_SCALE]
}

function groundXml(
  node: GroundLayoutNode,
  toLayer: Mat4,
  span: number,
  shader: string,
  shadowCatcher: boolean,
  eye: Vec3 | null,
  tanHalfV: number,
): string {
  const at = (lx: number, ly: number, lz: number): Vec3 => {
    const posed = applyPoseMatrix(toLayer, lx, ly, lz)
    return layerToWorld([posed.x, posed.y, posed.z])
  }
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1
    return [v[0] / l, v[1] / l, v[2] / l]
  }

  const origin = at(0, 0, 0)
  const rightRaw = sub(at(1, 0, 0), origin)
  const fwdRaw = sub(at(0, 1, 0), origin)
  let up = norm(cross3(fwdRaw, rightRaw))
  if (up[1] < 0) up = [-up[0], -up[1], -up[2]]   // 法线朝上
  const awayRaw = fwdRaw

  /* 「纵深方向」用地面自己的局部 +y——那是作者摆物体时定义的远方向，跟着
   * 地面姿态一起转，天然和物体的透视配套。相机眼点只用来算背墙高度：眼点
   * 在地上的投影距离决定了墙要折多高才出画。 */
  const unit = span * UNIT_SCALE
  /* `away` 必须是「远离相机」的方向；眼点缺失时退回地面局部 +y 的世界朝向。
   * 剖面 d 就沿它度量：d 增大 = 更远。 */
  /* `away` 取地面局部 +y 的世界朝向（s6 那版已验证的走向）：剖面沿 -away 走，
   * 即往远处铺。眼点只用来量距离和高度，不参与定方向。 */
  const away = norm(awayRaw)
  let distOrigin = unit * 1.1
  let eyeHeight = unit * 0.4
  if (eye) {
    const t = sub(eye, origin)
    const h = dot(t, up)
    const planar: Vec3 = [t[0] - up[0] * h, t[1] - up[1] * h, t[2] - up[2] * h]
    const d = Math.hypot(planar[0], planar[1], planar[2])
    if (d > 1e-4) distOrigin = d
    eyeHeight = h
  }
  const right = norm(cross3(up, away))



  /* 尺寸都以「眼点到地面的水平距离」distOrigin 为基准，主平面只铺到物体后方
   * 一点就够，别拉到几百米外——拉太远整条剖面在画面上被压成一团，墙脚会挤到
   * 画面顶端附近，既盖不住顶也留不住纵深。 */
  const reachFront = distOrigin * 1.2 + unit * 0.35   // 往相机这侧伸到脚下
  const flatFar = distOrigin * 0.45 + unit * 0.25     // 主平面往远处铺一小段
  const bendRadius = Math.max(unit * 0.12, distOrigin * 0.28)  // 大圆角过渡
  const frontDrop = Math.max(unit * 0.12, reachFront * 0.22)
  const halfWidth = reachFront * 1.4 + unit * 0.8     // 左右务必盖满画面

  /* 背墙高度按视角解析算：墙脚离眼点的水平距离 × 画面顶边仰角 tan，再加眼点
   * 高度、留余量。墙脚在 distOrigin + flatFar + bendRadius 处，比主平面近得多，
   * 折起来才能真的挡住画面顶部。 */
  const wallFootDist = distOrigin + flatFar + bendRadius
  const wallFootY = origin[1] + up[1] * (bendRadius + (eyeHeight > 0 ? 0 : 0))
  const neededRise = wallFootDist * Math.max(tanHalfV, 0.18) + Math.max(eyeHeight, 0) + unit * 0.4
  const wallReach = Math.max(neededRise / Math.max(0.25, up[1]), unit * 1.2)

  type Pt = { d: number; h: number }   // d: 沿「远」方向的距离；h: 沿法线抬起的高度
  const profile: Pt[] = []
  const push = (d: number, h: number) => profile.push({ d, h })

  /* 剖面沿 -away 铺：d 越小越远。顺序是「远端墙 → 后弯 → 主平面 → 近端」，
   * 一路都在同一个朝上/朝镜头的曲面里，法线天然连续。近端直接收到相机脚下，
   * 不需要额外往下折——相机在上方往下看，脚下那段本来就被画面底边裁掉。 */
  const flatFarEnd = -(flatFar + bendRadius)      // 背墙脚（最远）
  const flatNearEnd = reachFront                   // 主平面近端（相机脚下）
  /* 主平面：从墙脚一路铺到相机脚下，尽量长。 */
  const flatSteps = 26
  for (let i = 0; i <= flatSteps; i++) {
    push(lerp(flatFarEnd, flatNearEnd, i / flatSteps), 0)
  }
  /* 后弯：在远端接一段圆弧卷起来。 */
  const bendSteps = 20
  for (let i = 1; i <= bendSteps; i++) {
    const a = (Math.PI / 2) * (i / bendSteps)
    push(flatFarEnd - bendRadius * Math.sin(a), bendRadius * (1 - Math.cos(a)))
  }
  /* 背墙：竖直往上折到出画。 */
  const wallSteps = 8
  for (let i = 1; i <= wallSteps; i++) {
    push(flatFarEnd - bendRadius, bendRadius + (wallReach * i) / wallSteps)
  }

  /* 整条剖面沿法线退 `GROUND_SEAT_EPSILON`：地面与道具底面共面时，圆弧底壳
   * 的切点附近会有一大片三角形和地板抢同一个深度，渲出来像被地面咬掉一角。
   *
   * 让位量是「半个层像素」，只能乘 `UNIT_SCALE`。曾经误乘 `unit`——那是地面
   * 半边长（海报里 216 个世界单位），让位因此变成 108，整套道具悬空 1.08 m，
   * 接触阴影全部落到地面另一侧，画面上就是「整体地板上没有阴影」。 */
  const seatDrop = GROUND_SEAT_EPSILON * UNIT_SCALE
  const toWorld = (u: number, p: Pt): Vec3 => [
    origin[0] + right[0] * u + away[0] * p.d + up[0] * (p.h - seatDrop),
    origin[1] + right[1] * u + away[1] * p.d + up[1] * (p.h - seatDrop),
    origin[2] + right[2] * u + away[2] * p.d + up[2] * (p.h - seatDrop),
  ]

  const world: number[] = []
  const normals: number[] = []
  const verts: number[] = []
  const cols = [-halfWidth, halfWidth]
  const index = (col: number, row: number) => row * cols.length + col
  for (let row = 0; row < profile.length; row++) {
    for (let col = 0; col < cols.length; col++) {
      const p = toWorld(cols[col]!, profile[row]!)
      world.push(p[0], p[1], p[2])
    }
  }
  /* 法线 = cross(right, 剖面切线)。主平面段得到 up，背墙段得到朝镜头的 -away，
   * 圆弧段平滑过渡；配合 `interpolation="smooth"` 不会有折边。 */
  /* 逐行算法线，并逐行翻向观察者（主平面朝上、背墙朝镜头）。矢量绕序也跟着
   * 这一行翻，两者始终同向——统一用一个 sign 是行不通的，因为前坡本身是下坡，
   * cross 出来的方向天然和主平面相反。 */
  const flipped: boolean[] = []
  for (let row = 0; row < profile.length; row++) {
    const prev = profile[Math.max(0, row - 1)]!
    const next = profile[Math.min(profile.length - 1, row + 1)]!
    const tangent = sub(toWorld(0, next), toWorld(0, prev))
    let n = norm(cross3(tangent, right))
    const ref: Vec3 = eye ? sub(eye, toWorld(0, profile[row]!)) : up
    const needFlip = dot(n, ref) < 0
    if (needFlip) n = [-n[0], -n[1], -n[2]]
    flipped.push(needFlip)
    for (let col = 0; col < cols.length; col++) normals.push(n[0], n[1], n[2])
  }
  /* 绕序按「这一行有没有翻」来定，保证四边形两个三角形的几何法线都跟着顶点
   * 法线走。相邻两行翻转状态不同时，取下一行的状态——四边形以它为准更稳。 */
  for (let row = 0; row < profile.length - 1; row++) {
    const a = index(0, row)
    const b = index(1, row)
    const c = index(1, row + 1)
    const d = index(0, row + 1)
    if (flipped[row]) verts.push(a, b, c, a, c, d)
    else verts.push(a, c, b, a, d, c)
  }

  const objectAttr = shadowCatcher ? ' is_shadow_catcher="true"' : ''
  return [
    `<object${objectAttr}>`,
    `  <state interpolation="smooth" shader="${attr(shader)}">`,
    `    <mesh P="${world.map(num).join(' ')}" N="${normals.map(num).join(' ')}" verts="${verts.join(' ')}" nverts="${'3 '.repeat(verts.length / 3).trim()}" />`,
    `  </state>`,
    `</object>`,
  ].join('\n')
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/**
 * 正交基（列主序）。`travel` 是光线实际前进的方向，也就是这个物体局部的 -z。
 *
 * Cycles 的太阳和聚光灯都从 `-column(2)` 取方向（`SunLight::copy_to_kernel`
 * 里 `co = -transform_get_column(tfm, 2)`），所以只要把「光照向哪」放进 -z，
 * 剩下的 x、y 随便取一组正交的即可。
 */
function aimMatrix(travel: Vec3): Mat4 {
  const z: Vec3 = [-travel[0], -travel[1], -travel[2]]
  const up: Vec3 = Math.abs(z[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]
  const x: Vec3 = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]
  const length = Math.hypot(x[0], x[1], x[2]) || 1
  const nx: Vec3 = [x[0] / length, x[1] / length, x[2] / length]
  const y: Vec3 = [z[1] * nx[2] - z[2] * nx[1], z[2] * nx[0] - z[0] * nx[2], z[0] * nx[1] - z[1] * nx[0]]
  return [
    nx[0], nx[1], nx[2], 0,
    y[0], y[1], y[2], 0,
    z[0], z[1], z[2], 0,
    0, 0, 0, 1,
  ]
}

function normalize3(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

/**
 * 层空间的「照向」方向 → 世界空间的灯光姿态。
 *
 * 层空间 y 向下、+z 朝观众；世界空间 y 向上。`layerDirection` 做这一次翻转，
 * 只做一次——调用方传进来的是层空间的原始向量。
 *
 * 面光和聚光灯的方向取自 `-column(2)`，所以「照向」要放进 `-z`。
 */
function lightMatrix(travelInLayer: Vec3): Mat4 {
  return aimMatrix(normalize3(layerDirection(travelInLayer)))
}

/**
 * 太阳的姿态。
 *
 * `SunLight::copy_to_kernel` 取 `co = -column(2)`，而内核采样时 `ls->P = co`
 * 就是「从表面指向光源」的方向，所以 `column(2)` 指向的是光源那一侧，也就是
 * 光线前进方向的反向。`aimMatrix` 把入参取反后放进 `column(2)`，于是这里直接
 * 传「照向」即可和面光、聚光灯保持一致。
 */
function sunMatrix(travelInLayer: Vec3): Mat4 {
  return aimMatrix(normalize3(layerDirection(travelInLayer)))
}

/**
 * 灯必须挂一个自发光 shader。
 *
 * `Light::copy_to_kernel` 拿 `used_shaders` 里的第一个当灯的光谱，没写就落到
 * `scene->default_light`——那是 strength 0 的 emission，`has_contribution` 直接
 * 判它不出光，整盏灯等于不存在。强弱仍由 `<light strength>` 决定，这里只负责
 * 让灯进得了场景。
 */
const LIGHT_SHADER = 'light-bulb'

function lightShaderXml(): string {
  return [
    `<shader name="${LIGHT_SHADER}">`,
    `  <emission name="emission" color="1 1 1" strength="1" />`,
    `  <connect from="emission emission" to="output surface" />`,
    `</shader>`,
  ].join('\n')
}

function lightColor(light: LightSpec): Vec3 {
  return [toLinear(light.color[0]), toLinear(light.color[1]), toLinear(light.color[2])]
}

function shadowAttrs(light: LightSpec): string {
  return `cast_shadow="${light.castShadow === false ? 'false' : 'true'}"`
}

function authorLightXml(light: LightSpec, index: number, shadowCatcher = false): string | null {
  const color = lightColor(light)
  const strength = light.intensity
  if (strength <= 0) return null

  if (light.type === 'directional') {
    // 作者写的是「光从哪边来」：light - target。光前进的方向正好相反。
    const towardLight: Vec3 = [light.x - light.target[0], light.y - light.target[1], light.z - light.target[2]]
    const travel: Vec3 = [-towardLight[0], -towardLight[1], -towardLight[2]]
    return [
      `<transform ${matrixAttr(sunMatrix(travel))}>`,
      `  <state shader="${LIGHT_SHADER}">`,
      // 作者写的平行光强度就是照度：光栅器直接把它当 E 用（Lambert 读 albedo·E），
      // Cycles 的 sun `strength` 也是 E。这里再乘 π 会比原生亮三倍。
      `    <light light_type="sun" name="author-sun-${index}" strength="${vec(color.map((channel) => channel * strength) as Vec3)}"`,
      ` angle="${num(Math.max(0.005, (light.angle ?? 0.02) * 2))}" ${shadowAttrs(light)} />`,
      `  </state>`,
      `</transform>`,
    ].join('')
  }

  // 环境光和半球光由天空背景承担，不单独写光源。
  if (light.type === 'ambient' || light.type === 'hemisphere') return null

  const position = layerToWorld([light.x, light.y, light.z])
  const power = strength * AUTHOR_LIGHT_POWER
  if (light.type === 'area') {
    const width = Math.max(0.01, (light.width ?? 40) * UNIT_SCALE)
    const height = Math.max(0.01, (light.height ?? 40) * UNIT_SCALE)
    const towardTarget: Vec3 = [light.target[0] - light.x, light.target[1] - light.y, light.target[2] - light.z]
    const aimed = length3(towardTarget) > 1e-6 ? lightMatrix(towardTarget) : IDENTITY4
    const matrix = [...aimed]
    matrix[12] = position[0]
    matrix[13] = position[1]
    matrix[14] = position[2]
    const area = [
      `<transform ${matrixAttr(matrix)}>`,
      `  <state shader="${LIGHT_SHADER}">`,
      `    <light light_type="area" name="author-area-${index}" strength="${vec(color.map((channel) => channel * power) as Vec3)}"`,
      ` sizeu="${num(width)}" sizev="${num(height)}" ${shadowAttrs(light)} />`,
      `  </state>`,
      `</transform>`,
    ].join('')
    // 光栅器的柔光箱几乎不随距离衰减（它按固定半衰距离做近似），Cycles 的
    // 面光却是严格 1/r²。房间尺度的场景里，台面远处会被压暗到出现一条
    // 假地平线——读起来像换了个房间。补一盏同方向、很弱的太阳当作
    // 「远处那份没衰减掉的部分」：太阳没有距离衰减，正好补上这块。
    const travel: Vec3 = [-towardTarget[0], -towardTarget[1], -towardTarget[2]]
    const fill = strength * FLAT_FALLOFF_FILL
    const flat = length3(towardTarget) > 1e-6
      ? [
          `<transform ${matrixAttr(sunMatrix(travel))}>`,
          `  <state shader="${LIGHT_SHADER}">`,
          `    <light light_type="sun" name="author-area-${index}-far" strength="${vec(color.map((channel) => channel * fill * LAMBERT_TO_IRRADIANCE) as Vec3)}" angle="0.6" cast_shadow="true" />`,
          `  </state>`,
          `</transform>`,
        ].join('')
      : ''
    return area + flat
  }

  if (light.type === 'spot') {
    return [
      `<transform ${matrixAttr(positionedMatrix(light))}>`,
      `  <state shader="${LIGHT_SHADER}">`,
      `    <light light_type="spot" name="author-spot-${index}" strength="${vec(color.map((channel) => channel * power) as Vec3)}"`,
      ` angle="${num(clampAngle(light.angle ?? 0.5))}" smooth="${num(clampPenumbra(light.penumbra ?? 0.2))}" ${shadowAttrs(light)} />`,
      `  </state>`,
      `</transform>`,
    ].join('')
  }

  return [
    `<transform ${identityTag(position)}>`,
    `  <state shader="${LIGHT_SHADER}">`,
    `    <light light_type="point" name="author-point-${index}" strength="${vec(color.map((channel) => channel * power) as Vec3)}" ${shadowAttrs(light)} />`,
    `  </state>`,
    `</transform>`,
  ].join('')
}

function length3(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

/** 聚光灯：位置 + 朝 target 的朝向。 */
function positionedMatrix(light: LightSpec): Mat4 {
  const position = layerToWorld([light.x, light.y, light.z])
  const towardTarget: Vec3 = [light.target[0] - light.x, light.target[1] - light.y, light.target[2] - light.z]
  const matrix = [...(length3(towardTarget) > 1e-6 ? lightMatrix(towardTarget) : IDENTITY4)]
  matrix[12] = position[0]
  matrix[13] = position[1]
  matrix[14] = position[2]
  return matrix
}

/** Cycles 的 spot 用 `angle` 当整个锥角，`smooth` 是过渡比例（0–1）。 */
function clampAngle(value: number): number {
  return Math.min(Math.PI * 0.98, Math.max(0.02, value))
}

function clampPenumbra(value: number): number {
  return Math.min(0.999, Math.max(0.01, value))
}

function defaultLightsXml(): string {
  // 和光栅器的默认主光同一个方向：光从左上方偏前打过来。
  const key: Vec3 = [0.6, 0.85, -1]
  const fill: Vec3 = [-0.75, -0.2, -0.45]
  return [
    `<transform ${matrixAttr(sunMatrix(key))}>`,
    `  <state shader="${LIGHT_SHADER}">`,
    `    <light light_type="sun" name="studio-key" strength="${vec([DEFAULT_KEY_STRENGTH, DEFAULT_KEY_STRENGTH * 0.98, DEFAULT_KEY_STRENGTH * 0.94].map((value) => value * LAMBERT_TO_IRRADIANCE) as Vec3)}" angle="0.05" />`,
    `  </state>`,
    `</transform>`,
    `<transform ${matrixAttr(sunMatrix(fill))}>`,
    `  <state shader="${LIGHT_SHADER}">`,
    `    <light light_type="sun" name="studio-fill" strength="${vec([DEFAULT_FILL_STRENGTH * 0.85, DEFAULT_FILL_STRENGTH * 0.9, DEFAULT_FILL_STRENGTH].map((value) => value * LAMBERT_TO_IRRADIANCE) as Vec3)}" angle="0.35" />`,
    `  </state>`,
    `</transform>`,
  ].join('\n')
}

/**
 * film。`exposure` 在 Cycles 里是乘子（默认 1），不是档位偏移；写 0 会把整张图
 * 乘成黑色。这里固定 1，让场景亮度完全由光强决定，和光栅器的读数对得上。
 *
 * `use_approximate_shadow_catcher` 只在有阴影捕捉地面时打开。Standalone 只输出
 * `combined` 一个 pass，而阴影捕捉的合成发生在 `PASS_SHADOW_CATCHER_MATTE` 上：
 * 不开这个开关，`is_shadow_catcher` 会被静默忽略，地面照常渲成实心色块。开了
 * 之后合成是「背景 × 阴影比」，所以不可见的背景仍然由 `skySurface` 的 `seen`
 * 分支提供——和光栅器那张透明地板叠在画布底色上是同一个结果。
 */
function filmTag(options: CyclesEngineOptions, shadowCatcher: boolean): string {
  void options
  const catcher = shadowCatcher ? ' use_approximate_shadow_catcher="true"' : ''
  return `<film exposure="1" filter_type="blackman_harris" filter_width="2"${catcher} />`
}

function integratorTag(options: CyclesEngineOptions): string {
  return [
    `<integrator max_bounce="${Math.max(1, options.maxBounces)}" max_diffuse_bounce="${Math.max(1, Math.min(options.maxBounces, 6))}"`,
    ` max_glossy_bounce="${Math.max(1, Math.min(options.maxBounces, 8))}" max_transmission_bounce="${Math.max(1, Math.min(options.maxBounces, 12))}"`,
    ` use_adaptive_sampling="true" adaptive_threshold="0.01" use_denoise="${options.denoise ? 'true' : 'false'}"`,
    ` denoiser_type="openimagedenoise" use_light_tree="true" sample_clamp_indirect="8" />`,
  ].join('')
}

function backgroundTag(background: string, transparent: boolean): string {
  return transparent
    ? `<background name="bg" transparent="true" />`
    : `<background shader="sky" />`
}

export type ExportOptions = CyclesEngineOptions & {
  /** 覆盖画布尺寸，缺省用文档尺寸。 */
  width?: number
  height?: number
  /** 图片写到这个前缀下，缺省用 `textures/`。 */
  texturePrefix?: string
  /**
   * 跳过所有 ground。
   *
   * 假地板要两次渲染：一次带地面拿阴影，一次不带地面拿干净的背景。第二次就用这个。
   */
  omitGrounds?: boolean
}

/**
 * 把场景写成 Cycles XML。
 *
 * 网格、地面、灯光照常导出；相机里的二维平面（屏幕墙纸、键盘井、触控板）
 * 烘焙成带贴图的四边形，和光栅器 `planeBatch` 同源，这样 Cycles 单档就能看全。
 */
export function exportCyclesScene(doc: LayerDocument, options: ExportOptions): CyclesExport {
  const width = Math.max(1, Math.round(options.width ?? doc.width))
  const height = Math.max(1, Math.round(options.height ?? doc.height))
  const layer = findCameraLayer(doc.root)
  const skipped: string[] = []
  const counts = { meshes: 0, triangles: 0, lights: 0, grounds: 0, planes: 0 }

  if (!layer) {
    skipped.push('场景里没有开了镜头的 layer：只写背景，没有三维内容')
  }

  const items: CameraItem[] = layer ? cameraItems(layer) : []
  const surfaces = new Map<string, SurfaceDef>()
  const images: CyclesImage[] = []
  const meshes: string[] = []
  const grounds: string[] = []
  // 阴影捕捉器是否出现过：它决定 film 要不要开近似合成。
  let hasShadowCatcher = false
  const groundShadowName = SHADOW_CATCHER_NAME
  // 已经写出的贴图名，按出现顺序编号。
  const textures: string[] = []
  const shaders: string[] = []

  const rememberSurface = (def: Omit<SurfaceDef, 'name'>, base: string): string => {
    const key = surfaceKey(def)
    const existing = surfaces.get(key)
    if (existing) return existing.name
    const name = `${base}-${surfaces.size + 1}`
    const full: SurfaceDef = { ...def, name }
    surfaces.set(key, full)
    return name
  }

  for (const item of items) {
    if (item.behind) {
      skipped.push(`${item.node.path}：在相机后面`)
      continue
    }
    if (item.kind === 'plane' || item.kind === 'chrome') {
      counts.planes += 1
      const peeled = planePeeled(item)
      if (!peeled) {
        skipped.push(`${item.node.path}：平面没有可画内容`)
        continue
      }
      const painted = paintPlaneNode(peeled)
      if (!painted) {
        skipped.push(`${item.node.path}：平面烘焙失败`)
        continue
      }
      const pixels = painted.getContext('2d').getImageData(0, 0, painted.width, painted.height)
      const solid = uniformRgba(pixels.data)
      let textureName: string | null = null
      if (!solid) {
        const texture = writePlaneTexture(painted, textures.length, '')
        images.push(texture)
        textures.push(texture.name)
        textureName = texture.name
      }
      // 光栅器平面是 unshaded：固有色即最终读数。用 emission 接贴图复现；
      // 带透明时按 alpha 切掉，否则透明像素会盖住下面的银色机身。
      const base = solid
        ? ([toLinear(solid.r), toLinear(solid.g), toLinear(solid.b)] as Vec3)
        : ([1, 1, 1] as Vec3)
      const def: Omit<SurfaceDef, 'name'> = textureName
        ? {
            base: [0, 0, 0],
            metallic: 0,
            roughness: 1,
            transmission: 0,
            ior: 1.45,
            coat: 0,
            coatRoughness: 0.03,
            sheen: 0,
            anisotropic: 0,
            emission: { color: [1, 1, 1], strength: 1 },
            texture: { name: textureName, uvs: true, slot: 'emission' },
            alphaCutout: true,
          }
        : {
            base,
            metallic: 0,
            roughness: 1,
            transmission: 0,
            ior: 1.45,
            coat: 0,
            coatRoughness: 0.03,
            sheen: 0,
            anisotropic: 0,
            emission: { color: base, strength: 1 },
          }
      const name = rememberSurface(def, 'plane')
      const { chunk, triangles } = planeGeometry(item.node, item.toLayer, UNIT_SCALE)
      const meshName = `${sanitize(item.node.path)}-plane-${counts.meshes}`
      meshes.push(meshXml(meshName, IDENTITY4, chunk, name))
      counts.meshes += 1
      counts.triangles += triangles
      continue
    }
    if (item.kind === 'ground') {
      if (options.omitGrounds) continue
      const node = item.node as GroundLayoutNode
      /* 地面一律当真地板画，不再用阴影捕捉器。
       *
       * 阴影捕捉器会把地板换成一块平铺的背景色，于是接触阴影周围没有「被灯
       * 照亮的地面」托着，物体底下会留一圈脏暗边；被替换掉的那块背景还和画布
       * 底色对不上，在地平线处露出一条硬线。
       *
       * 反过来把地面做成一张够大的真地板：它自然铺满整个视锥，没有边界，接触
       * 阴影落在真实受光的地面上，和作者加了 fill 的地板完全一致。没写 fill
       * 时取画布底色，让「地板」和「背景」本来就是同一个颜色。
       */
      const fill = node.fill ?? doc.background ?? '#efe8df'
      const name = rememberSurface(
        { base: groundAlbedo(linearColor(fill, [0.78, 0.75, 0.7])), metallic: 0, roughness: 0.85, transmission: 0, ior: 1.45, coat: 0, coatRoughness: 0.03, sheen: 0, anisotropic: 0 },
        'ground',
      )
      // 跨度是层像素：`applyPoseMatrix` 之后才由 `layerToWorld` 换成米。
      // 这里再乘一次 `UNIT_SCALE` 会让地面缩成 0.6 m，落在脚下看不见。
      const span = Math.max(width, height) * GROUND_SPAN_FACTOR
      /* 眼点与画面顶边的仰角 tan：背墙要靠它们算高度，才能保证折到出画。 */
      const worldEye = layer ? layerToWorld(cameraPose(layer).eye) : null
      const tanHalfV = layer
        ? Math.tan(shortSideFov(cameraOf(layer).focal, width, height) / 2)
        : Math.tan(Math.PI / 8)
      grounds.push(groundXml(node, item.toLayer, span, name, false, worldEye, tanHalfV))
      counts.grounds += 1
      continue
    }
    const node = item.node as MeshLayoutNode
    const geometries = meshPrimGeometries(node, item.toLayer, UNIT_SCALE)
    if (geometries.length === 0) {
      skipped.push(`${node.path}：没有三角形`)
      continue
    }
    const fill = node.fill ?? '#c8c8c8'
    for (const geometry of geometries) {
      const texture = writeTexture(geometry.prim, textures.length, '')
      if (texture) images.push(texture)
      const def = surfaceFor(node, fill, geometry.prim, texture ? texture.name : null)
      const name = rememberSurface(def, 'mat')
      const meshName = `${sanitize(node.path)}-${counts.meshes}`
      meshes.push(meshXml(meshName, IDENTITY4, geometry.chunk, name))
      counts.meshes += 1
      counts.triangles += geometry.triangles
      if (texture) textures.push(texture.name)
    }
  }

  for (const surface of surfaces.values()) shaders.push(surfaceXml(surface, images))
  if (hasShadowCatcher) {
    shaders.push(shadowCatcherXml(doc.background))
  }
  shaders.push(lightShaderXml())

  const authorLights = layer?.lights ?? []
  const lights: string[] = []
  for (let i = 0; i < authorLights.length; i++) {
    const xml = authorLightXml(authorLights[i]!, i)
    if (xml) lights.push(xml)
  }
  /* `environment="ambient"` 表示「整幅画面只由全景天光决定」：这时不补那两盏
   * 默认太阳。它们原本是光栅器影棚主光的近似（3.0 / 0.8），会在平坦台面上打出
   * 一块可见的照度光斑，和「只用天光」的意图冲突。 */
  const ambientOnly = options.ambientOnly || layer?.environment === 'ambient'
  if (lights.length === 0 && !ambientOnly) lights.push(defaultLightsXml())

  counts.lights = layersLightCount(authorLights)

  const transparent = options.transparent
  // 有镜头且没关环境时用影棚全景；无镜头只留底色兜底，不挂 HDR。
  const wantStudio = !transparent && layer != null && layer.environment !== 'none'
  const studioHdr = wantStudio ? loadStudioHdrImage() : null
  if (studioHdr) images.push(studioHdr)
  else if (wantStudio) skipped.push(`找不到影棚全景 ${STUDIO_HDR_NAME}：环境退回中性灰`)

  const background = transparent
    ? ''
    : skySurface(doc.background, SKY_STRENGTH, studioHdr ? studioHdr.name : null)
  const parts = [
    '<?xml version="1.0"?>',
    '<cycles>',
    filmTag(options, hasShadowCatcher),
    integratorTag(options),
    layer ? cameraTag(layer, width, height) : '',
    background,
    backgroundTag(doc.background, transparent),
    ...shaders,
    ...lights,
    ...grounds,
    ...meshes,
    '</cycles>',
    '',
  ].filter((part) => part !== '')

  return {
    xml: parts.join('\n'),
    width,
    height,
    images,
    counts,
    hasShadowCatcher,
    skipped,
  }
}

function layersLightCount(lights: LightSpec[]): number {
  return lights.filter((light) => light.intensity > 0 && light.type !== 'ambient' && light.type !== 'hemisphere').length
}

function sanitize(path: string): string {
  return path.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'node'
}
