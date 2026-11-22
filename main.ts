// radar-4 entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with the fitted
// model in lib/model.ts, writes the ranked board to /output/board.json and the
// dashboard's data to /output/data.js, copies dashboard/ and screenshots/ to
// /output, and writes /output/dossier.json with the vendored make.fun library.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The fit is computed from the snapshot at run time. The run refuses to write
// when the computed fit disagrees with the values the analysis measured on the
// same sealed bytes — a changed snapshot must change the numbers, never pass
// silently with stale ones.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// Expected fit on the sealed 2026-11-14 snapshot (measured in analysis, see
// the dashboard's methodology section). A different snapshot must fail here.
const EXPECTED = { n: 128, dropped: 16, intercept: 3.025, slope: 0.522, board: 340, watchlist: 40 };

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);

// The run-time fit must reproduce the measured fit on these sealed bytes.
const fit = radar.fit;
if (fit.n !== EXPECTED.n || fit.dropped !== EXPECTED.dropped) {
  fail(`fit trained on ${fit.n} protocols (${fit.dropped} dropped), want ${EXPECTED.n} (${EXPECTED.dropped})`);
}
if (Math.abs(fit.intercept - EXPECTED.intercept) >= 0.01 || Math.abs(fit.slope - EXPECTED.slope) >= 0.01) {
  fail(`fit intercept ${fit.intercept.toFixed(3)} slope ${fit.slope.toFixed(3)}, want ${EXPECTED.intercept}/${EXPECTED.slope}`);
}
if (board.length !== EXPECTED.board) {
  fail(`board holds ${board.length} rows, want ${EXPECTED.board}`);
}
if (radar.accounting.watchlist_covered !== EXPECTED.watchlist) {
  fail(`watchlist covered ${radar.accounting.watchlist_covered}/${EXPECTED.watchlist}`);
}
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  fail(`the model wrote a board the gate refuses: ${issue}`);
}

// Absolute output first, a temp dir when it is not writable (never relative).
let out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
try {
  mkdirSync(out, { recursive: true });
} catch {
  out = mkdtempSync(join(tmpdir(), 'radar-'));
  mkdirSync(out, { recursive: true });
}
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (!dashboardFiles.includes('index.html') || !dashboardFiles.some((f) => f.endsWith('.css')) || !dashboardFiles.some((f) => f.endsWith('.js'))) {
  fail('dashboard/ must hold index.html and at least one .css and one .js file');
}
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.accounting.board} board, ${radar.accounting.traded} traded set aside)\n` +
    `token radar: fit log10(mcap) = ${fit.intercept.toFixed(3)} + ${fit.slope.toFixed(3)} log10(TVL) on ${fit.n} traded protocols; held-out R2 ${fit.fold_a_r2.toFixed(2)}/${fit.fold_b_r2.toFixed(2)} (flat ${fit.flat_r2.toFixed(2)}), walk-forward ${fit.walk_r2.toFixed(2)} (flat ${fit.walk_flat_r2.toFixed(2)})\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
