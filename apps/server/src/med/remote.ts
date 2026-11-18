/**
 * T3 Med: the public address a tunnel answers at (docs/t3-med/REMOTE.md) and the one-time link
 * that pairs a remote browser. Every route asks for `access:write`, which that link never
 * grants, so access is managed from the laptop only. The server stays on loopback.
 */
import { AuthAccessWriteScope } from "@t3tools/contracts";
import {
  MED_REMOTE_CLIENT_SCOPES,
  MedRefusedError,
  MedRemoteHttpApi,
  medRemotePairingUrl,
  normalizeMedRemoteAddress,
} from "@t3tools/contracts/med";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentScopeRequired,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as ServerConfig from "../config.ts";
import { layerAuth } from "./httpAuth.ts";

/** The desktop app's own settings file in the state directory (`apps/desktop/src/med`). */
export const MED_DESKTOP_SETTINGS_FILE = "t3med-desktop.json";

/** How a paired browser is named in the list of clients when the doctor gives no name. */
const MED_REMOTE_CLIENT_LABEL = "Remote browser";

interface MedRemoteSetting {
  readonly address: string;
  /** The loopback port the desktop app keeps for as long as the address is set. */
  readonly port: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPort = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65_535;

/** The settings file as an object; a file that cannot be read as one is an empty object. */
function parseMedDesktopSettings(raw: string): Record<string, unknown> {
  try {
    // Windows PowerShell 5.1 writes a byte order mark, which JSON.parse refuses.
    const parsed: unknown = JSON.parse(raw.replace(/^﻿/, ""));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The `remote` setting, or undefined when the file names no usable public address. */
function readMedRemoteSetting(settings: Record<string, unknown>): MedRemoteSetting | undefined {
  const remote = settings.remote;
  if (!isRecord(remote) || typeof remote.address !== "string") return undefined;
  const address = normalizeMedRemoteAddress(remote.address);
  if (address === undefined) return undefined;
  return { address, port: isPort(remote.port) ? remote.port : null };
}

/** The file with `remote` set or taken off, and every other setting as it was. */
function withMedRemoteSetting(
  settings: Record<string, unknown>,
  remote: { readonly address: string; readonly port: number } | null,
): Record<string, unknown> {
  const { remote: _previous, ...rest } = settings;
  return remote === null ? rest : { ...rest, remote };
}

const layerHandlers = HttpApiBuilder.group(
  MedRemoteHttpApi,
  "remote",
  Effect.fnUntraced(function* (handlers) {
    const config = yield* ServerConfig.ServerConfig;
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const settingsPath = path.join(config.stateDir, MED_DESKTOP_SETTINGS_FILE);

    // Only the step is logged: the file holds a folder path and the doctor's own hostname.
    const failFile = Effect.fnUntraced(function* (step: "read" | "write") {
      yield* Effect.logError("T3 Med remote access setting failed", { step });
      return yield* failEnvironmentInternal("internal_error");
    });

    const readSettings = fs.readFileString(settingsPath).pipe(
      Effect.map(parseMedDesktopSettings),
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed<Record<string, unknown>>({})
            : failFile("read"),
      }),
    );

    const describe = (remote: MedRemoteSetting | undefined) => ({
      address: remote?.address ?? null,
      port: config.port,
      keptPort: remote?.port ?? null,
    });

    return handlers
      .handle(
        "read",
        Effect.fn("med.remote.read")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return describe(readMedRemoteSetting(yield* readSettings));
        }),
      )
      .handle(
        "setAddress",
        Effect.fn("med.remote.setAddress")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          const address =
            args.payload.address === null ? null : normalizeMedRemoteAddress(args.payload.address);
          if (address === undefined) {
            return yield* new MedRefusedError({
              reason: "The address must be an HTTPS hostname, such as https://med.example.com.",
            });
          }
          // The port in use now is the one the tunnel is pointed at, so the app keeps it.
          const remote = address === null ? null : { address, port: config.port };
          const next = withMedRemoteSetting(yield* readSettings, remote);
          yield* fs
            .makeDirectory(config.stateDir, { recursive: true })
            .pipe(
              Effect.andThen(
                fs.writeFileString(settingsPath, `${JSON.stringify(next, null, 2)}\n`),
              ),
              Effect.catchTags({ PlatformError: () => failFile("write") }),
            );
          return describe(remote ?? undefined);
        }),
      )
      .handle(
        "createPairingLink",
        Effect.fn("med.remote.createPairingLink")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* requireEnvironmentScope(AuthAccessWriteScope);
          // Upstream's rule for any link: a session hands on only what it holds itself.
          for (const scope of MED_REMOTE_CLIENT_SCOPES) {
            if (!session.scopes.has(scope)) return yield* failEnvironmentScopeRequired(scope);
          }
          const remote = readMedRemoteSetting(yield* readSettings);
          if (remote === undefined) {
            return yield* new MedRefusedError({
              reason: "Set the public address before making a link.",
            });
          }
          const label = args.payload.label?.trim();
          const issued = yield* serverAuth
            .issuePairingCredential({
              scopes: MED_REMOTE_CLIENT_SCOPES,
              label: label === undefined || label === "" ? MED_REMOTE_CLIENT_LABEL : label,
            })
            .pipe(
              Effect.catchTags({
                ManagedPolicyRefusedError: (error) =>
                  Effect.fail(new MedRefusedError({ reason: error.message })),
              }),
              Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
                failEnvironmentInternal("pairing_credential_issuance_failed", error),
              ),
            );
          return {
            id: issued.id,
            url: medRemotePairingUrl(remote.address, issued.credential),
            expiresAt: issued.expiresAt,
            scopes: [...MED_REMOTE_CLIENT_SCOPES],
          };
        }),
      );
  }),
);

/** The remote access routes, signed in like the patient routes. */
export const layer = HttpApiBuilder.layer(MedRemoteHttpApi).pipe(
  Layer.provide(layerHandlers),
  Layer.provide(layerAuth),
);
