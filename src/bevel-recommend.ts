/**
 * 圆角（倒角）半径的推荐算法。**与渲染引擎无关**：输入是一组网格，输出是每个
 * 网格该用的世界半径；把它喂给 Cycles 的 `<bevel>`、Blender 的 Bevel 修改器、
 * 还是自己的 SDF 求交都行。
 *
 * 三条判断构成一个完整的推荐：
 *
 * 1. **闭合度**（`closure`）——判断这个网格是不是「实体」。
 * 2. **参考尺度**（`D_ref`）——整个场景里「一个正常物体有多大」。
 * 3. **逐物体厚度钳制**——半径不得超过物体自身的几何余量。
 *
 * 为什么要第 1 条：地板、天幕、环形背景板都是开放曲面，它们没有「棱」，
 * 而且尺寸比真实物体大两三个数量级。只要它们混进尺度统计，参考值立刻失真。
 * 闭合度是目前实测最可靠的筛子：封闭实体恒为 0，单张四边形片恒为 1。
 *
 * 为什么要第 3 条，而不是只用 `D_ref / K`：`D_ref` 是一个**平均值**，而「小
 * 物体被磨平」是**分布尾部**的问题。MacBook 场景实测，全局 1/100 半径会让
 * 24/55 个物体的圆角超过自身厚度。平均值解决不了尾部问题。
 *
 * 单位：输入输出的长度都是**世界单位**（米）。调用方负责把顶点乘到世界空间。
 */

/** 一个待评估的网格。顶点是扁平的世界坐标三元组。 */
export type BevelMesh = {
  /** 便于调用方回溯的标识，不参与计算。 */
  id?: string
  positions: ArrayLike<number>
  /** 三角形索引三元组。缺省时按「每连续 3 个顶点一个三角形」处理。 */
  indices?: ArrayLike<number>
}

export type BevelRecommendOptions = {
  /**
   * 参考尺度的倒数：`R_global = D_ref / scaleDivisor`。
   *
   * 实测参考值：`100` 是产品图常见的艺术夸张（当前机位约 2 px 宽的软边），
   * 真实工业件的圆角/长度多在 `400–600`。默认 100 保持与既有出图一致。
   */
  scaleDivisor?: number
  /**
   * 半径相对**物体最薄边**的上限。`0.2` 表示圆角最多从单面侵蚀掉 20% 壁厚，
   * 再大薄板就会从两面同时被磨成哑铃形。超过 `0.5` 基本必然塌边。
   */
  thicknessClamp?: number
  /** 闭合度高于此值判为开放曲面（地板、背景板、薄壳），不参与参考尺度。 */
  openThreshold?: number
  /**
   * 半径低于这个像素数就建议不挂倒角。需要调用方给出像素比例才能生效；
   * 不给 `pixelsPerWorld` 时这项检查被跳过。
   */
  minPixels?: number
  /**
   * 物体代表点处「每世界单位多少输出像素」。用于把 `minPixels` 换成世界半径。
   * 引擎无关的调用方可以自己算好逐物体的值传进来；不需要就省略。
   */
  pixelsPerWorld?: (mesh: BevelMesh, index: number) => number | null
}

export type BevelMeshReport = {
  id?: string
  /** 焊接后的拓扑闭合度：`边界边 / 总边数`。0 是封闭实体，1 是完全开放的片。 */
  closure: number
  /** 网格包围盒三条边的长度，**升序**。`extents[0]` 就是最薄边。 */
  extents: [number, number, number]
  /**
   * 代表尺寸：包围盒三边里**中间那条**。
   *
   * 不用最长边：细长物体（3 m 长、1 cm 粗的线）的最长边会把它伪装成大物体。
   * 不用对角线：对角线对细长形状系统性地高估。中位边对二者的失真都最小。
   */
  scale: number
  /** 厚度上限：`thicknessClamp × 最薄边`。 */
  thicknessCap: number
  /** 推荐半径（世界单位）。0 或 null 表示这个网格不该倒角。 */
  radius: number | null
  /**
   * 半径是被哪道闸门限制住的，便于调参时定位。
   *
   * - `reference`：全局锚点说了算。
   * - `thickness`：被物体自身最薄边钳住。
   * - `invisible`：投影后不足 `minPixels`，建议不挂倒角。
   * - `flat`：零厚度（单张平面、天幕），没有可倒的棱。
   * - `degenerate`：空网格或没有可用尺寸。
   */
  limitedBy: 'reference' | 'thickness' | 'invisible' | 'flat' | 'degenerate'
}

