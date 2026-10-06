import { describe, expect, it } from 'vitest'
import { checkFvg } from './render.js'

async function issues(source: string) {
  const report = await checkFvg(source)
  return report
}

describe('属性归属', () => {
  it('flex 子元素写 cx 报 warn 并带 hint', async () => {
    const report = await issues(`<layer width="400" height="200"><div style="display:flex"><p cx="10" cy="10">甲</p></div></layer>`)
    const hit = report.issues.find((issue) => issue.code === 'invalid-attr')
    expect(hit?.level).toBe('warn')
    expect(hit?.hint).toBeTruthy()
  })

  it('layer 子元素写 flex-grow 报 warn', async () => {
    const report = await issues(`<layer width="400" height="200"><p cx="40" cy="40" style="flex-grow:1">甲</p></layer>`)
    expect(report.issues.some((issue) => issue.code === 'invalid-attr' && issue.level === 'warn' && issue.hint)).toBe(true)
  })

  it('rect 的两点写法报 invalid-attr', async () => {
    const report = await issues(`<layer width="80" height="80"><rect x1="8" y1="8" x2="60" y2="40" rx="6" fill="#fff" /></layer>`)
    const hit = report.issues.find((issue) => issue.code === 'invalid-attr' && issue.message.includes('width'))
    expect(hit?.hint).toContain('x、y、width、height')
  })

  it('ellipse 的两点写法报 invalid-attr', async () => {
    const report = await issues(`<layer width="80" height="80"><ellipse x1="8" y1="8" x2="60" y2="40" rx="6" fill="#fff" /></layer>`)
    const hit = report.issues.find((issue) => issue.code === 'invalid-attr')
    expect(hit?.message).toContain('cx、cy、rx、ry')
  })

  it('线条写 cx 报 warn', async () => {
    const report = await issues(`<layer width="400" height="200"><line cx="10" x1="0" y1="0" x2="40" y2="0" /></layer>`)
    expect(report.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('线条'))).toBe(true)
  })

  it('Row 报 unknown-tag，并提示改成 div', async () => {
    const report = await issues(`<layer width="400" height="200"><Row><p>甲</p></Row></layer>`)
    const hit = report.issues.find((issue) => issue.code === 'unknown-tag')
    expect(hit?.hint).toContain('display:flex')
  })

  it('HTML 上的 width 属性报 warn', async () => {
    const report = await issues(`<layer width="400" height="200"><p width="80">甲</p></layer>`)
    const hit = report.issues.find((issue) => issue.code === 'invalid-attr')
    expect(hit?.message).toContain('width')
    expect(hit?.hint).toContain('style')
  })

  it('layer 写 background 报 warn', async () => {
    const report = await issues(`<layer width="400" height="200" background="#111"><layer width="40" height="40" background="#fff" /></layer>`)
    const hit = report.issues.find((issue) => issue.message.includes('background'))
    expect(hit?.level).toBe('warn')
    expect(hit?.hint).toMatch(/rect|draw/)
    expect(report.issues.some((issue) => issue.path === 'layer' && issue.message.includes('background'))).toBe(false)
  })

  it('layer 写 style 报 warn', async () => {
    const report = await issues(`<layer width="400" height="200"><layer cx="20" cy="20" style="background:#fff"></layer></layer>`)
    expect(report.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('style'))).toBe(true)
  })

  it('非 layer 写 overlay 报 warn', async () => {
    const report = await issues(
      `<layer width="200" height="100"><rect x="20" y="20" width="40" height="40" fill="#fff" overlay="#00000066" /></layer>`,
    )
    const hit = report.issues.find((issue) => issue.message.includes('overlay'))
    expect(hit?.level).toBe('warn')
    expect(hit?.hint).toContain('layer')
  })

  it('grade 只写在 layer 上：Rect 属性和 img 的 style 都报 warn', async () => {
    const report = await issues(
      `<layer width="200" height="100"><rect x="20" y="20" width="40" height="40" fill="#fff" grade="mono" /><img src="x.png" style="width:20px; height:20px; grade:lomo" /></layer>`,
    )
    const hits = report.issues.filter((issue) => issue.code === 'invalid-attr' && issue.message.includes('grade'))
    expect(hits).toHaveLength(2)
    expect(hits.every((issue) => issue.hint?.includes('layer'))).toBe(true)
  })

  it('grade 写错报 invalid-attr 并给出写法', async () => {
    const report = await issues(`<layer width="200" height="100" grade="contrast 5"><layer grade-mask="#fff" /></layer>`)
    expect(report.issues.some((issue) => issue.message.includes('grade') && issue.hint?.includes('lomo'))).toBe(true)
    expect(report.issues.some((issue) => issue.message.includes('grade-mask'))).toBe(true)
  })

  it('HTML style 写 overlay 报 warn', async () => {
    const report = await issues(
      `<layer width="200" height="100"><layer x="20" y="20"><p style="overlay:#00000066; font-size:24px">x</p></layer></layer>`,
    )
    expect(report.issues.some((issue) => issue.message.includes('overlay') && issue.hint?.includes('layer'))).toBe(true)
  })

  it('rect 上的 cx、cy 报 warn 并忽略', async () => {
    const report = await issues(`<layer width="400" height="200"><rect cx="10" cy="20" anchor="top-left" width="30" height="40" /></layer>`)
    const hit = report.issues.find((issue) => issue.code === 'invalid-attr' && issue.message.includes('cx、cy'))
    expect(hit?.hint).toContain('x="10"')
    expect(hit?.hint).toContain('y="20"')
    const rect = report.elements.find((element) => element.tag === 'rect')
    expect(rect?.box.left).toBeCloseTo(0, 3)
    expect(rect?.box.top).toBeCloseTo(0, 3)
  })

  it('rect 的 x、y 是左上角', async () => {
    const report = await issues(`<layer width="400" height="200"><rect x="15" y="25" width="30" height="40" /></layer>`)
    const rect = report.elements.find((element) => element.tag === 'rect')
    expect(rect?.box.left).toBeCloseTo(15, 3)
    expect(rect?.box.top).toBeCloseTo(25, 3)
    expect(report.issues.filter((issue) => issue.code === 'non-canonical')).toEqual([])
  })

  it('不认识的属性不报错', async () => {
    const report = await issues(`<layer width="200" height="200"><rect x="20" y="20" width="10" height="10" data-total="33" /></layer>`)
    expect(report.issues).toEqual([])
  })

  it('拼写接近已知属性时报 warn，并指出正确名字', async () => {
    const report = await issues(`<layer width="80" height="40"><rect x="0" y="0" widht="20" height="10" fil="#ff0000" /></layer>`)
    const hits = report.issues.filter((issue) => issue.message.includes('不认识的属性'))
    expect(hits.map((issue) => issue.hint)).toEqual(expect.arrayContaining(['是不是想写 width？', '是不是想写 fill？']))
    expect(hits.every((issue) => issue.level === 'warn' && issue.code === 'invalid-attr')).toBe(true)
    const root = await issues(`<layer widht="80" height="40" background="#000"></layer>`)
    expect(root.issues.some((issue) => issue.path === 'layer' && issue.hint === '是不是想写 width？')).toBe(true)
  })

  it('大写标签照常渲染，并提示改成小写', async () => {
    const report = await issues(`<Layer width="80" height="80"><Circle cx="40" cy="40" r="10" fill="#fff" /></Layer>`)
    expect(report.elements.some((element) => element.tag === 'circle')).toBe(true)
    const notes = report.issues.filter((issue) => issue.code === 'non-canonical' && issue.message.includes('应写成'))
    expect(notes.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('<Layer>'), expect.stringContaining('<Circle>')]),
    )
  })

  it('HTML 上的 cx、cy 只警告一次', async () => {
    const report = await issues(`<layer width="400" height="200"><p cx="40" cy="40">甲</p></layer>`)
    const hits = report.issues.filter((issue) => issue.code === 'invalid-attr')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.message).toContain('定位')
  })

  it('HTML 上的 fill 仍报图形属性', async () => {
    const report = await issues(`<layer width="400" height="200"><p cx="40" fill="#fff">甲</p></layer>`)
    const hits = report.issues.filter((issue) => issue.code === 'invalid-attr')
    expect(hits.some((issue) => issue.message.includes('定位'))).toBe(true)
    expect(hits.some((issue) => issue.message.includes('fill'))).toBe(true)
    expect(hits.some((issue) => issue.message.includes('cx'))).toBe(false)
  })

  it('带 draw 的 layer 写 anchor 不报形状不用 anchor', async () => {
    const report = await issues(
      `<layer width="80" height="80"><layer x="10" y="10" anchor="center"><draw>ctx.fillStyle = "#fff"</draw></layer></layer>`,
    )
    expect(report.issues.some((issue) => issue.message.includes('形状不用 anchor'))).toBe(false)
    const shape = await issues(`<layer width="80" height="80"><rect x="10" y="10" width="20" height="20" anchor="center" /></layer>`)
    expect(shape.issues.some((issue) => issue.message.includes('形状不用 anchor'))).toBe(true)
  })

  it('文字盒子里的块级标签报 invalid-child', async () => {
    const report = await issues(`<layer width="400" height="200"><div cx="40" cy="40"><h3>标题</h3></div></layer>`)
    const hit = report.issues.find((issue) => issue.code === 'invalid-child')
    expect(hit?.hint).toContain('display:flex')
  })
})
