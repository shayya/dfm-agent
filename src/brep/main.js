import { loadStep } from './stepLoader.js';
import { detectSharpCorners } from './detectSharpCorners.js';
import { detectDeepHoles } from './detectDeepHoles.js';
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

    statusEl.textContent = 'Building 3D viewer...';

    // Tessellate and render
    const mesh = tessellateShape(oc, shape);
    if (!viewer) {
      viewer = createViewer();
    }
    viewer.renderMesh(mesh, corners, holes);
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

    if (items.length === 0) {
      resultsEl.innerHTML = '<li class="ok">No DFM issues detected.</li>';
    } else {
      resultsEl.innerHTML = items
        .map(i => `<li class="${esc(i.severity)}">${i.html}</li>`)
        .join('\n');
    }

    statusEl.textContent =
      `Done. ${corners.length} sharp corner(s), ${holes.length} deep hole(s) flagged.`;
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
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
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

    renderMesh(mesh, corners, holes) {
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

      // Solid mesh — semi-transparent steel blue
      const material = new THREE.MeshPhongMaterial({
        color: 0x7a8fa6,
        shininess: 60,
        specular: 0x333333,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      });
      const solidMesh = new THREE.Mesh(geometry, material);
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

      // Highlight sharp corner edges as red lines
      if (corners.length > 0) {
        const cornerPositions = [];
        for (const c of corners) {
          cornerPositions.push(
            c.startPoint.x, c.startPoint.y, c.startPoint.z,
            c.endPoint.x, c.endPoint.y, c.endPoint.z,
          );
        }
        const cornerGeom = new THREE.BufferGeometry();
        cornerGeom.setAttribute('position',
          new THREE.Float32BufferAttribute(cornerPositions, 3));
        const cornerMat = new THREE.LineBasicMaterial({
          color: 0xff3333,
          linewidth: 2,
        });
        const cornerLines = new THREE.LineSegments(cornerGeom, cornerMat);
        cornerLines.userData.dfmMesh = true;
        scene.add(cornerLines);
      }

      // Highlight hole axis lines as orange
      // (We'd need axis info from the hole detector — for now skip, or add later)
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