export type BevelRecommendation = {
  /** 参与统计的参考尺度（面积加权中位）。没有可用物体时为 0。 */
  referenceScale: number
  /** `referenceScale / scaleDivisor`，全局半径锚点。 */
  globalRadius: number
  /** 闭合度超过阈值、被排除在参考尺度之外的网格数。 */
  excludedOpen: number
  /** 尺寸小到对参考尺度没有代表性、被排除的网格数。 */
  excludedTiny: number
  meshes: BevelMeshReport[]
}

const DEFAULTS = {
  scaleDivisor: 100,
  thicknessClamp: 0.2,
  openThreshold: 0.5,
  minPixels: 0.5,
} as const

/**
 * 单个网格的几何指标。不涉及参考尺度，可以独立调用。
 *
 * 闭合度需要先把顶点焊接起来：Flexlayer 导出的几何每个三角形自带独立顶点，
 * 不焊接的话每条边都只被一个三角形使用，闭合度会恒等于 1，筛子完全失效。
 */
export function analyzeMesh(mesh: BevelMesh): {
  closure: number
  /** 包围盒三边，**升序**：`[最薄边, 中间边, 最长边]`。 */
  extents: [number, number, number]
  scale: number
} {
  const positions = mesh.positions
  const triangleCount = Math.floor((mesh.indices ? mesh.indices.length : positions.length / 3) / 3)
  if (triangleCount === 0) return { closure: 1, extents: [0, 0, 0], scale: 0 }

  const bounds = boundsOf(positions)
  const diagonal = Math.hypot(bounds.size[0], bounds.size[1], bounds.size[2])
  const sorted = [...bounds.size].sort((a, b) => a - b) as [number, number, number]
  const extents = sorted

  /* 焊接容差取包围盒对角线的十万分之一。太小了配合不上渲染器自己导出的
   * 顶点（它们常有 1e-6 量级的抖动），太大了会把真实存在的细缝并掉。 */
  const tolerance = Math.max(diagonal * 1e-5, 1e-9)
  const welded = weldIndices(positions, mesh.indices, tolerance)

  return {
    closure: closureOf(welded.vertices, welded.triangles),
    extents,
    scale: extents[1],
  }
}

/**
 * 给整组网格推荐半径。
 *
 * 统计只用**闭合且够大**的网格；半径则逐个算，小物体靠厚度钳制自动退化成
 * 「不倒角」或「细倒角」，不需要任何名单或手工例外。
 */
