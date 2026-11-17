# Contributing

Thanks for helping. Bug reports, ideas, device requests and pull requests are all welcome.

## Reporting

- **Bugs**: open a [bug report](../../issues/new?template=bug.yml) with your Edge Cockpit version, the game build and steps to reproduce.
- **Ideas**: open a [feature request](../../issues/new?template=feature.yml).
- **Another touchscreen**: open a [device request](../../issues/new?template=device.yml).
- **Security issues**: never in a public issue. See [SECURITY.md](SECURITY.md).

Issues get a first reply within 14 days.

## Pull requests

1. Fork, branch from `main`, and keep each pull request to one change.
2. Run the checks below before you push.
3. Open the pull request against `main` and describe what changed and how you tested it. Pull requests are reviewed, must pass every required check, and are squash-merged.

By contributing you agree that your work is released under the [MIT License](LICENSE).

## Requirements for a change

- **Tests.** New behaviour comes with tests, and a bug fix comes with a test that fails without it. Rust tests live next to the code in `app/src-tauri/src` (`cargo test`), the Game.log reader, role pages and ship lookup in `app/test/*.test.js` (`npm test`), and the rendered console in `app/test/ui.mjs` (`npm run test:ui`).
- **No warnings.** `cargo clippy -- -D warnings` must be clean, and CI fails on any warning.
- **Style.** Format Rust with `cargo fmt`. UI code is plain HTML, CSS and JS with no framework and no remote code. Every label must fit on every page; `npm run test:ui` checks it.
- **Keys.** `layouts/star-citizen.json` is the source of truth for every key. Change it there, not in the generated files.
- **Dependencies.** Keep them few. New crates must pass `cargo deny check` (licences, advisories, sources).
- **User-visible changes** get a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).

## Running the checks

```sh
cd app
npm ci
npm test               # Game.log reader, role pages, ship lookup
npm run test:ui        # every page renders with full labels (needs Playwright)
cd src-tauri
cargo test --locked
cargo clippy --locked -- -D warnings   # Windows only, like the app
```

CI also runs CodeQL, cargo-deny, zizmor, gitleaks, dependency review and OpenSSF Scorecard on every change.
