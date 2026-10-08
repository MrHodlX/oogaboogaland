// The island room: one Durable Object holding every signed-in player's socket. The Worker is its
// only door (`/room`), and it hands over who the player is in x-player-* headers after checking the
// session; nothing a client sends can change its identity. Ported from the OBL-Audio prototype:
// hibernatable sockets with attachments, a snapshot at most 15 times a second while anything moves, an
// alarm sweeping silent sockets once a minute, and one socket per player, where a newer one kicks the older with `replaced`.
// Every claim on an Ooga passes `claimRefusal` against the cast the build writes (characters.gen.json).
// Voice: the room alone talks to the Realtime SFU (the secret stays here), decides who hears whom
// (`voicePeers`: both driving an Ooga in the same place) and re-checks it on every pull, so a page never
// learns another player's session and cannot pull a voice it may not hear.
// NPCs: the room elects one page as host (`electHost`), relays its binary pose frames to every other
// page showing the island, and keeps the latest frame for pages that arrive or come back.
// Cost: the room hibernates whenever nothing is happening, so no timer runs while idle: a snapshot is a
// one-shot flush scheduled by a pose, voice lists are sent when who hears whom can change, and the host
// is told how many pages follow it (`host { id, followers }`) so a lone host sends no frames, and who is
// in voice or muted goes out (`vstate`) only when it changes, as health does (`hp`). The last voice list
// each player was sent lives in its attachment (`sent`), so a woken room still knows what every page holds.

import { DurableObject } from "cloudflare:workers";
import {
  CLOSE_KICK, CLOSE_PROTOCOL, MAX_PLAYERS, MOVE_HZ, STALE_MS, SWEEP_MS, TICK_HZ,
  NPC_FRAME_MAX, NPC_HZ, OUTSIDE, HP_HZ, VOICE_TRACK, castIndex, electHost, npcFollowers, claimRefusal, parseClientMessage, playerFromHeaders, spawnPoint, takeToken, voicePeers,
} from "./protocol.js";
import { sfuClient } from "./sfu.js";
import CAST_ROWS from "./characters.gen.json";

