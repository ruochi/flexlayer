/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 1: MeshStandardMaterial, metalness 1.
// SPEC maps metalness ≥ 0.5 to `metal`. Keep Standard (not Physical).
// Mid-silver + bounce cards; polishfill weak FILL left a matte cutout (§9.2).
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  // Fillcell: dual-blind B read 0.02 polish as flat matte white — cooler mid
  // silver + slightly higher roughness so studio panels show as reflection.
  new THREE.MeshStandardMaterial({ color: '#b8c2cc', metalness: 1, roughness: 0.08 }),
)

export default layer.create(
  <layer width={440} height={300} background="#241f1b" expect="overflow-canvas: bounce walls">
    <layer width={440} height={300} camera="fov 32, orbit 36 24, distance 720, at 220 185 0" light="world">
      <light type="hemisphere" intensity="0.45" color="#e8eef4" ground-color="#3a4048" />
      <light type="directional" intensity="1.05" color="#ffffff" x="-180" y="-420" z="520" target="0 0 0" />
      <light type="point" intensity="3.0" color="#ff9a4a" x="300" y="40" z="220" distance="700" />
      <light type="point" intensity="1.6" color="#8ec8ff" x="-120" y="60" z="180" distance="500" />
      <ground y={220} rotateX={90} fill="#2a3038" shadow-blur={52} shadow-opacity={0.34} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <rect x="-10" y="-80" width="420" height="12" depth="260" fill="#1a1e24" />
        <rect x="250" y="-45" width="140" height="12" depth="180" fill="#e87838" />
        <rect x="30" y="-30" width="100" height="10" depth="160" fill="#4a8fd0" />
        <rect x="80" y="-55" width="180" height="8" depth="220" fill="#fff4ea" />
        <model object={mesh} unit={150} x={200} y={190} material="finish metal, color #b8c2cc, roughness 0.08, metalness 1" />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Standard · metal 1 · rough 0.08</p>
    </layer>
  </layer>,
)
