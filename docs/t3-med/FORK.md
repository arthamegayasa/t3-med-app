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
- The web client's browser tests (`*.browser.test.tsx`) need Playwright's Chromium shell once: `node apps/web/node_modules/playwright/cli.js install --only-shell chromium`. Then, in `apps/web`, `vp test run --project browser <files>`.
- `start-t3-med.cmd` in the repository root starts the built server on port 3899 with the patient workspace (`D:\T3 Projects\T3 Med`) as its project and opens the browser. Closing its window stops T3 Med.

## Changes to upstream files

Keep this list complete. Each entry is a place an upstream merge can conflict.

| File                                                        | Change                                                                                                                                                                   | Why                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `apps/web/src/branding.ts`                                  | Base name `T3 Med`                                                                                                                                                       | Identity                                                                              |
| `apps/web/index.html`                                       | Title and logo alt text `T3 Med`                                                                                                                                         | Identity                                                                              |
| `apps/server/src/os-jank.ts`                                | Default data folder `~/.t3med`                                                                                                                                           | Never share `~/.t3` with a real T3 Code install                                       |
| `apps/server/src/cli/browser.ts`                            | Same default folder                                                                                                                                                      | Same                                                                                  |
| `apps/desktop/src/app/DesktopStatePaths.ts`                 | Same default folder                                                                                                                                                      | Same                                                                                  |
| `apps/server/src/telemetry/AnalyticsService.ts`             | Telemetry off unless `T3CODE_TELEMETRY_ENABLED=true`                                                                                                                     | Patient chats must not feed upstream analytics                                        |
| `apps/server/src/mcp/McpHttpServer.ts`                      | Two imports, `layerPatientToolkit` beside the other registrations, and its line in `layerTools`                                                                          | Agents reach patient data through the app's own MCP server                            |
| `apps/server/src/server.ts`                                 | Three imports, `MedHttp.layer` in the route merge, and `PatientStore.layer` over `MedDatabase.layerConfig` provided once to all routes                                   | The patient tools and the patient pages share one store                               |
| `packages/contracts/package.json`                           | A `./med` entry in `exports`                                                                                                                                             | The patient pages' contract, without editing the barrel                               |
| `apps/web/src/components/Sidebar.tsx`                       | One import and `<MedSidebarNav />` above the thread list                                                                                                                 | Inbox, Patients, Needs you and Upcoming in the sidebar                                |
| `apps/web/src/components/chat/ChatHeader.tsx`               | One import and `<MedThreadPatientCrumb />`, given the thread's environment and id, before the thread title                                                               | The linked patient in the chat header                                                 |
| `apps/web/src/routeTree.gen.ts`                             | Generated: the five patient routes                                                                                                                                       | On a conflict take upstream's, then build the web app                                 |
| `apps/server/src/provider/AgentContextBudget.test.ts`       | One import and one `Layer.mock(PatientStore)` line                                                                                                                       | Registering the patient tools needs the service                                       |
| `apps/server/src/provider/agentContextBudget.json`          | `mcpToolListJsonBytes` is upstream's value plus the patient tools (4,774 bytes)                                                                                          | The budget test measures every advertised tool                                        |
| `apps/web/src/rightPanelStore.ts`                           | One import, `...MED_SURFACE_KINDS` in the kinds, `MedSurface` in the surface union, and a `default` case in `singletonSurface`                                           | The panel store knows the four patient surfaces                                       |
| `apps/web/src/components/RightPanelTabs.tsx`                | Two imports, both launcher lists passed through `useMedSurfaceActions(...)` instead of ending in `as const`, and a `default` case in `surfaceTitle` and in `SurfaceIcon` | Patient surfaces in the launcher, the `+` menu and the tabs; coding surfaces left out |
| `apps/web/src/components/chat/RightPanelSurfaceContent.tsx` | One import and a `default` case that renders `<MedSurfaceContent />`                                                                                                     | What a patient surface shows                                                          |
| `apps/web/src/components/chat/threadDetailsItems.ts`        | One import; the list is named `ALL_THREAD_DETAILS_ITEMS` and `THREAD_DETAILS_ITEMS` is that list filtered by `showsThreadDetailsItem`                                    | No editor, script, branch, Git or changes rows in the thread details menu             |
| `apps/web/src/components/ChatView.tsx`                      | One import and `!T3MED &&` in `showComposerContextStrip`                                                                                                                 | No branch and checkout controls under the composer                                    |
| `apps/web/src/components/sidebar/SidebarChrome.tsx`         | One import, `BRAND_WORD` in the wordmark and its label, `&& !T3MED` on the pull requests item, and `T3MED ? null :` before the update pill and the architecture warning  | Wordmark `T3 Med`; no pull requests entry; never offer upstream's releases            |
| `apps/web/src/components/chat/DraftHeroHeadline.tsx`        | Two imports and one early `return <MedDraftHero />`                                                                                                                      | The empty draft asks which patient, not what to build                                 |
| `apps/web/src/components/chat/useSystemComposerBanners.tsx` | One import and `T3MED ? null :` before the version mismatch                                                                                                              | No banner offering to update the server from upstream                                 |
| `apps/web/src/components/settings/SettingsPanels.tsx`       | One import and `&& !T3MED` on the About section that carries the updater                                                                                                 | Same; the plain version row stays                                                     |
| `apps/web/src/components/ui/standalone-page.tsx`            | One import and `BRAND_WORD` in the wordmark and its label                                                                                                                | `T3 Med` on the pairing and sign-in pages                                             |
| `apps/web/src/components/onboarding/WelcomePage.tsx`        | `APP_BASE_NAME` imported and used in the title                                                                                                                           | Identity                                                                              |
| `apps/web/src/components/chat/TimelineAssistantRows.tsx`    | One import and `APP_BASE_NAME` as the heading of the app's own messages                                                                                                  | Identity                                                                              |

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
- A thread is linked to a patient in three places and nowhere else: `patient_find` when a URN matches exactly, `patient_create` (which needs a URN), and `patient_move_note`, the doctor's choice for the thread's Inbox note. Each says in `relinkedFrom` which patient the thread was linked to before. A name search returns `candidates` and links nothing. `PatientStore.linkThread` links on no evidence; no tool and no route calls it, and it must stay that way.
- `patient_find` always returns `linked`, the patient the thread is linked to once the call is done, beside any `match` or `candidates`. Called with no URN and no name it reads only that, so an agent can ask whom its thread is about without searching.
- `patient_file` with a patient id is refused unless the thread is linked to exactly that patient, and it never changes the link. Filing to `inbox` is always allowed. `patient_verify` verifies the thread's note for its linked patient only.
- Reading (`patient_record`) and `patient_update` take any patient's id. Only filing, verifying and moving depend on the thread's link.
- A retried `patient_file` adds nothing: a lab the note has (same test, date, value, text and unit) or a plan it has (same title and due date) is returned as it is. `needsYou` collects one line per question until `clearNeedsYou`.
- A refusal reaches the agent as the store's own message (`labs[1].testAsWritten must not be blank.`). A store failure names only the step that failed. A failure's message is written to the trace file with the span it ended, so store messages carry ids, never names. The one refusal that names a patient, a URN that is taken, is worded in the handler from the error's fields.
- A call's arguments stay out of the trace file. Effect's `Toolkit.handle` (`effect/src/ai/Toolkit.ts`, `Effect.annotateCurrentSpan({ tool, parameters })`) writes them on the current span, which for a real call is the HTTP request's. `layerPatientToolkit` runs patient calls under `withoutArgumentsOnSpan`: a copy of that span with the same ids that takes no attributes. Upstream's own tools still record theirs.
- After an upstream merge, `agentContextBudget.json` usually conflicts. Take either side, run `vp test run src/provider/AgentContextBudget.test.ts` in `apps/server`, and set the file to the values the failure prints. Upstream's `agent-context-budget.yml` compares a pull request with `main` and fails on growth; in this fork that growth is the patient tools.

