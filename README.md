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

A touch cockpit for Star Citizen. Presses your own keybinds without taking focus from the game, and follows `Game.log` live.

Unofficial fan project, not affiliated with Cloud Imperium Games.

![The console](docs/panel.png)

## Install

Get it from the [Microsoft Store](https://apps.microsoft.com/detail/9N40T11TSHC1) (updates itself), or:

1. Run `Edge-Cockpit-<version>-setup.exe` from the [latest release](../../releases/latest). SmartScreen warns because the exe isn't code signed: **More info** > **Run anyway**. [How to verify a download](SECURITY.md#verifying-a-download).
2. In game: **Options > Keybindings > Advanced Controls Customization > Control Profiles**, pick **edge-cockpit**, tick **Keyboard** and **Mouse**. It only adds keys for actions you have not bound, and keeps your mouse buttons (quantum engage on the left button included). On first start a setup check shows what's ready, with a **Test a key** button.

It starts with Windows, wakes when Star Citizen starts and goes dark when you quit. Updates are offered only while you're not playing.

## Pages

- **Ship**: power plate with **Flight Ready**, a role module (target dial, mining laser, salvage beam, tractor beam...), flight and gear plates. Long-press a plate's title to rearrange or swap the role module, long-press a key to swap it; both saved. On another screen, pick which plates it shows.
- **Build your own pages**: long-press a ship page's title, then **New blank page** or **Duplicate & edit**. Drag controls from the palette onto a plate (16 px grid), tap one to pick its key, label and size. Switches take only actions with set-on and set-off binds, eject-type keys only a cover or slide. A **Sequence** key sends up to six keys in turn (for example limiter on, gear down, lights on, ATC). Undo, Try it (no keys sent), phone preview, Fit or Actual size. **Use for** picks the ships it replaces the ship page of. **Share** saves it to `Documents\Edge Cockpit\Pages`; **Import** adds one from there. A tablet or PC showing the whole console can edit it too, live on the Edge.
- **On foot**: weapon wheel, suit, comms, emotes.
- **Downed**: revive request.
- **MFD & assists**: MFD screens, light amplification, auto precision, wind compensation, Self repair all.
- **Map**: Starmap and route keys. Tap **Map** again for a 3D chart of your system: planets, moons, Lagrange points and gateways from UEX's list of places, not to scale. The game sends no coordinates, so the marker sits on the place `Game.log` last named. Tap a place for its stations and best trades; **Verse > Find > a commodity > Show on chart** lights where it sells best.
- **Log**: this session's stats, who downed you, region and shard, last jump, refinery jobs, a timeline, and past sessions from the game's log backups.
- **Verse**: executive hangar cycle (you sync it; hidden after a patch until you sync again), keycard printer and Ruin vault door timers, RSI server status, and the market where you are: buy and sell here, nearby, or find any commodity. Prices and stock are player reports from [UEX](https://uexcorp.space), each with its age. If the page doesn't know where you are, **Locate** (on foot) opens your inventory for a moment so `Game.log` names the place.

| | |
| --- | --- |
| ![Mining](docs/panel-mining.png) | ![On foot](docs/panel-onfoot.png) |
| ![Armistice](docs/panel-armistice.png) | ![Red alert](docs/panel-alert.png) |
| ![Log](docs/panel-log.png) | ![Verse](docs/panel-world.png) |
| ![Page editor](docs/panel-editor.png) | ![Telemetry pages](docs/panel-gauges.png) |
| ![System chart](docs/panel-chart.png) | |

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

The console has the same legend: tap the ? next to the clock.

## It follows the game

From `Game.log` it opens the right page and shows your ship, mission, location, quantum target, injuries, hangar queue and alerts (restricted areas, low fuel, party invites, why the game dropped you). Behind the status display sits a render of your ship from [FleetYards.net](https://fleetyards.net), fetched once and kept. Ships from Drake, Aegis, Origin, MISC, Anvil, RSI, Crusader, Argo and Consolidated Outland get their maker's theme (**Settings > Screen**), where **Large labels** also lives. The frame goes red only for a CrimeStat or a disabled ship.

It reads your `actionmaps.xml`, so rebound keys just work. **Settings > Keybinds** lists any it can't press. It keeps the last 5 versions in `Documents\Edge Cockpit\Binds`: when a game update wipes your binds, **Restore** puts them back as a Control Profile.

The game doesn't report most switch states, so nothing is guessed: ON/OFF switches stay unlit and the gear lever stays centred until you set them. **All systems on** sets them all. Toggle-only actions are push-buttons.

## Game telemetry

Star Citizen can share your ship's state with apps on your PC. **Settings > Game link > Turn telemetry on** (by hand: on 4.10 `setx GRPC_CLIENT_SERVER_ENABLED true`, a user variable; on 5.0 `server.game.telemetry.enabled=1` in the channel's `user.cfg`), then restart the RSI Launcher and the game. While it's live:

- Switches show the game's own state: power, thrusters, shields, weapons, gear, VTOL, lights, decoupled, speed limiter, G-safe, ESP, proximity assist, stability, gravity and wind compensation, advanced HUD, light amplification, SCM or NAV, gimbals, staggered fire. Toggles get a lamp.
- The status display shows the ten warning lights, shields, hull, boost, speed, radar altitude and vertical speed, as far as your game version sends them (4.10 leaves out shields, hull and the altitudes); decoy and noise keys show what's left, the gun placard how many guns are ready. On foot or in EVA: your vitals.
- On 5.0, a tap goes to the game directly when it takes the action. Anything it refuses goes out as your key. Keys you haven't bound still work this way, marked GAME. 4.10 only shares state.
- **Telemetry** (a softkey shown only while telemetry is live) opens eight instrument pages: Ship, Instruments, Approach, Systems, Combat, Suit, Quantum and Turret. Tapes, dials and lamps draw only what the game sends; anything else reads Not sent or No reading. Approach waits until the game sends radar altitude or vertical speed, and Turret appears in a gunner seat, where it opens by itself. With Follow game on in the pilot seat, Approach also opens by itself for landing and takeoff and hands back your page once you're down, clear of the ground, or out of the seat. **Settings > Game link > Telemetry pages** hides any page. On 5.0, shields show their rate and time to empty or full, and hull the last hit.
- **Ship** turns your ship's 3D model from FleetYards with a finger: a shield bubble that glows with the shield level, the hull tinted as it drops, dark with the power plant off, landed or flight model by the gear; if the model can't load, it says why and offers Retry. Paint is your pick (the game doesn't say which you fly). Guns the game names get a card with their rated stats from the [Star Citizen Wiki](https://api.star-citizen.wiki), marked Rated and the game version they're for.
- Page builder: a status screen can show a live value (speed, radar altitude, heading, shields, hull, hydrogen, boost, G, decoys and more) as a gauge.

What the game doesn't send (door state, port locks, flashlight, the gun group) stays unclaimed. **Layout > Classic** keeps the console as it is without telemetry. **Record telemetry** saves ten minutes of it for a bug report. Details: [docs/telemetry.md](docs/telemetry.md).

If a patch changes the log lines it reads, an amber **Log lines missing** chip says so, with a button to report it.

Nothing is sent about you. Network calls: FleetYards for ship images (once per ship) and, on the Telemetry Ship page, its 3D model and paints (kept in the app's cache), the Star Citizen Wiki for the stats of guns the game names (every 12 h), GitHub for updates, and while the Verse page is open, UEX for prices (every 30 min) and RSI's status page (every 5 min), and on the system chart, UEX's list of places (once a week).

## If keys do nothing

- **Settings > General > Setup check** shows what's off.
- Console smaller than the screen, or in a corner? **Refit** in **Settings > Screen**. **Identify screens** shows which screen is which.
- Keys only reach the game while it's in front. **Test mode** sends them anywhere.
- Game running as administrator? So must the console: **Run as administrator** in settings or the setup check.
- Touches land on the wrong screen? Windows **Tablet PC Settings** > **Setup**, then tap the touchscreen when asked.

## Ships

Each ship has a role. To change one, create `Documents\Edge Cockpit\ships.json`:

```json
{ "ships": { "DRAK_Cutlass_Black": "cargo", "AEGS_Gladius": { "role": "heavy-fighter", "has": ["missiles"] } } }
```

Use `Game.log` class names; a prefix covers every variant.

## Supported devices

Corsair Xeneon Edge (2560 x 720). On another touchscreen, **Settings › Screen** picks which plates it shows and Fit or Actual size, and you can build your own pages for it. Other sizes: open a [device request](../../issues/new?template=device.yml).

Phones, tablets and other PCs on your network join as extra screens: **Settings › Devices**, turn it on and scan the code (or open `http://edge-cockpit.local:47823`). No app to install. A phone shows one plate at a time; a tablet or another PC shows the whole console. Give a device one plate, or move a plate off the Edge onto it. Only paired devices can press keys.

| ![Phone](docs/phone-power.png) | ![Phone sideways](docs/phone-role.png) |
|---|---|

## Feedback

[Bug report](../../issues/new?template=bug.yml) (**Settings > About > Report a problem** fills it in and saves a report file to attach) · [Feature request](../../issues/new?template=feature.yml) · [Contributing](CONTRIBUTING.md)

## Support

Free, every feature. [Sponsor](https://github.com/sponsors/pcanilho) if you'd like.

## Security

[SECURITY.md](SECURITY.md): what the app can do and how to report a vulnerability.

## Development

Tauri 2: Rust in `app/src-tauri` (window, keys, files, updates), plain HTML/CSS/JS in `app/ui`. Every key comes from `layouts/star-citizen.json`.

```sh
cd app
npm ci
npm test               # Game.log reader, role pages, ship lookup
npm run test:ui        # every page: full labels, no idle work, fast touches (needs Playwright)
npm run dev            # run it
```

Browser preview (also the site's live demo): run `node scripts/sync.mjs` in `app`, then serve `app/ui` and open `index.html?demo=ship` (also `armistice`, `alert`, `downed`, `disabled`, `log`, `hangar`, or `page=mining`).

After a game patch: run `scripts/check_patch.py`, `build_layout.py` and `build_binds.py` on the new `defaultProfile.xml` (or [Boxxy-Binder's AllBinds.xml](https://github.com/BoxximusPrime/Boxxy-Binder)). The ship list refreshes monthly (`refresh-ships.yml`).

Release: add the version to [CHANGELOG.md](CHANGELOG.md) and `tauri.conf.json`, then run the **App** workflow with **release** ticked.

## Credits

Ship roles: [Star Citizen Wiki API](https://api.star-citizen.wiki). Commodity prices: [UEX](https://uexcorp.space), reported by players. Ship outlines and renders: [FleetYards.net](https://fleetyards.net), fetched at runtime, not in this repository. Star Citizen, its ships and logos belong to Cloud Imperium Games.

## License

[MIT](LICENSE)
