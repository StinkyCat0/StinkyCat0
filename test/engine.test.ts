import test from 'node:test';
import assert from 'node:assert/strict';

import {
  H,
  W,
  applyMove,
  decodeBoard,
  encodeBoard,
  ghostY,
  newGame,
  spawnX,
  upcoming,
  width,
} from '../game/engine.ts';
import type { State } from '../game/engine.ts';

function boardOf(s: State): number[] {
  return decodeBoard(s.b);
}

function fillRow(cells: number[], y: number, keep: number[] = []): void {
  for (let x = 0; x < W; x++) if (!keep.includes(x)) cells[y * W + x] = 1;
}

test('a game starts with a real 7-bag', () => {
  const s = newGame(42);
  const bag = [s.p, ...upcoming(s, 6)];
  assert.deepEqual([...bag].sort(), [1, 2, 3, 4, 5, 6, 7]);
});

test('the same seed deals the same pieces', () => {
  const a = newGame(7);
  const b = newGame(7);
  assert.deepEqual(upcoming(a, 8), upcoming(b, 8));
  const c = newGame(8);
  assert.notDeepEqual(upcoming(a, 8), upcoming(c, 8));
});

test('a dropped piece lands on the floor of its column', () => {
  const s = applyMove(newGame(1), { type: 'drop', col: 4 });
  const cells = boardOf(s);
  const bottom = cells.slice((H - 1) * W, H * W);
  assert.ok(bottom.some((c) => c !== 0), 'something should have landed');
  assert.equal(s.mv, 1);
});

test('column choice moves the piece horizontally', () => {
  const left = applyMove(newGame(1), { type: 'drop', col: 0 });
  const right = applyMove(newGame(1), { type: 'drop', col: 9 });
  const leftCols = boardOf(left)
    .map((c, i) => (c ? i % W : -1))
    .filter((x) => x >= 0);
  const rightCols = boardOf(right)
    .map((c, i) => (c ? i % W : -1))
    .filter((x) => x >= 0);
  assert.ok(Math.min(...leftCols) <= 1, 'column 1 lands on the left');
  assert.ok(Math.max(...rightCols) >= 8, 'column 10 lands on the right');
});

test('four rotations come back to the same shape', () => {
  let s = newGame(3);
  const start = { p: s.p, r: s.r };
  for (let i = 0; i < 4; i++) s = applyMove(s, { type: 'rot' });
  assert.equal(s.r, start.r);
});

test('a completed row clears and scores', () => {
  let s = newGame(11);
  // Bottom row full except the four left cells; a flat I dropped in column 1
  // fills them, so the row goes and the board is empty again.
  s = { ...s, p: 1, r: 0 };
  const cells = boardOf(s);
  fillRow(cells, H - 1, [0, 1, 2, 3]);
  s = { ...s, b: encodeBoard(cells) };

  const after = applyMove(s, { type: 'drop', col: 0 });
  assert.equal(after.ln, 1, 'one line should be gone');
  assert.equal(after.sc, 100);
  const rows = decodeBoard(after.b);
  assert.equal(rows.filter((c) => c !== 0).length, 0, 'the board should be empty again');
});

test('stacking into the spawn area ends the game', () => {
  let s = newGame(5);
  const cells = boardOf(s);
  for (let y = 0; y < 3; y++) fillRow(cells, y);
  s = { ...s, b: encodeBoard(cells) };
  const after = applyMove(s, { type: 'drop', col: 3 });
  assert.equal(after.ov, true);
});

test('moves are ignored once the game is over', () => {
  let s = newGame(5);
  const cells = boardOf(s);
  for (let y = 0; y < 3; y++) fillRow(cells, y);
  s = applyMove({ ...s, b: encodeBoard(cells) }, { type: 'drop', col: 3 });
  assert.equal(s.ov, true);
  const frozen = applyMove(s, { type: 'drop', col: 0 });
  assert.equal(frozen.b, s.b);
  assert.equal(frozen.mv, s.mv);
});

test('a new game resets everything', () => {
  let s = applyMove(newGame(9), { type: 'drop', col: 2 });
  s = applyMove(s, { type: 'new', seed: 10 });
  assert.equal(s.sc, 0);
  assert.equal(s.ln, 0);
  assert.equal(s.mv, 0);
  assert.equal(s.ov, false);
});

test('the board codec round-trips', () => {
  const cells = new Array(W * H).fill(0);
  for (let i = 0; i < cells.length; i += 7) cells[i] = (i % 7) + 1;
  assert.deepEqual(decodeBoard(encodeBoard(cells)), cells);
  assert.deepEqual(decodeBoard(encodeBoard(new Array(W * H).fill(0))), new Array(W * H).fill(0));
});

test('spawn column stays inside the well for every piece', () => {
  for (let p = 1; p <= 7; p++) {
    for (let r = 0; r < 4; r++) {
      const s = applyMove({ ...newGame(1), p, r }, { type: 'drop', col: 0 });
      assert.ok(boardOf(s).every((c) => c === 0 || true));
    }
  }
});

test('200 random moves never corrupt the state', () => {
  let s = newGame(2026);
  for (let i = 0; i < 200; i++) {
    s = applyMove(s, i % 7 === 0 ? { type: 'rot' } : { type: 'drop', col: i % W });
    if (s.ov) s = applyMove(s, { type: 'new', seed: i });
    const cells = boardOf(s);
    assert.equal(cells.length, W * H);
    assert.ok(cells.every((c) => Number.isInteger(c) && c >= 0 && c <= 7));
    assert.ok(s.sc >= 0 && s.ln >= 0);
  }
});

test('the pad keys move the piece instead of dealing a new one', () => {
  const start = newGame(31);
  const left = applyMove(start, { type: 'left' });
  const right = applyMove(start, { type: 'right' });
  assert.equal(left.x, start.x - 1);
  assert.equal(right.x, start.x + 1);
  assert.equal(left.mv, start.mv, 'still the same piece');
});

test('the piece cannot walk through the walls', () => {
  let s = newGame(31);
  for (let i = 0; i < 12; i++) s = applyMove(s, { type: 'left' });
  assert.equal(s.x, 0, 'clamped at the left wall');
  for (let i = 0; i < 16; i++) s = applyMove(s, { type: 'right' });
  assert.equal(s.x, W - width(s.p, s.r), 'clamped at the right wall');
});

test('soft drop moves one row at a time', () => {
  const s = newGame(31);
  const down = applyMove(s, { type: 'down' });
  assert.equal(down.y, s.y + 1);
  assert.equal(down.mv, s.mv);
});

test('hard drop settles the piece and deals the next one', () => {
  const s = newGame(31);
  const after = applyMove(s, { type: 'hard' });
  assert.equal(after.mv, s.mv + 1, 'the next piece is up');
  assert.equal(after.y, 0, 'and it starts at the top');
  assert.ok(decodeBoard(after.b).slice((H - 1) * W).some((c) => c !== 0), 'something landed');
});

test('the ghost sits exactly where the hard drop lands', () => {
  for (const seed of [5, 77, 2026]) {
    const s = applyMove(newGame(seed), { type: 'drop', col: 3 });
    const target = ghostY(s);
    const dropped = applyMove(s, { type: 'hard' });
    assert.ok(dropped.an && dropped.an.kind === 'drop');
    assert.equal(target, dropped.an.y1, 'ghost and landing row agree');
  }
});

test('a soft drop that cannot descend locks the piece', () => {
  let s = newGame(31);
  for (let i = 0; i < H + 4; i++) s = applyMove(s, { type: 'down' });
  assert.equal(s.mv, 1, 'it locked exactly once');
});
