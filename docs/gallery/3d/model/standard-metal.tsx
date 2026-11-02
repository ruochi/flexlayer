/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 1: MeshStandardMaterial, metalness 1.
// SPEC maps metalness ≥ 0.5 to `metal`. Keep Standard (not Physical).
// Metfix: boxyaw A model 6.8 / B flat-white Standard — cooler mid silver,
// less lamp blow, mild yaw so bounce cards read in the mirror.
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#d4dce6', metalness: 1, roughness: 0.015 }),
)
mesh.rotation.y = 0.40
mesh.rotation.x = -0.08

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer
      width={440}
      height={300}
      camera="fov 34, orbit 38 24, distance 850, at 220 198 0"
      light="world"
      quality="final"
    >
      <light type="hemisphere" intensity="0.38" color="#e8eef4" ground-color="#2e343c" />
      <light type="directional" intensity="0.82" color="#ffffff" x="-180" y="-420" z="520" target="0 0 0" />
      <light type="point" intensity="2.0" color="#ffffff" x="300" y="40" z="220" distance="700" />
      <light type="point" intensity="1.8" color="#8ec8ff" x="-120" y="60" z="180" distance="500" />
      <ground y={220} rotateX={90} fill="#2a3038" shadow-blur={52} shadow-opacity={0.34} />
      <sphere cx="95" cy="130" r="32" z="90" fill="#efe8e0" material="lamp" />
      <sphere cx="340" cy="125" r="28" z="85" fill="#5aa8ff" material="lamp" />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <rect x="-10" y="-80" width="420" height="12" depth="260" fill="#1a1e24" />
        <rect x="250" y="-45" width="140" height="12" depth="180" fill="#e87838" />
        <rect x="30" y="-30" width="100" height="10" depth="160" fill="#3a90e0" />
        <rect x="80" y="-55" width="160" height="8" depth="200" fill="#fff6ee" />
        <model object={mesh} unit={118} x={200} y={188} material="finish metal, color #c8d2dc, roughness 0.015, metalness 1" />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Standard · metal 1 · rough 0.02 · final</p>
    </layer>
  </layer>,
)
