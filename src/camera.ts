import { originOffset } from './matrix.js'
import {
  applyPoseMatrix,
  behindCamera,
  cameraSceneCustom,
  flattenReason,
  has3dPose,
  hasPerspective,
  poseMatrix,
  project,
  type Perspective,
  type Vec2,
  type Vec3,
} from './perspective.js'
import type { Issue, LayerLayoutNode, LayoutNode } from './types.js'

/** 行主序 3×3。和 shot3d 的镜头旋转同一套：先 yaw，再 pitch，再 roll。 */
type Mat3 = [number, number, number, number, number, number, number, number, number]

const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function rotX(deg: number): Mat3 {
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  return [1, 0, 0, 0, c, -s, 0, s, c]
}

function rotY(deg: number): Mat3 {
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  return [c, 0, s, 0, 1, 0, -s, 0, c]
}

function rotZ(deg: number): Mat3 {
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9) as Mat3
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!
  }
  return o
}

export function mulMat4(a: number[], b: number[]): number[] {
  const o = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!
    }
  }
  return o
}

function translation(x: number, y: number, z = 0): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
}

function nearlyIdentity(m: number[]): boolean {
  for (let i = 0; i < 16; i++) {
    const expect = i % 5 === 0 ? 1 : 0
    if (Math.abs(m[i]! - expect) > 1e-8) return false
  }
  return true
}

export type CameraResolved = {
  perspective: Perspective
  /** 列主序。缺省表示单位矩阵，不乘。 */
  view?: number[]
  vanishX: number
  vanishY: number
  moved: boolean
}

type CameraIssue = { level: 'warn' | 'info'; message: string; hint: string }

type Lens =
  | { kind: 'focal'; focal: number }
  | { kind: 'fov'; fov: number }
  | { kind: 'lens'; mm: number }
  | { kind: 'parallel' }

type ParsedCamera = {
  lens?: Lens
  at?: Vec3
  orbit?: { yaw: number; pitch: number }
  roll?: number
  distance?: number
  from?: Vec3
  vanish?: { x: number; y: number }
}

const SEGMENT_NAMES = ['focal', 'fov', 'lens', 'parallel', 'at', 'orbit', 'roll', 'distance', 'from', 'vanish'] as const

function num(token: string): number | null {
  if (token.trim() === '') return null
  const value = Number(token)
  return Number.isFinite(value) ? value : null
}

function nums(tokens: string[], count: number): number[] | null {
  if (tokens.length !== count) return null
  const out: number[] = []
  for (const token of tokens) {
    const value = num(token)
    if (value == null) return null
    out.push(value)
  }
  return out
}

function pushIssue(issues: CameraIssue[], message: string, hint: string, level: 'warn' | 'info' = 'warn') {
  issues.push({ level, message, hint })
}

