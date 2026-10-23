import { cameraItems } from './camera.js'
import { circleOfConfusion } from './dof.js'
import { filtersInPaintOrder, getFilter } from './filter.js'
import { MESH_TAGS } from './tags.js'
import { absoluteNodeMatrix, apply, applyToBox, IDENTITY, intersectBox, isIdentity, matrixScale, multiply, translated, type Matrix } from './matrix.js'
import { applyPoseMatrix, behindCamera, cameraSceneCustom, has3dPose, hasPerspective, planeDepth, poseMatrix, posePoint, project as projectPoint, splitsForCamera, type Perspective } from './perspective.js'
import { maskStats } from './mask-stats.js'
import { contentInsets, cssFilterPad, flexContentInset, hasBorder, innerInkStrokeReach, outerInkStrokeReach, overflowClips, shadowLayers } from './style.js'
import type { Box, ColorFilterSpec, ElementReport, LayerDocument, LayerReport, InlineOwner, Issue, LayerLayoutNode, LayoutNode, MeshLayoutNode, MinFontSpec, TextLayoutNode } from './types.js'
import { boxToRect, emptyBox, translateBox, unionBoxes } from './types.js'
import { viewMatrix } from './view.js'

const VISIBLE_OPACITY = 0.01
/** 交叉淡化时两段透明度之和的上限，留一点缓动的余量。 */
const CROSSFADE_SUM = 1.05

type Pt = { x: number; y: number }
type Quad = [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
type Projector = (u: number, v: number) => Pt | null

/** 把平面局部坐标投到画布。localClip 在平面局部里，canvasClip 在画布上。 */
type PlaneSpace = {
  project: Projector
  toPlane: Matrix
  localClip?: Box
  canvasClip?: Box
}

type EffectRecord = { plane: true; box: Box | null } | { plane: false; clip?: Box; base?: Box }

type Mat4 = number[]
const IDENTITY4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function mul4(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!
    }
  }
  return o
}

function translation4(x: number, y: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1]
}

/** 网格在这台 perspective 相机里的投影。toParent 把父级内容坐标变到该 layer。 */
type MeshView = {
  perspective: Perspective
  vx: number
  vy: number
  mapLayerLocal: (x: number, y: number) => Pt | null
  toParent: Mat4
  canvasClip?: Box
}

function meshHalfDepth(node: MeshLayoutNode): number {
  const mesh = node.mesh
  if (mesh.type === 'sphere' || mesh.type === 'cylinder' || mesh.type === 'tube') return mesh.r
  if (mesh.type === 'torus') return mesh.tube
  if (mesh.type === 'box' || mesh.type === 'extrude') return mesh.depth / 2
  if (!mesh.span || node.width <= 0 || node.height <= 0) return 0
  if (mesh.unit != null && mesh.unit > 0) return (mesh.span.z * mesh.unit) / 2
  const sx = mesh.span.x > 1e-6 ? node.width / mesh.span.x : Infinity
  const sy = mesh.span.y > 1e-6 ? node.height / mesh.span.y : Infinity
  const s = Math.min(sx, sy)
  if (!Number.isFinite(s) || s <= 0) return 0
  return (mesh.span.z * s) / 2
}

function meshSamples(node: MeshLayoutNode): Array<[number, number, number]> {
  const fitted = unitModelSamples(node)
  if (fitted) return fitted
  if (node.mesh.type === 'sphere') {
    const r = node.mesh.r
    const cx = node.width / 2
    const cy = node.height / 2
    const pts: Array<[number, number, number]> = []
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      for (const tz of [-0.65, 0, 0.65, 0.92]) {
        const rad = Math.sqrt(Math.max(0, 1 - tz * tz)) * r
        pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, tz * r])
      }
    }
    return pts
  }
  if (node.mesh.type === 'torus') {
    const major = node.mesh.r
    const tube = node.mesh.tube
    const cx = node.width / 2
    const cy = node.height / 2
    const pts: Array<[number, number, number]> = []
    for (let i = 0; i < 32; i++) {
      const theta = (i / 32) * Math.PI * 2
      const ct = Math.cos(theta)
      const st = Math.sin(theta)
      for (let j = 0; j < 16; j++) {
        const phi = (j / 16) * Math.PI * 2
        const rad = major + tube * Math.cos(phi)
        pts.push([cx + rad * ct, cy + rad * st, tube * Math.sin(phi)])
      }
    }
    return pts
  }
  const half = meshHalfDepth(node)
  const pts: Array<[number, number, number]> = []
  for (const u of [0, node.width]) {
    for (const v of [0, node.height]) {
      for (const z of [-half, half]) pts.push([u, v, z])
    }
  }
  return pts
}

/** `unit` 保留模型坐标。(x, y) 是模型原点。着墨按包围盒乘 unit，y 向上。 */
function unitModelSamples(node: MeshLayoutNode): Array<[number, number, number]> | null {
  const mesh = node.mesh
  if (mesh.type !== 'model' || mesh.unit == null || !(mesh.unit > 0) || !mesh.bounds) return null
  const unit = mesh.unit
  const box = mesh.bounds
  const pts: Array<[number, number, number]> = []
  for (const x of [box.minX, box.maxX]) {
    for (const y of [box.minY, box.maxY]) {
      for (const z of [box.minZ, box.maxZ]) pts.push([(x - box.minX) * unit, (box.maxY - y) * unit, z * unit])
    }
  }
  return pts
}

function projectMeshInk(node: MeshLayoutNode, view: MeshView, toLayer: Mat4): Box | null {
  const center = applyPoseMatrix(toLayer, node.width / 2, node.height / 2, 0)
  if (behindCamera(center.z, view.perspective)) return null
  const pts: Pt[] = []
  for (const [u, v, z] of meshSamples(node)) {
    const p = applyPoseMatrix(toLayer, u, v, z)
    const q = projectPoint(view.vx, view.vy, view.perspective, p)
    if (!q) continue
    const mapped = view.mapLayerLocal(q.x, q.y)
    if (mapped) pts.push(mapped)
  }
  const box = boxFromPoints(pts)
  if (!box) return null
  return clipInk(box, view.canvasClip)
}

function inkOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function quadsOverlap(a: Quad, b: Quad): boolean {
  const polys = [a, b]
  for (const poly of polys) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i]!
      const n = poly[(i + 1) % 4]!
      const axis = { x: -(n.y - p.y), y: n.x - p.x }
      let a0 = Infinity
      let a1 = -Infinity
      let b0 = Infinity
      let b1 = -Infinity
      for (const point of a) {
        const d = point.x * axis.x + point.y * axis.y
        a0 = Math.min(a0, d)
        a1 = Math.max(a1, d)
      }
      for (const point of b) {
        const d = point.x * axis.x + point.y * axis.y
        b0 = Math.min(b0, d)
        b1 = Math.max(b1, d)
      }
      if (a1 <= b0 + 1e-3 || b1 <= a0 + 1e-3) return false
    }
  }
  return true
}

/** 同一个公式里的记号是按数学排版规则摆的，着墨盒相交（积分下限、开方指数）不算重叠。 */
function mathRootPath(path: string): string | null {
  const m = path.match(/^(.*?\/math\[\d+\])(\/|$)/)
  return m ? m[1]! : null
}

function hasArea(b: Box): boolean {
  return b.width > 1e-3 && b.height > 1e-3
}

function clipInk(ink: Box, clip: Box | undefined): Box {
  return clip ? intersectBox(ink, clip) : ink
}

type InkEdgeCut = { left: boolean; right: boolean }

/** 裁切把左右边往里推过 1e-3，才算这条边是窗口切出来的。 */
function clippedHorizontal(before: Box, after: Box): InkEdgeCut {
  return {
    left: after.x > before.x + 1e-3,
    right: after.x + after.width < before.x + before.width - 1e-3,
  }
}

function unionCut(a: InkEdgeCut, b: InkEdgeCut): InkEdgeCut {
  return { left: a.left || b.left, right: a.right || b.right }
}

function tighten(clip: Box | undefined, next: Box): Box {
  return clip ? intersectBox(clip, next) : next
}

function nodeMatrix(parent: Matrix, node: LayoutNode): Matrix {
  const pose = absoluteNodeMatrix(node)
  if (isIdentity(pose)) return parent
  return multiply(parent, pose)
}

function cornerList(box: Box): Array<[number, number]> {
  return [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
  ]
}

function boxFromPoints(pts: Pt[]): Box | null {
  if (pts.length === 0) return null
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}

function expandBox(box: Box, pad: number): Box {
  return { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
}

/** 文字、图片、自定义节点的背景或边框铺满外框。没有时返回 null。 */
function boxChrome(node: LayoutNode): Box | null {
  const fills =
    (node.kind === 'text' || node.kind === 'image' || node.kind === 'custom') &&
    ((node.background != null && node.background !== 'transparent') || hasBorder(node.border))
  if (!fills) return null
  return { x: 0, y: 0, width: node.width, height: node.height }
}

/** 描边和阴影的范围要算上底板，不能只从字形外扩。 */
function effectInkLocal(node: LayoutNode): Box {
  const chrome = boxChrome(node)
  if (!chrome) return node.ink
  return unionBoxes(node.ink, chrome)
}

/**
 * 阴影和发光走 canvas `shadowBlur`。看得见的范围大约是 blur 的 0.55 倍，
 * 再往外只剩几乎全透明的尾巴。按 blur 本身会把离边缘还有十几到几十像素的效果报成裁切。
 * 偏移和 spread 是实打实的位移，仍按原值加。图层模糊和玻璃是 CSS `blur()`，外扩按两倍计。
 */
function effectPadOf(node: {
  shadow?: LayoutNode['shadow']
  shadowList?: LayoutNode['shadowList']
  glow?: LayoutNode['glow']
  blur?: number
  glass?: LayoutNode['glass']
  inkStroke?: LayoutNode['inkStroke']
  colorFilter?: ColorFilterSpec[]
  filter?: ColorFilterSpec[]
}): number {
  const visible = 0.55
  const strokeReach = outerInkStrokeReach(node.inkStroke)
  let shadowPad = 0
  for (const shadow of shadowLayers(node.shadow, node.shadowList)) {
    const pad =
      (shadow.blur + shadow.spread + strokeReach) * visible + Math.max(Math.abs(shadow.x), Math.abs(shadow.y))
    if (pad > shadowPad) shadowPad = pad
  }
  const filterPad = cssFilterPad(node.colorFilter ?? node.filter)
  return Math.max(
    shadowPad,
    node.glow ? (node.glow.blur + node.glow.spread + strokeReach) * visible : 0,
    (node.blur != null ? node.blur * 2 : 0) + filterPad,
    node.glass ? node.glass.blur * 2 : 0,
    strokeReach,
  )
}

function localMaskBounds(shapes: LayoutNode[]): Box | undefined {
  let union: Box | null = null
  for (const shape of shapes) {
    const bounds = applyToBox(nodeMatrix(IDENTITY, shape), {
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
    })
    union = union ? unionBoxes(union, bounds) : bounds
  }
  return union ?? undefined
}

/** 方形外扩的四个角在倾斜后会被透视拉出画布，但高斯模糊到不了那个空角。按圆角采样。 */
function roundedOutline(box: Box, radius: number): Pt[] {
  const r = Math.min(radius, box.width / 2, box.height / 2)
  if (r <= 1e-3) return cornerList(box).map(([x, y]) => ({ x, y }))
  const x0 = box.x
  const y0 = box.y
  const x1 = box.x + box.width
  const y1 = box.y + box.height
  const pts: Pt[] = []
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    const n = 4
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
    }
  }
  arc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5)
  arc(x1 - r, y0 + r, -Math.PI / 2, 0)
  arc(x1 - r, y1 - r, 0, Math.PI / 2)
  arc(x0 + r, y1 - r, Math.PI / 2, Math.PI)
  return pts
}

function projectBox(project: Projector, box: Box, cornerRadius = 0): Box {
  if (box.width <= 1e-6 || box.height <= 1e-6) return emptyBox()
  const pts: Pt[] = []
  for (const p of cornerRadius > 0 ? roundedOutline(box, cornerRadius) : cornerList(box).map(([x, y]) => ({ x, y }))) {
    const q = project(p.x, p.y)
    if (q) pts.push(q)
  }
  return boxFromPoints(pts) ?? emptyBox()
}

function placement(plane: PlaneSpace, node: LayoutNode): Matrix {
  return multiply(plane.toPlane, absoluteNodeMatrix(node))
}

