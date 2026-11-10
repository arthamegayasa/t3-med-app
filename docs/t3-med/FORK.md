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

| File                                                  | Change                                                                                                                                 | Why                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/web/src/branding.ts`                            | Base name `T3 Med`                                                                                                                     | Identity                                                   |
| `apps/web/index.html`                                 | Title and logo alt text `T3 Med`                                                                                                       | Identity                                                   |
| `apps/server/src/os-jank.ts`                          | Default data folder `~/.t3med`                                                                                                         | Never share `~/.t3` with a real T3 Code install            |
| `apps/server/src/cli/browser.ts`                      | Same default folder                                                                                                                    | Same                                                       |
| `apps/desktop/src/app/DesktopStatePaths.ts`           | Same default folder                                                                                                                    | Same                                                       |
| `apps/server/src/telemetry/AnalyticsService.ts`       | Telemetry off unless `T3CODE_TELEMETRY_ENABLED=true`                                                                                   | Patient chats must not feed upstream analytics             |
| `apps/server/src/mcp/McpHttpServer.ts`                | Two imports, `layerPatientToolkit` beside the other registrations, and its line in `layerTools`                                        | Agents reach patient data through the app's own MCP server |
| `apps/server/src/server.ts`                           | Three imports, `MedHttp.layer` in the route merge, and `PatientStore.layer` over `MedDatabase.layerConfig` provided once to all routes | The patient tools and the patient pages share one store    |
| `packages/contracts/package.json`                     | A `./med` entry in `exports`                                                                                                           | The patient pages' contract, without editing the barrel    |
| `apps/web/src/components/Sidebar.tsx`                 | One import and `<MedSidebarNav />` above the thread list                                                                               | Inbox, Patients, Needs you and Upcoming in the sidebar     |
| `apps/web/src/components/chat/ChatHeader.tsx`         | One import and `<MedThreadPatientCrumb />` before the thread title                                                                     | The linked patient in the chat header                      |
| `apps/web/src/routeTree.gen.ts`                       | Generated: the five patient routes                                                                                                     | On a conflict take upstream's, then build the web app      |
| `apps/server/src/provider/AgentContextBudget.test.ts` | One import and one `Layer.mock(PatientStore)` line                                                                                     | Registering the patient tools needs the service            |
| `apps/server/src/provider/agentContextBudget.json`    | `mcpToolListJsonBytes` is upstream's value plus the patient tools (4,692 bytes)                                                        | The budget test measures every advertised tool             |

## Patient data

Patient data lives in `t3med.sqlite`, a second SQLite file in the same state directory as upstream's database. Upstream's database is never given fork tables: its migrations are numbered, the migrator skips every id up to the highest one recorded, and a fork migration there would sooner or later take a number upstream also uses.

- Everything is under `apps/server/src/med/`: the database layer (`MedDatabase.ts`), its own migration list (`Migrations/`, recorded in the table `t3med_migrations`), the patient service (`PatientStore.ts`) and lab arithmetic (`labs.ts`). No upstream file is edited for it.
- `MedDatabase` has its own service tag, so nothing that asks for upstream's `SqlClient` can reach patient tables, and the other way round.
- The file is opened with the SQLite client directly, not through `persistence/Sqlite.ts`: that module runs upstream's migrations on whatever file it opens.
- `server.ts` provides the store once, to the whole route merge, so `/mcp` and `/api/med` share it and the file is opened once.

## Patient tools

Agents file and read patient data with the `patient_*` tools in `apps/server/src/mcp/toolkits/patient/`. Each handler calls one `PatientStore` method, so a call is one transaction: a refused lab leaves no note, plan or link behind.

- Only an agent running in a T3 Med thread may call them, reads included (`readsAsCaller`, `actsAsCaller`). An outside MCP client that signed in over OAuth is refused, whatever access it was approved with.
- The tools take no thread id and no note id. The calling thread comes from the MCP credential, so a call reaches only its own thread's notes.
- The store links a thread to a patient in three places and nowhere else: `patient_find` when a URN matches exactly, `patient_create` (which needs a URN), and `patient_move_note`, the doctor's choice for the thread's Inbox note. Each says in `relinkedFrom` which patient the thread was linked to before. A name search returns `candidates` and links nothing.
- `patient_file` with a patient id is refused unless the thread is linked to exactly that patient, and it never changes the link. Filing to `inbox` is always allowed. `patient_verify` verifies the thread's note for its linked patient only.
- Reading (`patient_record`) and `patient_update` take any patient's id. Only filing, verifying and moving depend on the thread's link.
- A retried `patient_file` adds nothing: a lab the note has (same test, date, value, text and unit) or a plan it has (same title and due date) is returned as it is. `needsYou` collects one line per question until `clearNeedsYou`.
- A refusal reaches the agent as the store's own message (`labs[1].testAsWritten must not be blank.`). A store failure names only the step that failed. A failure's message is written to the trace file with the span it ended, so store messages carry ids, never names. The one refusal that names a patient, a URN that is taken, is worded in the handler from the error's fields.
- A call's arguments stay out of the trace file. Effect's `Toolkit.handle` (`effect/src/ai/Toolkit.ts`, `Effect.annotateCurrentSpan({ tool, parameters })`) writes them on the current span, which for a real call is the HTTP request's. `layerPatientToolkit` runs patient calls under `withoutArgumentsOnSpan`: a copy of that span with the same ids that takes no attributes. Upstream's own tools still record theirs.
- After an upstream merge, `agentContextBudget.json` usually conflicts. Take either side, run `vp test run src/provider/AgentContextBudget.test.ts` in `apps/server`, and set the file to the values the failure prints. Upstream's `agent-context-budget.yml` compares a pull request with `main` and fails on growth; in this fork that growth is the patient tools.

## Patient pages

The web client reads patient data over HTTP, under `/api/med`. Everything is fork-owned: the contract (`packages/contracts/src/med.ts`, imported as `@t3tools/contracts/med`), the handlers (`apps/server/src/med/http.ts`), and the client (`apps/web/src/med/`, with the routes `apps/web/src/routes/_chat.{inbox,patients.index,patients.$patientId,needs-you,upcoming}.tsx`).

- **Why HTTP and not RPC.** A new RPC method is an edit to `packages/contracts/src/rpc.ts`, `ws.ts` and the client-runtime RPC layer, three files upstream changes all the time. `MedHttpApi` is its own `HttpApi`, mounted with one line in `server.ts`.
- **Signing in.** Every endpoint carries upstream's `EnvironmentAuthenticatedAuth` middleware, the one that guards `/api/projects` and `/api/orchestration`, so a cookie, a bearer token and a DPoP token are accepted and refused exactly as there, and an MCP client's session is refused. Reads need `orchestration:read`; linking a thread needs `orchestration:operate`.
- **No patient text in a URL.** The request span records the full URL, query string included. So the directory is sent whole and the search runs in the browser (`filterPatients`); do not add a `?q=`. Paths carry ids only.
- **Response fields.** A handler returns what the store returns and the contract's schema drops the rest. A field the pages should not get, such as `diagnoses`, stays out by not being in `med.ts`.
- **One environment.** The client asks the primary environment only, with the session the browser already holds. Threads of another connected environment show no patient.
- **Freshness.** The server pushes nothing for patient data. The client reads again when a patient page is entered, when the window regains focus, when any thread starts or stops working, and after its own write. What an agent files in the middle of a turn shows when the turn ends.
- **A chat started from a patient's page.** `New chat` runs upstream's own new-thread handler, which makes the draft and its thread id, and then posts the link for that id. The link is the doctor's channel (`PatientStore.linkThread`); agents still link by URN only.
- After an upstream merge, build the web app before type-checking: `routeTree.gen.ts` is written by the build.

## Not done yet

- The updater still points at upstream releases. A foreground server does not self-update, but the sidebar may offer upstream's update; do not accept it.
- Icons are still upstream's.
- Right-panel surfaces for a patient (Summary, Labs, Plan). The patient pages list notes and plans only; labs are not shown anywhere yet.
- Nothing unlinks a thread from a patient. `New chat` on a patient's page reuses the project's empty draft when there is one, so a draft linked there and left empty is still linked when it is later reused from the sidebar's New thread; the chat header names the patient.
- Patient data is not pushed to the client; see Freshness above.
- The patient pages exist in the web client only. Mobile has none, and nothing was checked in the desktop shell.
- Coding features (projects, pull requests, terminals) are still shown beside the patient rows.
- Nothing tells an agent to use the patient tools yet: the `patient-filing` skill in the workspace repo still files to Notion.
- A filed document is recorded on its thread's note, as the note's kind and the paths of its files. It has no note of its own, and the file is not copied into the state directory.
- Nothing undoes a filing. No tool or store method un-verifies a note, corrects or deletes a filed lab or plan, marks a plan done or cancelled, or moves a note back to the Inbox or on to another patient.
- No eval covers the tool descriptions. `evals/mcp-tool-use` has no patient cases, so a change to a description or a schema is checked by reading it.
