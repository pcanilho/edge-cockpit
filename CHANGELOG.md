# Changelog

## Unreleased

- **System chart.** Tap Map again (or the arrows on the Map plate) for a 3D chart of the system you're in: planets, moons, Lagrange points and gateways, drawn by the console from UEX's list of places. Drag to turn, pinch to zoom. It isn't to scale: the rings show the order of the planets, not distance.
- **Where you are, from Game.log.** The game sends no coordinates, so the marker sits on the place Game.log last named (a quantum arrival, a hangar lift or opening your inventory) and the card says how long ago. Your last quantum route shows as a dashed line. With no place named yet, there's no marker.
- **Tap a planet, moon or Lagrange point** to see its stations and cities and its best trades from Verse's prices. Routes are still set on the game's own Starmap; the keys for it sit beside the chart.
- **Verse > Find > a commodity > Show on chart** lights the places in your system where it sells best, with their prices.
- The chart loads only when you open it, draws only when something changes, and gives its graphics memory back when you leave it. The list of places is fetched once a week and kept for offline use.
- **Vitals in steps, not a gradient.** Health, oxygen, hunger and thirst are grey while fine, amber past the first mark and red past the second, with the marks beside each scale: health 50 / 25 %, oxygen 40 / 15 %, hunger and thirst 30 / 10 %. Body temperature turns amber under 35 °C or over 38.5 °C, red under 32 °C or over 40 °C. On the status card, the Suit page, the phone Suit tabs and page-builder tiles. The game publishes no thresholds, so these are ours.

## 0.11.4

- The Gauges softkey is now **Telemetry**, and Settings > Game link > Gauge pages is **Telemetry pages**.
- **Approach opens by itself for landing and takeoff (5.0).** With Follow game on in the pilot seat, Approach opens when the gear starts down or radar altitude drops under 300 m while descending, and when you lift off. It hands back your page 5 s after touchdown, or once you've been above 400 m with the gear up for 5 s. A page you pick in between stays. Not on 4.10, which sends no radar altitude.

## 0.11.3

- **3D Ship loads in the app.** The app's security settings stopped the 3D model from loading for every ship ("The 3D model didn't load"). It now loads. If it can't, the message says what went wrong (FleetYards didn't send it, the download stopped, you're offline, the file couldn't be read, or the graphics can't draw 3D), with a Retry button. A model that fails is no longer read again on every telemetry update.
- **On-foot status card fits.** Your vitals are two compact lists, so the mission, the location and Follow game fit under them on the Edge. Heart rate reads "beats a minute". When the card is still full, the system map gives way first.

## 0.11.2

- Gauge pages: colour only where it needs attention. Flight control shows On and Off as outlines, gear and VTOL stowed in flight are dark, a normal heart rate is no longer red, breathable air turns red only when it isn't, and the current master mode is a green rim. Vertical speed, speed and radar altitude keep their units inside the readout, clear of the scale. Combat shows decoys and noise left in big numbers on the keys.
- Caution lamps: a flashing lamp alternates between filled and outlined, so its name stays readable. Working systems show a grey name under a small green bar, so only warnings carry colour, and a system the game reports as switched off says Off.
- Phone: Instruments and Suit split into one tab per instrument, each at full width.

## 0.11.1

- **Lighter on your PC.** Gauge pages now change only the parts that moved: a needle turns, a number updates, and the rest of the drawing stays put. The Instruments page costs about 40 % less per update, and the status screen's telemetry block about 20 % less. The 3D Ship page redraws only when something you can see changes, so a still ship costs a small fraction of what it did, and it no longer downloads the model again for every update that arrives while it loads.
- **Only pages the game can fill.** Approach joins the swipe once the game sends radar altitude or vertical speed (4.10 sends neither), and Turret only in a gunner seat. **Settings > Game link > Gauge pages** takes any page out of the swipe or puts it back. The page count counts only the pages shown.
- **Which way the fight is going (5.0).** Shields show how fast they're falling or recharging and about when they'll be empty or full. Hull shows when the last hit landed and how much it took. The shield bar on the status screen shows ▼ or ▲ while shields move.
- **Gauges fit on a phone.** On a phone, a gauge that is wider than the screen shrinks to fit instead of being cut off, and its tab carries the page's name.

