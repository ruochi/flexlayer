import { existsSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { GlobalFonts } from '@napi-rs/canvas'
import { getFontsCacheDir, initFontsForMeasure } from './fonts.js'
import { layoutSource } from './layout.js'

const FONT_DIRS = [join(homedir(), '.cache', 'flexlayer', 'fonts'), '/tmp/flexlayer-test']

beforeAll(async () => {
  for (const dir of FONT_DIRS) {
    if (await initFontsForMeasure({ fontsCacheDir: dir })) break
  }
})

describe('layoutSource', () => {
  it('layer anchor top-left', async () => {
    const doc = await layoutSource(
      `<layer width="400" height="300" background="#fff"><layer x="10" y="10"><h1>A</h1></layer></layer>`,
      process.cwd(),
    )
    const layer = doc.root.children[0]
    expect(layer?.x).toBe(10)
    expect(layer?.y).toBe(10)
  })

  it('线条边界盒', async () => {
    const doc = await layoutSource(
      `<layer width="200" height="200"><line x1="10" y1="10" x2="100" y2="50" /></layer>`,
      process.cwd(),
    )
    const line = doc.root.children[0]
    expect(line?.kind).toBe('line')
    expect(line!.width).toBeGreaterThan(0)
  })

  it('线条使用 layer 的局部坐标，不被重新居中', async () => {
    const doc = await layoutSource(
      `<layer width="400" height="400"><layer x="50" y="50" width="300" height="300"><line x1="10" y1="10" x2="50" y2="10" stroke-width="4" /><polygon points="100,100 140,100 100,160" stroke-width="2" /></layer></layer>`,
      process.cwd(),
    )
    const layer = doc.root.children[0]
    expect(layer?.kind).toBe('layer')
    const [line, polygon] = (layer as { children: Array<{ x: number; y: number; width: number; height: number; ink: { y: number; height: number } }> }).children
    // 盒子是纯几何范围，描边只进 ink
    expect(line?.x).toBe(10)
    expect(line?.y).toBe(10)
    expect(line?.width).toBe(40)
    expect(line?.height).toBe(0)
    expect(line?.ink.y).toBe(-2)
    expect(line?.ink.height).toBe(4)
    expect(polygon?.x).toBe(100)
    expect(polygon?.y).toBe(100)
  })

  it('rect 没写 ry 时圆角跟 rx', async () => {
    const doc = await layoutSource(
      `<layer width="80" height="80"><rect x="10" y="10" width="40" height="20" rx="6" fill="#fff" /></layer>`,
      process.cwd(),
    )
    const rect = doc.root.children[0] as { rx?: number; ry?: number }
    expect(rect.rx).toBe(6)
    expect(rect.ry).toBe(6)
  })

  it('rect 两点写法报 invalid-attr，并不再参与几何', async () => {
    const doc = await layoutSource(
      `<layer width="400" height="400"><rect x1="80" y1="60" x2="20" y2="10" fill="#fff" /></layer>`,
      process.cwd(),
    )
    const rect = doc.root.children[0] as { x: number; y: number; width: number; height: number }
    expect(rect).toMatchObject({ x: 0, y: 0, width: 0, height: 0 })
    expect(doc.issues.some((issue) => issue.code === 'invalid-attr' && issue.hint?.includes('x、y、width、height'))).toBe(true)
  })

  it('div 里直接放 p 时从上到下靠起点排', async () => {
    const doc = await layoutSource(
      `<layer width="800" height="400"><div><p style="font-size:40px">甲</p><p style="font-size:40px">甲乙丙丁</p></div></layer>`,
      process.cwd(),
    )
    expect(doc.issues.filter((issue) => issue.code === 'invalid-child')).toEqual([])
    const column = doc.root.children[0] as {
      kind: string
      direction: string
      children: Array<{ tag: string; x: number; y: number; width: number; textLayout: { contentWidth: number; lines: Array<{ segments: Array<{ text: string }> }> } }>
    }
    expect(column.kind).toBe('flex')
    expect(column.direction).toBe('column')
    expect(column.children.map((child) => child.tag)).toEqual(['p', 'p'])
    expect(column.children.map((child) => child.x)).toEqual([0, 0])
    expect(column.children[0]!.width).toBeCloseTo(column.children[1]!.width, 0)
    expect(column.children[0]!.width).toBeGreaterThan(column.children[0]!.textLayout.contentWidth + 5)
    expect(column.children[1]!.y).toBeGreaterThan(column.children[0]!.y)
    const textOf = (child: (typeof column.children)[number]) => child.textLayout.lines.map((line) => line.segments.map((seg) => seg.text).join('')).join('')
    expect(column.children.map(textOf)).toEqual(['甲', '甲乙丙丁'])
  })

  it('div 里夹在段落旁的文字仍画出来，并用 div 的字号', async () => {
    const doc = await layoutSource(
      `<layer width="800" height="400"><div style="font-size:32px">前言<p>正文</p></div></layer>`,
      process.cwd(),
    )
    expect(doc.issues.filter((issue) => issue.code === 'invalid-child')).toEqual([])
    const column = doc.root.children[0] as {
      children: Array<{ textLayout: { fontSize: number; lines: Array<{ segments: Array<{ text: string }> }> } }>
    }
    const textOf = (child: (typeof column.children)[number]) =>
      child.textLayout.lines.map((line) => line.segments.map((seg) => seg.text).join('')).join('')
    expect(column.children.map(textOf)).toEqual(['前言', '正文'])
    expect(column.children.map((child) => child.textLayout.fontSize)).toEqual([32, 32])
  })

  it('div 上的字号和颜色传给 p，标题仍用自己的字号', async () => {
    const doc = await layoutSource(
      `<layer width="800" height="400" color="#111111"><div style="font-size:22px; color:#abcdef; font-family:Kai"><p>甲</p><h3>标题</h3></div></layer>`,
      process.cwd(),
    )
    const column = doc.root.children[0] as {
      children: Array<{ tag: string; textLayout: { fontSize: number; lines: Array<{ segments: Array<{ style: { color: string; fontFamily: string } }> }> } }>
    }
    const [paragraph, heading] = column.children
    expect(paragraph?.tag).toBe('p')
    expect(paragraph?.textLayout.fontSize).toBe(22)
    expect(paragraph?.textLayout.lines[0]?.segments[0]?.style.color).toBe('#abcdef')
    expect(paragraph?.textLayout.lines[0]?.segments[0]?.style.fontFamily).toBe('Kai')
    expect(heading?.tag).toBe('h3')
    expect(heading?.textLayout.fontSize).toBe(48)
    expect(heading?.textLayout.lines[0]?.segments[0]?.style.color).toBe('#abcdef')
    expect(heading?.textLayout.lines[0]?.segments[0]?.style.fontFamily).toBe('Kai')
  })

  it('写了宽度的 div 里，段落拉满后 text-align 才能居中', async () => {
    const doc = await layoutSource(
      `<layer width="800" height="300" safe="0"><div style="width:400px"><p style="text-align:center">甲</p></div></layer>`,
      process.cwd(),
    )
    const column = doc.root.children[0] as { width: number; children: Array<{ width: number; textAlign: string; textLayout: { contentWidth: number } }> }
    const paragraph = column.children[0]!
    expect(column.width).toBeCloseTo(400, 0)
    expect(paragraph.width).toBeCloseTo(400, 0)
    expect(paragraph.textAlign).toBe('center')
    expect(paragraph.textLayout.contentWidth).toBeLessThan(paragraph.width)
  })

  it('em 是斜体，u 带下划线', async () => {
    const doc = await layoutSource(
      `<layer width="400" height="200" safe="0"><p style="font-size:40px">甲<em>乙</em><u>丙</u></p></layer>`,
      process.cwd(),
    )
    const paragraph = doc.root.children[0] as {
      textLayout: { lines: Array<{ segments: Array<{ text: string; style: { fontStyle?: string; underline?: boolean } }> }> }
    }
    const segments = paragraph.textLayout.lines.flatMap((line) => line.segments)
    expect(segments.find((seg) => seg.text === '乙')?.style.fontStyle).toBe('italic')
    expect(segments.find((seg) => seg.text === '甲')?.style.fontStyle).toBeUndefined()
    expect(segments.find((seg) => seg.text === '丙')?.style.underline).toBe(true)
  })

  it('div 里的 layer 占一格，图形用这一层的局部坐标', async () => {
    const doc = await layoutSource(
      `<layer width="480" height="200" safe="0"><div style="display:flex; gap:24px; align-items:center"><layer width="80" height="80"><circle cx="40" cy="40" r="20" fill="#e8b04a" /></layer><p style="font-size:32px">标题</p></div></layer>`,
      process.cwd(),
    )
    expect(doc.issues.filter((issue) => issue.code === 'invalid-child' || issue.code === 'invalid-attr')).toEqual([])
    const row = doc.root.children[0] as {
      kind: string
      direction: string
      children: Array<{ tag: string; kind: string; x: number; y: number; width: number; height: number; children?: Array<{ x: number; y: number; width: number }> }>
    }
    expect(row.kind).toBe('flex')
    expect(row.direction).toBe('row')
    const [graphic, title] = row.children
    expect(graphic).toMatchObject({ tag: 'layer', kind: 'layer', x: 0, width: 80, height: 80 })
    expect(graphic?.children?.[0]).toMatchObject({ x: 20, y: 20, width: 40 })
    expect(title?.tag).toBe('p')
    expect(title!.x).toBeGreaterThan(graphic!.x + graphic!.width)
  })

  it('没写 display:flex 的 div 里，layer 和段落上下排', async () => {
    const doc = await layoutSource(
      `<layer width="400" height="240" safe="0"><div><layer width="80" height="40"><rect x="0" y="0" width="80" height="40" fill="#fff" /></layer><p style="font-size:32px">说明</p></div></layer>`,
      process.cwd(),
    )
    expect(doc.issues.filter((issue) => issue.code === 'invalid-child')).toEqual([])
    const column = doc.root.children[0] as { direction: string; children: Array<{ tag: string; y: number; height: number }> }
    expect(column.direction).toBe('column')
    expect(column.children.map((child) => child.tag)).toEqual(['layer', 'p'])
    expect(column.children[1]!.y).toBeGreaterThanOrEqual(column.children[0]!.height)
  })

  it('p 里可以直接放图片', async () => {
    const doc = await layoutSource(
      `<layer width="400" height="200" safe="0"><p style="font-size:32px">见图<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="width:12px; height:12px" /></p></layer>`,
      process.cwd(),
    )
    expect(doc.issues.filter((issue) => issue.code === 'invalid-child')).toEqual([])
    const text = doc.root.children[0] as {
      kind: string
      inlines?: Array<{ x: number; y: number; width: number }>
      textLayout: { lines: Array<{ width: number }> }
    }
    expect(text.kind).toBe('text')
    expect(text.inlines).toHaveLength(1)
    expect(text.textLayout.lines.length).toBeGreaterThan(0)
    expect(text.inlines![0]!.x).toBeGreaterThan(0)
  })

  it('只放文字的 div 仍是文字盒子', async () => {
    const doc = await layoutSource(`<layer width="400" height="200"><div style="font-size:40px">甲</div></layer>`, process.cwd())
    expect(doc.root.children[0]?.kind).toBe('text')
    expect(doc.issues.filter((issue) => issue.code === 'invalid-child')).toEqual([])
  })

  it('竖排 flex 把文字排成一列', async () => {
    const doc = await layoutSource(
      `<layer width="800" height="400"><div style="display:flex; flex-direction:column; gap:20px"><p style="font-size:40px">甲</p><p style="font-size:40px">乙</p></div></layer>`,
      process.cwd(),
    )
    const column = doc.root.children[0] as { children: Array<{ y: number }> }
    expect(column.children[1]!.y).toBeGreaterThan(column.children[0]!.y)
  })

  it('flex 里带内边距的短文字不被小数宽度挤到换行', async () => {
    const doc = await layoutSource(
      `<layer width="1920" height="1080"><div style="display:flex; gap:20px"><div style="padding:2px 29px; font-size:72px">a²</div><div style="padding:4px 22px; border:2px solid #333; font-size:44px">1 三角形</div></div></layer>`,
      process.cwd(),
    )
    expect(doc.issues.filter((i) => i.code === 'auto-wrap')).toEqual([])
    const row = doc.root.children[0] as { children: Array<{ textLayout: { lines: unknown[] } }> }
    for (const child of row.children) expect(child.textLayout.lines).toHaveLength(1)
  })

  it('没写宽高的 layer 原点固定，负坐标不会平移其他子元素', async () => {
    const doc = await layoutSource(
      `<layer width="400" height="400"><layer><rect x="10" y="10" width="20" height="20" /><rect x="-40" y="30" width="20" height="20" /></layer></layer>`,
      process.cwd(),
    )
    const layer = doc.root.children[0]
    expect(layer?.kind).toBe('layer')
    const [first, second] = (layer as { children: Array<{ x: number; y: number }> }).children
    expect(first?.x).toBe(10)
    expect(first?.y).toBe(10)
    expect(second?.x).toBe(-40)
    expect(second?.y).toBe(30)
  })

  it('path 几何减去盒子原点，和折线同一套局部坐标', async () => {
    const doc = await layoutSource(
      `<layer width="200" height="200"><path d="M 80 90 L 140 90" /><path d="M 80 90 l 40 0" /></layer>`,
      process.cwd(),
    )
    const [absolute, relative] = doc.root.children as Array<{ x: number; y: number; geometry: { kind: string; d: string } }>
    expect(absolute.x).toBe(80)
    expect(absolute.y).toBe(90)
    expect(absolute.geometry.d).toBe('M 0 0 L 60 0')
    expect(relative.geometry.d).toBe('M 0 0 l 40 0')
  })

  it('curve 穿过点，开口不填充', async () => {
    const doc = await layoutSource(
      `<layer width="400" height="300"><curve points="30,100 100,40 170,100" fill="#ff0000" /><curve points="40,40 160,40 100,140" closed fill="#00ff00" /></layer>`,
      process.cwd(),
    )
    const [open, closed] = doc.root.children as Array<{ tag: string; fill: string; geometry: { kind: string; d: string } }>
    expect(open.tag).toBe('curve')
    expect(open.fill).toBe('none')
    expect(open.geometry.kind).toBe('path')
    expect(open.geometry.d).toContain(' C ')
    expect(closed.fill).toBe('#00ff00')
    expect(closed.geometry.d.endsWith('Z')).toBe(true)
    expect(doc.issues.some((issue) => issue.code === 'open-curve-fill')).toBe(true)
  })

  it('symbol 不占位，use 按 x y 各放一份', async () => {
    const doc = await layoutSource(
      `<layer width="200" height="120"><symbol id="dot" width="20" height="20"><circle cx="10" cy="10" r="8" fill="#ff0000" /></symbol><use href="#dot" x="30" y="20" /><use href="#dot" x="70" y="20" /></layer>`,
      process.cwd(),
    )
    expect(doc.root.children.map((child) => child.tag)).toEqual(['use', 'use'])
    expect(doc.root.children.map((child) => child.x)).toEqual([30, 70])
    expect(doc.issues.filter((issue) => issue.code === 'missing-symbol')).toEqual([])
  })

  it('竖排寒露高过宽，字从上到下', async () => {
    const doc = await layoutSource(
      `<layer width="400" height="400"><h1 style="writing-mode:vertical-rl; font-size:40px; letter-spacing:8px">寒露</h1></layer>`,
      process.cwd(),
    )
    const title = doc.root.children[0] as {
      width: number
      height: number
      textLayout: { lines: Array<{ segments: Array<{ text: string }>; baselineY: number }> }
    }
    expect(title.height).toBeGreaterThan(title.width)
    expect(title.textLayout.lines.map((line) => line.segments[0]?.text)).toEqual(['寒', '露'])
    expect(title.textLayout.lines[1]!.baselineY).toBeGreaterThan(title.textLayout.lines[0]!.baselineY)
  })

  it('渐变、阴影和光晕写进图形', async () => {
    const doc = await layoutSource(
      `<layer width="200" height="200"><circle cx="40" cy="40" r="20" fill="radial-gradient(#fff, #fff0)" glow="12 #fff" shadow="0 4 8 #00000055" /></layer>`,
      process.cwd(),
    )
    const circle = doc.root.children[0] as { fill: string; glow?: { blur: number; color: string }; shadow?: { y: number; blur: number } }
    expect(circle.fill).toBe('radial-gradient(#fff, #fff0)')
    expect(circle.glow).toMatchObject({ blur: 12, color: '#fff' })
    expect(circle.shadow).toMatchObject({ y: 4, blur: 8 })
  })

  it('新效果属性写进布局节点', async () => {
    const doc = await layoutSource(
      `<layer width="200" height="200"><rect x="20" y="20" width="40" height="40" fill="#fff" inner-shadow="0 2 4 #00000055" blur="3" backdrop-blur="5" noise="0.1 #fff" filter="brightness(1.1)" blend="screen" /></layer>`,
      process.cwd(),
    )
    const rect = doc.root.children[0] as {
      innerShadow?: { y: number }
      blur?: number
      backdropBlur?: number
      noise?: { amount: number }
      colorFilter?: Array<{ name: string }>
      blend?: string
    }
    expect(rect.innerShadow).toMatchObject({ y: 2 })
    expect(rect.blur).toBe(3)
    expect(rect.backdropBlur).toBe(5)
    expect(rect.noise).toMatchObject({ amount: 0.1 })
    expect(rect.colorFilter?.[0]?.name).toBe('brightness')
    expect(rect.blend).toBe('screen')
  })

  it('align-items baseline 对齐第一行基线，竖排则按起点', async () => {
    const doc = await layoutSource(
      `<layer width="800" height="400" safe="0"><div style="display:flex; align-items:baseline; gap:16px"><p style="font-size:80px; white-space:nowrap">甲</p><p style="font-size:32px; white-space:nowrap">乙</p><div style="width:24px; height:24px; background:#e8b04a"></div></div></layer>`,
      process.cwd(),
    )
    expect(doc.issues.some((issue) => issue.code === 'invalid-attr')).toBe(false)
    const row = doc.root.children[0] as {
      children: Array<{
        y: number
        height: number
        padding: { top: number }
        border?: { width: number }
        textLayout?: { lines: Array<{ baselineY: number }> }
      }>
    }
    const [big, small, box] = row.children
    const base = (node: NonNullable<typeof big>) =>
      node.y + node.padding.top + (node.border?.width ?? 0) + node.textLayout!.lines[0]!.baselineY
    expect(base(big!)).toBeCloseTo(base(small!), 0)
    expect(box!.y + box!.height).toBeCloseTo(base(big!), 0)

    const column = await layoutSource(
      `<layer width="400" height="300" safe="0"><div style="display:flex; flex-direction:column; width:300px; align-items:baseline"><p style="font-size:40px">甲</p><p style="font-size:40px">甲乙丙丁</p></div></layer>`,
      process.cwd(),
    )
    const kids = (column.root.children[0] as { children: Array<{ x: number }> }).children
    expect(kids.map((child) => child.x)).toEqual([0, 0])

    const selves = await layoutSource(
      `<layer width="800" height="300" safe="0"><div style="display:flex; align-items:center; height:240px"><p style="font-size:80px; white-space:nowrap; align-self:baseline">甲</p><p style="font-size:32px; white-space:nowrap; align-self:baseline">乙</p></div></layer>`,
      process.cwd(),
    )
    const selfRow = selves.root.children[0] as { children: typeof row.children }
    const [selfBig, selfSmall] = selfRow.children
    expect(base(selfBig!)).toBeCloseTo(base(selfSmall!), 0)
    expect(selfBig!.y).toBeLessThan(40)
  })

  it('基线把行撑高后，居中和靠底的子项跟着新行盒走', async () => {
    const doc = await layoutSource(
      `<layer width="800" height="400" safe="0"><div style="display:flex; align-items:baseline; gap:12px"><p style="font-size:48px; white-space:nowrap">甲</p><p style="font-size:16px; white-space:nowrap; padding:0 0 80px">乙</p><div style="width:30px; height:30px; align-self:center; background:#ccc"></div><div style="width:30px; height:20px; align-self:flex-end; background:#ccc"></div><div style="width:30px; height:16px; align-self:end; background:#ccc"></div><div style="width:30px; height:12px; align-self:flex-start; background:#ccc"></div></div></layer>`,
      process.cwd(),
    )
    const row = doc.root.children[0] as {
      children: Array<{
        y: number
        height: number
        padding: { top: number }
        border?: { width: number }
        textLayout?: { lines: Array<{ baselineY: number }> }
      }>
    }
    const [big, small, center, end, namedEnd, start] = row.children
    const base = (node: NonNullable<typeof big>) =>
      node.y + node.padding.top + (node.border?.width ?? 0) + node.textLayout!.lines[0]!.baselineY
    const lineBottom = small!.y + small!.height
    expect(base(big!)).toBeCloseTo(base(small!), 0)
    expect(small!.y).toBeGreaterThan(1)
    expect(lineBottom).toBeGreaterThan(big!.y + big!.height + 1)
    expect(end!.y + end!.height).toBeCloseTo(lineBottom, 0)
    expect(namedEnd!.y + namedEnd!.height).toBeCloseTo(lineBottom, 0)
    expect(center!.y + center!.height / 2).toBeCloseTo(lineBottom / 2, 0)
    expect(start!.y).toBeCloseTo(0, 0)
  })

  it('align-items 的 flex-start 和 flex-end 按起止对齐', async () => {
    const place = async (align: string) => {
      const doc = await layoutSource(
        `<layer width="400" height="200"><div style="display:flex; flex-direction:column; width:300px; align-items:${align}"><p style="font-size:40px">甲</p><p style="font-size:40px">甲乙丙丁</p></div></layer>`,
        process.cwd(),
      )
      const column = doc.root.children[0] as { width: number; children: Array<{ x: number; width: number }> }
      return column
    }
    const atStart = await place('flex-start')
    expect(atStart.children.map((child) => child.x)).toEqual([0, 0])
    const atEnd = await place('flex-end')
    for (const child of atEnd.children) expect(child.x + child.width).toBeCloseTo(atEnd.width, 0)
    expect(atEnd.children[0]!.x).toBeGreaterThan(0)
    const named = await place('end')
    expect(named.children.map((child) => Math.round(child.x))).toEqual(atEnd.children.map((child) => Math.round(child.x)))
  })

  it('没写宽高的 layer 从写下的左上角排，子元素不再自动居中', async () => {
    const doc = await layoutSource(
      `<layer width="800" height="400"><layer x="400" y="120"><div style="display:flex; flex-direction:column; align-items:center; gap:8px"><p style="font-size:40px">甲</p><p style="font-size:40px">甲乙丙丁</p></div></layer></layer>`,
      process.cwd(),
    )
    const layer = doc.root.children[0] as { x: number; y: number; children: Array<{ x: number; children: Array<{ x: number; width: number }> }> }
    expect(layer.x).toBe(400)
    expect(layer.y).toBe(120)
    const column = layer.children[0]!
    expect(column.x).toBe(0)
    const hello = await layoutSource(readFileSync(join(process.cwd(), 'examples/hello.layer'), 'utf8'), process.cwd())
    const card = hello.root.children[0] as { x: number; children: Array<{ x: number; children: Array<{ x: number; width: number }> }> }
    const title = card.children[0]!.children[0]!
    expect(card.x + card.children[0]!.x + title.x + title.width / 2).toBeCloseTo(540, 0)
  })

  it('justify-content 的 flex-end 靠右', async () => {
    const doc = await layoutSource(
      `<layer width="400" height="120"><div style="display:flex; width:300px; justify-content:flex-end"><p style="font-size:40px">甲</p></div></layer>`,
      process.cwd(),
    )
    const row = doc.root.children[0] as { width: number; children: Array<{ x: number; width: number }> }
    const text = row.children[0]!
    expect(text.x + text.width).toBeCloseTo(row.width, 0)
    expect(text.x).toBeGreaterThan(0)
  })

  it('根 layer 里的 font 会注册', async () => {
    const src = join(getFontsCacheDir(), 'ChillDuanSansVF.ttf')
    const inside = 'ProbeFontInside'
    const before = 'ProbeFontBefore'
    const nested = 'ProbeFontNested'
    const insideDoc = await layoutSource(
      `<layer width="200" height="80"><font family="${inside}" src="${src}" /><p style="font-family:${inside}; font-size:32px">字</p></layer>`,
      process.cwd(),
    )
    expect(GlobalFonts.has(inside)).toBe(true)
    expect(insideDoc.issues.filter((issue) => issue.code === 'unknown-tag')).toEqual([])
    await layoutSource(
      `<font family="${before}" src="${src}" /><layer width="200" height="80"><p style="font-size:32px">字</p></layer>`,
      process.cwd(),
    )
    expect(GlobalFonts.has(before)).toBe(true)
    const nestedDoc = await layoutSource(
      `<layer width="200" height="80"><layer><font family="${nested}" src="${src}" /></layer></layer>`,
      process.cwd(),
    )
    expect(GlobalFonts.has(nested)).toBe(false)
    expect(nestedDoc.issues.some((issue) => issue.code === 'invalid-child' && issue.message.includes('<font>'))).toBe(true)
  })

  it('根 Layer 里的 font 会改变字宽', async () => {
    const src = ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/truetype/croscore/Cousine-Regular.ttf'].find(
      (path) => existsSync(path),
    )
    if (!src) return
    const family = 'Probe Mono'
    const sample = '0123456789'
    const textWidth = (source: string) =>
      layoutSource(source, process.cwd()).then((doc) => {
        const node = doc.root.children.find((child) => child.kind === 'text')
        return { width: node && node.kind === 'text' ? node.width : 0, issues: doc.issues }
      })
    const inside = await textWidth(
      `<layer width="1080" height="80"><font family="${family}" src="${src}" /><p style="font-family:${family}; font-size:32px">${sample}</p></layer>`,
    )
    const outside = await textWidth(
      `<font family="${family}" src="${src}" /><layer width="1080" height="80"><p style="font-family:${family}; font-size:32px">${sample}</p></layer>`,
    )
    const plain = await textWidth(`<layer width="1080" height="80"><p style="font-size:32px">${sample}</p></layer>`)
    expect(inside.issues.filter((issue) => issue.code === 'unknown-tag' || issue.code === 'invalid-child')).toEqual([])
    expect(inside.width).toBeCloseTo(outside.width, 1)
    expect(Math.abs(inside.width - plain.width)).toBeGreaterThan(1)
  })

  it('flex-wrap 把放不下的子项换到下一行', async () => {
    const doc = await layoutSource(
      `<layer width="400" height="300" safe="0"><div style="display:flex; flex-wrap:wrap; width:220px; column-gap:20px; row-gap:8px; align-items:flex-start"><div style="width:100px; height:40px; background:#fff; flex-shrink:0"></div><div style="width:100px; height:40px; background:#fff; flex-shrink:0"></div><div style="width:100px; height:40px; background:#fff; flex-shrink:0"></div></div></layer>`,
      process.cwd(),
    )
    const row = doc.root.children[0] as { height: number; children: Array<{ x: number; y: number }> }
    const [a, b, c] = row.children
    expect(a!.y).toBeCloseTo(0)
    expect(b!.x).toBeCloseTo(a!.x + 100 + 20)
    expect(b!.y).toBeCloseTo(a!.y)
    expect(c!.x).toBeCloseTo(a!.x)
    expect(c!.y).toBeCloseTo(a!.y + 40 + 8)
    expect(row.height).toBeGreaterThan(80)
    expect(doc.issues.some((issue) => issue.code === 'flex-overflow')).toBe(false)
  })

  it('换行以后仍超出写死的高度时报 flex-overflow', async () => {
    const overflow = await layoutSource(
      `<layer width="400" height="300" safe="0"><div style="display:flex; flex-wrap:wrap; width:220px; height:50px; align-items:flex-start"><div style="width:100px; height:40px; background:#fff; flex-shrink:0"></div><div style="width:100px; height:40px; background:#fff; flex-shrink:0"></div><div style="width:100px; height:40px; background:#fff; flex-shrink:0"></div></div></layer>`,
      process.cwd(),
    )
    expect(overflow.issues.some((issue) => issue.code === 'flex-overflow' && issue.message.includes('height'))).toBe(true)

    const fits = await layoutSource(
      `<layer width="400" height="300" safe="0"><div style="display:flex; width:400px; height:50px; align-items:flex-start"><div style="width:100px; height:40px; background:#fff; flex-shrink:0"></div><div style="width:100px; height:40px; background:#fff; flex-shrink:0"></div></div></layer>`,
      process.cwd(),
    )
    expect(fits.issues.some((issue) => issue.code === 'flex-overflow')).toBe(false)
  })

  it('align-content 缺省贴起点，写了 center 才把多行居中', async () => {
    const place = async (align: string | undefined) => {
      const extra = align ? `; align-content:${align}` : ''
      const doc = await layoutSource(
        `<layer width="400" height="300" safe="0"><div style="display:flex; flex-wrap:wrap; width:120px; height:200px; align-items:flex-start${extra}"><div style="width:100px; height:40px; background:#fff; flex-shrink:0"></div><div style="width:100px; height:40px; background:#fff; flex-shrink:0"></div></div></layer>`,
        process.cwd(),
      )
      const column = doc.root.children[0] as { children: Array<{ y: number }> }
      return column.children.map((child) => child.y)
    }
    const start = await place(undefined)
    expect(start[0]).toBeCloseTo(0)
    expect(start[1]).toBeCloseTo(40)
    const centered = await place('center')
    expect(centered[0]).toBeGreaterThan(20)
    expect(centered[1]! - centered[0]!).toBeCloseTo(40)
  })

  it('wrap-reverse 把第一行放到交叉轴末端', async () => {
    const doc = await layoutSource(
      `<layer width="400" height="300" safe="0"><div style="display:flex; flex-wrap:wrap-reverse; width:120px; height:200px; align-items:flex-start"><div style="width:100px; height:40px; background:#fff; flex-shrink:0"></div><div style="width:100px; height:40px; background:#fff; flex-shrink:0"></div></div></layer>`,
      process.cwd(),
    )
    const row = doc.root.children[0] as { height: number; children: Array<{ y: number }> }
    expect(row.children[0]!.y).toBeGreaterThan(row.children[1]!.y)
    expect(row.children[0]!.y + 40).toBeCloseTo(row.height, 0)
  })

  it('invalid-child 线条进 flex', async () => {
    const doc = await layoutSource(
      `<layer width="200" height="200"><div style="display:flex"><line x1="0" y1="0" x2="10" y2="10" /></div></layer>`,
      process.cwd(),
    )
    expect(doc.issues.some((i) => i.code === 'invalid-child')).toBe(true)
  })
})
