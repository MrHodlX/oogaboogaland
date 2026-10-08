// The room's wire format and the limits it enforces, as pure functions the tests can reach.
//
// Client → room:  { t: "pose", x, y, z, yaw }   the driven Ooga's feet and heading, at most MOVE_HZ
//                 { t: "body", name }            the Ooga being driven, or null when driving none
//                 { t: "zone", name }            where that Ooga is (see Zones below)
//                 { t: "poker-voice", table }     0-9 while watching a table, null for the Ember Den floor
//                 { t: "hub", on }               this page shows the island and is visible (host candidates)
//                 { t: "mute", on }              this page muted its own microphone, for everyone's roster
//                 { t: "hp", v, ko }             the driven Ooga's health (0-100) and whether it is knocked out
//                 binary                         the NPC host's frame of every Ooga's pose, relayed as is
// Room → client:  welcome { you, players, tickHz, now, loopEpoch }, join { p }, leave { id, reason },
//                 body { id, name }, state { now, ps: [id, x, y, z, yaw, ...] }, kick { reason },
//                 release { name, reason }   the Ooga this socket claimed is not, or no longer, its to drive
//                 host { id, followers }     who runs the NPCs now (0 for nobody) and how many pages follow
//                                            them (a host with none sends nothing); binary NPC frames from them
//                 vstate { id, voice, muted }  a player's microphone went live or off, or they muted it; welcome
//                                            and join carry the same two fields on every player, and hp and ko
//                 hp { id, v, ko }           a player's driven Ooga's health changed
//                 voice { peers, gens }      whom to hear, and each one's publication count (a new count is a
//                                            microphone published again, to be pulled again)
// Zones: `<group>` or `<group>.<place>`. Voice is shared within a group; who is shown is matched on the whole
// name, since a place inside a group can have coordinates of its own (the Factory's tunnel on the island and
// its hall). `none` is nowhere: off the island's edge, or between scenes; it shares voice with nobody.
// "ping" answers "pong" without waking the room (setWebSocketAutoResponse).

export const TICK_HZ = 15;
export const MOVE_HZ = 20;
export const MAX_PLAYERS = 32;
export const MESSAGE_MAX = 256;
// The sweep only catches half-open sockets (a clean disconnect closes at once), and every alarm wakes the
// room, so it runs once a minute; three missed 10 s pings make a socket stale.
export const STALE_MS = 90000;
export const SWEEP_MS = 60000;
// Generous bounds around the hub: jetpack flight reaches about 140 out and 72 up, falls end at -120.
export const BOUND_XZ = 160;
export const BOUND_Y_MIN = -130;
export const BOUND_Y_MAX = 100;
export const BODY_NAME = /^[A-Za-z0-9_.-]{1,40}$/;
export const ZONE_NAME = /^[a-z0-9-]{1,24}(\.[a-z0-9-]{1,16})?$/;
export const OUTSIDE = "outside";
export const NOWHERE = "none";
// Health reports: a fight sends a few a second at most; at full health nothing is sent.
export const HP_HZ = 4;
// Close codes: 4000 follows a `kick` (replaced, stale, full); 4400 is a message the room cannot read.
export const CLOSE_KICK = 4000;
// NPC frames: the host sends about 4 a second, only while a page follows; a frame of every Ooga's pose is a few kilobytes.
// Up to 128 bundled Oogas (112 floats each), plus the bounded event tail.
// The former 16 KiB cap could not carry the org-wide roster after reconciliation.
export const NPC_FRAME_MAX = 128 * 112 * 4 + 131072;
export const NPC_HZ = 20;
export const CLOSE_PROTOCOL = 4400;

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const round = (v) => Math.round(v * 1000) / 1000;

/** A parsed client message, `null` for one to ignore, or `false` for one that should close the socket. */
export const parseClientMessage = (text) => {
  if (typeof text !== "string" || text.length > MESSAGE_MAX) return false;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return false;
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return false;
  if (msg.t === "pose") {
    const { x, y, z, yaw } = msg;
    if (!finite(x) || !finite(y) || !finite(z) || !finite(yaw)) return null;
    if (Math.abs(x) > BOUND_XZ || Math.abs(z) > BOUND_XZ || y < BOUND_Y_MIN || y > BOUND_Y_MAX) return null;
    return { t: "pose", x: round(x), y: round(y), z: round(z), yaw: round(Math.atan2(Math.sin(yaw), Math.cos(yaw))) };
  }
  if (msg.t === "body") {
    if (msg.name === null) return { t: "body", name: null };
    return typeof msg.name === "string" && BODY_NAME.test(msg.name) ? { t: "body", name: msg.name } : null;
  }
  if (msg.t === "hub") return typeof msg.on === "boolean" ? { t: "hub", on: msg.on } : null;
  if (msg.t === "mute") return typeof msg.on === "boolean" ? { t: "mute", on: msg.on } : null;
  if (msg.t === "hp") return finite(msg.v) && typeof msg.ko === "boolean" ? { t: "hp", v: Math.max(0, Math.min(100, Math.round(msg.v))), ko: msg.ko } : null;
  if (msg.t === "zone") return typeof msg.name === "string" && ZONE_NAME.test(msg.name) ? { t: "zone", name: msg.name } : null;
  if (msg.t === "poker-voice") return msg.table === null || Number.isInteger(msg.table) && msg.table >= 0 && msg.table < 10 ? { t: "poker-voice", table: msg.table } : null;
  return null;
};

