import { createCanvas, loadImage } from '@napi-rs/canvas'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { emitLayer } from './emit.js'
import { h } from './h.js'
import { initFontsForMeasure } from './fonts.js'
import { layoutSource } from './layout.js'
import { loadLayerFile } from './load-source.js'
import { checkFvg, renderFvg } from './render.js'

const pkgDir = join(fileURLToPath(import.meta.url), '..', '..')

beforeAll(async () => {
  for (const dir of [join(process.env.HOME ?? '', '.cache/flexlayer/fonts'), '/tmp/flexlayer-test']) {
    if (await initFontsForMeasure({ fontsCacheDir: dir })) break
  }
})

const dot =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

async function pixel(png: Buffer, x: number, y: number) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const i = (y * img.width + x) * 4
  const data = ctx.getImageData(0, 0, img.width, img.height).data
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!] as const
}

describe('样式、换行和运行时', () => {
  it('自动堆叠的长段落换行后，下一块从新的底边开始', async () => {
    const doc = await layoutSource(
      `<layer width="800" height="600" safe="0"><div style="width:160px"><p style="font-size:32px">一二三四五六七八九十</p><p style="font-size:32px">下一行</p></div></layer>`,
      pkgDir,
    )
    const column = doc.root.children[0] as { children: Array<{ y: number; height: number; textLayout: { lines: unknown[] } }> }
    const [first, second] = column.children
    expect(first!.textLayout.lines.length).toBeGreaterThan(1)
    expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height - 0.5)
  })

  it('段落里的图片跟着文字换行，不拆成左右栏', async () => {
    const doc = await layoutSource(
      `<layer width="120" height="200" safe="0"><p style="width:100px; font-size:32px">甲乙丙丁<img src="${dot}" style="width:28px; height:28px" />戊己庚辛</p></layer>`,
      pkgDir,
    )
    const text = doc.root.children[0] as {
      kind: string
      height: number
      inlines?: Array<{ y: number }>
      textLayout: { lines: unknown[] }
    }
    expect(text.kind).toBe('text')
    expect(text.textLayout.lines.length).toBeGreaterThan(1)
    expect(text.inlines?.[0]?.y).toBeGreaterThan(0)
    expect(doc.issues.some((issue) => issue.message.includes('不能放图片'))).toBe(false)
  })

  it('line-height 的像素值生效，写错的单位会报出来', async () => {
    const px = await layoutSource(
      `<layer width="400" height="200" safe="0"><p style="font-size:32px; line-height:48px">甲乙</p></layer>`,
      pkgDir,
    )
    const text = px.root.children[0] as { textLayout: { lines: Array<{ height: number }> } }
    expect(text.textLayout.lines[0]!.height).toBeGreaterThanOrEqual(48)
    const bad = await checkFvg(`<layer width="400" height="200"><p style="font-size:32px; line-height:20em; text-align:centerr">甲</p></layer>`)
    const messages = bad.issues.map((issue) => issue.message)
    expect(messages.some((message) => message.includes('line-height'))).toBe(true)
    expect(messages.some((message) => message.includes('text-align'))).toBe(true)
  })

  it('不支持的样式和写错的 anchor 会警告，anchor 退回左上角', async () => {
    const doc = await layoutSource(
      `<layer width="200" height="120" safe="0"><layer x="80" y="40" width="20" height="20" anchor="middle"><p style="margin:8px">甲</p></layer></layer>`,
      pkgDir,
    )
    const nested = doc.root.children[0] as { x: number; y: number }
    expect(nested.x).toBe(80)
    expect(nested.y).toBe(40)
    expect(doc.issues.some((issue) => issue.message.includes('anchor'))).toBe(true)
    expect(doc.issues.some((issue) => issue.message.includes('margin'))).toBe(true)
  })

  it('嵌套 layer 的宽度会换行，颜色和字体传给里面的文字', async () => {
    const doc = await layoutSource(
      `<layer width="800" height="300" safe="0" color="#111111" font-family="ChillDuanSans"><layer width="80" color="#ff0000" font-family="Kai"><p style="font-size:32px">一二三四五六七八</p></layer></layer>`,
      pkgDir,
    )
    const nested = doc.root.children[0] as { children: Array<{ textLayout: { lines: Array<{ segments: Array<{ style: { color: string; fontFamily: string } }> }> } }> }
    const text = nested.children[0]!
    expect(text.textLayout.lines.length).toBeGreaterThan(1)
    expect(text.textLayout.lines[0]!.segments[0]!.style.color).toBe('#ff0000')
    expect(text.textLayout.lines[0]!.segments[0]!.style.fontFamily).toBe('Kai')
  })

  it('text-wrap:wrap 时标点不出现在行首', async () => {
    const doc = await layoutSource(
      `<layer width="200" height="200" safe="0"><p style="width:70px; font-size:32px; text-wrap:wrap">你好，世界</p></layer>`,
      pkgDir,
    )
    const lines = (doc.root.children[0] as { textLayout: { lines: Array<{ segments: Array<{ text: string }> }> } }).textLayout.lines
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      const text = line.segments.map((seg) => seg.text).join('')
      expect(text.startsWith('，')).toBe(false)
    }
  })

  it('根号里的文字不和前面的公式重叠', async () => {
    const report = await checkFvg(
      `<layer width="800" height="200" safe="0"><div style="display:flex; align-items:center"><span style="font-size:48px">因此</span><math><msqrt><mi>x</mi><mo>+</mo><mi>y</mi></msqrt></math></div></layer>`,
    )
    expect(report.issues.some((issue) => issue.code === 'text-overlap')).toBe(false)
  })

  it('圆角等于半边时和圆的像素一致', async () => {
    const round = await renderFvg(`<layer width="60" height="60" background="#000"><rect x="10" y="10" width="40" height="40" rx="20" fill="#fff" /></layer>`)
    const circle = await renderFvg(`<layer width="60" height="60" background="#000"><circle cx="30" cy="30" r="20" fill="#fff" /></layer>`)
    const corner = await pixel(round.png, 12, 12)
    const circleCorner = await pixel(circle.png, 12, 12)
    expect(Math.abs(corner[0] - circleCorner[0])).toBeLessThan(8)
    const mid = await pixel(round.png, 30, 10)
    expect(mid[0]).toBeGreaterThan(200)
  })

  it('写错的路径和 draw 运行错误不会让整张图退出', async () => {
    const pathReport = await checkFvg(`<layer width="80" height="80"><path d="not a path" fill="#fff" /></layer>`)
    expect(pathReport.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('路径'))).toBe(true)
    const source = `<layer width="40" height="40" background="#000">\n  <rect width="20" height="20" fill="#fff">\n    <draw>\nctx.notAMethod()\n    </draw>\n  </rect>\n</layer>`
    const { png, report } = await renderFvg(source)
    const hit = report.issues.find((issue) => issue.code === 'invalid-draw' && issue.message.includes('运行出错'))
    expect(hit?.source).toBe('3:5')
    expect(png[0]).toBe(0x89)
  })

  it('拼写提示按标签收窄', async () => {
    const report = await checkFvg(`<layer width="80" height="40"><rect x="0" y="0" widht="20" height="10" fil="#ff0000" /><p styl="color:#fff">甲</p></layer>`)
    const hints = report.issues.filter((issue) => issue.message.includes('不认识的属性')).map((issue) => issue.hint)
    expect(hints).toEqual(expect.arrayContaining(['是不是想写 width？', '是不是想写 fill？']))
    const style = await checkFvg(`<layer width="80" height="40"><p style="font-szie:20px">甲</p></layer>`)
    expect(style.issues.some((issue) => issue.hint?.includes('font-size'))).toBe(true)
    expect(style.issues.some((issue) => issue.hint?.includes('cx'))).toBe(false)
  })

  it('--emit 不在 span 两侧加空格', () => {
    const node = h('p', null, '你好', h('span', null, '世界'), '啊')
    expect(emitLayer(node).source).toContain('你好<span>世界</span>啊')
  })

  it('--emit 保留 draw 里的 ctx', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-emit-'))
    const file = join(dir, 'draw.tsx')
    writeFileSync(
      file,
      `/** @jsxImportSource flexlayer */\nexport default (\n  <layer width="40" height="40" background="#000">\n    <rect width="20" height="20" fill="#fff" draw={(ctx, el) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, el.w, el.h) }} />\n  </layer>\n)\n`,
    )
    const loaded = await loadLayerFile(file)
    expect(loaded.kind).toBe('node')
    if (loaded.kind !== 'node') return
    const emitted = emitLayer(loaded.node)
    expect(emitted.source).toContain('ctx.fillRect')
    expect(emitted.source).not.toContain('ctx2')
  })

  it('import.meta.url 指向源文件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-url-'))
    writeFileSync(join(dir, 'marker.txt'), '标记甲\n')
    const file = join(dir, 'page.tsx')
    writeFileSync(
      file,
      `/** @jsxImportSource flexlayer */\nimport { readFileSync } from 'node:fs'\nconst marker = readFileSync(new URL('./marker.txt', import.meta.url), 'utf8').trim()\nexport default (\n  <layer width="200" height="80" safe="0"><p style="font-size:32px">{marker}</p></layer>\n)\n`,
    )
    const loaded = await loadLayerFile(file)
    expect(loaded.kind).toBe('node')
    if (loaded.kind !== 'node') return
    const doc = await layoutSource(loaded.node, dir)
    const text = doc.root.children[0] as { text: string }
    expect(text.text).toContain('标记甲')
  })

  it('旧包名会提示改成 flexlayer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-legacy-'))
    const file = join(dir, 'old.tsx')
    const legacy = '@' + 'dc/flexlayer'
    writeFileSync(file, `/** @jsxImportSource flexlayer */\nimport { canvas } from '${legacy}'\nexport default <layer width="10" height="10" />\n`)
    await expect(loadLayerFile(file)).rejects.toThrow(/flexlayer/)
  })

  it('命令行执行 tsx 时 registerFilter 和渲染用同一份注册表', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-filter-'))
    const file = join(dir, 'wash.tsx')
    const png = join(dir, 'out.png')
    writeFileSync(
      file,
      `/** @jsxImportSource flexlayer */\nimport { registerFilter } from 'flexlayer'\nregisterFilter({\n  name: 'cli-wash',\n  kind: 'pixel',\n  parse: () => ({ spec: 1 }),\n  apply(pixels) {\n    const data = pixels.data\n    for (let i = 0; i < data.length; i += 4) {\n      if (!data[i + 3]) continue\n      data[i] = 255\n      data[i + 1] = 0\n      data[i + 2] = 0\n    }\n  },\n})\nexport default (\n  <layer width="20" height="20" background="#000">\n    <layer width="20" height="20" cli-wash="1"><rect x="0" y="0" width="20" height="20" fill="#224488" /></layer>\n  </layer>\n)\n`,
    )
    const result = spawnSync(join(pkgDir, 'node_modules/.bin/tsx'), [join(pkgDir, 'src/cli.ts'), 'render', file, '-o', png], {
      cwd: pkgDir,
      encoding: 'utf8',
    })
    expect(result.status, result.stderr || result.stdout).toBe(0)
    return pixel(readPng(png), 10, 10).then((sample) => {
      expect(sample[0]).toBeGreaterThan(200)
      expect(sample[1]).toBeLessThan(40)
    })
  })
})

function readPng(file: string) {
  return spawnSync('cat', [file]).stdout as Buffer
}
