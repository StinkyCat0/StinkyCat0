# TODO

Working list for the playable Tetris profile. Updated as work lands.

- [x] Confirm the mechanism (links + images only), pick the architecture
- [x] Scaffold repo, PLAN.md, engine skeleton
- [x] Engine: 7-bag, rotation, column drop, line clear, score — node:test suite
- [x] State codec: base64url state, validation, fits in a URL
- [x] SVG renderer: phosphor green CRT, SMIL drop + line-clear flash, HUD, column ruler
- [x] Worker: routing, move application, Contents API commit, 302 back
- [x] End-to-end tests against a fake GitHub API (600 moves, races, throttle)
- [ ] Measure the rendered README with GitHub's own sanitizer at phone width
- [ ] Deploy the worker, set the token secret, first live move
- [ ] Point the board at the live worker and verify camo serves each new board
- [ ] QA the live profile: desktop, mobile, double-click race, game over
- [ ] Docs: how it works, how to reset a game, how the token is scoped
