import { copyFileSync, existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { chdir } from 'node:process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mergeFrameIssues, sampleFrames } from './check-frames.js'
import { emitLayer } from './emit.js'
import { h } from './h.js'
import { Fragment, jsx, jsxDEV, type JsxSource } from './jsx-runtime.js'
import { loadLayerFile } from './load-source.js'
import { checkFvg, renderFvg } from './render.js'
import { nondeterministicCalls, readDrawFunction } from './syntax.js'
import { typecheckLayerFile } from './typecheck.js'

const pkgDir = join(fileURLToPath(import.meta.url), '..', '..')

const at = (line: number, column = 1): JsxSource => ({
  fileName: join(pkgDir, 'examples', 't.tsx'),
  lineNumber: line,
  columnNumber: column,
})

describe('jsx 运行时', () => {
  it('展开函数组件、片段，并把 style 对象收成字符串', () => {
    function Pill(props: { text: string }) {
      return jsx('div', { style: { fontSize: 32, color: '#fff' }, children: props.text })
    }
    const node = jsx('layer', {
      width: 10,
      height: 10,
      children: [jsx(Fragment, { children: [jsx(Pill, { text: '甲' }), null] }), false],
    })
    expect(node && !Array.isArray(node) && node.tag).toBe('layer')
    if (!node || Array.isArray(node)) return
    const div = node.children[0]
    expect(typeof div).not.toBe('string')
    if (typeof div === 'string') return
    expect(div.tag).toBe('div')
    expect(div.attrs.style).toBe('font-size:32; color:#fff')
    expect(div.children).toEqual(['甲'])
  })

  it('jsxDEV 把文件和行号记在节点上', () => {
    const node = jsxDEV('circle', { cx: 1, cy: 2, r: 3 }, undefined, false, at(18, 5), undefined)
    expect(node && !Array.isArray(node) && node.loc).toEqual({
      file: join(pkgDir, 'examples', 't.tsx'),
      line: 18,
      column: 5,
    })
  })
})

function typeMessages(file: string): string[] {
  return typecheckLayerFile(file).map((issue) => issue.message)
}

describe('JSX 类型', () => {
  it('examples 里的 .tsx 通过类型检查', () => {
    for (const name of ['hello.tsx', 'slide.tsx', 'poster.tsx']) {
      expect(typeMessages(join(pkgDir, 'examples', name)), name).toEqual([])
    }
  })

  it('仓库外的目录也能认到数组和 Math', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-outside-'))
    const file = join(dir, 'hello.tsx')
    await writeFile(
      file,
      `const tags = ['甲', '乙']
      export default (
        <layer width="32" height="32" background="#000">
          {tags.map((text, i) => <circle key={text} cx={8 + i * 12} cy={Math.min(16, 20)} r="4" fill="#fff" />)}
        </layer>
      )
      `,
    )
    expect(typeMessages(file)).toEqual([])
  })

  it('import 可以带 .tsx 扩展名', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-import-'))
    await writeFile(join(dir, 'piece.tsx'), `export const title = '甲'\n`)
    const file = join(dir, 'main.tsx')
    await writeFile(
      file,
      `import { title } from './piece.tsx'
      export default <layer width="32" height="32"><p style="font-size:12px">{title}</p></layer>
      `,
    )
    expect(typeMessages(file)).toEqual([])
  })

  it('线条可以写 stroke，不认识的属性留给 draw', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-stroke-'))
    const file = join(dir, 'lines.tsx')
    await writeFile(
      file,
      `export default (
        <layer width="80" height="40">
          <polyline points="0,0 10,10" stroke="#fff" strokeWidth="2" />
          <polygon points="0,0 10,0 10,10" stroke="#fff" strokeWidth="2" fill="none" />
          <path d="M0 0 L10 10" stroke="#fff" strokeWidth="2" />
          <rect width="10" height="10" fill="#fff" bogus="1" />
        </layer>
      )
      `,
    )
    expect(typeMessages(file)).toEqual([])
  })

  it('可以引用 node:fs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-node-'))
    const file = join(dir, 'read.tsx')
    await writeFile(
      file,
      `import { readFileSync } from 'node:fs'
      const title = readFileSync('title.txt', 'utf8')
      export default <layer width="32" height="32"><p style="font-size:12px">{title}</p></layer>
      `,
    )
    expect(typeMessages(file)).toEqual([])
  })

  it('rect 可以写 rotate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-rotate-'))
    const file = join(dir, 'spin.tsx')
    await writeFile(
      file,
      `export default <layer width="40" height="40"><rect x="15" y="18" width="10" height="4" rotate="15" fill="#fff" /></layer>\n`,
    )
    expect(typeMessages(file)).toEqual([])
  })

  it('HTML 上的 fill、stroke、points、d 报 invalid-attr', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-html-attr-'))
    const file = join(dir, 'ink.tsx')
    await writeFile(
      file,
      `export default (
        <layer width="80" height="40" background="#000">
          <p fill="#fff" stroke="#000" points="0,0 1,1" d="M0 0" style="font-size:16px">字</p>
          <circle cx="20" cy="20" r="8" fill="#fff" />
        </layer>
      )
      `,
    )
    expect(typecheckLayerFile(file)).toEqual([])
    const loaded = await loadLayerFile(file)
    expect(loaded.kind).toBe('node')
    if (loaded.kind !== 'node') return
    const report = await checkFvg(loaded.node, { baseDir: dir })
    const html = report.issues.filter((issue) => issue.code === 'invalid-attr' && issue.path.includes('p['))
    expect(html.map((issue) => issue.message).join(' ')).toMatch(/fill/)
    expect(html.map((issue) => issue.message).join(' ')).toMatch(/stroke/)
    expect(html.map((issue) => issue.message).join(' ')).toMatch(/points/)
    expect(html.map((issue) => issue.message).join(' ')).toMatch(/d/)
    expect(report.issues.some((issue) => issue.code === 'invalid-attr' && issue.path.includes('circle['))).toBe(false)
  })

  it('写错位置的属性由检查报 invalid-attr，类型检查不报', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-types-'))
    const cases = [
      [`export default <layer width="10" height="10"><p cx="3">hi</p></layer>\n`, '外包的 layer'],
      [`export default <layer width="10" height="10"><circle cx="4" cy="4" r="2" style="fill:#fff" /></layer>\n`, '不使用 style'],
      [`export default <layer width="10" height="10"><p font-size="40">hi</p></layer>\n`, '应写在 style'],
    ] as const
    for (let i = 0; i < cases.length; i++) {
      const [source, token] = cases[i]!
      const file = join(dir, `bad-${i}.tsx`)
      await writeFile(file, source)
      expect(typeMessages(file), token).toEqual([])
      const loaded = await loadLayerFile(file)
      expect(loaded.kind).toBe('node')
      if (loaded.kind !== 'node') continue
      const report = await checkFvg(loaded.node, { baseDir: dir })
      const text = report.issues
        .filter((issue) => issue.code === 'invalid-attr')
        .map((issue) => `${issue.message} ${issue.hint ?? ''}`)
      expect(text.some((message) => message.includes(token)), token).toBe(true)
    }
  })
})

