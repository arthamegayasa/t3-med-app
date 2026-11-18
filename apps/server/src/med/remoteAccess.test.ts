// T3 Med: who may reach patient data when the laptop's server is opened from another computer.
// Upstream's own sign-in, sessions and pairing run here unmocked, as a desktop backend on
// loopback behind a proxy that forwards a public HTTPS hostname.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import {
  MED_REMOTE_CLIENT_SCOPES,
  MedHttpApi,
  MedRemoteHttpApi,
  normalizeMedRemoteAddress,
} from "@t3tools/contracts/med";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { Etag, HttpPlatform, HttpRouter } from "effect/http";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as AuthHttp from "../auth/http.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as MedDatabase from "./MedDatabase.ts";
import * as MedHttp from "./http.ts";
import * as PatientStore from "./PatientStore.ts";
import { MED_DESKTOP_SETTINGS_FILE } from "./remote.ts";

const PORT = 3907;
const DESKTOP_TOKEN = "desktop-bootstrap-token-of-this-test";
const PUBLIC_HOST = "med.example.com";
const PUBLIC_ORIGIN = `https://${PUBLIC_HOST}`;

class AuthApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.auth) {}

interface Answer {
  readonly status: number;
  readonly body: any;
  readonly cookies: ReadonlyArray<string>;
  readonly cacheControl: string | null;
}

interface Call {
  readonly method?: string;
  readonly body?: unknown;
  readonly form?: Record<string, string>;
  readonly headers?: Record<string, string>;
}

/** The laptop's server: desktop mode, loopback, with the patient routes and upstream's auth routes. */
const startServer = Effect.fn("test.startMedServer")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const testConfig = Context.get(
    yield* Layer.build(ServerConfig.layerTest(process.cwd(), { prefix: "t3med-remote-test-" })),
    ServerConfig.ServerConfig,
  );
  const config = {
    ...testConfig,
    mode: "desktop",
    host: "127.0.0.1",
    port: PORT,
    desktopBootstrapToken: DESKTOP_TOKEN,
  } satisfies ServerConfig.ServerConfig["Service"];
  const layerConfig = Layer.succeed(ServerConfig.ServerConfig, config);
  const layerAuth = EnvironmentAuth.layer.pipe(
    Layer.provide(ManagedPolicy.layerTest()),
    Layer.provide(SqlitePersistence.layerMemory),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(ServerEnvironment.layerIdentity),
    Layer.provide(layerConfig),
  );
  const layerPlatform = HttpPlatform.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    Layer.provideMerge(Etag.layerWeak),
  );
  const layerRoutes = Layer.mergeAll(
    MedHttp.layer,
    HttpApiBuilder.layer(AuthApi).pipe(
      Layer.provide(AuthHttp.layer),
      Layer.provide(AuthHttp.layerAuthenticatedAuth),
    ),
  ).pipe(
    Layer.provide(
      PatientStore.layer.pipe(
        Layer.provide(MedDatabase.layerFromPath(path.join(config.stateDir, "t3med.sqlite"))),
      ),
    ),
    Layer.provideMerge(layerAuth),
    Layer.provide(layerConfig),
    Layer.provideMerge(layerPlatform),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(layerRoutes, { disableLogger: true });
  yield* Effect.addFinalizer(() => Effect.promise(dispose));
  const requestContext = Context.make(SecureRandom.SecureRandom, random).pipe(
    Context.add(
      ServerSecretStore.ServerSecretStore,
      ServerSecretStore.ServerSecretStore.of({
        get: () => Effect.succeedNone,
        set: () => Effect.void,
        create: () => Effect.void,
        getOrCreateRandom: () => Effect.die("Not used by these routes."),
        remove: () => Effect.void,
      }),
    ),
  );

  const send =
    (origin: string, baseHeaders: Record<string, string>) =>
    (route: string, call: Call = {}) =>
      Effect.promise(async (): Promise<Answer> => {
        const response = await handler(
          new Request(`${origin}${route}`, {
            method:
              call.method ?? (call.body === undefined && call.form === undefined ? "GET" : "POST"),
            headers: {
              ...baseHeaders,
              ...(call.body === undefined ? {} : { "content-type": "application/json" }),
              ...call.headers,
            },
            ...(call.form !== undefined
              ? { body: new URLSearchParams(call.form) }
              : call.body === undefined
                ? {}
                : { body: JSON.stringify(call.body) }),
          }),
          requestContext,
        );
        const text = await response.text();
        let body: unknown = null;
        try {
          body = text === "" ? null : JSON.parse(text);
        } catch {
          body = text;
        }
        return {
          status: response.status,
          body,
          cookies: response.headers.getSetCookie(),
          cacheControl: response.headers.get("cache-control"),
        };
      });

  // The desktop window: straight to loopback, as the app's own renderer.
  const local = send(`http://127.0.0.1:${PORT}`, { host: `127.0.0.1:${PORT}` });
  // Another computer's browser: what a tunnel's connector hands the server.
  const remoteHeaders = {
    host: PUBLIC_HOST,
    "x-forwarded-proto": "https",
    "x-forwarded-for": "203.0.113.9",
  };
  const remote = send(`http://${PUBLIC_HOST}`, remoteHeaders);

  const exchanged = yield* local("/oauth/token", {
    form: {
      grant_type: AuthTokenExchangeGrantType,
      subject_token: DESKTOP_TOKEN,
      subject_token_type: AuthEnvironmentBootstrapTokenType,
      requested_token_type: AuthAccessTokenType,
    },
  });
  assert.strictEqual(exchanged.status, 200);
  const laptop = { authorization: `Bearer ${exchanged.body.access_token}` };

  /** Sets the public address and makes one link, as Settings > Sharing & access does. */
  const makeLink = Effect.fn("test.makeLink")(function* () {
    const saved = yield* local("/api/med/remote", {
      method: "PUT",
      body: { address: PUBLIC_ORIGIN },
      headers: laptop,
    });
    assert.strictEqual(saved.status, 200);
    const link = yield* local("/api/med/remote/pairing-link", { body: {}, headers: laptop });
    assert.strictEqual(link.status, 200);
    return link.body as { id: string; url: string; scopes: ReadonlyArray<string> };
  });

  /** Opens the link in the other computer's browser and returns its cookie. */
  const pair = Effect.fn("test.pair")(function* (url: string) {
    const credential = new URLSearchParams(new URL(url).hash.slice(1)).get("token") ?? "";
    const paired = yield* remote("/api/auth/browser-session", {
      body: { credential },
      headers: { origin: PUBLIC_ORIGIN },
    });
    return { answer: paired, cookie: paired.cookies[0]?.split(";", 1)[0] ?? "" };
  });

  const settingsFile = path.join(config.stateDir, MED_DESKTOP_SETTINGS_FILE);
  const readSettings = fs.readFileString(settingsFile).pipe(Effect.map((text) => JSON.parse(text)));

  return { local, remote, laptop, makeLink, pair, settingsFile, readSettings, fs };
});

