import { beforeAll, describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { h } from './h.js'
import { initFontsForMeasure } from './fonts.js'
import { layoutSource } from './layout.js'
import { renderFvg } from './render.js'

const pkgDir = join(fileURLToPath(import.meta.url), '..', '..')
const helloPath = join(pkgDir, 'examples', 'hello.layer')

beforeAll(async () => {
  for (const dir of [join(homedir(), '.cache', 'flexlayer', 'fonts'), '/tmp/flexlayer-test']) {
    if (await initFontsForMeasure({ fontsCacheDir: dir })) break
  }
})

async function pixelAt(png: Buffer, x: number, y: number): Promise<[number, number, number, number]> {
  const img = await loadImage(png)
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(x, y, 1, 1).data
  return [d[0]!, d[1]!, d[2]!, d[3]!]
}

describe('draw(ctx, el)', () => {
  it('h1 draw 收到 attr、style、computed 并在底边着色', async () => {
    let seen: Record<string, unknown> | null = null

    const root = h(
      'layer',
      { width: '400', height: '300', background: '#ffffff', color: '#111111' },
      h(
        'h1',
        {
          cx: '200',
          cy: '150',
          anchor: 'center',
          style: 'font-size:48px; color:#ff0000',
          draw: (ctx, el) => {
            seen = {
              cx: el.attr.cx,
              color: el.computed.color,
              fontSize: el.computed.fontSize,
              w: el.w,
              h: el.h,
            }
            ctx.strokeStyle = '#00ff00'
            ctx.lineWidth = 4
            ctx.beginPath()
            ctx.moveTo(0, el.h - 2)
            ctx.lineTo(el.w, el.h - 2)
            ctx.stroke()
          },
        },
        'Hi',
      ),
    )

    const { png } = await renderFvg(root, { scale: 1 })
    expect(seen).toMatchObject({
      cx: '200',
      color: '#ff0000',
      fontSize: 48,
    })
    expect((seen as { w: number }).w).toBeGreaterThan(0)
    expect((seen as { h: number }).h).toBeGreaterThan(0)

    const doc = await layoutSource(root, process.cwd())
    const node = doc.root.children[0]!
    const px = Math.round(node.x + node.width / 2)
    const py = Math.round(node.y + node.height - 2)
    const [r, g, b, a] = await pixelAt(png, px, py)
    expect(a).toBeGreaterThan(200)
    expect(g).toBeGreaterThan(200)
    expect(r).toBeLessThan(50)
    expect(b).toBeLessThan(50)
  })

  it('未知标签带 draw 与尺寸时参与布局', async () => {
    let drawCalled = false
    const root = h(
      'layer',
      { width: '200', height: '200', background: '#000000' },
      h(
        'Ring',
        {
          x: '60',
          y: '60',
          width: '80',
          height: '80',
          draw: (ctx, el) => {
            drawCalled = true
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, el.w, el.h)
          },
        },
      ),
    )

    const doc = await layoutSource(root, process.cwd())
    const laid = doc.root.children[0]!
    expect(laid.kind).toBe('custom')
    expect(laid.width).toBe(80)
    expect(typeof laid.draw).toBe('function')

    const { png, report } = await renderFvg(root)
    expect(drawCalled).toBe(true)
    expect(report.issues.some((i) => i.code === 'unknown-tag')).toBe(false)
    const ring = report.elements.find((e) => e.tag === 'Ring')
    expect(ring).toBeTruthy()
    const cx = Math.round((ring!.box.left + ring!.box.right) / 2)
    const cy = Math.round((ring!.box.top + ring!.box.bottom) / 2)
    const [r, g, b] = await pixelAt(png, cx, cy)
    expect(r + g + b).toBeGreaterThan(400)
  })

  it('线条上的 draw 原点在几何范围的左上角', async () => {
    let seen: { w: number; h: number } | null = null
    const root = h(
      'layer',
      { width: '200', height: '80', background: '#000000' },
      h('line', {
        x1: '20',
        y1: '40',
        x2: '120',
        y2: '40',
        stroke: '#ffffff',
        'stroke-width': '4',
        draw: (_ctx, el) => {
          seen = { w: el.w, h: el.h }
        },
      }),
    )
    const { png } = await renderFvg(root)
    expect(seen).toEqual({ w: 100, h: 0 })
    const doc = await layoutSource(root, process.cwd())
    const line = doc.root.children[0]!
    expect(line.x).toBe(20)
    expect(line.y).toBe(40)
    expect((await pixelAt(png, 40, 40))[0]).toBeGreaterThan(200)
  })

  it('形状上的自定义属性出现在 el.attr', async () => {
    let total = ''
    const root = h(
      'layer',
      { width: '80', height: '80' },
      h('rect', {
        x: '30',
        y: '35',
        width: '20',
        height: '10',
        'data-total': '33',
        draw: (_ctx, el) => {
          total = el.attr['data-total'] ?? ''
        },
      }),
    )
    await renderFvg(root)
    expect(total).toBe('33')
  })

  it('根节点 layer 的 draw 在子元素之后执行', async () => {
    let seen: { w: number; h: number; t: number } | null = null
    let childAtDraw: number[] | null = null
    const root = h(
      'layer',
      {
        width: '80',
        height: '40',
        background: '#000000',
        draw: (ctx, el) => {
          seen = { w: el.w, h: el.h, t: el.t }
          const px = ctx.getImageData(70, 20, 1, 1).data
          childAtDraw = [px[0]!, px[1]!, px[2]!]
          ctx.fillStyle = '#ff0000'
          ctx.fillRect(0, 0, 4, 4)
        },
      },
      h('rect', { x: '65', y: '15',  width: '10', height: '10', fill: '#00ff00' }),
    )

    const { png } = await renderFvg(root, { t: 0.25 })
    expect(seen).toEqual({ w: 80, h: 40, t: 0.25 })
    expect(childAtDraw![1]).toBeGreaterThan(200)
    const corner = await pixelAt(png, 1, 1)
    expect(corner[0]).toBeGreaterThan(200)
    expect(corner[1]).toBeLessThan(40)
    expect(corner[2]).toBeLessThan(40)
    const child = await pixelAt(png, 70, 20)
    expect(child[1]).toBeGreaterThan(200)
    expect(child[0]).toBeLessThan(40)
    expect(child[2]).toBeLessThan(40)
  })

  it('hello.layer 无 draw 时结果不变', async () => {
    const source = await readFile(helloPath, 'utf8')
    const { report } = await renderFvg(source, {
      baseDir: join(pkgDir, 'examples'),
    })
    expect(report.width).toBe(1080)
    expect(report.height).toBe(1920)
    expect(report.elements.length).toBeGreaterThan(0)
  })

  it('.layer 里的 <draw> 在子元素之后着色', async () => {
    const { png, report } = await renderFvg(
      `<layer width="80" height="40" background="#000000">
        <rect x="65" y="15" width="10" height="10" fill="#00ff00" />
        <draw>
          ctx.fillStyle = '#ff0000'
          ctx.fillRect(0, 0, 4, 4)
        </draw>
      </layer>`,
    )
    expect(report.issues.some((i) => i.code === 'invalid-draw')).toBe(false)
    const corner = await pixelAt(png, 1, 1)
    expect(corner[0]).toBeGreaterThan(200)
    expect(corner[1]).toBeLessThan(40)
    const child = await pixelAt(png, 70, 20)
    expect(child[1]).toBeGreaterThan(200)
  })

  it('嵌套 layer 用 <draw> 填色，不用 background', async () => {
    const { png, report } = await renderFvg(
      `<layer width="60" height="40" background="#0000ff">
        <layer x="0" y="5" width="30" height="30">
          <draw>
            ctx.fillStyle = '#ff0000'
            ctx.fillRect(0, 0, el.w, el.h)
          </draw>
        </layer>
      </layer>`,
    )
    expect(report.issues.some((i) => i.message.includes('background'))).toBe(false)
    const red = await pixelAt(png, 15, 20)
    expect(red[0]).toBeGreaterThan(200)
    expect(red[2]).toBeLessThan(40)
    const blue = await pixelAt(png, 50, 20)
    expect(blue[2]).toBeGreaterThan(200)
    expect(blue[0]).toBeLessThan(40)
  })

  it('<draw> 语法错误报 invalid-draw', async () => {
    const { report } = await renderFvg(
      `<layer width="40" height="40" background="#000">
        <draw>ctx.fillStyle = </draw>
      </layer>`,
    )
    expect(report.issues.some((i) => i.code === 'invalid-draw' && i.level === 'error')).toBe(true)
  })
})
