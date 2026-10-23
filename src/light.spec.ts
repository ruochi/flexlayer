import { describe, expect, it } from 'vitest'
import { h } from './h.js'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import { checkLayer, inheritQuality } from './render.js'

async function laidOut(source: string) {
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, process.cwd(), { fonts: opened.fonts })
  return layoutSync(opened.root, assets)
}

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