export function recommendBevels(
  meshes: readonly BevelMesh[],
  options: BevelRecommendOptions = {},
): BevelRecommendation {
  const scaleDivisor = options.scaleDivisor ?? DEFAULTS.scaleDivisor
  const thicknessClamp = options.thicknessClamp ?? DEFAULTS.thicknessClamp
  const openThreshold = options.openThreshold ?? DEFAULTS.openThreshold
  const minPixels = options.minPixels ?? DEFAULTS.minPixels

  const analyzed = meshes.map((mesh, index) => {
    const metrics = analyzeMesh(mesh)
    const pixels = options.pixelsPerWorld ? options.pixelsPerWorld(mesh, index) : null
    /* 投影面积是「这个物体在画面里占多少」的最直接代理。只在没有像素比例
     * 时退回几何面积：几何面积会把近处小物体算得过轻、远处大物体算得过重。 */
    const weight = pixels != null && pixels > 0
      ? metrics.scale * metrics.scale * pixels * pixels
      : metrics.scale * metrics.scale
    return { mesh, index, metrics, pixels, weight }
  })

  const eligible = analyzed.filter(
    (entry) => entry.metrics.closure <= openThreshold && entry.metrics.scale > 0,
  )
  const closedEnough = analyzed.filter((entry) => entry.metrics.closure <= openThreshold)
  const excludedOpen = analyzed.length - closedEnough.length
  /* 「太小」的判据是相对中位数，所以得先有一轮中位数才能筛。两步走：
   * 先在所有闭合网格上取中位，再剔除比它小 100 倍的（AirTag 之于笔记本）。 */
  const provisional = weightedMedian(closedEnough.map((entry) => ({ value: entry.metrics.scale, weight: entry.weight })))
  const tinyCutoff = provisional * 0.01
  const representative = eligible.filter((entry) => entry.metrics.scale >= tinyCutoff)
  const excludedTiny = eligible.length - representative.length

  const referenceScale = weightedMedian(
    representative.map((entry) => ({ value: entry.metrics.scale, weight: entry.weight })),
  )
  const globalRadius = referenceScale > 0 ? referenceScale / scaleDivisor : 0

  const reports: BevelMeshReport[] = analyzed.map((entry) => {
    const { metrics, pixels } = entry
    /* `extents` 已升序，`[0]` 是最薄边——这是薄板能承受的几何余量。 */
    const thicknessCap = metrics.scale > 0 ? metrics.extents[0] * thicknessClamp : 0

    if (!(metrics.scale > 0)) {
      return { id: entry.mesh.id, closure: metrics.closure, extents: metrics.extents, scale: metrics.scale, thicknessCap, radius: null, limitedBy: 'degenerate' }
    }
    /* 零厚度的纯平面没有棱可倒：几何倒角需要壁厚，法线倒角也只是把同一法线
     * 再平均一次。直接返回 null，比给一个无意义的半径更诚实。 */
    if (!(metrics.extents[0] > 0)) {
      return { id: entry.mesh.id, closure: metrics.closure, extents: metrics.extents, scale: metrics.scale, thicknessCap, radius: null, limitedBy: 'flat' }
    }
    if (!(globalRadius > 0)) {
      return { id: entry.mesh.id, closure: metrics.closure, extents: metrics.extents, scale: metrics.scale, thicknessCap, radius: null, limitedBy: 'degenerate' }
    }

    const byReference = globalRadius
    const byThickness = thicknessCap
    const radius = Math.min(byReference, byThickness)
    const limitedBy: BevelMeshReport['limitedBy'] = byThickness < byReference ? 'thickness' : 'reference'

    if (pixels != null && pixels > 0) {
      const radiusPixels = radius * pixels
      if (!(radiusPixels >= minPixels)) {
        return { id: entry.mesh.id, closure: metrics.closure, extents: metrics.extents, scale: metrics.scale, thicknessCap, radius: null, limitedBy: 'invisible' }
      }
    }
    return { id: entry.mesh.id, closure: metrics.closure, extents: metrics.extents, scale: metrics.scale, thicknessCap, radius, limitedBy }
  })

  return { referenceScale, globalRadius, excludedOpen, excludedTiny, meshes: reports }
}

/** 包围盒。空输入返回全零。 */
export function boundsOf(positions: ArrayLike<number>): {
  min: [number, number, number]
  max: [number, number, number]
  size: [number, number, number]
} {
  if (positions.length < 3) {
    return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] }
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis]!
      if (value < min[axis]!) min[axis] = value
      if (value > max[axis]!) max[axis] = value
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] }
}

/**
 * 按位置焊接重复顶点，返回去重后的顶点表和重映射后的三角形。
 *
 * 量化到 `tolerance` 的网格上再做精确比较，避免浮点相等判断在近重合顶点上
 * 摇摆。同一格子里出现不同顶点时（跨格边界的抖动），退回逐点精确匹配。
 */