/** A token bucket per player: `rate` a second, bursting to `rate`. Mutates and answers whether one is spent. */
export const takeToken = (bucket, rate, now) => {
  bucket.tokens = Math.min(rate, bucket.tokens + (now - bucket.at) * rate / 1000);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
};

/** Eight spawn slots on a ring round the pile, so arrivals do not stand in one another. */
export const spawnPoint = (slot) => {
  const a = (slot % 8) * Math.PI / 4;
  return { x: round(Math.sin(a) * 3.5), z: round(Math.cos(a) * 3.5), yaw: round(Math.atan2(-Math.sin(a), -Math.cos(a))) };
};

/** The identity the Worker vouched for, read from its headers; null when any part is missing. */
export const playerFromHeaders = (headers) => {
  const id = Number(headers.get("x-player-id"));
  const login = headers.get("x-player-login");
  if (!Number.isSafeInteger(id) || id <= 0 || !login) return null;
  return { id, login, display: headers.get("x-player-display") || login, contributor: headers.get("x-player-contributor") === "1" };
};

// Who may drive which Ooga. `cast` is the character rows the build writes from src/characters/
// (`npm run characters:json`): every Ooga is a contributor's, keyed by handle, owned by its handle and
// its GitHub login alone: a handle that differs from the login is a name, and some other GitHub account
// may hold it. A contributor drives only their own; anyone else drives an Ooga only while its owner is
// not in the room and nobody else holds it. Whether an Ooga is working comes from activity the room does
// not see, so that rule stays with the page.
export const castIndex = (cast) => {
  const owners = new Map(), handleOf = new Map();
  for (const row of cast) {
    const handle = row.handle.toLowerCase();
    const login = String(row.github_login || row.handle).toLowerCase();
    owners.set(handle, login);
    handleOf.set(login, handle);
  }
  return { owners, handleOf };
};

/** null when `login` may drive `body` now; otherwise the refusal reason. `players` iterates { login, body }. */
export const claimRefusal = (index, login, body, players, contributor = false) => {
  if (body === null) return null;
  const want = body.toLowerCase();
  const me = login.toLowerCase();
  const own = index.handleOf.get(me);
  if (own) return own === want ? null : "not-yours";
  const owner = index.owners.get(want);
  // Only the Worker can vouch for this fallback. Never shadow a curated alias,
  // never grant another visitor an unbundled body, and never mutate the shared cast.
  if (contributor && !index.owners.has(me)) return want === me ? null : "not-yours";
  if (!owner) return "unknown";
  for (const p of players) {
    if (p.login.toLowerCase() === me) continue;
    if (p.login.toLowerCase() === owner) return "owner-here";
    if (p.body && p.body.toLowerCase() === want) return "taken";
  }
  return null;
};

// Voice: who hears whom. Players driving an Ooga hear each other at one volume while they are in the same
// zone group (the island, a bridged land, one cave or portal; see Zones above). A listener with a receiving
// session hears every other player in its group with a published microphone; nobody hears anyone `none`.
// The room decides and re-checks it on every pull.
export const VOICE_TRACK = "mic";

/** The voice group of a zone name: the part before its `.place`. */
export const zoneGroup = (zone) => {
  const dot = typeof zone === "string" ? zone.indexOf(".") : -1;
  return dot < 0 ? zone : zone.slice(0, dot);
};

/** Map of player id → sorted ids that player should hear. */
export const voicePeers = (players) => {
  const out = new Map();
  for (const p of players) {
    const ids = [];
    const group = zoneGroup(p.zone);
    if (p.body && p.voice && p.voice.sub && group !== NOWHERE) {
      for (const q of players) if (q !== p && q.body && zoneGroup(q.zone) === group && (group !== "ember-den" || (p.pokerVoice ?? null) === (q.pokerVoice ?? null)) && q.voice && q.voice.track) ids.push(q.id);
      ids.sort((a, b) => a - b);
    }
    out.set(p.id, ids);
  }
  return out;
};

// NPC host: one page runs the Ooga crew for everyone and streams its poses; the others follow. The host is
// the page longest in the room among those showing the island (`inHub`: in the hub scene and visible), so
// it changes only when that page leaves, hides or closes. 0 when no page qualifies.
export const electHost = (players) => {
  let best = null;
  for (const p of players) if (p.inHub && (!best || p.joinedAt < best.joinedAt || (p.joinedAt === best.joinedAt && p.id < best.id))) best = p;
  return best ? best.id : 0;
};

/** How many pages follow the NPC host: every other page showing the island. 0 with no host. */
export const npcFollowers = (players, hostId) => {
  if (!hostId) return 0;
  let count = 0;
  for (const p of players) if (p.inHub && p.id !== hostId) count++;
  return count;
};
