# TODO

Working list for the playable Tetris profile.

## Done

- [x] Confirm the mechanism (links + images only), pick the architecture
- [x] Scaffold repo, PLAN.md, engine skeleton
- [x] Engine: 7-bag, rotation normalised per piece, column drop, line clear, score
- [x] State codec: base64url state in the image URL, validated, small enough for a URL
- [x] SVG renderer: phosphor green CRT, SMIL drop + line-clear flash, HUD, column ruler
- [x] Worker: move -> apply -> commit README -> 302 back, sha-guarded with retry
- [x] 28 tests: rules, codec, SVG, and the click loop against a fake GitHub API
- [x] Verify the generated README survives GitHub's sanitizer (table, align, camo)
- [x] Deploy the worker and set the GitHub token secret
- [x] First live moves on github.com/StinkyCat0, camo serving each new board
- [x] Cache-busting redirect so a move is never followed by a stale page
- [x] Game over -> new game path verified end to end on staging
- [x] Pixel-check the SVGs (spawn, stack, clear, game over) with cairosvg
- [x] Docs: worker/README.md, PLAN.md, reset instructions

## Next, if it earns it

- [ ] Fine-grained PAT for the worker secret instead of the gh CLI OAuth token
- [ ] Custom domain for the worker instead of workers.dev
- [ ] Spend the 300ms: cache the README sha in KV, fall back to a read on 409
- [ ] A "best run" line in the HUD, committed alongside the board
- [ ] Real per-visitor games, if a server-rendered board is ever acceptable
