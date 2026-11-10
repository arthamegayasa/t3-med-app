# T3 Med fork

T3 Med is T3 Code organised around patients instead of code projects, for one doctor on a Windows laptop. This file records what the fork changes in upstream files, so an upstream merge can be checked against it. Product decisions are in the workspace repo (`arthamegayasa/t3-med`, `docs/adr/`).

## Branches and remotes

- `upstream` is `pingdotgg/t3code`. Its push URL is disabled on purpose.
- `med` is T3 Med. It started from upstream tag `v0.1.8`.
- Merge upstream from stable release tags, about once a month. Nightlies move too fast to follow.

## Building on Windows

- Check out to a path **without spaces**. The web build fails under a path such as `D:\T3 Projects\…` (`UNLOADABLE_DEPENDENCY`, os error 123), because a worker entry is resolved from a URL-encoded path.
- Install `vp` (`irm https://vite.plus/ps1 | iex`), then from the repository root: `vp i`, `vp run --filter t3 build`.
- Run the built server: `node apps/server/dist/bin.mjs serve --port 3899` with the Node that `vp` provides (Node 26). It serves the web UI on that port.
- The background service does not exist on Windows; the server runs in the foreground.
- `start-t3-med.cmd` in the repository root starts the built server on port 3899 with the patient workspace (`D:\T3 Projects\T3 Med`) as its project and opens the browser. Closing its window stops T3 Med.

## Changes to upstream files

Keep this list complete. Each entry is a place an upstream merge can conflict.

| File                                            | Change                                               | Why                                             |
| ----------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| `apps/web/src/branding.ts`                      | Base name `T3 Med`                                   | Identity                                        |
| `apps/web/index.html`                           | Title and logo alt text `T3 Med`                     | Identity                                        |
| `apps/server/src/os-jank.ts`                    | Default data folder `~/.t3med`                       | Never share `~/.t3` with a real T3 Code install |
| `apps/server/src/cli/browser.ts`                | Same default folder                                  | Same                                            |
| `apps/desktop/src/app/DesktopStatePaths.ts`     | Same default folder                                  | Same                                            |
| `apps/server/src/telemetry/AnalyticsService.ts` | Telemetry off unless `T3CODE_TELEMETRY_ENABLED=true` | Patient chats must not feed upstream analytics  |

## Not done yet

- The updater still points at upstream releases. A foreground server does not self-update, but the sidebar may offer upstream's update; do not accept it.
- Icons are still upstream's.
- No patient features yet: database, patient tools for agents, sidebar, patient pages and right-panel surfaces.
