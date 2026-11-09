// Prototype: an attract-mode loop. A greedy bot plays a 40-line sprint, every
// frame is snapshotted, and the frames become one looping SMIL animation with
// visibility windows, a progress bar toward 40 lines, and an elapsed timer.
// Run: node --experimental-strip-types scripts/attract.ts
import { writeFileSync } from 'node:fs';

import { H, SHAPES, W, applyMove, decodeBoard, newGame } from '../game/engine.ts';
import type { State } from '../game/engine.ts';

const CELL = 16; // attract mode is a thumbnail, not the board you play
const PAD = 4;
const HUD_H = 24; // strip above the well for the 40L bar and the timer
const WELL_TOP = PAD + HUD_H;
const VW = PAD * 2 + W * CELL;
const VH = PAD * 2 + HUD_H + H * CELL;

const FILL: Record<number, string> = {
  1: '#8ef7ac',
  2: '#63e88a',
  3: '#a9ffc4',
  4: '#43d872',
  5: '#c8ffdd',
  6: '#57ef83',
  7: '#7bff9c',
};

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const GOAL = 40; // lines in a sprint
const HOLD = 0.55; // seconds per frame
const GAP = 0.02; // hidden sliver between frames so two never overlap
const FALL_LEAD = 0.05; // how long the piece hangs before the fall starts
const FALL_DUR = 0.28; // how long the fall takes

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
  return -0.51 * agg - 0.36 * holes - 0.18 * bump - 0.3 * max;
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

let s = newGame(2026);
const shots: State[] = [];
while (s.ln < GOAL && !s.ov && shots.length < 250) {
  s = bestPlay(s);
  shots.push(s);
}

const LOOP = shots.length * HOLD;

// ---------------------------------------------------------------- HUD helpers

function fmtTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const ss = String(Math.floor(sec) % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

/** The constant HUD shell: title, bar trough, well outline. */
function hudShell(): string {
  const barW = 104;
  return (
    `<text x="${PAD + 2}" y="${PAD + 8}" font-family="${MONO}" font-size="6" letter-spacing="1" fill="#2f6b48">40L SPRINT</text>` +
    `<rect x="${PAD + 2}" y="${PAD + 13}" width="${barW}" height="6" rx="2" fill="#0a1510"/>` +
    `<rect x="${PAD}" y="${PAD + HUD_H}" width="${W * CELL}" height="${H * CELL}" fill="none" stroke="#1d4c31" stroke-width="1"/>`
  );
}

/** Per-frame HUD: how full the 40L bar is, the line count, the elapsed timer. */
function hudFrame(ln: number, elapsed: number): string {
  const barW = 104;
  const frac = Math.min(1, ln / GOAL);
  const fillW = barW * frac;
  return (
    `<rect x="${PAD + 2}" y="${PAD + 13}" width="${fillW.toFixed(1)}" height="6" rx="2" fill="${FILL[1]}"/>` +
    `<text x="${PAD + 2 + barW + 6}" y="${PAD + 18}" font-family="${MONO}" font-size="7" fill="#b8ffcd">${ln}/${GOAL}</text>` +
    `<text x="${VW - PAD - 2}" y="${PAD + 18}" text-anchor="end" font-family="${MONO}" font-size="7" fill="#4f9f70">${fmtTimer(elapsed)}</text>`
  );
}

// ---------------------------------------------------------------- frame build

const symbol = Object.entries(FILL)
  .map(([id, fill]) => `<rect id="c${id}" width="${CELL - 1}" height="${CELL - 1}" rx="1.5" fill="${fill}"/>`)
  .join('');

function keyTimes(...fractions: number[]): string {
  return fractions.map((f) => f.toFixed(6)).join(';');
}

let body = '';
shots.forEach((shot, i) => {
  const board = cells(shot);
  const an = shot.an;
  const a = i * HOLD;
  const b = a + HOLD - GAP;
  const mine = new Set<number>();
  if (an && an.kind === 'drop') {
    for (const [cx, cy] of SHAPES[an.piece][an.rot]) {
      const x = an.x + cx;
      const y = an.y1 + cy;
      if (x >= 0 && x < W && y >= 0 && y < H) mine.add(y * W + x);
    }
  }

  const parts: string[] = [];
  for (let idx = 0; idx < board.length; idx++) {
    const v = board[idx];
    if (!v || mine.has(idx)) continue;
    const x = idx % W;
    const y = (idx / W) | 0;
    parts.push(`<use href="#c${v}" x="${PAD + x * CELL}" y="${WELL_TOP + y * CELL}"/>`);
  }

  // The piece that just dropped: it must start ABOVE its landing spot (so it
  // never flashes at its final resting place before falling). Its base
  // transform is the top of the well; the fall is a keyTimes window inside the
  // frame so it only happens once per loop.
  if (an && an.kind === 'drop' && mine.size) {
    const dy = an.y1 * CELL;
    const falling = [...mine]
      .map(
        (idx) =>
          `<use href="#c${an.piece}" x="${PAD + (idx % W) * CELL}" y="${WELL_TOP + ((idx / W) | 0) * CELL}"/>`,
      )
      .join('');
    const fs = (a + FALL_LEAD) / LOOP;
    const fe = (a + FALL_LEAD + FALL_DUR) / LOOP;
    if (dy > 0) {
      parts.push(
        `<g><animateTransform attributeName="transform" type="translate" ` +
          `values="0 ${-dy};0 ${-dy};0 0;0 0" keyTimes="${keyTimes(0, fs, fe, 1)}" ` +
          `dur="${LOOP}s" begin="0s" repeatCount="indefinite"/>${falling}</g>`,
      );
    } else {
      parts.push(falling);
    }
  }

  // Visibility window for this frame, looping. Frame 0 starts visible at t=0;
  // every other frame is hidden until its window opens.
  const vis =
    a === 0
      ? `<animate attributeName="opacity" values="1;0" keyTimes="${keyTimes(0, b / LOOP)}" ` +
        `dur="${LOOP}s" begin="0s" repeatCount="indefinite" calcMode="discrete"/>`
      : `<animate attributeName="opacity" values="0;1;0" keyTimes="${keyTimes(0, a / LOOP, b / LOOP)}" ` +
        `dur="${LOOP}s" begin="0s" repeatCount="indefinite" calcMode="discrete"/>`;

  body +=
    `<g>${vis}${parts.join('')}${hudFrame(shot.ln, a)}</g>`;
});

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}">` +
  `<defs>${symbol}</defs>` +
  `<rect width="${VW}" height="${VH}" fill="#061109"/>` +
  hudShell() +
  body +
  `</svg>`;

writeFileSync(new URL('../attract.svg', import.meta.url), svg);
console.log(
  `frames=${shots.length} pieces  svg=${(svg.length / 1024).toFixed(1)} KB  loop=${(LOOP).toFixed(1)}s  ` +
    `lines=${shots.at(-1)?.ln} score=${shots.at(-1)?.sc}`,
);
