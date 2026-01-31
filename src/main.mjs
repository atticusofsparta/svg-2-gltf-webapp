import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// ─────────────────────────────────────────────────────────────
// Scene Setup
// ─────────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const viewport = document.getElementById('viewport');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0f);

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
camera.position.set(4, 3, 4); // Isometric-ish view

const renderer = new THREE.WebGLRenderer({ 
  canvas, 
  antialias: true,
  alpha: true 
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.5;
controls.maxDistance = 50;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(5, 10, 7);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x4488ff, 0.4);
fillLight.position.set(-5, 0, -5);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xff6b35, 0.3);
rimLight.position.set(0, -5, -3);
scene.add(rimLight);

// Grid helper (subtle) - horizontal on XZ plane
const gridHelper = new THREE.GridHelper(10, 20, 0x222233, 0x151520);
gridHelper.position.y = -0.01;
scene.add(gridHelper);

// XYZ Axes helper
const axesHelper = new THREE.AxesHelper(2);
axesHelper.setColors(
  new THREE.Color(0xff4444), // X - red
  new THREE.Color(0x44ff44), // Y - green  
  new THREE.Color(0x4488ff)  // Z - blue
);
scene.add(axesHelper);

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

let currentMesh = null;
let currentSvgData = null;
let currentFileName = '';

const settings = {
  scaleMeters: 1,        // Target size in meters (longest dimension)
  extrudeDepth: 0.2,
  bevelThickness: 0,
  curveSegments: 4,
  simplifyTolerance: 0,
  mergeDistance: 0.001,
  meshColor: '#ff6b35',
  wireframe: false
};

// ─────────────────────────────────────────────────────────────
// SVG Processing
// ─────────────────────────────────────────────────────────────

function parseSVG(svgText) {
  const loader = new SVGLoader();
  return loader.parse(svgText);
}

// Ramer-Douglas-Peucker algorithm to simplify a path
function simplifyPath(points, tolerance) {
  if (points.length <= 2 || tolerance <= 0) return points;
  
  // Find the point with the maximum distance from the line between first and last
  let maxDist = 0;
  let maxIndex = 0;
  
  const start = points[0];
  const end = points[points.length - 1];
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  
  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = simplifyPath(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyPath(points.slice(maxIndex), tolerance);
    return left.slice(0, -1).concat(right);
  } else {
    return [start, end];
  }
}

function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }
  
  const t = Math.max(0, Math.min(1, ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq));
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  
  return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
}

// Simplify a THREE.Shape by reducing points in its curves
function simplifyShape(shape, tolerance) {
  if (tolerance <= 0) return shape;
  
  // Get points from the shape's path
  const points = shape.getPoints(settings.curveSegments);
  const simplified = simplifyPath(points, tolerance);
  
  // Create a new shape from simplified points
  const newShape = new THREE.Shape(simplified);
  
  // Also simplify holes
  if (shape.holes && shape.holes.length > 0) {
    newShape.holes = shape.holes.map(hole => {
      const holePoints = hole.getPoints(settings.curveSegments);
      const simplifiedHole = simplifyPath(holePoints, tolerance);
      return new THREE.Path(simplifiedHole);
    });
  }
  
  return newShape;
}

