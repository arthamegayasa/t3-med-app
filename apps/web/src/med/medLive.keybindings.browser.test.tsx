/**
 * T3 Med: the twin of upstream's "re-enables Save when a When editor closes on an expression it
 * could not parse" (`KeybindingsSettings.browser.test.tsx`), which edits the `Terminal: Toggle`
 * row. That row is not listed here; the editor behaves the same on a row that is.
 */
import { RegistryProvider } from "@effect/atom-react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";

vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: ((environments: ReadonlyArray<{ environmentId: string }>) =>
    new Set(environments.map(({ environmentId }) => environmentId))) as never,
  readEnvironmentScope: () => true,
}));
vi.mock(import("../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => vi.fn()) as never,
}));
vi.mock(import("../components/settings/SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => {
    const environment = {
      environmentId: "env",
      label: "Clinic laptop",
      serverConfig: { keybindings: [], keybindingsConfigPath: null, availableEditors: [] },
    };
    return {
      scope: { kind: "environment" },
      environment,
      environments: [environment],
      connectedEnvironments: [environment],
      targets: [],
      target: null,
    };
  }) as never,
}));

import { KeybindingsSettingsPanel } from "../components/settings/KeybindingsSettings";

it("re-enables Save when a When editor closes on an expression it could not parse", async () => {
  await using screen = await render(
    <RegistryProvider>
      <KeybindingsSettingsPanel />
    </RegistryProvider>,
  );
  // No terminal shortcut is listed, and no condition on screen names the terminal.
  expect(screen.getByRole("button", { name: /Terminal: Toggle/ }).query()).toBeNull();
  expect(document.body.textContent).not.toMatch(/terminalFocus|previewFocus/);

  const whenTrigger = screen.getByRole("button", { name: "Edit when clause for Sidebar: Toggle" });
  const expression = screen.getByRole("textbox", { name: "When expression" });

  await whenTrigger.click();
  await userEvent.type(expression, "isDesktop");
  await userEvent.type(expression, " &&");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  await userEvent.keyboard("{Escape}");
  await whenTrigger.click();

  await expect.element(expression).toHaveValue("isDesktop");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});
