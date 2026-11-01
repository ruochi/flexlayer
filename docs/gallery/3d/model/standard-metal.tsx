/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 1: MeshStandardMaterial, metalness 1.
// SPEC maps metalness ≥ 0.5 to `metal`. Keep Standard (not Physical).
// Cool mid albedo + hard key + colored bounce so reflections are obvious (§9.2).
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 1, roughness: 0.1 }),
)

export default layer.create(
  <layer width={440} height={300} background="#241f1b" expect="overflow-canvas: bounce walls">
    <layer width={440} height={300} camera="fov 30, orbit 40 28, distance 780, at 220 200 0" light="world">
      <light type="hemisphere" intensity="0.45" color="#d8dde4" ground-color="#3a4048" />
      <light type="directional" intensity="0.55" color="#ffffff" x="-240" y="-400" z="520" target="0 0 0" />
      <light type="point" intensity="1.4" color="#ff8a3a" x="340" y="80" z="220" distance="700" />
      <ground y={220} rotateX={90} fill="#252a32" shadow-blur={56} shadow-opacity={0.34} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <rect x="0" y="-70" width="400" height="10" depth="240" fill="#12151a" />
        <rect x="260" y="-40" width="110" height="10" depth="160" fill="#e07030" />
        <rect x="50" y="-20" width="80" height="8" depth="140" fill="#3a6fb0" />
        <model object={mesh} unit={120} x={200} y={190} />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Standard · metal 1 · rough 0.10</p>
    </layer>
  </layer>,
)
