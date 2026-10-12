import { describe, expect, it } from 'vitest'
import { checkLayer } from './render.js'

const page = (body: string) => `<layer width="40" height="40" background="#000">${body}</layer>`

describe('expect', () => {
  it('子树上的出血降成 info，并带上原因', async () => {
    const report = await checkLayer(
      page(`<layer expect="overflow-canvas: 出血图"><circle cx="80" cy="20" r="4" fill="#fff" /></layer>`),
    )
    const overflow = report.issues.filter((issue) => issue.code === 'overflow-canvas')
    expect(overflow.length).toBeGreaterThan(0)
    expect(overflow.every((issue) => issue.level === 'info' && issue.expected === '出血图')).toBe(true)
    expect(report.issues.some((issue) => issue.code === 'unused-expect')).toBe(false)
    expect(report.issues.some((issue) => issue.level === 'error')).toBe(false)
  })

  it('根上的 expect 覆盖整棵子树', async () => {
    const report = await checkLayer(
      `<layer width="1080" height="1080" safe="0" expect="min-font-size: 海报注释"><p style="font-size:12px">甲</p><p style="font-size:14px">乙</p></layer>`,
    )
    const hits = report.issues.filter((issue) => issue.code === 'min-font-size')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.level).toBe('info')
    expect(hits[0]?.expected).toBe('海报注释')
    expect(report.issues.some((issue) => issue.code === 'unused-expect')).toBe(false)
  })

  it('没出现的问题码报 unused-expect，不认识的码报 invalid-attr', async () => {
    const quiet = await checkLayer(page(`<rect x="4" y="4" width="8" height="8" fill="#fff" expect="overflow-canvas; text-overlap" />`))
    const unused = quiet.issues.filter((issue) => issue.code === 'unused-expect')
    expect(unused.map((issue) => issue.expect)).toEqual([{ code: 'overflow-canvas' }, { code: 'text-overlap' }])
    expect(unused.every((issue) => issue.level === 'warn')).toBe(true)

    const unknown = await checkLayer(page(`<rect x="4" y="4" width="8" height="8" fill="#fff" expect="not-a-code" />`))
    expect(unknown.issues).toContainEqual(expect.objectContaining({ code: 'invalid-attr', message: 'expect 不认识 not-a-code' }))
    expect(unknown.issues.some((issue) => issue.code === 'unused-expect')).toBe(false)
  })
})
