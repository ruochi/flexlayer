import { getNativeAddon } from './src/native-loader.mjs'
const addon = await getNativeAddon()
const g = addon.roundedBoxGeometry(440, 14, 280, 12, ['top-left','top-right','bottom-left','bottom-right'])
const pos = g.positions, nrm = g.normals, idx = g.indices
const n = pos.length/3
const topZ = []
for (let i=0;i<n;i++){
  const z = pos[i*3+2], nz = nrm[i*3+2]
  if (nz>0.999 && Math.abs(z-14)>1e-4) topZ.push([pos[i*3].toFixed(1), pos[i*3+1].toFixed(1), z.toFixed(3), nrm[i*3].toFixed(2), nrm[i*3+1].toFixed(2)])
}
console.log('count', topZ.length, topZ.slice(0,8))
// triangle-level check for top plane
let badTri=0, triTotal=0
for (let t=0;t<idx.length;t+=3){
  const a=idx[t],b=idx[t+1],c=idx[t+2]
  const zs=[pos[a*3+2],pos[b*3+2],pos[c*3+2]]
  if (zs.every(z=>Math.abs(z-14)<1e-4)) {
    triTotal++
    const ns=[a,b,c].map(i=>[nrm[i*3],nrm[i*3+1],nrm[i*3+2]])
    if (!ns.every(v=>Math.abs(v[0])<1e-4 && Math.abs(v[1])<1e-4)) badTri++
  }
}
console.log('top tris', triTotal, 'with non-flat normals', badTri)
