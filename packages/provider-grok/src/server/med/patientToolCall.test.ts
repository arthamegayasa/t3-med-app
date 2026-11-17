import { isPatientToolCall } from "@t3tools/contracts/med";
import {
  type AcpToolCallState,
  extractMcpToolCallIdentity,
  mergeToolCallState,
  parseSessionUpdateEvent,
} from "@t3tools/provider-acp/server/runtimeModel";
import { describe, expect, it } from "vite-plus/test";

import { normalizeXAiAcpToolCallState } from "../xaiAcpExtension.ts";

// Grok calls an MCP tool through its `use_tool` built-in. These are the updates Grok 1.0.77
// sends for one call (upstream's fixture in `xaiAcpExtension.test.ts`), with a patient tool.
const grokUseTool = (toolName: string): AcpToolCallState => {
  const meta = { "x.ai/tool": { version: 1, name: "use_tool", kind: "use_tool" } };
  const rawInput = { tool_name: toolName, tool_input: { patientId: "inbox", title: "Labs" } };
  const toolCallId = "call-85597c6c-6fb8-4c9c-a6a8-12c4a74ebc96-1";
  const updates = [
    { sessionUpdate: "tool_call", toolCallId, title: "use_tool", rawInput, _meta: meta },
    {
      sessionUpdate: "tool_call_update",
      toolCallId,
      kind: "other",
      title: toolName,
      rawInput: { variant: "UseTool", ...rawInput },
      _meta: meta,
    },
  ];
  let state: AcpToolCallState | undefined;
  for (const update of updates) {
    const [event] = parseSessionUpdateEvent({
      sessionId: "01a0d660-c1bb-7842-91a3-02d91dc8b0d2",
      update,
    } as Parameters<typeof parseSessionUpdateEvent>[0]).events;
    if (event?._tag !== "ToolCallUpdated") throw new Error("expected a tool call update");
    state = normalizeXAiAcpToolCallState(mergeToolCallState(state, event.toolCall));
  }
  if (state === undefined) throw new Error("no tool call was tracked");
  return state;
};

describe("a patient tool called by Grok", () => {
  it("is tracked under the app's server and the tool's own name, which is what is allowed", () => {
    const tracked = grokUseTool("t3-code__patient_file");
    // The fields `patientToolDisposition` (provider-acp) decides on, as Grok's normaliser sets them.
    expect(tracked.kind).toBe("other");
    expect(tracked.command).toBeUndefined();
    expect(tracked.data.meta).toMatchObject({ is_mcp_tool_call: true });
    expect(tracked.data.rawInput).toMatchObject({ server: "t3-code", tool: "patient_file" });
    const identity = extractMcpToolCallIdentity(tracked);
    expect(identity).toEqual({ server: "t3-code", tool: "patient_file" });
    expect(isPatientToolCall(identity?.server, identity?.tool)).toBe(true);
  });

  it("is told apart from another server's tool of the same name", () => {
    const identity = extractMcpToolCallIdentity(grokUseTool("clinic-records__patient_file"));
    expect(identity).toEqual({ server: "clinic-records", tool: "patient_file" });
    expect(isPatientToolCall(identity?.server, identity?.tool)).toBe(false);
  });
});
