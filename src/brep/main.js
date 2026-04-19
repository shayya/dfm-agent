import { loadStep } from './stepLoader.js';
import { detectSharpCorners } from './detectSharpCorners.js';
import { detectDeepHoles } from './detectDeepHoles.js';

const fileInput = document.getElementById('file-input');
const statusEl  = document.getElementById('status');
const statsEl   = document.getElementById('stats');
const resultsEl = document.getElementById('results');

fileInput.addEventListener('change', async (evt) => {
  const file = evt.target.files[0];
  if (!file) return;

  statusEl.textContent = 'Loading WASM module and parsing STEP…';
  statsEl.innerHTML = '';
  resultsEl.innerHTML = '';

  try {
    const arrayBuffer = await file.arrayBuffer();

    const { oc, shape, stats } = await loadStep(arrayBuffer);

    // Show topology summary
    statsEl.innerHTML = `
      <strong>Topology summary for ${escHtml(file.name)}</strong>
      <ul>
        <li>Faces: ${stats.faceTotal} — ${formatCounts(stats.faceCounts)}</li>
        <li>Edges: ${stats.edgeTotal} — ${formatCounts(stats.edgeCounts)}</li>
      </ul>
    `;

    statusEl.textContent = 'Running DFM detectors…';

    const corners = detectSharpCorners(oc, shape);
    const holes   = detectDeepHoles(oc, shape);

    const items = [];

    for (const c of corners) {
      items.push({
        severity: c.severity,
        html: `<strong>[${c.severity.toUpperCase()}]</strong> Sharp internal corner — ` +
              `edge #${c.edgeIndex}, ` +
              `interior angle <strong>${c.interiorAngleDeg}°</strong>, ` +
              `faces ${c.faceA_index} &amp; ${c.faceB_index}, ` +
              `start (${fmt(c.startPoint.x)}, ${fmt(c.startPoint.y)}, ${fmt(c.startPoint.z)}), ` +
              `end (${fmt(c.endPoint.x)}, ${fmt(c.endPoint.y)}, ${fmt(c.endPoint.z)})`,
      });
    }

    for (const h of holes) {
      items.push({
        severity: h.severity,
        html: `<strong>[${h.severity.toUpperCase()}]</strong> Deep small hole — ` +
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
        .map(i => `<li class="${escHtml(i.severity)}">${i.html}</li>`)
        .join('\n');
    }

    statusEl.textContent = `Done. ${corners.length} sharp corner(s), ${holes.length} deep hole(s) flagged.`;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    console.error(err);
  }
});

function fmt(n) { return (Math.round(n * 100) / 100).toFixed(2); }
function formatCounts(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ');
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