function parseSegments(text: string, issues: CameraIssue[]): ParsedCamera | null {
  const parsed: ParsedCamera = {}
  const seen = new Set<string>()
  let lens: Lens | undefined
  const parts = text.split(',')
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/).filter((token) => token !== '')
    if (tokens.length === 0) continue
    const head = tokens[0]!
    const rest = tokens.slice(1)
    const bare = num(head)
    if (bare != null) {
      if (tokens.length !== 1) {
        pushIssue(issues, `无法解析 camera 片段「${part.trim()}」`, '焦距只写一个数，例如 camera="1484" 或 focal 1484')
        return null
      }
      if (lens || seen.has('focal')) {
        pushIssue(issues, 'camera 写了不止一种镜头', 'focal、fov、lens、parallel 只留一个')
        return null
      }
      seen.add('focal')
      lens = { kind: 'focal', focal: bare }
      continue
    }
    if (!SEGMENT_NAMES.includes(head as (typeof SEGMENT_NAMES)[number])) {
      pushIssue(issues, `不认识的 camera 片段「${part.trim()}」`, `可用 ${SEGMENT_NAMES.join('、')}`)
      return null
    }
    if (seen.has(head)) {
      pushIssue(issues, `camera 的 ${head} 写了两次`, '每种镜头参数只写一次')
      return null
    }
    seen.add(head)
    if (head === 'parallel') {
      if (rest.length !== 0) {
        pushIssue(issues, `无法解析 camera 片段「${part.trim()}」`, 'parallel 后面不跟数字')
        return null
      }
      if (lens) {
        pushIssue(issues, 'camera 写了不止一种镜头', 'focal、fov、lens、parallel 只留一个')
        return null
      }
      lens = { kind: 'parallel' }
      continue
    }
    if (head === 'focal' || head === 'fov' || head === 'lens' || head === 'roll' || head === 'distance') {
      const value = nums(rest, 1)
      if (!value) {
        pushIssue(issues, `无法解析 camera 片段「${part.trim()}」`, `${head} 后面跟一个数`)
        return null
      }
      if (head === 'roll') parsed.roll = value[0]!
      else if (head === 'distance') parsed.distance = value[0]!
      else {
        if (lens) {
          pushIssue(issues, 'camera 写了不止一种镜头', 'focal、fov、lens、parallel 只留一个')
          return null
        }
        if (head === 'focal') lens = { kind: 'focal', focal: value[0]! }
        else if (head === 'fov') lens = { kind: 'fov', fov: value[0]! }
        else lens = { kind: 'lens', mm: value[0]! }
      }
      continue
    }
    if (head === 'orbit') {
      const value = nums(rest, 2)
      if (!value) {
        pushIssue(issues, `无法解析 camera 片段「${part.trim()}」`, 'orbit 后面跟 yaw、pitch 两个角度')
        return null
      }
      parsed.orbit = { yaw: value[0]!, pitch: value[1]! }
      continue
    }
    if (head === 'vanish') {
      const value = nums(rest, 2)
      if (!value) {
        pushIssue(issues, `无法解析 camera 片段「${part.trim()}」`, 'vanish 后面跟 dx、dy 两个像素')
        return null
      }
      parsed.vanish = { x: value[0]!, y: value[1]! }
      continue
    }
    const count = 3
    const value = nums(rest, count)
    if (!value) {
      pushIssue(issues, `无法解析 camera 片段「${part.trim()}」`, `${head} 后面跟 x y z 三个数`)
      return null
    }
    const point = { x: value[0]!, y: value[1]!, z: value[2]! }
    if (head === 'at') parsed.at = point
    else parsed.from = point
  }
  parsed.lens = lens
  return parsed
}

function asPoint(value: unknown, count: number): number[] | null {
  if (!Array.isArray(value) || value.length !== count) return null
  const out: number[] = []
  for (const item of value) {
    const n = typeof item === 'number' ? item : typeof item === 'string' ? num(item) : null
    if (n == null) return null
    out.push(n)
  }
  return out
}

function asNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return num(value)
  return null
}

