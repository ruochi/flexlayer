/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// Glassclean: modelfill A model 6.8 — transmission sphere full of black
// reflection blotches (closer crop made them worse). Frost the shell, brighten
// the card, soften stripes, and ease the camera so refraction stays readable.
const glass = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 64, 48),
  new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    transmission: 1,
    roughness: 0.22,
    ior: 1.4,
    metalness: 0,
    thickness: 0.28,
    attenuationColor: '#f5fffb',
    attenuationDistance: 0.9,
  }),
)
glass.position.set(0, 0.70, 0.62)
function stripe(color: string, x: number) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 1.1, 0.08),
    new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0 }),
  )
  mesh.position.set(x, 0.66, -0.35)
  return mesh
}
const card = new THREE.Mesh(
  new THREE.BoxGeometry(1.55, 1.3, 0.05),
  new THREE.MeshStandardMaterial({ color: '#f7f2ea', roughness: 0.85, metalness: 0 }),
)
card.position.set(0, 0.66, -0.40)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer
      width={440}
      height={300}
      camera="fov 30, orbit 26 16, distance 720, at 220 178 0"
      light="world"
      quality="final"
    >
      <light type="hemisphere" intensity="0.55" color="#f0f4f8" ground-color="#3a4048" />
      <light type="directional" intensity="0.55" color="#ffffff" x="-140" y="-360" z="520" target="0 0 0" />
      <ground y={220} rotateX={90} fill="#4a5058" shadow-blur={120} shadow-opacity={0.28} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model object={card} unit={110} x={200} y={190} />
        <model object={stripe('#e09088', -0.38)} unit={110} x={200} y={190} />
        <model object={stripe('#f4f0e8', -0.1)} unit={110} x={200} y={190} />
        <model object={stripe('#7aa0c8', 0.18)} unit={110} x={200} y={190} />
        <model object={glass} unit={152} x={200} y={190} material="glass 0.2" />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Physical · transmission 1</p>
    </layer>
  </layer>,
)
