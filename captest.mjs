import { getNativeAddon } from './src/native-loader.mjs'
const addon = await getNativeAddon()
const hw=470, hh=328, hd=14, rx=30
const edges=['top-left','top-right','bottom-left','bottom-right']
const g = addon.roundedBoxGeometry(hw, hh, hd, rx, edges)
const out = addon.bevelFewFaces(Float32Array.from(g.positions), Uint32Array.from(g.indices), null, null)
const P = out.positions, N = out.normals, I = out.indices
let capTris = 0
const shown = new Set()
for (let t=0;t<I.length;t+=3){
  const ids=[I[t],I[t+1],I[t+2]]
  if (!ids.every(i=>P[i*3+2]>hd-1e-3)) continue
  capTris++
  for (const i of ids){
    const k=`${N[i*3].toFixed(3)},${N[i*3+1].toFixed(3)},${N[i*3+2].toFixed(3)}`
    if (!shown.has(k)) { shown.add(k); }
  }
}
console.log('deck cap tris', capTris, 'normals', [...shown])
// how many cap verts tilted
let tilted=0, total=0
for (let t=0;t<I.length;t+=3){
  const ids=[I[t],I[t+1],I[t+2]]
  if (!ids.every(i=>P[i*3+2]>hd-1e-3)) continue
  for (const i of ids){ total++; if (Math.abs(N[i*3])>1e-3||Math.abs(N[i*3+1])>1e-3) tilted++ }
}
console.log('cap verts', total, 'tilted', tilted)
