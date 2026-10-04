import { describe, expect, it } from 'vitest'
import { h } from './h.js'
import { checkFvg } from './render.js'
import { applyPoseMatrix, poseMatrix, poseOffset, posePoint, project } from './perspective.js'
import type { LayoutNode } from './types.js'

function node(partial: Partial<LayoutNode> & Pick<LayoutNode, 'kind'>): LayoutNode {
  return {
    path: 'Layer',
    tag: 'Layer',
    x: 0,
    y: 0,
    width: 80,
    height: 40,
    ink: { x: 0, y: 0, width: 80, height: 40 },
    opacity: 1,
    rotate: 0,
    scale: 1,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    attr: {},
    style: {},
    computed: { color: '#111', fontFamily: 'sans', fontSize: 16, fontWeight: 400, opacity: 1 },
    text: '',
    children: [],
    ...partial,
  } as LayoutNode
}

describe('perspective', () => {
  it('z 越大，点离灭点越远', () => {
    expect(project(100, 100, 200, { x: 150, y: 100, z: 0 })).toEqual({ x: 150, y: 100 })
    expect(project(100, 100, 200, { x: 150, y: 100, z: 100 })).toEqual({ x: 200, y: 100 })
    expect(project(100, 100, 200, { x: 150, y: 100, z: 200 })).toBeNull()
  })

  it('只有 rotate 和 scale 时，中心与角点和二维一致', () => {
    const box = node({ kind: 'shape', x: 10, y: 20, width: 80, height: 40, rotate: 90, scale: 2 })
    const center = posePoint(box, 40, 20)
    expect(center.x).toBeCloseTo(50)
    expect(center.y).toBeCloseTo(40)
    expect(center.z).toBeCloseTo(0)
    const corner = posePoint(box, 0, 0)
    // 绕中心转 90° 再放大 2：局部 (-40,-20) → (40,-80)，加回中心 (50,40)
    expect(corner.x).toBeCloseTo(90)
    expect(corner.y).toBeCloseTo(-40)
  })

  it('poseMatrix 与 posePoint、poseOffset 一致', () => {
    const box = node({ kind: 'shape', x: 12, y: 8, width: 80, height: 40, rotate: 25, rotateX: 15, rotateY: -20, z: 30, scale: 1.5, origin: 'top-left' })
    const matrix = poseMatrix(box)
    for (const [u, v, z] of [
      [0, 0, 0],
      [80, 40, 0],
      [10, 20, 6],
    ] as const) {
      const posed = applyPoseMatrix(matrix, u, v, z)
      const offset = poseOffset(box, u, v, z)
      expect(posed.x).toBeCloseTo(offset.x)
      expect(posed.y).toBeCloseTo(offset.y)
      expect(posed.z).toBeCloseTo(offset.z)
      if (z === 0) {
        const point = posePoint(box, u, v)
        expect(posed.x).toBeCloseTo(point.x)
        expect(posed.y).toBeCloseTo(point.y)
        expect(posed.z).toBeCloseTo(point.z)
      }
    }
  })

  it('没有 perspective 时 rotateY 报 flatten-3d', async () => {
    const report = await checkFvg(
      h('Layer', { width: '100', height: '100' }, h('Rect', { cx: '50', cy: '50', width: '40', height: '40', rotateY: '20', fill: '#fff' })),
    )
    expect(report.issues.some((issue) => issue.code === 'flatten-3d')).toBe(true)
  })

  it('倾斜后落在画布里的大平面不报 overflow-canvas，并给出 quad', async () => {
    const report = await checkFvg(
      `<layer width="300" height="200" background="#111" perspective="400"><rect cx="150" cy="100" width="360" height="80" fill="#fff" z="-200" rotateX="25" /></layer>`,
    )
    const rect = report.elements.find((el) => el.tag === 'rect')
    expect(rect?.quad).toHaveLength(4)
    expect(rect!.box.left).toBeLessThan(0)
    expect(rect!.box.right).toBeGreaterThan(300)
    const node = {
      kind: 'shape',
      x: rect!.box.x,
      y: rect!.box.y,
      width: rect!.box.width,
      height: rect!.box.height,
      rotateX: 25,
      z: -200,
      scale: 1,
      rotate: 0,
    } as LayoutNode
    const expected = [
      [0, 0],
      [node.width, 0],
      [node.width, node.height],
      [0, node.height],
    ].map(([u, v]) => project(150, 100, 400, posePoint(node, u!, v!))!)
    expect(expected.every((p) => p && p.x >= -0.5 && p.x <= 300.5 && p.y >= -0.5 && p.y <= 200.5)).toBe(true)
    rect!.quad!.forEach((corner, i) => {
      expect(corner.x).toBeCloseTo(expected[i]!.x, 1)
      expect(corner.y).toBeCloseTo(expected[i]!.y, 1)
    })
    expect(rect!.ink.left).toBeGreaterThanOrEqual(-0.5)
    expect(rect!.ink.right).toBeLessThanOrEqual(300.5)
    expect(rect!.ink.top).toBeGreaterThanOrEqual(-0.5)
    expect(rect!.ink.bottom).toBeLessThanOrEqual(200.5)
    expect(report.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(false)
  })

  it('平面里的子元素也按投影报告 quad', async () => {
    const report = await checkFvg(
      `<layer width="300" height="200" perspective="400"><layer cx="150" cy="100" width="360" height="80" z="-200" rotateX="25"><rect x1="20" y1="10" x2="80" y2="40" fill="#fff" /></layer></layer>`,
    )
    const layer = report.elements.find((el) => el.tag === 'layer' && el.quad)
    const rect = report.elements.find((el) => el.tag === 'rect')
    expect(layer?.quad).toHaveLength(4)
    const host = {
      kind: 'layer',
      x: layer!.box.x,
      y: layer!.box.y,
      width: layer!.box.width,
      height: layer!.box.height,
      rotateX: 25,
      z: -200,
      scale: 1,
      rotate: 0,
    } as LayoutNode
    const corner = project(150, 100, 400, posePoint(host, 20, 10))!
    expect(rect?.quad?.[0]?.x).toBeCloseTo(corner.x, 1)
    expect(rect?.quad?.[0]?.y).toBeCloseTo(corner.y, 1)
    expect(report.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(false)
  })

  it('嵌套 layer 上的 perspective 把 quad 算到画布坐标', async () => {
    const report = await checkFvg(
      `<layer width="400" height="300"><layer cx="200" cy="160" width="200" height="120" perspective="300"><rect cx="100" cy="60" width="40" height="30" fill="#fff" rotateY="20" /></layer></layer>`,
    )
    const rect = report.elements.find((el) => el.tag === 'rect')
    const node = {
      kind: 'shape',
      x: 80,
      y: 45,
      width: 40,
      height: 30,
      rotateY: 20,
      scale: 1,
      rotate: 0,
    } as LayoutNode
    const local = project(100, 60, 300, posePoint(node, 0, 0))!
    expect(rect?.quad?.[0]?.x).toBeCloseTo(local.x + 100, 1)
    expect(rect?.quad?.[0]?.y).toBeCloseTo(local.y + 100, 1)
  })

  it('z 超过视距时报 behind-camera', async () => {
    const report = await checkFvg(
      h(
        'Layer',
        { width: '100', height: '100', perspective: '80' },
        h('Rect', { cx: '50', cy: '50', width: '20', height: '20', z: '80', fill: '#fff' }),
      ),
    )
    expect(report.issues.some((issue) => issue.code === 'behind-camera')).toBe(true)
  })
})
