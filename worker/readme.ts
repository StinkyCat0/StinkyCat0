// Only the block between the markers belongs to the bot. Everything outside
// them — the profile owner's text — is copied through byte for byte. If the
// markers are missing, the worker refuses to write rather than guess.
//
// Two views of the block:
//   attract — the bot's looping game, plus one button to take over
//   play    — a live board, a three-row pad, and a way back to the bot

import type { State } from '../game/engine.ts';
import { encodeState } from '../game/state.ts';

export const BLOCK_START = '<!-- tetris:start -->';
export const BLOCK_END = '<!-- tetris:end -->';

const PAYLOAD_RE = /\/b\/([A-Za-z0-9_-]+)\.svg/;

function blockScope(readme: string): string {
  const start = readme.indexOf(BLOCK_START);
  const end = readme.indexOf(BLOCK_END);
  return start >= 0 && end > start ? readme.slice(start, end) : readme;
}

export function extractStatePayload(readme: string): string | null {
  const m = blockScope(readme).match(PAYLOAD_RE);
  return m ? m[1] : null;
}

/** Replace only the marked block, leaving every other byte alone.
 *  Returns null when the README has no markers — callers must not write then. */
export function spliceBlock(readme: string, block: string): string | null {
  const start = readme.indexOf(BLOCK_START);
  const end = readme.indexOf(BLOCK_END);
  if (start < 0 || end <= start) return null;
  return readme.slice(0, start + BLOCK_START.length) + '\n' + block + '\n' + readme.slice(end);
}

/** A README that has no owner text yet: just the markers and the block. */
export function emptyReadme(block: string): string {
  return `${BLOCK_START}\n${block}\n${BLOCK_END}\n`;
}

/** stable URL for the committed attract loop, relative to the README */
const ATTRACT_SRC = 'attract.svg';

function pill(href: string, label: string, title: string): string {
  return `<a href="${href}" title="${title}"><code>${label}</code></a>`;
}

/** The bot playing by itself. No state, no clicks, no reloads, no way in. */
export function buildAttract(): string {
  return (
    `<p align="center"><img src="${ATTRACT_SRC}" width="200" ` +
    `alt="A bot playing Tetris on its own, looping"></p>`
  );
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

export function buildReadme(state: State, base: string, profile: string): string {
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

  return `${board}\n\n${controls}`;
}
