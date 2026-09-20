(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, contributors, donations, qr, terrain, hubModels, headquartersModels, dropModels, rocketModels, rocketParts, caves, daylight, game: gameMod, hud: hudMod, interact: interactMod, pilot: pilotMod, fx: fxMod, crew: crewMod, pile: pileMod, crates: cratesMod, critters: crittersMod } = BL;
  const { clamp, lerp, ease, fnv1a, mulberry32 } = math;
  const { createNode, addChild, removeChild, createCamera, addTween, stepTweens, tweenCount, traverseVisible } = BL.scene;
  const { JET_SPEED, JET_RISE, JET_FUEL_SECONDS, JET_MOVE_SECONDS } = crewMod;
  const { DROP_HEIGHT } = pileMod;
  const { CONFETTI } = fxMod;
  const params = new URLSearchParams(location.search);
  const METER_CAPACITY = 60;
  const SEED = 1;
  const DEG = Math.PI / 180;
  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  const yawParam = parseFloat(params.get("yaw"));
  // Debug clock: a pinned hour and a day length in seconds
  const DEBUG = params.has("debug");
  const timeParam = DEBUG ? params.get("time") : null;
  const hourParam = DEBUG ? parseFloat(params.get("hour")) : NaN;
  const daylenParam = DEBUG ? parseFloat(params.get("daylen")) : NaN;
  const dayParam = DEBUG ? parseFloat(params.get("day")) : NaN;
  const latitudeParam = DEBUG ? parseFloat(params.get("latitude")) : NaN;
  const requestedView = DEBUG ? params.get("view") : null;
  const preloadedView = requestedView === "hq" ? "underground" : requestedView === "bsmt" ? "basement" : requestedView === "pile" || requestedView === "lab" || requestedView === "mirror" ? requestedView : null;
  const preloadedPose = DEBUG ? readPositionPose(params.get("pose")) : null;
  const preloadedMode = DEBUG ? params.get("mode") || preloadedPose?.mode : null;
  const preloadedFirstPerson = DEBUG && (params.get("firstperson") === "1" || preloadedMode === "first-person" || preloadedMode === "eye-level");
  const preloadedCharacter = DEBUG ? (params.get("character") || preloadedPose?.character)?.trim().toLowerCase() : null;
  const preloadedWeapon = DEBUG ? Number(params.get("weapon")) : 0;
  const preloadedAmmo = DEBUG ? params.get("ammo") : null;
  const preloadedEquipment = preloadedWeapon === 1 || preloadedWeapon === 2 || preloadedAmmo === "unlimited"
    || preloadedAmmo !== null && preloadedAmmo.trim() !== "" && Number.isFinite(Number(preloadedAmmo));
  const preloadedJetpack = DEBUG && (params.get("jetpack") === "1" || !!preloadedPose?.character && preloadedPose.jetpack);
  const preloadedJetpackWear = preloadedJetpack && preloadedView !== "underground" && preloadedView !== "basement";
  const POSITION_DEBUG = DEBUG && params.get("pos") !== "0";
  const islandLatitude = Number.isFinite(latitudeParam) ? Math.max(-66, Math.min(66, latitudeParam)) : daylight.ISLAND_LATITUDE_DEG;
  // Island measures, owned by terrain.js
  const MEADOW = 22, RADIUS = 30;
  const PITCH_MIN = 0.2, PITCH_MAX = 1.25, DIST_MIN = 3.5, DIST_MAX = 64;
  // Air the camera keeps over the rock
  const CLEARANCE = 1.5;
  // Landing view, close over the pile
  const PILE_VIEW = { yaw: Number.isFinite(yawParam) ? yawParam : 0, pitch: 0.62, dist: 24, target: { x: 0, y: 0.6, z: 0 } };
  // Gate view, its target y set at enter
  const GATE_VIEW = { yaw: 0, pitch: 0.32, dist: 18, target: { x: 0, y: 0, z: -(RADIUS - 2) } };
  // A mouth seen from in front, along its axis
  const mouthView = (m) => ({ yaw: m.ry, pitch: 0.3, dist: 18, target: { x: m.x, y: 1.5, z: m.z } });
  const NAVIGATION = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, dist: 6 };
  const NAVIGATION_OFFSETS = [0, -0.75, 0.75, -1.5, 1.5];
  // Dolly onto a tapped mouth before the scene changes
  const ENTER_DIST = 10, ENTER_DUR = 0.45;
  // Free flight speeds and bounds
  const FLY = { speed: 6, perDist: 0.5, climb: 6, yMin: -8, yMax: JET_RISE * JET_FUEL_SECONDS + 16 }, FLY_BOUND = RADIUS + JET_SPEED * JET_MOVE_SECONDS + 8;
  // An unseen support keeps hop integration finite until the visible abyss fall ends.
  const ABYSS_FLOOR = -120, ABYSS_RESPAWN_Y = -60;
  // Third person follow height and distance
  const FOLLOW = { y: 0.9, min: 4, max: 10, pitch: [0.25, 0.8] };
  // A close free view rests at an average Ooga eye; first person sits at the
  // face surface so looking down clears the hidden head and keeps the body and
  // feet in view. Portal ownership stays with the Ooga, not this look offset.
  const CLOSE_VIEW = { eyeHeight: 1.1, eyeRatio: 0.95, eyeForward: 0.16, pitch: [-1.35, 1.35], trailingDist: 6, orbitDist: 6 };
  // Tallest step a caveman may climb
  const STEP_MAX = pilotMod.WALK.step;
  // The island's one jetpack waits above a distant moving cloud.
  const JETPACK_HOVER = 0.5, JETPACK_REACH = 1.35, JETPACK_FAR = 44;
  const MAGAZINE_REACH = 0.7, MAGAZINE_SCALE = 2.4;
  const JETPACK_FALL_GRAVITY = 9.8, JETPACK_RESPAWN_Y = -60;
  // Launch reach includes room around the kart plinth and the plane's wings.
  const TUNNEL_REACH = 2.2, RALLY_REACH = 3.2, LAUNCH_REACH = 4, RALLY_KART_Z = -3.6;
  const MATRIX_TYPES = 8;
  const MATRIX_RAIN_GAP = 0.19;
  const MATRIX_SURFACE_PITCH = 0.12, MATRIX_SURFACE_GAP = 0.13, MATRIX_GLYPH_HZ = 20;
  const MATRIX_PIXEL_PITCH = 0.021, MATRIX_PIXEL_SIZE = 0.016;
  const MATRIX_STREAM_SPEED_MIN = 0.56, MATRIX_STREAM_SPEED_RANGE = 0.64;
  const MATRIX_TRAIN_MIN = 7, MATRIX_TRAIN_RANGE = 6, MATRIX_TRAIN_GAP_MIN = 2, MATRIX_TRAIN_GAP_RANGE = 5;
  const MATRIX_WORLD_SPEED = 72, MATRIX_WORLD_MAX = RADIUS + 8, MATRIX_FRONT_WIDTH = 1.5, MATRIX_GLYPH_REACH = 0.16;
  const MATRIX_MIRROR_HEIGHT = 3.25;
  const MATRIX_GATE_HIDDEN_Y = 3.2, MATRIX_GATE_SPEED = 3.2, MATRIX_BUTTON_REACH = 3.4, MATRIX_BUTTON_USE_REACH = 2.2;
  const MIRROR_GATE_Z = 0.28;
  // Breaking the mirror enables a local release; its gate starts locked down.
  const MIRROR_GATE_CLOSED = true;
  const MATRIX_WORLD = { active: 0, direction: 0, radius: 0, time: 0, density: 1, speed: MATRIX_WORLD_SPEED, retreatSpeed: MATRIX_WORLD_SPEED, maxRadius: MATRIX_WORLD_MAX, permanentCave: 0, permanentPlane: new Float32Array(4), permanentAperture: new Float32Array(4), livingGlobal: 0, origin: new Float32Array([0, 0, 0]), caves: new Float32Array(8 * 4), caveBounds: new Float32Array(8 * 4), caveNear: 0 };
  const MATRIX_DENSITY = { high: 8, medium: 5, low: 3, canvas2d: 1 };
  const PORTAL_Z = 0.5, PORTAL_MIN_X = -2.48, PORTAL_MAX_X = 2.48, PORTAL_MIN_Y = 0, PORTAL_MAX_Y = 2.98;
  // Sky, light and lamps, resampled from the clock every frame
  const RENDER_OPTS = {
    clear: new Float32Array(3), horizon: new Float32Array(3), zenith: new Float32Array(3), sky: new Float32Array(3), ground: new Float32Array(3), sun: new Float32Array(3), direct: new Float32Array(3),
    light: { x: 0.55, y: 0.78, z: -0.25 }, sunDirection: { x: 0, y: 1, z: 0 }, moon: { x: 0, y: 1, z: 0 }, celestialPole: { x: 0, y: Math.sin(20 * DEG), z: -Math.cos(20 * DEG) }, starMatrix: new Float32Array(9),
    stars: 0, torch: 0, day: 1, twilight: 0, lampFactor: 0, directStrength: 1, directionalLightStrength: 1, sunStrength: 1, moonStrength: 0, ambientFloor: 0.18, diffuseFloor: 0, shadowStrength: 1, shadowFloor: 0, shadowBias: 0.002, outdoorDarkestSurfaceEstimate: 0.34, activeLightSource: "sun", latitude: 20, dayOfYear: 172, continuousDay: 171.5, solarDeclination: 0, siderealAngle: 0, sunAltitude: 90, sunAzimuth: 180, moonAltitude: -90, moonAzimuth: 0, sunriseHour: 6, sunsetHour: 18,
    time: 0, bloomStrength: 0.5, lights: new Float32Array(80), lightCount: 0, shadowCenter: { x: 0, y: 0, z: 0 }, shadowExtent: 34, matrix: MATRIX_WORLD
  };
  RENDER_OPTS.starMatrix[0] = RENDER_OPTS.starMatrix[4] = RENDER_OPTS.starMatrix[8] = 1;
  const DAYLIGHT_DEBUG = {
    sunDirection: RENDER_OPTS.sunDirection, moonDirection: RENDER_OPTS.moon, celestialPole: RENDER_OPTS.celestialPole,
    hour: 12, continuousDay: 171.5, phase: "noon", latitude: 20, dayOfYear: 172, solarDeclination: 0, siderealAngle: 0, sunAltitude: 90, sunAzimuth: 180, moonAltitude: -90, moonAzimuth: 0,
    daylightFactor: 1, twilightFactor: 0, starFactor: 0, lampFactor: 0, directStrength: 1, directionalLightStrength: 1, moonStrength: 0, ambientFloor: 0.18, diffuseFloor: 0, shadowStrength: 1, shadowFloor: 0, shadowBias: 0.002, outdoorDarkestSurfaceEstimate: 0.34, activeLightSource: "sun", sunriseHour: 6, sunsetHour: 18
  };
  // Mirrored out of RENDER_OPTS for __ooga only, so it stays off the shipped frame path
  const syncDaylightDebug = (hour) => {
    DAYLIGHT_DEBUG.hour = hour;
    DAYLIGHT_DEBUG.continuousDay = RENDER_OPTS.continuousDay;
    DAYLIGHT_DEBUG.phase = phase;
    DAYLIGHT_DEBUG.latitude = RENDER_OPTS.latitude;
    DAYLIGHT_DEBUG.dayOfYear = RENDER_OPTS.dayOfYear;
    DAYLIGHT_DEBUG.solarDeclination = RENDER_OPTS.solarDeclination;
    DAYLIGHT_DEBUG.siderealAngle = RENDER_OPTS.siderealAngle;
    DAYLIGHT_DEBUG.sunAltitude = RENDER_OPTS.sunAltitude;
    DAYLIGHT_DEBUG.sunAzimuth = RENDER_OPTS.sunAzimuth;
    DAYLIGHT_DEBUG.moonAltitude = RENDER_OPTS.moonAltitude;
    DAYLIGHT_DEBUG.moonAzimuth = RENDER_OPTS.moonAzimuth;
    DAYLIGHT_DEBUG.daylightFactor = RENDER_OPTS.day;
    DAYLIGHT_DEBUG.twilightFactor = RENDER_OPTS.twilight;
    DAYLIGHT_DEBUG.starFactor = RENDER_OPTS.stars;
    DAYLIGHT_DEBUG.lampFactor = RENDER_OPTS.lampFactor;
    DAYLIGHT_DEBUG.directStrength = RENDER_OPTS.directStrength;
    DAYLIGHT_DEBUG.directionalLightStrength = RENDER_OPTS.directionalLightStrength;
    DAYLIGHT_DEBUG.moonStrength = RENDER_OPTS.moonStrength;
    DAYLIGHT_DEBUG.ambientFloor = RENDER_OPTS.ambientFloor;
    DAYLIGHT_DEBUG.diffuseFloor = RENDER_OPTS.diffuseFloor;
    DAYLIGHT_DEBUG.shadowStrength = RENDER_OPTS.shadowStrength;
    DAYLIGHT_DEBUG.shadowFloor = RENDER_OPTS.shadowFloor;
    DAYLIGHT_DEBUG.shadowBias = RENDER_OPTS.shadowBias;
    DAYLIGHT_DEBUG.outdoorDarkestSurfaceEstimate = RENDER_OPTS.outdoorDarkestSurfaceEstimate;
    DAYLIGHT_DEBUG.activeLightSource = RENDER_OPTS.activeLightSource;
    DAYLIGHT_DEBUG.sunriseHour = RENDER_OPTS.sunriseHour;
    DAYLIGHT_DEBUG.sunsetHour = RENDER_OPTS.sunsetHour;
  };
  const PHASE_TOASTS = { dawn: "Dawn breaks over the island", morning: "Morning on the island", noon: "High noon", dusk: "Dusk settles over the island", night: "Night. The torches are lit.", midnight: "Midnight. The island sleeps." };
  // Lamp colours and reach; a lamp's flame reads through node.glow
  const LAMP = { torch: { r: 1.0, g: 0.62, b: 0.25, radius: 6, glow: 0.85, hide: false }, fire: { r: 1.0, g: 0.55, b: 0.2, radius: 9, glow: 0.9, hide: true }, lantern: { r: 1.0, g: 0.8, b: 0.45, radius: 4, glow: 0.9, hide: false } };
  const LIGHT_CAPACITY = 10;
  const LIGHTING_DEBUG = {
    registeredLampCount: 0, activeFullLightCount: 0, approximatedLightCount: 0,
    configuredLightCapacity: LIGHT_CAPACITY, selectedCount: 0, approximatedCount: 0,
    tier: "high", selectedIds: new Array(LIGHT_CAPACITY).fill(null), approximatedIds: new Array(LIGHT_CAPACITY).fill(null)
  };
  // Lamps light one after another through the dusk ramp
  const LAMP_STAGGER = 0.12, LAMP_RAMP = 0.4, LAMP_OFF = 0.12;
  const CAVE_TORCH_GAP = 0.12;
  const FIRE_DEGREES = [130, 125, 135, 120, 140, 115, 145], FIRE_RADIUS = 11.5, FIRE_SEATS = 6, FIRE_SEAT_RADIUS = 1.8;
  const FIRE_CONTACT_RADIUS = 0.65, FIRE_AVOID_RADIUS = 1.25, FIRE_BOTTOM = 0.12, FIRE_TOP = 0.85;
  const NIGHT = 0.5, FIRE_SEAT_CHANCE = 0.5;
  // Clock angle to a meadow point
  const polar = (deg, r) => ({ x: Math.sin(deg * DEG) * r, z: -Math.cos(deg * DEG) * r });
  // Clock angles where the crew builds and sleeps
  const BUILD_DEGREES = [12, 40, 66, 80, 102, 165, 195, 212, 282, 297, 312, 340];
  const BUILD_RADIUS = 13;
  const NUDGES = [0, -2, 2, -4, 4, -6, 6, -8, 8];
  const VINES = ["c5"];
  const PILE_SCALE = 0.45;
  const SCENERY_CLEARANCE = 0.25;
  const MEADOW_INNER = 5, MEADOW_OUTER = MEADOW - 1.5, CLIFF_INNER = MEADOW + 1.5, CLIFF_OUTER = RADIUS - 1;
  const DOCK_DEG = 105, LADDER_Z = -3.6, LADDER_LEAN = 0.65;
  const CLOUD_COUNT = 30, CLOUD_WRAP = 60, CLOUD_NEAR = 36;
  // Where a strolling caveman may stop
  const WANDER_COUNT = 36, WANDER_INNER = 5.5;
  const ALTAR_HEIGHT = 0.34, ALTAR_BLOCK_WIDTH = 0.2, ALTAR_BLOCK_ARC = 0.3, ALTAR_RING_GAP = 0.02, ALTAR_MAX_BLOCKS = 512;
  // Ripen time and odds for a dropped banana
  const RIPEN = 25, TREE_CHANCE = 0.5, BUSH_CHANCE = 0.25;
  const PROP_TIPS = { tree: "Tree · shake it", bush: "Bush · rustle it", rock: "Rock · hit to break", crate: "Box · hit to break", barrel: "Barrel · hit to break", flower: "Flowers", torch: "Torch · warm", firepit: "Fire pit", bedroll: "Somebody's bed", ladder: "Ladder · wobbly", dock: "Dock · creaky", jetpack: "Jetpack · jump to collect", magazine: "Spare magazine · walk into it to collect", plane: "Ooga Drop · tap to fly", sign: "Ooga Drop · the plane flies from here", launchpad: "Ooga Orbit · tap to build a rocket", rocket: "Ooga Orbit · tap to fly", tower: "Launch tower · Ooga NASA", orbitsign: "Ooga Orbit · the pad past the bridge", bridge: "Rope bridge · to the launch pad", windsock: "Windsock · a fair wind", jumbotron: "Jumbotron · EntropyLab on the big screen · tap for the next board", gate: null };
  const MATRIX_LIVING_PROPS = new Set(["tree"]);
  const SOLID_PROPS = new Set(["tree", "rock", "crate", "barrel", "firepit", "dock", "jumbotron", "launchpad", "rocket", "tower", "bridge", "orbitsign"]);
  const BUSH_WORDS = ["Something rustles.", "A beetle. Ooga leaves it.", "Just a bush."];
  const LEAF = models.particleGeometry("#4a8530", 0.12, 0);
  const PETALS = ["#e04a3a", "#f2c94c", "#f3efe4"].map((c) => models.particleGeometry(c, 0.09, 0));
  const CHIP = models.particleGeometry("#6b625a", 0.1, 0);
  const SPARK = models.particleGeometry("#ffb13b", 0.08, 1);
  const DUST = models.particleGeometry("#a3874f", 0.1, 0);
  const FIRE_VIEW = { coverage: 0, ember: 0, soot: 0 };
  const FIRE_SPECKS = new Float32Array(96 * 4);
  {
    const random = mulberry32(fnv1a("first-person-fire"));
    for (let i = 0; i < FIRE_SPECKS.length; i += 4) {
      FIRE_SPECKS[i] = random();
      FIRE_SPECKS[i + 1] = random();
      FIRE_SPECKS[i + 2] = 0.0025 + random() * 0.009;
      FIRE_SPECKS[i + 3] = 0.35 + random() * 0.65;
    }
  }
  // Where eaters arrive from away
  const WALK_IN = { x: 0, z: -(MEADOW + 0.5) };
  // Where the thank-you ticker hangs
  const TICKER_AT = { x: 0, y: 0, z: -(RADIUS - 2) };
  const setVec = (v, x, y, z) => {
    v.x = x;
    v.y = y;
    v.z = z;
    return v;
  };
  const mark = (name) => {
    performance.clearMarks(`ooga:${name}`);
    performance.mark(`ooga:${name}`);
  };

  // One visit's state, made in enter and dropped in leave
  let renderer, game, world, go, lootEnabled, testBananas, root, camera, overlayCanvas, island, pathNode, altar, hud, hooks, input, pilot, fx, cameraCover, bananaCover, solids, rockGuides, objectGuides, sightGuides, bananaGuides, pileGuides, platformGuides, mirrorGuides, pile, crew, crates, critters, clock, presets, entering, jetpack, jetpackState, jetpackCarrier, jetpackWearer, lastJetpackCloud, mirrorCave, matrixCave, matrixControl, gateRain, fire, headquarters, dockStairs, jumbotron, positionDebug;
  let magazine, magazineState, breakables;
  const JETPACK_HUD_STATE = { owned: false, equipped: false, fuel: 1, blocked: false };
  let enteringTween = null;
  let stateTimer = 0, hintTimer = 0, meterTimer = 0, now = 0, hour = 12, unsubscribeActivity = null;
  let positionDebugNext = 0, positionDebugJSON = "";
  function createPositionPose() {
    return { version: 1, character: "", mode: "detached", battle: false, position: [0, 0, 0], target: [0, 0, -1], direction: [0, 0, -1], up: [0, 1, 0], fov: 48 * Math.PI / 180,
      actor: [0, 0, 0], body: [0, 0, 0], head: [0, 0, 0], bodyQuaternion: [0, 0, 0, 1], headQuaternion: [0, 0, 0, 1], bodyRolled: false, headRolled: false,
      orbit: [0, 0.62, 6, 0, 0, 0], headOffset: [0, 0, 0], headOrbit: false, shoulderSide: 0.6, closeMix: 0, ads: 0,
      selectedSlot: 1, ammo: 30, unlimited: false, magazines: [0, 0], magazineCount: 0, aimYaw: 0, aimPitch: 0, jetpack: false, fuel: 1, hop: 0, hopV: 0, lift: 0 };
  }
  function readPositionPose(value) {
    if (!value || value.length > 8192) return null;
    let data;
    try { data = JSON.parse(value); } catch { return null; }
    if (!data || data.version !== 1 || !["carry", "shoulder", "first-person", "orbit", "detached", "eye-level"].includes(data.mode)) return null;
    if (data.battle === undefined) data.battle = data.mode === "shoulder" || data.mode === "first-person";
    const pose = createPositionPose();
    for (const key of Object.keys(pose)) {
      const supplied = data[key], target = pose[key];
      if (Array.isArray(target)) {
        if (!Array.isArray(supplied) || supplied.length !== target.length || !supplied.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100000)) return null;
        for (let i = 0; i < target.length; i++) target[i] = supplied[i];
      } else if (typeof target === "number") {
        if (!Number.isFinite(supplied) || Math.abs(supplied) > 100000) return null;
        pose[key] = supplied;
      } else if (typeof supplied !== typeof target) return null;
      else pose[key] = supplied;
    }
    if (pose.character.length > 80 || pose.fov <= 0.05 || pose.fov >= Math.PI || pose.orbit[2] <= 0 || pose.orbit[2] > 200) return null;
    if (Math.hypot(...pose.up) < 0.001 || Math.hypot(...pose.bodyQuaternion) < 0.001 || Math.hypot(...pose.headQuaternion) < 0.001) return null;
    const dx = pose.target[0] - pose.position[0], dy = pose.target[1] - pose.position[1], dz = pose.target[2] - pose.position[2];
    if (Math.hypot(dx, dy, dz) < 0.001 || Math.hypot(dy * pose.up[2] - dz * pose.up[1], dz * pose.up[0] - dx * pose.up[2], dx * pose.up[1] - dy * pose.up[0]) < 1e-6) return null;
    for (const rotation of [pose.bodyQuaternion, pose.headQuaternion]) { const length = Math.hypot(...rotation); for (let i = 0; i < 4; i++) rotation[i] /= length; }
    pose.closeMix = clamp(pose.closeMix, 0, 1); pose.ads = clamp(pose.ads, 0, 1); pose.fuel = clamp(pose.fuel, 0, 1);
    pose.ammo = clamp(Math.floor(pose.ammo), 0, 30); pose.magazineCount = clamp(Math.floor(pose.magazineCount), 0, 2);
    return pose;
  }
  const POSITION_POSE = createPositionPose();
  const positionText = value => value.map(n => n.toFixed(5)).join(",");
  let phase = null;
  const updatePositionDebug = (force = false) => {
    if (!positionDebug || !camera || !pilot) return;
    pilot.capturePose(POSITION_POSE);
    const p = camera.position, t = camera.target, up = camera.up;
    const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z;
    const inverseLength = 1 / Math.max(1e-12, Math.hypot(dx, dy, dz));
    POSITION_POSE.position[0] = p.x; POSITION_POSE.position[1] = p.y; POSITION_POSE.position[2] = p.z;
    POSITION_POSE.target[0] = t.x; POSITION_POSE.target[1] = t.y; POSITION_POSE.target[2] = t.z;
    POSITION_POSE.direction[0] = dx * inverseLength; POSITION_POSE.direction[1] = dy * inverseLength; POSITION_POSE.direction[2] = dz * inverseLength;
    POSITION_POSE.up[0] = up ? up.x : 0; POSITION_POSE.up[1] = up ? up.y : 1; POSITION_POSE.up[2] = up ? up.z : 0;
    POSITION_POSE.fov = camera.fov;
    const json = JSON.stringify(POSITION_POSE);
    if (!force && json === positionDebugJSON) return;
    positionDebugJSON = json;
    positionDebug.dataset.pose = json;
    positionDebug.dataset.copied = "false";
    const pose = POSITION_POSE, first = pose.mode === "first-person";
    positionDebug.textContent = `${pose.character || "free camera"} · mode=${pose.mode}${pose.character ? ` · ${pose.battle ? "battle" : "carry"} · weapon=${pose.selectedSlot} ammo=${pose.unlimited ? "unlimited" : pose.ammo}` : ""}`
      + (pose.character ? `\npos=${positionText(pose.actor)}\nbody=${positionText(pose.body)}  head=${positionText(pose.head)} (rad)` : "")
      + (first ? "" : `\ncamera=${positionText(pose.position)}`)
      + `\nlook=${positionText(pose.target)}  dir=${positionText(pose.direction)}`
      + `\n${pilot.poseHeld ? "Restored pose · move/look to resume · " : ""}click to copy exact replay URL`;
  };
  const copyPositionDebug = () => {
    updatePositionDebug(true);
    const url = new URL(location.href);
    for (const key of ["pos", "body", "head", "camera", "look", "mode", "firstperson", "weapon", "ammo", "view", "jetpack", "mag"]) url.searchParams.delete(key);
    url.searchParams.set("debug", "1");
    if (POSITION_POSE.character) url.searchParams.set("character", POSITION_POSE.character);
    else url.searchParams.delete("character");
    url.searchParams.set("pose", positionDebugJSON);
    const value = url.href;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).catch(() => {});
    else {
      const field = document.createElement("textarea");
      field.value = value;
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    positionDebug.dataset.copied = "true";
    positionDebug.blur();
  };
  const restorePositionDebug = () => {
    if (!DEBUG) return;
    const vector = key => {
      const value = params.get(key);
      if (!value || value.length > 100) return null;
      const parts = value.split(",");
      if (parts.length !== 3 || parts.some(part => !part.trim())) return null;
      const numbers = parts.map(Number);
      return numbers.every(n => Number.isFinite(n) && Math.abs(n) <= 10000) ? numbers : null;
    };
    const position = vector("pos"), body = vector("body"), head = vector("head");
    let eye = vector("camera"), look = vector("look");
    const mode = ["carry", "shoulder", "first-person", "orbit", "detached", "eye-level"].includes(preloadedMode) ? preloadedMode : null;
    if (!preloadedPose && !position && !body && !head && !eye && !look && !mode) return;
    const pose = preloadedPose || pilot.capturePose(createPositionPose()), cave = pilot.player;
    if (preloadedPose && cave) {
      crew.configureWeapon(cave, pose.selectedSlot, pose.ammo, pose.unlimited);
      crew.removeMagazines(cave);
      for (let i = 0; i < pose.magazineCount; i++) crew.collectMagazine(cave);
      for (let i = 0; i < pose.magazineCount; i++) cave.weapon.spareAmmo[i] = clamp(Math.floor(pose.magazines[i]), 0, 30);
      if (cave.jet) cave.jetFuel = pose.fuel;
    }
    if (position && cave) {
      for (let i = 0; i < 3; i++) { const delta = position[i] - pose.actor[i]; pose.position[i] += delta; pose.target[i] += delta; pose.orbit[i + 3] += delta; pose.actor[i] = position[i]; }
    }
    if (body) { pose.body = body; pose.bodyRolled = false; }
    if (head) { pose.head = head; pose.headRolled = false; }
    const candidateEye = eye || pose.position, candidateLook = look || pose.target;
    const dx = candidateLook[0] - candidateEye[0], dy = candidateLook[1] - candidateEye[1], dz = candidateLook[2] - candidateEye[2];
    if (Math.hypot(dx, dy, dz) < 0.001) eye = look = null;
    else if (Math.hypot(dy * pose.up[2] - dz * pose.up[1], dz * pose.up[0] - dx * pose.up[2], dx * pose.up[1] - dy * pose.up[0]) < 1e-6) {
      // A manually requested vertical debug view needs a horizontal up axis.
      pose.up[0] = 0; pose.up[1] = Math.abs(dy) < Math.hypot(dx, dy, dz) * 0.9 ? 1 : 0; pose.up[2] = pose.up[1] ? 0 : 1;
    }
    if (eye) pose.position = eye;
    if (look && Math.hypot(look[0] - pose.position[0], look[1] - pose.position[1], look[2] - pose.position[2]) > 0.001) pose.target = look;
    if (mode) pose.mode = mode;
    if (!cave && (pose.mode === "carry" || pose.mode === "shoulder" || pose.mode === "first-person")) pose.mode = pose.mode === "first-person" ? "eye-level" : "orbit";
    if (!preloadedPose) {
      pose.closeMix = pose.mode === "first-person" || pose.mode === "eye-level" ? 1 : 0;
      if (eye || look) {
        const dx = pose.position[0] - pose.target[0], dy = pose.position[1] - pose.target[1], dz = pose.position[2] - pose.target[2];
        pose.orbit[0] = Math.atan2(dx, dz); pose.orbit[1] = Math.atan2(dy, Math.hypot(dx, dz));
        pose.orbit[2] = Math.max(0.1, Math.hypot(dx, dy, dz));
        for (let i = 0; i < 3; i++) pose.orbit[i + 3] = pose.target[i];
      } else if (body || head) {
        pose.orbit[0] = pose.body[1] + pose.head[1] + Math.PI;
        if (pose.mode === "first-person" || pose.mode === "shoulder") pose.orbit[1] = pose.head[0];
      }
    }
    pilot.restorePose(pose, !!preloadedPose || !!eye || !!look);
    updatePositionDebug(true);
  };
  const placed = [];
  const targets = [];
  const claimed = [];
  const clouds = [];
  const lamps = [];
  const entranceLights = [];
  const fireSeats = [];
  const fireHazards = [];
  const workZones = [];
  const closedCaveZones = [];
  const sleepers = [];
  const labels = [];
  const spots = [];
  const openMouths = [];
  const launchers = [];
  const props = [];
  const scenery = [];
  const sceneryClaims = [];
  const matrixInteriors = [];
  const matrixGates = [];
  const sealedCaves = [];
  let sceneryVisible = 0, sceneryRadiusCulled = 0, sceneryPathCulled = 0, sceneryFixedCulled = 0, sceneryReflows = 0;
  const addTarget = (node, owner, opts) => {
    input.add(node, owner, opts);
    targets.push(node);
  };
  // Keep a dragged banana on the meadow
  const clampDrag = (p) => {
    const max = island.meadowRadius - 0.5, r = Math.hypot(p.x, p.z);
    if (r > max) {
      p.x *= max / r;
      p.z *= max / r;
    }
    return p;
  };

  // ---------- surface glyphs behind the mirror ----------
  const buildMatrixPortal = (m) => {
    const cr = Math.cos(m.ry), sr = Math.sin(m.ry);
    return {
      inside: false, previousValid: false, previousX: 0, previousY: 0, previousZ: 0,
      lastCrossingDirection: "none",
      plane: { center: { x: m.x + sr * PORTAL_Z, y: m.floorY + 1.5, z: m.z + cr * PORTAL_Z }, normal: { x: sr, y: 0, z: cr } },
      opening: { minX: PORTAL_MIN_X, maxX: PORTAL_MAX_X, minY: PORTAL_MIN_Y, maxY: PORTAL_MAX_Y, planeZ: PORTAL_Z },
      rejected: { above: 0, below: 0, beside: 0 }
    };
  };
  const matrixModulo = (value, range) => value - Math.floor(value / range) * range;
  const matrixTravelDistance = (x, z, caveIndex = 0) => {
    if (!caveIndex) return Math.hypot(x - MATRIX_WORLD.origin[0], z - MATRIX_WORLD.origin[2]);
    const offset = (caveIndex - 1) * 4, descriptor = MATRIX_WORLD.caves;
    const depth = Math.max(0, descriptor[offset + 2] - x * descriptor[offset] - z * descriptor[offset + 1]);
    return Math.hypot(x + descriptor[offset] * depth - MATRIX_WORLD.origin[0], z + descriptor[offset + 1] * depth - MATRIX_WORLD.origin[2]) + depth;
  };
  const matrixCoverage = (x, z, caveIndex = 0) => {
    if (!MATRIX_WORLD.active) return 0;
    const amount = Math.max(0, Math.min(1, (MATRIX_WORLD.radius - matrixTravelDistance(x, z, caveIndex)) / MATRIX_FRONT_WIDTH));
    return amount * amount * (3 - 2 * amount);
  };
  const matrixEntranceMinimum = (m, minX, maxX) => {
    const sr = Math.sin(m.ry), cr = Math.cos(m.ry);
    const x = m.x + sr * PORTAL_Z - MATRIX_WORLD.origin[0], z = m.z + cr * PORTAL_Z - MATRIX_WORLD.origin[2];
    const cross = Math.max(minX, Math.min(maxX, -(x * cr - z * sr)));
    return Math.hypot(x + cr * cross, z - sr * cross);
  };
  // The original hanging code is separate from the surface-following lanes.
  // Prepare fixed columns inside the real carved volume, never the old flat liner.
  const buildCaveRain = (slot, m, group, caveIndex) => {
    // Falling ceiling glyphs belong to the upper caves. HQ keeps its surface
    // glyphs through both ramp systems and floors without airborne rain batches.
    if (slot.status === "headquarters") return { streams: [], nodes: [], perGlyphCapacity: 0, capacity: 0, bufferBytes: 0,
      spacing: MATRIX_RAIN_GAP, activeGlyphCount: 0, brightTipCount: 0, updates: 0, densityRankLimit: 0 };
    const canvas = renderer.kind === "canvas2d", limit = canvas ? 18 : 48, trainLength = canvas ? 9 : 14;
    const cr = Math.cos(m.ry), sr = Math.sin(m.ry), rand = mulberry32(fnv1a(`${slot.id}:rain`));
    const streams = [], nodes = [], obstacles = [], column = { caveIndex: 0, floor: 0, ceiling: 0 };
    const footprint = 0.055, halfHeight = 0.0605, clearance = 0.02;
    const visit = (node) => {
      if (node.geometry && !node.mirror) {
        const verts = node.geometry.verts, transform = node.world;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < verts.length; i += 3) {
          const x = verts[i], y = verts[i + 1], z = verts[i + 2];
          const wx = transform[0] * x + transform[4] * y + transform[8] * z + transform[12] - m.x;
          const wy = transform[1] * x + transform[5] * y + transform[9] * z + transform[13];
          const wz = transform[2] * x + transform[6] * y + transform[10] * z + transform[14] - m.z;
          const lx = cr * wx - sr * wz, lz = sr * wx + cr * wz;
          minX = Math.min(minX, lx); maxX = Math.max(maxX, lx);
          minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
          minZ = Math.min(minZ, lz); maxZ = Math.max(maxZ, lz);
        }
        if (minZ < -0.6) obstacles.push({ minX, maxX, minY, maxY, minZ, maxZ });
      }
      for (let i = 0; i < node.children.length; i++) visit(node.children[i]);
    };
    visit(group);
    for (let attempt = 0; attempt < limit * 16 && streams.length < limit; attempt++) {
      const side = rand() - 0.5, depth = rand();
      const lx = side * 5, lz = streams.length < limit * 0.65 ? -0.7 - depth * 1.55 : -2.55 - depth * 3.2;
      const x = m.x + cr * lx + sr * lz, z = m.z - sr * lx + cr * lz;
      let minY = -Infinity, maxY = Infinity, valid = true;
      for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
        if (!island.cavityAt(x + ix * footprint, z + iz * footprint, column, caveIndex) || column.caveIndex !== caveIndex || !Number.isFinite(column.ceiling)) valid = false;
        else { minY = Math.max(minY, column.floor); maxY = Math.min(maxY, column.ceiling); }
      }
      minY += halfHeight + clearance; maxY -= halfHeight + clearance;
      if (!valid || maxY - minY < 1) continue;
      const blocked = [];
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        if (lx + footprint < o.minX || lx - footprint > o.maxX || lz + footprint < o.minZ || lz - footprint > o.maxZ) continue;
        blocked.push(o.minY - halfHeight - clearance, o.maxY + halfHeight + clearance);
      }
      const seed = fnv1a(`${slot.id}:rain:${streams.length}`), yaw = m.ry + (rand() - 0.5) * 0.18;
      const period = maxY - minY + (trainLength - 1) * MATRIX_RAIN_GAP;
      streams.push({ x, z, minY, maxY, yaw, cr: Math.cos(yaw), sr: Math.sin(yaw), period, trainLength, seed,
        speed: MATRIX_STREAM_SPEED_MIN + rand() * MATRIX_STREAM_SPEED_RANGE, phase: rand() * period, brightness: 0.62 + rand() * 0.32,
        rank: canvas ? 0 : streams.length % 8, distance: matrixTravelDistance(x, z, caveIndex), blocked });
    }
    const perGlyphCapacity = streams.length * Math.ceil(trainLength / MATRIX_TYPES);
    for (let glyph = 0; glyph < MATRIX_TYPES; glyph++) {
      const node = createNode({ geometry: { ...hubModels.matrixGlyph(glyph), matrixCave: caveIndex }, instanceData: new Float32Array(perGlyphCapacity * 20), instanceCount: 0, drawInstanceCount: 0, instanceVersion: 0, fixedInstanceCapacity: true });
      addChild(root, node); placed.push(node); nodes.push(node);
    }
    return { streams, nodes, perGlyphCapacity, capacity: perGlyphCapacity * MATRIX_TYPES, bufferBytes: perGlyphCapacity * MATRIX_TYPES * 80,
      spacing: MATRIX_RAIN_GAP, activeGlyphCount: 0, brightTipCount: 0, updates: 0, densityRankLimit: 0 };
  };
  const buildGateRain = (gate) => {
    const canvas = renderer.kind === "canvas2d", columns = canvas ? 8 : 14, depths = canvas ? 1 : 2, trainLength = canvas ? 9 : 14;
    const rand = mulberry32(fnv1a("old-gate:rain")), streams = [], nodes = [];
    const minY = gate.position.y + 0.09, maxY = gate.position.y + 3.91;
    for (let depth = 0; depth < depths; depth++) for (let column = 0; column < columns; column++) {
      const x = gate.position.x + lerp(-0.84, 0.84, (column + 0.5) / columns);
      const z = gate.position.z + (depths === 1 ? 0 : depth ? 0.18 : -0.18);
      const seed = fnv1a(`old-gate:rain:${streams.length}`), period = maxY - minY + (trainLength - 1) * MATRIX_RAIN_GAP;
      streams.push({ x, z, minY, maxY, yaw: 0, cr: 1, sr: 0, period, trainLength, seed,
        speed: MATRIX_STREAM_SPEED_MIN + rand() * MATRIX_STREAM_SPEED_RANGE, phase: rand() * period, brightness: 0.62 + rand() * 0.32,
        rank: canvas ? 0 : streams.length % 8, distance: matrixTravelDistance(x, z), blocked: [] });
    }
    const perGlyphCapacity = streams.length * Math.ceil(trainLength / MATRIX_TYPES);
    for (let glyph = 0; glyph < MATRIX_TYPES; glyph++) {
      const node = createNode({ geometry: { ...hubModels.matrixGlyph(glyph) }, instanceData: new Float32Array(perGlyphCapacity * 20), instanceCount: 0, drawInstanceCount: 0, instanceVersion: 0, fixedInstanceCapacity: true });
      addChild(root, node); placed.push(node); nodes.push(node);
    }
    return { streams, nodes, perGlyphCapacity, capacity: perGlyphCapacity * MATRIX_TYPES, bufferBytes: perGlyphCapacity * MATRIX_TYPES * 80,
      spacing: MATRIX_RAIN_GAP, activeGlyphCount: 0, brightTipCount: 0, updates: 0, densityRankLimit: 0,
      minX: gate.position.x - 0.84, maxX: gate.position.x + 0.84, minY, maxY, minZ: gate.position.z - 0.18, maxZ: gate.position.z + 0.18 };
  };
  const updateCaveRain = (rain, elapsed, visible, densityRankLimit, permanent = false) => {
    rain.activeGlyphCount = rain.brightTipCount = 0;
    rain.densityRankLimit = densityRankLimit;
    for (let glyph = 0; glyph < rain.nodes.length; glyph++) rain.nodes[glyph].instanceCount = rain.nodes[glyph].drawInstanceCount = 0;
    if (!visible) return;
    for (let i = 0; i < rain.streams.length; i++) {
      const s = rain.streams[i];
      if (s.rank >= densityRankLimit || !permanent && s.distance - MATRIX_GLYPH_REACH >= MATRIX_WORLD.radius) continue;
      const head = s.maxY - matrixModulo(elapsed * s.speed + s.phase, s.period);
      const version = Math.floor(elapsed * MATRIX_GLYPH_HZ + (s.seed & 15) / 16);
      for (let character = 0; character < s.trainLength; character++) {
        const y = head + character * MATRIX_RAIN_GAP;
        if (y < s.minY || y > s.maxY) continue;
        let blocked = false;
        for (let b = 0; b < s.blocked.length; b += 2) if (y >= s.blocked[b] && y <= s.blocked[b + 1]) { blocked = true; break; }
        if (blocked) continue;
        const glyph = (character + version + (s.seed & 7)) & 7, node = rain.nodes[glyph], slot = node.instanceCount++;
        if (slot >= rain.perGlyphCapacity) throw new Error("Cave Matrix rain instance capacity exceeded");
        const data = node.instanceData, offset = slot * 20;
        data[offset] = s.cr; data[offset + 1] = 0; data[offset + 2] = -s.sr; data[offset + 3] = 0;
        data[offset + 4] = 0; data[offset + 5] = 1; data[offset + 6] = 0; data[offset + 7] = 0;
        data[offset + 8] = s.sr; data[offset + 9] = 0; data[offset + 10] = s.cr; data[offset + 11] = 0;
        data[offset + 12] = s.x; data[offset + 13] = y; data[offset + 14] = s.z; data[offset + 15] = 1;
        data[offset + 16] = s.brightness * (0.48 + (1 - character / s.trainLength) * 0.52);
        data[offset + 17] = 0; data[offset + 18] = character === 0 ? 1 : character === 1 ? 0.55 : 0;
        // Free-standing voxels, unlike surface glyphs, must be visible from behind.
        data[offset + 19] = 0;
        rain.activeGlyphCount++; if (character < 2) rain.brightTipCount++;
      }
    }
    for (let glyph = 0; glyph < rain.nodes.length; glyph++) {
      const node = rain.nodes[glyph];
      node.drawInstanceCount = node.instanceCount;
      if (rain.activeGlyphCount) node.instanceVersion++;
    }
    if (rain.activeGlyphCount) rain.updates++;
  };
  const clearMatrixDraw = (cave) => {
    cave.activeGlyphCount = cave.revealedGlyphCount = cave.drawnGlyphCount = cave.brightTipCount = cave.movingGapCount = 0;
    const counts = cave.activeSurfaceCounts;
    counts.floor = counts.ceiling = counts.wall = counts.prop = 0;
    for (let glyph = 0; glyph < MATRIX_TYPES; glyph++) {
      const node = cave.nodes[glyph];
      node.instanceCount = node.drawInstanceCount = 0;
    }
  };
  // Intersect a lane's full width with the union of coplanar terrain faces. Between
  // vertex U coordinates, each connected V interval has linear boundary edges.
  // Keep their endpoint limits, including at hole vertices where an exact point
  // sample alone would incorrectly join the intervals on either side of a hole.
  const matrixSupportIntervals = (supports, left, right) => {
    const cuts = [left, right];
    for (const support of supports) for (const point of support.polygon) {
      if (point[0] > left && point[0] < right) cuts.push(point[0]);
    }
    cuts.sort((a, b) => a - b);
    let allowed = null;
    for (let slab = 1; slab < cuts.length; slab++) {
      const loU = cuts[slab - 1], hiU = cuts[slab];
      if (hiU - loU < 1e-8) continue;
      const middle = (loU + hiU) * 0.5, intervals = [];
      for (const support of supports) {
        const polygon = support.polygon;
        let lo = Infinity, hi = -Infinity, loLeft = 0, loRight = 0, hiLeft = 0, hiRight = 0;
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i], b = polygon[(i + 1) % polygon.length];
          if (middle <= Math.min(a[0], b[0]) || middle >= Math.max(a[0], b[0])) continue;
          const slope = (b[1] - a[1]) / (b[0] - a[0]);
          const v = a[1] + (middle - a[0]) * slope;
          const atLeft = a[1] + (loU - a[0]) * slope, atRight = a[1] + (hiU - a[0]) * slope;
          if (v < lo) { lo = v; loLeft = atLeft; loRight = atRight; }
          if (v > hi) { hi = v; hiLeft = atLeft; hiRight = atRight; }
        }
        if (hi > lo) intervals.push({ lo, hi, loLeft, loRight, hiLeft, hiRight });
      }
      intervals.sort((a, b) => a.lo - b.lo);
      const union = [];
      for (let i = 0; i < intervals.length;) {
        const first = intervals[i++];
        let hi = first.hi, hiLeft = first.hiLeft, hiRight = first.hiRight;
        while (i < intervals.length && intervals[i].lo <= hi + 1e-8) {
          const next = intervals[i++];
          if (next.hi > hi) { hi = next.hi; hiLeft = next.hiLeft; hiRight = next.hiRight; }
        }
        const lo = Math.max(first.loLeft, first.loRight), top = Math.min(hiLeft, hiRight);
        if (top > lo) union.push([lo, top]);
      }
      if (allowed === null) allowed = union;
      else {
        const intersection = [];
        for (let a = 0, b = 0; a < allowed.length && b < union.length;) {
          const lo = Math.max(allowed[a][0], union[b][0]), hi = Math.min(allowed[a][1], union[b][1]);
          if (hi > lo) intersection.push([lo, hi]);
          if (allowed[a][1] < union[b][1]) a++; else b++;
        }
        allowed = intersection;
      }
      if (!allowed.length) break;
    }
    return allowed || [];
  };
  // Sample actual carved polygons and prop faces once. Horizontal terrain lanes
  // span coplanar mesh seams; only genuine holes, steps and outer edges inset them.
  // All caves share the original eight voxel meshes and immutable backing geometry.
  // Island faces bucketed by their cave, plus the access-ramp faces, computed
  // once and kept on the memoised island rather than rescanned per cave visit.
  const EMPTY_FACES = [];
  const islandFaceIndex = () => {
    if (island.faceIndex) return island.faceIndex;
    const byCave = new Map(), ramps = [];
    for (let i = 0; i < island.geometry.faces.length; i++) {
      const face = island.geometry.faces[i];
      if (face.headquartersRamp || face.headquartersBasementRamp) ramps.push(face);
      if (face.matrixCave === undefined || face.matrixWorldGlyphSurface) continue;
      let list = byCave.get(face.matrixCave);
      if (!list) byCave.set(face.matrixCave, list = []);
      list.push(face);
    }
    return island.faceIndex = { byCave, ramps };
  };
  const buildCaveGlyphs = (slot, m, group) => {
    const caveIndex = island.mouths.indexOf(m) + 1, cr = Math.cos(m.ry), sr = Math.sin(m.ry);
    const portalInset = slot.status === "mirror" ? 0 : 0.02;
    if (slot.status === "mirror") {
      // Voxel-centre ownership leaves unlabelled floor fragments behind the
      // glass. Only nearby candidates need the renderer's exact bounded lookup.
      const geometry = island.geometry, verts = geometry.verts;
      for (const face of geometry.faces) {
        if (face.matrixCave) continue;
        let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const index of face.i) {
          const at = index * 3, dx = verts[at] - m.x, dz = verts[at + 2] - m.z;
          const x = cr * dx - sr * dz, y = verts[at + 1] - m.floorY, z = sr * dx + cr * dz;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        if (minX <= 2.5 && maxX >= -2.5 && minY >= -1e-6 && maxY <= 1e-6 && minZ <= PORTAL_Z && maxZ >= 0) face.matrixPermanentFallback = true;
      }
    }
    const sections = [], streams = [], entries = [], nodes = [], horizontalDomains = [];
    const surfaceCounts = { floor: 0, ceiling: 0, wall: 0, prop: 0 };
    const halfX = 0.0395, halfY = 0.0605, halfZ = 0.005, clearance = 0.01;
    let maximumLocalZ = -Infinity, minEntranceX = Infinity, maxEntranceX = -Infinity, propFaces = 0, terrainFaces = 0, perGlyphCapacity = 0;
    const addStream = (section, column, flowMin, flowMax) => {
      const { nx, ny, nz, ux, uz, vx, vz, plane, horizontal } = section;
      const cross = column * MATRIX_SURFACE_PITCH;
      const seed = fnv1a(`${slot.id}:${Math.round(nx * 1000)}:${Math.round(ny * 1000)}:${Math.round(nz * 1000)}:${column}`);
      const rand = mulberry32(seed), trainLength = MATRIX_TRAIN_MIN + Math.floor(rand() * MATRIX_TRAIN_RANGE), gapLength = MATRIX_TRAIN_GAP_MIN + Math.floor(rand() * MATRIX_TRAIN_GAP_RANGE);
      const sequence = trainLength + gapLength, span = sequence * MATRIX_SURFACE_GAP;
      const speed = MATRIX_STREAM_SPEED_MIN + rand() * MATRIX_STREAM_SPEED_RANGE, phase = rand() * span, brightness = 0.58 + rand() * 0.36;
      const direction = horizontal && ny > 0 ? 1 : -1;
      const characters = Math.ceil((flowMax - flowMin) / MATRIX_SURFACE_GAP) + 1, rank = matrixModulo(column, 8);
      const stream = { section: sections.length, cross, speed, phase, brightness, trainLength, gapLength, direction, flowMin, flowMax, flowRange: span, seed, head: 0, gap: 0, rank, entryStart: entries.length, entryCount: 0 };
      const streamIndex = streams.length;
      streams.push(stream);
      if (renderer.kind !== "canvas2d" || rank < MATRIX_DENSITY.canvas2d) {
        for (let character = 0; character < characters; character++) entries.push({ stream: streamIndex, character, rank });
        stream.entryCount = characters;
        // Advected cell identities cover every glyph once per eight consecutive slots.
        perGlyphCapacity += Math.ceil(characters / MATRIX_TYPES);
      }
      section.streamCount++;
      section.glyphCount += characters;
      const portalU = sr * ux + cr * uz, portalV = sr * vx + cr * vz, portalN = sr * nx + cr * nz;
      for (let edge = 0; edge < 2; edge++) {
        const flow = edge ? flowMax : flowMin;
        const localZ = portalU * cross + portalV * flow + portalN * (plane + halfZ + clearance) - sr * m.x - cr * m.z;
        maximumLocalZ = Math.max(maximumLocalZ, localZ + Math.abs(portalU) * halfX + Math.abs(portalV) * halfY + Math.abs(portalN) * halfZ);
      }
    };
    const addFace = (geometry, face, transform, source) => {
      const points = [];
      for (let i = 0; i < face.i.length; i++) {
        const p = face.i[i] * 3, x = geometry.verts[p], y = geometry.verts[p + 1], z = geometry.verts[p + 2];
        points.push(transform ? [transform[0] * x + transform[4] * y + transform[8] * z + transform[12], transform[1] * x + transform[5] * y + transform[9] * z + transform[13], transform[2] * x + transform[6] * y + transform[10] * z + transform[14]] : [x, y, z]);
      }
      const a = points[0];
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < points.length; i++) {
        const p = points[i], q = points[(i + 1) % points.length];
        nx += (p[1] - q[1]) * (p[2] + q[2]);
        ny += (p[2] - q[2]) * (p[0] + q[0]);
        nz += (p[0] - q[0]) * (p[1] + q[1]);
      }
      const length = Math.hypot(nx, ny, nz);
      if (length < 1e-8) return;
      nx /= length; ny /= length; nz /= length;
      const horizontal = Math.abs(ny) > 0.999;
      let vx = horizontal ? sr * (ny > 0 ? -1 : 1) : -ny * nx;
      let vy = horizontal ? 0 : 1 - ny * ny;
      let vz = horizontal ? cr * (ny > 0 ? -1 : 1) : -ny * nz;
      const vLength = Math.hypot(vx, vy, vz);
      vx /= vLength; vy /= vLength; vz /= vLength;
      const ux = vy * nz - vz * ny, uy = vz * nx - vx * nz, uz = vx * ny - vy * nx;
      const plane = nx * a[0] + ny * a[1] + nz * a[2], polygon = [];
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (let i = 0; i < points.length; i++) {
        const p = points[i], u = ux * p[0] + uy * p[1] + uz * p[2], v = vx * p[0] + vy * p[1] + vz * p[2];
        const entranceX = cr * (p[0] - m.x) - sr * (p[2] - m.z);
        minEntranceX = Math.min(minEntranceX, entranceX); maxEntranceX = Math.max(maxEntranceX, entranceX);
        polygon.push([u, v]);
        minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        minV = Math.min(minV, v); maxV = Math.max(maxV, v);
      }
      if (source === "terrain" && horizontal) {
        let domain = null;
        for (let i = 0; i < horizontalDomains.length; i++) {
          const candidate = horizontalDomains[i];
          if (candidate.ny === ny && candidate.plane === plane) { domain = candidate; break; }
        }
        if (!domain) {
          domain = { source, category: ny > 0 ? "floor" : "ceiling", face: null, polygon: null, supports: [], constraints: [], ux, uy, uz, vx, vy, vz, nx, ny, nz, plane, clearance, horizontal, minU, maxU, streamStart: 0, streamCount: 0, glyphCount: 0 };
          horizontalDomains.push(domain);
        }
        domain.supports.push({ face, polygon });
        domain.minU = Math.min(domain.minU, minU); domain.maxU = Math.max(domain.maxU, maxU);
        terrainFaces++;
        return;
      }
      let area = 0;
      for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i], q = polygon[(i + 1) % polygon.length];
        area += p[0] * q[1] - q[0] * p[1];
      }
      const winding = area < 0 ? -1 : 1, constraints = [];
      for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i], q = polygon[(i + 1) % polygon.length];
        const cu = winding * (q[1] - p[1]), cv = winding * (p[0] - q[0]);
        constraints.push([cu, cv, cu * p[0] + cv * p[1] - Math.abs(cu) * halfX - Math.abs(cv) * halfY]);
      }
      // Account for the entire extruded glyph at the real portal, not only its centre.
      const portalU = sr * ux + cr * uz, portalV = sr * vx + cr * vz, portalN = sr * nx + cr * nz;
      constraints.push([portalU, portalV, PORTAL_Z - portalInset + sr * m.x + cr * m.z - portalN * (plane + halfZ + clearance) - Math.abs(portalU) * halfX - Math.abs(portalV) * halfY - Math.abs(portalN) * halfZ]);
      const category = source === "prop" ? "prop" : horizontal ? ny > 0 ? "floor" : "ceiling" : "wall";
      const section = { source, category, face, polygon, constraints, ux, uy, uz, vx, vy, vz, nx, ny, nz, plane, clearance, horizontal, streamStart: streams.length, streamCount: 0, glyphCount: 0 };
      for (let column = Math.ceil((minU + halfX) / MATRIX_SURFACE_PITCH); column * MATRIX_SURFACE_PITCH <= maxU - halfX + 1e-8; column++) {
        const cross = column * MATRIX_SURFACE_PITCH;
        let flowMin = minV + halfY, flowMax = maxV - halfY, valid = true;
        for (let i = 0; i < constraints.length; i++) {
          const constraint = constraints[i], remain = constraint[2] - constraint[0] * cross;
          if (constraint[1] > 1e-8) flowMax = Math.min(flowMax, remain / constraint[1]);
          else if (constraint[1] < -1e-8) flowMin = Math.max(flowMin, remain / constraint[1]);
          else if (remain < -1e-8) { valid = false; break; }
        }
        if (!valid || flowMax - flowMin < 1e-6) continue;
        addStream(section, column, flowMin, flowMax);
      }
      if (section.streamCount) {
        sections.push(section);
        surfaceCounts[category] += section.glyphCount;
      }
      if (source === "terrain") terrainFaces++; else propFaces++;
    };
    const caveFaces = islandFaceIndex().byCave.get(caveIndex) || EMPTY_FACES;
    for (let i = 0; i < caveFaces.length; i++) addFace(island.geometry, caveFaces[i], null, "terrain");
    for (const section of horizontalDomains) {
      section.streamStart = streams.length;
      const portalU = sr * section.ux + cr * section.uz, portalV = sr * section.vx + cr * section.vz;
      const portalN = sr * section.nx + cr * section.nz;
      const portalLimit = PORTAL_Z - portalInset + sr * m.x + cr * m.z - portalN * (section.plane + halfZ + clearance) - Math.abs(portalU) * halfX - Math.abs(portalV) * halfY - Math.abs(portalN) * halfZ;
      section.constraints.push([portalU, portalV, portalLimit]);
      for (let column = Math.ceil((section.minU + halfX) / MATRIX_SURFACE_PITCH); column * MATRIX_SURFACE_PITCH <= section.maxU - halfX + 1e-8; column++) {
        const cross = column * MATRIX_SURFACE_PITCH;
        const intervals = matrixSupportIntervals(section.supports, cross - halfX, cross + halfX);
        for (let i = 0; i < intervals.length; i++) {
          let flowMin = intervals[i][0] + halfY, flowMax = intervals[i][1] - halfY;
          const remain = portalLimit - portalU * cross;
          if (portalV > 1e-8) flowMax = Math.min(flowMax, remain / portalV);
          else if (portalV < -1e-8) flowMin = Math.max(flowMin, remain / portalV);
          else if (remain < -1e-8) continue;
          if (flowMax - flowMin >= 1e-6) addStream(section, column, flowMin, flowMax);
        }
      }
      if (section.streamCount) {
        sections.push(section);
        surfaceCounts[section.category] += section.glyphCount;
      }
    }
    BL.scene.updateWorld(group);
    const visit = (node, inheritedLiving = false, inheritedEmissive = false, inheritedExterior = false) => {
      const living = inheritedLiving || !!node.matrixLiving, emissiveLiving = inheritedEmissive || !!node.matrixEmissiveLiving, exterior = inheritedExterior || !!node.matrixExterior;
      if (node.geometry && !node.geometry.matrixGlyph && !node.geometry.matrixLocalGlyphSurface && !node.mirror && !exterior) {
        const original = node.geometry, faces = [], transform = node.world;
        let owned = false;
        for (let f = 0; f < original.faces.length; f++) {
          const face = original.faces[f];
          let inside = true, touches = false;
          for (let i = 0; i < face.i.length; i++) {
            const p = face.i[i] * 3, x = original.verts[p], y = original.verts[p + 1], z = original.verts[p + 2];
            const wx = transform[0] * x + transform[4] * y + transform[8] * z + transform[12];
            const wz = transform[2] * x + transform[6] * y + transform[10] * z + transform[14];
            const behind = sr * (wx - m.x) + cr * (wz - m.z) <= PORTAL_Z - portalInset;
            if (behind) touches = true;
            else { inside = false; if (slot.status !== "mirror") break; }
          }
          if (inside || slot.status === "mirror" && touches) {
            // A crossing rim face needs procedural glyphs on both sides when
            // the world wave arrives. Native lanes remain on wholly owned faces.
            const local = { ...face, matrixCave: caveIndex, matrixLocalGlyphSurface: inside, matrixWorldGlyphSurface: !inside };
            faces.push(local);
            if (inside && !living && !(emissiveLiving && face.emissive > 0)) addFace(original, local, transform, "prop");
            owned = true;
          } else faces.push(face);
        }
        if (owned) node.geometry = { ...original, faces, matrixSourceGeometry: original };
      }
      for (let i = 0; i < node.children.length; i++) visit(node.children[i], living, emissiveLiving, exterior);
    };
    visit(group);
    for (let glyph = 0; glyph < MATRIX_TYPES; glyph++) {
      // A record owns one raw instance buffer. Its geometry wrapper is per cave;
      // the immutable voxel vertices and faces themselves remain shared.
      const node = createNode({ geometry: { ...hubModels.matrixGlyph(glyph), matrixCave: caveIndex }, instanceData: new Float32Array(perGlyphCapacity * 20), instanceCount: 0, drawInstanceCount: 0, instanceVersion: 0, fixedInstanceCapacity: true });
      addChild(root, node); placed.push(node); nodes.push(node);
    }
    let registryHash = 2166136261, minBrightness = Infinity, maxBrightness = 0, minTrainLength = Infinity, maxTrainLength = 0, minGapLength = Infinity, maxGapLength = 0;
    let surfaceMetadataBytes = 0;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      registryHash = Math.imul(registryHash ^ Math.round(section.plane * 1000) ^ section.streamCount, 16777619) >>> 0;
      surfaceMetadataBytes += 128 + section.constraints.length * 24;
      if (section.supports) {
        for (const support of section.supports) surfaceMetadataBytes += 32 + support.polygon.length * 16;
      } else surfaceMetadataBytes += section.polygon.length * 16;
    }
    for (let i = 0; i < streams.length; i++) {
      const stream = streams[i];
      registryHash = Math.imul(registryHash ^ stream.seed ^ Math.round(stream.flowMin * 1000) ^ Math.round(stream.flowMax * 1000), 16777619) >>> 0;
      minBrightness = Math.min(minBrightness, stream.brightness); maxBrightness = Math.max(maxBrightness, stream.brightness);
      minTrainLength = Math.min(minTrainLength, stream.trainLength); maxTrainLength = Math.max(maxTrainLength, stream.trainLength);
      minGapLength = Math.min(minGapLength, stream.gapLength); maxGapLength = Math.max(maxGapLength, stream.gapLength);
    }
    const cave = {
      id: slot.id, caveIndex, mouth: m, cr, sr, nodes, sections, streams, entries, surfaceCounts, activeSurfaceCounts: { floor: 0, ceiling: 0, wall: 0, prop: 0 },
      rain: buildCaveRain(slot, m, group, caveIndex),
      glyphCount: surfaceCounts.floor + surfaceCounts.ceiling + surfaceCounts.wall + surfaceCounts.prop,
      perGlyphCapacity, capacity: perGlyphCapacity * MATRIX_TYPES, bufferBytes: perGlyphCapacity * MATRIX_TYPES * 80,
      registryBytes: entries.length * 24 + streams.length * 112 + surfaceMetadataBytes, surfaceMetadataBytes, registryHash: registryHash.toString(16).padStart(8, "0"),
      activeGlyphCount: 0, revealedGlyphCount: 0, drawnGlyphCount: 0, brightTipCount: 0, movingGapCount: 0, maximumLocalZ,
      minimumTravelDistance: matrixEntranceMinimum(m, minEntranceX, maxEntranceX), terrainFaces, propFaces, updates: 0, allocationCount: MATRIX_TYPES, rebuildCount: 1,
      quality: renderer.kind === "canvas2d" ? "canvas2d" : renderer.quality, densityRankLimit: MATRIX_DENSITY[renderer.kind === "canvas2d" ? "canvas2d" : renderer.quality], glyphVersion: -1, previousGlyphVersion: -1, mutationHash: 0, firstGlyphY: 0,
      minBrightness, maxBrightness, minTrainLength, maxTrainLength, minGapLength, maxGapLength, visible: false, drawEnabled: false
    };
    // One world-space sphere around the whole interior (portal at local z .5 to depth 7) lets the renderer skip the cave's batches
    const cullSphere = new Float32Array([m.x + sr * -3.25, m.floorY + 2.1, m.z + cr * -3.25, 5.6]);
    for (let i = 0; i < nodes.length; i++) nodes[i].cullSphere = cullSphere;
    for (let i = 0; i < cave.rain.nodes.length; i++) cave.rain.nodes[i].cullSphere = cullSphere;
    matrixInteriors.push(cave);
    return cave;
  };
  const updateCaveGlyphs = (elapsed, visible, densityRankLimit) => {
    for (let c = 0; c < matrixInteriors.length; c++) {
      const cave = matrixInteriors[c];
      const permanent = cave.caveIndex === MATRIX_WORLD.permanentCave;
      cave.visible = cave.drawEnabled = permanent || visible && MATRIX_WORLD.radius > cave.minimumTravelDistance;
      cave.quality = renderer.kind === "canvas2d" ? "canvas2d" : renderer.quality;
      cave.densityRankLimit = densityRankLimit;
      updateCaveRain(cave.rain, elapsed, cave.visible, densityRankLimit, permanent);
      if (!permanent && (!visible || MATRIX_WORLD.radius <= cave.minimumTravelDistance)) {
        clearMatrixDraw(cave);
        continue;
      }
      const nodes = cave.nodes, streams = cave.streams, sections = cave.sections, radius = MATRIX_WORLD.radius;
      for (let glyph = 0; glyph < MATRIX_TYPES; glyph++) nodes[glyph].instanceCount = 0;
      const counts = cave.activeSurfaceCounts;
      counts.floor = counts.ceiling = counts.wall = counts.prop = 0;
      let active = 0, revealed = 0, bright = 0, gaps = 0, first = true, mutationHash = 2166136261;
      // Entries are contiguous per stream with ascending character, so one pass over
      // the streams visits them in registry order with every per-stream term hoisted.
      for (let s = 0; s < streams.length; s++) {
        const stream = streams[s], direction = stream.direction, travel = elapsed * stream.speed + stream.phase;
        if (stream.entryCount && stream.rank < densityRankLimit) {
          const section = sections[stream.section], flowMin = stream.flowMin, flowMax = stream.flowMax, trainLength = stream.trainLength;
          const sequence = trainLength + stream.gapLength, shift = direction * travel, brightness = stream.brightness;
          const base = Math.ceil((flowMin - shift) / MATRIX_SURFACE_GAP), plane = section.plane + 0.015, cross = stream.cross;
          const ux = section.ux, uy = section.uy, uz = section.uz, vx = section.vx, vy = section.vy, vz = section.vz, nx = section.nx, ny = section.ny, nz = section.nz;
          const xu = ux * cross, yu = uy * cross, zu = uz * cross, xn = nx * plane, yn = ny * plane, zn = nz * plane;
          const pick = Math.floor(elapsed * MATRIX_GLYPH_HZ + (stream.seed & 15) / 16) + (stream.seed & 7);
          const from = stream.entryStart, to = from + stream.entryCount;
          let streamActive = 0;
          for (let i = from; i < to; i++) {
            const cell = base + (i - from), flow = cell * MATRIX_SURFACE_GAP + shift;
            if (flow < flowMin || flow > flowMax) continue;
            const x = xu + vx * flow + xn, z = zu + vz * flow + zn;
            let distance = 0;
            if (!permanent) {
              distance = matrixTravelDistance(x, z, cave.caveIndex);
              if (distance - MATRIX_GLYPH_REACH >= radius) continue;
            }
            const trainPosition = matrixModulo(-direction * cell, sequence);
            if (trainPosition >= trainLength) { gaps++; continue; }
            const tip = trainPosition === 0 ? 1 : trainPosition === 1 ? 0.55 : 0;
            const glyph = (cell + pick) & 7;
            const node = nodes[glyph], slot = node.instanceCount++;
            if (slot >= cave.perGlyphCapacity) throw new Error("Cave Matrix glyph instance capacity exceeded");
            const data = node.instanceData, offset = slot * 20;
            data[offset] = ux; data[offset + 1] = uy; data[offset + 2] = uz; data[offset + 3] = 0;
            data[offset + 4] = vx; data[offset + 5] = vy; data[offset + 6] = vz; data[offset + 7] = 0;
            data[offset + 8] = nx; data[offset + 9] = ny; data[offset + 10] = nz; data[offset + 11] = 0;
            data[offset + 12] = x;
            data[offset + 13] = yu + vy * flow + yn;
            data[offset + 14] = z;
            data[offset + 15] = 1; data[offset + 16] = brightness * (0.48 + (1 - trainPosition / trainLength) * 0.52); data[offset + 17] = 0; data[offset + 18] = tip; data[offset + 19] = 1;
            if (DEBUG) mutationHash = Math.imul(mutationHash ^ glyph ^ Math.imul(i + 1, 16777619), 16777619) >>> 0;
            if (first && !section.horizontal) { cave.firstGlyphY = data[offset + 13]; first = false; }
            streamActive++; if (permanent || distance < radius) revealed++; if (tip) bright++;
          }
          counts[section.category] += streamActive; active += streamActive;
        }
        const wrapped = matrixModulo(travel, stream.flowRange);
        stream.head = direction * wrapped;
        stream.gap = direction * matrixModulo(wrapped - stream.trainLength * MATRIX_SURFACE_GAP, stream.flowRange);
      }
      for (let glyph = 0; glyph < MATRIX_TYPES; glyph++) {
        const node = nodes[glyph];
        node.drawInstanceCount = node.instanceCount;
        if (active) node.instanceVersion++;
      }
      cave.activeGlyphCount = cave.drawnGlyphCount = active;
      cave.revealedGlyphCount = revealed;
      cave.brightTipCount = bright; cave.movingGapCount = gaps; if (active) cave.updates++;
      cave.previousGlyphVersion = cave.glyphVersion;
      cave.glyphVersion = Math.floor(elapsed * MATRIX_GLYPH_HZ);
      cave.mutationHash = mutationHash;
    }
  };
  const matrixWorldStreamSample = (stream, time, downward) => {
    const hash = (n) => {
      let value = n | 0;
      value ^= value >>> 16;
      value = Math.imul(value, 2146121005);
      value ^= value >>> 15;
      value = Math.imul(value, -2073254261);
      value ^= value >>> 16;
      return (value >>> 8) / 16777216;
    };
    const speed = MATRIX_STREAM_SPEED_MIN + hash(stream + 19) * MATRIX_STREAM_SPEED_RANGE;
    const trainLength = MATRIX_TRAIN_MIN + Math.floor(hash(stream) * MATRIX_TRAIN_RANGE);
    const gapLength = MATRIX_TRAIN_GAP_MIN + Math.floor(hash(stream + 41) * MATRIX_TRAIN_GAP_RANGE);
    const sequenceLength = trainLength + gapLength, span = sequenceLength * MATRIX_SURFACE_GAP;
    const phase = hash(stream + 73) * span, direction = downward ? -1 : 1;
    const brightness = 0.58 + hash(stream + 101) * 0.36;
    return {
      stream, time, speed, trainLength, gapLength, span, direction, brightness,
      leadingGlow: brightness,
      secondGlow: brightness * (0.48 + 0.52 * (trainLength - 1) / trainLength),
      trailingGlow: brightness * (0.48 + 0.52 / trainLength),
      head: direction * matrixModulo(time * speed + phase + (trainLength - 1) * MATRIX_SURFACE_GAP, span),
      gap: direction * matrixModulo(time * speed + phase + trainLength * MATRIX_SURFACE_GAP, span)
    };
  };
  const MATRIX_CAMERA_COLUMN = { caveIndex: 0, floor: 0, ceiling: 0 };
  const updateMatrixWorld = (dt, elapsed) => {
    if (!matrixCave) return;
    const quality = renderer.kind === "canvas2d" ? "canvas2d" : renderer.quality;
    const densityRankLimit = MATRIX_DENSITY[quality] || MATRIX_DENSITY.high;
    MATRIX_WORLD.time = elapsed;
    MATRIX_WORLD.density = densityRankLimit / MATRIX_DENSITY.high;
    if (MATRIX_WORLD.direction > 0) {
      MATRIX_WORLD.radius = Math.min(MATRIX_WORLD.maxRadius, MATRIX_WORLD.radius + dt * MATRIX_WORLD.speed);
      if (MATRIX_WORLD.radius === MATRIX_WORLD.maxRadius) MATRIX_WORLD.direction = 0;
    }
    else if (MATRIX_WORLD.direction < 0) {
      MATRIX_WORLD.radius = Math.max(0, MATRIX_WORLD.radius - dt * MATRIX_WORLD.retreatSpeed);
      if (MATRIX_WORLD.radius === 0) MATRIX_WORLD.direction = 0;
    }
    MATRIX_WORLD.active = MATRIX_WORLD.radius > 0 ? 1 : 0;
    const mirrorReveal = mirrorCave.damage.broken || matrixCave.unlocked ? 1 : matrixCave.portal.inside ? Math.max(0, Math.min(1, (MATRIX_WORLD.radius - matrixCave.mirrorDistance) / MATRIX_MIRROR_HEIGHT)) : 0;
    matrixCave.mirrorNode.mirrorReveal = mirrorReveal;
    matrixCave.mirrorNode.mirrorPortal = mirrorReveal === 1;
    updateCaveGlyphs(elapsed, !!MATRIX_WORLD.active, densityRankLimit);
    if (gateRain) updateCaveRain(gateRain, elapsed, !!MATRIX_WORLD.active, densityRankLimit);
    if (mirrorGuides) {
      const eye = camera.position;
      // A trailing eye can pass through a cave wall while its Ooga stays
      // outdoors. Read the eye's actual empty cavity rather than its owner.
      const inside = !!pilot.player && !matrixCave.portal.inside
        && island.cavityAt(eye.x, eye.z, MATRIX_CAMERA_COLUMN, matrixCave.caveIndex, eye.y) && MATRIX_CAMERA_COLUMN.caveIndex === matrixCave.caveIndex
        && eye.y >= MATRIX_CAMERA_COLUMN.floor && eye.y < MATRIX_CAMERA_COLUMN.ceiling && island.clearAt(eye.x, eye.y, eye.z, 1e-5, 2e-5);
      mirrorGuides.updateDoorway(camera, inside, elapsed, MATRIX_WORLD.density);
    }
  };
  const inMatrixCave = () => {
    return !!matrixCave && matrixCave.portal.inside;
  };
  const matrixOverlayVisible = (x, y, z) => {
    if (!matrixCave || !matrixCave.portal.inside) return true;
    const m = matrixCave.mouth;
    const cdx = camera.position.x - m.x, cdz = camera.position.z - m.z;
    const tdx = x - m.x, tdz = z - m.z;
    const cx = matrixCave.cr * cdx - matrixCave.sr * cdz;
    const cz = matrixCave.sr * cdx + matrixCave.cr * cdz;
    const tx = matrixCave.cr * tdx - matrixCave.sr * tdz;
    const tz = matrixCave.sr * tdx + matrixCave.cr * tdz;
    if (tz <= 0.5) return true;
    const amount = (0.5 - cz) / (tz - cz);
    if (amount <= 0 || amount >= 1) return false;
    const ix = cx + (tx - cx) * amount;
    const iy = camera.position.y - m.floorY + (y - camera.position.y) * amount;
    return ix >= PORTAL_MIN_X && ix <= PORTAL_MAX_X && iy >= PORTAL_MIN_Y && iy <= PORTAL_MAX_Y;
  };
  const SLEEP_SCREEN = { x: 0, y: 0, depth: 0 };
  let sleepSightFrame = 0;
  const sleepSightAt = (x, y, z) => {
    if (!matrixOverlayVisible(x, y, z)) return false;
    const screen = renderer.project(x, y, z, SLEEP_SCREEN);
    if (!screen || screen.x < 0 || screen.y < 0 || screen.x > renderer.size.width || screen.y > renderer.size.height) return false;
    const eye = camera.position, dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
    if (!entranceSegmentClear(eye.x, eye.y, eye.z, x, y, z, 0.002) || !bedSegmentClear(eye.x, eye.y, eye.z, x, y, z, 0.002, 0.004)) return false;
    // Short exact sweeps keep long sight rays from scanning an island-sized
    // box. The point checks also include the continuous ramp surfaces.
    const distance = Math.hypot(dx, dy, dz);
    const outside = Math.max(0, Math.hypot(eye.x, eye.y, eye.z) - Math.hypot(island.radius, island.undersideDepth, terrain.MAX_HEIGHT) - island.unit);
    const start = Math.min(1, outside / Math.max(distance, 1e-7));
    const steps = Math.max(1, Math.ceil(distance * (1 - start) / (island.unit * 0.5)));
    let px = eye.x + dx * start, py = eye.y + dy * start, pz = eye.z + dz * start;
    for (let i = 1; i <= steps; i++) {
      const k = start + (1 - start) * i / steps, nx = eye.x + dx * k, ny = eye.y + dy * k, nz = eye.z + dz * k;
      if (!island.clearAt(nx, ny, nz, 0.002, 0.004) || !island.voxelSegmentClearAt(px, py, pz, nx, ny, nz, 0.002, 0.004)) return false;
      px = nx; py = ny; pz = nz;
    }
    return true;
  };
  const sleepOpeningVisible = (x, y, z, cr, sr, halfWidth, halfHeight) => {
    if (sleepSightAt(x, y, z)) return true;
    for (let i = 0; i < 4; i++) {
      const across = (i & 1 ? 1 : -1) * halfWidth, lift = (i & 2 ? 1 : -1) * halfHeight;
      if (sleepSightAt(x + cr * across, y + lift, z + sr * across)) return true;
    }
    return false;
  };
  const sleepMarksVisible = (cave, x, y, z) => {
    if (!cave) return sleepSightAt(x, y, z);
    const bed = cave.bedroll;
    if (cave.state !== "sleeping" || cave.bedTravel.mode !== "rest" || !bed || bed.sleeper !== cave) return false;
    if (bed.sightFrame === sleepSightFrame) return bed.sightVisible;
    bed.sightFrame = sleepSightFrame;
    const head = cave.sleepHead, body = cave.root.position, room = bed.room, window = bed.window;
    bed.sightVisible = sleepSightAt(head.x, head.y, head.z) || sleepSightAt(body.x, body.y, body.z)
      || sleepOpeningVisible(room.entrance.x, room.floor + 1.8, room.entrance.z, bed.cr, -bed.sr, (room.corridorWidth ?? room.width - 1.3) * 0.35, 1.1)
      || !!window && sleepOpeningVisible(window.x, window.y, window.z, Math.cos(window.angle), Math.sin(window.angle), window.width * 0.35, window.height * 0.35);
    return bed.sightVisible;
  };
  const viewInsideMatrix = (lookOut = false) => {
    const m = matrixCave.mouth, targetZ = lookOut ? 0.45 : -5.45;
    const target = { x: m.x + matrixCave.sr * targetZ, y: m.floorY + 1.75, z: m.z + matrixCave.cr * targetZ };
    const orbit = pilot.orbit, yaw = m.ry + (lookOut ? Math.PI : 0);
    if (!matrixCave.portal.inside) {
      setCameraCave(0);
      setVec(CAMERA_PREVIOUS, m.x + matrixCave.sr * (PORTAL_Z + 0.01), m.floorY + 1.75, m.z + matrixCave.cr * (PORTAL_Z + 0.01));
      cameraPreviousValid = true;
    }
    orbit.target = target;
    orbit.tx = target.x;
    orbit.ty = target.y;
    orbit.tz = target.z;
    orbit.yaw = orbit.tYaw = yaw;
    orbit.pitch = orbit.tPitch = 0.08;
    orbit.dist = orbit.tDist = 3.5;
    pilot.update(0.1);
  };
  const viewMatrixApproach = () => {
    const m = matrixCave.mouth;
    const target = { x: m.x + matrixCave.sr * 0.5, y: m.floorY + 1.5, z: m.z + matrixCave.cr * 0.5 };
    const orbit = pilot.orbit;
    orbit.target = target;
    orbit.tx = target.x;
    orbit.ty = target.y;
    orbit.tz = target.z;
    orbit.yaw = orbit.tYaw = m.ry;
    orbit.pitch = orbit.tPitch = 0.08;
    orbit.dist = orbit.tDist = 12;
    pilot.update(0.1);
  };

  // ---------- island ----------
  // A prop with a kind answers pointer taps
  const addProp = (kind, node, x, z, radius) => {
    const owner = { kind: "prop", prop: kind, node, x, z, ripe: 0, pickRadius: radius, active: true };
    if (kind === "tree" || kind === "bush" || kind === "flower" || kind === "grass") owner.weaponType = "none";
    addTarget(node, owner, { radius });
    props.push(owner);
    if (SOLID_PROPS.has(kind)) solids.add(node);
    return owner;
  };
  const place = (geometry, x, z, ry = 0, y = island.surfaceAt(x, z), kind = null, radius = 0) => {
    const node = createNode({ position: { x, y, z }, rotation: { x: 0, y: ry, z: 0 }, geometry, matrixLiving: MATRIX_LIVING_PROPS.has(kind) });
    addChild(root, node);
    placed.push(node);
    if (kind) addProp(kind, node, x, z, radius);
    return node;
  };
  const claim = (x, z, r) => {
    const value = { x, z, r, scenery: null };
    claimed.push(value);
    return value;
  };
  const free = (x, z, r) => {
    for (const c of claimed) if (Math.hypot(c.x - x, c.z - z) < c.r + r) return false;
    return true;
  };
  const nearPath = (x, z, d) => {
    if (island.isPath(x, z)) return true;
    for (let i = 0; i < 16; i++) {
      const c = Math.cos(i / 16 * Math.PI * 2), s = Math.sin(i / 16 * Math.PI * 2);
      if (island.isPath(x + c * d, z + s * d) || island.isPath(x + c * d / 2, z + s * d / 2)) return true;
    }
    return false;
  };
  const nearMouth = (x, z, d) => {
    for (const m of island.mouths) if (Math.hypot(m.x - x, m.z - z) < d) return true;
    return false;
  };
  const spotAt = (deg, r, margin) => {
    for (const off of NUDGES) {
      const p = polar(deg + off, r);
      if (!nearPath(p.x, p.z, margin) && island.surfaceAt(p.x, p.z) === 0) return p;
    }
    return polar(deg, r);
  };
  // A flame that lights with the night; lit lamps also feed the point lights
  const addLamp = (node, kind, x, y, z, light = true, order = lamps.length, id = `lamp:${lamps.length}`) => {
    node.glow = LAMP_OFF;
    node.flare = 0;
    const lamp = { node, kind, x, y, z, light, order, id, k: 0, lit: false, selected: false, approximated: false, debug: null };
    lamps.push(lamp);
    return lamp;
  };
  // Light the lamps in order as the dusk ramp climbs, spark when one catches
  const updateLamps = (dt, elapsed, spark) => {
    const lights = RENDER_OPTS.lights;
    const webgl = renderer.kind === "webgl2";
    const limit = webgl ? LIGHT_CAPACITY : 0;
    let count = 0, approximated = 0;
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i], node = l.node;
      const k = l.always ? 1 : Math.min(1, Math.max(0, (RENDER_OPTS.torch - l.order * LAMP_STAGGER) / LAMP_RAMP));
      const lit = k > 0.05;
      if (lit && !l.lit && spark) fx.burst(l.x, l.y, l.z, 5, [SPARK], 1.3);
      l.lit = lit;
      l.k = k;
      const flicker = Math.sin(elapsed * 11 + i * 2.3) * 0.15;
      node.glow = LAMP_OFF + k * (l.kind.glow + flicker) + node.flare * 1.5;
      if (node.flare > 0) node.flare = Math.max(0, node.flare - dt * 2);
      // A cold fire shows no flame at all
      if (l.kind.hide) node.visible = lit;
      l.selected = false;
      l.approximated = false;
      if (l.debug) {
        l.debug.factor = k;
        l.debug.lit = lit;
        l.debug.selected = false;
        l.debug.approximated = false;
      }
    }
    // Registration order is spatially stable: camera movement never swaps lamp profiles.
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      if (!l.lit || !l.light) continue;
      if (count < limit) {
        l.selected = true;
        if (l.debug) l.debug.selected = true;
        LIGHTING_DEBUG.selectedIds[count] = l.id;
        const o = count++ * 8;
        lights[o] = l.x;
        lights[o + 1] = l.y;
        lights[o + 2] = l.z;
        lights[o + 3] = l.kind.radius;
        lights[o + 4] = l.kind.r * l.k;
        lights[o + 5] = l.kind.g * l.k;
        lights[o + 6] = l.kind.b * l.k;
      } else {
        l.approximated = true;
        if (l.debug) l.debug.approximated = true;
        LIGHTING_DEBUG.approximatedIds[approximated++] = l.id;
      }
    }
    for (let i = count; i < LIGHT_CAPACITY; i++) LIGHTING_DEBUG.selectedIds[i] = null;
    for (let i = approximated; i < LIGHT_CAPACITY; i++) LIGHTING_DEBUG.approximatedIds[i] = null;
    RENDER_OPTS.lightCount = count;
    LIGHTING_DEBUG.registeredLampCount = lamps.length;
    LIGHTING_DEBUG.activeFullLightCount = count;
    LIGHTING_DEBUG.approximatedLightCount = approximated;
    LIGHTING_DEBUG.configuredLightCapacity = limit;
    LIGHTING_DEBUG.selectedCount = count;
    LIGHTING_DEBUG.approximatedCount = approximated;
    LIGHTING_DEBUG.tier = webgl ? renderer.quality : "canvas2d";
    if (headquarters) {
      // The underground hearth stays lit for the windowless common room, but
      // its emissive flame breathes with the same flicker as the campfire.
      const hearth = headquarters.hearth;
      hearth.node.glow = LAMP_OFF + LAMP.fire.glow + Math.sin(elapsed * 11 + hearth.phase) * 0.15;
    }
    if (headquarters && camera.position.y < -1 && cameraCaveIndex && CAMERA_OPENINGS[cameraCaveIndex - 1].headquarters) {
      const underground = headquarters.sources;
      // The upper hearth cannot cast through the rock into the basement.
      const below = camera.position.y < island.headquarters.floor;
      const total = below ? 0 : Math.min(limit, underground.length);
      for (let i = 0; i < underground.length; i++) underground[i].selected = false;
      for (let i = 0; i < total; i++) {
        let nearest = null, distance = Infinity;
        for (let n = 0; n < underground.length; n++) {
          const l = underground[n];
          const d = (l.x - camera.position.x) ** 2 + (l.y - camera.position.y) ** 2 + (l.z - camera.position.z) ** 2;
          if (!l.selected && d < distance) { nearest = l; distance = d; }
        }
        const l = nearest, o = i * 8, sky = l.daylight ? 0.12 + RENDER_OPTS.day * 0.88 : 1;
        l.selected = true;
        lights[o] = l.x;
        lights[o + 1] = l.y;
        lights[o + 2] = l.z;
        lights[o + 3] = l.daylight ? 11 : 9;
        lights[o + 4] = (l.daylight ? 0.8 : 1) * sky;
        lights[o + 5] = (l.daylight ? 0.88 : 0.65) * sky;
        lights[o + 6] = (l.daylight ? 1 : 0.3) * sky;
        lights[o + 7] = 0;
        LIGHTING_DEBUG.selectedIds[i] = l.id;
      }
      for (let i = total; i < LIGHT_CAPACITY; i++) LIGHTING_DEBUG.selectedIds[i] = null;
      RENDER_OPTS.lightCount = LIGHTING_DEBUG.activeFullLightCount = LIGHTING_DEBUG.selectedCount = total;
    }
  };
  // A fire pit off the paths inside the bedroll ring, with seats around it
  const buildFire = () => {
    let p = null;
    for (const deg of FIRE_DEGREES) {
      const c = polar(deg, FIRE_RADIUS);
      if (island.surfaceAt(c.x, c.z) === 0 && free(c.x, c.z, 1.6) && !nearPath(c.x, c.z, 1.8)) {
        p = c;
        break;
      }
    }
    if (!p) throw new Error("No clear spot for the fire pit");
    const pit = place(hubModels.firepit(), p.x, p.z, 0, 0, "firepit", 1.2);
    const flame = createNode({ geometry: hubModels.fireFlame(), matrixEmissiveLiving: true });
    addChild(pit, flame);
    fireHazards.push({ node: flame, pit, x: p.x, y: pit.position.y, z: p.z, avoidRadius: FIRE_AVOID_RADIUS });
    addLamp(flame, LAMP.fire, p.x, 0.6, p.z, true, 3, "firepit").always = true;
    claim(p.x, p.z, 1.4);
    for (let i = 0; i < FIRE_SEATS; i++) {
      const a = (i + 0.5) / FIRE_SEATS * Math.PI * 2;
      const x = p.x + Math.cos(a) * FIRE_SEAT_RADIUS, z = p.z + Math.sin(a) * FIRE_SEAT_RADIUS;
      fireSeats.push({ x, z, ry: Math.atan2(p.x - x, p.z - z) });
    }
    return p;
  };
  // Build a mouth from its slot status, +z leading out
  const sealedCaveVariant = (id) => id === "c3" ? 1 : id === "c10" ? 2 : 0;
  const buildMouth = (slot, m) => {
    const ax = Math.sin(m.ry), az = Math.cos(m.ry);
    const caveIndex = island.mouths.indexOf(m) + 1;
    const group = createNode({ position: { x: m.x, y: m.floorY, z: m.z }, rotation: { x: 0, y: m.ry, z: 0 } });
    const rim = createNode({ position: { x: 0, y: 0, z: 0.5 }, geometry: hubModels.caveMouthRim(), sightSolid: true });
    addChild(group, rim);
    solids.add(rim);
    if (slot.status === "dark") {
      const geometry = hubModels.sealedCaveFace(sealedCaveVariant(slot.id));
      const seal = createNode({ position: { x: 0, y: 0, z: 0.52 }, geometry, matrixExterior: true, sightSolid: true });
      addChild(group, seal);
      solids.add(seal);
      sealedCaves.push({ caveIndex, mouth: m, node: seal, sr: ax, cr: az, stopZ: seal.position.z + geometry.frontZ + 0.01 });
      closedCaveZones.push({ active: true, x: m.x, z: m.z, floor: m.floorY, sr: ax, cr: az, half: PORTAL_MAX_X + 0.25, front: seal.position.z + geometry.frontZ + 0.26 });
    } else {
      const opening = rim.geometry.openingBounds;
      const geometry = { ...hubModels.matrixPrisonBars(), matrixCave: caveIndex, clipMinY: m.floorY + opening.floorY, clipMaxY: m.floorY + opening.ceilingY };
      const bars = createNode({ position: { x: 0, y: MATRIX_GATE_HIDDEN_Y, z: 0.78 }, geometry, visible: false, matrixExterior: true });
      addChild(group, bars);
      const bounds = BL.scene.boundsOf(geometry);
      matrixGates.push({ kind: "matrix-gate", caveIndex, mouth: m, node: bars, sr: ax, cr: az, open: false, localOpen: false, locked: false, raising: false, held: false, floor: opening.floorY, ceiling: opening.ceilingY, bottom: bounds.min[1], top: bounds.max[1], minX: bounds.min[0], maxX: bounds.max[0], minZ: bars.position.z + bounds.min[2], maxZ: bars.position.z + bounds.max[2], distance: matrixTravelDistance(m.x + ax * bars.position.z, m.z + az * bars.position.z) });
    }
    if (slot.status === "open" && slot.scene === "race") {
      // The rally garage: a kart up on a stone plinth, spare wheels, a crate and a barrel
      const kart = BL.raceModels.kart("#d98a2e");
      Object.assign(kart.node.position, { x: 0, y: 0.5, z: RALLY_KART_Z });
      kart.node.rotation.y = 0.5;
      const plinth = createNode({ position: { x: 0, y: 0, z: RALLY_KART_Z }, geometry: hubModels.altarSlab() });
      Object.assign(plinth.scale, { x: 1.4, y: 0.5, z: 1.4 });
      const wheels = createNode({ position: { x: -1.7, y: 0, z: -2.6 } });
      for (let i = 0; i < 3; i++) addChild(wheels, createNode({ position: { x: 0, y: 0.12 + i * 0.24, z: 0 }, rotation: { x: 0, y: 0, z: Math.PI / 2 }, geometry: BL.raceModels.kartWheel() }));
      const crate = createNode({ position: { x: 1.7, y: 0, z: -3 }, rotation: { x: 0, y: 0.3, z: 0 }, geometry: hubModels.woodCrate() });
      const barrel = createNode({ position: { x: 1.9, y: 0, z: -1.9 }, geometry: hubModels.barrel() });
      addChild(group, plinth, kart.node, wheels, crate, barrel);
      solids.add(plinth); solids.add(kart.node); solids.add(wheels); solids.add(crate); solids.add(barrel);
      // The Ooga Drop plane parks on the roof over the room, nose toward the meadow, a windsock beside it
      const roof = dropModels.roofSpot(island, m, {}, 0.8);
      const plane = dropModels.plane();
      Object.assign(plane.node.position, { x: 0, y: roof.y - m.floorY, z: dropModels.ROOF_BACK });
      Object.assign(plane.node.scale, { x: 0.8, y: 0.8, z: 0.8 });
      plane.node.rotation.x = dropModels.PARK_PITCH;
      plane.node.matrixExterior = true;
      const sockX = 3.2, sockZ = dropModels.ROOF_BACK + 0.6;
      const sock = createNode({ position: { x: sockX, y: roof.y - m.floorY, z: sockZ }, geometry: dropModels.windsock() });
      sock.matrixExterior = true;
      addChild(group, plane.node, sock);
      solids.add(plane.node);
      addProp("plane", plane.node.children[0], roof.x, roof.z, 2.6).roof = roof;
      addProp("windsock", sock, m.x + ax * sockZ + Math.cos(m.ry) * sockX, m.z + az * sockZ - Math.sin(m.ry) * sockX, 1);
      const signX = m.x + ax * dropModels.SIGN_AT.z + Math.cos(m.ry) * dropModels.SIGN_AT.x, signZ = m.z + az * dropModels.SIGN_AT.z - Math.sin(m.ry) * dropModels.SIGN_AT.x;
      const sign = createNode({ position: { x: dropModels.SIGN_AT.x, y: island.surfaceAt(signX, signZ) - m.floorY, z: dropModels.SIGN_AT.z }, geometry: dropModels.roofSign() });
      sign.matrixExterior = true;
      sign.matrixSignLiving = true;
      addChild(group, sign);
      addProp("sign", sign, signX, signZ, 1);
      claim(roof.x, roof.z, 3.8);
      launchers.push(roof);
    } else if (slot.status === "headquarters") {
      addChild(group, createNode({ position: { x: 0, y: 0, z: 0 }, geometry: headquartersModels.entranceRamp(), depthBias: 0.25 }));
    } else if (slot.status === "open") {
      for (const x of [-1.3, 1.3]) addChild(group, createNode({ position: { x, y: 0, z: -3.5 }, geometry: hubModels.caveShelves() }));
    } else if (slot.status === "mirror") {
      // Sit inside the rim so the cave floor ends behind the reflection.
      const node = createNode({ position: { x: 0, y: 1.5, z: 0.5 }, geometry: hubModels.mirrorPanel(), mirror: true, mirrorWalkThrough: true, mirrorReveal: 0 });
      addChild(group, node);
      mirrorCave = { slot, mouth: m, group, rim, node, sign: null };
      addTarget(node, { kind: "cave", slot, priority: 1 });
      const stand = createNode({ position: { x: 0, y: 0, z: -5.15 }, geometry: { ...hubModels.matrixButtonStand(), matrixCave: caveIndex }, matrixExterior: true });
      const button = createNode({ position: { x: 0, y: 1.12, z: 0 }, geometry: { ...hubModels.matrixButton(), matrixCave: caveIndex }, matrixExterior: true, matrixLiving: false, glow: 0.25 });
      addChild(stand, button);
      addChild(group, stand);
      matrixControl = {
        stand, button, x: m.x + ax * stand.position.z, z: m.z + az * stand.position.z,
        pressed: false, near: false, promptPressed: false, promptPlayer: null, promptAction: null, promptJet: false, promptRecovering: false
      };
      addTarget(button, { kind: "matrix-button", priority: 2 }, { radius: 0.55 });
    } else if (slot.status === "sleeping") {
      // Bedrolls lie along +x, as the sleep pose assumes
      addChild(group, createNode({ position: { x: 0, y: 0.05, z: -4.5 }, rotation: { x: 0, y: -m.ry, z: 0 }, geometry: hubModels.bedroll(), depthBias: 0.3 }));
      sleepers.push({ x: m.x + ax * 0.8, y: 4.4, z: m.z + az * 0.8, timer: sleepers.length * 0.7 });
    }
    if (slot.status === "open" || slot.status === "mirror") {
      const torchGeometry = hubModels.torch();
      const torchZ = rim.position.z + rim.geometry.frontZ - torchGeometry.backZ + CAVE_TORCH_GAP;
      for (let i = 0; i < 2; i++) {
        const side = i ? "right" : "left", localX = (i ? 1 : -1) * rim.geometry.jambCenterX;
        const torch = createNode({ position: { x: localX, y: 0, z: torchZ }, geometry: torchGeometry, flare: 0, matrixEmissiveLiving: true });
        addChild(group, torch);
        const tx = m.x + ax * torchZ + Math.cos(m.ry) * localX;
        const ty = m.floorY + torchGeometry.flameY;
        const tz = m.z + az * torchZ - Math.sin(m.ry) * localX;
        const id = `${slot.id}:torch:${side}`;
        const lamp = addLamp(torch, LAMP.torch, tx, ty, tz, true, i, id);
        const debug = { id, caveId: slot.id, kind: "torch", side, localPosition: [localX, torchGeometry.flameY, torchZ], worldPosition: [tx, ty, tz], registered: true, factor: 0, lit: false, selected: false, approximated: false, rimFront: rim.position.z + rim.geometry.frontZ, fixtureBack: torchZ + torchGeometry.backZ, gap: CAVE_TORCH_GAP };
        lamp.debug = debug;
        entranceLights.push(debug);
        claim(tx, tz, 0.5);
        addProp("torch", torch, tx, tz, 0.7);
      }
      const sign = createNode({ position: { x: 0, y: 4.5, z: 0.52 }, geometry: hubModels.caveSign(slot.name), matrixEmissiveLiving: true, sightHidden: slot.scene === "lab" });
      addChild(group, sign);
      const halfW = sign.geometry.signWidth * 0.5, halfH = sign.geometry.signHeight * 0.5;
      const x = m.x + ax * sign.position.z, y = m.floorY + sign.position.y, z = m.z + az * sign.position.z;
      const tx = Math.cos(m.ry), tz = -Math.sin(m.ry);
      labels.push({
        x, y, z, ax, az, text: slot.name, node: sign,
        world: [
          { x: x - tx * halfW, y: y + halfH, z: z - tz * halfW },
          { x: x + tx * halfW, y: y + halfH, z: z + tz * halfW },
          { x: x + tx * halfW, y: y - halfH, z: z + tz * halfW },
          { x: x - tx * halfW, y: y - halfH, z: z - tz * halfW }
        ]
      });
      if (mirrorCave && mirrorCave.slot === slot) mirrorCave.sign = sign;
      // A lantern hangs off the sign bracket and matches the entrance torches' dusk fade.
      const lantern = createNode({ position: { x: halfW + 0.1, y: sign.position.y + halfH + 0.14, z: 0.52 }, geometry: hubModels.lantern() });
      addChild(group, lantern);
      const lx = lantern.position.x, ly = lantern.position.y - 0.27, lz = lantern.position.z;
      const wx = m.x + Math.cos(m.ry) * lx + ax * lz;
      const wy = m.floorY + ly;
      const wz = m.z - Math.sin(m.ry) * lx + az * lz;
      const id = `${slot.id}:lantern:right`;
      const lamp = addLamp(lantern, LAMP.lantern, wx, wy, wz, true, 2, id);
      const debug = { id, caveId: slot.id, kind: "lantern", side: "right", localPosition: [lx, ly, lz], worldPosition: [wx, wy, wz], registered: true, factor: 0, lit: false, selected: false, approximated: false, rimFront: null, fixtureBack: null, gap: null };
      lamp.debug = debug;
      entranceLights.push(debug);
    }
    if (VINES.includes(slot.id)) for (const x of [-1.1, 1.1]) addChild(group, createNode({ position: { x, y: 3.45, z: 0.95 }, geometry: hubModels.vine() }));
    addChild(root, group);
    placed.push(group);
    const glyphs = buildCaveGlyphs(slot, m, group);
    if (slot.status === "mirror") {
      matrixCave = glyphs;
      MATRIX_WORLD.permanentCave = matrixCave.caveIndex;
      MATRIX_WORLD.permanentPlane[0] = ax;
      MATRIX_WORLD.permanentPlane[1] = 0;
      MATRIX_WORLD.permanentPlane[2] = az;
      MATRIX_WORLD.permanentPlane[3] = -(m.x * ax + m.z * az + mirrorCave.node.position.z);
      const opening = mirrorCave.rim.geometry.openingBounds, aperture = MATRIX_WORLD.permanentAperture;
      aperture[0] = opening.maxX;
      aperture[1] = opening.ceilingY;
      aperture[2] = mirrorCave.node.position.z - mirrorCave.rim.position.z - opening.minZ;
      aperture[3] = 0.5 * (Math.abs(ax) + Math.abs(az));
      matrixCave.portal = buildMatrixPortal(m);
      matrixCave.mirrorNode = mirrorCave.node;
      matrixCave.mirrorDistance = matrixEntranceMinimum(m, PORTAL_MIN_X, PORTAL_MAX_X);
      matrixCave.unlocked = false;
      const gate = matrixGates.find((candidate) => candidate.caveIndex === matrixCave.caveIndex);
      mirrorCave.gate = gate;
      const gateShift = MIRROR_GATE_Z - gate.node.position.z;
      gate.node.position.z = MIRROR_GATE_Z;
      gate.minZ += gateShift;
      gate.maxZ += gateShift;
      gate.distance = matrixCave.mirrorDistance + MATRIX_MIRROR_HEIGHT;
      gate.locked = MIRROR_GATE_CLOSED;
      if (gate.locked) {
        gate.node.position.y = gate.floor;
        gate.node.visible = true;
        closedCaveZones.push({ active: true, x: m.x, z: m.z, floor: m.floorY, sr: ax, cr: az, half: PORTAL_MAX_X + 0.25, front: PORTAL_Z + 0.25 });
      }
    }
    return rim;
  };
  const buildHeadquarters = () => {
    const floor = island.headquarters.floor, basement = island.headquarters.basement;
    const room = createNode({ position: { x: 0, y: floor, z: 0 }, geometry: headquartersModels.room() });
    addChild(root, room);
    placed.push(room);
    solids.add(room);
    const benches = [];
    for (const x of [-2.6, 2.6]) for (const z of [-0.55, 0.55]) benches.push({ kind: "bench", x, y: floor + 0.58, z, floor, ry: Math.atan2(-x, -z), sitter: null, walkAt: { x: x - Math.sign(x) * 0.85, z } });
    const entrances = [], lights = [], mattresses = [], roomSigns = [];
    FLY.yMin = basement.floor - 1;
    const addEntrance = (node, roomIndex, lower, ramp = false) => {
      node.sightSolid = true;
      addChild(root, node);
      placed.push(node);
      solids.add(node, true);
      const bounds = BL.scene.boundsOf(node.geometry);
      entrances.push({ roomIndex, node, basement: lower, ramp, sr: Math.sin(node.rotation.y), cr: Math.cos(node.rotation.y), radius: Math.hypot(Math.max(Math.abs(bounds.min[0]), Math.abs(bounds.max[0])) * node.scale.x, Math.max(Math.abs(bounds.min[2]), Math.abs(bounds.max[2]))), minY: node.position.y + bounds.min[1], maxY: node.position.y + bounds.max[1] });
    };
    const torchAt = (x, y, z) => {
      const node = createNode({ position: { x, y, z }, geometry: hubModels.torch(), glow: 0.85, matrixEmissiveLiving: true });
      addChild(root, node);
      placed.push(node);
      lights.push({ id: `headquarters:${lights.length}`, node, x, y: y + 1.6, z });
    };
    for (const level of [island.headquarters, basement]) for (const cave of level.rooms) {
      const i = cave.index, angle = cave.angle;
      const entrance = createNode({ position: { x: cave.entrance.x, y: cave.floor, z: cave.entrance.z }, rotation: { x: 0, y: -angle, z: 0 }, scale: { x: (cave.corridorWidth ?? cave.width - 1.3) / 3.86, y: 1, z: 1 }, geometry: headquartersModels.roomEntrance(i) });
      addEntrance(entrance, i, level === basement);
      const dimensions = headquartersModels.MATTRESS, across = -(cave.width / 2 - dimensions.wallInset - dimensions.width / 2), along = cave.depth / 2 - dimensions.wallInset - dimensions.depth / 2;
      const sx = Math.sin(angle), cx = Math.cos(angle), geometry = headquartersModels.mattress(cave);
      const sign = createNode({ position: { x: cave.entrance.x - sx * 0.28, y: cave.floor + 3.78, z: cave.entrance.z + cx * 0.28 }, rotation: { x: 0, y: -angle, z: 0 }, geometry: headquartersModels.roomSign(cave), matrixSignLiving: true });
      addChild(root, sign);
      placed.push(sign);
      const hanging = { roomIndex: i, basement: level === basement, room: cave, node: sign, sr: -sx, cr: cx, velocity: 0, hits: 0, contacts: 0 };
      roomSigns.push(hanging);
      addTarget(sign, { kind: "room-sign", roomSign: hanging });
      const node = createNode({ position: { x: cave.x + cx * across + sx * along, y: cave.floor, z: cave.z + sx * across - cx * along }, rotation: { x: 0, y: -angle, z: 0 }, geometry });
      addChild(root, node);
      placed.push(node);
      const side = dimensions.width / 2 + 0.5;
      mattresses.push({ roomIndex: i, basement: level === basement, corner: "rear-left", room: cave, node, ...geometry.mattress,
        x: node.position.x, y: cave.floor, z: node.position.z, sr: -sx, cr: cx, sleeper: null, sleep: dimensions,
        window: island.headquarters.windows.find((window) => window.kind === "room" && window.roomIndex === i && window.basement === (level === basement)), sightFrame: -1, sightVisible: false,
        collisionBoxes: new Float64Array([-dimensions.width / 2, 0, -dimensions.depth / 2, dimensions.width / 2, dimensions.surface, dimensions.depth / 2,
          -0.45, dimensions.surface, dimensions.pillowZ - 0.25, 0.45, dimensions.pillowTop, dimensions.pillowZ + 0.25]),
        walkAt: { x: node.position.x + cx * side, y: cave.floor, z: node.position.z + sx * side }
      });
    }
    for (const ramp of basement.ramps) {
      const p = ramp.entrance;
      // The model's inner opening, including the voxel edge, clears the tunnel.
      const entrance = createNode({ position: { x: p.x, y: p.y, z: p.z }, rotation: { x: 0, y: -ramp.angle, z: 0 }, scale: { x: (ramp.width + island.unit * Math.SQRT2) / 3.86, y: 1, z: 1 }, geometry: headquartersModels.rampEntrance(ramp.index) });
      addEntrance(entrance, ramp.index, false, true);
    }
    for (const ramp of island.headquarters.ramps) {
      const p = ramp.samples[30], angle = Math.atan2(p.x, -p.z), radius = Math.hypot(p.x, p.z) - 1.6;
      torchAt(Math.sin(angle) * radius, p.y + 0.6, -Math.cos(angle) * radius);
    }
    const firepit = createNode({ position: { x: 0, y: floor, z: 0 }, geometry: hubModels.firepit() });
    solids.add(firepit);
    const flame = createNode({ geometry: hubModels.fireFlame(), glow: 0.9, matrixEmissiveLiving: true });
    addChild(firepit, flame);
    fireHazards.push({ node: flame, pit: firepit, x: 0, y: floor, z: 0, avoidRadius: FIRE_AVOID_RADIUS });
    addChild(root, firepit);
    placed.push(firepit);
    const hearth = { id: "headquarters:hearth", node: flame, x: 0, y: floor + 0.6, z: 0, phase: 23 };
    lights.push(hearth);
    // The hearth is the only shared HQ point light. Windows remain physical
    // openings and ramp torches remain emissive landmarks, but neither creates
    // camera-proximity lighting that spills into an unclaimed room.
    const sources = [hearth];
    return { node: room, entrances, mattresses, roomSigns, benches, fireHazards, lights, sources, hearth, firepit, rooms: island.headquarters.rooms, windows: island.headquarters.windows, ramps: island.headquarters.ramps, openFloor: island.headquarters.room, basement, sleepMarksVisible };
  };
  // Ooga Orbit's islet off the south rim: the rope bridge out to it, the pad with the last rocket flown standing on
  // it, the tower and the sign; all of it is solid, so an Ooga walks over the bridge and onto the pad
  const buildLaunchSite = () => {
    const { SITE } = rocketModels;
    const spot = rocketModels.siteSpot(island, {});
    const site = rocketModels.site(spot);
    addChild(root, site.node);
    placed.push(site.node);
    solids.add(site.islet);
    addProp("launchpad", site.pad, spot.x, spot.z, SITE.padR);
    addProp("tower", site.tower, spot.x + SITE.towerX, spot.z, 1.4);
    addProp("bridge", site.bridge, spot.x, spot.bridgeZ + SITE.span / 2, SITE.width);
    addProp("orbitsign", site.sign, spot.x + site.sign.position.x, spot.z + site.sign.position.z, 1);
    const saved = game.state.orbit.build;
    const rocket = rocketModels.assemble(saved && rocketParts.check(saved).ok ? saved : rocketParts.PRESETS[0].stack);
    Object.assign(rocket.node.position, { x: spot.x, y: spot.padY, z: spot.z });
    addChild(root, rocket.node);
    placed.push(rocket.node);
    for (const part of rocket.parts) addProp("rocket", part.node, spot.x, spot.z, part.part.r + 0.3);
    claim(spot.x, spot.z, SITE.isletR + 1);
    // Keep the walk from the meadow to the bridge head clear of scenery
    for (let z = spot.bridgeZ; z > spot.bridgeZ - 7; z -= 1.5) claim(spot.x, z, 2.4);
    launchers.push({ x: spot.x, y: spot.padY, z: spot.z, scene: "orbit" });
    presets.orbit = { yaw: -0.64, pitch: 0.3, dist: 22 + rocket.height, target: { x: spot.x, y: spot.padY + rocket.height * 0.45, z: spot.z } };
  };
  // An invisible one-way staircase continues from the dock into the sky. It
  // only arms from a grounded step off the outer deck: arriving from the air,
  // or jumping once on it, leaves every tread intangible until the visitor
  // returns to the dock. The small fixed glyph pool reveals only fresh foot
  // contacts, without adding collision meshes or per-frame allocations.
  const buildDockStairs = (dock) => {
    const START = 4.25, RUN = 0.62, RISE = 0.5, HALF_WIDTH = 0.78, EFFECT_TIME = 0.62;
    const base = dock.position.y, count = Math.ceil((FLY.yMax - base) / RISE), end = START + count * RUN;
    const ry = dock.rotation.y, ux = Math.cos(ry), uz = -Math.sin(ry), vx = Math.sin(ry), vz = Math.cos(ry);
    const glyphs = [];
    for (let i = 0; i < MATRIX_TYPES; i++) {
      const node = createNode({ visible: false, rotation: { x: -Math.PI / 2, y: ry, z: 0 }, geometry: hubModels.matrixGlyph(i), glow: 1 });
      node.dockLife = 0;
      addChild(root, node);
      placed.push(node);
      glyphs.push(node);
    }
    let active = false, owner = null, lastStep = 0, nextGlyph = 0, contacts = 0, jumpRejects = 0;
    const alongAt = (x, z) => (x - dock.position.x) * ux + (z - dock.position.z) * uz;
    const acrossAt = (x, z) => (x - dock.position.x) * vx + (z - dock.position.z) * vz;
    const indexAt = (along, across, radius = PLAYER_RADIUS) => {
      if (Math.abs(across) > HALF_WIDTH + radius || along < START - radius || along > end + radius) return 0;
      return Math.min(count, Math.max(1, Math.floor((along + radius - START) / RUN) + 1));
    };
    const floorAt = (index) => Math.min(FLY.yMax, base + index * RISE);
    const groundedOnDock = (actor) => {
      if (!actor || actor !== pilot?.player || actor.hop !== 0 || actor.hopV > 0 || actor.jet?.thrust) return false;
      const p = actor.root.position, feet = p.y - actor.baseY, along = alongAt(p.x, p.z), across = acrossAt(p.x, p.z);
      return along >= 3 - PLAYER_RADIUS && along <= START + 0.1 && Math.abs(across) <= 1 + PLAYER_RADIUS && Math.abs(feet - base) < 0.08;
    };
    const reset = (jumped = false) => {
      if (jumped && active) jumpRejects++;
      active = false; owner = null; lastStep = 0;
    };
    const supportAt = (x, z, y, maxStep, actor, entering) => {
      if (actor !== pilot?.player) return -Infinity;
      if (active && (actor !== owner || actor.hop > 1e-7 || actor.hopV > 0 || actor.jet?.thrust)) reset(true);
      const along = alongAt(x, z), across = acrossAt(x, z), index = indexAt(along, across);
      if (!active) {
        // Only a real walking destination may arm the first tread. Camera,
        // spawn and ordinary ground probes pass entering=false.
        if (!entering || index !== 1 || !groundedOnDock(actor)) return -Infinity;
        active = true; owner = actor; lastStep = 0;
      }
      if (!index) return -Infinity;
      const floor = floorAt(index);
      return floor <= y + maxStep + 1e-7 ? floor : -Infinity;
    };
    const emit = (actor, index) => {
      const node = glyphs[nextGlyph];
      nextGlyph = (nextGlyph + 1) % glyphs.length;
      const p = actor.root.position, across = acrossAt(p.x, p.z), along = START + (index - 0.5) * RUN;
      node.position.x = dock.position.x + ux * along + vx * across;
      node.position.y = floorAt(index) + 0.018;
      node.position.z = dock.position.z + uz * along + vz * across;
      node.scale.x = node.scale.y = 2.8;
      node.scale.z = 1;
      node.glow = 1;
      node.dockLife = EFFECT_TIME;
      node.visible = true;
      contacts++;
    };
    const update = (dt, actor) => {
      for (let i = 0; i < glyphs.length; i++) {
        const node = glyphs[i];
        if (node.dockLife <= 0) continue;
        node.dockLife = Math.max(0, node.dockLife - dt);
        const k = node.dockLife / EFFECT_TIME;
        node.scale.x = node.scale.y = 1.8 + k;
        node.glow = 0.35 + k * 0.65;
        if (!node.dockLife) node.visible = false;
      }
      if (!active || actor !== owner) return;
      if (actor.hop > 1e-7 || actor.hopV > 0 || actor.jet?.thrust) { reset(true); return; }
      const p = actor.root.position, along = alongAt(p.x, p.z), across = acrossAt(p.x, p.z), index = indexAt(along, across);
      if (!index) {
        if (along <= START && Math.abs(across) <= 1 + PLAYER_RADIUS) reset(false);
        return;
      }
      const feet = p.y - actor.baseY;
      if (Math.abs(feet - floorAt(index)) < 0.08 && index !== lastStep) {
        lastStep = index;
        emit(actor, index);
      }
    };
    return {
      supportAt, update, reset, alongAt, acrossAt, indexAt, floorAt,
      base, start: START, run: RUN, rise: RISE, halfWidth: HALF_WIDTH, count, end, top: FLY.yMax, glyphs,
      get active() { return active; }, get lastStep() { return lastStep; }, get contacts() { return contacts; }, get jumpRejects() { return jumpRejects; }
    };
  };
  // Dock over the drop and ladder on the bluff
  const buildRim = () => {
    const d = polar(DOCK_DEG, CLIFF_OUTER);
    const dock = place(hubModels.dock(), d.x, d.z, Math.PI / 2 - DOCK_DEG * DEG, island.surfaceAt(d.x, d.z), "dock", 2.2);
    dockStairs = buildDockStairs(dock);
    headquarters.dockStairs = dockStairs;
    claim(d.x, d.z, 2.5);
    let faceX = MEADOW - 1;
    while (island.surfaceAt(faceX + island.unit / 2, LADDER_Z) < 3) faceX += island.unit;
    const foot = faceX - LADDER_LEAN - 0.06;
    const lean = createNode({ position: { x: foot, y: 0, z: LADDER_Z }, rotation: { x: 0, y: 0, z: -Math.asin(LADDER_LEAN / 4) } });
    const rungs = createNode({ rotation: { x: 0, y: Math.PI / 2, z: 0 }, geometry: hubModels.ladder() });
    addChild(lean, rungs);
    addChild(root, lean);
    placed.push(lean);
    claim(foot, LADDER_Z, 1);
    addProp("ladder", rungs, foot, LADDER_Z, 1.2).lean = lean;
    spots.push({ x: foot - 1.1, z: LADDER_Z, ry: Math.PI / 2 });
  };
  // Scatter props by rejection, keeping off paths and mouths
  const scatter = () => {
    const rand = mulberry32(SEED);
    const treeGroundClear = (geometry, x, z, y) => {
      // Scan every voxel column touched by the solid crown and a walking body's
      // radius. Four corner samples miss narrow, higher steps on cave roofs.
      const reach = geometry.treeSolidRadius + PLAYER_RADIUS, unit = island.unit, half = unit / 2;
      // Two units fit the tallest Ooga's full head-look envelope with room to spare.
      const rootRadius = Math.hypot(0.5, 0.25), ceiling = y + geometry.treeSolidCanopyFloor - 2;
      const grid = island.sightGrid, minX = Math.floor((x - reach - grid[1]) / unit), maxX = Math.floor((x + reach - grid[1]) / unit);
      const minZ = Math.floor((z - reach - grid[3]) / unit), maxZ = Math.floor((z + reach - grid[3]) / unit);
      for (let gx = minX; gx <= maxX; gx++) for (let gz = minZ; gz <= maxZ; gz++) {
        const px = grid[1] + (gx + 0.5) * unit, pz = grid[3] + (gz + 0.5) * unit;
        const distance = Math.hypot(Math.max(0, Math.abs(px - x) - half), Math.max(0, Math.abs(pz - z) - half));
        if (distance > reach) continue;
        const floor = island.surfaceAt(px, pz);
        if (floor > ceiling || distance < rootRadius && floor > y) return false;
      }
      return true;
    };
    const candidateFree = (x, z, radius) => {
      for (let i = 0; i < sceneryClaims.length; i++) {
        const c = sceneryClaims[i];
        if (Math.hypot(c.x - x, c.z - z) < c.r + radius) return false;
      }
      return true;
    };
    // Grass is dressing: it reflows with the rest but answers no tap or Space
    const addScenery = (geometry, x, z, ry, y, kind, footprint) => {
      const reservation = claim(x, z, footprint);
      sceneryClaims.push(reservation);
      const quiet = kind === "grass";
      const pickRadius = kind === "tree" ? BL.scene.boundsOf(geometry).radius : footprint + 0.3;
      const node = place(geometry, x, z, ry, y, quiet ? null : kind, pickRadius);
      if (quiet || kind === "flower" || kind === "bush") node.sightHidden = true;
      if (MATRIX_LIVING_PROPS.has(kind)) node.matrixLiving = true;
      const owner = quiet ? { kind: "prop", prop: kind, node, x, z, ripe: 0, pickRadius: 0, active: true } : props[props.length - 1];
      owner.footprint = footprint;
      owner.scenery = true;
      owner.reservation = reservation;
      reservation.scenery = owner;
      scenery.push(owner);
      return node;
    };
    const meadow = (count, radius, kind, geometryAt, square = false) => {
      for (let n = 0, tries = 0; n < count && tries < 1500; tries++) {
        const { x, z } = polar(rand() * 360, Math.sqrt(lerp(MEADOW_INNER * MEADOW_INNER, MEADOW_OUTER * MEADOW_OUTER, rand())));
        if (island.surfaceAt(x, z) > 0 || nearMouth(x, z, 3.5) || !candidateFree(x, z, radius)) continue;
        addScenery(geometryAt(n), x, z, square ? Math.floor(rand() * 4) * Math.PI / 2 + (rand() - 0.5) * 0.4 : rand() * Math.PI * 2, 0, kind, radius);
        n++;
      }
    };
    const cliff = (count, radius, minHeight, kind, geometryAt) => {
      // Safe root ledges are rarer than decorative bush sites. Keep the
      // seeded search bounded while retaining the full grove on the cliffs.
      for (let n = 0, tries = 0; n < count && tries < (kind === "tree" ? 24000 : 1200); tries++) {
        const { x, z } = polar(rand() * 360, lerp(CLIFF_INNER, CLIFF_OUTER, rand()));
        const h = island.surfaceAt(x, z);
        if (h < minHeight || !free(x, z, radius)) continue;
        let clear = true;
        for (let i = 0; i < 4 && clear; i++) {
          const a = (i + 0.5) * Math.PI / 2;
          if (island.surfaceAt(x + Math.cos(a) * 1.2, z + Math.sin(a) * 1.2) > h + 1.5) clear = false;
        }
        if (!clear || nearMouth(x, z, 4) || !candidateFree(x, z, radius)) continue;
        let geometry = geometryAt(n);
        if (kind === "tree" && !treeGroundClear(geometry, x, z, h)) {
          // A narrower crown can fit a ledge that cannot clear the next variant.
          // Try each cached shape once rather than exhaust the search on that tree.
          let fits = false;
          for (let variant = 0; variant < 4 && !fits; variant++) {
            const alternate = hubModels.tree(variant);
            if (alternate === geometry) continue;
            if (treeGroundClear(alternate, x, z, h)) { geometry = alternate; fits = true; }
          }
          if (!fits) continue;
        }
        addScenery(geometry, x, z, rand() * Math.PI * 2, h, kind, radius);
        n++;
      }
    };
    cliff(40, 1.4, 3, "tree", (n) => hubModels.tree(n % 4 === 3 ? 3 : n % 3));
    cliff(60, 1, 0.5, "bush", (n) => hubModels.bush(n % 3));
    meadow(60, 0.7, "bush", (n) => hubModels.bush(n % 3));
    meadow(8, 0.9, "rock", () => hubModels.rock(0));
    meadow(10, 0.7, "crate", () => hubModels.woodCrate(), true);
    meadow(8, 0.6, "barrel", () => hubModels.barrel());
    meadow(50, 0.35, "flower", () => hubModels.flowerTuft());
    meadow(150, 0.3, "grass", () => hubModels.grass());
  };
  const sceneryReason = (o) => {
    const clearance = island.path.debug.ringOuterRadius + SCENERY_CLEARANCE;
    if (Math.hypot(o.x, o.z) - o.footprint < clearance - 1e-9) return 1;
    if (island.path.overlaps(o.x, o.z, o.footprint)) return 2;
    for (let i = 0; i < claimed.length; i++) {
      const c = claimed[i];
      if (!c.scenery && Math.hypot(c.x - o.x, c.z - o.z) < c.r + o.footprint) return 3;
    }
    return 0;
  };
  const setSceneryActive = (o, active) => {
    if (o.active === active) return;
    o.active = active;
    o.node.visible = active;
    if (!o.pickRadius) return;
    if (active) input.add(o.node, o, { radius: o.pickRadius });
    else input.remove(o.node);
  };
  const reflowScenery = () => {
    if (!scenery.length) return;
    let visible = 0, radiusCulled = 0, pathCulled = 0, fixedCulled = 0;
    for (let i = 0; i < scenery.length; i++) {
      const o = scenery[i], reason = sceneryReason(o);
      setSceneryActive(o, reason === 0 && !o.breakable?.broken);
      if (!reason) { if (o.active) visible++; }
      else if (reason === 1) radiusCulled++;
      else if (reason === 2) pathCulled++;
      else fixedCulled++;
    }
    sceneryVisible = visible;
    sceneryRadiusCulled = radiusCulled;
    sceneryPathCulled = pathCulled;
    sceneryFixedCulled = fixedCulled;
    sceneryReflows++;
    if (magazine && !magazine.revealed && !magazine.host.active) attachMagazineHost();
  };
  const deactivateBreakable = (owner) => {
    if (owner.active) sceneryVisible--;
    setSceneryActive(owner, false);
    owner.node.highlight = 0;
    solids.sync();
  };
  const relocateBreakable = (owner) => {
    const radius = owner.footprint + SCENERY_CLEARANCE;
    const inner = Math.max(MEADOW_INNER, island.path.debug.ringOuterRadius + radius);
    if (inner >= MEADOW_OUTER) return false;
    const bounds = BL.scene.boundsOf(owner.node.geometry), height = bounds.max[1] - bounds.min[1];
    for (let attempt = 0; attempt < 80; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(lerp(inner * inner, MEADOW_OUTER * MEADOW_OUTER, Math.random()));
      const x = Math.sin(angle) * distance, z = Math.cos(angle) * distance;
      if (island.surfaceAt(x, z) !== 0 || island.path.overlaps(x, z, radius) || nearMouth(x, z, radius + 3.5)) continue;
      let clear = true;
      for (let i = 0; i < 8 && clear; i++) {
        const a = i * Math.PI / 4;
        if (island.surfaceAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius) !== 0) clear = false;
      }
      // Keep dormant scenery's reservation too: a shrinking pile may reveal it.
      for (let i = 0; i < claimed.length && clear; i++) {
        const c = claimed[i];
        if (c !== owner.reservation && Math.hypot(c.x - x, c.z - z) < c.r + radius) clear = false;
      }
      if (!clear || !solids.clearAt(x, 0.01, z, radius, height, owner.node)) continue;
      for (let i = 0; i < crew.list.length; i++) {
        const cave = crew.list[i];
        const p = cave.root.position, feet = p.y - cave.baseY;
        if (feet < height && feet + cave.bodyHeight > 0 && Math.hypot(p.x - x, p.z - z) < radius + cave.bodyRadius) { clear = false; break; }
      }
      for (let i = 0; i < crates.list.length && clear; i++) {
        const c = crates.list[i], p = c.slot || c.node.position;
        if (Math.hypot(p.x - x, p.z - z) < radius + 0.9) clear = false;
      }
      for (let i = 0; i < breakables.list.length && clear; i++) {
        const other = breakables.list[i];
        if (other.reward && Math.hypot(other.node.position.x - x, other.node.position.z - z) < radius + 0.6) clear = false;
      }
      if (jetpack && jetpack.node.position.y < height + 0.5 && Math.hypot(jetpack.x - x, jetpack.z - z) < radius + 0.6) clear = false;
      if (magazine && Math.hypot(magazine.node.position.x - x, magazine.node.position.z - z) < radius + 0.4) clear = false;
      if (!clear) continue;
      owner.x = owner.node.position.x = owner.reservation.x = x;
      owner.z = owner.node.position.z = owner.reservation.z = z;
      owner.node.position.y = 0;
      owner.node.rotation.y = Math.random() * Math.PI * 2;
      setSceneryActive(owner, true);
      sceneryVisible++;
      solids.sync();
      return true;
    }
    return false;
  };
  const collectBreakableReward = (kind, amount, cave) => {
    if (kind === "banana") {
      const added = crew.collectAmmo(amount, cave);
      if (added) hud.toast(`+${added} ammo`);
      pilot.showAct();
      return true;
    }
    if (kind === "magazine") {
      if (!crew.collectMagazine(cave)) return false;
      pilot.showAct();
      hud.toast("Full magazine collected · 30 rounds");
      return true;
    }
    syncJetpackFuel();
    if (jetpackState.owned && jetpackState.owner === cave.traits.name) {
      if (jetpackState.fuel >= 1) return false;
      jetpackState.fuel = 1;
      cave.jetFuel = 1;
      hud.toast("Jetpack refueled");
    } else if (jetpackState.owned) {
      return false;
    } else {
      grantJetpack(cave);
      hud.toast("Jetpack collected!");
    }
    pilot.showAct();
    return true;
  };
  const syncMirrorDamage = (quiet = false) => {
    const damage = mirrorCave.damage;
    if (mirrorCave.damageVersion === damage.version) return;
    const wasDamaged = mirrorCave.damageStage > 0;
    mirrorCave.damageStage = damage.stage;
    mirrorCave.damageVersion = damage.version;
    if (damage.broken && !mirrorCave.shattered) {
      mirrorCave.shattered = world.mirrorBroken = true;
      const gate = mirrorCave.gate;
      gate.locked = false;
      gate.localOpen = gate.open = gate.raising = false;
      mirrorCave.node.mirrorReveal = 1;
      mirrorCave.node.mirrorPortal = true;
      input.remove(mirrorCave.node);
      drop(targets, mirrorCave.node);
      addTarget(gate.node, { kind: "matrix-gate", gate, priority: 2, weaponType: "none" });
      if (!quiet) hud.toast("The mirror shatters. Move close to open the gate.");
    } else if (!quiet && !wasDamaged && damage.stage > 0) hud.toast("The mirror cracks. Glyphs glow behind the glass.");
    refreshObjectGuides();
  };
  const weaponImpact = (source, hit, dx, dy, dz, power = 1) => {
    if (hit.owner.kind === "caveman") {
      crew.damage(hit.owner.cave, power);
      return;
    }
    if (hit.node === mirrorCave.node) {
      if (mirrorCave.damage.hit(power, hit.x, hit.y, hit.z)) syncMirrorDamage();
      return;
    }
    if (breakables && breakables.hit(source, hit, power)) return;
    hitRoomSign(source, hit, dx, dy, dz);
  };
  const drop = (list, value) => {
    const i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1);
  };
  const jetpackHudStatus = (cave) => {
    JETPACK_HUD_STATE.owned = !!(cave && jetpackState && jetpackState.owned && jetpackState.owner === cave.traits.name);
    JETPACK_HUD_STATE.equipped = !!(cave && cave.jet);
    JETPACK_HUD_STATE.fuel = JETPACK_HUD_STATE.owned ? cave.jetFuel : 1;
    JETPACK_HUD_STATE.blocked = JETPACK_HUD_STATE.owned && (cave ? !jetpackAllowed(cave) : cameraCaveIndex !== 0);
    return JETPACK_HUD_STATE;
  };
  const syncJetpackFuel = () => {
    if (jetpackState && jetpackState.owned && jetpackCarrier) jetpackState.fuel = jetpackCarrier.jetFuel;
  };
  const equipJetpack = (cave) => {
    if (!jetpackState.owned || jetpackState.owner !== cave.traits.name) return false;
    if (jetpackWearer && jetpackWearer !== cave) crew.removeJetpack(jetpackWearer);
    if (!crew.wearJetpack(cave, hubModels.jetpack(), hubModels.jetFlame())) return false;
    jetpackWearer = cave;
    pilot.showAct();
    const p = cave.root.position;
    fx.burst(p.x, p.y + 0.7, p.z, 14, [SPARK, DUST], 2.2);
    fx.say(cave, "OOGA FLY!", 2);
    hud.toast("Jetpack!");
    hud.hint(cave.jetRecovering ? "Fuel recovering · jump until the gauge is above 20%" : COARSE ? "Hold Blast off to climb · stick to fly" : "Hold Space to climb · WASD to fly", 5000);
    return true;
  };
  const removeJetpackPickup = () => {
    if (!jetpack) return;
    const { node, owner } = jetpack;
    untrackMirrorObject(node);
    input.remove(node);
    removeChild(root, node);
    drop(targets, node);
    drop(placed, node);
    drop(props, owner);
    jetpack = null;
    refreshObjectGuides();
  };
  const collectJetpack = (cave) => {
    if (!jetpack || jetpack.falling) return false;
    removeJetpackPickup();
    jetpackState.owned = true;
    jetpackState.owner = cave.traits.name;
    jetpackState.fuel = cave.jetFuel = 1;
    jetpackCarrier = cave;
    crew.setJetpackOwnership(cave, true, hubModels.jetpack(), hubModels.jetFlame());
    pilot.showAct();
    fx.burst(cave.root.position.x, cave.root.position.y + 0.7, cave.root.position.z, 14, [SPARK, DUST], 2.2);
    fx.say(cave, "OOGA PACK!", 2);
    hud.toast("Jetpack collected!");
    hud.hint(COARSE ? "Tap the jetpack icon to put it on." : "Click the jetpack icon or press J to put it on.", 5000);
    return true;
  };
  const grantJetpack = (cave, wear = false) => {
    removeJetpackPickup();
    if (jetpackCarrier && jetpackCarrier !== cave) crew.setJetpackOwnership(jetpackCarrier, false);
    jetpackState.owned = true;
    jetpackState.owner = cave.traits.name;
    jetpackState.fuel = cave.jetFuel = 1;
    jetpackCarrier = cave;
    crew.setJetpackOwnership(cave, true, hubModels.jetpack(), hubModels.jetFlame());
    pilot.showAct();
    return !wear || equipJetpack(cave);
  };
  const toggleJetpack = () => {
    const cave = crew.player;
    if (!cave) {
      hud.toast("Double-tap an Ooga Booga first");
      return false;
    }
    if (!jetpackState.owned || jetpackState.owner !== cave.traits.name) {
      hud.toast("This Ooga Booga does not have a jetpack");
      return false;
    }
    if (cave.jet) {
      syncJetpackFuel();
      crew.removeJetpack(cave);
      jetpackWearer = null;
      pilot.showAct();
      hud.toast("Jetpack off");
      return true;
    }
    if (!jetpackAllowed(cave)) {
      hud.toast("No jetpacks under ground");
      return false;
    }
    return equipJetpack(cave);
  };
  const loseJetpack = (cave) => {
    if (!jetpackState.owned || !cave || jetpackState.owner !== cave.traits.name) return;
    if (cave && cave.jet) crew.removeJetpack(cave);
    crew.setJetpackOwnership(cave, false);
    jetpackWearer = jetpackCarrier = null;
    jetpackState.owned = false;
    jetpackState.owner = null;
    jetpackState.fuel = 1;
    if (cave) cave.jetFuel = 1;
    spawnJetpackPickup(lastJetpackCloud);
    pilot.showAct();
    hud.toast("Jetpack lost to the abyss");
  };
  const attachMagazineHost = () => {
    let host = null, best = Infinity;
    for (const o of scenery) {
      if (!o.active || o.prop !== "bush" && o.prop !== "tree") continue;
      // Meadow bushes can be walked through. Keep the hidden spare reachable
      // without needing the other pickup, even when the pile resizes scenery.
      const score = (o.prop === "bush" ? 0 : 1000000) + Math.abs(o.node.position.y) * 100 + fnv1a(`${o.x}/${o.z}/magazine`) / 4294967296;
      if (score < best) { host = o; best = score; }
    }
    if (!host) throw new Error("No scenery can hide the spare magazine");
    magazine.host = host;
    const p = magazine.node.position, bounds = BL.scene.boundsOf(host.node.geometry);
    p.x = host.x; p.z = host.z;
    p.y = magazine.y = host.node.position.y + bounds.max[1] * host.node.scale.y + 0.4;
  };
  const spawnMagazinePickup = () => {
    if (magazine) return;
    const visual = models.spareMagazine(), node = visual.node;
    node.visible = false;
    node.scale.x = node.scale.y = node.scale.z = MAGAZINE_SCALE;
    addChild(root, node); placed.push(node);
    magazine = { node, model: visual, host: null, owner: null, revealed: false, y: 0, ammo: 30 };
    attachMagazineHost();
    trackMirrorObject(node, 1);
  };
  const revealMagazine = (host = magazine && magazine.host) => {
    if (!magazine || magazine.revealed || host !== magazine.host || !host.active) return false;
    const node = magazine.node;
    magazine.revealed = node.visible = true;
    magazine.owner = addProp("magazine", node, node.position.x, node.position.z, 0.2);
    refreshObjectGuides();
    hud.toast("A full spare magazine!");
    hud.hint(pilot.player ? "Walk into the magazine to collect it." : "Double-tap an Ooga, then walk into the magazine.", 5000);
    return true;
  };
  const removeMagazinePickup = () => {
    if (!magazine) return;
    const { node, owner } = magazine;
    untrackMirrorObject(node);
    if (owner) { input.remove(node); drop(targets, node); drop(props, owner); }
    removeChild(root, node); drop(placed, node);
    magazine = null;
    refreshObjectGuides();
  };
  const grantMagazine = (cave = pilot.player) => {
    // Debug grants still create a full spare after the hidden pickup is gone.
    if (!magazine) return crew.collectMagazine(cave);
    const available = magazine.ammo;
    const remaining = crew.collectGroundMagazine(available, cave);
    if (remaining === available) return false;
    const added = available - remaining;
    if (remaining) {
      magazine.ammo = remaining;
      magazine.model.setAmmo(remaining);
    } else removeMagazinePickup();
    pilot.showAct();
    return added;
  };
  const loseMagazine = (cave = pilot.player) => {
    if (!crew.hasMagazine(cave)) return;
    crew.removeMagazines(cave);
    spawnMagazinePickup();
    pilot.showAct();
    hud.toast("Spare magazines lost to the abyss");
  };
  // Spots the crew strolls to
  const buildSpots = () => {
    spots.push({ x: 0, z: -(MEADOW + 2.5), ry: Math.PI });
    for (const m of island.mouths) {
      // Empty caves are sealed rock, not places for the crew to visit.
      const slot = caves.slots.find((slot) => slot.id === m.id);
      if (slot.status === "dark" || slot.status === "mirror" && MIRROR_GATE_CLOSED) continue;
      spots.push({ x: m.apron.x, z: m.apron.z, ry: Math.atan2(m.x - m.apron.x, m.z - m.apron.z) });
    }
    const rand = mulberry32(SEED + 5);
    for (let n = 0, tries = 0; n < WANDER_COUNT && tries < 1500; tries++) {
      const { x, z } = polar(rand() * 360, Math.sqrt(lerp(WANDER_INNER * WANDER_INNER, MEADOW_OUTER * MEADOW_OUTER, rand())));
        if (island.surfaceAt(x, z) !== 0 || nearMouth(x, z, 3) || npcClosedCaveAt(x, z) || !free(x, z, 0.9)) continue;
      spots.push({ x, z, ry: NaN });
      n++;
    }
  };
  // A seat nobody is heading for or sitting on
  const seatTaken = (s) => {
    for (let caveIndex = 0; caveIndex < crew.list.length; caveIndex++) {
      const cave = crew.list[caveIndex];
      const a = cave.act;
      if ((a.kind === "wander" || a.kind === "idle") && a.spot.x === s.x && a.spot.z === s.z) return true;
    }
    return false;
  };
  const freeSeat = () => {
    const start = Math.floor(Math.random() * fireSeats.length);
    for (let i = 0; i < fireSeats.length; i++) {
      const s = fireSeats[(start + i) % fireSeats.length];
      if (!seatTaken(s)) return s;
    }
    return null;
  };
  // By the fire at night, else anywhere on the meadow
  const npcWanderPointClear = (s, cave) => {
    const feet = island.surfaceAt(s.x, s.z), height = cave ? cave.bodyHeight : 1.5;
    return !npcClosedCaveAt(s.x, s.z, feet, height) && !npcPileAt(s.x, feet, s.z, height) && !npcWorkZoneAt(cave, s.x, feet, s.z) && npcFireClear(s.x, feet, s.z, s.x, feet, s.z, height) && walkable(s.x, s.z, s.x, s.z, feet, height, cave);
  };
  const wanderSpot = (out, cave = null) => {
    let s = RENDER_OPTS.stars > NIGHT && Math.random() < FIRE_SEAT_CHANCE ? freeSeat() : null;
    if (s && !npcWanderPointClear(s, cave)) s = null;
    if (!s) {
      const start = Math.floor(Math.random() * spots.length);
      for (let i = 0; i < spots.length; i++) {
        const candidate = spots[(start + i) % spots.length];
        if (candidate.x === out.x && candidate.z === out.z || !npcWanderPointClear(candidate, cave)) continue;
        s = candidate; break;
      }
    }
    if (!s) return;
    out.x = s.x;
    out.z = s.z;
    out.ry = s.ry;
  };
  // Surface caves and the headquarters can share a column below the same roof.
  const supportAt = (x, z, y = Infinity) => island.supportAt(x, z, y, STEP_MAX);
  const playerSupportAt = (x, z, y = 0, previousY = y, player = pilot?.player, dockEntry = false) => {
    const step = player ? player.hop === 0 && player.hopV <= 0 : !pilot.freeFalling;
    const height = player ? player.bodyHeight + Math.max(0, player.viewLift) : CLOSE_VIEW.eyeHeight + CAMERA_RADIUS;
    const from = Math.max(y, previousY), rise = step ? STEP_MAX : 0;
    return Math.max(island.supportAt(x, z, y, STEP_MAX, ABYSS_FLOOR, PLAYER_RADIUS), bedSupportAt(x, z, from, STEP_MAX, PLAYER_RADIUS), cloudFloorAt(x, z, from, rise, height, player), propSupportAt(x, z, from, rise, player), dockStairs ? dockStairs.supportAt(x, z, from, rise, player, dockEntry) : -Infinity);
  };
  const abyssAt = (x, z, y, actor = pilot?.player) => playerSupportAt(x, z, y, y, actor) === ABYSS_FLOOR;
  const visualSupportAt = (x, z, y) => {
    const floor = Math.max(cloudFloorAt(x, z, y, STEP_MAX), bedSupportAt(x, z, y, STEP_MAX, PLAYER_RADIUS), propSupportAt(x, z, y, STEP_MAX, pilot.player), dockStairs ? dockStairs.supportAt(x, z, y, STEP_MAX, pilot.player, false) : -Infinity);
    return floor > -Infinity && floor > island.supportAt(x, z, y, STEP_MAX, ABYSS_FLOOR, PLAYER_RADIUS) ? floor : island.smoothSupportAt(x, z, y, STEP_MAX, PLAYER_RADIUS);
  };
  const PLAYER_RADIUS = 0.3;
  const BODY_RADIUS = 0.38;
  const BODY_PARTS_SOLID = ["torso", "head", "armL", "armR", "legL", "legR"];
  const BODY_BOUNDS = new Float64Array(6);
  // A swept circle, restricted to the time its body overlaps the solid's
  // height. This also catches a fast move across a thin post or another Ooga.
  const cylinderSegmentClear = (x, y, z, toX, toY, toZ, radius, height, cx, cz, bottom, top, solidRadius) => {
    const dy = toY - y;
    let lo = 0, hi = 1;
    if (dy) {
      const a = (bottom - height + 1e-7 - y) / dy, b = (top - 1e-7 - y) / dy;
      lo = Math.max(0, Math.min(a, b)); hi = Math.min(1, Math.max(a, b));
      if (hi < lo) return true;
    } else if (y >= top - 1e-7 || y + height <= bottom + 1e-7) return true;
    const dx = toX - x, dz = toZ - z, length = dx * dx + dz * dz;
    // Actors can arrive at a shared spawn or be placed by a pointer. Let an
    // existing overlap separate, while still rejecting any move farther in.
    const startDistance = (x - cx) ** 2 + (z - cz) ** 2, endDistance = (toX - cx) ** 2 + (toZ - cz) ** 2;
    if (startDistance < (radius + solidRadius) ** 2 && endDistance > startDistance + 1e-9 && (x - cx) * dx + (z - cz) * dz >= 0) return true;
    const t = length ? Math.max(lo, Math.min(hi, ((cx - x) * dx + (cz - z) * dz) / length)) : lo;
    const ox = x + dx * t - cx, oz = z + dz * t - cz, reach = radius + solidRadius;
    return ox * ox + oz * oz >= reach * reach - 1e-8;
  };
  const actorBounds = (cave) => {
    const p = cave.root.position;
    if (cave.root.quaternion && cave.solidBounds) return cave.solidBounds;
    BODY_BOUNDS[0] = p.x - BODY_RADIUS; BODY_BOUNDS[2] = p.z - BODY_RADIUS;
    BODY_BOUNDS[3] = p.x + BODY_RADIUS; BODY_BOUNDS[5] = p.z + BODY_RADIUS;
    BODY_BOUNDS[1] = p.y - cave.baseY; BODY_BOUNDS[4] = BODY_BOUNDS[1] + cave.bodyHeight;
    return BODY_BOUNDS;
  };
  const updateSleepingSolids = () => {
    for (let index = 0; index < crew.list.length; index++) {
      const cave = crew.list[index];
      if (!cave.root.visible || !cave.root.quaternion) continue;
      const out = cave.solidBounds;
      out[0] = out[1] = out[2] = Infinity; out[3] = out[4] = out[5] = -Infinity;
      BL.scene.updateWorld(cave.root);
      for (let i = 0; i < BODY_PARTS_SOLID.length; i++) {
        const part = cave.parts[BODY_PARTS_SOLID[i]];
        if (!part?.geometry || !part.visible) continue;
        const b = BL.scene.boundsOf(part.geometry), m = part.world;
        for (let k = 0; k < 8; k++) {
          const x = k & 1 ? b.max[0] : b.min[0], y = k & 2 ? b.max[1] : b.min[1], z = k & 4 ? b.max[2] : b.min[2];
          const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
          out[0] = Math.min(out[0], wx); out[1] = Math.min(out[1], wy); out[2] = Math.min(out[2], wz);
          out[3] = Math.max(out[3], wx); out[4] = Math.max(out[4], wy); out[5] = Math.max(out[5], wz);
        }
      }
    }
  };
  const bodyOverlaps = (cave, b, x, z, radius) => {
    if (!cave.root.quaternion) { const p = cave.root.position; return (p.x - x) ** 2 + (p.z - z) ** 2 < (radius + BODY_RADIUS) ** 2 - 1e-8; }
    const dx = Math.max(b[0] - x, 0, x - b[3]), dz = Math.max(b[2] - z, 0, z - b[5]);
    return dx * dx + dz * dz < radius * radius - 1e-8;
  };
  const uprightCharacter = (cave) => cave.root.visible && cave.state !== "sleeping" && !cave.root.quaternion && !cave.camp.seat && !cave.camp.rolling;
  const standingPassenger = (cave) => uprightCharacter(cave) && cave.hop <= 1e-7 && cave.hopV <= 0 && !cave.jet?.thrust;
  const passengerOf = (cave, support) => {
    if (!support || !cave.riding.support || !uprightCharacter(support)) return false;
    // Links exist only during the crew's ordered update. Bound chains by the
    // roster even if two bodies were placed into an invalid shared position.
    for (let n = 0; cave && n < crew.cavemen.size; n++) {
      if (!standingPassenger(cave)) return false;
      cave = cave.riding.support;
      if (cave === support) return true;
    }
    return false;
  };
  const characterSupportAt = (cave) => {
    if (!standingPassenger(cave)) return null;
    const p = cave.root.position, feet = p.y - cave.baseY;
    let support = null, distance = Infinity;
    for (let otherIndex = 0; otherIndex < crew.list.length; otherIndex++) {
      const other = crew.list[otherIndex];
      if (other === cave || !uprightCharacter(other)) continue;
      const b = actorBounds(other);
      if (Math.abs(b[4] - feet) > 1e-6 || !bodyOverlaps(other, b, p.x, p.z, PLAYER_RADIUS)) continue;
      const q = other.root.position, d = (p.x - q.x) ** 2 + (p.z - q.z) ** 2;
      if (d < distance) { support = other; distance = d; }
    }
    return support && Math.abs(playerSupportAt(p.x, p.z, feet, feet, cave) - feet) <= 1e-6 ? support : null;
  };
  const propSupportAt = (x, z, y, rise, actor) => {
    let floor = solids ? solids.supportAt(x, z, y, rise, PLAYER_RADIUS) : -Infinity;
    if (altar && ALTAR_HEIGHT <= y + rise + 1e-7 && Math.hypot(x, z) < altar.platformRadius + PLAYER_RADIUS - 1e-7) floor = Math.max(floor, ALTAR_HEIGHT);
    if (crew) for (let i = 0; i < crew.list.length; i++) {
      const other = crew.list[i];
      if (other === actor || !other.root.visible) continue;
      const b = actorBounds(other);
      if (b[4] > floor && b[4] <= y + rise + 1e-7 && bodyOverlaps(other, b, x, z, PLAYER_RADIUS)) floor = b[4];
    }
    return floor;
  };
  const propCeilingAt = (x, z, y, radius, actor) => {
    let ceiling = solids ? solids.ceilingAt(x, z, y, radius) : Infinity;
    if (altar && y < ALTAR_HEIGHT - 1e-7 && Math.hypot(x, z) < altar.platformRadius + radius - 1e-7) ceiling = Math.min(ceiling, 0);
    if (crew) for (let i = 0; i < crew.list.length; i++) {
      const other = crew.list[i];
      if (other === actor || !other.root.visible || passengerOf(other, actor)) continue;
      const b = actorBounds(other);
      if (b[1] > y + 1e-7 && y < b[4] - 1e-7 && bodyOverlaps(other, b, x, z, radius)) ceiling = Math.min(ceiling, b[1]);
    }
    return ceiling;
  };
  const propSegmentClear = (x, y, z, toX, toY, toZ, radius, height, actor, carrying = false) => {
    if (solids && !solids.segmentClear(x, y, z, toX, toY, toZ, radius, height)) return false;
    if (altar && !cylinderSegmentClear(x, y, z, toX, toY, toZ, radius, height, 0, 0, 0, ALTAR_HEIGHT, altar.platformRadius)) return false;
    if (crew) for (let otherIndex = 0; otherIndex < crew.list.length; otherIndex++) {
      const other = crew.list[otherIndex];
      if (other === actor || !other.root.visible || passengerOf(other, actor) || carrying && passengerOf(actor, other)) continue;
      const b = actorBounds(other), p = other.root.position;
      if (other.root.quaternion) {
        if (!terrain.segmentBoxClear(x, y, z, toX - x, toY - y, toZ - z, radius, height, b[0], b[1], b[2], b[3], b[4], b[5])) return false;
      } else if (!cylinderSegmentClear(x, y, z, toX, toY, toZ, radius, height, p.x, p.z, b[1], b[4], BODY_RADIUS)) return false;
    }
    return true;
  };
  const bedSupportAt = (x, z, y, maxStep, radius) => {
    let floor = -Infinity;
    if (!headquarters) return floor;
    for (const bed of headquarters.mattresses) {
      if (y + maxStep < bed.y || !bed.node.visible || bed.node.parent !== root) continue;
      const dx = x - bed.x, dz = z - bed.z, lx = dx * bed.cr - dz * bed.sr, lz = dx * bed.sr + dz * bed.cr, boxes = bed.collisionBoxes;
      for (let i = 0; i < boxes.length; i += 6) {
        const top = bed.y + boxes[i + 4];
        if (top <= floor || top > y + maxStep + 1e-7) continue;
        const ox = Math.max(boxes[i] - lx, 0, lx - boxes[i + 3]), oz = Math.max(boxes[i + 2] - lz, 0, lz - boxes[i + 5]);
        if (radius ? ox * ox + oz * oz < radius * radius - 1e-9 : ox === 0 && oz === 0) floor = top;
      }
    }
    return floor;
  };
  const bedCeilingAt = (x, z, y, radius) => {
    let ceiling = Infinity;
    if (!headquarters) return ceiling;
    for (const bed of headquarters.mattresses) {
      if (y >= bed.y + bed.sleep.pillowTop - 1e-7 || !bed.node.visible || bed.node.parent !== root) continue;
      const dx = x - bed.x, dz = z - bed.z, lx = dx * bed.cr - dz * bed.sr, lz = dx * bed.sr + dz * bed.cr, boxes = bed.collisionBoxes;
      for (let i = 0; i < boxes.length; i += 6) {
        if (y >= bed.y + boxes[i + 4] - 1e-7) continue;
        const ox = Math.max(boxes[i] - lx, 0, lx - boxes[i + 3]), oz = Math.max(boxes[i + 2] - lz, 0, lz - boxes[i + 5]);
        if (radius ? ox * ox + oz * oz < radius * radius - 1e-9 : ox === 0 && oz === 0) ceiling = Math.min(ceiling, bed.y + boxes[i + 1]);
      }
    }
    return ceiling;
  };
  const bedSegmentClear = (x, y, z, toX, toY, toZ, radius, height) => {
    if (!headquarters) return true;
    const dx = toX - x, dy = toY - y, dz = toZ - z;
    for (const bed of headquarters.mattresses) {
      if (Math.min(y, toY) >= bed.y + bed.sleep.pillowTop - 1e-7 || Math.max(y, toY) + height <= bed.y || !bed.node.visible || bed.node.parent !== root) continue;
      const lx = (x - bed.x) * bed.cr - (z - bed.z) * bed.sr, lz = (x - bed.x) * bed.sr + (z - bed.z) * bed.cr;
      const vx = dx * bed.cr - dz * bed.sr, vz = dx * bed.sr + dz * bed.cr, boxes = bed.collisionBoxes;
      for (let i = 0; i < boxes.length; i += 6) if (!terrain.segmentBoxClear(lx, y - bed.y, lz, vx, dy, vz, radius, height, boxes[i], boxes[i + 1], boxes[i + 2], boxes[i + 3], boxes[i + 4], boxes[i + 5])) return false;
    }
    return true;
  };
  let cloudHit = null;
  // Clouds are one-way platforms. Their cached rectangles are the mesh's
  // actual upward faces; air below and beside them remains freely flyable.
  const cloudFloorAt = (x, z, y, maxStep = 0, height = 0, actor = pilot?.player) => {
    let floor = -Infinity;
    cloudHit = null;
    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i], node = cloud.node, p = node.position;
      if (!node.visible || node.parent !== root) continue;
      const lx = x - p.x, lz = z - p.z, bounds = cloud.bounds;
      if (lx < bounds[0] - PLAYER_RADIUS || lx > bounds[2] + PLAYER_RADIUS || lz < bounds[1] - PLAYER_RADIUS || lz > bounds[3] + PLAYER_RADIUS) continue;
      const tops = cloud.tops;
      for (let j = 0; j < tops.length; j += 5) {
        const top = p.y + tops[j + 4];
        if (top <= floor || top > y + maxStep + 1e-7) continue;
        const dx = Math.max(tops[j] - lx, 0, lx - tops[j + 2]), dz = Math.max(tops[j + 1] - lz, 0, lz - tops[j + 3]);
        if (dx * dx + dz * dz >= PLAYER_RADIUS * PLAYER_RADIUS - 1e-9) continue;
        if (top > y + 1e-7 && height && (!physicalClearAt(x, top, z, PLAYER_RADIUS, height, actor) || !island.voxelSegmentClearAt(x, y, z, x, top, z, PLAYER_RADIUS, height))) continue;
        floor = top;
        cloudHit = cloud;
      }
    }
    return floor;
  };
  const cloudAt = (x, z, y, maxStep = 0) => {
    const floor = cloudFloorAt(x, z, y, maxStep);
    return floor > island.supportAt(x, z, y, STEP_MAX, ABYSS_FLOOR, PLAYER_RADIUS) ? cloudHit : null;
  };
  const prepareCloudSupport = (cave) => {
    const p = cave.root.position, feet = p.y - cave.baseY, previous = cave.cloudSupport;
    const grounded = cave.hop === 0 && cave.hopV <= 0;
    const height = cave.bodyHeight + Math.max(0, cave.viewLift);
    if (previous && grounded && !previous.wrapped && previous.node.visible && previous.node.parent === root) {
      const x = p.x + previous.dx, z = p.z + previous.dz, floor = Math.max(feet, cloudFloorAt(x, z, feet, STEP_MAX, height, cave));
      if (flyable(p.x, p.z, x, z, feet, height, cave) && physicalClearAt(x, floor, z, PLAYER_RADIUS, height, cave) && island.voxelSegmentClearAt(p.x, feet, p.z, x, floor, z, PLAYER_RADIUS, height)) {
        p.x = x; p.z = z;
      }
    }
    const floor = cloudFloorAt(p.x, p.z, feet, grounded ? STEP_MAX : 0, height, cave), current = cloudHit;
    const ground = Math.max(island.supportAt(p.x, p.z, feet, STEP_MAX, ABYSS_FLOOR, PLAYER_RADIUS), bedSupportAt(p.x, p.z, feet, STEP_MAX, PLAYER_RADIUS), propSupportAt(p.x, p.z, feet, grounded ? STEP_MAX : 0, cave));
    if (previous || floor > ground) {
      const support = Math.max(floor, ground);
      cave.hop = Math.max(0, feet - support);
      p.y = cave.baseY + support + cave.hop;
    }
    // Remember the support layer during flight too. If that cloud drifts
    // away before landing, hop must rebase onto the abyss without a snap.
    cave.cloudSupport = floor > ground ? current : null;
  };
  // The stone frames are rendered boxes, separate from the carved terrain.
  // Rotate the cylinder into each fixed arch's axes; its footprint stays round.
  const entranceCeilingAt = (x, z, y, radius) => {
    let ceiling = Infinity;
    for (let i = 0; i < headquarters.entrances.length; i++) {
      const entry = headquarters.entrances[i], node = entry.node;
      const dx = x - node.position.x, dz = z - node.position.z, reach = entry.radius + radius;
      if (y >= entry.maxY - 1e-7 || dx * dx + dz * dz > reach * reach) continue;
      const lx = dx * entry.cr - dz * entry.sr, lz = dx * entry.sr + dz * entry.cr, scale = node.scale.x, boxes = node.geometry.collisionBoxes;
      for (let j = 0; j < boxes.length; j += 6) {
        if (y >= node.position.y + boxes[j + 4] - 1e-7) continue;
        const ox = Math.max(boxes[j] * scale - lx, 0, lx - boxes[j + 3] * scale), oz = Math.max(boxes[j + 2] - lz, 0, lz - boxes[j + 5]);
        if (ox * ox + oz * oz < radius * radius - 1e-9) ceiling = Math.min(ceiling, node.position.y + boxes[j + 1]);
      }
    }
    return ceiling;
  };
  const ROOM_SIGN_LIMIT = 1.35, ROOM_SIGN_HEAD_RADIUS = 0.22;
  const swingRoomSign = (sign, direction, velocity, additive = false) => {
    const impulse = direction * velocity;
    sign.velocity = additive ? clamp(sign.velocity + impulse, -7, 7) : impulse;
    sign.hits++;
  };
  // Sweep the head through the board's rotated coordinates. These light
  // hanging props yield to the body; the stone frame still owns collision.
  const roomSignHeadClear = (sign, x, y, z, dx, dy, dz) => {
    const a = sign.node.rotation.x, c = Math.cos(a), s = Math.sin(a), b = sign.node.geometry.roomLifehashSign.board, r = ROOM_SIGN_HEAD_RADIUS;
    return terrain.segmentBoxClear(x, y * c + z * s - r, z * c - y * s, dx, dy * c + dz * s, dz * c - dy * s, r, r * 2, b[0], b[1], b[2], b[3], b[4], b[5]);
  };
  const moveRoomSigns = (cave, x, y, z, dt) => {
    const p = cave.root.position, dx = p.x - x, dy = p.y - y, dz = p.z - z, bit = 1 << cave.index;
    const continuous = Math.hypot(dx, dz) <= (JET_SPEED + pilotMod.WALK.speed) * dt + 1e-5 && Math.abs(dy) <= Math.abs(cave.hopV) * dt + STEP_MAX + 1e-5;
    for (const sign of headquarters.roomSigns) {
      const ox = x - sign.node.position.x, oz = z - sign.node.position.z;
      const lx = ox * sign.cr - oz * sign.sr, lz = ox * sign.sr + oz * sign.cr;
      const ly = y - cave.baseY + cave.bodyHeight + cave.viewLift - ROOM_SIGN_HEAD_RADIUS - sign.node.position.y;
      const vx = dx * sign.cr - dz * sign.sr, vz = dx * sign.sr + dz * sign.cr;
      if (!sign.node.visible || !continuous || Math.abs(lx + vx) > sign.node.geometry.roomLifehashSign.width / 2 + ROOM_SIGN_HEAD_RADIUS
        || Math.abs(lz + vz) > 1.1 || ly + dy < -1.1 || ly + dy > 0.3) { sign.contacts &= ~bit; continue; }
      if (roomSignHeadClear(sign, lx, ly, lz, vx, dy, vz)) continue;
      const direction = sign.contacts & bit ? Math.sign(sign.node.rotation.x || sign.velocity) : Math.abs(vz) > 1e-6 ? -Math.sign(vz) : lz >= 0.07 ? 1 : -1;
      if (!(sign.contacts & bit)) {
        swingRoomSign(sign, direction, Math.min(7, 2 + Math.hypot(dx, dy, dz) / dt * 0.65));
        sign.contacts |= bit;
      }
      // Resolve overlap by moving the board, preserving the jump's velocity.
      // The bounded angular steps let the head push it farther as it passes.
      for (let n = 0; n < 68 && !roomSignHeadClear(sign, lx + vx, ly + dy, lz + vz, 0, 0, 0); n++) {
        const angle = clamp(sign.node.rotation.x + direction * 0.04, -ROOM_SIGN_LIMIT, ROOM_SIGN_LIMIT);
        if (angle === sign.node.rotation.x) break;
        sign.node.rotation.x = angle;
      }
    }
  };
  const updateRoomSigns = (dt) => {
    for (const sign of headquarters.roomSigns) {
      if (!sign.velocity && !sign.node.rotation.x) continue;
      let remaining = Math.min(dt, 0.1);
      while (remaining > 1e-7) {
        const step = Math.min(remaining, 1 / 120);
        sign.velocity += (-18 * sign.node.rotation.x - 4 * sign.velocity) * step;
        sign.node.rotation.x += sign.velocity * step;
        if (Math.abs(sign.node.rotation.x) > ROOM_SIGN_LIMIT) { sign.node.rotation.x = clamp(sign.node.rotation.x, -ROOM_SIGN_LIMIT, ROOM_SIGN_LIMIT); sign.velocity *= -0.2; }
        remaining -= step;
      }
      if (Math.abs(sign.velocity) < 0.001 && Math.abs(sign.node.rotation.x) < 0.001) sign.velocity = sign.node.rotation.x = 0;
    }
  };
  const hitRoomSign = (_source, hit, dx, dy, dz) => {
    const sign = hit.owner && hit.owner.roomSign;
    if (!sign || !sign.node.visible) return;
    const localZ = dx * sign.sr + dz * sign.cr;
    const ox = hit.x - sign.node.position.x, oz = hit.z - sign.node.position.z;
    const hitZ = ox * sign.sr + oz * sign.cr;
    const direction = Math.abs(localZ) > 1e-6 ? -Math.sign(localZ) : hitZ >= 0 ? 1 : -1;
    swingRoomSign(sign, direction, 3.5, true);
  };
  const moveCampBody = (cave, x, y, z, dt) => {
    moveRoomSigns(cave, x, y, z, dt);
    if (cave.camp.burning || cave.camp.rolling || cave.camp.cooldown > 0) return;
    const p = cave.root.position, dx = p.x - x, dz = p.z - z, distance = dx * dx + dz * dz;
    for (const hazard of fireHazards) {
      if (!hazard.node.visible) continue;
      const t = distance ? clamp(((hazard.x - x) * dx + (hazard.z - z) * dz) / distance, 0, 1) : 0;
      const feet = y + (p.y - y) * t - cave.baseY;
      if (feet < hazard.y + FIRE_TOP && feet + cave.bodyHeight > hazard.y + FIRE_BOTTOM
        && (x + dx * t - hazard.x) ** 2 + (z + dz * t - hazard.z) ** 2 < FIRE_CONTACT_RADIUS ** 2) { crew.ignite(cave); break; }
    }
  };
  // Flames are traversable by the visitor, but voluntary NPC steps keep a
  // margin around the entire pit: ash, logs and stone enclosure included.
  // The pit stays excluded when its flame is off, while the vertical sweep
  // still lets another storey or a safely high jump pass over it.
  const npcFireClear = (x, y, z, toX, toY, toZ, height) => {
    const dx = toX - x, dy = toY - y, dz = toZ - z, length = dx * dx + dz * dz;
    for (const hazard of fireHazards) {
      if (!hazard.pit.visible) continue;
      const low = hazard.y + FIRE_BOTTOM - height, high = hazard.y + FIRE_TOP;
      let enter = 0, exit = 1;
      if (dy) {
        const a = (low - y) / dy, b = (high - y) / dy;
        enter = Math.max(0, Math.min(a, b)); exit = Math.min(1, Math.max(a, b));
        if (enter >= exit) continue;
      } else if (y <= low || y >= high) continue;
      const ox = x - hazard.x, oz = z - hazard.z, before = ox * ox + oz * oz;
      // A fire can light beneath a walker. Let them move outward, never
      // deeper into it; a stationary point inside is still an unsafe goal.
      if (y > low && y < high && before < hazard.avoidRadius ** 2 && length > 0
        && ox * dx + oz * dz >= 0 && (ox + dx) ** 2 + (oz + dz) ** 2 > before) continue;
      const t = length ? clamp(-(ox * dx + oz * dz) / length, enter, exit) : enter;
      if ((ox + dx * t) ** 2 + (oz + dz * t) ** 2 < hazard.avoidRadius ** 2) return false;
    }
    return true;
  };
  const physicalClearAt = (x, y, z, radius, height, actor = pilot?.player) => island.clearAt(x, y, z, radius, height) && y + height <= Math.min(entranceCeilingAt(x, z, y, radius), bedCeilingAt(x, z, y, radius), propCeilingAt(x, z, y, radius, actor)) + 1e-7 && (!solids || solids.clearAt(x, y, z, radius, height));
  const JETPACK_COLUMN = { caveIndex: 0, floor: 0, ceiling: 0 };
  const jetpackAllowed = (cave) => {
    const p = cave.root.position, feet = p.y - cave.baseY;
    const basement = island.headquarters.basement, hole = basement.hole;
    // Keep thrust through the open shaft and its bevel until the whole body
    // clears the lip. The basement ceiling still separates it from HQ above.
    if (feet < basement.ceiling && Math.hypot(p.x - hole.x, p.z - hole.z) <= hole.mouthRadius + PLAYER_RADIUS) return true;
    return !island.cavityAt(p.x, p.z, JETPACK_COLUMN, island.headquarters.caveIndex, feet) || feet < JETPACK_COLUMN.floor - 1e-6 || feet >= JETPACK_COLUMN.ceiling;
  };
  // Interaction reach follows clear air, including stacked rooms. Sweep solid
  // walls and frames exactly; substeps also check the rendered ramp slopes.
  const actionReachable = (x, y, z, toX, toY, toZ, margin = 0.025) => {
    if (crossesSealedCave(x, z, toX, toZ, y) || !island.voxelSegmentClearAt(x, y - margin, z, toX, toY - margin, toZ, margin, margin * 2) || !entranceSegmentClear(x, y, z, toX, toY, toZ, margin)) return false;
    const steps = Math.max(1, Math.ceil(Math.hypot(toX - x, toY - y, toZ - z) / 0.12));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!island.clearAt(lerp(x, toX, t), lerp(y, toY, t) - margin, lerp(z, toZ, t), margin, margin * 2)) return false;
    }
    return true;
  };
  const actionWithinReach = (x, y, z, toX, toY, toZ, reach) => Math.hypot(toX - x, toY - y, toZ - z) < reach && actionReachable(x, y, z, toX, toY, toZ);
  const MIRROR_ACTOR_RADII = new WeakMap();
  const mirrorPartReach = (geometry, m, x, y, z) => {
    const b = BL.scene.boundsOf(geometry);
    let reach = 0;
    for (let corner = 0; corner < 8; corner++) {
      const px = corner & 1 ? b.max[0] : b.min[0], py = corner & 2 ? b.max[1] : b.min[1], pz = corner & 4 ? b.max[2] : b.min[2];
      reach = Math.max(reach, Math.hypot(m[0] * px + m[4] * py + m[8] * pz + m[12] - x,
        m[1] * px + m[5] * py + m[9] * pz + m[13] - y,
        m[2] * px + m[6] * py + m[10] * pz + m[14] - z));
    }
    return reach;
  };
  const mirrorHeadReach = (node, x, y, z) => {
    if (!node.visible) return 0;
    let reach = node.geometry ? mirrorPartReach(node.geometry, node.world, x, y, z) : 0;
    for (let i = 0; i < node.children.length; i++) reach = Math.max(reach, mirrorHeadReach(node.children[i], x, y, z));
    return reach;
  };
  const mirrorActorRadius = (actor) => {
    let radius = MIRROR_ACTOR_RADII.get(actor);
    if (radius !== undefined) return radius;
    BL.scene.updateWorld(actor.root, actor.root.parent?.world);
    // Away actors still need current accessory transforms when gear changes.
    BL.scene.updateWorld(actor.parts.head, actor.root.world);
    const head = actor.parts.head, m = head.world;
    const reach = Math.max(mirrorHeadReach(head, m[12], m[13], m[14]), mirrorPartReach(actor.headClosed, m, m[12], m[13], m[14]));
    // A sphere about the head pivot contains every yaw/pitch, including hats
    // and masks. Held weapons stay outside this physical clearance envelope.
    // The close view uses a 0.1 m near plane; reserve its oblique corners too.
    radius = Math.max(PLAYER_RADIUS, actor.bodyRadius, Math.hypot(actor.sleepParts.headX, actor.sleepParts.headZ) + reach, CLOSE_VIEW.eyeForward + 0.2) + 0.015;
    MIRROR_ACTOR_RADII.set(actor, radius);
    return radius;
  };
  const mirrorActorSegmentClear = (x, y, z, toX, toY, toZ, height, actor) => {
    if (!actor || mirrorCave.damage.broken) return true;
    const m = mirrorCave.mouth, sr = matrixCave.sr, cr = matrixCave.cr;
    const bounds = BL.scene.boundsOf(mirrorCave.node.mirrorCaptureGeometry), radius = mirrorActorRadius(actor);
    const bottom = mirrorCave.node.position.y + bounds.min[1], top = mirrorCave.node.position.y + bounds.max[1];
    if (Math.min(y, toY) >= m.floorY + top || Math.max(y, toY) + height <= m.floorY + bottom) return true;
    const lx = (x - m.x) * cr - (z - m.z) * sr, lz = (x - m.x) * sr + (z - m.z) * cr;
    const dx = (toX - x) * cr - (toZ - z) * sr, dz = (toX - x) * sr + (toZ - z) * cr;
    if (Math.min(lz, lz + dz) > PORTAL_Z + radius || Math.max(lz, lz + dz) < PORTAL_Z - radius) return true;
    // Partly broken glass still keeps the complete actor outside. The gate
    // remains a separate barrier after the final pane shatters.
    return terrain.segmentBoxClear(lx, y - m.floorY, lz, dx, toY - y, dz, radius, height,
      bounds.min[0], bottom, PORTAL_Z, bounds.max[0], top, PORTAL_Z);
  };
  // A glyph gate is a single barrier, including the spaces between its bars.
  // Sweep the full cylinder so a fast step cannot jump over the thin slab.
  // Keep this separate from camera/terrain clearance: free eyes still pass it.
  const matrixGateSegmentClear = (x, y, z, toX, toY, toZ, radius, height) => {
    const dx = toX - x, dy = toY - y, dz = toZ - z;
    for (let i = 0; i < matrixGates.length; i++) {
      const gate = matrixGates[i], m = gate.mouth;
      const bottom = Math.max(gate.floor, gate.node.position.y + gate.bottom), top = Math.min(gate.ceiling, gate.node.position.y + gate.top);
      if (bottom >= top || Math.min(y, toY) >= m.floorY + top || Math.max(y, toY) + height <= m.floorY + bottom) continue;
      const lx = (x - m.x) * gate.cr - (z - m.z) * gate.sr, lz = (x - m.x) * gate.sr + (z - m.z) * gate.cr;
      if (!terrain.segmentBoxClear(lx, y - m.floorY, lz, dx * gate.cr - dz * gate.sr, dy, dx * gate.sr + dz * gate.cr, radius, height, gate.minX, bottom, gate.minZ, gate.maxX, top, gate.maxZ)) return false;
    }
    return true;
  };
  const matrixGateCeilingAt = (x, z, y) => {
    let ceiling = Infinity;
    for (let i = 0; i < matrixGates.length; i++) {
      const gate = matrixGates[i], m = gate.mouth;
      const bottom = Math.max(gate.floor, gate.node.position.y + gate.bottom), top = Math.min(gate.ceiling, gate.node.position.y + gate.top);
      if (bottom >= top || y >= m.floorY + top - 1e-7) continue;
      const lx = (x - m.x) * gate.cr - (z - m.z) * gate.sr, lz = (x - m.x) * gate.sr + (z - m.z) * gate.cr;
      const ox = Math.max(gate.minX - lx, 0, lx - gate.maxX), oz = Math.max(gate.minZ - lz, 0, lz - gate.maxZ);
      if (ox * ox + oz * oz < PLAYER_RADIUS * PLAYER_RADIUS - 1e-9) ceiling = Math.min(ceiling, m.floorY + bottom);
    }
    return ceiling;
  };
  const ceilingAt = (x, z, y, actor = pilot?.player, passengers = true) => {
    let ceiling = Math.min(island.ceilingAt(x, y, z, PLAYER_RADIUS), entranceCeilingAt(x, z, y, PLAYER_RADIUS), bedCeilingAt(x, z, y, PLAYER_RADIUS), matrixGateCeilingAt(x, z, y), propCeilingAt(x, z, y, PLAYER_RADIUS, actor));
    for (let i = 0; i < CAMERA_OPENINGS.length; i++) {
      const entry = CAMERA_OPENINGS[i], m = entry.mouth, rim = entry.rim;
      const dx = x - m.x, dz = z - m.z, along = dx * entry.sr + dz * entry.cr, across = dx * entry.cr - dz * entry.sr;
      if (y < m.floorY - STEP_MAX || y > m.floorY + rim.ceilingY || along < rim.minZ + PORTAL_Z - PLAYER_RADIUS || along > rim.maxZ + PORTAL_Z + PLAYER_RADIUS || across < rim.minX - PLAYER_RADIUS || across > rim.maxX + PLAYER_RADIUS) continue;
      ceiling = Math.min(ceiling, m.floorY + rim.ceilingY);
    }
    if (passengers && actor && crew && (actor.hopV > 0 || y > actor.riding.y - actor.baseY + 1e-7)) for (let riderIndex = 0; riderIndex < crew.list.length; riderIndex++) {
      const rider = crew.list[riderIndex];
      if (rider === actor || !passengerOf(rider, actor)) continue;
      const from = actor.riding, riding = rider.riding;
      const offset = riding.y - rider.baseY - from.y + actor.baseY;
      const roof = ceilingAt(x + riding.x - from.x, z + riding.z - from.z, y + offset, rider, false);
      // Convert each passenger's headroom into a limit for the lower body.
      // Upward motion cannot push it through a roof; level travel may leave
      // a passenger behind at a wall that the lower body can pass beneath.
      ceiling = Math.min(ceiling, roof - offset - rider.bodyHeight - Math.max(0, rider.viewLift) + actor.bodyHeight + Math.max(0, actor.viewLift));
    }
    return ceiling;
  };
  const crossesSealedCave = (fromX, fromZ, toX, toZ, y = 0) => {
    for (let i = 0; i < sealedCaves.length; i++) {
      const sealed = sealedCaves[i], m = sealed.mouth, sr = sealed.sr, cr = sealed.cr;
      if (y < m.floorY - STEP_MAX || y > m.floorY + PORTAL_MAX_Y) continue;
      const a = (fromX - m.x) * sr + (fromZ - m.z) * cr - sealed.stopZ;
      const b = (toX - m.x) * sr + (toZ - m.z) * cr - sealed.stopZ;
      if (a * b > 0 || a === b) continue;
      const k = a / (a - b), x = lerp(fromX, toX, k), z = lerp(fromZ, toZ, k);
      const across = (x - m.x) * cr - (z - m.z) * sr;
      if (across >= PORTAL_MIN_X && across <= PORTAL_MAX_X) return true;
    }
    return false;
  };
  // Bananas are passable; the visitor must jump onto their stone platform.
  const walkable = (fromX, fromZ, toX, toZ, y, height = 1.5, actor = pilot?.player) => {
    if (Math.hypot(toX, toZ) > FLY_BOUND || crossesSealedCave(fromX, fromZ, toX, toZ, y)) return false;
    // Sweep the feet before ordinary step assistance lifts them. Once above
    // the rim, jumping, landing and walking off keep their normal clearance.
    if (altar && actor && actor === pilot.player && !cylinderSegmentClear(fromX, y, fromZ, toX, y, toZ, PLAYER_RADIUS, height, 0, 0, 0, ALTAR_HEIGHT, altar.platformRadius)) return false;
    const floor = playerSupportAt(toX, toZ, y, y, actor, true), feet = Math.max(y, floor);
    if (floor - y > STEP_MAX) return false;
    // The feet may mount an ordinary voxel step; the torso and head must fit
    // across their whole footprint at the destination's actual elevation.
    return feet + height <= ceilingAt(toX, toZ, feet, actor) + 1e-7 && physicalClearAt(toX, feet + STEP_MAX, toZ, PLAYER_RADIUS, Math.max(0, height - STEP_MAX), actor) && propSegmentClear(fromX, feet + STEP_MAX, fromZ, toX, feet + STEP_MAX, toZ, PLAYER_RADIUS, Math.max(0, height - STEP_MAX), actor) && matrixGateSegmentClear(fromX, y, fromZ, toX, feet, toZ, PLAYER_RADIUS, height) && mirrorActorSegmentClear(fromX, y, fromZ, toX, feet, toZ, height, actor);
  };
  const flyable = (fromX, fromZ, toX, toZ, y = 0, height = 1.5, actor = pilot?.player) => Math.hypot(toX, toZ) <= FLY_BOUND && !crossesSealedCave(fromX, fromZ, toX, toZ, y) && y + height <= ceilingAt(toX, toZ, y, actor) + 1e-7 && physicalClearAt(toX, y, toZ, PLAYER_RADIUS, height, actor) && propSegmentClear(fromX, y, fromZ, toX, y, toZ, PLAYER_RADIUS, height, actor) && bedSegmentClear(fromX, y, fromZ, toX, y, toZ, PLAYER_RADIUS, height) && matrixGateSegmentClear(fromX, y, fromZ, toX, y, toZ, PLAYER_RADIUS, height) && mirrorActorSegmentClear(fromX, y, fromZ, toX, y, toZ, height, actor);
  const characterCarryClear = (cave, x, y, z, toX, toY, toZ) => {
    const height = cave.bodyHeight + Math.max(0, cave.viewLift), feet = y + 1e-7, toFeet = toY + 1e-7;
    return Math.hypot(toX, toZ) <= FLY_BOUND && !crossesSealedCave(x, z, toX, toZ, Math.min(y, toY))
      && toY + height <= ceilingAt(toX, toZ, toY, cave) + 1e-7
      && physicalClearAt(toX, toFeet, toZ, PLAYER_RADIUS, height - 1e-7, cave)
      && island.voxelSegmentClearAt(x, feet, z, toX, toFeet, toZ, PLAYER_RADIUS, height - 1e-7)
      && propSegmentClear(x, feet, z, toX, toFeet, toZ, PLAYER_RADIUS, height - 1e-7, cave, true)
      && bedSegmentClear(x, feet, z, toX, toFeet, toZ, PLAYER_RADIUS, height - 1e-7)
      && matrixGateSegmentClear(x, feet, z, toX, toFeet, toZ, PLAYER_RADIUS, height - 1e-7)
      && mirrorActorSegmentClear(x, feet, z, toX, toFeet, toZ, height - 1e-7, cave);
  };
  const carryCharacter = (cave, dx, dy, dz) => {
    if (!standingPassenger(cave) || !cave.riding.support || !uprightCharacter(cave.riding.support)) return;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1e-9) return;
    const p = cave.root.position, steps = Math.max(1, Math.ceil(distance / 0.125));
    dx /= steps; dy /= steps; dz /= steps;
    for (let n = 0; n < steps; n++) {
      const feet = p.y - cave.baseY;
      if (characterCarryClear(cave, p.x, feet, p.z, p.x + dx, feet + dy, p.z + dz)) {
        p.x += dx; p.y += dy; p.z += dz;
        continue;
      }
      // Preserve contact with the obstacle instead of crossing it or losing
      // an entire frame of safe movement near a wall or low ceiling.
      let lo = 0, hi = 1;
      for (let i = 0; i < 8; i++) {
        const t = (lo + hi) / 2;
        if (characterCarryClear(cave, p.x, feet, p.z, p.x + dx * t, feet + dy * t, p.z + dz * t)) lo = t;
        else hi = t;
      }
      p.x += dx * lo; p.y += dy * lo; p.z += dz * lo;
      break;
    }
  };
  const inBananas = (cave, x = cave.root.position.x, z = cave.root.position.z) => bananaCover.intersectsBody(x, cave.root.position.y - cave.baseY, z, cave.bodyHeight);
  const npcPileAt = (x, feet, z, height) => feet <= ALTAR_HEIGHT + STEP_MAX && feet + height > 0 && Math.hypot(x, z) < altar.platformRadius + PLAYER_RADIUS
    || bananaCover.intersectsBody(x, feet, z, height);
  const workZoneTraveler = (cave) => cave && cave !== crew?.player && (cave.state !== "working" || cave.bedTravel.mode);
  const refreshWorkZones = () => {
    for (const zone of workZones) { zone.active = false; zone.half = 3.4; zone.front = 5.8; }
    for (let i = 0; i < crew.list.length; i++) {
      const cave = crew.list[i];
      if (!cave.root.visible || cave === crew.player || cave.state !== "working" || !cave.work.phase) continue;
      const zone = workZones[cave.work.site], p = cave.work.position;
      if (!zone) continue;
      zone.active = true;
      if (cave.work.phase !== "outbound" && cave.work.phase !== "station" && cave.work.phase !== "shoot") continue;
      const dx = p.x - zone.x, dz = p.z - zone.z;
      zone.half = Math.max(zone.half, Math.abs(dx * zone.cr - dz * zone.sr) + 0.8);
      zone.front = Math.max(zone.front, dx * zone.sr + dz * zone.cr + 0.8);
    }
  };
  const workZoneContains = (zone, x, y, z, height) => {
    if (!zone.active || y + height <= zone.floor || y >= zone.floor + 3.5) return false;
    const dx = x - zone.x, dz = z - zone.z, across = dx * zone.cr - dz * zone.sr, along = dx * zone.sr + dz * zone.cr;
    const ox = Math.max(Math.abs(across) - zone.half, 0), oz = Math.max(-7 - along, 0, along - zone.front);
    return ox * ox + oz * oz < PLAYER_RADIUS * PLAYER_RADIUS - 1e-9;
  };
  const workZoneSegmentClear = (zone, x, y, z, toX, toY, toZ, height) => {
    const dx = x - zone.x, dz = z - zone.z, vx = toX - x, vz = toZ - z;
    return terrain.segmentBoxClear(dx * zone.cr - dz * zone.sr, y, dx * zone.sr + dz * zone.cr,
      vx * zone.cr - vz * zone.sr, toY - y, vx * zone.sr + vz * zone.cr, PLAYER_RADIUS, height,
      -zone.half, zone.floor, -7, zone.half, zone.floor + 3.5, zone.front);
  };
  const npcClosedCaveAt = (x, z, y = null, height = 1.5) => {
    for (const zone of closedCaveZones) if (workZoneContains(zone, x, y === null ? zone.floor : y, z, height)) return true;
    return false;
  };
  // Cave-mouth frames are narrow structural ledges, not NPC destinations.
  // Recovery may otherwise jump onto the top bar and find no legal walking
  // step back down to the apron.
  const npcCaveRimAt = (x, y, z) => {
    for (let i = 0; i < CAMERA_OPENINGS.length; i++) {
      const entry = CAMERA_OPENINGS[i], m = entry.mouth;
      if (y <= m.floorY + STEP_MAX) continue;
      const dx = x - m.x, dz = z - m.z;
      const across = dx * entry.cr - dz * entry.sr, along = dx * entry.sr + dz * entry.cr;
      if (Math.abs(across) <= 3 + PLAYER_RADIUS && along >= -PLAYER_RADIUS && along <= 1 + PLAYER_RADIUS) return true;
    }
    return false;
  };
  const npcClosedCaveClear = (x, y, z, toX, toY, toZ, height) => {
    for (const zone of closedCaveZones) {
      // A released player may already be beside the boards. Keep the way out open.
      if (workZoneContains(zone, x, y, z, height)) {
        const dx = x - zone.x, dz = z - zone.z, tx = toX - zone.x, tz = toZ - zone.z;
        const across = Math.abs(dx * zone.cr - dz * zone.sr), toAcross = Math.abs(tx * zone.cr - tz * zone.sr);
        const along = dx * zone.sr + dz * zone.cr, toAlong = tx * zone.sr + tz * zone.cr;
        if (toAlong >= along - 1e-7 || toAcross > across + 1e-7) continue;
        return false;
      }
      if (!workZoneSegmentClear(zone, x, y, z, toX, toY, toZ, height)) return false;
    }
    return true;
  };
  const npcWorkZoneAt = (cave, x, y, z) => {
    if (!workZoneTraveler(cave)) return false;
    for (const zone of workZones) if (workZoneContains(zone, x, y, z, cave.bodyHeight)) return true;
    return false;
  };
  const npcWorkZoneClear = (cave, x, y, z, toX, toY, toZ) => {
    if (!workZoneTraveler(cave)) return true;
    const p = cave.root.position, feet = p.y - cave.baseY;
    for (const zone of workZones) {
      // A shift may start around someone. Their exit remains open.
      if (!zone.active || workZoneContains(zone, p.x, feet, p.z, cave.bodyHeight)) continue;
      if (!workZoneSegmentClear(zone, x, y, z, toX, toY, toZ, cave.bodyHeight)) return false;
    }
    return true;
  };
  const npcWorkDetour = (cave, tx, tz, targetY = cave.root.position.y - cave.baseY) => {
    const out = cave.avoidance.detour, p = cave.root.position, feet = p.y - cave.baseY;
    if (!workZoneTraveler(cave)) { out.site = -1; return false; }
    if (out.goalX !== tx || out.goalZ !== tz) { out.site = -1; out.goalX = tx; out.goalZ = tz; }
    if (out.site < 0) {
      for (let i = 0; i < workZones.length; i++) {
        const zone = workZones[i];
        if (!zone.active) continue;
        const inside = workZoneContains(zone, p.x, feet, p.z, cave.bodyHeight);
        const path = cave.pathing;
        if (!inside && workZoneSegmentClear(zone, p.x, feet, p.z, tx, targetY, tz, cave.bodyHeight)
          && (path.tx !== tx || path.tz !== tz || workZoneSegmentClear(zone, p.x, feet, p.z, path.targetX, targetY, path.targetZ, cave.bodyHeight))) continue;
        const localX = (p.x - zone.x) * zone.cr - (p.z - zone.z) * zone.sr;
        out.site = i; out.phase = 0; out.entryX = inside ? localX : (localX < 0 ? -1 : 1) * (zone.half + 0.9);
        out.side = (tx - zone.x) * zone.cr - (tz - zone.z) * zone.sr < 0 ? -1 : 1;
        cave.avoidance.navigation.mode = 0; cave.avoidance.tx = NaN;
        break;
      }
      if (out.site < 0) return false;
    }
    const zone = workZones[out.site];
    if (!zone.active) { out.site = -1; cave.pathing.tx = NaN; return false; }
    // Two front corners avoid both the line of fire and the occupied fan.
    // Keep this direct detour until its original goal, so painted-path hints
    // cannot pull the walker back toward an intermediate point inside it.
    if (out.phase === 0) {
      out.x = zone.x + zone.cr * out.entryX + zone.sr * (zone.front + 0.9);
      out.z = zone.z - zone.sr * out.entryX + zone.cr * (zone.front + 0.9);
      if (Math.hypot(out.x - p.x, out.z - p.z) < 0.12) out.phase = 1;
    }
    if (out.phase === 1) {
      if (workZoneSegmentClear(zone, p.x, feet, p.z, tx, targetY, tz, cave.bodyHeight)) out.phase = 2;
      else {
        const x = out.side * (zone.half + 0.9), z = zone.front + 0.9;
        out.x = zone.x + zone.cr * x + zone.sr * z; out.z = zone.z - zone.sr * x + zone.cr * z;
        if (Math.hypot(out.x - p.x, out.z - p.z) < 0.12) out.phase = 2;
      }
    }
    if (out.phase === 2) { out.x = tx; out.z = tz; }
    cave.pathing.tx = NaN; cave.pathing.index = cave.pathing.count;
    cave.pathing.targetX = out.x; cave.pathing.targetZ = out.z;
    return true;
  };
  const npcDestinationBlocked = (cave, x, z) => {
    // Stroll destinations are on the surface. Evaluate their own floor,
    // not the walker's current elevation at the bottom of a staircase.
    const feet = island.surfaceAt(x, z);
    return npcClosedCaveAt(x, z, feet, cave.bodyHeight) || npcPileAt(x, feet, z, cave.bodyHeight) || npcWorkZoneAt(cave, x, feet, z) || !npcFireClear(x, feet, z, x, feet, z, cave.bodyHeight) || !walkable(x, z, x, z, feet, cave.bodyHeight, cave);
  };
  const npcWalkable = (fromX, fromZ, toX, toZ, y, height, actor) => {
    if (!walkable(fromX, fromZ, toX, toZ, y, height, actor)) return false;
    // Sweep to the actual downhill support too. Checking at the previous,
    // higher floor can clear a move whose lowered torso intersects the wall.
    const feet = playerSupportAt(toX, toZ, y, y, actor);
    if (!npcClosedCaveClear(fromX, y, fromZ, toX, feet, toZ, height)) return false;
    if (!npcWorkZoneClear(actor, fromX, y, fromZ, toX, feet, toZ)) return false;
    if (!npcFireClear(fromX, y, fromZ, toX, feet, toZ, height)) return false;
    // Voluntary walkers go around fruit. A growing pile or a landing may put
    // one inside; keep their way out passable rather than trapping them.
    if (!npcPileAt(fromX, y, fromZ, height)) {
      const steps = Math.max(1, Math.ceil(Math.hypot(toX - fromX, toZ - fromZ) / 0.15));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (npcPileAt(lerp(fromX, toX, t), lerp(y, feet, t), lerp(fromZ, toZ, t), height)) return false;
      }
    }
    // Supported ascent lifts onto a tread before moving across it. A diagonal
    // torso sweep from the old floor would falsely hit a legal half-metre
    // riser at its outer corner. Descents still sweep the actual falling edge.
    const sweepY = Math.max(y, feet);
    return island.clearAt(toX, feet + 1e-5, toZ, 0, 0.01) && island.clearAt(toX, feet + 0.3, toZ, PLAYER_RADIUS, height - 0.3)
      && (feet <= y || island.clearAt(fromX, sweepY + 0.3, fromZ, PLAYER_RADIUS, height - 0.3))
      && island.voxelSegmentClearAt(fromX, sweepY + 0.3, fromZ, toX, feet + 0.3, toZ, PLAYER_RADIUS, height - 0.3);
  };
  // The route graph describes connected architecture. Scenery and other
  // walkers are avoided by the same swept steps used during the actual walk.
  const sleepRouteClear = (fromX, fromZ, toX, toZ, y, height) => {
    const feet = Math.max(y, supportAt(toX, toZ, y), bedSupportAt(toX, toZ, y, STEP_MAX, PLAYER_RADIUS));
    return !crossesSealedCave(fromX, fromZ, toX, toZ, y) && feet - y <= STEP_MAX && feet + height <= Math.min(island.ceilingAt(toX, feet, toZ, PLAYER_RADIUS), entranceCeilingAt(toX, toZ, feet, PLAYER_RADIUS), bedCeilingAt(toX, toZ, feet, PLAYER_RADIUS)) + 1e-7 && island.clearAt(toX, feet + STEP_MAX, toZ, PLAYER_RADIUS, Math.max(0, height - STEP_MAX));
  };
  // Upward thrust follows the outside of the spherical underside. Slide out
  // beneath its voxel notches before rising, with the same full-body clearance
  // as ordinary flight; interior ceilings and unsupported idle falls stay put.
  const glideJetCeiling = (cave, dt) => {
    const p = cave.root.position, feet = p.y - cave.baseY, height = cave.bodyHeight + Math.max(0, cave.viewLift);
    if (feet >= 0 || !abyssAt(p.x, p.z, feet)) return false;
    const ceiling = ceilingAt(p.x, p.z, feet), radius = Math.hypot(p.x, p.z);
    if (!radius || ceiling - feet - height > 0.15) return false;
    const distance = JET_SPEED * dt, x = p.x + p.x / radius * distance, z = p.z + p.z / radius * distance;
    if (!flyable(p.x, p.z, x, z, feet, height, cave) || !island.voxelSegmentClearAt(p.x, feet, p.z, x, feet, z, PLAYER_RADIUS, height)) return false;
    p.x = x; p.z = z;
    return true;
  };
  // Clouds ring the island without crossing it
  const buildClouds = () => {
    const rand = mulberry32(SEED + 77);
    const surfaces = new Map();
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const beside = i % 2 === 0;
      const out = (rand() < 0.5 ? -1 : 1) * lerp(CLOUD_NEAR, CLOUD_WRAP, rand());
      const span = lerp(-CLOUD_WRAP, CLOUD_WRAP, rand());
      const y = beside ? lerp(-4, 6, rand()) : lerp(2, 8, rand());
      const node = createNode({ position: { x: beside ? out : span, y, z: beside ? span : -Math.abs(out) }, geometry: hubModels.cloud(Math.min(2, i % 4)), matrixCloud: true });
      let surface = surfaces.get(node.geometry);
      if (!surface) {
        const tops = [], bounds = [Infinity, Infinity, -Infinity, -Infinity], v = node.geometry.verts;
        for (const face of node.geometry.faces) {
          const a = face.i[0] * 3, b = face.i[1] * 3, c = face.i[2] * 3;
          if ((v[b + 2] - v[a + 2]) * (v[c] - v[a]) - (v[b] - v[a]) * (v[c + 2] - v[a + 2]) <= 0) continue;
          let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
          for (const vertex of face.i) {
            minX = Math.min(minX, v[vertex * 3]); maxX = Math.max(maxX, v[vertex * 3]);
            minZ = Math.min(minZ, v[vertex * 3 + 2]); maxZ = Math.max(maxZ, v[vertex * 3 + 2]);
          }
          tops.push(minX, minZ, maxX, maxZ, v[a + 1]);
          bounds[0] = Math.min(bounds[0], minX); bounds[1] = Math.min(bounds[1], minZ);
          bounds[2] = Math.max(bounds[2], maxX); bounds[3] = Math.max(bounds[3], maxZ);
        }
        let centerTop = -Infinity;
        for (let j = 0; j < tops.length; j += 5) if (tops[j] <= 0 && tops[j + 2] >= 0 && tops[j + 1] <= 0 && tops[j + 3] >= 0) centerTop = Math.max(centerTop, tops[j + 4]);
        surface = { tops: new Float64Array(tops), bounds: new Float64Array(bounds), centerTop };
        surfaces.set(node.geometry, surface);
      }
      addChild(root, node);
      placed.push(node);
      clouds.push({ node, speed: 0.4 + rand() * 0.4, beside, tops: surface.tops, bounds: surface.bounds, centerTop: surface.centerTop, dx: 0, dz: 0, wrapped: false });
    }
  };
  const chooseJetpackCloud = (exclude) => {
    let chosen = null, nearest = Infinity;
    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i], p = cloud.node.position, radius = Math.hypot(p.x, p.z);
      if (cloud === exclude || !Number.isFinite(cloud.centerTop) || radius < JETPACK_FAR || radius >= nearest) continue;
      chosen = cloud;
      nearest = radius;
    }
    if (chosen) return chosen;
    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i], p = cloud.node.position, radius = Math.hypot(p.x, p.z);
      if (cloud !== exclude && Number.isFinite(cloud.centerTop) && radius < nearest) { chosen = cloud; nearest = radius; }
    }
    if (!chosen) throw new Error("No cloud can support the jetpack");
    return chosen;
  };
  const attachJetpackToCloud = (exclude = null) => {
    const host = chooseJetpackCloud(exclude), p = host.node.position;
    lastJetpackCloud = host;
    jetpack.host = host;
    jetpack.falling = false;
    jetpack.vy = 0;
    jetpack.x = jetpack.owner.x = jetpack.node.position.x = p.x;
    jetpack.z = jetpack.owner.z = jetpack.node.position.z = p.z;
    jetpack.node.position.y = p.y + host.centerTop + JETPACK_HOVER;
  };
  const spawnJetpackPickup = (exclude = null) => {
    if (jetpackState.owned || jetpack) return;
    const node = place(hubModels.jetpack(), 0, 0, 0, 0, "jetpack", 1);
    jetpack = { node, owner: props[props.length - 1], host: null, x: 0, z: 0, vy: 0, falling: false };
    attachJetpackToCloud(exclude);
    trackMirrorObject(node, 2);
    refreshObjectGuides();
  };
  const dropJetpackFromCloud = (cloud, x, z) => {
    if (!jetpack || jetpack.host !== cloud) return;
    jetpack.host = null;
    jetpack.falling = true;
    jetpack.vy = 0;
    jetpack.x = jetpack.owner.x = jetpack.node.position.x = x;
    jetpack.z = jetpack.owner.z = jetpack.node.position.z = z;
  };
  const updateClouds = (dt) => {
    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i], p = cloud.node.position;
      cloud.dx = cloud.beside ? 0 : cloud.speed * dt;
      cloud.dz = cloud.beside ? cloud.speed * dt : 0;
      p.x += cloud.dx; p.z += cloud.dz;
      cloud.wrapped = cloud.beside ? p.z > CLOUD_WRAP : p.x > CLOUD_WRAP;
      if (cloud.wrapped) {
        dropJetpackFromCloud(cloud, p.x, p.z);
        if (cloud.beside) p.z -= CLOUD_WRAP * 2;
        else p.x -= CLOUD_WRAP * 2;
      }
    }
  };
  // A low stone dais and its flush, one block-wide perimeter grow continuously with the pile.
  const buildAltar = () => {
    const node = createNode();
    const slab = createNode({ geometry: hubModels.altarSlab(), depthBias: 0.15 });
    const rings = [];
    addChild(node, slab);
    for (let i = 0; i < 3; i++) {
      const ring = createNode({ geometry: hubModels.altarBlock(i), instanceData: new Float32Array(Math.ceil(ALTAR_MAX_BLOCKS / 3) * 20), instanceCount: 0, instanceVersion: 0, depthBias: 0.2 });
      rings.push(ring);
      addChild(node, ring);
    }
    addChild(root, node);
    placed.push(node);
    const result = { node, slab, rings, radius: 0, platformRadius: 0, outerRingRadius: 0, outerRingInnerRadius: 0, height: ALTAR_HEIGHT, ringCount: 1, blockCount: 0, setRadius: null };
    result.setRadius = (radius) => {
      result.radius = radius;
      const halfWidth = ALTAR_BLOCK_WIDTH * 0.5;
      const outer = radius + ALTAR_RING_GAP + halfWidth;
      const wanted = Math.min(ALTAR_MAX_BLOCKS, Math.max(8, Math.round(outer * Math.PI * 2 / ALTAR_BLOCK_ARC)));
      const arc = outer * Math.PI * 2 / wanted * 0.88;
      result.blockCount = wanted;
      result.outerRingRadius = outer;
      result.outerRingInnerRadius = outer - halfWidth;
      result.platformRadius = outer + halfWidth;
      setVec(slab.scale, result.outerRingInnerRadius, ALTAR_HEIGHT, result.outerRingInnerRadius);
      for (let i = 0; i < rings.length; i++) rings[i].instanceCount = 0;
      for (let i = 0; i < wanted; i++) {
        const angle = i / wanted * Math.PI * 2;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const ring = rings[i % rings.length];
        const offset = ring.instanceCount++ * 20;
        const data = ring.instanceData;
        data[offset] = cos * ALTAR_BLOCK_WIDTH;
        data[offset + 1] = 0;
        data[offset + 2] = sin * ALTAR_BLOCK_WIDTH;
        data[offset + 3] = 0;
        data[offset + 4] = 0;
        data[offset + 5] = ALTAR_HEIGHT;
        data[offset + 6] = 0;
        data[offset + 7] = 0;
        data[offset + 8] = -sin * arc;
        data[offset + 9] = 0;
        data[offset + 10] = cos * arc;
        data[offset + 11] = 0;
        data[offset + 12] = cos * outer;
        data[offset + 13] = 0;
        data[offset + 14] = sin * outer;
        data[offset + 15] = 1;
        data[offset + 16] = 1;
        data[offset + 17] = 0;
        data[offset + 18] = 0;
        data[offset + 19] = 0;
      }
      for (let i = 0; i < rings.length; i++) rings[i].instanceVersion++;
    };
    result.setRadius(PILE_SCALE);
    return result;
  };

  // ---------- donations ----------
  const celebrate = (donation, bananas) => {
    for (const cave of crew.workingCavemen()) {
      if (cave.build) continue;
      cave.cheer = 1.6;
      fx.say(cave, ["OOGA!", "BOOGA!", "BANANA!"][fnv1a(`${donation.id}/${cave.traits.name}`) % 3], 1.8);
    }
    fx.burst(0, DROP_HEIGHT - 0.2, 0, 26, CONFETTI, 2.2);
    fx.showTicker(`THANKS ${donation.handle ? "@" + donation.handle.toUpperCase() : "ANON"} · ${bananas} BANANAS`, 4.5);
  };
  const onDonation = (donation) => {
    game.recordDonation(donation);
    const bananas = gameMod.bananasFor(donation.sats);
    pile.deliverBananas(bananas);
    celebrate(donation, bananas);
    const loot = lootEnabled ? game.lootFor(donation) : null;
    const who = donation.handle ? `@${donation.handle}` : "anon";
    hud.toast(`+${gameMod.formatLarge(donation.sats)} sats · ${bananas} banana${bananas > 1 ? "s" : ""} · ${who}${loot ? ` · ${loot.tier} crate!` : ""}`);
    if (loot) crates.spawnCrate(donation, loot, 0.9 + Math.min(1.5, bananas / pileMod.DROP_RATE));
    hud.setStats(game.state);
  };

  // ---------- caves ----------
  const tooltipFor = (hit) => {
    const o = hit.owner;
    switch (o.kind) {
      case "caveman":
        return o.cave.traits.name;
      case "crate":
        return `${o.crate.loot.tier} crate · tap to open`;
      case "cave":
        return o.slot.status === "open" ? `${o.slot.name} · tap to enter` : o.slot.status === "headquarters" ? "Headquarters · walk down the ramp" : o.slot.status === "mirror" ? `${o.slot.name} · mirror` : o.slot.status === "sleeping" ? "A project sleeps here · zzz" : "An empty cave";
      case "gate":
        return `${caves.gate.name} · leads nowhere yet`;
      case "matrix-button":
        return matrixCave.unlocked ? "Matrix gate control · press out" : "Matrix gate control · press in";
      case "matrix-gate":
        return "Glyph gate · tap or press Space nearby to open";
      case "room-sign":
        return "Room sign";
      case "prop":
        return PROP_TIPS[o.prop] || "";
      default:
        return "";
    }
  };
  // ---------- props ----------
  const wobble = (node, amp) => {
    if (node.busy) return false;
    node.busy = true;
    const z0 = node.rotation.z;
    addTween({
      dur: 0.6, update: (k) => {
        node.rotation.z = z0 + Math.sin(k * Math.PI * 3) * (1 - k) * amp;
      }, done: () => {
        node.rotation.z = z0;
        node.busy = false;
      }
    });
    return true;
  };
  // Drop a banana from a tree or bush
  const dropBanana = (o, chance) => {
    if (now < o.ripe || Math.random() > chance) return false;
    o.ripe = now + RIPEN;
    pile.deliverBananas(1);
    hud.toast("A banana fell out and rolled to the pile!");
    return true;
  };
  const reactProp = (o) => {
    if (o.breakable) {
      hud.toast("Swing your melee weapon or shoot to break it");
      return;
    }
    const w = o.node.world;
    const x = w[12], z = w[14];
    const foundMagazine = (o.prop === "tree" || o.prop === "bush") && revealMagazine(o);
    switch (o.prop) {
      case "tree":
        if (!wobble(o.node, 0.1)) return;
        fx.burst(x, 2.6, z, 10, [LEAF], 1.6);
        if (RENDER_OPTS.stars > NIGHT) critters.burst(x, z);
        if (!foundMagazine && !dropBanana(o, TREE_CHANCE)) hud.toast("Leaves. Just leaves.");
        break;
      case "bush":
        if (!wobble(o.node, 0.25)) return;
        fx.burst(x, w[13] + 0.7, z, 6, [LEAF], 1.2);
        if (!foundMagazine && !dropBanana(o, BUSH_CHANCE)) hud.toast(BUSH_WORDS[fnv1a(`${o.x}/${o.z}/${Math.floor(now)}`) % BUSH_WORDS.length]);
        break;
      case "rock":
        fx.burst(x, 0.6, z, 6, [CHIP], 1.4);
        hud.toast("Solid rock. Ow.");
        break;
      case "jumbotron":
        if (jumbotron) jumbotron.nextView();
        break;
      case "crate":
        if (!wobble(o.node, 0.12)) return;
        fx.burst(x, 0.9, z, 5, [DUST], 1);
        hud.toast("Locked. Ooga knows the code.");
        break;
      case "barrel":
        if (!wobble(o.node, 0.3)) return;
        hud.toast("Empty. Ooga drank it.");
        break;
      case "flower":
        if (!wobble(o.node, 0.4)) return;
        fx.burst(x, 0.35, z, 8, PETALS, 1.1);
        break;
      case "torch":
        o.node.flare = 1;
        fx.burst(x, w[13] + 1.4, z, 8, [SPARK], 1.3);
        break;
      case "firepit":
        if (RENDER_OPTS.torch < 0.5) {
          hud.toast("Cold ashes. Ooga waits for night.");
          break;
        }
        fire.node.flare = 1;
        fx.burst(x, 0.9, z, 10, [SPARK], 1.6);
        hud.toast("Warm. Ooga likes.");
        break;
      case "bedroll":
        hud.toast("Somebody's bed. Ooga leaves it.");
        break;
      case "ladder":
        if (!wobble(o.lean, 0.05)) return;
        hud.toast("Wobbly. Ooga does not climb.");
        break;
      case "dock":
        hud.toast("The planks creak over the drop.");
        break;
      case "jetpack":
        hud.toast(pilot.player ? "Jump into it to collect it." : "Double-tap an Ooga, then jump into it.");
        break;
      case "magazine":
        hud.toast(pilot.player ? "Walk into it to collect it." : "Double-tap an Ooga, then walk into it.");
        break;
      case "gate":
        hud.toast(`${caves.gate.name} · leads nowhere yet`);
        break;
      case "plane":
      case "sign":
        enterLaunch();
        break;
      case "launchpad":
      case "rocket":
      case "tower":
      case "orbitsign":
        enterLaunch("orbit");
        break;
      case "bridge":
        hud.toast("The planks sway. Ooga NASA built it.");
        break;
      case "windsock":
        hud.toast("A fair wind for a drop.");
        break;
      default:
        break;
    }
  };
  const useProp = (o) => {
    if (!o.active) return;
    reactProp(o);
  };
  const WAKE_ACTION = { kind: "wake" }, ROLL_ACTION = { kind: "roll" }, STAND_ACTION = { kind: "stand" };
  const nearbyAction = (x, y, z, reach) => {
    const player = pilot.player;
    if (player && player.camp.burning) return ROLL_ACTION;
    if (player && player.camp.seat) return STAND_ACTION;
    if (player && crew.sleeping) return WAKE_ACTION;
    if (player && pilot.moving) return null;
    if (player && player.hop < 0.03 && player.hopV <= 0 && headquarters) {
      const feet = player.root.position.y - player.baseY;
      const floor = bedSupportAt(x, z, feet + 0.04, 0, PLAYER_RADIUS);
      if (Math.abs(feet - floor) < 0.08) for (const bed of headquarters.mattresses) {
        if (bed.sleeper && bed.sleeper !== player || !bed.node.visible || bed.node.parent !== root) continue;
        const dx = x - bed.x, dz = z - bed.z, lx = dx * bed.cr - dz * bed.sr, lz = dx * bed.sr + dz * bed.cr;
        if (Math.abs(lx) < bed.width / 2 && Math.abs(lz) < bed.depth / 2 && Math.abs(floor - bed.y - bed.sleep.surface) < bed.sleep.pillowTop) return bed;
      }
    }
    if (player) {
      const gate = nearbyMatrixGate(x, y, z, reach);
      if (gate) return gate;
    }
    if (matrixControl && matrixControlNear(x, y, z, reach)) return matrixControl;
    if (player && player.hop < 0.03 && player.hopV <= 0 && headquarters) {
      let nearest = null, distance = Math.min(reach, 1.5) ** 2;
      for (const seat of headquarters.benches) {
        const d = (x - seat.x) ** 2 + (z - seat.z) ** 2;
        if (!seat.sitter && d < distance && Math.abs(y - 1.1 - seat.floor) < 0.7) { nearest = seat; distance = d; }
      }
      if (nearest) return nearest;
    }
    for (let i = 0; i < openMouths.length; i++) {
      const entry = openMouths[i], m = entry.m;
      if (entry.slot.scene === "race" && actionWithinReach(x, y, z, entry.actionX, m.floorY + 1.1, entry.actionZ, RALLY_REACH)) return entry;
    }
    for (let i = 0; i < launchers.length; i++) {
      const launcher = launchers[i];
      if (actionWithinReach(x, y, z, launcher.x, launcher.y + 1.1, launcher.z, LAUNCH_REACH)) return launcher;
    }
    return null;
  };
  const useNearbyAction = (action) => {
    if (action === WAKE_ACTION) crew.wakePlayer();
    else if (action === ROLL_ACTION) crew.dropRoll();
    else if (action === STAND_ACTION) crew.standPlayer();
    else if (action.kind === "bench") crew.sitPlayer(action);
    else if (action.sleep) crew.sleepPlayer(action);
    else if (action.kind === "matrix-gate") {
      action.localOpen = action.open = action.raising = true;
      hud.toast("The glyph gate rises.");
    } else if (action === matrixControl) toggleMatrixControl();
    else if (action.slot) enterCave(action.slot);
    else enterLaunch(action.scene);
  };
  const freeAction = () => {
    const action = nearbyAction(camera.position.x, camera.position.y, camera.position.z, MATRIX_BUTTON_REACH);
    if (!action) return false;
    useNearbyAction(action);
    return true;
  };
  // Stationary functional controls take priority over a jump or jetpack thrust.
  const useNear = (x, z, reach, feetY) => {
    const action = nearbyAction(x, feetY + 1.1, z, reach);
    if (!action) return false;
    useNearbyAction(action);
    return true;
  };
  // Dolly onto a view, then change scene
  const enterScene = (view, id) => {
    if (entering) return;
    entering = true;
    pilot.release(true);
    hud.tooltip.hide();
    const orbit = pilot.orbit;
    const from = { x: orbit.tx, y: orbit.ty, z: orbit.tz, dist: orbit.dist, yaw: orbit.yaw };
    const turn = Math.atan2(Math.sin(view.yaw - from.yaw), Math.cos(view.yaw - from.yaw));
    orbit.target = view.target;
    orbit.tYaw = from.yaw + turn;
    orbit.tPitch = view.pitch;
    orbit.tDist = ENTER_DIST;
    enteringTween = addTween({
      dur: ENTER_DUR, ease: ease.inOutQuad, update: (k) => {
        orbit.tx = lerp(from.x, view.target.x, k);
        orbit.ty = lerp(from.y, view.target.y, k);
        orbit.tz = lerp(from.z, view.target.z, k);
        orbit.dist = lerp(from.dist, ENTER_DIST, k);
        orbit.yaw = from.yaw + turn * k;
      }, done: () => { enteringTween = null; go(id); }
    });
  };
  const enterCave = (slot) => enterScene(presets[slot.scene], slot.scene);
  // The Ooga at the wheel flies the plane, or rides the rocket
  const enterLaunch = (id = "drop") => {
    if (entering) return;
    world.pilot = pilot.player ? pilot.player.traits.name : null;
    enterScene(presets[id], id);
  };
  const onTap = (hit) => {
    if (!hit) return;
    const o = hit.owner;
    switch (o.kind) {
      case "caveman":
        crew.pokeCave(o.cave);
        // Poked Oogas get their stats on the big screen.
        if (jumbotron) jumbotron.showContributor(o.cave.traits.name);
        break;
      case "crate":
        crates.openCrate(o.crate);
        break;
      case "cave":
        if (o.slot.status === "open") enterCave(o.slot);
        else hud.toast(tooltipFor(hit));
        break;
      case "gate":
        hud.toast(tooltipFor(hit));
        break;
      case "matrix-button":
        toggleMatrixControl();
        break;
      case "matrix-gate": {
        const player = pilot.player;
        if (player && nearbyMatrixGate(player.root.position.x, player.root.position.y + 1.1 - player.baseY, player.root.position.z, MATRIX_BUTTON_USE_REACH) === o.gate) useNearbyAction(o.gate);
        else hud.toast(player ? "Move closer to open this gate." : "Double-tap an Ooga, then move close to open the gate.");
        break;
      }
      case "prop":
        useProp(o);
        break;
      default:
        break;
    }
  };

  // ---------- camera bounds ----------
  const CAMERA_RADIUS = 0.3, CAMERA_FLOOR = 0.55, CAMERA_STEP_FLOOR = CAMERA_RADIUS + 0.02, CAMERA_VERTICAL_RATE = 3.2, CAMERA_HORIZONTAL_RATE = 8;
  const CAMERA_RECOVERY_SPEED = 16, CAMERA_TRAIL_CAPACITY = 96;
  const CAMERA_PREVIOUS = { x: 0, y: 0, z: 0 };
  const CAMERA_REQUESTED = { x: 0, y: 0, z: 0 };
  const CAMERA_FROM = { x: 0, y: 0, z: 0 };
  const CAMERA_VOLUME_FROM = { x: 0, y: 0, z: 0 };
  const CAMERA_RECOVERY = { x: 0, y: 0, z: 0 };
  const CAMERA_MANUAL_VIEW = { x: 0, y: 0, z: 0 }, CAMERA_MANUAL_BODY = { x: 0, y: 0, z: 0 };
  const CAMERA_TRAIL = new Float64Array(CAMERA_TRAIL_CAPACITY * 3);
  let cameraTrailPlayer = null, cameraTrailCount = 0, cameraTrailNext = 0, cameraTrailSleeping = false, cameraManualContact = false;
  let cameraUnrestricted = false, cameraReentering = false;
  const PLAYER_PREVIOUS = { x: 0, y: 0, z: 0 }, PLAYER_POSITION = { x: 0, y: 0, z: 0 };
  const CAMERA_SPACE = { floor: 0, ceiling: 0 }, CAMERA_COLUMN = { caveIndex: 0, floor: 0, ceiling: 0 };
  const CAMERA_CROSSING = { direction: 0, valid: false, reason: null, amount: 0 };
  const CAMERA_OPENINGS = [];
  const CAMERA_RAMP_CELLS = new Map();
  const buildCameraRamps = () => {
    CAMERA_RAMP_CELLS.clear();
    const v = island.geometry.verts, unit = island.unit;
    const rampFaces = islandFaceIndex().ramps;
    for (let n = 0; n < rampFaces.length; n++) {
      const face = rampFaces[n];
      const a = face.i[0] * 3, b = face.i[1] * 3, c = face.i[2] * 3;
      const key = Math.floor((v[a] + v[b] + v[c]) / (3 * unit)) * 512 + Math.floor((v[a + 2] + v[b + 2] + v[c + 2]) / (3 * unit));
      let faces = CAMERA_RAMP_CELLS.get(key);
      if (!faces) CAMERA_RAMP_CELLS.set(key, faces = []);
      faces.push(face);
    }
  };
  const playerOnAccessRamp = (player) => {
    if (!player || crew.sleeping) return false;
    const p = player.root.position, feet = p.y - player.baseY, v = island.geometry.verts, unit = island.unit, radius = PLAYER_RADIUS;
    for (let x = Math.floor((p.x - radius) / unit); x <= Math.floor((p.x + radius) / unit); x++) for (let z = Math.floor((p.z - radius) / unit); z <= Math.floor((p.z + radius) / unit); z++) {
      const faces = CAMERA_RAMP_CELLS.get(x * 512 + z);
      if (!faces) continue;
      for (const face of faces) {
        const a = face.i[0] * 3, b = face.i[1] * 3, c = face.i[2] * 3;
        const ux = v[b] - v[a], uz = v[b + 2] - v[a + 2], vx = v[c] - v[a], vz = v[c + 2] - v[a + 2], det = ux * vz - uz * vx;
        let tx = p.x, tz = p.z;
        const u = ((tx - v[a]) * vz - (tz - v[a + 2]) * vx) / det, w = (ux * (tz - v[a + 2]) - uz * (tx - v[a])) / det;
        if (u < 0 || w < 0 || u + w > 1) {
          let distance = Infinity;
          for (let edge = 0; edge < 3; edge++) {
            const i = face.i[edge] * 3, j = face.i[(edge + 1) % 3] * 3, dx = v[j] - v[i], dz = v[j + 2] - v[i + 2];
            const t = Math.max(0, Math.min(1, ((p.x - v[i]) * dx + (p.z - v[i + 2]) * dz) / (dx * dx + dz * dz)));
            const ex = v[i] + dx * t, ez = v[i + 2] + dz * t, d = (p.x - ex) ** 2 + (p.z - ez) ** 2;
            if (d < distance) { distance = d; tx = ex; tz = ez; }
          }
          if (distance > radius * radius) continue;
        }
        const s = ((tx - v[a]) * vz - (tz - v[a + 2]) * vx) / det, t = (ux * (tz - v[a + 2]) - uz * (tx - v[a])) / det;
        const floor = v[a + 1] + s * (v[b + 1] - v[a + 1]) + t * (v[c + 1] - v[a + 1]);
        if (feet >= floor - STEP_MAX && feet + player.bodyHeight <= Math.min(floor + island.headquarters.ceiling - island.headquarters.floor, island.ceilingAt(p.x, floor + 1e-5, p.z, PLAYER_RADIUS)) + 1e-7) return true;
      }
    }
    // The basement access galleries become level before joining the common
    // area. Their flat floor is voxel-meshed, so it has no slope triangles.
    const basement = island.headquarters.basement;
    if (Math.hypot(p.x, p.z) > basement.room.radius && Math.abs(feet - basement.floor) <= STEP_MAX) for (const ramp of basement.ramps) {
      for (let i = 1; i < ramp.samples.length; i++) {
        const a = ramp.samples[i - 1], b = ramp.samples[i];
        if (a.y !== basement.floor || b.y !== basement.floor) continue;
        const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
        if (Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t) > ramp.width / 2 + radius) continue;
        if (Math.abs(island.supportAt(p.x, p.z, feet, STEP_MAX, ABYSS_FLOOR, radius) - basement.floor) < 1e-6 && island.ceilingAt(p.x, feet, p.z, radius) >= feet + player.bodyHeight) return true;
      }
    }
    return false;
  };
  let cameraCaveIndex = 0, cameraEntranceIndex = 0, cameraPreviousValid = false, cameraTerrainY = 0, cameraTerrainX = 0, cameraTerrainZ = 0, cameraTerrainValid = false, cameraTerrainRecovering = false, cameraTerrainEntranceIndex = 0;
  let caveEntryPlayer = null, playerCaveIndex = 0;
  const cameraCrossing = (from, to, opening, grounded = false) => {
    const m = opening.mouth, sr = opening.sr, cr = opening.cr;
    const a = (from.x - m.x) * sr + (from.z - m.z) * cr - opening.planeZ;
    const b = (to.x - m.x) * sr + (to.z - m.z) * cr - opening.planeZ;
    const direction = a >= -1e-7 && b < -1e-7 ? 1 : a <= 1e-7 && b > 1e-7 ? -1 : 0;
    CAMERA_CROSSING.direction = direction;
    CAMERA_CROSSING.valid = false;
    CAMERA_CROSSING.reason = null;
    if (!direction) return CAMERA_CROSSING;
    const t = Math.max(0, Math.min(1, a / (a - b))), x = lerp(from.x, to.x, t), y = lerp(from.y, to.y, t) - m.floorY, z = lerp(from.z, to.z, t);
    const across = (x - m.x) * cr - (z - m.z) * sr;
    const floor = opening.headquarters && island.cavityAt(x, z, CAMERA_COLUMN, island.headquarters.caveIndex, y + m.floorY) ? CAMERA_COLUMN.floor - m.floorY - 1e-6 : opening.minY;
    // Feet follow the bend from the flat apron onto the slope. Their straight
    // frame-to-frame sweep cuts just below that bend even while fully supported.
    const followsRamp = grounded && opening.headquarters && Math.abs(from.y - supportAt(from.x, from.z, from.y)) < 1e-6 && Math.abs(to.y - supportAt(to.x, to.z, to.y)) < 1e-6;
    CAMERA_CROSSING.amount = t;
    if (y < floor && !followsRamp) CAMERA_CROSSING.reason = "below";
    else if (y > opening.maxY) CAMERA_CROSSING.reason = "above";
    else if (across < opening.minX || across > opening.maxX) CAMERA_CROSSING.reason = "beside";
    else if (opening.blocked) CAMERA_CROSSING.reason = "sealed";
    else if (caveColumnAt(x - sr * 0.05, z - cr * 0.05, opening, y + m.floorY)) CAMERA_CROSSING.valid = true;
    return CAMERA_CROSSING;
  };
  const setMatrixInside = (inside) => {
    if (!matrixCave) return;
    const portal = matrixCave.portal;
    if (portal.inside === inside) return;
    portal.inside = inside;
    portal.lastCrossingDirection = inside ? "in" : "out";
    const global = inside || matrixCave.unlocked;
    MATRIX_WORLD.livingGlobal = global ? 1 : 0;
    MATRIX_WORLD.direction = global ? MATRIX_WORLD.radius < MATRIX_WORLD.maxRadius ? 1 : 0 : MATRIX_WORLD.radius > 0 ? -1 : 0;
    MATRIX_WORLD.active = global || MATRIX_WORLD.radius > 0 ? 1 : 0;
    // Exiting an unlatched room closes the glass immediately; reentry resumes
    // its reveal only once the outward world front reaches the mirror.
    if (!inside && !matrixCave.unlocked && !mirrorCave.damage.broken) {
      matrixCave.mirrorNode.mirrorReveal = 0;
      matrixCave.mirrorNode.mirrorPortal = false;
    }
  };
  const setMatrixUnlocked = (unlocked, quiet = false) => {
    if (!matrixCave || !matrixControl || matrixCave.unlocked === unlocked) return false;
    matrixCave.unlocked = unlocked;
    MATRIX_WORLD.livingGlobal = unlocked || matrixCave.portal.inside ? 1 : 0;
    matrixControl.pressed = unlocked;
    matrixControl.button.matrixLiving = unlocked;
    matrixControl.button.glow = unlocked ? 1 : 0.25;
    matrixControl.button.highlight = unlocked ? 0.8 : 0;
    for (let i = 0; i < matrixGates.length; i++) {
      const gate = matrixGates[i];
      // The inside switch explicitly raises the mirror bars even while glass
      // is intact. The outside nearby release still requires the glass lock.
      if (gate === mirrorCave.gate) {
        gate.localOpen = gate.open = gate.raising = unlocked;
        continue;
      }
      gate.open = unlocked && !gate.locked;
      gate.raising = unlocked && !gate.locked;
      gate.localOpen = false;
    }
    if (unlocked) {
      MATRIX_WORLD.active = 1;
      MATRIX_WORLD.direction = MATRIX_WORLD.radius < MATRIX_WORLD.maxRadius ? 1 : 0;
      matrixCave.mirrorNode.mirrorReveal = 1;
      matrixCave.mirrorNode.mirrorPortal = true;
    } else if (matrixCave.portal.inside) {
      MATRIX_WORLD.active = 1;
      MATRIX_WORLD.direction = MATRIX_WORLD.radius < MATRIX_WORLD.maxRadius ? 1 : 0;
    } else {
      MATRIX_WORLD.direction = MATRIX_WORLD.radius > 0 ? -1 : 0;
      MATRIX_WORLD.active = MATRIX_WORLD.radius > 0 ? 1 : 0;
      matrixCave.mirrorNode.mirrorReveal = mirrorCave.damage.broken ? 1 : 0;
      matrixCave.mirrorNode.mirrorPortal = mirrorCave.damage.broken;
    }
    if (!quiet) hud.toast(unlocked && !mirrorCave.gate.open ? "The outer glyph gates rise. The mirror gate stays shut."
      : unlocked ? "The glyph gates rise. The Matrix stays." : "The glyph gates descend while the mirror is open.");
    return true;
  };
  const toggleMatrixControl = () => setMatrixUnlocked(!matrixCave.unlocked);
  const respawnAtPile = () => {
    setMatrixUnlocked(false, true);
    setMatrixInside(false);
    // Respawn arrives in the ordinary world immediately, without a retreating
    // wave keeping the pile and the returning character in Matrix mode.
    MATRIX_WORLD.active = MATRIX_WORLD.direction = MATRIX_WORLD.radius = 0;
    navigate("pile");
  };
  const matrixControlNear = (x, y, z, reach = MATRIX_BUTTON_REACH) => !!matrixControl && actionWithinReach(x, y, z, matrixControl.x, matrixCave.mouth.floorY + matrixControl.button.position.y, matrixControl.z, reach);
  const nearbyMatrixGate = (x, y, z, reach) => {
    let nearest = null, distance = reach;
    for (let i = 0; i < matrixGates.length; i++) {
      const gate = matrixGates[i], m = gate.mouth;
      const mirror = gate === mirrorCave.gate;
      if (gate.locked || gate.localOpen || !mirror && (matrixCave.unlocked || !MATRIX_WORLD.active || MATRIX_WORLD.radius < gate.distance)) continue;
      const lx = (x - m.x) * gate.cr - (z - m.z) * gate.sr, lz = (x - m.x) * gate.sr + (z - m.z) * gate.cr;
      // Ordinary gates release from inside. Broken glass exposes the mirror
      // gate's release on either side, even before the Matrix wave is active.
      if (!mirror && lz > gate.node.position.z || y < m.floorY + gate.floor || y > m.floorY + gate.ceiling) continue;
      const across = Math.max(gate.minX, Math.min(gate.maxX, lx)), along = mirror && lz > gate.node.position.z ? gate.maxZ + 0.035 : gate.minZ - 0.035;
      const tx = m.x + across * gate.cr + along * gate.sr, tz = m.z - across * gate.sr + along * gate.cr;
      const d = Math.hypot(tx - x, tz - z);
      if (d >= distance || !actionReachable(x, y, z, tx, y, tz)) continue;
      distance = d; nearest = gate;
    }
    return nearest;
  };
  const matrixGateDescent = (gate, nextY) => {
    const m = gate.mouth, y = gate.node.position.y;
    gate.held = false;
    // Never lower a barrier into an existing body. Hold it just above that
    // head until the footprint clears; the nearby release remains usable.
    for (let caveIndex = 0; caveIndex < crew.list.length; caveIndex++) {
      const cave = crew.list[caveIndex];
      if (!cave.root.visible) continue;
      const p = cave.root.position, feet = p.y - cave.baseY, head = feet + cave.bodyHeight + Math.max(0, cave.viewLift);
      if (feet >= m.floorY + gate.ceiling || head <= m.floorY + nextY + gate.bottom) continue;
      const lx = (p.x - m.x) * gate.cr - (p.z - m.z) * gate.sr, lz = (p.x - m.x) * gate.sr + (p.z - m.z) * gate.cr;
      const ox = Math.max(gate.minX - lx, 0, lx - gate.maxX), oz = Math.max(gate.minZ - lz, 0, lz - gate.maxZ);
      if (ox * ox + oz * oz >= PLAYER_RADIUS * PLAYER_RADIUS - 1e-9) continue;
      const safe = Math.min(y, head - m.floorY - gate.bottom + 0.02);
      if (safe > nextY) { nextY = safe; gate.held = true; }
    }
    return nextY;
  };
  const updateMatrixControl = (dt, player) => {
    if (!matrixControl) return;
    const gateStep = MATRIX_GATE_SPEED * dt;
    for (let i = 0; i < matrixGates.length; i++) {
      const gate = matrixGates[i], y = gate.node.position.y;
      const mirror = gate === mirrorCave.gate;
      if (!mirror && !MATRIX_WORLD.active || gate.locked && !(mirror && matrixCave.unlocked)) gate.localOpen = false;
      gate.open = mirror && matrixCave.unlocked || !gate.locked && (gate.localOpen || !mirror && matrixCave.unlocked);
      const target = !gate.open && (gate.locked || mirror || MATRIX_WORLD.active && MATRIX_WORLD.radius >= gate.distance) ? gate.floor : MATRIX_GATE_HIDDEN_Y;
      gate.held = false;
      gate.node.position.y = y < target ? Math.min(target, y + gateStep) : y > target ? matrixGateDescent(gate, Math.max(target, y - gateStep)) : y;
      gate.raising = gate.node.position.y < target;
      // Gates descend from the actual stone lintel. Their stored overhead
      // sections are clipped in every render pass, including their shadows.
      gate.node.visible = gate.node.position.y + gate.bottom < gate.ceiling && gate.node.position.y + gate.top > gate.floor;
    }
    const buttonY = matrixControl.pressed ? 1.04 : 1.12;
    matrixControl.button.position.y = matrixControl.button.position.y < buttonY ? Math.min(buttonY, matrixControl.button.position.y + dt * 0.5) : Math.max(buttonY, matrixControl.button.position.y - dt * 0.5);
    const subject = player ? player.root.position : camera.position;
    const action = nearbyAction(subject.x, subject.y + (player ? 1.1 - player.baseY : 0), subject.z, player ? MATRIX_BUTTON_USE_REACH : MATRIX_BUTTON_REACH);
    const equipped = !!(player && player.jet);
    const recovering = !!(player && player.jetRecovering);
    if (action === matrixControl.promptAction && player === matrixControl.promptPlayer && equipped === matrixControl.promptJet && recovering === matrixControl.promptRecovering && matrixControl.pressed === matrixControl.promptPressed) return;
    const hadPlayerPrompt = matrixControl.promptAction && matrixControl.promptPlayer;
    matrixControl.near = action === matrixControl;
    matrixControl.promptAction = action;
    matrixControl.promptPlayer = player;
    matrixControl.promptJet = equipped;
    matrixControl.promptRecovering = recovering;
    matrixControl.promptPressed = matrixControl.pressed;
    if (action) {
      if (action === WAKE_ACTION) {
        hud.hint(COARSE ? "Tap WAKE UP! to get up" : "Space wakes up · WASD changes sleeping pose");
        hud.setAct("WAKE UP!");
      } else if (action === ROLL_ACTION) {
        hud.hint(COARSE ? "Tap DROP & ROLL! to put the fire out" : "Press Space to drop and roll until the fire goes out");
        hud.setAct("DROP & ROLL!");
      } else if (action === STAND_ACTION) {
        hud.hint(COARSE ? "Move or tap STAND UP! to get up" : "Move or press Space to stand up");
        hud.setAct("STAND UP!");
      } else if (action.kind === "bench") {
        hud.hint(COARSE ? "Tap SIT to sit facing the fire" : "Press Space to sit facing the fire");
        hud.setAct("SIT");
      } else if (action.sleep) {
        hud.hint(COARSE ? "Tap SLEEP to lie down" : "Press Space to sleep");
        hud.setAct("SLEEP");
      } else if (action.kind === "matrix-gate") {
        hud.hint(COARSE ? "Tap OPEN GATE! to open this gate" : "Press Space to open this gate");
        hud.setAct("OPEN GATE!");
      } else if (action === matrixControl) {
        const label = matrixControl.pressed ? "press it out" : "press it in";
        hud.hint(COARSE ? `Tap the glyph control to ${label}` : `Press Space or tap the control to ${label}`);
        if (player) hud.setAct(matrixControl.pressed ? "PRESS OUT" : "PRESS IN");
      } else {
        const label = action.slot ? "START RALLY" : action.scene === "orbit" ? "BUILD ROCKET" : "FLY PLANE";
        hud.hint(COARSE ? `Tap ${label} to play` : `Press Space to ${action.slot ? "start Ooga Rally" : action.scene === "orbit" ? "build for Ooga Orbit" : "fly Ooga Drop"}`);
        if (player) hud.setAct(label);
      }
    } else if (hadPlayerPrompt || player) pilot.showAct();
  };
  const syncMatrixInside = (player) => {
    if (!matrixCave) return;
    // A controlled Ooga owns the portal in both camera modes. The first-person
    // eye sits forward on the face and follows head-look, which must not open
    // or close the mirror while the body remains stationary.
    setMatrixInside((player ? playerCaveIndex : cameraCaveIndex) === matrixCave.caveIndex);
  };
  const setCameraCave = (index) => {
    if (cameraCaveIndex === index) return;
    cameraCaveIndex = index;
    // Free-camera crossings have no separate character owner, so commit their
    // portal state as soon as the validated camera crossing changes caves.
    // Character views are synchronized after pilot.update, when the active
    // first-person eye or third-person Ooga position is final for this frame.
    if (!pilot || !pilot.player) syncMatrixInside(null);
  };
  const caveColumnAt = (x, z, opening, y) => {
    const dx = x - opening.mouth.x, dz = z - opening.mouth.z;
    const along = dx * opening.sr + dz * opening.cr, across = dx * opening.cr - dz * opening.sr;
    const caveIndex = opening.headquarters ? island.headquarters.caveIndex : opening.caveIndex;
    if (!island.cavityAt(x, z, CAMERA_COLUMN, caveIndex, y) || CAMERA_COLUMN.caveIndex !== caveIndex) {
      // Rotated voxel columns straddle the doorway plane. Uncarved, open-air
      // apron cells there are still traversable; solid cliff columns are not.
      const ground = island.surfaceAt(x, z);
      if (along < opening.planeZ - island.unit * Math.SQRT2 || along > 3 || across < opening.minX || across > opening.maxX || ground !== opening.mouth.floorY) return false;
      CAMERA_COLUMN.floor = ground;
      CAMERA_COLUMN.ceiling = Infinity;
    }
    // A window can continue below an upper ramp after its room metadata ends.
    // A solid roof between the eye and that ramp makes it a different volume.
    if (opening.headquarters && y < CAMERA_COLUMN.floor && island.ceilingAt(x, y, z) <= CAMERA_COLUMN.floor) return false;
    // The original stone frame has its own soffit even where the carved voxel
    // column is open sky. Use the model's real bounds, not the cliff top.
    const rim = opening.rim;
    if (along >= rim.minZ + PORTAL_Z && along <= rim.maxZ + PORTAL_Z && (!opening.headquarters || CAMERA_COLUMN.ceiling > opening.mouth.floorY)) {
      if (across < rim.minX || across > rim.maxX) return false;
      if (!opening.headquarters || along >= opening.planeZ) CAMERA_COLUMN.floor = Math.max(CAMERA_COLUMN.floor, opening.mouth.floorY + rim.floorY);
      CAMERA_COLUMN.ceiling = Math.min(CAMERA_COLUMN.ceiling, opening.mouth.floorY + rim.ceilingY);
    }
    CAMERA_COLUMN.caveIndex = opening.caveIndex;
    return true;
  };
  // Sample the real quarter-unit cavity around the eye, including the open apron.
  // Its floor/roof bounds are independent of the Matrix state and cliff-top height.
  // Eye height keeps a lowered room separate from the main ramp above it.
  const cameraSpaceAt = (x, z, opening, y) => {
    let floor = -Infinity, ceiling = Infinity;
    for (let i = 0; i < 25; i++) {
      const ox = (i % 5 - 2) * CAMERA_RADIUS * 0.5, oz = (Math.floor(i / 5) - 2) * CAMERA_RADIUS * 0.5;
      if (ox * ox + oz * oz > CAMERA_RADIUS * CAMERA_RADIUS + 1e-7) continue;
      const sx = x + ox, sz = z + oz;
      if (!caveColumnAt(sx, sz, opening, y)) return false;
      floor = Math.max(floor, CAMERA_COLUMN.floor);
      ceiling = Math.min(ceiling, CAMERA_COLUMN.ceiling);
    }
    CAMERA_SPACE.floor = floor + (pilot && pilot.player ? lerp(CAMERA_RADIUS, CAMERA_FLOOR, pilot.closeMix) : CAMERA_FLOOR);
    // The clearance samples can miss a voxel corner between probes. Match the
    // full collision footprint so a roof contact lowers the eye before the
    // volume sweep, instead of wedging it against an unseen ceiling step.
    // An open shaft has no floor. Look above the current eye there instead of
    // mistaking rock at the island's underside for an overhead ceiling.
    const base = (Number.isFinite(CAMERA_SPACE.floor) ? CAMERA_SPACE.floor : y) - CAMERA_RADIUS;
    CAMERA_SPACE.ceiling = Math.min(ceiling, island.ceilingAt(x, base, z, CAMERA_RADIUS), entranceCeilingAt(x, z, base, CAMERA_RADIUS)) - CAMERA_RADIUS;
    return CAMERA_SPACE.floor <= CAMERA_SPACE.ceiling;
  };
  const CAMERA_CAVE_DEBUG = {
    get index() { return cameraCaveIndex; },
    get playerIndex() { return playerCaveIndex; },
    get entranceIndex() { return cameraEntranceIndex; },
    get accessRamp() { return playerOnAccessRamp(pilot && pilot.player); },
    get rampAssist() { return false; },
    get transitioning() { return cameraReentering; },
    get constraint() { return cameraCaveIndex ? "interior" : cameraEntranceIndex ? "entrance" : "exterior"; },
    get id() { return cameraCaveIndex ? CAMERA_OPENINGS[cameraCaveIndex - 1].id : null; },
    openings: CAMERA_OPENINGS,
    contains(x, y, z) {
      return !!cameraCaveIndex && caveColumnAt(x, z, CAMERA_OPENINGS[cameraCaveIndex - 1], y) && y >= CAMERA_COLUMN.floor && y < CAMERA_COLUMN.ceiling;
    }
  };
  // The common headquarters room belongs to both ramps. Once a body or eye
  // reaches a ramp, bind it to that ramp's actual entrance instead of keeping
  // whichever entrance happened to seed an HQ navigation arrival.
  const headquartersOpeningAt = (x, z, clearance) => {
    if (Math.hypot(x, z) < island.headquarters.room.radius - 1.25) return null;
    let nearest = null, nearestDistance = Infinity;
    for (let i = 0; i < CAMERA_OPENINGS.length; i++) {
      const opening = CAMERA_OPENINGS[i];
      if (!opening.ramp) continue;
      const samples = opening.ramp.samples;
      for (let n = 0; n < samples.length; n++) {
        const dx = x - samples[n].x, dz = z - samples[n].z, distance = dx * dx + dz * dz;
        if (distance < nearestDistance) { nearestDistance = distance; nearest = opening; }
      }
    }
    return nearest && nearestDistance <= (nearest.ramp.width / 2 + clearance) ** 2 ? nearest : null;
  };
  const updatePlayerCave = (player) => {
    if (!player) {
      caveEntryPlayer = null;
      playerCaveIndex = 0;
      return;
    }
    const p = player.root.position;
    setVec(PLAYER_POSITION, p.x, p.y - player.baseY, p.z);
    if (caveEntryPlayer !== player) {
      caveEntryPlayer = player;
      playerCaveIndex = 0;
    } else {
      if (playerCaveIndex && CAMERA_OPENINGS[playerCaveIndex - 1].headquarters) {
        const rampOpening = headquartersOpeningAt(p.x, p.z, PLAYER_RADIUS);
        if (rampOpening) playerCaveIndex = rampOpening.caveIndex;
      }
      for (let i = 0; i < CAMERA_OPENINGS.length; i++) {
        const opening = CAMERA_OPENINGS[i], crossing = cameraCrossing(PLAYER_PREVIOUS, PLAYER_POSITION, opening, player.hop === 0);
        if (!crossing.valid) continue;
        if (!playerCaveIndex && crossing.direction > 0) playerCaveIndex = opening.caveIndex;
        else if (playerCaveIndex && crossing.direction < 0 && (playerCaveIndex === opening.caveIndex || CAMERA_OPENINGS[playerCaveIndex - 1].headquarters && opening.headquarters)) playerCaveIndex = 0;
      }
      if (playerCaveIndex && (!caveColumnAt(p.x, p.z, CAMERA_OPENINGS[playerCaveIndex - 1], PLAYER_POSITION.y) || PLAYER_POSITION.y < CAMERA_COLUMN.floor - 1e-6 || PLAYER_POSITION.y >= CAMERA_COLUMN.ceiling)) playerCaveIndex = 0;
    }
    // The exterior windows are physical entrances too. Movement has already
    // checked the body against the rock; bind its actual underground layer
    // without requiring a crossing of either main ramp's doorway.
    if (!playerCaveIndex && island.cavityAt(p.x, p.z, CAMERA_COLUMN, island.headquarters.caveIndex, PLAYER_POSITION.y) && PLAYER_POSITION.y >= CAMERA_COLUMN.floor - 1e-6 && PLAYER_POSITION.y + player.bodyHeight <= CAMERA_COLUMN.ceiling && physicalClearAt(p.x, PLAYER_POSITION.y + 1e-5, p.z, PLAYER_RADIUS, player.bodyHeight - 1e-5)) {
      for (let i = 0; i < CAMERA_OPENINGS.length; i++) if (CAMERA_OPENINGS[i].headquarters) {
        playerCaveIndex = CAMERA_OPENINGS[i].caveIndex;
        break;
      }
    }
    setVec(PLAYER_PREVIOUS, PLAYER_POSITION.x, PLAYER_POSITION.y, PLAYER_POSITION.z);
  };
  // Destination placement is explicit travel, not a sweep across the intervening
  // island. Validate the arrival volumes, then seed that location's own history.
  const navigationClearAt = (x, y, z, radius, height) => {
    if (!physicalClearAt(x, y, z, radius, height)) return false;
    for (const prop of props) {
      if (!prop.active || prop.prop === "gate" || !prop.node.geometry) continue;
      const b = BL.scene.boundsOf(prop.node.geometry), m = prop.node.world;
      const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      const hx = (b.max[0] - b.min[0]) / 2, hy = (b.max[1] - b.min[1]) / 2, hz = (b.max[2] - b.min[2]) / 2;
      const wx = m[0] * cx + m[4] * cy + m[8] * cz + m[12], wy = m[1] * cx + m[5] * cy + m[9] * cz + m[13], wz = m[2] * cx + m[6] * cy + m[10] * cz + m[14];
      const ex = Math.abs(m[0]) * hx + Math.abs(m[4]) * hy + Math.abs(m[8]) * hz, ey = Math.abs(m[1]) * hx + Math.abs(m[5]) * hy + Math.abs(m[9]) * hz, ez = Math.abs(m[2]) * hx + Math.abs(m[6]) * hy + Math.abs(m[10]) * hz;
      if (y >= wy + ey || y + height <= wy - ey) continue;
      const dx = Math.max(0, Math.abs(x - wx) - ex), dz = Math.max(0, Math.abs(z - wz) - ez);
      if (dx * dx + dz * dz < radius * radius) return false;
    }
    return true;
  };
  const navigate = (name) => {
    const destination = NAVIGATION, p = destination.position, target = destination.target;
    const player = pilot.player, close = pilot.closeWanted, basement = name === "basement", underground = name === "underground" || basement;
    if (hud.setDetachedView) hud.setDetachedView(name, !player);
    let x = 0, z = 0, yaw = 0, pitch = 0.18, dist = player ? 6 : 8;
    if (name === "pile") {
      z = Math.max(5, altar.platformRadius + 1.3);
      setVec(target, 0, ALTAR_HEIGHT + Math.max(0.4, pile.pileEdge() * 0.3), 0);
      pitch = player ? 0.22 : 0.28;
      if (!player) dist = Math.max(10, z + 4);
    } else if (name === "gate") {
      // Eye-level arrivals view the whole arch from the foot of the steps.
      // A trailing camera can pull back from the broad upper landing instead.
      // Neither arrival puts a standing body across the narrow stair treads.
      x = island.gate.x; z = island.gate.z + (close ? 6.75 : 0.75);
      setVec(target, island.gate.x, island.surfaceAt(island.gate.x, island.gate.z) + 2.5, island.gate.z);
      pitch = player ? 0 : 0.2;
      dist = player ? 10 : 12;
    } else if (name === "lab" || name === "mirror") {
      const id = name === "lab" ? "c11" : "c1", m = island.mouths.find((mouth) => mouth.id === id);
      yaw = m.ry;
      const approach = close ? 6 : 4;
      x = m.x + Math.sin(yaw) * approach; z = m.z + Math.cos(yaw) * approach;
      setVec(target, m.x, m.floorY + (close ? 2.5 : 2.1), m.z);
      pitch = player ? 0.06 : 0.16;
      dist = player ? 8 : 9;
    } else if (underground) {
      z = 6;
      setVec(target, 0, (basement ? island.headquarters.basement.floor : island.headquarters.floor) + 0.8, 0);
      pitch = player ? 0.4 : 0.15;
      dist = player ? 6 : 8;
    } else return;
    BL.scene.updateWorld(root);
    let found = false;
    for (const offset of NAVIGATION_OFFSETS) {
      p.x = x + Math.cos(yaw) * offset; p.z = z - Math.sin(yaw) * offset;
      p.y = underground ? (basement ? island.headquarters.basement.floor : island.headquarters.floor) : island.surfaceAt(p.x, p.z);
      if (!island.onLand(p.x, p.z) || !navigationClearAt(p.x, p.y + 1e-5, p.z, PLAYER_RADIUS, player ? player.bodyHeight : 1.6)) continue;
      destination.yaw = Math.atan2(p.x - target.x, p.z - target.z);
      destination.pitch = close ? Math.atan2(p.y + (player ? player.headOffset * CLOSE_VIEW.eyeRatio : CLOSE_VIEW.eyeHeight) - target.y, Math.hypot(p.x - target.x, p.z - target.z)) : pitch;
      destination.dist = dist;
      let eyeX, eyeY, eyeZ;
      if (close) {
        eyeX = p.x - (player ? Math.sin(destination.yaw) * CLOSE_VIEW.eyeForward : 0);
        eyeY = p.y + (player ? player.headOffset * CLOSE_VIEW.eyeRatio : CLOSE_VIEW.eyeHeight);
        eyeZ = p.z - (player ? Math.cos(destination.yaw) * CLOSE_VIEW.eyeForward : 0);
      } else {
        let viewPitch = pitch;
        if (player) { const t = Math.max(0, Math.min(1, (CLOSE_VIEW.trailingDist - dist) / (CLOSE_VIEW.trailingDist - DIST_MIN))); viewPitch *= 1 - t * t * (3 - 2 * t); }
        eyeX = (player ? p.x : target.x) + Math.sin(destination.yaw) * Math.cos(viewPitch) * dist;
        eyeY = (player ? p.y + FOLLOW.y : target.y) + Math.sin(viewPitch) * dist;
        eyeZ = (player ? p.z : target.z) + Math.cos(destination.yaw) * Math.cos(viewPitch) * dist;
      }
      if (!navigationClearAt(eyeX, eyeY - CAMERA_RADIUS, eyeZ, CAMERA_RADIUS, CAMERA_RADIUS * 2)) continue;
      setVec(CAMERA_PREVIOUS, eyeX, eyeY, eyeZ);
      setVec(camera.position, eyeX, eyeY, eyeZ);
      found = true;
      break;
    }
    if (!found) throw new Error(`No clear navigation arrival for ${name}`);
    if (enteringTween) { enteringTween.alive = false; enteringTween = null; }
    entering = false;
    cameraPreviousValid = cameraTerrainValid = cameraTerrainRecovering = cameraManualContact = false;
    cameraUnrestricted = cameraReentering = false;
    cameraTrailPlayer = null;
    cameraTrailCount = cameraTrailNext = cameraEntranceIndex = cameraTerrainEntranceIndex = 0;
    caveEntryPlayer = player;
    const index = underground ? CAMERA_OPENINGS.find((opening) => opening.headquarters).caveIndex : 0;
    playerCaveIndex = player ? index : 0;
    setCameraCave(index);
    setVec(PLAYER_PREVIOUS, p.x, p.y, p.z);
    setVec(PLAYER_POSITION, p.x, p.y, p.z);
    pilot.navigate(destination);
    if (player && player.jet && !jetpackAllowed(player)) {
      syncJetpackFuel();
      crew.removeJetpack(player);
      jetpackWearer = null;
      pilot.showAct();
    }
    syncMatrixInside(player);
    hud.tooltip.hide();
  };
  // Keep navigation within the world's horizontal extent. An orbit's focal
  // point may pass through the island, independently of its displayed eye.
  const clampTarget = (t) => {
    const r = Math.hypot(t.x, t.z);
    if (r > FLY_BOUND) {
      t.x *= FLY_BOUND / r;
      t.z *= FLY_BOUND / r;
    }
  };
  let exteriorEntranceIndex = 0, exteriorCeiling = Infinity;
  const exteriorCameraFloorAt = (x, y, z, clearance, smoothStep, closeMix, undergroundAir = false) => {
    const physicalFloor = island.surfaceAt(x, z);
    let floor = (smoothStep ? lerp(island.smoothSupportAt(x, z, physicalFloor, STEP_MAX), physicalFloor, closeMix) : physicalFloor) + clearance;
    exteriorEntranceIndex = 0;
    exteriorCeiling = Infinity;
    const player = pilot.player;
    // A jumping face can already extend beyond the ledge while its feet are
    // still over land. Its clearance is measured from the abyss there; keep
    // the body-anchored eye and let the swept rock collision constrain it.
    if (player && closeMix > 0.5 && (player.hop > 1e-5 || Math.abs(player.hopV) > 1e-5)) return -Infinity;
    if (player && (abyssAt(player.root.position.x, player.root.position.z, player.root.position.y - player.baseY) || !playerCaveIndex && player.root.position.y - player.baseY < island.surfaceAt(player.root.position.x, player.root.position.z) - STEP_MAX)) return -Infinity;
    if (!player && pilot.freeFalling && abyssAt(x, z, y - CLOSE_VIEW.eyeHeight)) return -Infinity;
    if (!player && closeMix > 0.5 && cloudAt(x, z, y - CLOSE_VIEW.eyeHeight)) return -Infinity;
    if (undergroundAir && y < physicalFloor && cameraClearAt(x, y, z)) {
      exteriorCeiling = island.ceilingAt(x, y - CAMERA_RADIUS, z, CAMERA_RADIUS) - CAMERA_RADIUS;
      return island.onLand(x, z) ? island.supportAt(x, z, y - CAMERA_RADIUS, 0, ABYSS_FLOOR) + CAMERA_RADIUS : -Infinity;
    }
    for (let i = 0; i < CAMERA_OPENINGS.length; i++) {
      const entry = CAMERA_OPENINGS[i], dx = x - entry.mouth.x, dz = z - entry.mouth.z;
      if (entry.blocked) continue;
      const along = dx * entry.sr + dz * entry.cr, across = dx * entry.cr - dz * entry.sr;
      if (along < entry.planeZ - 1e-7 || along > 3 || across < entry.minX + CAMERA_RADIUS || across > entry.maxX - CAMERA_RADIUS || y < entry.mouth.floorY || y > entry.mouth.floorY + entry.maxY) continue;
      const k = (along - entry.planeZ) / (3 - entry.planeZ);
      exteriorEntranceIndex = entry.caveIndex;
      // The lower headquarters can lie beneath the outdoor apron; only the
      // threshold-height tunnel may constrain an eye approaching from outside.
      const entranceColumn = caveColumnAt(x, z, entry, y) && CAMERA_COLUMN.ceiling > entry.mouth.floorY;
      floor = (entranceColumn ? CAMERA_COLUMN.floor : physicalFloor) + CAMERA_FLOOR + (clearance - CAMERA_FLOOR) * k * k * (3 - 2 * k);
      if (entranceColumn && cameraSpaceAt(x, z, entry, y)) exteriorCeiling = CAMERA_SPACE.ceiling;
      break;
    }
    return floor;
  };
  const cameraClearAt = (x, y, z) => physicalClearAt(x, y - CAMERA_RADIUS, z, CAMERA_RADIUS, CAMERA_RADIUS * 2);
  // The carved throat can extend beyond room-ownership columns. It remains
  // inside HQ while real rock encloses its clear air above and below. Match
  // the whole eye footprint at the sloping edge of an exterior window floor.
  const headquartersWindowAirAt = (x, y, z) => y < -CAMERA_RADIUS && cameraClearAt(x, y, z) && island.ceilingAt(x, y - CAMERA_RADIUS, z, CAMERA_RADIUS) < Infinity && island.supportAt(x, z, y - CAMERA_RADIUS, 0, ABYSS_FLOOR, CAMERA_RADIUS) > ABYSS_FLOOR;
  // Exact frame contacts can occur between the ordinary terrain substeps.
  const entranceSegmentClear = (x, y, z, toX, toY, toZ, radius = CAMERA_RADIUS) => {
    const dx = toX - x, dy = toY - y, dz = toZ - z, span2 = dx * dx + dz * dz;
    for (let i = 0; i < headquarters.entrances.length; i++) {
      const entry = headquarters.entrances[i], node = entry.node;
      if (Math.min(y, toY) - radius >= entry.maxY || Math.max(y, toY) + radius <= entry.minY) continue;
      const k = span2 ? Math.max(0, Math.min(1, ((node.position.x - x) * dx + (node.position.z - z) * dz) / span2)) : 0;
      const ox = x + dx * k - node.position.x, oz = z + dz * k - node.position.z, reach = entry.radius + radius;
      if (ox * ox + oz * oz > reach * reach) continue;
      const lx = (x - node.position.x) * entry.cr - (z - node.position.z) * entry.sr, lz = (x - node.position.x) * entry.sr + (z - node.position.z) * entry.cr;
      const vx = dx * entry.cr - dz * entry.sr, vz = dx * entry.sr + dz * entry.cr, boxes = node.geometry.collisionBoxes, scale = node.scale.x;
      for (let j = 0; j < boxes.length; j += 6) {
        if (!terrain.segmentBoxClear(lx, y - node.position.y - radius, lz, vx, dy, vz, radius, radius * 2, boxes[j] * scale, boxes[j + 1], boxes[j + 2], boxes[j + 3] * scale, boxes[j + 4], boxes[j + 5])) return false;
      }
    }
    return true;
  };
  const cameraSegmentClear = (x, y, z, toX, toY, toZ) => cameraClearAt(toX, toY, toZ) && island.voxelSegmentClearAt(x, y - CAMERA_RADIUS, z, toX, toY - CAMERA_RADIUS, toZ, CAMERA_RADIUS, CAMERA_RADIUS * 2) && entranceSegmentClear(x, y, z, toX, toY, toZ) && bedSegmentClear(x, y - CAMERA_RADIUS, z, toX, toY - CAMERA_RADIUS, toZ, CAMERA_RADIUS, CAMERA_RADIUS * 2);
  const sleepEyeFloorAt = (player) => player.bedroll.y + player.bedroll.sleep.pillowTop + CAMERA_RADIUS;
  const cameraHeadAt = (out, player) => {
    if (crew.sleeping) {
      const head = player.sleepHead;
      // A resting head replaces the upright boom anchor. Keep the eye volume
      // above the actual pillow while the face rolls toward the sheet.
      setVec(out, head.x, Math.max(head.y, sleepEyeFloorAt(player)), head.z);
    } else {
      const p = player.root.position;
      setVec(out, p.x, p.y - player.baseY + player.headOffset * CLOSE_VIEW.eyeRatio, p.z);
    }
  };
  const enterFreeCameraView = (eye) => {
    if (cameraClearAt(eye.x, eye.y, eye.z)) return false;
    // A low orbit focus may overlap a walkable prop or the ground. Lift the
    // eye over that support before looking for another room; a pile focus
    // must not recover to the HQ simply because its platform became solid.
    const floor = playerSupportAt(eye.x, eye.z, eye.y), raisedY = floor + CLOSE_VIEW.eyeHeight;
    if (floor <= eye.y && raisedY > eye.y && cameraClearAt(eye.x, raisedY, eye.z)) {
      eye.y = raisedY;
      return false;
    }
    // A free orbit can be inside stone. Enter walking view from the nearest
    // clear, authored circulation point, then approach the requested eye as
    // far as its real floor and swept camera volume permit.
    const points = headquarters.sleepNavigation.points;
    let best = Infinity, found = false;
    for (const point of points) {
      const y = playerSupportAt(point.x, point.z, point.y) + CLOSE_VIEW.eyeHeight;
      const distance = (point.x - eye.x) ** 2 + (y - eye.y) ** 2 + (point.z - eye.z) ** 2;
      if (distance >= best || !cameraClearAt(point.x, y, point.z)) continue;
      best = distance; found = true;
      setVec(CAMERA_RECOVERY, point.x, y, point.z);
    }
    if (!found) throw new Error("No clear free-camera entry");
    const x = CAMERA_RECOVERY.x, y = CAMERA_RECOVERY.y, z = CAMERA_RECOVERY.z;
    const count = Math.max(1, Math.min(1024, Math.ceil(Math.sqrt(best) / (island.unit * 0.5))));
    for (let i = 1; i <= count; i++) {
      const t = i / count, nx = lerp(x, eye.x, t), nz = lerp(z, eye.z, t), requestedY = lerp(y, eye.y, t);
      const ny = Math.max(requestedY, playerSupportAt(nx, nz, requestedY - CLOSE_VIEW.eyeHeight) + CLOSE_VIEW.eyeHeight);
      if (!cameraSegmentClear(CAMERA_RECOVERY.x, CAMERA_RECOVERY.y, CAMERA_RECOVERY.z, nx, ny, nz)) break;
      setVec(CAMERA_RECOVERY, nx, ny, nz);
    }
    setVec(eye, CAMERA_RECOVERY.x, CAMERA_RECOVERY.y, CAMERA_RECOVERY.z);
    setVec(CAMERA_PREVIOUS, eye.x, eye.y, eye.z);
    setVec(CAMERA_REQUESTED, eye.x, eye.y, eye.z);
    let index = 0;
    if (island.cavityAt(eye.x, eye.z, CAMERA_COLUMN, island.headquarters.caveIndex, eye.y) && eye.y >= CAMERA_COLUMN.floor && eye.y <= CAMERA_COLUMN.ceiling) {
      index = CAMERA_COLUMN.caveIndex;
      if (index === island.headquarters.caveIndex) for (const opening of CAMERA_OPENINGS) if (opening.headquarters) { index = opening.caveIndex; break; }
    }
    setCameraCave(index);
    cameraPreviousValid = true;
    cameraTerrainValid = cameraTerrainRecovering = cameraManualContact = false;
    cameraUnrestricted = cameraReentering = false;
    cameraTrailPlayer = null;
    cameraTrailCount = cameraTrailNext = 0;
    return true;
  };
  const releaseCameraView = (player, eye) => {
    if (cameraClearAt(eye.x, eye.y, eye.z)) return false;
    const p = player.root.position, feet = p.y - player.baseY;
    const floor = playerSupportAt(p.x, p.z, feet), roof = ceilingAt(p.x, p.z, Math.max(floor, feet) + 1e-5) - CAMERA_RADIUS;
    setVec(eye, p.x, Math.min(roof, Math.max(feet + player.headOffset * 0.95, floor + CLOSE_VIEW.eyeHeight)), p.z);
    setVec(CAMERA_PREVIOUS, eye.x, eye.y, eye.z);
    setVec(CAMERA_REQUESTED, eye.x, eye.y, eye.z);
    setCameraCave(playerCaveIndex);
    cameraPreviousValid = true;
    cameraTerrainValid = cameraTerrainRecovering = cameraManualContact = false;
    cameraUnrestricted = cameraReentering = false;
    return true;
  };
  const sweepCameraVolume = (from, p, slide) => {
    const dx = p.x - from.x, dy = p.y - from.y, dz = p.z - from.z;
    const steps = Math.max(1, Math.min(1024, Math.ceil(Math.hypot(dx, dy, dz) / (island.unit * 0.5))));
    let x = from.x, y = from.y, z = from.z, slid = false;
    for (let i = 0; i < steps; i++) {
      const sx = x + dx / steps, sy = y + dy / steps, sz = z + dz / steps;
      if (cameraSegmentClear(x, y, z, sx, sy, sz)) { x = sx; y = sy; z = sz; continue; }
      if (!slide) {
        let lo = 0, hi = 1;
        for (let n = 0; n < 10; n++) {
          const k = (lo + hi) / 2;
          if (cameraSegmentClear(x, y, z, x + dx / steps * k, y + dy / steps * k, z + dz / steps * k)) lo = k;
          else hi = k;
        }
        x += dx / steps * lo; y += dy / steps * lo; z += dz / steps * lo;
        break;
      }
      slid = true;
      if (dy && cameraSegmentClear(x, y, z, x, sy, z)) y = sy;
      if (cameraSegmentClear(x, y, z, sx, y, sz)) { x = sx; z = sz; }
      else {
        if (dx && cameraSegmentClear(x, y, z, sx, y, z)) x = sx;
        if (dz && cameraSegmentClear(x, y, z, x, y, sz)) z = sz;
      }
    }
    setVec(p, x, y, z);
    if (slid) {
      // A bent slide can leave a clear endpoint whose displayed diagonal cuts
      // the stone. Lower before entering a lintel; leave it before rising.
      sweepCameraVolume(from, p, false);
      if (Math.abs(y - from.y) > 1e-7 && Math.hypot(p.x - x, p.y - y, p.z - z) > 1e-5) {
        const rising = y > from.y;
        setVec(p, rising ? x : from.x, rising ? from.y : y, rising ? z : from.z);
        sweepCameraVolume(from, p, false);
        if (Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z) < 1e-5) {
          setVec(p, rising ? from.x : x, rising ? y : from.y, rising ? from.z : z);
          sweepCameraVolume(from, p, false);
        }
      }
    }
  };
  const followCameraMotion = (p, player, dt, directView, smoothStep, closeMix, requestedStep, falling = false) => {
    cameraHeadAt(CAMERA_VOLUME_FROM, player);
    const body = CAMERA_VOLUME_FROM, y = body.y;
    const previous = (cameraTrailNext + CAMERA_TRAIL_CAPACITY - 1) % CAMERA_TRAIL_CAPACITY * 3;
    const moved = cameraTrailCount ? Math.hypot(body.x - CAMERA_TRAIL[previous], y - CAMERA_TRAIL[previous + 1], body.z - CAMERA_TRAIL[previous + 2]) : Infinity;
    // A fast fall can travel farther than one unit in a frame. Only reset for
    // travel beyond the body's actual speed, so low-rate falls still sweep.
    const sleeping = crew.sleeping;
    // Standing changes the head anchor without teleporting the Ooga. Retain
    // the last eye and sweep that transition around nearby room corners.
    const reset = player !== cameraTrailPlayer || sleeping === cameraTrailSleeping && moved > Math.max(1, (Math.abs(player.hopV) + pilotMod.WALK.speed) * dt + 0.5);
    cameraTrailSleeping = sleeping;
    if (reset) { cameraTrailPlayer = player; cameraTrailCount = cameraTrailNext = 0; }
    if (reset || moved >= 0.125) {
      const at = cameraTrailNext * 3;
      CAMERA_TRAIL[at] = body.x; CAMERA_TRAIL[at + 1] = y; CAMERA_TRAIL[at + 2] = body.z;
      cameraTrailNext = (cameraTrailNext + 1) % CAMERA_TRAIL_CAPACITY;
      cameraTrailCount = Math.min(CAMERA_TRAIL_CAPACITY, cameraTrailCount + 1);
    }
    if (reset || !cameraPreviousValid) return;
    const distance = Math.hypot(p.x - CAMERA_PREVIOUS.x, p.y - CAMERA_PREVIOUS.y, p.z - CAMERA_PREVIOUS.z);
    // Preserve the authored close-view blend and first-person pose motion,
    // but ease the extra correction when a previously obstructed eye clears.
    // A vertical correction must not consume the horizontal follow budget.
    // Clamp height separately, then sweep the resulting segment in full.
    const travel = Math.max(CAMERA_RECOVERY_SPEED * dt, closeMix > 0 ? requestedStep : 0);
    const amount = directView ? 1 : Math.min(1, travel / Math.max(distance, 1e-7));
    p.x = lerp(CAMERA_PREVIOUS.x, p.x, amount);
    // Falling follows the body's speed while a newly exposed boom eases its
    // remaining correction. A cliff contact must not release a height snap.
    const verticalTravel = Math.max(CAMERA_RECOVERY_SPEED, Math.abs(player.hopV)) * dt;
    p.y = falling && !directView ? Math.max(CAMERA_PREVIOUS.y - verticalTravel, Math.min(CAMERA_PREVIOUS.y + verticalTravel, p.y)) : lerp(CAMERA_PREVIOUS.y, p.y, amount);
    p.z = lerp(CAMERA_PREVIOUS.z, p.z, amount);
    if (smoothStep && !directView) p.y = Math.max(CAMERA_PREVIOUS.y - CAMERA_VERTICAL_RATE * dt, Math.min(CAMERA_PREVIOUS.y + CAMERA_VERTICAL_RATE * dt, p.y));
    if (cameraReentering) {
      // A room view may begin inside solid rock. Ease it into the corridor;
      // only then can a sweep have a physically clear starting volume.
      if (cameraClearAt(p.x, p.y, p.z) && cameraSegmentClear(body.x, body.y, body.z, p.x, p.y, p.z)) cameraReentering = false;
      return;
    }
    const wantedX = p.x, wantedY = p.y, wantedZ = p.z;
    sweepCameraVolume(CAMERA_PREVIOUS, p, true);
    if (Math.hypot(p.x - wantedX, p.y - wantedY, p.z - wantedZ) < 1e-4) return;
    // Dragging an exterior view into rock is not an Ooga rounding a corner.
    // Keep that wall contact instead of following its trail into the cave.
    if (directView) return true;
    // The last clear boom can bend around a doorway as its Ooga turns. Follow
    // the newest visible point on that real route rather than cutting through
    // the wall or repeatedly pushing the eye into the same corner.
    let reached = cameraTrailCount;
    for (let i = 0; i < cameraTrailCount; i++) {
      const at = (cameraTrailNext + CAMERA_TRAIL_CAPACITY - 1 - i) % CAMERA_TRAIL_CAPACITY * 3;
      setVec(CAMERA_RECOVERY, CAMERA_TRAIL[at], CAMERA_TRAIL[at + 1], CAMERA_TRAIL[at + 2]);
      sweepCameraVolume(CAMERA_PREVIOUS, CAMERA_RECOVERY, false);
      if (Math.hypot(CAMERA_RECOVERY.x - CAMERA_TRAIL[at], CAMERA_RECOVERY.y - CAMERA_TRAIL[at + 1], CAMERA_RECOVERY.z - CAMERA_TRAIL[at + 2]) > 1e-4) continue;
      reached = i;
      const span = Math.hypot(CAMERA_RECOVERY.x - CAMERA_PREVIOUS.x, CAMERA_RECOVERY.y - CAMERA_PREVIOUS.y, CAMERA_RECOVERY.z - CAMERA_PREVIOUS.z);
      if (span < 1e-5) break;
      const k = Math.min(1, CAMERA_RECOVERY_SPEED * dt / Math.max(span, 1e-7));
      p.x = lerp(CAMERA_PREVIOUS.x, CAMERA_RECOVERY.x, k);
      p.y = lerp(CAMERA_PREVIOUS.y, CAMERA_RECOVERY.y, k);
      p.z = lerp(CAMERA_PREVIOUS.z, CAMERA_RECOVERY.z, k);
      if (smoothStep) p.y = Math.max(CAMERA_PREVIOUS.y - CAMERA_VERTICAL_RATE * dt, Math.min(CAMERA_PREVIOUS.y + CAMERA_VERTICAL_RATE * dt, p.y));
      sweepCameraVolume(CAMERA_PREVIOUS, p, true);
      if (Math.hypot(p.x - CAMERA_PREVIOUS.x, p.y - CAMERA_PREVIOUS.y, p.z - CAMERA_PREVIOUS.z) > 1e-5) return;
      break;
    }
    // A boom can enter a side passage the Ooga never walked through. Slide a
    // short, fully swept step toward the next point on its trail. Revisiting
    // older points after reaching a corner would make the eye walk backward.
    for (let i = reached - 1; i >= 0; i--) {
      const at = (cameraTrailNext + CAMERA_TRAIL_CAPACITY - 1 - i) % CAMERA_TRAIL_CAPACITY * 3;
      const dx = CAMERA_TRAIL[at] - CAMERA_PREVIOUS.x, dy = CAMERA_TRAIL[at + 1] - CAMERA_PREVIOUS.y, dz = CAMERA_TRAIL[at + 2] - CAMERA_PREVIOUS.z;
      const span = Math.hypot(dx, dy, dz), k = Math.min(1, CAMERA_RECOVERY_SPEED * dt / Math.max(span, 1e-7));
      setVec(CAMERA_RECOVERY, CAMERA_PREVIOUS.x + dx * k, CAMERA_PREVIOUS.y + dy * k, CAMERA_PREVIOUS.z + dz * k);
      if (smoothStep) CAMERA_RECOVERY.y = Math.max(CAMERA_PREVIOUS.y - CAMERA_VERTICAL_RATE * dt, Math.min(CAMERA_PREVIOUS.y + CAMERA_VERTICAL_RATE * dt, CAMERA_RECOVERY.y));
      sweepCameraVolume(CAMERA_PREVIOUS, CAMERA_RECOVERY, true);
      if (Math.hypot(CAMERA_TRAIL[at] - CAMERA_RECOVERY.x, CAMERA_TRAIL[at + 1] - CAMERA_RECOVERY.y, CAMERA_TRAIL[at + 2] - CAMERA_RECOVERY.z) >= span - 1e-4) continue;
      setVec(p, CAMERA_RECOVERY.x, CAMERA_RECOVERY.y, CAMERA_RECOVERY.z);
      return;
    }
  };
  const clampCamera = (p, closeMix = 0, closeClearance = CLEARANCE, smoothStep = false, dt = 0, resetSmooth = false, directView = false, freeMove = false, preserveExitAngle = false) => {
    const requestedX = p.x, requestedY = p.y, requestedZ = p.z;
    const player = pilot && pilot.player;
    if (cameraUnrestricted && player && closeMix > 0 && !preserveExitAngle) {
      cameraHeadAt(CAMERA_VOLUME_FROM, player);
      cameraReentering = !cameraClearAt(CAMERA_PREVIOUS.x, CAMERA_PREVIOUS.y, CAMERA_PREVIOUS.z) || !cameraSegmentClear(CAMERA_PREVIOUS.x, CAMERA_PREVIOUS.y, CAMERA_PREVIOUS.z, CAMERA_VOLUME_FROM.x, CAMERA_VOLUME_FROM.y, CAMERA_VOLUME_FROM.z);
      cameraUnrestricted = false;
      CAMERA_TRAIL[0] = CAMERA_VOLUME_FROM.x; CAMERA_TRAIL[1] = CAMERA_VOLUME_FROM.y; CAMERA_TRAIL[2] = CAMERA_VOLUME_FROM.z;
      cameraTrailPlayer = player; cameraTrailCount = cameraTrailNext = 1; cameraTrailSleeping = crew.sleeping;
    }
    // Orbit views retain their chosen pose everywhere. When a close-view
    // dolly begins in rock, retain that continuous authored path until the
    // final physical head position; the rock overlay covers its interior.
    if (preserveExitAngle || closeMix === 0 || cameraReentering && closeMix < 1) {
      if (preserveExitAngle || closeMix === 0) { cameraUnrestricted = true; cameraReentering = false; }
      cameraManualContact = false;
      let index = 0;
      const owner = player ? playerCaveIndex : cameraCaveIndex;
      const preferred = owner && CAMERA_OPENINGS[owner - 1].headquarters ? island.headquarters.caveIndex : owner;
      if (island.cavityAt(p.x, p.z, CAMERA_COLUMN, preferred, p.y) && p.y >= CAMERA_COLUMN.floor && p.y < CAMERA_COLUMN.ceiling) {
        if (CAMERA_COLUMN.caveIndex === island.headquarters.caveIndex) {
          for (const opening of CAMERA_OPENINGS) if (opening.headquarters && (!index || opening.caveIndex === playerCaveIndex)) index = opening.caveIndex;
        } else index = CAMERA_COLUMN.caveIndex;
      }
      setCameraCave(index); cameraEntranceIndex = 0;
      cameraTerrainValid = cameraTerrainRecovering = false;
      camera.near = 0.1;
      setVec(CAMERA_PREVIOUS, p.x, p.y, p.z);
      setVec(CAMERA_REQUESTED, requestedX, requestedY, requestedZ);
      cameraPreviousValid = true;
      return false;
    }
    cameraReentering = false;
    if (!player) cameraUnrestricted = false;
    const exteriorFlight = player && (abyssAt(player.root.position.x, player.root.position.z, player.root.position.y - player.baseY) || !playerCaveIndex && player.root.position.y - player.baseY < island.surfaceAt(player.root.position.x, player.root.position.z) - STEP_MAX);
    if (exteriorFlight) smoothStep = false;
    if (cameraManualContact && player === cameraTrailPlayer && cameraPreviousValid && !directView && closeMix === 0) {
      const body = player.root.position;
      if (Math.hypot(body.x - CAMERA_MANUAL_BODY.x, body.y - CAMERA_MANUAL_BODY.y, body.z - CAMERA_MANUAL_BODY.z) < 1e-7 && Math.hypot(pilot.orbit.yaw - CAMERA_MANUAL_VIEW.x, pilot.orbit.pitch - CAMERA_MANUAL_VIEW.y, pilot.orbit.dist - CAMERA_MANUAL_VIEW.z) < 1e-7) {
        // Hold the selected view when input and body movement have stopped,
        // including an exterior orbit whose Ooga is inside the doorway.
        setVec(p, CAMERA_PREVIOUS.x, CAMERA_PREVIOUS.y, CAMERA_PREVIOUS.z);
        return true;
      }
    }
    cameraManualContact = false;
    const requestedStep = Math.hypot(p.x - CAMERA_REQUESTED.x, p.y - CAMERA_REQUESTED.y, p.z - CAMERA_REQUESTED.z);
    setVec(CAMERA_REQUESTED, requestedX, requestedY, requestedZ);
    if (cameraCaveIndex && CAMERA_OPENINGS[cameraCaveIndex - 1].headquarters) {
      const rampOpening = headquartersOpeningAt(p.x, p.z, CAMERA_RADIUS);
      if (rampOpening) setCameraCave(rampOpening.caveIndex);
    }
    const previousCaveIndex = cameraCaveIndex;
    const undergroundAir = (freeMove || player && player.root.position.y - player.baseY < island.surfaceAt(player.root.position.x, player.root.position.z) - STEP_MAX) && (CAMERA_PREVIOUS.y < -CAMERA_RADIUS || previousCaveIndex && CAMERA_OPENINGS[previousCaveIndex - 1].headquarters);
    const clearance = lerp(player ? CAMERA_RADIUS : CLEARANCE, Math.max(smoothStep ? CAMERA_STEP_FLOOR : CAMERA_FLOOR, closeClearance), closeMix);
    let opening = cameraCaveIndex ? CAMERA_OPENINGS[cameraCaveIndex - 1] : null, start = 0, exit = false;
    setVec(CAMERA_FROM, CAMERA_PREVIOUS.x, CAMERA_PREVIOUS.y, CAMERA_PREVIOUS.z);
    // Physical first-person placement follows the character's actual layer.
    const followOpening = playerCaveIndex ? CAMERA_OPENINGS[playerCaveIndex - 1] : null;
    const followBoom = player && closeMix > 0;
    if (followBoom) {
      opening = followOpening;
      cameraHeadAt(CAMERA_FROM, player);
      if (opening && cameraSpaceAt(CAMERA_FROM.x, CAMERA_FROM.z, opening, CAMERA_FROM.y)) CAMERA_FROM.y = Math.max(CAMERA_SPACE.floor, Math.min(CAMERA_SPACE.ceiling, CAMERA_FROM.y));
    }
    if (cameraPreviousValid) {
      for (let i = 0; i < CAMERA_OPENINGS.length; i++) {
        const candidate = CAMERA_OPENINGS[i], crossing = cameraCrossing(CAMERA_FROM, p, candidate);
        if (matrixCave && candidate.caveIndex === matrixCave.caveIndex && crossing.reason) {
          const rejected = matrixCave.portal.rejected, reason = crossing.reason;
          rejected[reason] = Math.min(0x7fffffff, rejected[reason] + 1);
        }
        if (crossing.reason === "sealed" && crossing.direction > 0) {
          const fromAlong = (CAMERA_FROM.x - candidate.mouth.x) * candidate.sr + (CAMERA_FROM.z - candidate.mouth.z) * candidate.cr;
          const toAlong = (p.x - candidate.mouth.x) * candidate.sr + (p.z - candidate.mouth.z) * candidate.cr;
          const k = Math.max(0, Math.min(1, (fromAlong - candidate.stopZ) / (fromAlong - toAlong)));
          p.x = lerp(CAMERA_FROM.x, p.x, k);
          p.y = lerp(CAMERA_FROM.y, p.y, k);
          p.z = lerp(CAMERA_FROM.z, p.z, k);
        }
        if (!crossing.valid) continue;
        if (!opening && crossing.direction > 0) {
          opening = candidate;
          start = crossing.amount;
        } else if (opening && crossing.direction < 0 && (opening === candidate || opening.headquarters && candidate.headquarters)) {
          opening = candidate;
          exit = true;
        }
      }
    }
    if (opening) {
      const fromX = lerp(CAMERA_FROM.x, p.x, start), fromY = lerp(CAMERA_FROM.y, p.y, start), fromZ = lerp(CAMERA_FROM.z, p.z, start);
      const dx = p.x - fromX, dy = p.y - fromY, dz = p.z - fromZ;
      const steps = Math.max(1, Math.min(768, Math.ceil(Math.hypot(dx, dz) / (island.unit * 0.5))));
      let x = CAMERA_FROM.x, y = CAMERA_FROM.y, z = CAMERA_FROM.z, outside = false, accepted = false;
      for (let i = 0; i <= steps; i++) {
        const k = i / steps, sx = i ? x + dx / steps : fromX, sz = i ? z + dz / steps : fromZ;
        const along = (sx - opening.mouth.x) * opening.sr + (sz - opening.mouth.z) * opening.cr;
        if (cameraCaveIndex && along > opening.planeZ + 1e-7 && (!opening.headquarters || exit)) {
          if (exit) outside = true;
          break;
        }
        if (!cameraSpaceAt(sx, sz, opening, y)) {
          // Windows are real openings through the island shell. Their clear
          // air need not have room-ownership metadata to be traversable.
          if ((freeMove || player) && opening.headquarters && cameraClearAt(sx, fromY + dy * k, sz)) {
            x = sx; y = fromY + dy * k; z = sz;
            accepted = true;
            continue;
          }
          // Project blocked free movement onto each remaining axis. Retaining
          // the accepted point lets shallow wall contact keep its tangent.
          // A follow boom stops at its first obstruction to keep line of sight.
          if (!i || followBoom || !freeMove && !player) break;
          if (cameraSpaceAt(sx, z, opening, y)) {
            x = sx;
            y = Math.max(CAMERA_SPACE.floor, Math.min(CAMERA_SPACE.ceiling, fromY + dy * k));
          }
          if (cameraSpaceAt(x, sz, opening, y)) {
            z = sz;
            y = Math.max(CAMERA_SPACE.floor, Math.min(CAMERA_SPACE.ceiling, fromY + dy * k));
          }
          continue;
        }
        if (cameraCaveIndex && opening.headquarters && along > opening.planeZ + 1e-7 && CAMERA_SPACE.ceiling > opening.mouth.floorY) break;
        accepted = true;
        x = sx; z = sz;
        y = Math.max(CAMERA_SPACE.floor, Math.min(CAMERA_SPACE.ceiling, fromY + dy * k));
      }
      if (outside) setCameraCave(0);
      else {
        p.x = x; p.y = y; p.z = z;
        const along = (x - opening.mouth.x) * opening.sr + (z - opening.mouth.z) * opening.cr;
        if (accepted) {
          if ((freeMove || player) && opening.headquarters && (!island.cavityAt(x, z, CAMERA_COLUMN, island.headquarters.caveIndex, y) || y < CAMERA_COLUMN.floor + CAMERA_RADIUS || y > CAMERA_COLUMN.ceiling - CAMERA_RADIUS) && !headquartersWindowAirAt(x, y, z)) setCameraCave(0);
          else if (along < opening.planeZ - 1e-7) setCameraCave(opening.caveIndex);
        }
      }
    }
    let caveView = !!cameraCaveIndex;
    if (freeMove && closeMix > 0.5) {
      // Resolve eye-level support at the accepted horizontal position. A
      // requested point inside a wall must not lift the eye to that wall's top.
      const floor = playerSupportAt(p.x, p.z, CAMERA_PREVIOUS.y - CLOSE_VIEW.eyeHeight);
      const eye = floor + CLOSE_VIEW.eyeHeight;
      if (opening && cameraSpaceAt(p.x, p.z, opening, p.y)) p.y = Math.max(CAMERA_SPACE.floor, Math.min(CAMERA_SPACE.ceiling, pilot.freeFalling ? Math.max(p.y, eye) : eye));
    }
    cameraEntranceIndex = 0;
    if (!cameraCaveIndex) {
      const floor = exteriorCameraFloorAt(p.x, p.y, p.z, clearance, smoothStep, closeMix, undergroundAir);
      cameraEntranceIndex = exteriorEntranceIndex;
      p.y = Math.min(p.y, exteriorCeiling);
      p.y = Math.max(p.y, floor);
    }
    // Walking smooths terrain steps; entering first person already has an
    // authored camera blend. Rate-limiting its first half stores an error
    // that would otherwise be released as a visible jump halfway through.
    if (smoothStep && closeMix === 0 && !caveView) {
      const moved = Math.hypot(p.x - cameraTerrainX, p.z - cameraTerrainZ);
      const verticalStep = CAMERA_VERTICAL_RATE * Math.min(dt, 0.05);
      const horizontalStep = CAMERA_HORIZONTAL_RATE * Math.min(dt, 0.05);
      if (!cameraTerrainValid || resetSmooth || directView) {
        cameraTerrainY = p.y;
        cameraTerrainRecovering = false;
      } else {
        const targetY = p.y;
        if (targetY > cameraTerrainY + verticalStep) {
          cameraTerrainY += verticalStep;
          cameraTerrainRecovering = true;
        } else if (targetY < cameraTerrainY) cameraTerrainY = Math.max(targetY, cameraTerrainY - verticalStep);
        else cameraTerrainY = targetY;
        if ((cameraEntranceIndex || cameraTerrainEntranceIndex) && moved > horizontalStep) cameraTerrainRecovering = true;
        if (cameraTerrainRecovering && moved > horizontalStep) {
          const k = horizontalStep / moved, x = lerp(cameraTerrainX, p.x, k), z = lerp(cameraTerrainZ, p.z, k);
          if (exteriorCameraFloorAt(x, cameraTerrainY, z, clearance, smoothStep, closeMix) <= cameraTerrainY + 1e-7) {
            p.x = x;
            p.z = z;
          } else {
            p.x = cameraTerrainX;
            p.z = cameraTerrainZ;
          }
        }
        if (cameraTerrainRecovering && moved <= horizontalStep && Math.abs(cameraTerrainY - targetY) <= 1e-7) cameraTerrainRecovering = false;
      }
      p.y = cameraTerrainY;
      exteriorCameraFloorAt(p.x, p.y, p.z, clearance, smoothStep, closeMix);
      cameraEntranceIndex = exteriorEntranceIndex;
      p.y = Math.min(p.y, exteriorCeiling);
      cameraTerrainX = p.x;
      cameraTerrainZ = p.z;
      cameraTerrainEntranceIndex = cameraEntranceIndex;
      cameraTerrainValid = true;
    } else {
      cameraTerrainValid = false;
      cameraTerrainRecovering = false;
      cameraTerrainEntranceIndex = 0;
    }
    if (cameraPreviousValid && freeMove) {
      // Raising clearance over a cliff must not jump the eye through its side.
      // Sweep the whole eye volume, including at outdoor voxel corners, and
      // allow its blocked horizontal component to slide while it gains height.
      if (!caveView) p.y = Math.min(p.y, Math.max(requestedY, CAMERA_PREVIOUS.y + CAMERA_VERTICAL_RATE * Math.min(dt, 0.05)));
      if (caveView && closeMix <= 0.5 && p.y < requestedY) p.y = Math.max(p.y, CAMERA_PREVIOUS.y - CAMERA_VERTICAL_RATE * Math.min(dt, 0.05));
      if (closeMix > 0.5 && !pilot.freeFalling) p.y = Math.max(CAMERA_PREVIOUS.y - CAMERA_VERTICAL_RATE * Math.min(dt, 0.05), Math.min(CAMERA_PREVIOUS.y + CAMERA_VERTICAL_RATE * Math.min(dt, 0.05), p.y));
      sweepCameraVolume(CAMERA_PREVIOUS, p, true);
      if (previousCaveIndex) {
        const previousOpening = CAMERA_OPENINGS[previousCaveIndex - 1];
        const along = (p.x - previousOpening.mouth.x) * previousOpening.sr + (p.z - previousOpening.mouth.z) * previousOpening.cr;
        if (along < previousOpening.planeZ && caveColumnAt(p.x, p.z, previousOpening, p.y) && p.y < CAMERA_COLUMN.ceiling) setCameraCave(previousCaveIndex);
      }
    } else if (player && followBoom && (!directView || previousCaveIndex)) {
      cameraHeadAt(CAMERA_VOLUME_FROM, player);
      if (cameraClearAt(CAMERA_VOLUME_FROM.x, CAMERA_VOLUME_FROM.y, CAMERA_VOLUME_FROM.z)) sweepCameraVolume(CAMERA_VOLUME_FROM, p, false);
    }
    if (player) {
      // Keep the exterior eye smooth through a doorway. Once it enters HQ,
      // the full swept follow rate keeps up with the continuous descents.
      // At the settled first-person endpoint the camera belongs to the head.
      // Do not tether it to an old eye position on the far side of a prop as
      // the character walks around that prop; only the short head-to-eye
      // segment must be clear.
      const fixedFirstPerson = followBoom && closeMix === 1 && cameraClearAt(p.x, p.y, p.z)
        && cameraSegmentClear(CAMERA_VOLUME_FROM.x, CAMERA_VOLUME_FROM.y, CAMERA_VOLUME_FROM.z, p.x, p.y, p.z);
      cameraManualContact = fixedFirstPerson ? false : followCameraMotion(p, player, dt, directView, smoothStep && closeMix === 0, closeMix, requestedStep, exteriorFlight) === true;
      if (fixedFirstPerson) {
        cameraTrailPlayer = player;
        cameraTrailCount = cameraTrailNext = 1;
        CAMERA_TRAIL[0] = p.x; CAMERA_TRAIL[1] = p.y; CAMERA_TRAIL[2] = p.z;
      }
      // Admission belongs to the resolved eye path. Boom clipping can leave
      // the eye inside even when the originally requested view was outside.
      let index = previousCaveIndex;
      if (cameraPreviousValid) for (let i = 0; i < CAMERA_OPENINGS.length; i++) {
        const entry = CAMERA_OPENINGS[i], crossing = cameraCrossing(CAMERA_PREVIOUS, p, entry);
        if (!crossing.valid) continue;
        if (!index && crossing.direction > 0) index = entry.caveIndex;
        else if (index && crossing.direction < 0 && (index === entry.caveIndex || CAMERA_OPENINGS[index - 1].headquarters && entry.headquarters)) index = 0;
      }
      if (index && CAMERA_OPENINGS[index - 1].headquarters && (!island.cavityAt(p.x, p.z, CAMERA_COLUMN, island.headquarters.caveIndex, p.y) || p.y < CAMERA_COLUMN.floor + CAMERA_RADIUS || p.y > CAMERA_COLUMN.ceiling - CAMERA_RADIUS) && !headquartersWindowAirAt(p.x, p.y, p.z)) index = 0;
      setCameraCave(index);
      if (directView && !index) cameraManualContact = true;
      if (cameraManualContact) {
        setVec(CAMERA_MANUAL_VIEW, pilot.orbit.yaw, pilot.orbit.pitch, pilot.orbit.dist);
        const body = player.root.position;
        setVec(CAMERA_MANUAL_BODY, body.x, body.y, body.z);
      }
    } else {
      cameraTrailPlayer = null;
      cameraTrailCount = cameraTrailNext = 0;
    }
    const headquartersEye = player && followOpening && followOpening.headquarters && (p.y < -CAMERA_RADIUS || (p.x - followOpening.mouth.x) * followOpening.sr + (p.z - followOpening.mouth.z) * followOpening.cr < followOpening.planeZ - 1e-7);
    if ((undergroundAir && p.y < -CAMERA_RADIUS || headquartersEye) && !cameraCaveIndex && island.cavityAt(p.x, p.z, CAMERA_COLUMN, island.headquarters.caveIndex, p.y) && p.y >= CAMERA_COLUMN.floor + CAMERA_RADIUS && p.y < CAMERA_COLUMN.ceiling && cameraClearAt(p.x, p.y, p.z)) {
      // A swept eye can enter an open throat or window after its Ooga. The
      // center identifies its layer; the full cylinder checks the actual rock
      // at open column edges. The Mirror Cave still requires its own crossing.
      for (let i = 0; i < CAMERA_OPENINGS.length; i++) if (CAMERA_OPENINGS[i].headquarters) {
        setCameraCave(CAMERA_OPENINGS[i].caveIndex);
        break;
      }
    }
    caveView = !!cameraCaveIndex;
    if (!caveView) {
      exteriorCameraFloorAt(p.x, p.y, p.z, clearance, smoothStep, closeMix, undergroundAir);
      cameraEntranceIndex = exteriorEntranceIndex;
    }
    const collided = Math.abs(p.x - requestedX) > 1e-7 || Math.abs(p.z - requestedZ) > 1e-7 || (freeMove || !!opening) && Math.abs(p.y - requestedY) > 1e-7;
    // The outdoor near plane is wider than the cave eye clearance. Shorten it
    // at low entrances/interiors so nearby jagged rock is not sliced away.
    camera.near = caveView || cameraEntranceIndex || closeMix > 0.5 || undergroundAir ? 0.1 : 0.5;
    setVec(CAMERA_PREVIOUS, p.x, p.y, p.z);
    cameraPreviousValid = true;
    if (matrixCave) {
      const portal = matrixCave.portal, m = matrixCave.mouth, dx = p.x - m.x, dz = p.z - m.z;
      portal.previousX = matrixCave.cr * dx - matrixCave.sr * dz;
      portal.previousY = p.y - m.floorY;
      portal.previousZ = matrixCave.sr * dx + matrixCave.cr * dz;
      portal.previousValid = true;
    }
    return collided;
  };

  // ---------- per frame ----------
  const updateMeter = () => {
    let reloading = 0;
    for (let i = 0; i < crew.list.length; i++) if (crew.list[i].weapon.reloading) reloading++;
    hud.setMeter(world.level, METER_CAPACITY, reloading ? `${reloading} reloading · 6 shots per banana` : world.level < 1 ? "Waiting for bananas" : "Ready for reloads");
  };
  // The clock drives the sky, the lamps and who is out
  const setPhase = (next) => {
    const first = phase === null;
    phase = next;
    if (first) hud.setSubtitle("an island of caves");
    if (!first) hud.toast(PHASE_TOASTS[next]);
  };
  const update = (dt, elapsed) => {
    now = elapsed;
    hour = clock.read();
    daylight.sample(hour, RENDER_OPTS, clock.dayOfYear, islandLatitude, clock.continuousDay);
    RENDER_OPTS.time = elapsed;
    updateLamps(dt, elapsed, phase !== null);
    if (jumbotron) jumbotron.update(elapsed, renderer);
    const next = daylight.phaseAt(hour);
    if (next !== phase) setPhase(next);
    if (DEBUG) syncDaylightDebug(hour);
    critters.update(dt, elapsed, RENDER_OPTS.day, RENDER_OPTS.stars, fire.k, 1);
    updateClouds(dt);
    solids.sync();
    updateSleepingSolids();
    pilot.readInput(dt);
    mirrorCave.damage.update(dt);
    syncMirrorDamage();
    mirrorCave.ripples.update(dt, elapsed);
    crew.update(dt, elapsed);
    dockStairs.update(dt, pilot.player);
    updateRoomSigns(dt);
    pile.update(dt);
    const player = pilot.player;
    if (jetpackWearer && jetpackWearer !== player) {
      syncJetpackFuel();
      crew.removeJetpack(jetpackWearer);
      jetpackWearer = null;
    }
    syncJetpackFuel();
    if (player && !pilot.poseHeld && player.root.position.y - player.baseY < ABYSS_RESPAWN_Y && abyssAt(player.root.position.x, player.root.position.z, player.root.position.y - player.baseY)) {
      loseJetpack(player);
      loseMagazine();
      respawnAtPile();
    }
    else if (!player && !pilot.poseHeld && pilot.freeFalling && camera.position.y - CLOSE_VIEW.eyeHeight < ABYSS_RESPAWN_Y && abyssAt(camera.position.x, camera.position.z, camera.position.y - CLOSE_VIEW.eyeHeight)) respawnAtPile();
    updatePlayerCave(player);
    if (player && player.jet && !jetpackAllowed(player)) {
      syncJetpackFuel();
      crew.removeJetpack(player);
      jetpackWearer = null;
      pilot.showAct();
      hud.toast("No jetpacks under ground");
    }
    // Turn the pickup above its moving support. If that cloud wraps out of the
    // sky, let the pack fall visibly before placing it on another far cloud.
    if (jetpack) {
      jetpack.node.rotation.y += dt * 0.9;
      if (jetpack.host) {
        const host = jetpack.host, p = host.node.position;
        jetpack.x = jetpack.owner.x = jetpack.node.position.x = p.x;
        jetpack.z = jetpack.owner.z = jetpack.node.position.z = p.z;
        jetpack.node.position.y = p.y + host.centerTop + JETPACK_HOVER + Math.sin(elapsed * 2) * 0.09;
      } else {
        jetpack.vy -= JETPACK_FALL_GRAVITY * dt;
        jetpack.node.position.y += jetpack.vy * dt;
        if (jetpack.node.position.y < JETPACK_RESPAWN_Y) attachJetpackToCloud(lastJetpackCloud);
      }
      if (player && !jetpack.falling) {
        const p = player.root.position, py = p.y - player.baseY + 0.75;
        if (Math.hypot(p.x - jetpack.x, py - jetpack.node.position.y, p.z - jetpack.z) < JETPACK_REACH) collectJetpack(player);
      }
    }
    if (magazine && magazine.revealed) {
      const node = magazine.node;
      node.rotation.y += dt * 0.9;
      node.position.y = magazine.y + Math.sin(elapsed * 2) * 0.08;
      if (player && player.root.visible && player.state !== "sleeping") {
        const p = player.root.position, feet = p.y - player.baseY;
        const dx = p.x - node.position.x, dz = p.z - node.position.z;
        if (dx * dx + dz * dz < MAGAZINE_REACH * MAGAZINE_REACH
          && feet < node.position.y + 0.28 && feet + player.bodyHeight > node.position.y - 0.28) {
          const added = grantMagazine(player);
          if (added) {
            hud.toast(magazine ? `+${added} ammo · ${magazine.ammo} left` : "Spare magazine collected");
            if (!magazine) hud.hint("R selects the fullest spare · Space reloads near the pile", 5000);
          }
        }
      }
    }
    // The lab still opens on entry. Game launchers wait for a nearby action.
    if (player && !entering && player.hop < 1) {
      const p = player.root.position;
      const y = p.y - player.baseY;
      if (playerCaveIndex) {
        const playerOpening = CAMERA_OPENINGS[playerCaveIndex - 1];
        const overhead = camera.position.y >= playerOpening.mouth.floorY + playerOpening.maxY;
        for (let i = 0; i < openMouths.length; i++) {
          const { slot, m } = openMouths[i];
          if (slot.scene === "race") continue;
          if (!overhead && m === playerOpening.mouth && Math.abs(y - m.floorY) < 1 && Math.hypot(p.x - m.inside.x, p.z - m.inside.z) < TUNNEL_REACH) enterCave(slot);
        }
      }
    }
    for (let i = 0; i < sleepers.length; i++) {
      const s = sleepers[i];
      s.timer -= dt;
      if (s.timer <= 0) {
        s.timer = 1.6;
        fx.zzzAt(s.x, s.y, s.z);
      }
    }
    breakables.update(dt, elapsed);
    crates.update(dt, elapsed);
    fx.update(dt);
    stepTweens(dt);
    pilot.update(dt);
    if (POSITION_DEBUG && elapsed >= positionDebugNext) {
      positionDebugNext = elapsed + 0.1;
      updatePositionDebug();
    }
    // clampCamera resolves the active eye's entrance crossing inside pilot.update.
    // Commit the portal and Matrix state only after that result, before rendering,
    // so the mirror and the covered interior can never disagree for one frame.
    syncMatrixInside(player);
    updateMatrixWorld(dt, elapsed);
    updateMatrixControl(dt, player);
    mirrorCave.body.update(dt);
    meterTimer -= dt;
    if (meterTimer <= 0) {
      meterTimer = 0.25;
      updateMeter();
    }
  };
  // Build quotes over the depth-tested scene
  const drawExtra = (ctx2d, project, drawBubble) => {
    crew.drawQuotes(ctx2d, project, drawBubble);
    breakables.drawOverlay(ctx2d);
  };
  const cameraPlatformAt = (x, y, z) => y >= 0 && y <= ALTAR_HEIGHT && Math.hypot(x, z) <= altar.platformRadius;
  // One solid mask spans the terrain, dais and fruit contact. The fruit pass
  // supplies its own color over this opaque backing, including shared edges.
  const cameraRockAt = (x, y, z) => cameraPlatformAt(x, y, z) || bananaCover.contains(x, y, z)
    || island.solidAt(x, y, z) || !island.clearAt(x, y, z, 1e-5, 2e-5) || !entranceSegmentClear(x, y, z, x, y, z, 1e-5);
  const cameraRockMaterialAt = (x, y, z) => cameraPlatformAt(x, y, z) ? altar.slab.geometry.faces[0].color : island.rockMaterialAt(x, y, z);
  const bananaLightVisibleAt = (x, y, z, lx, ly, lz) => {
    const reach = RENDER_OPTS.shadowExtent * 3, toX = x + lx * reach, toY = y + ly * reach, toZ = z + lz * reach;
    return island.sightClearAt(x, y, z, toX, toY, toZ) && solids.segmentClear(x, y, z, toX, toY, toZ, 0, 1e-5)
      && bananaCover.segmentClear(x, y, z, toX, toY, toZ);
  };
  const cameraGlyphCoverage = (x, y, z) => {
    const caveIndex = island.rockCaveAt(x, y, z);
    if (caveIndex && caveIndex === MATRIX_WORLD.permanentCave) {
      const plane = MATRIX_WORLD.permanentPlane, aperture = MATRIX_WORLD.permanentAperture, at = (caveIndex - 1) * 4;
      const depth = -(plane[0] * x + plane[1] * y + plane[2] * z + plane[3]), bounds = MATRIX_WORLD.caveBounds, caves = MATRIX_WORLD.caves;
      const across = caves[at + 1] * (x - bounds[at]) - caves[at] * (z - bounds[at + 2]), height = y - bounds[at + 1];
      const room = depth > aperture[2] + 2.5 - aperture[3], throat = depth <= aperture[2];
      const half = throat ? aperture[0] : aperture[0] + (room ? 0.5 : 0) + aperture[3], ceiling = aperture[1] + (room && !throat ? 1 : 0);
      if (depth >= -1e-6 && depth <= bounds[at + 3] + aperture[3] && Math.abs(across) <= half + 1e-6 && height >= -1e-6 && height <= ceiling + 1e-6) return 1;
    }
    return matrixCoverage(x, z, caveIndex);
  };
  // Outline contrast is global; the material within rock follows the same
  // local cave ownership and radial front as the rendered stone surfaces.
  const CAMERA_GLYPHS = { coverageAt: cameraGlyphCoverage, version: 0, time: 0, radius: -1, active: -1, permanentCave: -1 };
  const guideSegmentClear = (x, y, z, toX, toY, toZ) => island.sightClearAt(x, y, z, toX, toY, toZ);
  guideSegmentClear.boxClear = (minX, minY, minZ, maxX, maxY, maxZ) => island.sightBoxClearAt(minX, minY, minZ, maxX, maxY, maxZ);
  guideSegmentClear.boxSolid = (minX, minY, minZ, maxX, maxY, maxZ) => island.sightBoxSolidAt(minX, minY, minZ, maxX, maxY, maxZ);
  const GUIDE_RAMP_COLUMN = { floor: 0, ceiling: 0 };
  const exteriorRampGuides = (player) => {
    const eye = camera.position, p = player.root.position, feet = p.y - player.baseY;
    // The exception belongs to the descent, not the flat entrance corridor
    // or a camera occupying another room/window inside the island.
    if (feet >= -0.1) return false;
    const outside = !island.onLand(eye.x, eye.z)
      || eye.y < -Math.ceil(island.undersideDepthAt(Math.hypot(eye.x, eye.z)) / island.unit) * island.unit;
    if (!outside) return false;
    for (let layer = 0; layer < 2; layer++) if (island.rampColumnAt(p.x, p.z, !!layer, GUIDE_RAMP_COLUMN)
      && feet >= GUIDE_RAMP_COLUMN.floor - 0.3 && feet < GUIDE_RAMP_COLUMN.ceiling) return true;
    return false;
  };
  const guideEyeAt = (player, out) => {
    // A full turn uses one stable eye anchor, independent of the current head
    // yaw. A resting head keeps the same pillow clearance as first person.
    cameraHeadAt(out, player);
    if (!crew.sleeping) out.y += player.viewLift;
  };
  const GUIDE_ACTOR_FORWARD = new Float64Array(3);
  const guideActorVisibleAt = (x, y, z) => {
    const p = camera.position, dx = x - p.x, dy = y - p.y, dz = z - p.z;
    const depth = dx * GUIDE_ACTOR_FORWARD[0] + dy * GUIDE_ACTOR_FORWARD[1] + dz * GUIDE_ACTOR_FORWARD[2];
    const start = camera.near / depth, end = 1 - 0.018 / Math.hypot(dx, dy, dz);
    if (end <= start) return false;
    const ax = p.x + dx * start, ay = p.y + dy * start, az = p.z + dz * start, bx = p.x + dx * end, by = p.y + dy * end, bz = p.z + dz * end;
    return guideSegmentClear(ax, ay, az, bx, by, bz) && objectGuides.cameraClear(ax, ay, az, bx, by, bz, crew.player, crew.player.root);
  };
  const trackMirrorObject = (node, radius, vertexCapacity) => mirrorCave?.body?.track(node, radius, vertexCapacity);
  const untrackMirrorObject = (node) => mirrorCave?.body?.untrack(node);
  const refreshMirrorObject = (node) => {
    mirrorCave?.body?.refresh(node);
    if (crew) for (let i = 0; i < crew.list.length; i++) {
      const actor = crew.list[i];
      if (actor.root !== node) continue;
      MIRROR_ACTOR_RADII.delete(actor);
      mirrorActorRadius(actor);
      break;
    }
  };
  const refreshObjectGuides = () => {
    // Model changes also happen during scene construction, before the cache.
    if (objectGuides) {
      objectGuides.refresh();
      sightGuides.reserve(objectGuides.result, null);
      bananaGuides.reserve(objectGuides.result, null);
    }
  };
  let uiGuideObjects = null, uiGuidesReady = false, preparingGuideActor = null;
  const collectViewObjects = () => {
    const player = crew.player, p = player ? player.root.position : camera.target;
    return objectGuides.collect(player, p.x, p.y, p.z, camera, renderer.size.width / Math.max(1, renderer.size.height), sightGuides.state.retainedOwners, sightGuides.state.retainedCount);
  };
  const characterUiOccluded = (cave) => {
    // Input-time tooltips may run before this frame's transforms are rendered.
    // Use rock certificates only during the overlay, after updating providers;
    // all other callers keep the exact visibility query.
    if (!uiGuidesReady) return false;
    if (!uiGuideObjects) uiGuideObjects = collectViewObjects();
    return !objectGuides.actorVisible(cave, guideSegmentClear);
  };
  const prepareCoveredView = (overlayCanvas) => {
    const actor = crew.list.find((cave) => cave.root.visible);
    if (!actor) return;
    // Exercise the first covered-view paths behind the loading curtain. The
    // real camera, bodies and controls stay untouched; only presentation
    // caches and their bounded canvases are prepared for later navigation.
    BL.scene.updateWorld(root);
    const p = actor.root.position, aspect = renderer.size.width / Math.max(1, renderer.size.height);
    const view = createCamera();
    view.fov = camera.fov; view.near = camera.near; view.far = camera.far;
    setVec(view.target, p.x, p.y + 0.8, p.z);
    setVec(view.position, p.x, p.y + 8, p.z + 50);
    try {
      preparingGuideActor = actor;
      const objects = objectGuides.collect(actor, p.x, p.y, p.z, view, aspect);
      const guides = sightGuides.update(actor, null, objects, view, aspect, 0.25, true);
      const observer = guides.observer;
      guides.structure = rockGuides.select(p.x, p.y - actor.baseY, p.z, view.position.x, view.position.y, view.position.z);
      guides.structures = rockGuides.updateSurfaces(observer[19], observer[20], observer[21], view, 0.25, actor, objectGuides.perceptionClear, objects.occlusionVersion, objects.perceptionVersion);
      cameraCover.draw(view, actor.root, false, true, cameraRockAt, cameraRockMaterialAt, guides, 0.25);
    } finally {
      preparingGuideActor = null;
      const guides = sightGuides.update(null, null, null, camera, aspect, 0, false);
      guides.structure = guides.structures = null;
      rockGuides.resetSurface();
      cameraCover.draw(camera, null, false, false, cameraRockAt, cameraRockMaterialAt, guides, 0);
      collectViewObjects();
      const context = overlayCanvas.getContext("2d");
      context.save(); context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); context.restore();
    }
  };
  const drawFirstPersonFire = (player) => {
    if (!player || !pilot.closeWanted || pilot.closeMix < 0.98) return;
    crew.fireView(player, FIRE_VIEW);
    const coverage = FIRE_VIEW.coverage, ember = FIRE_VIEW.ember, soot = FIRE_VIEW.soot;
    if (coverage <= 0 && soot <= 0) return;
    const context = overlayCanvas.getContext("2d"), width = overlayCanvas.width, height = overlayCanvas.height;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    if (coverage > 0) {
      // Heat closes in as the fire reaches more body parts. Full body coverage
      // is opaque, while the second layer brightens as those embers heat up.
      context.globalAlpha = coverage;
      context.fillStyle = "#8f260b";
      context.fillRect(0, 0, width, height);
      context.globalAlpha = ember;
      context.fillStyle = "#ff6d16";
      context.fillRect(0, 0, width, height);
      const count = Math.ceil(FIRE_SPECKS.length / 4 * Math.sqrt(coverage));
      context.fillStyle = "#ffe176";
      context.globalAlpha = Math.min(1, 0.3 + ember * 0.7);
      for (let i = 0; i < count; i++) {
        const at = i * 4, size = FIRE_SPECKS[at + 2] * Math.min(width, height) * (0.7 + ember * 1.3);
        const x = FIRE_SPECKS[at] * width;
        const y = ((FIRE_SPECKS[at + 1] - now * (0.05 + FIRE_SPECKS[at + 3] * 0.08)) % 1 + 1) % 1 * height;
        context.fillRect(x - size * 0.5, y - size * 0.5, size, size);
      }
    }
    if (soot > 0) {
      // The roll replaces heat with the actual accumulated char coverage;
      // that same coverage then recedes with the body's soot fade.
      context.globalAlpha = soot;
      context.fillStyle = "#090807";
      context.fillRect(0, 0, width, height);
    }
    context.restore();
  };
  const overlay = (dt) => {
    sleepSightFrame++;
    if (CAMERA_GLYPHS.radius !== MATRIX_WORLD.radius || CAMERA_GLYPHS.active !== MATRIX_WORLD.active || CAMERA_GLYPHS.permanentCave !== MATRIX_WORLD.permanentCave) {
      CAMERA_GLYPHS.radius = MATRIX_WORLD.radius; CAMERA_GLYPHS.active = MATRIX_WORLD.active; CAMERA_GLYPHS.permanentCave = MATRIX_WORLD.permanentCave;
      CAMERA_GLYPHS.version++;
    }
    CAMERA_GLYPHS.time = MATRIX_WORLD.time;
    const player = crew.player;
    const insideMirror = !!player && playerCaveIndex === matrixCave.caveIndex;
    mirrorGuides.update(insideMirror, MATRIX_WORLD.time, MATRIX_WORLD.density);
    const bananaActor = bananaCover.prepare(camera, player);
    uiGuideObjects = null; uiGuidesReady = true;
    try { fx.drawOverlay(dt, drawExtra); } finally { uiGuidesReady = false; }
    let touchesRock = false, occluded = false, guides = null, exteriorRamp = false;
    if (pilot.closeMix < 1) {
      const eye = camera.position, tangent = Math.tan(camera.fov / 2), aspect = renderer.size.width / Math.max(1, renderer.size.height);
      const radius = camera.near * Math.sqrt(1 + tangent * tangent * (1 + aspect * aspect));
      // A cheap enclosing-volume check avoids sampling an entirely clear view.
      // The cover then caps only solid rock intersecting the actual near plane.
      touchesRock = island.solidAt(eye.x, eye.y, eye.z)
        || eye.y + radius >= 0 && eye.y - radius <= ALTAR_HEIGHT && Math.hypot(eye.x, eye.z) <= altar.platformRadius + radius
        || !island.clearAt(eye.x, eye.y - radius, eye.z, radius, radius * 2)
        || !entranceSegmentClear(eye.x, eye.y, eye.z, eye.x, eye.y, eye.z, radius);
    }
    if (player) {
      const p = player.root.position, aspect = renderer.size.width / Math.max(1, renderer.size.height);
      const objects = uiGuideObjects || collectViewObjects();
      exteriorRamp = !pilot.closeWanted && pilot.closeMix < 1 && exteriorRampGuides(player);
      const viewEligible = !pilot.closeWanted && pilot.closeMix < 1;
      const actorVisible = viewEligible && objectGuides.actorVisible(player, guideSegmentClear);
      const rockSection = viewEligible && touchesRock && actorVisible && !exteriorRamp;
      const objectsEnabled = viewEligible && (exteriorRamp || rockSection || !actorVisible);
      const bananaEnabled = bananaCover.state.cameraInPile;
      occluded = objectsEnabled;
      guides = sightGuides.update(player, null, objects, camera, aspect, dt, objectsEnabled, rockSection);
      // Keep a separate cap pass so split objects remain legible in fruit
      // without changing the visibility rules in the clear part of the view.
      const fruitGuides = bananaGuides.update(bananaEnabled ? player : null, null, objects, camera, aspect, dt, bananaEnabled, true);
      if (objectsEnabled || bananaEnabled) {
        const structure = rockGuides.select(p.x, p.y - player.baseY, p.z, camera.position.x, camera.position.y, camera.position.z), observer = guides.observer;
        const surfaces = rockGuides.updateSurfaces(observer[19], observer[20], observer[21], camera, dt, player, objectGuides.perceptionClear, objects.occlusionVersion, objects.perceptionVersion);
        guides.structures = objectsEnabled ? surfaces : null; guides.structure = objectsEnabled ? structure : null;
        fruitGuides.structures = bananaEnabled ? surfaces : null; fruitGuides.structure = bananaEnabled ? structure : null;
      } else { guides.structure = fruitGuides.structure = null; guides.structures = fruitGuides.structures = null; rockGuides.resetSurface(); }
    } else {
      sightGuides.update(null, null, null, camera, 1, dt);
      bananaGuides.update(null, null, null, camera, 1, dt, false, true);
      sightGuides.state.structure = null;
      sightGuides.state.structures = null;
      bananaGuides.state.structure = bananaGuides.state.structures = null;
      rockGuides.resetSurface();
    }
    if (exteriorRamp || bananaActor) {
      const p = camera.position, t = camera.target, length = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
      GUIDE_ACTOR_FORWARD[0] = (t.x - p.x) / length; GUIDE_ACTOR_FORWARD[1] = (t.y - p.y) / length; GUIDE_ACTOR_FORWARD[2] = (t.z - p.z) / length;
    }
    cameraCover.state.opacity = 0.22 * (1 - pilot.closeMix);
    cameraCover.draw(camera, bananaActor ? null : player?.root, touchesRock, occluded, cameraRockAt, cameraRockMaterialAt, guides, dt, MATRIX_WORLD.active ? 1 : 0, CAMERA_GLYPHS, exteriorRamp ? guideActorVisibleAt : null);
    bananaCover.draw(camera, player, dt, guideActorVisibleAt, bananaGuides.state, CAMERA_GLYPHS);
    drawFirstPersonFire(player);
  };

  // ---------- actions and keys ----------
  const onLootCleared = () => {
    if (!lootEnabled) return;
    crew.applyAllSwag();
    crew.renderLocker();
    hud.toast("Loot locker cleared");
  };
  const clearLoot = () => {
    game.clearLoot();
    onLootCleared();
  };
  const demoTip = (sats) => onDonation({ id: `demo-${Date.now()}`, sats, handle: game.state.handle, message: game.state.message, at: Date.now() });
  const addTestBananas = (amount) => {
    pile.deliverBananas(amount);
    hud.toast(`+${amount} test bananas`);
  };
  const resetDemo = () => {
    game.resetAll();
    location.reload();
  };
  const onKey = (e) => {
    if (e.key === "0") {
      if (!e.repeat) pilot.modeAction("mode-toggle");
      return;
    }
    if ((e.key === "1" || e.key === "2") && pilot.weaponMode(Number(e.key))) return;
    if (e.key === "Escape") pilot.release();
    if (e.key === "b" || e.key === "B") addTestBananas(testBananas);
    if (e.key === "l" || e.key === "L") demoTip(120000);
    if (e.key === "p" || e.key === "P") {
      world.level = Math.max(world.level, pile.slots.length);
      pile.syncPile(true);
    }
    // J mirrors the carried jetpack button without changing its fuel.
    if ((e.key === "j" || e.key === "J") && !e.repeat) toggleJetpack();
    if (e.key === "g" || e.key === "G") pilot.weaponAction("weapon-toggle");
    if (e.key === "v" || e.key === "V") pilot.weaponAction("weapon-fire");
    const digit = parseInt(e.key, 10);
    if (digit >= 1 && digit <= 9) {
      const contributor = contributors.roster[digit - 1];
      const cave = contributor && crew.cavemen.get(contributor.name);
      if (cave && crew.stateOf(cave) !== "working") {
        cave.override = "working";
        crew.refreshStates();
      }
    }
  };

  // ---------- scene contract ----------
  const enter = (ctx) => {
    ({ renderer, game, world, go, lootEnabled, testBananas } = ctx);
    overlayCanvas = ctx.overlay;
    jetpackState = world.jetpack || (world.jetpack = { owned: false, owner: null, fuel: 1 });
    magazineState = {
      get owned() { return !!crew && crew.hasMagazine(crew.player); },
      get ammo() { return crew ? crew.magazineAmmo(crew.player) : 0; },
      get count() { return crew ? crew.magazineCount(crew.player) : 0; },
      get carrier() { return crew && crew.hasMagazine(crew.player) ? crew.player.traits.name : null; }
    };
    magazine = null;
    jetpackState.fuel = Math.max(0, Math.min(1, Number.isFinite(jetpackState.fuel) ? jetpackState.fuel : 1));
    if (!jetpackState.owned) jetpackState.owner = null;
    // Underground starts carry the requested pack without equipping it or
    // automatically selecting an Ooga. Ownership survives the trip outside.
    if (ctx.from === null && preloadedJetpack && !preloadedJetpackWear) jetpackState.owned = true;
    jetpackCarrier = jetpackWearer = lastJetpackCloud = null;
    MATRIX_WORLD.active = MATRIX_WORLD.direction = MATRIX_WORLD.radius = MATRIX_WORLD.time = MATRIX_WORLD.permanentCave = 0;
    MATRIX_WORLD.livingGlobal = 0;
    MATRIX_WORLD.density = renderer.kind === "canvas2d" ? MATRIX_DENSITY.canvas2d / MATRIX_DENSITY.high : MATRIX_DENSITY[renderer.quality] / MATRIX_DENSITY.high;
    camera = createCamera({ fov: 48, near: 0.5, far: 140 });
    root = createNode();
    positionDebug = document.getElementById("position-debug");
    positionDebug.hidden = !POSITION_DEBUG;
    positionDebugNext = 0;
    positionDebugJSON = "";
    if (POSITION_DEBUG) positionDebug.addEventListener("click", copyPositionDebug);
    solids = BL.solidProps.create();
    clock = daylight.createClock({ hour: hourParam, daylen: daylenParam, day: dayParam, time: timeParam, now: new Date() });
    phase = null;
    island = terrain.island({ seed: SEED });
    guideSegmentClear.boxGrid = island.sightGrid;
    buildCameraRamps();
    cameraCaveIndex = 0;
    cameraEntranceIndex = 0;
    cameraPreviousValid = false;
    cameraUnrestricted = cameraReentering = false;
    cameraTrailPlayer = null;
    cameraTrailCount = cameraTrailNext = 0;
    cameraTrailSleeping = false;
    cameraManualContact = false;
    cameraTerrainValid = false;
    cameraTerrainRecovering = false;
    cameraTerrainEntranceIndex = 0;
    caveEntryPlayer = null;
    playerCaveIndex = 0;
    CAMERA_OPENINGS.length = 0;
    MATRIX_WORLD.caveNear = Infinity;
    for (let i = 0; i < island.mouths.length; i++) {
      const m = island.mouths[i], sr = Math.sin(m.ry), cr = Math.cos(m.ry), offset = i * 4;
      const slot = caves.slots.find((candidate) => candidate.id === m.id);
      const blocked = slot.status === "dark";
      CAMERA_OPENINGS.push({ id: m.id, caveIndex: i + 1, mouth: m, sr, cr, minX: PORTAL_MIN_X, maxX: PORTAL_MAX_X, minY: PORTAL_MIN_Y, maxY: PORTAL_MAX_Y, planeZ: PORTAL_Z, blocked, headquarters: slot.status === "headquarters", ramp: slot.status === "headquarters" ? island.headquarters.ramps.find((entry) => entry.id === m.id) : null, stopZ: blocked ? 0.53 + hubModels.sealedCaveFace(sealedCaveVariant(slot.id)).frontZ : PORTAL_Z, rim: hubModels.caveMouthRim().openingBounds });
      MATRIX_WORLD.caves[offset] = sr;
      MATRIX_WORLD.caves[offset + 1] = cr;
      MATRIX_WORLD.caves[offset + 2] = sr * m.x + cr * m.z + PORTAL_Z;
      MATRIX_WORLD.caves[offset + 3] = Math.hypot(m.x + sr * PORTAL_Z - MATRIX_WORLD.origin[0], m.z + cr * PORTAL_Z - MATRIX_WORLD.origin[2]);
      MATRIX_WORLD.caveBounds[offset] = m.x;
      MATRIX_WORLD.caveBounds[offset + 1] = m.floorY;
      MATRIX_WORLD.caveBounds[offset + 2] = m.z;
      MATRIX_WORLD.caveBounds[offset + 3] = 7;
      MATRIX_WORLD.caveNear = Math.min(MATRIX_WORLD.caveNear, MATRIX_WORLD.caves[offset + 3] - 4);
    }
    mark("island");
    hud = hudMod.create({ roster: contributors.activeRoster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled });
    hooks = {};
    input = interactMod.create({ canvas: ctx.canvas, renderer, camera, hooks });
    presets = { pile: PILE_VIEW, gate: GATE_VIEW };
    pilot = pilotMod.create({ renderer, canvas: ctx.canvas, camera, hud, presets, landing: "pile", pitch: [PITCH_MIN, PITCH_MAX], dist: [DIST_MIN, DIST_MAX], follow: FOLLOW, fly: FLY, clampTarget, clampCamera, ceilingAt, releaseView: releaseCameraView, enterFreeView: enterFreeCameraView, coarse: COARSE, onFreeAction: freeAction, jetpackStatus: jetpackHudStatus, close: { ...CLOSE_VIEW, maxStep: STEP_MAX, groundAt: playerSupportAt, visualGroundAt: visualSupportAt, sleepEyeFloorAt, cloudAt, zone: () => playerCaveIndex } });
    place(island.geometry, 0, 0, 0, 0);
    const pathGeometry = { ...island.path.geometry, faces: island.path.geometry.faces.map(face => ({ ...face, matrixPermanentFallback: true })) };
    pathNode = createNode({ geometry: pathGeometry, instanceData: island.path.instanceData, instanceCount: 0, instanceVersion: 0, depthBias: 0.05 });
    addChild(root, pathNode);
    placed.push(pathNode);
    altar = buildAltar();
    const layoutPile = (radius) => {
      altar.setRadius(radius);
      CAMERA_GLYPHS.version++;
      const changed = island.path.setRadius(altar.platformRadius);
      island.path.apply(pathNode);
      if (changed) reflowScenery();
    };
    layoutPile(pileMod.visualFootprintFor(world.level, PILE_SCALE));
    const gate = place(hubModels.gate(), island.gate.x, island.gate.z, island.gate.ry);
    solids.add(gate);
    gateRain = buildGateRain(gate);
    addTarget(gate, { kind: "gate" }, { radius: 3 });
    props.push({ kind: "prop", prop: "gate", node: gate, x: gate.position.x, z: gate.position.z, ripe: 0, active: true });
    claim(gate.position.x, gate.position.z, 3);
    TICKER_AT.y = gate.position.y + 6;
    GATE_VIEW.target.y = gate.position.y + 2.5;
    headquarters = buildHeadquarters();
    const bedrolls = headquarters.mattresses;
    headquarters.sleepAnchors = bedrolls;
    for (const slot of caves.slots) {
      const m = island.mouths.find((mouth) => mouth.id === slot.id);
      addTarget(buildMouth(slot, m), { kind: "cave", slot, priority: 1 }, { radius: 2.6 });
      claim(m.x, m.z, 3.5);
      if (slot.scene) {
        presets[slot.scene] = mouthView(m);
        openMouths.push({ slot, m, actionX: m.x + Math.sin(m.ry) * RALLY_KART_Z, actionZ: m.z + Math.cos(m.ry) * RALLY_KART_Z });
      }
    }
    // The roof view the drop launch dollies onto
    for (const roof of launchers) presets.drop = { yaw: roof.ry, pitch: 0.36, dist: 14, target: { x: roof.x, y: roof.y + 1.2, z: roof.z } };
    const buildSpotsList = BUILD_DEGREES.map((deg) => {
      const { x, z } = spotAt(deg, BUILD_RADIUS, 1);
      claim(x, z, 0.9);
      return { x, z, ry: Math.atan2(-x, -z) };
    });
    buildRim();
    buildLaunchSite();
    const firePos = buildFire();
    fire = lamps[lamps.length - 1];
    // The jumbotron: a stadium stats board standing on the rim crest just
    // west of the gate, turned to face the meadow center.
    {
      const jx = -7, jz = -27, jScale = 2.6;
      const jry = Math.atan2(-jx, -jz);
      claim(jx, jz, 3.4);
      const legDrop = 0.6 + 0.6 + 0.06; // cabinet half + leg + foot, in local units
      jumbotron = BL.jumbotron.create({
        data: BL.jumbotronData,
        position: { x: jx, y: island.surfaceAt(jx, jz) + legDrop * jScale, z: jz },
        ry: jry,
        scale: jScale
      });
      addChild(root, jumbotron.node);
      placed.push(jumbotron.node);
      addProp("jumbotron", jumbotron.node, jx, jz, 3.4);
    }
    scatter();
    reflowScenery();
    buildSpots();
    buildClouds();
    if (!jetpackState.owned) spawnJetpackPickup();
    spawnMagazinePickup();
    critters = crittersMod.create({ root, renderer, flowers: scenery.filter((o) => o.prop === "flower" && o.active), fire: firePos, secondaryFire: { x: 0, y: island.headquarters.floor, z: 0 }, meadowRadius: MEADOW, heightAt: island.surfaceAt });
    mark("props");
    const shared = { root, input, hooks, hud, game, world, renderer, camera, overlay: ctx.overlay, overlayVisible: matrixOverlayVisible, zzzVisible: sleepMarksVisible, tickerAt: TICKER_AT, buildSpots: buildSpotsList, walkIn: WALK_IN, clampDrag, viewYaw: PILE_VIEW.yaw, bedrolls, pileScale: PILE_SCALE, pileY: ALTAR_HEIGHT + 0.02, matrixLivingPile: true, onLayout: layoutPile, onShown: () => { meterTimer = 0; }, crateRadius: () => Math.max(4.4, altar.platformRadius + 0.8), groundAt: playerSupportAt, prepareCloudSupport, cloudAt, ceilingAt, wanderSpot, walkable, flyable, glideJetCeiling, useNear, abyssAt, abyssRespawnY: ABYSS_RESPAWN_Y, jetpackAllowed, phase: () => phase };
    shared.dropStunJetpack = (cave) => {
      if (!jetpackState.owned || jetpackState.owner !== cave.traits.name) return null;
      syncJetpackFuel();
      const fuel = cave.jetFuel, equipped = !!cave.jet;
      if (cave.jet) crew.removeJetpack(cave);
      crew.setJetpackOwnership(cave, false);
      if (jetpackWearer === cave) jetpackWearer = null;
      jetpackCarrier = null;
      jetpackState.owned = false;
      jetpackState.owner = null;
      jetpackState.fuel = fuel;
      if (pilot) pilot.showAct();
      return { geometry: hubModels.jetpack(), fuel, equipped };
    };
    shared.collectStunJetpack = (cave, fuel, equip) => {
      if (jetpackState.owned) return false;
      jetpackState.owned = true;
      jetpackState.owner = cave.traits.name;
      jetpackState.fuel = cave.jetFuel = Math.max(0, Math.min(1, fuel));
      jetpackCarrier = cave;
      crew.setJetpackOwnership(cave, true, hubModels.jetpack(), hubModels.jetFlame());
      if (equip && jetpackAllowed(cave)) {
        crew.wearJetpack(cave, hubModels.jetpack(), hubModels.jetFlame());
        jetpackWearer = cave;
      }
      if (pilot) pilot.showAct();
      return true;
    };
    shared.reloadRadius = () => island.path.debug.ringOuterRadius;
    shared.reloadHeight = ALTAR_HEIGHT;
    shared.onAbyssRespawn = loseMagazine;
    shared.characterOccluded = characterUiOccluded;
    fx = shared.fx = fxMod.create(shared);
    shared.characterSupportAt = characterSupportAt;
    shared.carryCharacter = carryCharacter;
    shared.npcWalkable = npcWalkable;
    shared.prepareNpcRoutes = refreshWorkZones;
    shared.npcDetour = npcWorkDetour;
    shared.npcRouteBlocked = (cave, x, y, z) => npcClosedCaveAt(x, z, y, cave.bodyHeight) || npcWorkZoneAt(cave, x, y, z);
    shared.shoulderObstacleActive = solids.isActive;
    shared.shoulderObstacle = (cave, fx, fz, reach, out) => {
      const p = cave.root.position;
      if (!solids.shoulderAt(p.x, p.y - cave.baseY + STEP_MAX, p.z, fx, fz, PLAYER_RADIUS, Math.max(0, cave.bodyHeight - STEP_MAX), reach, out, p.y - cave.baseY + 1e-7)) return false;
      if (!out.node.sightSolid) return true;
      // A level probe can hit later stair treads above the current feet.
      // Follow ordinary support in short swept steps before treating the
      // whole staircase as a tall prop that must be passed sideways.
      const steps = Math.max(1, Math.ceil(reach / 0.125));
      let x = p.x, z = p.z, feet = p.y - cave.baseY;
      for (let i = 1; i <= steps; i++) {
        const nx = p.x + fx * reach * i / steps, nz = p.z + fz * reach * i / steps;
        const floor = playerSupportAt(nx, nz, feet, feet, cave);
        if (floor < feet - STEP_MAX - 1e-7 || !walkable(x, z, nx, nz, feet, cave.bodyHeight, cave)) return true;
        x = nx; z = nz; feet = floor;
      }
      return false;
    };
    // Once a tall prop causes a shoulder pass, stay beside its lower tiers
    // instead of mounting one and interrupting the return to the walking line.
    shared.shoulderPropClear = (cave, x, z) => {
      const p = cave.root.position, feet = p.y - cave.baseY + 1e-5;
      return solids.segmentClear(p.x, feet, p.z, x, feet, z, PLAYER_RADIUS, cave.bodyHeight - 1e-5);
    };
    shared.onBodyMove = moveCampBody;
    mirrorCave.damage = BL.mirrorDamage.create(mirrorCave.node, (geometry) => renderer.releaseGeometry(geometry), (x, z, y) => island.supportAt(x, z, y, 0));
    mirrorCave.damageStage = mirrorCave.damage.stage;
    mirrorCave.damageVersion = mirrorCave.damage.version;
    mirrorCave.shattered = false;
    mirrorCave.ripples = BL.mirrorRipples.create(mirrorCave.node);
    shared.onProjectileMove = mirrorCave.ripples.cross;
    shared.onWeaponImpact = weaponImpact;
    shared.onMeleeStrike = mirrorCave.ripples.strike;
    shared.aimSurface = mirrorCave.ripples.aimAt;
    shared.continueShot = mirrorCave.ripples.continueShot;
    shared.fireReachable = (x, y, z, toX, toY, toZ, ignoreNode = null, precise = false) => actionReachable(x, y, z, toX, toY, toZ, precise ? 1e-6 : 0.025)
      && solids.segmentClear(x, y, z, toX, toY, toZ, precise ? 1e-6 : 0.01, precise ? 2e-6 : 0.02, ignoreNode)
      && matrixGateSegmentClear(x, y, z, toX, toY, toZ, precise ? 1e-6 : 0.01, precise ? 2e-6 : 0.02);
    // Cursor selection needs a surface point, not the projectile's clearance
    // margin: that small vertical gap becomes a large miss along a distant floor.
    shared.cursorReachable = (x, y, z, toX, toY, toZ) => actionReachable(x, y, z, toX, toY, toZ, 0.001)
      && solids.segmentClear(x, y, z, toX, toY, toZ, 0.001, 0.002)
      && matrixGateSegmentClear(x, y, z, toX, toY, toZ, 0.001, 0.002);
    shared.inBananas = inBananas;
    shared.npcDestinationBlocked = npcDestinationBlocked;
    shared.npcLandingAllowed = (x, y, z, height, cave) => !npcCaveRimAt(x, y, z) && !npcClosedCaveAt(x, z, y, height) && !npcPileAt(x, y, z, height) && !npcWorkZoneAt(cave, x, y, z) && npcFireClear(x, y, z, x, y, z, height);
    shared.npcRecoveryDrop = (x, y, z) => npcCaveRimAt(x, y, z);
    shared.npcHazardClear = (x, y, z, toX, toY, toZ, height, cave) => npcClosedCaveClear(x, y, z, toX, toY, toZ, height) && npcFireClear(x, y, z, toX, toY, toZ, height) && npcWorkZoneClear(cave, x, y, z, toX, toY, toZ);
    shared.onModelChange = refreshObjectGuides;
    shared.trackMirrorObject = trackMirrorObject;
    shared.untrackMirrorObject = untrackMirrorObject;
    shared.refreshMirrorObject = refreshMirrorObject;
    cameraCover = BL.cameraCover.create(ctx.overlay);
    headquarters.cameraCover = cameraCover.state;
    headquarters.glyphMaterial = CAMERA_GLYPHS;
    rockGuides = headquarters.rockGuides = BL.rockGuides.create({ island, sealed: sealedCaves });
    mark("rockGuides");
    pile = shared.pile = pileMod.create(shared);
    bananaCover = BL.bananaCover.create({ overlay: ctx.overlay, pile, renderOpts: RENDER_OPTS, renderer, floor: ALTAR_HEIGHT, lightVisibleAt: bananaLightVisibleAt });
    headquarters.bananaCover = bananaCover;
    solids.sync();
    shared.npcPaths = headquarters.npcPaths = BL.npcPaths.create({ island, walkable: npcWalkable, pointAllowed: (x, z) => !npcClosedCaveAt(x, z),
      surfaceAt: (x, z, y) => island.supportAt(x, z, y, 1e-6, null, PLAYER_RADIUS) });
    const sleepNavigation = headquarters.sleepNavigation = BL.headquartersSleep.create({ island, beds: bedrolls, walkable: sleepRouteClear, surfaceRoute: shared.npcPaths.route });
    const sleepRouteFrom = { x: 0, y: 0, z: 0 };
    shared.bedRoute = (cave, bed, toBed) => sleepNavigation.route(cave.root.position.x, cave.root.position.y - cave.baseY, cave.root.position.z, bed, toBed, cave.slot?.x, cave.slot?.z);
    shared.bedRouteClear = (cave, to) => {
      const p = cave.root.position;
      sleepRouteFrom.x = p.x; sleepRouteFrom.y = p.y - cave.baseY; sleepRouteFrom.z = p.z;
      return sleepNavigation.clearSegment(sleepRouteFrom, to, false, 0.3);
    };
    shared.workSites = caves.slots.filter((slot) => slot.repo && slot.status === "open").map((slot) => {
      const mouth = island.mouths.find((entry) => entry.id === slot.id), sr = Math.sin(mouth.ry), cr = Math.cos(mouth.ry);
      workZones.push({ x: mouth.x, z: mouth.z, floor: mouth.floorY, sr, cr, active: false, half: 3.4, front: 5.8 });
      const aimX = mouth.x + sr * 5.8, aimZ = mouth.z + cr * 5.8, approach = { x: aimX, z: aimZ };
      let nearest = Infinity;
      // Rejoin the painted trail itself, rather than an off-path mouth-axis
      // marker that makes every worker step sideways and retrace their steps.
      for (const line of island.path.centerlines) for (let n = 1; n < line.length; n++) {
        const a = line[n - 1], b = line[n], dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
        const t = length2 ? clamp(((aimX - a.x) * dx + (aimZ - a.z) * dz) / length2, 0, 1) : 0;
        const x = a.x + dx * t, z = a.z + dz * t, distance = (x - aimX) ** 2 + (z - aimZ) ** 2;
        if (distance < nearest) { nearest = distance; approach.x = x; approach.z = z; }
      }
      return {
        repo: slot.repo,
        route: [approach],
        approachDistance: 2.5,
        position: (cave, out) => {
          // Reserve the first free place in the fan. Leave the central path
          // open for reload traffic and stagger each extra row behind it.
          for (let place = 0; place < crew.cavemen.size; place++) {
            const row = Math.floor(place / 4), side = place & 1 ? 1 : -1;
            const x = side * (1.25 + Math.floor(place % 4 / 2) * 1.35 + (row & 1) * 0.6);
            const z = 2.8 + row * 1.35 + Math.abs(x) * 0.16;
            out.x = mouth.x + cr * x + sr * z;
            out.z = mouth.z - sr * x + cr * z;
            let occupied = false;
            for (let i = 0; i < crew.list.length; i++) {
              const other = crew.list[i];
              if (other === cave || other === crew.player || other.state !== "working"
                || other.work.phase !== "outbound" && other.work.phase !== "station" && other.work.phase !== "shoot"
                || shared.workSites[other.work.site]?.repo !== slot.repo) continue;
              if (Math.hypot(other.work.position.x - out.x, other.work.position.z - out.z) < 0.5) { occupied = true; break; }
            }
            if (!occupied) break;
          }
          out.y = mouth.floorY;
        },
        target: (cave, out) => {
          const rounds = 30 - cave.weapon.ammo, x = Math.sin(rounds * 1.7 + cave.index) * 2.1, z = -6;
          out.x = mouth.x + cr * x + sr * z;
          out.y = mouth.floorY + 0.8 + (rounds % 4) * 0.45;
          out.z = mouth.z - sr * x + cr * z;
        }
      };
    });
    mark("pile");
    crew = shared.crew = crewMod.create(shared);
    if (jetpackState.owned && jetpackState.owner) {
      jetpackCarrier = crew.cavemen.get(jetpackState.owner) || null;
      if (jetpackCarrier) {
        jetpackCarrier.jetFuel = jetpackState.fuel;
        crew.setJetpackOwnership(jetpackCarrier, true, hubModels.jetpack(), hubModels.jetFlame());
      } else {
        jetpackState.owned = false;
        jetpackState.owner = null;
        spawnJetpackPickup();
      }
    }
    mirrorCave.body = BL.mirrorBody.create(mirrorCave.node, crew.cavemen);
    if (jetpack) trackMirrorObject(jetpack.node, 2);
    if (magazine) trackMirrorObject(magazine.node, 1);
    for (let caveIndex = 0; caveIndex < crew.list.length; caveIndex++) {
      const cave = crew.list[caveIndex];
      cave.root.matrixLiving = true;
      cave.solidBounds = new Float64Array(6);
      mirrorActorRadius(cave);
    }
    headquarters.solids = { props: solids, supportAt: playerSupportAt, walkable, npcWalkable, flyable, ceilingAt, inBananas };
    headquarters.firingZones = workZones;
    headquarters.firingZoneAt = npcWorkZoneAt;
    shared.addSolid = solids.add;
    shared.removeSolid = solids.remove;
    mark("cavemen");
    crates = shared.crates = cratesMod.create(shared);
    pilot.bind(shared);
    breakables = headquarters.breakables = BL.breakables.create({ root, input, renderer, fx, crew,
      collectReward: collectBreakableReward, deactivate: deactivateBreakable, relocate: relocateBreakable,
      onAmmoPickup: (added, remaining) => {
        pilot.showAct();
        hud.toast(remaining ? `+${added} ammo · ${remaining} left` : "Magazine collected");
      },
      trackMirrorObject, untrackMirrorObject });
    for (const owner of scenery) breakables.register(owner);

    hud.onAssign((entryId, name) => {
      if (game.assign(entryId, name)) {
        crew.applyAllSwag();
        crew.renderLocker();
        const cave = crew.cavemen.get(name);
        const item = game.itemOf(entryId);
        if (cave && item) {
          fx.say(cave, `Ooga! ${item.name}!`);
          hud.toast(`${item.name} → ${name}`);
        }
      }
    });
    hud.onUnassign((name) => {
      game.unassign(name);
      crew.applyAllSwag();
      crew.renderLocker();
    });
    const donationRequest = donations.createRequest(game.state);
    qr.drawTo(hud.el.qr, donationRequest.url, { quiet: 3, dark: "#000000", light: "#f3efe4" });
    mark("qr");
    hud.setDonationUrl(donationRequest.url);
    hud.setIdentity(game.state);
    hud.onIdentityChange(({ handle, message }) => {
      game.setIdentity({ handle: donations.sanitize(handle, donations.HANDLE_MAX), message: donations.sanitize(message, donations.MESSAGE_MAX) });
      hud.setIdentity(game.state);
    });

    Object.assign(hooks, {
      onHover: (hit, p) => {
        if (hit) hud.tooltip.show(tooltipFor(hit), p.x, p.y, hit.owner.cave);
        else hud.tooltip.hide();
      },
      onHoverMove: (hit, p) => hud.tooltip.show(tooltipFor(hit), p.x, p.y, hit.owner.cave),
      onTap,
      ...pilot.hooks
    });
    // Every visit starts on the landing view
    entering = false;
    enteringTween = null;
    now = 0;
    hud.onPreset(navigate);
    hud.setDetachedView("pile");
    hud.onAction((action, value) => {
      if (action === "tip") demoTip(1200);
      else if (action === "tip-legendary") demoTip(120000);
      else if (action === "clear-loot") clearLoot();
      else if (action === "reset") resetDemo();
      else if (action === "act") pilot.action();
      else if (action === "mode-preset") navigate(value);
      else if (action.startsWith("mode-")) pilot.modeAction(action);
      else if (action === "jetpack-toggle") toggleJetpack();
      else if (action.startsWith("weapon-") || action === "magazine-swap") pilot.weaponAction(action);
      else if (action === "reset-view") pilot.goPreset("pile");
    });
    meterTimer = 0;
    crew.refreshStates(true);
    unsubscribeActivity = contributors.subscribe(() => crew.refreshStates());
    let initialCharacter = ctx.from === null && preloadedCharacter ? contributors.activeRoster.find((entry) => entry.name.toLowerCase() === preloadedCharacter) : null;
    if (ctx.from === null && (preloadedJetpackWear || preloadedEquipment) && !params.has("character") && !initialCharacter) initialCharacter = contributors.activeRoster.find((entry) => crew.stateOf(crew.cavemen.get(entry.name)) === "working") || contributors.activeRoster[0];
    if (initialCharacter) {
      const cave = crew.cavemen.get(initialCharacter.name);
      if (!contributors.debugState && crew.stateOf(cave) !== "working") {
        cave.override = "working";
        crew.refreshStates(true);
      }
      pilot.possess(cave);
      crew.configureWeapon(cave, preloadedWeapon, preloadedAmmo);
    }
    const initialFirstPerson = ctx.from === null && preloadedFirstPerson;
    if (initialFirstPerson) pilot.enterClose(true);
    if (!crew.sleeping && (preloadedView || initialCharacter || initialFirstPerson)) navigate(preloadedView || "pile");
    if (initialCharacter && preloadedJetpack) {
      grantJetpack(pilot.player, preloadedJetpackWear);
    } else if (ctx.from === null && preloadedJetpack && jetpackState.owned && !jetpackState.owner) {
      const entry = contributors.activeRoster.find((candidate) => crew.stateOf(crew.cavemen.get(candidate.name)) === "working") || contributors.activeRoster[0];
      grantJetpack(crew.cavemen.get(entry.name), false);
    }
    // Once a minute, refresh states and trim the pool
    stateTimer = window.setInterval(() => {
      crew.refreshStates();
      fx.trimPool();
    }, 6e4);
    for (let i = 0; i < crew.list.length; i++) crew.refreshRosterRow(crew.list[i]);
    if (lootEnabled) {
      crew.applyAllSwag();
      crew.renderLocker();
    }
    hud.setStats(game.state);
    pile.syncPile(true);
    pileGuides = headquarters.pileGuides = BL.pileGuides.create({ pile, altar,
      cameraClear: (ax, ay, az, bx, by, bz) => guideSegmentClear(ax, ay, az, bx, by, bz) && objectGuides.cameraClear(ax, ay, az, bx, by, bz, preparingGuideActor || crew.player, pile.core),
      cameraBoundsState: (minX, minY, minZ, maxX, maxY, maxZ, propsOnly) => objectGuides.cameraBoundsState(minX, minY, minZ, maxX, maxY, maxZ, preparingGuideActor || crew.player, pile.core, guideSegmentClear, propsOnly),
      occlusionVersion: () => objectGuides.result.occlusionVersion
    });
    platformGuides = headquarters.platformGuides = BL.pileGuides.create({ pile, altar, platform: true });
    mirrorGuides = mirrorCave.guides = BL.mirrorGuides.create({ mirror: mirrorCave, stand: matrixControl.stand });
    // Scenery may receive outlines, but only island rock activates the hidden
    // character view. Banana interiors keep their separate covered-view pass.
    objectGuides = headquarters.objectGuides = BL.objectGuides.create({ roots: root.children, crew, exclude: [island.geometry, pathNode.geometry], providers: [pileGuides, platformGuides, mirrorGuides], propsBlockActor: false, perceptionThrough: (actor) => inBananas(actor) ? pile.core : null });
    const guideOptions = { segmentClear: guideSegmentClear, objectClear: objectGuides.cameraClear, actorClear: objectGuides.perceptionClear, eyeAt: guideEyeAt, ownerBoundary: objectGuides.ownerBoundaryAt, ownerPerceived: objectGuides.perceived, ownerConcealed: objectGuides.concealed, ownerDistance: objectGuides.distance, ownerInView: objectGuides.inView, ownerClear: objectGuides.ownerClear, getProvider: objectGuides.getProvider };
    sightGuides = BL.sightGuides.create(guideOptions);
    bananaGuides = BL.sightGuides.create(guideOptions);
    sightGuides.reserve(objectGuides.result, null);
    bananaGuides.reserve(objectGuides.result, null);
    headquarters.sightGuides = sightGuides.state;
    headquarters.bananaGuides = bananaGuides.state;
    mark("guides");
    updateMeter();
    if (window.matchMedia("(max-width: 720px), (max-height: 500px)").matches) hud.el.sheet.dataset.open = "false";
    hintTimer = window.setTimeout(() => {
      if (!pilot.player && !matrixControl.promptAction) hud.hint(COARSE ? "Drag to look · pinch to eye level · sticks to fly · tap a cave" : "Drag to look · scroll to eye level · WASD to fly · tap a cave to enter");
    }, 1200);
    Object.assign(hubScene, {
      root, camera, input,
      debug: {
        slots: pile.slots, drops: pile.drops, core: pile.core, shell: pile.shell, delivery: pile.delivery, spillEffect: pile.spillEffect, cavemen: crew.cavemen, crates: crates.list, lab: null, hud, applyAllSwag: crew.applyAllSwag, renderLocker: crew.renderLocker, demoTip, setPileLevel: pile.setLevel, refreshStates: crew.refreshStates, trimPool: fx.trimPool,
        get shown() {
          return pile.shown;
        },
        island, mouths: island.mouths, labels, launchers, camera, cameraPose: POSITION_POSE, crew, fx, controls: pilot.controls, props, altar, path: island.path.debug, headquarters, jumbotron,
        scenery: {
          get candidateCount() { return scenery.length; },
          get visibleCount() { return sceneryVisible; },
          get radiusCulledCount() { return sceneryRadiusCulled; },
          get pathCulledCount() { return sceneryPathCulled; },
          get fixedCulledCount() { return sceneryFixedCulled; },
          get visibilityReflowCount() { return sceneryReflows; },
          get clearanceRadius() { return island.path.debug.ringOuterRadius + SCENERY_CLEARANCE; }
        },
        mirrorCave,
        matrixGate: {
          gates: matrixGates,
          sealed: sealedCaves,
          get unlocked() { return matrixCave.unlocked; },
          get pressed() { return matrixControl.pressed; },
          get near() { return matrixControl.near; },
          get button() { return matrixControl.button; },
          get stand() { return matrixControl.stand; },
          get x() { return matrixControl.x; },
          get z() { return matrixControl.z; },
          get visibleHeight() { return 0; },
          get hiddenHeight() { return MATRIX_GATE_HIDDEN_Y; },
          segmentClear: matrixGateSegmentClear,
          ceilingAt: matrixGateCeilingAt,
          openNear(x, y, z, reach = MATRIX_BUTTON_USE_REACH) {
            const gate = pilot.player && nearbyMatrixGate(x, y, z, reach);
            if (!gate) return false;
            useNearbyAction(gate);
            return true;
          },
          press: () => toggleMatrixControl(),
          set: (unlocked) => setMatrixUnlocked(!!unlocked, true)
        },
        cameraCave: CAMERA_CAVE_DEBUG,
        matrixCave: {
          get streamCount() { return matrixCave.streams.length; },
          get glyphCount() { return matrixCave.glyphCount; },
          get surfaceSectionCount() { return matrixCave.sections.length; },
          get surfaceStreamCount() { return matrixCave.streams.length; },
          get surfaceGlyphCount() { return matrixCave.glyphCount; },
          get activeGlyphCount() { return matrixCave.activeGlyphCount; },
          get brightTipCount() { return matrixCave.brightTipCount; },
          get capacity() { return matrixCave.capacity; },
          get glyphVersion() { return matrixCave.glyphVersion; },
          get previousGlyphVersion() { return matrixCave.previousGlyphVersion; },
          get mutationHash() { return matrixCave.mutationHash; },
          get glyphCadenceHz() { return MATRIX_GLYPH_HZ; },
          get bufferCount() { return MATRIX_TYPES; },
          get bufferBytes() { return matrixCave.bufferBytes; },
          get registryBytes() { return matrixCave.registryBytes; },
          get surfaceMetadataBytes() { return matrixCave.surfaceMetadataBytes; },
          get registryHash() { return matrixCave.registryHash; },
          get allocationCount() { return matrixCave.allocationCount; },
          get rebuildCount() { return matrixCave.rebuildCount; },
          get quality() { return matrixCave.quality; },
          get qualityDensity() { return matrixCave.densityRankLimit / 8; },
          get surfacePitch() { return MATRIX_SURFACE_PITCH; },
          get surfaceGap() { return MATRIX_SURFACE_GAP; },
          get surfaceCounts() { return matrixCave.surfaceCounts; },
          get activeSurfaceCounts() { return matrixCave.activeSurfaceCounts; },
          get terrainFaceCount() { return matrixCave.terrainFaces; },
          get propFaceCount() { return matrixCave.propFaces; },
          get geometrySource() { return "carved-terrain"; },
          get minBrightness() { return matrixCave.minBrightness; },
          get maxBrightness() { return matrixCave.maxBrightness; },
          get minTrainLength() { return matrixCave.minTrainLength; },
          get maxTrainLength() { return matrixCave.maxTrainLength; },
          get minGapLength() { return matrixCave.minGapLength; },
          get maxGapLength() { return matrixCave.maxGapLength; },
          get movingGapCount() { return matrixCave.movingGapCount; },
          get maxLocalZ() { return matrixCave.maximumLocalZ; },
          get portalClearance() { return PORTAL_Z - matrixCave.maximumLocalZ; },
          get mirrorDistance() { return matrixCave.mirrorDistance; },
          get mirrorHeight() { return MATRIX_MIRROR_HEIGHT; },
          get mirrorReveal() { return matrixCave.mirrorNode.mirrorReveal; },
          sampleMotion: (category) => {
            for (let i = 0; i < matrixCave.sections.length; i++) {
              const section = matrixCave.sections[i];
              if (section.category !== category) continue;
              const stream = matrixCave.streams[section.streamStart];
              return {
                surface: category, direction: stream.direction, speed: stream.speed,
                head: stream.head, gap: stream.gap, flowMin: stream.flowMin, flowMax: stream.flowMax, flowRange: stream.flowRange,
                trainLength: stream.trainLength, gapLength: stream.gapLength,
                flowX: section.vx * stream.direction, flowY: section.vy * stream.direction, flowZ: section.vz * stream.direction,
                leadingGlow: stream.brightness,
                secondGlow: stream.brightness * (0.48 + 0.52 * (1 - 1 / stream.trainLength)),
                trailingGlow: stream.brightness * (0.48 + 0.52 / stream.trainLength)
              };
            }
            return null;
          },
          get updates() { return matrixCave.updates; },
          get prewarmCount() { return 0; },
          get preloaded() { return false; },
          get drawEnabled() { return matrixCave.drawEnabled; },
          get drawnGlyphCount() { return matrixCave.drawnGlyphCount; },
          get batchDrawCount() {
            let count = 0;
            for (let glyph = 0; glyph < MATRIX_TYPES; glyph++) count += matrixCave.nodes[glyph].drawInstanceCount;
            return count;
          },
          get preloadDistance() { return 0; },
          get revealedGlyphCount() { return matrixCave.revealedGlyphCount; },
          get visible() { return matrixCave.visible; },
          get inside() { return matrixCave.portal.inside; },
          get gateRain() { return gateRain; },
          get clouds() { return clouds; },
          get firstGlyphY() { return matrixCave.firstGlyphY; },
          world: {
            get active() { return !!MATRIX_WORLD.active; },
            get radius() { return MATRIX_WORLD.radius; },
            get direction() { return MATRIX_WORLD.direction; },
            get maxRadius() { return MATRIX_WORLD.maxRadius; },
            get permanentCave() { return MATRIX_WORLD.permanentCave; },
            get speed() { return MATRIX_WORLD.speed; },
            get retreatSpeed() { return MATRIX_WORLD.retreatSpeed; },
            get frontWidth() { return MATRIX_FRONT_WIDTH; },
            get density() { return MATRIX_WORLD.density; },
            get streamPitch() { return MATRIX_SURFACE_PITCH; },
            get glyphGap() { return MATRIX_SURFACE_GAP; },
            get pixelPitch() { return MATRIX_PIXEL_PITCH; },
            get pixelSize() { return MATRIX_PIXEL_SIZE; },
            get glyphCadenceHz() { return MATRIX_GLYPH_HZ; },
            get minimumStreamSpeed() { return MATRIX_STREAM_SPEED_MIN; },
            get maximumStreamSpeed() { return MATRIX_STREAM_SPEED_MIN + MATRIX_STREAM_SPEED_RANGE; },
            get minimumTrainLength() { return MATRIX_TRAIN_MIN; },
            get maximumTrainLength() { return MATRIX_TRAIN_MIN + MATRIX_TRAIN_RANGE - 1; },
            get minimumGapLength() { return MATRIX_TRAIN_GAP_MIN; },
            get maximumGapLength() { return MATRIX_TRAIN_GAP_MIN + MATRIX_TRAIN_GAP_RANGE - 1; },
            get palette() { return "#46ff70|#18dc4a"; },
            get leadingTipColor() { return "#d6ffe3"; },
            get voxelFaceShading() { return true; },
            get antialiasedGlyphEdges() { return true; },
            get caveEmissiveLighting() { return true; },
            get sharedEmissionCurve() { return true; },
            get lightingIndependentBrightness() { return true; },
            get emissionFloor() { return 0.78; },
            get emissionCeiling() { return 1.15; },
            get viewDependentPixelSides() { return true; },
            get opaqueGlyphFaces() { return true; },
            get brightClasses() { return "cavemen|trees|banana-pile|flying-bees|cave-sign-letters|fireflies|fires"; },
            get referenceCaveLayerIsolated() { return matrixCave.sections.every((section) => section.supports ? section.supports.every((support) => support.face.matrixCave === matrixCave.caveIndex) : section.face.matrixCave === matrixCave.caveIndex); },
            get coordinateSystem() { return "pile-centered-world-space"; },
            get caveRestartCount() { return 0; },
            get wallFlowDirection() { return "down"; },
            get radialBaseStreamCount() { return 32; },
            get radialMaximumStreamCount() { return 2048; },
            origin: MATRIX_WORLD.origin,
            caves: MATRIX_WORLD.caves,
            caveBounds: MATRIX_WORLD.caveBounds,
            get caveNear() { return MATRIX_WORLD.caveNear; },
            travelDistance: matrixTravelDistance,
            coverage: matrixCoverage,
            flowDistance: (x, z) => Math.hypot(x - MATRIX_WORLD.origin[0], z - MATRIX_WORLD.origin[2]),
            covered: (x, z) => !!MATRIX_WORLD.active && Math.hypot(x - MATRIX_WORLD.origin[0], z - MATRIX_WORLD.origin[2]) <= MATRIX_WORLD.radius,
            radialStreamCountAt: (radius) => 32 * 2 ** Math.max(0, Math.min(6, Math.ceil(Math.log2(Math.max(radius, 0.75) / 0.75)))),
            radialSpacingAt: (radius) => Math.PI * 2 * radius / (32 * 2 ** Math.max(0, Math.min(6, Math.ceil(Math.log2(Math.max(radius, 0.75) / 0.75))))),
            radialLinePoint: (stream, radius) => ({ x: Math.cos(-Math.PI + stream / 2048 * Math.PI * 2) * radius, z: Math.sin(-Math.PI + stream / 2048 * Math.PI * 2) * radius }),
            sampleStream: (stream = 0, time = MATRIX_WORLD.time) => matrixWorldStreamSample(stream, time, false),
            sampleWallStream: (stream = 0, time = MATRIX_WORLD.time) => matrixWorldStreamSample(stream, time, true)
          },
          portal: {
            get inside() { return matrixCave.portal.inside; },
            get lastCrossingDirection() { return matrixCave.portal.lastCrossingDirection; },
            plane: matrixCave.portal.plane,
            opening: matrixCave.portal.opening,
            rejected: matrixCave.portal.rejected
          },
          contains: inMatrixCave,
          overlayVisible: matrixOverlayVisible,
          viewApproach: viewMatrixApproach,
          viewInside: viewInsideMatrix
        },
        pilot,
        renderOpts: RENDER_OPTS,
        lamps,
        entranceLights,
        lighting: LIGHTING_DEBUG,
        fireSeats,
        get critters() {
          return critters.stats();
        },
        get daylight() {
          if (!DEBUG) syncDaylightDebug(hour);
          return DAYLIGHT_DEBUG;
        },
        setHour: (h, daylen = NaN, day = clock.dayOfYear) => {
          clock = daylight.createClock({ hour: h, daylen, day, time: timeParam });
        },
        magazine: { state: magazineState, get pickup() { return magazine; }, reveal: revealMagazine, grant: grantMagazine },
        get jetpack() {
          return {
            pickup: jetpack,
            state: jetpackState,
            get owned() { return jetpackState.owned; },
            get carrier() { return jetpackCarrier; },
            get wearer() { return jetpackWearer; },
            grant: (cave = crew.player, wear = false) => cave ? grantJetpack(cave, wear) : false,
            toggle: toggleJetpack,
            dropHost: () => jetpack && jetpack.host ? dropJetpackFromCloud(jetpack.host, jetpack.node.position.x, jetpack.node.position.z) : false,
            forceHostWrap: () => {
              if (!jetpack || !jetpack.host) return false;
              const cloud = jetpack.host;
              if (cloud.beside) cloud.node.position.z = CLOUD_WRAP + 0.01;
              else cloud.node.position.x = CLOUD_WRAP + 0.01;
              return true;
            }
          };
        }
      }
    });
    Object.defineProperty(hubScene.debug.matrixCave, "caves", { value: matrixInteriors });
    if (world.mirrorBroken) {
      mirrorCave.damage.restore();
      syncMirrorDamage(true);
    }
    pilot.update(0);
    if (ctx.from === null) restorePositionDebug();
    if (ctx.from === null && pilot.mode === "first-person") pilot.focusAim();
    if (POSITION_DEBUG) updatePositionDebug(true);
    mark("visibility-start");
    fx.warmVisibility(crew);
    mark("visibility");
    mark("covered-view-start");
    prepareCoveredView(ctx.overlay);
    mark("covered-view");
  };
  const leave = () => {
    uiGuideObjects = null; uiGuidesReady = false;
    if (enteringTween) enteringTween.alive = false;
    enteringTween = null;
    window.clearInterval(stateTimer);
    unsubscribeActivity();
    unsubscribeActivity = null;
    window.clearTimeout(hintTimer);
    if (positionDebug) {
      positionDebug.removeEventListener("click", copyPositionDebug);
      positionDebug.hidden = true;
      positionDebug.removeAttribute("data-pose");
      positionDebug.removeAttribute("data-copied");
    }
    syncJetpackFuel();
    breakables.dispose();
    crates.dispose();
    pile.dispose();
    crew.dispose();
    critters.dispose();
    fx.dispose();
    cameraCover.dispose();
    bananaCover.dispose();
    solids.dispose();
    rockGuides.dispose();
    sightGuides.dispose();
    bananaGuides.dispose();
    objectGuides.dispose();
    pileGuides.dispose();
    platformGuides.dispose();
    mirrorGuides.dispose();
    mirrorCave.damage.dispose();
    mirrorCave.ripples.dispose();
    mirrorCave.body.dispose();
    pilot.dispose();
    if (jumbotron) {
      jumbotron.dispose(renderer);
      jumbotron = null;
    }
    for (const node of targets) input.remove(node);
    for (const node of placed) removeChild(root, node);
    targets.length = placed.length = claimed.length = scenery.length = sceneryClaims.length = matrixInteriors.length = matrixGates.length = sealedCaves.length = clouds.length = lamps.length = entranceLights.length = fireSeats.length = sleepers.length = labels.length = spots.length = openMouths.length = launchers.length = props.length = 0;
    fireHazards.length = 0;
    workZones.length = 0;
    closedCaveZones.length = 0;
    cloudHit = null;
    RENDER_OPTS.lightCount = 0;
    MATRIX_WORLD.active = MATRIX_WORLD.direction = MATRIX_WORLD.radius = MATRIX_WORLD.permanentCave = 0;
    cameraCaveIndex = 0;
    cameraEntranceIndex = 0;
    cameraPreviousValid = false;
    cameraUnrestricted = cameraReentering = false;
    cameraTrailPlayer = null;
    cameraTrailCount = cameraTrailNext = 0;
    cameraTrailSleeping = false;
    cameraManualContact = false;
    cameraTerrainValid = false;
    cameraTerrainRecovering = false;
    cameraTerrainEntranceIndex = 0;
    caveEntryPlayer = null;
    playerCaveIndex = 0;
    CAMERA_OPENINGS.length = 0;
    LIGHTING_DEBUG.registeredLampCount = LIGHTING_DEBUG.activeFullLightCount = LIGHTING_DEBUG.approximatedLightCount = LIGHTING_DEBUG.selectedCount = LIGHTING_DEBUG.approximatedCount = 0;
    CAMERA_RAMP_CELLS.clear();
    for (let i = 0; i < LIGHT_CAPACITY; i++) LIGHTING_DEBUG.selectedIds[i] = LIGHTING_DEBUG.approximatedIds[i] = null;
    sceneryVisible = sceneryRadiusCulled = sceneryPathCulled = sceneryFixedCulled = sceneryReflows = 0;
    const count = input.targetCount;
    input.dispose();
    hud.dispose();
    // Drop everything but the cached island
    pathNode = altar = hud = hooks = input = pilot = fx = cameraCover = bananaCover = solids = rockGuides = objectGuides = sightGuides = bananaGuides = pileGuides = platformGuides = mirrorGuides = pile = crew = crates = critters = clock = presets = jetpack = jetpackState = jetpackCarrier = jetpackWearer = lastJetpackCloud = mirrorCave = matrixCave = matrixControl = gateRain = fire = headquarters = dockStairs = positionDebug = overlayCanvas = null;
    magazine = magazineState = breakables = null;
    hubScene.input = hubScene.debug = null;
    return { targets: count };
  };
  const liveGeometry = (set) => {
    pile.liveGeometry(set);
    breakables.liveGeometry(set);
    mirrorCave.damage.liveGeometry(set);
    for (const cave of crew.cavemen.values()) set.add(cave.headOpen).add(cave.headClosed);
  };
  const stats = () => {
    let nodes = 0;
    traverseVisible(root, () => nodes++);
    const all = (n) => 1 + n.children.reduce((sum, c) => sum + all(c), 0);
    return { visibleNodes: nodes, allNodes: all(root), tweens: tweenCount(), targets: input.targetCount, ...fx.stats(), ...crates.stats(), ...crew.stats(), ...pile.stats(), ...critters.stats(), ...breakables.stats() };
  };
  const hubScene = {
    id: "hub", enter, update, overlay, onDonation, onKey, onLootCleared, renderOpts: RENDER_OPTS, leave, stats, liveGeometry,
    root: null, camera: null, input: null, debug: null,
    get inMotion() {
      if (pile.inMotion || fx.inMotion || breakables.inMotion || jetpack || magazine && magazine.revealed || MATRIX_WORLD.active || mirrorGuides.state.doorway || mirrorCave.damage.active || mirrorCave.ripples.active || mirrorCave.body.active) return true;
      for (const sign of headquarters.roomSigns) if (sign.velocity || sign.node.rotation.x) return true;
      for (let i = 0; i < matrixGates.length; i++) if (matrixCave && (matrixGates[i].raising || matrixCave.unlocked && matrixGates[i].node.position.y !== MATRIX_GATE_HIDDEN_Y)) return true;
      return false;
    }
  };
  BL.scenes = BL.scenes || {};
  BL.scenes.hub = hubScene;
})();