const MED_ROUTES: Array<readonly [method: string, path: string]> = [];
const listRoute = ({ endpoint }: { endpoint: { method: string; path: string } }) => {
  MED_ROUTES.push([endpoint.method, endpoint.path.replaceAll(/:(\w+)/g, "some-$1")]);
};
HttpApi.reflect(MedHttpApi, { onGroup: () => {}, onEndpoint: listRoute });
HttpApi.reflect(MedRemoteHttpApi, { onGroup: () => {}, onEndpoint: listRoute });

const everyMedRoute = (
  call: (route: string, call?: Call) => Effect.Effect<Answer>,
  headers: Record<string, string>,
) =>
  Effect.forEach(MED_ROUTES, ([method, route]) =>
    call(route, { method, headers, ...(method === "GET" ? {} : { body: {} }) }).pipe(
      Effect.map((answer) => [method, route, answer.status, answer.cacheControl] as const),
    ),
  );

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("med remote access", (it) => {
  it.effect("lists every med route, patient and remote, so none is left out below", () =>
    Effect.sync(() => {
      assert.strictEqual(MED_ROUTES.length, 24);
      assert.deepStrictEqual(
        MED_ROUTES.filter(([, route]) => !route.startsWith("/api/med/")),
        [],
      );
      assert.includeDeepMembers(MED_ROUTES, [
        ["GET", "/api/med/remote"],
        ["PUT", "/api/med/remote"],
        ["POST", "/api/med/remote/pairing-link"],
      ]);
    }),
  );

  it.effect("answers no med route without a session, from loopback or through the tunnel", () =>
    Effect.gen(function* () {
      const server = yield* startServer();
      for (const call of [server.local, server.remote]) {
        for (const headers of [
          {},
          { authorization: "Bearer not-a-session" },
          { cookie: `t3_session_${PORT}=not-a-session` },
          { cookie: `t3_session_${PORT}=not-a-session`, origin: PUBLIC_ORIGIN },
        ]) {
          for (const [method, route, status, cacheControl] of yield* everyMedRoute(call, headers)) {
            assert.deepStrictEqual(
              [method, route, status, cacheControl],
              [method, route, 401, "no-store"],
            );
          }
        }
      }
    }),
  );

  it.effect("makes a one-time link on the public address, with the remote scopes and no more", () =>
    Effect.gen(function* () {
      const server = yield* startServer();

      // Nothing to link to until the address is set.
      const early = yield* server.local("/api/med/remote/pairing-link", {
        body: {},
        headers: server.laptop,
      });
      assert.strictEqual(early.status, 422);
      assert.deepStrictEqual(
        (yield* server.local("/api/med/remote", { headers: server.laptop })).body,
        { address: null, port: PORT, keptPort: null },
      );

      const link = yield* server.makeLink();
      assert.deepStrictEqual(link.scopes, [...MED_REMOTE_CLIENT_SCOPES]);
      const url = new URL(link.url);
      assert.strictEqual(url.origin, PUBLIC_ORIGIN);
      assert.strictEqual(url.pathname, "/pair");
      assert.strictEqual(url.search, "");
      assert.match(url.hash, /^#token=[0-9A-Z]{12}$/);

      const { answer, cookie } = yield* server.pair(link.url);
      assert.strictEqual(answer.status, 200);
      assert.deepStrictEqual(answer.body.permissions, [...MED_REMOTE_CLIENT_SCOPES]);
      // A cookie the browser sends back over HTTPS only, and never to a script.
      assert.strictEqual(answer.cookies.length, 1);
      assert.match(answer.cookies[0]!, new RegExp(`^t3_session_${PORT}=`));
      assert.match(answer.cookies[0]!, /;\s*Secure/i);
      assert.match(answer.cookies[0]!, /;\s*HttpOnly/i);
      assert.match(answer.cookies[0]!, /;\s*SameSite=Lax/i);
      assert.notStrictEqual(cookie, "");

      // Once.
      assert.strictEqual((yield* server.pair(link.url)).answer.status, 401);
    }),
  );

  it.effect("lets a paired browser read and change patients, and manage no access", () =>
    Effect.gen(function* () {
      const server = yield* startServer();
      const { cookie } = yield* server.pair((yield* server.makeLink()).url);
      const browser = { cookie, origin: PUBLIC_ORIGIN };

      const patients = yield* server.remote("/api/med/patients", { headers: { cookie } });
      assert.deepStrictEqual([patients.status, patients.body], [200, { patients: [] }]);
      assert.strictEqual(
        (yield* server.remote("/api/med/counts", { headers: { cookie } })).status,
        200,
      );
      // A change reaches the store: no such patient, and not "forbidden".
      const change = yield* server.remote("/api/med/patients/no-such-patient", {
        method: "PATCH",
        body: { diagnoses: "Migraine" },
        headers: browser,
      });
      assert.strictEqual(change.status, 404);
      const verify = yield* server.remote("/api/med/notes/no-such-note/verify", {
        body: { labIds: [], planIds: [] },
        headers: browser,
      });
      assert.strictEqual(verify.status, 404);

      // Access stays with the laptop: no link, no revoking, no address.
      for (const [route, call] of [
        ["/api/auth/pairing-token", { body: {} }],
        ["/api/auth/pairing-token", { body: { scopes: ["orchestration:read"] } }],
        ["/api/auth/pairing-links/revoke", { body: { id: "any" } }],
        ["/api/auth/clients/revoke", { body: { sessionId: "any" } }],
        ["/api/auth/clients/revoke-others", { body: {} }],
        ["/api/med/remote", {}],
        ["/api/med/remote", { method: "PUT", body: { address: "https://elsewhere.example.com" } }],
        ["/api/med/remote", { method: "PUT", body: { address: null } }],
        ["/api/med/remote/pairing-link", { body: {} }],
      ] as ReadonlyArray<readonly [string, Call]>) {
        const answer = yield* server.remote(route, { ...call, headers: browser });
        assert.deepStrictEqual(
          [route, call.method ?? "", answer.status, answer.body?.requiredPermission],
          [route, call.method ?? "", 403, "access:write"],
        );
      }
      assert.strictEqual((yield* server.readSettings).remote.address, PUBLIC_ORIGIN);
    }),
  );

  it.effect("takes the cookie from the public address only, not from another site", () =>
    Effect.gen(function* () {
      const server = yield* startServer();
      const { cookie } = yield* server.pair((yield* server.makeLink()).url);
      const read = (headers: Record<string, string>) =>
        server
          .remote("/api/med/patients", { headers: { cookie, ...headers } })
          .pipe(Effect.map((answer) => answer.status));
      assert.strictEqual(yield* read({ origin: PUBLIC_ORIGIN }), 200);
      assert.strictEqual(
        yield* read({ origin: PUBLIC_ORIGIN, "sec-fetch-site": "same-origin" }),
        200,
      );
      assert.strictEqual(yield* read({ origin: "https://other.example.com" }), 401);
      assert.strictEqual(
        yield* read({ origin: "https://other.example.com", "sec-fetch-site": "cross-site" }),
        401,
      );
      assert.strictEqual(yield* read({ origin: "https://med.example.com.evil.test" }), 401);
    }),
  );

  it.effect("refuses a revoked browser, on every med route", () =>
    Effect.gen(function* () {
      const server = yield* startServer();
      const { cookie } = yield* server.pair((yield* server.makeLink()).url);
      assert.strictEqual(
        (yield* server.remote("/api/med/patients", { headers: { cookie } })).status,
        200,
      );

      const revoked = yield* server.local("/api/auth/clients/revoke-others", {
        body: {},
        headers: server.laptop,
      });
      assert.deepStrictEqual([revoked.status, revoked.body], [200, { revokedCount: 1 }]);

      for (const [method, route, status] of yield* everyMedRoute(server.remote, {
        cookie,
        origin: PUBLIC_ORIGIN,
      })) {
        assert.deepStrictEqual([method, route, status], [method, route, 401]);
      }
      // The laptop is still signed in.
      assert.strictEqual(
        (yield* server.local("/api/med/patients", { headers: server.laptop })).status,
        200,
      );
    }),
  );

  it.effect("revokes a link that was never opened", () =>
    Effect.gen(function* () {
      const server = yield* startServer();
      const link = yield* server.makeLink();
      const revoked = yield* server.local("/api/auth/pairing-links/revoke", {
        body: { id: link.id },
        headers: server.laptop,
      });
      assert.deepStrictEqual([revoked.status, revoked.body], [200, { revoked: true }]);
      assert.strictEqual((yield* server.pair(link.url)).answer.status, 401);
    }),
  );

  it.effect("keeps the address and the port beside the workspace setting, and takes them off", () =>
    Effect.gen(function* () {
      const server = yield* startServer();
      yield* server.fs.writeFileString(
        server.settingsFile,
        `﻿${JSON.stringify({ workspace: "E:\\Clinic", other: 1 })}`,
      );
      const set = (address: string | null) =>
        server.local("/api/med/remote", {
          method: "PUT",
          body: { address },
          headers: server.laptop,
        });

      const saved = yield* set("  Med.Example.com ");
      assert.deepStrictEqual(
        [saved.status, saved.body],
        [200, { address: PUBLIC_ORIGIN, port: PORT, keptPort: PORT }],
      );
      assert.deepStrictEqual(yield* server.readSettings, {
        workspace: "E:\\Clinic",
        other: 1,
        remote: { address: PUBLIC_ORIGIN, port: PORT },
      });

      for (const address of ["http://med.example.com", "https://192.168.1.20", "localhost", ""]) {
        assert.strictEqual(normalizeMedRemoteAddress(address), undefined);
        assert.strictEqual((yield* set(address)).status, 422, address);
      }
      assert.strictEqual((yield* server.readSettings).remote.address, PUBLIC_ORIGIN);

      const cleared = yield* set(null);
      assert.deepStrictEqual(
        [cleared.status, cleared.body],
        [200, { address: null, port: PORT, keptPort: null }],
      );
      assert.deepStrictEqual(yield* server.readSettings, { workspace: "E:\\Clinic", other: 1 });
      const link = yield* server.local("/api/med/remote/pairing-link", {
        body: {},
        headers: server.laptop,
      });
      assert.strictEqual(link.status, 422);
    }),
  );

  it.effect("makes no link for a session that could not grant what the link grants", () =>
    Effect.gen(function* () {
      const server = yield* startServer();
      yield* server.makeLink();
      // A client with access management but without the chat scopes cannot hand them on.
      const narrow = yield* server.local("/api/auth/pairing-token", {
        body: { scopes: ["access:read", "access:write"] },
        headers: server.laptop,
      });
      assert.strictEqual(narrow.status, 200);
      const exchanged = yield* server.local("/oauth/token", {
        form: {
          grant_type: AuthTokenExchangeGrantType,
          subject_token: narrow.body.credential,
          subject_token_type: AuthEnvironmentBootstrapTokenType,
          requested_token_type: AuthAccessTokenType,
        },
      });
      assert.strictEqual(exchanged.status, 200);
      const link = yield* server.local("/api/med/remote/pairing-link", {
        body: {},
        headers: { authorization: `Bearer ${exchanged.body.access_token}` },
      });
      assert.deepStrictEqual(
        [link.status, link.body?.requiredPermission],
        [403, "orchestration:read"],
      );
    }),
  );
});