describe('emitLayer', () => {
  it('只使用 ctx 和 el 的 draw 写回 <draw>', () => {
    const node = h(
      'layer',
      { width: '40', height: '20', background: '#000' },
      h('rect', {
        width: '10',
        height: '10',
        fill: '#fff',
        draw: (ctx, el) => {
          const color = '#fff'
          ctx.fillStyle = color
          ctx.fillRect(0, 0, el.w, el.h)
        },
      }),
    )
    const emitted = emitLayer(node)
    expect(emitted.issues).toEqual([])
    expect(emitted.source).toContain('<draw>')
    expect(emitted.source).toContain('ctx.fillRect(0, 0, el.w, el.h)')
  })

  it('引用外部变量时告警', () => {
    const color = '#fff'
    const node = h(
      'rect',
      {
        width: '10',
        height: '10',
        draw: (ctx, el) => {
          ctx.fillStyle = color
          ctx.fillRect(0, 0, el.w, el.h)
        },
      },
    )
    const emitted = emitLayer(node)
    expect(emitted.issues.map((issue) => issue.code)).toContain('emit-draw')
    expect(emitted.source).not.toContain('<draw>')
    expect(emitted.source).not.toContain('color')
  })

  it('同一行声明的多个变量不算外部引用', () => {
    const node = h('rect', {
      width: '10',
      height: '10',
      draw: (ctx, el) => {
        const r = 58, c = 75
        ctx.fillRect(c, r, el.w, el.h)
      },
    })
    expect(emitLayer(node).issues).toEqual([])
  })

  it('注释、字符串和换行后的第二个声明不是外部变量', () => {
    const read = readDrawFunction(`(ctx, el) => {
      // color
      const label = 'palette'
      const a =
        1, b = 2
      const { w: width } = el
      ctx.fillRect(b, a, width, el.h)
      void label
    }`)
    expect(read?.free).toEqual([])
    expect(nondeterministicCalls(`const label = 'Math.random()'\n// Date.now()\ntype Now = typeof Date.now\n`, 'quiet.tsx')).toEqual([])
    expect(nondeterministicCalls(`const n = Date.now()\n`, 'clock.ts').map((call) => call.name)).toEqual(['Date.now'])
    expect(
      nondeterministicCalls(
        `const rnd = Math.random\nrnd()\nMath['random']()\nMath["random"]()\nconst { random } = Math\nrandom()\nconst { now: clock } = Date\nclock()\nconst again = rnd\nagain()\n`,
        'alias.tsx',
      ).map((call) => call.name),
    ).toEqual(['Math.random', 'Math.random', 'Math.random', 'Math.random', 'Date.now', 'Math.random'])
    expect(
      nondeterministicCalls(`const rnd = Math.random\nfunction f(rnd: () => number) { rnd() }\n`, 'shadow.tsx'),
    ).toEqual([])
  })

  it('换行声明、解构和内层函数都不算外部变量', () => {
    const node = h('rect', {
      width: '10',
      height: '10',
      draw: (ctx, el) => {
        const a =
          1, b = 2
        const { w: width } = el
        const label = 'color'
        // palette
        function paint() {
          ctx.fillStyle = label
          ctx.fillRect(b, a, width, el.h)
        }
        paint()
      },
    })
    expect(emitLayer(node).issues).toEqual([])
  })

  it('文字和表达式挨在一起时，写回的 .layer 不插入空格', async () => {
    const node = h('layer', { width: '240', height: '80' }, h('p', { style: 'font-size:24px' }, "'{}'", ' ×', '3', '个'))
    const emitted = emitLayer(node)
    expect(emitted.issues).toEqual([])
    const report = await checkFvg(emitted.source)
    const text = report.elements.find((el) => el.tag === 'p')?.lines?.map((line) => line.text).join('\n')
    expect(text).toBe("'{}' ×3个")
  })

  it('<draw> 引用外部变量时不让整张图退出', async () => {
    const source = `<layer width="40" height="40" background="#000">\n  <rect width="10" height="10" fill="#fff">\n    <draw>\nctx.fillStyle = OUT\n</draw>\n  </rect>\n</layer>`
    const report = await checkFvg(source)
    const issue = report.issues.find((item) => item.code === 'invalid-draw')
    expect(issue?.level).toBe('error')
    expect(issue?.message).toContain('OUT')
    expect(issue?.path).toBe('layer/rect[0]/draw[0]')
    expect(issue?.source).toBe('3:5')
    const { renderFvg } = await import('./render.js')
    await expect(renderFvg(source)).resolves.toMatchObject({ png: expect.any(Buffer) })
  })
})