function parseObject(source: Record<string, unknown>, issues: CameraIssue[]): ParsedCamera | null {
  const parsed: ParsedCamera = {}
  let lens: Lens | undefined
  for (const key of Object.keys(source)) {
    if (!SEGMENT_NAMES.includes(key as (typeof SEGMENT_NAMES)[number])) {
      pushIssue(issues, `不认识的 camera 字段 ${key}`, `可用 ${SEGMENT_NAMES.join('、')}`)
      return null
    }
  }
  const takeLens = (next: Lens) => {
    if (lens) {
      pushIssue(issues, 'camera 写了不止一种镜头', 'focal、fov、lens、parallel 只留一个')
      return false
    }
    lens = next
    return true
  }
  if ('parallel' in source) {
    if (source.parallel !== true) {
      pushIssue(issues, '无法解析 camera 的 parallel', '平行投影写 parallel: true')
      return null
    }
    if (!takeLens({ kind: 'parallel' })) return null
  }
  if ('focal' in source) {
    const focal = asNum(source.focal)
    if (focal == null) {
      pushIssue(issues, '无法解析 camera 的 focal', 'focal 是像素视距')
      return null
    }
    if (!takeLens({ kind: 'focal', focal })) return null
  }
  if ('fov' in source) {
    const fov = asNum(source.fov)
    if (fov == null) {
      pushIssue(issues, '无法解析 camera 的 fov', 'fov 是竖直视角，单位度')
      return null
    }
    if (!takeLens({ kind: 'fov', fov })) return null
  }
  if ('lens' in source) {
    const mm = asNum(source.lens)
    if (mm == null) {
      pushIssue(issues, '无法解析 camera 的 lens', 'lens 是焦距毫米，按全画幅竖直视角换算')
      return null
    }
    if (!takeLens({ kind: 'lens', mm })) return null
  }
  if ('at' in source) {
    const at = asPoint(source.at, 3)
    if (!at) {
      pushIssue(issues, '无法解析 camera 的 at', 'at 是 [x, y, z]')
      return null
    }
    parsed.at = { x: at[0]!, y: at[1]!, z: at[2]! }
  }
  if ('orbit' in source) {
    const orbit = asPoint(source.orbit, 2)
    if (!orbit) {
      pushIssue(issues, '无法解析 camera 的 orbit', 'orbit 是 [yaw, pitch]，单位度')
      return null
    }
    parsed.orbit = { yaw: orbit[0]!, pitch: orbit[1]! }
  }
  if ('roll' in source) {
    const roll = asNum(source.roll)
    if (roll == null) {
      pushIssue(issues, '无法解析 camera 的 roll', 'roll 是绕视线的角度')
      return null
    }
    parsed.roll = roll
  }
  if ('distance' in source) {
    const distance = asNum(source.distance)
    if (distance == null) {
      pushIssue(issues, '无法解析 camera 的 distance', 'distance 是机位到对准点的像素')
      return null
    }
    parsed.distance = distance
  }
  if ('from' in source) {
    const from = asPoint(source.from, 3)
    if (!from) {
      pushIssue(issues, '无法解析 camera 的 from', 'from 是 [x, y, z]')
      return null
    }
    parsed.from = { x: from[0]!, y: from[1]!, z: from[2]! }
  }
  if ('vanish' in source) {
    const vanish = asPoint(source.vanish, 2)
    if (!vanish) {
      pushIssue(issues, '无法解析 camera 的 vanish', 'vanish 是 [dx, dy]，取景窗像素')
      return null
    }
    parsed.vanish = { x: vanish[0]!, y: vanish[1]! }
  }
  parsed.lens = lens
  return parsed
}

function viewMatrix(yaw: number, pitch: number, roll: number, at: Vec3, cx: number, cy: number, cz: number): number[] {
  const view = mul3(rotZ(roll), mul3(rotX(-pitch), rotY(-yaw)))
  const row = (r: number) => view[r]! * at.x + view[r + 1]! * at.y + view[r + 2]! * at.z
  return [
    view[0]!, view[3]!, view[6]!, 0,
    view[1]!, view[4]!, view[7]!, 0,
    view[2]!, view[5]!, view[8]!, 0,
    cx - row(0), cy - row(3), cz - row(6), 1,
  ]
}

/**
 * 把 camera 字符串或对象解成视距、视图矩阵和灭点偏移。
 * 默认机位（只有焦距或 parallel，对准盒子中心）的矩阵是单位矩阵，不记 view。
 */
