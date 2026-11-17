/**
 * T3 Med: where the fork's releases are published and how they are numbered. The one place that
 * names the release repository; the update feed, `cliRelease.ts`, every release link and the
 * release workflow read it from here. Never upstream's. See docs/t3-med/FORK.md, "Updates".
 */

export const MED_RELEASE_OWNER = "arthamegayasa";
export const MED_RELEASE_REPO = "t3-med-app";
export const MED_RELEASE_REPOSITORY = `${MED_RELEASE_OWNER}/${MED_RELEASE_REPO}`;
export const MED_RELEASES_URL = `https://github.com/${MED_RELEASE_REPOSITORY}/releases`;

/**
 * A release is the tag `med-v<version>`. Upstream's tags are `v<version>` and arrive in the same
 * checkout with every `git fetch upstream --tags`, so the fork's carry their own prefix.
 */
export const MED_RELEASE_TAG_PREFIX = "med-v";

/**
 * The upstream release `med` was last merged from (FORK.md, "Branches and remotes"). Change it in
 * the commit that records an upstream merge. The About page shows it beside T3 Med's own version.
 */
export const MED_UPSTREAM_VERSION = "0.1.10";

/**
 * electron-builder's `publish` entry. It writes this into the packaged app's `app-update.yml`,
 * the only place the installed app's updater reads its feed from: the newest release of the
 * fork's repository that is not a draft or a pre-release, and that release's `latest.yml`.
 */
export const MED_UPDATE_FEED = {
  provider: "github",
  owner: MED_RELEASE_OWNER,
  repo: MED_RELEASE_REPO,
  releaseType: "release",
} as const;

export interface MedVersion {
  readonly year: number;
  readonly month: number;
  readonly release: number;
}

// Three plain numbers, none with a leading zero: semver refuses `2026.01.1`.
const MED_VERSION_PATTERN = /^(20\d{2})\.([1-9]|1[0-2])\.([1-9]\d*)$/;

/**
 * `<year>.<month>.<release>`: `2026.11.2` is the second release of November 2026. A plain semver
 * with no pre-release part, which would sort below its own release (`1.0.0-med.2` < `1.0.0`) and
 * name an update channel to electron-builder. Not derived from upstream's version.
 */
export function parseMedVersion(version: string): MedVersion | null {
  const match = MED_VERSION_PATTERN.exec(version);
  if (match === null) return null;
  return { year: Number(match[1]), month: Number(match[2]), release: Number(match[3]) };
}

/** False for a build made from source without a release tag, whose version is upstream's. */
export const isMedReleaseVersion = (version: string): boolean => parseMedVersion(version) !== null;

const formatMedVersion = (version: MedVersion): string =>
  `${version.year}.${version.month}.${version.release}`;

/** Negative when `left` is the older release. The order semver gives the same two versions. */
export function compareMedVersions(left: MedVersion, right: MedVersion): number {
  return left.year - right.year || left.month - right.month || left.release - right.release;
}

export const medReleaseTag = (version: string): string => `${MED_RELEASE_TAG_PREFIX}${version}`;

/** The version a tag or a `refs/tags/...` ref releases, or null when it is not a T3 Med tag. */
export function medVersionOfTag(tagOrRef: string): string | null {
  const tag = tagOrRef.replace(/^refs\/tags\//, "");
  if (!tag.startsWith(MED_RELEASE_TAG_PREFIX)) return null;
  const version = tag.slice(MED_RELEASE_TAG_PREFIX.length);
  return isMedReleaseVersion(version) ? version : null;
}

/** The newest version among tags; tags that are not T3 Med releases are passed over. */
export function latestMedVersion(tags: ReadonlyArray<string>): string | null {
  let latest: MedVersion | null = null;
  for (const tag of tags) {
    const version = medVersionOfTag(tag);
    const parsed = version === null ? null : parseMedVersion(version);
    if (parsed !== null && (latest === null || compareMedVersions(parsed, latest) > 0)) {
      latest = parsed;
    }
  }
  return latest === null ? null : formatMedVersion(latest);
}

/**
 * The version the next release takes: the first of this month, or one more than the newest
 * release when that one is of this month or, by a wrong clock or a hand-made tag, of a later one.
 */
export function nextMedVersion(
  latest: string | null,
  today: { readonly year: number; readonly month: number },
): string {
  const first: MedVersion = { year: today.year, month: today.month, release: 1 };
  const newest = latest === null ? null : parseMedVersion(latest);
  if (newest === null || compareMedVersions(first, newest) > 0) return formatMedVersion(first);
  return formatMedVersion({ ...newest, release: newest.release + 1 });
}

/** The page of one release, or the list of releases for a build that is not one. */
export const medReleaseUrl = (version: string): string =>
  isMedReleaseVersion(version)
    ? `${MED_RELEASES_URL}/tag/${medReleaseTag(version)}`
    : MED_RELEASES_URL;
