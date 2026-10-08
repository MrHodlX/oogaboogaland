// Pure checks on the room's wire format and limits: no Durable Object, no sockets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOUND_XZ, MESSAGE_MAX, MOVE_HZ, parseClientMessage, playerFromHeaders, spawnPoint, takeToken } from "../src/protocol.js";

test("poses inside the bounds are accepted, rounded and their yaw wrapped", () => {
  const m = parseClientMessage(JSON.stringify({ t: "pose", x: 1.23456, y: -7, z: 3, yaw: 7 }));
  assert.equal(m.t, "pose");
  assert.equal(m.x, 1.235);
  assert.ok(Math.abs(m.yaw - (7 - 2 * Math.PI)) < 1e-3);
});

test("poses out of bounds or not numbers are ignored, not fatal", () => {
  for (const bad of [{ x: BOUND_XZ + 1, y: 0, z: 0, yaw: 0 }, { x: 0, y: 500, z: 0, yaw: 0 }, { x: "1", y: 0, z: 0, yaw: 0 }, { x: 0, y: 0, z: 0 }]) {
    assert.equal(parseClientMessage(JSON.stringify({ t: "pose", ...bad })), null, JSON.stringify(bad));
  }
});

test("a body is an Ooga name or null; anything else is ignored", () => {
  assert.deepEqual(parseClientMessage('{"t":"body","name":"w-s-bitcoin"}'), { t: "body", name: "w-s-bitcoin" });
  assert.deepEqual(parseClientMessage('{"t":"body","name":null}'), { t: "body", name: null });
  assert.equal(parseClientMessage('{"t":"body","name":"<b>"}'), null);
  assert.equal(parseClientMessage('{"t":"body","name":""}'), null);
});

test("unknown types are ignored; unreadable or oversized frames close the socket", () => {
  assert.equal(parseClientMessage('{"t":"teleport","id":1}'), null);
  assert.equal(parseClientMessage("{nope"), false);
  assert.equal(parseClientMessage("[1,2]"), false);
  assert.equal(parseClientMessage(" ".repeat(MESSAGE_MAX + 1)), false);
  assert.equal(parseClientMessage(undefined), false);
});

test("the move bucket allows MOVE_HZ a second and refills with time", () => {
  const b = { tokens: MOVE_HZ, at: 0 };
  let spent = 0;
  for (let i = 0; i < 100; i++) if (takeToken(b, MOVE_HZ, 0)) spent++;
  assert.equal(spent, MOVE_HZ);
  assert.ok(!takeToken(b, MOVE_HZ, 10));
  assert.ok(takeToken(b, MOVE_HZ, 60));
});

test("spawn slots ring the pile, eight apart, facing it", () => {
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    const s = spawnPoint(i);
    assert.ok(Math.abs(Math.hypot(s.x, s.z) - 3.5) < 1e-2);
    seen.add(`${s.x},${s.z}`);
  }
  assert.equal(seen.size, 8);
  assert.deepEqual(spawnPoint(8), spawnPoint(0));
});

test("identity comes only from the Worker's headers, all or nothing", () => {
  const h = (o) => new Headers(o);
  assert.deepEqual(playerFromHeaders(h({ "x-player-id": "42", "x-player-login": "ooga" })), { id: 42, login: "ooga", display: "ooga", contributor: false });
  assert.equal(playerFromHeaders(h({ "x-player-id": "42", "x-player-login": "ooga", "x-player-contributor": "1" })).contributor, true);
  assert.equal(playerFromHeaders(h({ "x-player-login": "ooga" })), null);
  assert.equal(playerFromHeaders(h({ "x-player-id": "abc", "x-player-login": "ooga" })), null);
  assert.equal(playerFromHeaders(h({ "x-player-id": "42" })), null);
});

