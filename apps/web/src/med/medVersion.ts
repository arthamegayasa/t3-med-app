/**
 * T3 Med: what Settings > About says the running build is. A release carries its own version,
 * `<year>.<month>.<release>`, injected at build time from the release tag. A build made from the
 * source checkout (the browser version, or a local installer build) carries upstream's manifest
 * version, which is not a T3 Med version and is not shown as one.
 */
import { MED_UPSTREAM_VERSION, isMedReleaseVersion } from "@t3tools/shared/medRelease";

export interface MedVersionDescription {
  /** What stands after `Version`. */
  readonly label: string;
  /** The upstream release this build's source was last merged from. */
  readonly builtOn: string;
  /** What the copy button puts on the clipboard, for a bug report. */
  readonly copyText: string;
}

export function describeMedVersion(appVersion: string): MedVersionDescription {
  const builtOn = `built on T3 Code ${MED_UPSTREAM_VERSION}`;
  return isMedReleaseVersion(appVersion)
    ? { label: appVersion, builtOn, copyText: `T3 Med ${appVersion} (${builtOn})` }
    : {
        label: "from source",
        builtOn,
        copyText: `T3 Med from source (${builtOn}; manifest ${appVersion})`,
      };
}
