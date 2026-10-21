# 2D geometry

Built in `src/geom-*.ts`, tested in `src/geom.spec.ts`. This file is the spec until it moves into SPEC. What is not built yet is listed under "Status".

Markup stays SVG. Geometry is computed in `.tsx`, and the result is handed to `<path d>`:

```tsx
import { Path2D, buffer, union, fillet } from 'flexlayer'

const card = new Path2D()
card.roundRect(150, 120, 90, 40, 6)

const lead = fillet(new Path2D('M60 190 L120 160 L160 160'), 8)
const plate = buffer(buffer(union(card, buffer(lead, 2.5)), 6), -6)

<path d={plate.toSVGString()} fill="#fff" stroke="none" />
<path d={lead.toSVGString()} fill="none" stroke="#3a9" stroke-width="2.5" />
```

No tag and no attribute is added. `.layer` cannot run these functions. `--emit` writes the computed `d`. A `<path>` with no fill strokes 4 px in the text color. A filled path does not take that stroke, and `check` reports `implicit-stroke`, so a filled region writes `stroke="none"`.

Each layer of the API follows an existing standard. This document only fills what those standards leave open: direction, sign, failure, and exact output.

| Layer | Standard | Names |
| --- | --- | --- |
| Construction | WHATWG Canvas `Path2D` | `moveTo`, `lineTo`, `arcTo`, `arc`, `ellipse`, `quadraticCurveTo`, `bezierCurveTo`, `rect`, `roundRect`, `closePath`, `addPath`, `new Path2D(d)` |
| Regions | OGC Simple Features (ISO 19125-1) | `buffer`, `union`, `difference`, `intersection`, `symDifference` |
| Curves | Commands shared by AutoCAD and Rhino | `fillet`, `chamfer`, `offset`, `blend`, `trim`, `extend`, `join`, `reverse` |
| Queries | Object snaps | `intersections`, `closestPoint`, `pointAt`, `tangentAt`, `length`, `bounds`, `area`, `contains` |

## Values

Coordinates are the containing layer's local pixels, y down, the same as `<path d>`. Angles inside `Path2D` are radians, as in Canvas. Elsewhere in flexlayer angles are degrees.

A point is written `{ x, y }` or `[x, y]`. A returned point is always `{ x, y }`.

A **curve** is a `Path2D` with exactly one subpath, open or closed. Its direction runs from its first point to its last.

A **region** is a `Path2D` read with the nonzero fill rule, as SVG fills by default. An open subpath is closed by a straight segment, as SVG fill does. A hole winds opposite to its outer contour, or is made with `difference`.

Every function is pure. It does not modify its arguments, and it returns a new `Path2D`. The same input always gives the same output.

## Exact segments

`Path2D` exported from `flexlayer` is the Canvas `Path2D`. It also remembers the exact segments it was built from: lines, circular and elliptical arcs, quadratic and cubic Béziers. Every function here reads and writes those segments.

- Lines and circular arcs stay exact through `fillet`, `chamfer`, `offset`, `trim`, `extend`, `join`, and `reverse`.
- `fillet` produces circular arcs. `chamfer` produces lines.
- The offset of a Bézier or an elliptical arc is a fitted cubic within 0.05 px.
- Region operations (`buffer`, `union`, `difference`, `intersection`, `symDifference`) are computed by Skia PathOps. Their result is quadratic pieces within 0.05 px, not arcs. A curve function given such a result treats its corners as Bézier corners.

`toSVGString()` writes `M`, `L`, `A`, `Q`, `C`, and `Z` in absolute coordinates, numbers rounded to 3 decimals. A circular arc is written as `A`. A full circle is two `A`. A closing straight edge is left to `Z`.

The native `@napi-rs/canvas` methods `op`, `stroke`, `round`, `simplify`, `asWinding`, `trim`, and `dash` still exist on the object. They are outside this document. They modify the path in place, and afterwards its exact segments are read back from the result, so arcs become quadratic pieces. `transform` keeps arcs under rotation, translation, and uniform scale.

## Regions

Names and meaning follow OGC Simple Features. Results agree with shapely, GEOS, JTS, and PostGIS for the same coordinates, within 0.05 px.

In `buffer`, a closed subpath is a region, an open subpath is a curve, and a subpath that is a single `moveTo` is a point.

| Function | Result |
| --- | --- |
| `buffer(g, distance, options?)` | All points within `distance` of `g`. On a region, a positive distance grows it and a negative one shrinks it. On an open curve or a single point, a positive distance gives a band or a disc. A distance of 0 or less there gives an empty path |
| `union(...gs)` | Points in any input |
| `difference(a, ...bs)` | Points in `a` and in none of `bs` |
| `intersection(a, ...bs)` | Points in every input |
| `symDifference(a, b)` | Points in exactly one input |

`buffer` options use shapely's names: `joinStyle` is `round` (default), `mitre`, or `bevel`. `capStyle` is `round` (default), `flat`, or `square`. `mitreLimit` defaults to 5.

`buffer(buffer(g, r), -r)` rounds concave corners with radius `r` and keeps convex corners sharp. `buffer(buffer(g, -r), r)` rounds convex corners. CHEATSHEET names both.

A result contour runs clockwise on screen. A hole runs counterclockwise. The default `fill-rule` therefore draws holes.

## Curves

