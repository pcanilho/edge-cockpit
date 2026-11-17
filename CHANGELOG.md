# Changelog

## Unreleased

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
