import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";

// T3 Med: PUT and PATCH added; the patient and remote access routes use them (med/cors.test.ts).
export const browserApiCorsAllowedMethods = ["GET", "POST", "PUT", "PATCH", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

// T3 Med: its desktop window loads from its own scheme (scripts/lib/med-identity.ts).
export const DESKTOP_RENDERER_ORIGINS = [
  "t3code://app",
  "t3code-dev://app",
  "t3med://app",
  "t3med-dev://app",
] as const;

/** MCP refuses every browser Origin with 403, so the browser CORS layer must not answer for it. */
export const MCP_HTTP_PATH = "/mcp";
