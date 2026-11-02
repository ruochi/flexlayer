/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// Mirrormat: glassread B model 6.5 — Standard metal read flat matte grey under
// a blown white pool. Dim lamps, hotter bounce cards, tighter roughness.
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#c8d0da', metalness: 1, roughness: 0.01 }),
)
mesh.rotation.y = 0.42
mesh.rotation.x = -0.1

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer
      width={440}
      height={300}
      camera="fov 34, orbit 36 22, distance 860, at 220 198 0"
      light="world"
      quality="final"
    >
      <light type="hemisphere" intensity="0.28" color="#d8e0e8" ground-color="#2a3038" />
      <light type="directional" intensity="0.65" color="#ffffff" x="-200" y="-400" z="480" target="0 0 0" />
      <light type="point" intensity="1.2" color="#ffe8d0" x="280" y="50" z="200" distance="600" />
      <light type="point" intensity="1.4" color="#6ab0ff" x="-100" y="70" z="160" distance="450" />
      <ground y={220} rotateX={90} fill="#2a3038" shadow-blur={56} shadow-opacity={0.36} />
      <sphere cx="70" cy="140" r="22" z="70" fill="#ffe8d8" material="lamp" />
      <sphere cx="360" cy="135" r="20" z="65" fill="#4a98ff" material="lamp" />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <rect x="-10" y="-80" width="420" height="12" depth="260" fill="#1a1e24" />
        <rect x="240" y="-40" width="150" height="12" depth="190" fill="#ff7a28" />
        <rect x="20" y="-25" width="110" height="10" depth="170" fill="#2a80e8" />
        <rect x="70" y="-55" width="170" height="8" depth="210" fill="#fff8f0" />
        <model object={mesh} unit={116} x={200} y={188} material="finish metal, color #b8c4d0, roughness 0.01, metalness 1" />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Standard · metal 1 · rough 0.02 · final</p>
    </layer>
  </layer>,
)
