// Native rasterizer implementation
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import type { Perspective } from './perspective.js'
import type { LayerLayoutNode } from './types.js'
import {
  borderQuads,
  buildBoxMesh,
  buildCylinderMesh,
  buildExtrudeMesh,
  buildSphereMesh,
  buildTorusMesh,
  buildTubeMesh,
  circleOfConfusionNative,
  clampCornersNative,
  compositeDof,
  coverStrokesNative,
  downsampleSurfaceNative,
  meshExtractEdges,
  meshStrokeRuns,
  planDepthOfField,
  rasterizeFill,
  roundRectCommands,
  roundedCornerCommands,
  sphereRingPoints,
  transformNormalNative,
  transformPointNative,
  uniformSphereNative,
} from './native-mesh-renderer.mjs'

export {
  borderQuads,
  buildBoxMesh,
  buildCylinderMesh,
  buildExtrudeMesh,
  buildSphereMesh,
  buildTorusMesh,
  buildTubeMesh,
  circleOfConfusionNative,
  clampCornersNative,
  compositeDof,
  coverStrokesNative,
  downsampleSurfaceNative,
  meshExtractEdges,
  meshStrokeRuns,
  planDepthOfField,
  roundRectCommands,
  roundedCornerCommands,
  sphereRingPoints,
  transformNormalNative,
  transformPointNative,
  uniformSphereNative,
}

type RasterRect = { x: number; y: number; width: number; height: number }
type MeshFrame = { canvas: Canvas; x: number; y: number; width: number; height: number }

type Batch = {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array | null
  indices: Uint32Array
  r: number
  g: number
  b: number
  a: number
  doubleSided: boolean
  shaded: boolean
  depthWrite: boolean
  castShadow: boolean
  receiveShadow: boolean
  material: 'lambert' | 'plastic' | 'metal' | 'glass' | 'lamp' | 'neon'
  roughness: number
  matcap?: string | null
  texture: Uint8ClampedArray | null
  tw: number
  th: number
  toLayer: Float64Array | number[]
  originX: number
  originY: number
  owner: number
  emissiveR?: number
  emissiveG?: number
  emissiveB?: number
  lines?: unknown
  segmentIndices?: unknown
  pointIndices?: unknown
}

const MAX_RASTER_SIDE = 8192
const MESH_SAMPLES = 4

function snapDown(x: number, step: number): number {
  return Math.floor(x / step) * step
}

function snapUp(x: number, step: number): number {
  return Math.ceil(x / step) * step
}

function intersectRect(a: RasterRect, b: RasterRect): RasterRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (x >= right || y >= bottom) return null
  return { x, y, width: right - x, height: bottom - y }
}

function padClipEdges(tight: RasterRect, covered: RasterRect, margin: number): RasterRect {
  let x = tight.x
  let y = tight.y
  let width = tight.width
  let height = tight.height
  if (tight.x > covered.x) { x -= margin; width += margin }
  if (tight.y > covered.y) { y -= margin; height += margin }
  if (tight.x + tight.width < covered.x + covered.width) width += margin
  if (tight.y + tight.height < covered.y + covered.height) height += margin
  return { x, y, width, height }
}

export type NativeGround = {
  toLayer: Float64Array | number[]
  opacity: number
  hasFill: boolean
  fillR: number
  fillG: number
  fillB: number
  fillA: number
  inkR: number
  inkG: number
  inkB: number
  inkA: number
  shadowBlur: number
  receiveShadow: boolean
}

export function rasterizeNative(
  batches: Batch[],
  layer: LayerLayoutNode,
  perspective: Perspective,
  scale: number,
  samplesRequested: number,
  clip: RasterRect,
  grounds: NativeGround[] = [],
  keepHi = false,
): MeshFrame & {
  pixels?: Uint8ClampedArray
  depth?: Float32Array
  owners?: Int16Array
  hiWidth?: number
  hiHeight?: number
  samples?: number
  viewW?: number
  viewH?: number
} {
  if (batches.length === 0 && grounds.length === 0) {
    const canvas = createCanvas(1, 1)
    return { canvas, x: 0, y: 0, width: 0, height: 0 }
  }
  const tNative = Date.now()
  const frame = rasterizeFill(
    {
      layerWidth: layer.width,
      layerHeight: layer.height,
      vanishX: layer.vanishX ?? 0,
      vanishY: layer.vanishY ?? 0,
      perspective: perspective === 'parallel' ? 'parallel' : String(perspective),
      scale,
      samples: samplesRequested,
      clipX: clip.x,
      clipY: clip.y,
      clipW: clip.width,
      clipH: clip.height,
      shadows: layer.shadows !== 'none',
      keepHi,
      ...(layer.shading ? { shading: layer.shading } : {}),
      ...(layer.cameraView ? { view: layer.cameraView } : {}),
      ...(layer.lightSpace ? { lightSpace: layer.lightSpace } : {}),
      ...(layer.quality ? { quality: layer.quality } : {}),
      ...(layer.shadowScale && layer.shadowScale > 1 ? { shadowScale: layer.shadowScale } : {}),
      tonemap: layer.tonemap ?? 'neutral',
      environment: layer.environment ?? 'studio',
      ...(layer.lights?.length
        ? {
            lights: layer.lights.map((light) => ({
              kind: light.type,
              r: light.color[0],
              g: light.color[1],
              b: light.color[2],
              intensity: light.intensity,
              x: light.x,
              y: light.y,
              z: light.z,
              tx: light.target[0],
              ty: light.target[1],
              tz: light.target[2],
              // Every other field the kernel's AuthorLight carries. Dropping
              // them here made a spot fall back to the default cone and a point
              // to the default range, which is why spot was a no-op.
              ...(light.distance != null ? { distance: light.distance } : {}),
              ...(light.decay != null ? { decay: light.decay } : {}),
              ...(light.angle != null ? { angle: light.angle } : {}),
              ...(light.penumbra != null ? { penumbra: light.penumbra } : {}),
              ...(light.width != null ? { width: light.width } : {}),
              ...(light.height != null ? { height: light.height } : {}),
              ...(light.castShadow === false ? { castShadow: false } : {}),
              ...(light.groundColor
                ? { groundR: light.groundColor[0], groundG: light.groundColor[1], groundB: light.groundColor[2] }
                : {}),
            })),
          }
        : {}),
    },
    batches,
    grounds,
  )
  if (process.env.DEBUG_RASTER === '1') {
    console.error('RUST', frame.debug, `${Date.now() - tNative}ms`)
  }
  if (keepHi) {
    return {
      canvas: createCanvas(1, 1),
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      pixels: frame.pixels,
      depth: frame.depth,
      owners: frame.owners,
      hiWidth: frame.hiWidth,
      hiHeight: frame.hiHeight,
      samples: frame.samples,
      viewW: frame.viewW,
      viewH: frame.viewH,
    }
  }
  if (!(frame.pixelWidth > 0) || !(frame.pixelHeight > 0)) {
    const canvas = createCanvas(1, 1)
    return { canvas, x: 0, y: 0, width: 0, height: 0 }
  }
  const canvas = createCanvas(frame.pixelWidth, frame.pixelHeight)
  const ctx = canvas.getContext('2d')
  const imageData = ctx.createImageData(frame.pixelWidth, frame.pixelHeight)
  imageData.data.set(frame.pixels)
  ctx.putImageData(imageData, 0, 0)
  return { canvas, x: frame.x, y: frame.y, width: frame.width, height: frame.height }
}
