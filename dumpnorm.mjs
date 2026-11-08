import { getNativeAddon } from './src/native-loader.mjs'
const addon = await getNativeAddon()
const g = addon.roundedBoxGeometry(440, 14, 280, 12, ['top-left','top-right','bottom-left','bottom-right'])
const pos = g.positions, nrm = g.normals, idx = g.indices
console.log('verts', pos.length/3, 'tris', idx.length/3)
let bad = 0
for (let i=0;i<pos.length/3;i++){
  const z=pos[i*3+2], nz=nrm[i*3+2]
  if (nz>0.999 && Math.abs(z-14)>1e-4) bad++
}
console.log('top-normal verts off plane', bad)
const hist = new Map()
for (let i=0;i<pos.length/3;i++){
  const k = `${nrm[i*3].toFixed(2)},${nrm[i*3+1].toFixed(2)},${nrm[i*3+2].toFixed(2)}`
  hist.set(k,(hist.get(k)||0)+1)
}
console.log([...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,14))
