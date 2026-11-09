import { describe, expect, it } from 'vitest'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import {
  CYCLES_DEFAULTS,
  UNIT_SCALE,
  exportCyclesScene,
  layerToWorld,
  shortSideFov,
  surfaceFor,
  viewplaneFor,
  verticalFov,
} from './cycles-export.js'
import type { LayerDocument } from './types.js'

const SCENE = `<layer width="960" height="640" background="#f3efe6" camera="fov 30, orbit 26 30, distance 1150, at 480 460 0">
  <ground y="500" rotateX="90" fill="#e7e0d4" />
  <layer x="0" y="500" width="960" height="380" origin="480 0" rotateX="90" preserve-3d>
    <sphere cx="150" cy="150" r="72" z="72" fill="#4CC3D9" material="plastic 0.4" />
    <rect x="300" y="120" width="150" height="100" depth="72" rx="8" z="36" fill="#EF2D5E" material="metal 0.28" />
  </layer>
</layer>`

async function document(source: string): Promise<LayerDocument> {
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, process.cwd(), { fonts: opened.fonts })
  return layoutSync(opened.root, assets)
}

describe('cycles 导出', () => {
  it('把相机写成 <camera> 的兄弟 <transform>，矩阵按行主序', async () => {
    const doc = await document(SCENE)
    const { xml } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    // xml_read_camera 只读 <camera> 自己的属性；矩阵必须在外层 <transform> 上。
    // 未自闭合的 `<camera ...>` 才会把后面的节点收成子元素。
    expect(xml).not.toMatch(/<camera(?:(?!\/>)[^>])*>\s*<transform/)
    expect(xml).toMatch(/<transform matrix="[^"]+"><camera type="perspective" \/><\/transform>/)
    // <camera> 必须自闭合，否则后面的 <transform> 会被当成它的子元素。
    expect(xml).toMatch(/<camera [^>]*\/>/)
  })

  it('每个网格的三角形数量与索引对得上', async () => {
    const doc = await document(SCENE)
    const { xml, counts } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    expect(counts.meshes).toBeGreaterThan(0)
    expect(counts.triangles).toBeGreaterThan(0)
    for (const mesh of xml.match(/<mesh [^>]*\/>/g) ?? []) {
      const verts = /verts="([^"]*)"/.exec(mesh)?.[1]?.trim().split(/\s+/) ?? []
      const nverts = /nverts="([^"]*)"/.exec(mesh)?.[1]?.trim().split(/\s+/) ?? []
      const positions = /P="([^"]*)"/.exec(mesh)?.[1]?.trim().split(/\s+/) ?? []
      expect(positions.length % 3).toBe(0)
      expect(verts.length).toBe(3 * nverts.length)
      for (const index of verts) expect(Number(index)).toBeLessThan(positions.length / 3)
      for (const n of nverts) expect(Number(n)).toBe(3)
    }
  })

  it('曝光是乘子而不是档位，不能写 0', async () => {
    const doc = await document(SCENE)
    const { xml } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    expect(xml).toMatch(/<film exposure="1"/)
  })

  it('相机放得下整张画布：viewplane 与 shortSideFov 同源', async () => {
    // 横幅：长边是宽，半径 x=aspect、y=1。
    const landscape = viewplaneFor(1600, 900, 900)
    expect(landscape.top - landscape.bottom).toBeCloseTo(2, 6)
    expect(landscape.right - landscape.left).toBeCloseTo((2 * 1600) / 900, 6)
    // 竖幅：长边是高，半径 x=1、y=1/aspect。
    const portrait = viewplaneFor(1440, 1800, 3600)
    expect(portrait.right - portrait.left).toBeCloseTo(2, 6)
    expect(portrait.top - portrait.bottom).toBeCloseTo((2 * 1800) / 1440, 6)
    // Standalone 覆盖 viewplane 后，fov 必须对着短边算，每米像素数才回到 focal。
    const fov = shortSideFov(3600, 1440, 1800)
    expect(Math.tan(fov / 2)).toBeCloseTo(1440 / (2 * 3600), 6)
    // 横幅时短边是高，退化成原来的 verticalFov。
    expect(shortSideFov(900, 1600, 900)).toBeCloseTo(verticalFov(900, 900), 9)
  })

  it('层 → 世界的 y、z 翻转只做一次', () => {
    expect(layerToWorld([100, 200, 300])).toEqual([100 * UNIT_SCALE, -200 * UNIT_SCALE, -300 * UNIT_SCALE])
  })

  it('法线不含平移：网格摆得再远，法线仍是单位长度', async () => {
    const doc = await document(SCENE)
    const { xml } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    for (const normals of xml.match(/N="([^"]*)"/g) ?? []) {
      const values = normals.slice(3, -1).trim().split(/\s+/).map(Number)
      for (let i = 0; i < values.length; i += 3) {
        expect(Math.hypot(values[i]!, values[i + 1]!, values[i + 2]!)).toBeCloseTo(1, 3)
      }
    }
  })

  it('作者灯一旦写了，就不再加默认影棚光', async () => {
    const withLight = await document(
      `<layer width="800" height="600" camera="900">
        <light type="directional" x="0" y="0" z="500" target="0 0 0" intensity="2" />
        <ground y="400" rotateX="90" fill="#ddd" />
        <rect x="300" y="200" width="200" height="120" depth="80" fill="#8ad" />
      </layer>`,
    )
    const { xml, counts } = exportCyclesScene(withLight, CYCLES_DEFAULTS)
    expect(counts.lights).toBe(1)
    expect(xml).toContain('author-sun-0')
    expect(xml).not.toContain('studio-key')
    expect(xml).not.toContain('studio-fill')
  })

  it('environment="ambient" 时只用天光，不补默认影棚光', async () => {
    const ambient = await document(
      `<layer width="800" height="600" camera="900" environment="ambient">
        <ground y="400" rotateX="90" />
        <rect x="300" y="200" width="200" height="120" depth="80" fill="#8ad" />
      </layer>`,
    )
    const { xml, counts } = exportCyclesScene(ambient, CYCLES_DEFAULTS)
    expect(counts.lights).toBe(0)
    expect(xml).not.toContain('studio-key')
    expect(xml).not.toContain('studio-fill')
    expect(xml).toContain('environment_texture')
  })

  it('太阳的 -z 列指向光源', async () => {
    const doc = await document(
      `<layer width="800" height="600" camera="900">
        <light type="directional" x="0" y="-500" z="0" target="0 0 0" intensity="1" />
        <ground y="400" rotateX="90" fill="#ddd" />
        <rect x="300" y="200" width="200" height="120" depth="80" fill="#8ad" />
      </layer>`,
    )
    const { xml } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    const match = /<transform matrix="([^"]+)">\s*<state shader="[^"]+">\s*<light light_type="sun"/.exec(xml)
    expect(match).not.toBeNull()
    const m = match![1]!.split(/\s+/).map(Number)
    // 矩阵按行主序。Cycles 取 co = -column2 当「指向光源」的方向。
    const co = [-m[8]!, -m[9]!, -m[10]!]
    // 作者把灯放在层空间 y=-500（画面上方）；层 y 向下，翻到世界后是 +y 朝上，
    // 也就是 co.y 应当是负的（光源在世界下方），主光才照到朝上的面。
    expect(co[1]).toBeLessThan(-0.9)
  })

  /**
   * 地面一律是实体无缝背景（cyclorama），不再有「没有 fill = 阴影捕捉器」的分支。
   * 捕捉器那套除法合成会在画布底色上留下黑圈，这里彻底不用。
   */
  it('没有 fill 的地面也是实体背景，不再当阴影捕捉器', async () => {
    const doc = await document(
      `<layer width="800" height="600" camera="900">
        <ground y="400" rotateX="90" />
        <rect x="300" y="200" width="200" height="120" depth="80" fill="#8ad" />
      </layer>`,
    )
    const { xml, counts } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    expect(counts.grounds).toBe(1)
    expect(xml).not.toContain('is_shadow_catcher')
    expect(xml).not.toContain('use_approximate_shadow_catcher')
  })

  /**
   * 地面是影棚无缝背景：一大段水平主平面 + 后部圆弧卷成竖直背墙 + 前坡下收。
   * 这样铺开以后相机里没有地平线，背景和地面是同一块连续的表面。
   */
  it('地面铺成无缝影棚背景：水平主平面接后弯背墙', async () => {
    const doc = await document(
      `<layer width="800" height="600" camera="900">
        <ground y="400" rotateX="90" />
        <rect x="300" y="200" width="200" height="120" depth="80" fill="#8ad" />
      </layer>`,
    )
    const { xml } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    // 剖面是一条带平滑法线的扫掠带，不是 4 个点的方片。
    const positions = /<mesh P="([^"]*)"/.exec(xml)?.[1]?.trim().split(/\s+/).map(Number) ?? []
    expect(positions.length / 3).toBeGreaterThan(20)
    // 至少有顶点明显高于地面基准，说明后部卷起了背墙。
    const ys = positions.filter((_, i) => i % 3 === 1)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20)
    expect(xml).toContain('interpolation="smooth"')
  })

  /**
   * 回归：地面让位量必须只有「半个层像素」，不能按地面半边长缩放。
   *
   * 曾经写成 `GROUND_SEAT_EPSILON * unit`，而 `unit` 是半边长（海报里 216），
   * 让位因此变成 108 个世界单位。整套道具于是悬空 1.08 m，接触阴影落到地面
   * 另一侧，画面上就是「整体地板上没有阴影」。
   */
  it('地面只退半个层像素，道具底面贴在主平面上', async () => {
    const doc = await document(
      `<layer width="1440" height="1800" camera="fov 28, orbit 16 14, distance 4900, at 720 1000 0">
        <layer x="0" y="1060" width="1440" height="1300" origin="720 0" rotateX="90" preserve-3d>
          <rect x="300" y="400" width="120" height="80" fill="#8ad" />
        </layer>
        <ground y="1060" rotateX="90" />
      </layer>`,
    )
    const { xml } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    const meshes = [...xml.matchAll(/<mesh(?: name="([^"]*)")? P="([^"]*)"[^>]*N="([^"]*)"/g)].map((match) => ({
      name: match[1] ?? null,
      points: match[2]!.trim().split(/\s+/).map(Number),
      normals: match[3]!.trim().split(/\s+/).map(Number),
    }))
    const ground = meshes.find((mesh) => mesh.name === null)
    const box = meshes.find((mesh) => mesh.name !== null)
    expect(ground).toBeDefined()
    expect(box).toBeDefined()

    // 主平面法线直接取扫掠带顶点法线（第一行左端），它由剖面切线叉乘得到。
    const normal: [number, number, number] = [
      ground!.normals[0]!,
      ground!.normals[1]!,
      ground!.normals[2]!,
    ]
    const centroid: [number, number, number] = [0, 0, 0]
    for (let i = 0; i < 54 * 3; i += 3) {
      centroid[0] += ground!.points[i]! / 54
      centroid[1] += ground!.points[i + 1]! / 54
      centroid[2] += ground!.points[i + 2]! / 54
    }
    const planeOffset =
      normal[0] * centroid[0] + normal[1] * centroid[1] + normal[2] * centroid[2]

    let lowest = Number.POSITIVE_INFINITY
    for (let i = 0; i < box!.points.length; i += 3) {
      const distance =
        normal[0] * box!.points[i]! +
        normal[1] * box!.points[i + 1]! +
        normal[2] * box!.points[i + 2]! -
        planeOffset
      lowest = Math.min(lowest, distance)
    }
    // 平面片就坐在 z=0：让位只有半像素（0.005 m）。
    expect(lowest).toBeGreaterThan(-0.02)
    expect(lowest).toBeLessThan(0.02)
  })

  it('omitGrounds 写出一份没有地面的同一场景', async () => {
    const doc = await document(
      `<layer width="800" height="600" background="#f3efe6" camera="900">
        <ground y="400" rotateX="90" shadow-blur="20" />
        <rect x="300" y="200" width="200" height="120" depth="80" fill="#8ad" />
      </layer>`,
    )
    const plain = exportCyclesScene(doc, { ...CYCLES_DEFAULTS, omitGrounds: true })
    expect(plain.counts.grounds).toBe(0)
    expect(plain.xml).not.toContain('is_shadow_catcher')
    // 相机看到的背景色不变：两张图要在背景上逐像素对得上。
    expect(plain.xml).toContain('<background name="seen"')
  })

  /**
   * 有镜头时默认挂影棚全景；摄影机看到的仍是画布底色，不跟 HDR 走。
   * `environment="none"` 和没有镜头时退回中性灰照明，避免米色画布染机身。
   */
  it('默认用影棚全景照明，相机看到的是画布底色', async () => {
    const warm = await document(
      `<layer width="400" height="300" background="#f3efe6" camera="900">
        <ground y="250" rotateX="90" fill="#ddd" />
        <rect x="150" y="150" width="80" height="60" depth="40" fill="#8ad" />
      </layer>`,
    )
    const cool = await document(
      `<layer width="400" height="300" background="#2f6fbf" camera="900">
        <ground y="250" rotateX="90" fill="#ddd" />
        <rect x="150" y="150" width="80" height="60" depth="40" fill="#8ad" />
      </layer>`,
    )
    const seenOf = (xml: string) => {
      const match = /<background name="seen" color="([^"]+)"/.exec(xml)
      expect(match).not.toBeNull()
      return match![1]!.split(/\s+/).map(Number)
    }
    const warmScene = exportCyclesScene(warm, CYCLES_DEFAULTS)
    const coolScene = exportCyclesScene(cool, CYCLES_DEFAULTS)
    expect(warmScene.xml).toMatch(/environment_texture[^>]*filename="monochrome_studio_01_1k\.hdr"/)
    expect(warmScene.images.some((image) => image.name === 'monochrome_studio_01_1k.hdr')).toBe(true)
    expect(warmScene.xml).toMatch(/is_camera_ray/)
    expect(seenOf(warmScene.xml)).not.toEqual(seenOf(coolScene.xml))
  })

  it('environment=none 时退回中性灰照明', async () => {
    const doc = await document(
      `<layer width="400" height="300" background="#f3efe6" camera="900" environment="none">
        <ground y="250" rotateX="90" fill="#ddd" />
        <rect x="150" y="150" width="80" height="60" depth="40" fill="#8ad" />
      </layer>`,
    )
    const { xml, images } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    expect(xml).not.toMatch(/environment_texture/)
    expect(images.some((image) => image.name.endsWith('.hdr'))).toBe(false)
    const lit = /<background name="lit" color="([^"]+)"/.exec(xml)
    expect(lit).not.toBeNull()
    const channels = lit![1]!.split(/\s+/).map(Number)
    expect(channels[0]).toBeCloseTo(channels[1]!, 5)
  })

  it('相机平面烘焙成带贴图或固有色的四边形', async () => {
    const doc = await document(
      `<layer width="400" height="300" camera="900">
        <layer x="100" y="80" width="200" height="140" rotateX="20">
          <rect width="200" height="140" fill="#112233" />
          <rect x="20" y="20" width="160" height="100" fill="#ff8800" />
        </layer>
      </layer>`,
    )
    const scene = exportCyclesScene(doc, CYCLES_DEFAULTS)
    expect(scene.counts.planes).toBeGreaterThan(0)
    expect(scene.counts.meshes).toBeGreaterThan(0)
    expect(scene.xml).toMatch(/plane-\d+\.png|emission_strength="1"/)
  })

  it('没有镜头的层只留背景，并明确说明', async () => {
    const doc = await document(`<layer width="200" height="200" background="#fff"><rect width="10" height="10" fill="#000" /></layer>`)
    const scene = exportCyclesScene(doc, CYCLES_DEFAULTS)
    expect(scene.skipped.some((line) => line.includes('镜头'))).toBe(true)
    expect(scene.counts.meshes).toBe(0)
  })

  /**
   * 绕序是「物体全黑」那次事故的根因：层空间里三角形是逆时针朝外，
   * `layerToWorld` 翻掉 y、z 之后法线仍朝外，绕序却朝里。Cycles 用绕序
   * 定几何法线，于是每个面都在背面黑掉。这里拿几何法线和 `N` 逐一比对。
   */
  it('三角形的绕序和法线同向，不会整体背面朝里', async () => {
    const doc = await document(SCENE)
    const { xml } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    let triangles = 0
    for (const mesh of xml.match(/<mesh [^>]*\/>/g) ?? []) {
      const positions = /P="([^"]*)"/.exec(mesh)?.[1]?.trim().split(/\s+/).map(Number) ?? []
      const normals = /N="([^"]*)"/.exec(mesh)?.[1]?.trim().split(/\s+/).map(Number)
      const verts = /verts="([^"]*)"/.exec(mesh)?.[1]?.trim().split(/\s+/).map(Number) ?? []
      if (!normals) continue
      for (let t = 0; t + 2 < verts.length; t += 3) {
        const i0 = verts[t]!, i1 = verts[t + 1]!, i2 = verts[t + 2]!
        const a: [number, number, number] = [positions[i0 * 3]!, positions[i0 * 3 + 1]!, positions[i0 * 3 + 2]!]
        const b: [number, number, number] = [positions[i1 * 3]!, positions[i1 * 3 + 1]!, positions[i1 * 3 + 2]!]
        const c: [number, number, number] = [positions[i2 * 3]!, positions[i2 * 3 + 1]!, positions[i2 * 3 + 2]!]
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
        const geometric = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!]
        const length = Math.hypot(geometric[0]!, geometric[1]!, geometric[2]!)
        if (length < 1e-12) continue
        const shading = [
          (normals[i0 * 3]! + normals[i1 * 3]! + normals[i2 * 3]!) / 3,
          (normals[i0 * 3 + 1]! + normals[i1 * 3 + 1]! + normals[i2 * 3 + 1]!) / 3,
          (normals[i0 * 3 + 2]! + normals[i1 * 3 + 2]! + normals[i2 * 3 + 2]!) / 3,
        ]
        const dot = geometric[0]! * shading[0]! + geometric[1]! * shading[1]! + geometric[2]! * shading[2]!
        expect(dot).toBeGreaterThan(0)
        triangles++
      }
    }
    expect(triangles).toBeGreaterThan(1000)
  })

  /**
   * `Light::copy_to_kernel` 会把 `used_shaders[0]` 当灯的光谱，没挂就落到
   * `scene->default_light`（strength 0），整盏灯等于不存在。所以每盏灯都必须
   * 包在一段自发光 shader 的 `<state>` 里。
   */
  it('每盏灯都挂了自发光 shader，否则 Cycles 当它是 0 强度', async () => {
    const doc = await document(
      `<layer width="800" height="600" camera="900">
        <light type="directional" x="0" y="-500" z="0" target="0 0 0" intensity="2" />
        <light type="point" x="200" y="-300" z="400" intensity="40" />
        <ground y="400" rotateX="90" fill="#ddd" />
        <rect x="300" y="200" width="200" height="120" depth="80" fill="#8ad" />
      </layer>`,
    )
    const { xml } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    expect(xml).toMatch(/<shader name="light-bulb">[\s\S]*?<emission [^>]*strength="1"/)
    const lights = xml.match(/<light [^>]*\/>/g) ?? []
    expect(lights.length).toBeGreaterThanOrEqual(2)
    for (const light of lights) {
      const index = xml.indexOf(light)
      const before = xml.slice(0, index)
      // 最近的 <state> 必须是那枚自发光 shader。
      const state = before.lastIndexOf('<state')
      expect(before.slice(state, state + 60)).toContain('shader="light-bulb"')
    }
  })

  it('模型用自己的 baseColorFactor，不被 fill 的 #000000 涂黑', async () => {
    const doc = await document(
      `<layer width="400" height="400" camera="700">
        <model src="examples/box.glb" x="100" y="100" width="120" height="120" material="metal 0.28" />
      </layer>`,
    )
    const { xml } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    const base = /<principled_bsdf name="bsdf" base_color="([^"]+)"/.exec(xml)?.[1]?.split(/\s+/).map(Number)
    expect(base).toBeDefined()
    // box.glb 的 baseColorFactor 是 (0.95, 0.72, 0.2)，线性后远离 0。
    expect(base![0]).toBeGreaterThan(0.5)
    expect(base![2]).toBeLessThan(base![0]!)
    expect(base!.every((channel) => channel > 0.01)).toBe(true)
  })

  it('有贴图的模型把 UV 按角点写出，长度是三角数 × 6', async () => {
    const doc = await document(
      `<layer width="400" height="400" camera="700">
        <model src="examples/box.glb" x="100" y="100" width="120" height="120" />
      </layer>`,
    )
    const { xml } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    for (const mesh of xml.match(/<mesh [^>]*\/>/g) ?? []) {
      const uv = /UV="([^"]*)"/.exec(mesh)
      if (!uv) continue
      const nverts = /nverts="([^"]*)"/.exec(mesh)?.[1]?.trim().split(/\s+/) ?? []
      const values = uv[1]!.trim().split(/\s+/)
      expect(values.length).toBe(nverts.length * 6)
    }
  })

  it('面光补一盏无衰减的远场太阳，地面才不会出现假地平线', async () => {
    const doc = await document(
      `<layer width="800" height="600" camera="900">
        <light type="area" x="0" y="-400" z="600" target="400 300 0" width="800" height="400" intensity="2" />
        <ground y="400" rotateX="90" fill="#ddd" />
        <rect x="300" y="200" width="200" height="120" depth="80" fill="#8ad" />
      </layer>`,
    )
    const { xml } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    expect(xml).toContain('author-area-0')
    expect(xml).toContain('author-area-0-far')
    expect(xml).toMatch(/light_type="sun"[^>]*name="author-area-0-far"/)
  })

    it('地面左右铺得足够宽，脚下方片不会露空', async () => {
    const doc = await document(
      `<layer width="960" height="640" camera="fov 30, distance 1150, at 480 460 0">
        <ground y="500" rotateX="90" fill="#e7e0d4" />
      </layer>`,
    )
    const { xml } = exportCyclesScene(doc, CYCLES_DEFAULTS)
    const positions = /<mesh P="([^"]*)"/.exec(xml)?.[1]?.trim().split(/\s+/).map(Number) ?? []
    const xs = positions.filter((_, i) => i % 3 === 0)
    const span = Math.max(...xs) - Math.min(...xs)
    // 层像素 × UNIT_SCALE 之后再放大到能盖满画面，几十米量级。
    expect(span).toBeGreaterThan(50)
  })

  /**
   * 作者没写 `material` 的模型要靠图元自己的 `shade` 走通道。之前这里退回
   * 'matte'，钻石的 transmission 被压平、roughness 还被 matte 预设覆盖成 1，
   * 整颗石头渲染成不透光的灰多面体。
   */
  it('模型自带的玻璃通道和粗糙度不会被 matte 预设压平', () => {
    const prim = {
      positions: new Float32Array(9),
      normals: new Float32Array(9),
      indices: new Uint32Array(3),
      alpha: 255,
      doubleSided: false,
      shade: 'glass' as const,
      roughness: 0.015,
      metalness: 0,
      transmission: 1,
      ior: 2.42,
      clearcoat: 1,
    }
    const surface = surfaceFor({ material: undefined } as never, '#000000', prim, null)
    expect(surface.transmission).toBe(1)
    expect(surface.roughness).toBeCloseTo(0.015)
    expect(surface.ior).toBeCloseTo(2.42)
    // 高折射率才给色散，普通玻璃不该泛彩虹。
    expect(surface.dispersion).toBe(1)
  })

  /**
   * 金属分支原来跳过 `prim.roughness`、直接吃 metal 预设的 0.28。镜面拉丝的
   * 不锈钢（0.05）被抹成一片均匀反射，AirTag 的钢面就读成一只白盘子。这和
   * 钻石那条是同一类 bug：模型自带的物理参数被预设盖掉。
   */
  it('金属沿用模型自带的粗糙度，不被 metal 预设盖掉', () => {
    const prim = {
      positions: new Float32Array(9),
      normals: new Float32Array(9),
      indices: new Uint32Array(3),
      alpha: 255,
      doubleSided: false,
      shade: 'metal' as const,
      roughness: 0.05,
      metalness: 1,
    }
    const surface = surfaceFor({ material: undefined } as never, '#c8ccd1', prim, null)
    expect(surface.metallic).toBe(1)
    expect(surface.roughness).toBeCloseTo(0.05)
  })

})
