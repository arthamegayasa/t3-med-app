/**
 * T3 Med: a thread that asks before it acts still files without asking. An ACP agent (Grok, and
 * the others on this adapter) asks permission per tool call; this lifts "ask" to "allow" for a
 * patient tool of T3 Med's own MCP server, in the asking mode only, and for nothing else.
 */
import type { RuntimeMode } from "@t3tools/contracts";
import { isPatientToolCall } from "@t3tools/contracts/med";

import type { AcpPermissionDisposition } from "../clientPolicy.ts";
import type { AcpToolCallState } from "../runtimeModel.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Only a call the provider itself marked as an MCP call, with its server and tool as fields.
// `extractMcpToolCallIdentity` also reads titles and `acp-mcp-call` command lines, which a
// shell command can spell; those must keep asking.
const isPatientMcpCall = (tracked: AcpToolCallState): boolean => {
  const { meta, rawInput } = tracked.data;
  return (
    tracked.kind !== "execute" &&
    tracked.command === undefined &&
    isRecord(meta) &&
    meta.is_mcp_tool_call === true &&
    isRecord(rawInput) &&
    isPatientToolCall(rawInput.server, rawInput.tool)
  );
};

/**
 * `tracked` is the call as the adapter already holds it, in the shape the provider's own
 * normaliser gave it. A refusal stays a refusal, and so does a prompt in Auto, where it is the
 * provider's classifier refusing.
 */
export const patientToolDisposition = (
  disposition: AcpPermissionDisposition,
  runtimeMode: RuntimeMode,
  tracked: AcpToolCallState | undefined,
): AcpPermissionDisposition =>
  disposition === "ask" &&
  runtimeMode === "approval-required" &&
  tracked !== undefined &&
  isPatientMcpCall(tracked)
    ? "allow"
    : disposition;
