# PLAN — a playable Tetris at the top of the profile

## What this is

A real, playable Tetris in the profile README of github.com/StinkyCat0, sitting at the
top of the profile page. Visitors click to place pieces. No JavaScript runs in a README,
so "playable" is built out of links, images and a small edge function.

Live worker: https://stinky-tetris.antonio-devine111.workers.dev

## The constraint that shapes everything

GitHub sanitizes README markdown. `style`, `onclick`, `<script>`, `<iframe>` are stripped:

    gh api /markdown -f mode=gfm -f text='<div onclick="x()" style="color:red">A</div>'

Only links, images, tables (`<pre>`, `<details>`, `<picture>`) survive. There is exactly
one input channel: the visitor clicks a link. The only carrier of intent is the URL.

So every move is:

    click a column link  ->  edge function  ->  commit new README  ->  302 back to profile

A page reload per move is the ceiling in a README. Measured on the live worker: ~1.0-1.6s
inside the worker (one GitHub read, one write), ~2.2s including the profile page load.

## Architecture

    README.md (top of profile)
      <img src="https://tetris.<zone>/b/<state>.svg">      <- board, content-addressed
      [rotate]  [1][2][3][4][5] / [6][7][8][9][10]         <- drop links, no state needed
                |
                v
    Cloudflare Worker
      - reads README.md from GitHub: it holds the current board
      - applies the move, replaces only the <!-- tetris:start --> block, commits it
        with a sha guard; text outside the markers is never written
      - serves /b/<state>.svg for any state, forever, immutable
      - 302 -> github.com/StinkyCat0?b=<moves>  (the query defeats the page's CDN cache)

### The README is the database

The board image URL carries the whole game as base64url state. The worker reads the current
state out of the marked block, applies the move, and rewrites only that block. Nothing else
is stored.

- no database, no KV, nothing to desync; the commit history is the game log
- the keypad links are static (`?c=0..9`, `/r`, `/n`), so a stale page cannot replay a move
  against a board it does not belong to: the move is applied to whatever the README says
- two clicks at once: the loser of the sha-guarded write re-reads the new board and retries,
  so both land in order instead of one being eaten

### Why the board image is content-addressed

GitHub proxies every README image through camo, which caches hard. A fixed URL
(`/b/board.svg`) would keep serving the first board. Naming the image after the state means
every move is a new URL, so camo can never hand back a stale board — and since the state
implies the bytes, caching it forever is free and correct.

## Move model

There are two views of the same profile, decided by whether the README carries a board:

**attract** — the bot plays itself. `attract.svg` is a looping SMIL animation of a
real 40-line sprint (a greedy height/holes/bumpiness bot): it plays until it clears
40 lines, showing a progress bar toward 40L and an elapsed timer in the HUD, then the
loop restarts on a fresh board. No state, no requests, no reloads. One button:
`▶ let me play`. The settled stack is emitted once, as per-cell opacity windows, so the
file grows with moves rather than with frames x cells; each piece is drawn at its spawn
row and translated down, so no frame — and no paused animation — paints a block at its
landing spot before it drops.

**play** — a live board for the human.

- Click a **number** to slide the piece over that column and drop it: one click per piece.
- Or use the five-key pad, which is the arrow-key scheme spelled as clicks:
  `◀ ▶` nudge a column, `↻` rotate, `▼` down one row, `⤓` slam it to the floor.
  A ghost piece shows where the slam would land.
- Game over: the well dims with the run's lines and points, and the page offers
  `▶ play again` and `◀ watch the bot`. Mid-game, the same `◀ watch the bot` link sits
  under the pad, so you can hand the board back at any time. A scheduled workflow pings
  `/w?if=over` every six hours, so a finished game can never sit on the profile overnight.

Keys cannot be real: a README runs no JavaScript, so no element can receive a keypress,
and every click is a page load (~1.5s). The pad is honest about that — each key is one
reload, which is why the column click stays the fast path.

## Decisions

- Hosting: Cloudflare Worker (free tier, edge, nothing to babysit).
- Look: CRT terminal — phosphor green on near-black, scanlines, seven tints of green, glow.
- Controls: column click + rotate, two rows of five. Ten cells in one row measured 320px
  against a 293px phone container; five cells at 44px fits even a 320px screen.
- No JavaScript, no iframe, no stylesheet: none of those survive a README.

## What production taught us

- **The profile page has its own CDN cache.** A move could land and the visitor would still
  reload the old page, which reads as a dead click. The redirect now carries `?b=<moves>`,
  enough to miss the cached entry. Verified: the cache-busted page has the new board.
- **Rotation must be normalised to each piece's own bounding box.** A vertical I keeps its
  column at x=2 inside a 3-wide box, so it could never reach columns 1 and 2. Caught by a
  line-clear test, not by looking at it.
- Rasterising the SVG and checking pixels is the only way to verify it without eyes: spawn
  piece lands in rows 0-1, a cleared line shifts the stack down exactly one row, nothing
  bleeds outside the canvas.

## Cost and guards

- One commit per move, one read plus one write, one invocation, no storage.
- Per-isolate throttle, 20 moves per IP per minute, best effort. A real limit belongs in a
  Cloudflare WAF rule on `/m`, `/r`, `/n`.
- If the GitHub write fails the visitor gets a small page linking back, not an error dump.

## Open

- Per-visitor games are not possible: readme links are static, so everyone plays the same
  board. Same model as the chess and shogi readmes — for a stacking game it means strangers
  inherit your mess. Fine, or a feature, depending on the day.
- A KV fast path could skip the README read (~300ms) and fall back to the slow path on a
  409. Not worth the duplicated state yet.