export function weldIndices(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | undefined,
  tolerance: number,
): { vertices: Float64Array; triangles: Uint32Array } {
  const vertexCount = Math.floor(positions.length / 3)
  const remap = new Uint32Array(vertexCount)
  const grid = new Map<string, number[]>()
  const unique: number[] = []
  const inverseTolerance = 1 / Math.max(tolerance, Number.EPSILON)

  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const x = positions[vertex * 3]!
    const y = positions[vertex * 3 + 1]!
    const z = positions[vertex * 3 + 2]!
    const key = `${snap(x * inverseTolerance)},${snap(y * inverseTolerance)},${snap(z * inverseTolerance)}`
    const bucket = grid.get(key)
    let matched = -1
    if (bucket) {
      for (const candidate of bucket) {
        if (
          Math.abs(unique[candidate * 3]! - x) <= tolerance &&
          Math.abs(unique[candidate * 3 + 1]! - y) <= tolerance &&
          Math.abs(unique[candidate * 3 + 2]! - z) <= tolerance
        ) {
          matched = candidate
          break
        }
      }
    }
    if (matched < 0) {
      matched = unique.length / 3
      unique.push(x, y, z)
      if (bucket) bucket.push(matched)
      else grid.set(key, [matched])
    }
    remap[vertex] = matched
  }

  const triangleCount = Math.floor((indices ? indices.length : vertexCount) / 3)
  const triangles = new Uint32Array(triangleCount * 3)
  for (let corner = 0; corner < triangleCount * 3; corner++) {
    const source = indices ? indices[corner]! : corner
    triangles[corner] = remap[source] ?? 0
  }
  return { vertices: Float64Array.from(unique), triangles }
}

/**
 * 拓扑闭合度：只被一个三角形使用的边（边界边）占全部唯一边的比例。
 *
 * 封闭实体每条边恰被两个三角形共享，结果为 0；一张四边形片四条边都是边界边，
 * 结果为 1。非流形边（>2 个面共享）不算边界边，但会让分母变大，属于可接受的
 * 温和偏差——它几乎总是出现在已经封闭的硬表面模型上。
 */
export function closureOf(vertices: ArrayLike<number>, triangles: ArrayLike<number>): number {
  const triangleCount = Math.floor(triangles.length / 3)
  if (triangleCount === 0) return 1
  const edgeUses = new Map<number, number>()
  const vertexCount = Math.floor(vertices.length / 3)

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const a = triangles[triangle * 3]!
    const b = triangles[triangle * 3 + 1]!
    const c = triangles[triangle * 3 + 2]!
    for (const [from, to] of [[a, b], [b, c], [c, a]] as const) {
      if (from === to) continue
      const low = Math.min(from, to)
      const high = Math.max(from, to)
      const key = low * vertexCount + high
      edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1)
    }
  }

  let boundary = 0
  for (const uses of edgeUses.values()) if (uses === 1) boundary++
  return edgeUses.size === 0 ? 1 : boundary / edgeUses.size
}

/** 按权重取中位数。权重非正或总和为零时退化成普通中位数。 */
export function weightedMedian(samples: readonly { value: number; weight: number }[]): number {
  const usable = samples.filter((sample) => Number.isFinite(sample.value) && sample.value > 0)
  if (usable.length === 0) return 0
  const sorted = [...usable].sort((a, b) => a.value - b.value)
  const totalWeight = sorted.reduce((sum, sample) => sum + (sample.weight > 0 ? sample.weight : 0), 0)
  if (!(totalWeight > 0)) {
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1 ? sorted[middle]!.value : (sorted[middle - 1]!.value + sorted[middle]!.value) / 2
  }
  let running = 0
  for (const sample of sorted) {
    running += sample.weight > 0 ? sample.weight : 0
    if (running >= totalWeight / 2) return sample.value
  }
  return sorted[sorted.length - 1]!.value
}

function snap(value: number): number {
  return Math.round(value)
}
