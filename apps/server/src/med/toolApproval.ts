/**
 * T3 Med: a thread that asks before it acts still files without asking. Codex asks to run an MCP
 * tool through an elicitation; this says which of those are a patient tool of T3 Med's own
 * server. Anything else, another server's tool or another kind of request, still asks.
 */
import { isPatientToolCall } from "@t3tools/contracts/med";

const CODEX_TOOL_CALL_APPROVAL = "mcp_tool_call";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Whether a Codex elicitation is its own approval prompt for one patient tool call. The server
 * name is Codex's, and the tool name is the one Codex puts in the approval's metadata.
 */
export const isPatientToolApproval = (payload: {
  readonly serverName: string;
  readonly _meta?: unknown;
}): boolean =>
  isRecord(payload._meta) &&
  payload._meta.codex_approval_kind === CODEX_TOOL_CALL_APPROVAL &&
  isPatientToolCall(payload.serverName, payload._meta.tool_name);
