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

  statusEl.textContent = 'Loading WASM module and parsing STEP\u2026';
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

    statusEl.textContent = 'Running DFM detectors\u2026';

    const corners = detectSharpCorners(oc, shape);
    const holes   = detectDeepHoles(oc, shape);

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

function f(n) { return (Math.round(n * 100) / 100).toFixed(2); }
function fmtCounts(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ');
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
