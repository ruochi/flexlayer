import { getNativeAddon } from './src/native-loader.mjs'
const addon = await getNativeAddon()
const g = addon.roundedBoxGeometry(440, 14, 280, 12, ['top-left','top-right','bottom-left','bottom-right'])
const P = g.positions, N = g.normals, I = g.indices
const cap = []
for (let t=0;t<I.length;t+=3){
  const ids=[I[t],I[t+1],I[t+2]]
  const ys=ids.map(i=>P[i*3+1])
  if (ys.every(y=>y>13.99)) cap.push(ids)
}
const verts = [...new Set(cap.flat())]
for (const i of verts) console.log(i, P[i*3].toFixed(1), P[i*3+1].toFixed(1), P[i*3+2].toFixed(1), '|', N[i*3].toFixed(2), N[i*3+1].toFixed(2), N[i*3+2].toFixed(2))
console.log('tris', cap)
