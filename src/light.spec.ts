import { describe, expect, it } from 'vitest'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import { checkLayer, inheritQuality } from './render.js'

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
