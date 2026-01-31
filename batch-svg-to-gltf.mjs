#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const blenderBin = arg("--blender", "blender");
const inputDir = arg("--in");
const outputDir = arg("--out");

const format = arg("--format", "glb");      // glb | gltf
const extrude = Number(arg("--extrude", "0.01"));
const mode = arg("--mode", "curve");        // curve | gp | auto

if (!inputDir || !outputDir) {
  console.error(
    "Usage: node batch-svg-to-gltf.mjs --in /path/to/svgs --out /path/to/out " +
    "[--blender blender] [--format glb|gltf] [--extrude 0.01] [--mode curve|gp|auto]"
  );
  process.exit(1);
}

const inDir = resolve(inputDir);
const outDir = resolve(outputDir);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const scriptPath = resolve(new URL("./blender_svg_glyphs_to_gltf.py", import.meta.url).pathname);

const args = [
  "-b",
  "--factory-startup",
  "--python",
  scriptPath,
  "--",
  "--in", inDir,
  "--out", outDir,
  "--format", format,
  "--extrude", String(extrude),
  "--mode", mode,
];

console.log(`Running: ${blenderBin} ${args.join(" ")}`);

const p = spawn(blenderBin, args, { stdio: "inherit" });
p.on("exit", (code) => process.exit(code ?? 1));
