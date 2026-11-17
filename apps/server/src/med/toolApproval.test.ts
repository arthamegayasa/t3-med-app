import { assert, describe, it } from "@effect/vitest";
import { isPatientToolCall, MED_MCP_SERVER_NAME, PATIENT_TOOL_NAMES } from "@t3tools/contracts/med";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type * as McpProviderSession from "@t3tools/provider-core/server/mcpSession";

import { PatientToolkit } from "../mcp/toolkits/patient/tools.ts";
import * as ClaudeAdapterV2 from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { isPatientToolApproval } from "./toolApproval.ts";

const SUPERVISED = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
  runtimeMode: "approval-required",
  interactionMode: "default",
  cwd: "/workspace",
});

describe("the patient tools in a thread that asks before it acts", () => {
  it("are exactly the tools the app's own MCP server registers for patients", () => {
    assert.deepStrictEqual(
      [...PATIENT_TOOL_NAMES].toSorted(),
      Object.keys(PatientToolkit.tools).toSorted(),
    );
    for (const name of PATIENT_TOOL_NAMES) {
      assert.isTrue(isPatientToolCall(MED_MCP_SERVER_NAME, name), name);
      // The same name on another MCP server is another tool.
      assert.isFalse(isPatientToolCall("clinic-records", name), name);
      assert.isFalse(isPatientToolCall("t3-code-direct", name), name);
    }
    // Upstream's own tools, a name that only starts like one, and no name at all.
    for (const tool of ["terminal_run", "preview_open", "patient_file_export", "patient", "", 7]) {
      assert.isFalse(isPatientToolCall(MED_MCP_SERVER_NAME, tool), String(tool));
    }
  });

  describe("Codex", () => {
    // The approval Codex raises for an MCP tool call: `codex_approval_kind` and `tool_name` are
    // the keys its own reviewer reads (codex-cli 0.169.0).
    const approval = (serverName: string, meta: unknown) => ({
      serverName,
      threadId: "native-thread",
      turnId: "native-turn",
      mode: "form" as const,
      message: `Allow the ${serverName} MCP server to run tool?`,
      requestedSchema: { type: "object" as const, properties: {} },
      _meta: meta,
    });
    const toolCall = (tool: unknown) => ({ codex_approval_kind: "mcp_tool_call", tool_name: tool });

    it("answers its approval for a patient tool itself, reading or writing", () => {
      for (const tool of PATIENT_TOOL_NAMES) {
        assert.isTrue(isPatientToolApproval(approval("t3-code", toolCall(tool))), tool);
      }
    });

    it("still asks for any other tool, any other server and any other kind of request", () => {
      for (const [serverName, meta] of [
        // Upstream's own tools on the same server.
        ["t3-code", toolCall("terminal_run")],
        ["t3-code", toolCall("preview_open")],
        // A patient tool's name on a server that is not the app's.
        ["clinic-records", toolCall("patient_file")],
        ["t3-code-direct", toolCall("patient_file")],
        // An app or browser access prompt, which names no tool call.
        ["t3-code", { app_name: "Safari", persist: ["session", "always"] }],
        ["t3-code", { tool_name: "patient_file" }],
        ["t3-code", { codex_approval_kind: "mcp_tool_call" }],
        ["t3-code", { codex_approval_kind: "tool_suggestion", tool_name: "patient_file" }],
        ["t3-code", toolCall(["patient_file"])],
        ["t3-code", undefined],
        ["t3-code", null],
        ["t3-code", "patient_file"],
      ] as const) {
        assert.isFalse(
          isPatientToolApproval(approval(serverName, meta)),
          `${serverName} ${JSON.stringify(meta)}`,
        );
      }
    });
  });

  describe("Claude", () => {
    const mcpSession: McpProviderSession.McpProviderSessionConfig = {
      environmentId: EnvironmentId.make("environment-med"),
      threadId: ThreadId.make("thread-med-claude"),
      providerSessionId: "mcp-session-med",
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      endpoint: "http://127.0.0.1:43123/mcp",
      authorizationHeader: "Bearer test",
      browserToolsAvailable: false,
    };

    it("asks for its own tools, and pre-approves the app's MCP server and nothing wider", () => {
      const policy = ClaudeAdapterV2.claudeRuntimeQueryPolicyForRuntimePolicy(SUPERVISED);
      // `default` is the mode in which Claude asks before Bash, Write, WebFetch and MCP tools.
      assert.strictEqual(policy.permissionMode, "default");
      assert.isTrue(policy.installPermissionCallback);
      assert.isUndefined(policy.allowedTools);

      const overrides = ClaudeAdapterV2.claudeMcpQueryOverrides({
        mcpSession,
        readOnlySandbox: false,
        ...(policy.allowedTools === undefined ? {} : { allowedTools: policy.allowedTools }),
      });
      // One rule, for one server: the patient tools are that server's.
      assert.deepStrictEqual(overrides.allowedTools, [`mcp__${MED_MCP_SERVER_NAME}__*`]);
      assert.deepStrictEqual(Object.keys(overrides.mcpServers ?? {}), [MED_MCP_SERVER_NAME]);
      const prefix = (overrides.allowedTools?.[0] ?? "").slice(0, -1);
      for (const tool of PATIENT_TOOL_NAMES) {
        assert.isTrue(`mcp__${MED_MCP_SERVER_NAME}__${tool}`.startsWith(prefix), tool);
      }
      for (const other of [
        "Bash",
        "Write",
        "Edit",
        "WebFetch",
        "mcp__clinic-records__patient_file",
      ]) {
        assert.isFalse(other.startsWith(prefix), other);
      }
    });
  });
});
