/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 1: MeshStandardMaterial, metalness 1.
// SPEC maps metalness ≥ 0.5 to `metal`. Keep Standard (not Physical).
// Glassmetal: metalfinal A still chalked the top (5) while B just cleared (7).
// Darker body + yaw so faces aim at orange/blue lamps; keep quality=final BVH.
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#8b959f', metalness: 1, roughness: 0.02 }),
)
mesh.rotation.y = 0.55
mesh.rotation.x = -0.2

export default layer.create(
  <layer width={440} height={300} background="#1a1816" expect="overflow-canvas: bounce walls">
    <layer
      width={440}
      height={300}
      camera="fov 32, orbit 48 18, distance 780, at 210 175 0"
      light="world"
      quality="final"
    >
      <light type="hemisphere" intensity="0.35" color="#d8e0e8" ground-color="#2a3038" />
      <light type="directional" intensity="1.1" color="#ffffff" x="-200" y="-380" z="480" target="0 0 0" />
      <light type="point" intensity="5.0" color="#ff7a28" x="260" y="30" z="200" distance="600" />
      <light type="point" intensity="4.0" color="#4a9cff" x="-80" y="50" z="160" distance="500" />
      <ground y={220} rotateX={90} fill="#1e2228" shadow-blur={48} shadow-opacity={0.4} />
      <sphere cx="70" cy="160" r="48" z="120" fill="#ff6a18" material="lamp" />
      <sphere cx="350" cy="150" r="44" z="110" fill="#3a90ff" material="lamp" />
      {/* Ceiling card — mirrors into the cube top under final rays. */}
      <rect x="120" y="20" width="220" height="10" depth="160" fill="#ff9030" z="210" />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <rect x="-10" y="-80" width="420" height="12" depth="260" fill="#12161c" />
        <rect x="240" y="-60" width="160" height="12" depth="210" fill="#e87838" />
        <rect x="20" y="-50" width="120" height="10" depth="190" fill="#3a7fd0" />
        <rect x="90" y="-75" width="180" height="8" depth="230" fill="#fff0e0" />
        <model object={mesh} unit={138} x={195} y={185} material="finish metal, color #8b959f, roughness 0.02, metalness 1" />
      </layer>
    </layer>
    <layer x={12} y={274}>
      <p style="font-size:18px; color:#b7aea2">Standard · metal 1 · rough 0.02 · final</p>
    </layer>
  </layer>,
)