const CAST = castIndex(CAST_ROWS);

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map();
    this.spawnSlot = 0;
    this.dirty = false;
    this.flushTimer = 0;
    this.sfu = sfuClient(env);
    this.hostId = 0;
    this.followers = 0;
    this.lastNpc = null;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // The pile's sound loop started once, for good: every page plays it at (now - loopEpoch), so all
    // hear the same crackle at the same moment. Stored, so a woken or redeployed room keeps the phase.
    this.loopEpoch = 0;
    ctx.blockConcurrencyWhile(async () => {
      this.loopEpoch = (await ctx.storage.get("loopEpoch")) || Date.now();
      await ctx.storage.put("loopEpoch", this.loopEpoch);
    });
    // A woken room rebuilds its roster from the attachments its sockets carry.
    for (const ws of ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a) this.players.set(a.id, this.record(ws, a));
    }
    this.hostId = electHost(this.players.values());
    this.followers = npcFollowers(this.players.values(), this.hostId);
  }

  record(ws, a) {
    return { ws, voice: { pub: null, sub: null, track: null, gen: 0 }, muted: false, hp: 100, ko: false, sent: null, zone: OUTSIDE, pokerVoice: null, inHub: false, joinedAt: Date.now(), ...a, bucket: { tokens: MOVE_HZ, at: Date.now() }, npcBucket: { tokens: NPC_HZ, at: Date.now() }, hpBucket: { tokens: HP_HZ, at: Date.now() }, seenAt: Date.now() };
  }

  attachment(p) {
    return { id: p.id, login: p.login, display: p.display, contributor: p.contributor, body: p.body, x: p.x, y: p.y, z: p.z, yaw: p.yaw, voice: p.voice, muted: p.muted, hp: p.hp, ko: p.ko, sent: p.sent, zone: p.zone, pokerVoice: p.pokerVoice, inHub: p.inHub, joinedAt: p.joinedAt };
  }

  view(p) {
    return { id: p.id, login: p.login, display: p.display, body: p.body, zone: p.zone, x: p.x, y: p.y, z: p.z, yaw: p.yaw, voice: !!p.voice.track, muted: p.muted, hp: p.hp, ko: p.ko };
  }

  send(ws, msg) {
    try {
      ws.send(typeof msg === "string" || msg instanceof ArrayBuffer ? msg : JSON.stringify(msg));
    } catch {
      // A socket closing under us is dropped by its close event.
    }
  }

  broadcast(msg, except = null) {
    const text = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.ws !== except) this.send(p.ws, text);
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/voice/")) return this.voiceRequest(path.slice("/voice/".length), request);
    if (request.headers.get("upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const who = playerFromHeaders(request.headers);
    if (!who) return new Response("Forbidden", { status: 403 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [String(who.id)]);

    const older = this.players.get(who.id);
    if (older) this.evict(older, "replaced");
    if (this.players.size >= MAX_PLAYERS) {
      this.send(server, { t: "kick", reason: "full" });
      server.close(CLOSE_KICK, "full");
      return new Response(null, { status: 101, webSocket: client });
    }

    const spawn = spawnPoint(this.spawnSlot++);
    const p = this.record(server, { ...who, body: null, x: spawn.x, y: 0, z: spawn.z, yaw: spawn.yaw });
    server.serializeAttachment(this.attachment(p));
    // An owner arriving takes their Ooga back from whoever holds it.
    const own = CAST.handleOf.get(p.login.toLowerCase());
    if (own) for (const o of this.players.values()) if (o.body && o.body.toLowerCase() === own) this.release(o, "owner-here");
    this.players.set(p.id, p);

    const others = [];
    for (const o of this.players.values()) if (o !== p) others.push(this.view(o));
    this.send(server, { t: "welcome", you: this.view(p), players: others, tickHz: TICK_HZ, now: Date.now(), loopEpoch: this.loopEpoch, host: this.hostId, followers: this.followers });
    this.broadcast({ t: "join", p: this.view(p) }, server);
    this.updateVoice();
    await this.ensureSweep();
    return new Response(null, { status: 101, webSocket: client });
  }

  byWs(ws) {
    const a = ws.deserializeAttachment();
    const p = a && this.players.get(a.id);
    return p && p.ws === ws ? p : null;
  }

  webSocketMessage(ws, message) {
    const p = this.byWs(ws);
    if (!p) return;
    if (typeof message !== "string") {
      this.npcFrame(p, message);
      return;
    }
    const msg = parseClientMessage(typeof message === "string" ? message : "");
    if (msg === false) {
      this.drop(p, "protocol");
      ws.close(CLOSE_PROTOCOL, "unreadable message");
      return;
    }
    p.seenAt = Date.now();
    if (!msg) return;
    if (msg.t === "pose") {
      if (!takeToken(p.bucket, MOVE_HZ, p.seenAt)) return;
      p.x = msg.x; p.y = msg.y; p.z = msg.z; p.yaw = msg.yaw;
      this.dirty = true;
      this.scheduleFlush();
    } else if (msg.t === "hub") {
      if (msg.on === p.inHub) return;
      p.inHub = msg.on;
      this.electHost();
      // A page arriving on the island catches up with the NPCs at once rather than at the next frame.
      if (p.inHub && p.id !== this.hostId && this.lastNpc) this.send(p.ws, this.lastNpc);
    } else if (msg.t === "zone") {
      if (msg.name === p.zone) return;
      p.zone = msg.name;
      p.pokerVoice = null;
      this.broadcast({ t: "zone", id: p.id, name: p.zone });
      // The page let go of every voice when it moved, so it always hears where it is now, changed list or not.
      p.sent = null;
      this.updateVoice();
    } else if (msg.t === "poker-voice") {
      if (p.zone !== "ember-den" || msg.table === p.pokerVoice) return;
      p.pokerVoice = msg.table;
      p.sent = null;
      this.updateVoice();
    } else if (msg.t === "hp") {
      if (msg.v === p.hp && msg.ko === p.ko) return;
      if (!takeToken(p.hpBucket, HP_HZ, p.seenAt)) return;
      p.hp = msg.v;
      p.ko = msg.ko;
      this.broadcast({ t: "hp", id: p.id, v: p.hp, ko: p.ko }, p.ws);
    } else if (msg.t === "mute") {
      if (msg.on === p.muted) return;
      p.muted = msg.on;
      this.voiceState(p);
    } else if (msg.t === "body") {
      if (msg.name === p.body) return;
      const refusal = claimRefusal(CAST, p.login, msg.name, this.players.values(), p.contributor);
      if (refusal) {
        this.send(ws, { t: "release", name: msg.name, reason: refusal });
        if (p.body === null) return;
        p.body = null;
      } else {
        p.body = msg.name;
      }
      // Another Ooga, or none: its health is reported afresh.
      p.hp = 100;
      p.ko = false;
      this.broadcast({ t: "body", id: p.id, name: p.body });
      this.updateVoice();
    }
    ws.serializeAttachment(this.attachment(p));
  }

  // The prototype's note stands: on this compatibility date close handlers must not call ws.close().
  webSocketClose(ws) {
    const p = this.byWs(ws);
    if (p) this.drop(p, "closed");
  }

  webSocketError(ws) {
    const p = this.byWs(ws);
    if (p) this.drop(p, "error");
  }

  drop(p, reason) {
    if (this.players.get(p.id) !== p) return;
    this.players.delete(p.id);
    this.broadcast({ t: "leave", id: p.id, reason });
    this.electHost();
    this.updateVoice();
    if (!this.players.size && this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = 0;
    }
  }

  release(p, reason) {
    this.send(p.ws, { t: "release", name: p.body, reason });
    p.body = null;
    p.ws.serializeAttachment(this.attachment(p));
    this.broadcast({ t: "body", id: p.id, name: null });
    this.updateVoice();
  }

  // An explicit kick before the close: a server-initiated close alone can leave the client in CLOSING.
  evict(p, reason) {
    this.drop(p, reason);
    this.send(p.ws, { t: "kick", reason });
    try {
      p.ws.close(CLOSE_KICK, reason);
    } catch {
      // Already closed.
    }
  }

  // One snapshot at most every 1/TICK_HZ while poses arrive, and nothing pending once they stop, so the
  // room can hibernate between bursts (a running interval would keep it awake, and billed, for good).
  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = 0;
      this.snapshot();
    }, 1000 / TICK_HZ);
  }

  snapshot() {
    if (!this.dirty) return;
    this.dirty = false;
    const ps = [];
    for (const p of this.players.values()) ps.push(p.id, p.x, p.y, p.z, p.yaw);
    this.broadcast({ t: "state", now: Date.now(), ps });
  }

  // Also after any page's `hub` flag changes: the host sends frames only while someone follows.
  electHost() {
    const id = electHost(this.players.values());
    const followers = npcFollowers(this.players.values(), id);
    if (id === this.hostId && followers === this.followers) return;
    this.hostId = id;
    this.followers = followers;
    if (!id) this.lastNpc = null;
    this.broadcast({ t: "host", id, followers });
  }

  // A binary frame is the NPC host's poses: taken only from the current host, capped in size and rate,
  // and relayed unchanged to every other page showing the island.
  npcFrame(p, data) {
    if (p.id !== this.hostId || !p.inHub) return;
    if (!(data instanceof ArrayBuffer) || data.byteLength > NPC_FRAME_MAX) return;
    if (!takeToken(p.npcBucket, NPC_HZ, Date.now())) return;
    p.seenAt = Date.now();
    this.lastNpc = data;
    for (const q of this.players.values()) if (q !== p && q.inHub) this.send(q.ws, data);
  }

  // Tells each player whom to hear, with each one's publication (`gens`: a microphone published again is
  // pulled again), only when that changed since the list the player last got (`sent`, kept through a
  // hibernation; null sends regardless). Called wherever it can change: a join or leave, a body or zone, a
  // voice session opened, announced or left.
  updateVoice() {
    if (!this.sfu) return;
    const desired = voicePeers([...this.players.values()]);
    for (const p of this.players.values()) {
      const peers = desired.get(p.id) || [];
      const gens = peers.map((id) => this.players.get(id).voice.gen || 0);
      const sig = peers.map((id, i) => `${id}:${gens[i]}`).join(",");
      if (p.sent === sig) continue;
      p.sent = sig;
      p.ws.serializeAttachment(this.attachment(p));
      this.send(p.ws, { t: "voice", peers, gens });
    }
  }

  // Every other page's roster shows who is in voice (a live microphone) and who muted it: sent on a change only.
  voiceState(p) {
    this.broadcast({ t: "vstate", id: p.id, voice: !!p.voice.track, muted: p.muted }, p.ws);
  }

  // /voice/<op> from the Worker, which checked the session and set x-player-id. Ops: session (a publish
  // or receive session), publish (the mic's offer), live (the publishing connection is up: only now is the
  // mic announced, since pulling a publication before it connects fails), pull (peers the room allows),
  // renegotiate, close (dropped peers' tracks), leave (forget this player's sessions).
  async voiceRequest(op, request) {
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (!this.sfu) return json({ error: "voice is not configured" }, 503);
    const p = this.players.get(Number(request.headers.get("x-player-id")));
    if (!p) return json({ error: "join the island first" }, 409);
    let body = {};
    try {
      body = await request.json();
    } catch {
      // No body.
    }
    const was = !!p.voice.track;
    try {
      if (op === "session") {
        const kind = body.kind === "pub" ? "pub" : "sub";
        const { sessionId } = await this.sfu.newSession();
        p.voice[kind] = sessionId;
        if (kind === "pub") p.voice.track = p.voice.pending = null;
        p.ws.serializeAttachment(this.attachment(p));
        this.updateVoice();
        if (was && !p.voice.track) this.voiceState(p);
        return json({ ok: true });
      }
      if (op === "publish") {
        if (!p.voice.pub || typeof body.sdp !== "string" || typeof body.mid !== "string") return json({ error: "bad publish" }, 400);
        const res = await this.sfu.newTracks(p.voice.pub, {
          sessionDescription: { type: "offer", sdp: body.sdp },
          tracks: [{ location: "local", mid: body.mid, trackName: VOICE_TRACK }],
        });
        const t = res.tracks && res.tracks[0];
        if (!t || t.errorCode) return json({ error: (t && t.errorDescription) || "publish failed" }, 502);
        p.voice.pending = VOICE_TRACK;
        p.ws.serializeAttachment(this.attachment(p));
        return json({ sessionDescription: res.sessionDescription });
      }
      if (op === "live") {
        if (!p.voice.pub || !p.voice.pending) return json({ error: "nothing published" }, 400);
        p.voice.track = p.voice.pending;
        // A new count for every microphone that goes live, never reused: whoever heard an older one pulls this one.
        p.voice.gen = Math.max(Date.now(), (p.voice.gen || 0) + 1);
        p.ws.serializeAttachment(this.attachment(p));
        this.updateVoice();
        if (!was) this.voiceState(p);
        return json({ ok: true });
      }
      if (op === "pull") {
        if (!p.voice.sub || !Array.isArray(body.ids)) return json({ error: "bad pull" }, 400);
        const allowed = new Set(voicePeers([...this.players.values()]).get(p.id) || []);
        const tracks = [], idOf = new Map();
        for (const id of body.ids.slice(0, 64)) {
          const q = this.players.get(id);
          if (!allowed.has(id) || !q || !q.voice.pub) continue;
          tracks.push({ location: "remote", sessionId: q.voice.pub, trackName: q.voice.track });
          idOf.set(q.voice.pub, id);
        }
        if (!tracks.length) return json({ tracks: [], requiresImmediateRenegotiation: false });
        const res = await this.sfu.newTracks(p.voice.sub, { tracks });
        return json({
          tracks: (res.tracks || []).map((t) => ({ id: idOf.get(t.sessionId) ?? null, mid: t.mid, errorCode: t.errorCode })),
          sessionDescription: res.sessionDescription,
          requiresImmediateRenegotiation: !!res.requiresImmediateRenegotiation,
        });
      }
      if (op === "renegotiate") {
        if (!p.voice.sub || typeof body.sdp !== "string") return json({ error: "bad renegotiate" }, 400);
        await this.sfu.renegotiate(p.voice.sub, body.sdp);
        return json({ ok: true });
      }
      if (op === "close") {
        if (!p.voice.sub || !Array.isArray(body.mids)) return json({ error: "bad close" }, 400);
        const mids = body.mids.filter((m) => typeof m === "string").slice(0, 64);
        if (mids.length) await this.sfu.closeTracks(p.voice.sub, mids);
        return json({ ok: true });
      }
      if (op === "leave") {
        p.voice = { pub: null, sub: null, track: null, pending: null, gen: p.voice.gen || 0 };
        p.ws.serializeAttachment(this.attachment(p));
        this.updateVoice();
        if (was) this.voiceState(p);
        return json({ ok: true });
      }
      return json({ error: "unknown voice op" }, 404);
    } catch (err) {
      console.warn(`voice ${op} failed for ${p.id}: ${err.message}`);
      return json({ error: "the voice service did not answer" }, 502);
    }
  }

  async ensureSweep() {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }

  // Sockets silent past STALE_MS, auto-answered pings included, are evicted as stale.
  async alarm() {
    const now = Date.now();
    for (const p of [...this.players.values()]) {
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(p.ws);
      const last = Math.max(p.seenAt, pinged ? pinged.getTime() : 0);
      if (now - last > STALE_MS) this.evict(p, "stale");
    }
    if (this.players.size) await this.ctx.storage.setAlarm(now + SWEEP_MS);
  }
}
