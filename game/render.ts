// State -> SVG. One image per board state, named after that state, so GitHub's
// image cache can never hand a visitor a stale board.
//
// Everything is drawn as phosphor green on near-black: rounded blocks with a
// soft glow, a faint column ruler that matches the keypad in the README, and
// SMIL animation for the move that produced this board (the piece falling in,
// cleared lines flashing out). SMIL runs inside an <img>, which is the only
// moving thing GitHub lets a README have.

import { CLEAR_SCORE, H, SHAPES, W, decodeBoard, ghostY, upcoming } from './engine.ts';
import type { State } from './engine.ts';

const CELL = 24;
const PAD = 12;
const HUD = 44;

const SVG_W = PAD * 2 + W * CELL;
const SVG_H = PAD * 2 + HUD + H * CELL;
const WELL_X = PAD;
const WELL_Y = PAD + HUD;

const FILL: Record<number, string> = {
  0: 'none',
  1: '#8ef7ac',
  2: '#63e88a',
  3: '#a9ffc4',
  4: '#43d872',
  5: '#c8ffdd',
  6: '#57ef83',
  7: '#7bff9c',
};

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function block(x: number, y: number, piece: number, extra = ''): string {
  const px = WELL_X + x * CELL;
  const py = WELL_Y + y * CELL;
  const fill = FILL[piece] ?? FILL[1];
  return (
    `<g${extra}>` +
    `<rect x="${px + 1}" y="${py + 1}" width="${CELL - 2}" height="${CELL - 2}" rx="2.5" fill="${fill}" fill-opacity="0.92"/>` +
    `<rect x="${px + 3}" y="${py + 3}" width="${CELL - 6}" height="${(CELL - 6) / 2.4}" rx="1.4" fill="#ffffff" fill-opacity="0.18"/>` +
    `</g>`
  );
}

function hud(s: State): string {
  const score = String(s.sc).padStart(5, '0');
  const lines = String(s.ln).padStart(2, '0');
  const next = upcoming(s, 1)[0] ?? s.p;
  const shape = SHAPES[next][0];
  const nx = SVG_W - PAD - 34;
  const ny = PAD + 8;
  const cells = shape
    .map(
      ([cx, cy]) =>
        `<rect x="${nx + cx * 7}" y="${ny + 12 + cy * 7}" width="6" height="6" rx="1" fill="${FILL[next]}" fill-opacity="0.85"/>`,
    )
    .join('');
  return (
    `<g font-family="${MONO}">` +
    `<text x="${PAD}" y="${PAD + 10}" font-size="7.5" letter-spacing="1.2" fill="#4f9f70">SCORE</text>` +
    `<text x="${PAD}" y="${PAD + 30}" font-size="17" fill="#b8ffcd" letter-spacing="1">${score}</text>` +
    `<text x="${PAD + 86}" y="${PAD + 10}" font-size="7.5" letter-spacing="1.2" fill="#4f9f70">LINES</text>` +
    `<text x="${PAD + 86}" y="${PAD + 30}" font-size="17" fill="#b8ffcd" letter-spacing="1">${lines}</text>` +
    `<text x="${nx - 2}" y="${PAD + 10}" font-size="7.5" letter-spacing="1.2" fill="#4f9f70">NEXT</text>` +
    cells +
    `</g>`
  );
}

function skipCells(s: State): Set<number> {
  // Cells belonging to the piece that just landed are drawn in the animation
  // group instead, so the fall reads as a fall and not as a duplicate.
  const set = new Set<number>();
  const an = s.an;
  if (an && an.kind === 'drop') {
    for (const [cx, cy] of SHAPES[an.piece][an.rot]) {
      const x = an.x + cx;
      const y = an.y1 + cy;
      if (x >= 0 && x < W && y >= 0 && y < H) set.add(y * W + x);
    }
  }
  return set;
}