describe('load .tsx', () => {
  it('hello.tsx 展开后能检查，报告带源码位置', async () => {
    const loaded = await loadLayerFile(join(pkgDir, 'examples', 'hello.tsx'))
    expect(loaded.kind).toBe('node')
    if (loaded.kind !== 'node') return
    const report = await checkFvg(loaded.node, { baseDir: join(pkgDir, 'examples') })
    expect(report.width).toBe(1080)
    expect(report.height).toBe(1920)
    expect(report.issues.filter((issue) => issue.level === 'error')).toEqual([])
    const titled = report.elements.find((el) => el.tag === 'h1')
    expect(titled?.source).toMatch(/hello\.tsx:\d+:\d+/)
    const emitted = emitLayer(loaded.node)
    expect(emitted.source).toContain('比特币减半')
    expect(emitted.source).toContain('3.125 BTC')
    expect(emitted.issues).toEqual([])
    const again = await checkFvg(emitted.source, { baseDir: join(pkgDir, 'examples') })
    expect(again.issues.filter((issue) => issue.level === 'error')).toEqual([])
  })

  it('slide.tsx 是 Composition，帧之间位置不同', async () => {
    const loaded = await loadLayerFile(join(pkgDir, 'examples', 'slide.tsx'))
    expect(loaded.kind).toBe('composition')
    if (loaded.kind !== 'composition') return
    const { composition } = loaded
    const a = composition.component({ frame: 0, fps: composition.fps, t: 0 })
    const b = composition.component({ frame: 1, fps: composition.fps, t: 0.25 })
    const rect = (node: typeof a) =>
      node.children.find((child) => typeof child !== 'string' && child.tag === 'rect' && child.attrs.fill === '#3ecfc4')
    const left = rect(a)
    const right = rect(b)
    expect(typeof left !== 'string' && left && 'attrs' in left && left.attrs.x).toBe('20')
    expect(typeof right !== 'string' && right && 'attrs' in right && right.attrs.x).toBe('90')
  })

  it('可以从 @dc/flexlayer 引用运行时函数', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-tsx-'))
    const file = join(dir, 'use-lib.tsx')
    await writeFile(
      file,
      `import { interpolate } from '@dc/flexlayer'
      export default function Box() {
        const x = interpolate(1, [0, 1], [4, 16])
        return (
          <layer width="32" height="32" background="#111">
            <circle cx={x} cy="16" r="4" fill="#fff" />
          </layer>
        )
      }
      `,
    )
    const loaded = await loadLayerFile(file)
    expect(loaded.kind).toBe('node')
    if (loaded.kind !== 'node') return
    const circle = loaded.node.children.find((child) => typeof child !== 'string' && child.tag === 'circle')
    expect(typeof circle !== 'string' && circle && 'attrs' in circle && circle.attrs.cx).toBe('16')
  })

  it('Math.random 报 nondeterministic', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-tsx-'))
    const file = join(dir, 'rand.tsx')
    await writeFile(
      file,
      `export default (
        <layer width="32" height="32" background="#000">
          <circle cx={Math.random() * 10} cy="8" r="2" fill="#fff" />
        </layer>
      )
      `,
    )
    const loaded = await loadLayerFile(file)
    expect(loaded.kind).toBe('node')
    if (loaded.kind !== 'node') return
    expect(loaded.issues.map((issue) => issue.code)).toContain('nondeterministic')
    expect(loaded.issues[0]?.message).toContain('Math.random')
    expect(loaded.issues[0]?.source).toMatch(/rand\.tsx:\d+:\d+/)
  })

  it('字符串、注释和类型里的 Math.random 不报 nondeterministic', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-tsx-'))
    const file = join(dir, 'text.tsx')
    await writeFile(
      file,
      `// Date.now()
      const label = 'Math.random()'
      type Now = typeof Date.now
      export default <layer width="32" height="32"><p style="font-size:12px">{label}</p></layer>
      `,
    )
    const loaded = await loadLayerFile(file)
    expect(loaded.kind).toBe('node')
    if (loaded.kind !== 'node') return
    expect(loaded.issues).toEqual([])
  })

  it('放错位置的属性带着源码行', async () => {
    const node = jsxDEV(
      'layer',
      {
        width: 80,
        height: 40,
        background: '#000',
        children: jsxDEV('circle', { cx: 10, cy: 10, r: 4, style: 'fill:#fff' }, undefined, false, at(4, 3), undefined),
      },
      undefined,
      false,
      at(1, 1),
      undefined,
    )
    if (!node || Array.isArray(node)) throw new Error('expected node')
    const report = await checkFvg(node, { baseDir: pkgDir })
    const issue = report.issues.find((item) => item.code === 'invalid-attr')
    expect(issue?.source).toMatch(/t\.tsx:4:3/)
  })

  it('类型错误写进 type-error，并带上源码位置', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-tsx-'))
    const file = join(dir, 'bad.tsx')
    await writeFile(
      file,
      `const title: number = 'hi'
      export default <layer width="10" height="10"><p style="font-size:12px">{title}</p></layer>
      `,
    )
    const issues = typecheckLayerFile(file)
    expect(issues.map((issue) => issue.code)).toContain('type-error')
    expect(issues.every((issue) => issue.level === 'error')).toBe(true)
    expect(issues.some((issue) => /bad\.tsx:\d+:\d+/.test(issue.source ?? ''))).toBe(true)
    expect(typecheckLayerFile(join(pkgDir, 'examples', 'hello.layer'))).toEqual([])
    const elsewhere = await mkdtemp(join(tmpdir(), 'flexlayer-cwd-'))
    const scene = join(dir, 'scene.tsx')
    await writeFile(
      scene,
      `const title: number = 'hi'\nexport default <layer width="40" height="40"><p fill="#fff" style="font-size:12px">{title}</p></layer>\n`,
    )
    const cwd = process.cwd()
    try {
      chdir(elsewhere)
      const typeSource = typecheckLayerFile(scene).find((issue) => issue.code === 'type-error')?.source ?? ''
      const loaded = await loadLayerFile(scene)
      expect(loaded.kind).toBe('node')
      if (loaded.kind !== 'node') return
      const report = await checkFvg(loaded.node, { baseDir: dir })
      const attrSource = report.issues.find((issue) => issue.code === 'invalid-attr')?.source ?? ''
      const fileOf = (source: string) => source.replace(/:\d+:\d+$/, '')
      expect(fileOf(typeSource)).toBe(scene)
      expect(fileOf(attrSource)).toBe(scene)
    } finally {
      chdir(cwd)
    }
    expect(typecheckLayerFile(join(pkgDir, 'examples', 'hello.tsx'))).toEqual([])
    expect(typecheckLayerFile(join(pkgDir, 'examples', 'slide.tsx'))).toEqual([])
  })

  it('末帧才超出画布时，抽查记在最后一帧', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-tsx-'))
    const file = join(dir, 'spill.tsx')
    await writeFile(
      file,
      `import type { Composition } from '@dc/flexlayer'
      export const composition: Composition = {
        id: 'spill',
        width: 40,
        height: 40,
        fps: 1,
        durationInFrames: 5,
        component: ({ frame }) => (
          <layer width="40" height="40" background="#000">
            <circle cx={frame === 4 ? 80 : 20} cy="20" r="4" fill="#fff" />
          </layer>
        ),
      }
      `,
    )
    const loaded = await loadLayerFile(file)
    expect(loaded.kind).toBe('composition')
    if (loaded.kind !== 'composition') return
    const { composition } = loaded
    const frames = sampleFrames(composition.durationInFrames)
    expect(frames).toEqual([0, 2, 4])
    const parts = []
    for (const frame of frames) {
      const node = composition.component({ frame, fps: composition.fps, t: frame / composition.fps })
      const report = await checkFvg(node, { baseDir: dir })
      parts.push({ frame, issues: report.issues })
    }
    const overflow = mergeFrameIssues(parts).filter((issue) => issue.code === 'overflow-canvas')
    expect(overflow.length).toBeGreaterThan(0)
    expect(overflow.every((issue) => issue.frame === 4)).toBe(true)
    expect(parts[0]?.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(false)
  })

  it('canvas.component 在打包后的 tsx 里生效，类型用 jsx-runtime 声明', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-badge-'))
    const file = join(dir, 'badge.tsx')
    await writeFile(
      file,
      `/** @jsxImportSource @dc/flexlayer */
import { canvas } from '@dc/flexlayer'

declare module '@dc/flexlayer/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      badge: { fill?: string }
    }
  }
}

canvas.component('badge', () => <circle cx="24" cy="24" r="16" fill="#00ff00" />)

export default (
  <layer width="48" height="48" background="#000000">
    <badge />
  </layer>
)
`,
    )
    expect(typecheckLayerFile(file)).toEqual([])
    const bare = join(dir, 'bare.tsx')
    await writeFile(
      bare,
      `/** @jsxImportSource @dc/flexlayer */
export default <layer width="48" height="48"><badge /></layer>
`,
    )
    expect(typecheckLayerFile(bare).some((issue) => issue.message.includes('badge'))).toBe(true)
    const loaded = await loadLayerFile(file)
    expect(loaded.kind).toBe('node')
    if (loaded.kind !== 'node') return
    const report = await checkFvg(loaded.node)
    expect(report.issues.filter((issue) => issue.code === 'unknown-tag')).toEqual([])
    const { png } = await renderFvg(loaded.node)
    const { createCanvas, loadImage } = await import('@napi-rs/canvas')
    const img = await loadImage(png)
    const canvasEl = createCanvas(img.width, img.height)
    const ctx = canvasEl.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const pixel = ctx.getImageData(24, 24, 1, 1).data
    expect(pixel[1]).toBeGreaterThan(200)
  })

  it('canvas.create 里的相对字体路径按源文件目录解析', async () => {
    const src = ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/truetype/croscore/Cousine-Regular.ttf'].find(
      (path) => existsSync(path),
    )
    if (!src) return
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-font-'))
    copyFileSync(src, join(dir, 'RelProbe.ttf'))
    const file = join(dir, 'poster.tsx')
    await writeFile(
      file,
      `/** @jsxImportSource @dc/flexlayer */
import { canvas } from '@dc/flexlayer'
const block = canvas.create(
  <layer width="240">
    <font family="RelProbe" src="./RelProbe.ttf" />
    <h1 style="font-family:RelProbe; font-size:32px; white-space:nowrap">0000000000</h1>
  </layer>,
)
export default <layer width="240" height="80">{block}</layer>
`,
    )
    const cwd = process.cwd()
    try {
      chdir('/tmp')
      const loaded = await loadLayerFile(file)
      expect(loaded.kind).toBe('node')
    } finally {
      chdir(cwd)
    }
  })
})