/** 节点局部盒子变成平面局部的轴对齐范围。平面根的局部坐标就是平面坐标。 */
function toPlaneBox(plane: PlaneSpace, node: LayoutNode, local: Box, planeRoot: boolean): Box {
  if (planeRoot) return local
  return applyToBox(placement(plane, node), translateBox(local, node.x, node.y))
}

function finishCanvas(box: Box, canvasClip: Box | undefined): Box {
  if (!hasArea(box)) return emptyBox()
  return clipInk(box, canvasClip)
}

function contentToPlane(plane: PlaneSpace, node: LayoutNode, planeRoot: boolean, insetX: number, insetY: number): Matrix {
  if (planeRoot) return translated(insetX, insetY)
  return multiply(placement(plane, node), translated(node.x + insetX, node.y + insetY))
}

function makeProjector(
  node: LayoutNode,
  mapLayerLocal: (x: number, y: number) => Pt | null,
  perspective: Perspective,
  vx: number,
  vy: number,
): Projector {
  return (u, v) => {
    if (behindCamera(planeDepth(node), perspective)) return null
    const q = projectPoint(vx, vy, perspective, posePoint(node, u, v))
    if (!q) return null
    return mapLayerLocal(q.x, q.y)
  }
}

function textAlignShift(node: TextLayoutNode, lineWidth: number): number {
  const inset = contentInsets(node.padding, node.border)
  const inner = node.width - inset.left - inset.right
  if (node.textAlign === 'center') return (inner - lineWidth) / 2
  if (node.textAlign === 'right') return inner - lineWidth
  return 0
}

/** 内容坐标（行内段的 x、行 ink 的 y）变到画布，和文字行的 box 用同一套变换。 */
function mapTextContentBox(
  node: TextLayoutNode,
  content: Box,
  matrix: Matrix,
  clip: Box | undefined,
  plane: PlaneSpace | undefined,
  planeRoot: boolean,
): Box {
  const pad = contentInsets(node.padding, node.border)
  const padX = pad.left
  const padY = pad.top
  if (plane) {
    const local = translateBox(content, padX, padY)
    const placed = toPlaneBox(plane, node, local, planeRoot)
    const visible = plane.localClip ? intersectBox(placed, plane.localClip) : placed
    return finishCanvas(projectBox(plane.project, visible), plane.canvasClip)
  }
  return clipInk(applyToBox(matrix, translateBox(content, node.x + padX, node.y + padY)), clip)
}

function inlineElementReports(
  node: TextLayoutNode,
  matrix: Matrix,
  opacity: number,
  clip: Box | undefined,
  plane: PlaneSpace | undefined,
  planeRoot: boolean,
): ElementReport[] {
  const grouped = new Map<string, { owner: InlineOwner; layout: Box | null; painted: Box | null; lines: Array<{ text: string; box: Box }> }>()
  const order: string[] = []
  for (const line of node.textLayout.lines) {
    const shift = textAlignShift(node, line.width)
    const onLine = new Map<string, { text: string; box: Box }>()
    const flow = line.flowInk ?? line.ink
    for (const seg of line.segments) {
      const owner = seg.owner
      if (!owner || !seg.text) continue
      const piece: Box = { x: shift + seg.x, y: flow.y, width: seg.width, height: flow.height }
      const painted: Box | null = seg.paintInk
        ? { x: shift + seg.paintInk.x, y: seg.paintInk.y, width: seg.paintInk.width, height: seg.paintInk.height }
        : null
      let acc = grouped.get(owner.path)
      if (!acc) {
        acc = { owner, layout: null, painted: null, lines: [] }
        grouped.set(owner.path, acc)
        order.push(owner.path)
      }
      acc.layout = acc.layout ? unionBoxes(acc.layout, piece) : piece
      if (painted && painted.width > 1e-3 && painted.height > 1e-3) {
        acc.painted = acc.painted ? unionBoxes(acc.painted, painted) : painted
      } else if (painted) {
        acc.painted = acc.painted ?? { x: painted.x, y: painted.y, width: 0, height: 0 }
      }
      const part = onLine.get(owner.path)
      if (!part) onLine.set(owner.path, { text: seg.text, box: piece })
      else {
        part.text += seg.text
        part.box = unionBoxes(part.box, piece)
      }
    }
    for (const [path, part] of onLine) grouped.get(path)!.lines.push(part)
  }

  const out: ElementReport[] = []
  for (const path of order) {
    const acc = grouped.get(path)!
    if (!acc.layout) continue
    const layout = mapTextContentBox(node, acc.layout, matrix, clip, plane, planeRoot)
    const ink = mapTextContentBox(node, acc.painted ?? acc.layout, matrix, clip, plane, planeRoot)
    out.push({
      path: acc.owner.path,
      id: acc.owner.id,
      tag: acc.owner.tag,
      inline: true,
      box: boxToRect(layout),
      ink: boxToRect(ink),
      opacity,
      lines: acc.lines.map((line) => ({
        text: line.text,
        box: boxToRect(mapTextContentBox(node, line.box, matrix, clip, plane, planeRoot)),
      })),
    })
  }
  return out
}

type CameraCtx = {
  layer: LayerLayoutNode
  /** 当前节点的父级内容坐标到镜头空间（已乘视图矩阵）。 */
  toLocal: number[]
  mapLayerLocal: (x: number, y: number) => Pt | null
  canvasClip?: Box
}

