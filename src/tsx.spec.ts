import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { mergeFrameIssues, sampleFrames } from './check-frames.js'
import { emitLayer } from './emit.js'
import { h } from './h.js'
import { Fragment, jsx, jsxDEV, type JsxSource } from './jsx-runtime.js'
import { loadLayerFile } from './load-source.js'
import { checkFvg } from './render.js'
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

function typeErrors(files: string[]): string[] {
  const program = ts.createProgram(files, {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: '@dc/flexlayer',
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    baseUrl: pkgDir,
    paths: {
      '@dc/flexlayer': ['src/index.ts'],
      '@dc/flexlayer/jsx-runtime': ['src/jsx-runtime.ts'],
      '@dc/flexlayer/jsx-dev-runtime': ['src/jsx-dev-runtime.ts'],
    },
  })
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file && files.includes(d.file.fileName))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

describe('JSX 类型', () => {
  it('examples 里的 .tsx 通过类型检查', () => {
    const files = ['hello.tsx', 'slide.tsx'].map((name) => join(pkgDir, 'examples', name))
    expect(typeErrors(files)).toEqual([])
  })

  it('写错位置的属性是类型错误', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flexlayer-types-'))
    const cases = [
      [`export default <layer width="10" height="10"><p cx="3">hi</p></layer>\n`, "'cx'"],
      [`export default <layer width="10" height="10"><circle cx="4" cy="4" r="2" style="fill:#fff" /></layer>\n`, "'style'"],
      [`export default <layer width="10" height="10"><p font-size="40">hi</p></layer>\n`, "'font-size'"],
    ] as const
    for (const [source, token] of cases) {
      const file = join(dir, `${token.replace(/'/g, '')}.tsx`)
      await writeFile(file, source)
      const errors = typeErrors([file])
      expect(errors.some((message) => message.includes(token)), token).toBe(true)
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
    expect(emitted.source).toContain('color')
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
    const rect = (node: typeof a) => node.children.find((child) => typeof child !== 'string' && child.tag === 'rect')
    const left = rect(a)
    const right = rect(b)
    expect(typeof left !== 'string' && left && 'attrs' in left && left.attrs.cx).toBe('40')
    expect(typeof right !== 'string' && right && 'attrs' in right && right.attrs.cx).toBe('110')
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
    expect(loaded.issues[0]?.source).toMatch(/rand\.tsx:\d+:\d+/)
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
    await writeFile(file, `export default <layer width="10" height="10"><p cx="3">hi</p></layer>\n`)
    const issues = typecheckLayerFile(file)
    expect(issues.map((issue) => issue.code)).toContain('type-error')
    expect(issues.every((issue) => issue.level === 'error')).toBe(true)
    expect(issues.some((issue) => /bad\.tsx:\d+:\d+/.test(issue.source ?? ''))).toBe(true)
    expect(typecheckLayerFile(join(pkgDir, 'examples', 'hello.layer'))).toEqual([])
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
})
