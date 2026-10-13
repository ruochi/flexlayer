import { mkdtempSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { solidBoxGlb } from './glb.js'
import { h } from './h.js'
import { loadLayerFile } from './load-source.js'
import { checkLayer, renderLayer } from './render.js'
import { fromThree } from './three.js'
import { typecheckLayerFile } from './typecheck.js'

const pkgDir = join(fileURLToPath(import.meta.url), '..', '..')

function triangleGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
  geometry.setIndex([0, 1, 2])
  geometry.computeVertexNormals()
  return geometry
}

function centroid(positions: Float32Array) {
  let x = 0
  let y = 0
  let z = 0
  const count = positions.length / 3
  for (let i = 0; i < positions.length; i += 3) {
    x += positions[i]!
    y += positions[i + 1]!
    z += positions[i + 2]!
  }
  return { x: x / count, y: y / count, z: z / count }
}

async function pixelAt(png: Buffer, x: number, y: number) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(x, y, 1, 1).data
}

describe('fromThree', () => {
  it('认 isMesh，保留 y 向上，并读出金属度和双面', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const mesh = {
      isMesh: true,
      geometry: {
        isBufferGeometry: true,
        attributes: {
          position: {
            count: 3,
            getX: (i: number) => positions[i * 3]!,
            getY: (i: number) => positions[i * 3 + 1]!,
            getZ: (i: number) => positions[i * 3 + 2]!,
          },
        },
        index: { count: 3, getX: (i: number) => i },
      },
      material: { color: { r: 1, g: 0, b: 0 }, metalness: 0.8, roughness: 0.2, opacity: 1, side: 2 },
      matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1] },
    }
    const prims = fromThree(mesh)
    expect(prims).toHaveLength(1)
    expect(prims[0]!.positions[1]).toBeCloseTo(2)
    expect(prims[0]!.positions[4]).toBeCloseTo(2)
    expect(prims[0]!.metalness).toBeCloseTo(0.8)
    expect(prims[0]!.roughness).toBeCloseTo(0.2)
    expect(prims[0]!.shade).toBe('metal')
    expect(prims[0]!.doubleSided).toBe(true)
    expect(Array.from(prims[0]!.indices!)).toEqual([0, 1, 2])
    expect(mesh instanceof THREE.Mesh).toBe(false)
  })

  it('父级位移在传入子节点时仍然生效，负缩放翻转绕序', () => {
    const group = new THREE.Group()
    group.position.set(5, 0, 0)
    const child = new THREE.Mesh(triangleGeometry(), new THREE.MeshBasicMaterial())
    group.add(child)
    const lifted = fromThree(child)
    expect(lifted[0]!.positions[0]).toBeCloseTo(5)
    expect(lifted[0]!.positions[1]).toBeCloseTo(0)
    expect(lifted[0]!.normals![2]).toBeGreaterThan(0.9)

    const mirrored = new THREE.Mesh(triangleGeometry(), new THREE.MeshBasicMaterial())
    mirrored.scale.set(-1, 1, 1)
    const flipped = fromThree(mirrored)
    expect(Array.from(flipped[0]!.indices!)).toEqual([0, 2, 1])
    expect(flipped[0]!.positions[3]).toBeCloseTo(-1)
  })

  it('多个部件保持世界坐标里的相对位置', () => {
    const group = new THREE.Group()
    const a = new THREE.Mesh(triangleGeometry(), new THREE.MeshStandardMaterial({ color: '#7dce8a', metalness: 0.2, roughness: 0.4 }))
    const b = new THREE.Mesh(triangleGeometry(), new THREE.MeshStandardMaterial({ color: '#7dce8a', metalness: 0.2, roughness: 0.4 }))
    b.position.set(3, 1, 0)
    group.add(a, b)
    const prims = fromThree(group)
    expect(prims).toHaveLength(2)
    const left = centroid(prims[0]!.positions)
    const right = centroid(prims[1]!.positions)
    expect(right.x - left.x).toBeCloseTo(3)
    expect(right.y - left.y).toBeCloseTo(1)
    expect(prims[0]!.color[1]).toBeGreaterThan(0.75)
    expect(prims[0]!.color[1]).toBeLessThan(0.9)
  })

  it('交错属性和 InstancedMesh 用分量读取', () => {
    const buffer = new THREE.InterleavedBuffer(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0))
    geometry.setIndex([0, 1, 2])
    const interleaved = fromThree(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()))
    expect(interleaved[0]!.positions[3]).toBeCloseTo(1)
    expect(interleaved[0]!.positions[7]).toBeCloseTo(1)

    const instanced = new THREE.InstancedMesh(triangleGeometry(), new THREE.MeshStandardMaterial(), 2)
    instanced.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0, 0))
    const copies = fromThree(instanced)
    expect(copies).toHaveLength(2)
    expect(copies[1]!.positions[0]! - copies[0]!.positions[0]!).toBeCloseTo(2)
  })

  it('Lambert 和 Toon 是磨砂，Phong 的光泽收成粗糙度，透射过半是玻璃', () => {
    const lambert = fromThree(new THREE.Mesh(triangleGeometry(), new THREE.MeshLambertMaterial({ color: '#888888' })))
    const toon = fromThree(new THREE.Mesh(triangleGeometry(), new THREE.MeshToonMaterial({ color: '#888888' })))
    expect(lambert[0]!.shade).toBe('matte')
    expect(toon[0]!.shade).toBe('matte')

    const dull = fromThree(new THREE.Mesh(triangleGeometry(), new THREE.MeshPhongMaterial({ shininess: 0 })))
    const shiny = fromThree(new THREE.Mesh(triangleGeometry(), new THREE.MeshPhongMaterial({ shininess: 100 })))
    expect(dull[0]!.shade).toBe('plastic')
    expect(dull[0]!.roughness).toBeCloseTo(1)
    expect(shiny[0]!.shade).toBe('plastic')
    expect(shiny[0]!.roughness).toBeCloseTo(0)

    const glass = fromThree(
      new THREE.Mesh(triangleGeometry(), new THREE.MeshPhysicalMaterial({ transmission: 1, roughness: 0.15, metalness: 0 })),
    )
    const faint = fromThree(
      new THREE.Mesh(triangleGeometry(), new THREE.MeshPhysicalMaterial({ transmission: 0.2, roughness: 0.4, metalness: 0 })),
    )
    expect(glass[0]!.shade).toBe('glass')
    expect(glass[0]!.roughness).toBeCloseTo(0.15)
    expect(faint[0]!.shade).toBe('plastic')
    expect(faint[0]!.roughness).toBeCloseTo(0.4)
  })
})