export function resolveCamera(source: unknown, width: number, height: number): { camera?: CameraResolved; issues: CameraIssue[] } {
  const issues: CameraIssue[] = []
  let parsed: ParsedCamera | null
  if (typeof source === 'string') parsed = parseSegments(source, issues)
  else if (source != null && typeof source === 'object' && !Array.isArray(source)) parsed = parseObject(source as Record<string, unknown>, issues)
  else {
    pushIssue(issues, '无法解析 camera', '写成 camera="focal 900" 或对象 { focal: 900 }')
    return { issues }
  }
  if (!parsed || !parsed.lens) {
    if (parsed && !parsed.lens) pushIssue(issues, 'camera 没有镜头', '写 focal、fov、lens、parallel 里的一个，或一个正数视距')
    return { issues }
  }
  if (parsed.from && (parsed.orbit || parsed.distance != null)) {
    pushIssue(issues, 'from 不要和 orbit、distance 一起写', 'from 已经决定机位和距离')
    return { issues }
  }
  let perspective: Perspective
  if (parsed.lens.kind === 'parallel') perspective = 'parallel'
  else if (parsed.lens.kind === 'focal') {
    if (!(parsed.lens.focal > 0)) {
      pushIssue(issues, `无法解析 camera 的 focal: ${parsed.lens.focal}`, '焦距是正的像素')
      return { issues }
    }
    perspective = parsed.lens.focal
  } else {
    if (!(height > 0)) {
      pushIssue(issues, 'camera 的 fov / lens 需要这一层的 height', '先写 height，或改用 focal')
      return { issues }
    }
    let fov = parsed.lens.kind === 'fov' ? parsed.lens.fov : (2 * Math.atan(12 / parsed.lens.mm) * 180) / Math.PI
    if (parsed.lens.kind === 'lens' && !(parsed.lens.mm > 0)) {
      pushIssue(issues, `无法解析 camera 的 lens: ${parsed.lens.mm}`, '焦距毫米要大于 0')
      return { issues }
    }
    if (!(fov > 0) || fov >= 180) {
      pushIssue(issues, `无法解析 camera 的 fov: ${fov}`, '竖直视角要在 0 和 180 度之间')
      return { issues }
    }
    const focal = height / 2 / Math.tan(((fov * Math.PI) / 180) / 2)
    if (!(focal > 0)) {
      pushIssue(issues, 'camera 算不出焦距', '检查 fov 或 lens，以及这一层的 height')
      return { issues }
    }
    perspective = focal
  }
  const parallel = perspective === 'parallel'
  if (parallel && (parsed.distance != null || parsed.vanish)) {
    pushIssue(
      issues,
      'parallel 下 distance 和 vanish 不起作用',
      '平行投影的大小用外层 view。orbit、at、roll、from 仍然有效',
      'info',
    )
  }
  const at = parsed.at ?? { x: width / 2, y: height / 2, z: 0 }
  let yaw = parsed.orbit?.yaw ?? 0
  let pitch = parsed.orbit?.pitch ?? 0
  const focalLength = perspective === 'parallel' ? 0 : perspective
  let distance = parallel ? 0 : (parsed.distance ?? focalLength)
  let dropFrom = false
  if (parsed.from) {
    const dx = parsed.from.x - at.x
    const dy = parsed.from.y - at.y
    const dz = parsed.from.z - at.z
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-3) {
      pushIssue(issues, 'from 和对准点重合', 'from 要离开 at。这一层仍用默认机位')
      dropFrom = true
    } else {
      yaw = (Math.atan2(dx, dz) * 180) / Math.PI
      pitch = (Math.asin(Math.max(-1, Math.min(1, -dy / len))) * 180) / Math.PI
      distance = len
    }
  }
  if (!parallel && !(distance > 0)) {
    pushIssue(issues, `无法解析 camera 的 distance: ${distance}`, 'distance 是正的像素。不写时等于焦距')
    return { issues }
  }
  const roll = dropFrom ? 0 : (parsed.roll ?? 0)
  const cx = width / 2
  const cy = height / 2
  const cz = parallel || dropFrom ? 0 : focalLength - distance
  const matrix = viewMatrix(dropFrom ? 0 : yaw, dropFrom ? 0 : pitch, roll, dropFrom ? { x: cx, y: cy, z: 0 } : at, cx, cy, cz)
  const view = nearlyIdentity(matrix) ? undefined : matrix
  const vanishX = !parallel && parsed.vanish ? parsed.vanish.x : 0
  const vanishY = !parallel && parsed.vanish ? parsed.vanish.y : 0
  const moved = view != null || Math.abs(vanishX) > 1e-9 || Math.abs(vanishY) > 1e-9
  return {
    camera: { perspective, ...(view ? { view } : {}), vanishX, vanishY, moved },
    issues,
  }
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 1000) / 1000
  if (Object.is(rounded, -0)) return '0'
  return String(rounded)
}

function formatPoint(values: number[]): string {
  return values.map((value) => formatNum(value)).join(' ')
}

