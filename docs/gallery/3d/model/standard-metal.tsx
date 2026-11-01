/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 1: MeshStandardMaterial, metalness 1.
// SPEC maps metalness ≥ 0.5 to `metal`. Keep Standard (not Physical).
// Cool mid albedo; polished FILL is weak so studio bands read (§9.2 glasstint).
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 1, roughness: 0.08 }),
)

export default layer.create(
  <layer width={440} height={300} background="#241f1b" expect="overflow-canvas: bounce walls">
    <layer width={440} height={300} camera="fov 30, orbit 42 30, distance 760, at 220 198 0" light="world">
      <light type="hemisphere" intensity="0.55" color="#d8dee6" ground-color="#3a4048" />
      <light type="directional" intensity="0.72" color="#ffffff" x="-260" y="-420" z="540" target="0 0 0" />
      <light type="point" intensity="1.8" color="#ff8a3a" x="300" y="40" z="180" distance="680" />
      <ground y={220} rotateX={90} fill="#252a32" shadow-blur={56} shadow-opacity={0.36} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <rect x="-10" y="-80" width="420" height="12" depth="260" fill="#12151a" />
        <rect x="230" y="-45" width="150" height="12" depth="180" fill="#f07838" />
        <rect x="20" y="-25" width="110" height="10" depth="160" fill="#4a8fd0" />
        <rect x="70" y="-110" width="220" height="8" depth="50" fill="#f4f0e8" />
        <model object={mesh} unit={120} x={200} y={190} />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Standard · metal 1 · rough 0.08</p>
    </layer>
  </layer>,
)
