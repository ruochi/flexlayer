/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2: transmission 1 → glass. Cream card + close stripes so the
// sphere refracts a continuous field (dropedge: avoid milky RGB-column read
// without plate-edge AA crushing the cell).
const glass = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 48, 32),
  new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, roughness: 0.03, ior: 1.45, metalness: 0, thickness: 0.4 }),
)
glass.position.set(0, 0.55, 0.4)
function stripe(color: string, x: number) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 1.25, 0.1),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0 }),
  )
  mesh.position.set(x, 0.66, -0.22)
  return mesh
}
const card = new THREE.Mesh(
  new THREE.BoxGeometry(1.55, 1.3, 0.05),
  new THREE.MeshStandardMaterial({ color: '#efe8df', roughness: 0.75, metalness: 0 }),
)
card.position.set(0, 0.66, -0.28)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer width={440} height={300} camera="fov 30, orbit 28 18, distance 720, at 220 175 0">
      <ground y={220} rotateX={90} fill="#3a3f49" shadow-blur={56} shadow-opacity={0.22} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model object={card} unit={110} x={200} y={190} />
        <model object={stripe('#d94a3a', -0.4)} unit={110} x={200} y={190} />
        <model object={stripe('#f4f0e8', -0.1)} unit={110} x={200} y={190} />
        <model object={stripe('#3a7ec8', 0.2)} unit={110} x={200} y={190} />
        <model object={glass} unit={150} x={200} y={190} material="glass 0.08" />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Physical · transmission 1</p>
    </layer>
  </layer>,
)