function walk(
  node: LayoutNode,
  parentMatrix: Matrix,
  parentOpacity: number,
  ox: number,
  oy: number,
  clip: Box | undefined,
  elements: ElementReport[],
  effects: EffectRecord[],
  plane: PlaneSpace | undefined,
  planeRoot: boolean,
  meshView: MeshView | undefined,
  inkSlack: number[],
  maskIssues: Issue[],
  sideCuts: InkEdgeCut[],
  cameraCtx?: CameraCtx,
) {
  const absX = ox + node.x
  const absY = oy + node.y
  const matrix = nodeMatrix(parentMatrix, node)
  const opacity = parentOpacity * node.opacity
  const ownMask = node.kind === 'layer' && node.mask?.length ? localMaskBounds(node.mask) : undefined

  const toLayer = meshView ? mul4(meshView.toParent, poseMatrix(node)) : undefined
  let ink: Box
  let quad: Quad | undefined
  let planeEffect: Box | null = null
  const meshInk = node.kind === 'mesh' && meshView && toLayer ? projectMeshInk(node, meshView, toLayer) : undefined
  let edgeCut: InkEdgeCut = { left: false, right: false }
  if (meshInk) {
    ink = meshInk
  } else if (plane) {
    const localInk = toPlaneBox(plane, node, node.ink, planeRoot)
    let visible = plane.localClip ? intersectBox(localInk, plane.localClip) : localInk
    if (planeRoot && ownMask) visible = intersectBox(visible, ownMask)
    const projected = projectBox(plane.project, visible)
    ink = finishCanvas(projected, plane.canvasClip)
    edgeCut = clippedHorizontal(projected, ink)
    quad = layoutQuad(node, plane, planeRoot)
    const pad = effectPadOf(node)
    if (pad > 0) {
      const grown = toPlaneBox(plane, node, expandBox(effectInkLocal(node), pad), planeRoot)
      let effectLocal = plane.localClip ? intersectBox(grown, plane.localClip) : grown
      if (ownMask) {
        const maskPlane = planeRoot ? ownMask : applyToBox(contentToPlane(plane, node, false, 0, 0), ownMask)
        effectLocal = intersectBox(effectLocal, maskPlane)
      }
      const round = planeRoot && !plane.localClip && !ownMask ? pad : 0
      planeEffect = finishCanvas(projectBox(plane.project, effectLocal, round), plane.canvasClip)
    }
  } else {
    const rawInk = applyToBox(matrix, translateBox(node.ink, node.x, node.y))
    ink = clipInk(rawInk, clip)
    edgeCut = clippedHorizontal(rawInk, ink)
    if (overflowClips(node)) {
      const selfClip = applyToBox(matrix, { x: node.x, y: node.y, width: node.width, height: node.height })
      const next = intersectBox(ink, clip ? intersectBox(selfClip, clip) : selfClip)
      edgeCut = unionCut(edgeCut, clippedHorizontal(ink, next))
      ink = next
    }
  }

  const entry: ElementReport = {
    path: node.path,
    id: node.id,
    tag: node.tag,
    box: boxToRect({ x: absX, y: absY, width: node.width, height: node.height }),
    ink: boxToRect(ink),
    opacity,
  }
  if (quad) entry.quad = quad
  if (node.shadow) entry.shadow = node.shadow
  if (node.shadowList && node.shadowList.length > 1) entry.shadowList = node.shadowList
  if (node.glow) entry.glow = node.glow
  if (node.innerShadow) entry.innerShadow = node.innerShadow
  if (node.innerShadowList && node.innerShadowList.length > 1) entry.innerShadowList = node.innerShadowList
  if (node.innerGlow) entry.innerGlow = node.innerGlow
  if (node.inkStroke) entry.inkStroke = node.inkStroke
  if (node.blur != null) entry.blur = node.blur
  if (node.backdropBlur != null) entry.backdropBlur = node.backdropBlur
  if (node.backdropFilter) {
    const color = node.backdropFilter.filter((step) => step.name !== 'blur')
    if (color.length) entry.backdropFilter = color
  }
  if (node.noise) entry.noise = node.noise
  if (node.overlay) entry.overlay = node.overlay
  if (node.glass) entry.glass = node.glass
  if (node.colorFilter) entry.filter = node.colorFilter
  if (node.blend) entry.blend = node.blend
  if (node.grade) entry.grade = node.grade
  if (node.gradeMask) entry.gradeMask = node.gradeMask
  if (node.anchorBox === 'ink') {
    entry.anchorBox = 'ink'
    entry.inkOffset = node.inkOffset
  }
  const paintedFilters = filtersInPaintOrder(node.filters)
  if (paintedFilters.length) {
    entry.filters = paintedFilters.map((item) => ({
      name: item.name,
      ...(item.mask ? { mask: item.mask } : {}),
      value: getFilter(item.name)?.report?.(item.spec) ?? item.spec,
    }))
  }
  if (node.kind === 'text') {
    const contentPad = contentInsets(node.padding, node.border)
    const contentX = node.x + contentPad.left
    const contentY = node.y + contentPad.top
    entry.fontSize = node.textLayout.fontSize
    entry.lines = node.textLayout.lines.map((line) => {
      const shift = textAlignShift(node, line.width)
      const local = translateBox(
        line.ink,
        contentPad.left + shift,
        contentPad.top,
      )
      const lineBox = plane
        ? finishCanvas(
            projectBox(plane.project, plane.localClip ? intersectBox(toPlaneBox(plane, node, local, planeRoot), plane.localClip) : toPlaneBox(plane, node, local, planeRoot)),
            plane.canvasClip,
          )
        : clipInk(applyToBox(matrix, translateBox(line.ink, contentX + shift, contentY)), clip)
      return { text: line.segments.map((s) => s.text).join(''), box: boxToRect(lineBox) }
    })
  }
  elements.push(entry)
  // 线条贴边时，描边半径不算超出。layer / flex 的 ink 只是子元素的并集，超出与否由子元素自己报。
  const shown = matrixScale(matrix)
  if (Math.abs(shown - 1) > 1e-3) entry.screenScale = shown
  if (node.kind === 'layer' && node.view) entry.view = node.view
  const slack =
    node.kind === 'line' && node.stroke !== 'none' && node.strokeWidth > 0
      ? (node.strokeWidth / 2) * shown
      : node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group'
        ? Number.POSITIVE_INFINITY
        : 0
  inkSlack.push(slack)
  sideCuts.push(edgeCut)

  const inset = flexContentInset(node).x
  const insetY = flexContentInset(node).y
  const childMatrix = multiply(matrix, translated(node.x + inset, node.y + insetY))
  if (node.kind === 'layer' && node.mask?.length) {
    const stats = maskStats(node.mask, node.width, node.height, {
      feather: node.maskFeather,
      invert: node.maskInvert,
      issues: maskIssues,
      path: node.path,
    })
    if (stats) {
      const { ink: maskInk, ...rest } = stats
      entry.mask = plane ? rest : { ...rest, ink: maskInk ? boxToRect(applyToBox(childMatrix, maskInk)) : null }
    }
  }
  let effectClip = clip
  if (!plane && ownMask) effectClip = tighten(effectClip, applyToBox(childMatrix, ownMask))
  const chrome = boxChrome(node)
  effects.push(
    plane
      ? { plane: true, box: planeEffect }
      : {
          plane: false,
          clip: effectClip,
          ...(chrome
            ? { base: clipInk(applyToBox(matrix, translateBox(unionBoxes(node.ink, chrome), node.x, node.y)), clip) }
            : {}),
        },
  )

  if (node.kind === 'text') {
    for (const extra of inlineElementReports(node, matrix, opacity, clip, plane, planeRoot)) {
      elements.push(extra)
      inkSlack.push(0)
      sideCuts.push({ left: false, right: false })
      effects.push(plane ? { plane: true, box: null } : { plane: false, clip: effectClip })
    }
    if (node.inlines) {
      const base = multiply(matrix, translated(node.x, node.y))
      for (const image of node.inlines) {
        walk(image, base, opacity, absX, absY, clip, elements, effects, plane, false, meshView, inkSlack, maskIssues, sideCuts)
      }
    }
  }

  if (node.kind === 'group') {
    const childMatrix = multiply(matrix, node.svg)
    for (const ch of node.children) {
      walk(ch, childMatrix, opacity, ox, oy, clip, elements, effects, undefined, false, meshView, inkSlack, maskIssues, sideCuts)
    }
    return
  }

  if (node.kind === 'layer' || node.kind === 'flex') {
    let childClip = clip
    let childPlane = plane
    const mapping = node.kind === 'layer' && node.view ? viewMatrix(node.width, node.height, node.view) : null
    const contentMatrix = mapping ? multiply(childMatrix, mapping) : childMatrix
    if (plane) {
      let toPlane = contentToPlane(plane, node, planeRoot, inset, insetY)
      let localClip = plane.localClip
      const clipsChildren = overflowClips(node) || (node.kind === 'layer' && node.view != null)
      if (clipsChildren) {
        const viewport = { x: 0, y: 0, width: node.width, height: node.height }
        localClip = tighten(localClip, planeRoot ? viewport : applyToBox(toPlane, viewport))
      }
      if (ownMask) localClip = tighten(localClip, planeRoot ? ownMask : applyToBox(toPlane, ownMask))
      if (mapping) toPlane = multiply(toPlane, mapping)
      childPlane = { ...plane, toPlane, localClip }
    } else {
      if (overflowClips(node) || (node.kind === 'layer' && node.view != null)) {
        const layerClip = applyToBox(matrix, { x: node.x, y: node.y, width: node.width, height: node.height })
        childClip = tighten(childClip, layerClip)
      }
      if (ownMask) childClip = tighten(childClip, applyToBox(childMatrix, ownMask))
    }

    const perspective = node.kind === 'layer' ? node.perspective : undefined
    const opens = hasPerspective(perspective)
    const mapLayerLocal = (x: number, y: number): Pt | null => {
      if (childPlane) {
        const [u, v] = apply(childPlane.toPlane, x, y)
        return childPlane.project(u, v)
      }
      const [cx, cy] = apply(contentMatrix, x, y)
      return { x: cx, y: cy }
    }

    const childMesh: MeshView | undefined = opens
      ? {
          perspective: perspective!,
          vx: node.width / 2,
          vy: node.height / 2,
          mapLayerLocal,
          toParent: IDENTITY4,
          canvasClip: childPlane ? childPlane.canvasClip : childClip,
        }
      : meshView && toLayer
        ? { ...meshView, toParent: mul4(toLayer, translation4(inset, insetY)) }
        : undefined

    const start = elements.length
    const opensOwn = node.kind === 'layer' && hasPerspective(node.perspective)
    const projectChildren = opensOwn ? cameraSceneCustom(node) : !!(cameraCtx && splitsForCamera(node, true))
    if (projectChildren) {
      const camera = opensOwn ? node : cameraCtx!.layer
      const toContent = opensOwn ? (node.cameraView ?? IDENTITY4) : mul4(cameraCtx!.toLocal, translation4(inset, insetY))
      const map = opensOwn ? mapLayerLocal : cameraCtx!.mapLayerLocal
      const clipForChild = opensOwn ? (childPlane ? childPlane.canvasClip : childClip) : cameraCtx!.canvasClip
      const vx = camera.width / 2 + (camera.vanishX ?? 0)
      const vy = camera.height / 2 + (camera.vanishY ?? 0)
      const perspective = camera.perspective!
      for (const ch of node.children) {
        const toLayer = mul4(toContent, poseMatrix(ch))
        const descend = splitsForCamera(ch, !opensOwn && cameraCtx != null)
        const posed = !opensOwn || !!node.cameraMoved || has3dPose(ch) || descend
        const center = applyPoseMatrix(toLayer, ch.width / 2, ch.height / 2, 0)
        const behind = behindCamera(center.z, perspective)
        const project: Projector = (u, v) => {
          if (behind) return null
          const q = projectPoint(vx, vy, perspective, applyPoseMatrix(toLayer, u, v, 0))
          if (!q) return null
          return map(q.x, q.y)
        }
        const childView: MeshView = {
          perspective,
          vx,
          vy,
          mapLayerLocal: map,
          toParent: toContent,
          canvasClip: clipForChild,
        }
        const nextCtx: CameraCtx | undefined = descend
          ? { layer: camera, toLocal: toLayer, mapLayerLocal: map, canvasClip: clipForChild }
          : undefined
        if (!posed) {
          walk(ch, contentMatrix, opacity, absX + inset, absY + insetY, childClip, elements, effects, childPlane, false, childView, inkSlack, maskIssues, sideCuts)
          continue
        }
        walk(
          ch,
          contentMatrix,
          opacity,
          absX + inset,
          absY + insetY,
          childClip,
          elements,
          effects,
          { project, toPlane: IDENTITY, canvasClip: clipForChild },
          true,
          childView,
          inkSlack,
          maskIssues,
          sideCuts,
          nextCtx,
        )
      }
    } else for (const ch of node.children) {
      if (opens && has3dPose(ch)) {
        walk(
          ch,
          contentMatrix,
          opacity,
          absX + inset,
          absY + insetY,
          childClip,
          elements,
          effects,
          {
            project: makeProjector(ch, mapLayerLocal, perspective!, node.width / 2, node.height / 2),
            toPlane: IDENTITY,
            canvasClip: childPlane ? childPlane.canvasClip : childClip,
            localClip: undefined,
          },
          true,
          childMesh,
          inkSlack,
          maskIssues,
          sideCuts,
        )
      } else if (childPlane) {
        walk(ch, contentMatrix, opacity, absX + inset, absY + insetY, childClip, elements, effects, childPlane, false, childMesh, inkSlack, maskIssues, sideCuts)
      } else {
        walk(ch, contentMatrix, opacity, absX + inset, absY + insetY, childClip, elements, effects, undefined, false, childMesh, inkSlack, maskIssues, sideCuts)
      }
    }
    let union: Box | null = null
    const add = (b: Box) => {
      if (b.width <= 1e-3 || b.height <= 1e-3) return
      union = union ? unionBoxes(union, b) : b
    }
    if ((node.background && node.background !== 'transparent') || hasBorder(node.border)) {
      const chrome = plane
        ? finishCanvas(
            projectBox(
              plane.project,
              plane.localClip
                ? intersectBox(toPlaneBox(plane, node, { x: 0, y: 0, width: node.width, height: node.height }, planeRoot), plane.localClip)
                : toPlaneBox(plane, node, { x: 0, y: 0, width: node.width, height: node.height }, planeRoot),
            ),
            plane.canvasClip,
          )
        : clipInk(applyToBox(matrix, { x: node.x, y: node.y, width: node.width, height: node.height }), clip)
      add(chrome)
    }
    for (let i = start; i < elements.length; i++) add(elements[i]!.ink)
    if (union && !plane && (overflowClips(node) || (node.kind === 'layer' && node.view != null))) {
      const selfClip = applyToBox(matrix, { x: node.x, y: node.y, width: node.width, height: node.height })
      union = intersectBox(union, clip ? intersectBox(selfClip, clip) : selfClip)
    }
    if (union && !plane && ownMask) union = intersectBox(union, applyToBox(childMatrix, ownMask))
    if (union) entry.ink = boxToRect(union)
  }
}

