# SVG → GLTF Web Converter

A browser-based tool to convert SVG paths into extruded 3D meshes and export them to GLTF/GLB format.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

## Features

- **Drag & drop SVG upload** - Load any SVG file
- **Real-time 3D preview** - See your mesh with orbit controls
- **Extrusion depth** - Control how thick your 3D mesh is
- **Bevel thickness** - Add beveled edges
- **Curve segments** - Control mesh smoothness
- **Custom color** - Override SVG colors
- **Wireframe mode** - Debug mesh topology
- **GLB/GLTF export** - Download your 3D model

## How it Works

1. Uses Three.js `SVGLoader` to parse SVG path data
2. Converts paths to shapes using `SVGLoader.createShapes()`
3. Creates 3D geometry with `ExtrudeGeometry`
4. Exports using `GLTFExporter`

## Sample Files

A `sample.svg` is included for testing.

## Build for Production

```bash
npm run build
```

Output will be in the `dist/` folder.
