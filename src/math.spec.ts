import { describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { layoutSource } from './layout.js'
import { renderFvg } from './render.js'
import type { FlexLayoutNode, LayoutNode } from './types.js'

function findByTag(root: LayoutNode, tag: string): LayoutNode[] {
  const out: LayoutNode[] = []
  const visit = (n: LayoutNode) => {
    if (n.tag === tag) out.push(n)
    if (n.kind === 'flex' || n.kind === 'layer') for (const c of n.children) visit(c)
    else if (n.kind === 'sqrt') visit(n.child)
  }
  visit(root)
  return out
}

function flex(node: LayoutNode | undefined): FlexLayoutNode {
  if (node?.kind !== 'flex') throw new Error(`expected flex, got ${node?.kind}`)
  return node
}

function frame(body: string): string {
  return `<layer width="800" height="400" background="#0f1115" color="#ffffff">${body}</layer>`
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
  it('分数线在分子和分母之间，宽度跟较宽的一侧', async () => {
    const doc = await layoutSource(
      frame('<math><mfrac><mi>WWWW</mi><mi>i</mi></mfrac></math>'),
      process.cwd(),
    )
    const frac = flex(findByTag(doc.root, 'mfrac')[0])
    const [num, rule, den] = frac.children
    expect(num?.computed.fontSize).toBeCloseTo(40 * 0.85, 5)
    expect(den?.computed.fontSize).toBeCloseTo(40 * 0.85, 5)
    expect(rule?.tag).toBe('rule')
    expect(rule!.y).toBeGreaterThanOrEqual(num!.y + num!.height - 0.5)
    expect(den!.y).toBeGreaterThanOrEqual(rule!.y + rule!.height - 0.5)
    expect(rule!.y - (num!.y + num!.height)).toBeCloseTo(40 * 0.28, 1)
    expect(rule!.width).toBeCloseTo(Math.max(num!.width, den!.width), 3)
    expect(num!.width).toBeGreaterThan(den!.width)
  })

  it('msubsup 上下标在同一列，上标在上', async () => {
    const doc = await layoutSource(
      frame('<math><msubsup><mi>a</mi><mn>1</mn><mn>10</mn></msubsup></math>'),
      process.cwd(),
    )
    const node = flex(findByTag(doc.root, 'msubsup')[0])
    expect(node.direction).toBe('row')
    const base = node.children[0]!
    const scripts = flex(node.children[1])
    expect(scripts.direction).toBe('column')
    expect(scripts.children[0]!.x).toBe(scripts.children[1]!.x)
    expect(scripts.children[0]!.y).toBeLessThan(scripts.children[1]!.y)
    expect(scripts.children[0]!.computed.fontSize).toBeCloseTo(40 * 0.7, 5)
    expect(scripts.x).toBeGreaterThanOrEqual(base.x + base.width - 0.5)
  })

  it('求和的限在符号上下，不在右侧', async () => {
    const doc = await layoutSource(
      frame('<math><msubsup><mo>∑</mo><mi>i</mi><mi>n</mi></msubsup></math>'),
      process.cwd(),
    )
    const node = flex(findByTag(doc.root, 'msubsup')[0])
    expect(node.direction).toBe('column')
    const [sup, base, sub] = node.children
    expect(sup!.y + sup!.height).toBeCloseTo(base!.y, 1)
    expect(sub!.y).toBeCloseTo(base!.y + base!.height, 1)
    expect(sup!.x + sup!.width / 2).toBeCloseTo(base!.x + base!.width / 2, 0)
    expect(sub!.x + sub!.width / 2).toBeCloseTo(base!.x + base!.width / 2, 0)
  })

  it('极限在基座下方', async () => {
    const doc = await layoutSource(
      frame('<math><msub><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></msub></math>'),
      process.cwd(),
    )
    const node = flex(findByTag(doc.root, 'msub')[0])
    expect(node.direction).toBe('column')
    const [base, under] = node.children
    expect(under!.y).toBeGreaterThanOrEqual(base!.y + base!.height - 0.5)
    expect(under!.x + under!.width / 2).toBeCloseTo(base!.x + base!.width / 2, 0)
  })

  it('积分限在符号右侧，积分号更高', async () => {
    const doc = await layoutSource(
      frame('<math><mrow><msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><mi>x</mi></mrow></math>'),
      process.cwd(),
    )
    const node = flex(findByTag(doc.root, 'msubsup')[0])
    expect(node.direction).toBe('row')
    const base = node.children[0]!
    const scripts = node.children[1]!
    const integrand = findByTag(doc.root, 'mi').find((n) => n.text === 'x')
    expect(base.computed.fontSize).toBeCloseTo(40 * 1.35, 5)
    expect(base.text).toBe('∫')
    expect(scripts.x).toBeGreaterThanOrEqual(base.x + base.width - 0.5)
    expect(integrand).toBeTruthy()
    expect(integrand!.height).toBeLessThan(base.height)
    expect(integrand!.x).toBeGreaterThanOrEqual(node.x + node.width - 0.5)
  })

  it('根号宽度随内容变长，开方指数在左上', async () => {
    const doc = await layoutSource(
      frame(
        '<math><msqrt><mi>x</mi></msqrt><msqrt><mrow><mi>x</mi><mo>+</mo><mi>y</mi><mo>+</mo><mi>z</mi></mrow></msqrt><mroot><mi>x</mi><mn>3</mn></mroot></math>',
      ),
      process.cwd(),
    )
    const sq = findByTag(doc.root, 'msqrt')
    expect(sq.length).toBeGreaterThanOrEqual(2)
    expect(sq[1]!.width).toBeGreaterThan(sq[0]!.width)
    expect(sq[0]!.kind).toBe('sqrt')
    const root = flex(findByTag(doc.root, 'mroot')[0])
    expect(root.children[0]!.tag).toBe('mn')
    expect(root.children[0]!.computed.fontSize).toBeCloseTo(40 * 0.7, 5)
    expect(root.children[1]!.kind).toBe('sqrt')
    expect(root.children[0]!.x).toBeLessThan(root.children[1]!.x)
    expect(root.children[0]!.y).toBeLessThanOrEqual(root.children[1]!.y + 0.01)
  })

  it('矩阵有多行', async () => {
    const doc = await layoutSource(
      frame(
        '<math><mtable><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr><mtr><mtd><mi>c</mi></mtd><mtd><mi>d</mi></mtd></mtr></mtable></math>',
      ),
      process.cwd(),
    )
    const table = flex(findByTag(doc.root, 'mtable')[0])
    expect(table.direction).toBe('column')
    expect(table.children).toHaveLength(2)
    expect(table.children[1]!.y).toBeGreaterThan(table.children[0]!.y)
    const row0 = flex(table.children[0])
    expect(row0.children).toHaveLength(2)
    expect(row0.children[1]!.x).toBeGreaterThan(row0.children[0]!.x)
    expect(table.children[1]!.y - (table.children[0]!.y + table.children[0]!.height)).toBeCloseTo(40 * 0.2, 1)
    expect(row0.children[1]!.x - (row0.children[0]!.x + row0.children[0]!.width)).toBeCloseTo(40 * 0.45, 1)
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

  it('裸的 mfrac 仍是未知标签', async () => {
    const doc = await layoutSource(frame('<mfrac><mi>a</mi><mi>b</mi></mfrac>'), process.cwd())
    expect(doc.issues.some((i) => i.code === 'unknown-tag' && i.message.includes('mfrac'))).toBe(true)
  })

  it('分数线画在布局盒子里', async () => {
    const source = frame('<math><mfrac><mi>N</mi><mi>M</mi></mfrac></math>')
    const { png, report } = await renderFvg(source)
    const rule = report.elements.find((e) => e.tag === 'rule')
    expect(rule).toBeTruthy()
    const x = Math.round(rule!.ink.centerX)
    const y = Math.round(rule!.ink.centerY)
    const [r, g, b] = await pixelAt(png, x, y)
    expect(r + g + b).toBeGreaterThan(400)
  })
})
