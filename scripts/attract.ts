// An attract-mode loop. A greedy bot plays a 40-line sprint, every frame is
// snapshotted, and the frames become one looping SMIL animation: the settled
// stack is drawn once as per-cell windows, each piece falls from its spawn row
// (never painted at its landing spot first), and the HUD tracks the sprint.
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

// Rounded so `dur` is a clean number; keyTimes use the same value.
const LOOP = +(shots.length * HOLD).toFixed(3);

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

const boards = shots.map((shot) => cells(shot));
const frames = shots.length;

/**
 * The settled stack, drawn once for the whole loop.
 *
 * Each cell emits one node per run of frames where it holds a value, and that
 * node is shown by a discrete opacity window. So the file grows with placements
 * and clears, not with frames x cells. Redrawing the stack inside every frame
 * duplicated the whole board ~50 times by the end of the sprint, so the loop
 * got heavier exactly as the stack grew.
 */
function boardLayer(): string {
  const out: string[] = [];

  function run(value: number, idx: number, start: number, end: number): string {
    const el = `<use href="#c${value}" x="${PAD + (idx % W) * CELL}" y="${WELL_TOP + ((idx / W) | 0) * CELL}"`;
    if (start === 0 && end === frames) return `${el}/>`; // occupied all loop
    let values: string;
    let keys: string;
    if (start === 0) {
      values = '1;0';
      keys = keyTimes(0, (end * HOLD) / LOOP);
    } else if (end === frames) {
      values = '0;1';
      keys = keyTimes(0, (start * HOLD) / LOOP);
    } else {
      values = '0;1;0';
      keys = keyTimes(0, (start * HOLD) / LOOP, (end * HOLD) / LOOP);
    }
    // Hidden base value: a static render (no SMIL) shows an empty well rather
    // than a pile of every cell that ever fills.
    return (
      `${el} opacity="0">` +
      `<animate attributeName="opacity" values="${values}" keyTimes="${keys}" ` +
      `dur="${LOOP}s" begin="0s" repeatCount="indefinite" calcMode="discrete"/></use>`
    );
  }

  for (let idx = 0; idx < W * H; idx++) {
    let start = 0;
    let value = 0;
    for (let i = 0; i <= frames; i++) {
      // The stack under a frame is the board before its piece landed. That
      // keeps the fall honest and survives the line-clear shift: the post-clear
      // board has already collapsed, so using it here would move the piece.
      const v = i < frames && i > 0 ? boards[i - 1][idx] : 0;
      if (v === value) continue;
      if (value) out.push(run(value, idx, start, i));
      value = v;
      start = i;
    }
  }
  return out.join('');
}

let body = '';
shots.forEach((shot, i) => {
  const an = shot.an;
  const a = i * HOLD;
  const b = a + HOLD - GAP;
  const parts: string[] = [];

  // The piece is drawn at its spawn row, so the base drawing is never at the
  // landing spot: no pass of the loop and no paused animation can show a block
  // sitting where it is about to land. The fall then translates it down.
  if (an && an.kind === 'drop') {
    const dy = (an.y1 - an.y0) * CELL;
    const falling = SHAPES[an.piece][an.rot]
      .map(
        ([dx, dyy]) =>
          `<use href="#c${an.piece}" x="${PAD + (an.x + dx) * CELL}" y="${WELL_TOP + (an.y0 + dyy) * CELL}"/>`,
      )
      .join('');
    const fs = (a + FALL_LEAD) / LOOP;
    const fe = (a + FALL_LEAD + FALL_DUR) / LOOP;
    if (dy > 0) {
      parts.push(
        `<g><animateTransform attributeName="transform" type="translate" ` +
          `values="0 0;0 0;0 ${dy};0 ${dy}" keyTimes="${keyTimes(0, fs, fe, 1)}" ` +
          `dur="${LOOP}s" begin="0s" repeatCount="indefinite"/>${falling}</g>`,
      );
    } else {
      parts.push(falling);
    }

    // The rows this piece completed, flashed where they were, then the next
    // frame shows the board after they collapse.
    if (an.cleared.length) {
      parts.push(
        an.cleared
          .map(
            (row) =>
              `<rect x="${PAD}" y="${WELL_TOP + row * CELL}" width="${W * CELL}" height="${CELL}" fill="#eaffef" opacity="0">` +
              `<animate attributeName="opacity" values="0;0.6;0" keyTimes="${keyTimes(0, fe, b / LOOP)}" ` +
              `dur="${LOOP}s" begin="0s" repeatCount="indefinite"/></rect>`,
          )
          .join(''),
      );
    }
  }

  // Visibility window for this frame, looping. Frame 0 starts visible at t=0;
  // every other frame is hidden until its window opens. Base opacity 0 means a
  // frame whose animate is ever dropped stays hidden instead of painting a
  // stale piece over the loop.
  const vis =
    i === 0
      ? `<animate attributeName="opacity" values="1;0" keyTimes="${keyTimes(0, b / LOOP)}" ` +
        `dur="${LOOP}s" begin="0s" repeatCount="indefinite" calcMode="discrete"/>`
      : `<animate attributeName="opacity" values="0;1;0" keyTimes="${keyTimes(0, a / LOOP, b / LOOP)}" ` +
        `dur="${LOOP}s" begin="0s" repeatCount="indefinite" calcMode="discrete"/>`;

  body += `<g opacity="${i === 0 ? 1 : 0}">${vis}${parts.join('')}${hudFrame(shot.ln, a)}</g>`;
});

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}">` +
  `<defs>${symbol}</defs>` +
  `<rect width="${VW}" height="${VH}" fill="#061109"/>` +
  hudShell() +
  boardLayer() +
  body +
  `</svg>`;

writeFileSync(new URL('../attract.svg', import.meta.url), svg);
console.log(
  `frames=${shots.length} pieces  svg=${(svg.length / 1024).toFixed(1)} KB  loop=${(LOOP).toFixed(1)}s  ` +
    `lines=${shots.at(-1)?.ln} score=${shots.at(-1)?.sc}`,
);
