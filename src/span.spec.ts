import { describe, expect, it } from 'vitest'
import { checkFvg } from './render.js'

const page = (body: string, attrs = 'width="800" height="240" safe="0"') =>
  `<layer ${attrs} background="#fff">${body}</layer>`

describe('行内标签进报告', () => {
  it('带 id 的 span 有自己的范围，没写 id 的不进元素表', async () => {
    const report = await checkFvg(page(`<p style="font-size:40px; white-space:nowrap">你好<span id="mark">世界</span>啊</p>`))
    const paragraph = report.elements.find((el) => el.tag === 'p')
    const span = report.elements.find((el) => el.id === 'mark')
    expect(paragraph).toBeTruthy()
    expect(span).toMatchObject({ tag: 'span', path: 'layer/p[0]/span[0]', inline: true })
    expect(span!.lines?.map((line) => line.text).join('')).toBe('世界')
    expect(span!.box.x).toBeGreaterThan(paragraph!.box.x)
    expect(span!.box.width).toBeLessThan(paragraph!.box.width)
    expect(span!.ink.width).toBeGreaterThan(0)

    const plain = await checkFvg(page(`<p style="font-size:40px"><span>世界</span></p>`))
    expect(plain.elements.some((el) => el.inline)).toBe(false)
  })

  it('最内层 id 拥有这段字，没写 id 的内层沿用外层', async () => {
    const nested = await checkFvg(
      page(`<p style="font-size:40px; white-space:nowrap">甲<strong id="b">乙<em id="c">丙</em></strong></p>`),
    )
    const strong = nested.elements.find((el) => el.id === 'b')
    const em = nested.elements.find((el) => el.id === 'c')
    expect(strong).toMatchObject({ tag: 'strong', path: 'layer/p[0]/strong[0]', inline: true })
    expect(em).toMatchObject({ tag: 'em', path: 'layer/p[0]/strong[0]/em[0]', inline: true })
    expect(strong!.lines?.map((line) => line.text).join('')).toBe('乙')
    expect(em!.lines?.map((line) => line.text).join('')).toBe('丙')

    const inherited = await checkFvg(page(`<p style="font-size:40px"><span id="a">甲<em>乙</em></span></p>`))
    const span = inherited.elements.find((el) => el.id === 'a')
    expect(span!.lines?.map((line) => line.text).join('')).toBe('甲乙')
    expect(inherited.elements.filter((el) => el.inline)).toHaveLength(1)
  })

  it('br 也占元素序号', async () => {
    const report = await checkFvg(page(`<p style="font-size:40px">甲<br/><span id="z">乙</span></p>`))
    expect(report.elements.find((el) => el.id === 'z')?.path).toBe('layer/p[0]/span[1]')
  })

  it('行内元素不重复报安全区、最小字号和文字重叠', async () => {
    const safe = await checkFvg(
      `<layer width="200" height="120" safe="40" background="#fff"><p style="font-size:32px; white-space:nowrap">靠边<span id="mark">的字</span></p></layer>`,
    )
    const outside = safe.issues.filter((issue) => issue.code === 'outside-safe')
    expect(outside.length).toBeGreaterThan(0)
    expect(outside.every((issue) => !issue.path.includes('/span'))).toBe(true)

    const tiny = await checkFvg(
      `<layer width="1080" height="200" safe="0" background="#fff"><p style="font-size:12px">小<span id="mark">字</span></p></layer>`,
    )
    const small = tiny.issues.filter((issue) => issue.code === 'min-font-size')
    expect(small.length).toBeGreaterThan(0)
    expect(small.every((issue) => !issue.path.includes('/span'))).toBe(true)

    const overlap = await checkFvg(
      page(`<p style="font-size:40px">甲<span id="a">乙</span></p><p style="font-size:40px">丙<span id="b">丁</span></p>`),
    )
    const hits = overlap.issues.filter((issue) => issue.code === 'text-overlap')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((issue) => !issue.path.includes('/span') && !issue.message.includes('/span'))).toBe(true)
  })

  it('父级旋转以后，行内范围跟着转', async () => {
    const body = `<p style="font-size:40px; white-space:nowrap">横<span id="mark">排文字</span></p>`
    const flat = await checkFvg(
      `<layer width="500" height="500" safe="0" background="#fff"><layer x="250" y="250" anchor="center">${body}</layer></layer>`,
    )
    const turned = await checkFvg(
      `<layer width="500" height="500" safe="0" background="#fff"><layer x="250" y="250" anchor="center" rotate="90">${body}</layer></layer>`,
    )
    const a = flat.elements.find((el) => el.id === 'mark')!
    const b = turned.elements.find((el) => el.id === 'mark')!
    expect(a.ink.width).toBeGreaterThan(a.ink.height)
    expect(Math.abs(b.ink.height - a.ink.width)).toBeLessThan(1)
    expect(Math.abs(b.ink.width - a.ink.height)).toBeLessThan(1)
  })
})
