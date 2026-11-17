# Site

Source for https://edge-cockpit.canilho.net/, deployed by `.github/workflows/pages.yml` on pushes to main that touch `site/` or `docs/`, daily, and by hand.

- `index.html` is the page. `{{NAME}}` placeholders are filled by `build.py` from the latest release.
- Screenshots and the logo come from `docs/`, fonts from the app's `@fontsource` packages.
- `site.js` swaps in the newest release at load, so the links stay right between builds.

Preview: `npm ci --prefix app --ignore-scripts`, `python site/build.py _site`, then open `_site/index.html`.
