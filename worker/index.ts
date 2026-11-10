// The whole server: apply a move, replace the bot's marked block in README.md,
// send the visitor back to the profile. The board lives in that block (as the
// image URL), so this worker keeps no state of its own — and a lost update is
// just a retry. Text outside the markers is never written.

import { applyMove, newGame } from '../game/engine.ts';
import type { Move, State } from '../game/engine.ts';
import { renderBoard } from '../game/render.ts';
import { decodeState, randomSeed } from '../game/state.ts';
import { buildAttract, buildReadme, emptyReadme, extractStatePayload, spliceBlock } from './readme.ts';

interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string; // "owner/repo"
  PROFILE_URL: string; // "https://github.com/owner"
}

const API = 'https://api.github.com';
const BOT = { name: 'tetris', email: 'tetris@users.noreply.github.com' };

function ghHeaders(env: Env): HeadersInit {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'stinky-tetris',
    'content-type': 'application/json',
  };
}

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64decode(data: string): string {
  const bin = atob(data.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

type RepoFile = { text: string; sha: string };

async function getFile(env: Env, path: string): Promise<RepoFile | null> {
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/contents/${path}`, {
    headers: ghHeaders(env),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`read ${path}: ${res.status}`);
  const json = (await res.json()) as { content: string; sha: string };
  return { text: b64decode(json.content), sha: json.sha };
}

async function putFile(
  env: Env,
  path: string,
  text: string,
  sha: string | null,
  message: string,
): Promise<boolean> {
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: ghHeaders(env),
    body: JSON.stringify({
      message,
      content: b64encode(text),
      ...(sha ? { sha } : {}),
      committer: BOT,
      author: BOT,
    }),
  });
  // 409: someone else's move landed between our read and our write.
  if (res.status === 409) return false;
  if (!res.ok) throw new Error(`write ${path}: ${res.status} ${await res.text()}`);
  return true;
}

function describe(move: Move, next: State): string {
  if (move.type === 'new') return 'tetris: new game';
  if (move.type === 'rot') return `tetris: rotate ${next.p}`;
  if (move.type === 'drop') return `tetris: drop in column ${Math.floor(move.col) + 1}`;
  if (move.type === 'hard') return 'tetris: hard drop';
  if (move.type === 'down') return 'tetris: soft drop';
  return `tetris: nudge ${move.type}`;
}

/**
 * Read the current board out of the README, apply the move, write it back.
 * Retries when the write loses a race, always from the freshly read board.
 */
async function play(env: Env, move: Move, base: string): Promise<State | null> {
  let last: State | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const readme = await getFile(env, 'README.md');
    const payload = readme ? extractStatePayload(readme.text) : null;
    const prev = (payload && decodeState(payload)) || newGame(randomSeed());
    const next = applyMove(prev, move);
    const block = buildReadme(next, base, env.PROFILE_URL);
    const body = readme ? spliceBlock(readme.text, block) : emptyReadme(block);
    // No markers means this is not a README the bot owns. Refuse to write
    // rather than replace the owner's text.
    if (body === null) throw new Error('README.md has no tetris markers');
    if (await putFile(env, 'README.md', body, readme?.sha ?? null, describe(move, next))) {
      return next;
    }
    last = next;
    await new Promise((r) => setTimeout(r, 90 + attempt * 140));
  }
  return last;
}

// Best-effort per-isolate throttle. Cloudflare's WAF is the real guard; this
// just stops one tab from machine-gunning commits.
const hits = new Map<string, number[]>();
function allow(ip: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title>` +
      `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#040907;color:#b8ffcd;font:14px/1.6 ui-monospace,Menlo,monospace;text-align:center">` +
      `<div style="padding:32px">${body}</div></body>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

/** Back to the profile. The query string beats the profile page's CDN cache:
 *  a move that lands but reloads an old page reads as a dead click. */
function bounce(env: Env, moves: number): Response {
  return Response.redirect(`${env.PROFILE_URL}?b=${moves}`, 302);
}

/** Hand the board back to the bot. With onlyIfOver, a live human game is left alone. */
async function toAttract(env: Env, onlyIfOver: boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const readme = await getFile(env, 'README.md');
    if (!readme) return false;
    const payload = extractStatePayload(readme.text);
    const state = payload ? decodeState(payload) : null;
    if (onlyIfOver && state && !state.ov) return false;
    const body = spliceBlock(readme.text, buildAttract());
    if (body === null) return false;
    if (body === readme.text) return true;
    if (await putFile(env, 'README.md', body, readme.sha, 'tetris: back to the attract loop')) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 110));
  }
  return false;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/health') return new Response('ok');

    // The board image. Content-addressed: the payload IS the board, so the URL
    // never has to change meaning and GitHub's image cache can keep it forever.
    if (path.startsWith('/b/') && path.endsWith('.svg')) {
      const state = decodeState(path.slice(3, -4));
      if (!state) return new Response('bad board', { status: 404 });
      return new Response(renderBoard(state), {
        headers: {
          'content-type': 'image/svg+xml; charset=utf-8',
          'cache-control': 'public, max-age=31536000, immutable',
          'access-control-allow-origin': '*',
        },
      });
    }

    if (path === '/m' || path === '/r' || path === '/n' || path === '/k') {
      const ip = request.headers.get('cf-connecting-ip') ?? 'anon';
      if (!allow(ip)) {
        return page(
          'slow down',
          `<p>that is a lot of tetris.</p><p><a href="${env.PROFILE_URL}" style="color:#8ef7ac">back to the board</a></p>`,
        );
      }

      // The pad's five keys are just moves; /m is the column click and /n a
      // fresh deal, so a stale page can never replay a move into a wrong board.
      const KEYS: Record<string, Move> = {
        l: { type: 'left' },
        r: { type: 'right' },
        u: { type: 'rot' },
        d: { type: 'down' },
        s: { type: 'hard' },
      };
      const move: Move =
        path === '/m'
          ? { type: 'drop', col: Number(url.searchParams.get('c') ?? '0') }
          : path === '/r'
            ? { type: 'rot' }
            : path === '/n'
              ? { type: 'new', seed: randomSeed() }
              : (KEYS[url.searchParams.get('k') ?? 'd'] ?? KEYS.d);

      if (move.type === 'drop' && !(Number.isFinite(move.col) && move.col >= 0 && move.col <= 9)) {
        return Response.redirect(env.PROFILE_URL, 302);
      }

      try {
        const next = await play(env, move, url.origin);
        if (!next) throw new Error('no write landed');
        return bounce(env, next.mv);
      } catch (err) {
        console.error('play failed', err);
        return page(
          'that move did not land',
          `<p>the board is still where you left it.</p>` +
            `<p><a href="${env.PROFILE_URL}" style="color:#8ef7ac">back to the board</a></p>`,
        );
      }
    }

    // Take over from the bot: a fresh board, yours.
    if (path === '/p') {
      if (!allow(request.headers.get('cf-connecting-ip') ?? 'anon')) {
        return page('slow down', `<p><a href="${env.PROFILE_URL}" style="color:#8ef7ac">back to the board</a></p>`);
      }
      try {
        const next = await play(env, { type: 'new', seed: randomSeed() }, url.origin);
        if (!next) throw new Error('no write landed');
        return bounce(env, next.mv);
      } catch (err) {
        console.error('start failed', err);
        return page('could not start a game', `<p><a href="${env.PROFILE_URL}" style="color:#8ef7ac">back to the board</a></p>`);
      }
    }

    // Hand the board back to the bot. ?if=over makes it a no-op unless the
    // game is finished, which is what the scheduled reset uses.
    if (path === '/w') {
      try {
        await toAttract(env, url.searchParams.get('if') === 'over');
      } catch (err) {
        console.error('attract failed', err);
      }
      return bounce(env, 0);
    }

    if (path === '/') return Response.redirect(env.PROFILE_URL, 302);
    return new Response('not found', { status: 404 });
  },
};
