/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 1: MeshStandardMaterial, metalness 1.
// SPEC maps metalness ≥ 0.5 to `metal`. Keep Standard (not Physical).
// Matclose: metshine B Standard read matte white under flood lamps — darker
// lid + saturated bounce cards so SSR reflections contrast; keep yaw.
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#9aa6b4', metalness: 1, roughness: 0.02 }),
)
mesh.rotation.y = 0.42
mesh.rotation.x = -0.1

export default layer.create(
  <layer width={440} height={300} background="#1c1816">
    <layer
      width={440}
      height={300}
      camera="fov 34, orbit 40 22, distance 860, at 220 198 0"
      light="world"
      quality="final"
    >
      <light type="hemisphere" intensity="0.28" color="#dce6f0" ground-color="#1e242c" />
      <light type="directional" intensity="0.7" color="#ffffff" x="-200" y="-400" z="520" target="0 0 0" />
      <light type="point" intensity="1.6" color="#ffffff" x="320" y="20" z="240" distance="700" />
      <light type="point" intensity="1.8" color="#6ab0ff" x="-140" y="50" z="200" distance="500" />
      <ground y={220} rotateX={90} fill="#222830" shadow-blur={52} shadow-opacity={0.38} />
      <sphere cx="88" cy="125" r="36" z="95" fill="#fff4ea" material="lamp" />
      <sphere cx="348" cy="120" r="32" z="90" fill="#4a9cff" material="lamp" />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <rect x="-10" y="-80" width="420" height="12" depth="260" fill="#14181e" />
        <rect x="250" y="-45" width="150" height="12" depth="190" fill="#e87838" />
        <rect x="20" y="-30" width="110" height="10" depth="170" fill="#3a8fd8" />
        <rect x="70" y="-55" width="170" height="8" depth="210" fill="#fff6ee" />
        <model object={mesh} unit={120} x={200} y={188} material="finish metal, color #9aa6b4, roughness 0.02, metalness 1" />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Standard · metal 1 · rough 0.02 · final</p>
    </layer>
  </layer>,
)
