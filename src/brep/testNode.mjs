/**
 * Node.js test for B-Rep DFM analysis.
 * Usage:  node src/brep/testNode.mjs
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const wasmDir = resolve(__dirname, '../../node_modules/opencascade.js/dist');
globalThis.__dirname = globalThis.__dirname || wasmDir;

const wasmBinary = readFileSync(join(wasmDir, 'opencascade.wasm.wasm'));
const ocModule = require(join(wasmDir, 'opencascade.wasm.js'));
const ocFactory = ocModule.default || ocModule;

async function main() {
  console.log('Initializing opencascade.js WASM...');
  const oc = await ocFactory({ wasmBinary, locateFile: (path) => join(wasmDir, path) });
  console.log('WASM initialized.\n');

  const stepPath = resolve(__dirname, '../../samples/part1.step');
  console.log(`Loading STEP file: ${stepPath}`);
  const data = readFileSync(stepPath);

  oc.FS.writeFile('model.step', data);
  const reader = new oc.STEPControl_Reader_1();
  const readStatus = reader.ReadFile('model.step');
  try { oc.FS.unlink('model.step'); } catch (_) {}

  console.log('ReadFile status:', readStatus.value === 1 ? 'SUCCESS' : `FAILED (${readStatus.value})`);

  if (readStatus.value !== 1) {
    console.error('STEP file failed to parse. Aborting.');
    process.exit(1);
  }

  reader.TransferRoots();
  const shape = reader.OneShape();

  // Quick stats
  let faceCount = 0, edgeCount = 0;
  const fExp = new oc.TopExp_Explorer_1();
  fExp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (fExp.More()) { faceCount++; fExp.Next(); }
  fExp.delete();
  const eExp = new oc.TopExp_Explorer_1();
  eExp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (eExp.More()) { edgeCount++; eExp.Next(); }
  eExp.delete();
  console.log(`Shape loaded: ${faceCount} faces, ${edgeCount} edges.\n`);

  // Run detectors
  const { detectSharpCorners } = await import('./detectSharpCorners.js');
  const { detectDeepHoles } = await import('./detectDeepHoles.js');

  console.log('Running sharp corner detector...');
  const corners = detectSharpCorners(oc, shape);

  console.log('Running deep hole detector...');
  const holes = detectDeepHoles(oc, shape);

  console.log('\n=== Sharp Internal Corners ===');
  if (corners.length === 0) {
    console.log('  (none detected)');
  }
  for (const c of corners) {
    console.log(
      `  [${c.severity.toUpperCase()}] Edge #${c.edgeIndex}: ` +
      `interior angle ${c.interiorAngleDeg}deg, ` +
      `faces ${c.faceA_index} & ${c.faceB_index}`
    );
    console.log(
      `    start (${c.startPoint.x.toFixed(3)}, ${c.startPoint.y.toFixed(3)}, ${c.startPoint.z.toFixed(3)}), ` +
      `end (${c.endPoint.x.toFixed(3)}, ${c.endPoint.y.toFixed(3)}, ${c.endPoint.z.toFixed(3)})`
    );
  }

  console.log('\n=== Deep Small Holes ===');
  if (holes.length === 0) {
    console.log('  (none detected)');
  }
  for (const h of holes) {
    console.log(
      `  [${h.severity.toUpperCase()}] Face #${h.faceIndex}: ` +
      `diameter ${h.diameter} mm, depth ${h.depth} mm, ` +
      `aspect ratio ${h.aspectRatio}:1`
    );
  }

  console.log(`\nDone. ${corners.length} corner(s), ${holes.length} hole(s) flagged.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
