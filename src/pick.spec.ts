import { describe, expect, it } from 'vitest'
import { pickLayer } from './pick.js'

const fonts = { fontsCacheDir: '/tmp/flexlayer-test' }

describe('pickLayer', () => {
  it('hits the later rect and reports local coordinates', async () => {
    const source = `<layer width="80" height="40" background="#fff">
      <rect id="a" x="0" y="0" width="30" height="30" fill="#f00" />
      <rect id="b" x="10" y="10" width="30" height="30" fill="#0f0" />
    </layer>`
    const onB = await pickLayer(source, { x: 15, y: 15 }, fonts)
    expect(onB.hit?.id).toBe('b')
    expect(onB.hit?.path).toBe('layer/rect[1]')
    expect(onB.hit?.tag).toBe('rect')
    expect(onB.hit?.localX).toBeCloseTo(5)
    expect(onB.hit?.localY).toBeCloseTo(5)
    const onA = await pickLayer(source, { x: 2, y: 2 }, fonts)
    expect(onA.hit?.id).toBe('a')
    const outside = await pickLayer(source, { x: 90, y: 2 }, fonts)
    expect(outside.hit).toBeNull()
  })

  it('skips a fully transparent rect and a clipped overflow', async () => {
    const ghost = `<layer width="40" height="40" background="#fff">
      <rect id="back" x="0" y="0" width="40" height="40" fill="#f00" />
      <rect id="ghost" x="0" y="0" width="40" height="40" fill="#0f0" opacity="0" />
    </layer>`
    expect((await pickLayer(ghost, { x: 8, y: 8 }, fonts)).hit?.id).toBe('back')

    const clipped = `<layer width="80" height="40" background="#fff">
      <layer x="0" y="0" width="20" height="20" overflow="hidden">
        <rect id="cut" x="10" y="0" width="30" height="10" fill="#fff" />
      </layer>
    </layer>`
    expect((await pickLayer(clipped, { x: 25, y: 5 }, fonts)).hit?.tag).toBe('layer')
    expect((await pickLayer(clipped, { x: 15, y: 5 }, fonts)).hit?.id).toBe('cut')
    expect((await pickLayer(clipped, { x: 15, y: 5 }, fonts)).hit?.path).toBe('layer/layer[0]/rect[0]')
  })

  it('places a flex child inside the padding', async () => {
    const source = `<layer width="80" height="80" background="#fff">
      <div style="display:flex; padding:10px; width:60px; height:40px">
        <rect id="item" width="10" height="10" fill="#fff" />
      </div>
    </layer>`
    const pad = await pickLayer(source, { x: 4, y: 4 }, fonts)
    expect(pad.hit?.id).not.toBe('item')
    const item = await pickLayer(source, { x: 12, y: 12 }, fonts)
    expect(item.hit?.id).toBe('item')
    expect(item.hit?.localX).toBeCloseTo(2)
    expect(item.hit?.localY).toBeCloseTo(2)
  })
})
