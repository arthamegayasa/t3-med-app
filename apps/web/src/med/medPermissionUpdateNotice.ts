/**
 * T3 Med: no "Permissions have changed" notice. Upstream shows it to a session that holds only
 * `orchestration:read` and `orchestration:operate`, which it reads as a grant from before its
 * scopes were split. That is exactly what a remote browser is given (docs/t3-med/REMOTE.md).
 */
import * as Upstream from "../components/PermissionUpdateNotice";
import { T3MED } from "./t3med";

const noticeNothing = () => () => {};

export const startPermissionUpdateNotices: typeof Upstream.startPermissionUpdateNotices = T3MED
  ? noticeNothing
  : Upstream.startPermissionUpdateNotices;
