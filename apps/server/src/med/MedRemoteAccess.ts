/**
 * T3 Med: remote access (docs/t3-med/REMOTE.md). The public address a tunnel answers at, kept as
 * `remote` in the desktop app's settings file, and the one-time link that pairs another
 * computer's browser. The server stays on loopback; nothing here listens anywhere.
 */
import {
  MED_DESKTOP_SETTINGS_FILE,
  MED_REMOTE_ADDRESS_RULE,
  MED_REMOTE_CLIENT_SCOPES,
  MedRefusedError,
  type MedRemoteAccess as MedRemoteAccessState,
  type MedRemotePairingLink,
  type MedRemoteSetting,
  medRemotePairingUrl,
  normalizeMedRemoteAddress,
  parseMedDesktopSettings,
  parseMedRemoteSetting,
} from "@t3tools/contracts/med";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";

/** How a paired browser is named in the list of clients. */
const MED_REMOTE_CLIENT_LABEL = "Remote browser";

const MED_UNREADABLE_SETTINGS = `The address was not saved: ${MED_DESKTOP_SETTINGS_FILE} in T3 Med's data folder is not valid JSON. Correct that file, or delete it, then save the address again.`;

export class MedRemoteSettingsFileError extends Schema.TaggedError<MedRemoteSettingsFileError>()(
  "MedRemoteSettingsFileError",
  { step: Schema.Literals(["read", "write"]), cause: Schema.Defect() },
) {
  override get message(): string {
    return `T3 Med could not ${this.step} its remote access setting.`;
  }
}

export class MedRemoteAccess extends Context.Service<
  MedRemoteAccess,
  {
    readonly read: Effect.Effect<MedRemoteAccessState, MedRemoteSettingsFileError>;
    /** Sets the public address, or with null turns remote access off. */
    readonly setAddress: (
      address: string | null,
    ) => Effect.Effect<MedRemoteAccessState, MedRefusedError | MedRemoteSettingsFileError>;
    readonly createPairingLink: Effect.Effect<
      MedRemotePairingLink,
      MedRefusedError | MedRemoteSettingsFileError | EnvironmentAuth.ServerAuthInternalError
    >;
  }
>()("t3/med/MedRemoteAccess") {}

// Indented, so the doctor's helper can read and edit the file by hand.
const settingsText = (settings: Record<string, unknown>): string =>
  `${JSON.stringify(settings, null, 2)}\n`;

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settingsPath = path.join(config.stateDir, MED_DESKTOP_SETTINGS_FILE);

  // Only the step is logged: the file holds a folder path and the doctor's own hostname.
  const failFile = (step: "read" | "write") => (cause: unknown) =>
    Effect.logError("T3 Med remote access setting failed", { step }).pipe(
      Effect.andThen(Effect.fail(new MedRemoteSettingsFileError({ step, cause }))),
    );

  /** The file's text, or undefined while there is no file. */
  const readText = fs.readFileString(settingsPath).pipe(
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound" ? Effect.undefined : failFile("read")(error),
    }),
  );

  // Beside the file, then moved onto it: a write that stops halfway leaves the old file whole.
  const temporaryPath = `${settingsPath}.tmp`;
  const writeText = (text: string) =>
    fs.makeDirectory(config.stateDir, { recursive: true }).pipe(
      Effect.andThen(fs.writeFileString(temporaryPath, text)),
      Effect.andThen(fs.rename(temporaryPath, settingsPath)),
      Effect.onError(() => Effect.ignore(fs.remove(temporaryPath, { force: true }))),
      Effect.catchTags({ PlatformError: failFile("write") }),
    );

  const describe = (remote: MedRemoteSetting): MedRemoteAccessState => ({
    address: remote.address,
    port: config.port,
    keptPort: remote.address === null ? null : remote.port,
  });

  const read: MedRemoteAccess["Service"]["read"] = readText.pipe(
    Effect.map((text) => describe(parseMedRemoteSetting(text ?? ""))),
    Effect.withSpan("MedRemoteAccess.read"),
  );

  const setAddress: MedRemoteAccess["Service"]["setAddress"] = Effect.fn(
    "MedRemoteAccess.setAddress",
  )(function* (input) {
    const address = input === null ? null : normalizeMedRemoteAddress(input);
    if (address === undefined) {
      return yield* new MedRefusedError({ reason: MED_REMOTE_ADDRESS_RULE });
    }
    const text = yield* readText;
    const settings = text === undefined ? {} : parseMedDesktopSettings(text);
    if (settings === undefined) {
      // Nothing is set in a file that cannot be read, so turning off has nothing to take out.
      if (address === null) return describe({ address: null, port: null });
      // Writing would drop whatever else the file holds, the workspace folder among it.
      return yield* new MedRefusedError({ reason: MED_UNREADABLE_SETTINGS });
    }
    const { remote: _previous, ...rest } = settings;
    // The port in use now is the one the tunnel is pointed at, so the app keeps it.
    const remote = address === null ? null : { address, port: config.port };
    if (remote !== null || "remote" in settings) {
      yield* writeText(settingsText(remote === null ? rest : { ...rest, remote }));
    }
    return describe(remote ?? { address: null, port: null });
  });

  const createPairingLink: MedRemoteAccess["Service"]["createPairingLink"] = Effect.gen(
    function* () {
      const { address } = parseMedRemoteSetting((yield* readText) ?? "");
      if (address === null) {
        return yield* new MedRefusedError({
          reason: "Set the public address before making a link.",
        });
      }
      const issued = yield* serverAuth
        .issuePairingCredential({
          scopes: MED_REMOTE_CLIENT_SCOPES,
          label: MED_REMOTE_CLIENT_LABEL,
        })
        .pipe(
          Effect.catchTags({
            ManagedPolicyRefusedError: (error) =>
              Effect.fail(new MedRefusedError({ reason: error.message })),
          }),
        );
      return {
        id: issued.id,
        url: medRemotePairingUrl(address, issued.credential),
        expiresAt: issued.expiresAt,
        scopes: [...MED_REMOTE_CLIENT_SCOPES],
      };
    },
  ).pipe(Effect.withSpan("MedRemoteAccess.createPairingLink"));

  return MedRemoteAccess.of({ read, setAddress, createPairingLink });
});

export const layer = Layer.effect(MedRemoteAccess, make);
