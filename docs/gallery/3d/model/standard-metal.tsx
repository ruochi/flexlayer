/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 1: MeshStandardMaterial, metalness 1, roughness 0.2.
// SPEC maps metalness ≥ 0.5 to `metal`, so this must read like
// `material="metal 0.2"`.
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  // Slightly lighter albedo so the metal-1 top does not read near-black (§9.2).
  new THREE.MeshStandardMaterial({ color: '#d4d9df', metalness: 1, roughness: 0.22 }),
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
      <p style="font-size:19px; color:#b7aea2">Standard · metal 1 · rough 0.2</p>
    </layer>
  </layer>,
)
