/**
 * T3 Med: no upstream release is ever installed over the fork, and the server never replaces
 * itself. The desktop app updates as a whole from T3 Med's own releases, through its own updater;
 * the browser version is the source checkout. So every path that would download a server build
 * and switch this machine to it is refused here with one message, which says how T3 Med updates.
 */
import { ServerSelfUpdateError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerSelfUpdate } from "../cloud/selfUpdate.ts";

// Typed `string` so the code after each refusal stays live: an empty text gives upstream's update back.
export const MED_UPDATE_REFUSAL: string =
  'T3 Med is not updated by this command. The desktop app updates itself from T3 Med\'s own releases: it downloads a new version by itself and then offers "Restart to update" in its sidebar, and Settings > About > Check for Updates looks for one at once. The browser version (start-t3-med.cmd) runs from the source checkout and is updated by pulling and rebuilding it (docs/t3-med/FORK.md, Updates). Nothing was downloaded or changed.';

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
