/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 1: MeshStandardMaterial, metalness 1.
// SPEC maps metalness ≥ 0.5 to `metal`. Keep Standard (not Physical).
// Mid-silver + bright bounce cards so env reflections read (§9.2 envfill).
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#c2c8d0', metalness: 1, roughness: 0.08 }),
)

export default layer.create(
  <layer width={440} height={300} background="#241f1b" expect="overflow-canvas: bounce walls">
    <layer width={440} height={300} camera="fov 30, orbit 38 26, distance 800, at 220 200 0" light="world">
      <light type="hemisphere" intensity="0.7" color="#e8eef4" ground-color="#4a5058" />
      <light type="directional" intensity="0.48" color="#ffffff" x="-220" y="-380" z="500" target="0 0 0" />
      <light type="point" intensity="1.6" color="#ff9a4a" x="320" y="60" z="200" distance="720" />
      <ground y={220} rotateX={90} fill="#2a3038" shadow-blur={56} shadow-opacity={0.34} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <rect x="-10" y="-80" width="420" height="12" depth="260" fill="#1a1e24" />
        <rect x="240" y="-50" width="140" height="12" depth="180" fill="#f07838" />
        <rect x="30" y="-30" width="100" height="10" depth="160" fill="#4a8fd0" />
        <rect x="80" y="-100" width="200" height="8" depth="40" fill="#f4f0e8" />
        <model object={mesh} unit={120} x={200} y={190} />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Standard · metal 1 · rough 0.08</p>
    </layer>
  </layer>,
)
