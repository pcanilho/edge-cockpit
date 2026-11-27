# Microsoft Store package

Every App workflow run builds `Edge-Cockpit-<version>.msix` (artifact `edge-cockpit-msix`), installs a test-signed copy on the runner and checks that the app starts from it. Releases on GitHub are unchanged.

The package is unsigned: the Store signs MSIX packages itself, so no certificate is needed. It can't be installed outside the Store as it is.

## Submitting

1. Open a Partner Center account and reserve the name **Edge Cockpit**.
2. Under Product identity, copy `Package/Identity/Name`, `Package/Identity/Publisher` and `Package/Properties/PublisherDisplayName` into the repository variables `MSIX_NAME`, `MSIX_PUBLISHER` and `MSIX_PUBLISHER_NAME`.
3. Run the App workflow, download `edge-cockpit-msix` and upload the `.msix` to a new submission (product type MSIX).
4. Justify the restricted capabilities: `runFullTrust` (desktop app: sends keys to the game, reads Game.log) and `unvirtualizedResources` (writes `GRPC_CLIENT_SERVER_ENABLED` to the user environment so the game turns on its telemetry API).

Listing rules: no "Star Citizen" in the title or search terms, no ship art in screenshots, privacy policy URL `https://pcanilho.github.io/edge-cockpit/privacy.html`, and a note that this is an unofficial fan app.

## What differs in the Store copy

- No self-update: the Store updates it.
- Start with Windows uses the package's startup task (Settings > Apps > Startup).
- Game link on Windows 10: the app shows the `setx` command to run; Windows 11 works as usual.
- The phone server's firewall rules come with the package, so Windows doesn't ask.
- Settings live in the package's own storage and go when it's removed.
