import { describe, expect, it } from 'vitest'
import { decodeEntities, parseLayer } from './parse.js'

describe('parseLayer', () => {
  it('不认识的标签保留大小写', () => {
    const nodes = parseLayer('<Row><Column /></Row>')
    expect(nodes[0]?.tag).toBe('Row')
    const row = nodes[0]!
    expect((row.children[0] as { tag: string }).tag).toBe('Column')
  })

  it('大写标签保持原样，不归一成小写', () => {
    const nodes = parseLayer('<Layer><Circle /></Layer>')
    expect(nodes[0]?.tag).toBe('Layer')
    const circle = nodes[0]!.children[0] as { tag: string }
    expect(circle.tag).toBe('Circle')
  })

  it('解析 br 与注释', () => {
    const nodes = parseLayer('<p>a<br/>b<!-- x --></p>')
    const p = nodes[0]!
    expect(p.children.some((c) => typeof c !== 'string' && c.tag === 'br')).toBe(true)
  })

  it('decodeEntities', () => {
    expect(decodeEntities('&times;')).toBe('×')
  })

  it('<script> 正文按原文保留，含 < 比较符', () => {
    const nodes = parseLayer(`<layer width="10" height="10">
      <script>
        if (canvas.width < 100) ctx.fillRect(0, 0, canvas.width, canvas.height)
      </script>
    </layer>`)
    const layer = nodes[0]!
    const script = layer.children.find((c) => typeof c !== 'string' && c.tag === 'script') as {
      tag: string
      children: string[]
    }
    expect(script?.tag).toBe('script')
    expect(script.children.join('')).toContain('canvas.width < 100')
    expect(script.children.join('')).not.toContain('<100')
  })
})
