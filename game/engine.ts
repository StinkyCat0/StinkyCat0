// Tetris rules. Pure functions over a small plain-data state so the whole
// game travels inside a URL and the worker needs no database.
//
// Coordinates: the board is 10x20, row-major, index = y * 10 + x.
// A board cell is 0 for empty, 1..7 for the piece id that settled there.

export const W = 10;
export const H = 20;

export const CLEAR_SCORE = [0, 100, 300, 500, 800];

/** [piece][rotation] = cells, normalised so min x is 0. */
export const SHAPES: Record<number, [number, number][][]> = {
  1: [
    // I
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
    [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
    ],
    [
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
    ],
    [
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
    ],
  ],
  2: [
    // O
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  ],
  3: [
    // T
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    [
      [1, 0],
      [1, 1],
      [2, 1],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 2],
    ],
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, 2],
    ],
  ],
  4: [
    // S
    [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ],
    [
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
    ],
    [
      [1, 1],
      [2, 1],
      [0, 2],
      [1, 2],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 2],
    ],
  ],
  5: [
    // Z
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
    [
      [2, 0],
      [1, 1],
      [2, 1],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 2],
    ],
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [0, 2],
    ],
  ],
  6: [
    // J
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    [
      [1, 0],
      [2, 0],
      [1, 1],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [2, 2],
    ],
    [
      [1, 0],
      [1, 1],
      [0, 2],
      [1, 2],
    ],
  ],
  7: [
    // L
    [
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    [
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [0, 2],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  ],
};

// Normalise every rotation to its own tight bounding box. Without this a
// vertical I keeps its column at x=2 inside a 3-wide box and can never reach
// columns 1 or 2 — the piece would sit one column right of where you clicked.
for (const rots of Object.values(SHAPES)) {
  for (const cellsOfRot of rots) {
    const minX = Math.min(...cellsOfRot.map((c) => c[0]));
    for (const cell of cellsOfRot) cell[0] -= minX;
  }
}

export type Move =
  | { type: 'drop'; col: number } // column click: slide to that column, then fall
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'down' } // one row, or lock if it cannot go further
  | { type: 'hard' } // fall as far as it can, then lock
  | { type: 'rot' }
  | { type: 'new'; seed: number };

/** What the renderer animates. Only ever describes the move that just happened. */
export type Anim =
  | { kind: 'drop'; piece: number; rot: number; x: number; y0: number; y1: number; cleared: number[] }
  | { kind: 'fall'; from: number }
  | { kind: 'move' }
  | { kind: 'new' }
  | { kind: 'over' };

export type State = {
  v: 1;
  /** run-length encoded board, 200 cells */
  b: string;
  /** current piece, 1..7 */
  p: number;
  /** current rotation, 0..3 */
  r: number;
  /** left edge of the falling piece */
  x: number;
  /** top edge of the falling piece */
  y: number;
  /** upcoming pieces, digits */
  q: string;
  /** how many bags have been shuffled so far (drives the PRNG) */
  bc: number;
  sd: number;
  sc: number;
  ln: number;
  mv: number;
  ov: boolean;
  an: Anim | null;
};

// ---------------------------------------------------------------- board codec

export function emptyBoard(): number[] {
  return new Array(W * H).fill(0);
}

export function encodeBoard(cells: number[]): string {
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let out = '';
    let run = cells[y * W];
    let n = 0;
    for (let x = 0; x < W; x++) {
      const c = cells[y * W + x];
      if (c === run) n++;
      else {
        out += n.toString(36) + run;
        run = c;
        n = 1;
      }
    }
    rows.push(out + n.toString(36) + run);
  }
  return rows.join('.');
}

export function decodeBoard(s: string): number[] {
  const rows = s.split('.');
  if (rows.length !== H) throw new Error('bad board rows');
  const cells: number[] = [];
  for (const row of rows) {
    let x = 0;
    for (const part of row.matchAll(/([0-9a-z])(\d)/g)) {
      const n = parseInt(part[1], 36);
      const v = Number(part[2]);
      for (let i = 0; i < n; i++) cells.push(v);
      x += n;
    }
    if (x !== W) throw new Error('bad board width');
  }
  if (cells.length !== W * H) throw new Error('bad board length');
  return cells;
}

// ---------------------------------------------------------------------- random

/** mulberry32 — deterministic, tiny, plenty for a bag shuffle. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleBag(seed: number, bag: number): number[] {
  const rnd = prng((seed * 2654435761) ^ (bag * 40503));
  const bag7 = [1, 2, 3, 4, 5, 6, 7];
  for (let i = bag7.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [bag7[i], bag7[j]] = [bag7[j], bag7[i]];
  }
  return bag7;
}

// ----------------------------------------------------------------------- rules

export function width(piece: number, rot: number): number {
  return Math.max(...SHAPES[piece][rot].map((c) => c[0])) + 1;
}

export function spawnX(piece: number, rot: number): number {
  return Math.floor((W - width(piece, rot)) / 2);
}

function fits(cells: number[], piece: number, rot: number, left: number, top: number): boolean {
  for (const [cx, cy] of SHAPES[piece][rot]) {
    const x = left + cx;
    const y = top + cy;
    if (x < 0 || x >= W || y >= H) return false;
    if (y >= 0 && cells[y * W + x] !== 0) return false;
  }
  return true;
}

function ensureQueue(s: State, need: number): void {
  while (s.q.length < need) {
    s.q += shuffleBag(s.sd, s.bc++).join('');
  }
}

export function newGame(seed: number): State {
  const s: State = {
    v: 1,
    b: encodeBoard(emptyBoard()),
    p: 0,
    r: 0,
    x: 0,
    y: 0,
    q: '',
    bc: 0,
    sd: seed,
    sc: 0,
    ln: 0,
    mv: 0,
    ov: false,
    an: { kind: 'new' },
  };
  ensureQueue(s, 8);
  s.p = Number(s.q[0]);
  s.r = 0;
  s.x = spawnX(s.p, s.r);
  s.y = 0;
  s.q = s.q.slice(1);
  return s;
}

/** The pieces still to come, as the renderer needs them. */
export function upcoming(s: State, n: number): number[] {
  return s.q.slice(0, n).split('').map(Number);
}

