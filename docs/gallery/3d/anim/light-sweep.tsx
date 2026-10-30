/** @jsxImportSource flexlayer */

import { interpolate, layer, type Composition } from 'flexlayer'

/**
 * QUALITY-6 §B.2. The key light circles the bench; the camera is fixed. Geometry
 * and the projection do not change between frames, so a shadow that steps, a
 * contact map whose texel grid moves, or a penumbra that re-quantises shows up
 * here as a brightness reversal.
 */
export const composition: Composition = {
  id: 'light-sweep',
  width: 640,
  height: 420,
  fps: 30,
  durationInFrames: 30,
  component: ({ frame }) => {
    const angle = interpolate(frame, [0, 29], [-70, 70])
    const rad = (angle * Math.PI) / 180
    const x = Math.round(320 + Math.sin(rad) * 520)
    const z = Math.round(Math.cos(rad) * 520)
    return layer.create(
      <layer width={640} height={420} background="#efe9df">
        <layer width={640} height={420} camera="fov 30, orbit 24 26, distance 1000, at 320 360 0">
          <light type="directional" x={x} y={-260} z={z} target="320 420 0" intensity="2" color="#ffcf88" />
          <ground y={420} rotateX={90} fill="#e7e0d4" shadow-blur={30} />
          <layer x={60} y={420} width={520} height={260} origin="260 0" rotateX={90} preserve-3d>
            <rect x={120} y={70} width={130} height={100} depth={100} rx={10} fill="#d23b3b" material="plastic 0.3" />
            <sphere cx={370} cy={120} r={56} z={56} fill="#c5c9ce" material="metal 0.2" />
          </layer>
        </layer>
      </layer>,
    )
  },
}
