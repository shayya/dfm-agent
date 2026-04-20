import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadStep } from './stepLoader.js';
import { detectSharpCorners } from './detectSharpCorners.js';
import { detectDeepHoles } from './detectDeepHoles.js';
import { detectSmallFillets } from './detectSmallFillets.js';
import { tessellateShape } from './tessellate.js';

const fileInput = document.getElementById('file-input');
const statusEl  = document.getElementById('status');
const statsEl   = document.getElementById('stats');
const resultsEl = document.getElementById('results');

let viewer = null;

fileInput.addEventListener('change', async (evt) => {
  const file = evt.target.files[0];
  if (!file) return;

  statusEl.textContent = 'Loading WASM module and parsing STEP...';
  statsEl.innerHTML = '';
  resultsEl.innerHTML = '';

  try {
    const arrayBuffer = await file.arrayBuffer();
    const { oc, shape, stats } = await loadStep(arrayBuffer);

    statsEl.innerHTML = [
      `<strong>Topology summary for ${esc(file.name)}</strong>`,
      '<ul>',
      `<li>Faces: ${stats.faceTotal} \u2014 ${fmtCounts(stats.faceCounts)}</li>`,
      `<li>Edges: ${stats.edgeTotal} \u2014 ${fmtCounts(stats.edgeCounts)}</li>`,
      '</ul>',
    ].join('\n');

    statusEl.textContent = 'Running DFM detectors...';

    const corners = detectSharpCorners(oc, shape);
    const holes   = detectDeepHoles(oc, shape);
    const fillets = detectSmallFillets(oc, shape);

    statusEl.textContent = 'Building 3D viewer...';

    // Tessellate and render
    const mesh = tessellateShape(oc, shape);
    if (!viewer) {
      viewer = createViewer();
    }
    viewer.renderMesh(mesh, corners, holes, fillets);
    viewer.fitCamera();

    // Render issue list
    const items = [];

    for (const c of corners) {
      items.push({
        severity: c.severity,
        html:
          `<strong>[${c.severity.toUpperCase()}]</strong> Sharp internal corner \u2014 ` +
          `edge #${c.edgeIndex}, ` +
          `interior angle <strong>${c.interiorAngleDeg}\u00B0</strong>, ` +
          `faces ${c.faceA_index} &amp; ${c.faceB_index}, ` +
          `start (${f(c.startPoint.x)}, ${f(c.startPoint.y)}, ${f(c.startPoint.z)}), ` +
          `end (${f(c.endPoint.x)}, ${f(c.endPoint.y)}, ${f(c.endPoint.z)})`,
      });
    }

    for (const h of holes) {
      items.push({
        severity: h.severity,
        html:
          `<strong>[${h.severity.toUpperCase()}]</strong> Deep small hole \u2014 ` +
          `face #${h.faceIndex}, ` +
          `diameter <strong>${h.diameter} mm</strong>, ` +
          `depth <strong>${h.depth} mm</strong>, ` +
          `aspect ratio <strong>${h.aspectRatio}:1</strong>`,
      });
    }

    for (const fl of fillets) {
      items.push({
        severity: fl.severity,
        html:
          `<strong>[${fl.severity.toUpperCase()}]</strong> Small internal fillet \u2014 ` +
          `face #${fl.faceIndex}, ` +
          `radius <strong>${fl.radius} mm</strong>`,
      });
    }

    if (items.length === 0) {
      resultsEl.innerHTML = '<li class="ok">No DFM issues detected.</li>';
    } else {
      resultsEl.innerHTML = items
        .map(i => `<li class="${esc(i.severity)}">${i.html}</li>`)
        .join('\n');
    }

    statusEl.textContent =
      `Done. ${corners.length} sharp corner(s), ${holes.length} deep hole(s), ${fillets.length} small fillet(s) flagged.`;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    console.error(err);
  }
});

// ---------- Three.js viewer ----------

