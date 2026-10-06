/** @jsxImportSource @dc/flexlayer */

import { canvas, type Composition } from '@dc/flexlayer'

export const composition: Composition = {
  id: 'slide',
  width: 320,
  height: 180,
  fps: 4,
  durationInFrames: 4,
  component: ({ frame }) =>
    canvas.create(
      <layer width={320} height={180} safe="0">
        <rect x="0" y="0" width="320" height="180" fill="#0e1219" />
        <rect width="40" height="40" fill="#3ecfc4" x={20 + frame * 70} y={70} />
      </layer>,
    ),
}
