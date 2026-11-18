// T3 Med: the public address of remote access, the link built from it, and what a remote browser may do.
import { assert, describe, it } from "vite-plus/test";

import { AuthStandardClientScopes } from "./auth.ts";
import {
  MED_REMOTE_CLIENT_SCOPES,
  medRemotePairingUrl,
  normalizeMedRemoteAddress,
  parseMedDesktopSettings,
  parseMedRemoteSetting,
} from "./med.ts";

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

describe("the desktop settings file", () => {
  const file = (remote: unknown) => JSON.stringify({ workspace: "E:/Clinic", remote });

  it("is read as an object, with or without a byte order mark", () => {
    assert.deepEqual(parseMedDesktopSettings(`\uFEFF${file(null)}`), {
      workspace: "E:/Clinic",
      remote: null,
    });
    for (const raw of ["", "not json", "[]", "3", "null", '{"workspace": "E:/Clinic"']) {
      assert.equal(parseMedDesktopSettings(raw), undefined, raw);
    }
  });

  it("names the public address and the kept port", () => {
    assert.deepEqual(
      parseMedRemoteSetting(file({ address: "https://med.example.com", port: 3901 })),
      { address: "https://med.example.com", port: 3901 },
    );
    // Turned off: the port a tunnel was pointed at is remembered, the address is gone.
    assert.deepEqual(parseMedRemoteSetting(file({ port: 3901 })), { address: null, port: 3901 });
  });

  it("names no address the server would refuse, and no port that is not one", () => {
    for (const remote of [undefined, null, "https://med.example.com", [], {}]) {
      assert.deepEqual(parseMedRemoteSetting(file(remote)), { address: null, port: null });
    }
    assert.deepEqual(parseMedRemoteSetting("not json"), { address: null, port: null });
    for (const address of ["", "http://med.example.com", "https://192.168.1.20", 7]) {
      assert.equal(parseMedRemoteSetting(file({ address, port: 3901 })).address, null);
    }
    for (const port of [undefined, "3901", 0, 70_000, 3901.5]) {
      assert.equal(
        parseMedRemoteSetting(file({ address: "https://med.example.com", port })).port,
        null,
      );
    }
  });
});
