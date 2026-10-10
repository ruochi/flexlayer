import { glyph, h, renderFrames } from 'flexlayer'
const W = 1920
const H = 1080
const [MO] = await glyph('墨', { font: 'Kai', size: 520, weight: 700 })
const FLOOR = H / 2 - MO.height / 2 + MO.ink.y + MO.ink.height
function scene({ rotY = -32, ball = null, floor = true } = {}) {
  return h(
    'layer',
    { width: W, height: H, background: '#15171c' },
    h(
      'layer',
      { width: W, height: H, perspective: 1600 },
      floor ? h('box', { x: W / 2 - 1100, y: FLOOR.toFixed(1), width: 2200, height: 24, depth: 1200, fill: '#2a2d36' }) : null,
      ball == null ? null : h('sphere', { cx: (1780 - 2040 * ball).toFixed(1), cy: (FLOOR - 80).toFixed(1), r: 80, z: (-360 + 700 * ball * ball).toFixed(1), fill: '#d8b45a' }),
      h(
        'layer',
        { x: W / 2, y: H / 2, anchor: 'center', width: MO.width, height: MO.height, rotateY: rotY.toFixed(2), rotateX: '-12' },
        h('extrude', { d: MO.d, depth: 130, fill: '#c8352e' }),
      ),
    ),
  )
}
async function bench(name, component, n = 12) {
  const frames = renderFrames({ id: name, width: W, height: H, fps: 30, durationInFrames: n + 1, component }, { from: 0, to: n, format: 'rgba' })
  await frames.next()
  const t0 = performance.now()
  for (let i = 0; i < n; i++) await frames.next()
  console.log(`${name.padEnd(14)} ${Math.round((performance.now() - t0) / n)} ms/帧`)
}
await bench('地面+字 静止', () => scene())
await bench('只有字 静止', () => scene({ floor: false }))
await bench('字在转', ({ frame }) => scene({ rotY: -32 + frame * 2 }))
await bench('字+球在动', ({ frame }) => scene({ rotY: -32 + frame * 2, ball: frame / 12 }))
await bench('二维对照', () => h('layer', { width: W, height: H, background: '#15171c' }, h('path', { d: MO.d, fill: '#c8352e', x: 700, y: 200 })))
