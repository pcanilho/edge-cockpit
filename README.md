<p align="center"><img src="docs/banner.png" alt="Edge Cockpit"></p>

<p align="center">
  <a href="../../releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/pcanilho/edge-cockpit?label=release&color=5cc8e6"></a>
  <a href="../../actions/workflows/check.yml"><img alt="Checks" src="https://img.shields.io/github/actions/workflow/status/pcanilho/edge-cockpit/check.yml?branch=main&label=checks"></a>
  <a href="../../actions/workflows/security.yml"><img alt="Security" src="https://img.shields.io/github/actions/workflow/status/pcanilho/edge-cockpit/security.yml?branch=main&label=security"></a>
  <a href="../../actions/workflows/codeql.yml"><img alt="CodeQL" src="https://img.shields.io/github/actions/workflow/status/pcanilho/edge-cockpit/codeql.yml?branch=main&label=CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/pcanilho/edge-cockpit"><img alt="OpenSSF Scorecard" src="https://api.scorecard.dev/projects/github.com/pcanilho/edge-cockpit/badge"></a>
  <a href="https://www.bestpractices.dev/projects/16854"><img alt="OpenSSF Best Practices" src="https://www.bestpractices.dev/projects/16854/badge"></a>
  <a href="../../releases/latest"><img alt="VirusTotal" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fpcanilho%2Fedge-cockpit%2Fbadges%2Fvirustotal.json"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/pcanilho/edge-cockpit?color=ffb547"></a>
</p>

A lightweight cockpit-style touch console for Star Citizen. It sends your real keybinds without stealing focus from the game, and reacts live to `Game.log`.

Unofficial fan project, not affiliated with Cloud Imperium Games.

![The console](docs/panel.png)

## Install

1. Run `Edge-Cockpit-<version>-setup.exe` from the [latest release](../../releases/latest). SmartScreen warns because the exe isn't code signed: **More info** > **Run anyway**. [How to verify a download](SECURITY.md#verifying-a-download).
2. In game: **Options > Keybindings > Advanced Controls Customization > Control Profiles**, pick **edge-cockpit**, tick only **Keyboard**. This adds keys for actions that have none. Your own binds stay. On first start a setup check shows what's ready and has a **Test a key** button.

It starts with Windows, wakes when Star Citizen starts and goes dark when you quit. Updates are offered only while you're not playing.

## Pages

- **Ship**: power plate with **Flight Ready**, a role module (target dial, mining laser, salvage beam, tractor beam...), flight and gear plates. Long-press a plate's title to rearrange; saved per role.
- **On foot**: weapon wheel, suit, comms, emotes.
- **Downed**: revive request.
- **MFD & assists**: MFD screens, light amplification, auto precision, wind compensation, Self repair all.
- **Log**: this session's stats, who downed you, region and shard, last jump, refinery jobs, a timeline.
- **World**: executive hangar cycle (synced by you, hidden after a patch until you sync again), keycard and vault door timers, RSI server status, and the commodity market where you are: buy and sell here, nearby, or find any commodity. Prices and stock are player reports from [UEX](https://uexcorp.space), each with its age. If the page does not know where you are, **Locate** opens your inventory for a moment so `Game.log` names the place.

| | |
| --- | --- |
| ![Mining](docs/panel-mining.png) | ![On foot](docs/panel-onfoot.png) |
| ![Armistice](docs/panel-armistice.png) | ![Red alert](docs/panel-alert.png) |
| ![Log](docs/panel-log.png) | ![Settings](docs/panel-settings.png) |

| Control | How it works |
| --- | --- |
| Keycap | Tap |
| HOLD | Held while you hold it |
| LONG / 2× | Long press or double tap for a second action |
| MACRO (cut corners) | Runs a sequence |
| ON/OFF switch | Top half on, bottom half off. Unlit until set |
| Gear lever | Slide up or down. Sits in the middle until you move it |
| Slider, knob | Drag or turn. Each step goes to the game, which keeps the value, so no number is shown |
| Red cover | Tap to lift, tap again within 3 s |

## It follows the game

From `Game.log` it opens the right page and shows your ship, mission, location, quantum target and alerts. Behind the status screen sits a render of your ship from [FleetYards.net](https://fleetyards.net), fetched once and kept. Ships from Drake, Aegis, Origin, MISC, Anvil, RSI, Crusader, Argo and Consolidated Outland get their maker's theme (**Settings > Screen**), where **Large labels** also lives. The frame goes red only for a CrimeStat or a disabled ship.

It reads your `actionmaps.xml`, so rebound keys just work. **Settings > Keybinds** lists any it can't press.

The game doesn't report most switch states, so nothing is guessed: ON/OFF switches stay unlit and the gear lever waits in the middle until you set them, and **All systems on** syncs them. Everything else is a push-button.

If a patch changes the log lines it reads, an amber **Log lines missing** chip says so, with a button to report it.

No telemetry. Network calls: FleetYards for ship images, GitHub for updates, and while the World page shows, UEX for prices (every 30 min) and RSI's status page (every 5 min).

## If keys do nothing

- **Settings > General > Setup check** shows what's off.
- Keys only reach the game while it's in front. **Test mode** sends them anywhere.
- Game running as administrator? So must the console: **Run as administrator** in settings or the setup check.
- Touches land on the wrong screen? Windows **Calibrate the pen and touch input** > **Setup**.

## Ships

Each ship has a role. To change one, create `Documents\Edge Cockpit\ships.json`:

```json
{ "ships": { "DRAK_Cutlass_Black": "cargo", "AEGS_Gladius": { "role": "heavy-fighter", "has": ["missiles"] } } }
```

Use `Game.log` class names; a prefix covers every variant.

## Supported devices

Corsair Xeneon Edge (2560 x 720). Other touchscreens: open a [device request](../../issues/new?template=device.yml).

## Feedback

[Bug report](../../issues/new?template=bug.yml) · [Feature request](../../issues/new?template=feature.yml) · [Contributing](CONTRIBUTING.md)

## Support

Free, with every feature. [Sponsor](https://github.com/sponsors/pcanilho) if you'd like to support it.

## Security

[SECURITY.md](SECURITY.md): what the app can do and how to report a vulnerability.

## Development

Tauri 2: Rust in `app/src-tauri` (window, keys, files, updates), plain HTML/CSS/JS in `app/ui`. Every key comes from `layouts/star-citizen.json`.

```sh
cd app
npm ci
npm test               # Game.log reader, role pages, ship lookup
npm run test:ui        # every page: full labels, no idle work, fast touches (needs Playwright)
npx tauri dev          # run it (Windows)
```

Browser preview: run `node scripts/sync.mjs` in `app`, then serve `app/ui` and open `index.html?demo=ship` (also `armistice`, `alert`, `downed`, `log`, or `page=mining`).

After a game patch: run `scripts/check_patch.py`, `build_layout.py` and `build_binds.py` on the new `defaultProfile.xml` (or [Boxxy-Binder's AllBinds.xml](https://github.com/BoxximusPrime/Boxxy-Binder)). The ship list refreshes monthly.

Release: add the version to [CHANGELOG.md](CHANGELOG.md) and `tauri.conf.json`, then run the **App** workflow with **release** ticked.

## Credits

Ship roles: [Star Citizen Wiki API](https://api.star-citizen.wiki). Commodity prices: [UEX](https://uexcorp.space), reported by players. Ship outlines and renders: [FleetYards.net](https://fleetyards.net), fetched at runtime, not in this repository. Star Citizen, its ships and logos belong to Cloud Imperium Games.

## License

[MIT](LICENSE)