## Patient pages

The web client reads patient data over HTTP, under `/api/med`, and only reads it. Everything is fork-owned: the contract (`packages/contracts/src/med.ts`, imported as `@t3tools/contracts/med`), the handlers (`apps/server/src/med/http.ts`), and the client (`apps/web/src/med/`, with the routes `apps/web/src/routes/_chat.{inbox,patients.index,patients.$patientId,needs-you,upcoming}.tsx`).

- **Why HTTP and not RPC.** A new RPC method is an edit to `packages/contracts/src/rpc.ts`, `ws.ts` and the client-runtime RPC layer, three files upstream changes all the time. `MedHttpApi` is its own `HttpApi`, mounted with one line in `server.ts`.
- **Signing in.** Every endpoint carries upstream's `EnvironmentAuthenticatedAuth` middleware, the one that guards `/api/projects` and `/api/orchestration`, so a cookie, a bearer token and a DPoP token are accepted and refused exactly as there, and an MCP client's session is refused. Every route is a read and needs `orchestration:read`.
- **The client never links a thread.** `MedHttpApi` has `GET` routes only, and `http.test.ts` fails when a route of another method is added. A link written from the browser is a link made on no evidence: the draft it was written for can be reused for another patient's chat.
- **No caching.** Every answer, a refusal included, carries `Cache-Control: no-store`. The header is set in a wrapper around the sign-in middleware (`layerAuth` in `http.ts`), which runs before every handler.
- **No patient text in a URL.** The request span records the full URL, query string included. So the directory is sent whole and the search runs in the browser (`filterPatients`); do not add a `?q=`. Paths carry ids only.
- **Response fields.** A handler returns what the store returns and the contract's schema drops the rest. A field a route should not give, such as `diagnoses` on a patient's home, stays out by not being in that route's schema in `med.ts`.
- **One environment.** Patient data belongs to the primary environment. `useMedEnvironmentId` (`medData.ts`) is that environment's id once the session may read there, and null until then; every patient query goes through `useMedQuery` or `useThreadPatient`, which ask nothing while it is null. So a thread of another connected environment shows no patient and is not asked about, rows that open a thread open it in the primary environment, and `New chat` uses the first project of the primary environment. Without a primary environment the pages keep their loading placeholder.
- **Freshness.** The server pushes nothing for patient data. The client reads again when a patient page is entered, when the window regains focus, and when any thread starts or stops working. What an agent files in the middle of a turn shows when the turn ends.
- **A chat started from a patient's page.** `New chat` runs upstream's own new-thread handler with its `prompt` option, the one prompt links and playbooks fill a draft's composer with. The text is one line, `URN 00-12-34-56 (Ni Made Suartini)` and a line break, which the doctor sees and can change. Nothing is linked then: the agent links the thread when the message arrives, by that URN. A patient with no URN cannot be started this way, and the button says so.
- **Earlier chats.** A patient's page lists the patient's notes and, from `thread_patients`, every linked thread that filed no note for them; such a row takes its title from the client's own thread list. `Last chat` in the directory is the latest of a patient's note changes and thread links, and a dash when there is neither.
- **Rows.** A row that opens something ends with a chevron; a row that opens nothing (a note without a thread, a plan on its own patient's page) has none. Links share `MedLink`.
- After an upstream merge, build the web app before type-checking: `routeTree.gen.ts` is written by the build.

## Patient surfaces in the right panel

A thread linked to a patient offers Summary, Labs, Plan and Timeline in the right panel's launcher and `+` menu, before Files and Side chat. Everything but the edits listed above is in `apps/web/src/med/`.

- **Kinds.** The surfaces are `med-summary`, `med-labs`, `med-plan` and `med-timeline` (`medSurfaces.ts`), one tab each per thread. Never name a kind `plan` or `agents`: `migratePersistedRightPanelState` drops saved surfaces of those kinds. The panel's state is in localStorage only, so the kinds are not part of any contract.
- **Whose patient.** The launcher belongs to the thread in the route (`useMedSurfaceActions`). A draft, a thread with no linked patient and a thread of another environment get the four rows disabled, with the reason shown the way upstream's launcher shows it for an unavailable surface. A tab left open on a thread that has no patient says the same instead of showing a record.
- **One read.** All four surfaces draw `GET /api/med/patients/:patientId/record`: the patient with diagnoses, every lab oldest first, every plan, every note. It is `PatientStore.getPatientRecord`, the method `patient_record` calls, with `testName` replaced for display.
- **Test names.** `testDisplayName` in `labs.ts` has one English name per Test ID. The route sends it as `testName`, so a catalogue row first named `Kolesterol LDL` reads `LDL cholesterol`; a test without a Test ID keeps the name as written. The agent tools still get the catalogue's name.
- **The client computes no lab number.** A result is shown as written (`valueText` and `unit`). The chart plots the baseline's own value and, for every other result, the store's `valueInBaselineUnit`; a result the store did not compare is left off the chart and counted under it. `From baseline` is the store's `changeFromBaseline`, `changePercent` and `changeUnit`, rounded for display only (`medPanelLogic.ts`).
- **The chart** (`MedLabChart.tsx`) is fork code: upstream has no chart primitive. An SVG stretched to the plot draws the lines; dots and labels are positioned in percent over it, so it follows the panel's width without being measured. A draft is a hollow dot reached by a dashed line. The height stands for at least a quarter of the largest value, so 0.9 to 1.0 does not look like 162 to 78.
- **The chosen test** is kept per patient for the session (`selectedLabTestAtom`), so it survives switching tabs. Until one is chosen the Labs surface shows the first test, A to Z, that has two points to join.
- **Narrow panel.** Below 28rem the results table folds the reference range and the draft mark under the result, so it fits the panel's minimum width.

## What a patient workspace hides

`T3MED` in `apps/web/src/med/t3med.ts` is the one switch. Every hidden piece of upstream UI reads it in a one-line condition, listed in the table above; nothing was deleted, and `false` gives upstream's chrome back.

- Launcher and `+` menu: Browser, Terminal, Diff, Pull request, Linked pull requests and Device are left out (`patientLauncherActions` keeps `Files` and `Side chat` by label). Summary takes the `S` key, so Side chat is `C`.
- Thread details menu: the editor, project scripts, branch and pull request, Git actions and changes rows. Their ids stay in client settings untouched.
- Under the composer: the environment, branch and checkout strip.
- Sidebar footer: the pull requests page entry and the update pill with its dialogs.
- Updates: also the Settings updater section (desktop and hosted builds) and the composer banner that offers to update a server whose version differs.

## Not done yet

- The updater still points at upstream releases; only its UI is hidden. Settings > Connections can still show another machine's server as out of date, and the desktop shell's own update check was not looked at.
- Icons are still upstream's.
- The patient surfaces only read. Nothing there verifies a draft, opens the Labs surface on a test picked in Summary, or shows medications or imaging.
- Nothing unlinks a thread from a patient. A thread linked to the wrong patient is corrected by giving the agent the right URN, which relinks it.
- Patient data is not pushed to the client; see Freshness above.
- The patient pages exist in the web client only. Mobile has none, and nothing was checked in the desktop shell.
- Coding features are hidden where a doctor meets them every day, not everywhere: the command palette, keybindings, Settings, the pull requests page by its URL and a thread row's pull request badge still exist, and the composer's placeholder still speaks of files and commands. `T3 Code` is still written in dialogs and settings a doctor rarely opens, and in `Sent by T3 Code`, which an upstream test asserts.
- Nothing tells an agent to use the patient tools yet: the `patient-filing` skill in the workspace repo still files to Notion.
- A filed document is recorded on its thread's note, as the note's kind and the paths of its files. It has no note of its own, and the file is not copied into the state directory.
- Nothing undoes a filing. No tool or store method un-verifies a note, corrects or deletes a filed lab or plan, marks a plan done or cancelled, or moves a note back to the Inbox or on to another patient.
- No eval covers the tool descriptions. `evals/mcp-tool-use` has no patient cases, so a change to a description or a schema is checked by reading it.
