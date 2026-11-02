/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 1: MeshStandardMaterial, metalness 1.
// SPEC maps metalness ≥ 0.5 to `metal`. Keep Standard (not Physical).
// Mid-silver + bounce cards; polishfill weak FILL left a matte cutout (§9.2).
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  // Mintgate: mintbars B still flat diffuse grey at 0.03 — mirror polish + bigger bounce.
  new THREE.MeshStandardMaterial({ color: '#e0e6ee', metalness: 1, roughness: 0.02 }),
)

export default layer.create(
  <layer width={440} height={300} background="#241f1b" expect="overflow-canvas: bounce walls">
    <layer width={440} height={300} camera="fov 32, orbit 36 24, distance 780, at 220 195 0" light="world">
      <light type="hemisphere" intensity="0.78" color="#eef2f6" ground-color="#454b54" />
      <light type="directional" intensity="0.7" color="#ffffff" x="-220" y="-380" z="500" target="0 0 0" />
      <light type="point" intensity="2.1" color="#ff9a4a" x="320" y="70" z="200" distance="700" />
      <ground y={220} rotateX={90} fill="#2a3038" shadow-blur={52} shadow-opacity={0.34} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <rect x="-10" y="-80" width="420" height="12" depth="260" fill="#1a1e24" />
        <rect x="250" y="-45" width="140" height="12" depth="180" fill="#e87838" />
        <rect x="30" y="-30" width="100" height="10" depth="160" fill="#4a8fd0" />
        <rect x="80" y="-55" width="160" height="8" depth="200" fill="#fff4ea" />
        <model object={mesh} unit={135} x={200} y={190} />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Standard · metal 1 · rough 0.02</p>
    </layer>
  </layer>,
)
