import { PATIENT_TOOL_NAMES } from "@t3tools/contracts/med";
import { describe, expect, it } from "vite-plus/test";

import { acpPermissionDisposition } from "../clientPolicy.ts";
import { type AcpToolCallState, extractMcpToolCallIdentity } from "../runtimeModel.ts";
import { patientToolDisposition } from "./patientToolApproval.ts";

// A tool call as the adapter tracks it once a provider's normaliser named its MCP server and
// tool: the shape `extractMcpToolCallIdentity` reads first, whichever agent sent it.
const mcpCall = (server: string, tool: string): AcpToolCallState => ({
  toolCallId: "call-1",
  kind: "other",
  title: tool,
  status: "pending",
  data: { meta: { is_mcp_tool_call: true }, rawInput: { server, tool, arguments: {} } },
});

const call = (kind: string, title: string): AcpToolCallState => ({
  toolCallId: "call-1",
  kind,
  title,
  status: "pending",
  data: { title, kind },
});

const supervised = { runtimeMode: "approval-required" as const, cwd: "/workspace" };
const permissionFor = (kind: "other" | "execute" | "edit" | "fetch") => ({
  sessionId: "session-1",
  toolCall: { toolCallId: "call-1", kind },
  options: [],
});

describe("an ACP agent's permission request in a thread that asks", () => {
  it("is asked of the doctor by upstream's policy, whatever the tool", () => {
    // What the fork starts from: only reads pass without a prompt.
    for (const kind of ["other", "execute", "edit", "fetch"] as const) {
      expect(acpPermissionDisposition(supervised, permissionFor(kind)), kind).toBe("ask");
    }
  });

  it("runs a patient tool of the app's own server without asking", () => {
    for (const tool of PATIENT_TOOL_NAMES) {
      expect(
        patientToolDisposition("ask", "approval-required", mcpCall("t3-code", tool)),
        tool,
      ).toBe("allow");
    }
  });

  it("still asks for every other call", () => {
    const stillAsks: ReadonlyArray<AcpToolCallState | undefined> = [
      // Upstream's own tools on the same server, and a patient tool's name on another server.
      mcpCall("t3-code", "terminal_run"),
      mcpCall("t3-code", "preview_open"),
      mcpCall("clinic-records", "patient_file"),
      // A shell command, a file write and a web fetch are not MCP calls at all.
      call("execute", "rm -rf notes"),
      call("edit", "Write notes.md"),
      call("fetch", "https://example.com"),
      // A command line, and a title, that only spell a patient tool's name.
      call("execute", "patient_file"),
      call("other", "mcp__t3-code__patient_file"),
      // The command-line fallback some agents call T3's tools by: it is a shell command, and a
      // shell command can say anything after it.
      {
        ...call("execute", "rm -rf notes; acp-mcp-call patient_file {}"),
        command: "rm -rf notes; acp-mcp-call patient_file {}",
      },
      call("other", "acp-mcp-call patient_file {}"),
      { ...mcpCall("t3-code", "patient_file"), kind: "execute" },
      { ...mcpCall("t3-code", "patient_file"), command: "patient_file" },
      // A request for a call the adapter never saw.
      undefined,
    ];
    // Upstream's own reader does name the command-line form as the app's tool, which is why
    // the decision does not go through it.
    expect(extractMcpToolCallIdentity(call("other", "acp-mcp-call patient_file {}"))).toEqual({
      server: "t3-code",
      tool: "patient_file",
      input: {},
    });
    for (const tracked of stillAsks) {
      expect(
        patientToolDisposition("ask", "approval-required", tracked),
        JSON.stringify(tracked),
      ).toBe("ask");
    }
  });

  it("changes nothing a policy refused, and nothing outside the asking mode", () => {
    const filing = mcpCall("t3-code", "patient_file");
    expect(patientToolDisposition("deny", "approval-required", filing)).toBe("deny");
    expect(patientToolDisposition("allow", "approval-required", filing)).toBe("allow");
    // In Auto a prompt is the provider's own classifier refusing, and must reach the doctor.
    expect(patientToolDisposition("ask", "auto", filing)).toBe("ask");
    expect(patientToolDisposition("ask", "auto-accept-edits", filing)).toBe("ask");
  });
});