function layoutQuad(node: LayoutNode, plane: PlaneSpace, planeRoot: boolean): Quad | undefined {
  const pts: Pt[] = []
  const placed = planeRoot ? null : placement(plane, node)
  for (const [lx, ly] of [
    [0, 0],
    [node.width, 0],
    [node.width, node.height],
    [0, node.height],
  ] as const) {
    let u = lx
    let v = ly
    if (placed) {
      const mapped = apply(placed, node.x + lx, node.y + ly)
      u = mapped[0]
      v = mapped[1]
    }
    const p = plane.project(u, v)
    if (!p) return undefined
    pts.push(p)
  }
  return [pts[0]!, pts[1]!, pts[2]!, pts[3]!]
}

function effectOutside(box: Box, doc: LayerDocument): boolean {
  return box.x < -1e-3 || box.y < -1e-3 || box.x + box.width > doc.width + 1e-3 || box.y + box.height > doc.height + 1e-3
}

function attachDefocus(node: LayoutNode, elements: ElementReport[]) {
  if (node.kind === 'layer' && node.dof && typeof node.perspective === 'number') {
    const byPath = new Map(elements.map((el) => [el.path, el]))
    for (const item of cameraItems(node)) {
      if (item.behind) continue
      const el = byPath.get(item.node.path)
      if (!el) continue
      const coc = circleOfConfusion(node.perspective, item.depth, node.dof, !!item.node.sharp)
      if (coc > 0.05) el.defocus = Math.round(coc * 1000) / 1000
    }
  }
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    for (const child of node.children) attachDefocus(child, elements)
  }
}

