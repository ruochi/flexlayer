import { describe, expect, it } from 'vitest'
import { h } from './h.js'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import { checkLayer, inheritQuality, renderLayer } from './render.js'
import { meanFlip } from '../scripts/flip-diff.ts'

async function laidOut(source: string) {
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, process.cwd(), { fonts: opened.fonts })
  return layoutSync(opened.root, assets)
}

/**
 * QUALITY-6 §A.4. The same small scene as the `3d-lights` plate: a red plastic
 * box, a matte white box and a metal sphere on a mid-tone floor. Only the
 * `<light>` changes, so a difference between two renders can only come from the
 * light. The floor is deliberately mid-tone: a lamp adds energy, and on cream
 * paper there is no headroom left to see a disc in.
 */
function lightScene(light: string): string {
  return `<layer width="440" height="300" camera="fov 32, orbit 34 22, distance 860, at 220 160 0">
    ${light}
    <ground id="ground" y="220" rotateX="90" fill="#9a9285" shadow-blur="26" shadow-opacity="0.5" />
    <layer x="28" y="220" width="400" height="190" origin="200 0" rotateX="90" preserve-3d>
      <rect id="red" x="30" y="34" width="120" height="86" depth="72" rx="12" fill="#d23b3b" material="plastic 0.3" />
      <rect id="matte" x="168" y="26" width="96" height="96" depth="60" rx="8" fill="#f4f1ea" material="matte" />
      <sphere id="ball" cx="330" cy="78" r="46" z="46" fill="#c5c9ce" material="metal 0.2" />
    </layer>
  </layer>`
}

type Painted = { rgba: Uint8ClampedArray; width: number; height: number }

async function paint(light: string): Promise<Painted> {
  const out = await renderLayer(lightScene(light), { baseDir: process.cwd(), format: 'rgba', meshCache: false })
  return { rgba: out.rgba, width: out.width, height: out.height }
}

const lumaAt = (p: Painted, x: number, y: number): number => {
  const i = (y * p.width + x) * 4
  return 0.299 * p.rgba[i]! + 0.587 * p.rgba[i + 1]! + 0.114 * p.rgba[i + 2]!
}

/**
 * First row of the floor band: below every body's ink, so the walk never crosses
 * a body's own edge or its contact shadow. `gallery-metrics.mjs` reads the same
 * band off the plate's report; starting higher picked up the matte box's shadow
 * and read a penumbra reversal that belongs to the shadow, not the cone.
 */
async function floorTop(): Promise<number> {
  const report = await checkLayer(lightScene(''), { baseDir: process.cwd() })
  let bottom = 0
  for (const element of report.elements ?? []) {
    if (element.id === 'ground' || !element.ink || element.ink.height <= 0) continue
    bottom = Math.max(bottom, element.ink.y + element.ink.height)
  }
  return Math.ceil(bottom + 2)
}

/** Brightest pixel in the floor band under the three bodies. */
function floorPeak(p: Painted, top: number): { x: number; y: number; Y: number } {
  let best = { x: 0, y: 0, Y: -1 }
  for (let y = top; y < p.height; y++) {
    for (let x = 4; x < p.width - 4; x++) {
      const Y = lumaAt(p, x, y)
      if (Y > best.Y) best = { x, y, Y }
    }
  }
  return best
}

/**
 * The four author-light readings the proposal asks for, on the plate's scene.
 *
 * These are pixel assertions, not parse assertions: a light that is accepted by
 * the layout and then dropped on the way to the kernel renders identically to
 * the control, and that is exactly the bug this round fixed. `spot` and `point`
 * both measured 0.000 FLIP when the round started.
 */