| Function | Result |
| --- | --- |
| `fillet(a, b, radius)` | `a`, then an arc of `radius` tangent to both, then `b`, joined into one curve. `a` and `b` are trimmed back, or lines and arcs are extended, to the tangent points. The ends nearest the meeting point are used, and the tangent points lie on the parts kept up to it. A radius of 0 trims or extends both to a sharp corner. The two meeting segments are lines or circular arcs |
| `fillet(curve, radius)` | Every corner of one curve rounded with `radius`. A corner between a line and an arc counts. A smooth joint is left alone. A corner touching a Bézier or an elliptical arc is left sharp |
| `chamfer(a, b, d1, d2 = d1)` | Like `fillet`, with a straight cut `d1` along `a` and `d2` along `b` from the corner |
| `chamfer(curve, d)` | Every corner of one curve cut with `d` on both sides, measured along the curve. Any segment kind counts |
| `offset(curve, distance, options?)` | The parallel curve at `distance`. Positive lies along `(−dy, dx)` of the direction of travel: in y-down coordinates, the right-hand side on screen. This is the formula of OGC `ST_OffsetCurve` and shapely `offset_curve`, so the same coordinates give the same result. `joinStyle` defaults to `mitre`, as a CAD offset keeps corners sharp |
| `blend(a, b, options?)` | A Bézier from the end of `a` to the start of `b`. `continuity` is `tangency` (default, cubic) or `curvature` (quintic), Rhino's names. `bulge` is `[1, 1]` by default and scales the two tangent handles |
| `trim(curve, cutter, keep)` | `curve` split where it meets `cutter`. `keep` is `'start'` (start to the first crossing), `'end'` (last crossing to the end), or a point (the piece nearest that point) |
| `extend(curve, boundary, end = 'both')` | `curve` lengthened until it meets `boundary`. `end` is `'start'`, `'end'`, or `'both'`. A line extends straight, an arc along its circle, a Bézier along its end tangent |
| `join(...curves)` | Curves chained end to end into one, reversing where needed. Ends closer than 0.01 px count as touching |
| `reverse(curve)` | The same curve, travelled the other way |

`fillet(curve, radius)` and `chamfer(curve, d)` clamp each corner separately, with the rule of CSS Shapes `polygon(round …)`: the cut along each adjacent segment is at most half that segment's length.

## Queries

`s` is distance along a curve from its start, in pixels.

| Function | Returns |
| --- | --- |
| `intersections(a, b)` | `[{ x, y, sa, sb }]`, ordered by `sa` |
| `closestPoint(curve, point)` | `{ x, y, s, distance }` |
| `pointAt(curve, s)` | `{ x, y }`. `s` is clamped to the curve |
| `tangentAt(curve, s)` | Unit vector `{ x, y }` along the direction of travel |
| `length(curve)` | Pixels |
| `bounds(g)` | `{ x, y, width, height }` of the exact geometry |
| `area(region)` | Square pixels, always positive |
| `contains(region, point)` | Boolean, nonzero rule |

The midpoint is `pointAt(c, length(c) / 2)`. The end is `pointAt(c, length(c))`.

## Failure

A bad argument throws: a non-finite number, a negative radius, or something that is not a `Path2D` or a point.

A geometric impossibility does not throw. The function returns its best result and records an issue. `check` and `render` add it to the report, at the call's source location, such as `scene.tsx:12:5`. Each is `warn`. The same issue from the same call is reported once. An `expect` on the root covers these codes, as for any other issue.

| Code | When | Result |
| --- | --- | --- |
| `fillet-too-large` | A corner's radius or cut did not fit and was clamped, or two curves have no fillet of that radius | Clamped corner, or `a` and `b` as two subpaths |
| `no-intersection` | `trim`, `extend`, or a two-curve `fillet` found no meeting point | A copy of the input |
| `offset-collapse` | `offset` or a negative `buffer` removed part or all of the input | What remains, possibly empty |
| `empty-geometry` | A region operation returned nothing | An empty path |
| `not-a-curve` | A curve function received several subpaths, or `join` could not chain them all | The first subpath is used. `join` keeps the rest as further subpaths |
| `curve-unsupported` | `fillet` met a Bézier or an elliptical arc at a corner or a meeting end | The corner is left sharp, or `a` and `b` as two subpaths |

The hint states the largest value that would fit, when there is one.

## Examples

These are normative. An implementation returns these values. Numbers in comments are rounded to 3 decimals. `buffer` bounds hold within 0.05 px.

```ts
fillet(new Path2D('M240 40 L60 40'), new Path2D('M60 40 L60 160'), 8).toSVGString()
// 'M240 40 L68 40 A8 8 0 0 0 60 48 L60 160'

chamfer(new Path2D('M240 40 L60 40'), new Path2D('M60 40 L60 160'), 5).toSVGString()
// 'M240 40 L65 40 L60 45 L60 160'

offset(new Path2D('M0 0 L100 0'), 10).toSVGString()
// 'M0 10 L100 10'

bounds(buffer(new Path2D('M0 0 H100 V100 H0 Z'), 6))
// { x: -6, y: -6, width: 112, height: 112 }

bounds(buffer(new Path2D('M0 0 H100 V100 H0 Z'), -6))
// { x: 6, y: 6, width: 88, height: 88 }

intersections(new Path2D('M0 0 L100 100'), new Path2D('M0 100 L100 0'))
// [{ x: 50, y: 50, sa: 70.711, sb: 70.711 }]
```

## Status

Everything above is built, except:

- `blend` with `continuity: 'curvature'` throws. Only `tangency` is built.
- `offset` trims adjacent segments where they cross. It does not remove loops between segments farther apart, or the cusp of a Bézier offset past its radius of curvature.
- Issues are collected while the module runs. A geometry call inside a `Composition`'s `component` runs per frame, after loading, and its issues are not reported.

## Not covered

A constraint solver, NURBS editing, dimension lines, text on a path, and 3D. Solids stay with `depth` and `<model object>`.