export function buildReport(doc: LayerDocument, clock: { frame?: number; fps?: number } = {}): LayerReport {
  const elements: ElementReport[] = []
  const effects: EffectRecord[] = []
  const inkSlack: number[] = []
  const sideCuts: InkEdgeCut[] = []
  const maskIssues: Issue[] = []
  walk(doc.root, IDENTITY, 1, 0, 0, undefined, elements, effects, undefined, false, undefined, inkSlack, maskIssues, sideCuts)
  attachDefocus(doc.root, elements)

  const issues: Issue[] = [...doc.issues, ...maskIssues]
  const visible = elements.filter((el) => el.opacity >= VISIBLE_OPACITY && hasArea(el.ink))
  const minFontHits: Array<{ path: string; shown: number; floor: number; message: string }> = []

  for (let index = 0; index < elements.length; index++) {
    const el = elements[index]!
    if (el.opacity < VISIBLE_OPACITY || !hasArea(el.ink)) continue
    const slack = inkSlack[index] ?? 0
    const edge = 1e-3 + slack
    const inkOutside = el.ink.x + el.ink.width > doc.width + edge || el.ink.y + el.ink.height > doc.height + edge || el.ink.x < -edge || el.ink.y < -edge
    if (inkOutside) {
      issues.push({
        level: 'error',
        code: 'overflow-canvas',
        path: el.path,
        message: '着墨超出画布',
        hint: '舞台比成片大时，用 view="x y w h" 只取要出的那一块。被取景窗裁掉的不算超出',
      })
    }
    const effectPad = effectPadOf(el)
    const recorded = effects[index]
    const screen = el.screenScale ?? 1
    let effectBox: Box | null = null
    if (recorded?.plane) effectBox = recorded.box
    else if (effectPad > 0) {
      const base = recorded && !recorded.plane && recorded.base ? recorded.base : el.ink
      effectBox = clipInk(expandBox(base, effectPad * screen), recorded?.clip)
    }
    if (!MESH_TAGS.has(el.tag) && effectBox && hasArea(effectBox)) el.effect = boxToRect(effectBox)
    if (!MESH_TAGS.has(el.tag) && !inkOutside && effectBox && hasArea(effectBox) && effectOutside(effectBox, doc)) {
      issues.push({
        level: 'warn',
        code: 'effect-clipped',
        path: el.path,
        message: '本体在画布内，但阴影、光晕、描边或模糊超出画布',
        hint: '把元素往里移，或减小 blur / stroke',
      })
    }
    if (!el.inline && el.lines != null && (el.tag === 'h1' || el.tag === 'h2' || el.tag === 'h3' || el.tag === 'p' || el.tag === 'div' || el.tag === 'span')) {
      const cut = sideCuts[index]
      const pastLeft = el.ink.x < doc.safe.left - 1e-3 && !cut?.left
      const pastRight = el.ink.x + el.ink.width > doc.width - doc.safe.right + 1e-3 && !cut?.right
      if ((pastLeft || pastRight) && !inkOutside) {
        issues.push({
          level: 'warn',
          code: 'outside-safe',
          path: el.path,
          message: '文字超出安全区',
          hint: '被取景窗或 overflow="hidden" 裁掉的边不算。裁完仍露在安全区外的字要往里移',
        })
      }
      const minFs = minFontFloor(doc)
      const shownSize = (el.fontSize ?? 0) * (el.screenScale ?? 1)
      if (minFs != null && shownSize < minFs - 1e-3) {
        const sized = el.screenScale != null ? `屏幕上的字号 ${shownSize.toFixed(1)}px` : `字号 ${el.fontSize}px`
        minFontHits.push({
          path: el.path,
          shown: shownSize,
          floor: minFs,
          message: `${sized} 小于建议最小 ${minFs.toFixed(1)}px`,
        })
      }
    }
    if (el.fontSize != null && el.inkStroke) {
      const inner = innerInkStrokeReach(el.inkStroke)
      if (inner >= el.fontSize * 0.08) {
        issues.push({
          level: 'warn',
          code: 'stroke-fill',
          path: el.path,
          message: '小字号宽内描边会填死字内空白（如「口」）',
          hint: '把 inside / center 的内侧宽度收到字号的 8% 以内，或改用 outside',
        })
      }
    }
  }

  if (minFontHits.length === 1) {
    const hit = minFontHits[0]!
    issues.push({
      level: 'warn',
      code: 'min-font-size',
      path: hit.path,
      message: hit.message,
      hint: '根上写 min-font="print" 或 min-font="16"。screen 是 min(宽, 高) / 1080 × 24',
    })
  } else if (minFontHits.length > 1) {
    const smallest = minFontHits.reduce((best, hit) => (hit.shown < best.shown ? hit : best))
    issues.push({
      level: 'warn',
      code: 'min-font-size',
      path: smallest.path,
      message: `${minFontHits.length} 处字号小于建议最小 ${smallest.floor.toFixed(1)}px`,
      hint: `最小的是 ${smallest.shown.toFixed(1)}px（${smallest.path}）。海报写 min-font="print"，或直接写像素 min-font="16"。min-font="none" 关掉这条`,
    })
  }

  const textInks = visible.filter((e) => e.lines != null && !e.inline)
  for (let i = 0; i < textInks.length; i++) {
    for (let j = i + 1; j < textInks.length; j++) {
      const a = textInks[i]!
      const b = textInks[j]!
      const formula = mathRootPath(a.path)
      if (formula && formula === mathRootPath(b.path)) continue
      const overlap = a.quad && b.quad ? quadsOverlap(a.quad, b.quad) : inkOverlap(a.ink, b.ink)
      if (overlap) {
        // 两段都半透明、透明度加起来不过 1：交叉淡化，一段在淡出另一段在淡入。
        const crossfade = a.opacity < 1 && b.opacity < 1 && a.opacity + b.opacity <= CROSSFADE_SUM
        issues.push({
          level: crossfade ? 'info' : 'warn',
          code: 'text-overlap',
          path: a.path,
          message: `文字与 ${b.path} 着墨重叠`,
          ...(crossfade ? { expected: '交叉淡化' } : {}),
        })
      }
    }
  }

  applyExpects(doc.root, issues, { frame: clock.frame ?? 0, fps: clock.fps ?? 0 })

  const sources = doc.sources
  if (sources && sources.size > 0) {
    for (const el of elements) {
      const source = sources.get(el.path)
      if (source) el.source = source
    }
    for (const issue of issues) {
      if (issue.source) continue
      const source = sources.get(issue.path)
      if (source) issue.source = source
    }
  }

  return {
    flexlayer: '0.1',
    width: doc.width,
    height: doc.height,
    elements,
    issues,
  }
}