test("who may drive which Ooga: owners only their own, others only while the owner is away and nobody holds it", async () => {
  const { castIndex, claimRefusal } = await import("../src/protocol.js");
  const cast = castIndex([
    { handle: "bc1gui", github_login: "ottoz0r" },
    { handle: "portlandhodl", github_login: "portlandhodl" },
    { handle: "rules-without-rulers", github_login: "rules-without-rulers" },
  ]);
  const room = (...players) => players.map(([login, body = null]) => ({ login, body }));
  // A contributor, known by GitHub login: their own Ooga, and nothing else.
  assert.equal(claimRefusal(cast, "ottoz0r", "bc1gui", room()), null);
  assert.equal(claimRefusal(cast, "OTTOZ0R", "BC1GUI", room()), null);
  assert.equal(claimRefusal(cast, "ottoz0r", "portlandhodl", room()), "not-yours");
  // A handle is a name, not a login: another account called bc1gui owns nothing.
  assert.equal(claimRefusal(cast, "bc1gui", "bc1gui", room(["ottoz0r"])), "owner-here");
  // A visitor: only while the owner is away and nobody else holds it.
  assert.equal(claimRefusal(cast, "visitor", "portlandhodl", room()), null);
  assert.equal(claimRefusal(cast, "visitor", "portlandhodl", room(["portlandhodl"])), "owner-here");
  assert.equal(claimRefusal(cast, "visitor", "portlandhodl", room(["someone", "portlandhodl"])), "taken");
  assert.equal(claimRefusal(cast, "visitor", "portlandhodl", room(["visitor", "portlandhodl"])), null);
  assert.equal(claimRefusal(cast, "visitor", "nobody-real", room()), "unknown");
  assert.equal(claimRefusal(cast, "visitor", null, room(["portlandhodl"])), null);
  // Eligibility is a Worker-vouched flag, persisted in the room's attachment.
  assert.equal(claimRefusal(cast, "new-ooga", "new-ooga", room()), "unknown");
  assert.equal(claimRefusal(cast, "new-ooga", "NEW-OOGA", room(), true), null);
  assert.equal(claimRefusal(cast, "new-ooga", "portlandhodl", room(), true), "not-yours");
  assert.equal(claimRefusal(cast, "visitor", "new-ooga", room(["new-ooga", "new-ooga"])), "unknown");
  assert.equal(claimRefusal(cast, "ottoz0r", "ottoz0r", room(), true), "not-yours");
  assert.equal(claimRefusal(cast, "ottoz0r", "bc1gui", room(), true), null);
  assert.equal(claimRefusal(cast, "bc1gui", "bc1gui", room(["ottoz0r"]), true), "owner-here");
});

test("voice: players driving an Ooga hear each other while in the same place; nobody else does", async () => {
  const { voicePeers, parseClientMessage } = await import("../src/protocol.js");
  const on = { pub: "p", sub: "s", track: "mic" };
  const p = (id, body, zone, voice = on) => ({ id, body, zone, voice });
  const players = [
    p(1, "bc1gui", "outside"), p(2, "portlandhodl", "outside"), p(3, "w-s-bitcoin", "cave-lab"),
    p(4, null, "outside"), p(5, "MrHodlX", "outside", { pub: null, sub: "s", track: null }), p(6, "DrNeski", "outside", { pub: "p", sub: null, track: "mic" }),
    p(7, "timechainb", "cave-lab"), p(8, "Tmmmemcee", "hq"),
  ];
  const peers = voicePeers(players);
  assert.deepEqual(peers.get(1), [2, 6]);
  assert.deepEqual(peers.get(2), [1, 6]);
  assert.deepEqual(peers.get(3), [7], "a cave hears only its own");
  assert.deepEqual(peers.get(7), [3]);
  assert.deepEqual(peers.get(8), [], "alone in HQ hears nobody outside it");
  assert.deepEqual(peers.get(4), [], "not driving an Ooga hears nobody");
  assert.deepEqual(peers.get(5), [1, 2, 6], "listening without a microphone is allowed");
  assert.deepEqual(peers.get(6), [], "no receiving session, nothing to hear");
  assert.deepEqual(parseClientMessage('{"t":"zone","name":"cave-lab"}'), { t: "zone", name: "cave-lab" });
  assert.equal(parseClientMessage('{"t":"zone","name":"Cave Lab!"}'), null);
  assert.deepEqual(parseClientMessage('{"t":"mute","on":true}'), { t: "mute", on: true }, "a muted microphone reaches every roster");
  assert.equal(parseClientMessage('{"t":"mute","on":"yes"}'), null);
  assert.equal(parseClientMessage('{"t":"mute"}'), null);
});

