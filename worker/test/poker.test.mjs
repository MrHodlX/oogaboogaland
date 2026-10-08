// Contract: the account gateway must never trust browser identity or expose its service credential.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { createPokerGateway } from "../src/poker.js";
import { createPokerServer } from "../../server/poker/server.mjs";
import { loadProtocol, source } from "../../server/poker/load.mjs";

const site = "https://floor.example", env = { SITE_ORIGIN: site, POKER_SERVICE_URL: "https://relay.example", POKER_SERVICE_TOKEN: "ab".repeat(32) };
const account = async () => ({ player: { id: 101, login: "player-one", display: "Player One" } });
const request = (path, options = {}) => new Request(site + path, { ...options, headers: { origin: site, ...options.headers } });

test("poker gateway derives identity and strips cookies and spoofed service headers", async () => {
  let call;
  const gateway = createPokerGateway(account, async (url, options) => {
    call = { url: String(url), ...options };
    return new Response('{"accepted":true}', { headers: { "content-type": "application/json", "set-cookie": "secret=bad", "x-player-id": "forged" } });
  });
  const response = await gateway(request("/poker/api/command", { method: "POST", body: "{}", headers: {
    "content-type": "application/json", cookie: "session=private", authorization: "Bearer poker-session",
    "x-poker-service-token": "forged", "x-player-id": "999", "x-player-login": "fake", "x-poker-instance": "cd".repeat(32),
  } }), env);
  assert.equal(response.status, 200);
  assert.equal(call.url, "https://relay.example/poker/api/command");
  assert.equal(call.redirect, "error");
  assert.equal(call.headers.get("cookie"), null);
  assert.equal(call.headers.get("x-player-id"), "101");
  assert.equal(call.headers.get("x-player-login"), "player-one");
  assert.equal(call.headers.get("x-player-display"), "Player%20One");
  assert.equal(call.headers.get("x-poker-service-token"), env.POKER_SERVICE_TOKEN);
  assert.equal(call.headers.get("authorization"), "Bearer poker-session");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-player-id"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("poker gateway fails closed on missing config, sign-out, wrong origin, unknown routes and oversized streaming bodies", async () => {
  let calls = 0;
  const forward = async () => { calls++; throw new Error("must not forward"); };
  const gateway = createPokerGateway(account, forward);
  assert.equal((await gateway(request("/poker/api/health"), {})).status, 503);
  assert.equal((await createPokerGateway(async () => null, forward)(request("/poker/api/health"), env)).status, 401);
  assert.equal((await gateway(request("/poker/api/health", { headers: { origin: "https://other.example" } }), env)).status, 403);
  assert.equal((await gateway(request("/poker/api/admin"), env)).status, 404);
  assert.equal((await gateway(request("/poker/api/session"), env)).status, 405);
  assert.equal((await gateway(request("/poker/api/state?table=1&table=2"), env)).status, 400);
  assert.equal((await gateway(request("/poker/api/state?redirect=https://other.example"), env)).status, 400);
  assert.equal((await gateway(request("/poker/api/health"), { ...env, POKER_SERVICE_URL: "http://relay.example" })).status, 503);
  assert.equal((await gateway(request("/poker/api/health"), { ...env, POKER_SERVICE_URL: site })).status, 503);
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
  assert.equal((await gateway(request("/poker/api/command", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" }), env)).status, 413);
  assert.equal(calls, 0);
});

test("poker gateway rejects upstream HTML and redirects instead of delivering executable error pages", async () => {
  for (const response of [new Response("bad", { headers: { "content-type": "text/html" } }), new Response(null, { status: 302, headers: { location: site } })]) {
    const gateway = createPokerGateway(account, async () => response);
    assert.equal((await gateway(request("/poker/worker.js"), env)).status, 502);
  }
});

const C = loadProtocol().pokerCrypto;
const proof = async identity => { const nonce = C.nonce(); return { publicKey: identity.publicKey, nonce, signature: await identity.sign("connect", nonce) }; };
const signed = async (identity, table, seq, op, data) => {
  const value = { table, signer: identity.publicKey, seq, op, data };
  return { ...value, signature: await identity.sign("command", value) };
};
const startService = async () => {
  let now = 0;
  const service = createPokerServer({ origins: [site], serviceToken: env.POKER_SERVICE_TOKEN, clock: () => now });
  await new Promise(resolve => service.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  const headers = (id = 101, token = "", instance = "") => ({ origin: site, "content-type": "application/json", "x-poker-service-token": env.POKER_SERVICE_TOKEN,
    "x-player-id": String(id), "x-player-login": "player-" + id, "x-player-display": "Player%20" + id, authorization: "Bearer " + token, "x-poker-instance": instance });
  const post = (path, value, h) => fetch(origin + path, { method: "POST", headers: h, body: JSON.stringify(value) });
  const close = async () => { service.server.closeAllConnections(); await new Promise(resolve => service.server.close(resolve)); };
  return { ...service, origin, headers, post, close, advance: n => { now = n; } };
};

test("account sessions reconnect the same key, reject identity/token substitution and serialize cross-table joins", async () => {
  const s = await startService(), identity = C.player(), other = C.player();
  try {
    const connected = await s.post("/poker/api/session", await proof(identity), s.headers());
    assert.equal(connected.status, 201);
    const a = await connected.json(), h = s.headers(101, a.token, a.instance);
    const again = await (await s.post("/poker/api/session", await proof(identity), s.headers())).json();
    assert.equal(again.token, a.token);
    assert.equal((await s.post("/poker/api/session", await proof(other), s.headers())).status, 400);
    assert.equal((await s.post("/poker/api/session", await proof(identity), s.headers(202))).status, 400);
    assert.equal((await fetch(s.origin + "/poker/api/health", { headers: { origin: site } })).status, 403);
    assert.equal((await fetch(s.origin + "/poker/api/state?table=0", { headers: s.headers(202, a.token, a.instance) })).status, 401);
    assert.equal((await fetch(s.origin + "/poker/api/state?table=0", { headers: s.headers(101, a.token, "00".repeat(32)) })).status, 409);
    assert.equal((await s.post("/poker/api/command", await signed(identity, 0, 1, "join", { name: "Spoof" }), h)).status, 400);
    const joins = await Promise.all([0, 1].map(async table => s.post("/poker/api/command", await signed(identity, table, 1, "join", { name: "Player 101" }), h)));
    assert.deepEqual(joins.map(r => r.status).sort(), [200, 400]);
    assert.equal(s.tables.filter(t => t.summary().state.seats.some(p => p?.id === identity.publicKey)).length, 1);
  } finally { identity.dispose(); other.dispose(); await s.close(); }
});

test("restored crypto keys keep identity and reject zero and noncanonical secrets", async () => {
  const original = C.player(), restored = C.player(original.checkpoint());
  try {
    assert.equal(restored.publicKey, original.publicKey);
    assert.ok(await C.signatureValid(original.publicKey, "checkpoint", "test", await restored.sign("checkpoint", "test")));
    for (const bad of ["0".repeat(64), "f".repeat(64), "1", "A".repeat(64), {}]) assert.throws(() => C.player(bad));
  } finally { original.dispose(); restored.dispose(); }
  assert.throws(() => restored.checkpoint());
});

// Regression: actual worker code must retry identical signed bytes after the relay accepts a key
// but its HTTP response is lost. Storage is an adapter here; real IndexedDB/locks need browser play-test.
test("private worker reload recovers a hand key and pending move, then erases that key on verified cancellation", { timeout: 60000 }, async () => {
  const s = await startService(), peer = C.player(), workers = [], messages = [], bodies = [];
  let saved = null;
  const workerSource = "self.window=self;\n" + source + "\n" + readFileSync(new URL("../../src/js/poker-worker.js", import.meta.url), "utf8");
  const wrapper = `const { parentPort, workerData } = require('node:worker_threads');
    const vm = require('node:vm'), { webcrypto } = require('node:crypto');
    let value = workerData.saved;
    const ctx = { crypto: webcrypto, TextEncoder, setTimeout, clearTimeout, AbortController,
      postMessage: message => parentPort.postMessage(message),
      fetch: async (path, options = {}) => {
        const response = await fetch(new URL(path, workerData.origin), { ...options, headers: { ...workerData.headers, ...options.headers } });
        if (options.body && JSON.parse(options.body).op === 'key') {
          parentPort.postMessage({ type: 'key-sent', body: options.body, accepted: response.ok });
          if (workerData.loseKeyReply) return new Promise(() => {});
        }
        return response;
      } };
    ctx.self = ctx; vm.runInNewContext(workerData.source, ctx);
    ctx.BL.pokerRecovery = { open: async () => ({ load: async () => value,
      save: async checkpoint => { value = JSON.parse(JSON.stringify(checkpoint)); parentPort.postMessage({ type: 'saved', value }); },
      clear: async () => { value = null; }, close() {} }) };
    parentPort.on('message', data => ctx.onmessage({ data }));`;
  const spawn = loseKeyReply => {
    const worker = new Worker(wrapper, { eval: true, workerData: { source: workerSource, origin: s.origin, headers: s.headers(), saved, loseKeyReply } });
    workers.push(worker);
    worker.on("error", error => messages.push({ type: "fatal", message: error.message }));
    worker.on("message", message => {
      if (message.type === "saved") saved = message.value;
      else if (message.type === "key-sent") bodies.push(message);
      else messages.push(message);
    });
    worker.postMessage({ type: "connect", table: 0 }); return worker;
  };
  const waitFor = async predicate => {
    const end = Date.now() + 20000;
    while (!predicate()) {
      const fatal = messages.find(m => m.type === "fatal"); if (fatal) throw new Error(fatal.message);
      if (Date.now() > end) throw new Error("Recovery fixture timed out");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  try {
    const p = await (await s.post("/poker/api/session", await proof(peer), s.headers(202))).json();
    assert.equal((await s.post("/poker/api/command", await signed(peer, 0, 1, "join", { name: "Player 202" }), s.headers(202, p.token, p.instance))).status, 200);
    const first = spawn(true);
    await waitFor(() => messages.some(m => m.type === "state"));
    first.postMessage({ type: "action", name: "join" });
    await waitFor(() => s.tables[0].summary().state.seats.filter(Boolean).length === 2);
    first.postMessage({ type: "action", name: "start" });
    await waitFor(() => bodies.length === 1 && saved?.pending && saved?.hand);
    assert.ok(bodies[0].accepted);
    const secret = saved.hand, key = saved.publicKey;
    await first.terminate(); messages.length = 0;
    const second = spawn(false);
    await waitFor(() => bodies.length === 2 && !saved.pending && messages.some(m => m.type === "state"));
    assert.equal(bodies[1].body, bodies[0].body);
    assert.ok(bodies[1].accepted);
    assert.equal(saved.hand, secret);
    assert.equal(saved.publicKey, key);
    assert.equal(s.tables[0].state().keys.length, 1);
    s.advance(90001); await s.sweep();
    await waitFor(() => saved.hand === null && saved.lastRecord?.events.at(-1).request.op === "cancel");
    assert.equal(saved.keyHand, "");
    await second.terminate();
  } finally { for (const worker of workers) await worker.terminate(); peer.dispose(); await s.close(); }
});
