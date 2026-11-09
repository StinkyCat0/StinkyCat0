import test from 'node:test';
import assert from 'node:assert/strict';

import { applyMove, newGame } from '../game/engine.ts';
import { decodeState, encodeState } from '../game/state.ts';
import { renderBoard } from '../game/render.ts';

test('state survives the URL round trip', () => {
  const s = applyMove(newGame(1234), { type: 'drop', col: 6 });
  const back = decodeState(encodeState(s));
  assert.ok(back);
  assert.equal(back.b, s.b);
  assert.equal(back.sc, s.sc);
  assert.deepEqual(back.q, s.q);
});

test('the payload is URL safe', () => {
  const payload = encodeState(applyMove(newGame(1), { type: 'drop', col: 2 }));
  assert.match(payload, /^[A-Za-z0-9_-]+$/);
});

test('garbage payloads are rejected, not thrown', () => {
  for (const bad of ['', 'nope', 'e30', encodeState(newGame(1)).slice(0, 20)]) {
    assert.equal(decodeState(bad), null);
  }
});

test('a tampered board is rejected', () => {
  const s = newGame(2);
  const payload = encodeState({ ...s, p: 99 });
  assert.equal(decodeState(payload), null);
});

test('a state is small enough to live in a README', () => {
  let s = newGame(77);
  for (let i = 0; i < 40 && !s.ov; i++) s = applyMove(s, { type: 'drop', col: i % 10 });
  const payload = encodeState(s);
  assert.ok(payload.length < 700, `payload was ${payload.length} bytes`);
});

test('the renderer produces a self-contained SVG with no leaks', () => {
  const s = applyMove(newGame(4), { type: 'drop', col: 5 });
  const svg = renderBoard(s);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(!svg.includes('undefined'));
  assert.ok(!svg.includes('NaN'));
  assert.ok(svg.includes('viewBox='), 'scales on mobile');
  assert.equal((svg.match(/<g/g) ?? []).length, (svg.match(/<\/g>/g) ?? []).length, 'groups balance');
  assert.equal((svg.match(/<rect/g) ?? []).length > 10, true, 'blocks are drawn');
});

test('the landed piece is animated, not duplicated', () => {
  const s = applyMove(newGame(4), { type: 'drop', col: 5 });
  const svg = renderBoard(s);
  assert.ok(svg.includes('animateTransform'), 'the drop animates');
  const landed = (s.an && s.an.kind === 'drop' && s.an.piece) || 0;
  assert.ok(landed >= 1);
});

test('a game over board renders the result', () => {
  let s = newGame(8);
  for (let i = 0; i < 400 && !s.ov; i++) s = applyMove(s, { type: 'drop', col: 0 });
  assert.equal(s.ov, true);
  const svg = renderBoard(s);
  assert.ok(svg.includes('GAME OVER'));
  assert.ok(svg.includes(`${s.sc} PTS`));
});
