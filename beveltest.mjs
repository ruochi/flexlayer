import { getNativeAddon } from './src/native-loader.mjs'
const addon = await getNativeAddon()
const g = addon.roundedBoxGeometry(440, 14, 280, 12, ['top-left','top-right','bottom-left','bottom-right'])
const srcP = Float32Array.from(g.positions)
const srcI = Uint32Array.from(g.indices)
const out = addon.bevelFewFaces(srcP, srcI, null, null)
if (!out) { console.log('null'); process.exit(0) }
const P = out.positions, N = out.normals, I = out.indices
console.log('bevel verts', P.length/3, 'tris', I.length/3)
// find top cap tris: all y ~14 and normals ~ (0,1,0) or tilted
let capTris = 0
const normalSet = new Map()
for (let t=0;t<I.length;t+=3){
  const ids=[I[t],I[t+1],I[t+2]]
  if (!ids.every(i=>P[i*3+1]>13.2)) continue
  capTris++
  for (const i of ids) {
    const k=`${N[i*3].toFixed(2)},${N[i*3+1].toFixed(2)},${N[i*3+2].toFixed(2)}`
    normalSet.set(k,(normalSet.get(k)||0)+1)
  }
}
console.log('top region tris', capTris)
console.log([...normalSet.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10))
