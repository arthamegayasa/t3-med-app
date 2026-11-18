# T3 Med naming rules, and taking an upstream release

T3 Med is a fork that must stay cheap to update from T3 Code. So it renames as little as it can: what a doctor reads and where the data lives are T3 Med's; everything a merge, a client or a stored file depends on keeps the name upstream gave it. [FORK.md](FORK.md) lists every edit to an upstream file.

## What keeps upstream's name

Never rename these, in upstream code or in fork code that refers to them.

| What                                | Examples                                                                                                                                                              | Why it stays                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Package scope and package names     | `@t3tools/contracts`, `@t3tools/web`, the server package `t3`                                                                                                         | Every import names them. A rename touches thousands of lines that upstream edits daily                 |
| Environment variables               | `T3CODE_HOME`, `T3CODE_TELEMETRY_ENABLED`, `T3CODE_RELEASE_BASE_URL`, `T3CODE_DESKTOP_UPDATE_REPOSITORY`                                                              | Upstream's code, scripts and docs read them by name                                                    |
| The CLI                             | The command `t3`, its subcommands and flags, its help text                                                                                                            | `start-t3-med.cmd` and upstream's own tooling call it; the help text is upstream's to reword           |
| The pairing and connection protocol | `/pair#token=…`, the `t3code://` app links (pairing, prompt, Codex sign-in), `/.well-known/t3/environment`, the RPC and HTTP contracts, the MCP server and tool names | Upstream's desktop and mobile clients, and agents, connect by them                                     |
| Persisted keys and files            | `statev2.sqlite`, localStorage keys, client settings ids, thread details item ids, right panel surface kinds, keybinding command ids                                  | Data written by one version is read by the next. A renamed key silently loses a setting                |
| Internal names                      | Span and service names (`t3code-server`), lint rules (`t3code/…`), Vite plugin names, the `.t3` folder of a dev worktree                                              | Nobody but a maintainer sees them, and upstream's tooling matches on them                              |
| A string an upstream test asserts   | `Sent by T3 Code` (`QueuedRunsControl.browser.test.tsx`), `MESSAGE_AUTHOR` (`turnDetailAnnouncement.test.ts`)                                                         | Changing it means editing upstream's test, a second place to conflict. Leave it and list it in FORK.md |
| Links to upstream's documentation   | The FAQ and troubleshooting links, the GitHub star prompt, the triage flow                                                                                            | They describe upstream's product and are true of it                                                    |

## What carries T3 Med's identity

| What               | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Rule                                                                                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The visible name   | `APP_BASE_NAME` in `apps/web/src/branding.ts`, the title in `apps/web/index.html`, the base name in `apps/web/vite.config.ts`, `BRAND_WORD` in `apps/web/src/med/t3med.ts`                                                                                                                                                                                                                                                                                       | Change the string, never the symbol. Where upstream writes `T3 Code` in a sentence a doctor meets, use `APP_BASE_NAME` if the file can import it, else the words `T3 Med`                                                                             |
| The data directory | `~/.t3med`, in `apps/server/src/os-jank.ts`, `apps/server/src/cli/browser.ts` and `apps/desktop/src/app/DesktopStatePaths.ts`                                                                                                                                                                                                                                                                                                                                    | Never `~/.t3`: a real T3 Code install on the same machine must not share state with patients' data                                                                                                                                                    |
| Patient data       | `t3med.sqlite` and its `t3med_migrations` table, `/api/med` (remote access under `/api/med/remote`), the `patient_*` tools, the `med-*` surface kinds                                                                                                                                                                                                                                                                                                            | New names in fork-owned code may say `med` or `patient`                                                                                                                                                                                               |
| Update sources     | `packages/shared/src/medRelease.ts`: the release repository, the `med-v` tag prefix and the version scheme. `CLI_RELEASE_REPOSITORY` in `packages/shared/src/cliRelease.ts`, `RELEASES_URL` in `apps/desktop/src/app/DesktopStartupRecovery.ts`, the release links of `apps/web/src/components/desktopUpdate.logic.ts` and the packaged update feed (`scripts/med/desktop-package.ts`) read it; `MED_UPDATE_REFUSAL` in `apps/server/src/med/updates.ts` refuses | They name `arthamegayasa/t3-med-app` or refuse. No source may name `pingdotgg/t3code` as a place to fetch a build from: see Updates in FORK.md                                                                                                        |
| Telemetry          | Off unless `T3CODE_TELEMETRY_ENABLED=true`                                                                                                                                                                                                                                                                                                                                                                                                                       | Patient chats must not feed upstream's analytics                                                                                                                                                                                                      |
| Icons              | `assets/med`, drawn by `assets/med/make-icons.py`; the desktop packaging reads them through `scripts/med/desktop-package.ts`                                                                                                                                                                                                                                                                                                                                     | Upstream's image files under `assets/` and `apps/web/public` stay as they are: `icons:check` compares them with their sources                                                                                                                         |
| The desktop app    | `scripts/lib/med-identity.ts`: product name, app id `com.arthamegayasa.t3med`, package name `t3med`, window scheme `t3med`, profile folder, port 3900                                                                                                                                                                                                                                                                                                            | Never upstream's value: T3 Code runs on the same machine. See The desktop app in FORK.md                                                                                                                                                              |
| What is hidden     | One-line conditions on `T3MED` (`apps/web/src/med/t3med.ts`), one call into `apps/web/src/med/medHidden.ts` or `medStoredState.ts`, which hold the lists, or one import swapped for a fork file of the same name                                                                                                                                                                                                                                                 | Hide, never delete: `false` must give upstream's chrome back. An upstream test file is never edited: a test of a hidden control is listed in `apps/web/src/med/medSkippedTests.ts`, and a test of behaviour that is still live gets a fork-owned twin |

