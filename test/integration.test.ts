// End to end, against a fake GitHub API: click the way a visitor clicks, then
// read back what the profile would render.
import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../worker/index.ts';
import { buildAttract } from '../worker/readme.ts';
import { decodeState } from '../game/state.ts';

const enc = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const dec = (s: string) => Buffer.from(s.replace(/\n/g, ''), 'base64').toString('utf8');

type Store = Map<string, { content: string; sha: string }>;
let store: Store = new Map();
let putCount = 0;
let failNextPutWith409 = false;

function shaFor(n: number): string {
  return n.toString(16).padStart(40, 'a');
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.github.com') return realFetch(input as never, init);

  const path = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, '');
  if (init?.method === 'PUT') {
    putCount++;
    if (failNextPutWith409) {
      failNextPutWith409 = false;
      return new Response(JSON.stringify({ message: 'conflict' }), { status: 409 });
    }
    const body = JSON.parse(String(init.body)) as { content: string; sha?: string };
    const existing = store.get(path);
    if (body.sha && existing && body.sha !== existing.sha) {
      return new Response(JSON.stringify({ message: 'conflict' }), { status: 409 });
    }
    store.set(path, { content: dec(body.content), sha: shaFor(putCount) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const file = store.get(path);
  if (!file) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  return new Response(JSON.stringify({ content: enc(file.content), sha: file.sha }), { status: 200 });
}) as typeof fetch;

const env = {
  GITHUB_TOKEN: 'test-token',
  GITHUB_REPO: 'owner/repo',
  PROFILE_URL: 'https://github.com/owner',
};

const ownerText =
  "my name is antwizzle welcome to my stinky palace, here's some 40L for your enjoyment check out my repos below!\n\nhmu!\n";
const seedReadme =
  `<!-- tetris:start -->\n${buildAttract()}\n<!-- tetris:end -->\n${ownerText}`;

function seedRepo(): void {
  store = new Map([['README.md', { content: seedReadme, sha: shaFor(0) }]]);
  putCount = 0;
}

let ipc = 0;
async function visit(path: string): Promise<Response> {
  ipc++;
  const req = new Request(`https://tetris.test${path}`, {
    headers: { 'cf-connecting-ip': `10.0.0.${ipc % 250}` },
  });
  return worker.fetch(req, env as never);
}

async function readme(): Promise<string> {
  const res = await visit('/does-not-exist');
  void res;
  const file = store.get('README.md');
  assert.ok(file, 'README should exist after a move');
  return file.content;
}

function payloadOf(md: string): string {
  const m = md.match(/\/b\/([A-Za-z0-9_-]+)\.svg/);
  assert.ok(m, 'README should reference a board image');
  return m[1];
}

test('a first click starts a game and commits the README', async () => {
  seedRepo();
  const res = await visit('/m?c=4');
  assert.equal(res.status, 302);
  const loc = res.headers.get('location') ?? '';
  assert.ok(loc.startsWith(env.PROFILE_URL), 'sends the visitor back to the profile');
  assert.match(loc, /\?b=\d+$/, 'with a cache-busting query so the new board is not a stale page');

  const md = await readme();
  assert.ok(md.endsWith(`<!-- tetris:end -->\n${ownerText}`), 'owner text outside the markers is untouched');
  assert.ok(md.includes('<table align="center">'), 'the keypad is there');
  assert.equal((md.match(/\/m\?c=/g) ?? []).length, 10, 'ten columns');
  assert.ok(md.includes('/k?k=u'), 'the rotate key is on the pad');
  assert.ok(md.includes('/k?k=s'), 'the slam key is on the pad');
});

test('play and attract writes never touch text outside the markers', async () => {
  seedRepo();
  const suffix = `<!-- tetris:end -->\n${ownerText}`;
  await visit('/n');
  assert.ok((await readme()).endsWith(suffix), 'new game');
  await visit('/m?c=4');
  assert.ok((await readme()).endsWith(suffix), 'move');
  await visit('/w');
  assert.ok((await readme()).endsWith(suffix), 'watch the bot');
  await visit('/p');
  assert.ok((await readme()).endsWith(suffix), 'take over');
});

test('a README with no markers is left alone, not rewritten', async () => {
  store = new Map([['README.md', { content: ownerText, sha: shaFor(0) }]]);
  putCount = 0;
  const res = await visit('/m?c=4');
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('did not land'));
  assert.equal(store.get('README.md')!.content, ownerText);
  assert.equal(putCount, 0, 'no write was attempted');
});

test('a scheduled reset on an already-attracted board writes nothing', async () => {
  seedRepo();
  const before = store.get('README.md')!.content;
  const res = await visit('/w?if=over');
  assert.equal(res.status, 302);
  assert.equal(store.get('README.md')!.content, before);
  assert.equal(putCount, 0, 'no no-op commit');
});

test('the board image renders and changes with every move', async () => {
  seedRepo();
  await visit('/m?c=2');
  const first = payloadOf(await readme());
  const svg1 = await (await visit(`/b/${first}.svg`)).text();
  assert.ok(svg1.startsWith('<svg'));

  await visit('/m?c=7');
  const second = payloadOf(await readme());
  const svg2 = await (await visit(`/b/${second}.svg`)).text();
  assert.notEqual(second, first, 'a new board is a new URL, so the cache cannot lie');
  assert.notEqual(svg2, svg1);
  assert.ok(svg2.includes('animateTransform'), 'the drop animates on load');
});