describe('author lights on the plate', () => {
  const lights: Array<[string, string]> = [
    ['directional', '<light type="directional" x="-260" y="-160" z="200" target="220 220 0" intensity="2" color="#ffcf88" />'],
    ['point', '<light type="point" x="80" y="60" z="90" intensity="20" distance="500" color="#ff2020" />'],
    ['spot', '<light type="spot" x="220" y="-80" z="20" target="220 220 0" angle="0.9" penumbra="0.4" intensity="14" color="#ffb066" />'],
    ['area', '<light type="area" x="220" y="-120" z="60" target="220 220 0" width="300" height="300" intensity="60" color="#fff2dd" />'],
    ['hemisphere', '<light type="hemisphere" intensity="1.2" color="#7fb2ff" ground-color="#8a6a45" />'],
    ['ambient', '<light type="ambient" intensity="0.5" color="#ffffff" />'],
  ]

  it('每一种灯都改变画面，spot 在地面上照出圆斑，point 的池子向外衰减', async () => {
    const control = await paint('')
    const cells = new Map<string, Painted>()
    for (const [name, light] of lights) cells.set(name, await paint(light))

    // `lightEffect`: FLIP against the same scene with no `<light>`.
    for (const [name] of lights) {
      const cell = cells.get(name)!
      const flip = meanFlip(cell.rgba, control.rgba, cell.width, cell.height)
      expect(flip, `${name} renders like the control`).toBeGreaterThan(0.03)
    }

    // `spotDisc`: the disc's core stands clear of the floor outside it, and the
    // walk from the core to the disc's edge only ever falls. The walk stops when
    // the profile reaches the open floor, because past that point the box's
    // contact shadow is the thing being measured, not the cone.
    const top = await floorTop()
    const spot = cells.get('spot')!
    const spotPeak = floorPeak(spot, top)
    const outside = lumaAt(spot, 4, spotPeak.y)
    expect(spotPeak.Y - outside, 'spot disc rise').toBeGreaterThan(25)
    let dips = 0
    for (const step of [-1, 1]) {
      let prev = spotPeak.Y
      for (let k = 1; k < 200; k++) {
        const x = spotPeak.x + step * k
        if (x < 1 || x >= spot.width - 1) break
        const Y = lumaAt(spot, x, spotPeak.y)
        if (Y <= outside + 2) break
        if (Y > prev + 2) dips += 1
        prev = Y
      }
    }
    expect(dips, 'spot disc edge is not monotone').toBe(0)

    // `pointFalloff`: five samples walking away from the pool's foot, which is
    // where a point light's brightest floor pixel lands. The total drop is what
    // separates a real falloff from a flat wash.
    const point = cells.get('point')!
    const pointPeak = floorPeak(point, top)
    const direction = pointPeak.x < point.width / 2 ? 1 : -1
    const samples: number[] = []
    for (let k = 0; k < 5; k++) {
      const x = pointPeak.x + direction * 36 * k
      if (x < 1 || x >= point.width - 1) break
      samples.push(lumaAt(point, x, pointPeak.y))
    }
    expect(samples.length).toBe(5)
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!, `point falloff rises at sample ${i}`).toBeLessThanOrEqual(samples[i - 1]! + 1)
    }
    expect(samples[0]! - samples[samples.length - 1]!, 'point falloff drop').toBeGreaterThan(8)
  })

  it('matte 盒朝灯的一面被点光抬起，暗面不是死黑', async () => {
    const control = await paint('')
    const point = await paint('<light type="point" x="80" y="60" z="90" intensity="20" distance="500" color="#ff2020" />')
    const report = await checkLayer(lightScene(''), { baseDir: process.cwd() })
    const ink = report.elements?.find((element) => element.id === 'matte')?.ink
    expect(ink).toBeTruthy()
    const x0 = Math.max(0, Math.floor(ink!.x))
    const y0 = Math.max(0, Math.floor(ink!.y))
    const x1 = Math.min(control.width, Math.ceil(ink!.x + ink!.width))
    const y1 = Math.min(control.height, Math.ceil(ink!.y + ink!.height))
    const picked: Array<{ x: number; y: number; Y: number }> = []
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) picked.push({ x, y, Y: lumaAt(control, x, y) })
    }
    picked.sort((a, b) => a.Y - b.Y)
    const face = picked.slice(0, Math.max(12, Math.floor(picked.length * 0.25)))
    // A red lamp raises red and leaves luma nearly alone on a white box, so the
    // per-channel mean rise is the honest reading and the gate uses the larger.
    let channelRise = 0
    let lumaRise = 0
    for (const p of face) {
      const i = (p.y * point.width + p.x) * 4
      lumaRise += lumaAt(point, p.x, p.y) - p.Y
      for (let c = 0; c < 3; c++) channelRise += point.rgba[i + c]! - control.rgba[i + c]!
    }
    const rise = Math.max(lumaRise / face.length, channelRise / face.length)
    expect(rise, 'matte face under the point light').toBeGreaterThan(15)
  })
})

