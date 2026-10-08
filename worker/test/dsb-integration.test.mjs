import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as protocol from "../src/protocol.js";
import { sfuClient } from "../src/sfu.js";

const zones = ["dsb-outside", "dsb-studio", "dsb-maxis", "dsb-without-rulers", "dsb-proof-of-ink", "dsb-big-bitcoin", "dsb-meme-factory", "dsb-stackchain", "dsb-svrn"];
test("every DSB venue isolates voice from other venues, hub and Bifrost", () => {
  const player = (id, zone) => ({ id, zone, body: `ooga-${id}`, voice: { sub: "receive", track: "mic" } });
  for (const zone of zones) {
    assert.deepEqual(protocol.parseClientMessage(JSON.stringify({ t: "zone", name: zone })), { t: "zone", name: zone });
    const peers = [player(1, zone), player(2, zone), ...zones.filter(z => z !== zone).map((z, i) => player(i + 3, z)), player(20, "outside"), player(21, "scene-bifrost")];
    assert.deepEqual(protocol.voicePeers(peers).get(1), [2]);
    peers[0].zone = "scene-bifrost";
    assert.deepEqual(protocol.voicePeers(peers).get(1), [21]);
    peers[0].body = null;
    assert.deepEqual(protocol.voicePeers(peers).get(1), []);
  }
});

// Execute the real room methods with a minimal Cloudflare host, sockets and SFU mocked.
const roomClass = () => {
  const source = readFileSync(new URL("../src/room.js", import.meta.url), "utf8")
    .replace(/import\s+[\s\S]*?from\s+"[^"]+";/g, "")
    .replace("export class Room", "class Room") + "\nglobalThis.Room = Room;";
  const context = { ...protocol, DurableObject: class {}, sfuClient, CAST_ROWS: [{ handle: "YellowBrokeIt", github_login: "YellowBrokeIt" }], Date, Map, Set, setTimeout, clearTimeout };
  runInNewContext(source, context);
  return context.Room;
};
test("room broadcasts DSB zone changes, persists them and keeps ownership enforcement", () => {
  const Room = roomClass(), room = Object.create(Room.prototype), sent = [];
  room.players = new Map(); room.voiceSig = new Map();
  let attachment;
  const ws = { deserializeAttachment: () => ({ id: 1 }), serializeAttachment: value => { attachment = value; }, send: text => sent.push(JSON.parse(text)) };
  const player = room.record(ws, { id: 1, login: "YellowBrokeIt", display: "Yellow", body: "YellowBrokeIt", x: -45, y: 40, z: -43, yaw: 0 });
  room.players.set(1, player);
  room.webSocketMessage(ws, JSON.stringify({ t: "zone", name: "dsb-svrn" }));
  assert.equal(room.view(player).zone, "dsb-svrn");
  assert.equal(attachment.zone, "dsb-svrn");
  assert.ok(sent.some(m => m.t === "zone" && m.id === 1 && m.name === "dsb-svrn"));
  room.webSocketMessage(ws, JSON.stringify({ t: "body", name: "someone-else" }));
  assert.equal(player.body, null);
  assert.ok(sent.some(m => m.t === "release" && m.reason === "not-yours"));
  room.webSocketMessage(ws, JSON.stringify({ t: "zone", name: "scene-bifrost" }));
  assert.equal(room.view(player).zone, "scene-bifrost");
});