Fork code lives in `med/` folders (`apps/server/src/med/`, `apps/web/src/med/`, `apps/server/src/mcp/toolkits/patient/`, `packages/contracts/src/med.ts`, `apps/desktop/src/med/`, `packages/provider-acp/src/server/med/`, `packages/provider-grok/src/server/med/` (a test), `scripts/med/`, `assets/med/`; `scripts/lib/med-identity.ts` sits beside upstream's script libraries because both the app and the packaging compile that folder) and each file's first comment starts with `T3 Med:`. An edit to an upstream file is one import and one line where it can be, shaped so the formatter does not re-indent upstream's code: a second argument to a call that wraps a long list re-flowed 150 lines of `RightPanelTabs.tsx`, and a separate hook name did not.

## Taking an upstream release

Done about once a month, from a stable tag. This is the routine as it was run for `v0.1.10`.

1. **Fetch.** `git fetch upstream --tags`. Pick the newest tag with no `-nightly` or `-preview` suffix. The working tree must be clean and `med` pushed.
2. **Branch.** `git checkout -b med-upstream-<version> med`. `med` is not touched until the end.
3. **Merge.** `git merge --no-ff --no-commit v<version>`. A merge commit, never a rebase or a squash: the next merge needs upstream's history as an ancestor.
4. **Resolve each conflict** by taking upstream's side and re-applying the fork's edit from FORK.md's table on top. The files that conflicted at `v0.1.10`, and will again:

   | File                                               | Resolution                                                                                                                                                                                  |
   | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `apps/server/src/mcp/McpHttpServer.ts`             | Keep both sides' imports, and `layerPatientToolkit` beside whatever upstream added to `layerTools`                                                                                          |
   | `apps/server/src/provider/agentContextBudget.json` | Upstream's side (`git checkout --theirs`), then re-measure in step 8                                                                                                                        |
   | `apps/web/index.html`                              | Upstream's block, with `<title>T3 Med</title>`                                                                                                                                              |
   | `apps/web/src/branding.ts`                         | Upstream's lines, with `"T3 Med"` as the base name                                                                                                                                          |
   | `apps/web/src/routeTree.gen.ts`                    | Did not conflict at `v0.1.10`. If it does: upstream's side, and the build in step 7 writes the patient routes back                                                                          |
   | Any other file in FORK.md's table                  | Upstream's side, then the one-line edit the table describes. If the edit no longer earns its conflict, drop it and say so in FORK.md: `ChatComposer.tsx` lost its placeholder edit this way |

5. **Check that every fork edit survived**, conflict or not. A clean merge can still drop one when upstream moved the code around it. Go down FORK.md's table; these find most of it:

   ```sh
   grep -rn "T3MED\b" apps/web/src --include=*.tsx --include=*.ts | grep -v "src/med/"
   grep -rn "med/medHidden\|med/medStoredState\|med/medDefaults\|med/medFontPreviews\|med/MedNoWorkspace" apps/web/src --include=*.tsx --include=*.ts | grep -v "src/med/"
   grep -rn "med/MedThreadDetailsPanel\|med/MedAuthorizedClientsAction\|med/medAgentOpenedPreviews\|med/MedSidebarPatient" apps/web/src --include=*.tsx --include=*.ts | grep -v "src/med/"
   grep -n "medSkippedTests.setup" apps/web/vite.config.ts
   grep -n "medPolicy" apps/server/src/policy/ManagedPolicy.ts
   grep -n "isPatientToolApproval" apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts
   grep -n "patientToolDisposition" packages/provider-acp/src/server/adapter.ts
   grep -n "refuseFeedbackUpload" apps/server/src/ws.ts
   grep -n "MED_HIDES_" apps/desktop/src/window/DesktopApplicationMenu.ts
   grep -n '"Beta"' apps/web/src/components/settings/settingsSearch.ts
   grep -n '"Orchid"' packages/shared/src/themePalettes.ts
   grep -rn "T3 Med Web\|T3 Med Desktop" apps/web/src/connection/clientMetadata.ts apps/desktop/src/backend/DesktopLocalEnvironmentAuth.ts
   grep -rn "~/med/\|/med/" apps/web/src/components apps/web/src/rightPanelStore.ts apps/server/src/server.ts apps/server/src/cli/update.ts apps/server/src/mcp/McpHttpServer.ts | grep import
   grep -rn "t3med" apps/server/src/os-jank.ts apps/server/src/cli/browser.ts apps/desktop/src/app/DesktopStatePaths.ts
   grep -rn "arthamegayasa" packages/shared/src apps/desktop/src
   grep -rn "medRelease" packages/shared/package.json packages/shared/src/cliRelease.ts apps/desktop/src/app/DesktopStartupRecovery.ts apps/web/src/components/desktopUpdate.logic.ts scripts/med/desktop-package.ts
   grep -n "medUpdateDialog" apps/desktop/src/window/DesktopApplicationMenu.ts
   grep -n "|| T3MED\|T3MED ? \[\] : machines" apps/web/src/components/sidebar/useUpdateEverything.ts
   grep -n "layerMed" apps/desktop/src/main.ts
   grep -n "medTakesMockFeed" apps/desktop/src/updates/DesktopUpdates.ts
   grep -n "medUpdateButtonTooltip\|medRestartQuestion\|medUpdateWording" apps/web/src/components/desktopUpdate.logic.ts
   grep -n "announceMedUpdateReady" apps/web/src/components/desktopUpdate.toast.tsx
   grep -n "MedUpdateReady" apps/web/src/components/sidebar/SidebarChrome.tsx
   grep -n "MED_INSTALL_LABEL\|medUpdateRowText" apps/web/src/components/settings/SettingsPanels.tsx
   head -3 README.md
   grep -n "med/MedAboutVersionTitle" apps/web/src/components/settings/SettingsPanels.tsx
   grep -rn "med/identity\|med/workspace\|med/remote" apps/desktop/src --include=*.ts | grep -v "src/med/"
   grep -n "med/medPermissionUpdateNotice\|med/medAgentOpenedPreviews" apps/web/src/appInit.tsx
   grep -n "patientWording" apps/web/src/components/auth/PairingRouteSurface.tsx
   grep -n "t3med" apps/server/src/httpCors.ts apps/server/src/cliCompileCache.ts packages/shared/src/providerAuthReturnUrl.ts
   grep -n '"productName": "T3 Med"' apps/desktop/package.json
   grep -n "MED_\|medStagePackageJson\|applyMedWebIcons" scripts/build-desktop-artifact.ts
   ```

6. **Look at what upstream added** that these rules cover, since nothing fails when a new one appears:

   ```sh
   git diff med..v<version> --stat | tail -1
   grep -rn "pingdotgg" apps/server/src apps/desktop/src apps/web/src packages/*/src | grep -v "\.test\.\|testkit"
   grep -rn "T3 Code" apps/web/src/components/chat apps/web/src/components/ChatView.tsx apps/web/src/components/sidebar apps/web/index.html apps/web/vite.config.ts | grep -v "test\."
   ```

   A new release source or update prompt is closed as in FORK.md's Updates. A new `T3 Code` a doctor meets is renamed. At `v0.1.10` this found the build-time title stamp in `vite.config.ts` and the heading of the new sent-message row.

   Then updates, which a merge can reopen without failing anything:

   ```sh
   git diff med..v<version> --stat -- apps/desktop/src/updates apps/desktop/src/electron/ElectronUpdater.ts patches/electron-updater*.patch scripts/build-desktop-artifact.ts apps/web/src/components/desktopUpdate.logic.ts
   grep -rn "setFeedURL\|provider: \"" apps/desktop/src scripts/build-desktop-artifact.ts | grep -v "\.test\."
   git diff med..v<version> --name-status -- .github/workflows .github/actions/setup-ci-deps
   gh workflow list -R arthamegayasa/t3-med-app --all
   ```

   - **The feed.** The first two show whether upstream gave the updater a new place to read from (a second provider, a mirror, a CDN, a fallback) or changed how a check picks a release. Whatever it is, the packaged feed stays the fork's alone: `medStagePackageJson` overrides `publish`, and step 11 reads the package. A new feed that is set at run time, as `T3CODE_DESKTOP_MOCK_UPDATES` and a managed policy's `feedUrl` are, is closed or listed under Updates in FORK.md. T3 Med's own behaviour wraps upstream's update service in `apps/desktop/src/med/updates.ts`: when upstream changes `DesktopUpdates.ts` or how `main.ts` builds it, run `apps/desktop/src/med/updates.test.ts`, which drives upstream's own test harness, and read the change for a new state the background download should react to. `README.md` conflicts when upstream edits its top: take upstream's text and put the T3 Med section back above it.
   - **The workflow.** `med-release.yml` uses upstream's `./.github/actions/setup-ci-deps` and runs upstream's `scripts/build-desktop-artifact.ts` through `build-t3-med-installer.cmd`. When either changed, read the change, and expect the first release after the merge to need a second look.
   - **New workflows.** A workflow file upstream added (`A` in the third command) arrives enabled in the fork. After `med` is pushed, disable each one: `gh workflow disable <file> -R arthamegayasa/t3-med-app`. The last command must list `T3 Med release` as the only `active` workflow.

   Then the things a patient workspace hides. Nothing fails when upstream adds a new page, a new slash command of its own, or a new way to send a thread somewhere, so read the release for them:

   ```sh
   git diff med..v<version> -- apps/web/src/components/settings/settingsSearch.ts apps/web/src/components/CommandPalette.tsx apps/web/src/components/chat/useComposerMenuItems.ts packages/contracts/src/keybindings.ts | grep '^+'
   git diff med..v<version> --stat -- apps/server/src/mcp/toolkits packages/contracts/src/rpc.ts
   grep -rn "share\|export\|upload\|feedback" --include=*.ts -il apps/server/src/ws.ts apps/server/src/guest packages/contracts/src/rpc.ts
   ```

   A new Settings page or row, palette action and shortcut command is decided in `medHidden.ts`, where `medHidden.test.ts` lists what stays and fails on one that is new. A new path out of the machine goes in FORK.md's table of them. A change to pairing, sessions or scopes (`git diff med..v<version> --stat -- apps/server/src/auth packages/contracts/src/auth.ts`) is read against FORK.md's Remote access: `apps/server/src/med/remoteAccess.test.ts` runs upstream's own sign-in and fails when a rule there moved. A new right-panel surface kind is dropped from saved state unless it is added to `KEPT_SURFACE_KINDS` (`medStoredState.ts`).

7. **Install and build.** `vp i` when `pnpm-lock.yaml` changed, then `vp run --filter t3 build`. The build writes `routeTree.gen.ts`; `git status` shows whether it differs from what was merged.
8. **Re-measure the context budget.** In `apps/server`: `vp test run src/provider/AgentContextBudget.test.ts`. Set `agentContextBudget.json` to the values the failure prints; the tool list is upstream's number plus the patient tools.
9. **Fix what upstream's changes ask of fork code.** The checks say what. At `v0.1.10`: `McpToolAccess` began to refuse caller-only tools that outside clients are offered, so the patient tools gained `hiddenFromOutsideClients`; and `resolveDefaultProjectRef` gained an argument that `PatientHomePage.tsx` now passes.
10. **Run the checks.**

    ```sh
    vp run --filter t3 typecheck
    vp run --filter @t3tools/web typecheck
    cd apps/server && vp test run src/med src/mcp/toolkits/patient src/provider/AgentContextBudget.test.ts src/cli/update.test.ts src/cloud/selfUpdate.test.ts
    cd apps/server && vp test run src/policy src/serverSettings.test.ts src/orchestration-v2/Adapters/CodexAdapterV2.test.ts src/orchestration-v2/Adapters/GrokAdapterV2.test.ts
    cd packages/provider-acp && vp test run --config ../../vite.config.ts --dir . src/server/med
    cd packages/provider-grok && vp test run --config ../../vite.config.ts --dir . src/server/med
    cd apps/desktop && vp test run src/med src/window/DesktopApplicationMenu.test.ts src/updates
    cd packages/shared && vp test run --config ../../vite.config.ts --dir . src/medRelease.test.ts src/cliRelease.test.ts
    cd packages/contracts && vp test run --config ../../vite.config.ts --dir . src/medRemote.test.ts
    cd scripts && vp test run --config ../vite.config.ts --dir . med
    cd apps/web && vp test run --project unit
    cd apps/web && vp test run --project browser
    vp run check:changed v<version>
    ```

    `check:changed` against the tag checks exactly the fork's difference from upstream. Some upstream tests fail on Windows whatever the fork does and are not a reason to stop: the `boot service install` cases and `serviceProtection.test.ts` in `apps/server/src/cloud`, the `.deb` case and the two update-restart-marker cases in `apps/desktop/src/updates/DesktopUpdates.test.ts`, and the `t3.cmd` case in `scripts/install.test.ts`. They failed the same way on `med` before the merge. One upstream test fails because of the fork itself: `apps/web/src/components/chat/DraftHeroHeadline.browser.test.tsx` (new in `v0.1.10`) looks for the project picker of the draft hero, which `T3MED` replaces with `MedDraftHero`. It is listed in `apps/web/src/med/medSkippedTests.ts`, as is every other upstream test of a control T3 Med hides.

    **Read the skip list's failures.** Upstream's test files are taken as they come: a conflict in one is always resolved to upstream's side. After a merge the whole web unit project and the whole browser project are run, not a chosen few, because the list is checked file by file:
    - A file that fails with `medSkippedTests.ts names tests that <file> no longer has` holds a case upstream renamed or removed. Find it in upstream's file and fix the entry's name, or drop the entry if the case is gone.
    - A test that fails because it looks for something hidden is a new case of a hidden control: add it to the list with its reason. One that tests behaviour that is still live is not listed: make it pass, or list it and write its twin in a `medLive.*.browser.test.tsx`.
    - `medHidden.test.ts` fails when upstream renames or removes an id or a sentence the fork names, or adds a Settings page, a palette action or a shortcut command. Each failure says which: decide on it in `medHidden.ts`.
    - `medLive.welcome.browser.test.tsx` carries a copy of upstream's harness from `WelcomePage.import.browser.test.tsx`. When that file's top changed, regenerate the copy (everything above upstream's first `it(`, with the import paths moved from `components/onboarding` to `med`).

11. **Build the desktop app.** `build-t3-med-installer.cmd --keep-stage`. Upstream's desktop tests that name the scheme, the profile folder or the display name conflict or fail after a merge: take upstream's side, then put the fork's names back (FORK.md's table lists the files; `t3code://app` becomes `t3med://app`, while links such as `t3code://new` stay). In `apps/desktop`, `vp test run` must fail only where it failed on `med` before the merge. Then read the package in the kept stage folder: its `package.json` must say `com.arthamegayasa.t3med` and a `publish` of one entry, the fork's (`"owner":"arthamegayasa","repo":"t3-med-app"`), and `win-unpacked\resources\app-update.yml` must name that owner and repository and nothing else. `node scripts/med/verify-update-package.ts --version 0.1.9 --installer release\T3-Med-0.1.9-x64.exe --latest-yml release\latest.yml --app-update-yml <stage>\app\dist\win-unpacked\resources\app-update.yml --app-asar <stage>\app\dist\win-unpacked\resources\app.asar --stage <stage>` checks the package the way the release workflow does: the feed, the metadata, the packaged version and the installer's configuration (it also asks for the installer's name to match the version, so pass the version the build printed). Start the unpacked app on a temporary `T3CODE_HOME` and `APPDATA`, never on `~/.t3med`, and delete the stage folder afterwards.
12. **Look at it.** Start the built server on a temporary `--base-dir` and a port other than 3899, never on `~/.t3med`. Open Patients, a patient's page, and a chat with the Labs surface, and try `t3 update`: it must refuse. Walk every Settings page, the `/` menu, the command palette and a new draft's permission mode: they should name no project, branch, terminal, diff or other machine, and a new draft should say Supervised. `t3 serve` takes no `--auto-bootstrap-project-from-cwd` since `v0.1.10`; the plain `t3` command that `start-t3-med.cmd` runs still does.
13. **Commit, then move `med`.** Commit the merge as `Merge upstream v<version> into med`, with the conflicts and their resolutions in the message: the release notes read the upstream version from that subject. Green: `git checkout med && git merge --ff-only med-upstream-<version> && git push origin med`. Not green: push the branch with what fails written down, and leave `med` where it was.
14. **Record it.** Update the tag in FORK.md's Branches and remotes, `MED_UPSTREAM_VERSION` in `packages/shared/src/medRelease.ts` (the About page and the release notes show it; `scripts/med/upstream-version.test.ts`, part of step 10's `med` tests, fails until it names the merged tag), and any row of FORK.md's table that changed.
15. **Release it,** when the doctor should have it: FORK.md, Updates, Releasing. The first release after a merge is the one to watch to the end.
