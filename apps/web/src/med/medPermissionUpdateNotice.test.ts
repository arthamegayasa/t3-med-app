// T3 Med: a remote browser's own scopes are not an outdated grant, and nobody is told they are.
import { sessionHasLegacyPermissions } from "@t3tools/contracts";
import { MED_REMOTE_CLIENT_SCOPES } from "@t3tools/contracts/med";
import { expect, it } from "vite-plus/test";

it("is what upstream would call an outdated grant, which is why the notice is off", () => {
  expect(
    sessionHasLegacyPermissions({
      authenticated: true,
      scopes: [...MED_REMOTE_CLIENT_SCOPES],
      permissions: [...MED_REMOTE_CLIENT_SCOPES],
    }),
  ).toBe(true);
});