describe('model object 和 unit', () => {
  it('拆开的部件按 unit 留在各自的位置，金属和塑料看起来不同', async () => {
    const left = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: '#e23b2f', metalness: 0.05, roughness: 0.45 }),
    )
    left.position.set(-1.2, 0, 0)
    const right = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: '#2f6fe2', metalness: 0.9, roughness: 0.2 }),
    )
    right.position.set(1.2, 0, 0)
    const node = h(
      'layer',
      { width: 240, height: 240, camera: 'parallel', background: '#000000' },
      h('model', { object: left, unit: 50 }),
      h('model', { object: right, unit: 50 }),
    )
    const { png } = await renderLayer(node)
    const leftPx = await pixelAt(png, 60, 120)
    const rightPx = await pixelAt(png, 180, 120)
    const mid = await pixelAt(png, 120, 120)
    expect(leftPx[0]).toBeGreaterThan(leftPx[2]! + 30)
    expect(rightPx[2]).toBeGreaterThan(rightPx[0]! + 30)
    expect(mid[0]).toBeLessThan(15)

    async function shade(metalness: number, roughness: number) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: '#c8c8c8', metalness, roughness }),
      )
      const shaded = h(
        'layer',
        { width: 80, height: 80, camera: 'parallel', background: '#000000' },
        h('model', { object: mesh, unit: 40 }),
      )
      const frame = await renderLayer(shaded)
      return pixelAt(frame.png, 40, 40)
    }
    const plastic = await shade(0, 0.85)
    const metal = await shade(1, 0.15)
    const diff = Math.abs(plastic[0]! - metal[0]!) + Math.abs(plastic[1]! - metal[1]!) + Math.abs(plastic[2]! - metal[2]!)
    expect(diff).toBeGreaterThan(8)

    async function face(material: THREE.Material) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
      const shaded = h(
        'layer',
        { width: 80, height: 80, camera: 'parallel', background: '#000000' },
        h('model', { object: mesh, unit: 40 }),
      )
      const frame = await renderLayer(shaded)
      return pixelAt(frame.png, 40, 40)
    }
    const matte = await face(new THREE.MeshLambertMaterial({ color: '#c8c8c8' }))
    const glossy = await face(new THREE.MeshPhongMaterial({ color: '#c8c8c8', shininess: 100 }))
    const pane = await face(new THREE.MeshPhysicalMaterial({ color: '#c8c8c8', transmission: 1, roughness: 0.05 }))
    const matteGap = Math.abs(matte[0]! - glossy[0]!) + Math.abs(matte[1]! - glossy[1]!) + Math.abs(matte[2]! - glossy[2]!)
    const glassGap = Math.abs(matte[0]! - pane[0]!) + Math.abs(matte[1]! - pane[1]!) + Math.abs(matte[2]! - pane[2]!)
    expect(matteGap).toBeGreaterThan(8)
    expect(glassGap).toBeGreaterThan(8)
  }, 30000)

  it('glb 写了 unit 就不再撑满盒子', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-unit-'))
    writeFileSync(join(dir, 'box.glb'), solidBoxGlb([0.15, 0.82, 0.35, 1]))
    const contain = await renderLayer(
      `<layer width="100" height="100" background="#000000" camera="parallel"><model src="box.glb" /></layer>`,
      { baseDir: dir },
    )
    const fitted = await renderLayer(
      `<layer width="100" height="100" background="#000000" camera="parallel"><model src="box.glb" unit="10" /></layer>`,
      { baseDir: dir },
    )
    const containCorner = await pixelAt(contain.png, 2, 2)
    const unitCorner = await pixelAt(fitted.png, 2, 2)
    const unitCenter = await pixelAt(fitted.png, 50, 50)
    expect(containCorner[1]).toBeGreaterThan(40)
    expect(unitCorner[1]).toBeLessThan(15)
    expect(unitCenter[1]).toBeGreaterThan(40)
  }, 30000)

  it('空对象、同时写 src、以及 unit 不是正数时给出警告', async () => {
    const empty = h(
      'layer',
      { width: 80, height: 80, camera: 'parallel' },
      h('model', { object: { isObject3D: true, children: [] }, unit: 10 }),
    )
    const emptyReport = await checkLayer(empty)
    expect(emptyReport.issues.some((issue) => issue.code === 'missing-model' && issue.message.includes('三角形'))).toBe(true)

    const both = h(
      'layer',
      { width: 80, height: 80, camera: 'parallel' },
      h('model', { object: { isMesh: true }, src: 'box.glb', unit: 0 }),
    )
    const bothReport = await checkLayer(both)
    expect(bothReport.issues.some((issue) => issue.message.includes('同时写了 src 和 object'))).toBe(true)
    expect(bothReport.issues.some((issue) => issue.message.includes('无法解析 unit'))).toBe(true)

    const text = await checkLayer(`<layer width="40" height="40"><model object="mesh" /><rect unit="4" /></layer>`)
    expect(text.issues.some((issue) => issue.message.includes('传入网格对象'))).toBe(true)
    expect(text.issues.some((issue) => issue.message.includes('unit 只写在 model'))).toBe(true)
  })
})