/** Where a hard drop would land, for the ghost piece. */
export function ghostY(s: State): number {
  const cells = decodeBoard(s.b);
  let y = s.y;
  while (fits(cells, s.p, s.r, s.x, y + 1)) y++;
  return y;
}

function spawnNext(s: State): void {
  ensureQueue(s, 8);
  s.p = Number(s.q[0]);
  s.r = 0;
  s.x = spawnX(s.p, s.r);
  s.y = 0;
  s.q = s.q.slice(1);
  s.mv++;
  const cells = decodeBoard(s.b);
  if (!fits(cells, s.p, s.r, s.x, s.y)) {
    s.ov = true;
    s.an = { kind: 'over' };
  }
}

/** Settle the falling piece, score whatever it completed, and deal the next one. */
function lockPiece(s: State, cells: number[], from: number): void {
  const piece = s.p;
  const rot = s.r;
  for (const [cx, cy] of SHAPES[piece][rot]) {
    cells[(s.y + cy) * W + s.x + cx] = piece;
  }

  // clear lines
  const kept: number[][] = [];
  const cleared: number[] = [];
  for (let y = 0; y < H; y++) {
    const row = cells.slice(y * W, y * W + W);
    if (row.every((c) => c !== 0)) cleared.push(y);
    else kept.push(row);
  }
  while (kept.length < H) kept.unshift(new Array(W).fill(0));
  s.b = encodeBoard(kept.flat());
  s.sc += CLEAR_SCORE[cleared.length] ?? 0;
  s.ln += cleared.length;

  const anim: Anim = { kind: 'drop', piece, rot, x: s.x, y0: from, y1: s.y, cleared };
  spawnNext(s);
  if (!s.ov) s.an = anim;
}

export function applyMove(state: State, move: Move): State {
  const s: State = JSON.parse(JSON.stringify(state));
  s.an = null;

  if (move.type === 'new') return newGame(move.seed);
  if (s.ov) return s;

  const cells = decodeBoard(s.b);

  // A piece that cannot stand where it is has nowhere to go: the stack reached
  // the top. Locking it there would overwrite settled cells.
  if (!fits(cells, s.p, s.r, s.x, s.y)) {
    s.ov = true;
    s.an = { kind: 'over' };
    return s;
  }

  if (move.type === 'rot') {
    const next = (s.r + 1) % 4;
    // Rotating in place first, then nudging one step either way, then two.
    for (const dx of [0, -1, 1, -2, 2]) {
      if (fits(cells, s.p, next, s.x + dx, s.y)) {
        s.r = next;
        s.x += dx;
        s.an = { kind: 'move' };
        return s;
      }
    }
    return s; // blocked: no-op, the board stays put
  }

  if (move.type === 'left' || move.type === 'right') {
    const nx = s.x + (move.type === 'left' ? -1 : 1);
    if (fits(cells, s.p, s.r, nx, s.y)) {
      s.x = nx;
      s.an = { kind: 'move' };
    }
    return s;
  }

  const from = s.y;

  if (move.type === 'down') {
    if (fits(cells, s.p, s.r, s.x, s.y + 1)) {
      s.y += 1;
      s.an = { kind: 'fall', from };
    } else {
      lockPiece(s, cells, from);
    }
    return s;
  }

  if (move.type === 'hard') {
    while (fits(cells, s.p, s.r, s.x, s.y + 1)) s.y++;
    lockPiece(s, cells, from);
    return s;
  }

  // Column click: slide the piece over that column, then let it fall.
  const col = Math.max(0, Math.min(W - 1, Math.floor(move.col)));
  const w = width(s.p, s.r);
  const target = Math.max(0, Math.min(W - w, col - Math.floor((w - 1) / 2)));
  if (fits(cells, s.p, s.r, target, s.y)) s.x = target;
  while (fits(cells, s.p, s.r, s.x, s.y + 1)) s.y++;
  lockPiece(s, cells, from);
  return s;
}

export function isValidState(s: unknown): s is State {
  if (!s || typeof s !== 'object') return false;
  const o = s as State;
  if (o.v !== 1) return false;
  if (typeof o.b !== 'string' || typeof o.q !== 'string') return false;
  if (!Number.isInteger(o.p) || o.p < 1 || o.p > 7) return false;
  if (!Number.isInteger(o.r) || o.r < 0 || o.r > 3) return false;
  if (!Number.isInteger(o.x) || o.x < 0 || o.x >= W) return false;
  if (!Number.isInteger(o.y) || o.y < 0 || o.y >= H) return false;
  if (!Number.isInteger(o.sc) || o.sc < 0 || o.sc > 10_000_000) return false;
  if (!Number.isInteger(o.ln) || o.ln < 0 || o.ln > 100_000) return false;
  if (!Number.isInteger(o.mv) || o.mv < 0) return false;
  if (!Number.isInteger(o.sd)) return false;
  if (!Number.isInteger(o.bc) || o.bc < 0) return false;
  try {
    decodeBoard(o.b);
  } catch {
    return false;
  }
  return true;
}
