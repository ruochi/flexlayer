import { describe, expect, it } from 'vitest'
import { checkFvg } from './render.js'
import type { ElementReport } from './types.js'

function rectInk(elements: ElementReport[]): ElementReport {
  const el = elements.find((item) => item.tag === 'rect')
  expect(el).toBeTruthy()
  return el!
}

describe('origin 任意一点', () => {
  it('像素支点缩放后这一点不动', async () => {
    const report = await checkFvg(
      `<layer width="400" height="300" safe="0"><rect x="100" y="80" width="40" height="20" fill="#fff" scale="2" origin="10 5" /></layer>`,
    )
    const ink = rectInk(report.elements).ink
    expect(ink.left).toBeCloseTo(90)
    expect(ink.top).toBeCloseTo(75)
    expect(ink.width).toBeCloseTo(80)
    expect(ink.height).toBeCloseTo(40)
  })

  it('0 0 与 top-left 相同，百分比与九宫格相同', async () => {
    const px = await checkFvg(
      `<layer width="200" height="120" safe="0"><rect x="20" y="10" width="80" height="40" fill="#fff" rotate="90" origin="0 0" /></layer>`,
    )
    const named = await checkFvg(
      `<layer width="200" height="120" safe="0"><rect x="20" y="10" width="80" height="40" fill="#fff" rotate="90" origin="top-left" /></layer>`,
    )
    const percent = await checkFvg(
      `<layer width="200" height="120" safe="0"><rect x="20" y="10" width="80" height="40" fill="#fff" rotate="90" origin="0% 0%" /></layer>`,
    )
    expect(rectInk(px.elements).ink).toEqual(rectInk(named.elements).ink)
    expect(rectInk(percent.elements).ink).toEqual(rectInk(named.elements).ink)
  })

  it('镜头推近和把目标点挪到九宫格上的两层 layer 落在同一处', async () => {
    const direct = await checkFvg(
      `<layer width="400" height="300" safe="0"><layer width="200" height="100" scale="2" origin="40 30"><rect x="10" y="10" width="20" height="20" fill="#fff" /></layer></layer>`,
    )
    const nested = await checkFvg(
      `<layer width="400" height="300" safe="0"><layer x="40" y="30" scale="2" origin="top-left"><layer x="-40" y="-30" width="200" height="100"><rect x="10" y="10" width="20" height="20" fill="#fff" /></layer></layer></layer>`,
    )
    const percent = await checkFvg(
      `<layer width="400" height="300" safe="0"><layer width="200" height="100" scale="2" origin="20% 30%"><rect x="10" y="10" width="20" height="20" fill="#fff" /></layer></layer>`,
    )
    expect(rectInk(direct.elements).ink).toEqual(rectInk(nested.elements).ink)
    expect(rectInk(percent.elements).ink).toEqual(rectInk(direct.elements).ink)
  })

  it('关键字可以写在数的前面', async () => {
    const swapped = await checkFvg(
      `<layer width="300" height="200" safe="0"><rect x="0" y="0" width="100" height="40" fill="#fff" scale="2" origin="top 10" /></layer>`,
    )
    const ordered = await checkFvg(
      `<layer width="300" height="200" safe="0"><rect x="0" y="0" width="100" height="40" fill="#fff" scale="2" origin="10 0" /></layer>`,
    )
    expect(rectInk(swapped.elements).ink).toEqual(rectInk(ordered.elements).ink)
  })

  it('无法解析时退回中心并警告', async () => {
    const bad = await checkFvg(
      `<layer width="200" height="100" safe="0"><rect x="10" y="10" width="40" height="20" fill="#fff" scale="2" origin="nope" /></layer>`,
    )
    const center = await checkFvg(
      `<layer width="200" height="100" safe="0"><rect x="10" y="10" width="40" height="20" fill="#fff" scale="2" origin="center" /></layer>`,
    )
    expect(rectInk(bad.elements).ink).toEqual(rectInk(center.elements).ink)
    const hit = bad.issues.find((issue) => issue.code === 'invalid-attr' && issue.message.includes('origin'))
    expect(hit?.level).toBe('warn')
    expect(hit?.hint).toContain('120 80')
  })
})
