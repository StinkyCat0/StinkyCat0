// End to end, against a fake GitHub API: click the way a visitor clicks, then
// read back what the profile would render.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import worker from '../worker/index.ts';

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

const template = readFileSync(new URL('../README.template.md', import.meta.url), 'utf8');

function seedRepo(): void {
  store = new Map([['README.template.md', { content: template, sha: shaFor(0) }]]);
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
  assert.equal(res.headers.get('location'), env.PROFILE_URL);

  const md = await readme();
  assert.ok(md.includes('welcome to the stinkiest place'));
  assert.ok(md.includes('My name is Antonio Devine'));
  assert.ok(md.includes('<table align="center">'), 'the keypad is there');
  assert.equal((md.match(/\/m\?c=/g) ?? []).length, 10, 'ten columns');
  assert.ok(md.includes('/r'), 'the rotate control is there');
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
      // game over: the keypad is replaced by a new-game link, then start again
      assert.ok(md.includes('new game'));
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
