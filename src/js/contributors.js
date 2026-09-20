(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const MINUTE = 60 * 1e3, HOUR = 60 * MINUTE, WORK_WINDOW = 4 * HOUR, CHILL_WINDOW = 48 * HOUR;
  const ENTROPY = "oogaboogax/entropylab", MAX_REPOS = 64;
  const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  // Historical EntropyLab activity; a backend can refresh it with applyActivity.
  const roster = [
    ["portlandhodl", 1788159681],
    ["w-s-bitcoin", 1788178261],
    ["dplusplus1024", 1788153655],
    ["bc1gui", 1788190400],
    ["RandyMcMillan", 1788210011],
    ["MrHodlX", 1788200000],
    ["timechainb", 1788171200],
    ["YellowBrokeIt", 1788225311],
    ["DrNeski", 1788219000],
    ["genXbtc", 1788215311]
  ].map(([name, unixSeconds]) => ({ name, lastCommitAt: unixSeconds * 1e3, activity: new Map([[ENTROPY, unixSeconds * 1e3]]) }));
  // Filter construction, not visibility: solo worlds do no work for absent Oogas.
  // Keep the canonical roster intact for activity, likenesses and stable indices.
  const params = new URLSearchParams(location.search);
  const solo = params.has("debug") && (params.get("solo") === "1" || params.get("solo") === "");
  const requestedStatus = params.has("debug") ? params.get("status") : null;
  const debugState = requestedStatus === "clankin" ? "working" : requestedStatus === "chillin" ? "chilling" : requestedStatus === "sleepin" ? "sleeping" : null;
  const character = params.get("character")?.trim().toLowerCase();
  const activeRoster = solo ? roster.filter((entry) => entry.name.toLowerCase() === character) : roster;
  const byName = new Map(roster.map((contributor) => [contributor.name.toLowerCase(), contributor]));
  byName.set("ottoz0r", byName.get("bc1gui"));
  const listeners = new Set(), snapshotRepos = new Set();
  const repositoryOf = (repo) => {
    if (typeof repo !== "string") return null;
    const key = repo.toLowerCase();
    if (key === "w-s-bitcoin/entropylab") return ENTROPY;
    return /^oogaboogax\/[a-z0-9_.-]{1,100}$/.test(key) ? key : null;
  };
  // Callers use the canonical lowercase repository key, keeping frame queries allocation-free.
  const hasRecentActivity = (contributor, repo, at = Date.now()) => {
    if (debugState === "working" && repo === ENTROPY) return true;
    const seen = contributor.activity.get(repo);
    return seen > 0 && seen <= at && at - seen < WORK_WINDOW;
  };
  const stateFor = (contributor, at = Date.now()) => {
    if (debugState) return debugState;
    const age = at - contributor.lastCommitAt;
    if (!Number.isFinite(age) || contributor.lastCommitAt <= 0 || age < 0) return "sleeping";
    if (age < WORK_WINDOW) return "working";
    return age < CHILL_WINDOW ? "chilling" : "sleeping";
  };
  const ageLabel = (contributor, at = Date.now()) => {
    if (!Number.isFinite(contributor.lastCommitAt) || contributor.lastCommitAt <= 0) return "no activity";
    const minutes = Math.max(0, Math.floor((at - contributor.lastCommitAt) / MINUTE));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };
  // Rows: { name: GitHub handle, lastCommitAt: Unix milliseconds, repo? }.
  // Keep each repository's newest activity; delayed snapshots cannot rewind it.
  const applyActivity = (rows, at = Date.now()) => {
    if (!Array.isArray(rows) || !Number.isFinite(at)) return 0;
    const changed = new Set();
    for (const row of rows) {
      if (!row || typeof row.name !== "string" || !Number.isFinite(row.lastCommitAt) || row.lastCommitAt <= 0 || row.lastCommitAt > at) continue;
      const contributor = byName.get(row.name.toLowerCase()), repo = repositoryOf(row.repo === undefined ? ENTROPY : row.repo);
      if (!contributor || !repo) continue;
      const previous = contributor.activity.get(repo);
      if (previous !== undefined ? row.lastCommitAt <= previous : contributor.activity.size >= MAX_REPOS) continue;
      contributor.activity.set(repo, row.lastCommitAt);
      contributor.lastCommitAt = Math.max(contributor.lastCommitAt, row.lastCommitAt);
      changed.add(contributor);
    }
    if (changed.size) for (const notify of listeners) notify();
    return changed.size;
  };
  // Oogatron schema 1, one snapshot or an array of project snapshots. generated_at
  // describes the snapshot, never the contributor's most recent activity.
  const applySnapshot = (snapshots, at = Date.now()) => {
    const rows = [];
    for (const snapshot of Array.isArray(snapshots) ? snapshots : [snapshots]) {
      if (!snapshot || !snapshot.meta || snapshot.meta.schema_version !== 1 || !Array.isArray(snapshot.contributors)) continue;
      const repo = repositoryOf(snapshot.meta.repo);
      if (!repo) continue;
      const firstSnapshot = !snapshotRepos.has(repo), accepted = [];
      for (const contributor of snapshot.contributors) {
        if (!contributor || typeof contributor.login !== "string" || typeof contributor.last_seen_at !== "string" || !ISO_TIME.test(contributor.last_seen_at)) continue;
        const lastCommitAt = Date.parse(contributor.last_seen_at);
        const entry = byName.get(contributor.login.toLowerCase());
        if (entry && Number.isFinite(lastCommitAt) && lastCommitAt > 0 && lastCommitAt <= at) accepted.push({ entry, name: contributor.login, lastCommitAt, repo });
      }
      // The first authoritative snapshot replaces the bundled historical fallback,
      // even when the fallback happened to be later. Subsequent snapshots still
      // cannot rewind newer activity received during this page session.
      if (accepted.length) {
        if (firstSnapshot) for (const row of accepted) {
          row.entry.activity.delete(repo);
          let latest = 0;
          for (const stamp of row.entry.activity.values()) latest = Math.max(latest, stamp);
          row.entry.lastCommitAt = latest;
        }
        snapshotRepos.add(repo);
        for (const { name, lastCommitAt } of accepted) rows.push({ name, lastCommitAt, repo });
      }
    }
    return applyActivity(rows, at);
  };
  const subscribe = (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  };
  // Explicit debug fixture only; the director never calls this on a normal page.
  const seedDebugActivity = (at = Date.now()) => {
    for (let i = 0; i < roster.length; i++) {
      const contributor = roster[i];
      const age = i < 3 ? i * 30000 : i < 6 ? 8 * HOUR + i * 60000 : CHILL_WINDOW;
      contributor.lastCommitAt = at - age;
      contributor.activity.clear();
      contributor.activity.set(ENTROPY, contributor.lastCommitAt);
    }
    for (const notify of listeners) notify();
  };
  const { fnv1a, mulberry32 } = BL.math;
  // Opt-in likeness overrides per handle
  const LIKENESS = {
    portlandhodl: { bald: true },
    "w-s-bitcoin": { apple: true, symmetricTusks: true, stoneAxe: true },
    MrHodlX: { gasMask: true },
    dplusplus1024: { build: "slim", hair: "#b9dcaa" },
    bc1gui: { skater: true, skin: "#f2a33c", hair: "#e4561f", fur: "#8f4f17" },
    RandyMcMillan: { bee: true, skin: "#f3b52a", hair: "#151515" },
    timechainb: { anunnaki: true, skin: "#b8703c", hair: "#33200f" },
    YellowBrokeIt: { bald: true, cleanShaven: true, wideEyes: true, yellowFace: true, cigarette: true, energyCan: true, orangeChest: true, skin: "#ffe36a", hair: "#21160e", fur: "#ed9b24" },
    DrNeski: { laserEyes: true, headband: true, stethoscope: true, newspaper: true, hair: "#f2ece0" },
    genXbtc: { topHat: true, skeleton: true, pumpkin: true, bald: true, cleanShaven: true, skin: "#cfc8b4", hair: "#151515", fur: "#141414", height: 1.16 }
  };
  // Opt-in voices per handle: a signature line when poked, and idle lines mixed with the tribe's
  const VOICES = {
    DrNeski: {
      poke: "You've got 10 seconds!",
      idle: ["You are fired!", "Where is Kortik??", "Go rebalance your Node!", "Get laid on the 1st date", "What's your question for DrNeski?", "I sold my neighbor ex's cat for sats"]
    },
    genXbtc: {
      poke: "POWER OVERWHELMING",
      idle: ["Shut up you larp", "Rules Without Rulers"]
    }
  };
  const voiceFor = (name) => VOICES[name] || null;
  const SKINS = ["#c98a5b", "#a9744c", "#8a5a3a", "#d9a06b", "#b58057"];
  const HAIRS = ["#2b1b10", "#4a2c14", "#151312", "#5c4425", "#7a2e12"];
  const HAIRS_SLIM = ["#ece5d3", "#e0dac6", "#f2eee2", "#b9dcaa", "#a3d19a"];
  const FURS = ["#d98a2e", "#cc7f28", "#c98936", "#e09a40", "#c27a24", "#d4913a"];
  const traitsFor = (name) => {
    const likeness = LIKENESS[name] || {};
    const slim = likeness.build === "slim";
    const rand = mulberry32(fnv1a(name));
    const skin = SKINS[Math.floor(rand() * SKINS.length)];
    const hashedHair = (slim ? HAIRS_SLIM : HAIRS)[Math.floor(rand() * HAIRS.length)];
    const traits = {
      name,
      slim,
      bald: !!likeness.bald,
      cleanShaven: !!likeness.cleanShaven,
      apple: !!likeness.apple,
      gasMask: !!likeness.gasMask,
      symmetricTusks: !!likeness.symmetricTusks,
      stoneAxe: !!likeness.stoneAxe,
      skater: !!likeness.skater,
      anunnaki: !!likeness.anunnaki,
      bee: !!likeness.bee,
      wideEyes: !!likeness.wideEyes,
      cigarette: !!likeness.cigarette,
      energyCan: !!likeness.energyCan,
      yellowFace: !!likeness.yellowFace,
      orangeChest: !!likeness.orangeChest,
      laserEyes: !!likeness.laserEyes,
      headband: !!likeness.headband,
      stethoscope: !!likeness.stethoscope,
      newspaper: !!likeness.newspaper,
      topHat: !!likeness.topHat,
      skeleton: !!likeness.skeleton,
      pumpkin: !!likeness.pumpkin,
      skin: likeness.skin || skin,
      hair: likeness.hair || hashedHair,
      fur: likeness.fur || FURS[Math.floor(rand() * FURS.length)],
      height: 0.92 + rand() * 0.24,
      belly: (0.9 + rand() * 0.35) * (slim ? 0.8 : 1),
      rand: mulberry32(fnv1a(name + "/body"))
    };
    // An explicit stature replaces the hashed one after every draw, so the
    // other hashed traits keep their sequence.
    if (likeness.height) traits.height = likeness.height;
    return traits;
  };
  BL.contributors = { roster, activeRoster, solo, debugState, stateFor, ageLabel, traitsFor, voiceFor, hasRecentActivity, applyActivity, applySnapshot, subscribe, seedDebugActivity };
})();