test('rotate then drop is two clicks and one piece', async () => {
  seedRepo();
  await visit('/n');
  await visit('/m?c=3');
  const before = payloadOf(await readme());
  const rot = await visit('/r');
  assert.equal(rot.status, 302);
  const after = payloadOf(await readme());
  assert.notEqual(after, before);
  const svg = await (await visit(`/b/${after}.svg`)).text();
  assert.ok(svg.includes('viewBox'));
});

test('six hundred moves of real play stay coherent', async () => {
  seedRepo();
  await visit('/n');
  let last = '';
  for (let i = 0; i < 600; i++) {
    const res = await visit(`/m?c=${(i * 3 + 1) % 10}`);
    assert.equal(res.status, 302);
    const md = await readme();
    const p = payloadOf(md);
    assert.notEqual(p, last);
    last = p;
    const svg = await (await visit(`/b/${p}.svg`)).text();
    assert.ok(!svg.includes('NaN'));
    if (md.includes('/n')) {
      // game over: the pad is replaced by play-again and watch-the-bot
      assert.ok(md.includes('play again'));
      await visit('/n');
    }
  }
});

test('a lost race is retried from the fresh board, not dropped', async () => {
  seedRepo();
  await visit('/n');
  const before = store.get('README.md')!.content;
  failNextPutWith409 = true;
  const res = await visit('/m?c=1');
  assert.equal(res.status, 302);
  const after = store.get('README.md')!.content;
  assert.notEqual(after, before, 'the move still landed');
  assert.ok(after.includes('/m?c='), 'the board is still playable');
});

test('two clicks at once both land', async () => {
  seedRepo();
  await visit('/n');
  const start = payloadOf(store.get('README.md')!.content);
  const [a, b] = await Promise.all([visit('/m?c=0'), visit('/m?c=9')]);
  assert.equal(a.status, 302);
  assert.equal(b.status, 302);
  const end = payloadOf(store.get('README.md')!.content);
  assert.notEqual(end, start);
  assert.ok(putCount >= 3, 'the winner retried rather than dropping a move');
});

test('a bot gets throttled instead of spamming commits', async () => {
  seedRepo();
  const req = () => new Request('https://tetris.test/m?c=1', { headers: { 'cf-connecting-ip': '9.9.9.9' } });
  let blocked = false;
  for (let i = 0; i < 40; i++) {
    const res = await worker.fetch(req(), env as never);
    if (res.status === 200) {
      const body = await res.text();
      if (body.includes('slow down')) {
        blocked = true;
        break;
      }
    }
  }
  assert.ok(blocked, 'the throttle should engage');
});

test('a broken board payload is a clean 404', async () => {
  seedRepo();
  const res = await visit('/b/notastate.svg');
  assert.equal(res.status, 404);
});

test('the board starts as the bot playing itself, with no way in', async () => {
  seedRepo();
  const res = await visit('/w');
  assert.equal(res.status, 302);
  const md = await readme();
  assert.ok(md.includes('attract.svg'), 'the looping bot game is on the profile');
  assert.ok(!md.includes('/p"'), 'no way to take the board over from the profile');
  assert.ok(!md.includes('board is shared'), 'no tagline inviting a takeover');
  assert.ok(!md.includes('/b/'), 'no live board image while the bot plays');
});

test('let me play deals a fresh board with the whole pad', async () => {
  seedRepo();
  await visit('/w');
  assert.equal((await visit('/p')).status, 302);
  const md = await readme();
  assert.ok(md.includes('/b/'), 'a live board now');
  for (const k of ['l', 'r', 'u', 'd', 's']) assert.ok(md.includes(`/k?k=${k}`), `key ${k}`);
  assert.equal((md.match(/\/m\?c=/g) ?? []).length, 10, 'ten columns');
  assert.ok(md.includes('/w'), 'a way back to the bot is always there, mid-game too');
  const state = decodeState(payloadOf(md));
  assert.ok(state && !state.ov);
  assert.equal(state.mv, 0, 'a clean board');
});

test('a pad key moves the piece without dealing a new one', async () => {
  seedRepo();
  await visit('/p');
  const before = decodeState(payloadOf(await readme()));
  assert.equal((await visit('/k?k=l')).status, 302);
  const after = decodeState(payloadOf(await readme()));
  assert.ok(before && after);
  assert.equal(after.mv, before.mv, 'same piece');
  assert.notEqual(after.x, before.x, 'it moved one column');
});

test('a finished game offers play again and watch the bot', async () => {
  seedRepo();
  await visit('/p');
  for (let i = 0; i < 300; i++) {
    const s = decodeState(payloadOf(store.get('README.md')!.content));
    if (s?.ov) break;
    await visit('/m?c=0');
  }
  const md = await readme();
  assert.ok(md.includes('run over'), 'the result is on the page');
  assert.ok(md.includes('/n'), 'play again');
  assert.ok(md.includes('/w'), 'watch the bot');
});

test('the scheduled reset leaves a live game alone', async () => {
  seedRepo();
  await visit('/p');
  await visit('/m?c=4');
  const before = await readme();
  await visit('/w?if=over');
  assert.equal(await readme(), before, 'a game in progress is not wiped');
});

test('watch the bot takes the board back', async () => {
  seedRepo();
  await visit('/p');
  await visit('/m?c=2');
  await visit('/w');
  const md = await readme();
  assert.ok(md.includes('attract.svg'));
  assert.ok(!md.includes('/b/'));
});
