/**
 * T3 Med: the routes the patient pages read. Each handler checks the session's scope, calls
 * one `PatientStore` method and maps its failure; the contract's schemas drop every store
 * field the pages do not show.
 */
import { AuthOrchestrationReadScope, EnvironmentAuthenticatedAuth } from "@t3tools/contracts";
import { MedHttpApi, MedPatientNotFoundError } from "@t3tools/contracts/med";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpServerResponse } from "effect/http";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  layerAuthenticatedAuth,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as PatientStore from "./PatientStore.ts";

// Only the step is logged: the cause of a failed statement can carry what it was given.
const failStore = Effect.fnUntraced(function* (error: PatientStore.PatientStoreError) {
  yield* Effect.logError("patient store failed for a med route", { operation: error.operation });
  return yield* failEnvironmentInternal("internal_error");
});

const failMissingPatient = (error: PatientStore.PatientNotFoundError) =>
  Effect.fail(new MedPatientNotFoundError({ patientId: error.patientId }));

const layerHandlers = HttpApiBuilder.group(
  MedHttpApi,
  "patients",
  Effect.fnUntraced(function* (handlers) {
    const store = yield* PatientStore.PatientStore;
    return handlers
      .handle(
        "list",
        Effect.fn("med.patients.list")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const patients = yield* store
            .listPatients()
            .pipe(Effect.catchTags({ PatientStoreError: failStore }));
          return { patients };
        }),
      )
      .handle(
        "home",
        Effect.fn("med.patients.home")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* store.getPatientHome(args.params.patientId).pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              PatientNotFoundError: failMissingPatient,
            }),
          );
        }),
      )
      .handle(
        "needsYou",
        Effect.fn("med.patients.needsYou")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* store
            .listNeedsYou()
            .pipe(Effect.catchTags({ PatientStoreError: failStore }));
        }),
      )
      .handle(
        "upcoming",
        Effect.fn("med.patients.upcoming")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const plans = yield* store.listUpcomingPlans().pipe(
            Effect.catchTags({
              PatientStoreError: failStore,
              // No range is given, so neither can be refused.
              InvalidDateError: (error) => Effect.die(error),
              DateRangeError: (error) => Effect.die(error),
            }),
          );
          return { plans };
        }),
      )
      .handle(
        "counts",
        Effect.fn("med.patients.counts")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* store.getCounts().pipe(Effect.catchTags({ PatientStoreError: failStore }));
        }),
      )
      .handle(
        "threadPatient",
        Effect.fn("med.patients.threadPatient")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const patient = yield* store
            .getThreadPatient(args.params.threadId)
            .pipe(Effect.catchTags({ PatientStoreError: failStore }));
          return { patient: Option.getOrNull(patient) };
        }),
      );
  }),
);

const forbidStoring = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(HttpServerResponse.setHeader(response, "cache-control", "no-store")),
);

// Every route runs this middleware first, so a refusal carries the header as an answer does.
const layerAuth = Layer.effect(
  EnvironmentAuthenticatedAuth,
  Effect.gen(function* () {
    const authenticate = yield* EnvironmentAuthenticatedAuth;
    return (httpEffect, options) =>
      forbidStoring.pipe(Effect.andThen(authenticate(httpEffect, options)));
  }),
).pipe(Layer.provide(layerAuthenticatedAuth));

/**
 * The routes, signed in by the middleware that guards upstream's own HTTP API. No answer may
 * be kept by a cache: each one is patient data.
 */
export const layer = HttpApiBuilder.layer(MedHttpApi).pipe(
  Layer.provide(layerHandlers),
  Layer.provide(layerAuth),
);
