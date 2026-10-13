import { beforeAll, describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { create } from './canvas.js'
import { emitLayer } from './emit.js'
import { initFontsForMeasure } from './fonts.js'
import { h } from './h.js'
import { parseLayer } from './parse.js'
import { checkLayer, renderLayer } from './render.js'

beforeAll(async () => {
  for (const dir of [join(homedir(), '.cache', 'flexlayer', 'fonts'), '/tmp/flexlayer-test']) {
    if (await initFontsForMeasure({ fontsCacheDir: dir })) break
  }
})

describe('data', () => {
  it('对象属性不变成字符串，data 导出再解析后仍是结构，脚本像素相同', async () => {
    const watched = h(
      'layer',
      { width: '40', height: '40', background: '#000000' },
      h('rect', {
        x: '4',
        y: '4',
        width: '16',
        height: '16',
        fill: '#ffffff',
        values: [1, 2],
        data: { values: [3, 5, 8], label: "it's" },
      }),
    )
    const watchedRect = watched.children[0]
    expect(typeof watchedRect !== 'string' && watchedRect.attrs.values).toBeUndefined()
    expect(typeof watchedRect !== 'string' && watchedRect.badAttrs).toEqual(['values'])
    const watchedReport = await checkLayer(watched)
    expect(watchedReport.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid-attr', hint: '结构化数据放进 data', path: 'layer/rect[0]' }),
    )

    const root = h(
      'layer',
      { width: '40', height: '40', background: '#000000' },
      h('rect', {
        x: '4',
        y: '4',
        width: '16',
        height: '16',
        fill: '#ffffff',
        data: { values: [3, 5, 8], label: "it's" },
      }),
      h('canvas', { id: 'bar', x: '4', y: '4', width: '16', height: '16' }),
      h(
        'script',
        null,
        `const canvas = document.querySelector('#bar')
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ff0000'
        ctx.fillRect(0, 0, 3, 3)`,
      ),
    )
    const { png } = await renderLayer(root)

    const emitted = emitLayer(root)
    expect(emitted.issues).toEqual([])
    expect(emitted.source).toContain(`data='{"values":[3,5,8],"label":"it&apos;s"}'`)
    expect(emitted.source).not.toContain('[object Object]')
    const parsed = parseLayer(emitted.source)[0]
    const parsedRect = parsed?.children.find((child) => typeof child !== 'string' && child.tag === 'rect')
    expect(typeof parsedRect !== 'string' && parsedRect && parsedRect.data).toEqual({ values: [3, 5, 8], label: "it's" })

    const again = await renderLayer(emitted.source)
    expect(again.png.equals(png)).toBe(true)
    expect(again.report.issues.filter((issue) => issue.level === 'error')).toEqual([])
  })

  it('非法 JSON 是 error，Map 和循环引用不写回', async () => {
    const bad = await checkLayer(`<layer width="40" height="40" background="#000"><rect width="10" height="10" x="0" y="0" fill="#fff" data="{oops}" /></layer>`)
    expect(bad.issues).toContainEqual(expect.objectContaining({ code: 'invalid-attr', level: 'error', message: 'data 不是合法的 JSON' }))

    const mapped = emitLayer(h('layer', { width: '10', height: '10', data: new Map([['a', 1]]) }))
    expect(mapped.issues.map((issue) => issue.code)).toContain('emit-data')
    expect(mapped.source).not.toContain('data=')

    const box: { self?: unknown } = { self: undefined }
    box.self = box
    const cycled = emitLayer(h('layer', { width: '10', height: '10', data: box }))
    expect(cycled.issues.map((issue) => issue.code)).toContain('emit-data')
    expect(cycled.source).not.toContain('data=')
  })

  it('canvas.create 留下 data', () => {
    const node = h(
      'layer',
      { width: '40', height: '20', data: { n: 1 } },
      h('rect', { width: '10', height: '10', fill: '#fff' }),
    )
    const created = create(node)
    expect(created).toBe(node)
    expect(created.data).toEqual({ n: 1 })
  })
})
