import { render } from '/Users/ruochi/project/flexlayer-mac/flexlayer/src/render.js'
import { PNG } from 'pngjs'

const png = await render(`
  <layer width="280" height="180" background="#efeae2" camera="520">
    <sphere cx="140" cy="36" r="14" fill="#2c5f8a" material="clay" />
    <ground y="140" rotateX="74" fill="#e7e1d6" shadow-blur="80" shadow-opacity="0.8" />
  </layer>`, { scale: 1 } as any)
const img = PNG.sync.read(Buffer.from(png as any))
const luma = (x: number, y: number) => {
  const i = (y * img.width + x) * 4
  return 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!
}
let center = { x: 0, y: 0, v: 999 }
for (let y = 80; y <= 150; y++) for (let x = 80; x <= 240; x++) {
  const v = luma(x, y); if (v < center.v) center = { x, y, v }
}
console.log('center', center)
const col: number[] = []
for (let y = center.y - 60; y <= center.y + 60; y++) {
  col.push(y < 0 || y >= img.height ? NaN : luma(center.x, y))
}
console.log(col.map((v, i) => `${center.y - 60 + i}:${Number.isNaN(v) ? 'NA' : v.toFixed(1)}`).join(' '))
