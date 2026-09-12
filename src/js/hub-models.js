// Hub props, one cached geometry per builder
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { hexToRgb, mulberry32 } = BL.math;
  const { box, lathe, ring, merge, voxelFaces } = BL.models;
  const cached = (build) => {
    let value = null;
    return () => value || (value = build());
  };
  const variants = (build) => {
    const cache = [];
    return (i = 0) => cache[i] || (cache[i] = build(i));
  };
  const vox = () => {
    const map = new Map();
    const key = (x, y, z) => x + "," + y + "," + z;
    return {
      map,
      has: (x, y, z) => map.has(key(x, y, z)),
      set: (x, y, z, c) => map.set(key(x, y, z), c),
      fill(x0, x1, y0, y1, z0, z1, c) {
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) map.set(key(x, y, z), typeof c === "function" ? c(x, y, z) : c);
      }
    };
  };
  // Voxel cells to geometry, palette in hex
  const voxGeo = (v, { unit, palette, origin = { x: 0, y: 0, z: 0 }, emissive = {} }) => {
    const geo = { verts: [], faces: [], lines: [] };
    const rgb = palette.map(hexToRgb);
    const emit = (pts, c) => {
      const i = pts.map(([x, y, z]) => {
        geo.verts.push(origin.x + x * unit, origin.y + y * unit, origin.z + z * unit);
        return geo.verts.length / 3 - 1;
      });
      geo.faces.push({ i, color: rgb[c], emissive: emissive[c] || 0 });
    };
    voxelFaces((fn) => {
      for (const [k, c] of v.map) {
        const [x, y, z] = k.split(",").map(Number);
        fn(x, y, z, c);
      }
    }, v.has, emit);
    return geo;
  };
  // Ellipsoid of cells, chipped and cut off below floor
  const blob = (v, { cx, cy, cz, rx, ry, rz, chip = 0, floor = -Infinity, rand, color }) => {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      for (let y = Math.max(floor, Math.floor(cy - ry)); y <= Math.ceil(cy + ry); y++) {
        for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > 1 || (d > 0.72 && rand() < chip)) continue;
          v.set(x, y, z, color(x, y, z));
        }
      }
    }
  };
  const pick = (rand, base, alt, p) => () => rand() < p ? alt : base;
  // Tone leaf cells between lo and hi: dark under the lower third, light caps on top
  const foliage = (v, rand, base, lo, hi, berry = 0) => {
    for (const [k, c] of v.map) {
      if (c < base) continue;
      const [x, y, z] = k.split(",").map(Number);
      let tone;
      if ((y - lo) / (hi - lo) < 0.34) tone = rand() < 0.75 ? 0 : 1;
      else if (!v.has(x, y + 1, z)) tone = rand() < berry ? 4 : rand() < 0.65 ? 3 : 2;
      else tone = rand() < 0.5 ? 1 : 2;
      v.map.set(k, base + tone);
    }
  };
  // Roll about z, then yaw about y, in place
  const turn = (geo, yaw, roll = 0) => {
    const p = geo.verts;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] * cr - p[i + 1] * sr, y = p[i] * sr + p[i + 1] * cr, z = p[i + 2];
      p[i] = x * cy + z * sy;
      p[i + 1] = y;
      p[i + 2] = z * cy - x * sy;
    }
    return geo;
  };
  const noShadow = (geo) => {
    geo.castShadow = false;
    return geo;
  };
  const VOX = 0.5;
  const QUARTER = 0.25;
  const QHALF = { x: -QUARTER / 2, y: 0, z: -QUARTER / 2 };
  const STONE = ["#3a3734", "#2d2b28", "#45413d"];
  const CLIFF = ["#7d6f61", "#5e5449", "#877869"];
  const WOOD = "#8a6236", WOOD_DK = "#5c4425", PLANK = "#a9773f";
  const CAVE_SIGN_WIDTH = 3.78, CAVE_SIGN_HEIGHT = 1.06;
  const SIGN_GLYPHS = {
    E: ["111", "100", "110", "100", "111"],
    n: ["000", "110", "101", "101", "101"],
    t: ["010", "111", "010", "010", "011"],
    r: ["000", "110", "101", "100", "100"],
    O: ["111", "101", "101", "101", "111"],
    o: ["000", "111", "101", "101", "111"],
    p: ["000", "110", "101", "110", "100", "100"],
    y: ["000", "101", "101", "011", "001", "110"],
    g: ["000", "111", "101", "111", "001", "110"],
    q: ["000", "111", "101", "111", "001", "001"],
    j: ["001", "000", "001", "001", "101", "010"],
    B: ["110", "101", "110", "101", "110"],
    L: ["100", "100", "100", "100", "111"],
    a: ["000", "010", "101", "111", "101"],
    b: ["100", "100", "110", "101", "110"],
    d: ["001", "001", "011", "101", "011"],
    c: ["000", "011", "100", "100", "011"],
    e: ["000", "010", "111", "100", "011"],
    f: ["011", "010", "111", "010", "010"],
    h: ["100", "100", "110", "101", "101"],
    i: ["010", "000", "010", "010", "010"],
    k: ["100", "101", "110", "101", "101"],
    l: ["110", "010", "010", "010", "011"],
    m: ["000", "111", "111", "101", "101"],
    s: ["000", "011", "110", "001", "110"],
    u: ["000", "101", "101", "101", "011"],
    v: ["000", "101", "101", "101", "010"],
    w: ["000", "101", "101", "111", "010"],
    x: ["000", "101", "010", "010", "101"],
    z: ["000", "111", "001", "010", "111"],
    A: ["010", "101", "111", "101", "101"],
    C: ["011", "100", "100", "100", "011"],
    D: ["110", "101", "101", "101", "110"],
    F: ["111", "100", "110", "100", "100"],
    H: ["101", "101", "111", "101", "101"],
    M: ["101", "111", "111", "101", "101"],
    P: ["110", "101", "110", "100", "100"],
    R: ["110", "101", "110", "101", "101"],
    S: ["011", "100", "010", "001", "110"],
    T: ["111", "010", "010", "010", "010"],
    W: ["101", "101", "101", "111", "101"],
    0: ["111", "101", "101", "101", "111"],
    1: ["010", "110", "010", "010", "111"],
    2: ["111", "001", "111", "100", "111"],
    3: ["111", "001", "111", "001", "111"],
    4: ["101", "101", "111", "001", "001"],
    5: ["111", "100", "111", "001", "111"],
    6: ["111", "100", "111", "101", "111"],
    7: ["111", "001", "001", "001", "001"],
    8: ["111", "101", "111", "101", "111"],
    9: ["111", "101", "111", "001", "111"],
    "!": ["010", "010", "010", "000", "010"],
    "'": ["010", "010", "000", "000", "000"],
    "?": ["111", "001", "011", "000", "010"],
    ".": ["000", "000", "000", "000", "010"]
  };
  const SIGN_CELL = 0.075, SIGN_PIXEL = 0.061, SIGN_PAD = 0.855, SIGN_FRONT = 0.23;
  const SIGN_CACHE = new Map();
  const caveSign = (text = "EntropyLab") => {
    const hit = SIGN_CACHE.get(text);
    if (hit) return hit;
    let cells = -1;
    for (const ch of text) cells += ch === " " ? 2 : 4;
    const textW = cells * SIGN_CELL;
    const width = Math.max(CAVE_SIGN_WIDTH, textW + SIGN_PAD);
    const half = CAVE_SIGN_HEIGHT * 0.5;
    // Back slab, two planks with end grain, hung from a bar; the front face sits at SIGN_FRONT
    const geos = [
      box({ w: width, h: CAVE_SIGN_HEIGHT, d: 0.14, color: WOOD_DK }),
      box({ w: width - 0.24, h: half, d: 0.16, color: WOOD, offset: { y: half * 0.5, z: 0.15 } }),
      box({ w: width - 0.24, h: half, d: 0.16, color: PLANK, offset: { y: -half * 0.5, z: 0.15 } }),
      ...[-1, 1].flatMap((side) => [half * 0.5, -half * 0.5].map((y) => box({ w: 0.12, h: half, d: 0.16, color: "#4a3319", offset: { x: side * (width * 0.5 - 0.06), y, z: 0.15 } }))),
      box({ w: width + 0.3, h: 0.08, d: 0.34, color: WOOD_DK, offset: { y: half + 0.18, z: 0.08 } }),
      ...[-1, 1].map((side) => box({ w: 0.06, h: 0.2, d: 0.06, color: "#3a2a18", offset: { x: side * (width * 0.5 - 0.3), y: half + 0.07, z: 0.08 } })),
      box({ w: width - 0.2, h: 0.025, d: 0.025, color: "#7a5630", offset: { y: 0.2, z: SIGN_FRONT + 0.0175 } }),
      box({ w: width - 0.2, h: 0.025, d: 0.025, color: "#7a5630", offset: { y: -0.22, z: SIGN_FRONT + 0.0175 } })
    ];
    let cursor = -textW * 0.5;
    for (const ch of text) {
      if (ch === " ") {
        cursor += SIGN_CELL * 2;
        continue;
      }
      const glyph = SIGN_GLYPHS[ch];
      if (!glyph) throw new Error(`No cave-sign glyph for "${ch}"`);
      for (let row = 0; row < glyph.length; row++) {
        for (let col = 0; col < glyph[row].length; col++) {
          if (glyph[row][col] !== "1") continue;
          geos.push(box({ w: SIGN_PIXEL, h: SIGN_PIXEL, d: 0.035, color: "#f3efe4", emissive: 0.2, offset: { x: cursor + col * SIGN_CELL + SIGN_CELL * 0.5, y: (2 - row) * SIGN_CELL, z: SIGN_FRONT + 0.0125 } }));
        }
      }
      cursor += SIGN_CELL * 4;
    }
    for (const x of [-width * 0.5 + 0.13, width * 0.5 - 0.13]) {
      for (const y of [-CAVE_SIGN_HEIGHT * 0.5 + 0.13, CAVE_SIGN_HEIGHT * 0.5 - 0.13]) {
        geos.push(box({ w: 0.07, h: 0.07, d: 0.035, color: "#3a2a18", offset: { x, y, z: SIGN_FRONT + 0.0125 } }));
      }
    }
    const geo = merge(...geos);
    geo.signWidth = width;
    geo.signHeight = CAVE_SIGN_HEIGHT;
    SIGN_CACHE.set(text, geo);
    return geo;
  };
  // Stone frame around a cave mouth
  const caveMouthRim = cached(() => {
    const rand = mulberry32(31);
    const v = vox();
    const stone = pick(rand, 0, 1, 0.3);
    const light = pick(rand, 2, 0, 0.5);
    v.fill(-6, -6, 0, 5, 0, 1, stone);
    v.fill(5, 5, 0, 5, 0, 1, stone);
    v.fill(-5, 4, 6, 6, 0, 1, light);
    const geo = voxGeo(v, { unit: VOX, palette: CLIFF, origin: { x: 0, y: 0, z: -VOX } });
    geo.jambCenterX = 2.75;
    geo.frontZ = 0.5;
    geo.openingBounds = { minX: -2.5, maxX: 2.5, floorY: 0, ceilingY: 3, minZ: -0.5, maxZ: 0.5 };
    return geo;
  });
  const mirrorPanel = cached(() => {
    const geo = {
      verts: [-2.5, -1.75, 0, 2.5, -1.75, 0, 2.5, 1.5, 0, -2.5, 1.5, 0],
      faces: [{ i: [0, 1, 2, 3], color: hexToRgb("#81919c"), emissive: 0 }],
      lines: [],
      castShadow: false
    };
    return geo;
  });
  const MATRIX_GLYPHS = [
    ["0110", "1001", "1111", "1001", "1001", "0000"],
    ["1110", "1001", "1110", "1001", "1110", "0000"],
    ["1111", "1000", "1110", "1000", "1111", "0000"],
    ["1001", "1001", "1111", "0001", "1110", "0000"],
    ["1111", "0110", "0110", "0110", "1111", "0000"],
    ["1000", "1100", "1010", "0110", "0010", "0000"],
    ["0110", "1111", "0110", "1111", "0110", "0000"],
    ["1001", "0110", "1001", "0110", "1001", "0000"]
  ];
  const matrixGlyph = variants((i) => {
    const rows = MATRIX_GLYPHS[i % MATRIX_GLYPHS.length], pixels = [];
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        if (rows[y][x] !== "1") continue;
        pixels.push(box({ w: 0.016, h: 0.016, d: 0.01, color: i & 1 ? "#46ff70" : "#18dc4a", emissive: 1, offset: { x: (x - 1.5) * 0.021, y: (2.5 - y) * 0.021 } }));
      }
    }
    const geo = merge(...pixels);
    geo.castShadow = false;
    geo.matrixGlyph = true;
    return geo;
  });
  // Gateway arch over the pass, trail along z
  const gate = cached(() => {
    const rand = mulberry32(67);
    const v = vox();
    const stone = pick(rand, 0, 1, 0.3);
    const light = pick(rand, 2, 0, 0.5);
    v.fill(-3, -3, 0, 7, 0, 1, stone);
    v.fill(2, 2, 0, 7, 0, 1, stone);
    v.fill(-3, 2, 8, 8, 0, 1, light);
    v.fill(-1, 0, 9, 9, 0, 1, light);
    return voxGeo(v, { unit: VOX, palette: STONE, origin: { x: 0, y: 0, z: -VOX } });
  });
  const SCREEN = (x, y, color) => [
    box({ w: 0.7, h: 0.5, d: 0.12, color: "#1d2326", offset: { x, y, z: 0 } }),
    box({ w: 0.62, h: 0.42, d: 0.02, color, emissive: 0.9, offset: { x, y, z: 0.07 } })
  ];
  // Shelves that glow enough to read in the tunnel
  const caveShelves = cached(() => merge(
    box({ w: 2.4, h: 2.2, d: 0.1, color: "#3a3632", emissive: 0.35, offset: { y: 1.1, z: -0.25 } }),
    box({ w: 0.12, h: 2.2, d: 0.6, color: "#6a4f34", emissive: 0.35, offset: { x: -1.14, y: 1.1 } }),
    box({ w: 0.12, h: 2.2, d: 0.6, color: "#6a4f34", emissive: 0.35, offset: { x: 1.14, y: 1.1 } }),
    ...[0.06, 0.78, 1.5].map((y) => box({ w: 2.3, h: 0.08, d: 0.6, color: "#7a5a3a", emissive: 0.35, offset: { y } })),
    ...SCREEN(-0.6, 1.1, "#3fd1c5"),
    ...SCREEN(0.5, 1.82, "#6f9fca"),
    box({ w: 0.4, h: 0.3, d: 0.3, color: "#1d2326", offset: { x: 0.55, y: 0.97, z: 0.05 } }),
    box({ w: 0.3, h: 0.06, d: 0.02, color: "#22c55e", emissive: 0.9, offset: { x: 0.55, y: 1.05, z: 0.21 } }),
    box({ w: 0.44, h: 0.44, d: 0.44, color: WOOD, offset: { x: -0.7, y: 0.32, z: 0.02 } }),
    box({ w: 0.24, h: 0.3, d: 0.24, color: "#d8892b", offset: { x: 0.2, y: 0.25, z: 0.06 } }),
    box({ w: 0.24, h: 0.2, d: 0.24, color: "#6f9fca", offset: { x: 0.65, y: 0.2, z: 0.02 } })
  ));
  // Jetpack tanks and backplate, flame kept separate
  const JET_UNIT = 0.075;
  const JET_ORIGIN = { x: -3 * JET_UNIT, y: 0, z: -2 * JET_UNIT };
  const jetpack = cached(() => {
    const v = vox();
    for (const x of [0, 4]) {
      v.fill(x, x + 1, 1, 5, 0, 1, 0);
      v.fill(x, x + 1, 6, 6, 0, 1, 1);
      v.fill(x, x + 1, 0, 0, 0, 1, 2);
    }
    v.fill(2, 3, 2, 5, 1, 1, 1);
    v.fill(2, 3, 4, 4, 0, 0, 2);
    return voxGeo(v, { unit: JET_UNIT, palette: ["#c8552f", "#9aa1a8", "#3c3f44"], origin: JET_ORIGIN });
  });
  const jetFlame = cached(() => {
    const v = vox();
    for (const x of [0, 4]) {
      v.fill(x, x + 1, -1, -1, 0, 1, 0);
      v.set(x + (x ? 0 : 1), -2, 1, 1);
      v.set(x + (x ? 1 : 0), -2, 0, 1);
    }
    return voxGeo(v, { unit: JET_UNIT, palette: ["#ffb13b", "#ffe9a8"], origin: JET_ORIGIN, emissive: { 0: 1, 1: 1 } });
  });
  const bedroll = cached(() => merge(box({ w: 1.9, h: 0.09, d: 0.85, color: "#2e2724" }), box({ w: 0.4, h: 0.16, d: 0.6, color: "#40342c", offset: { x: 0.65, y: 0.1 } })));
  const GREENS = ["#3f7a2b", "#4f8f36", "#5fa243", "#74b552"];
  const CANOPIES = [GREENS, ["#2f6b3a", "#3f8248", "#4f9a58", "#66b06a"], ["#5a7d2a", "#6f9436", "#86aa44", "#a2c055"], ["#c47f9d", "#d697b0", "#e8b4c6", "#f2c9d8"]];
  const TREE_HEIGHT = 3;
  // Crown clumps per variant as [cx, cy, cz, rx, ry, rz] in quarter cells
  const CROWNS = [
    [[0, 8.6, 0, 4.6, 3.0, 4.4], [-2.2, 9.6, 1.4, 2.6, 2.4, 2.6], [2.0, 7.4, -1.6, 2.4, 2.0, 2.4]],
    [[0, 8.2, 0, 4.2, 2.6, 4.6], [1.6, 10.0, 0.6, 2.8, 2.2, 2.6], [-2.4, 7.6, -0.8, 2.6, 2.2, 2.4]],
    [[0.4, 8.8, -0.4, 4.4, 3.2, 4.2], [-2.6, 8.0, 1.8, 2.8, 2.2, 2.6]],
    [[0, 8.6, 0, 4.6, 3.0, 4.6], [2.2, 9.6, -1.2, 2.6, 2.2, 2.6], [-2.0, 7.6, 1.6, 2.4, 2.0, 2.4]]
  ];
  // Rooted trunk with branch stubs under a clumped canopy, TREE_HEIGHT units tall
  const tree = variants((i) => {
    const rand = mulberry32(101 + i);
    const v = vox();
    const bark = pick(rand, 0, 1, 0.3);
    v.fill(-1, 0, 0, 7, -1, 0, bark);
    for (const [x, z] of [[-2, -1], [1, 0], [0, 1], [-1, -2]]) if (rand() < 0.85) v.set(x, 0, z, bark());
    let lo = Infinity, hi = 0;
    for (const [cx, cy, cz, rx, ry, rz] of CROWNS[i]) {
      blob(v, { cx, cy, cz, rx, ry, rz, chip: 0.35, rand, color: () => 2 });
      lo = Math.min(lo, cy - ry);
      hi = Math.max(hi, cy + ry);
    }
    v.set(1, 6, 0, 1);
    v.set(2, 7, 0, 1);
    if (i % 2) {
      v.set(-2, 6, -1, 1);
      v.set(-3, 7, -1, 1);
    }
    foliage(v, rand, 2, lo, hi);
    return voxGeo(v, { unit: QUARTER, palette: ["#6b4a2b", "#4e361f", ...CANOPIES[i]] });
  });
  // Bush clumps per variant, small tuft to a wide berry bush
  const CLUMPS = [
    [[0, 1.0, 0, 1.9, 1.8, 1.7], [0.7, 1.4, -0.5, 1.3, 1.3, 1.2]],
    [[0, 1.4, 0, 2.5, 2.2, 2.3], [-1.2, 2.0, 0.8, 1.7, 1.6, 1.6], [1.3, 1.8, -0.9, 1.6, 1.5, 1.5]],
    [[0, 1.4, 0, 3.4, 2.0, 2.9], [-1.5, 2.1, 0.6, 2.0, 1.9, 1.9], [1.7, 2.3, -0.5, 2.0, 2.0, 2.0], [0.3, 2.8, 1.0, 1.6, 1.5, 1.5]]
  ];
  const bush = variants((i) => {
    const rand = mulberry32(7 + i);
    const v = vox();
    let hi = 0;
    for (const [cx, cy, cz, rx, ry, rz] of CLUMPS[i]) {
      blob(v, { cx, cy, cz, rx, ry, rz, chip: 0.2 + i * 0.05, floor: 0, rand, color: () => 0 });
      hi = Math.max(hi, cy + ry);
    }
    foliage(v, rand, 0, 0, hi, i === 2 ? 0.18 : 0);
    return voxGeo(v, { unit: QUARTER, palette: [...GREENS, "#c8322e"] });
  });
  const ROCK_SHAPES = [{ rx: 3.2, ry: 3.6, rz: 2.8 }, { rx: 5, ry: 3.8, rz: 4.2 }];
  const rock = variants((i) => {
    const rand = mulberry32(211 + i);
    const v = vox();
    const { rx, ry, rz } = ROCK_SHAPES[i];
    blob(v, { cx: 0.5, cy: 0.4, cz: 0.5, rx, ry, rz, chip: 0.2, floor: 0, rand, color: pick(rand, 0, 1, 0.3) });
    let top = 0;
    for (const k of v.map.keys()) top = Math.max(top, +k.split(",")[1]);
    for (const [k, c] of v.map) {
      const [x, y, z] = k.split(",").map(Number);
      if (y >= top * 2 / 3 && !v.has(x, y + 1, z) && rand() < 0.3) v.map.set(k, 3);
      else if (c === 0 && rand() < 0.15) v.map.set(k, 2);
    }
    return voxGeo(v, { unit: QUARTER, palette: ["#6b625a", "#57504a", "#7a716a", "#5b7f3a"], origin: QHALF });
  });
  const altarSlab = cached(() => lathe({
    profile: [[0, 0], [1, 0], [1, 0.82], [0.96, 1], [0, 1]],
    segments: 32,
    color: (t) => t < 0.5 ? "#57504a" : "#756b62"
  }));
  // Unit blocks are instanced around the continuously growing altar edge.
  const altarBlock = variants((i) => box({ color: STONE[i % STONE.length], offset: { y: 0.5 } }));
  const woodCrate = cached(() => merge(
    box({ w: 0.9, h: 0.9, d: 0.9, color: PLANK, offset: { y: 0.45 } }),
    ...[[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]].map(([x, z]) => box({ w: 0.1, h: 0.94, d: 0.1, color: WOOD_DK, offset: { x, y: 0.47, z } })),
    box({ w: 0.94, h: 0.1, d: 0.1, color: WOOD_DK, offset: { y: 0.89, z: -0.42 } }),
    box({ w: 0.94, h: 0.1, d: 0.1, color: WOOD_DK, offset: { y: 0.89, z: 0.42 } }),
    box({ w: 0.1, h: 0.1, d: 0.94, color: WOOD_DK, offset: { x: -0.42, y: 0.89 } }),
    box({ w: 0.1, h: 0.1, d: 0.94, color: WOOD_DK, offset: { x: 0.42, y: 0.89 } })
  ));
  const barrel = cached(() => merge(
    lathe({ profile: [[0.32, 0], [0.4, 0.16], [0.43, 0.45], [0.4, 0.74], [0.32, 0.9], [0, 0.9]], segments: 8, color: "#7a5230" }),
    ring({ r: 0.45, thickness: 0.03, y: 0.24, segments: 8, color: "#3a2a1a" }),
    ring({ r: 0.45, thickness: 0.03, y: 0.66, segments: 8, color: "#3a2a1a" })
  ));
  const flowerTuft = cached(() => merge(
    box({ w: 0.44, h: 0.12, d: 0.14, color: "#5b9a3a", offset: { y: 0.06 } }),
    box({ w: 0.14, h: 0.12, d: 0.44, color: "#4a8530", offset: { y: 0.06 } }),
    ...[[-0.14, 0.05, 0.3, "#e04a3a"], [0.02, -0.12, 0.36, "#f2c94c"], [0.15, 0.1, 0.26, "#f3efe4"]].map(([x, z, h, color]) => merge(
      box({ w: 0.04, h, d: 0.04, color: "#4a8530", offset: { x, y: h / 2, z } }),
      box({ w: 0.12, h: 0.1, d: 0.12, color, offset: { x, y: h + 0.03, z } })
    ))
  ));
  const torch = cached(() => {
    const geo = merge(
      box({ w: 0.14, h: 1.1, d: 0.14, color: WOOD_DK, offset: { y: 0.55 } }),
      box({ w: 0.24, h: 0.16, d: 0.24, color: "#3a2a18", offset: { y: 1.16 } }),
      box({ w: 0.26, h: 0.26, d: 0.26, color: "#ffb13b", emissive: 1, offset: { y: 1.36 } })
    );
    geo.castShadow = false;
    geo.backZ = -0.13;
    geo.flameY = 1.36;
    return geo;
  });
  // A tuft of leaning blades, no shadow
  const grass = cached(() => {
    const rand = mulberry32(89);
    return noShadow(merge(...Array.from({ length: 6 }, (_, n) => {
      const h = 0.28 + rand() * 0.14;
      return turn(box({ w: 0.05, h, d: 0.12, color: n % 2 ? "#74b552" : "#4f8f36", offset: { y: h * 0.5 } }), n * Math.PI / 6 + (rand() - 0.5) * 0.4, (rand() - 0.5) * 0.4);
    })));
  });
  // Caged lamp hanging from its hook at the origin
  const lantern = cached(() => noShadow(merge(
    box({ w: 0.06, h: 0.08, d: 0.06, color: "#3a2a18", offset: { y: -0.04 } }),
    box({ w: 0.24, h: 0.04, d: 0.24, color: "#2b2521", offset: { y: -0.1 } }),
    ...[[-0.105, -0.105], [0.105, -0.105], [-0.105, 0.105], [0.105, 0.105]].map(([x, z]) => box({ w: 0.03, h: 0.3, d: 0.03, color: "#2b2521", offset: { x, y: -0.27, z } })),
    box({ w: 0.24, h: 0.04, d: 0.24, color: "#2b2521", offset: { y: -0.44 } }),
    box({ w: 0.13, h: 0.16, d: 0.13, color: "#ffd27a", emissive: 1, offset: { y: -0.27 } })
  )));
  // Stone ring over an ash bed with three crossed logs; the flame is fireFlame
  const firepit = cached(() => {
    const rand = mulberry32(131);
    return merge(
      box({ w: 1.1, h: 0.04, d: 1.1, color: "#2a2522", offset: { y: 0.02 } }),
      ...Array.from({ length: 8 }, (_, n) => {
        const a = n * Math.PI / 4 + (rand() - 0.5) * 0.3, h = 0.2 + rand() * 0.12;
        return turn(box({ w: 0.28 + rand() * 0.1, h, d: 0.24 + rand() * 0.1, color: STONE[n % 3], offset: { x: 0.7, y: h * 0.5 } }), a, 0);
      }),
      ...Array.from({ length: 3 }, (_, n) => turn(box({ w: 0.9, h: 0.14, d: 0.14, color: WOOD_DK, offset: { y: 0.12 + n * 0.05 } }), n * Math.PI / 3, 0.18))
    );
  });
  const FLAME = [[0.34, 0.3, 0.22, 0, 0, "#ff9a2e"], [0.26, 0.22, 0.44, 0.02, -0.02, "#ffc148"], [0.2, 0.18, 0.6, 0.06, 0.03, "#ffc148"], [0.16, 0.14, 0.72, 0.03, 0.05, "#fff0b0"], [0.12, 0.12, 0.84, -0.01, 0.02, "#fff0b0"], [0.14, 0.16, 0.36, -0.16, 0.04, "#ffc148"], [0.12, 0.14, 0.5, 0.17, 0.1, "#ff9a2e"]];
  const fireFlame = cached(() => noShadow(merge(...FLAME.map(([w, h, y, x, z, color]) => box({ w, h, d: w, color, emissive: 1, offset: { x, y, z } })))));
  const WINGS = [["#f2c94c", "#e04a3a"], ["#f3efe4", "#6f9fca"]];
  const butterfly = variants((i) => {
    const [wing, spot] = WINGS[i];
    return noShadow(merge(
      box({ w: 0.02, h: 0.02, d: 0.08, color: "#2b2521" }),
      ...[-1, 1].flatMap((side) => [
        turn(box({ w: 0.1, h: 0.01, d: 0.07, color: wing, offset: { x: side * 0.05 } }), 0, side * 0.61),
        turn(box({ w: 0.04, h: 0.012, d: 0.03, color: spot, offset: { x: side * 0.065, z: 0.01 } }), 0, side * 0.61)
      ])
    ));
  });
  const firefly = cached(() => noShadow(box({ w: 0.06, h: 0.06, d: 0.06, color: "#d9ff6a", emissive: 1 })));
  const ember = cached(() => noShadow(box({ w: 0.05, h: 0.05, d: 0.05, color: "#ff8a2a", emissive: 1 })));
  // Three leaf strands, about 1.2 wide
  const vine = cached(() => {
    const rand = mulberry32(53);
    const leaves = [];
    [[-0.42, 5], [0.02, 4], [0.44, 3]].forEach(([x, count]) => {
      for (let n = 0; n < count; n++) leaves.push(box({ w: 0.26, h: 0.34, d: 0.18, color: n % 2 ? "#3e7a2c" : "#4f8a3d", offset: { x: x + (rand() - 0.5) * 0.08, y: -0.17 - n * 0.34 } }));
    });
    const geo = merge(...leaves);
    geo.castShadow = false;
    return geo;
  });
  // Flat cloud blobs from overlapping puffs
  const CLOUD_PUFFS = [
    [[0, 3, 2.6], [3, 4.5, 2]],
    [[-2, 3.4, 3], [2.5, 4.4, 2.6], [6, 3, 2.2]],
    [[-4, 3.6, 3.2], [0, 5, 3.6], [4, 4.4, 3], [7.5, 3, 2.4]]
  ];
  const cloud = variants((i) => {
    const rand = mulberry32(307 + i);
    const v = vox();
    const puffs = CLOUD_PUFFS[i];
    const mid = (puffs[0][0] + puffs[puffs.length - 1][0]) / 2;
    for (const [cx, rx, rz] of puffs) blob(v, { cx: cx - mid + 0.5, cy: 1, cz: 0.5, rx, ry: 1.6, rz, chip: 0.3, rand, color: (x, y) => y > 0 ? 0 : 1 });
    const geo = voxGeo(v, { unit: VOX, palette: ["#f7f9fb", "#dfe6ee"], origin: { x: -VOX / 2, y: -VOX, z: -VOX / 2 } });
    geo.castShadow = false;
    return geo;
  });
  const ladder = cached(() => merge(
    box({ w: 0.1, h: 4, d: 0.1, color: WOOD, offset: { x: -0.4, y: 2 } }),
    box({ w: 0.1, h: 4, d: 0.1, color: WOOD, offset: { x: 0.4, y: 2 } }),
    ...Array.from({ length: 9 }, (_, n) => box({ w: 0.9, h: 0.08, d: 0.08, color: "#7a5630", offset: { y: 0.35 + n * 0.42 } }))
  ));
  const dock = cached(() => merge(
    ...Array.from({ length: 8 }, (_, n) => box({ w: 0.46, h: 0.1, d: 2, color: n % 2 ? "#8f6538" : "#9c7040", offset: { x: 0.25 + n * 0.5, y: -0.05 } })),
    box({ w: 4, h: 0.14, d: 0.16, color: WOOD_DK, offset: { x: 2, y: -0.17, z: -0.92 } }),
    box({ w: 4, h: 0.14, d: 0.16, color: WOOD_DK, offset: { x: 2, y: -0.17, z: 0.92 } }),
    ...[[0.5, -0.8], [0.5, 0.8], [3.5, -0.8], [3.5, 0.8]].map(([x, z]) => box({ w: 0.2, h: 2.2, d: 0.2, color: "#6b4a2b", offset: { x, y: -1.2, z } }))
  ));
  BL.hubModels = { SIGN_GLYPHS, jetpack, jetFlame, caveMouthRim, mirrorPanel, matrixGlyph, caveSign, CAVE_SIGN_WIDTH, CAVE_SIGN_HEIGHT, gate, caveShelves, bedroll, tree, bush, rock, altarSlab, altarBlock, woodCrate, barrel, flowerTuft, torch, grass, lantern, firepit, fireFlame, butterfly, firefly, ember, vine, cloud, ladder, dock, TREE_HEIGHT };
})();
