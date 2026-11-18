/**
 * T3 Med: a request whose `X-Forwarded-Host` differs from its `Host` is refused, on every route.
 * Upstream takes a browser's cookie from a page whose origin equals that header, so another site
 * naming itself there would pass as the app's own. REMOTE.md's tunnel keeps `Host` and sends none.
 */
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as ServerConfig from "../config.ts";

const hosts = (value: string | undefined): ReadonlyArray<string> =>
  (value ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== "");

/** True when the header is there and any host in it differs from `Host`. */
function namesForeignForwardedHost(headers: Readonly<Record<string, string | undefined>>): boolean {
  const [host] = hosts(headers.host);
  return hosts(headers["x-forwarded-host"]).some((forwarded) => forwarded !== host);
}

const refusal = HttpServerResponse.text("X-Forwarded-Host does not match Host.", {
  status: 400,
  headers: { "cache-control": "no-store" },
});

export const layer = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const request = yield* HttpServerRequest.HttpServerRequest;
      // Vite's dev proxy rewrites `Host` for some routes and names the page's host in the header.
      return config.devUrl === undefined && namesForeignForwardedHost(request.headers)
        ? refusal
        : yield* httpEffect;
    }),
  { global: true },
);
