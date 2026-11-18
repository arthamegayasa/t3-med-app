// T3 Med: a remote browser's own scopes are not an outdated grant, and nobody is told they are.
import { sessionHasLegacyPermissions } from "@t3tools/contracts";
import { MED_REMOTE_CLIENT_SCOPES } from "@t3tools/contracts/med";
import type { AnyRouter } from "@tanstack/react-router";
import { expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import { startPermissionUpdateNotices } from "./medPermissionUpdateNotice";

it("is what upstream would call an outdated grant, which is why the notice is off", () => {
  expect(
    sessionHasLegacyPermissions({
      authenticated: true,
      scopes: [...MED_REMOTE_CLIENT_SCOPES],
      permissions: [...MED_REMOTE_CLIENT_SCOPES],
    }),
  ).toBe(true);
});

it("starts nothing and shows no toast", () => {
  const add = vi.spyOn(toastManager, "add");
  const stop = startPermissionUpdateNotices({} as AnyRouter);
  expect(add).not.toHaveBeenCalled();
  expect(() => stop()).not.toThrow();
  add.mockRestore();
});