export function renderBoard(s: State): string {
  const cells = decodeBoard(s.b);
  const skip = skipCells(s);
  const an = s.an;

  let grid = '';
  for (let x = 1; x < W; x++) {
    grid += `<line x1="${WELL_X + x * CELL}" y1="${WELL_Y}" x2="${WELL_X + x * CELL}" y2="${WELL_Y + H * CELL}" stroke="#2fd267" stroke-opacity="0.05"/>`;
  }

  let blocks = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = cells[y * W + x];
      if (p && !skip.has(y * W + x)) blocks += block(x, y, p);
    }
  }

  // The piece that just dropped: drawn at its landing spot, animated down from
  // where it hung at the top of the well.
  let moving = '';
  let after = '';
  if (an && an.kind === 'drop') {
    const dy = (an.y0 - an.y1) * CELL;
    const inner = SHAPES[an.piece][an.rot]
      .map(([cx, cy]) => block(an.x + cx, an.y1 + cy, an.piece))
      .join('');
    if (dy !== 0 && s.mv > 0) {
      moving =
        `<g>` +
        `<animateTransform attributeName="transform" type="translate" values="0 ${dy};0 0" dur="0.22s" begin="0s" fill="freeze" calcMode="spline" keySplines="0.2 0.6 0.25 1" keyTimes="0;1"/>` +
        inner +
        `</g>`;
    } else {
      moving = inner;
    }

    // Lines that just went away flash where they were, then fade.
    if (an.cleared.length) {
      const pts = CLEAR_SCORE[an.cleared.length] ?? 0;
      after += an.cleared
        .map(
          (row) =>
            `<rect x="${WELL_X}" y="${WELL_Y + row * CELL}" width="${W * CELL}" height="${CELL}" fill="#eaffef" opacity="0">` +
            `<animate attributeName="opacity" values="0;0.62;0" dur="0.5s" begin="0.14s" fill="freeze"/></rect>`,
        )
        .join('');
      after +=
        `<g opacity="0"><animate attributeName="opacity" values="0;1;0" dur="0.7s" begin="0.14s" fill="freeze"/>` +
        `<text x="${WELL_X + W * CELL - 4}" y="${WELL_Y + an.y1 * CELL - 4}" text-anchor="end" font-family="${MONO}" font-size="11" fill="#d8ffe4">+${pts}</text>` +
        `</g>`;
    }
  }

  // Ghost: where a hard drop would land. Dotted, so the keypad has a landing guide.
  let ghost = '';
  if (!s.ov) {
    const gy = ghostY(s);
    if (gy !== s.y) {
      ghost = SHAPES[s.p][s.r]
        .map(([cx, cy]) => {
          const px = WELL_X + (s.x + cx) * CELL;
          const py = WELL_Y + (gy + cy) * CELL;
          return `<rect x="${px + 2}" y="${py + 2}" width="${CELL - 4}" height="${CELL - 4}" rx="2" fill="none" stroke="${FILL[s.p]}" stroke-opacity="0.45" stroke-width="1.4" stroke-dasharray="3 2"/>`;
        })
        .join('');
    }
  }

  // The falling piece: at its current position, sliding down one row when the
  // last move was a soft drop, or fading in after the previous piece settled.
  let spawned = '';
  if (!s.ov) {
    const cellsHtml = SHAPES[s.p][s.r].map(([cx, cy]) => block(s.x + cx, s.y + cy, s.p)).join('');
    if (an && an.kind === 'drop') {
      spawned =
        `<g opacity="0">` +
        `<animate attributeName="opacity" values="0;1" dur="0.06s" begin="0.22s" fill="freeze"/>` +
        cellsHtml +
        `</g>`;
    } else if (an && an.kind === 'fall') {
      spawned =
        `<g>` +
        `<animateTransform attributeName="transform" type="translate" values="0 ${(an.from - s.y) * CELL};0 0" dur="0.09s" begin="0s" fill="freeze"/>` +
        cellsHtml +
        `</g>`;
    } else {
      spawned = cellsHtml;
    }
  }

  // Column ruler, matching the 1..10 keypad under the board.
  let ruler = '';
  for (let x = 0; x < W; x++) {
    ruler += `<text x="${WELL_X + x * CELL + CELL / 2}" y="${WELL_Y + H * CELL + 10}" text-anchor="middle" font-family="${MONO}" font-size="8.5" fill="#2f6b48">${x + 1}</text>`;
  }

  const over = s.ov
    ? `<g>` +
      `<rect x="${WELL_X}" y="${WELL_Y}" width="${W * CELL}" height="${H * CELL}" fill="#03060a" opacity="0">` +
      `<animate attributeName="opacity" values="0;0.72" dur="0.35s" begin="0.3s" fill="freeze"/></rect>` +
      `<g opacity="0"><animate attributeName="opacity" values="0;1" dur="0.01s" begin="0.34s" fill="freeze"/>` +
      `<text x="${WELL_X + (W * CELL) / 2}" y="${WELL_Y + H * CELL * 0.44}" text-anchor="middle" font-family="${MONO}" font-size="19" letter-spacing="2" fill="#e9fff0">GAME OVER</text>` +
      `<text x="${WELL_X + (W * CELL) / 2}" y="${WELL_Y + H * CELL * 0.44 + 22}" text-anchor="middle" font-family="${MONO}" font-size="10" letter-spacing="1" fill="#7ad79b">${s.ln} LINES · ${s.sc} PTS</text>` +
      `</g></g>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="Tetris board, ${s.ln} lines, ${s.sc} points">` +
    `<title>Tetris — ${s.ln} lines, ${s.sc} points</title>` +
    `<defs>` +
    `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%">` +
    `<feGaussianBlur stdDeviation="2.1" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>` +
    `</filter>` +
    `<pattern id="scan" width="1" height="3" patternUnits="userSpaceOnUse">` +
    `<rect width="1" height="1.2" fill="#000"/></pattern>` +
    `</defs>` +
    `<rect width="${SVG_W}" height="${SVG_H}" rx="7" fill="#040907"/>` +
    `<rect x="${WELL_X}" y="${WELL_Y}" width="${W * CELL}" height="${H * CELL}" fill="#061109" stroke="#1d4c31" stroke-width="1"/>` +
    grid +
    `<g filter="url(#glow)">${ghost}${blocks}${moving}${spawned}</g>` +
    after +
    over +
    `<rect x="${WELL_X}" y="${WELL_Y}" width="${W * CELL}" height="${H * CELL}" fill="url(#scan)" opacity="0.16"/>` +
    hud(s) +
    ruler +
    `</svg>`
  );
}

export const BOARD_SIZE = { width: SVG_W, height: SVG_H };
