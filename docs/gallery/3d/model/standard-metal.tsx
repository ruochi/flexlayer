/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 1: MeshStandardMaterial, metalness 1.
// SPEC maps metalness ≥ 0.5 to `metal`. Keep Standard (not Physical).
// Metcube: metglass mid-silver r0.08 read chalk-matte under §9.2 A — restore
// seampale mirror polish + larger bounce cards so reflections read.
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#dce4ec', metalness: 1, roughness: 0.03 }),
)

export default layer.create(
  <layer width={440} height={300} background="#241f1b" expect="overflow-canvas: bounce walls">
    <layer width={440} height={300} camera="fov 34, orbit 36 24, distance 780, at 220 190 0" light="world">
      <light type="hemisphere" intensity="0.5" color="#e8eef4" ground-color="#3a4048" />
      <light type="directional" intensity="0.95" color="#ffffff" x="-180" y="-420" z="520" target="0 0 0" />
      <light type="point" intensity="3.2" color="#ff9a4a" x="300" y="40" z="220" distance="700" />
      <light type="point" intensity="1.7" color="#8ec8ff" x="-120" y="60" z="180" distance="500" />
      <ground y={220} rotateX={90} fill="#2a3038" shadow-blur={52} shadow-opacity={0.34} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <rect x="-10" y="-80" width="420" height="12" depth="260" fill="#1a1e24" />
        <rect x="240" y="-50" width="150" height="12" depth="190" fill="#e87838" />
        <rect x="20" y="-35" width="110" height="10" depth="170" fill="#4a8fd0" />
        <rect x="70" y="-60" width="200" height="8" depth="230" fill="#fff4ea" />
        <model object={mesh} unit={140} x={200} y={185} material="finish metal, color #d4dce6, roughness 0.04, metalness 1" />
      </layer>
    </layer>
    <layer x={12} y={274}>
      <p style="font-size:18px; color:#b7aea2">Standard · metal 1 · rough 0.03</p>
    </layer>
  </layer>,
)