// Remove degenerate (zero-area) triangles
function removeDegenerateTriangles(geometry, minArea = 1e-10) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  
  if (!index) {
    // Non-indexed geometry - filter triangles directly
    const newPositions = [];
    const oldPositions = position.array;
    
    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const cross = new THREE.Vector3();
    
    for (let i = 0; i < position.count; i += 3) {
      v0.fromBufferAttribute(position, i);
      v1.fromBufferAttribute(position, i + 1);
      v2.fromBufferAttribute(position, i + 2);
      
      edge1.subVectors(v1, v0);
      edge2.subVectors(v2, v0);
      cross.crossVectors(edge1, edge2);
      
      const area = cross.length() * 0.5;
      
      if (area > minArea) {
        newPositions.push(
          oldPositions[i * 3], oldPositions[i * 3 + 1], oldPositions[i * 3 + 2],
          oldPositions[(i + 1) * 3], oldPositions[(i + 1) * 3 + 1], oldPositions[(i + 1) * 3 + 2],
          oldPositions[(i + 2) * 3], oldPositions[(i + 2) * 3 + 1], oldPositions[(i + 2) * 3 + 2]
        );
      }
    }
    
    const newGeometry = new THREE.BufferGeometry();
    newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    return newGeometry;
  }
  
  // Indexed geometry - filter indices
  const indices = index.array;
  const newIndices = [];
  
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const cross = new THREE.Vector3();
  
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    
    // Skip if any indices are the same (degenerate)
    if (a === b || b === c || a === c) continue;
    
    v0.fromBufferAttribute(position, a);
    v1.fromBufferAttribute(position, b);
    v2.fromBufferAttribute(position, c);
    
    edge1.subVectors(v1, v0);
    edge2.subVectors(v2, v0);
    cross.crossVectors(edge1, edge2);
    
    const area = cross.length() * 0.5;
    
    if (area > minArea) {
      newIndices.push(a, b, c);
    }
  }
  
  const newGeometry = geometry.clone();
  newGeometry.setIndex(newIndices);
  return newGeometry;
}

function createMeshFromSVG(svgData) {
  const paths = svgData.paths;
  const geometries = [];
  
  let shapeCount = 0;
  
  paths.forEach((path) => {
    const shapes = SVGLoader.createShapes(path);
    
    shapes.forEach((rawShape) => {
      shapeCount++;
      
      // Simplify the shape if tolerance is set
      const shape = settings.simplifyTolerance > 0 
        ? simplifyShape(rawShape, settings.simplifyTolerance) 
        : rawShape;
      
      const extrudeSettings = {
        depth: settings.extrudeDepth,
        bevelEnabled: settings.bevelThickness > 0,
        bevelThickness: settings.bevelThickness,
        bevelSize: settings.bevelThickness,
        bevelOffset: 0,
        bevelSegments: 2,
        curveSegments: settings.curveSegments,
        steps: 1
      };
      
      const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      geometries.push(geometry);
    });
  });
  
  if (geometries.length === 0) {
    return { group: new THREE.Group(), shapeCount: 0, totalVertices: 0 };
  }
  
  // Merge all shape geometries together
  let mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, false);
  
  // Convert to non-indexed, then re-index with vertex merging
  // This ensures cap vertices connect properly to side walls
  mergedGeometry = mergedGeometry.toNonIndexed();
  mergedGeometry = BufferGeometryUtils.mergeVertices(mergedGeometry, settings.mergeDistance);
  
  // Remove degenerate triangles (zero area)
  mergedGeometry = removeDegenerateTriangles(mergedGeometry);
  
  // Compute proper normals after topology is fixed
  mergedGeometry.computeVertexNormals();
  
  // Center the geometry
  mergedGeometry.computeBoundingBox();
  const box = mergedGeometry.boundingBox;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  mergedGeometry.translate(-center.x, -center.y, -center.z);
  
  // Dispose individual geometries
  geometries.forEach(g => g.dispose());
  
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(settings.meshColor),
    metalness: 0.1,
    roughness: 0.6,
    side: THREE.FrontSide, // Use FrontSide for proper manifold mesh
    wireframe: settings.wireframe
  });
  
  const mesh = new THREE.Mesh(mergedGeometry, material);
  const totalVertices = mergedGeometry.attributes.position.count;
  
  const group = new THREE.Group();
  group.add(mesh);
  
  // Scale to target size in meters (based on longest dimension)
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? settings.scaleMeters / maxDim : 1;
  group.scale.setScalar(scale);
  
  // Flip Y axis (SVG coordinate system is inverted)
  group.scale.y *= -1;
  
  // Rotate to lay flat on XZ plane (SVG extrudes along Z, we want it along Y)
  group.rotation.x = -Math.PI / 2;
  
  // Center extrusion on Y axis
  group.position.y = (settings.extrudeDepth * scale) / 2;
  
  return { group, shapeCount, totalVertices };
}