describe('author lights', () => {
  it('镜头上的 light 被记下，未知类型和越界粗糙度会警告', async () => {
    const opened = readLayerRoot(`<layer width="200" height="160" camera="400" environment="studio" tonemap="neutral" light="world" quality="final">
      <light type="directional" color="#fff" intensity="2" x="0" y="-40" z="80" target="0 0 0" cast-shadow="false" />
      <light type="point" distance="80" />
      <sphere cx="100" cy="80" r="24" fill="#c45a3a" roughness="0.4" />
    </layer>`)
    const assets = await prepareAssets(opened.root, process.cwd(), { fonts: opened.fonts })
    const doc = layoutSync(opened.root, assets)
    expect(doc.root.lights).toHaveLength(2)
    expect(doc.root.lights?.[0]?.type).toBe('directional')
    expect(doc.root.lights?.[0]?.intensity).toBe(2)
    expect(doc.root.lights?.[0]?.castShadow).toBe(false)
    expect(doc.root.lights?.[1]?.distance).toBe(80)
    expect(doc.root.lightSpace).toBe('world')
    expect(doc.root.quality).toBe('final')
    expect(doc.root.environment).toBeUndefined()
    const mesh = doc.root.children.find((child) => child.kind === 'mesh')
    expect(mesh && mesh.kind === 'mesh' ? mesh.material?.roughness : 0).toBeCloseTo(0.4)

    const report = await checkLayer(`<layer width="80" height="80" camera="200">
      <light type="candle" />
      <sphere cx="40" cy="40" r="12" roughness="2" />
    </layer>`)
    const messages = report.issues.map((issue) => issue.message).join('\n')
    expect(messages).toContain('candle')
    expect(messages).toContain('roughness')
    expect(report.issues.some((issue) => issue.code === 'unknown-tag')).toBe(false)
  })

  it('spot 的 angle 是弧度，penumbra 是 0–1 的比例', async () => {
    const doc = await laidOut(`<layer width="200" height="160" camera="400">
      <light type="spot" angle="0.6" penumbra="0.25" distance="300" decay="1.5" cast-shadow="false" />
      <light type="area" width="80" height="40" />
      <light type="hemisphere" color="#7fb2ff" ground-color="#8a6a45" />
      <sphere cx="100" cy="80" r="24" fill="#c45a3a" />
    </layer>`)
    const [spot, area, hemisphere] = doc.root.lights ?? []
    // Radians everywhere: `layout.ts`, `SPEC.md` and the kernel agree, so a
    // `angle="0.6"` is a ~34° half-angle and not six tenths of a degree.
    expect(spot?.angle).toBeCloseTo(0.6)
    expect(spot?.penumbra).toBeCloseTo(0.25)
    expect(spot?.distance).toBe(300)
    expect(spot?.decay).toBeCloseTo(1.5)
    expect(spot?.castShadow).toBe(false)
    expect(area?.width).toBe(80)
    expect(area?.height).toBe(40)
    expect(hemisphere?.groundColor).toEqual([0x8a, 0x6a, 0x45])
  })
})

