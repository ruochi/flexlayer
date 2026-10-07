import { describe, expect, it } from 'vitest'
import { canvas } from './canvas.js'
import { h } from './h.js'
import { poseOffset } from './perspective.js'
import { parseOrigin } from './style.js'
import { checkFvg } from './render.js'
import type { LayoutNode } from './types.js'

const page = (body: string, attrs = 'width="320" height="240" safe="0"') =>
  `<layer ${attrs} background="#111">${body}</layer>`

describe('分轴 scale', () => {
  it('镜像不改变外接矩形，压扁会变窄', async () => {
    const plain = await checkFvg(page(`<rect x="40" y="40" width="80" height="50" fill="#fff" />`))
    const mirror = await checkFvg(page(`<rect x="40" y="40" width="80" height="50" fill="#fff" scale="-1 1" />`))
    const flat = await checkFvg(page(`<rect x="40" y="40" width="80" height="50" fill="#fff" scale="0.5 1" />`))
    const a = plain.elements.find((el) => el.tag === 'rect')!
    const b = mirror.elements.find((el) => el.tag === 'rect')!
    const c = flat.elements.find((el) => el.tag === 'rect')!
    expect(b.ink.left).toBeCloseTo(a.ink.left, 1)
    expect(b.ink.right).toBeCloseTo(a.ink.right, 1)
    expect(b.ink.top).toBeCloseTo(a.ink.top, 1)
    expect(b.ink.bottom).toBeCloseTo(a.ink.bottom, 1)
    expect(c.ink.width).toBeCloseTo(a.ink.width / 2, 1)
    expect(c.ink.height).toBeCloseTo(a.ink.height, 1)
  })

  it('文字 style 里的分轴缩放同样压扁', async () => {
    const plain = await checkFvg(page(`<p style="font-size:40px; white-space:nowrap">横排</p>`))
    const squashed = await checkFvg(page(`<p style="font-size:40px; white-space:nowrap; scale:0.5 1">横排</p>`))
    const a = plain.elements.find((el) => el.tag === 'p')!
    const b = squashed.elements.find((el) => el.tag === 'p')!
    expect(b.ink.width).toBeCloseTo(a.ink.width / 2, 0)
    expect(b.ink.height).toBeCloseTo(a.ink.height, 0)
  })

  it('透视平面水平镜像后左右角对调，外接范围不变', async () => {
    const attrs = 'width="300" height="220" safe="0" perspective="500"'
    const plain = await checkFvg(page(`<rect x="80" y="70" width="100" height="60" fill="#fff" z="40" />`, attrs))
    const mirror = await checkFvg(page(`<rect x="80" y="70" width="100" height="60" fill="#fff" z="40" scale="-1 1" />`, attrs))
    const a = plain.elements.find((el) => el.tag === 'rect')!
    const b = mirror.elements.find((el) => el.tag === 'rect')!
    expect(b.quad).toHaveLength(4)
    expect(b.ink.left).toBeCloseTo(a.ink.left, 1)
    expect(b.ink.right).toBeCloseTo(a.ink.right, 1)
    expect(b.ink.top).toBeCloseTo(a.ink.top, 1)
    expect(b.ink.bottom).toBeCloseTo(a.ink.bottom, 1)
    expect(b.quad![0]!.x).toBeCloseTo(a.quad![1]!.x, 1)
    expect(b.quad![1]!.x).toBeCloseTo(a.quad![0]!.x, 1)
    expect(b.quad![0]!.y).toBeCloseTo(a.quad![1]!.y, 1)
  })

  it('三维里只有一个 scale 时 z 用这个数，分轴时用几何平均', () => {
    const uniform = { x: 0, y: 0, width: 10, height: 10, rotate: 0, scaleX: -2, scaleY: -2, z: 0 } as LayoutNode
    expect(poseOffset(uniform, 0, 0, 10).z).toBeCloseTo(-20)
    const split = { x: 0, y: 0, width: 10, height: 10, rotate: 0, scaleX: 4, scaleY: 1, z: 0, origin: parseOrigin('top-left') } as LayoutNode
    expect(poseOffset(split, 2, 3, 10)).toMatchObject({ x: 8, y: 3 })
    expect(poseOffset(split, 0, 0, 10).z).toBeCloseTo(20)
  })

  it('按比例放缩时乘进已有的 scale，两个数不会被收成一个', () => {
    const mirrored = canvas.create(
      h('layer', { width: '90', scale: '-1 1' }, h('rect', { x: '0', y: '0', width: '180', height: '60', fill: '#fff' })),
    )
    expect(mirrored.attrs.scale).toBe('-0.5 0.5')
    expect(mirrored.rotatedBox.width).toBeCloseTo(45)
    expect(mirrored.rotatedBox.height).toBeCloseTo(15)
    expect(mirrored.rotatedBox.left).toBeCloseTo(mirrored.left - 45)

    const single = canvas.create(
      h('layer', { width: '90', scale: '-1' }, h('rect', { x: '0', y: '0', width: '180', height: '60', fill: '#fff' })),
    )
    expect(single.attrs.scale).toBe('-0.5')
    expect(single.attrs.scale?.includes(' ')).toBe(false)
  })
})