function updateMesh() {
  if (!currentSvgData) return;
  
  if (currentMesh) {
    scene.remove(currentMesh);
    disposeMesh(currentMesh);
  }
  
  const { group, shapeCount, totalVertices } = createMeshFromSVG(currentSvgData);
  currentMesh = group;
  scene.add(currentMesh);
  
  // Debug: log mesh bounds
  const box = new THREE.Box3().setFromObject(currentMesh);
  const size = box.getSize(new THREE.Vector3());
  console.log('📦 Mesh created:', { shapeCount, totalVertices, size: size.toArray().map(n => n.toFixed(2)) });
  
  // Update info display
  document.getElementById('shapeCount').textContent = shapeCount;
  document.getElementById('vertexCount').textContent = totalVertices.toLocaleString();
  
  // Enable export buttons
  document.getElementById('exportGlb').disabled = false;
  document.getElementById('exportGltf').disabled = false;
}

function disposeMesh(mesh) {
  mesh.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────
// File Handling
// ─────────────────────────────────────────────────────────────

async function loadSVGFile(file) {
  const text = await file.text();
  currentSvgData = parseSVG(text);
  currentFileName = file.name.replace('.svg', '');
  
  updateMesh();
  
  // Update UI - hide empty state
  document.getElementById('viewportEmpty').style.display = 'none';
  document.getElementById('fileInfo').hidden = false;
  document.getElementById('fileName').textContent = file.name;
  
  // Fit camera to object
  fitCameraToMesh();
}

function resetCamera() {
  camera.position.set(4, 3, 4); // Isometric-ish view
  controls.target.set(0, 0, 0);
  controls.update();
}

function fitCameraToMesh() {
  if (!currentMesh) return;
  
  const box = new THREE.Box3().setFromObject(currentMesh);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  
  // Position camera at a distance based on mesh size
  const distance = maxDim * 2;
  camera.position.set(distance, distance * 0.75, distance);
  controls.target.set(0, 0, 0);
  controls.update();
}

// ─────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────

function exportGLTF(binary = true) {
  if (!currentMesh) return;
  
  const exporter = new GLTFExporter();
  const options = {
    binary,
    trs: false,
    onlyVisible: true,
    includeCustomExtensions: false
  };
  
  exporter.parse(
    currentMesh,
    (result) => {
      if (binary) {
        saveArrayBuffer(result, `${currentFileName}.glb`);
      } else {
        const output = JSON.stringify(result, null, 2);
        saveString(output, `${currentFileName}.gltf`);
      }
    },
    (error) => {
      console.error('Export error:', error);
    },
    options
  );
}

function saveArrayBuffer(buffer, filename) {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  downloadBlob(blob, filename);
}

function saveString(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ─────────────────────────────────────────────────────────────
// Batch Processing
// ─────────────────────────────────────────────────────────────

let batchFiles = [];

function addToBatch(files) {
  const svgFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.svg'));
  if (svgFiles.length === 0) return;
  
  batchFiles = svgFiles;
  updateBatchUI();
  
  // Load first file for preview
  if (svgFiles.length > 0) {
    loadSVGFile(svgFiles[0]);
  }
}

function updateBatchUI() {
  const panel = document.getElementById('batchPanel');
  const list = document.getElementById('batchList');
  const count = document.getElementById('batchCount');
  
  if (batchFiles.length <= 1) {
    panel.hidden = true;
    return;
  }
  
  panel.hidden = false;
  count.textContent = `${batchFiles.length} files`;
  
  list.innerHTML = batchFiles.map((file, i) => `
    <div class="batch-item" data-index="${i}">
      <span class="batch-item-name">${file.name}</span>
      <span class="batch-item-status pending" id="status-${i}">pending</span>
    </div>
  `).join('');
  
  // Click to preview
  list.querySelectorAll('.batch-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.index);
      loadSVGFile(batchFiles[idx]);
    });
  });
}