## 0.11.0

Game telemetry and the Gauges pages were also checked against 5.0 PTU recordings.

- **Game telemetry.** Star Citizen can share your ship's state with apps on your PC; Settings > Game link turns it on (4.10 LIVE and 5.0 PTU), then restart the RSI Launcher and the game. While it's live, switches show the game's own state instead of staying dark until you set them: power, thrusters, shields, weapons, gear, VTOL, lights, decoupled, speed limiter, G-safe, ESP, proximity assist, stability, gravity and wind compensation, advanced HUD, light amplification, SCM or NAV, gimbals and staggered fire. Toggles get a lamp.
  - The status display shows the ten warning lights, boost and speed, plus shields, hull, radar altitude and vertical speed where the game sends them (5.0; 4.10 doesn't), and the seat, landed or flying, and SCM or NAV. On foot or in EVA: health, oxygen, hunger, thirst, body temperature, heart rate, outside temperature and gravity.
  - Decoy and noise keys show what's left; the gun placard how many guns are ready.
  - On 5.0, a tap goes to the game directly when it takes the action, and your key when it doesn't. Settings shows which way the last press went. 4.10 only shares state.
  - A chip on the status screen says whether it works: Telemetry live, linked (the game answers but shares nothing until your character spawns), or no answer. Tap it for Settings > Game link.
  - A key with no keyboard bind still works on 5.0 when the game takes its action: its cap reads GAME, and Keybinds and the unbound chip no longer count it.
  - What the game doesn't send (door state, port locks, flashlight, the gun group) stays as before.
  - Layout > Classic keeps the console as it is without telemetry. Record telemetry saves up to ten minutes of it to Documents\Edge Cockpit for a bug report.
- **Gauges.** A softkey shown while telemetry is live opens eight instrument pages, each drawn only from what the game sends (anything else reads Not sent):
  - Ship: your ship's 3D model from FleetYards, turned with a finger. Shield bubble glows with the shield level, hull tints as it drops, dark with the power plant off, landed or flight model by the gear. Paint is your pick. Guns the game names get a card with rated stats (burst, sustained, alpha, rate, range) from the Star Citizen Wiki, labelled with the game version, and a ship total.
  - Instruments: heading ribbon, speed and radar altitude tapes, vertical speed, boost and G meters with peak, hydrogen, master caution and warning from the ten lights.
  - Approach: radar altitude on a log scale, descent angle and time to ground, touchdown check, sink rate.
  - Systems: power bus, flight control board, gear and VTOL, guns, gimbals, stagger, decoys and noise.
  - Combat: big Missile and Hit lamps, shields and hull, decoy and noise keys, guns ready.
  - Suit: health, oxygen, heart rate, hunger, thirst, body and outside temperature, gravity, breathable air.
  - Quantum: NAV or SCM with a stopwatch for the spool (timed by the console, the game sends no percentage), hydrogen and how long it lasts at the current burn.
  - Turret: seat, gyro and mouse mode, recenter, change position and remote turret keys. Opens by itself in a gunner seat.
- Page builder: status screens can show 16 live values as gauges.
- Start with Windows: an update no longer takes the app off Windows sign-in until it is opened again.

## 0.10.2

- **Pick the edge-cockpit control profile again, with Keyboard and Mouse ticked.** Keys that used right Shift (Open doors, Door locks and 40 more) also fired the game's Lock rotation, so the mouse stopped turning the ship until the key was pressed again. The profile uses right Ctrl and right Ctrl + left Alt only now. Every key, and each modifier on its way down, is checked against all the game's default keyboard binds, in CI too. Greet no longer uses Ctrl + Alt + F4. Settings > Keybinds and the setup check say when a loaded bind still holds right Shift, left Shift or left Ctrl.
- Loading the edge-cockpit control profile never replaces a bind of yours: it only adds keys for actions you haven't set, and picks other keys where yours are taken. If it overwrote some, Settings > Keybinds > Restore brings back the copy from before.
- Quantum engage keeps the left mouse button. Mining laser type (LAlt + left button) and operator mode (middle button) too.
- Status screen: a mission, place, quantum and route together no longer run off the bottom, on the Edge or a phone. The ship picture shrinks, then gives way, so everything and Follow game stay in sight.
- Quantum to a mission marker reads its place (Quantum to Kaboos), not the marker's ID.
- Sound: Mute all in Settings > Feedback silences clicks and alert tones together. Alert sound (armistice, CrimeStat, ship, hangar, party and timer tones) now sits next to Click sounds; it was under General, so turning clicks off left those tones on. Paired devices get Mute all and Alert sound in their own settings too; before, they could only turn clicks off.

## 0.10.1

- How the keys work: a card that shows each kind of key as it looks on the console (hold ring, LONG and 2×, macro corner, ON/OFF, GUARD, cover, your swapped keys, colours, empty slots) and what it does. It follows the setup check on the first start, then opens from the ? next to the clock or Settings > General.

## 0.10.0

- **Reload the edge-cockpit control profile** for the new keys below.
- Screen check: after every move the console compares its size with its screen's and moves again if Windows shrank it. If it is still wrong, Settings > Screen and the status screen say so, with Refit.
  - Screen cards show each screen's Windows scale when the screens differ.
  - Identify screens shows each screen's name on that screen for 3 seconds.
  - The setup check starts with the screen: the console fills it, or Refit.
- Binds you change in the game reach the console at once: it reads actionmaps.xml again when the game saves it and says if a console key lost its keyboard bind.
- Wipe lock: hold the clock for a second (or Settings > General > Wipe lock) and touches are off for 15 s while you clean the screen. Hold anywhere for a second to end it early.
- Night backlight: Night mode also turns the screen's own backlight down (10, 30 or 50 %, or Off), and back up when it ends. Screens that can't do this say so, and only the console dims. Screen off now moves to Settings > General.
- Log page: Past sessions, from the logs the game keeps in its logbackups folder (last 30 days): when each started, time played, injuries (or kills), downs, missions and ships, and the week's total. The four cards above are shorter to make room.
- Page editor: Sequence, a key of your own that sends up to six keys in turn, 250 ms, 1 s or 3 s apart (for example Landing: limiter on, gear down, VTOL on, lights on, ATC). A step that switches something must be its set-on or set-off key, so switches on the console show what the sequence set. Hold keys, keys that end a flight and other sequences can't be steps.
- Injuries: the status screen shows the injury that needs the most care, with its tier (tier 3: med pen, tier 2: med bed, tier 1: hospital). It clears after a med bed treatment or a respawn, or with a tap (a med pen leaves no log line). The Log page and recap count injuries instead of kills, which the game stopped logging in 2026; Kills come back for a session that logs one.
- Hangar queue: the hangar chip shows your place in the queue and the longest wait the game gives.
- Restricted area: an amber banner and tone when you enter one, and the law chip says Restricted area or Private property while you're inside. Ship impounded and Low fuel alerts too. Tap Low fuel to clear it after refuelling.
- Why the game dropped you: a timeout, a server crash, an idle kick, a sign-in elsewhere, or the kind of game crash. It shows on the status screen until you are back in, in the Log and in the session recap. Leaving by yourself shows nothing.
- Party: a banner when someone invites you or starts a jump to you, a chip while a party jump calibrates, and party members coming online in the Log.
- New keys for your own pages and long-press swaps: Door locks and Port locks as ON/OFF switches (the game's separate lock and unlock binds), Pin target, Unpin target, Pin 1–3, Next pinned, and remote turrets (Turret 1–3, Next, Previous, Exit).
- Settings > Feedback (was Touch feedback): Shapes for colour (amber marks are triangles, red diamonds, green rings, and the red frame is dashed) and Reduce motion (no flashing, blinking or sliding).
- HUD notices that run over several lines in Game.log now reach the console whole.
- Status chips that would run off the status screen give way, the least pressing first, so Follow game stays in sight.
- Binds copies: each time the game saves your binds, the console keeps a copy in `Documents\Edge Cockpit\Binds` (the last 5 per game channel). If a game update or a deleted USER folder wipes them, Settings > Keybinds and a Binds reset chip say so. Restore adds the copy to the game's Control Profiles as edge-cockpit-backup, with every device and its options; Keep them as they are stops the warning.
- Report a problem (Settings > About, and the Log lines missing chip): saves `Documents\Edge Cockpit\report.txt` with the app, Windows, WebView2 and game versions, your screens and their scale, the keybind check, your settings and the last 300 Game.log lines the console read, with your handle, other players' names, ID numbers and addresses taken out. Explorer shows the file and the bug form opens filled in. Nothing is sent unless you post it.
- Site: Try it live turns the hero screenshot into the console itself, playing recorded scenes (fighter, mining, armistice, red alert, downed, log). It is the released version, loads only its own files and sends no keys.

## 0.9.2

- The console fills the Edge at start again when your main screen uses another Windows scale (it came up smaller, in a corner).
- Devices: Vibration On/Off in the device's settings, next to Sound. Android buzzes on every press, as before, and can now be turned off. iPhone (iOS 17.4 and later) gets one light tick per press. The Edge is unchanged.

## 0.9.1

- Installer in the cockpit look: Edge Cockpit art on the welcome and finish pages and in the header, with dark welcome, finish and header areas.
- Security: url updated to 2.5.9.

## 0.9.0

- Your keys: long-press any tap key to swap it for another. A cyan dot marks keys you changed; Back to stock undoes it. Kept per page and in saved profiles.
- Key picker: Suggested first (keys like the one you replace, then your recent picks), sub-groups in each tab, toggle / on / off as one tile, and search on its own keyboard.
- Arrange mode (long-press a plate title) also picks the role module, so a ship page can carry another module. Saved per role.
- Settings > Screen: choose which ship plates this screen shows; the rest leave and the others grow to fill it. Size: Fit, or Actual size (never larger than designed).
- Page editor: long-press a ship page's title, then New blank page or Duplicate & edit. Long-press the title of a page of yours to edit it again.
  - Drag controls from the palette (where the status display sits) onto a plate; they snap to a 16 px grid, with guides to line them up. Tap one for its card: key, label, size, duplicate, remove. Drag to move, drag the corner to resize.
  - Stock plates on a duplicated page: move or remove their controls; Back to stock undoes it. Add, remove, reorder and size your own plates.
  - The key picker dims what a control can't take and says why. A switch takes only actions with set-on and set-off binds. An amber note marks keys not bound in your game.
  - Done is blocked while a control has no key, a label doesn't fit or two controls overlap.
  - Undo, an autosaved draft, Try it (presses light up, no keys sent), Fit or Actual size per page, Delete.
- Pages of yours, beyond the Edge:
  - Use for: pick the ships a page replaces the ship page of; sitting in one shows it.
  - Phone: the editor previews a plate as an upright phone folds it.
  - Share saves the page to Documents\Edge Cockpit\Pages; Import (arrange mode) adds a page file from there as a new page. Profiles carry your pages too.
  - Devices show your pages, and a tablet or PC showing the whole console can edit them: the Edge shows each change live, and Done saves on the PC.
- README and site: pages of your own, with an editor screenshot. The Settings screenshot is retaken.
- CI: every PR pixel-compares all curated pages and phone views against its base.

## 0.8.0

- Devices: phones, tablets and other PCs on your network join as extra screens. No app to install.
  - Settings > Devices: turn it on and scan the QR to pair at once, or open the address and enter the 6-digit code. On a phone, Add to Home Screen opens it full screen.
  - A phone shows one plate at a time, upright or sideways, with a rail to step through it. A tablet or another PC shows the whole console.
  - Per device: all plates or one, and Copy or Move (Move takes the plate off the Edge). Set it from the PC or from the device.
  - The console answers to `edge-cockpit.local`, so a Home Screen icon keeps working when the router hands the PC a new address.
  - The device's screen stays on, it reopens on the view it showed last, and Android phones buzz on a press.
  - Off until you turn it on. Only private addresses are served and only paired devices can press keys. Forget a device to unpair it.
- Network: with Devices on, the console is served on your home network (port 47823) and announced as `edge-cockpit.local`.
- README and site: Devices, with phone screenshots.

## 0.7.1

- World: the sell side's stock reads "Stock full" instead of "Their stock full".
- Place names keep the game's spacing: Area 18, not Area18.
- Site and README checked against the app and trimmed. The World and Settings screenshots are retaken.

## 0.7.0

- World page (new page key; the page keys are now four over three):
  - Executive hangars: the five lights, open or charging, when it changes and the next two openings. Tap Sync once at the hangar and pick what the lights show. After a game update the times hide until you sync again.
  - Your timers: red and blue keycard printers (30 min), the Ruin vault door (20 min closed, 1 min open, ends when you change server) and one of your own. A chime when each is ready.
  - Servers: RSI's status page and your region and shard.
  - Commodities where you are: what this place sells with the best place in the system to sell it, what it buys with the cheapest place to buy it, the profit per SCU, and the same for the places around the planet. Find: kind chips and an A–Z strip, then where a commodity is cheapest and pays most. Player reports from UEX, each with its age; older than 2 days in grey, older than a week left out. Offline it shows the saved prices and says so.
  - Location unknown: a Locate key opens your inventory for a moment so Game.log names the place, then closes it (on foot only, since I toggles thrusters in a seat). Until then, the best trades in your system. Calling a ship at a hangar also names the place.
  - After you travel, the place is tagged "You travelled since" with Locate beside it.
  - Stock with each price: SCU for sale where you buy, the terminal's own stock where you sell. Low stock and full terminals in amber.
- Network: while the World page shows, it fetches UEX prices (every 30 min) and RSI's status page (every 5 min). Nothing when the page is closed.
- README and site screenshots retaken on this version, with one of the World page.

## 0.6.1

- **Reload the edge-cockpit control profile** after updating (Options > Keybindings > Advanced Controls Customization > Control Profiles, Keyboard only). It adds keys for gear down and gear up.
- Gear lever: sends gear down and gear up instead of the toggle. It sits in the middle with its lights dark until you move it, since the game doesn't report the gear.
- Speed limit, beam distance, beam spacing and laser power show no made-up value. They send steps and the game keeps the number, so the slider springs back to the middle and the knob shows which way you turned.
- Armistice: locked weapon keys keep their own label, dimmed, with a small ARMISTICE tag instead of the word printed over it.
- Fix: Settings > Screen always showed "Touches land on another display", and the key picker showed Clear slot on an empty slot.
- README and site screenshots retaken on this version.

## 0.6.0

- Ship backdrop: when a ship's angled render on FleetYards is broken, the store image shows instead. Ships whose FleetYards id carries a suffix (Constellation Andromeda) are found.
- Long ship and maker names shrink to fit one line (Constellation Andromeda, CRUSADER, ROBERTS SPACE INDUSTRIES).
- Maker themes for RSI, Crusader, Argo and Consolidated Outland, each with its own line art.
- Settings > Screen > Large labels: key text a quarter bigger, placards a fifth, key hints hidden. For glare or a screen further away. Two rows on a tall screen moved to General.
- Setup check: on first start (and from Settings > General) a card shows whether the touchscreen, the game and its Game.log, the edge-cockpit control profile and admin rights are all right, with a fix for each and a Test a key button (opens mobiGlas).
- Patch watch: an amber "Log lines missing" chip when the game log stops showing lines every session has (your character, joining a server), or boarding while you press ship keys. Tap it to report it on GitHub.
- CI replays a whole 4.10 session log through the app's own Game.log reader and line filter, then through the console's parser, and runs the Rust tests on Linux.
- Page keys sit in two even rows of three. Burst − and + are one rocker. A key press flashes brighter.
- Tray menu: the version, Settings, Setup check, Start with Windows and Check for updates, next to Hide the console and Quit.

## 0.5.0

- Ship backdrop: behind the status screen, a dimmed render of the ship you sit in over its maker's name. The render comes from FleetYards.net the first time and is kept on your PC; offline, themed makers show line art instead.
- Maker themes: in a Drake, Aegis, Origin, MISC or Anvil ship, the plates and title trim take on that maker's style (drawn for the app, no game art). Settings > Screen > Maker theme: Auto (follows your ship), Off (also hides the backdrop), or one maker always.
- When the game restarts and starts a new Game.log, the console starts over with it instead of keeping the last session's state.
- Log page: this session's time played, kills, times downed, missions and ships flown above the timeline.
- The layout and ship data load without whitespace (the layout drops from 300 KB to 190 KB).
- Fix: the app passed only part of Game.log to the console, so in the installed app it missed boarding a ship on 4.10, hangar status and the new Log page events (the browser demo was fine). Every line the console reads now gets through, and a test checks each one.
- Log page (new Log soft key): who downed you last, with the weapon and the hospital you respawn at; region and shard; the last jump; a finished refinery job; ships stored or ejected from; and a timeline of the session from the game log.
- Quantum: the destination comes from the route the drive plots as well as the marker, and shows "Arrived" once the drive drops out.
- Disabled ship: Flight ready and All systems on become Self repair all and Emergency exit until the ship is back.
- Server lag: an amber chip for 45 s when the log reports your client stalled.
- Redrawn icons: ship, landing gear, VTOL, missiles, on foot, docking and jettison. Self repair gets a wrench instead of the medical cross.
- MFD & assists ship page: keys for each MFD screen, ON/OFF switches for light amplification, auto precision and wind compensation, and Self repair all. MFD keys can also go in a spare slot.

## 0.4.0

- The keybind profile in the game is now called **edge-cockpit**.
- Two rows on a screen that isn't ultra-wide: on a 16:10, 4:3 or portrait monitor or a tablet the console stacks into two rows when that makes the keys bigger (a third bigger on 4:3, half again on a portrait 1080p screen). On 16:9 one row is already as big, so it stays. Settings > Screen > Maker theme: Auto (follows your ship), Off, or one maker always.
- Spare slots: where a ship lacks the kit (no missiles, EMP or QED), hold the empty slot to put any tap key there, picked from a list by group. Hold it again to change or clear it. Kept per page and saved in profiles.
- Hangar status: a chip and an alert follow a ship you call at a fleet terminal (called, lift rising, ready, with the hangar size) and a landing hangar ATC assigns you. It clears when you board or leave the seat. The log says nothing about pads or hangar numbers, so neither is shown.
- The weapon wheel and map dial are slightly smaller so their rims no longer run under the corner keys. A screen test now fails if any two controls or plates touch on any page.
- Buttons are coloured by group (weapons amber, flight cyan, systems white, emergency red) with a dim backlight strip and tinted icon at rest. Hold keys show a ring that fills while held; macros have a notched corner.
- New keys, checked against GameGlass's Star Citizen shards: Accept and Ignore for invites and calls, next hostile, next attacker and subtarget on the target wheel, aim mode, missile mode, and the horn on ground vehicles. Reload the keybind profile for the missile mode key.
- Alerts: a banner, a flash of the frame and a short tone when you get or clear a CrimeStat, enter or leave armistice, or your ship is disabled or destroyed (with who did it, when the log says). Settings > General turns the tone off.
- Session recap when you leave the game: time played, kills, times down, missions, routes set, ships flown and places visited, from that session's log. Settings > General turns it off.
- Every emote has its own icon.
- Emotes page, from the Emotes key on the On foot page: squad hand signals and 24 emotes. Reload the keybind profile for their keys.
- Panic decoy now has a key in the keybind profile (it had none, so the long press did nothing).
- Every key is checked on each change against the game's 4.x action list, so a renamed or removed action fails the build instead of a key doing nothing.
- ON/OFF switches for power (all, thrusters, shields, weapons), lights, VTOL, speed limiter, decoupled, G-safe, proximity assist, advanced HUD, stability, gravity compensation and staggered fire. They use the game's separate on and off binds, so a tap sets the state rather than flipping it. Unlit until set; reset when you leave the seat or change ship.
- All systems on: one macro that powers everything up and runs Flight Ready.
- The flight mode knob sets NAV or SCM directly.
- Long-press Decoy for a panic decoy burst. Hail target on the comms plate.
- Mining mode and Salvage mode use the game's 4.x actions (the old combined one is gone from 4.x). Checked every key against a full 4.x keybind list: all others exist.

- Keys with modifiers (RCtrl+F2 for the speed limiter and others) press the modifier a moment before the key, so the game no longer reads them as the bare key (F2 opened the starmap).
- Knows which ship you're in on 4.10 again: the game no longer logs taking the pilot seat, so boarding is read from the ship's crew channel and the ship from its navigation. The console follows you between ship and on-foot pages again, and picks the ship page by the ship.
- Flight Ready is now a big button on the power plate, beside plain Weapons / Engines / Shields + and Power reset keys. The power triangle and its guessed pips are gone.
- Cycle gimbal replaces Freelook on the combat target wheels; Freelook moved to the flight plate.
- Switches the game doesn't report (G-safe, ESP, doors, lights and the like) are push-buttons with no guessed ON/OFF. Only keys that set one state, and the gear lever, show the last one sent.
- The red frame is only for a CrimeStat or your ship disabled. Unmonitored space, comms down and ungoverned space show as an amber note.
- The status screen is reorganised: a readable location ("Keeger · Nyx", "Asteroid base · Ungoverned"), a drawn line of the system's planets with where you are, and, on foot, the ship you last flew.
- Ship pages have a clear page counter with arrow buttons, as well as swiping.
- Night mode: Off, Auto (dims from 20:00 to 07:00) or On.
- Hidden performance overlay: hold the EDGE COCKPIT title for 2 seconds for frame rate, CPU, memory and touch-to-key time.
- Settings, Screen: pick the display for the console, or leave it on Automatic, which now finds the touchscreen. A warning, with a fix button, shows when Windows maps touch to another display. The console moves back by itself when displays change.
- "Auto pages" is now called "Follow game", on the status screen chip and in Settings.
- The Settings key lights up while Settings is open, and tapping a page key closes Settings.
- The VirusTotal badge shows the latest release's real result (engines that flag it), and the release notes give the result next to each exe's report link.
- Profiles: save your settings, plate order, ship roles and keyboard binds to Documents\Edge Cockpit\profile.json, and load them on another PC. Loading adds the binds to the game's Control Profiles as "edge-cockpit-profile".
- With no game running, the controls grey out, and the game link at the top of the status screen is now a clear pill: grey OFFLINE with no game, the game channel and version in amber while it runs behind, green when it's in front.
- The tray menu is down to one item that shows or hides the console, plus Quit, and a left click does the same. Show and hide now work reliably.
- Keybind check: at start and whenever your binds change, the console checks every key it can send. Keys with no keyboard bind, joystick-only binds and two actions sharing a key show in Settings, Keybinds, and a chip on the status screen points there.
- Press flash: a control lights up for a moment when its key goes out, including the power corners. Turn it off in Settings.
- Settings are grouped into sections (General, Screen, Touch feedback, Keybinds, About) with room to grow. The update chip opens About.
- With no game running, the status screen reads "Standing by" instead of a title that wrapped over its subtitle.

## 0.3.0

- **Edge Cockpit**: the console has a new name, logo and home.
- Starts with Windows and waits in the tray. Wakes when Star Citizen starts and sleeps when you quit.
- Screen off when not playing: the Edge's backlight goes down where it allows it, and the console goes black. A touch wakes it.
- Updates itself from GitHub releases and shows what's new in settings.
- Rearrange the plates: long-press a plate's title, drag, tap Done. Saved for each role.
- Every label fits on every page, checked on each change.
