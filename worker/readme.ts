// The profile README is generated, never hand-edited. The copy comes from
// README.template.md in the repo; the board and the controls are injected here.
//
// Two views:
//   attract — the bot's looping game, plus one button to take over
//   play    — a live board, a three-row pad, and a way back to the bot

import type { State } from '../game/engine.ts';
import { encodeState } from '../game/state.ts';

const PAYLOAD_RE = /\/b\/([A-Za-z0-9_-]+)\.svg/;

export function extractStatePayload(readme: string): string | null {
  const m = readme.match(PAYLOAD_RE);
  return m ? m[1] : null;
}

/** stable URL for the committed attract loop, relative to the README */
const ATTRACT_SRC = 'attract.svg';

function pill(href: string, label: string, title: string): string {
  return `<a href="${href}" title="${title}"><code>${label}</code></a>`;
}

function fill(template: string, board: string, controls: string): string {
  return template
    .replace('{{BOARD}}', board)
    .replace('{{CONTROLS}}', controls)
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
    .concat('\n');
}

/** The bot playing by itself. No state, no clicks, no reloads, no way in. */
export function buildAttract(template: string, profile: string): string {
  const board =
    `<p align="center"><img src="${ATTRACT_SRC}" width="200" ` +
    `alt="A bot playing Tetris on its own, looping"></p>`;
  return fill(template, board, '').replaceAll('${PROFILE}', profile);
}

function pad(base: string): string {
  const key = (k: string, label: string, title: string) =>
    `<td align="center">${pill(`${base}/k?k=${k}`, label, title)}</td>`;
  const col = (c: number) =>
    `<td align="center">${pill(`${base}/m?c=${c}`, String(c + 1), `drop the piece in column ${c + 1}`)}</td>`;

  const keys = [0, 1, 2, 3, 4]
    .map((i) =>
      key(
        ['l', 'r', 'u', 'd', 's'][i],
        ['◀', '▶', '↻', '▼', '⤓'][i],
        ['move left', 'move right', 'rotate', 'down one row', 'slam it down'][i],
      ),
    )
    .join('');
  const cols = (from: number) => `<tr>${[0, 1, 2, 3, 4].map((i) => col(from + i)).join('')}</tr>`;

  return (
    `<p align="center"><sub>click a number to drop there · ◀ ▶ move · ↻ rotate · ▼ down · ⤓ slam</sub></p>\n` +
    `<table align="center"><tbody><tr>${keys}</tr>${cols(0)}${cols(5)}</tbody></table>`
  );
}

export function buildReadme(template: string, state: State, base: string, profile: string): string {
  const payload = encodeState(state);
  const board =
    `<p align="center"><a href="${profile}#board"><img src="${base}/b/${payload}.svg" width="300" ` +
    `alt="A game of Tetris — ${state.ln} lines, ${state.sc} points. Click a number below the board to drop the piece."></a></p>`;

  const controls = state.ov
    ? `<p align="center"><sub>run over — ${state.ln} lines, ${state.sc} points.</sub></p>\n` +
      `<p align="center">${pill(`${base}/n`, '▶ play again', 'deal a fresh board')} · ` +
      `${pill(`${base}/w`, '◀ watch the bot', 'hand the board back to the bot')}</p>`
    : pad(base) +
      `\n<p align="center">${pill(`${base}/w`, '◀ watch the bot', 'hand the board back to the bot')}</p>`;

  return fill(template, board, controls);
}
