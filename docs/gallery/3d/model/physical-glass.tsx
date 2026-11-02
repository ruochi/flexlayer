/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// Softbars: mirrormat B model 6.5 — black blotch inside Physical sphere again.
// Drop colored stripes (they smear dark through transmission); cream booth only,
// frost the shell so refraction stays bright.
const glass = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 64, 48),
  new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    transmission: 1,
    roughness: 0.28,
    ior: 1.4,
    metalness: 0,
    thickness: 0.3,
    attenuationColor: '#ffffff',
    attenuationDistance: 0.8,
  }),
)
glass.position.set(0, 0.75, 0.4)
const back = new THREE.Mesh(
  new THREE.BoxGeometry(1.9, 1.5, 0.08),
  new THREE.MeshStandardMaterial({ color: '#fff8f0', roughness: 0.95, metalness: 0 }),
)
back.position.set(0, 0.95, -0.5)
const floorCard = new THREE.Mesh(
  new THREE.BoxGeometry(1.7, 0.08, 1.1),
  new THREE.MeshStandardMaterial({ color: '#f2ebe2', roughness: 0.9, metalness: 0 }),
)
floorCard.position.set(0, 0.04, 0.15)
const key = new THREE.Mesh(
  new THREE.SphereGeometry(0.2, 24, 16),
  new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.2, roughness: 1 }),
)
key.position.set(-0.55, 1.1, 0.2)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer
      width={440}
      height={300}
      camera="fov 28, orbit 20 12, distance 800, at 220 188 0"
      light="world"
      quality="final"
    >
      <light type="hemisphere" intensity="0.85" color="#ffffff" ground-color="#e8e0d4" />
      <light type="directional" intensity="0.4" color="#ffffff" x="-80" y="-280" z="520" target="0 0 0" />
      <ground y={220} rotateX={90} fill="#d4cec4" shadow-blur={110} shadow-opacity={0.18} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model object={back} unit={110} x={200} y={190} />
        <model object={floorCard} unit={110} x={200} y={190} />
        <model object={key} unit={110} x={200} y={190} />
        <model object={glass} unit={145} x={200} y={190} material="glass 0.22" />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Physical · transmission 1</p>
    </layer>
  </layer>,
)
