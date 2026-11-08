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
console.log('cap tris', cap.length)
let neg=0, total=0
for (const [a,b,c] of cap){
  const ax=P[a*3],az=P[a*3+2], bx=P[b*3],bz=P[b*3+2], cx=P[c*3],cz=P[c*3+2]
  const area=((bx-ax)*(cz-az)-(cx-ax)*(bz-az))/2
  if (area< -1e-6) neg++
  total+=Math.abs(area)
}
console.log('neg winding', neg, 'sum area', total.toFixed(1), 'expected', (880*560-(4-Math.PI)*144).toFixed(1))
// normal spread on cap
let nonFlat=0
for (const [a,b,c] of cap){
  for (const i of [a,b,c]) {
    if (Math.abs(N[i*3])>1e-4 || Math.abs(N[i*3+2])>1e-4 || N[i*3+1]<0.999) nonFlat++
  }
}
console.log('cap verts with non-(0,1,0) normal', nonFlat)
const verts = new Set(cap.flat())
console.log('cap unique verts', verts.size)
let yset = new Set([...verts].map(i=>P[i*3+1].toFixed(4)))
console.log('cap y values', [...yset])
