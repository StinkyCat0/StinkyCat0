// The profile README is generated, never hand-edited. The copy comes from
// README.template.md in the repo; the board and the keypad are injected here.

import type { State } from '../game/engine.ts';
import { encodeState } from '../game/state.ts';

const PAYLOAD_RE = /\/b\/([A-Za-z0-9_-]+)\.svg/;

export function extractStatePayload(readme: string): string | null {
  const m = readme.match(PAYLOAD_RE);
  return m ? m[1] : null;
}

function keypad(base: string, over: boolean): string {
  if (over) {
    return (
      `<p align="center"><a href="${base}/n" title="deal a fresh board"><code>new game ⟳</code></a></p>`
    );
  }
  const cell = (col: number) =>
    `<td align="center"><a href="${base}/m?c=${col}" title="drop the piece in column ${col + 1}"><code>${col + 1}</code></a></td>`;
  const row = (from: number) => `<tr>${[0, 1, 2, 3, 4].map((i) => cell(from + i)).join('')}</tr>`;
  return (
    `<p align="center"><sub>click a number to drop the piece · ↻ rotates it</sub></p>\n` +
    `<p align="center"><a href="${base}/r" title="rotate the falling piece"><code>↻ rotate</code></a></p>\n` +
    `<table align="center"><tbody>${row(0)}${row(5)}</tbody></table>`
  );
}

export function buildReadme(template: string, state: State, base: string, profile: string): string {
  const payload = encodeState(state);
  const board =
    `<p align="center"><a href="${profile}#board"><img src="${base}/b/${payload}.svg" width="264" ` +
    `alt="A game of Tetris — ${state.ln} lines, ${state.sc} points. Click a number below the board to drop the piece."></a></p>`;

  const controls = keypad(base, state.ov);

  return template
    .replace('{{BOARD}}', board)
    .replace('{{CONTROLS}}', controls)
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
    .concat('\n');
}
