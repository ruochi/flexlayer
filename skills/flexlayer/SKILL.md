---
name: flexlayer
description: "Lay out one frame as a PNG with Flex Layer. Use for a poster, cover, slide, infographic, diagram, or social image, or when the user mentions flexlayer or .layer. Distinctive features: wireframe breaks in one depth buffer, text hidden behind an image by its ink, depth of field per object, and a stroke around the ink. Read the docs for the version in use."
license: MIT
compatibility: Node.js 20 or newer. Catalog fonts need a network the first time they are used, and download to ~/.cache/flexlayer/fonts.
metadata:
  author: ruochi
---

# Flex Layer

Flex Layer describes one frame with tags, renders it to PNG, and writes a layout report. Text and layout are HTML, rendered as HTML. Shapes use the SVG form. Authoring and rendering are separate. The handoff is `.layer` text. When there is data, a loop, or animation, write `.tsx`. Running it produces the same tree. Vue and React are not part of this.

Repository: https://github.com/ruochi/flexlayer

This skill does not record attributes, tags, command flags, or examples. Those change with the version. Before writing, read the docs that match the renderer you are using. When something is wrong, follow `path` and `hint` in the report.

## What is distinctive

Text, images, wireframes, and solids share one depth buffer. Only pixels that have ink occlude.

- A wireframe does not break on empty space. It breaks when it meets a solid. An edge hidden by its own body is dashed. An edge hidden by another object breaks.
- Text hides behind an image by its ink. One character can be half in front and half behind.
- Depth of field blurs per object. A blurred edge does not leak a color that was hidden.
- A stroke follows the ink after compositing. Overlapping characters get one outline.
- Translucent glass does not write depth. Edges behind it stay visible.

Check writes a report. Render writes a PNG. The report has paths, layout boxes, and ink. Fonts and palettes use the names in the resources doc.

## Beyond an HTML screenshot

An HTML screenshot paints a page from a browser. Flex Layer lays out text with the same CSS. The features below need the docs open:

- **Measure, then place.** Measure one block, then place the next, against the real layout box and against the ink after transform or projection.
- **Shapes and text in one tree.** Rectangles, circles, lines, paths, and arrows are drawn in a layer with shape attributes.
- **Solids and a camera.** A shape can be extruded by thickness. There are also spheres, tori, tubes, a ground, and shadows. three.js geometry can share depth with text and line art.
- **Masks, images, glyph outlines.** A mask clips a layer after it is composited. A photo, a real object, or a material comes from the asset service at https://nc.fangyitech.com/flex/v1/docs. Copy `items[0].snippet`. A single character's outline can be measured and placed back into the picture.
- **Layer effects and custom pixels.** Grade, glass, and noise apply to a whole subtree. Pixels can be handed to a canvas script.
- **Frames.** Each instant is still one Flex Layer tree. Randomness and the clock are fixed per frame. The same input produces the same picture.

## Docs

Find the files that match the version you are using. `main` in the repo may be newer than an installed package. When a package is installed, use the files inside it.

When the current workspace is the flexlayer repo (it has `src/cli.ts`), read these files and run commands with `npx tsx src/cli.ts`:

| File | Contents |
| --- | --- |
| `AGENTS.md` | Entry, deviations, hard rules, common issues |
| `SPEC.md` | Tags, attributes, issue codes |
| `docs/CHEATSHEET.md` | One page of syntax |
| `docs/RESOURCES.md` | Fonts, images, palettes |
| `docs/GALLERY.md` | Sample pictures |
| `docs/attrs.json` | Lookup by attribute name |

When it is installed in another project, read `SPEC.md`, `docs/CHEATSHEET.md`, `docs/RESOURCES.md`, `docs/GALLERY.md`, and `docs/attrs.json` under `node_modules/flexlayer/`, and run commands with `npx flexlayer`. `AGENTS.md` is not published in the package. The entry rules are in the repo's `AGENTS.md` and in SPEC.

The same docs on the web:

- https://github.com/ruochi/flexlayer/blob/main/AGENTS.md
- https://github.com/ruochi/flexlayer/blob/main/SPEC.md
- https://github.com/ruochi/flexlayer/blob/main/docs/CHEATSHEET.md
- https://github.com/ruochi/flexlayer/blob/main/docs/RESOURCES.md
- https://github.com/ruochi/flexlayer/blob/main/docs/GALLERY.md
- https://github.com/ruochi/flexlayer/blob/main/docs/attrs.json

## Start

Node.js 20 or newer.

```bash
npm install github:ruochi/flexlayer
npx flexlayer check scene.tsx
npx flexlayer render scene.tsx -o scene.png
```

`check` first. An error exits with code 1. Fix it from the report, then check again. `render` after it passes. The other flags are in SPEC and in the installed package's README.
