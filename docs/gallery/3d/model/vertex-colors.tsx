/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

/**
 * QUALITY-6 §E.2 cell 7: vertex colours. SPEC says the attribute multiplies the
 * material colour before shading, so a body painted per-vertex has to keep the
 * pattern under the light instead of being flattened to the material colour.
 *
 * A sphere is used because a box's six faces would each read as one flat tone
 * and say nothing about interpolation. The colours are written in linear space,
 * the way three.js stores them, so the sRGB result is what a `fill` of the same
 * hex would look like.
 */
const geometry = new THREE.SphereGeometry(0.55, 48, 32)
const position = geometry.getAttribute('position')
const colors = new Float32Array(position.count * 3)
for (let i = 0; i < position.count; i++) {
  // Longitude bands: red at the seam, then green and blue, wrapping back.
  const angle = Math.atan2(position.getZ(i), position.getX(i))
  const band = (angle / (Math.PI * 2) + 0.5) * 3
  const t = band % 1
  const from = Math.floor(band) % 3
  const to = (from + 1) % 3
  const value = [0, 0, 0]
  value[from] = 1 - t
  value[to] = t
  // Bright enough that the shading does not swallow the hue at the rim.
  for (let c = 0; c < 3; c++) colors[i * 3 + c] = 0.25 + 0.75 * value[c]!
}
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

const mesh = new THREE.Mesh(
  geometry,
  new THREE.MeshStandardMaterial({ vertexColors: true, color: '#ffffff', roughness: 0.55, metalness: 0 }),
)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer width={440} height={300} camera="fov 32, orbit 34 22, distance 860, at 220 210 0">
      <ground y={220} rotateX={90} fill="#3a3f49" shadow-blur={26} shadow-opacity={0.5} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model object={mesh} unit={120} x={200} y={190} />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">顶点色 · vertexColors</p>
    </layer>
  </layer>,
)