/** 可以写进 expect 的问题码。不含 unused-expect 自己。 */
const EXPECT_CODES = new Set([
  'overflow-canvas',
  'outside-safe',
  'text-overflow',
  'flex-overflow',
  'text-overlap',
  'min-font-size',
  'auto-wrap',
  'non-canonical',
  'unknown-tag',
  'invalid-attr',
  'invalid-child',
  'empty-mask',
  'mask-op-noop',
  'invalid-draw',
  'invalid-script',
  'unsupported-dom',
  'unsupported-webgl',
  'missing-image',
  'missing-icon',
  'missing-model',
  'missing-symbol',
  'symbol-cycle',
  'open-curve-fill',
  'implicit-stroke',
  'effect-clipped',
  'view-outside',
  'flatten-3d',
  'output-limit',
  'input-limit',
  'flattened-3d',
  'behind-camera',
  'emit-draw',
  'emit-script',
  'emit-data',
  'nondeterministic',
  'fillet-too-large',
  'no-intersection',
  'offset-collapse',
  'empty-geometry',
  'not-a-curve',
  'curve-unsupported',
  'type-error',
  'measure-mismatch',
  'ink-inset',
  'ink-anchor-empty',
  'ink-anchor-rotate',
])

type ExpectDecl = { path: string; code: string; reason?: string; used: boolean; window?: { start: number; end: number } }

function expectCovers(expectPath: string, issuePath: string): boolean {
  return issuePath === expectPath || issuePath.startsWith(`${expectPath}/`)
}

function frameInside(window: { start: number; end: number } | undefined, frame: number): boolean {
  if (!window) return true
  return frame >= window.start && frame <= window.end
}

