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
  extrudeDepth: 0.2,
  bevelThickness: 0,
  curveSegments: 12,
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

function createMeshFromSVG(svgData) {
  const paths = svgData.paths;
  const geometries = [];
  
  let shapeCount = 0;
  
  paths.forEach((path) => {
    const shapes = SVGLoader.createShapes(path);
    
    shapes.forEach((shape) => {
      shapeCount++;
      
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
  // Use very tight tolerance to avoid breaking thin walls
  mergedGeometry = mergedGeometry.toNonIndexed();
  mergedGeometry = BufferGeometryUtils.mergeVertices(mergedGeometry, 1e-6);
  
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
  
  // Scale to fit nicely in view (target ~3 units)
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? 3 / maxDim : 1;
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
  resetCamera();
}

function resetCamera() {
  camera.position.set(4, 3, 4); // Isometric-ish view
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
// Event Handlers
// ─────────────────────────────────────────────────────────────

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.svg')) {
    loadSVGFile(file);
  }
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadSVGFile(file);
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
