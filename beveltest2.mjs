import { getNativeAddon } from './src/native-loader.mjs'
const addon = await getNativeAddon()
const g = addon.roundedBoxGeometry(440, 14, 280, 12, ['top-left','top-right','bottom-left','bottom-right'])
const out = addon.bevelFewFaces(Float32Array.from(g.positions), Uint32Array.from(g.indices), null, null)
const P = out.positions, N = out.normals, I = out.indices
let flatTris=0, tilted=0
const ys = new Set()
for (let t=0;t<I.length;t+=3){
  const ids=[I[t],I[t+1],I[t+2]]
  if (!ids.every(i=>P[i*3+1]>13.999)) continue
  flatTris++
  ids.forEach(i=>ys.add(P[i*3+1].toFixed(3)))
  const bad = ids.filter(i=>Math.abs(N[i*3])>1e-3 || Math.abs(N[i*3+2])>1e-3 || N[i*3+1]<0.999)
  if (bad.length) {
    tilted++
    if (tilted<6) console.log('tilted tri', ids.map(i=>[P[i*3].toFixed(1),P[i*3+1].toFixed(2),P[i*3+2].toFixed(1), N[i*3].toFixed(2),N[i*3+1].toFixed(2),N[i*3+2].toFixed(2)].join(',')))
  }
}
console.log('flat cap tris', flatTris, 'with tilted normals', tilted, 'y', [...ys])
