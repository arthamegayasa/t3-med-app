/**
 * T3 Med: no upstream release is ever installed over the fork. T3 Med takes upstream's work by
 * merging a release tag (docs/t3-med/BRANDING.md), so every path that would download a build
 * and switch this machine to it is refused here with one message.
 */
import { ServerSelfUpdateError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerSelfUpdate } from "../cloud/selfUpdate.ts";

// Typed `string` so the code after each refusal stays live: an empty text gives upstream's update back.
export const MED_UPDATE_REFUSAL: string =
  "T3 Med is not updated by this command. It is a fork of T3 Code and takes new releases by merging upstream into its own source, then rebuilding (docs/t3-med/BRANDING.md). Nothing was downloaded or changed.";

const refuse = () => Effect.fail(new ServerSelfUpdateError({ reason: MED_UPDATE_REFUSAL }));

/** A `ServerSelfUpdate` that tells every client that asks for an update no. */
export const layerNoSelfUpdate = Layer.succeed(
  ServerSelfUpdate,
  ServerSelfUpdate.of({ update: refuse, commitDesktopUpdate: refuse }),
);

/** What `server.ts` provides in place of upstream's self-update layer, which it is handed. */
export const medSelfUpdate = <E, R>(
  upstream: Layer.Layer<ServerSelfUpdate, E, R>,
): Layer.Layer<ServerSelfUpdate, E, R> =>
  MED_UPDATE_REFUSAL === "" ? upstream : layerNoSelfUpdate;
