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

const MIN_TOOL_RADIUS_MM = 0.794; // 1/32" end mill

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

    const mesh = tessellateShape(oc, shape);
    if (!viewer) {
      viewer = createViewer();
    }
    viewer.renderMesh(mesh, corners, holes, fillets);
    viewer.fitCamera();

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
  const width  = container.clientWidth;
  const height = container.clientHeight;

  // Scene — near-white background
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f7);

  // Camera
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
  camera.position.set(100, 80, 120);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0xf5f5f7);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // Soft neutral lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dir1 = new THREE.DirectionalLight(0xffffff, 0.6);
  dir1.position.set(50, 100, 80);
  scene.add(dir1);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.35);
  dir2.position.set(-50, -20, -60);
  scene.add(dir2);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  // Viewer state
  let highlightEnabled = true;
  let issueOverlays    = null;
  let defaultMaterial  = null;
  let wedgeMaterial    = null;
  let solidMesh        = null;

  // ---- Axis gizmo (lower-left) ----
  let gizmoRenderer, gizmoScene, gizmoCamera;
  const gizmoEl = document.getElementById('axis-gizmo');
  if (gizmoEl) {
    gizmoRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    gizmoRenderer.setSize(90, 90);
    gizmoRenderer.setPixelRatio(window.devicePixelRatio);
    gizmoEl.appendChild(gizmoRenderer.domElement);

    gizmoScene  = new THREE.Scene();
    gizmoCamera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10);
    gizmoCamera.position.set(0, 0, 5);

    gizmoScene.add(new THREE.AxesHelper(1));

    const labels = [
      { text: 'X', color: '#ee3333', pos: [1.3, 0, 0] },
      { text: 'Y', color: '#33bb33', pos: [0, 1.3, 0] },
      { text: 'Z', color: '#3366ee', pos: [0, 0, 1.3] },
    ];
    for (const { text, color, pos } of labels) {
      const sprite = makeTextSprite(text, color);
      sprite.position.set(...pos);
      gizmoScene.add(sprite);
    }
  }

  // ---- Scale bar ----
  function updateScaleBar() {
    const bar = document.getElementById('scale-bar');
    if (!bar || !solidMesh) return;

    const box = new THREE.Box3();
    scene.traverse(child => {
      if (child.isMesh && child.userData.dfmMesh) box.expandByObject(child);
    });
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const p1 = center.clone().project(camera);
    const p2 = center.clone().add(new THREE.Vector3(25.4, 0, 0)).project(camera);
    const px = Math.abs(p2.x - p1.x) * container.clientWidth / 2;

    const inner = bar.querySelector('.scale-inner');
    if (inner) inner.style.width = Math.max(10, px) + 'px';
  }

  // ---- Animation loop ----
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);

    // Sync axis gizmo with main camera
    if (gizmoRenderer && gizmoCamera) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      gizmoCamera.position.copy(dir.negate().multiplyScalar(5));
      gizmoCamera.lookAt(0, 0, 0);
      gizmoCamera.up.copy(camera.up);
      gizmoRenderer.render(gizmoScene, gizmoCamera);
    }

    updateScaleBar();
  }
  animate();

  // ---- Resize ----
  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  // ---- Viewer API ----
  const viewer = {
    scene, camera, controls, renderer,

    renderMesh(mesh, corners, holes, fillets) {
      // Remove previous objects
      const toRemove = [];
      scene.traverse(child => {
        if (child.userData.dfmMesh) toRemove.push(child);
      });
      toRemove.forEach(o => scene.remove(o));

      // Build indexed buffer geometry
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      geometry.setAttribute('normal',   new THREE.BufferAttribute(mesh.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      geometry.computeVertexNormals();

      // Single default material — light gray matte, polygonOffset for clean edge lines
      defaultMaterial = new THREE.MeshPhongMaterial({
        color: 0xd8d8dc,
        specular: 0x222222,
        shininess: 20,
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });

      solidMesh = new THREE.Mesh(geometry, defaultMaterial);
      solidMesh.userData.dfmMesh = true;
      scene.add(solidMesh);

      // Black B-Rep edge lines via EdgesGeometry (20° feature angle)
      const edgesGeo = new THREE.EdgesGeometry(geometry, 20);
      const edgeMat  = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
      const edgeLines = new THREE.LineSegments(edgesGeo, edgeMat);
      edgeLines.userData.dfmMesh = true;
      edgeLines.renderOrder = 1;
      scene.add(edgeLines);

      // ---- Blue issue overlays ----
      issueOverlays = new THREE.Group();
      issueOverlays.userData.dfmMesh = true;
      issueOverlays.visible = highlightEnabled;

      // Sharp corners — cusp geometry (tool-radius leftover material)
      if (corners.length > 0) {
        const R = MIN_TOOL_RADIUS_MM;
        const N_ARC = 8;
        const positions = [];
        const indices = [];

        for (let ci = 0; ci < corners.length; ci++) {
          const c = corners[ci];
          const sp = new THREE.Vector3(c.startPoint.x, c.startPoint.y, c.startPoint.z);
          const ep = new THREE.Vector3(c.endPoint.x, c.endPoint.y, c.endPoint.z);
          const edgeDir = new THREE.Vector3().subVectors(ep, sp).normalize();

          const nA = new THREE.Vector3(c.faceA_normal.x, c.faceA_normal.y, c.faceA_normal.z).normalize();
          const nB = new THREE.Vector3(c.faceB_normal.x, c.faceB_normal.y, c.faceB_normal.z).normalize();
          const intA = new THREE.Vector3(c.faceA_interiorDir.x, c.faceA_interiorDir.y, c.faceA_interiorDir.z).normalize();
          const intB = new THREE.Vector3(c.faceB_interiorDir.x, c.faceB_interiorDir.y, c.faceB_interiorDir.z).normalize();

          // Project interior dirs onto face planes → tangent on face
          function tangentOnFace(intDir, normal) {
            const dot = intDir.dot(normal);
            const t = intDir.clone().addScaledVector(normal, -dot);
            const len = t.length();
            return len > 1e-12 ? t.divideScalar(len) : intDir.clone();
          }

          const tanA = tangentOnFace(intA, nA);
          const tanB = tangentOnFace(intB, nB);

          // Bisector (into the void, away from material)
          const bisector = new THREE.Vector3().addVectors(tanA, tanB).normalize();

          const thetaRad = c.interiorAngleDeg * Math.PI / 180;
          const thetaHalf = thetaRad / 2;

          // Physical leg length and clamped legs
          const aPhysical = R / Math.tan(thetaHalf);
          const aA = Math.min(aPhysical, c.maxLegA_mm);
          const aB = Math.min(aPhysical, c.maxLegB_mm);

          // Tool center distance from edge along bisector
          const d = R / Math.sin(thetaHalf);

          // Arc center
          const midPt = new THREE.Vector3().addVectors(sp, ep).multiplyScalar(0.5);
          const arcCenter = midPt.clone().addScaledVector(bisector, d);

          // Local 2D frame in cross-section plane (perp to edgeDir)
          const u = tanA.clone();
          let w = new THREE.Vector3().crossVectors(edgeDir, tanA).normalize();
          if (tanB.dot(w) < 0) w.negate();

          // Arc angles: legA tip at -π/2, legB tip at θ+π/2, concave sweep = -(π-θ)
          const startAngle = -Math.PI / 2;
          const sweepAngle = -(Math.PI - thetaRad);

          // Build boundary offsets relative to edge point:
          // [0] = edge point (zero), [1] = legA tip, [2..2+N_ARC] = arc, [3+N_ARC] = legB tip
          const offsets = [new THREE.Vector3(0, 0, 0)];
          offsets.push(tanA.clone().multiplyScalar(aA));
          for (let j = 0; j <= N_ARC; j++) {
            const angle = startAngle + sweepAngle * j / N_ARC;
            offsets.push(
              arcCenter.clone()
                .addScaledVector(u, R * Math.cos(angle))
                .addScaledVector(w, R * Math.sin(angle))
                .sub(midPt)
            );
          }
          offsets.push(tanB.clone().multiplyScalar(aB));

          const nPts = offsets.length;

          // Vertices at start and end of edge
          const baseIdx = positions.length / 3;
          for (const o of offsets) {
            const v = sp.clone().add(o);
            positions.push(v.x, v.y, v.z);
          }
          for (const o of offsets) {
            const v = ep.clone().add(o);
            positions.push(v.x, v.y, v.z);
          }

          const endBase = baseIdx + nPts;

          // Start cap (fan from edge point = index 0 in this corner's block)
          for (let j = 1; j < nPts - 1; j++) {
            indices.push(baseIdx, baseIdx + j, baseIdx + j + 1);
          }

          // End cap (reversed winding)
          for (let j = 1; j < nPts - 1; j++) {
            indices.push(endBase, endBase + j + 1, endBase + j);
          }

          // Side quads
          for (let j = 1; j < nPts - 1; j++) {
            const s0 = baseIdx + j, s1 = baseIdx + j + 1;
            const e0 = endBase + j, e1 = endBase + j + 1;
            indices.push(s0, s1, e1,  s0, e1, e0);
          }
        }

        const cuspGeom = new THREE.BufferGeometry();
        cuspGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        cuspGeom.setIndex(indices);
        cuspGeom.computeVertexNormals();

        const cuspMat = new THREE.MeshBasicMaterial({
          color: 0x1a3dd6,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        const cuspMesh = new THREE.Mesh(cuspGeom, cuspMat);
        cuspMesh.renderOrder = 2;
        cuspMesh.userData.dfmMesh = true;
        issueOverlays.add(cuspMesh);

        wedgeMaterial = cuspMat;
      }

      // Deep hole axis lines — bright blue
      for (const h of holes) {
        const top = {
          x: h.location.x + h.axis.x * h.depth / 2,
          y: h.location.y + h.axis.y * h.depth / 2,
          z: h.location.z + h.axis.z * h.depth / 2,
        };
        const bot = {
          x: h.location.x - h.axis.x * h.depth / 2,
          y: h.location.y - h.axis.y * h.depth / 2,
          z: h.location.z - h.axis.z * h.depth / 2,
        };
        const pts = new Float32Array([top.x, top.y, top.z, bot.x, bot.y, bot.z]);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const m = new THREE.LineBasicMaterial({ color: 0x0033ff, depthTest: false });
        const l = new THREE.LineSegments(g, m);
        l.renderOrder = 2;
        issueOverlays.add(l);
      }

      scene.add(issueOverlays);
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
        const center  = box.getCenter(new THREE.Vector3());
        const size    = box.getSize(new THREE.Vector3());
        const maxDim  = Math.max(size.x, size.y, size.z);
        const dist    = maxDim * 1.8;
        camera.position.set(
          center.x + dist * 0.5,
          center.y + dist * 0.4,
          center.z + dist * 0.7,
        );
        controls.target.copy(center);
        controls.update();
      }
    },

    setHighlightIssues(v) {
      highlightEnabled = v;
      if (issueOverlays) issueOverlays.visible = v;
    },

    setTransparency(v) {
      if (defaultMaterial) {
        defaultMaterial.opacity = v;
        defaultMaterial.transparent = v < 1;
      }
      if (wedgeMaterial) {
        wedgeMaterial.depthTest = v >= 1;
        wedgeMaterial.needsUpdate = true;
      }
    },

    viewFace(name) {
      const box = new THREE.Box3();
      scene.traverse(child => {
        if (child.isMesh && child.userData.dfmMesh) {
          child.geometry.computeBoundingBox();
          box.expandByObject(child);
        }
      });
      if (box.isEmpty()) return;

      const center = box.getCenter(new THREE.Vector3());
      const size   = box.getSize(new THREE.Vector3());
      const dist   = Math.max(size.x, size.y, size.z) * 1.5;

      const map = {
        front:  [center.x, center.y, center.z + dist],
        back:   [center.x, center.y, center.z - dist],
        top:    [center.x, center.y + dist, center.z],
        bottom: [center.x, center.y - dist, center.z],
        left:   [center.x - dist, center.y, center.z],
        right:  [center.x + dist, center.y, center.z],
      };
      if (map[name]) {
        camera.position.set(...map[name]);
        controls.target.copy(center);
        controls.update();
      }
    },
  };

  // Wire toolbar controls to viewer API
  wireToolbar(viewer);

  return viewer;
}

// ---------- Toolbar wiring ----------

function wireToolbar(v) {
  const slider = document.getElementById('transparency-slider');
  if (slider) slider.addEventListener('input', e => v.setTransparency(parseFloat(e.target.value)));

  const on  = document.getElementById('highlight-on');
  const off = document.getElementById('highlight-off');
  if (on)  on.addEventListener('change',  () => v.setHighlightIssues(true));
  if (off) off.addEventListener('change', () => v.setHighlightIssues(false));

  for (const face of ['front', 'back', 'top', 'bottom', 'left', 'right']) {
    const btn = document.getElementById(`view-${face}`);
    if (btn) btn.addEventListener('click', () => v.viewFace(face));
  }

  const home = document.getElementById('btn-home');
  if (home) home.addEventListener('click', () => v.fitCamera());
}

// ---------- Helpers ----------

function makeTextSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.4, 0.4, 1);
  return sprite;
}

function f(n) { return (Math.round(n * 100) / 100).toFixed(2); }
function fmtCounts(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ');
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
