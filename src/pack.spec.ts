import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('..', import.meta.url).pathname

function run(cmd: string, args: string[], cwd: string) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120_000 })
  if (result.error) throw result.error
  return result
}

/** 装成依赖时 @types/node 常被提升。这里强制成那种布局，再跑 check。 */
function hoistNodeTypes(app: string) {
  const nested = join(app, 'node_modules/flexlayer/node_modules/@types/node')
  const hoisted = join(app, 'node_modules/@types/node')
  if (existsSync(nested) && !existsSync(hoisted)) {
    mkdirSync(join(app, 'node_modules/@types'), { recursive: true })
    cpSync(nested, hoisted, { recursive: true })
  }
  rmSync(join(app, 'node_modules/flexlayer/node_modules/@types'), { recursive: true, force: true })
  if (!existsSync(hoisted)) throw new Error('@types/node 没有装上')
}

describe('打包', () => {
  it(
    '打出来的包装进临时目录后，能 check 用了 node 类型的 .tsx',
    () => {
      const packed = run('npm', ['pack', '--json'], root)
      expect(packed.status, packed.stderr).toBe(0)
      const filename = (JSON.parse(packed.stdout) as Array<{ filename: string }>)[0]?.filename
      if (!filename) throw new Error(`npm pack 没有给出文件名: ${packed.stdout}`)
      const tarball = join(root, filename)
      const app = mkdtempSync(join(tmpdir(), 'flexlayer-pack-'))
      try {
        const listed = run('tar', ['-tzf', tarball], root)
        expect(listed.status, listed.stderr).toBe(0)
        expect(listed.stdout).toContain('package/dist/cli.js')
        expect(listed.stdout).toContain('package/dist/typecheck.js')

        const init = run('npm', ['init', '-y'], app)
        expect(init.status, init.stderr).toBe(0)
        const install = run('npm', ['install', '--no-fund', '--no-audit', '--prefer-offline', tarball], app)
        expect(install.status, install.stderr).toBe(0)
        hoistNodeTypes(app)

        const bin = join(app, 'node_modules/.bin/flexlayer')
        writeFileSync(
          join(app, 'scene.tsx'),
          `import { readFileSync } from 'node:fs'
const color: string = readFileSync ? '#fff' : '#000'
export default <layer width="40" height="40" background={color}><rect x="4" y="4" width="16" height="16" fill="#fff" /></layer>
`,
        )
        const ok = run(bin, ['check', 'scene.tsx'], app)
        expect(ok.stderr + ok.stdout, 'check 应通过').toContain('0 issues')
        expect(ok.status).toBe(0)

        writeFileSync(
          join(app, 'bad.tsx'),
          `const title: number = 'hi'
export default <layer width="40" height="40" background="#000"><p style="font-size:12px">{title}</p></layer>
`,
        )
        const bad = run(bin, ['check', 'bad.tsx'], app)
        expect(bad.status).toBe(1)
        expect(bad.stdout).toContain('type-error')
      } finally {
        rmSync(tarball, { force: true })
        rmSync(app, { recursive: true, force: true })
      }
    },
    180_000,
  )
})
