# Security

## Reporting a vulnerability

Please report a vulnerability privately through [GitHub's private vulnerability reporting](https://github.com/pcanilho/edge-cockpit/security/advisories/new), not in a public issue.

Useful details: the Edge Cockpit version, what an attacker could do, and steps to reproduce.

What happens next:

- You get a reply within 7 days.
- A confirmed issue is fixed in a new release, usually within 30 days, sooner when it is serious.
- Disclosure is coordinated: the advisory is published once the fix is out, or after 90 days at the latest, and you are credited unless you'd rather not be.

## Supported versions

Only the latest release gets fixes. Edge Cockpit updates itself, so most people are on it.

## What the app can do

- Sends key presses and mouse wheel turns to Star Citizen, only while the game is the window in front (unless Test mode is on).
- Reads Star Citizen's `Game.log` and `actionmaps.xml`, and writes one keybind profile into the game's folder.
- Reads `Documents\Edge Cockpit\ships.json` if you create it, and keeps its own settings in your user profile.
- Adds itself to Windows sign-in (HKCU Run) when "Start with Windows" is on.
- Talks to the network only to fetch ship outlines from FleetYards.net, to check GitHub releases for updates, and, while the World page shows, to read commodity prices from UEX (api.uexcorp.space) and server status from status.robertsspaceindustries.com. Updates are signed and checked against a key built into the app before they install.
- The console's web view has a strict content security policy and only the app's own commands. It loads no remote code.

## Verifying a download

Each release lists SHA-256 checksums and a VirusTotal scan, and carries a build provenance attestation, signed with Sigstore by GitHub Actions. Check it with the GitHub CLI:

```sh
gh attestation verify Edge-Cockpit-<version>-setup.exe --repo pcanilho/edge-cockpit
```

The same attestation is attached to the release as `edge-cockpit-<version>.sigstore.json`, and the setup's update signature as `Edge-Cockpit-<version>-setup.exe.sig`.
