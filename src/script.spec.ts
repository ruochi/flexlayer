import { beforeAll, describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { h } from './h.js'
import { initFontsForMeasure } from './fonts.js'
import { renderLayer } from './render.js'
import { emitLayer } from './emit.js'

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

function scene(script: string, extra = '') {
  return `<layer width="32" height="32" background="#000000">
    <canvas id="bar" x="4" y="4" width="16" height="16"></canvas>
    <script>
      ${script}
    </script>
    ${extra}
  </layer>`
}

describe('canvas 和 script', () => {
  it('脚本里的 ctx 可以 drawImage', async () => {
    const stamp = createCanvas(4, 4)
    const sctx = stamp.getContext('2d')
    sctx.fillStyle = '#ff0000'
    sctx.fillRect(0, 0, 4, 4)
    const root = h(
      'layer',
      { width: '16', height: '16', background: '#ffffff' },
      h('canvas', { id: 'bar', x: '6', y: '6', width: '4', height: '4' }),
      h('script', null, () => {
        const canvas = document.querySelector('#bar') as { getContext(type: '2d'): CanvasRenderingContext2D }
        canvas.getContext('2d').drawImage(stamp, 0, 0)
      }),
    )
    const { png } = await renderLayer(root, { scale: 1 })
    expect(await pixelAt(png, 7, 7)).toEqual([255, 0, 0, 255])
    expect(await pixelAt(png, 0, 0)).toEqual([255, 255, 255, 255])
  })

  it('立刻画和 requestAnimationFrame 都画在这一帧，下一轮 rAF 丢掉', async () => {
    const now: number[] = []
    const root = h(
      'layer',
      { width: '16', height: '16', background: '#000000' },
      h('canvas', { id: 'bar', width: '16', height: '16' }),
      h('script', null, () => {
        const canvas = document.querySelector('#bar') as {
          getContext(type: '2d'): CanvasRenderingContext2D
        }
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#0000ff'
        ctx.fillRect(0, 0, 16, 16)
        requestAnimationFrame((time: number) => {
          now.push(time)
          ctx.fillStyle = '#ff0000'
          ctx.fillRect(0, 0, 16, 16)
          requestAnimationFrame(() => {
            ctx.fillStyle = '#00ff00'
            ctx.fillRect(0, 0, 16, 16)
          })
        })
      }),
    )
    const { png } = await renderLayer(root, { t: 0.25, frame: 3, fps: 12 })
    expect(now).toEqual([250])
    expect(await pixelAt(png, 8, 8)).toEqual([255, 0, 0, 255])
  })

  it('getComputedStyle 给 CSS 字符串，改位图尺寸不改布局', async () => {
    const seen: { fontSize: string; color: string; rect: number; box: number }[] = []
    const root = h(
      'layer',
      { width: '80', height: '40', background: '#ffffff', color: '#111111' },
      h('canvas', { id: 'bar', x: '8', y: '4', width: '20', height: '10', style: 'font-size:48px; color:#ff0000' }),
      h('script', null, () => {
        const canvas = document.querySelector('#bar') as {
          width: number
          getBoundingClientRect(): { width: number }
          getContext(type: '2d'): CanvasRenderingContext2D
        }
        const style = getComputedStyle(canvas as unknown as Element)
        const before = canvas.getBoundingClientRect().width
        canvas.width = before * devicePixelRatio
        seen.push({
          fontSize: style.fontSize,
          color: style.color,
          rect: canvas.getBoundingClientRect().width,
          box: before,
        })
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#00ff00'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }),
    )
    const { png, report } = await renderLayer(root, { scale: 2 })
    expect(seen[0]).toEqual({ fontSize: '48px', color: '#ff0000', rect: 20, box: 20 })
    const laid = report.elements.find((el) => el.tag === 'canvas')
    expect(laid?.box.width).toBe(20)
    expect(await pixelAt(png, 20, 10)).toEqual([0, 255, 0, 255])
  })

  it('后面的 canvas 盖住前面的', async () => {
    const { png } = await renderLayer(`<layer width="24" height="24" background="#000">
      <canvas id="a" x="0" y="0" width="16" height="16"></canvas>
      <canvas id="b" x="8" y="8" width="16" height="16"></canvas>
      <script>
        const a = document.querySelector('#a')
        const b = document.querySelector('#b')
        a.getContext('2d').fillStyle = '#0000ff'
        a.getContext('2d').fillRect(0, 0, a.width, a.height)
        b.getContext('2d').fillStyle = '#ff0000'
        b.getContext('2d').fillRect(0, 0, b.width, b.height)
      </script>
    </layer>`)
    expect((await pixelAt(png, 2, 2))[2]).toBeGreaterThan(200)
    expect(await pixelAt(png, 12, 12)).toEqual([255, 0, 0, 255])
  })

  it('performance.now 和 Date.now 是帧时间，Math.random 可重复', async () => {
    const seen: number[] = []
    const root = h(
      'layer',
      { width: '8', height: '8', background: '#000' },
      h('canvas', { id: 'bar', width: '8', height: '8' }),
      h('script', null, () => {
        seen.push(performance.now(), Date.now())
        const canvas = document.querySelector('#bar') as { getContext(type: '2d'): CanvasRenderingContext2D }
        const ctx = canvas.getContext('2d')
        const n = Math.floor(Math.random() * 200) + 20
        ctx.fillStyle = `rgb(${n},0,0)`
        ctx.fillRect(0, 0, 8, 8)
      }),
    )
    const a = await renderLayer(root, { t: 1.5, frame: 4, fps: 10 })
    const b = await renderLayer(root, { t: 1.5, frame: 4, fps: 10 })
    const c = await renderLayer(root, { t: 0, frame: 0, fps: 10 })
    expect(seen.slice(0, 2)).toEqual([1500, 1500])
    expect(a.png.equals(b.png)).toBe(true)
    expect(a.png.equals(c.png)).toBe(false)
  })

  it('字符串脚本读不到文件，其余内容仍绘制', async () => {
    const { png, report } = await renderLayer(scene(
      `const fs = process.getBuiltinModule('node:fs')
       fs.readFileSync('/etc/passwd', 'utf8')`,
      '<rect x="0" y="0" width="4" height="4" fill="#00ff00" />',
    ))
    const hit = report.issues.find((issue) => issue.code === 'invalid-script')
    expect(hit?.level).toBe('error')
    expect(hit?.message).not.toContain('root:')
    expect((await pixelAt(png, 1, 1))[1]).toBeGreaterThan(200)
  })

  it('不支持的 DOM 报 unsupported-dom', async () => {
    const { report } = await renderLayer(scene(`document.createElement('div')`))
    const hit = report.issues.find((issue) => issue.code === 'unsupported-dom')
    expect(hit?.level).toBe('error')
    expect(hit?.hint).toContain('querySelector')
    expect(report.issues.some((issue) => issue.code === 'invalid-script')).toBe(false)
  })

  it('默认画布是 300×150', async () => {
    const { report } = await renderLayer(`<layer width="400" height="200"><canvas id="bar"></canvas></layer>`)
    const laid = report.elements.find((el) => el.tag === 'canvas')
    expect(laid?.box.width).toBe(300)
    expect(laid?.box.height).toBe(150)
  })

  it('style 宽高只改布局', async () => {
    const seen: { css: number; bitmap: number }[] = []
    const root = h(
      'layer',
      { width: '200', height: '80' },
      h('canvas', { id: 'bar', width: '40', height: '20', style: 'width:80px; height:30px' }),
      h('script', null, () => {
        const canvas = document.querySelector('#bar') as { width: number; getBoundingClientRect(): { width: number; height: number } }
        const rect = canvas.getBoundingClientRect()
        seen.push({ css: rect.width, bitmap: canvas.width })
        expect(rect.height).toBe(30)
      }),
    )
    const { report } = await renderLayer(root)
    expect(seen[0]).toEqual({ css: 80, bitmap: 40 })
    const laid = report.elements.find((el) => el.tag === 'canvas')
    expect(laid?.box.width).toBe(80)
    expect(laid?.box.height).toBe(30)
  })

  it('--no-script 跳过脚本，画布保持透明', async () => {
    const { png, report } = await renderLayer(scene(`const canvas = document.querySelector('#bar'); canvas.getContext('2d').fillStyle = '#ff0000'; canvas.getContext('2d').fillRect(0, 0, 16, 16)`), {
      noScript: true,
    })
    expect(report.issues).toContainEqual(expect.objectContaining({ level: 'info', message: '已跳过 script' }))
    expect(await pixelAt(png, 8, 8)).toEqual([0, 0, 0, 255])
  })

  it('<draw> 和 draw 回调都报错，图仍然出来', async () => {
    const tagged = await renderLayer(`<layer width="20" height="20" background="#fff"><draw>ctx.fillRect(0,0,1,1)</draw></layer>`)
    expect(tagged.report.issues).toContainEqual(expect.objectContaining({ code: 'invalid-child', message: '不再有 <draw>' }))
    expect(tagged.png[0]).toBe(0x89)
    const called = h('layer', { width: '20', height: '20' }, h('rect', { width: '10', height: '10', fill: '#fff', draw: () => {} }))
    const prog = await renderLayer(called)
    expect(prog.report.issues).toContainEqual(expect.objectContaining({ code: 'invalid-attr', message: '不再支持 draw 回调' }))
    const emitted = emitLayer(called)
    expect(emitted.issues.map((issue) => issue.code)).toContain('emit-draw')
    expect(emitted.source).not.toContain('<draw>')
  })

  it('dataset 是字符串', async () => {
    const seen: string[] = []
    const root = h(
      'layer',
      { width: '16', height: '16' },
      h('canvas', { id: 'bar', width: '8', height: '8', 'data-values': '3,5' }),
      h('script', null, () => {
        const canvas = document.querySelector('#bar') as { dataset: { values: string } }
        seen.push(canvas.dataset.values)
      }),
    )
    await renderLayer(root)
    expect(seen).toEqual(['3,5'])
  })
})

declare const document: { querySelector(selector: string): unknown }
declare const devicePixelRatio: number
declare function requestAnimationFrame(callback: (time: number) => void): number
declare function getComputedStyle(el: Element): { fontSize: string; color: string }