function createViewer() {
  const container = document.getElementById('viewer');
  const width = container.clientWidth;
  const height = container.clientHeight;

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  // Camera
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
  camera.position.set(100, 80, 120);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(50, 100, 80);
  scene.add(dirLight);
  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dirLight2.position.set(-50, -20, -60);
  scene.add(dirLight2);

  // Grid
  const grid = new THREE.GridHelper(200, 20, 0x444466, 0x333355);
  scene.add(grid);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // Resize handler
  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  return {
    scene,
    camera,
    controls,
    renderer,

    renderMesh(mesh, corners, holes, fillets) {
      // Remove previous mesh objects
      const toRemove = [];
      scene.traverse(child => {
        if (child.userData.dfmMesh) toRemove.push(child);
      });
      toRemove.forEach(o => { scene.remove(o); });

      // Build indexed buffer geometry
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

      // Compute normals if missing (all zeros)
      geometry.computeVertexNormals();

      // Build set of flagged hole face indices
      const holeFaces = new Set();
      for (const h of holes) {
        holeFaces.add(h.faceIndex);
      }

      // Build set of flagged fillet face indices
      const filletFaces = new Set();
      for (const fl of fillets) {
        filletFaces.add(fl.faceIndex);
      }

      // Assign per-face groups with material index
      // 0 = default, 1 = deep hole (orange), 2 = small fillet (yellow)
      for (const fg of mesh.faceGroups) {
        let matIdx = 0;
        if (holeFaces.has(fg.faceIndex)) matIdx = 1;
        if (filletFaces.has(fg.faceIndex)) matIdx = 2;
        geometry.addGroup(fg.start, fg.count, matIdx);
      }

      // Materials array (index must match addGroup materialIndex)
      const materials = [
        // 0: default steel blue
        new THREE.MeshPhongMaterial({
          color: 0x7a8fa6,
          shininess: 60,
          specular: 0x333333,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        }),
        // 1: deep hole — orange tint
        new THREE.MeshPhongMaterial({
          color: 0xff8800,
          shininess: 60,
          specular: 0x333333,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        }),
        // 2: small fillet — yellow
        new THREE.MeshPhongMaterial({
          color: 0xffcc33,
          shininess: 60,
          specular: 0x333333,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        }),
      ];

      const solidMesh = new THREE.Mesh(geometry, materials);
      solidMesh.userData.dfmMesh = true;
      scene.add(solidMesh);

      // Wireframe overlay
      const wireMat = new THREE.MeshBasicMaterial({
        color: 0x3a4a5a,
        wireframe: true,
        transparent: true,
        opacity: 0.15,
      });
      const wireMesh = new THREE.Mesh(geometry, wireMat);
      wireMesh.userData.dfmMesh = true;
      scene.add(wireMesh);

      // Sharp-corner edge overlays: bright red LineSegments on top of mesh
      if (corners.length > 0) {
        const linePositions = new Float32Array(corners.length * 6);
        for (let i = 0; i < corners.length; i++) {
          const c = corners[i];
          const off = i * 6;
          linePositions[off]     = c.startPoint.x;
          linePositions[off + 1] = c.startPoint.y;
          linePositions[off + 2] = c.startPoint.z;
          linePositions[off + 3] = c.endPoint.x;
          linePositions[off + 4] = c.endPoint.y;
          linePositions[off + 5] = c.endPoint.z;
        }
        const lineGeom = new THREE.BufferGeometry();
        lineGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
        const lineMat = new THREE.LineBasicMaterial({
          color: 0xff3333,
          depthTest: false,
        });
        const lineSegments = new THREE.LineSegments(lineGeom, lineMat);
        lineSegments.userData.dfmMesh = true;
        lineSegments.renderOrder = 1;
        scene.add(lineSegments);
      }
    },

    fitCamera() {
      const box = new THREE.Box3();
      scene.traverse(child => {
        if (child.isMesh && child.userData.dfmMesh) {
          child.geometry.computeBoundingBox();
          box.expandByObject(child);
        }
      });
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const dist = maxDim * 1.8;
        camera.position.set(center.x + dist * 0.5, center.y + dist * 0.4, center.z + dist * 0.7);
        controls.target.copy(center);
        controls.update();
      }
    },
  };
}

// ---------- helpers ----------

function f(n) { return (Math.round(n * 100) / 100).toFixed(2); }
function fmtCounts(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ');
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
