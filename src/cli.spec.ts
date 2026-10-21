import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initFontsForMeasure } from './fonts.js'
import { renderLayer } from './render.js'

const pkgDir = join(fileURLToPath(import.meta.url), '..', '..')
const helloPath = join(pkgDir, 'examples', 'hello.layer')

beforeAll(async () => {
  for (const dir of [join(homedir(), '.cache', 'flexlayer', 'fonts'), '/tmp/flexlayer-test']) {
    if (await initFontsForMeasure({ fontsCacheDir: dir })) break
  }
})

describe('render hello.layer', () => {
  it('生成 PNG', async () => {
    const source = await readFile(helloPath, 'utf8')
    const { png, report } = await renderLayer(source, {
      baseDir: join(pkgDir, 'examples'),
      fontsCacheDir: join(homedir(), '.cache', 'flexlayer', 'fonts'),
    })
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
    expect(report.width).toBe(1080)
    expect(report.height).toBe(1920)
    expect(report.elements.length).toBeGreaterThan(0)
  })

  it('check 没有问题时打印 ✓ 0 issues', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-check-'))
    const file = join(dir, 'ok.layer')
    writeFileSync(file, `<layer width="40" height="40" background="#000"><rect x="0" y="0" width="10" height="10" fill="#fff" /></layer>`)
    const result = spawnSync(join(pkgDir, 'node_modules/.bin/tsx'), [join(pkgDir, 'src/cli.ts'), 'check', file], {
      cwd: pkgDir,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('✓ 0 issues')
  })
})

const tsxBin = join(pkgDir, 'node_modules/.bin/tsx')
const cliPath = join(pkgDir, 'src/cli.ts')

function runCli(args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync(tsxBin, [cliPath, ...args], {
    cwd: pkgDir,
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : undefined,
  })
}

function pngSize(file: string) {
  const buf = readFileSync(file)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function runCliBuffer(args: string[]) {
  return spawnSync(tsxBin, [cliPath, ...args], { cwd: pkgDir })
}

describe('帧序列命令行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flexlayer-frames-'))
  const scene = join(dir, 'scene.tsx')
  writeFileSync(
    scene,
    `import type { Composition } from 'flexlayer'
export const composition: Composition = {
  id: 'span',
  width: 40,
  height: 40,
  fps: 1,
  durationInFrames: 6,
  component: ({ frame }) => (
    <layer width="40" height="40" background="#000">
      <rect x="4" y="4" width="8" height="8" fill="#ccc" />
      <circle cx={frame === 4 ? 80 : 20} cy="20" r="4" fill="#fff" />
    </layer>
  ),
}
`,
  )

  it('check --frames 0-5 --step 2 把问题收成区间', () => {
    const reportPath = join(dir, 'report.json')
    const result = runCli(['check', scene, '--frames', '0-5', '--step', '2', '--report', reportPath])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('overflow-canvas')
    expect(result.stdout).toContain('第4帧')
    expect(result.stdout).toContain('抽查')
    expect(result.stdout).not.toContain('也出现在')
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      issues: Array<{ code: string; frames?: Array<[number, number]> }>
    }
    const overflow = report.issues.filter((issue) => issue.code === 'overflow-canvas')
    expect(overflow).toEqual([expect.objectContaining({ frames: [[4, 4]] })])
  })

  it('--frames 边写边出，只包含 from 到 to', () => {
    const framesDir = join(dir, 'frames')
    const result = runCli(['render', scene, '--frames', framesDir, '--from', '1', '--to', '3'])
    expect(result.status).toBe(0)
    expect(readdirSync(framesDir).sort()).toEqual(['frame-0001.png', 'frame-0002.png', 'frame-0003.png'])
    expect(existsSync(join(dir, 'scene.png'))).toBe(true)
  })

  it('素材命令指向素材服务，不在这个程序里抠图', () => {
    for (const command of ['asset', 'cutout', 'select']) {
      const result = runCli([command, 'photo.jpg'])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('只排版和渲染')
      expect(result.stderr).toContain('https://nc.fangyitech.com/flex/v1/docs')
    }
  })

  it('--rgba - 的标准输出只有像素', () => {
    const result = runCliBuffer(['render', scene, '--rgba', '-'])
    expect(result.stdout.length).toBe(6 * 40 * 40 * 4)
    expect(result.stdout[0]).toBe(0)
    const err = result.stderr.toString('utf8')
    expect(err).toContain('-f rawvideo -pix_fmt rgba -s 40x40 -r 1 -i -')
    expect(err).toContain('overflow-canvas')
    expect(result.stdout.subarray(0, 8).toString('utf8')).not.toContain('ffmpeg')
    expect(result.status).toBe(1)
  })

  it('--watch 在文件改完后再渲染一次', async () => {
    const watchDir = mkdtempSync(join(tmpdir(), 'flexlayer-watch-'))
    const file = join(watchDir, 'card.layer')
    const out = join(watchDir, 'card.png')
    writeFileSync(file, `<layer width="20" height="16" background="#000"></layer>`)
    const child = spawn(tsxBin, [cliPath, 'render', file, '-o', out, '--watch'], { cwd: pkgDir })
    let text = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8')
    })
    const waitFor = async (count: number) => {
      const start = Date.now()
      while (Date.now() - start < 20000) {
        if (text.split('✓').length - 1 >= count) return
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      throw new Error(`没等到 ${count} 次渲染\n${text}\n${err}`)
    }
    try {
      await waitFor(1)
      expect(text).toContain('20×16')
      writeFileSync(file, `<layer width="28" height="16" background="#111"></layer>`)
      await waitFor(2)
      expect(text).toContain('28×16')
      expect(text).toContain('watching')
    } finally {
      child.kill('SIGKILL')
    }
  })
})

