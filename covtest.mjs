import { getNativeAddon } from './src/native-loader.mjs'
const addon = await getNativeAddon()
const g = addon.roundedBoxGeometry(440, 14, 280, 12, ['top-left','top-right','bottom-left','bottom-right'])
const P = g.positions, N = g.normals, I = g.indices
const top = []
for (let t=0;t<I.length;t+=3){
  const ids=[I[t],I[t+1],I[t+2]]
  const zs=ids.map(i=>P[i*3+2])
  if (zs.every(z=>z>13.99)) top.push(ids)
}
console.log('top tris', top.length)
let neg=0, zero=0
for (const [a,b,c] of top){
  const ax=P[a*3],ay=P[a*3+1], bx=P[b*3],by=P[b*3+1], cx=P[c*3],cy=P[c*3+1]
  const area=((bx-ax)*(cy-ay)-(cx-ax)*(by-ay))/2
  if (area< -1e-6) neg++
  if (Math.abs(area)<1e-6) zero++
}
console.log('neg winding', neg, 'degenerate', zero)
// total area vs polygon area
let total=0
for (const [a,b,c] of top){
  const ax=P[a*3],ay=P[a*3+1], bx=P[b*3],by=P[b*3+1], cx=P[c*3],cy=P[c*3+1]
  total+=Math.abs(((bx-ax)*(cy-ay)-(cx-ax)*(by-ay))/2)
}
const polyArea = 880*560 - (4-Math.PI)*12*12
console.log('sum |tri| area', total.toFixed(1), 'expected', polyArea.toFixed(1))
