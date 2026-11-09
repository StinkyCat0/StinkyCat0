# worker

The edge function behind every click on the board. One request per move:

    /p          let me play: deal a fresh board for the human
    /w          watch the bot: hand the board back to the attract loop
                (?if=over makes it a no-op unless the game is finished)
    /m?c=0..9   drop the current piece in that column (the fast path)
    /k?k=l|r|u|d|s   pad key: left, right, rotate, down one row, slam
    /r          rotate (what the pad's u key calls)
    /n          deal a new game
    /b/<state>.svg   the board image (the state is inside the URL)
    /health     ok

Each move: read `README.md` from GitHub, pull the board out of the board image
URL, apply the move locally, regenerate the README, commit it with a sha guard,
then 302 the visitor back to the profile. There is no database: the committed
README is the game.

## Deploy

    npx wrangler login          # once
    npx wrangler secret put GITHUB_TOKEN
    npx wrangler deploy

`GITHUB_TOKEN` needs **Contents: read and write** on `StinkyCat0/StinkyCat0`
and nothing else. A fine-grained PAT scoped to that one repo is the right shape;
a classic token with `repo` works but is broader than needed. The commit is
authored by `tetris <tetris@users.noreply.github.com>`, so the history reads as
the game's, not yours.

`GITHUB_REPO` and `PROFILE_URL` are plain vars in `wrangler.jsonc`. The board
image URL is built from the incoming request's origin, so no public-URL setting
is needed: deploy it wherever, the README follows.

## Local dev

    cp .dev.vars.example .dev.vars   # then paste a token
    npx wrangler dev
    curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'http://127.0.0.1:8787/m?c=4'

Point `GITHUB_REPO` at a throwaway repo while developing:

    npx wrangler dev --var GITHUB_REPO:StinkyCat0/tetris-staging

## Reset a game

A finished game offers `play again` and `watch the bot`; the scheduled workflow in
`.github/workflows/attract.yml` also pings `/w?if=over` every six hours, so a game over
screen cannot sit on the profile overnight. To wipe a live game immediately, hit `/w`, or
`/p` for a fresh board. Deleting the board image reference from `README.md` also works:
with no board in the README the worker treats the profile as the attract loop.

## The attract loop

`attract.svg` is generated, not hand-made: `npm run attract` runs a greedy bot through a
40-line sprint (height, holes, bumpiness, line clears), snapshots every position, and emits
one SVG. The settled stack is drawn once, as per-cell opacity windows, so the file grows
with placements and clears rather than with frames x cells. Each piece is drawn at its
spawn row and translated down into place, so it is never painted at its landing spot before
it drops. A progress bar and elapsed timer in the HUD track the sprint, and the whole thing
restarts on a fresh board when 40 lines clear. Every animation carries
`repeatCount="indefinite"`, so it loops forever instead of playing once and going blank.
Regenerate it if the board styling changes; the file is committed and served by GitHub, so
it costs the worker nothing.

## Throttle

`allow()` is a per-isolate counter, not a global one: 20 moves per IP per minute,
best effort. It keeps one tab from machine-gunning commits; it is not a security
boundary. If you ever need a real one, put a Cloudflare Rate Limiting rule on
`/m`, `/r`, `/n` — the worker already answers 302 for anything legitimate, so a
rule that blocks bursts will not break play.

## Cost

One commit per move, one GitHub API read plus one write, one worker invocation.
No storage. Someone mashing the pad costs a few hundred GitHub API calls an hour,
well inside a token's 5000/h.
