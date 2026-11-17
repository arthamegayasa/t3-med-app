/**
 * T3 Med: the twin of upstream's "moves Tab through every settings section"
 * (`SettingsSidebarNav.composition.browser.test.tsx`), which expects every page of upstream's
 * navigation. Tab still walks the navigation in order, over the pages that are left.
 */
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { SettingsSidebarNav } from "../components/settings/SettingsSidebarNav";
import { SidebarProvider } from "../components/ui/sidebar";

vi.mock("../components/settings/useAvailableSettingsSearchItems", () => ({
  useAvailableSettingsSearchItems: () => [
    { id: "theme", title: "Theme", to: "/settings/appearance" },
  ],
}));

it("moves Tab through every settings page a doctor has, in order", async () => {
  await page.viewport(1280, 800);
  await using _screen = await render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname="/settings/general" />
    </SidebarProvider>,
    { router: "/settings/general" },
  );
  await userEvent.click(page.getByRole("combobox", { name: "Search settings" }));

  const tabbed: string[] = [];
  for (let step = 0; step < 30; step += 1) {
    await userEvent.tab();
    const section = document.activeElement?.closest("[data-settings-section]");
    if (!section) break;
    tabbed.push(section.textContent ?? "");
  }
  expect(tabbed).toEqual([
    "General",
    "Appearance",
    "Chat",
    "Keybindings",
    "Voice",
    "Providers",
    "Threads",
    "Sharing & access",
    "Maintenance",
    "Beta",
    "About",
    "Archive",
  ]);
  // The group that held only coding pages is gone with them.
  expect(page.getByRole("heading", { name: "Code", level: 3 }).query()).toBeNull();
});
