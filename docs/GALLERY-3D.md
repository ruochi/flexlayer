# 3D gallery

These plates are the visual check for solids, cameras, materials, and shading. A plate that is one sphere on an empty ground is not enough: contact, occlusion, glass, a crevice, and a line have to be readable at a glance.

`npm run gallery:3d` rewrites the cells in `docs/gallery/3d/` and the sheets in `docs/gallery/`. Each cell is one camera. The sheet is those cells placed side by side. The long edge of a delivered picture is 1920.

## The bench

One still life. Shading, quality, and camera reuse it. It is written once in `scripts/gallery-3d.ts`. Do not restage a cell with a different object.

The bench has all of these:

- A ground (`rotateX="90"`) lighter than the page, with `shadow-blur`.
- A backdrop wall.
- A rounded plastic box on the ground beside a taller matte box, close enough to leave a crevice and to pass color.
- A metal slab with a sharp metal sphere sitting on it.
- A plastic sphere held above the ground, so its shadow separates from the contact shadows.
- A glass sphere in front of three saturated stripes.
- A standing cylinder (`circle` with `depth` on the floor plan).
- A flat plate with a hole.
- A neon torus and a lamp.

The camera, unless the plate says otherwise, is `fov 30, orbit 28 18, distance 1280, at 550 400 0`. Yaw and pitch are both nonzero, so a top, a front, and a side are in the picture. Labels are 2D and sit outside the camera layer.

## Plates

| Sheet | Cells | What you are looking at |
| --- | --- | --- |
| [3d-still.png](gallery/3d-still.png) | the bench, studio, draft | Contact is dark and tight. The lifted sphere's shadow is separate. The near solids cut the far ones. The hole stays open. The lamp lights a pool. Neon has a core and a halo. |
| [3d-shading.png](gallery/3d-shading.png) | `studio`, `toon`, `technical`, `manga` | The same bench. Studio is the continuous finish. Toon is flat color and an ink outline. Technical keeps the finish and adds an outline, a crease, and a hidden line. Manga is paper, hatch, or ink. No solid on this plate writes `stroke`. The lines come from `shading`. |
| [3d-quality.png](gallery/3d-quality.png) | `draft`, `final` | The same bench. Final widens the penumbra and adds occlusion in the crevice, one bounce, a reflection in the sharp metal, and a glass tint. Draft stays on the shadow map. The two panels have to differ in the crevice, in the chrome sphere, and in the glass. |
| [3d-materials.png](gallery/3d-materials.png) | sixteen finishes | Every cell is the same cluster: a wall, a rounded box, a sphere, and a cylinder or a neon torus, on a ground. One finish changes. Neighbors have to be distinguishable. The matte cell's camera-facing face stays the written fill. The two glass cells put the sphere in front of red, white, and blue stripes. |
| [3d-camera.png](gallery/3d-camera.png) | `orbit 28 18`, `orbit 10 46`, `orbit 62 14`, `aperture 14` | Three-quarter, from above, and from the side. The depth-of-field cell is soft away from the middle. The blur fades out. |
| [3d-lines.png](gallery/3d-lines.png) | one drawing | A different stage. A cylinder through a box, both with `stroke` and `hidden`. A turned box with `rx`. A cylinder with rim `rx`. A sphere outline. A plate with a hole. A tube elbow with `halo`. |

Material cells, in order: `matte`, `clay`, `clay` with `fill`, `plastic 0.12`, `plastic 0.85`, `metal 0.08`, `metal 0.8`, `mirror`, `brushed`, `glass 0.06`, `glass 0.72`, `clearcoat 1`, `anisotropy 0.9`, `sheen 0.85`, `lamp`, `neon`.

## A new plate

- Reuse the bench when the question is shading, quality, light, or camera.
- One camera per file. Assemble a sheet from the cell pictures.
- A cell's main solid stays large enough that a crease, a hatch, or a contact shadow is visible.
- `quality="final"` is only on the quality plate.
- Fit the ink in the cell. Do not silence `overflow-canvas` with `expect`.
- Labels name the attribute value and sit outside the camera layer.
