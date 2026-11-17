# Security

## Reporting a vulnerability

Please report security issues privately through [GitHub's private vulnerability reporting](../../security/advisories/new), not in a public issue. You'll get a reply within a week.

Useful details: the Edge Cockpit version, what an attacker could do, and steps to reproduce.

## Supported versions

Only the latest release gets fixes. Edge Cockpit updates itself, so most people are on it.

## What the app can do

- Sends key presses and mouse wheel turns to Star Citizen, only while the game is the window in front (unless Test mode is on).
- Reads Star Citizen's `Game.log` and `actionmaps.xml`, and writes one keybind profile into the game's folder.
- Reads `Documents\Edge Cockpit\ships.json` if you create it, and keeps its own settings in your user profile.
- Adds itself to Windows sign-in (HKCU Run) when "Start with Windows" is on.
- Talks to the network only to fetch ship outlines from FleetYards.net and to check GitHub releases for updates. Updates are signed and checked against a key built into the app before they install.
- The console's web view has a strict content security policy and only the app's own commands. It loads no remote code.

## Verifying a download

Each release lists SHA-256 checksums and carries a build provenance attestation:

```sh
gh attestation verify Edge-Cockpit-<version>-setup.exe --repo pcanilho/edge-cockpit
```
