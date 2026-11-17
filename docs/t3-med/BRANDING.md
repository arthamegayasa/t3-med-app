# T3 Med naming rules, and taking an upstream release

T3 Med is a fork that must stay cheap to update from T3 Code. So it renames as little as it can: what a doctor reads and where the data lives are T3 Med's; everything a merge, a client or a stored file depends on keeps the name upstream gave it. [FORK.md](FORK.md) lists every edit to an upstream file.

## What keeps upstream's name

Never rename these, in upstream code or in fork code that refers to them.

| What                                | Examples                                                                                                                             | Why it stays                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Package scope and package names     | `@t3tools/contracts`, `@t3tools/web`, the server package `t3`                                                                        | Every import names them. A rename touches thousands of lines that upstream edits daily                 |
| Environment variables               | `T3CODE_HOME`, `T3CODE_TELEMETRY_ENABLED`, `T3CODE_RELEASE_BASE_URL`, `T3CODE_DESKTOP_UPDATE_REPOSITORY`                             | Upstream's code, scripts and docs read them by name                                                    |
| The CLI                             | The command `t3`, its subcommands and flags, its help text                                                                           | `start-t3-med.cmd` and upstream's own tooling call it; the help text is upstream's to reword           |
| The pairing and connection protocol | `/pair#token=…`, the `t3code://` app link, `/.well-known/t3/environment`, the RPC and HTTP contracts, the MCP server and tool names  | Upstream's desktop and mobile clients, and agents, connect by them                                     |
| Persisted keys and files            | `statev2.sqlite`, localStorage keys, client settings ids, thread details item ids, right panel surface kinds, keybinding command ids | Data written by one version is read by the next. A renamed key silently loses a setting                |
| Internal names                      | Span and service names (`t3code-server`), lint rules (`t3code/…`), Vite plugin names, the `.t3` folder of a dev worktree             | Nobody but a maintainer sees them, and upstream's tooling matches on them                              |
| A string an upstream test asserts   | `Sent by T3 Code` (`QueuedRunsControl.browser.test.tsx`), `MESSAGE_AUTHOR` (`turnDetailAnnouncement.test.ts`)                        | Changing it means editing upstream's test, a second place to conflict. Leave it and list it in FORK.md |
| Links to upstream's documentation   | The FAQ and troubleshooting links, the GitHub star prompt, the triage flow                                                           | They describe upstream's product and are true of it                                                    |

## What carries T3 Med's identity

| What               | Where                                                                                                                                                                                         | Rule                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The visible name   | `APP_BASE_NAME` in `apps/web/src/branding.ts`, the title in `apps/web/index.html`, the base name in `apps/web/vite.config.ts`, `BRAND_WORD` in `apps/web/src/med/t3med.ts`                    | Change the string, never the symbol. Where upstream writes `T3 Code` in a sentence a doctor meets, use `APP_BASE_NAME` if the file can import it, else the words `T3 Med` |
| The data directory | `~/.t3med`, in `apps/server/src/os-jank.ts`, `apps/server/src/cli/browser.ts` and `apps/desktop/src/app/DesktopStatePaths.ts`                                                                 | Never `~/.t3`: a real T3 Code install on the same machine must not share state with patients' data                                                                        |
| Patient data       | `t3med.sqlite` and its `t3med_migrations` table, `/api/med`, the `patient_*` tools, the `med-*` surface kinds                                                                                 | New names in fork-owned code may say `med` or `patient`                                                                                                                   |
| Update sources     | `CLI_RELEASE_REPOSITORY` in `packages/shared/src/cliRelease.ts`, `RELEASES_URL` in `apps/desktop/src/app/DesktopStartupRecovery.ts`, `MED_UPDATE_REFUSAL` in `apps/server/src/med/updates.ts` | They name `arthamegayasa/t3-med-app` or refuse. No source may name `pingdotgg/t3code`: see Updates in FORK.md                                                             |
| Telemetry          | Off unless `T3CODE_TELEMETRY_ENABLED=true`                                                                                                                                                    | Patient chats must not feed upstream's analytics                                                                                                                          |
| Icons              | Still upstream's                                                                                                                                                                              | When T3 Med has its own, replace the image files in place under the names they have; do not rename or re-reference them                                                   |
| What is hidden     | One-line conditions on `T3MED` (`apps/web/src/med/t3med.ts`)                                                                                                                                  | Hide, never delete: `false` must give upstream's chrome back                                                                                                              |

