/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

/**
 * QUALITY-6 §E.2 cell 8: `LineSegments` and `Points` mixed into a mesh, to show
 * that all three kinds share one depth buffer.
 *
 * A ring of line segments and a ring of dots lie on the floor around the solid
 * box. The half of each ring that passes *behind* the box must be hidden by it
 * and the half in front must be drawn, so the picture reads as a ring the box
 * stands inside rather than a complete circle painted over the box. A renderer
 * that drew lines and points in their own pass — the way a naive port of three's
 * renderer does — would show the whole circle, back half crossing the face.
 *
 * The ring is a polygon, not a smooth circle: a segment is one straight piece,
 * so where it disappears at the silhouette is unambiguous.
 *
 * Everything is one `Group`, because a `model` with `unit` is fitted to its own
 * bounds and three separate models would each be re-centred on their own box.
 *
 * This layer is `rotateX="90"`, so model y is depth and model z is height: the
 * ring is laid out in x/y and sits at z = 0, the floor.
 */
const box = new THREE.Mesh(
  new THREE.BoxGeometry(0.8, 0.8, 0.8),
  new THREE.MeshStandardMaterial({ color: '#d9d2c4', roughness: 0.75, metalness: 0 }),
)
box.position.set(0, 0.4, 0.4)

const SIDES = 20
const RADIUS = 0.92
const ringPoint = (i: number): [number, number, number] => {
  const angle = (i / SIDES) * Math.PI * 2
  return [Math.cos(angle) * RADIUS, 0.4 + Math.sin(angle) * RADIUS, 0.02]
}

const ringPoints: number[] = []
for (let i = 0; i < SIDES; i++) ringPoints.push(...ringPoint(i), ...ringPoint(i + 1))
const ringGeometry = new THREE.BufferGeometry()
ringGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ringPoints, 3))
const ring = new THREE.LineSegments(ringGeometry, new THREE.LineBasicMaterial({ color: '#e23b2f', linewidth: 3 }))

const dotPoints: number[] = []
for (let i = 0; i < SIDES; i++) dotPoints.push(...ringPoint(i))
const dotGeometry = new THREE.BufferGeometry()
dotGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dotPoints, 3))
const dots = new THREE.Points(dotGeometry, new THREE.PointsMaterial({ color: '#ffcf88', size: 0.15 }))

const group = new THREE.Group()
group.add(box, ring, dots)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer width={440} height={300} camera="fov 32, orbit 34 22, distance 860, at 220 210 0">
      <ground y={220} rotateX={90} fill="#3a3f49" shadow-blur={26} shadow-opacity={0.5} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model object={group} unit={120} x={200} y={190} />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Line / Points · 共用深度</p>
    </layer>
  </layer>,
)
