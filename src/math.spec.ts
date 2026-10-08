import { describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { layoutSource } from './layout.js'
import { mathConstant } from './math/font.js'
import { renderFvg } from './render.js'
import type { FlexLayoutNode, LayoutNode } from './types.js'

function findByTag(root: LayoutNode, tag: string): LayoutNode[] {
  const out: LayoutNode[] = []
  const visit = (n: LayoutNode) => {
    if (n.tag === tag) out.push(n)
    if (n.kind === 'flex' || n.kind === 'layer') for (const c of n.children) visit(c)
  }
  visit(root)
  return out
}

function flex(node: LayoutNode | undefined): FlexLayoutNode {
  if (node?.kind !== 'flex') throw new Error(`expected flex, got ${node?.kind}`)
  return node
}

/** 节点在 `<math>` 坐标里的盒子。 */
function absBox(root: LayoutNode, target: LayoutNode): { x: number; y: number; width: number; height: number } {
  let found: { x: number; y: number } | null = null
  const visit = (n: LayoutNode, ox: number, oy: number) => {
    const x = ox + n.x
    const y = oy + n.y
    if (n === target) found = { x, y }
    if (n.kind === 'flex') for (const c of n.children) visit(c, x + n.padding.left, y + n.padding.top)
  }
  visit(root, -root.x, -root.y)
  if (!found) throw new Error('not found')
  const f = found as { x: number; y: number }
  return { x: f.x, y: f.y, width: target.width, height: target.height }
}

/** 文字节点的基线，`<math>` 坐标。 */
function baseline(root: LayoutNode, node: LayoutNode): number {
  if (node.kind !== 'text') throw new Error('expected text')
  return absBox(root, node).y + node.padding.top + node.textLayout.lines[0]!.baselineY
}

function frame(body: string): string {
  return `<layer width="1000" height="500" background="#0f1115" color="#ffffff">${body}</layer>`
}

async function mathOf(body: string) {
  const doc = await layoutSource(frame(body), process.cwd())
  const math = findByTag(doc.root, 'math')[0]!
  return { doc, math }
}

function textNode(root: LayoutNode, text: string): LayoutNode {
  const all: LayoutNode[] = []
  const visit = (n: LayoutNode) => {
    if (n.kind === 'text' && n.text === text) all.push(n)
    if (n.kind === 'flex' || n.kind === 'layer') for (const c of n.children) visit(c)
  }
  visit(root)
  if (!all[0]) throw new Error(`no text ${text}`)
  return all[0]
}

async function pixelAt(png: Buffer, x: number, y: number): Promise<[number, number, number, number]> {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data
  return [d[0]!, d[1]!, d[2]!, d[3]!]
}

describe('mathml', () => {
  it('单个字母的 mi 用数学斜体，多个字母和 mn 直立，mathvariant 换字母表', async () => {
    const { math } = await mathOf(
      '<math><mi>x</mi><mi>sin</mi><mn>2</mn><mi mathvariant="double-struck">R</mi><mi mathvariant="normal">d</mi><mi>Δ</mi></math>',
    )
    const texts = findByTag(math, 'mi').map((n) => n.text)
    expect(texts).toEqual(['𝑥', 'sin', 'ℝ', 'd', 'Δ'])
    expect(findByTag(math, 'mn')[0]!.text).toBe('2')
    expect(findByTag(math, 'mi')[0]!.computed.fontFamily).toBe('STIXTwoMath')
  })

  it('公式忽略普通字体，mtext 仍用外面的字体', async () => {
    const { doc, math } = await mathOf(
      '<math style="font-family:Kai"><mi style="font-family:Song">x</mi><mtext style="font-family:Kai">当</mtext></math>',
    )
    expect(findByTag(math, 'mi')[0]!.computed.fontFamily).toBe('STIXTwoMath')
    expect(findByTag(math, 'mi')[0]!.text).toBe('𝑥')
    expect(findByTag(math, 'mtext')[0]!.computed.fontFamily).toBe('Kai')
    expect(math.computed.fontFamily).toBe('STIXTwoMath')
    const issues = doc.issues.filter((i) => i.code === 'invalid-attr')
    expect(issues.map((i) => i.path)).toEqual(['layer/math[0]', 'layer/math[0]/mi[0]'])
    const alias = await mathOf('<math style="font-family:\'STIX Two Math\'"><mi>x</mi></math>')
    expect(alias.doc.issues.filter((i) => i.code === 'invalid-attr')).toEqual([])
    expect(findByTag(alias.math, 'mi')[0]!.computed.fontFamily).toBe('STIXTwoMath')
  })

  it('等号两侧是粗空，开头的减号当正负号不加空', async () => {
    const { math } = await mathOf('<math><mo>-</mo><mi>a</mi><mo>=</mo><mi>b</mi><mo>+</mo><mi>c</mi></math>')
    const [minus, eq, plus] = findByTag(math, 'mo')
    const [a, b, c] = findByTag(math, 'mi')
    expect(minus!.text).toBe('−')
    expect(a!.x - (minus!.x + minus!.width)).toBeCloseTo(0, 3)
    expect(eq!.x - (a!.x + a!.width)).toBeCloseTo((40 * 5) / 18, 3)
    expect(b!.x - (eq!.x + eq!.width)).toBeCloseTo((40 * 5) / 18, 3)
    expect(plus!.x - (b!.x + b!.width)).toBeCloseTo((40 * 4) / 18, 3)
    expect(c!.x - (plus!.x + plus!.width)).toBeCloseTo((40 * 4) / 18, 3)
  })

  it('一行里的记号按基线对齐', async () => {
    const { math } = await mathOf('<math><mi>a</mi><mi>b</mi><mi>y</mi><mo>=</mo><mn>1</mn></math>')
    const lines = ['𝑎', '𝑏', '𝑦', '=', '1'].map((t) => baseline(math, textNode(math, t)))
    for (const y of lines) expect(y).toBeCloseTo(lines[0]!, 3)
  })

  it('分数线在数学轴上，分子在上分母在下，线比较宽的一侧略长', async () => {
    const { math } = await mathOf('<math><mi>x</mi><mo>=</mo><mfrac><mi>WWWW</mi><mi>i</mi></mfrac></math>')
    const frac = flex(findByTag(math, 'mfrac')[0])
    const [num, rule, den] = frac.children
    expect(num!.computed.fontSize).toBeCloseTo(40 * 0.85, 5)
    expect(den!.computed.fontSize).toBeCloseTo(40 * 0.85, 5)
    expect(rule!.tag).toBe('rule')
    expect(rule!.y).toBeGreaterThanOrEqual(num!.y + num!.height - 0.5)
    expect(den!.y).toBeGreaterThanOrEqual(rule!.y + rule!.height - 0.5)
    expect(rule!.width).toBeGreaterThan(Math.max(num!.width, den!.width))
    const axis = mathConstant('AxisHeight', 40)
    const ruleCenter = absBox(math, rule!).y + rule!.height / 2
    expect(baseline(math, textNode(math, '𝑥')) - ruleCenter).toBeCloseTo(axis, 1)
  })

  it('display="block" 的分数不缩小，求和号换大号字形', async () => {
    const { math } = await mathOf(
      '<math display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac><munderover><mo>∑</mo><mi>i</mi><mi>n</mi></munderover></math>',
    )
    const frac = flex(findByTag(math, 'mfrac')[0])
    expect(frac.children[0]!.computed.fontSize).toBe(40)
    const sum = flex(findByTag(math, 'munderover')[0])
    const op = sum.children[0]!
    expect(op.kind).toBe('line')
    expect(op.height).toBeGreaterThan(40 * 1.2)
  })

  it('同一行的上标不管基座高矮都在同一高度', async () => {
    const { math } = await mathOf('<math><msup><mi>a</mi><mn>2</mn></msup><mo>+</mo><msup><mi>b</mi><mn>2</mn></msup></math>')
    const twos = findByTag(math, 'mn')
    expect(twos).toHaveLength(2)
    expect(baseline(math, twos[0]!)).toBeCloseTo(baseline(math, twos[1]!), 3)
    expect(twos[0]!.computed.fontSize).toBeCloseTo(40 * 0.7, 5)
    const raise = baseline(math, textNode(math, '𝑎')) - baseline(math, twos[0]!)
    expect(raise).toBeCloseTo(mathConstant('SuperscriptShiftUp', 40), 1)
  })

  it('msubsup 上下标都在基座右边，上标在上，中间留缝', async () => {
    const { math } = await mathOf('<math><msubsup><mi>a</mi><mn>1</mn><mn>10</mn></msubsup></math>')
    const node = flex(findByTag(math, 'msubsup')[0])
    const [base, sup, sub] = node.children
    expect(sup!.text).toBe('10')
    expect(sub!.text).toBe('1')
    expect(sup!.x).toBeGreaterThanOrEqual(base!.x + base!.width - 0.5)
    expect(sub!.x).toBeGreaterThanOrEqual(base!.x + base!.width - 0.5)
    const gap = absBox(math, sub!).y - (absBox(math, sup!).y + sup!.height)
    expect(gap).toBeGreaterThan(0)
  })

  it('display 时求和和极限的限在基座正上方、正下方', async () => {
    const { math } = await mathOf(
      '<math display="block"><msubsup><mo>∑</mo><mi>i</mi><mi>n</mi></msubsup><munder><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder></math>',
    )
    const sum = flex(findByTag(math, 'msubsup')[0])
    const [base, over, under] = sum.children
    expect(over!.y + over!.height).toBeLessThanOrEqual(base!.y + 0.5)
    expect(under!.y).toBeGreaterThanOrEqual(base!.y + base!.height - 0.5)
    expect(over!.x + over!.width / 2).toBeCloseTo(base!.x + base!.width / 2, 0)
    const lim = flex(findByTag(math, 'munder')[0])
    const [word, below] = lim.children
    expect(below!.y).toBeGreaterThanOrEqual(word!.y + word!.height - 0.5)
    expect(below!.computed.fontSize).toBeCloseTo(40 * 0.7, 5)
  })

  it('行内的 munderover 求和把限放到右侧', async () => {
    const { math } = await mathOf(
      '<math><munderover><mo>∑</mo><mi>i</mi><mi>n</mi></munderover><munder><mo movablelimits="false">∑</mo><mi>k</mi></munder></math>',
    )
    const [sum, fixed] = findByTag(math, 'munderover').concat(findByTag(math, 'munder')).map(flex)
    const [base, over, under] = sum!.children
    expect(under!.text).toBe('𝑖')
    expect(over!.text).toBe('𝑛')
    expect(over!.y).toBeLessThan(under!.y)
    expect(under!.x).toBeGreaterThanOrEqual(base!.x + base!.width * 0.5)
    expect(over!.x).toBeGreaterThanOrEqual(base!.x + base!.width - 0.5)
    const [base2, below] = fixed!.children
    expect(below!.y).toBeGreaterThanOrEqual(base2!.y + base2!.height - 0.5)
  })

  it('积分限在右侧，下限往左收进斜体修正；显示样式的积分号更高', async () => {
    const inline = await mathOf('<math><msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><mi>x</mi></math>')
    const node = flex(findByTag(inline.math, 'msubsup')[0])
    const [base, sup, sub] = node.children
    expect(sup!.x).toBeGreaterThan(sub!.x)
    expect(sub!.x).toBeLessThan(base!.x + base!.width)
    const display = await mathOf('<math display="block"><msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup></math>')
    const big = flex(findByTag(display.math, 'msubsup')[0]).children[0]!
    expect(big.kind).toBe('line')
    expect(big.height).toBeGreaterThan(base!.height * 1.8)
  })

  it('根号随内容变高，开方指数在左上', async () => {
    const { math } = await mathOf(
      '<math><msqrt><mi>x</mi></msqrt><msqrt><mfrac><mi>a</mi><mi>b</mi></mfrac></msqrt><mroot><mi>x</mi><mn>3</mn></mroot></math>',
    )
    const [small, tall] = findByTag(math, 'msqrt')
    const surdSmall = flex(small).children.find((c) => c.tag === 'surd')!
    const surdTall = flex(tall).children.find((c) => c.tag === 'surd')!
    expect(surdTall.height).toBeGreaterThan(surdSmall.height)
    const bar = flex(small).children.find((c) => c.tag === 'rule')!
    const radicand = flex(small).children.find((c) => c.tag === 'mrow')!
    expect(bar.y + bar.height).toBeLessThanOrEqual(radicand.y + 0.5)
    const root = flex(findByTag(math, 'mroot')[0])
    const index = root.children.find((c) => c.tag === 'mn')!
    const surd = root.children.find((c) => c.tag === 'surd')!
    expect(index.computed.fontSize).toBeCloseTo(40 * 0.55, 5)
    expect(index.x).toBeLessThan(surd.x + surd.width / 2)
    expect(index.y + index.height).toBeLessThan(surd.y + surd.height)
  })

  it('矩阵同一列对齐，括号拉长到整张表', async () => {
    const { math } = await mathOf(
      '<math><mrow><mo>(</mo><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr><mtr><mtd><mn>100</mn></mtd><mtd><mn>1</mn></mtd></mtr></mtable><mo>)</mo></mrow></math>',
    )
    const table = flex(findByTag(math, 'mtable')[0])
    expect(table.children).toHaveLength(2)
    const [r0, r1] = table.children.map(flex)
    const center = (row: FlexLayoutNode, i: number) => row.children[i]!.x + row.children[i]!.width / 2
    expect(center(r0!, 0)).toBeCloseTo(center(r1!, 0), 3)
    expect(center(r0!, 1)).toBeCloseTo(center(r1!, 1), 3)
    expect(r1!.y - r0!.y).toBeGreaterThanOrEqual(40 * 1.2 - 0.01)
    const fences = findByTag(math, 'mo')
    expect(fences[0]!.kind).toBe('line')
    expect(fences[0]!.height).toBeGreaterThanOrEqual(table.height * 0.95)
  })

  it('括号按配对伸长：f(x) 不跟着同一行的大括号变高', async () => {
    const { math } = await mathOf(
      '<math><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>=</mo><mrow><mo>{</mo><mtable><mtr><mtd><mn>1</mn></mtd></mtr><mtr><mtd><mn>0</mn></mtd></mtr></mtable></mrow></math>',
    )
    const mos = findByTag(math, 'mo')
    expect(mos[0]!.kind).toBe('text')
    expect(mos[1]!.kind).toBe('text')
    const brace = mos.find((n) => n.text === '{' || n.kind === 'line')!
    expect(brace.kind).toBe('line')
  })

  it('上方重音盖住基座，横线和基座一样宽', async () => {
    const { math } = await mathOf(
      '<math><mover><mi>x</mi><mo>^</mo></mover><mover><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mo>¯</mo></mover></math>',
    )
    const [hat, bar] = findByTag(math, 'mover').map(flex)
    const hatMark = hat!.children[1]!
    expect(hatMark.kind).toBe('line')
    expect(hatMark.ink.y + hatMark.y + hatMark.ink.height).toBeLessThanOrEqual(hat!.children[0]!.y + hat!.children[0]!.ink.y + 0.5)
    const [base, line] = bar!.children
    expect(line!.kind).toBe('shape')
    expect(line!.width).toBeCloseTo(base!.width, 3)
    expect(line!.y + line!.height).toBeLessThanOrEqual(base!.y + 0.5)
  })

  it('和文字并排居中时，公式基线和同字号文字的基线对齐', async () => {
    const doc = await layoutSource(
      frame(
        '<div style="display:flex; gap:8px; align-items:center"><span style="font-size:40px">因此</span><math><mi>x</mi><mo>=</mo><mfrac><mrow><mn>1</mn></mrow><mrow><mn>1</mn><mo>+</mo><mfrac><mn>1</mn><mi>x</mi></mfrac></mrow></mfrac></math></div>',
      ),
      process.cwd(),
    )
    const row = doc.root.children[0]!
    const span = flex(row).children[0]!
    const math = findByTag(doc.root, 'math')[0]!
    if (span.kind !== 'text') throw new Error('span')
    const spanBaseline = span.y + span.textLayout.lines[0]!.baselineY
    const x = textNode(math, '𝑥')
    const mathBaseline = math.y + baseline(math, x)
    expect(Math.abs(spanBaseline - mathBaseline)).toBeLessThan(40 * 0.08)
  })

  it('同一个公式里的记号相交不报 text-overlap', async () => {
    const { report } = await renderFvg(
      frame('<math display="block"><msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><mroot><mi>x</mi><mn>3</mn></mroot></math>'),
    )
    expect(report.issues.filter((i) => i.code === 'text-overlap')).toEqual([])
  })

  it('semantics 只排第一个子元素，annotation 不画', async () => {
    const { doc, math } = await mathOf(
      '<math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math>',
    )
    expect(doc.issues.some((i) => i.code === 'unknown-tag')).toBe(false)
    expect(findByTag(math, 'annotation')).toHaveLength(0)
    expect(findByTag(math, 'mi')).toHaveLength(1)
  })

  it('flex 里的 math 不再报 unknown-tag', async () => {
    const doc = await layoutSource(
      frame(
        '<div style="display:flex; gap:8px; align-items:center"><span>因此</span><math><mi>π</mi><mo>≈</mo><mn>4</mn><mo>·</mo><mfrac><mi>N</mi><mi>M</mi></mfrac></math></div>',
      ),
      process.cwd(),
    )
    expect(doc.issues.some((i) => i.code === 'unknown-tag')).toBe(false)
    expect(findByTag(doc.root, 'math').length).toBe(1)
    expect(findByTag(doc.root, 'math')[0]!.width).toBeGreaterThan(0)
  })

  it('div 里可以直接放 math', async () => {
    const doc = await layoutSource(frame('<div><span>因此</span><math><mi>x</mi></math></div>'), process.cwd())
    expect(doc.issues.some((i) => i.code === 'invalid-child')).toBe(false)
    expect(findByTag(doc.root, 'math')).toHaveLength(1)
  })

  it('文字盒子里的 math 报 invalid-child', async () => {
    const doc = await layoutSource(frame('<p>因此<math><mi>x</mi></math></p>'), process.cwd())
    expect(doc.issues.some((i) => i.code === 'invalid-child')).toBe(true)
    expect(findByTag(doc.root, 'math')).toHaveLength(0)
  })

  it('裸的 mfrac 仍是未知标签，公式里不认识的标签报 unknown-tag', async () => {
    const bare = await layoutSource(frame('<mfrac><mi>a</mi><mi>b</mi></mfrac>'), process.cwd())
    expect(bare.issues.some((i) => i.code === 'unknown-tag' && i.message.includes('mfrac'))).toBe(true)
    const inner = await layoutSource(frame('<math><mi>a</mi><menclose><mi>b</mi></menclose></math>'), process.cwd())
    expect(inner.issues.some((i) => i.code === 'unknown-tag' && i.message.includes('menclose'))).toBe(true)
  })

  it('分数线和根号画在布局盒子里', async () => {
    const source = frame('<layer x="100" y="100"><math><mfrac><mi>N</mi><mi>M</mi></mfrac><msqrt><mi>x</mi></msqrt></math></layer>')
    const { png, report } = await renderFvg(source)
    for (const tag of ['rule', 'surd']) {
      const el = report.elements.find((e) => e.tag === tag)
      expect(el, tag).toBeTruthy()
    }
    const rule = report.elements.find((e) => e.tag === 'rule')!
    const [r, g, b] = await pixelAt(png, Math.round(rule.ink.centerX), Math.round(rule.ink.centerY))
    expect(r + g + b).toBeGreaterThan(400)
  })
})
