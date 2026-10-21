import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveLayerBaseDir } from './canvas.js'

describe('resolveLayerBaseDir', () => {
  it('目录名带 flexlayer- 的脚本，相对路径按这个目录', () => {
    const stack = 'Error\n    at render (/tmp/flexlayer-poster/scene.tsx:12:3)'
    expect(resolveLayerBaseDir(stack, '/pinned', '/cwd')).toBe('/tmp/flexlayer-poster')
  })

  it('调用栈写成 at path:line:col 时也能认出来', () => {
    const stack = 'Error\n    at /home/me/work/flexlayer-tools/poster.tsx:4:2'
    expect(resolveLayerBaseDir(stack, '/pinned', '/cwd')).toBe('/home/me/work/flexlayer-tools')
  })

  it('打包器写在临时目录里的 entry 用钉住的源目录', () => {
    const entry = join(tmpdir(), 'flexlayer-Ab12', 'entry.mjs')
    const stack = `Error\n    at ${entry}:1:1\n    at run (/workspace/src/canvas.ts:10:1)`
    expect(resolveLayerBaseDir(stack, '/src/poster', '/cwd')).toBe('/src/poster')
  })

  it('代码缓存里的 entry 也用钉住的源目录', () => {
    const entry = join(homedir(), '.cache', 'flexlayer', 'code', 'abc', 'entry.mjs')
    const stack = `Error\n    at ${entry}:1:1\n    at run (/workspace/src/canvas.ts:10:1)`
    expect(resolveLayerBaseDir(stack, '/src/poster', '/cwd')).toBe('/src/poster')
  })

  it('node_modules 和渲染器自己的文件跳过，落到用户脚本', () => {
    const stack = [
      'Error',
      '    at /workspace/node_modules/flexlayer/dist/canvas.js:10:1',
      '    at /workspace/src/canvas.ts:20:1',
      '    at /home/me/work/flexlayer-tools/poster.tsx:4:2',
    ].join('\n')
    expect(resolveLayerBaseDir(stack)).toBe('/home/me/work/flexlayer-tools')
  })
})
