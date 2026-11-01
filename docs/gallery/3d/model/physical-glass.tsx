/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2: transmission 1 → glass. Softplate: bright wide cream card +
// stripes set back so refraction reads continuous (dropedge milky RGB/dark patch).
const glass = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 48, 32),
  new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    transmission: 1,
    roughness: 0.02,
    ior: 1.45,
    metalness: 0,
    thickness: 0.28,
  }),
)
glass.position.set(0, 0.55, 0.42)
function stripe(color: string, x: number) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 1.2, 0.08),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0 }),
  )
  mesh.position.set(x, 0.66, -0.32)
  return mesh
}
const card = new THREE.Mesh(
  new THREE.BoxGeometry(1.7, 1.35, 0.04),
  new THREE.MeshStandardMaterial({ color: '#f5efe6', roughness: 0.8, metalness: 0 }),
)
card.position.set(0, 0.66, -0.38)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer width={440} height={300} camera="fov 30, orbit 28 18, distance 720, at 220 175 0">
      <ground y={220} rotateX={90} fill="#3a3f49" shadow-blur={56} shadow-opacity={0.22} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model object={card} unit={110} x={200} y={190} />
        <model object={stripe('#d94a3a', -0.38)} unit={110} x={200} y={190} />
        <model object={stripe('#f4f0e8', -0.08)} unit={110} x={200} y={190} />
        <model object={stripe('#3a7ec8', 0.22)} unit={110} x={200} y={190} />
        <model object={glass} unit={150} x={200} y={190} material="glass 0.06" />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Physical · transmission 1</p>
    </layer>
  </layer>,
)
