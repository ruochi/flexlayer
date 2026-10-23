import { describe, expect, it } from 'vitest'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import { checkLayer } from './render.js'

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
