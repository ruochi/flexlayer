import { createCanvas, loadImage } from '@napi-rs/canvas'
import { afterEach, describe, expect, it } from 'vitest'
import {
  filtersPad,
  getFilter,
  listFilters,
  registerFilter,
  unregisterFilter,
  type FilterPixels,
} from './filter.js'
import { checkFvg, renderFvg } from './render.js'

const EXTRA = ['wash', 'set-red', 'add-red', 'cast', 'cast-local']

afterEach(() => {
  for (const name of EXTRA) unregisterFilter(name)
})

async function pixels(png: Buffer) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height).data
  const at = (x: number, y: number) => {
    const i = (y * img.width + x) * 4
    return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!] as const
  }
  return { at }
}

function wash(pixelsIn: FilterPixels, amount: number) {
  const data = pixelsIn.data
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    data[i] = data[i]! + (255 - data[i]!) * amount
  }
}

describe('滤镜接口', () => {
  it('内置 grade 和 filter 登记在同一张表上', () => {
    const names = listFilters().map((item) => item.name)
    expect(names).toContain('grade')
    expect(names).toContain('filter')
    expect(getFilter('grade')).toMatchObject({ kind: 'pixel', includeBackdrop: true, maskAttr: 'grade-mask' })
    expect(getFilter('filter')).toMatchObject({ kind: 'canvas', layerOnly: false })
  })

  it('不能占用已有属性，也不能卸下内置滤镜', () => {
    expect(() =>
      registerFilter({
        name: 'blur',
        kind: 'pixel',
        parse: () => ({ spec: true }),
        apply() {},
      }),
    ).toThrow(/已经是属性/)
    expect(() => unregisterFilter('grade')).toThrow(/不能卸下/)
    expect(() => unregisterFilter('filter')).toThrow(/不能卸下/)
  })

  it('后登记的像素滤镜改子树颜色，并出现在报告里', async () => {
    registerFilter<number>({
      name: 'wash',
      kind: 'pixel',
      order: 1,
      maskAttr: 'wash-mask',
      hint: '写成 0 到 1',
      parse(value) {
        const n = Number(value)
        if (!Number.isFinite(n) || n < 0 || n > 1) return { error: '强度要在 0 到 1 之间' }
        return { spec: n }
      },
      apply: wash,
      pad: () => 6,
    })
    const { png, report } = await renderFvg(
      `<layer width="40" height="40" background="#ffffff"><layer width="40" height="40" grade="mono" wash="1"><rect x1="0" y1="0" x2="40" y2="40" fill="#224488" /></layer></layer>`,
    )
    const { at } = await pixels(png)
    const mid = at(20, 20)
    expect(mid[0]).toBeGreaterThan(mid[1] + 40)
    expect(Math.abs(mid[1] - mid[2])).toBeLessThan(4)
    const layer = report.elements.find((item) => item.filters?.some((entry) => entry.name === 'wash'))
    expect(layer?.filters?.map((entry) => entry.name)).toEqual(['grade', 'wash'])
    expect(layer?.grade).toMatchObject({ preset: 'mono' })
    expect(filtersPad([{ name: 'wash', kind: 'pixel', order: 1, seq: 0, spec: 1, includeBackdrop: false }])).toBe(6)
  })

  it('遮罩透明的一边保持原色', async () => {
    registerFilter<number>({
      name: 'wash',
      kind: 'pixel',
      maskAttr: 'wash-mask',
      parse(value) {
        const n = Number(value)
        if (!Number.isFinite(n) || n < 0 || n > 1) return { error: '强度要在 0 到 1 之间' }
        return { spec: n }
      },
      apply: wash,
    })
    const { png } = await renderFvg(
      `<layer width="40" height="20" background="#ffffff"><layer width="40" height="20" wash="1" wash-mask="linear-gradient(to right, #fff0 50%, #fff 50%)"><rect x1="0" y1="0" x2="40" y2="20" fill="#808080" /></layer></layer>`,
    )
    const { at } = await pixels(png)
    expect(Math.abs(at(4, 10)[0] - at(4, 10)[1])).toBeLessThan(4)
    expect(at(36, 10)[0]).toBeGreaterThan(at(36, 10)[1] + 40)
  })

  it('order 决定像素滤镜的先后', async () => {
    registerFilter({
      name: 'set-red',
      kind: 'pixel',
      order: 0,
      parse: () => ({ spec: true }),
      apply(pixelsIn) {
        const data = pixelsIn.data
        for (let i = 0; i < data.length; i += 4) if (data[i + 3]) data[i] = 20
      },
    })
    registerFilter({
      name: 'add-red',
      kind: 'pixel',
      order: 1,
      parse: () => ({ spec: true }),
      apply(pixelsIn) {
        const data = pixelsIn.data
        for (let i = 0; i < data.length; i += 4) if (data[i + 3]) data[i] = data[i]! + 30
      },
    })
    const scene = `<layer width="16" height="16" background="#ffffff"><layer width="16" height="16" set-red="on" add-red="on"><rect x1="0" y1="0" x2="16" y2="16" fill="#000000" /></layer></layer>`
    const first = await pixels((await renderFvg(scene)).png)
    expect(first.at(8, 8)[0]).toBe(50)

    unregisterFilter('set-red')
    unregisterFilter('add-red')
    registerFilter({
      name: 'add-red',
      kind: 'pixel',
      order: 0,
      parse: () => ({ spec: true }),
      apply(pixelsIn) {
        const data = pixelsIn.data
        for (let i = 0; i < data.length; i += 4) if (data[i + 3]) data[i] = data[i]! + 30
      },
    })
    registerFilter({
      name: 'set-red',
      kind: 'pixel',
      order: 1,
      parse: () => ({ spec: true }),
      apply(pixelsIn) {
        const data = pixelsIn.data
        for (let i = 0; i < data.length; i += 4) if (data[i + 3]) data[i] = 20
      },
    })
    const second = await pixels((await renderFvg(scene)).png)
    expect(second.at(8, 8)[0]).toBe(20)
  })

  it('根 layer 上 includeBackdrop 的滤镜连画布底色一起改', async () => {
    const blue = (pixelsIn: FilterPixels) => {
      const data = pixelsIn.data
      for (let i = 0; i < data.length; i += 4) if (data[i + 3]) data[i + 2] = 255
    }
    registerFilter({
      name: 'cast',
      kind: 'pixel',
      includeBackdrop: true,
      parse: () => ({ spec: true }),
      apply: blue,
    })
    registerFilter({
      name: 'cast-local',
      kind: 'pixel',
      parse: () => ({ spec: true }),
      apply: blue,
    })
    const onRoot = await pixels(
      (await renderFvg(`<layer width="20" height="20" background="#e04020" cast="on"></layer>`)).png,
    )
    expect(onRoot.at(10, 10)[2]).toBe(255)
    const local = await pixels(
      (await renderFvg(`<layer width="20" height="20" background="#e04020" cast-local="on"></layer>`)).png,
    )
    expect(local.at(10, 10)[2]).toBeLessThan(80)
  })

  it('写错、写错位置、写进 style 都报 invalid-attr', async () => {
    registerFilter<number>({
      name: 'wash',
      kind: 'pixel',
      maskAttr: 'wash-mask',
      hint: '写成 0 到 1',
      parse(value) {
        const n = Number(value)
        if (!Number.isFinite(n) || n < 0 || n > 1) return { error: '强度要在 0 到 1 之间' }
        return { spec: n }
      },
      apply: wash,
    })
    const bad = await checkFvg(`<layer width="40" height="40" wash="2" wash-mask="#fff"></layer>`)
    expect(bad.issues.some((issue) => issue.message.includes('wash') && issue.hint?.includes('0 到 1'))).toBe(true)
    const maskOnly = await checkFvg(`<layer width="40" height="40" wash-mask="#fff"></layer>`)
    expect(maskOnly.issues.some((issue) => issue.message.includes('wash-mask'))).toBe(true)
    const onRect = await checkFvg(
      `<layer width="40" height="40"><rect x1="0" y1="0" x2="10" y2="10" fill="#888" wash="1" /></layer>`,
    )
    expect(onRect.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('wash'))).toBe(true)
    const inStyle = await checkFvg(`<layer width="80" height="40"><p style="wash:1">甲</p></layer>`)
    expect(inStyle.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('wash'))).toBe(true)
  })
})