/** 按作者给出的字段写回 camera 字符串，不把 from 折成 orbit。 */
export function formatCamera(source: unknown): string | null {
  if (source == null || typeof source !== 'object' || Array.isArray(source)) return null
  const record = source as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!SEGMENT_NAMES.includes(key as (typeof SEGMENT_NAMES)[number])) return null
  }
  const parts: string[] = []
  if (record.parallel === true) parts.push('parallel')
  else if ('focal' in record) {
    const focal = asNum(record.focal)
    if (focal == null) return null
    parts.push(`focal ${formatNum(focal)}`)
  } else if ('fov' in record) {
    const fov = asNum(record.fov)
    if (fov == null) return null
    parts.push(`fov ${formatNum(fov)}`)
  } else if ('lens' in record) {
    const mm = asNum(record.lens)
    if (mm == null) return null
    parts.push(`lens ${formatNum(mm)}`)
  }
  if ('at' in record) {
    const at = asPoint(record.at, 3)
    if (!at) return null
    parts.push(`at ${formatPoint(at)}`)
  }
  if ('orbit' in record) {
    const orbit = asPoint(record.orbit, 2)
    if (!orbit) return null
    parts.push(`orbit ${formatPoint(orbit)}`)
  }
  if ('roll' in record) {
    const roll = asNum(record.roll)
    if (roll == null) return null
    parts.push(`roll ${formatNum(roll)}`)
  }
  if ('distance' in record) {
    const distance = asNum(record.distance)
    if (distance == null) return null
    parts.push(`distance ${formatNum(distance)}`)
  }
  if ('from' in record) {
    const from = asPoint(record.from, 3)
    if (!from) return null
    parts.push(`from ${formatPoint(from)}`)
  }
  if ('vanish' in record) {
    const vanish = asPoint(record.vanish, 2)
    if (!vanish) return null
    parts.push(`vanish ${formatPoint(vanish)}`)
  }
  if (parts.length === 0) return null
  return parts.join(', ')
}

export function readPreserve(raw: string | undefined): { value: boolean; invalid: boolean } {
  if (raw == null) return { value: false, invalid: false }
  const text = raw.trim()
  if (text === '' || text === 'true' || text === 'preserve-3d') return { value: true, invalid: false }
  if (text === 'false') return { value: false, invalid: false }
  return { value: false, invalid: true }
}

function hasChrome(node: LayoutNode): boolean {
  const background = node.background != null && node.background !== 'transparent'
  const border = node.border != null && node.border.width > 0
  return background || border
}

function leavesTexture(node: LayoutNode): boolean {
  if (node.kind === 'mesh') return false
  if (node.kind === 'layer' || node.kind === 'flex') {
    if (node.kind === 'layer' && hasPerspective(node.perspective)) return true
    if (hasChrome(node) || node.draw != null) return true
    return node.children.some((child) => leavesTexture(child))
  }
  return node.width > 0 || node.height > 0
}

export type CameraItem = {
  kind: 'plane' | 'mesh' | 'chrome'
  node: LayoutNode
  /** 节点局部到这一层镜头空间（已经乘过视图矩阵）。 */
  toLayer: number[]
  posed: boolean
  behind: boolean
  depth: number
  opacity: number
  index: number
}

function centerDepth(node: LayoutNode, toLayer: number[]): number {
  return applyPoseMatrix(toLayer, node.width / 2, node.height / 2, 0).z
}

function meshPivotDepth(node: LayoutNode, toLayer: number[]): number {
  const origin = originOffset(node.origin, node.width, node.height)
  return applyPoseMatrix(toLayer, origin.x, origin.y, 0).z
}

/**
 * 镜头层上要单独投影的平面和网格。
 * 默认机位且没有 preserve-3d 时调用方继续走原来的直接子元素路径。
 */
export function cameraItems(layer: LayerLayoutNode): CameraItem[] {
  const items: CameraItem[] = []
  const perspective = layer.perspective
  if (!hasPerspective(perspective)) return items
  const view = layer.cameraView
  let index = 0
  const push = (item: Omit<CameraItem, 'index' | 'behind' | 'depth'> & { depth: number }) => {
    items.push({ ...item, index: index++, behind: behindCamera(item.depth, perspective), depth: item.depth })
  }
  const pullMeshes = (node: LayoutNode, toParent: number[], opacity: number) => {
    const toLocal = mulMat4(toParent, poseMatrix(node))
    const toLayer = view ? mulMat4(view, toLocal) : toLocal
    if (node.kind === 'mesh') {
      push({ kind: 'mesh', node, toLayer, posed: true, opacity, depth: meshPivotDepth(node, toLayer) })
      return
    }
    if (node.kind === 'layer' && hasPerspective(node.perspective)) return
    if (node.kind === 'layer' || node.kind === 'flex') {
      const insetX = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
      const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
      const content = mulMat4(toLocal, translation(insetX, insetY))
      const next = opacity * (node.opacity ?? 1)
      for (const child of node.children) pullMeshes(child, content, next)
    }
  }
  const visit = (node: LayoutNode, toParent: number[], descended: boolean, opacity: number) => {
    const toLocal = mulMat4(toParent, poseMatrix(node))
    const toLayer = view ? mulMat4(view, toLocal) : toLocal
    if (node.kind === 'mesh') {
      push({ kind: 'mesh', node, toLayer, posed: true, opacity, depth: meshPivotDepth(node, toLayer) })
      return
    }
    const nested = node.kind === 'layer' && hasPerspective(node.perspective)
    const descend =
      !nested &&
      (descended || !!node.preserve3d) &&
      !flattenReason(node) &&
      (node.kind === 'layer' || node.kind === 'flex')
    const posed = descended || has3dPose(node) || !!layer.cameraMoved
    if (descend) {
      if (hasChrome(node)) {
        push({ kind: 'chrome', node, toLayer, posed, opacity, depth: centerDepth(node, toLayer) })
      }
      const insetX = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
      const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
      const content = mulMat4(toLocal, translation(insetX, insetY))
      const next = opacity * (node.opacity ?? 1)
      for (const child of node.children) visit(child, content, true, next)
      return
    }
    const depth = centerDepth(node, toLayer)
    const behind = behindCamera(depth, perspective)
    if (!nested && !behind && (node.kind === 'layer' || node.kind === 'flex')) {
      const insetX = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
      const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
      const content = mulMat4(toLocal, translation(insetX, insetY))
      const next = opacity * (node.opacity ?? 1)
      for (const child of node.children) pullMeshes(child, content, next)
    }
    push({ kind: 'plane', node, toLayer, posed, opacity, depth })
  }
  for (const child of layer.children) visit(child, IDENTITY4, false, 1)
  return items
}