test("voice lists survive the room sleeping and follow a microphone published again", () => {
  const Room = roomClass();
  const socket = (id, store) => ({ sent: [], deserializeAttachment: () => store.a, serializeAttachment(value) { store.a = JSON.parse(JSON.stringify(value)); }, send(text) { this.sent.push(JSON.parse(text)); } });
  const stores = { 1: {}, 2: {} }, sockets = { 1: socket(1, stores[1]), 2: socket(2, stores[2]) };
  const wake = () => {
    const room = Object.create(Room.prototype);
    room.sfu = {};
    room.players = new Map();
    for (const id of [1, 2]) if (stores[id].a) room.players.set(id, room.record(sockets[id], stores[id].a));
    return room;
  };
  const room = Object.create(Room.prototype);
  room.sfu = {};
  room.players = new Map();
  for (const id of [1, 2]) {
    const p = room.record(sockets[id], { id, login: `p${id}`, display: `p${id}`, body: `ooga-${id}`, zone: "factory.hall", x: 0, y: 0, z: 0, yaw: 0 });
    p.voice = { pub: `pub${id}`, sub: `sub${id}`, track: "mic", gen: 10 + id };
    room.players.set(id, p);
    sockets[id].serializeAttachment(room.attachment(p));
  }
  room.updateVoice();
  const last = (id) => sockets[id].sent.filter((m) => m.t === "voice").at(-1);
  assert.deepEqual(last(1), { t: "voice", peers: [2], gens: [12] });
  // Asleep and woken: the room still knows what it sent, so nothing repeats...
  const woken = wake();
  const before = sockets[1].sent.length;
  woken.updateVoice();
  assert.equal(sockets[1].sent.length, before);
  // ...and when the other leaves, the list that just went empty is sent (it used to be assumed sent).
  woken.players.delete(2);
  woken.updateVoice();
  assert.deepEqual(last(1), { t: "voice", peers: [], gens: [] });
  // The other back with a microphone published again: a new count, so the listener pulls it anew.
  const back = woken.record(sockets[2], { id: 2, login: "p2", display: "p2", body: "ooga-2", zone: "factory", x: 0, y: 0, z: 0, yaw: 0 });
  back.voice = { pub: "pub2b", sub: "sub2b", track: "mic", gen: 99 };
  woken.players.set(2, back);
  woken.updateVoice();
  assert.deepEqual(last(1), { t: "voice", peers: [2], gens: [99] }, "the tunnel and the hall share voice");
});

test("SFU stays unavailable without secrets and uses bounded upstream calls with mocked transport", async () => {
  assert.equal(sfuClient({}), null);
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ sessionId: "fixture" }) }; };
  try {
    const client = sfuClient({ REALTIME_APP_ID: "fixture-app", REALTIME_SECRET: "fixture-only" });
    await client.newSession(); await client.newTracks("fixture", { tracks: [] });
    await client.renegotiate("fixture", "fixture-sdp"); await client.closeTracks("fixture", ["0"]);
    assert.deepEqual(calls.map(c => c.options.method), ["POST", "POST", "PUT", "PUT"]);
    assert.ok(calls.every(c => c.url.startsWith("https://rtc.live.cloudflare.com/v1/apps/fixture-app/sessions/")));
    assert.equal(JSON.parse(calls[3].options.body).force, true);
  } finally { globalThis.fetch = original; }
});

// Regression: a table voice choice survives hibernation, but never a scene change.
test("room scopes poker voice to Ember Den and clears it on departure", () => {
  const Room = roomClass(), room = Object.create(Room.prototype);
  room.players = new Map(); room.sfu = {};
  let attachment;
  const ws = { deserializeAttachment: () => ({ id: 1 }), serializeAttachment: value => { attachment = value; }, send() {} };
  const player = room.record(ws, { id: 1, login: "fixture", display: "Fixture", body: "fixture", zone: "outside" });
  room.players.set(1, player);
  const send = message => room.webSocketMessage(ws, JSON.stringify(message));
  send({ t: "poker-voice", table: 2 }); assert.equal(player.pokerVoice, null);
  send({ t: "zone", name: "ember-den" }); send({ t: "poker-voice", table: 2 });
  assert.equal(attachment.pokerVoice, 2);
  assert.equal(room.record(ws, attachment).pokerVoice, 2);
  assert.equal(room.view(player).zone, "ember-den");
  send({ t: "zone", name: "outside" });
  assert.equal(attachment.pokerVoice, null);
  send({ t: "zone", name: "ember-den" }); assert.equal(player.pokerVoice, null);
});
