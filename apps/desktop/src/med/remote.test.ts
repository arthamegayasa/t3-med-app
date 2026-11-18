// T3 Med: the backend port stays where a tunnel points at it, for as long as remote access is set.
import { assert, describe, it } from "vite-plus/test";
import * as Option from "effect/Option";

import { medKeptPort, pickMedBackendPort } from "./remote.ts";

const settings = (remote: unknown, rest: object = { workspace: "E:\\Clinic" }) =>
  JSON.stringify({ ...rest, remote });

describe("medKeptPort", () => {
  it("is the port saved with a public address", () => {
    assert.equal(medKeptPort(settings({ address: "https://med.example.com", port: 3901 })), 3901);
    assert.equal(
      medKeptPort(`﻿${settings({ address: "https://med.example.com", port: 3900 })}`),
      3900,
    );
  });

  it("is nothing without remote access, so the app scans for a port as upstream does", () => {
    for (const raw of [
      undefined,
      "",
      "not json",
      "[]",
      JSON.stringify({ workspace: "E:\\Clinic" }),
      settings(null),
      settings({ port: 3901 }),
      settings({ address: "", port: 3901 }),
      // An address the server would refuse fixes nothing.
      settings({ address: "http://med.example.com", port: 3901 }),
      settings({ address: "https://192.168.1.20", port: 3901 }),
      settings({ address: "https://med.example.com" }),
      settings({ address: "https://med.example.com", port: "3901" }),
      settings({ address: "https://med.example.com", port: 0 }),
      settings({ address: "https://med.example.com", port: 70_000 }),
      settings({ address: "https://med.example.com", port: 3901.5 }),
    ]) {
      assert.equal(medKeptPort(raw), undefined, raw);
    }
  });
});

describe("pickMedBackendPort", () => {
  it("leaves a port set in the environment alone", () => {
    assert.deepEqual(
      pickMedBackendPort({ configured: Option.some(4100), kept: 3901, keptIsFree: true }),
      Option.some(4100),
    );
  });

  it("takes the kept port when nothing else holds it", () => {
    assert.deepEqual(
      pickMedBackendPort({ configured: Option.none(), kept: 3901, keptIsFree: true }),
      Option.some(3901),
    );
  });

  it("falls back to the scan when the kept port is taken, so the app still starts", () => {
    assert.deepEqual(
      pickMedBackendPort({ configured: Option.none(), kept: 3901, keptIsFree: false }),
      Option.none(),
    );
  });

  it("scans when no port is kept", () => {
    assert.deepEqual(
      pickMedBackendPort({ configured: Option.none(), kept: undefined, keptIsFree: false }),
      Option.none(),
    );
  });
});
