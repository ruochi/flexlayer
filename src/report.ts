import { apply, applyToBox, aroundPivot, IDENTITY, intersectBox, multiply, originOffset, translated, type Matrix } from './matrix.js'
import { applyPoseMatrix, has3dPose, planeDepth, poseMatrix, posePoint, project as projectPoint } from './perspective.js'
import type { Box, ElementReport, FvgDocument, FvgReport, Issue, LayoutNode, MeshLayoutNode } from './types.js'
import { boxToRect, emptyBox, translateBox, unionBoxes } from './types.js'

const VISIBLE_OPACITY = 0.01

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

type EffectRecord = { plane: true; box: Box | null } | { plane: false; clip?: Box }

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
  perspective: number
  vx: number
  vy: number
  mapLayerLocal: (x: number, y: number) => Pt | null
  toParent: Mat4
  canvasClip?: Box
}

function meshHalfDepth(node: MeshLayoutNode): number {
  const mesh = node.mesh
  if (mesh.type === 'sphere') return mesh.r
  if (mesh.type === 'box' || mesh.type === 'extrude') return mesh.depth / 2
  if (!mesh.span || node.width <= 0 || node.height <= 0) return 0
  const sx = mesh.span.x > 1e-6 ? node.width / mesh.span.x : Infinity
  const sy = mesh.span.y > 1e-6 ? node.height / mesh.span.y : Infinity
  const s = Math.min(sx, sy)
  if (!Number.isFinite(s) || s <= 0) return 0
  return (mesh.span.z * s) / 2
}

function meshSamples(node: MeshLayoutNode): Array<[number, number, number]> {
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
  const half = meshHalfDepth(node)
  const pts: Array<[number, number, number]> = []
  for (const u of [0, node.width]) {
    for (const v of [0, node.height]) {
      for (const z of [-half, half]) pts.push([u, v, z])
    }
  }
  return pts
}