describe('material phrase', () => {
  it('finish 和 color 收在 material 里，color 盖过 fill', async () => {
    const doc = await laidOut(`<layer width="200" height="80" camera="200">
      <sphere cx="30" cy="40" r="16" fill="#111111" material="finish metal, color #c6c9ce, roughness 0.28, metalness 1" />
      <sphere cx="80" cy="40" r="16" fill="#445566" material="finish metal, color #c6c9ce" />
      <sphere cx="140" cy="40" r="12" fill="#445566" material="metal" />
    </layer>`)
    const meshes = doc.root.children.filter((child) => child.kind === 'mesh')
    const physical = meshes[0]
    const baked = meshes[1]
    const legacy = meshes[2]
    expect(physical && physical.kind === 'mesh' ? physical.fill : '').toBe('#c6c9ce')
    expect(physical && physical.kind === 'mesh' ? physical.material : undefined).toMatchObject({
      kind: 'metal',
      roughness: 0.28,
      metalness: 1,
    })
    expect(physical && physical.kind === 'mesh' ? physical.material?.matcap : 'set').toBeUndefined()
    expect(baked && baked.kind === 'mesh' ? baked.fill : '').toBe('#c6c9ce')
    expect(baked && baked.kind === 'mesh' ? baked.material?.matcap : '').toBe('metal')
    expect(legacy && legacy.kind === 'mesh' ? legacy.fill : '').toBe('#445566')
    expect(legacy && legacy.kind === 'mesh' ? legacy.material?.matcap : '').toBe('metal')
    expect(doc.issues.filter((issue) => issue.code === 'invalid-attr')).toEqual([])
  })

  it('tsx 对象收成同一句，玻璃和未知 finish 分开', async () => {
    const root = h(
      'layer',
      { width: 80, height: 80, camera: 200 },
      h('sphere', {
        cx: 40,
        cy: 40,
        r: 16,
        fill: '#111111',
        material: { finish: 'glass', color: 'rgb(198, 201, 206)', roughness: 0.05, transmission: 1, ior: 1.5 },
      }),
    )
    const sphere = root.children[0]
    expect(typeof sphere !== 'string' && sphere?.attrs.material).toBe('finish glass, color rgb(198, 201, 206), roughness 0.05, transmission 1, ior 1.5')
    const assets = await prepareAssets(root, process.cwd())
    const doc = layoutSync(root, assets)
    const mesh = doc.root.children.find((child) => child.kind === 'mesh')
    expect(mesh && mesh.kind === 'mesh' ? mesh.fill : '').toBe('rgb(198, 201, 206)')
    expect(mesh && mesh.kind === 'mesh' ? mesh.material : undefined).toMatchObject({
      kind: 'glass',
      roughness: 0.05,
      transmission: 1,
      ior: 1.5,
    })

    const report = await checkLayer(`<layer width="80" height="80" camera="200"><sphere cx="40" cy="40" r="12" material="finish wood, color #fff" /></layer>`)
    expect(report.issues.some((issue) => issue.message.includes('不认识的 finish'))).toBe(true)
  })
})

describe('quality inheritance', () => {
  const scene = `<layer width="80" height="60" quality="final">
      <layer width="80" height="60" camera="120">
        <rect x="8" y="8" width="20" height="12" fill="#888" />
      </layer>
      <layer width="80" height="60" camera="120" quality="draft">
        <rect x="8" y="8" width="20" height="12" fill="#888" />
      </layer>
      <layer x="0" y="0" width="10" height="10" />
    </layer>`

  it('没写 quality 的镜头继承根上的值，自己写了的保留', async () => {
    const opened = readLayerRoot(scene)
    const assets = await prepareAssets(opened.root, process.cwd(), { fonts: opened.fonts })
    const doc = layoutSync(opened.root, assets)
    const [inherited, authored, plain] = doc.root.children
    expect(doc.root.quality).toBe('final')
    expect(inherited && inherited.kind === 'layer' ? inherited.quality : undefined).toBe('final')
    expect(authored && authored.kind === 'layer' ? authored.quality : undefined).toBe('draft')
    expect(plain && plain.kind === 'layer' ? plain.quality : 'set').toBeUndefined()
    expect(doc.issues.some((issue) => issue.message.includes('quality'))).toBe(false)
    const config = inherited && inherited.kind === 'layer' && inherited.quality ? { quality: inherited.quality } : {}
    expect(config).toEqual({ quality: 'final' })
  })

  it('渲染传入的 quality 盖过根，并填进还没写质量档的镜头', async () => {
    const opened = readLayerRoot(scene.replace('quality="final"', ''))
    const assets = await prepareAssets(opened.root, process.cwd(), { fonts: opened.fonts })
    const doc = layoutSync(opened.root, assets, 'final')
    inheritQuality(doc.root, 'final')
    const [inherited, authored] = doc.root.children
    expect(inherited && inherited.kind === 'layer' ? inherited.quality : undefined).toBe('final')
    expect(authored && authored.kind === 'layer' ? authored.quality : undefined).toBe('draft')
  })
})
