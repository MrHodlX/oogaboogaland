(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, contributors, donations, qr, terrain, hubModels, dropModels, caves, daylight, game: gameMod, hud: hudMod, interact: interactMod, pilot: pilotMod, fx: fxMod, crew: crewMod, pile: pileMod, crates: cratesMod, critters: crittersMod } = BL;
  const { lerp, ease, fnv1a, mulberry32 } = math;
  const { createNode, addChild, removeChild, createCamera, addTween, stepTweens, tweenCount, traverseVisible } = BL.scene;
  const { EAT_RATE } = crewMod;
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
  const hourParam = DEBUG ? parseFloat(params.get("hour")) : NaN;
  const daylenParam = DEBUG ? parseFloat(params.get("daylen")) : NaN;
  const dayParam = DEBUG ? parseFloat(params.get("day")) : NaN;
  const latitudeParam = DEBUG ? parseFloat(params.get("latitude")) : NaN;
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
  // Dolly onto a tapped mouth before the scene changes
  const ENTER_DIST = 10, ENTER_DUR = 0.45;
  // Free flight speeds and bounds
  const FLY = { speed: 6, perDist: 0.5, climb: 6, yMax: 30 }, FLY_BOUND = RADIUS + 14;
  // Third person follow height and distance
  const FOLLOW = { y: 0.9, min: 4, max: 10, pitch: [0.25, 0.8] };
  // A close free view rests at an average Ooga eye; first person sits at the
  // face surface so looking down clears the hidden head and keeps the body and
  // feet in view. Portal ownership stays with the Ooga, not this look offset.
  const CLOSE_VIEW = { eyeHeight: 1.1, eyeRatio: 0.95, eyeForward: 0.16, pitch: [-1.35, 1.35], trailingDist: 6, orbitDist: 6 };
  // Tallest step a caveman may climb
  const STEP_MAX = 0.6;
  // Props the jetpack may hide under
  const JETPACK_HIDERS = ["bush", "rock", "crate", "barrel", "flower"];
  const JETPACK_HOVER = 0.4, JETPACK_REACH = 1.3;
  const JETPACK_APPROACH = [1.8, 1.6, 2];
  const JETPACK_SAFE = { x: 0, z: 0 };
  // Pulse the hiding prop when the hunt stalls
  const HINT_AFTER = 120, HINT_EVERY = 12, HINT_PULSE = 1.6, HINT_MAX = 0.9;
  // Reach at which a caveman is inside a cave, or at the plane on the roof
  const TUNNEL_REACH = 2.2, LAUNCH_REACH = 2.6;
  const MATRIX_TYPES = 8;
  const MATRIX_RAIN_GAP = 0.19;
  const MATRIX_SURFACE_PITCH = 0.12, MATRIX_SURFACE_GAP = 0.13, MATRIX_GLYPH_HZ = 20;
  const MATRIX_PIXEL_PITCH = 0.021, MATRIX_PIXEL_SIZE = 0.016;
  const MATRIX_STREAM_SPEED_MIN = 0.56, MATRIX_STREAM_SPEED_RANGE = 0.64;
  const MATRIX_TRAIN_MIN = 7, MATRIX_TRAIN_RANGE = 6, MATRIX_TRAIN_GAP_MIN = 2, MATRIX_TRAIN_GAP_RANGE = 5;
  const MATRIX_WORLD_SPEED = 72, MATRIX_WORLD_MAX = RADIUS + 8, MATRIX_FRONT_WIDTH = 1.5, MATRIX_GLYPH_REACH = 0.16;
  const MATRIX_WORLD = { active: 0, direction: 0, radius: 0, time: 0, density: 1, speed: MATRIX_WORLD_SPEED, retreatSpeed: MATRIX_WORLD_SPEED, maxRadius: MATRIX_WORLD_MAX, origin: new Float32Array([0, 0, 0]), caves: new Float32Array(7 * 4), caveBounds: new Float32Array(7 * 4), caveNear: 0 };
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
  const NIGHT = 0.5, FIRE_SEAT_CHANCE = 0.5;
  // Clock angle to a meadow point
  const polar = (deg, r) => ({ x: Math.sin(deg * DEG) * r, z: -Math.cos(deg * DEG) * r });
  // Clock angles where the crew builds and sleeps
  const BUILD_DEGREES = [12, 40, 66, 80, 102, 165, 195, 212, 282, 297, 312, 340];
  const BUILD_RADIUS = 13;
  const BEDROLL_DEGREES = [100, 195, 252, 300, 345];
  const BEDROLL_RADIUS = 14, BEDROLL_INNER = 10;
  const NUDGES = [0, -2, 2, -4, 4, -6, 6, -8, 8];
  const VINES = ["c9", "c5"];
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
  const PROP_TIPS = { tree: "Tree · shake it", bush: "Bush · rustle it", rock: "Rock · solid", crate: "Crate · locked", barrel: "Barrel · empty", flower: "Flowers", torch: "Torch · warm", firepit: "Fire pit", bedroll: "Somebody's bed", ladder: "Ladder · wobbly", dock: "Dock · creaky", jetpack: "Jetpack · walk an Ooga into it", plane: "Ooga Drop · tap to fly", sign: "Ooga Drop · the plane flies from here", windsock: "Windsock · a fair wind", gate: null };
  const MATRIX_LIVING_PROPS = new Set(["tree"]);
  const BUSH_WORDS = ["Something rustles.", "A beetle. Ooga leaves it.", "Just a bush."];
  const LEAF = models.particleGeometry("#4a8530", 0.12, 0);
  const PETALS = ["#e04a3a", "#f2c94c", "#f3efe4"].map((c) => models.particleGeometry(c, 0.09, 0));
  const CHIP = models.particleGeometry("#6b625a", 0.1, 0);
  const SPARK = models.particleGeometry("#ffb13b", 0.08, 1);
  const DUST = models.particleGeometry("#a3874f", 0.1, 0);
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
  let renderer, game, world, go, lootEnabled, testBananas, root, camera, island, pathNode, altar, hud, hooks, input, pilot, fx, pile, crew, crates, critters, clock, presets, entering, stash, jetpack, mirrorCave, matrixCave, gateRain, fire;
  let hintAt = HINT_AFTER;
  let stateTimer = 0, hintTimer = 0, meterTimer = 0, pileEdgeNow = 0, now = 0, hour = 12;
  let phase = null;
  const placed = [];
  const targets = [];
  const claimed = [];
  const clouds = [];
  const lamps = [];
  const entranceLights = [];
  const fireSeats = [];
  const sleepers = [];
  const labels = [];
  const spots = [];
  const openMouths = [];
  const launchers = [];
  const props = [];
  const scenery = [];
  const sceneryClaims = [];
  const matrixInteriors = [];
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
      const lx = (rand() - 0.5) * 5, lz = streams.length < limit * 0.65 ? -0.7 - rand() * 1.55 : -2.55 - rand() * 3.2;
      const x = m.x + cr * lx + sr * lz, z = m.z - sr * lx + cr * lz;
      let minY = -Infinity, maxY = Infinity, valid = true;
      for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
        if (!island.cavityAt(x + ix * footprint, z + iz * footprint, column) || column.caveIndex !== caveIndex || !Number.isFinite(column.ceiling)) valid = false;
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
  const updateCaveRain = (rain, elapsed, visible, densityRankLimit) => {
    rain.activeGlyphCount = rain.brightTipCount = 0;
    rain.densityRankLimit = densityRankLimit;
    for (let glyph = 0; glyph < MATRIX_TYPES; glyph++) rain.nodes[glyph].instanceCount = rain.nodes[glyph].drawInstanceCount = 0;
    if (!visible) return;
    for (let i = 0; i < rain.streams.length; i++) {
      const s = rain.streams[i];
      if (s.rank >= densityRankLimit || s.distance - MATRIX_GLYPH_REACH >= MATRIX_WORLD.radius) continue;
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
    for (let glyph = 0; glyph < MATRIX_TYPES; glyph++) {
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
  const buildCaveGlyphs = (slot, m, group) => {
    const caveIndex = island.mouths.indexOf(m) + 1, cr = Math.cos(m.ry), sr = Math.sin(m.ry);
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
      const stream = { section: sections.length, cross, speed, phase, brightness, trainLength, gapLength, direction, flowMin, flowMax, flowRange: span, seed, head: 0, gap: 0 };
      const streamIndex = streams.length;
      streams.push(stream);
      if (renderer.kind !== "canvas2d" || rank < MATRIX_DENSITY.canvas2d) {
        for (let character = 0; character < characters; character++) entries.push({ stream: streamIndex, character, rank });
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
      constraints.push([portalU, portalV, PORTAL_Z - 0.02 + sr * m.x + cr * m.z - portalN * (plane + halfZ + clearance) - Math.abs(portalU) * halfX - Math.abs(portalV) * halfY - Math.abs(portalN) * halfZ]);
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
    for (let i = 0; i < island.geometry.faces.length; i++) {
      const face = island.geometry.faces[i];
      if (face.matrixCave === caveIndex) addFace(island.geometry, face, null, "terrain");
    }
    for (const section of horizontalDomains) {
      section.streamStart = streams.length;
      const portalU = sr * section.ux + cr * section.uz, portalV = sr * section.vx + cr * section.vz;
      const portalN = sr * section.nx + cr * section.nz;
      const portalLimit = PORTAL_Z - 0.02 + sr * m.x + cr * m.z - portalN * (section.plane + halfZ + clearance) - Math.abs(portalU) * halfX - Math.abs(portalV) * halfY - Math.abs(portalN) * halfZ;
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
          let inside = true;
          for (let i = 0; i < face.i.length; i++) {
            const p = face.i[i] * 3, x = original.verts[p], y = original.verts[p + 1], z = original.verts[p + 2];
            const wx = transform[0] * x + transform[4] * y + transform[8] * z + transform[12];
            const wz = transform[2] * x + transform[6] * y + transform[10] * z + transform[14];
            if (sr * (wx - m.x) + cr * (wz - m.z) > PORTAL_Z - 0.02) { inside = false; break; }
          }
          if (inside) {
            const local = { ...face, matrixCave: caveIndex, matrixLocalGlyphSurface: true };
            faces.push(local);
            if (!living && !(emissiveLiving && face.emissive > 0)) addFace(original, local, transform, "prop");
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
      cave.visible = cave.drawEnabled = visible && MATRIX_WORLD.radius > cave.minimumTravelDistance;
      cave.quality = renderer.kind === "canvas2d" ? "canvas2d" : renderer.quality;
      cave.densityRankLimit = densityRankLimit;
      updateCaveRain(cave.rain, elapsed, cave.visible, densityRankLimit);
      if (!visible || MATRIX_WORLD.radius <= cave.minimumTravelDistance) {
        clearMatrixDraw(cave);
        continue;
      }
      for (let glyph = 0; glyph < MATRIX_TYPES; glyph++) cave.nodes[glyph].instanceCount = 0;
      const counts = cave.activeSurfaceCounts;
      counts.floor = counts.ceiling = counts.wall = counts.prop = 0;
      let active = 0, revealed = 0, bright = 0, gaps = 0, first = true, mutationHash = 2166136261;
      for (let i = 0; i < cave.entries.length; i++) {
        const entry = cave.entries[i];
        if (entry.rank >= densityRankLimit) continue;
        const stream = cave.streams[entry.stream], section = cave.sections[stream.section];
        const sequence = stream.trainLength + stream.gapLength;
        const travel = elapsed * stream.speed + stream.phase;
        const cell = Math.ceil((stream.flowMin - stream.direction * travel) / MATRIX_SURFACE_GAP) + entry.character;
        const flow = cell * MATRIX_SURFACE_GAP + stream.direction * travel;
        if (flow < stream.flowMin || flow > stream.flowMax) continue;
        const plane = section.plane + 0.015;
        const x = section.ux * stream.cross + section.vx * flow + section.nx * plane;
        const z = section.uz * stream.cross + section.vz * flow + section.nz * plane;
        const distance = matrixTravelDistance(x, z, cave.caveIndex);
        if (distance - MATRIX_GLYPH_REACH >= MATRIX_WORLD.radius) continue;
        const trainPosition = matrixModulo(-stream.direction * cell, sequence);
        if (trainPosition >= stream.trainLength) { gaps++; continue; }
        const tip = trainPosition === 0 ? 1 : trainPosition === 1 ? 0.55 : 0;
        const glow = stream.brightness * (0.48 + (1 - trainPosition / stream.trainLength) * 0.52);
        const version = Math.floor(elapsed * MATRIX_GLYPH_HZ + (stream.seed & 15) / 16);
        const glyph = (cell + version + (stream.seed & 7)) & 7;
        const node = cave.nodes[glyph], slot = node.instanceCount++;
        if (slot >= cave.perGlyphCapacity) throw new Error("Cave Matrix glyph instance capacity exceeded");
        const data = node.instanceData, offset = slot * 20;
        data[offset] = section.ux; data[offset + 1] = section.uy; data[offset + 2] = section.uz; data[offset + 3] = 0;
        data[offset + 4] = section.vx; data[offset + 5] = section.vy; data[offset + 6] = section.vz; data[offset + 7] = 0;
        data[offset + 8] = section.nx; data[offset + 9] = section.ny; data[offset + 10] = section.nz; data[offset + 11] = 0;
        data[offset + 12] = x;
        data[offset + 13] = section.uy * stream.cross + section.vy * flow + section.ny * plane;
        data[offset + 14] = z;
        data[offset + 15] = 1; data[offset + 16] = glow; data[offset + 17] = 0; data[offset + 18] = tip; data[offset + 19] = 1;
        mutationHash = Math.imul(mutationHash ^ glyph ^ Math.imul(i + 1, 16777619), 16777619) >>> 0;
        counts[section.category]++;
        if (first && !section.horizontal) { cave.firstGlyphY = data[offset + 13]; first = false; }
        active++; if (distance < MATRIX_WORLD.radius) revealed++; if (tip) bright++;
      }
      for (let i = 0; i < cave.streams.length; i++) {
        const stream = cave.streams[i], travel = matrixModulo(elapsed * stream.speed + stream.phase, stream.flowRange);
        stream.head = stream.direction * travel;
        stream.gap = stream.direction * matrixModulo(travel - stream.trainLength * MATRIX_SURFACE_GAP, stream.flowRange);
      }
      for (let glyph = 0; glyph < MATRIX_TYPES; glyph++) {
        const node = cave.nodes[glyph];
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
  const updateMatrixWorld = (dt, elapsed) => {
    if (!matrixCave) return;
    const quality = renderer.kind === "canvas2d" ? "canvas2d" : renderer.quality;
    const densityRankLimit = MATRIX_DENSITY[quality] || MATRIX_DENSITY.high;
    MATRIX_WORLD.time = elapsed;
    MATRIX_WORLD.density = densityRankLimit / MATRIX_DENSITY.high;
    if (MATRIX_WORLD.direction > 0) MATRIX_WORLD.radius = Math.min(MATRIX_WORLD.maxRadius, MATRIX_WORLD.radius + dt * MATRIX_WORLD.speed);
    else if (MATRIX_WORLD.direction < 0) {
      MATRIX_WORLD.radius = Math.max(0, MATRIX_WORLD.radius - dt * MATRIX_WORLD.retreatSpeed);
      if (MATRIX_WORLD.radius === 0) MATRIX_WORLD.direction = 0;
    }
    MATRIX_WORLD.active = MATRIX_WORLD.radius > 0 ? 1 : 0;
    matrixCave.mirrorNode.mirrorPortal = matrixCave.portal.inside;
    updateCaveGlyphs(elapsed, !!MATRIX_WORLD.active, densityRankLimit);
    if (gateRain) updateCaveRain(gateRain, elapsed, !!MATRIX_WORLD.active, densityRankLimit);
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
  // A prop with a kind answers taps and Space
  const addProp = (kind, node, x, z, radius) => {
    const owner = { kind: "prop", prop: kind, node, x, z, ripe: 0, pickRadius: radius, active: true };
    addTarget(node, owner, { radius });
    props.push(owner);
    return owner;
  };
  const place = (geometry, x, z, ry = 0, y = island.heightAt(x, z), kind = null, radius = 0) => {
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
      const k = Math.min(1, Math.max(0, (RENDER_OPTS.torch - l.order * LAMP_STAGGER) / LAMP_RAMP));
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
  };
  // A fire pit off the paths inside the bedroll ring, with seats around it
  const buildFire = () => {
    let p = null;
    for (const deg of FIRE_DEGREES) {
      const c = polar(deg, FIRE_RADIUS);
      if (island.heightAt(c.x, c.z) === 0 && free(c.x, c.z, 1.6) && !nearPath(c.x, c.z, 1.8)) {
        p = c;
        break;
      }
    }
    if (!p) throw new Error("No clear spot for the fire pit");
    const pit = place(hubModels.firepit(), p.x, p.z, 0, 0, "firepit", 1.2);
    const flame = createNode({ geometry: hubModels.fireFlame(), matrixEmissiveLiving: true });
    addChild(pit, flame);
    addLamp(flame, LAMP.fire, p.x, 0.6, p.z, true, 3, "firepit");
    claim(p.x, p.z, 1.4);
    for (let i = 0; i < FIRE_SEATS; i++) {
      const a = (i + 0.5) / FIRE_SEATS * Math.PI * 2;
      const x = p.x + Math.cos(a) * FIRE_SEAT_RADIUS, z = p.z + Math.sin(a) * FIRE_SEAT_RADIUS;
      fireSeats.push({ x, z, ry: Math.atan2(p.x - x, p.z - z) });
    }
    return p;
  };
  // Build a mouth from its slot status, +z leading out
  const buildMouth = (slot, m) => {
    const ax = Math.sin(m.ry), az = Math.cos(m.ry);
    const group = createNode({ position: { x: m.x, y: m.floorY, z: m.z }, rotation: { x: 0, y: m.ry, z: 0 } });
    const rim = createNode({ position: { x: 0, y: 0, z: 0.5 }, geometry: hubModels.caveMouthRim() });
    addChild(group, rim);
    if (slot.status === "open" && slot.scene === "race") {
      // The rally garage: a kart up on a stone plinth, spare wheels, a crate and a barrel
      const kart = BL.raceModels.kart("#d98a2e");
      Object.assign(kart.node.position, { x: 0, y: 0.5, z: -3.6 });
      kart.node.rotation.y = 0.5;
      const plinth = createNode({ position: { x: 0, y: 0, z: -3.6 }, geometry: hubModels.altarSlab() });
      Object.assign(plinth.scale, { x: 1.4, y: 0.5, z: 1.4 });
      const wheels = createNode({ position: { x: -1.7, y: 0, z: -2.6 } });
      for (let i = 0; i < 3; i++) addChild(wheels, createNode({ position: { x: 0, y: 0.12 + i * 0.24, z: 0 }, rotation: { x: 0, y: 0, z: Math.PI / 2 }, geometry: BL.raceModels.kartWheel() }));
      addChild(group, plinth, kart.node, wheels, createNode({ position: { x: 1.7, y: 0, z: -3 }, rotation: { x: 0, y: 0.3, z: 0 }, geometry: hubModels.woodCrate() }), createNode({ position: { x: 1.9, y: 0, z: -1.9 }, geometry: hubModels.barrel() }));
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
      addProp("plane", plane.node.children[0], roof.x, roof.z, 2.6).roof = roof;
      addProp("windsock", sock, m.x + ax * sockZ + Math.cos(m.ry) * sockX, m.z + az * sockZ - Math.sin(m.ry) * sockX, 1);
      const signX = m.x + ax * dropModels.SIGN_AT.z + Math.cos(m.ry) * dropModels.SIGN_AT.x, signZ = m.z + az * dropModels.SIGN_AT.z - Math.sin(m.ry) * dropModels.SIGN_AT.x;
      const sign = createNode({ position: { x: dropModels.SIGN_AT.x, y: island.surfaceAt(signX, signZ) - m.floorY, z: dropModels.SIGN_AT.z }, geometry: dropModels.roofSign() });
      sign.matrixExterior = true;
      addChild(group, sign);
      addProp("sign", sign, signX, signZ, 1);
      claim(roof.x, roof.z, 3.8);
      launchers.push(roof);
    } else if (slot.status === "open" && slot.scene === "hodl") {
      // Bedroom door: bedroll, crate stack with a night banana and a hanging lamp.
      // No entrance torches/point lights — keeps the hub inside the 10-lamp budget.
      addChild(group, createNode({ position: { x: 0, y: 0.05, z: -1.5 }, rotation: { x: 0, y: 0.4, z: 0 }, geometry: hubModels.bedroll(), depthBias: 0.3 }));
      addChild(group, createNode({ position: { x: -1.75, y: 0, z: -1.05 }, rotation: { x: 0, y: 0.35, z: 0 }, geometry: hubModels.woodCrate() }));
      addChild(group, createNode({ position: { x: -1.8, y: 0.88, z: -1.1 }, rotation: { x: 0, y: -0.25, z: 0 }, geometry: hubModels.woodCrate() }));
      const bananaScale = models.BANANA_AMMO_SCALE;
      addChild(group, createNode({ position: { x: -1.8, y: 1.84, z: -1.1 }, rotation: { x: 0, y: 0.6, z: 0 }, scale: { x: bananaScale, y: bananaScale, z: bananaScale }, geometry: models.bananaGeometry() }));
      addChild(group, createNode({ position: { x: 0.35, y: 2.5, z: -1.25 }, geometry: hubModels.lantern(), matrixEmissiveLiving: true, glow: 0.85, flare: 0 }));
    } else if (slot.status === "open") {
      for (const x of [-1.3, 1.3]) addChild(group, createNode({ position: { x, y: 0, z: -3.5 }, geometry: hubModels.caveShelves() }));
    } else if (slot.status === "mirror") {
      // Sit inside the rim so the cave floor ends behind the reflection.
      const node = createNode({ position: { x: 0, y: 1.5, z: 0.5 }, geometry: hubModels.mirrorPanel(), mirror: true, mirrorWalkThrough: true });
      addChild(group, node);
      mirrorCave = { slot, mouth: m, group, rim, node, sign: null };
    } else if (slot.status === "sleeping") {
      // Bedrolls lie along +x, as the sleep pose assumes
      addChild(group, createNode({ position: { x: 0, y: 0.05, z: -4.5 }, rotation: { x: 0, y: -m.ry, z: 0 }, geometry: hubModels.bedroll(), depthBias: 0.3 }));
      sleepers.push({ x: m.x + ax * 0.8, y: 4.4, z: m.z + az * 0.8, timer: sleepers.length * 0.7 });
    }
    if (slot.status === "open" || slot.status === "mirror") {
      // Hodl keeps the sign but skips the torch pair and sign-lantern so the hub
      // stays inside the fixed ten point-light budget used by the other caves.
      if (slot.scene !== "hodl") {
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
      }
      const sign = createNode({ position: { x: 0, y: 4.5, z: 0.52 }, geometry: hubModels.caveSign(slot.name), matrixEmissiveLiving: true });
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
      if (slot.scene !== "hodl") {
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
    }
    if (VINES.includes(slot.id)) for (const x of [-1.1, 1.1]) addChild(group, createNode({ position: { x, y: 3.45, z: 0.95 }, geometry: hubModels.vine() }));
    addChild(root, group);
    placed.push(group);
    const glyphs = buildCaveGlyphs(slot, m, group);
    if (slot.status === "mirror") {
      matrixCave = glyphs;
      matrixCave.portal = buildMatrixPortal(m);
      matrixCave.mirrorNode = mirrorCave.node;
    }
    return rim;
  };
  // Dock over the drop and ladder on the bluff
  const buildRim = () => {
    const d = polar(DOCK_DEG, CLIFF_OUTER);
    place(hubModels.dock(), d.x, d.z, Math.PI / 2 - DOCK_DEG * DEG, island.heightAt(d.x, d.z), "dock", 2.2);
    claim(d.x, d.z, 2.5);
    let faceX = MEADOW - 1;
    while (island.heightAt(faceX + island.unit / 2, LADDER_Z) < 3) faceX += island.unit;
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
      const node = place(geometry, x, z, ry, y, quiet ? null : kind, footprint + 0.3);
      if (MATRIX_LIVING_PROPS.has(kind)) node.matrixLiving = true;
      const owner = quiet ? { kind: "prop", prop: kind, node, x, z, ripe: 0, pickRadius: 0, active: true } : props[props.length - 1];
      owner.footprint = footprint;
      owner.scenery = true;
      reservation.scenery = owner;
      scenery.push(owner);
      return node;
    };
    const meadow = (count, radius, kind, geometryAt, square = false) => {
      for (let n = 0, tries = 0; n < count && tries < 1500; tries++) {
        const { x, z } = polar(rand() * 360, Math.sqrt(lerp(MEADOW_INNER * MEADOW_INNER, MEADOW_OUTER * MEADOW_OUTER, rand())));
        if (island.heightAt(x, z) > 0 || nearMouth(x, z, 3.5) || !candidateFree(x, z, radius)) continue;
        addScenery(geometryAt(n), x, z, square ? Math.floor(rand() * 4) * Math.PI / 2 + (rand() - 0.5) * 0.4 : rand() * Math.PI * 2, 0, kind, radius);
        n++;
      }
    };
    const cliff = (count, radius, minHeight, kind, geometryAt) => {
      for (let n = 0, tries = 0; n < count && tries < 1200; tries++) {
        const { x, z } = polar(rand() * 360, lerp(CLIFF_INNER, CLIFF_OUTER, rand()));
        const h = island.heightAt(x, z);
        if (h < minHeight || !free(x, z, radius)) continue;
        let clear = true;
        for (let i = 0; i < 4 && clear; i++) {
          const a = (i + 0.5) * Math.PI / 2;
          if (island.heightAt(x + Math.cos(a) * 1.2, z + Math.sin(a) * 1.2) > h + 1.5) clear = false;
        }
        if (!clear || nearMouth(x, z, 4) || !candidateFree(x, z, radius)) continue;
        addScenery(geometryAt(n), x, z, rand() * Math.PI * 2, h, kind, radius);
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
      setSceneryActive(o, reason === 0);
      if (!reason) visible++;
      else if (reason === 1) radiusCulled++;
      else if (reason === 2) pathCulled++;
      else fixedCulled++;
    }
    sceneryVisible = visible;
    sceneryRadiusCulled = radiusCulled;
    sceneryPathCulled = pathCulled;
    sceneryFixedCulled = fixedCulled;
    sceneryReflows++;
    if (stash && !stash.active) rehomeJetpack(stash);
    if (jetpack && (Math.hypot(jetpack.x, jetpack.z) - 1 < island.path.debug.ringOuterRadius + SCENERY_CLEARANCE || island.path.overlaps(jetpack.x, jetpack.z, 1))) moveJetpackSafe();
  };
  // Hide the island's one jetpack under a visible, approachable scenery prop.
  const approachableHider = (o) => {
    for (let r = 0; r < JETPACK_APPROACH.length; r++) {
      const radius = JETPACK_APPROACH[r];
      for (let i = 0; i < 12; i++) {
        const angle = i / 12 * Math.PI * 2;
        const x = o.x + Math.cos(angle) * radius, z = o.z + Math.sin(angle) * radius;
        if (!island.onLand(x, z)) continue;
        let nearest = true;
        for (let j = 0; j < props.length; j++) {
          const other = props[j];
          if (other !== o && other.active && Math.hypot(other.x - x, other.z - z) < radius) {
            nearest = false;
            break;
          }
        }
        if (nearest) return true;
      }
    }
    return false;
  };
  const eligibleHider = (o) => o.active && JETPACK_HIDERS.includes(o.prop) && island.heightAt(o.x, o.z) === 0 && approachableHider(o);
  const hideJetpack = () => {
    const hiders = scenery.filter(eligibleHider);
    stash = hiders.length ? hiders[Math.floor(Math.random() * hiders.length)] : null;
    hintAt = HINT_AFTER;
  };
  const safeJetpackSpot = () => {
    const firstRadius = Math.max(MEADOW_INNER, island.path.debug.ringOuterRadius + SCENERY_CLEARANCE + 1);
    for (let radius = firstRadius; radius <= MEADOW_OUTER; radius += 0.5) {
      for (let i = 0; i < 64; i++) {
        const angle = (i * 137.5 + SEED * 17) * DEG;
        const x = Math.sin(angle) * radius, z = -Math.cos(angle) * radius;
        if (!island.onLand(x, z) || island.heightAt(x, z) !== 0 || island.path.overlaps(x, z, 1)) continue;
        let clear = true;
        for (let j = 0; j < claimed.length && clear; j++) {
          const c = claimed[j];
          if (!c.scenery && Math.hypot(c.x - x, c.z - z) < c.r + 1) clear = false;
        }
        for (let j = 0; j < scenery.length && clear; j++) {
          const o = scenery[j];
          if (o.active && Math.hypot(o.x - x, o.z - z) < o.footprint + 1) clear = false;
        }
        if (!clear) continue;
        JETPACK_SAFE.x = x;
        JETPACK_SAFE.z = z;
        return true;
      }
    }
    return false;
  };
  const moveJetpackSafe = () => {
    if (!safeJetpackSpot()) throw new Error("No safe meadow location for the jetpack");
    jetpack.x = jetpack.owner.x = jetpack.node.position.x = JETPACK_SAFE.x;
    jetpack.z = jetpack.owner.z = jetpack.node.position.z = JETPACK_SAFE.z;
  };
  const revealJetpackSafe = () => {
    if (!safeJetpackSpot()) throw new Error("No safe meadow location for the jetpack");
    const node = place(hubModels.jetpack(), JETPACK_SAFE.x, JETPACK_SAFE.z, 0, JETPACK_HOVER, "jetpack", 1);
    jetpack = { node, x: JETPACK_SAFE.x, z: JETPACK_SAFE.z, owner: props[props.length - 1] };
  };
  const rehomeJetpack = (old) => {
    old.node.highlight = 0;
    const start = scenery.indexOf(old);
    stash = null;
    for (let offset = 1; offset <= scenery.length; offset++) {
      const candidate = scenery[(start + offset) % scenery.length];
      if (!eligibleHider(candidate)) continue;
      stash = candidate;
      hintAt = now + HINT_AFTER;
      return;
    }
    revealJetpackSafe();
  };
  const dropJetpack = (o) => {
    o.node.highlight = 0;
    stash = null;
    const node = place(hubModels.jetpack(), o.x, o.z, 0, JETPACK_HOVER, "jetpack", 1);
    jetpack = { node, x: o.x, z: o.z, owner: props[props.length - 1] };
    fx.burst(o.x, JETPACK_HOVER + 0.3, o.z, 12, [DUST, SPARK], 1.8);
    hud.toast(`A jetpack was under the ${o.prop}!`);
    hud.hint("Walk an Ooga into it to put it on.", 5000);
  };
  const drop = (list, value) => {
    const i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1);
  };
  const equipJetpack = (cave) => {
    if (!crew.wearJetpack(cave, hubModels.jetpack(), hubModels.jetFlame())) return;
    pilot.showAct();
    const p = cave.root.position;
    fx.burst(p.x, p.y + 0.7, p.z, 14, [SPARK, DUST], 2.2);
    fx.say(cave, "OOGA FLY!", 2);
    hud.toast("Jetpack!");
    hud.hint(COARSE ? "Hold Blast off to climb · stick to fly" : "Hold Space to climb · WASD to fly", 5000);
  };
  const collectJetpack = (cave) => {
    const { node, owner } = jetpack;
    input.remove(node);
    removeChild(root, node);
    drop(targets, node);
    drop(placed, node);
    drop(props, owner);
    jetpack = null;
    equipJetpack(cave);
  };
  // Spots the crew strolls to
  const buildSpots = () => {
    spots.push({ x: 0, z: -(MEADOW + 2.5), ry: Math.PI });
    for (const m of island.mouths) spots.push({ x: m.apron.x, z: m.apron.z, ry: Math.atan2(m.x - m.apron.x, m.z - m.apron.z) });
    const rand = mulberry32(SEED + 5);
    for (let n = 0, tries = 0; n < WANDER_COUNT && tries < 1500; tries++) {
      const { x, z } = polar(rand() * 360, Math.sqrt(lerp(WANDER_INNER * WANDER_INNER, MEADOW_OUTER * MEADOW_OUTER, rand())));
      if (island.heightAt(x, z) !== 0 || nearMouth(x, z, 3) || !free(x, z, 0.9)) continue;
      spots.push({ x, z, ry: NaN });
      n++;
    }
  };
  // A seat nobody is heading for or sitting on
  const seatTaken = (s) => {
    for (const cave of crew.cavemen.values()) {
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
  const wanderSpot = (out) => {
    let s = RENDER_OPTS.stars > NIGHT && Math.random() < FIRE_SEAT_CHANCE ? freeSeat() : null;
    if (!s) {
      s = spots[Math.floor(Math.random() * spots.length)];
      if (s.x === out.x && s.z === out.z) s = spots[(spots.indexOf(s) + 1) % spots.length];
    }
    out.x = s.x;
    out.z = s.z;
    out.ry = s.ry;
  };
  // Over a cave the rock has two layers, the tunnel floor and the roof above it
  const supportAt = (x, z, y = -Infinity) => {
    const roof = island.surfaceAt(x, z);
    return y >= roof - STEP_MAX ? roof : island.heightAt(x, z);
  };
  const visualSupportAt = (x, z, y) => island.smoothSupportAt(x, z, y, STEP_MAX);
  // A driven step stays on rock, off the heap, and on its own layer
  const walkable = (fromX, fromZ, toX, toZ, y) => {
    if (!island.onLand(toX, toZ) || Math.hypot(toX, toZ) <= pileEdgeNow + 0.4) return false;
    if (y >= island.surfaceAt(toX, toZ) - STEP_MAX) return true;
    return Math.abs(island.heightAt(toX, toZ) - y) <= STEP_MAX;
  };
  // Flying, only the rim stops him
  const flyable = (fromX, fromZ, toX, toZ) => island.onLand(toX, toZ);
  // Clouds ring the island without crossing it
  const buildClouds = () => {
    const rand = mulberry32(SEED + 77);
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const beside = i % 2 === 0;
      const out = (rand() < 0.5 ? -1 : 1) * lerp(CLOUD_NEAR, CLOUD_WRAP, rand());
      const span = lerp(-CLOUD_WRAP, CLOUD_WRAP, rand());
      const y = beside ? lerp(-4, 6, rand()) : lerp(2, 8, rand());
      const node = createNode({ position: { x: beside ? out : span, y, z: beside ? span : -Math.abs(out) }, geometry: hubModels.cloud(Math.min(2, i % 4)), matrixCloud: true });
      addChild(root, node);
      placed.push(node);
      clouds.push({ node, speed: 0.4 + rand() * 0.4, beside });
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
      case "caveman": {
        const c = o.cave;
        const worn = crew.wornBy(c.traits.name);
        return `${c.traits.name} · ${hudMod.STATE_LABELS[c.state]} · last commit ${contributors.ageLabel(c.contributor)}${worn ? ` · ${worn}` : ""}${c === pilot.player ? " · yours" : c.state === "working" ? " · double-tap to drive" : ""}`;
      }
      case "crate":
        return `${o.crate.loot.tier} crate · tap to open`;
      case "cave":
        return o.slot.status === "open" ? (o.slot.scene === "hodl" ? `${o.slot.name} · tap to rest` : `${o.slot.name} · tap to enter`) : o.slot.status === "mirror" ? `${o.slot.name} · mirror` : o.slot.status === "sleeping" ? "A project sleeps here · zzz" : "An empty cave";
      case "gate":
        return `${caves.gate.name} · leads nowhere yet`;
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
    const w = o.node.world;
    const x = w[12], z = w[14];
    switch (o.prop) {
      case "tree":
        if (!wobble(o.node, 0.1)) return;
        fx.burst(x, 2.6, z, 10, [LEAF], 1.6);
        if (RENDER_OPTS.stars > NIGHT) critters.burst(x, z);
        if (!dropBanana(o, TREE_CHANCE)) hud.toast("Leaves. Just leaves.");
        break;
      case "bush":
        if (!wobble(o.node, 0.25)) return;
        fx.burst(x, w[13] + 0.7, z, 6, [LEAF], 1.2);
        if (!dropBanana(o, BUSH_CHANCE)) hud.toast(BUSH_WORDS[fnv1a(`${o.x}/${o.z}/${Math.floor(now)}`) % BUSH_WORDS.length]);
        break;
      case "rock":
        fx.burst(x, 0.6, z, 6, [CHIP], 1.4);
        hud.toast("Solid rock. Ow.");
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
        if (pilot.player) collectJetpack(pilot.player);
        else hud.toast("Double-tap an Ooga, then walk them into it.");
        break;
      case "gate":
        hud.toast(`${caves.gate.name} · leads nowhere yet`);
        break;
      case "plane":
      case "sign":
        enterLaunch();
        break;
      case "windsock":
        hud.toast("A fair wind for a drop.");
        break;
      default:
        break;
    }
  };
  // Any use of the hiding prop frees the jetpack
  const useProp = (o) => {
    if (!o.active) return;
    reactProp(o);
    if (stash === o) dropJetpack(o);
  };
  // Nearest prop within reach, if any
  const useNear = (x, z, reach) => {
    let best = null, bestD = reach;
    for (let i = 0; i < props.length; i++) {
      const o = props[i];
      if (!o.active) continue;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return false;
    useProp(best);
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
    addTween({
      dur: ENTER_DUR, ease: ease.inOutQuad, update: (k) => {
        orbit.tx = lerp(from.x, view.target.x, k);
        orbit.ty = lerp(from.y, view.target.y, k);
        orbit.tz = lerp(from.z, view.target.z, k);
        orbit.dist = lerp(from.dist, ENTER_DIST, k);
        orbit.yaw = from.yaw + turn * k;
      }, done: () => go(id)
    });
  };
  const enterCave = (slot) => enterScene(presets[slot.scene], slot.scene);
  // The Ooga at the wheel flies the plane
  const enterLaunch = () => {
    if (entering) return;
    world.pilot = pilot.player ? pilot.player.traits.name : null;
    enterScene(presets.drop, "drop");
  };
  const onTap = (hit) => {
    if (!hit) return;
    const o = hit.owner;
    switch (o.kind) {
      case "caveman":
        crew.pokeCave(o.cave);
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
      case "prop":
        useProp(o);
        break;
      default:
        break;
    }
  };

  // ---------- camera bounds ----------
  const CAMERA_RADIUS = 0.3, CAMERA_FLOOR = 0.55, CAMERA_STEP_FLOOR = CAMERA_RADIUS + 0.02, CAMERA_VERTICAL_RATE = 3.2, CAMERA_HORIZONTAL_RATE = 8;
  const CAMERA_PREVIOUS = { x: 0, y: 0, z: 0 };
  const PLAYER_PREVIOUS = { x: 0, y: 0, z: 0 }, PLAYER_POSITION = { x: 0, y: 0, z: 0 };
  const CAMERA_SPACE = { floor: 0, ceiling: 0 }, CAMERA_COLUMN = { caveIndex: 0, floor: 0, ceiling: 0 };
  const CAMERA_CROSSING = { direction: 0, valid: false, reason: null, amount: 0 };
  const CAMERA_OPENINGS = [];
  let cameraCaveIndex = 0, cameraEntranceIndex = 0, cameraPreviousValid = false, cameraTerrainY = 0, cameraTerrainX = 0, cameraTerrainZ = 0, cameraTerrainValid = false, cameraTerrainRecovering = false, cameraTerrainEntranceIndex = 0;
  let caveEntryPlayer = null, playerCaveIndex = 0;
  const cameraCrossing = (from, to, opening) => {
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
    CAMERA_CROSSING.amount = t;
    if (y < opening.minY) CAMERA_CROSSING.reason = "below";
    else if (y > opening.maxY) CAMERA_CROSSING.reason = "above";
    else if (across < opening.minX || across > opening.maxX) CAMERA_CROSSING.reason = "beside";
    else if (caveColumnAt(x - sr * 0.05, z - cr * 0.05, opening)) CAMERA_CROSSING.valid = true;
    return CAMERA_CROSSING;
  };
  const setMatrixInside = (inside) => {
    if (!matrixCave) return;
    const portal = matrixCave.portal;
    if (portal.inside === inside) return;
    portal.inside = inside;
    portal.lastCrossingDirection = inside ? "in" : "out";
    if (inside) {
      MATRIX_WORLD.radius = MATRIX_WORLD.maxRadius;
      MATRIX_WORLD.direction = 0;
      MATRIX_WORLD.active = 1;
    } else {
      MATRIX_WORLD.direction = MATRIX_WORLD.radius > 0 ? -1 : 0;
      MATRIX_WORLD.active = MATRIX_WORLD.radius > 0 ? 1 : 0;
    }
    // Close the doorway on the crossing itself; glyph retraction runs independently.
    matrixCave.mirrorNode.mirrorPortal = inside;
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
  const caveColumnAt = (x, z, opening) => {
    const dx = x - opening.mouth.x, dz = z - opening.mouth.z;
    const along = dx * opening.sr + dz * opening.cr, across = dx * opening.cr - dz * opening.sr;
    if (!island.cavityAt(x, z, CAMERA_COLUMN) || CAMERA_COLUMN.caveIndex !== opening.caveIndex) {
      // Rotated voxel columns straddle the doorway plane. Uncarved, open-air
      // apron cells there are still traversable; solid cliff columns are not.
      const ground = island.heightAt(x, z);
      if (along < opening.planeZ - island.unit * Math.SQRT2 || along > 3 || across < opening.minX || across > opening.maxX || island.surfaceAt(x, z) !== ground) return false;
      CAMERA_COLUMN.floor = ground;
      CAMERA_COLUMN.ceiling = Infinity;
    }
    // The original stone frame has its own soffit even where the carved voxel
    // column is open sky. Use the model's real bounds, not the cliff top.
    const rim = opening.rim;
    if (along >= rim.minZ + PORTAL_Z && along <= rim.maxZ + PORTAL_Z) {
      if (across < rim.minX || across > rim.maxX) return false;
      CAMERA_COLUMN.floor = Math.max(CAMERA_COLUMN.floor, opening.mouth.floorY + rim.floorY);
      CAMERA_COLUMN.ceiling = Math.min(CAMERA_COLUMN.ceiling, opening.mouth.floorY + rim.ceilingY);
    }
    CAMERA_COLUMN.caveIndex = opening.caveIndex;
    return true;
  };
  // Sample the real quarter-unit cavity around the eye, including the open apron.
  // Its floor/roof bounds are independent of the Matrix state and cliff-top height.
  const cameraSpaceAt = (x, z, opening) => {
    let floor = -Infinity, ceiling = Infinity;
    for (let i = 0; i < 25; i++) {
      const sx = x + (i % 5 - 2) * CAMERA_RADIUS * 0.5, sz = z + (Math.floor(i / 5) - 2) * CAMERA_RADIUS * 0.5;
      if (!caveColumnAt(sx, sz, opening)) return false;
      floor = Math.max(floor, CAMERA_COLUMN.floor);
      ceiling = Math.min(ceiling, CAMERA_COLUMN.ceiling);
    }
    CAMERA_SPACE.floor = floor + CAMERA_FLOOR;
    CAMERA_SPACE.ceiling = ceiling - CAMERA_RADIUS;
    return CAMERA_SPACE.floor <= CAMERA_SPACE.ceiling;
  };
  const CAMERA_CAVE_DEBUG = {
    get index() { return cameraCaveIndex; },
    get playerIndex() { return playerCaveIndex; },
    get entranceIndex() { return cameraEntranceIndex; },
    get constraint() { return cameraCaveIndex ? "interior" : cameraEntranceIndex ? "entrance" : "exterior"; },
    get id() { return cameraCaveIndex ? CAMERA_OPENINGS[cameraCaveIndex - 1].id : null; },
    openings: CAMERA_OPENINGS,
    contains(x, y, z) {
      return !!cameraCaveIndex && caveColumnAt(x, z, CAMERA_OPENINGS[cameraCaveIndex - 1]) && y >= CAMERA_COLUMN.floor && y < CAMERA_COLUMN.ceiling;
    }
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
      for (let i = 0; i < CAMERA_OPENINGS.length; i++) {
        const opening = CAMERA_OPENINGS[i], crossing = cameraCrossing(PLAYER_PREVIOUS, PLAYER_POSITION, opening);
        if (!crossing.valid) continue;
        if (!playerCaveIndex && crossing.direction > 0) playerCaveIndex = opening.caveIndex;
        else if (playerCaveIndex === opening.caveIndex && crossing.direction < 0) playerCaveIndex = 0;
      }
      if (playerCaveIndex && (!caveColumnAt(p.x, p.z, CAMERA_OPENINGS[playerCaveIndex - 1]) || PLAYER_POSITION.y < CAMERA_COLUMN.floor || PLAYER_POSITION.y >= CAMERA_COLUMN.ceiling)) playerCaveIndex = 0;
    }
    setVec(PLAYER_PREVIOUS, PLAYER_POSITION.x, PLAYER_POSITION.y, PLAYER_POSITION.z);
  };
  // Keep flight in a drum and the eye above rock
  const clampTarget = (t) => {
    const r = Math.hypot(t.x, t.z);
    if (r > FLY_BOUND) {
      t.x *= FLY_BOUND / r;
      t.z *= FLY_BOUND / r;
    }
  };
  let exteriorEntranceIndex = 0, exteriorCeiling = Infinity;
  const exteriorCameraFloorAt = (x, y, z, clearance, smoothStep, closeMix) => {
    const physicalFloor = island.surfaceAt(x, z);
    let floor = (smoothStep && closeMix <= 0.5 ? visualSupportAt(x, z, physicalFloor) : physicalFloor) + clearance;
    exteriorEntranceIndex = 0;
    exteriorCeiling = Infinity;
    for (let i = 0; i < CAMERA_OPENINGS.length; i++) {
      const entry = CAMERA_OPENINGS[i], dx = x - entry.mouth.x, dz = z - entry.mouth.z;
      const along = dx * entry.sr + dz * entry.cr, across = dx * entry.cr - dz * entry.sr;
      if (along < entry.planeZ - 1e-7 || along > 3 || across < entry.minX + CAMERA_RADIUS || across > entry.maxX - CAMERA_RADIUS || y < entry.mouth.floorY || y > entry.mouth.floorY + entry.maxY) continue;
      const k = (along - entry.planeZ) / (3 - entry.planeZ);
      exteriorEntranceIndex = entry.caveIndex;
      floor = island.heightAt(x, z) + CAMERA_FLOOR + (clearance - CAMERA_FLOOR) * k * k * (3 - 2 * k);
      if (cameraSpaceAt(x, z, entry)) exteriorCeiling = CAMERA_SPACE.ceiling;
      break;
    }
    return floor;
  };
  const clampCamera = (p, closeMix = 0, closeClearance = CLEARANCE, smoothStep = false, dt = 0, resetSmooth = false, directView = false) => {
    const clearance = lerp(CLEARANCE, Math.max(smoothStep ? CAMERA_STEP_FLOOR : CAMERA_FLOOR, closeClearance), closeMix);
    // The first-person eye sits on the face, but it must not pass through the
    // sealed mirror before the Ooga makes a valid body crossing. Keep only
    // that eye at the entrance plane; normal face-level placement resumes as
    // soon as the Ooga owns the cave.
    if (matrixCave && closeMix > 0.5 && pilot && pilot.player && playerCaveIndex !== matrixCave.caveIndex) {
      const m = matrixCave.mouth, dx = p.x - m.x, dz = p.z - m.z;
      const x = matrixCave.cr * dx - matrixCave.sr * dz;
      const y = p.y - m.floorY;
      const z = matrixCave.sr * dx + matrixCave.cr * dz;
      if (x >= PORTAL_MIN_X && x <= PORTAL_MAX_X && y >= PORTAL_MIN_Y && y <= PORTAL_MAX_Y && z < PORTAL_Z + 1e-4) {
        p.x = m.x + matrixCave.cr * x + matrixCave.sr * (PORTAL_Z + 1e-4);
        p.z = m.z - matrixCave.sr * x + matrixCave.cr * (PORTAL_Z + 1e-4);
      }
    }
    let opening = cameraCaveIndex ? CAMERA_OPENINGS[cameraCaveIndex - 1] : null, start = 0, exit = false;
    if (cameraPreviousValid) {
      for (let i = 0; i < CAMERA_OPENINGS.length; i++) {
        const candidate = CAMERA_OPENINGS[i], crossing = cameraCrossing(CAMERA_PREVIOUS, p, candidate);
        if (matrixCave && candidate.caveIndex === matrixCave.caveIndex && crossing.reason) {
          const rejected = matrixCave.portal.rejected, reason = crossing.reason;
          rejected[reason] = Math.min(0x7fffffff, rejected[reason] + 1);
        }
        if (!crossing.valid) continue;
        if (!opening && crossing.direction > 0) {
          opening = candidate;
          start = crossing.amount;
        } else if (opening === candidate && crossing.direction < 0) exit = true;
      }
    }
    if (opening) {
      const fromX = lerp(CAMERA_PREVIOUS.x, p.x, start), fromY = lerp(CAMERA_PREVIOUS.y, p.y, start), fromZ = lerp(CAMERA_PREVIOUS.z, p.z, start);
      const dx = p.x - fromX, dy = p.y - fromY, dz = p.z - fromZ;
      const steps = Math.max(1, Math.min(768, Math.ceil(Math.hypot(dx, dz) / (island.unit * 0.5))));
      let x = CAMERA_PREVIOUS.x, y = CAMERA_PREVIOUS.y, z = CAMERA_PREVIOUS.z, outside = false, accepted = false;
      for (let i = 0; i <= steps; i++) {
        const k = i / steps, sx = fromX + dx * k, sz = fromZ + dz * k;
        const along = (sx - opening.mouth.x) * opening.sr + (sz - opening.mouth.z) * opening.cr;
        if (cameraCaveIndex && along > opening.planeZ + 1e-7) {
          if (exit) outside = true;
          break;
        }
        if (!cameraSpaceAt(sx, sz, opening)) break;
        accepted = true;
        x = sx; z = sz;
        y = Math.max(CAMERA_SPACE.floor, Math.min(CAMERA_SPACE.ceiling, fromY + dy * k));
      }
      if (outside) setCameraCave(0);
      else {
        p.x = x; p.y = y; p.z = z;
        const along = (x - opening.mouth.x) * opening.sr + (z - opening.mouth.z) * opening.cr;
        if (accepted && along < opening.planeZ - 1e-7) setCameraCave(opening.caveIndex);
      }
    }
    const caveView = !!cameraCaveIndex;
    cameraEntranceIndex = 0;
    if (!cameraCaveIndex) {
      const floor = exteriorCameraFloorAt(p.x, p.y, p.z, clearance, smoothStep, closeMix);
      cameraEntranceIndex = exteriorEntranceIndex;
      p.y = Math.min(p.y, exteriorCeiling);
      p.y = Math.max(p.y, floor);
    }
    if (smoothStep && closeMix <= 0.5 && !caveView) {
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
    // The outdoor near plane is wider than the cave eye clearance. Shorten it
    // at low entrances/interiors so nearby jagged rock is not sliced away.
    camera.near = caveView || cameraEntranceIndex || closeMix > 0.5 ? 0.1 : 0.5;
    setVec(CAMERA_PREVIOUS, p.x, p.y, p.z);
    cameraPreviousValid = true;
    if (matrixCave) {
      const portal = matrixCave.portal, m = matrixCave.mouth, dx = p.x - m.x, dz = p.z - m.z;
      portal.previousX = matrixCave.cr * dx - matrixCave.sr * dz;
      portal.previousY = p.y - m.floorY;
      portal.previousZ = matrixCave.sr * dx + matrixCave.cr * dz;
      portal.previousValid = true;
    }
  };

  // ---------- per frame ----------
  const updateMeter = () => {
    const seconds = game.forecast(world.level, crew.eatingCavemen().length, EAT_RATE);
    hud.setMeter(world.level, METER_CAPACITY, Number.isFinite(seconds) ? `≈ ${game.formatDuration(seconds)} left` : "stable");
  };
  // The clock drives the sky, the lamps and who is out
  const setPhase = (next) => {
    const first = phase === null;
    phase = next;
    hud.setSubtitle(`an island of caves · ${next}`);
    if (!first) hud.toast(PHASE_TOASTS[next]);
  };
  const update = (dt, elapsed) => {
    now = elapsed;
    hour = clock.read();
    daylight.sample(hour, RENDER_OPTS, clock.dayOfYear, islandLatitude, clock.continuousDay);
    RENDER_OPTS.time = elapsed;
    updateLamps(dt, elapsed, phase !== null);
    const next = daylight.phaseAt(hour);
    if (next !== phase) setPhase(next);
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
    critters.update(dt, elapsed, RENDER_OPTS.day, RENDER_OPTS.stars, fire.k);
    pileEdgeNow = pile.pileEdge();
    pilot.readInput(dt);
    crew.update(dt, elapsed);
    pile.update(dt);
    const player = pilot.player;
    const continuingPlayer = !!player && caveEntryPlayer === player;
    const previousPlayerX = PLAYER_PREVIOUS.x, previousPlayerZ = PLAYER_PREVIOUS.z;
    updatePlayerCave(player);
    // Pulse the prop if it still hides the jetpack
    if (stash) {
      const t = now - hintAt;
      const pulse = t > 0 ? t % HINT_EVERY : HINT_PULSE;
      stash.node.highlight = pulse < HINT_PULSE ? Math.sin(pulse / HINT_PULSE * Math.PI) * HINT_MAX : 0;
    }
    // Turn and bob the dropped pickup
    if (jetpack) {
      jetpack.node.rotation.y += dt * 0.9;
      jetpack.node.position.y = JETPACK_HOVER + Math.sin(elapsed * 2) * 0.09;
      if (player && !player.jet && Math.hypot(player.root.position.x - jetpack.x, player.root.position.z - jetpack.z) < JETPACK_REACH) collectJetpack(player);
    }
    // Walking into an open cave enters it, flying or standing on its roof does not.
    // The drop plane is deliberately on that roof and uses its own proximity gate.
    if (player && !entering && player.hop < 1) {
      const p = player.root.position;
      const y = p.y - player.baseY;
      if (playerCaveIndex) {
        const playerOpening = CAMERA_OPENINGS[playerCaveIndex - 1];
        const overhead = camera.position.y >= playerOpening.mouth.floorY + playerOpening.maxY;
        for (let i = 0; i < openMouths.length; i++) {
          const { slot, m } = openMouths[i];
          if (!overhead && m === playerOpening.mouth && Math.abs(y - m.floorY) < 1 && Math.hypot(p.x - m.inside.x, p.z - m.inside.z) < TUNNEL_REACH) enterCave(slot);
        }
      }
      if (!playerCaveIndex && continuingPlayer) for (let i = 0; i < launchers.length; i++) {
        const l = launchers[i];
        const distance = Math.hypot(p.x - l.x, p.z - l.z);
        const previousDistance = Math.hypot(previousPlayerX - l.x, previousPlayerZ - l.z);
        if (Math.abs(y - l.y) < 1 && distance < LAUNCH_REACH && previousDistance >= LAUNCH_REACH) enterLaunch();
      }
    }
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i], p = c.node.position;
      if (c.beside) {
        p.z += c.speed * dt;
        if (p.z > CLOUD_WRAP) p.z -= CLOUD_WRAP * 2;
      } else {
        p.x += c.speed * dt;
        if (p.x > CLOUD_WRAP) p.x -= CLOUD_WRAP * 2;
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
    crates.update(dt, elapsed);
    fx.update(dt);
    stepTweens(dt);
    pilot.update(dt);
    // clampCamera resolves the active eye's entrance crossing inside pilot.update.
    // Commit the portal and Matrix state only after that result, before rendering,
    // so the mirror and the covered interior can never disagree for one frame.
    syncMatrixInside(player);
    updateMatrixWorld(dt, elapsed);
    meterTimer -= dt;
    if (meterTimer <= 0) {
      meterTimer = 0.25;
      updateMeter();
    }
  };
  // Build quotes over the depth-tested scene
  const drawExtra = (ctx2d, project, drawBubble) => {
    crew.drawQuotes(ctx2d, project, drawBubble);
  };
  const overlay = (dt) => fx.drawOverlay(dt, drawExtra);

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
    if (e.key === "Escape") pilot.release();
    if (e.key === "0") pilot.goPreset("pile");
    if (e.key === "b" || e.key === "B") addTestBananas(testBananas);
    if (e.key === "l" || e.key === "L") demoTip(120000);
    if (e.key === "p" || e.key === "P") {
      world.level = Math.max(world.level, pile.slots.length);
      pile.syncPile(true);
    }
    // J straps a jetpack on whoever is being driven
    if (e.key === "j" || e.key === "J") {
      const cave = crew.player;
      if (cave && !cave.jet) {
        if (stash) {
          stash.node.highlight = 0;
          stash = null;
        }
        if (jetpack) collectJetpack(cave);
        else equipJetpack(cave);
      }
    }
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
    MATRIX_WORLD.active = MATRIX_WORLD.direction = MATRIX_WORLD.radius = MATRIX_WORLD.time = 0;
    MATRIX_WORLD.density = renderer.kind === "canvas2d" ? MATRIX_DENSITY.canvas2d / MATRIX_DENSITY.high : MATRIX_DENSITY[renderer.quality] / MATRIX_DENSITY.high;
    camera = createCamera({ fov: 48, near: 0.5, far: 140 });
    root = createNode();
    clock = daylight.createClock({ hour: hourParam, daylen: daylenParam, day: dayParam, now: new Date() });
    phase = null;
    island = terrain.island({ seed: SEED });
    cameraCaveIndex = 0;
    cameraEntranceIndex = 0;
    cameraPreviousValid = false;
    cameraTerrainValid = false;
    cameraTerrainRecovering = false;
    cameraTerrainEntranceIndex = 0;
    caveEntryPlayer = null;
    playerCaveIndex = 0;
    CAMERA_OPENINGS.length = 0;
    MATRIX_WORLD.caveNear = Infinity;
    for (let i = 0; i < island.mouths.length; i++) {
      const m = island.mouths[i], sr = Math.sin(m.ry), cr = Math.cos(m.ry), offset = i * 4;
      CAMERA_OPENINGS.push({ id: m.id, caveIndex: i + 1, mouth: m, sr, cr, minX: PORTAL_MIN_X, maxX: PORTAL_MAX_X, minY: PORTAL_MIN_Y, maxY: PORTAL_MAX_Y, planeZ: PORTAL_Z, rim: hubModels.caveMouthRim().openingBounds });
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
    hud = hudMod.create({ roster: contributors.roster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled });
    hooks = {};
    input = interactMod.create({ canvas: ctx.canvas, renderer, camera, hooks });
    presets = { pile: PILE_VIEW, gate: GATE_VIEW };
    pilot = pilotMod.create({ renderer, canvas: ctx.canvas, camera, hud, presets, landing: "pile", pitch: [PITCH_MIN, PITCH_MAX], dist: [DIST_MIN, DIST_MAX], follow: FOLLOW, fly: FLY, clampTarget, clampCamera, coarse: COARSE, close: { ...CLOSE_VIEW, maxStep: STEP_MAX, groundAt: supportAt, visualGroundAt: visualSupportAt, zone: () => playerCaveIndex } });
    place(island.geometry, 0, 0, 0, 0);
    pathNode = createNode({ geometry: island.path.geometry, instanceData: island.path.instanceData, instanceCount: 0, instanceVersion: 0, depthBias: 0.05 });
    addChild(root, pathNode);
    placed.push(pathNode);
    altar = buildAltar();
    const layoutPile = (radius) => {
      altar.setRadius(radius);
      const changed = island.path.setRadius(altar.platformRadius);
      island.path.apply(pathNode);
      if (changed) reflowScenery();
    };
    layoutPile(pileMod.visualFootprintFor(world.level, PILE_SCALE));
    const gate = place(hubModels.gate(), island.gate.x, island.gate.z, island.gate.ry);
    gateRain = buildGateRain(gate);
    addTarget(gate, { kind: "gate" }, { radius: 3 });
    props.push({ kind: "prop", prop: "gate", node: gate, x: gate.position.x, z: gate.position.z, ripe: 0, active: true });
    claim(gate.position.x, gate.position.z, 3);
    TICKER_AT.y = gate.position.y + 6;
    GATE_VIEW.target.y = gate.position.y + 2.5;
    const bedrolls = [];
    for (const slot of caves.slots) {
      const m = island.mouths.find((mouth) => mouth.id === slot.id);
      addTarget(buildMouth(slot, m), { kind: "cave", slot, priority: 1 }, { radius: 2.6 });
      claim(m.x, m.z, 3.5);
      if (slot.scene) {
        presets[slot.scene] = mouthView(m);
        openMouths.push({ slot, m });
      }
      if (slot.status === "sleeping") bedrolls.push(m.inside);
    }
    // The roof view the drop launch dollies onto
    for (const roof of launchers) presets.drop = { yaw: roof.ry, pitch: 0.36, dist: 14, target: { x: roof.x, y: roof.y + 1.2, z: roof.z } };
    for (const deg of BEDROLL_DEGREES) {
      const p = spotAt(deg, BEDROLL_RADIUS, 1.4);
      place(hubModels.bedroll(), p.x, p.z, 0, 0.05, "bedroll", 1.1).depthBias = 0.3;
      claim(p.x, p.z, 1.2);
      bedrolls.push(p);
    }
    // An inner ring of beds for the rest
    const extra = contributors.roster.length - bedrolls.length;
    for (let k = 0; k < extra; k++) {
      const p = spotAt(20 + k * 360 / extra, BEDROLL_INNER, 1.4);
      place(hubModels.bedroll(), p.x, p.z, 0, 0.05, "bedroll", 1.1).depthBias = 0.3;
      claim(p.x, p.z, 1.2);
      bedrolls.push(p);
    }
    const buildSpotsList = BUILD_DEGREES.map((deg) => {
      const { x, z } = spotAt(deg, BUILD_RADIUS, 1);
      claim(x, z, 0.9);
      return { x, z, ry: Math.atan2(-x, -z) };
    });
    buildRim();
    const firePos = buildFire();
    fire = lamps[lamps.length - 1];
    scatter();
    reflowScenery();
    buildSpots();
    buildClouds();
    hideJetpack();
    critters = crittersMod.create({ root, renderer, flowers: scenery.filter((o) => o.prop === "flower" && o.active), fire: firePos, meadowRadius: MEADOW, heightAt: island.heightAt });
    mark("props");
    const shared = { root, input, hooks, hud, game, world, renderer, camera, overlay: ctx.overlay, overlayVisible: matrixOverlayVisible, tickerAt: TICKER_AT, buildSpots: buildSpotsList, walkIn: WALK_IN, clampDrag, viewYaw: PILE_VIEW.yaw, bedrolls, pileScale: PILE_SCALE, pileY: ALTAR_HEIGHT + 0.02, matrixLivingPile: true, onLayout: layoutPile, onShown: () => { meterTimer = 0; }, crateRadius: () => Math.max(4.4, altar.platformRadius + 0.8), groundAt: supportAt, wanderSpot, walkable, flyable, useNear, phase: () => phase };
    fx = shared.fx = fxMod.create(shared);
    pile = shared.pile = pileMod.create(shared);
    mark("pile");
    crew = shared.crew = crewMod.create(shared);
    for (const cave of crew.cavemen.values()) cave.root.matrixLiving = true;
    mark("cavemen");
    crates = shared.crates = cratesMod.create(shared);
    pilot.bind(shared);

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
        if (hit) hud.tooltip.show(tooltipFor(hit), p.x, p.y);
        else hud.tooltip.hide();
      },
      onHoverMove: (hit, p) => hud.tooltip.show(tooltipFor(hit), p.x, p.y),
      onTap,
      ...pilot.hooks
    });
    // Every visit starts on the landing view
    entering = false;
    pileEdgeNow = 0;
    now = 0;
    hud.onPreset(pilot.goPreset);
    hud.onAction((action) => {
      if (action === "tip") demoTip(1200);
      else if (action === "tip-legendary") demoTip(120000);
      else if (action === "clear-loot") clearLoot();
      else if (action === "reset") resetDemo();
      else if (action === "act") pilot.action();
      else if (action === "reset-view") pilot.goPreset("pile");
    });
    meterTimer = 0;
    crew.refreshStates(true);
    // Once a minute, refresh states and trim the pool
    stateTimer = window.setInterval(() => {
      crew.refreshStates();
      fx.trimPool();
    }, 6e4);
    for (const cave of crew.cavemen.values()) crew.refreshRosterRow(cave);
    if (lootEnabled) {
      crew.applyAllSwag();
      crew.renderLocker();
    }
    hud.setStats(game.state);
    pile.syncPile(true);
    updateMeter();
    if (window.matchMedia("(max-width: 720px), (max-height: 500px)").matches) hud.el.sheet.dataset.open = "false";
    hintTimer = window.setTimeout(() => hud.hint(COARSE ? "Drag to look · pinch to eye level · sticks to fly · tap a cave" : "Drag to look · scroll to eye level · WASD to fly · tap a cave to enter"), 1200);
    Object.assign(hubScene, {
      root, camera, input,
      debug: {
        slots: pile.slots, drops: pile.drops, core: pile.core, shell: pile.shell, delivery: pile.delivery, cavemen: crew.cavemen, crates: crates.list, lab: null, hud, applyAllSwag: crew.applyAllSwag, renderLocker: crew.renderLocker, demoTip, setPileLevel: pile.setLevel, refreshStates: crew.refreshStates, trimPool: fx.trimPool,
        get shown() {
          return pile.shown;
        },
        island, mouths: island.mouths, labels, launchers, camera, crew, controls: pilot.controls, props, altar, path: island.path.debug,
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
          return DAYLIGHT_DEBUG;
        },
        setHour: (h, daylen = NaN, day = clock.dayOfYear) => {
          clock = daylight.createClock({ hour: h, daylen, day });
        },
        get jetpack() {
          return {
            stash, pickup: jetpack, hintAt,
            hintNow: () => (hintAt = now),
            forceHost: (o) => {
              if (!o.scenery || !o.active) throw new Error("Jetpack test host must be active scenery");
              if (stash) stash.node.highlight = 0;
              stash = o;
              hintAt = now + HINT_AFTER;
            }
          };
        }
      }
    });
    Object.defineProperty(hubScene.debug.matrixCave, "caves", { value: matrixInteriors });
  };
  const leave = () => {
    window.clearInterval(stateTimer);
    window.clearTimeout(hintTimer);
    crates.dispose();
    pile.dispose();
    crew.dispose();
    critters.dispose();
    fx.dispose();
    pilot.dispose();
    for (const node of targets) input.remove(node);
    for (const node of placed) removeChild(root, node);
    targets.length = placed.length = claimed.length = scenery.length = sceneryClaims.length = matrixInteriors.length = clouds.length = lamps.length = entranceLights.length = fireSeats.length = sleepers.length = labels.length = spots.length = openMouths.length = launchers.length = props.length = 0;
    RENDER_OPTS.lightCount = 0;
    MATRIX_WORLD.active = MATRIX_WORLD.direction = MATRIX_WORLD.radius = 0;
    cameraCaveIndex = 0;
    cameraEntranceIndex = 0;
    cameraPreviousValid = false;
    cameraTerrainValid = false;
    cameraTerrainRecovering = false;
    cameraTerrainEntranceIndex = 0;
    caveEntryPlayer = null;
    playerCaveIndex = 0;
    CAMERA_OPENINGS.length = 0;
    LIGHTING_DEBUG.registeredLampCount = LIGHTING_DEBUG.activeFullLightCount = LIGHTING_DEBUG.approximatedLightCount = LIGHTING_DEBUG.selectedCount = LIGHTING_DEBUG.approximatedCount = 0;
    for (let i = 0; i < LIGHT_CAPACITY; i++) LIGHTING_DEBUG.selectedIds[i] = LIGHTING_DEBUG.approximatedIds[i] = null;
    sceneryVisible = sceneryRadiusCulled = sceneryPathCulled = sceneryFixedCulled = sceneryReflows = 0;
    const count = input.targetCount;
    input.dispose();
    hud.dispose();
    // Drop everything but the cached island
    pathNode = altar = hud = hooks = input = pilot = fx = pile = crew = crates = critters = clock = presets = stash = jetpack = mirrorCave = matrixCave = gateRain = fire = null;
    hubScene.input = hubScene.debug = null;
    return { targets: count };
  };
  const liveGeometry = (set) => {
    for (const cave of crew.cavemen.values()) set.add(cave.headOpen).add(cave.headClosed);
  };
  const stats = () => {
    let nodes = 0;
    traverseVisible(root, () => nodes++);
    const all = (n) => 1 + n.children.reduce((sum, c) => sum + all(c), 0);
    return { visibleNodes: nodes, allNodes: all(root), tweens: tweenCount(), targets: input.targetCount, ...fx.stats(), ...crates.stats(), ...crew.stats(), ...pile.stats(), ...critters.stats() };
  };
  const hubScene = {
    id: "hub", enter, update, overlay, onDonation, onKey, onLootCleared, renderOpts: RENDER_OPTS, leave, stats, liveGeometry,
    root: null, camera: null, input: null, debug: null,
    get inMotion() {
      return pile.inMotion || fx.inMotion || !!MATRIX_WORLD.active;
    }
  };
  BL.scenes = BL.scenes || {};
  BL.scenes.hub = hubScene;
})();
