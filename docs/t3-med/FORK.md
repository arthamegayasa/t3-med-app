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

| File                                                  | Change                                                                                          | Why                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/web/src/branding.ts`                            | Base name `T3 Med`                                                                              | Identity                                                   |
| `apps/web/index.html`                                 | Title and logo alt text `T3 Med`                                                                | Identity                                                   |
| `apps/server/src/os-jank.ts`                          | Default data folder `~/.t3med`                                                                  | Never share `~/.t3` with a real T3 Code install            |
| `apps/server/src/cli/browser.ts`                      | Same default folder                                                                             | Same                                                       |
| `apps/desktop/src/app/DesktopStatePaths.ts`           | Same default folder                                                                             | Same                                                       |
| `apps/server/src/telemetry/AnalyticsService.ts`       | Telemetry off unless `T3CODE_TELEMETRY_ENABLED=true`                                            | Patient chats must not feed upstream analytics             |
| `apps/server/src/mcp/McpHttpServer.ts`                | Two imports, and the patient toolkit as one line in `layerTools`                                | Agents reach patient data through the app's own MCP server |
| `apps/server/src/server.ts`                           | Two imports, and `PatientStore.layer` over `MedDatabase.layerConfig` provided to the MCP server | The patient tools need the store                           |
| `apps/server/src/provider/AgentContextBudget.test.ts` | One import and one `Layer.mock(PatientStore)` line                                              | Registering the patient tools needs the service            |
| `apps/server/src/provider/agentContextBudget.json`    | `mcpToolListJsonBytes` is upstream's value plus the patient tools (4,051 bytes when added)      | The budget test measures every advertised tool             |

## Patient data

Patient data lives in `t3med.sqlite`, a second SQLite file in the same state directory as upstream's database. Upstream's database is never given fork tables: its migrations are numbered, the migrator skips every id up to the highest one recorded, and a fork migration there would sooner or later take a number upstream also uses.

- Everything is under `apps/server/src/med/`: the database layer (`MedDatabase.ts`), its own migration list (`Migrations/`, recorded in the table `t3med_migrations`), the patient service (`PatientStore.ts`) and lab arithmetic (`labs.ts`). No upstream file is edited for it.
- `MedDatabase` has its own service tag, so nothing that asks for upstream's `SqlClient` can reach patient tables, and the other way round.
- The file is opened with the SQLite client directly, not through `persistence/Sqlite.ts`: that module runs upstream's migrations on whatever file it opens.
- `server.ts` provides the store to the MCP server only. A second transport that needs it (WebSocket, HTTP) moves that one `Layer.provide` to where both can share it, so the file is opened once.

## Patient tools

Agents file and read patient data with the `patient_*` tools in `apps/server/src/mcp/toolkits/patient/`. Each handler calls one `PatientStore` method, so a filing is one transaction: a refused lab leaves no note, plan or link behind.

- Only an agent running in a T3 Med thread may call them, reads included (`readsAsCaller`, `actsAsCaller`). An outside MCP client that signed in over OAuth is refused, whatever access it was approved with.
- The tools take no thread id. The calling thread comes from the MCP credential, so a note cannot be filed under another thread.
- A thread is linked to a patient by `patient_file` with a patient id and by `patient_move_note`. `patient_find` returns a name's patients as `candidates`, never as `match`; nothing in code stops an agent from filing to a candidate's id, so the tool descriptions carry that rule.
- A refusal reaches the agent as the store's own message (`labs[1].testAsWritten must not be blank.`). A store failure names only the step that failed.
- After an upstream merge, `agentContextBudget.json` usually conflicts. Take either side, run `vp test run src/provider/AgentContextBudget.test.ts` in `apps/server`, and set the file to the values the failure prints. Upstream's `agent-context-budget.yml` compares a pull request with `main` and fails on growth; in this fork that growth is the patient tools.

## Not done yet

- The updater still points at upstream releases. A foreground server does not self-update, but the sidebar may offer upstream's update; do not accept it.
- Icons are still upstream's.
- Patient features beyond the store and the agent tools: sidebar, patient pages and right-panel surfaces.
- Nothing tells an agent to use the patient tools yet: the `patient-filing` skill in the workspace repo still files to Notion.
- A filed document is recorded on its thread's note, as the note's kind and the paths of its files. It has no note of its own, and the file is not copied into the state directory.
- No tool corrects or removes one filed lab or plan, or marks a plan done or cancelled. Filing the same result twice makes two rows.
- A filed lab returns its change from baseline but not the baseline itself; an agent reads that from `patient_record`.
