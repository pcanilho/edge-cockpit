# Changelog

## Unreleased

- Profiles: save your settings, plate order, ship roles and keyboard binds to Documents\Edge Cockpit\profile.json, and load them on another PC. Loading adds the binds to the game's Control Profiles as "edge-cockpit-profile".
- With no game running, the controls grey out, and the game link at the top of the status screen is now a clear pill: grey with no game, amber while the game runs behind, green when it's in front.
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