async function processSVGToGLB(file) {
  const text = await file.text();
  const svgData = parseSVG(text);
  
  // Temporarily set the data and create mesh
  const prevData = currentSvgData;
  currentSvgData = svgData;
  
  const { group } = createMeshFromSVG(svgData);
  
  // Restore
  currentSvgData = prevData;
  
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      group,
      (result) => {
        // Dispose the temporary mesh
        disposeMesh(group);
        resolve(result);
      },
      (error) => {
        disposeMesh(group);
        reject(error);
      },
      { binary: true }
    );
  });
}

async function batchExport() {
  if (batchFiles.length === 0) return;
  
  const progressEl = document.getElementById('batchProgress');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  
  progressEl.hidden = false;
  
  const results = [];
  
  for (let i = 0; i < batchFiles.length; i++) {
    const file = batchFiles[i];
    const statusEl = document.getElementById(`status-${i}`);
    
    statusEl.className = 'batch-item-status active';
    statusEl.textContent = 'processing';
    
    progressFill.style.width = `${(i / batchFiles.length) * 100}%`;
    progressText.textContent = `${i} / ${batchFiles.length}`;
    
    try {
      const glb = await processSVGToGLB(file);
      const filename = file.name.replace(/\.svg$/i, '.glb');
      results.push({ filename, data: glb });
      
      statusEl.className = 'batch-item-status done';
      statusEl.textContent = 'done';
    } catch (err) {
      console.error(`Error processing ${file.name}:`, err);
      statusEl.className = 'batch-item-status pending';
      statusEl.textContent = 'error';
    }
  }
  
  progressFill.style.width = '100%';
  progressText.textContent = `${batchFiles.length} / ${batchFiles.length}`;
  
  // Download as zip if multiple, or single file
  if (results.length === 1) {
    saveArrayBuffer(results[0].data, results[0].filename);
  } else if (results.length > 1) {
    await downloadAsZip(results);
  }
  
  setTimeout(() => {
    progressEl.hidden = true;
  }, 2000);
}

async function downloadAsZip(files) {
  // Dynamic import of JSZip from CDN
  if (!window.JSZip) {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    document.head.appendChild(script);
    await new Promise(resolve => script.onload = resolve);
  }
  
  const zip = new JSZip();
  
  files.forEach(({ filename, data }) => {
    zip.file(filename, data);
  });
  
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, 'svg-to-gltf-export.zip');
}

function clearBatch() {
  batchFiles = [];
  document.getElementById('batchPanel').hidden = true;
}

// ─────────────────────────────────────────────────────────────
// Event Handlers
// ─────────────────────────────────────────────────────────────

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const folderInput = document.getElementById('folderInput');

dropZone.addEventListener('click', (e) => {
  // Shift+click for folder
  if (e.shiftKey) {
    folderInput.click();
  } else {
    fileInput.click();
  }
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  
  const items = e.dataTransfer.items;
  const files = [];
  
  // Handle folder drops
  if (items) {
    const entries = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    
    for (const entry of entries) {
      if (entry.isDirectory) {
        const dirFiles = await readDirectory(entry);
        files.push(...dirFiles);
      } else if (entry.isFile) {
        const file = await getFileFromEntry(entry);
        files.push(file);
      }
    }
  } else {
    files.push(...e.dataTransfer.files);
  }
  
  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.svg')) {
    loadSVGFile(files[0]);
  } else if (files.length > 0) {
    addToBatch(files);
  }
});

async function readDirectory(dirEntry) {
  const reader = dirEntry.createReader();
  const files = [];
  
  const readEntries = () => new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
  
  let entries;
  do {
    entries = await readEntries();
    for (const entry of entries) {
      if (entry.isFile && entry.name.toLowerCase().endsWith('.svg')) {
        const file = await getFileFromEntry(entry);
        files.push(file);
      }
    }
  } while (entries.length > 0);
  
  return files;
}

