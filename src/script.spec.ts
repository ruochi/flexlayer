import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { h } from './h.js'
import { initFontsForMeasure } from './fonts.js'
import { renderLayer } from './render.js'
import { emitLayer } from './emit.js'
import { scriptChildArgs, scriptPermissionFlags, scriptReadGrants } from './run-scripts.js'

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

  it('Node 20 读宿主每一级 package.json 时路径已放行', () => {
    const host = fileURLToPath(new URL('./canvas-dom.mjs', import.meta.url))
    const grants = scriptReadGrants(host)
    expect(grants).toContain(join(dirname(host), 'package.json'))
    expect(grants).toContain(join(dirname(dirname(host)), 'package.json'))
    expect(grants).toContain(join(dirname(host), 'node_modules'))
    expect(grants).toContain(`${join(dirname(host), 'node_modules')}/*`)
    expect(grants.some((grant) => grant.endsWith(`${join('@napi-rs', 'canvas', 'index.js')}`))).toBe(true)
    expect(grants.some((grant) => grant === '/etc/passwd' || grant.startsWith('/etc/'))).toBe(false)
  })

  it('没有 --allow-addons 的 Node 不开权限模型', () => {
    expect(scriptPermissionFlags('20.11.1', false)).toEqual([])
    expect(scriptPermissionFlags('20.9.0', false)).toEqual([])
    expect(scriptPermissionFlags('20.12.2', true)).toEqual(['--experimental-permission', '--allow-addons'])
    expect(scriptPermissionFlags('21.6.2', false)).toEqual([])
    expect(scriptPermissionFlags('22.14.0', true)).toEqual(['--permission', '--allow-addons'])
    expect(scriptPermissionFlags('24.10.0', true)).toEqual(['--permission', '--allow-addons'])
    const args = scriptChildArgs(fileURLToPath(new URL('./canvas-dom.mjs', import.meta.url)))
    if (scriptPermissionFlags(process.versions.node, args[0]?.startsWith('--') ?? false).length === 0) {
      expect(args).toEqual([fileURLToPath(new URL('./canvas-dom.mjs', import.meta.url))])
    } else {
      expect(args[0]).toMatch(/--(experimental-)?permission/)
      expect(args).toContain('--allow-addons')
    }
  })

  it('读权限不会在 Node 20 上把同一条前缀插两次', () => {
    const host = fileURLToPath(new URL('./canvas-dom.mjs', import.meta.url))
    const grants = scriptReadGrants(host)
    expect(grants.length).toBeGreaterThan(0)
    const inserted = grants.map((grant) => {
      expect(grant.startsWith('/')).toBe(true)
      expect(grant).not.toBe('/')
      expect(grant.includes('**')).toBe(false)
      expect(grant).not.toBe('*')
      try {
        if (statSync(grant).isDirectory()) return grant.endsWith('/') ? `${grant}*` : `${grant}/*`
      } catch {
        // 不存在的路径原样插入，Node 不会再加通配。
      }
      return grant
    })
    expect(new Set(inserted).size).toBe(inserted.length)
  })

  it('node_modules 是符号链接时仍能跑 .layer 脚本', () => {
    const root = mkdtempSync(join(tmpdir(), 'flexlayer-link-'))
    try {
      const store = join(root, 'store')
      const app = join(root, 'app')
      mkdirSync(join(app, 'src'), { recursive: true })
      mkdirSync(join(app, 'node_modules', '@napi-rs'), { recursive: true })
      mkdirSync(store, { recursive: true })
      const realRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@napi-rs')
      symlinkSync(join(realRoot, 'canvas'), join(store, 'canvas'))
      symlinkSync(join(store, 'canvas'), join(app, 'node_modules', '@napi-rs', 'canvas'))
      const host = join(app, 'src', 'canvas-dom.mjs')
      writeFileSync(host, readFileSync(new URL('./canvas-dom.mjs', import.meta.url)))
      writeFileSync(join(app, 'src', 'webgl-fake.mjs'), readFileSync(new URL('./webgl-fake.mjs', import.meta.url)))
      writeFileSync(join(app, 'src', 'tri-raster.mjs'), readFileSync(new URL('./tri-raster.mjs', import.meta.url)))
      writeFileSync(join(app, 'src', 'native-loader.mjs'), readFileSync(new URL('./native-loader.mjs', import.meta.url)))
      const grants = scriptReadGrants(host)
      expect(grants).toContain(join(app, 'node_modules', '@napi-rs', 'canvas', 'package.json'))
      expect(grants).toContain(join(realRoot, 'canvas', 'package.json'))
      const nativeFile = grants.find((grant) => grant.endsWith('.node') && existsSync(grant))
      expect(nativeFile).toBeTruthy()
      const payload = JSON.stringify({
        canvases: [{ path: 'layer/canvas[0]', id: 'bar', width: 4, height: 4, bitmapWidth: 4, bitmapHeight: 4, x: 0, y: 0, style: {}, computed: {}, text: '', attrs: {} }],
        scripts: [{ path: 'layer/script[0]', body: 'const c=document.querySelector("#bar"); const x=c.getContext("2d"); x.fillStyle="#ff0000"; x.fillRect(0,0,4,4)' }],
        timeMs: 0,
        fps: 0,
        frame: 0,
        dpr: 1,
        seed: 1,
        sources: {},
      })
      const result = spawnSync(process.execPath, scriptChildArgs(host), {
        input: payload,
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', NAPI_RS_NATIVE_LIBRARY_PATH: nativeFile },
      })
      expect(result.stderr).not.toContain('Access to this API has been restricted')
      expect(result.status).toBe(0)
      const out = JSON.parse(result.stdout) as { issues: unknown[]; canvases: Array<{ rgba: string }> }
      expect(out.issues).toEqual([])
      expect(Buffer.from(out.canvases[0]!.rgba, 'base64')[0]).toBe(255)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('node_modules 整目录或 pnpm 虚拟目录是符号链接时脚本仍能画', () => {
    const root = mkdtempSync(join(tmpdir(), 'flexlayer-link-'))
    const realRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@napi-rs')
    const hostSrc = readFileSync(new URL('./canvas-dom.mjs', import.meta.url))
    const webglSrc = readFileSync(new URL('./webgl-fake.mjs', import.meta.url))
    const rasterSrc = readFileSync(new URL('./tri-raster.mjs', import.meta.url))
    const loaderSrc = readFileSync(new URL('./native-loader.mjs', import.meta.url))
    const payload = JSON.stringify({
      canvases: [{ path: 'layer/canvas[0]', id: 'bar', width: 4, height: 4, bitmapWidth: 4, bitmapHeight: 4, x: 0, y: 0, style: {}, computed: {}, text: '', attrs: {} }],
      scripts: [{ path: 'layer/script[0]', body: 'const c=document.querySelector("#bar"); const x=c.getContext("2d"); x.fillStyle="#ff0000"; x.fillRect(0,0,4,4)' }],
      timeMs: 0,
      fps: 0,
      frame: 0,
      dpr: 1,
      seed: 1,
      sources: {},
    })
    const paint = (host: string) => {
      const grants = scriptReadGrants(host)
      const nativeFile = grants.find((grant) => grant.endsWith('.node') && existsSync(grant))
      return spawnSync(process.execPath, scriptChildArgs(host), {
        input: payload,
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', NAPI_RS_NATIVE_LIBRARY_PATH: nativeFile },
      })
    }
    try {
      const store = join(root, 'store')
      const app = join(root, 'whole')
      mkdirSync(join(store, '@napi-rs'), { recursive: true })
      mkdirSync(join(app, 'src'), { recursive: true })
      const nativeName = readdirSync(realRoot).find((name) => name.startsWith('canvas-'))
      expect(nativeName).toBeTruthy()
      symlinkSync(join(realRoot, 'canvas'), join(store, '@napi-rs', 'canvas'))
      symlinkSync(join(realRoot, nativeName!), join(store, '@napi-rs', nativeName!))
      symlinkSync(store, join(app, 'node_modules'))
      const host = join(app, 'src', 'canvas-dom.mjs')
      writeFileSync(host, hostSrc)
      writeFileSync(join(app, 'src', 'webgl-fake.mjs'), webglSrc)
      writeFileSync(join(app, 'src', 'tri-raster.mjs'), rasterSrc)
      writeFileSync(join(app, 'src', 'native-loader.mjs'), loaderSrc)
      const whole = paint(host)
      expect(whole.stderr).not.toContain('Access to this API has been restricted')
      expect(whole.status).toBe(0)

      const pnpm = join(root, 'pnpm', 'node_modules', '.pnpm')
      const canvasVirt = join(pnpm, '@napi-rs+canvas@1.0.9', 'node_modules', '@napi-rs')
      const nativeVirt = join(pnpm, `@napi-rs+${nativeName}@1.0.9`, 'node_modules', '@napi-rs')
      const pnpmApp = join(root, 'pnpm')
      mkdirSync(canvasVirt, { recursive: true })
      mkdirSync(nativeVirt, { recursive: true })
      mkdirSync(join(pnpmApp, 'node_modules', '@napi-rs'), { recursive: true })
      mkdirSync(join(pnpmApp, 'src'), { recursive: true })
      symlinkSync(join(realRoot, 'canvas'), join(canvasVirt, 'canvas'))
      symlinkSync(join(realRoot, nativeName!), join(nativeVirt, nativeName!))
      symlinkSync(join(canvasVirt, 'canvas'), join(pnpmApp, 'node_modules', '@napi-rs', 'canvas'))
      symlinkSync(join(nativeVirt, nativeName!), join(pnpmApp, 'node_modules', '@napi-rs', nativeName!))
      symlinkSync(join(nativeVirt, nativeName!), join(canvasVirt, nativeName!))
      const pnpmHost = join(pnpmApp, 'src', 'canvas-dom.mjs')
      writeFileSync(pnpmHost, hostSrc)
      writeFileSync(join(pnpmApp, 'src', 'webgl-fake.mjs'), webglSrc)
      writeFileSync(join(pnpmApp, 'src', 'tri-raster.mjs'), rasterSrc)
      writeFileSync(join(pnpmApp, 'src', 'native-loader.mjs'), loaderSrc)
      const nested = paint(pnpmHost)
      expect(nested.stderr).not.toContain('Access to this API has been restricted')
      expect(nested.status).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('webgl 清屏画进画布位图', async () => {
    const { png, report } = await renderLayer(scene(
      `const gl = document.querySelector('#bar').getContext('webgl2')
       gl.clearColor(0, 0, 1, 1)
       gl.clear(gl.COLOR_BUFFER_BIT)`,
    ))
    expect(report.issues.filter((issue) => issue.level === 'error')).toEqual([])
    expect(await pixelAt(png, 12, 12)).toEqual([0, 0, 255, 255])
  })

  it('没有矩阵时 webgl 三角形按像素坐标画', async () => {
    const { png, report } = await renderLayer(scene(
      `const gl = document.querySelector('#bar').getContext('webgl')
       const buf = gl.createBuffer()
       gl.bindBuffer(gl.ARRAY_BUFFER, buf)
       gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 16, 0, 8, 16]), gl.STATIC_DRAW)
       gl.enableVertexAttribArray(0)
       gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
       gl.vertexAttrib4f(1, 1, 0, 0, 1)
       gl.drawArrays(gl.TRIANGLES, 0, 3)`,
    ))
    expect(report.issues.filter((issue) => issue.level === 'error')).toEqual([])
    expect(await pixelAt(png, 12, 10)).toEqual([255, 0, 0, 255])
    expect(await pixelAt(png, 4, 18)).toEqual([0, 0, 0, 255])
  })

  it('webgl 三角形斜边按覆盖混合，不是阶梯', async () => {
    const { png, report } = await renderLayer(scene(
      `const gl = document.querySelector('#bar').getContext('webgl')
       gl.clearColor(0, 0, 0, 1)
       gl.clear(gl.COLOR_BUFFER_BIT)
       const buf = gl.createBuffer()
       gl.bindBuffer(gl.ARRAY_BUFFER, buf)
       gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 16, 0, 0, 16]), gl.STATIC_DRAW)
       gl.enableVertexAttribArray(0)
       gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
       gl.vertexAttrib4f(1, 1, 0, 0, 1)
       gl.drawArrays(gl.TRIANGLES, 0, 3)`,
    ))
    expect(report.issues.filter((issue) => issue.level === 'error')).toEqual([])
    const inside = await pixelAt(png, 6, 6)
    expect(inside).toEqual([255, 0, 0, 255])
    const img = await loadImage(png)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    let partial = 0
    for (let y = 4; y < 20; y++) {
      for (let x = 4; x < 20; x++) {
        const red = ctx.getImageData(x, y, 1, 1).data[0]!
        if (red > 8 && red < 247) partial++
      }
    }
    expect(partial).toBeGreaterThan(4)
  })

  it('three.js WebGLRenderer 画进 canvas，明暗用我们的主光', async () => {
    const THREE = await import('three')
    const root = h(
      'layer',
      { width: '64', height: '64', background: '#000000' },
      h('canvas', { id: 'bar', width: '64', height: '64' }),
      h('script', null, () => {
        const canvas = document.querySelector('#bar') as HTMLCanvasElement
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false })
        renderer.setSize(64, 64, false)
        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20)
        camera.position.set(0.4, 0.3, 2.4)
        camera.lookAt(0, 0, 0)
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshLambertMaterial({ color: 0xff2244 }),
        )
        scene.add(mesh)
        renderer.render(scene, camera)
      }),
    )
    const { png, report } = await renderLayer(root)
    const errors = report.issues.filter((issue) => issue.level === 'error')
    expect(errors).toEqual([])
    const center = await pixelAt(png, 32, 32)
    const corner = await pixelAt(png, 2, 2)
    expect(center[0]).toBeGreaterThan(180)
    expect(center[3]).toBe(255)
    expect(corner[0]).toBeLessThan(40)
  })
})

declare const document: { querySelector(selector: string): unknown }
declare const devicePixelRatio: number
declare function requestAnimationFrame(callback: (time: number) => void): number
declare function getComputedStyle(el: Element): { fontSize: string; color: string }
