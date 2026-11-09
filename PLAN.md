# PLAN — a playable Tetris at the top of the profile

## What this is

A real, playable Tetris in the profile README of github.com/StinkyCat0, sitting at the
top of the profile page. Visitors click to place pieces. No JavaScript runs in a README,
so "playable" is built out of links, images and a small edge function.

## The constraint that shapes everything

GitHub sanitizes README markdown. `style`, `onclick`, `<script>`, `<iframe>` are stripped:

    gh api /markdown -f mode=gfm -f text='<div onclick="x()" style="color:red">A</div>'

Only links, images, tables (`<pre>`, `<details>`, `<picture>`) survive. There is exactly
one input channel: the visitor clicks a link. The only carrier of intent is the URL.

So every move is:

    click a column link  ->  edge function  ->  commit new README  ->  302 back to profile

The profile page reloads and the new board is there. A page reload per move is the ceiling
in a README; the goal is to make the round trip small enough that it reads as deliberate
rather than broken. Target: under ~2s from click to new board.

## Architecture

    README.md (top of profile)
      <img src="https://tetris.<zone>/b/<hash>.svg">     <- board, content-addressed
      | [<](rotate) [1][2][3][4][5][6][7][8][9][10] |   <- drop links, carry state
                |
                v
    Cloudflare Worker
      - decodes game state from the link (HMAC-signed, so scores can't be forged)
      - applies the move: rotate, or drop in column N
      - renders board SVG at /b/<hash>.svg  (cache-friendly: URL changes with state)
      - commits the new README.md via GitHub Contents API (sha-checked, retried)
      - 302 -> github.com/StinkyCat0

### Why the state lives in the links

The README has to be rewritten on every move anyway (the board image name changes), so
there is no reason to keep a database. Each link carries the post-move state, signed.
Consequences:

- worker is stateless: no KV, no lock table, nothing to desync
- the repo is the whole game: `README.md` + the SVG files are the audit log
- no stale-read race: the Contents API update is sha-guarded, conflicts retry from the
  fresh README

### Why content-addressed images

GitHub proxies every README image through camo, which caches aggressively. A fixed URL
like `/b/board.svg` would keep showing the old board. Naming the image after the state
hash means a new move is always a new URL, so camo can never serve a stale board — and
since the hash implies immutable content, caching is free.

## Move model (one click per piece)

- Board renders: settled stack + the falling piece at spawn + score/lines.
- A control row under the well: `rotate` plus ten column targets.
- Click a column: the piece slides to that column and drops. One click per piece.
- Click rotate: the piece rotates one step and the board re-renders; then click a column.
  That mirrors real keypresses (rotate, then place), it just costs a reload.

## Rules

- 10x20 well, 7-bag randomiser, fixed seed per game.
- 4 rotation states (SRS piece shapes, no wall kicks needed since the piece only moves
  by explicit column choice).
- Line clear, gravity is "one piece at a time" (no timer: nothing runs between clicks).
- Game over when a spawned piece cannot be placed; board shows the run result and a
  `new game` link.

## Repo layout

    README.md            the profile itself (rewritten by the worker each move)
    board/<hash>.svg     the rendered boards (append-only game log)
    game/engine.ts       tetris rules, pure and tested
    game/render.ts       state -> SVG (terminal styling, SMIL drop + line-clear flash)
    game/state.ts        encode/decode state, HMAC signing
    worker/index.ts      Cloudflare Worker entry (routing, GitHub commit, redirects)
    worker/README.md     deploy steps, secrets
    test/               engine + render + state tests (node:test)

## Latency budget per move

    worker cold start        ~0-40ms   (edge)
    Contents API commit      ~300-800ms
    302 + profile load       ~400-900ms
    camo fetch of new SVG    ~200-500ms (new URL, uncached once)
    -------------------------------------
    total                    ~1-2s

## Guards

- Every move is HMAC-signed; a forged state (fake score) is rejected with a friendly page.
- Column must be 0-9 and the reverse move must be legal, else no-op redirect.
- Rate limit per IP (short window) and a global in-flight guard, so a script can't burn
  the PAT's API quota or shotgun 500 commits.
- If the GitHub call fails, redirect back to the profile with a `#log` note instead of
  leaving the visitor on an error page.

## Open questions

- Hosting: Cloudflare Worker (planned) vs Vercel function.
- Look: CRT green phosphor vs the site's obsidian/blue palette vs clean modern.
- Profile copy: what the README says besides the game.
