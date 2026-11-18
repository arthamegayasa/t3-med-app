// T3 Med: the Remote access dialog in Settings > Sharing & access.
import "~/index.css";

import type { MedRemoteAccess } from "@t3tools/contracts/med";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { MedRemoteAccessAction } from "./MedRemoteAccess";
import { callMedRemote } from "./medRemote";

vi.mock("./medRemote", () => ({ callMedRemote: vi.fn() }));

const LINK = "https://med.example.com/pair#token=ABCD2345EFGH";

// The dialog's calls, answered in the order it makes them.
function answer(...values: ReadonlyArray<unknown>) {
  const call = vi.mocked(callMedRemote);
  call.mockReset();
  for (const value of values) call.mockResolvedValueOnce({ ok: true, value });
  return call;
}

const access = (fields: Partial<MedRemoteAccess> = {}): MedRemoteAccess => ({
  address: null,
  port: 3900,
  keptPort: null,
  ...fields,
});

const link = {
  id: "link-1",
  url: LINK,
  expiresAt: DateTime.makeUnsafe("2026-11-18T05:39:00.000Z"),
  scopes: ["orchestration:read", "orchestration:operate"],
};

it("offers no link until a public address is saved, and names the tunnel's target", async () => {
  const call = answer(access());
  await using screen = await render(<MedRemoteAccessAction />);

  await screen.getByRole("button", { name: "Remote access" }).click();

  await expect.element(page.getByText(/http:\/\/127\.0\.0\.1:3900/)).toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Create link" })).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Turn off" })).not.toBeInTheDocument();
  expect(call).toHaveBeenCalledTimes(1);
});

it("refuses an address that is not an HTTPS hostname without asking the server", async () => {
  const call = answer(access());
  await using screen = await render(<MedRemoteAccessAction />);
  await screen.getByRole("button", { name: "Remote access" }).click();

  await page.getByLabelText("Public address").fill("http://192.168.1.20:3900");
  await page.getByRole("button", { name: "Save" }).click();

  await expect.element(page.getByText(/must be an HTTPS hostname/)).toBeInTheDocument();
  expect(call).toHaveBeenCalledTimes(1);
});

it("saves the address, then makes a link and shows it once", async () => {
  const saved = access({ address: "https://med.example.com", keptPort: 3900 });
  const call = answer(access(), saved, link);
  await using screen = await render(<MedRemoteAccessAction />);
  await screen.getByRole("button", { name: "Remote access" }).click();

  await page.getByLabelText("Public address").fill("med.example.com");
  await page.getByRole("button", { name: "Save" }).click();
  await expect
    .element(page.getByLabelText("Public address"))
    .toHaveValue("https://med.example.com");

  await page.getByRole("button", { name: "Create link" }).click();
  await expect.element(page.getByLabelText("One-time link")).toHaveValue(LINK);
  await expect.element(page.getByText(/Works once/)).toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "New link" })).toBeInTheDocument();
  expect(call).toHaveBeenCalledTimes(3);
});

it("says when the tunnel points at a port T3 Med could not take", async () => {
  answer(access({ address: "https://med.example.com", port: 3901, keptPort: 3900 }));
  await using screen = await render(<MedRemoteAccessAction />);

  await screen.getByRole("button", { name: "Remote access" }).click();

  await expect.element(page.getByText(/tunnel points at port 3900/)).toBeInTheDocument();
  await expect.element(page.getByText(/T3 Med is on port 3901/)).toBeInTheDocument();
});

it("turns remote access off, which takes the link away with the address", async () => {
  const call = answer(access({ address: "https://med.example.com", keptPort: 3900 }), access());
  await using screen = await render(<MedRemoteAccessAction />);
  await screen.getByRole("button", { name: "Remote access" }).click();

  await page.getByRole("button", { name: "Turn off" }).click();

  await expect.element(page.getByLabelText("Public address")).toHaveValue("");
  await expect.element(page.getByRole("button", { name: "Create link" })).not.toBeInTheDocument();
  expect(call).toHaveBeenCalledTimes(2);
});

it("shows the server's refusal and keeps the dialog usable", async () => {
  const call = answer(access());
  call.mockResolvedValueOnce({
    ok: false,
    message: "Set the public address before making a link.",
  });
  await using screen = await render(<MedRemoteAccessAction />);
  await screen.getByRole("button", { name: "Remote access" }).click();

  await page.getByLabelText("Public address").fill("med.example.com");
  await page.getByRole("button", { name: "Save" }).click();

  await expect
    .element(page.getByText("Set the public address before making a link."))
    .toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Save" })).toBeEnabled();
});