export function projectOnLayer(layer: LayerLayoutNode, toLayer: number[], u: number, v: number): Vec2 | null {
  const perspective = layer.perspective
  if (!hasPerspective(perspective)) return null
  const point = applyPoseMatrix(toLayer, u, v, 0)
  return project(layer.width / 2 + (layer.vanishX ?? 0), layer.height / 2 + (layer.vanishY ?? 0), perspective, point)
}

function issue(level: Issue['level'], code: string, path: string, message: string, hint: string): Issue {
  return { level, code, path, message, hint }
}

/** preserve-3d 被压平、包住网格的 blur，以及非默认机位的 behind-camera。 */
export function cameraAuditIssues(root: LayoutNode): Issue[] {
  const issues: Issue[] = []
  const visit = (node: LayoutNode) => {
    if (node.kind === 'layer' && hasPerspective(node.perspective)) {
      auditLayer(node, issues)
      for (const child of node.children) visit(child)
      return
    }
    if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
      for (const child of node.children) visit(child)
    }
  }
  visit(root)
  return issues
}

function noteFlatten(node: LayoutNode, issues: Issue[]) {
  if (!node.preserve3d) return
  const reason = flattenReason(node)
  if (!reason) return
  issues.push(
    issue(
      'info',
      'flattened-3d',
      node.path,
      `preserve-3d 被 ${reason} 压平`,
      '透明度、模糊、滤镜、调色、蒙版和 overflow="hidden" 会把子树收成一张图',
    ),
  )
}

function auditLayer(layer: LayerLayoutNode, issues: Issue[]) {
  const perspective = layer.perspective!
  noteFlatten(layer, issues)
  const scan = (node: LayoutNode) => {
    if (node.kind === 'layer' && hasPerspective(node.perspective) && node !== layer) return
    if (node !== layer) {
      noteFlatten(node, issues)
      if ((node.blur ?? 0) > 0 && !leavesTexture(node)) {
        issues.push(
          issue(
            'warn',
            'invalid-attr',
            node.path,
            'blur 写在没有可画纹理的网格层上',
            'blur 是平面局部像素。网格没有这张纹理时去掉 blur，或在同一层里留一块可画的形状',
          ),
        )
      }
    }
    if (node.kind === 'layer' || node.kind === 'flex') {
      for (const child of node.children) scan(child)
    }
  }
  scan(layer)
  if (!cameraSceneCustom(layer)) return
  for (const item of cameraItems(layer)) {
    if (!item.behind) continue
    const kind = item.kind === 'mesh' ? '网格' : '平面'
    issues.push(
      issue(
        'warn',
        'behind-camera',
        item.node.path,
        `${kind}在观众身后，不绘制`,
        `采样点的投影 w 小于等于 0。把 z 减小到小于 perspective（${perspective}），或改相机的 distance / from`,
      ),
    )
  }
}
