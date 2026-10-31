/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 5: an in-memory `map`. SPEC says a map and vertex colors
// multiply the base color before shading, so the checker must survive the
// lighting instead of being washed out by it. The texture is built in memory
// because a sample plate cannot ship an image the reader does not have.
function checker(size = 64, cells = 8): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  const step = size / cells
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = (Math.floor(x / step) + Math.floor(y / step)) % 2 === 0
      const i = (y * size + x) * 4
      data[i] = on ? 232 : 42
      data[i + 1] = on ? 214 : 52
      data[i + 2] = on ? 168 : 70
      data[i + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.needsUpdate = true
  return texture
}

const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ map: checker(), roughness: 0.7, metalness: 0 }),
)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer width={440} height={300} camera="fov 32, orbit 34 22, distance 860, at 220 210 0">
      <ground y={220} rotateX={90} fill="#3a3f49" shadow-blur={26} shadow-opacity={0.5} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model object={mesh} unit={120} x={200} y={210} />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:20px; color:#b7aea2">map · 内存贴图</p>
    </layer>
  </layer>,
)