Fork code lives in `med/` folders (`apps/server/src/med/`, `apps/web/src/med/`, `apps/server/src/mcp/toolkits/patient/`, `packages/contracts/src/med.ts`) and each file's first comment starts with `T3 Med:`. An edit to an upstream file is one import and one line where it can be, shaped so the formatter does not re-indent upstream's code: a second argument to a call that wraps a long list re-flowed 150 lines of `RightPanelTabs.tsx`, and a separate hook name did not.

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
   grep -rn "~/med/\|/med/" apps/web/src/components apps/web/src/rightPanelStore.ts apps/server/src/server.ts apps/server/src/cli/update.ts apps/server/src/mcp/McpHttpServer.ts | grep import
   grep -rn "t3med" apps/server/src/os-jank.ts apps/server/src/cli/browser.ts apps/desktop/src/app/DesktopStatePaths.ts
   grep -rn "arthamegayasa" packages/shared/src apps/desktop/src
   ```

6. **Look at what upstream added** that these rules cover, since nothing fails when a new one appears:

   ```sh
   git diff med..v<version> --stat | tail -1
   grep -rn "pingdotgg" apps/server/src apps/desktop/src apps/web/src packages/*/src | grep -v "\.test\.\|testkit"
   grep -rn "T3 Code" apps/web/src/components/chat apps/web/src/components/ChatView.tsx apps/web/src/components/sidebar apps/web/index.html apps/web/vite.config.ts | grep -v "test\."
   ```

   A new release source or update prompt is closed as in FORK.md's Updates. A new `T3 Code` a doctor meets is renamed. At `v0.1.10` this found the build-time title stamp in `vite.config.ts` and the heading of the new sent-message row.

7. **Install and build.** `vp i` when `pnpm-lock.yaml` changed, then `vp run --filter t3 build`. The build writes `routeTree.gen.ts`; `git status` shows whether it differs from what was merged.
8. **Re-measure the context budget.** In `apps/server`: `vp test run src/provider/AgentContextBudget.test.ts`. Set `agentContextBudget.json` to the values the failure prints; the tool list is upstream's number plus the patient tools.
9. **Fix what upstream's changes ask of fork code.** The checks say what. At `v0.1.10`: `McpToolAccess` began to refuse caller-only tools that outside clients are offered, so the patient tools gained `hiddenFromOutsideClients`; and `resolveDefaultProjectRef` gained an argument that `PatientHomePage.tsx` now passes.
10. **Run the checks.**

    ```sh
    vp run --filter t3 typecheck
    vp run --filter @t3tools/web typecheck
    cd apps/server && vp test run src/med src/mcp/toolkits/patient src/provider/AgentContextBudget.test.ts src/cli/update.test.ts src/cloud/selfUpdate.test.ts
    cd apps/web && vp test run src/med src/reactCompilerCoverage.test.ts
    cd apps/web && vp test run --project browser src/med src/components/Sidebar.browser.test.tsx src/components/chat/ChatHeader.browser.test.tsx src/components/ChatView.browser.test.tsx src/components/chat/QueuedRunsControl.browser.test.tsx
    vp run check:changed v<version>
    ```

    `check:changed` against the tag checks exactly the fork's difference from upstream. Some upstream tests fail on Windows whatever the fork does and are not a reason to stop: the `boot service install` cases and `serviceProtection.test.ts` in `apps/server/src/cloud`, the `.deb` case in `apps/desktop/src/updates/DesktopUpdates.test.ts`, and the `t3.cmd` case in `scripts/install.test.ts`. They failed the same way on `med` before the merge. One upstream test fails because of the fork itself: `apps/web/src/components/chat/DraftHeroHeadline.browser.test.tsx` (new in `v0.1.10`) looks for the project picker of the draft hero, which `T3MED` replaces with `MedDraftHero`. It is the only failure `check:changed` reported at `v0.1.10`, and it is not yet decided whether to quarantine it or leave it red.

11. **Look at it.** Start the built server on a temporary `--base-dir` and a port other than 3899, never on `~/.t3med`. Open Patients, a patient's page, and a chat with the Labs surface, and try `t3 update`: it must refuse. `t3 serve` takes no `--auto-bootstrap-project-from-cwd` since `v0.1.10`; the plain `t3` command that `start-t3-med.cmd` runs still does.
12. **Commit, then move `med`.** Commit the merge with the conflicts and their resolutions in the message. Green: `git checkout med && git merge --ff-only med-upstream-<version> && git push origin med`. Not green: push the branch with what fails written down, and leave `med` where it was.
13. **Record it.** Update the tag in FORK.md's Branches and remotes, and any row of its table that changed.