function projectMeshInk(node: MeshLayoutNode, view: MeshView, toLayer: Mat4): Box | null {
  const center = applyPoseMatrix(toLayer, node.width / 2, node.height / 2, 0)
  if (center.z >= view.perspective) return null
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

const MESH_TAGS = new Set(['sphere', 'box', 'extrude', 'model'])

function inkOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function hasArea(b: Box): boolean {
  return b.width > 1e-3 && b.height > 1e-3
}

function clipInk(ink: Box, clip: Box | undefined): Box {
  return clip ? intersectBox(ink, clip) : ink
}

function tighten(clip: Box | undefined, next: Box): Box {
  return clip ? intersectBox(clip, next) : next
}

function nodeMatrix(parent: Matrix, node: LayoutNode): Matrix {
  if (node.rotate === 0 && node.scale === 1) return parent
  const o = originOffset(node.origin, node.width, node.height)
  return multiply(parent, aroundPivot(node.x + o.x, node.y + o.y, node.rotate, node.scale))
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

/**
 * 阴影和发光走 canvas `shadowBlur`，看得见的范围大约就是 blur 本身。
 * 按 blur×2 会把明明还在画布里的效果报成裁切。
 * 图层模糊和玻璃是 CSS `blur()`，参数是标准差，外扩仍按两倍计。
 */
function effectPadOf(node: { shadow?: LayoutNode['shadow']; glow?: LayoutNode['glow']; blur?: number; glass?: LayoutNode['glass'] }): number {
  return Math.max(
    node.shadow ? node.shadow.blur + node.shadow.spread + Math.max(Math.abs(node.shadow.x), Math.abs(node.shadow.y)) : 0,
    node.glow ? node.glow.blur + node.glow.spread : 0,
    node.blur != null ? node.blur * 2 : 0,
    node.glass ? node.glass.blur * 2 : 0,
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
  const o = originOffset(node.origin, node.width, node.height)
  return multiply(plane.toPlane, aroundPivot(node.x + o.x, node.y + o.y, node.rotate, node.scale))
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
  perspective: number,
  vx: number,
  vy: number,
): Projector {
  return (u, v) => {
    if (planeDepth(node) >= perspective) return null
    const q = projectPoint(vx, vy, perspective, posePoint(node, u, v))
    if (!q) return null
    return mapLayerLocal(q.x, q.y)
  }
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
  if (meshInk) {
    ink = meshInk
  } else if (plane) {
    const localInk = toPlaneBox(plane, node, node.ink, planeRoot)
    let visible = plane.localClip ? intersectBox(localInk, plane.localClip) : localInk
    if (planeRoot && ownMask) visible = intersectBox(visible, ownMask)
    ink = finishCanvas(projectBox(plane.project, visible), plane.canvasClip)
    quad = layoutQuad(node, plane, planeRoot)
    const pad = effectPadOf(node)
    if (pad > 0) {
      const grown = toPlaneBox(plane, node, expandBox(node.ink, pad), planeRoot)
      let effectLocal = plane.localClip ? intersectBox(grown, plane.localClip) : grown
      if (ownMask) {
        const maskPlane = planeRoot ? ownMask : applyToBox(contentToPlane(plane, node, false, 0, 0), ownMask)
        effectLocal = intersectBox(effectLocal, maskPlane)
      }
      const round = planeRoot && !plane.localClip && !ownMask ? pad : 0
      planeEffect = finishCanvas(projectBox(plane.project, effectLocal, round), plane.canvasClip)
    }
  } else {
    ink = clipInk(applyToBox(matrix, translateBox(node.ink, node.x, node.y)), clip)
    if (node.kind === 'layer' && node.overflow === 'hidden') {
      const selfClip = applyToBox(matrix, { x: node.x, y: node.y, width: node.width, height: node.height })
      ink = intersectBox(ink, clip ? intersectBox(selfClip, clip) : selfClip)
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
  if (node.glow) entry.glow = node.glow
  if (node.innerShadow) entry.innerShadow = node.innerShadow
  if (node.innerGlow) entry.innerGlow = node.innerGlow
  if (node.blur != null) entry.blur = node.blur
  if (node.backdropBlur != null) entry.backdropBlur = node.backdropBlur
  if (node.noise) entry.noise = node.noise
  if (node.overlay) entry.overlay = node.overlay
  if (node.glass) entry.glass = node.glass
  if (node.colorFilter) entry.filter = node.colorFilter
  if (node.blend) entry.blend = node.blend
  if (node.grade) entry.grade = node.grade
  if (node.gradeMask) entry.gradeMask = node.gradeMask
  if (node.kind === 'text') {
    const contentX = node.x + node.padding.left + (node.border?.width ?? 0)
    const contentY = node.y + node.padding.top + (node.border?.width ?? 0)
    entry.fontSize = node.textLayout.fontSize
    entry.lines = node.textLayout.lines.map((line) => {
      const local = translateBox(line.ink, node.padding.left + (node.border?.width ?? 0), node.padding.top + (node.border?.width ?? 0))
      const lineBox = plane
        ? finishCanvas(
            projectBox(plane.project, plane.localClip ? intersectBox(toPlaneBox(plane, node, local, planeRoot), plane.localClip) : toPlaneBox(plane, node, local, planeRoot)),
            plane.canvasClip,
          )
        : clipInk(applyToBox(matrix, translateBox(line.ink, contentX, contentY)), clip)
      return { text: line.segments.map((s) => s.text).join(''), box: boxToRect(lineBox) }
    })
  }
  elements.push(entry)
  // 线条贴边时，描边半径不算超出。layer / flex 的 ink 只是子元素的并集，超出与否由子元素自己报。
  const slack =
    node.kind === 'line' && node.stroke !== 'none' && node.strokeWidth > 0
      ? node.strokeWidth / 2
      : node.kind === 'layer' || node.kind === 'flex'
        ? Number.POSITIVE_INFINITY
        : 0
  inkSlack.push(slack)

  const inset = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
  const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
  const childMatrix = multiply(matrix, translated(node.x + inset, node.y + insetY))
  let effectClip = clip
  if (!plane && ownMask) effectClip = tighten(effectClip, applyToBox(childMatrix, ownMask))
  effects.push(plane ? { plane: true, box: planeEffect } : { plane: false, clip: effectClip })

  if (node.kind === 'layer' || node.kind === 'flex') {
    let childClip = clip
    let childPlane = plane
    if (plane) {
      const toPlane = contentToPlane(plane, node, planeRoot, inset, insetY)
      let localClip = plane.localClip
      if (node.kind === 'layer' && node.overflow === 'hidden') {
        localClip = tighten(localClip, planeRoot ? { x: 0, y: 0, width: node.width, height: node.height } : applyToBox(toPlane, { x: 0, y: 0, width: node.width, height: node.height }))
      }
      if (ownMask) localClip = tighten(localClip, planeRoot ? ownMask : applyToBox(toPlane, ownMask))
      childPlane = { ...plane, toPlane, localClip }
    } else {
      if (node.kind === 'layer' && node.overflow === 'hidden') {
        const layerClip = applyToBox(matrix, { x: node.x, y: node.y, width: node.width, height: node.height })
        childClip = tighten(childClip, layerClip)
      }
      if (ownMask) childClip = tighten(childClip, applyToBox(childMatrix, ownMask))
    }

    const perspective = node.kind === 'layer' ? node.perspective : undefined
    const opens = perspective != null && perspective > 0
    const mapLayerLocal = (x: number, y: number): Pt | null => {
      if (childPlane) {
        const [u, v] = apply(childPlane.toPlane, x, y)
        return childPlane.project(u, v)
      }
      const [cx, cy] = apply(childMatrix, x, y)
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
    for (const ch of node.children) {
      if (opens && has3dPose(ch)) {
        walk(
          ch,
          childMatrix,
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
        )
      } else if (childPlane) {
        walk(ch, childMatrix, opacity, absX + inset, absY + insetY, childClip, elements, effects, childPlane, false, childMesh, inkSlack)
      } else {
        walk(ch, childMatrix, opacity, absX + inset, absY + insetY, childClip, elements, effects, undefined, false, childMesh, inkSlack)
      }
    }
    let union: Box | null = null
    const add = (b: Box) => {
      if (b.width <= 1e-3 || b.height <= 1e-3) return
      union = union ? unionBoxes(union, b) : b
    }
    if ((node.background && node.background !== 'transparent') || (node.border && node.border.width > 0)) {
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
    if (union && !plane && node.kind === 'layer' && node.overflow === 'hidden') {
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

function effectOutside(box: Box, doc: FvgDocument): boolean {
  return box.x < -1e-3 || box.y < -1e-3 || box.x + box.width > doc.width + 1e-3 || box.y + box.height > doc.height + 1e-3
}

export function buildReport(doc: FvgDocument): FvgReport {
  const elements: ElementReport[] = []
  const effects: EffectRecord[] = []
  const inkSlack: number[] = []
  walk(doc.root, IDENTITY, 1, 0, 0, undefined, elements, effects, undefined, false, undefined, inkSlack)

  const issues: Issue[] = [...doc.issues]
  const visible = elements.filter((el) => el.opacity >= VISIBLE_OPACITY && hasArea(el.ink))

  for (let index = 0; index < elements.length; index++) {
    const el = elements[index]!
    if (el.opacity < VISIBLE_OPACITY || !hasArea(el.ink)) continue
    const slack = inkSlack[index] ?? 0
    const edge = 1e-3 + slack
    const inkOutside = el.ink.right > doc.width + edge || el.ink.bottom > doc.height + edge || el.ink.left < -edge || el.ink.top < -edge
    if (inkOutside) {
      issues.push({
        level: 'error',
        code: 'overflow-canvas',
        path: el.path,
        message: '着墨超出画布',
      })
    }
    const effectPad = effectPadOf(el)
    const recorded = effects[index]
    let effectBox: Box | null = null
    if (recorded?.plane) effectBox = recorded.box
    else if (effectPad > 0) effectBox = clipInk(expandBox(el.ink, effectPad), recorded?.clip)
    if (!MESH_TAGS.has(el.tag) && !inkOutside && effectBox && hasArea(effectBox) && effectOutside(effectBox, doc)) {
      issues.push({
        level: 'warn',
        code: 'effect-clipped',
        path: el.path,
        message: '本体在画布内，但阴影、光晕或模糊超出画布',
        hint: '把元素往里移，或减小 blur',
      })
    }
    if (el.lines != null && (el.tag === 'h1' || el.tag === 'h2' || el.tag === 'h3' || el.tag === 'p' || el.tag === 'div' || el.tag === 'span')) {
      if (el.ink.left < doc.safe.left - 1e-3 || el.ink.right > doc.width - doc.safe.right + 1e-3) {
        issues.push({
          level: 'warn',
          code: 'outside-safe',
          path: el.path,
          message: '文字超出安全区',
        })
      }
      const minFs = (doc.width / 1080) * 24
      if ((el.fontSize ?? 0) < minFs - 1e-3) {
        issues.push({
          level: 'warn',
          code: 'min-font-size',
          path: el.path,
          message: `字号 ${el.fontSize}px 小于建议最小 ${minFs.toFixed(1)}px`,
        })
      }
    }
  }

  const textInks = visible.filter((e) => e.lines != null)
  for (let i = 0; i < textInks.length; i++) {
    for (let j = i + 1; j < textInks.length; j++) {
      const a = textInks[i]!
      const b = textInks[j]!
      if (inkOverlap(a.ink, b.ink)) {
        issues.push({
          level: 'warn',
          code: 'text-overlap',
          path: a.path,
          message: `文字与 ${b.path} 着墨重叠`,
        })
      }
    }
  }

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

export function formatIssueLine(issue: Issue): string {
  const sym = issue.level === 'error' ? '✗ error' : issue.level === 'warn' ? '! warn' : '· info'
  const at = issue.source ? `${issue.source}  ` : ''
  const frame = issue.frame != null ? `第${issue.frame}帧  ` : ''
  const line = `${at}${frame}${sym}  ${issue.code.padEnd(16)} ${issue.path.padEnd(24)} ${issue.message}`
  return issue.hint ? `${line}\n         ${issue.hint}` : line
}
