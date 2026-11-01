/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 1: MeshStandardMaterial, metalness 1.
// SPEC maps metalness ≥ 0.5 to `metal`. Keep Standard (not Physical).
// Mid-grey albedo so studio env bands read (bright #f4 chalk under dual-blind).
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#b8c0c8', metalness: 1, roughness: 0.12 }),
)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer width={440} height={300} camera="fov 32, orbit 36 24, distance 840, at 220 205 0" light="world">
      <light type="hemisphere" intensity="0.65" color="#eef2f6" ground-color="#4a5058" />
      <light type="directional" intensity="0.28" color="#ffffff" x="-200" y="-360" z="480" target="0 0 0" />
      <ground y={220} rotateX={90} fill="#2e333b" shadow-blur={52} shadow-opacity={0.32} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        {/* Dark + warm bounce so mid-grey metal shows contrast bands (§9.2). */}
        <rect x="-20" y="-90" width="440" height="12" depth="280" fill="#1a1e24" />
        <rect x="300" y="-40" width="90" height="10" depth="160" fill="#c87840" />
        <model object={mesh} unit={120} x={200} y={190} />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Standard · metal 1 · rough 0.12</p>
    </layer>
  </layer>,
)
