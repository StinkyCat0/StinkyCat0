// Dev utility: write sample boards to disk so they can be rasterised and
// checked without deploying. `npm run preview`
import { mkdirSync, writeFileSync } from 'node:fs';

import { applyMove, encodeBoard, newGame } from '../game/engine.ts';
import type { State } from '../game/engine.ts';
import { renderBoard } from '../game/render.ts';

const out = new URL('../preview/', import.meta.url);
mkdirSync(out, { recursive: true });

function write(name: string, s: State): void {
  writeFileSync(new URL(`${name}.svg`, out), renderBoard(s));
  console.log(`${name}.svg  moves=${s.mv} lines=${s.ln} score=${s.sc} over=${s.ov}`);
}

write('fresh', newGame(2026));

let stacked = newGame(7);
for (let i = 0; i < 14; i++) {
  stacked = applyMove(stacked, { type: 'drop', col: [3, 4, 5, 2, 6][i % 5] });
}
write('stacked', stacked);

// A line clear in progress: the bottom row is full except the four left cells,
// and a flat I dropped in column 1 fills them.
const board = new Array(200).fill(0);
for (let x = 4; x < 10; x++) board[19 * 10 + x] = 2;
const clearing: State = { ...newGame(11), p: 1, r: 0, b: encodeBoard(board) };
write('clearing', applyMove(clearing, { type: 'drop', col: 0 }));

let over = newGame(8);
for (let i = 0; i < 400 && !over.ov; i++) over = applyMove(over, { type: 'drop', col: 0 });
write('gameover', over);
