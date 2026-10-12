import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canvas, h } from './index.js'
import { checkLayer } from './render.js'
import { fitTitle, scene } from './scene.js'

describe('fitTitle', () => {
  it('中间的字对准尖，挡住的比例停在 cover', () => {
    const skyline = new Array<number>(100).fill(80)
    for (let x = 40; x < 60; x++) skyline[x] = 40
    const line = {
      y: 0,
      height: 20,
      baseline: 16,
      chars: [
        { x: 0, width: 20 },
        { x: 20, width: 20 },
        { x: 40, width: 20 },
      ],
    }
    const fit = fitTitle({ width: 100, height: 100, skyline, spire: { x: 50, y: 40 }, sky: { height: 30 } }, line, { cover: 0.2 })
    expect(fit.x + 30).toBeCloseTo(50, 0)
    expect(fit.covered[1]).toBeGreaterThanOrEqual(0.2)
    expect(fit.covered[1]).toBeLessThan(0.45)
    expect(fit.covered[0]).toBe(0)
  })
})

describe('scene', () => {
  it('读 scene.json，原图变了就抛错', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-scene-'))
    const src = join(dir, 'photo.png')
    writeFileSync(src, 'photo')
    const skyline = new Array<number>(8).fill(8)
    writeFileSync(join(dir, 'photo.scene.json'), JSON.stringify({
      src: 'photo.png',
      srcHash: createHash('sha256').update('photo').digest('hex'),
      width: 8,
      height: 8,
      flat: false,
      sky: { y: 0, height: 2 },
      subject: { x: 2, y: 2, width: 4, height: 4 },
      spire: { x: 4, y: 2 },
      roofY: 3,
      skyline,
    }))
    const found = scene(src)
    expect(found.spire).toEqual({ x: 4, y: 2 })
    expect(found.skyline).toHaveLength(8)
    writeFileSync(src, 'changed')
    expect(() => scene(src)).toThrow(/重新运行/)
  })

  it('没有分层缓存时说明要跑的命令', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-scene-miss-'))
    expect(() => scene(join(dir, 'photo.png'))).toThrow(/flexlayer-select layers photo.png/)
  })
})

describe('derive plate', () => {
  it('净背景缺缓存时提示 layers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-plate-'))
    const report = await checkLayer('<layer width="8" height="8"><mask><img src="photo.png" derive="plate" style="width:8px; height:8px" /></mask></layer>', { baseDir: dir })
    const issue = report.issues.find((item) => item.code === 'missing-mask')
    expect(issue?.hint).toContain('flexlayer-select layers')
  })
})

describe('标题量完再夹进去', () => {
  it('fit 用的是这一层的字', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-scene-fit-'))
    const src = join(dir, 'photo.png')
    writeFileSync(src, 'photo')
    const skyline = new Array<number>(200).fill(200)
    for (let x = 80; x < 120; x++) skyline[x] = 80
    writeFileSync(join(dir, 'photo.scene.json'), JSON.stringify({
      srcHash: createHash('sha256').update('photo').digest('hex'),
      width: 200,
      height: 200,
      flat: false,
      sky: { y: 0, height: 40 },
      spire: { x: 100, y: 80 },
      skyline,
    }))
    const title = canvas.create(h('layer', { x: '0', y: '0' }, h('h1', { style: 'font-size:40px; white-space:nowrap' }, '安')))
    const fit = scene(src).fit(title, { cover: 0.2 })
    expect(fit.covered[0]).toBeGreaterThanOrEqual(0.2)
    expect(fit.y).toBeGreaterThan(0)
  })
})