function getFileFromEntry(entry) {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

fileInput.addEventListener('change', (e) => {
  const files = e.target.files;
  if (files.length === 1) {
    loadSVGFile(files[0]);
  } else if (files.length > 1) {
    addToBatch(files);
  }
});

folderInput.addEventListener('change', (e) => {
  addToBatch(e.target.files);
});

// Batch buttons
document.getElementById('batchExportGlb').addEventListener('click', batchExport);
document.getElementById('batchClear').addEventListener('click', clearBatch);

// Scale input
const scaleInput = document.getElementById('scaleInput');
scaleInput.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  if (val > 0) {
    settings.scaleMeters = val;
    updateMesh();
    fitCameraToMesh();
  }
});

// Sliders
const extrudeSlider = document.getElementById('extrudeSlider');
const bevelSlider = document.getElementById('bevelSlider');
const segmentsSlider = document.getElementById('segmentsSlider');
const colorPicker = document.getElementById('colorPicker');
const wireframeToggle = document.getElementById('wireframeToggle');

extrudeSlider.addEventListener('input', (e) => {
  settings.extrudeDepth = parseFloat(e.target.value);
  document.getElementById('extrudeValue').textContent = settings.extrudeDepth.toFixed(2);
  updateMesh();
});

bevelSlider.addEventListener('input', (e) => {
  settings.bevelThickness = parseFloat(e.target.value);
  document.getElementById('bevelValue').textContent = settings.bevelThickness.toFixed(3);
  updateMesh();
});

segmentsSlider.addEventListener('input', (e) => {
  settings.curveSegments = parseInt(e.target.value);
  document.getElementById('segmentsValue').textContent = settings.curveSegments;
  updateMesh();
});

const simplifySlider = document.getElementById('simplifySlider');
simplifySlider.addEventListener('input', (e) => {
  settings.simplifyTolerance = parseFloat(e.target.value);
  document.getElementById('simplifyValue').textContent = settings.simplifyTolerance.toFixed(1);
  updateMesh();
});

const mergeDistSlider = document.getElementById('mergeDistSlider');
mergeDistSlider.addEventListener('input', (e) => {
  // Slider is log scale: -7 to -1 maps to 10^-7 to 10^-1
  const exponent = parseFloat(e.target.value);
  settings.mergeDistance = Math.pow(10, exponent);
  document.getElementById('mergeDistValue').textContent = settings.mergeDistance.toExponential(0);
  updateMesh();
});

colorPicker.addEventListener('input', (e) => {
  settings.meshColor = e.target.value;
  updateMesh();
});

wireframeToggle.addEventListener('change', (e) => {
  settings.wireframe = e.target.checked;
  updateMesh();
});

// Export buttons
document.getElementById('exportGlb').addEventListener('click', () => exportGLTF(true));
document.getElementById('exportGltf').addEventListener('click', () => exportGLTF(false));

// View buttons
document.getElementById('viewIso').addEventListener('click', () => {
  camera.position.set(4, 3, 4);
  controls.target.set(0, 0, 0);
  controls.update();
});

document.getElementById('viewTop').addEventListener('click', () => {
  camera.position.set(0, 5, 0.01);
  controls.target.set(0, 0, 0);
  controls.update();
});

document.getElementById('viewFront').addEventListener('click', () => {
  camera.position.set(0, 0, 5);
  controls.target.set(0, 0, 0);
  controls.update();
});

document.getElementById('viewReset').addEventListener('click', resetCamera);

// ─────────────────────────────────────────────────────────────
// Render Loop
// ─────────────────────────────────────────────────────────────

function resize() {
  const rect = viewport.getBoundingClientRect();
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height);
}

window.addEventListener('resize', resize);
resize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();

console.log('🎨 SVG → GLTF Converter loaded');
