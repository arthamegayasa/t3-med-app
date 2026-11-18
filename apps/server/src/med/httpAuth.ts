/**
 * T3 Med: how every `/api/med` route signs in. Upstream's own middleware, the one that guards
 * `/api/projects` and `/api/orchestration`, wrapped so that no answer, a refusal included, may
 * be kept by a cache: each one is patient data, or says who may reach it.
 */
import { EnvironmentAuthenticatedAuth } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpServerResponse } from "effect/http";
import * as HttpEffect from "effect/http/HttpEffect";

import { layerAuthenticatedAuth } from "../auth/http.ts";

const forbidStoring = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(HttpServerResponse.setHeader(response, "cache-control", "no-store")),
);

// Every route runs this middleware first, so a refusal carries the header as an answer does.
export const layerAuth = Layer.effect(
  EnvironmentAuthenticatedAuth,
  Effect.gen(function* () {
    const authenticate = yield* EnvironmentAuthenticatedAuth;
    return (httpEffect, options) =>
      forbidStoring.pipe(Effect.andThen(authenticate(httpEffect, options)));
  }),
).pipe(Layer.provide(layerAuthenticatedAuth));
