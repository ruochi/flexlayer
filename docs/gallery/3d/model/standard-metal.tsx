/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 1: MeshStandardMaterial, metalness 1.
// SPEC maps metalness ≥ 0.5 to `metal`. Keep Standard (not Physical) so the
// mapping cell stays honest; polished rough + warm bounce for §9.2 look.
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#f4f7fb', metalness: 1, roughness: 0.08 }),
)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer width={440} height={300} camera="fov 32, orbit 38 26, distance 820, at 220 200 0" light="world">
      <light type="hemisphere" intensity="0.85" color="#fff4e8" ground-color="#5a6068" />
      <light type="directional" intensity="0.22" color="#fff0e0" x="-180" y="-320" z="420" target="0 0 0" />
      <ground y={220} rotateX={90} fill="#3a3f49" shadow-blur={56} shadow-opacity={0.30} />
      {/* Warm accent so flat metal catches a readable reflection (§9.2). */}
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <rect x="-20" y="-80" width="440" height="12" depth="260" fill="#f0a060" />
        <rect x="40" y="-50" width="120" height="10" depth="180" fill="#6a90c8" />
        <model object={mesh} unit={120} x={200} y={190} />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Standard · metal 1 · rough 0.08</p>
    </layer>
  </layer>,
)
