/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// Floorbars: softbars B model 6.5 — cream booth on a dark #241f1b page still
// left a dark band across the top, and transmission refracted that into a
// black blotch. Match the page to the booth, fill the frame, frost the shell.
const glass = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 64, 48),
  new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    transmission: 1,
    roughness: 0.36,
    ior: 1.4,
    metalness: 0,
    thickness: 0.28,
    attenuationColor: '#ffffff',
    attenuationDistance: 0.7,
  }),
)
glass.position.set(0, 0.72, 0.35)
const back = new THREE.Mesh(
  new THREE.BoxGeometry(2.4, 2.0, 0.08),
  new THREE.MeshStandardMaterial({ color: '#fff8f0', roughness: 0.95, metalness: 0 }),
)
back.position.set(0, 1.05, -0.45)
const floorCard = new THREE.Mesh(
  new THREE.BoxGeometry(2.2, 0.08, 1.4),
  new THREE.MeshStandardMaterial({ color: '#f2ebe2', roughness: 0.9, metalness: 0 }),
)
floorCard.position.set(0, 0.04, 0.2)
const key = new THREE.Mesh(
  new THREE.SphereGeometry(0.22, 24, 16),
  new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.5, roughness: 1 }),
)
key.position.set(-0.6, 1.15, 0.25)

export default layer.create(
  <layer width={440} height={300} background="#d8d0c4">
    <layer
      width={440}
      height={300}
      camera="fov 26, orbit 18 10, distance 760, at 220 188 0"
      light="world"
      quality="final"
    >
      <light type="hemisphere" intensity="1.05" color="#ffffff" ground-color="#efe6da" />
      <light type="directional" intensity="0.45" color="#ffffff" x="-80" y="-280" z="520" target="0 0 0" />
      <ground y={220} rotateX={90} fill="#d4cec4" shadow-blur={110} shadow-opacity={0.16} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model object={back} unit={110} x={200} y={190} />
        <model object={floorCard} unit={110} x={200} y={190} />
        <model object={key} unit={110} x={200} y={190} />
        <model object={glass} unit={150} x={200} y={190} material="glass 0.32" />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#6a6258">Physical · transmission 1</p>
    </layer>
  </layer>,
)
