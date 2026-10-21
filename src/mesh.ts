import type { Canvas } from '@napi-rs/canvas'
import {
  meshCacheLimit,
  meshSampleCount,
  meshSceneCacheKey,
  readMeshCache,
  writeMeshCache,
  type MeshClip,
} from './mesh-cache.js'
import { cameraItems } from './camera.js'
import { behindCamera, cameraSceneCustom, hasPerspective, planeDepth, poseMatrix, type Perspective } from './perspective.js'
import { renderMeshSoftware } from './software-mesh.js'
import { flexContentInset, hasBorder } from './style.js'
import type { GroundLayoutNode, LayerLayoutNode, LayoutNode, MeshLayoutNode } from './types.js'

type Mat4 = number[]

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!
    }
  }
  return o
}

function translation(x: number, y: number, z = 0): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
}

/** 这一层自己的 perspective 里有网格，且网格不在更内层的 perspective 中。 */
export function ownsMeshScene(layer: LayerLayoutNode): boolean {
  if (!hasPerspective(layer.perspective)) return false
  const visit = (node: LayoutNode, blocked: boolean): boolean => {
    if (blocked) return false
    if (node.kind === 'mesh' || node.kind === 'ground') return true
    if (node.kind !== 'layer' && node.kind !== 'flex') return false
    const nested = node !== layer && node.kind === 'layer' && hasPerspective(node.perspective)
    return node.children.some((child) => visit(child, nested))
  }
  return visit(layer, false)
}

function paintable(node: LayoutNode): boolean {
  if (node.kind === 'mesh' || node.kind === 'ground') return false
  if (node.kind === 'layer' || node.kind === 'flex') {
    const chrome = (node.background != null && node.background !== 'transparent') || hasBorder(node.border)
    return chrome || node.children.some(paintable)
  }
  return node.width > 0 || node.height > 0
}

/** 嵌套的网格场景保持原对象，好按引用取已经画好的图。其余网格从位图里拿掉。 */
function stripMeshes(node: LayoutNode): LayoutNode | null {
  if (node.kind === 'mesh' || node.kind === 'ground') return null
  if (node.kind === 'layer' && ownsMeshScene(node)) return node
  if (node.kind === 'layer' || node.kind === 'flex') {
    const children = node.children.map(stripMeshes).filter((child): child is LayoutNode => child != null)
    const next = { ...node, children }
    return paintable(next) ? next : null
  }
  return paintable(node) ? node : null
}

export type MeshInstance = { node: MeshLayoutNode; toLayer: Mat4; opacity: number }
export type GroundInstance = { node: GroundLayoutNode; toLayer: Mat4; opacity: number }
type PlaneInstance = { node: LayoutNode; peeled: LayoutNode; toLayer: Mat4 }

function collectMeshes(node: LayoutNode, toParent: Mat4, ancestorOpacity: number, out: MeshInstance[], grounds: GroundInstance[] = []) {
  if (node.kind === 'layer' && ownsMeshScene(node)) return
  const toLayer = mul(toParent, poseMatrix(node))
  if (node.kind === 'mesh') {
    out.push({ node, toLayer, opacity: ancestorOpacity })
    return
  }
  if (node.kind === 'ground') {
    grounds.push({ node, toLayer, opacity: ancestorOpacity })
    return
  }
  if (node.kind === 'layer' || node.kind === 'flex') {
    const insetX = flexContentInset(node).x
    const insetY = flexContentInset(node).y
    const content = mul(toLayer, translation(insetX, insetY))
    const next = ancestorOpacity * (node.opacity ?? 1)
    for (const child of node.children) collectMeshes(child, content, next, out, grounds)
  }
}


export type MeshRaster = {
  canvas: Canvas
  pad: number
  logicalWidth: number
  logicalHeight: number
  /** 位图 (0, 0) 在平面局部的位置。效果留白是负的。 */
  localX: number
  localY: number
  /** 内容坐标里的可见多边形。缺省时用位图四角。 */
  polygon?: Array<{ u: number; v: number }>
}

/** 这一层相机里的网格，和绘制走同一条收集：嵌套的另一台相机会停在自己那一层。 */
export function collectMeshInstances(layer: LayerLayoutNode): MeshInstance[] {
  const perspective = layer.perspective
  const meshes: MeshInstance[] = []
  if (typeof perspective !== 'number' || !(perspective > 0)) return meshes
  for (const child of layer.children) {
    if (planeDepth(child) >= perspective) continue
    collectMeshes(child, IDENTITY, 1, meshes)
  }
  return meshes
}

/** 画进父层的网格画面。x、y 可以是负的，这样物体能溢出所在 layer。 */
export type MeshFrame = { canvas: Canvas; x: number; y: number; width: number; height: number }

