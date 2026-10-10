import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { solidBoxGlb } from './glb.js'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import { clearMeshCache } from './mesh-cache.js'
import { meshLayerCacheKey, ownsMeshScene } from './mesh.js'
import { renderToCanvas } from './render.js'
import type { LayerLayoutNode, LayoutNode, MeshLayoutNode } from './types.js'

const clipOf = (layer: LayerLayoutNode) => ({ x: 0, y: 0, width: layer.width, height: layer.height })

async function laid(source: string, baseDir = process.cwd()) {
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, baseDir, { fonts: opened.fonts })
  return layoutSync(opened.root, assets)
}

function firstMeshLayer(node: LayoutNode): LayerLayoutNode | null {
  if (node.kind === 'layer' && ownsMeshScene(node)) return node
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    for (const child of node.children) {
      const found = firstMeshLayer(child)
      if (found) return found
    }
  }
  return null
}

function findModel(node: LayoutNode): MeshLayoutNode | null {
  if (node.kind === 'mesh' && node.mesh.type === 'model') return node
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    for (const child of node.children) {
      const found = findModel(child)
      if (found) return found
    }
  }
  return null
}

async function keyOf(source: string, scale = 1, samples = 4, baseDir = process.cwd()) {
  const doc = await laid(source, baseDir)
  const layer = firstMeshLayer(doc.root)
  if (!layer) throw new Error('没有网格层')
  return meshLayerCacheKey(layer, scale, samples, clipOf(layer))
}

const box = (rotateY = 0, depth = 24, fill = '#e23b2f', opacity = 1) => `
  <layer width="160" height="120" background="#111111" perspective="500">
    <rect x="8" y="70" width="36" height="20" fill="#2244aa" />
    <layer x="48" y="24" width="64" height="64" rotateY="${rotateY}">
      <box width="64" height="64" depth="${depth}" fill="${fill}" opacity="${opacity}" />
    </layer>
  </layer>
`

function rgba(canvas: { width: number; height: number; getContext(kind: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } }) {
  const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  return Buffer.from(image.data)
}

describe('网格场景缓存键', () => {
  it('同一数值重建节点后键不变', async () => {
    const a = await keyOf(box())
    const b = await keyOf(box())
    expect(a).toBeTruthy()
    expect(a).toBe(b)
  })

  it('旋转、depth、fill、opacity、scale、perspective、平面内容都会改键', async () => {
    const base = await keyOf(box())
    expect(await keyOf(box(25))).not.toBe(base)
    expect(await keyOf(box(0, 48))).not.toBe(base)
    expect(await keyOf(box(0, 24, '#00ff88'))).not.toBe(base)
    expect(await keyOf(box(0, 24, '#e23b2f', 0.4))).not.toBe(base)
    expect(await keyOf(box(), 2)).not.toBe(base)
    expect(await keyOf(box().replace('perspective="500"', 'perspective="900"'))).not.toBe(base)
    expect(await keyOf(box().replace('fill="#2244aa"', 'fill="#ccaa22"'))).not.toBe(base)
    expect(await keyOf(box(), 1, 2)).not.toBe(base)
  })

  it('模型文件的 mtime 变了键也变', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-mesh-key-'))
    const file = join(dir, 'box.glb')
    writeFileSync(file, solidBoxGlb([0.2, 0.7, 0.3, 1]))
    const source = `<layer width="120" height="120" background="#000" perspective="600"><layer x="30" y="30" width="60" height="60"><model src="box.glb" /></layer></layer>`
    const doc = await laid(source, dir)
    const layer = firstMeshLayer(doc.root)
    if (!layer) throw new Error('没有网格层')
    const model = findModel(layer)
    expect(model?.mesh.type === 'model' ? model.mesh.file : '').toBe(file)
    const clip = clipOf(layer)
    const first = meshLayerCacheKey(layer, 1, 4, clip)
    const later = new Date(Date.now() + 10_000)
    utimesSync(file, later, later)
    const second = meshLayerCacheKey(layer, 1, 4, clip)
    expect(first).toBeTruthy()
    expect(second).not.toBe(first)
  })

  it('平面里有 draw 时不缓存', async () => {
    const source = `
      <layer width="80" height="80" background="#000" perspective="300">
        <sphere cx="40" cy="40" r="16" fill="#fff" />
        <layer x="4" y="4" width="20" height="20"><draw>ctx.fillRect(0,0,el.w,el.h)</draw></layer>
      </layer>
    `
    expect(await keyOf(source)).toBeNull()
  })
})

describe('网格场景缓存像素', () => {
  it('命中、未命中和关闭缓存的 RGBA 逐字节相同', async () => {
    const source = `<layer width="72" height="72" background="#123456" perspective="320"><sphere cx="36" cy="36" r="16" fill="#ff2244" /></layer>`
    clearMeshCache()
    const off = await renderToCanvas(source, { meshCache: false })
    const miss = await renderToCanvas(source, { meshCache: 32 * 1024 * 1024 })
    const hit = await renderToCanvas(source, { meshCache: 32 * 1024 * 1024 })
    const a = rgba(off.canvas)
    const b = rgba(miss.canvas)
    const c = rgba(hit.canvas)
    expect(b.equals(a)).toBe(true)
    expect(c.equals(a)).toBe(true)
    const center = b[(36 * 72 + 36) * 4]!
    expect(center).toBeGreaterThan(140)
  })
})