describe('three 的模块', () => {
  it('加载器和用户代码用同一份 three，类型检查从源文件目录往上找', async () => {
    const dir = await mkdtemp(join(pkgDir, '.tmp-three-'))
    const file = join(dir, 'scene.tsx')
    const glb = JSON.stringify(join(pkgDir, 'examples', 'box.glb'))
    try {
      await writeFile(
        file,
        `import { readFileSync } from 'node:fs'
        import * as THREE from 'three'
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
        import { fromThree } from 'flexlayer/three'

        const buf = readFileSync(${glb})
        const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
        let found: THREE.Mesh | undefined
        gltf.scene.traverse((obj: THREE.Object3D) => {
          if (obj instanceof THREE.Mesh) found = obj
        })
        if (!found) throw new Error('dual three')
        if (fromThree(found).length === 0) throw new Error('no triangles')
        export default (
          <layer width="64" height="64" camera="parallel" background="#000">
            <model object={found} unit={20} />
          </layer>
        )
        `,
      )
      expect(typecheckLayerFile(file).map((issue) => issue.message).join('\n')).toBe('')
      const loaded = await loadLayerFile(file)
      expect(loaded.kind).toBe('node')
      if (loaded.kind !== 'node') return
      const { png } = await renderLayer(loaded.node)
      const center = await pixelAt(png, 32, 32)
      expect(center[0]! + center[1]! + center[2]!).toBeGreaterThan(20)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30000)

  it('仓库外的文件运行时和类型检查都找不到 three', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-outside-three-'))
    const file = join(dir, 'scene.tsx')
    await writeFile(file, `import * as THREE from 'three'\nexport default <layer width="8" height="8">{String(THREE.REVISION)}</layer>\n`)
    expect(typecheckLayerFile(file).some((issue) => issue.message.includes("Cannot find module 'three'"))).toBe(true)
    await expect(loadLayerFile(file)).rejects.toThrow(/无法解析 three/)
  })
})
