# TODO

Working list for the playable Tetris profile. Updated as work lands.

- [x] Confirm the mechanism (links + images only), pick the architecture
- [ ] Scaffold repo, PLAN.md, engine skeleton
- [ ] Engine: 7-bag, rotation, column drop, line clear, score — with node:test suite
- [ ] State codec: compact encode/decode + HMAC signing
- [ ] SVG renderer: terminal styling, SMIL drop + line-clear animation
- [ ] Worker: routing, move application, Contents API commit, 302 back
- [ ] README: board at top, rotate + 10 column links, dead links stay on page
- [ ] Deploy worker, set secrets, first live move verified
- [ ] Guards: signature check, rate limit, in-flight guard, failure redirect
- [ ] QA on the live profile: desktop, mobile, camo freshness, double-click race
- [ ] Docs: how it works, how to reset a game
