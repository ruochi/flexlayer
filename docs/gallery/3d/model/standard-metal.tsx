/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 1: MeshStandardMaterial, metalness 1.
// SPEC maps metalness ≥ 0.5 to `metal`. Keep Standard (not Physical).
// Metalfinal: draft SSR never painted bounce color onto the cube (cubepolish
// A/B model 5–6). quality=final enables BVH reflections of the cards/lamps;
// slightly cooler mid albedo so those hits read against the body.
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#c5ced8', metalness: 1, roughness: 0.02 }),
)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer
      width={440}
      height={300}
      camera="fov 34, orbit 42 22, distance 820, at 220 185 0"
      light="world"
      quality="final"
    >
      <light type="hemisphere" intensity="0.4" color="#e8eef4" ground-color="#3a4048" />
      <light type="directional" intensity="0.9" color="#ffffff" x="-180" y="-420" z="520" target="0 0 0" />
      <light type="point" intensity="3.6" color="#ff9a4a" x="300" y="40" z="220" distance="700" />
      <light type="point" intensity="2.4" color="#8ec8ff" x="-120" y="60" z="180" distance="500" />
      <ground y={220} rotateX={90} fill="#2a3038" shadow-blur={52} shadow-opacity={0.34} />
      <sphere cx="100" cy="145" r="40" z="100" fill="#ff7a30" material="lamp" />
      <sphere cx="330" cy="140" r="36" z="95" fill="#5aa8ff" material="lamp" />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <rect x="-10" y="-80" width="420" height="12" depth="260" fill="#1a1e24" />
        <rect x="245" y="-55" width="150" height="12" depth="200" fill="#e87838" />
        <rect x="25" y="-40" width="110" height="10" depth="180" fill="#4a8fd0" />
        <rect x="85" y="-70" width="170" height="8" depth="220" fill="#fff4ea" />
        <model object={mesh} unit={132} x={200} y={188} material="finish metal, color #c5ced8, roughness 0.02, metalness 1" />
      </layer>
    </layer>
    <layer x={12} y={274}>
      <p style="font-size:18px; color:#b7aea2">Standard · metal 1 · rough 0.02 · final</p>
    </layer>
  </layer>,
)