describe('类型检查和批量出图', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flexlayer-batch-'))
  const bad = join(dir, 'bad.tsx')
  const card = join(dir, 'card.tsx')
  const mark = join(dir, 'mark.txt')
  const plain = join(dir, 'plain.layer')
  const other = join(dir, 'other.tsx')
  writeFileSync(bad, `const title: number = 'hi'\nexport default <layer width="40" height="24" background="#000" />\n`)
  writeFileSync(
    card,
    `import { appendFileSync } from 'node:fs'
export default () => {
  appendFileSync(process.env.MARK!, 'x')
  return <layer width="16" height="10" background="#000" />
}
`,
  )
  writeFileSync(other, `export default <layer width="8" height="8" background="#fff"><rect x="1" y="1" width="4" height="4" fill="#000" /></layer>\n`)
  writeFileSync(plain, `<layer width="8" height="8" background="#fff"><rect x="1" y="1" width="4" height="4" fill="#000" /></layer>`)

  it('render 默认不查类型，--typecheck 才记 type-error，图仍然写出', () => {
    const plainPng = join(dir, 'plain.png')
    const skipped = runCli(['render', bad, '-o', plainPng])
    expect(skipped.status).toBe(0)
    expect(skipped.stdout).not.toContain('type-error')
    expect(existsSync(plainPng)).toBe(true)

    const checkedPng = join(dir, 'checked.png')
    const checked = runCli(['render', bad, '-o', checkedPng, '--typecheck'])
    expect(checked.status).toBe(1)
    expect(checked.stdout).toContain('type-error')
    expect(existsSync(checkedPng)).toBe(true)
  })

  it('check 查类型，--no-typecheck 跳过', () => {
    const checked = runCli(['check', bad])
    expect(checked.status).toBe(1)
    expect(checked.stdout).toContain('type-error')

    const skipped = runCli(['check', bad, '--no-typecheck'])
    expect(skipped.status).toBe(0)
    expect(skipped.stdout).not.toContain('type-error')
    expect(skipped.stdout.trim()).toBe('✓ 0 issues')
  })

  it('一次进程渲多张和多个倍率，同一份源只执行一次', () => {
    const out = join(dir, 'out')
    const reports = join(dir, 'reports')
    const emitted = join(dir, 'emitted')
    const result = runCli(['render', card, other, '--scale', '1', '--scale', '2', '-o', out, '--report', reports, '--emit', emitted], { MARK: mark })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).not.toContain('type-error')
    expect(readFileSync(mark, 'utf8')).toBe('x')
    expect(pngSize(join(out, 'card@1x.png'))).toEqual({ width: 16, height: 10 })
    expect(pngSize(join(out, 'card@2x.png'))).toEqual({ width: 32, height: 20 })
    expect(pngSize(join(out, 'other@1x.png'))).toEqual({ width: 8, height: 8 })
    expect(pngSize(join(out, 'other@2x.png'))).toEqual({ width: 16, height: 16 })
    const report = JSON.parse(readFileSync(join(reports, 'card@2x.json'), 'utf8')) as { width: number }
    expect(report.width).toBe(16)
    expect(readdirSync(emitted).sort()).toEqual(['card.layer', 'other.layer'])
    expect(readFileSync(join(emitted, 'card.layer'), 'utf8')).toContain('<layer')
  })

  it('一张出错时其余的图仍然写出', () => {
    const broken = join(dir, 'broken.tsx')
    writeFileSync(broken, `export default 1\n`)
    const out = join(dir, 'rest')
    const result = runCli(['render', broken, plain, '-o', out])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('需要默认导出')
    expect(pngSize(join(out, 'plain.png'))).toEqual({ width: 8, height: 8 })
    expect(existsSync(join(out, 'broken.png'))).toBe(false)
  })

  it('check 可以一次查多个文件', () => {
    const reports = join(dir, 'check-reports')
    const result = runCli(['check', bad, plain, '--report', reports])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('type-error')
    expect(result.stdout).toContain('✓ 0 issues')
    expect(JSON.parse(readFileSync(join(reports, 'plain.json'), 'utf8'))).toMatchObject({ width: 8, height: 8 })
    const badReport = JSON.parse(readFileSync(join(reports, 'bad.json'), 'utf8')) as { issues: Array<{ code: string }> }
    expect(badReport.issues.some((issue) => issue.code === 'type-error')).toBe(true)
  })

  it('多张图时 -o 要是目录，单个倍率不改文件名', () => {
    const asFile = runCli(['render', plain, card, '-o', join(dir, 'out.png')])
    expect(asFile.status).toBe(2)
    expect(asFile.stderr).toContain('目录')

    const twice = join(dir, 'twice.png')
    const scaled = runCli(['render', plain, '--scale', '2', '-o', twice])
    expect(scaled.status).toBe(0)
    expect(pngSize(twice)).toEqual({ width: 16, height: 16 })
    expect(existsSync(join(dir, 'twice@2x.png'))).toBe(false)
  })
})