function parseExpectWindow(
  raw: string,
  fps: number,
  path: string,
  issues: Issue[],
): { start: number; end: number } | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*(s)?\s*-\s*(\d+(?:\.\d+)?)\s*(s)?$/.exec(raw.trim())
  if (!match) {
    issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path,
      message: `无法解析 expect 区间: ${raw}`,
      hint: '写成 @800-846 或 @26.7s-28.2s，两端都包含',
    })
    return undefined
  }
  const leftUnit = match[2]
  const rightUnit = match[4]
  if (Boolean(leftUnit) !== Boolean(rightUnit)) {
    issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path,
      message: `expect 区间的单位要成对: ${raw}`,
      hint: '帧号写成 @800-846，秒数写成 @26.7s-28.2s',
    })
    return undefined
  }
  const left = Number(match[1])
  const right = Number(match[3])
  let start = left
  let end = right
  if (leftUnit) {
    if (!(fps > 0)) {
      issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path,
        message: `expect 的秒数需要帧率: ${raw}`,
        hint: '这段片子要有 fps，或改成帧号 @800-846',
      })
      return undefined
    }
    start = Math.round(left * fps)
    end = Math.round(right * fps)
  } else if (!Number.isInteger(left) || !Number.isInteger(right)) {
    issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path,
      message: `expect 的帧号要是整数: ${raw}`,
      hint: '帧号写成 @800-846。秒数加 s，例如 @26.7s-28.2s',
    })
    return undefined
  }
  if (start > end) {
    issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path,
      message: `expect 区间颠倒了: ${raw}`,
      hint: '先写开始，再写结束，例如 @800-846',
    })
    return undefined
  }
  return { start, end }
}

function collectExpects(node: LayoutNode, decls: ExpectDecl[], issues: Issue[], fps: number) {
  const raw = node.attr.expect?.trim()
  if (raw) {
    for (const part of raw.split(';')) {
      const piece = part.trim()
      if (!piece) continue
      const colon = piece.indexOf(':')
      const head = (colon < 0 ? piece : piece.slice(0, colon)).trim()
      const reason = colon < 0 ? '' : piece.slice(colon + 1).trim()
      const at = head.indexOf('@')
      const code = (at < 0 ? head : head.slice(0, at)).trim()
      const windowRaw = at < 0 ? '' : head.slice(at + 1).trim()
      if (!EXPECT_CODES.has(code)) {
        issues.push({
          level: 'warn',
          code: 'invalid-attr',
          path: node.path,
          message: `expect 不认识 ${code}`,
          hint: '写成报告里已有的问题码，例如 overflow-canvas。区间写成 overflow-canvas@800-846',
        })
        continue
      }
      let window: { start: number; end: number } | undefined
      if (windowRaw) {
        window = parseExpectWindow(windowRaw, fps, node.path, issues)
        if (!window) continue
      }
      decls.push({ path: node.path, code, reason: reason || undefined, used: false, window })
    }
  }
  if (node.kind === 'layer' && node.mask) {
    for (const shape of node.mask) collectExpects(shape, decls, issues, fps)
  }
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    for (const child of node.children) collectExpects(child, decls, issues, fps)
  }
}

function applyExpects(root: LayoutNode, issues: Issue[], clock: { frame: number; fps: number }) {
  const decls: ExpectDecl[] = []
  collectExpects(root, decls, issues, clock.fps)
  for (const issue of issues.slice()) {
    const hits = decls.filter(
      (decl) => decl.code === issue.code && expectCovers(decl.path, issue.path) && frameInside(decl.window, clock.frame),
    )
    if (hits.length === 0) continue
    for (const hit of hits) hit.used = true
    const deepest = hits.reduce((best, hit) => (hit.path.length >= best.path.length ? hit : best))
    issue.level = 'info'
    if (deepest.reason) issue.expected = deepest.reason
  }
  for (const decl of decls) {
    if (decl.used || !frameInside(decl.window, clock.frame)) continue
    const span = decl.window
      ? decl.window.start === decl.window.end
        ? `第${decl.window.start}帧`
        : `第${decl.window.start}–${decl.window.end}帧`
      : ''
    issues.push({
      level: 'warn',
      code: 'unused-expect',
      path: decl.path,
      message: span ? `${span}没有出现 ${decl.code}` : `没有出现 ${decl.code}`,
      hint: '删掉这句 expect，或确认问题码写的是子树里真会出现的那一个',
      expect: { code: decl.code },
    })
  }
}

/**
 * 加载源文件时产生的问题（几何函数、nondeterministic）不挂在节点上，只由根上的 expect 认领。
 * 认领到的降成 info，同时撤掉根上同一问题码的 unused-expect。
 */
export function applyRootExpects(report: LayerReport, fileIssues: Issue[], rootExpect: string | undefined): void {
  const raw = rootExpect?.trim()
  if (!raw || fileIssues.length === 0) return
  const reasons = new Map<string, string>()
  for (const part of raw.split(';')) {
    const piece = part.trim()
    const colon = piece.indexOf(':')
    const head = (colon < 0 ? piece : piece.slice(0, colon)).trim()
    if (head.includes('@')) continue
    reasons.set(head, colon < 0 ? '' : piece.slice(colon + 1).trim())
  }
  const used = new Set<string>()
  for (const issue of fileIssues) {
    const reason = reasons.get(issue.code)
    if (reason == null) continue
    used.add(issue.code)
    issue.level = 'info'
    if (reason) issue.expected = reason
  }
  if (used.size === 0) return
  const root = report.elements[0]?.path ?? 'layer'
  report.issues = report.issues.filter((i) => !(i.code === 'unused-expect' && i.path === root && i.expect && used.has(i.expect.code)))
}

function minFontFloor(doc: LayerDocument): number | null {
  const spec: MinFontSpec = doc.minFont ?? { mode: 'screen' }
  if (spec.mode === 'none') return null
  if (spec.mode === 'px') return spec.px
  const ratio = spec.mode === 'print' ? 12 : 24
  return (Math.min(doc.width, doc.height) / 1080) * ratio
}

function formatFrameSpan(frames: Array<[number, number]> | undefined): string {
  if (!frames || frames.length === 0) return ''
  const text = frames
    .map(([start, end]) => (start === end ? `第${start}帧` : `第${start}–${end}帧`))
    .join('、')
  return `${text}  `
}

export function formatIssueLine(issue: Issue): string {
  const sym = issue.level === 'error' ? '✗ error' : issue.level === 'warn' ? '! warn' : '· info'
  const at = issue.source ? `${issue.source}  ` : ''
  const frame = formatFrameSpan(issue.frames)
  const line = `${at}${frame}${sym}  ${issue.code.padEnd(16)} ${issue.path.padEnd(24)} ${issue.message}`
  // 已经被 expect 或入场、出场、交叉淡化认下来的，写出原因，不再重复改法。
  if (issue.expected != null) return `${line}  ← ${issue.expected}`
  return issue.hint ? `${line}\n         ${issue.hint}` : line
}
