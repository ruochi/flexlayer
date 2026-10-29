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
import { fromThree, lightsFromThree } from './three.js'
import { typecheckLayerFile } from './typecheck.js'

const pkgDir = join(fileURLToPath(import.meta.url), '..', '..')

function quadGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()
  return geometry
}

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

  it('作者写的 roughness 0 不会被默认值 0.65 顶掉', () => {
    // The 0.65 fallback is for a bare object with no roughness at all. A
    // written 0 is a real value and a sharp reflection, not "unset".
    const sharp = fromThree(
      new THREE.Mesh(triangleGeometry(), new THREE.MeshStandardMaterial({ color: '#888888', metalness: 0.8, roughness: 0 })),
    )
    expect(sharp[0]!.shade).toBe('metal')
    expect(sharp[0]!.roughness).toBe(0)
  })

  it('贴图、顶点色、自发光和着色器颜色进到底色', () => {
    const data = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255])
    const map = new THREE.DataTexture(data, 2, 1)
    const textured = fromThree(new THREE.Mesh(quadGeometry(), new THREE.MeshLambertMaterial({ map })))
    expect(textured[0]!.map?.w).toBe(2)
    expect(textured[0]!.map?.rgba[0]).toBe(255)
    expect(textured[0]!.map?.rgba[4]).toBe(0)
    expect(textured[0]!.uvs?.[0]).toBe(0)
    expect(textured[0]!.uvs?.[2]).toBe(1)

    const colors = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0])
    const painted = quadGeometry()
    painted.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const vertex = fromThree(new THREE.Mesh(painted, new THREE.MeshLambertMaterial({ vertexColors: true, color: '#ffffff' })))
    expect(vertex[0]!.colors?.[0]).toBeCloseTo(1)
    expect(vertex[0]!.colors?.[3]).toBeCloseTo(0)

    const glow = fromThree(new THREE.Mesh(triangleGeometry(), new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#00ff00', emissiveIntensity: 1 })))
    expect(glow[0]!.emissive?.[1]).toBeGreaterThan(0.9)

    const shader = fromThree(
      new THREE.Mesh(
        triangleGeometry(),
        new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color('#e23b2f') } },
          vertexShader: 'void main() {}',
          fragmentShader: 'void main() {}',
        }),
      ),
    )
    expect(shader[0]!.shade).toBe('plastic')
    expect(shader[0]!.color[0]).toBeGreaterThan(shader[0]!.color[2]!)
  })

  it('LineSegments 收成线段，wireframe 只留边，Points 收成点', () => {
    const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0])
    const position = {
      count: 3,
      getX: (i: number) => positions[i * 3]!,
      getY: (i: number) => positions[i * 3 + 1]!,
      getZ: (i: number) => positions[i * 3 + 2]!,
    }
    const geometry = { isBufferGeometry: true, attributes: { position } }
    const line = {
      isLine: true,
      isLineSegments: true,
      geometry,
      material: { color: { r: 1, g: 0, b: 0 }, linewidth: 2 },
      matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 4, 0, 1] },
    }
    const segments = fromThree(line)
    expect(segments).toHaveLength(1)
    expect(segments[0]!.lines).toBe(true)
    expect(segments[0]!.linePx).toBe(2)
    expect(Array.from(segments[0]!.indices!)).toEqual([0, 1])
    expect(segments[0]!.positions[1]).toBeCloseTo(4)
    expect(segments[0]!.positions[3]).toBeCloseTo(2)

    const wire = {
      isMesh: true,
      geometry: { ...geometry, index: { count: 3, getX: (i: number) => i } },
      material: { color: { r: 0, g: 1, b: 0 }, wireframe: true },
      matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    }
    const edges = fromThree(wire)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.lines).toBe(true)
    expect(Array.from(edges[0]!.indices!).sort((a, b) => a - b)).toEqual([0, 0, 1, 1, 2, 2])

    const points = { isPoints: true, geometry, material: { color: { r: 1, g: 1, b: 1 }, size: 3 }, matrixWorld: wire.matrixWorld }
    const dots = fromThree(points)
    expect(dots).toHaveLength(1)
    expect(dots[0]!.points).toBe(true)
    expect(dots[0]!.pointPx).toBe(3)
    expect(dots[0]!.lines).toBeUndefined()
    expect(Array.from(dots[0]!.indices!)).toEqual([0, 1, 2])
    expect(dots[0]!.positions[0]).toBeCloseTo(0)
    expect(dots[0]!.color[0]).toBeGreaterThan(0.9)
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
      h('model', { object: left, unit: 50, x: 120, y: 120 }),
      h('model', { object: right, unit: 50, x: 120, y: 120 }),
    )
    const { png } = await renderLayer(node)
    const leftPx = await pixelAt(png, 60, 120)
    const rightPx = await pixelAt(png, 180, 120)
    const mid = await pixelAt(png, 120, 120)
    expect(leftPx[0]).toBeGreaterThan(leftPx[2]! + 30)
    // Metal desaturate (QUALITY-5 §3) softens pure studio blues; still must
    // read cooler than the red plastic neighbour.
    expect(rightPx[2]).toBeGreaterThan(rightPx[0]! + 12)
    expect(rightPx[2]! + rightPx[1]!).toBeGreaterThan(rightPx[0]! + 20)
    expect(mid[0]).toBeLessThan(15)

    async function shade(metalness: number, roughness: number) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: '#c8c8c8', metalness, roughness }),
      )
      const shaded = h(
        'layer',
        { width: 80, height: 80, camera: 'parallel', background: '#000000' },
        h('model', { object: mesh, unit: 40, x: 40, y: 40 }),
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
        h('model', { object: mesh, unit: 40, x: 40, y: 40 }),
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

    async function quadAt(material: THREE.Material, x: number, y: number) {
      const mesh = new THREE.Mesh(quadGeometry(), material)
      mesh.material.side = THREE.DoubleSide
      const frame = await renderLayer(
        h('layer', { width: 80, height: 80, camera: 'parallel', background: '#000000' }, h('model', { object: mesh, unit: 40, x: 40, y: 40 })),
      )
      return pixelAt(frame.png, x, y)
    }
    const split = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]), 2, 1)
    const lambertMap = await quadAt(new THREE.MeshLambertMaterial({ color: '#ffffff', map: split }), 28, 40)
    const lambertFar = await quadAt(new THREE.MeshLambertMaterial({ color: '#ffffff', map: split }), 52, 40)
    expect(lambertMap[0]).toBeGreaterThan((lambertMap[2] ?? 0) + 30)
    expect(lambertFar[2]).toBeGreaterThan((lambertFar[0] ?? 0) + 30)
    const metalMap = await quadAt(new THREE.MeshStandardMaterial({ color: '#ffffff', map: split, metalness: 1, roughness: 0.35 }), 28, 40)
    const metalFar = await quadAt(new THREE.MeshStandardMaterial({ color: '#ffffff', map: split, metalness: 1, roughness: 0.35 }), 52, 40)
    expect(Math.abs((metalMap[0] ?? 0) - (metalFar[0] ?? 0)) + Math.abs((metalMap[2] ?? 0) - (metalFar[2] ?? 0))).toBeGreaterThan(8)

    const colored = quadGeometry()
    colored.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0]), 3))
    const colorFrame = await renderLayer(
      h(
        'layer',
        { width: 80, height: 80, camera: 'parallel', background: '#000000' },
        h('model', { object: new THREE.Mesh(colored, new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true })), unit: 40, x: 40, y: 40 }),
      ),
    )
    const leftColor = await pixelAt(colorFrame.png, 28, 40)
    const rightColor = await pixelAt(colorFrame.png, 52, 40)
    expect(leftColor[0]).toBeGreaterThan((leftColor[2] ?? 0) + 20)
    expect(rightColor[2]).toBeGreaterThan((rightColor[0] ?? 0) + 20)

    const dark = await quadAt(new THREE.MeshStandardMaterial({ color: '#000000', roughness: 1, metalness: 0 }), 40, 40)
    const lit = await quadAt(new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#3dff7a', emissiveIntensity: 1, roughness: 1, metalness: 0 }), 40, 40)
    expect(lit[1]).toBeGreaterThan((dark[1] ?? 0) + 30)
    const shaderPx = await quadAt(
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color('#e23b2f') } },
        vertexShader: 'void main() {}',
        fragmentShader: 'void main() {}',
      }),
      40,
      40,
    )
    expect(shaderPx[0]).toBeGreaterThan((shaderPx[2] ?? 0) + 20)
  }, 30000)

  it('glb 写了 unit 就不再撑满盒子', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-unit-'))
    writeFileSync(join(dir, 'box.glb'), solidBoxGlb([0.15, 0.82, 0.35, 1]))
    const contain = await renderLayer(
      `<layer width="100" height="100" background="#000000" camera="parallel"><model src="box.glb" x="0" y="0" width="100" height="100" /></layer>`,
      { baseDir: dir },
    )
    const fitted = await renderLayer(
      `<layer width="100" height="100" background="#000000" camera="parallel"><model src="box.glb" unit="10" x="50" y="50" /></layer>`,
      { baseDir: dir },
    )
    const containCorner = await pixelAt(contain.png, 2, 2)
    const unitCorner = await pixelAt(fitted.png, 2, 2)
    const unitCenter = await pixelAt(fitted.png, 50, 50)
    expect(containCorner[1]).toBeGreaterThan(40)
    expect(unitCorner[1]).toBeLessThan(15)
    expect(unitCenter[1]).toBeGreaterThan(40)
  }, 30000)

  it('unit 的 x y 是模型原点，不是盒子中心', async () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#3ddc97' }))
    mesh.position.set(2, 0, 0)
    const node = h(
      'layer',
      { width: 160, height: 80, camera: 'parallel', background: '#000000' },
      h('model', { object: mesh, unit: 10, x: 40, y: 40 }),
    )
    const report = await checkLayer(node)
    const placed = report.elements.find((el) => el.tag === 'model')
    expect(placed).toMatchObject({ box: { x: 55, y: 35, width: 10, height: 10 } })
    const { png } = await renderLayer(node)
    const origin = await pixelAt(png, 40, 40)
    const body = await pixelAt(png, 60, 40)
    expect(origin[0]! + origin[1]! + origin[2]!).toBeLessThan(20)
    expect(body[1]).toBeGreaterThan(80)
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

  it('线框不填面，线段被更近的实体挡住', async () => {
    const wire = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#3ddc97', wireframe: true }),
    )
    const wireNode = h(
      'layer',
      { width: 120, height: 120, camera: 'parallel', background: '#000000' },
      h('model', { object: wire, unit: 40, x: 60, y: 60 }),
    )
    const wireFrame = await renderLayer(wireNode)
    const interior = await pixelAt(wireFrame.png, 48, 55)
    const edge = await pixelAt(wireFrame.png, 60, 40)
    expect(interior[0]! + interior[1]! + interior[2]!).toBeLessThan(30)
    expect(edge[1]).toBeGreaterThan(80)

    const solid = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#3d6bdc', wireframe: false }),
    )
    const solidFrame = await renderLayer(
      h('layer', { width: 120, height: 120, camera: 'parallel', background: '#000000' }, h('model', { object: solid, unit: 40, x: 60, y: 60 })),
    )
    const solidCenter = await pixelAt(solidFrame.png, 60, 60)
    expect(solidCenter[2]).toBeGreaterThan(solidCenter[0]! + 20)

    const line = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.4, 0, 0), new THREE.Vector3(1.4, 0, 0)]),
      new THREE.LineBasicMaterial({ color: '#ff3040' }),
    )
    const occluded = await renderLayer(
      h(
        'layer',
        { width: 120, height: 120, camera: 'parallel', background: '#000000' },
        h('model', { object: line, unit: 40, x: 60, y: 60 }),
        h('model', { object: solid, unit: 40, x: 60, y: 60 }),
      ),
    )
    const outside = await pixelAt(occluded.png, 12, 60)
    const covered = await pixelAt(occluded.png, 60, 60)
    expect(outside[0]).toBeGreaterThan(100)
    expect(covered[2]).toBeGreaterThan(covered[0]! + 20)

    const points = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1.4, 0, 0),
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1.4, 0, 0),
      ]),
      new THREE.PointsMaterial({ color: '#ff3040', size: 6 }),
    )
    const dotted = await renderLayer(
      h(
        'layer',
        { width: 120, height: 120, camera: 'parallel', background: '#000000' },
        h('model', { object: points, unit: 40, x: 60, y: 60 }),
        h('model', { object: solid, unit: 40, x: 60, y: 60 }),
      ),
    )
    const dot = await pixelAt(dotted.png, 4, 60)
    const hiddenDot = await pixelAt(dotted.png, 60, 60)
    expect(dot[0]).toBeGreaterThan(100)
    expect(hiddenDot[2]).toBeGreaterThan(hiddenDot[0]! + 20)
  }, 30000)
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
            <model object={found} unit={20} x={32} y={32} />
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

  it('读 three.js 的灯和透射', () => {
    const lights = lightsFromThree({
      children: [
        { isDirectionalLight: true, intensity: 2, color: { r: 1, g: 1, b: 1 }, position: { x: 0, y: 1, z: 3 } },
        { isAmbientLight: true, intensity: 0.2, color: { r: 1, g: 1, b: 1 } },
      ],
    })
    expect(lights.map((light) => light.type)).toEqual(['directional', 'ambient'])
    expect(lights[0]?.intensity).toBe(2)
    expect(lights[0]?.z).toBe(3)
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 4, 3),
      new THREE.MeshPhysicalMaterial({ transmission: 1, ior: 1.5, roughness: 0, metalness: 0 }),
    )
    const prims = fromThree(mesh)
    expect(prims[0]?.transmission).toBeCloseTo(1)
    expect(prims[0]?.ior).toBeCloseTo(1.5)
  })

  it('仓库外的文件运行时和类型检查都找不到 three', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-outside-three-'))
    const file = join(dir, 'scene.tsx')
    await writeFile(file, `import * as THREE from 'three'\nexport default <layer width="8" height="8">{String(THREE.REVISION)}</layer>\n`)
    expect(typecheckLayerFile(file).some((issue) => issue.message.includes("Cannot find module 'three'"))).toBe(true)
    await expect(loadLayerFile(file)).rejects.toThrow(/无法解析 three/)
  })
})
