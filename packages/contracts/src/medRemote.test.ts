// T3 Med: the public address of remote access, the link built from it, and what a remote browser may do.
import { assert, describe, it } from "vite-plus/test";

import { AuthStandardClientScopes } from "./auth.ts";
import { MED_REMOTE_CLIENT_SCOPES, medRemotePairingUrl, normalizeMedRemoteAddress } from "./med.ts";

describe("normalizeMedRemoteAddress", () => {
  it("keeps an HTTPS hostname as its origin, and adds the scheme a doctor leaves out", () => {
    assert.equal(normalizeMedRemoteAddress("https://med.example.com"), "https://med.example.com");
    assert.equal(
      normalizeMedRemoteAddress("  https://Med.Example.com/  "),
      "https://med.example.com",
    );
    assert.equal(normalizeMedRemoteAddress("med.example.com"), "https://med.example.com");
    assert.equal(
      normalizeMedRemoteAddress("https://med.example.com:8443"),
      "https://med.example.com:8443",
    );
  });

  it("refuses anything that is not a public HTTPS hostname", () => {
    for (const text of [
      "",
      "   ",
      "http://med.example.com",
      "ftp://med.example.com",
      "https://",
      "https://localhost",
      "https://app.localhost:8443",
      "https://127.0.0.1",
      "https://192.168.1.20",
      "https://[::1]",
      "192.168.1.20",
      "https://user:secret@med.example.com",
      "https://med.example.com/pair",
      "https://med.example.com/?a=1",
      "https://med.example.com/#token=abc",
      "med example com",
      "medexample",
    ]) {
      assert.equal(normalizeMedRemoteAddress(text), undefined, text);
    }
  });
});

describe("medRemotePairingUrl", () => {
  it("is upstream's pairing link on the public address, with the token after the hash", () => {
    assert.equal(
      medRemotePairingUrl("https://med.example.com", "ABCD2345EFGH"),
      "https://med.example.com/pair#token=ABCD2345EFGH",
    );
  });
});

describe("MED_REMOTE_CLIENT_SCOPES", () => {
  it("lets a remote browser read and work in chats and patient pages, and nothing else", () => {
    assert.deepEqual(
      [...MED_REMOTE_CLIENT_SCOPES],
      ["orchestration:read", "orchestration:operate"],
    );
  });

  it("is a part of what upstream's own pairing link grants", () => {
    const standard: ReadonlyArray<string> = AuthStandardClientScopes;
    for (const scope of MED_REMOTE_CLIENT_SCOPES) assert.include(standard, scope);
    assert.isBelow(MED_REMOTE_CLIENT_SCOPES.length, standard.length);
  });
});
