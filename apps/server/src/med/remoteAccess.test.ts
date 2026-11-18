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
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as MedContract from "@t3tools/contracts/med";
import {
  MED_DESKTOP_SETTINGS_FILE,
  MED_REMOTE_CLIENT_SCOPES,
  MED_REMOTE_SUBJECT,
  MedHttpApi,
  MedRemoteHttpApi,
  normalizeMedRemoteAddress,
} from "@t3tools/contracts/med";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Stream from "effect/Stream";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as TestClock from "effect/testing/TestClock";
import { Etag, HttpPlatform, HttpRouter } from "effect/http";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as RpcTest from "effect/rpc/RpcTest";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as AuthHttp from "../auth/http.ts";
import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as MedDatabase from "./MedDatabase.ts";
import * as MedHttp from "./http.ts";
import * as PatientStore from "./PatientStore.ts";

const PORT = 3907;
const DESKTOP_TOKEN = "desktop-bootstrap-token-of-this-test";
const PUBLIC_HOST = "med.example.com";
const PUBLIC_ORIGIN = `https://${PUBLIC_HOST}`;

class AuthApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.auth) {}

interface Answer {
  readonly status: number;
  readonly body: unknown;
  readonly cookies: ReadonlyArray<string>;
  readonly cacheControl: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A field of a JSON answer; undefined when the answer is no object or lacks the field. */
const field = (body: unknown, name: string): unknown => (isRecord(body) ? body[name] : undefined);

const textField = (body: unknown, name: string): string => {
  const value = field(body, name);
  if (typeof value !== "string") throw new Error(`The answer has no text field ${name}.`);
  return value;
};

/** The one-time token a pairing link carries after its hash. */
const tokenOf = (url: string): string =>
  new URLSearchParams(new URL(url).hash.slice(1)).get("token") ?? "";

interface Call {
  readonly method?: string;
  readonly body?: unknown;
  readonly form?: Record<string, string>;
  readonly headers?: Record<string, string>;
}

/** The laptop's server: desktop mode, loopback, with the patient routes and upstream's auth routes. */
const startServer = Effect.fn("test.startMedServer")(function* (
  options: {
    /** The clock the server tells time by; without one, the real clock. */
    readonly clock?: Clock.Clock;
    readonly mode?: ServerConfig.ServerConfig["Service"]["mode"];
    /** A disk that refuses to move a file into place. */
    readonly renameFails?: boolean;
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const testConfig = Context.get(
    yield* Layer.build(ServerConfig.layerTest(process.cwd(), { prefix: "t3med-remote-test-" })),
    ServerConfig.ServerConfig,
  );
  const config = {
    ...testConfig,
    mode: options.mode ?? "desktop",
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
  // Built once, so a test can ask the same sign-in service the routes use.
  const onServerClock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    options.clock === undefined
      ? TestClock.withLive(effect)
      : Effect.provideService(effect, Clock.Clock, options.clock);
  const layerDisk = options.renameFails
    ? Layer.succeed(FileSystem.FileSystem, {
        ...fs,
        rename: () =>
          Effect.fail(
            PlatformError.systemError({
              _tag: "PermissionDenied",
              module: "FileSystem",
              method: "rename",
            }),
          ),
      })
    : Layer.empty;
  const services = yield* onServerClock(
    Layer.build(
      layerAuth.pipe(
        Layer.provideMerge(layerConfig),
        Layer.provideMerge(layerDisk),
        Layer.provideMerge(layerPlatform),
      ),
    ),
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
    Layer.provideMerge(Layer.succeedContext(services)),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(layerRoutes, { disableLogger: true });
  yield* Effect.addFinalizer(() => Effect.promise(dispose));
  const requestContext = Context.make(SecureRandom.SecureRandom, random).pipe(
    // A request tells time by the server's clock; the default is the real one.
    options.clock === undefined ? (context) => context : Context.add(Clock.Clock, options.clock),
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
  const laptop = { authorization: `Bearer ${textField(exchanged.body, "access_token")}` };

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
    return {
      id: textField(link.body, "id"),
      url: textField(link.body, "url"),
      scopes: field(link.body, "scopes"),
    };
  });

  /** Opens the link in the other computer's browser and returns its cookie. */
  const pair = Effect.fn("test.pair")(function* (url: string) {
    const credential = tokenOf(url);
    const paired = yield* remote("/api/auth/browser-session", {
      body: { credential },
      headers: { origin: PUBLIC_ORIGIN },
    });
    return { answer: paired, cookie: paired.cookies[0]?.split(";", 1)[0] ?? "" };
  });

  const settingsFile = path.join(config.stateDir, MED_DESKTOP_SETTINGS_FILE);
  const readSettings = fs
    .readFileString(settingsFile)
    .pipe(Effect.map((text): unknown => JSON.parse(text)));
  const auth = Context.get(services, EnvironmentAuth.EnvironmentAuth);

  return {
    local,
    remote,
    laptop,
    makeLink,
    pair,
    settingsFile,
    readSettings,
    fs,
    stateDir: config.stateDir,
    services,
    auth,
    onServerClock,
  };
});

// Every HttpApi the fork's contract exports, so a new route or a new group is listed without an
// edit here, and a route this server does not mount answers 404 below instead of 401.
const MED_APIS = Object.values(MedContract).flatMap((value: unknown) =>
  HttpApi.isHttpApi(value) ? [value] : [],
);
const MED_ROUTES = MED_APIS.flatMap((api) => {
  const routes: Array<readonly [method: string, path: string]> = [];
  HttpApi.reflect(api, {
    onGroup: () => {},
    onEndpoint: ({ endpoint }) => {
      routes.push([endpoint.method, endpoint.path.replaceAll(/:(\w+)/g, "some-$1")]);
    },
  });
  return routes;
});

// One WebSocket call a paired browser may make, and three it may not.
const REMOTE_RPC_METHODS = [
  WS_METHODS.serverProbe,
  WS_METHODS.terminalOpen,
  WS_METHODS.serverUpdateSettings,
  WS_METHODS.subscribeAuthAccess,
] as const;
const REMOTE_RPC_GROUP = WsRpcGroup.omit(
  ...[...WsRpcGroup.requests.keys()].filter(
    (
      tag,
    ): tag is Exclude<
      keyof typeof RpcAuthorization.RPC_REQUIRED_SCOPES,
      (typeof REMOTE_RPC_METHODS)[number]
    > => !(REMOTE_RPC_METHODS as ReadonlyArray<string>).includes(tag),
  ),
);

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
      const exported: Array<unknown> = [...MED_APIS];
      assert.includeMembers(exported, [MedHttpApi, MedRemoteHttpApi]);
      assert.strictEqual(
        new Set(MED_ROUTES.map(([method, route]) => `${method} ${route}`)).size,
        MED_ROUTES.length,
      );
      assert.deepStrictEqual(
        MED_ROUTES.filter(([, route]) => !route.startsWith("/api/med/")),
        [],
      );
      assert.includeDeepMembers(MED_ROUTES, [
        ["GET", "/api/med/patients"],
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
      assert.deepStrictEqual(field(answer.body, "permissions"), [...MED_REMOTE_CLIENT_SCOPES]);
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
          [route, call.method ?? "", answer.status, field(answer.body, "requiredPermission")],
          [route, call.method ?? "", 403, "access:write"],
        );
      }
      assert.strictEqual(
        field(field(yield* server.readSettings, "remote"), "address"),
        PUBLIC_ORIGIN,
      );
    }),
  );

  it.effect("gives a link spent for a token only what the link grants, whatever is asked", () =>
    Effect.gen(function* () {
      const server = yield* startServer();
      const exchange = (scope: string) =>
        Effect.gen(function* () {
          return yield* server.remote("/oauth/token", {
            form: {
              grant_type: AuthTokenExchangeGrantType,
              subject_token: tokenOf((yield* server.makeLink()).url),
              subject_token_type: AuthEnvironmentBootstrapTokenType,
              requested_token_type: AuthAccessTokenType,
              scope,
            },
          });
        });

      const greedy = yield* exchange(
        "orchestration:read orchestration:operate access:write terminal:operate settings:write",
      );
      assert.strictEqual(greedy.status, 200);
      assert.strictEqual(field(greedy.body, "scope"), MED_REMOTE_CLIENT_SCOPES.join(" "));
      const token = { authorization: `Bearer ${textField(greedy.body, "access_token")}` };
      const managing = yield* server.remote("/api/med/remote", { headers: token });
      assert.deepStrictEqual(
        [managing.status, field(managing.body, "requiredPermission")],
        [403, "access:write"],
      );

      // Asking only for what the link does not grant gets no token at all.
      const foreign = yield* exchange("access:write terminal:operate");
      assert.notStrictEqual(foreign.status, 200);
      assert.strictEqual(field(foreign.body, "access_token"), undefined);
    }),
  );

  it.effect("refuses a request whose forwarded host is not the host it came to", () =>
    Effect.gen(function* () {
      const server = yield* startServer();
      const { cookie } = yield* server.pair((yield* server.makeLink()).url);
      const read = (headers: Record<string, string>) =>
        server
          .remote("/api/med/patients", { headers: { cookie, ...headers } })
          .pipe(Effect.map((answer) => answer.status));

      // Upstream takes a cookie from a page whose origin is `X-Forwarded-Host`, so a request
      // from another site that names itself there would pass as the app's own.
      assert.strictEqual(
        yield* read({
          origin: "https://other.example.com",
          "x-forwarded-host": "other.example.com",
        }),
        400,
      );
      assert.strictEqual(
        yield* read({
          origin: "https://other.example.com",
          "sec-fetch-site": "cross-site",
          "x-forwarded-host": "other.example.com, med.example.com",
        }),
        400,
      );
      // The same host twice is what an honest proxy sends, and changes nothing.
      assert.strictEqual(
        yield* read({ origin: PUBLIC_ORIGIN, "x-forwarded-host": PUBLIC_HOST }),
        200,
      );
      assert.strictEqual(yield* read({ origin: "https://other.example.com" }), 401);
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
        `\uFEFF${JSON.stringify({ workspace: "E:\\Clinic", other: 1 })}`,
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
      assert.strictEqual(
        field(field(yield* server.readSettings, "remote"), "address"),
        PUBLIC_ORIGIN,
      );

      const cleared = yield* set(null);
      assert.deepStrictEqual(
        [cleared.status, cleared.body],
        [200, { address: null, port: PORT, keptPort: null }],
      );
      // The address is gone; the port a tunnel was pointed at is remembered for the next time.
      assert.deepStrictEqual(yield* server.readSettings, {
        workspace: "E:\\Clinic",
        other: 1,
        remote: { port: PORT },
      });
      const link = yield* server.local("/api/med/remote/pairing-link", {
        body: {},
        headers: server.laptop,
      });
      assert.strictEqual(link.status, 422);
    }),
  );

  it.effect("keeps the port a tunnel points at, whatever port this start ended up on", () =>
    Effect.gen(function* () {
      // 3901 was kept; something held it at this start, so the server is on its fallback port.
      const server = yield* startServer();
      yield* server.fs.writeFileString(
        server.settingsFile,
        JSON.stringify({ remote: { address: "https://old.example.com", port: 3901 } }),
      );
      const set = (address: string | null) =>
        server.local("/api/med/remote", {
          method: "PUT",
          body: { address },
          headers: server.laptop,
        });

      assert.deepStrictEqual((yield* set(PUBLIC_ORIGIN)).body, {
        address: PUBLIC_ORIGIN,
        port: PORT,
        keptPort: 3901,
      });
      // Off and on again while on the fallback port does not make the fallback the kept port.
      assert.deepStrictEqual((yield* set(null)).body, {
        address: null,
        port: PORT,
        keptPort: null,
      });
      assert.deepStrictEqual(yield* server.readSettings, { remote: { port: 3901 } });
      yield* set(PUBLIC_ORIGIN);
      assert.deepStrictEqual(yield* server.readSettings, {
        remote: { address: PUBLIC_ORIGIN, port: 3901 },
      });
    }),
  );

  it.effect("keeps no port for the browser version, which is always started on its own", () =>
    Effect.gen(function* () {
      const server = yield* startServer({ mode: "web" });
      const saved = yield* server.local("/api/med/remote", {
        method: "PUT",
        body: { address: PUBLIC_ORIGIN },
        headers: server.laptop,
      });
      assert.deepStrictEqual(
        [saved.status, saved.body],
        [200, { address: PUBLIC_ORIGIN, port: PORT, keptPort: null }],
      );
      assert.deepStrictEqual(yield* server.readSettings, { remote: { address: PUBLIC_ORIGIN } });
    }),
  );

  it.effect("refuses a paired browser the terminal, the settings and the client list", () =>
    Effect.gen(function* () {
      const server = yield* startServer();
      yield* server.pair((yield* server.makeLink()).url);
      // What the session really holds, as upstream's WebSocket route hands it to the RPC layer.
      const [paired] = (yield* server.onServerClock(server.auth.listSessions())).filter(
        (session) => session.subject === MED_REMOTE_SUBJECT,
      );
      assert.deepStrictEqual(paired?.scopes, [...MED_REMOTE_CLIENT_SCOPES]);

      const handled: Array<string> = [];
      const handle = (method: string) => Effect.sync(() => void handled.push(method));
      const client = yield* RpcTest.makeClient(REMOTE_RPC_GROUP).pipe(
        Effect.provide(
          Layer.mergeAll(
            REMOTE_RPC_GROUP.toLayerHandler(WS_METHODS.serverProbe, () =>
              handle(WS_METHODS.serverProbe).pipe(Effect.as({})),
            ),
            REMOTE_RPC_GROUP.toLayerHandler(WS_METHODS.terminalOpen, () =>
              handle(WS_METHODS.terminalOpen).pipe(Effect.andThen(Effect.never)),
            ),
            REMOTE_RPC_GROUP.toLayerHandler(WS_METHODS.serverUpdateSettings, () =>
              handle(WS_METHODS.serverUpdateSettings).pipe(Effect.andThen(Effect.never)),
            ),
            REMOTE_RPC_GROUP.toLayerHandler(WS_METHODS.subscribeAuthAccess, () =>
              Stream.fromEffect(handle(WS_METHODS.subscribeAuthAccess)).pipe(Stream.drain),
            ),
            RpcAuthorization.layer(paired?.scopes ?? []),
          ),
        ),
      );
      const refusal = <A, E>(call: Effect.Effect<A, E>) =>
        call.pipe(
          Effect.flip,
          Effect.map((error) => field(error, "requiredPermission")),
        );

      yield* client[WS_METHODS.serverProbe]({});
      assert.strictEqual(
        yield* refusal(
          client[WS_METHODS.terminalOpen]({
            threadId: "thread-1",
            terminalId: "terminal-1",
            cwd: "E:/Clinic",
          }),
        ),
        "terminal:operate",
      );
      assert.strictEqual(
        yield* refusal(client[WS_METHODS.serverUpdateSettings]({ patch: { setModelsHidden: [] } })),
        "settings:write",
      );
      assert.strictEqual(
        yield* refusal(
          client[WS_METHODS.serverUpdateSettings]({
            patch: { requireConnectDeviceApproval: false },
          }),
        ),
        "access:write",
      );
      assert.strictEqual(
        yield* refusal(Stream.runDrain(client[WS_METHODS.subscribeAuthAccess]({}))),
        "access:read",
      );
      // Only the call its scopes cover reached a handler.
      assert.deepStrictEqual(handled, [WS_METHODS.serverProbe]);
    }),
  );

  it.effect("turning off signs out every remote browser and voids every unused link", () =>
    Effect.gen(function* () {
      const server = yield* startServer();
      const { cookie } = yield* server.pair((yield* server.makeLink()).url);
      // A link is a credential like any other: a script can spend one for a bearer token.
      const spent = yield* server.remote("/oauth/token", {
        form: {
          grant_type: AuthTokenExchangeGrantType,
          subject_token: tokenOf((yield* server.makeLink()).url),
          subject_token_type: AuthEnvironmentBootstrapTokenType,
          requested_token_type: AuthAccessTokenType,
        },
      });
      const script = { authorization: `Bearer ${textField(spent.body, "access_token")}` };
      const unused = yield* server.makeLink();
      // A client paired by upstream's own link is not remote access's to sign out.
      const other = yield* server.local("/api/auth/pairing-token", {
        body: {},
        headers: server.laptop,
      });
      const otherClient = yield* server.pair(
        `${PUBLIC_ORIGIN}/pair#token=${textField(other.body, "credential")}`,
      );
      const reads = (headers: Record<string, string>) =>
        server.remote("/api/med/patients", { headers }).pipe(Effect.map((answer) => answer.status));
      assert.deepStrictEqual([yield* reads({ cookie }), yield* reads(script)], [200, 200]);

      // An open connection is closed by upstream when its session ends.
      const sessions = Context.get(server.services, SessionStore.SessionStore);
      const remoteSessions = (yield* server.onServerClock(server.auth.listSessions())).filter(
        (session) => session.subject === MED_REMOTE_SUBJECT,
      );
      assert.strictEqual(remoteSessions.length, 2);
      const closed = yield* Effect.forkChild(
        Effect.forEach(
          remoteSessions,
          (session) => sessions.awaitInvalidation(session.sessionId, undefined),
          { concurrency: "unbounded" },
        ),
      );

      const off = yield* server.local("/api/med/remote", {
        method: "PUT",
        body: { address: null },
        headers: server.laptop,
      });
      assert.strictEqual(off.status, 200);

      assert.deepStrictEqual([yield* reads({ cookie }), yield* reads(script)], [401, 401]);
      assert.strictEqual((yield* server.pair(unused.url)).answer.status, 401);
      yield* Fiber.join(closed);
      assert.strictEqual(yield* reads({ cookie: otherClient.cookie }), 200);
      assert.strictEqual(
        (yield* server.local("/api/med/patients", { headers: server.laptop })).status,
        200,
      );
    }),
  );

  it.effect("signs a remote browser out after twelve hours, by the server's own clock", () =>
    Effect.gen(function* () {
      const server = yield* startServer({ clock: yield* Clock.Clock });
      const twelveHours = Duration.toMillis(Duration.hours(12));
      const pairedAt = yield* Clock.currentTimeMillis;
      const { answer, cookie } = yield* server.pair((yield* server.makeLink()).url);
      assert.strictEqual(Date.parse(textField(answer.body, "expiresAt")) - pairedAt, twelveHours);
      // The browser drops the cookie at the same moment.
      const expires = /;\s*Expires=([^;]+)/i.exec(answer.cookies[0] ?? "")?.[1] ?? "";
      assert.strictEqual(Date.parse(expires) - pairedAt, twelveHours);
      // A link spent for a bearer token instead gets no longer a life.
      const spent = yield* server.remote("/oauth/token", {
        form: {
          grant_type: AuthTokenExchangeGrantType,
          subject_token: tokenOf((yield* server.makeLink()).url),
          subject_token_type: AuthEnvironmentBootstrapTokenType,
          requested_token_type: AuthAccessTokenType,
        },
      });
      assert.strictEqual(field(spent.body, "expires_in"), twelveHours / 1000);
      const script = { authorization: `Bearer ${textField(spent.body, "access_token")}` };
      const reads = (headers: Record<string, string>) =>
        server.remote("/api/med/patients", { headers }).pipe(Effect.map((answer) => answer.status));

      yield* TestClock.adjust(Duration.minutes(12 * 60 - 1));
      assert.deepStrictEqual([yield* reads({ cookie }), yield* reads(script)], [200, 200]);
      yield* TestClock.adjust(Duration.minutes(1));
      assert.deepStrictEqual([yield* reads({ cookie }), yield* reads(script)], [401, 401]);
      // This computer's own session is upstream's, and lasts as upstream's does.
      assert.strictEqual(yield* reads(server.laptop), 200);
    }),
  );

  it.effect("lets no remote link sign an agent in through MCP", () =>
    Effect.gen(function* () {
      const server = yield* startServer();
      const link = yield* server.makeLink();
      // What POST /oauth/mcp/decision does with a pairing code, at the two levels the link's
      // scopes would cover. Either would mint a 30-day session that Turn off does not end.
      for (const access of ["read-only", "approval-required"] as const) {
        const refused = yield* server
          .onServerClock(server.auth.consumeMcpApprovalCode(tokenOf(link.url), access))
          .pipe(Effect.flip);
        assert.strictEqual(refused._tag, "ServerAuthMcpApprovalCodeError");
      }
      // Offered there, the link is used up.
      assert.strictEqual((yield* server.pair(link.url)).answer.status, 401);

      // Upstream's own code still approves an agent, so the refusal is the link's alone.
      const own = yield* server.local("/api/auth/pairing-token", {
        body: {},
        headers: server.laptop,
      });
      assert.strictEqual(
        yield* server.onServerClock(
          server.auth.consumeMcpApprovalCode(textField(own.body, "credential"), "read-only"),
        ),
        "read-only",
      );
    }),
  );

  it.effect("refuses to save over a settings file it cannot read, and leaves it as it was", () =>
    Effect.gen(function* () {
      const server = yield* startServer();
      // A hand edit that lost its closing brace. The workspace setting is still in it.
      const broken = '{ "workspace": "E:/Clinic"';
      yield* server.fs.writeFileString(server.settingsFile, broken);
      const set = (address: string | null) =>
        server.local("/api/med/remote", {
          method: "PUT",
          body: { address },
          headers: server.laptop,
        });

      const saved = yield* set(PUBLIC_ORIGIN);
      assert.strictEqual(saved.status, 422);
      assert.match(textField(saved.body, "reason"), /t3med-desktop\.json/);
      assert.strictEqual(yield* server.fs.readFileString(server.settingsFile), broken);

      // Nothing is set in a file that cannot be read, so there is no link and nothing to take off.
      assert.deepStrictEqual(
        (yield* server.local("/api/med/remote", { headers: server.laptop })).body,
        { address: null, port: PORT, keptPort: null },
      );
      assert.strictEqual((yield* set(null)).status, 200);
      assert.strictEqual(yield* server.fs.readFileString(server.settingsFile), broken);
    }),
  );

  it.effect("writes the settings file whole or not at all", () =>
    Effect.gen(function* () {
      const server = yield* startServer({ renameFails: true });
      const before = JSON.stringify({ workspace: "E:/Clinic" });
      yield* server.fs.writeFileString(server.settingsFile, before);
      const files = yield* server.fs.readDirectory(server.stateDir);

      const saved = yield* server.local("/api/med/remote", {
        method: "PUT",
        body: { address: PUBLIC_ORIGIN },
        headers: server.laptop,
      });

      // The new text never reached the file's name, and no half-written copy is left beside it.
      assert.strictEqual(saved.status, 500);
      assert.strictEqual(yield* server.fs.readFileString(server.settingsFile), before);
      assert.sameMembers(yield* server.fs.readDirectory(server.stateDir), files);
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
          subject_token: textField(narrow.body, "credential"),
          subject_token_type: AuthEnvironmentBootstrapTokenType,
          requested_token_type: AuthAccessTokenType,
        },
      });
      assert.strictEqual(exchanged.status, 200);
      const link = yield* server.local("/api/med/remote/pairing-link", {
        body: {},
        headers: { authorization: `Bearer ${textField(exchanged.body, "access_token")}` },
      });
      assert.deepStrictEqual(
        [link.status, field(link.body, "requiredPermission")],
        [403, "orchestration:read"],
      );
    }),
  );
});
