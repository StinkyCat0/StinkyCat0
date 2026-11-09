// Prototype: an attract-mode loop. A greedy bot plays N pieces, every frame is
// snapshotted, and the frames become one SMIL animation with visibility windows.
// Run: node --experimental-strip-types scripts/attract.ts
import { writeFileSync } from 'node:fs';

import { H, SHAPES, W, applyMove, decodeBoard, newGame } from '../game/engine.ts';
import type { State } from '../game/engine.ts';

const CELL = 16; // attract mode is a thumbnail, not the board you play
const FILL: Record<number, string> = {
  1: '#8ef7ac',
  2: '#63e88a',
  3: '#a9ffc4',
  4: '#43d872',
  5: '#c8ffdd',
  6: '#57ef83',
  7: '#7bff9c',
};

function cells(s: State): number[] {
  return decodeBoard(s.b);
}

/** classic Dellacherie-ish heuristic: low, few holes, few bumps, clear lines */
function score(cellsArr: number[]): number {
  const heights: number[] = [];
  let holes = 0;
  for (let x = 0; x < W; x++) {
    let h = 0;
    let seen = false;
    for (let y = 0; y < H; y++) {
      if (cellsArr[y * W + x]) {
        if (!seen) {
          seen = true;
          h = H - y;
        }
      } else if (seen) holes++;
    }
    heights.push(h);
  }
  const agg = heights.reduce((a, b) => a + b, 0);
  let bump = 0;
  for (let i = 1; i < W; i++) bump += Math.abs(heights[i] - heights[i - 1]);
  const max = Math.max(...heights);
  return -0.51 * agg + 0.76 * 0 - 0.36 * holes - 0.18 * bump - 0.3 * max;
}

function rotated(s: State, turns: number): State {
  let out = s;
  for (let i = 0; i < turns; i++) out = applyMove(out, { type: 'rot' });
  return out;
}

function bestPlay(s: State): State {
  let best: State | null = null;
  let bestScore = -Infinity;
  for (let turns = 0; turns < 4; turns++) {
    for (let col = 0; col < W; col++) {
      const cand = applyMove(rotated(s, turns), { type: 'drop', col });
      if (cand.ov) continue;
      // reward lines that would clear (the board already has them cleared, so
      // compare before/after line counts)
      const gain = (cand.ln - s.ln) * 40;
      const v = score(cells(cand)) + gain;
      if (v > bestScore) {
        bestScore = v;
        best = cand;
      }
    }
  }
  return best ?? s;
}

const FRAMES = Number(process.argv[2] ?? 26);
const HOLD = 0.55; // seconds per frame
let s = newGame(2026);
const shots: State[] = [];
for (let i = 0; i < FRAMES && !s.ov; i++) {
  s = bestPlay(s);
  shots.push(s);
}

const SW = W * CELL;
const SH = H * CELL;
const symbol = Object.entries(FILL)
  .map(([id, fill]) => `<rect id="c${id}" width="${CELL - 1}" height="${CELL - 1}" rx="1.5" fill="${fill}"/>`)
  .join('');

let body = '';
shots.forEach((shot, i) => {
  const board = cells(shot);
  const an = shot.an;
  const mine = new Set<number>();
  if (an && an.kind === 'drop') {
    for (const [cx, cy] of SHAPES[an.piece][an.rot]) {
      const x = an.x + cx;
      const y = an.y1 + cy;
      if (x >= 0 && x < W && y >= 0 && y < H) mine.add(y * W + x);
    }
  }
  const t0 = i * HOLD;
  const parts: string[] = [];
  for (let idx = 0; idx < board.length; idx++) {
    const v = board[idx];
    if (!v || mine.has(idx)) continue;
    const x = idx % W;
    const y = (idx / W) | 0;
    parts.push(`<use href="#c${v}" x="${x * CELL}" y="${y * CELL}"/>`);
  }
  if (an && an.kind === 'drop' && mine.size) {
    const dy = an.y1 * CELL;
    const falling = [...mine]
      .map((idx) => `<use href="#c${an.piece}" x="${(idx % W) * CELL}" y="${(((idx / W) | 0) * CELL)}"/>`)
      .join('');
    parts.push(
      `<g><animateTransform attributeName="transform" type="translate" values="0 ${-dy};0 0" ` +
        `dur="0.28s" begin="${t0 + 0.05}s" fill="freeze"/>${falling}</g>`,
    );
  }
  body +=
    `<g visibility="hidden">` +
    `<set attributeName="visibility" to="visible" begin="${t0}s" dur="${HOLD - 0.02}s"/>` +
    parts.join('') +
    `</g>`;
});

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SW + 8}" height="${SH + 8}" viewBox="-4 -4 ${SW + 8} ${SH + 8}">` +
  `<defs>${symbol}</defs>` +
  `<rect x="-4" y="-4" width="${SW + 8}" height="${SH + 8}" fill="#061109"/>` +
  body +
  `</svg>`;

writeFileSync(new URL('../attract.svg', import.meta.url), svg);
console.log(`frames=${shots.length} pieces   svg=${(svg.length / 1024).toFixed(1)} KB   loop=${(shots.length * HOLD).toFixed(1)}s   lines=${shots.at(-1)?.ln} score=${shots.at(-1)?.sc}`);
