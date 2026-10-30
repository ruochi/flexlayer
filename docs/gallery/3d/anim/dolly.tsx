/** @jsxImportSource flexlayer */

import { interpolate, layer, type Composition } from 'flexlayer'

/**
 * QUALITY-6 §B.2. The camera pushes in from distance 1400 to 700. Geometry and
 * light stay put, so anything that changes shape between frames is the
 * renderer's: the bevel radius is chosen from the screen scale, and the contact
 * map's texel size follows the projection.
 */
export const composition: Composition = {
  id: 'dolly',
  width: 640,
  height: 420,
  fps: 30,
  durationInFrames: 30,
  component: ({ frame }) =>
    layer.create(
      <layer width={640} height={420} background="#efe9df">
        <layer
          width={640}
          height={420}
          camera={`fov 30, orbit 24 26, distance ${interpolate(frame, [0, 29], [1400, 700])}, at 320 360 0`}
        >
          <ground y={420} rotateX={90} fill="#e7e0d4" shadow-blur={30} />
          <layer x={60} y={420} width={520} height={260} origin="260 0" rotateX={90} preserve-3d>
            <rect x={120} y={70} width={130} height={100} depth={100} rx={10} fill="#d23b3b" material="plastic 0.3" />
            <sphere cx={370} cy={120} r={56} z={56} fill="#c5c9ce" material="metal 0.2" />
          </layer>
        </layer>
      </layer>,
    ),
}