test("voice zones: a group shares voice across its places; nobody is heard from none", async () => {
  const { voicePeers, parseClientMessage, zoneGroup } = await import("../src/protocol.js");
  const on = { pub: "p", sub: "s", track: "mic" };
  const p = (id, zone) => ({ id, body: `ooga-${id}`, zone, voice: on });
  const peers = voicePeers([p(1, "factory"), p(2, "factory.hall"), p(3, "outside"), p(4, "sphere"), p(5, "none"), p(6, "none"), p(7, "bifrost"), p(8, "bifrost.chamber")]);
  assert.deepEqual(peers.get(1), [2], "the Factory's tunnel hears its hall");
  assert.deepEqual(peers.get(2), [1]);
  assert.deepEqual(peers.get(3), [], "the island does not hear a bridged land");
  assert.deepEqual(peers.get(4), []);
  assert.deepEqual(peers.get(5), [], "off the island's edge hears nobody, not even another off it");
  assert.deepEqual(peers.get(7), [8], "the Bifrost isle hears its chamber");
  assert.equal(zoneGroup("arcade.hall"), "arcade");
  assert.equal(zoneGroup("dsb-studio"), "dsb-studio");
  assert.deepEqual(parseClientMessage('{"t":"zone","name":"factory.hall"}'), { t: "zone", name: "factory.hall" });
  assert.equal(parseClientMessage('{"t":"zone","name":"a.b.c"}'), null);
  assert.equal(parseClientMessage('{"t":"zone","name":".hall"}'), null);
});

test("health: a driven Ooga's health is clamped to 0-100 and needs its knocked-out flag", async () => {
  const { parseClientMessage } = await import("../src/protocol.js");
  assert.deepEqual(parseClientMessage('{"t":"hp","v":63.6,"ko":false}'), { t: "hp", v: 64, ko: false });
  assert.deepEqual(parseClientMessage('{"t":"hp","v":-5,"ko":true}'), { t: "hp", v: 0, ko: true });
  assert.deepEqual(parseClientMessage('{"t":"hp","v":250,"ko":false}'), { t: "hp", v: 100, ko: false });
  assert.equal(parseClientMessage('{"t":"hp","v":"50","ko":false}'), null);
  assert.equal(parseClientMessage('{"t":"hp","v":50}'), null);
});

// Contract: spectators keep floor visibility while hearing only the table they selected.
test("Ember Den voice separates ten tables and the walking floor without changing zones", async () => {
  const { voicePeers } = await import("../src/protocol.js");
  const player = (id, pokerVoice) => ({ id, pokerVoice, zone: "ember-den", body: `fixture-${id}`, voice: { sub: "receive", track: "mic" } });
  const players = [player(1, 0), player(2, 0), player(3, 1), player(4, null), player(5, null), player(6, 9)];
  const peers = voicePeers(players);
  assert.deepEqual(peers.get(1), [2]);
  assert.deepEqual(peers.get(3), []);
  assert.deepEqual(peers.get(4), [5]);
  assert.deepEqual(peers.get(6), []);
  players[2].pokerVoice = 0;
  assert.deepEqual(voicePeers(players).get(3), [1, 2]);
  assert.ok(players.every(p => p.zone === "ember-den"));
  for (const table of [null, 0, 9]) assert.deepEqual(parseClientMessage(JSON.stringify({ t: "poker-voice", table })), { t: "poker-voice", table });
  for (const table of [-1, 10, 0.5, "0", undefined]) assert.equal(parseClientMessage(JSON.stringify({ t: "poker-voice", table })), null);
});

test("NPC host: the page longest in the room among those showing the island; nobody when none does", async () => {
  const { electHost, parseClientMessage } = await import("../src/protocol.js");
  const p = (id, joinedAt, inHub) => ({ id, joinedAt, inHub });
  assert.equal(electHost([p(1, 100, true), p(2, 50, true), p(3, 10, false)]), 2);
  assert.equal(electHost([p(1, 100, true), p(2, 100, true)]), 1, "a tie goes to the lower id");
  assert.equal(electHost([p(1, 100, false)]), 0);
  assert.equal(electHost([]), 0);
  assert.deepEqual(parseClientMessage('{"t":"hub","on":true}'), { t: "hub", on: true });
  assert.equal(parseClientMessage('{"t":"hub","on":"yes"}'), null);
});

test("NPC followers: every other page showing the island, so a lone host sends nothing", async () => {
  const { electHost, npcFollowers } = await import("../src/protocol.js");
  const p = (id, joinedAt, inHub) => ({ id, joinedAt, inHub });
  const alone = [p(1, 10, true), p(2, 20, false)];
  assert.equal(npcFollowers(alone, electHost(alone)), 0, "a page elsewhere or hidden does not follow");
  const two = [p(1, 10, true), p(2, 20, true), p(3, 30, false)];
  assert.equal(npcFollowers(two, electHost(two)), 1);
  assert.equal(npcFollowers(two, 0), 0, "no host, no followers");
});