export type MeshLayerOptions = {
  /** 这一层坐标里真正可见的范围。光栅和它求交。 */
  clip?: MeshClip
  /** 超采样，1、2 或 4。缺省 4。 */
  samples?: number
  /** 场景缓存上限，字节。false 关闭。缺省看环境变量，再缺省 256MB。 */
  cacheBytes?: number | false
}

function gatherCustom(layer: LayerLayoutNode): {
  perspective: Perspective
  meshes: MeshInstance[]
  grounds: GroundInstance[]
  planes: PlaneInstance[]
} | null {
  const perspective = layer.perspective
  if (!hasPerspective(perspective) || layer.width <= 0 || layer.height <= 0) return null
  const meshes: MeshInstance[] = []
  const grounds: GroundInstance[] = []
  const planes: PlaneInstance[] = []
  for (const item of cameraItems(layer)) {
    if (item.behind) continue
    if (item.kind === 'mesh') {
      meshes.push({ node: item.node as MeshLayoutNode, toLayer: item.toLayer, opacity: item.opacity })
      continue
    }
    if (item.kind === 'ground') {
      grounds.push({ node: item.node as GroundLayoutNode, toLayer: item.toLayer, opacity: item.opacity })
      continue
    }
    if (item.kind === 'chrome') {
      const shell = { ...item.node, children: [] } as LayoutNode
      if (paintable(shell)) planes.push({ node: item.node, peeled: shell, toLayer: item.toLayer })
      continue
    }
    if (item.node.kind === 'mesh' || item.node.kind === 'ground') continue
    const peeled = stripMeshes(item.node)
    if (peeled && paintable(peeled)) planes.push({ node: item.node, peeled, toLayer: item.toLayer })
  }
  if (meshes.length === 0 && grounds.length === 0 && layer.dof == null) return null
  if (meshes.length === 0 && grounds.length === 0 && planes.length === 0) return null
  return { perspective, meshes, grounds, planes }
}

function gather(layer: LayerLayoutNode): {
  perspective: Perspective
  meshes: MeshInstance[]
  grounds: GroundInstance[]
  planes: PlaneInstance[]
} | null {
  if (cameraSceneCustom(layer)) return gatherCustom(layer)
  const perspective = layer.perspective
  if (!hasPerspective(perspective) || layer.width <= 0 || layer.height <= 0) return null
  const meshes: MeshInstance[] = []
  const grounds: GroundInstance[] = []
  const planes: PlaneInstance[] = []
  for (const child of layer.children) {
    if (child.kind !== 'ground' && behindCamera(planeDepth(child), perspective)) continue
    collectMeshes(child, IDENTITY, 1, meshes, grounds)
    if (child.kind === 'mesh' || child.kind === 'ground') continue
    const peeled = stripMeshes(child)
    if (peeled && paintable(peeled)) planes.push({ node: child, peeled, toLayer: poseMatrix(child) })
  }
  if (meshes.length === 0 && grounds.length === 0 && planes.length === 0) return null
  return { perspective, meshes, grounds, planes }
}

/** 和 renderMeshLayer 用同一套输入。无法哈希时返回 null。 */
export function meshLayerCacheKey(layer: LayerLayoutNode, scale: number, samples: number, clip: MeshClip): string | null {
  const scene = gather(layer)
  if (!scene) return null
  return meshSceneCacheKey({ layer, scale, samples: meshSampleCount(samples), clip, ...scene })
}

/**
 * 把这一层的网格和兄弟平面画进同一台相机。返回的画布只盖住可见范围内的物体，背景透明。
 * 没有可画的东西时返回 null，调用方继续走原来的二维透视。
 * 内容没变时直接复用进程里上一次的画面。
 */
export function renderMeshLayer(
  layer: LayerLayoutNode,
  scale: number,
  raster: (node: LayoutNode, toLayer?: number[]) => MeshRaster,
  options?: MeshLayerOptions,
): MeshFrame | null {
  const scene = gather(layer)
  if (!scene) return null
  const samples = meshSampleCount(options?.samples)
  const clip = options?.clip ?? { x: 0, y: 0, width: layer.width, height: layer.height }
  const limit = meshCacheLimit(options?.cacheBytes)
  const key = limit > 0 ? meshSceneCacheKey({ layer, scale, samples, clip, ...scene }) : null
  if (key) {
    const hit = readMeshCache(key)
    if (hit) return hit
  }
  const frame = renderMeshSoftware({
    layer,
    perspective: scene.perspective,
    meshes: scene.meshes,
    planes: scene.planes,
    grounds: scene.grounds,
    scale,
    raster,
    samples,
    clip,
  })
  if (key) writeMeshCache(key, frame, limit)
  return frame
}
