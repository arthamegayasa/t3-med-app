// T3 Med: the desktop window loads from its own scheme, so every call it makes to the server is
// cross-origin and a browser asks first (CORS preflight). A method missing from the allowed list
// fails in the installed app only, as "Transport error", while same-origin browser tests pass.
import { MedHttpApi, MedRemoteHttpApi } from "@t3tools/contracts/med";
import * as HttpApi from "effect/http-api/HttpApi";
import type * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { assert, it } from "@effect/vitest";

import { browserApiCorsAllowedMethods } from "../httpCors.ts";

const methodsOf = <Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
): ReadonlyArray<string> => {
  const methods = new Set<string>();
  HttpApi.reflect(api, {
    onGroup: () => {},
    onEndpoint: ({ endpoint }) => {
      methods.add(endpoint.method);
    },
  });
  return [...methods].toSorted();
};

it("allows the desktop window every method the patient routes use", () => {
  const allowed: ReadonlyArray<string> = browserApiCorsAllowedMethods;
  const used = [...methodsOf(MedHttpApi), ...methodsOf(MedRemoteHttpApi)];
  assert.isAbove(used.length, 0);
  assert.deepStrictEqual(
    used.filter((method) => !allowed.includes(method)),
    [],
  );
});
