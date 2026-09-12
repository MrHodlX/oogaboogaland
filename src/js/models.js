(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { hexToRgb, damp } = BL.math;
  const { createNode, addChild } = BL.scene;
  const geometry = () => ({ verts: [], faces: [], lines: [] });
  const pushVert = (geo, x, y, z) => {
    geo.verts.push(x, y, z);
    return geo.verts.length / 3 - 1;
  };
  const face = (geo, indices, color, { emissive = 0 } = {}) => {
    geo.faces.push({ i: indices, color, emissive });
  };
  const box = ({ w = 1, h = 1, d = 1, color, emissive = 0, offset = {} } = {}) => {
    const geo = geometry();
    const ox = offset.x || 0, oy = offset.y || 0, oz = offset.z || 0;
    const px = w / 2, py = h / 2, pz = d / 2;
    const c = [
      [-px, -py, -pz],
      [px, -py, -pz],
      [px, py, -pz],
      [-px, py, -pz],
      [-px, -py, pz],
      [px, -py, pz],
      [px, py, pz],
      [-px, py, pz]
    ].map(([x, y, z]) => pushVert(geo, x + ox, y + oy, z + oz));
    const rgb = hexToRgb(color);
    const opts = { emissive };
    face(geo, [c[4], c[5], c[6], c[7]], rgb, opts);
    face(geo, [c[1], c[0], c[3], c[2]], rgb, opts);
    face(geo, [c[5], c[1], c[2], c[6]], rgb, opts);
    face(geo, [c[0], c[4], c[7], c[3]], rgb, opts);
    face(geo, [c[3], c[7], c[6], c[2]], rgb, opts);
    face(geo, [c[0], c[1], c[5], c[4]], rgb, opts);
    return geo;
  };
  const panel = ({ w = 1, h = 1, tilesX = 4, tilesY = 4, color, altColor, emissive = 0 } = {}) => {
    const geo = geometry();
    const rgb = hexToRgb(color);
    const alt = altColor ? hexToRgb(altColor) : rgb;
    const grid = [];
    for (let ty = 0; ty <= tilesY; ty++) {
      const row = [];
      for (let tx = 0; tx <= tilesX; tx++) {
        row.push(pushVert(geo, (tx / tilesX - 0.5) * w, (ty / tilesY - 0.5) * h, 0));
      }
      grid.push(row);
    }
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        face(geo, [grid[ty][tx], grid[ty][tx + 1], grid[ty + 1][tx + 1], grid[ty + 1][tx]], (tx + ty) % 2 ? alt : rgb, { emissive });
      }
    }
    return geo;
  };
  const lathe = ({ profile, segments = 8, color, emissive = 0 } = {}) => {
    const geo = geometry();
    const rgb = typeof color === "string" ? hexToRgb(color) : null;
    const rings = profile.map(([r, y]) => {
      const ring = [];
      for (let s = 0; s < segments; s++) {
        const a = s / segments * Math.PI * 2;
        ring.push(pushVert(geo, Math.cos(a) * r, y, Math.sin(a) * r));
      }
      return ring;
    });
    for (let p = 0; p < rings.length - 1; p++) {
      const t = p / (rings.length - 1);
      const c = rgb || hexToRgb(color(t));
      for (let s = 0; s < segments; s++) {
        const s2 = (s + 1) % segments;
        face(geo, [rings[p][s], rings[p + 1][s], rings[p + 1][s2], rings[p][s2]], c, { emissive });
      }
    }
    return geo;
  };
  const tube = ({ path, radius, rings = 8, segments = 6, colorFn, emissive = 0 } = {}) => {
    const geo = geometry();
    const ringIdx = [];
    for (let p = 0; p <= rings; p++) {
      const t = p / rings;
      const center = path(t);
      const ahead = path(Math.min(1, t + 0.01));
      const behind = path(Math.max(0, t - 0.01));
      let tx = ahead.x - behind.x, ty = ahead.y - behind.y, tz = ahead.z - behind.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      let nx = ty, ny = -tx, nz = 0;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      const r = radius(t);
      const ring = [];
      for (let s = 0; s < segments; s++) {
        const a = s / segments * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        ring.push(pushVert(geo, center.x + (nx * ca + bx * sa) * r, center.y + (ny * ca + by * sa) * r, center.z + (nz * ca + bz * sa) * r));
      }
      ringIdx.push(ring);
    }
    for (let p = 0; p < rings; p++) {
      const c = hexToRgb(colorFn(p / rings));
      for (let s = 0; s < segments; s++) {
        const s2 = (s + 1) % segments;
        face(geo, [ringIdx[p][s], ringIdx[p][s2], ringIdx[p + 1][s2], ringIdx[p + 1][s]], c, { emissive });
      }
    }
    return geo;
  };
  const ring = ({ r = 0.3, thickness = 0.05, y = 0, segments = 12, color, emissive = 0 } = {}) => lathe({
    profile: [[r - thickness, y - thickness], [r + thickness, y - thickness], [r + thickness, y + thickness], [r - thickness, y + thickness], [r - thickness, y - thickness]],
    segments,
    color,
    emissive
  });
  const polyline = ({ points, color, emissive = 0.8, closed = false } = {}) => {
    const geo = geometry();
    const rgb = hexToRgb(color);
    const idx = points.map((p) => pushVert(geo, p.x, p.y, p.z));
    const count = closed ? idx.length : idx.length - 1;
    for (let i = 0; i < count; i++) geo.lines.push({ i: [idx[i], idx[(i + 1) % idx.length]], color: rgb, emissive });
    return geo;
  };
  const merge = (...geos) => {
    const out = geometry();
    for (const geo of geos) {
      const shift = out.verts.length / 3;
      out.verts.push(...geo.verts);
      for (const f of geo.faces) out.faces.push({ ...f, i: f.i.map((i) => i + shift) });
      for (const l of geo.lines) out.lines.push({ ...l, i: l.i.map((i) => i + shift) });
    }
    return out;
  };
  const makeVox = () => {
    const map = new Map();
    const key = (x, y, z) => x + "," + y + "," + z;
    return {
      map,
      has: (x, y, z) => map.has(key(x, y, z)),
      get: (x, y, z) => map.get(key(x, y, z)),
      set: (x, y, z, c) => map.set(key(x, y, z), c),
      del: (x, y, z) => map.delete(key(x, y, z)),
      fill(x0, x1, y0, y1, z0, z1, c) {
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            for (let z = z0; z <= z1; z++) {
              const value = typeof c === "function" ? c(x, y, z) : c;
              if (value != null) map.set(key(x, y, z), value);
            }
          }
        }
      }
    };
  };
  // Exposed voxel faces as run-merged quads
  const voxelFaces = (iterate, has, emit) => {
    const F = { py: [], ny: [], px: [], nx: [], pz: [], nz: [] };
    iterate((x, y, z, c) => {
      if (!has(x, y + 1, z)) F.py.push({ a: y, b: z, r: x, c });
      if (!has(x, y - 1, z)) F.ny.push({ a: y, b: z, r: x, c });
      if (!has(x + 1, y, z)) F.px.push({ a: x, b: y, r: z, c });
      if (!has(x - 1, y, z)) F.nx.push({ a: x, b: y, r: z, c });
      if (!has(x, y, z + 1)) F.pz.push({ a: z, b: y, r: x, c });
      if (!has(x, y, z - 1)) F.nz.push({ a: z, b: y, r: x, c });
    });
    const mergeEmit = (list, quad) => {
      list.sort((p, q) => p.a - q.a || p.b - q.b || p.r - q.r);
      for (let i = 0; i < list.length;) {
        let j = i + 1;
        while (j < list.length && list[j].a === list[i].a && list[j].b === list[i].b && list[j].r === list[j - 1].r + 1 && list[j].c === list[i].c) j++;
        quad(list[i], list[j - 1].r);
        i = j;
      }
    };
    mergeEmit(F.py, (f, r1) => emit([[f.r, f.a + 1, f.b], [f.r, f.a + 1, f.b + 1], [r1 + 1, f.a + 1, f.b + 1], [r1 + 1, f.a + 1, f.b]], f.c));
    mergeEmit(F.ny, (f, r1) => emit([[f.r, f.a, f.b], [r1 + 1, f.a, f.b], [r1 + 1, f.a, f.b + 1], [f.r, f.a, f.b + 1]], f.c));
    mergeEmit(F.px, (f, r1) => emit([[f.a + 1, f.b, f.r], [f.a + 1, f.b + 1, f.r], [f.a + 1, f.b + 1, r1 + 1], [f.a + 1, f.b, r1 + 1]], f.c));
    mergeEmit(F.nx, (f, r1) => emit([[f.a, f.b, f.r], [f.a, f.b, r1 + 1], [f.a, f.b + 1, r1 + 1], [f.a, f.b + 1, f.r]], f.c));
    mergeEmit(F.pz, (f, r1) => emit([[f.r, f.b, f.a + 1], [r1 + 1, f.b, f.a + 1], [r1 + 1, f.b + 1, f.a + 1], [f.r, f.b + 1, f.a + 1]], f.c));
    mergeEmit(F.nz, (f, r1) => emit([[f.r, f.b, f.a], [f.r, f.b + 1, f.a], [r1 + 1, f.b + 1, f.a], [r1 + 1, f.b, f.a]], f.c));
  };
  const voxelGeometry = (vox, { unit, palette, origin = { x: 0, y: 0, z: 0 }, emissive = {} }) => {
    const geo = geometry();
    const emit = (pts, c) => {
      face(geo, pts.map(([x, y, z]) => pushVert(geo, origin.x + x * unit, origin.y + y * unit, origin.z + z * unit)), palette[c], { emissive: emissive[c] || 0 });
    };
    voxelFaces((fn) => {
      for (const [k, c] of vox.map) {
        const [x, y, z] = k.split(",").map(Number);
        fn(x, y, z, c);
      }
    }, vox.has, emit);
    return geo;
  };
  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const shade = (hex, k) => hexToRgb(hex).map((v) => clamp255(v * k));
  const mixRgb = (a, b, t) => a.map((v, i) => clamp255(v + (b[i] - v) * t));
  const cached = (build) => {
    let value = null;
    return () => value || (value = build());
  };
  const BANANA_AMMO_SCALE = 0.34;
  // A full-shouldered loose heap encloses the dead space between curved bananas
  // without returning to the old pointed silhouette.
  const BANANA_PILE_PROFILE = [[1, 0], [0.98, 0.11], [0.9, 0.31], [0.72, 0.53], [0.5, 0.7], [0.28, 0.82], [0.1, 0.87], [0, 0.88]];
  const bananaPileRadiusScale = (angle, radius) => {
    // Keep the foot of the mound circular, then blend in the lumpy silhouette above it.
    const fade = Math.min(1, Math.max(0, (1 - radius) / 0.18));
    return 1 + fade * (-0.025
      + Math.sin(angle * 3 + radius * 5.7 + 0.4) * 0.012
      + Math.sin(angle * 5 - radius * 8.3 + 1.7) * 0.008
      + Math.sin(angle * 9 + radius * 13.1) * 0.004);
  };
  const bananaPileHeightOffset = (angle, radius) => {
    const fade = radius * (1 - radius) * 4;
    return fade * (Math.sin(angle * 2 + radius * 4.1) * 0.018
      + Math.sin(angle * 6 - radius * 7.3 + 0.8) * 0.009
      + Math.sin(angle * 11 + radius * 15.7) * 0.004);
  };
  const bananaGeometry = cached(() => tube({
    rings: 8,
    segments: 5,
    path: (t) => {
      const a = (t - 0.5) * 2;
      return { x: Math.sin(a) * 0.55, y: (1 - Math.cos(a)) * 0.55 + 0.1, z: 0 };
    },
    radius: (t) => 0.085 * Math.pow(Math.sin(Math.PI * t), 0.55) + 0.012,
    colorFn: (t) => t < 0.08 || t > 0.92 ? "#5a3a1a" : t < 0.2 || t > 0.8 ? "#c9b23a" : "#f5c542"
  }));
  const banana = () => createNode({ geometry: bananaGeometry() });
  // A centered copy for the pile skin. It has the full depth and dimensions of a
  // carried banana, while its origin lets it sit evenly across the mound surface.
  const bananaTileGeometry = cached(() => tube({
    rings: 8,
    segments: 5,
    path: (t) => {
      const a = (t - 0.5) * 2;
      return { x: Math.sin(a) * 0.55, y: (1 - Math.cos(a)) * 0.55 - 0.075, z: 0 };
    },
    radius: (t) => 0.085 * Math.pow(Math.sin(Math.PI * t), 0.55) + 0.012,
    colorFn: (t) => t < 0.08 || t > 0.92 ? "#5a3a1a" : t < 0.2 || t > 0.8 ? "#c9b23a" : "#f5c542"
  }));
  const bananaPileCoreGeometry = (worldRadius = 0.45, worldHeight = 0.48, faceSize = 0.16) => {
    const geo = geometry();
    const segments = Math.max(24, Math.min(384, Math.ceil(Math.PI * 2 * worldRadius / faceSize)));
    const profile = [];
    for (let i = 0; i < BANANA_PILE_PROFILE.length - 1; i++) {
      const outer = BANANA_PILE_PROFILE[i], inner = BANANA_PILE_PROFILE[i + 1];
      const length = Math.hypot((outer[0] - inner[0]) * worldRadius, (outer[1] - inner[1]) * worldHeight);
      const steps = Math.max(1, Math.ceil(length / faceSize));
      for (let step = 0; step < steps; step++) {
        const t = step / steps;
        profile.push([outer[0] + (inner[0] - outer[0]) * t, outer[1] + (inner[1] - outer[1]) * t]);
      }
    }
    // Golden panels keep any backing visible between shell bananas part of the pile.
    const colors = ["#c9a21d", "#ddb72b", "#b98f14", "#e5c13a", "#d1aa22"].map(hexToRgb);
    const rings = profile.map(([radius, y], ringIndex) => {
      const ring = [];
      for (let segment = 0; segment < segments; segment++) {
        const angle = segment / segments * Math.PI * 2;
        const warpedRadius = radius * bananaPileRadiusScale(angle, radius);
        const warpedY = y + bananaPileHeightOffset(angle, radius);
        ring.push(pushVert(geo, Math.cos(angle) * warpedRadius, warpedY, Math.sin(angle) * warpedRadius));
      }
      return ring;
    });
    for (let ring = 0; ring < rings.length - 1; ring++) {
      for (let segment = 0; segment < segments; segment++) {
        const next = (segment + 1) % segments;
        const shadeIndex = Math.floor(Math.abs(Math.sin((segment + 1) * 12.9898 + (ring + 1) * 78.233)) * colors.length) % colors.length;
        face(geo, [rings[ring][segment], rings[ring + 1][segment], rings[ring + 1][next], rings[ring][next]], colors[shadeIndex]);
      }
    }
    const top = pushVert(geo, 0, BANANA_PILE_PROFILE[BANANA_PILE_PROFILE.length - 1][1], 0);
    const last = rings[rings.length - 1];
    for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments;
      face(geo, [last[segment], top, last[next]], colors[(segment + 3) % colors.length]);
    }
    geo.pileSegments = segments;
    geo.pileRings = rings.length;
    geo.pileFaceSize = faceSize;
    return geo;
  };
  const particleCache = new Map();
  const particleGeometry = (color, size = 0.07, emissive = 1) => {
    const key = `${color}/${size}/${emissive}`;
    let geo = particleCache.get(key);
    if (!geo) {
      geo = box({ w: size, h: size, d: size, color, emissive });
      geo.castShadow = false;
      particleCache.set(key, geo);
    }
    return geo;
  };
  // Weapons, club in voxels and rifle in boxes
  const clubVoxels = (rand) => {
    const v = makeVox();
    const woodJ = () => rand() < 0.2 ? 1 : 0;
    // Handle at the bottom, heavy head on top
    v.fill(0, 1, 0, 4, 0, 1, woodJ);
    v.fill(-1, 2, 5, 7, -1, 2, woodJ);
    v.fill(-1, 2, 8, 10, -1, 2, woodJ);
    for (const [cx, cz] of [[-1, -1], [-1, 2], [2, -1], [2, 2]]) v.del(cx, 10, cz);
    return v;
  };
  const CLUB_PALETTE = [hexToRgb("#5c4425"), hexToRgb("#3f2e18")];
  const GOLD_CLUB_PALETTE = [hexToRgb("#e0b53a"), hexToRgb("#c99a2e")];
  const GUN_PALETTE = { body: "#3a3a3a", stock: "#5c4425", barrel: "#2b2b2b", emissive: 0 };
  const GOLD_GUN_PALETTE = { body: "#e0b53a", stock: "#5c4425", barrel: "#f0c95a", emissive: 0.25 };
  const gunGeometry = (h, pal) => merge(
    box({ w: 0.11 * h, h: 0.13 * h, d: 0.55 * h, color: pal.body, emissive: pal.emissive, offset: { z: 0.02 * h } }),
    box({ w: 0.09 * h, h: 0.12 * h, d: 0.24 * h, color: pal.stock, offset: { z: -0.32 * h, y: 0.01 * h } }),
    box({ w: 0.05 * h, h: 0.05 * h, d: 0.36 * h, color: pal.barrel, emissive: pal.emissive, offset: { z: 0.46 * h, y: 0.03 * h } }),
    box({ w: 0.06 * h, h: 0.14 * h, d: 0.08 * h, color: pal.stock, offset: { y: -0.12 * h, z: -0.08 * h } })
  );
  // Re-axis a lathe to +Z, reversing the winding
  const forward = (geo, { x = 0, y = 0, z = 0 } = {}) => {
    const out = geometry();
    for (let v = 0; v < geo.verts.length; v += 3) out.verts.push(x + geo.verts[v], y + geo.verts[v + 2], z + geo.verts[v + 1]);
    out.faces = geo.faces.map((f) => ({ ...f, i: [...f.i].reverse() }));
    return out;
  };
  // Gas mask hood, snout, filter, lenses and strap
  const gasMaskGeometry = cached(() => {
    const shell = "#3a3d35", trim = "#2a2d27", metal = "#5b6066";
    const hood = lathe({ profile: [[0.29, -0.06], [0.31, 0.1], [0.31, 0.3], [0.28, 0.46], [0.2, 0.58], [0.08, 0.66], [0, 0.68]], segments: 14, color: shell });
    const snout = forward(lathe({ profile: [[0.17, 0], [0.16, 0.06], [0.13, 0.13], [0.11, 0.16]], segments: 12, color: shell }), { y: 0.1, z: 0.24 });
    const filter = forward(lathe({ profile: [[0, 0], [0.12, 0], [0.13, 0.05], [0.1, 0.07], [0, 0.07]], segments: 12, color: metal }), { y: 0.1, z: 0.39 });
    const lens = (x) => merge(
      forward(lathe({ profile: [[0.06, 0], [0.09, 0], [0.095, 0.03], [0.06, 0.03]], segments: 12, color: metal }), { x, y: 0.22, z: 0.28 }),
      forward(lathe({ profile: [[0, 0], [0.065, 0], [0.065, 0.005], [0, 0.005]], segments: 12, color: "#ff2a1e", emissive: 1 }), { x, y: 0.22, z: 0.31 })
    );
    // Breathing tubes, one each side of the snout
    const tube = (x) => forward(lathe({ profile: [[0.03, 0], [0.038, 0.02], [0.038, 0.11], [0.03, 0.13], [0, 0.13]], segments: 10, color: metal }), { x, y: 0.09, z: 0.2 });
    // A centre hole ringed by six, proud of the disc
    const holes = [[0, 0], ...[0, 1, 2, 3, 4, 5].map((i) => [Math.cos(i / 6 * Math.PI * 2) * 0.065, Math.sin(i / 6 * Math.PI * 2) * 0.065])]
      .map(([hx, hy]) => box({ w: 0.03, h: 0.03, d: 0.008, color: "#0f1113", offset: { x: hx, y: 0.1 + hy, z: 0.463 } }));
    return merge(hood, snout, filter, ...holes, lens(-0.12), lens(0.12), tube(-0.21), tube(0.21), ring({ r: 0.315, thickness: 0.02, y: 0.4, segments: 14, color: trim }));
  });
  // A tall crook staff in the club's grip: shaft from the ground past the shoulder, knots along it, curled head
  const staffVoxels = (rand) => {
    const v = makeVox();
    const woodJ = () => rand() < 0.2 ? 1 : 0;
    v.fill(0, 0, -2, 15, 0, 0, woodJ);
    for (const y of [3, 8, 12]) v.set(rand() < 0.5 ? -1 : 1, y, 0, 1);
    for (const [y, z] of [[16, 0], [17, 1], [17, 2], [16, 3], [15, 3]]) v.set(0, y, z, woodJ());
    return v;
  };
  const LION_PALETTE = [hexToRgb("#d4a04a"), hexToRgb("#bd8b38"), hexToRgb("#a5602a"), hexToRgb("#7d4520"), hexToRgb("#ecc98a"), hexToRgb("#141414")];
  // A lion carried under the arm: body hanging, hind legs and tail dangling, front paws draped forward, maned head up
  const lionVoxels = (rand) => {
    const v = makeVox();
    const L = { fur: 0, furDk: 1, mane: 2, maneDk: 3, belly: 4, black: 5 };
    const fur = () => rand() < 0.15 ? L.furDk : L.fur;
    const mane = () => rand() < 0.35 ? L.maneDk : L.mane;
    v.fill(0, 3, 0, 5, 0, 3, fur);
    v.fill(1, 2, 0, 4, 3, 3, L.belly);
    // Mane: a ring framing the face, a ruff under the chin, a shag down the back
    v.fill(-1, 4, 6, 10, 1, 5, (x, y, z) => (x === -1 || x === 4) && (y === 6 || y === 10) ? null : x === -1 || x === 4 || y === 6 || y === 10 || z === 1 ? mane() : null);
    v.fill(0, 3, 7, 9, 2, 5, fur);
    v.fill(1, 2, 7, 7, 5, 6, L.belly);
    v.fill(1, 2, 8, 8, 5, 5, L.maneDk);
    v.set(0, 9, 5, L.black);
    v.set(3, 9, 5, L.black);
    v.set(0, 11, 2, L.fur);
    v.set(3, 11, 2, L.fur);
    for (const x of [0, 3]) {
      v.fill(x, x, 3, 4, 4, 6, fur);
      v.fill(x, x, 1, 2, 6, 6, fur);
      v.fill(x, x, -3, -1, 1, 2, fur);
      v.fill(x, x, -3, -3, 3, 3, fur);
    }
    v.fill(2, 2, -5, -1, -1, -1, fur);
    v.set(2, -6, -1, L.maneDk);
    return v;
  };
  // A deck slung across the back, wheels out
  const skateboardGeometry = (h) => merge(
    box({ w: 0.22 * h, h: 0.8 * h, d: 0.03 * h, color: "#7cc242" }),
    box({ w: 0.2 * h, h: 0.08 * h, d: 0.03 * h, color: "#f7931a", offset: { z: -0.006 * h } }),
    ...[-0.28, 0.28].map((y) => box({ w: 0.2 * h, h: 0.03 * h, d: 0.045 * h, color: "#8a8a8a", offset: { y: y * h, z: -0.03 * h } })),
    ...[-0.28, 0.28].flatMap((y) => [-0.085, 0.085].map((x) => box({ w: 0.06 * h, h: 0.06 * h, d: 0.05 * h, color: "#1a1a1a", offset: { x: x * h, y: y * h, z: -0.07 * h } })))
  );
  const caveman = (traits) => {
    const { skin, hair, height: h, belly, rand } = traits;
    const u = h / 16;
    const P = { skin: 0, skinDk: 1, hair: 2, hairDk: 3, fur: 4, spot: 5, white: 6, black: 7, nose: 8, stubble: 9, wood: 10, stone: 11, stoneDk: 12, apple: 13, appleDk: 14, leaf: 15, knit: 16, knitDk: 17, pom: 18, lens: 19, btc: 20, gold: 21, goldDk: 22, wing: 23, wingDk: 24, goggle: 25, goggleDk: 26 };
    const palette = [
      shade(skin, 1),
      shade(skin, 0.9),
      shade(hair, 1),
      shade(hair, 0.85),
      shade(traits.fur, 1),
      hexToRgb("#4a2f16"),
      hexToRgb("#f2efe4"),
      hexToRgb("#141414"),
      shade(skin, 1.18),
      mixRgb(shade(skin, 1), [201, 194, 178], 0.55),
      hexToRgb("#5c4425"),
      hexToRgb("#7a7a7a"),
      hexToRgb("#565656"),
      hexToRgb("#c8342a"),
      hexToRgb("#8f231b"),
      hexToRgb("#4f8a3d"),
      hexToRgb("#8cc63f"),
      hexToRgb("#6faa2f"),
      hexToRgb("#a9d94c"),
      hexToRgb("#3f9c96"),
      hexToRgb("#f7931a"),
      hexToRgb("#d4a83a"),
      hexToRgb("#9c7a22"),
      hexToRgb("#e4f3fb"),
      hexToRgb("#bcdcec"),
      hexToRgb("#3a9dff"),
      hexToRgb("#1f6fc4")
    ];
    const jit = (base, dark, p) => () => rand() < p ? dark : base;
    const skinJ = jit(P.skin, P.skinDk, 0.08);
    const hairJ = jit(P.hair, P.hairDk, 0.12);
    const leopard = jit(P.fur, P.spot, 0.05);
    const rosettes = (v, x0, x1, y0, y1, z0, z1, count) => {
      for (let i = 0; i < count; i++) {
        const x = x0 + Math.floor(rand() * (x1 - x0 + 1));
        const y = y0 + Math.floor(rand() * (y1 - y0 + 1));
        const z = z0 + Math.floor(rand() * (z1 - z0 + 1));
        if (v.get(x, y, z) === P.fur) v.set(x, y, z, P.spot);
        const nx = x + (rand() < 0.5 ? 1 : -1);
        if (v.get(nx, y, z) === P.fur) v.set(nx, y, z, P.spot);
      }
    };
    const vg = (v, origin, emissive) => voxelGeometry(v, { unit: u, palette, origin, emissive });
    const parts = {};
    const legH = 5 * u;
    const root = createNode({ position: { x: 0, y: legH, z: 0 } });
    const legVox = () => {
      const v = makeVox();
      v.fill(0, 3, 2, 4, 0, 3, skinJ);
      v.fill(0, 3, 0, 1, 0, 5, skinJ);
      v.set(0, 0, 6, P.skin);
      v.set(2, 0, 6, P.skin);
      return v;
    };
    const leg = (side) => createNode({ position: { x: side * 2.5 * u, y: 0, z: 0 }, geometry: vg(legVox(), { x: -2 * u, y: -5 * u, z: -2.5 * u }) });
    parts.legL = leg(-1);
    parts.legR = leg(1);
    const torsoVox = () => {
      const v = makeVox();
      if (traits.slim) {
        v.fill(0, 8, 0, 2, 0, 5, leopard);
        v.fill(1, 7, 3, 7, 1, 4, leopard);
        rosettes(v, 0, 8, 0, 7, 0, 5, 12);
      } else {
        v.fill(0, 8, 0, 2, 0, 5, leopard);
        rosettes(v, 0, 8, 0, 2, 0, 5, 8);
        v.fill(1, 7, 3, 7, 1, 4, skinJ);
      }
      if (traits.bee) {
        // The Bee: black bands round the fuzz and two pale wings folded off the back, baked into the torso
        v.fill(1, 7, 4, 4, 1, 4, P.black);
        v.fill(1, 7, 6, 6, 1, 4, P.black);
        const vein = jit(P.wing, P.wingDk, 0.3);
        for (const cx of [0.5, 7.5]) v.fill(-2, 10, 2, 10, -1, -1, (x, y) => ((x - cx) / 2.6) ** 2 + ((y - 6.5) / 4) ** 2 <= 1 ? vein() : null);
      }
      for (let x = 0; x <= 8; x++) for (let z = 0; z <= 5; z++) if (rand() < 0.18) v.del(x, 0, z);
      return v;
    };
    parts.torso = createNode({ scale: { x: belly, y: 1, z: belly }, geometry: vg(torsoVox(), { x: -4.5 * u, y: 0, z: -3 * u }) });
    const armVox = () => {
      const v = makeVox();
      v.fill(0, 2, 2, 7, 0, 2, skinJ);
      if (traits.slim) {
        v.fill(0, 2, 8, 10, 0, 2, leopard);
        rosettes(v, 0, 2, 8, 10, 0, 2, 2);
      } else {
        v.fill(-1, 3, 8, 10, -1, 3, skinJ);
      }
      v.fill(-1, 3, 0, 1, -1, 3, skinJ);
      v.set(0, 1, 4, P.skin);
      v.set(2, 1, 4, P.skin);
      return v;
    };
    const armX = 0.29 * h * belly + 0.09 * h;
    const arm = (side) => createNode({
      position: { x: side * armX, y: 0.46 * h, z: 0 },
      rotation: { x: -0.2, y: 0, z: side * 0.1 },
      geometry: vg(armVox(), { x: -1.5 * u, y: -11 * u, z: -1.5 * u })
    });
    parts.armL = arm(-1);
    parts.armR = arm(1);
    // Two finishes of one model, default and gold
    const clubV = traits.anunnaki ? staffVoxels(rand) : clubVoxels(rand);
    const clubOrigin = { x: -1 * u, y: -1 * u, z: -1 * u };
    const skins = {
      club: { default: voxelGeometry(clubV, { unit: u, palette: CLUB_PALETTE, origin: clubOrigin }), gold: voxelGeometry(clubV, { unit: u, palette: GOLD_CLUB_PALETTE, origin: clubOrigin }) },
      gun: { default: gunGeometry(h, GUN_PALETTE), gold: gunGeometry(h, GOLD_GUN_PALETTE) }
    };
    // The staff stands upright in the grip; the club hangs forward
    parts.club = createNode({
      position: { x: 0, y: -0.62 * h, z: 0.08 * h },
      rotation: { x: traits.anunnaki ? 0.2 : 0.95, y: 0, z: 0 },
      geometry: skins.club.default
    });
    addChild(parts.armL, parts.club);
    parts.snack = createNode({
      position: { x: 0, y: -0.62 * h, z: 0.18 * h },
      scale: { x: BANANA_AMMO_SCALE, y: BANANA_AMMO_SCALE, z: BANANA_AMMO_SCALE },
      rotation: { x: 0.4, y: 0, z: 1.2 },
      geometry: bananaGeometry(),
      visible: false
    });
    addChild(parts.armR, parts.snack);
    parts.gun = createNode({ position: { x: 0, y: -0.6 * h, z: 0.17 * h }, rotation: { x: Math.PI / 2, y: 0, z: 0 }, visible: false });
    parts.gunBody = createNode({ geometry: skins.gun.default });
    addChild(parts.gun, parts.gunBody);
    addChild(parts.armR, parts.gun);
    const headVox = makeVox();
    const eyeCells = [];
    {
      const v = headVox;
      if (traits.apple) {
        const appleJ = jit(P.apple, P.appleDk, 0.14);
        v.fill(-1, 7, 0, 7, -1, 5, appleJ);
        for (let x = -1; x <= 7; x++) {
          for (let z = -1; z <= 5; z++) {
            const rim = x === -1 || x === 7 || z === -1 || z === 5;
            if (rim) v.del(x, 7, z);
            if (x === -1 || x === 7 || z === -1) v.del(x, 0, z);
          }
        }
        v.fill(1, 5, 0, 1, 6, 6, appleJ);
        v.set(3, 8, 2, P.wood);
        v.set(3, 9, 2, P.wood);
        v.set(4, 9, 2, P.leaf);
      } else {
        v.fill(0, 6, 0, 5, 0, 5, skinJ);
        v.fill(1, 5, 0, 1, 6, 6, skinJ);
      }
      if (traits.gasMask) {
        // Nose, beard and mouth sit under the mask
      } else if (traits.slim) {
        v.fill(3, 3, 2, 3, 6, 6, P.nose);
      } else if (traits.skater || traits.bee) {
        // Clean-shaven under the shades: a low nose and a smirk
        v.set(3, 1, 6, P.nose);
        v.fill(2, 4, 0, 0, 6, 6, P.spot);
      } else {
        v.fill(0, 6, 0, 1, 5, 7, jit(P.hair, P.stubble, 0.25));
        v.fill(1, 5, -2, -1, 5, 7, (x, y) => y === -2 && rand() < 0.35 ? null : rand() < 0.15 ? P.hairDk : P.hair);
        v.set(1, 0, 7, P.white);
        v.set(5, 0, 7, P.white);
        v.fill(2, 4, 2, 3, 6, 7, jit(traits.apple ? P.appleDk : P.nose, traits.apple ? P.apple : P.skin, 0.25));
      }
      if (!traits.gasMask && !traits.skater && !traits.bee) v.fill(0, 6, 4, 4, 6, 6, hairJ);
      const hairy = !traits.bald && !traits.apple && !traits.gasMask && !traits.anunnaki && !traits.skater && !traits.bee;
      if (hairy) {
        v.fill(-1, 7, 6, 8, -1, 6, hairJ);
        v.fill(-1, 7, traits.slim ? -5 : -2, 5, -2, -1, hairJ);
        v.fill(-1, -1, traits.slim ? -3 : 2, 5, -1, 4, hairJ);
        v.fill(7, 7, traits.slim ? -3 : 2, 5, -1, 4, hairJ);
      }
      if (traits.anunnaki) {
        // The Anunnaki: a gold banded cap over the brow, hair curling down the back and sides, a full beard to the chest
        const curl = (x, y, z) => (x + y + z) % 2 ? P.hairDk : P.hair;
        v.fill(-1, 7, -4, 5, -2, -1, curl);
        v.fill(-1, -1, -4, 5, 0, 2, curl);
        v.fill(7, 7, -4, 5, 0, 2, curl);
        v.fill(0, 6, 0, 1, 5, 7, curl);
        v.fill(0, 6, -2, -1, 5, 8, curl);
        v.fill(1, 5, -5, -3, 6, 8, curl);
        v.fill(2, 4, -7, -6, 7, 8, curl);
        v.set(3, -8, 8, P.hairDk);
        v.fill(-1, 7, 6, 8, -1, 6, (x, y) => y === 7 ? P.gold : P.goldDk);
        v.fill(0, 6, 9, 9, 0, 5, P.gold);
        v.fill(1, 5, 10, 10, 1, 4, P.goldDk);
        v.fill(2, 4, 11, 11, 2, 3, P.gold);
      }
      if (traits.skater) {
        // A slouched green beanie over dreads, shades in front of the eyes
        const rib = (x, y, z) => (x + z) % 2 ? P.knitDk : P.knit;
        v.fill(-1, 7, 4, 8, -1, 6, rib);
        v.fill(-1, 5, 9, 9, 0, 5, rib);
        v.fill(-2, 3, 10, 10, 1, 4, rib);
        v.fill(-3, 0, 11, 12, 1, 3, jit(P.pom, P.knit, 0.2));
        v.fill(-2, -1, 13, 13, 2, 2, P.pom);
        for (const [bx, by] of [[3, 8], [4, 8], [3, 7], [5, 7], [3, 6], [4, 6], [3, 5], [5, 5], [3, 4], [4, 4]]) v.set(bx, by, 6, P.btc);
        for (const z of [-1, 1, 3]) {
          v.fill(-1, -1, -2, 3, z, z, hairJ);
          v.fill(7, 7, -2, 3, z, z, hairJ);
        }
        for (const x of [0, 2, 4, 6]) v.fill(x, x, -3, 3, -1, -1, hairJ);
        v.fill(0, 6, 3, 3, 6, 6, P.black);
        v.fill(0, 1, 2, 3, 6, 6, P.lens);
        v.fill(5, 6, 2, 3, 6, 6, P.lens);
        v.fill(-1, -1, 3, 3, 4, 6, P.black);
        v.fill(7, 7, 3, 3, 4, 6, P.black);
      }
      if (traits.bee) {
        // The Bee: round blue goggles on a black strap, two antennae bent forward off the crown
        for (const cx of [1, 5]) {
          v.fill(cx - 1, cx + 1, 1, 4, 6, 6, P.black);
          v.fill(cx, cx, 2, 3, 6, 6, P.goggle);
          v.set(cx - 1, 3, 6, P.goggle);
          v.set(cx + 1, 2, 6, P.goggleDk);
        }
        v.set(3, 3, 6, P.black);
        v.fill(-1, -1, 3, 3, 3, 6, P.black);
        v.fill(7, 7, 3, 3, 3, 6, P.black);
        for (const ax of [1, 5]) {
          v.fill(ax, ax, 6, 7, 2, 2, P.black);
          v.set(ax, 8, 3, P.black);
          v.set(ax, 9, 4, P.black);
          v.set(ax, 10, 4, P.goggleDk);
        }
      }
      for (const [k, c] of [...v.map]) {
        if (c !== P.hair && c !== P.hairDk) continue;
        const [x, y, z] = k.split(",").map(Number);
        const exposed = !v.has(x + 1, y, z) || !v.has(x - 1, y, z) || !v.has(x, y, z + 1) || !v.has(x, y, z - 1) || !v.has(x, y + 1, z);
        if (exposed && rand() < 0.07) v.del(x, y, z);
      }
      if (hairy) {
        for (let x = 0; x <= 6; x++) for (let z = 0; z <= 5; z++) if (rand() < 0.08) v.set(x, 9, z, rand() < 0.5 ? P.hair : P.hairDk);
      }
      for (const [ex0, ex1] of [[0, 1], [5, 6]]) {
        for (let x = ex0; x <= ex1; x++) for (let y = 2; y <= 3; y++) {
          v.set(x, y, 5, P.white);
          eyeCells.push([x, y]);
        }
      }
      v.set(1, 2, 5, P.black);
      v.set(5, 2, 5, P.black);
      if (traits.symmetricTusks) {
        // Keep w-s-bitcoin's tusks and the stubble beside them as a clean mirror pair.
        for (let x = 0; x <= 6; x++) {
          for (let y = 0; y <= 1; y++) {
            v.set(x, y, 7, P.hair);
            for (let z = 5; z <= 6; z++) if (v.get(x, y, z) === P.stubble) v.set(x, y, z, P.hair);
          }
        }
        for (const x of [0, 6]) {
          v.set(x, 0, 7, P.stubble);
          v.set(x, 1, 7, P.stubble);
          v.del(x, 0, 6);
        }
        v.set(1, 0, 7, P.white);
        v.set(5, 0, 7, P.white);
      }
    }
    const headOrigin = { x: -3.5 * u, y: 0, z: -3 * u };
    const headOpen = vg(headVox, headOrigin);
    const closedVox = makeVox();
    for (const [k, c] of headVox.map) closedVox.map.set(k, c);
    for (const [x, y] of eyeCells) closedVox.set(x, y, 5, y === 2 ? P.skinDk : P.skin);
    const headClosed = vg(closedVox, headOrigin);
    parts.head = createNode({ position: { x: 0, y: 0.5 * h, z: 0.02 * h }, geometry: headOpen });
    const hatY = traits.gasMask ? 0.66 * h : (traits.bald ? 6 : traits.apple ? 8 : traits.anunnaki ? 12 : traits.skater ? 13 : traits.bee ? 11 : 9) * u;
    parts.hat = createNode({ position: { x: 0, y: hatY, z: 0 }, scale: { x: h, y: h, z: h }, visible: false });
    parts.face = createNode({ position: { x: 0, y: 0, z: 0 }, scale: { x: h, y: h, z: h }, visible: false });
    addChild(parts.head, parts.hat, parts.face);
    if (traits.gasMask) addChild(parts.head, createNode({ scale: { x: h, y: h, z: h }, geometry: gasMaskGeometry() }));
    addChild(root, parts.legL, parts.legR, parts.torso, parts.armL, parts.armR, parts.head);
    if (traits.anunnaki) {
      parts.lion = createNode({ geometry: voxelGeometry(lionVoxels(rand), { unit: u, palette: LION_PALETTE, origin: { x: armX + 1.5 * u, y: -1 * u, z: -2 * u } }) });
      addChild(root, parts.lion);
    }
    if (traits.skater) addChild(root, createNode({ position: { x: 0, y: 0.28 * h, z: -0.35 * h }, rotation: { x: 0, y: 0, z: 0.4 }, geometry: skateboardGeometry(h) }));
    return { root, parts, traits, headOffset: 1.1 * h, headOpen, headClosed, skins };
  };
  // A real die, opposite faces summing to seven
  const die = ({ size = 0.3 } = {}) => {
    const n = 5, u = size / n;
    const v = makeVox();
    v.fill(0, n - 1, 0, n - 1, 0, n - 1, 0);
    for (const cx of [0, n - 1]) for (const cy of [0, n - 1]) for (const cz of [0, n - 1]) v.del(cx, cy, cz);
    const corners = [[1, 1], [1, 3], [3, 1], [3, 3]];
    for (const [a, b] of [...corners, [2, 2]]) v.set(a, n - 1, b, 1);
    for (const [a, b] of [[1, 1], [3, 3]]) v.set(a, 0, b, 1);
    for (const [a, b] of [...corners, [1, 2], [3, 2]]) v.set(n - 1, a, b, 1);
    v.set(0, 2, 2, 1);
    for (const [a, b] of [[1, 1], [2, 2], [3, 3]]) v.set(a, b, n - 1, 1);
    for (const [a, b] of corners) v.set(a, b, 0, 1);
    return voxelGeometry(v, { unit: u, palette: [hexToRgb("#f3efe4"), hexToRgb("#141414")], origin: { x: -size / 2, y: -size / 2, z: -size / 2 } });
  };
  // Euler rotation putting a pip count on top
  const dieRotationFor = (pips, spin) => ({
    5: { x: 0, y: spin, z: 0 },
    2: { x: Math.PI, y: spin, z: 0 },
    3: { x: -Math.PI / 2, y: 0, z: spin },
    4: { x: Math.PI / 2, y: 0, z: spin },
    6: { x: 0, y: spin, z: Math.PI / 2 },
    1: { x: 0, y: spin, z: -Math.PI / 2 }
  })[pips];
  const playingCard = ({ red = false } = {}) => merge(
    box({ w: 0.26, h: 0.014, d: 0.38, color: "#292929" }),
    box({ w: 0.05, h: 8e-3, d: 0.06, color: "#eeeeee", offset: { x: -0.08, y: 0.01, z: -0.12 } }),
    box({ w: 0.08, h: 8e-3, d: 0.09, color: red ? "#ef7468" : "#eeeeee", offset: { y: 0.01, z: 0.04 } }),
    box({ w: 0.2, h: 8e-3, d: 0.3, color: "#8f231b", offset: { y: -0.01 } })
  );
  const ABACUS_RODS = 3;
  const EARTH_BEADS = 4;
  const BEAD_PITCH = 0.13;
  const DIVIDER_X = 0.2;
  // Four earth beads left of the divider, one heaven right
  const abacus = () => {
    const frame = "#5c4425";
    const node = createNode();
    const frameGeo = merge(
      box({ w: 0.08, h: 1.3, d: 0.1, color: frame, offset: { x: -0.55, y: 0.65 } }),
      box({ w: 0.08, h: 1.3, d: 0.1, color: frame, offset: { x: 0.55, y: 0.65 } }),
      box({ w: 1.18, h: 0.08, d: 0.1, color: frame, offset: { y: 1.31 } }),
      box({ w: 1.18, h: 0.08, d: 0.1, color: frame, offset: { y: 0.04 } }),
      box({ w: 0.04, h: 1.22, d: 0.08, color: "#3f2e18", offset: { x: DIVIDER_X, y: 0.65 } }),
      ...Array.from({ length: ABACUS_RODS }, (_, rod) => box({ w: 1.02, h: 0.03, d: 0.03, color: "#3a3a3a", offset: { y: 0.34 + rod * 0.34 } }))
    );
    addChild(node, createNode({ geometry: frameGeo }));
    const beadColors = ["#d8892b", "#6f9fca", "#22c55e"];
    const beadGeos = beadColors.map((color) => box({ w: 0.1, h: 0.11, d: 0.09, color }));
    const rods = [];
    for (let rod = 0; rod < ABACUS_RODS; rod++) {
      const y = 0.34 + rod * 0.34;
      const earth = [];
      for (let b = 0; b < EARTH_BEADS; b++) {
        const bead = createNode({ position: { x: -0.46 + b * BEAD_PITCH, y, z: 0 }, geometry: beadGeos[rod] });
        bead.targetX = bead.position.x;
        earth.push(bead);
        addChild(node, bead);
      }
      const heaven = createNode({ position: { x: 0.46, y, z: 0 }, geometry: beadGeos[rod] });
      heaven.targetX = heaven.position.x;
      addChild(node, heaven);
      rods.push({ earth, heaven });
    }
    const setValue = (value) => {
      let v = Math.max(0, Math.min(999, Math.floor(value)));
      for (let rod = 0; rod < ABACUS_RODS; rod++) {
        const digit = v % 10;
        v = Math.floor(v / 10);
        const pushed = digit % 5;
        rods[rod].earth.forEach((bead, b) => {
          const againstDivider = b >= EARTH_BEADS - pushed;
          bead.targetX = againstDivider ? DIVIDER_X - 0.08 - (EARTH_BEADS - 1 - b) * BEAD_PITCH : -0.46 + b * BEAD_PITCH;
        });
        rods[rod].heaven.targetX = digit >= 5 ? DIVIDER_X + 0.09 : 0.46;
      }
    };
    const update = (dt) => {
      for (const { earth, heaven } of rods) {
        for (const bead of earth) bead.position.x = damp(bead.position.x, bead.targetX, 9, dt);
        heaven.position.x = damp(heaven.position.x, heaven.targetX, 9, dt);
      }
    };
    return { node, setValue, update };
  };
  const labRoom = ({ half = 8, wallH = 4.6, bedrollCount = 12 } = {}) => {
    const room = createNode();
    const leds = [];
    const equipment = { racks: [], flasks: [], dice: [], cards: [] };
    const floorGeo = panel({ w: half * 2, h: half * 2, tilesX: 10, tilesY: 10, color: "#26262a", altColor: "#202024" });
    addChild(room, createNode({ rotation: { x: -Math.PI / 2, y: 0, z: 0 }, geometry: floorGeo, depthBias: 1.2 }));
    const gridGeo = geometry();
    const gridRgb = hexToRgb("#2c2c2f");
    for (let i = -half; i <= half; i += 2) {
      const a = pushVert(gridGeo, i, 0.012, -half), b = pushVert(gridGeo, i, 0.012, half);
      gridGeo.lines.push({ i: [a, b], color: gridRgb, emissive: 0.15 });
      const c = pushVert(gridGeo, -half, 0.012, i), d = pushVert(gridGeo, half, 0.012, i);
      gridGeo.lines.push({ i: [c, d], color: gridRgb, emissive: 0.15 });
    }
    gridGeo.lineWidth = 1.2;
    addChild(room, createNode({ geometry: gridGeo, depthBias: 1 }));
    const wallGeo = panel({ w: half * 2, h: wallH, tilesX: 10, tilesY: 3, color: "#232326", altColor: "#212124" });
    const skirtGeo = box({ w: half * 2, h: 0.18, d: 0.06, color: "#2e2e32", offset: { y: 0.09, z: 0.03 } });
    const wallAt = (x, z, ry) => {
      const wall = createNode({ position: { x, y: 0, z }, rotation: { x: 0, y: ry, z: 0 } });
      addChild(wall, createNode({ position: { x: 0, y: wallH / 2, z: 0 }, geometry: wallGeo, depthBias: 1.1 }), createNode({ geometry: skirtGeo }));
      return wall;
    };
    addChild(room, wallAt(0, -half, 0), wallAt(-half, 0, Math.PI / 2), wallAt(half, 0, -Math.PI / 2), wallAt(0, half, Math.PI));
    const ceilingGeo = panel({ w: half * 2, h: half * 2, tilesX: 6, tilesY: 6, color: "#151517", altColor: "#131315" });
    ceilingGeo.castShadow = false;
    addChild(room, createNode({ position: { x: 0, y: wallH, z: 0 }, rotation: { x: Math.PI / 2, y: 0, z: 0 }, geometry: ceilingGeo }));
    const lampGeo = box({ w: 1.6, h: 0.06, d: 0.5, color: "#f1e6c8", emissive: 0.85 });
    lampGeo.castShadow = false;
    for (const [lx, lz] of [[-5, -4], [5, -4], [-5, 4], [5, 4]]) addChild(room, createNode({ position: { x: lx, y: wallH - 0.04, z: lz }, geometry: lampGeo }));
    const hatchFrameGeo = merge(
      box({ w: 1.7, h: 0.1, d: 0.12, color: "#3a3a3e", offset: { z: -0.79 } }),
      box({ w: 1.7, h: 0.1, d: 0.12, color: "#3a3a3e", offset: { z: 0.79 } }),
      box({ w: 0.12, h: 0.1, d: 1.7, color: "#3a3a3e", offset: { x: -0.79 } }),
      box({ w: 0.12, h: 0.1, d: 1.7, color: "#3a3a3e", offset: { x: 0.79 } })
    );
    hatchFrameGeo.castShadow = false;
    const flapGeo = box({ w: 0.72, h: 0.06, d: 1.46, color: "#2a2a2e", offset: { x: 0.36 } });
    flapGeo.castShadow = false;
    const hatch = createNode({ position: { x: 0, y: wallH - 0.06, z: 0 } });
    const flapL = createNode({ position: { x: -0.73, y: 0, z: 0 }, geometry: flapGeo, rotation: { x: 0, y: Math.PI, z: 0 } });
    const flapR = createNode({ position: { x: 0.73, y: 0, z: 0 }, geometry: flapGeo });
    addChild(hatch, createNode({ geometry: hatchFrameGeo }), flapL, flapR);
    addChild(room, hatch);
    const setHatch = (k) => {
      flapL.rotation.z = -k * 1.35;
      flapR.rotation.z = k * 1.35;
    };
    const ledColors = ["#22c55e", "#d8892b", "#6f9fca"];
    const rackGeo = cached(() => {
      const rackParts = [
        box({ w: 1.7, h: 3.1, d: 0.8, color: "#1b1d1f", offset: { y: 1.61 } }),
        box({ w: 1.8, h: 0.1, d: 0.9, color: "#2a2c2f", offset: { y: 3.21 } }),
        box({ w: 1.8, h: 0.12, d: 0.9, color: "#2a2c2f", offset: { y: 0.06 } }),
        box({ w: 0.08, h: 2.95, d: 0.06, color: "#35383b", offset: { x: -0.74, y: 1.61, z: 0.4 } }),
        box({ w: 0.08, h: 2.95, d: 0.06, color: "#35383b", offset: { x: 0.74, y: 1.61, z: 0.4 } })
      ];
      for (let unit = 0; unit < 8; unit++) {
        const uy = 0.42 + unit * 0.34;
        rackParts.push(
          box({ w: 1.36, h: 0.26, d: 0.06, color: unit % 2 ? "#26282b" : "#202224", offset: { y: uy, z: 0.41 } }),
          box({ w: 0.55, h: 0.1, d: 0.02, color: "#0d0e0e", offset: { x: -0.28, y: uy, z: 0.45 } })
        );
      }
      return merge(...rackParts);
    });
    const ledGeos = ledColors.map((color) => box({ w: 0.07, h: 0.05, d: 0.02, color, emissive: 1 }));
    for (let r = 0; r < 3; r++) {
      const rx = -3.4 + r * 3.4;
      const rack = createNode({ position: { x: rx, y: 0, z: -half + 0.6 }, geometry: rackGeo() });
      addChild(room, rack);
      const rackLeds = [];
      for (let unit = 0; unit < 8; unit++) {
        const led = createNode({ position: { x: rx + 0.44, y: 0.45 + unit * 0.34, z: -half + 1.07 }, geometry: ledGeos[(r + unit) % 3] });
        led.ledGeos = ledGeos;
        leds.push(led);
        rackLeds.push(led);
        addChild(room, led);
      }
      equipment.racks.push({ node: rack, leds: rackLeds, index: r });
    }
    const bench = createNode({ position: { x: half - 1.6, y: 0, z: 1.5 } });
    const slab = ({ w, d, h = 0.12, color, sx = 1, sz = 1 }) => merge(
      ...[].concat(...Array.from({ length: sx }, (_, ix) => Array.from({ length: sz }, (_2, iz) => box({
        w: w / sx,
        h,
        d: d / sz,
        color,
        offset: { x: (ix + 0.5) * (w / sx) - w / 2, z: (iz + 0.5) * (d / sz) - d / 2 }
      }))))
    );
    addChild(bench, createNode({ position: { y: 1.02, x: 0, z: 0 }, geometry: slab({ w: 1.3, d: 3.4, color: "#2a2a2d", sz: 6 }) }));
    for (const dz of [-1.5, 1.5]) addChild(bench, createNode({ position: { x: 0, y: 0.5, z: dz }, geometry: box({ w: 1.1, h: 1, d: 0.14, color: "#202022" }) }));
    ["#22c55e", "#6f9fca", "#d8892b"].forEach((liquid, i) => {
      const flask = createNode({
        position: { x: 0, y: 1.13, z: -0.8 + i * 0.8 },
        geometry: lathe({ profile: [[0.02, 0], [0.22, 0.02], [0.24, 0.14], [0.1, 0.34], [0.06, 0.52], [0.08, 0.56]], segments: 8, color: liquid, emissive: 0.75 })
      });
      flask.color = liquid;
      leds.push(flask);
      equipment.flasks.push(flask);
      addChild(bench, flask);
    });
    equipment.bench = bench;
    addChild(room, bench);
    const desk = createNode({ position: { x: -6.8, y: 0, z: -half + 0.75 } });
    addChild(desk, createNode({ position: { x: 0, y: 1, z: 0 }, geometry: slab({ w: 2.2, d: 1, h: 0.1, color: "#2a2a2d", sx: 4, sz: 2 }) }));
    for (const [lx, lz] of [[-1, -0.4], [1, -0.4], [-1, 0.4], [1, 0.4]]) addChild(desk, createNode({ geometry: box({ w: 0.12, h: 0.95, d: 0.12, color: "#1c1c1e", offset: { x: lx, y: 0.475, z: lz } }) }));
    const monitor = createNode({
      position: { x: -0.2, y: 1.05, z: -0.15 },
      geometry: merge(
        box({ w: 0.5, h: 0.05, d: 0.35, color: "#1e2320", offset: { y: 0.025 } }),
        box({ w: 0.08, h: 0.28, d: 0.08, color: "#1e2320", offset: { y: 0.19 } }),
        box({ w: 1.1, h: 0.72, d: 0.08, color: "#1e2320", offset: { y: 0.66 } }),
        box({ w: 0.96, h: 0.58, d: 0.02, color: "#1c4a2c", emissive: 0.9, offset: { y: 0.66, z: 0.045 } })
      )
    });
    leds.push(monitor);
    equipment.monitor = monitor;
    addChild(desk, monitor);
    addChild(desk, createNode({ geometry: box({ w: 0.8, h: 0.05, d: 0.3, color: "#252527", offset: { x: -0.1, y: 1.08, z: 0.28 } }) }));
    const tower = createNode({
      position: { x: 0.85, y: 0, z: 0 },
      geometry: merge(
        box({ w: 0.45, h: 0.85, d: 0.8, color: "#202022", offset: { y: 0.425 } }),
        box({ w: 0.05, h: 0.05, d: 0.02, color: "#22c55e", emissive: 1, offset: { x: 0.12, y: 0.7, z: 0.41 } })
      )
    });
    leds.push(tower);
    equipment.tower = tower;
    addChild(desk, tower);
    addChild(desk, createNode({
      position: { x: -0.2, y: 0, z: 1.1 },
      geometry: merge(box({ w: 0.5, h: 0.08, d: 0.5, color: "#2e2724", offset: { y: 0.55 } }), box({ w: 0.1, h: 0.55, d: 0.1, color: "#1c1c1e", offset: { y: 0.26 } }))
    }));
    equipment.desk = desk;
    addChild(room, desk);
    const cardTable = createNode({ position: { x: 5.2, y: 0, z: 4.4 }, rotation: { x: 0, y: 0.4, z: 0 } });
    addChild(
      cardTable,
      createNode({ position: { x: 0, y: 0.55, z: 0 }, geometry: slab({ w: 1.3, d: 0.9, h: 0.1, color: "#2a2a2d", sx: 3, sz: 2 }) }),
      createNode({ geometry: box({ w: 0.16, h: 0.5, d: 0.16, color: "#1c1c1e", offset: { y: 0.25 } }) })
    );
    const cardGeos = { red: playingCard({ red: true }), black: playingCard({ red: false }) };
    [[-0.35, 0.15, 0.3, false], [-0.05, -0.12, 0.9, true], [0.3, 0.1, 1.6, false]].forEach(([cx, cz, ry, red]) => {
      const card = createNode({ position: { x: cx, y: 0.61, z: cz }, rotation: { x: 0, y: ry, z: 0 }, geometry: cardGeos[red ? "red" : "black"] });
      equipment.cards.push(card);
      addChild(cardTable, card);
    });
    const dieGeos = { small: die({ size: 0.16 }), medium: die({ size: 0.26 }), large: die({ size: 0.4 }) };
    for (const [px, pz, ry] of [[0.42, -0.25, 0.9], [0.16, -0.3, 2.2]]) {
      const d = createNode({ position: { x: px, y: 0.61 + 0.08, z: pz }, rotation: { x: 0, y: ry, z: 0 }, geometry: dieGeos.small });
      d.dieSize = 0.16;
      equipment.dice.push(d);
      addChild(cardTable, d);
    }
    equipment.cardTable = cardTable;
    addChild(room, cardTable);
    const floorDice = [
      createNode({ position: { x: 3.4, y: 0.2, z: 5.3 }, rotation: { x: 0, y: 1.1, z: 0 }, geometry: dieGeos.large }),
      createNode({ position: { x: 4.5, y: 0.13, z: 5.8 }, rotation: { x: 0, y: 2.6, z: 0 }, geometry: dieGeos.medium })
    ];
    floorDice[0].dieSize = 0.4;
    floorDice[1].dieSize = 0.26;
    equipment.dice.push(...floorDice);
    const floorCard = createNode({ position: { x: 4.2, y: 0.02, z: 3.3 }, rotation: { x: 0, y: 2.3, z: 0 }, geometry: cardGeos.red, depthBias: 0.5 });
    equipment.cards.push(floorCard);
    const abacusModel = abacus();
    abacusModel.node.position = { x: half - 0.45, y: 0, z: -3.5 };
    abacusModel.node.rotation = { x: 0, y: -Math.PI / 2, z: 0 };
    equipment.abacus = abacusModel;
    addChild(room, ...floorDice, floorCard, abacusModel.node);
    const strokeFont = {
      O: [[[0.5, 0], [0.12, 0.35], [0.12, 1.05], [0.5, 1.4], [0.88, 1.05], [0.88, 0.35], [0.5, 0]]],
      G: [[[0.88, 1.1], [0.5, 1.4], [0.12, 1.05], [0.12, 0.35], [0.5, 0], [0.88, 0.3], [0.88, 0.65], [0.52, 0.65]]],
      A: [[[0.05, 0], [0.5, 1.4], [0.95, 0]], [[0.28, 0.5], [0.72, 0.5]]],
      B: [[[0.12, 0], [0.12, 1.4]], [[0.12, 1.4], [0.82, 1.12], [0.12, 0.72]], [[0.12, 0.72], [0.92, 0.34], [0.12, 0]]]
    };
    const wob = (n) => Math.sin(n * 12.9898) * 0.045;
    const caveText = "OOGA BOOGA";
    const ls = 0.72, letterW = 0.95, letterGap = 0.32, spaceW = 0.6;
    let cursor = 0;
    const strokes = [];
    let pointIdx = 0;
    for (const ch of caveText) {
      if (ch === " ") {
        cursor += spaceW;
        continue;
      }
      for (const stroke of strokeFont[ch]) {
        strokes.push(stroke.map(([px, py]) => ({ x: cursor + (px * letterW + wob(pointIdx)) * ls, y: (py + wob(pointIdx++ + 57)) * ls, z: 0 })));
      }
      cursor += (letterW + letterGap) * ls;
    }
    const signW = cursor - letterGap * ls;
    const signGeo = merge(...strokes.map((points) => polyline({ points, color: "#e8973a", emissive: 1 })));
    signGeo.lineWidth = 2.6;
    addChild(room, createNode({ position: { x: -signW / 2, y: 3.55, z: -half + 0.25 }, geometry: signGeo }));
    const bedrolls = [];
    const bedrollGeo = merge(box({ w: 1.9, h: 0.09, d: 0.85, color: "#2e2724" }), box({ w: 0.4, h: 0.16, d: 0.6, color: "#40342c", offset: { x: 0.65, y: 0.1 } }));
    for (let i = 0; i < bedrollCount; i++) {
      const x = -half + 1.3 + i % 2 * 2.3;
      const z = -7.6 + Math.floor(i / 2) * 1.6;
      addChild(room, createNode({ position: { x, y: 0.05, z }, geometry: bedrollGeo, depthBias: 0.3 }));
      bedrolls.push({ x, z });
    }
    return { room, leds, bedrolls, equipment, hatch: { node: hatch, set: setHatch } };
  };
  // MrHodl's den: a snug sleeping room whose bed, nightstand, mask peg, desk,
  // shelves, crates and lanterns come back as interactive props for the scene
  const denRoom = ({ half = 6.4, wallH = 3.4, bed = { x: 0.2, z: -4.2 } } = {}) => {
    const room = createNode();
    const lanterns = [];
    const interactive = [];
    const prop = (node, kind, radius = 0) => {
      interactive.push({ node, kind, radius });
      return node;
    };
    const floorGeo = panel({ w: half * 2, h: half * 2, tilesX: 8, tilesY: 8, color: "#2a231c", altColor: "#241e18" });
    addChild(room, createNode({ rotation: { x: -Math.PI / 2, y: 0, z: 0 }, geometry: floorGeo, depthBias: 1.2 }));
    const wallGeo = panel({ w: half * 2, h: wallH, tilesX: 8, tilesY: 3, color: "#2b241d", altColor: "#261f19" });
    const skirtGeo = box({ w: half * 2, h: 0.16, d: 0.06, color: "#342b22", offset: { y: 0.08, z: 0.03 } });
    const wallAt = (x, z, ry) => {
      const wall = createNode({ position: { x, y: 0, z }, rotation: { x: 0, y: ry, z: 0 } });
      addChild(wall, createNode({ position: { x: 0, y: wallH / 2, z: 0 }, geometry: wallGeo, depthBias: 1.1 }), createNode({ geometry: skirtGeo }));
      return wall;
    };
    addChild(room, wallAt(0, -half, 0), wallAt(-half, 0, Math.PI / 2), wallAt(half, 0, -Math.PI / 2), wallAt(0, half, Math.PI));
    const ceilingGeo = panel({ w: half * 2, h: half * 2, tilesX: 6, tilesY: 6, color: "#1b1611", altColor: "#18140f" });
    ceilingGeo.castShadow = false;
    addChild(room, createNode({ position: { x: 0, y: wallH, z: 0 }, rotation: { x: Math.PI / 2, y: 0, z: 0 }, geometry: ceilingGeo }));
    // Low beams read the ceiling as a den rather than a hall
    const beamGeo = box({ w: half * 2, h: 0.2, d: 0.22, color: "#3a2d20" });
    addChild(room, createNode({ position: { x: 0, y: wallH - 0.11, z: -half + 2.6 }, geometry: beamGeo }), createNode({ position: { x: 0, y: wallH - 0.11, z: 1.4 }, geometry: beamGeo }));
    // A rug, and the peels MrHodl never got round to sweeping
    addChild(room, createNode({ position: { x: 0.2, y: 0.02, z: 0.5 }, rotation: { x: -Math.PI / 2, y: 0, z: 0 }, geometry: panel({ w: 4, h: 3.2, tilesX: 6, tilesY: 5, color: "#5a3a2a", altColor: "#654231" }), depthBias: 1.4 }));
    const peelGeo = merge(box({ w: 0.42, h: 0.03, d: 0.12, color: "#c9b23a", offset: { x: 0.12 } }), box({ w: 0.05, h: 0.05, d: 0.05, color: "#5a3a1a", offset: { x: -0.1 } }));
    for (const [px, pz, ry] of [[2.4, 1.9, 0.7], [2.9, 0.6, 2.4], [-2.6, 2.2, 1.3]]) addChild(room, createNode({ position: { x: px, y: 0.026, z: pz }, rotation: { x: 0, y: ry, z: 0 }, geometry: peelGeo, depthBias: 1.6 }));
    // The bed: a low platform and a headboard on the back wall, the bedroll on top
    const bedNode = createNode({
      position: { x: bed.x, y: 0, z: bed.z },
      geometry: merge(
        box({ w: 2.8, h: 0.3, d: 1.6, color: "#4a3a2a", offset: { y: 0.15 } }),
        box({ w: 2.9, h: 0.86, d: 0.16, color: "#3f3327", offset: { y: 0.73, z: -0.78 } }),
        box({ w: 0.18, h: 1, d: 0.2, color: "#4a3a2a", offset: { x: -1.42, y: 0.5, z: -0.78 } }),
        box({ w: 0.18, h: 1, d: 0.2, color: "#4a3a2a", offset: { x: 1.42, y: 0.5, z: -0.78 } })
      )
    });
    prop(bedNode, "bed", 1.3);
    addChild(room, bedNode);
    // The nightstand and the night snack on it
    const standX = bed.x + 2, standZ = bed.z + 0.1;
    addChild(room, createNode({
      position: { x: standX, y: 0, z: standZ },
      geometry: merge(
        box({ w: 0.72, h: 0.12, d: 0.72, color: "#5b4a38", offset: { y: 0.6 } }),
        box({ w: 0.6, h: 0.54, d: 0.6, color: "#4a3a2a", offset: { y: 0.3 } }),
        box({ w: 0.14, h: 0.1, d: 0.14, color: "#3a2d20", offset: { y: 0.1, x: -0.2, z: -0.2 } }),
        box({ w: 0.14, h: 0.1, d: 0.14, color: "#3a2d20", offset: { y: 0.1, x: 0.2, z: 0.2 } })
      )
    }));
    const snack = createNode({
      position: { x: standX - 0.06, y: 0.72, z: standZ + 0.04 },
      rotation: { x: 0, y: 0.6, z: 0 },
      scale: { x: BANANA_AMMO_SCALE, y: BANANA_AMMO_SCALE, z: BANANA_AMMO_SCALE },
      geometry: bananaGeometry()
    });
    prop(snack, "snack", 0.4);
    addChild(room, snack);
    // The gas-mask peg on one wall, the mask resting on its rail
    const peg = createNode({ position: { x: -half + 0.1, y: 1.5, z: 0.1 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } });
    addChild(peg, createNode({
      geometry: merge(
        box({ w: 1.2, h: 1.6, d: 0.1, color: "#4a3a2a", offset: { y: 0.1 } }),
        box({ w: 1.2, h: 0.12, d: 0.34, color: "#5b4a38", offset: { y: -0.66, z: 0.16 } }),
        box({ w: 0.1, h: 0.1, d: 0.2, color: "#3a2d20", offset: { y: 0.78, z: 0.14 } })
      )
    }));
    const mask = createNode({ position: { x: -0.15, y: -0.6, z: 0.24 }, rotation: { x: 0, y: 0.2, z: 0 }, geometry: gasMaskGeometry() });
    prop(mask, "mask", 0.4);
    addChild(peg, mask);
    addChild(room, peg);
    // A small desk: a slate, a lamp and a die
    const desk = createNode({ position: { x: -half + 1.5, y: 0, z: -2.2 }, rotation: { x: 0, y: 0.4, z: 0 } });
    addChild(desk, createNode({
      geometry: merge(
        box({ w: 1.7, h: 0.12, d: 0.9, color: "#5b4a38", offset: { y: 0.94 } }),
        ...[[-0.74, -0.34], [0.74, -0.34], [-0.74, 0.34], [0.74, 0.34]].map(([x, z]) => box({ w: 0.12, h: 0.88, d: 0.12, color: "#3a2d20", offset: { x, y: 0.44, z } })),
        box({ w: 0.42, h: 0.05, d: 0.56, color: "#5a4a38", offset: { x: -0.3, y: 1.03, z: 0.02 } }),
        box({ w: 0.36, h: 0.02, d: 0.5, color: "#8a7a63", offset: { x: -0.3, y: 1.06, z: 0.02 } }),
        box({ w: 0.22, h: 0.18, d: 0.22, color: "#3f3327", offset: { x: 0.36, y: 1.09, z: -0.14 } })
      )
    }));
    const deskDie = createNode({ position: { x: 0.06, y: 1.1, z: 0.24 }, rotation: { ...dieRotationFor(4, 0.7) }, geometry: die({ size: 0.18 }) });
    deskDie.dieSize = 0.18;
    prop(deskDie, "die", 0.3);
    addChild(desk, deskDie);
    addChild(room, desk);
    // A die left on the floor mid-game
    const floorDie = createNode({ position: { x: 2.1, y: 0.16, z: 1.1 }, rotation: { x: 0, y: 1.1, z: 0 }, geometry: die({ size: 0.32 }) });
    floorDie.dieSize = 0.32;
    prop(floorDie, "die", 0.36);
    addChild(room, floorDie);
    // Shelves on the far wall with a crate stack beside them
    const shelf = createNode({ position: { x: half - 0.16, y: 0, z: -1.5 }, rotation: { x: 0, y: -Math.PI / 2, z: 0 } });
    addChild(shelf, createNode({
      geometry: merge(
        box({ w: 1.9, h: 2.1, d: 0.1, color: "#3f3327", offset: { y: 1.05 } }),
        ...[0.7, 1.4, 2].map((y) => box({ w: 1.9, h: 0.08, d: 0.44, color: "#5b4a38", offset: { y, z: 0.2 } })),
        box({ w: 0.3, h: 0.34, d: 0.28, color: "#6b4a26", offset: { x: -0.55, y: 0.91, z: 0.22 } }),
        box({ w: 0.24, h: 0.28, d: 0.24, color: "#8a6236", offset: { x: 0.2, y: 0.88, z: 0.22 } }),
        box({ w: 0.26, h: 0.26, d: 0.26, color: "#d8892b", emissive: 0.35, offset: { x: 0.72, y: 1.68, z: 0.22 } })
      )
    }));
    addChild(room, shelf);
    const crateGeo = merge(
      box({ w: 0.86, h: 0.86, d: 0.86, color: "#8a6236", offset: { y: 0.43 } }),
      ...[0.8, 0.12].flatMap((y) => [-0.4, 0.4].map((z) => box({ w: 0.9, h: 0.1, d: 0.1, color: "#5c4425", offset: { y, z } })))
    );
    const crateA = createNode({ position: { x: half - 1.1, y: 0, z: 1.5 }, rotation: { x: 0, y: 0.3, z: 0 }, geometry: crateGeo });
    prop(crateA, "crate", 0.9);
    const crateB = createNode({ position: { x: half - 1.15, y: 0.86, z: 1.44 }, rotation: { x: 0, y: -0.4, z: 0 }, geometry: crateGeo });
    prop(crateB, "crate", 0.9);
    addChild(room, crateA, crateB);
    // Corner lanterns over the headboard, panes emissive so the scene can glow them
    const lanternGeo = merge(
      box({ w: 0.06, h: 0.1, d: 0.06, color: "#3a2a18", offset: { y: 0.2 } }),
      box({ w: 0.32, h: 0.05, d: 0.32, color: "#2b2521", offset: { y: 0.12 } }),
      box({ w: 0.34, h: 0.06, d: 0.34, color: "#2b2521", offset: { y: -0.32 } }),
      ...[[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]].map(([x, z]) => box({ w: 0.03, h: 0.34, d: 0.03, color: "#2b2521", offset: { x, y: -0.09, z } })),
      box({ w: 0.16, h: 0.3, d: 0.16, color: "#ffd27a", emissive: 1, offset: { y: -0.09 } })
    );
    lanternGeo.castShadow = false;
    for (const lx of [bed.x - 2.6, bed.x + 2.6]) {
      const lantern = createNode({ position: { x: lx, y: wallH - 0.5, z: bed.z - 0.5 }, geometry: lanternGeo });
      lantern.flare = 0;
      lantern.glow = 0.8;
      lanterns.push(lantern);
      prop(lantern, "lantern", 0.5);
      addChild(room, lantern);
    }
    return {
      room,
      bed: { x: bed.x, y: 0.72, z: bed.z },
      bedNode,
      spots: {
        mask: { x: -half + 0.34, y: 1.1, z: 0.25 },
        snack: { x: standX, y: 0.85, z: standZ },
        desk: { x: -half + 1.5, y: 1.2, z: -2.2 }
      },
      interactive,
      lanterns,
      bedrolls: [{ x: bed.x, z: bed.z }]
    };
  };

  const buildableGeos = [
    cached(() => merge(
      box({ w: 0.8, h: 1.3, d: 0.5, color: "#1b1d1f", offset: { y: 0.65 } }),
      box({ w: 0.86, h: 0.06, d: 0.56, color: "#2a2c2f", offset: { y: 1.33 } }),
      box({ w: 0.6, h: 0.1, d: 0.03, color: "#202224", offset: { y: 0.9, z: 0.26 } }),
      box({ w: 0.6, h: 0.1, d: 0.03, color: "#202224", offset: { y: 0.6, z: 0.26 } }),
      box({ w: 0.06, h: 0.05, d: 0.02, color: "#22c55e", emissive: 1, offset: { x: 0.2, y: 1.05, z: 0.26 } })
    )),
    cached(() => merge(
      box({ w: 0.9, h: 0.7, d: 0.9, color: "#5c4425", offset: { y: 0.35 } }),
      box({ w: 0.96, h: 0.08, d: 0.96, color: "#4c3a20", offset: { y: 0.72 } }),
      box({ w: 0.9, h: 0.08, d: 0.1, color: "#4c3a20", offset: { y: 0.35, z: 0.41 } })
    )),
    cached(() => merge(
      box({ w: 0.12, h: 1.1, d: 0.12, color: "#35383b", offset: { y: 0.55 } }),
      box({ w: 0.5, h: 0.5, d: 0.06, color: "#3f4245", offset: { y: 1.2, z: 0.1 } }),
      box({ w: 0.08, h: 0.08, d: 0.06, color: "#d8892b", emissive: 1, offset: { y: 1.2, z: 0.16 } })
    ))
  ];
  const TIER_COLORS = { common: "#9aa0a6", rare: "#6f9fca", epic: "#b16fd6", legendary: "#d8892b" };
  const crateCache = new Map();
  const crate = (tier) => {
    let geos = crateCache.get(tier);
    if (!geos) {
      const stripe = TIER_COLORS[tier] || TIER_COLORS.common;
      geos = {
        body: merge(
          box({ w: 0.7, h: 0.5, d: 0.7, color: "#6b4a26", offset: { y: 0.25 } }),
          box({ w: 0.74, h: 0.08, d: 0.74, color: "#4c3a20", offset: { y: 0.06 } }),
          box({ w: 0.74, h: 0.1, d: 0.16, color: stripe, emissive: 0.6, offset: { y: 0.3 } }),
          box({ w: 0.16, h: 0.1, d: 0.74, color: stripe, emissive: 0.6, offset: { y: 0.3 } })
        ),
        lid: merge(box({ w: 0.76, h: 0.1, d: 0.76, color: "#7a5630", offset: { x: 0.38, y: 0.05 } }), box({ w: 0.2, h: 0.06, d: 0.2, color: stripe, emissive: 0.8, offset: { x: 0.38, y: 0.12 } }))
      };
      crateCache.set(tier, geos);
    }
    const node = createNode();
    const lid = createNode({ position: { x: -0.38, y: 0.5, z: 0 }, geometry: geos.lid });
    addChild(node, createNode({ geometry: geos.body }), lid);
    return { node, lid };
  };
  const swagCache = new Map();
  const swagGeo = (id, build) => {
    let geo = swagCache.get(id);
    if (!geo) {
      geo = build();
      swagCache.set(id, geo);
    }
    return geo;
  };
  // Head anchor and swag sizes, in height fractions
  const SWAG = [
    { id: "party-hat", name: "Party Hat", tier: "common", slot: "head", offset: { y: -0.03 }, build: () => lathe({ profile: [[0.36, 0], [0.26, 0.2], [0.14, 0.42], [0.0, 0.62]], segments: 8, color: (t) => t < 0.34 ? "#d8892b" : t < 0.67 ? "#f3efe4" : "#22c55e" }) },
    { id: "bandana", name: "Bandana", tier: "common", slot: "head", offset: { y: -0.16 }, build: () => merge(ring({ r: 0.4, thickness: 0.045, segments: 10, color: "#c8342a" }), box({ w: 0.1, h: 0.04, d: 0.26, color: "#c8342a", offset: { x: 0.06, y: -0.03, z: -0.5 } }), box({ w: 0.1, h: 0.04, d: 0.2, color: "#a82a22", offset: { x: -0.08, y: -0.05, z: -0.46 } })) },
    {
      id: "banana-peel", name: "Banana Peel Hat", tier: "common", slot: "head", offset: { y: -0.06 }, build: () => merge(
        lathe({ profile: [[0.23, 0], [0.22, 0.08], [0.16, 0.16], [0.07, 0.22], [0, 0.24]], segments: 8, color: "#f5c542" }),
        box({ w: 0.05, h: 0.09, d: 0.05, color: "#5a3a1a", offset: { y: 0.27 } }),
        ...[0, 1, 2, 3].map((i) => {
          const a = i / 4 * Math.PI * 2 + Math.PI / 4;
          return tube({
            rings: 6,
            segments: 5,
            path: (t) => ({ x: Math.cos(a) * (0.08 + t * 0.34), y: 0.14 - t * t * 0.42, z: Math.sin(a) * (0.08 + t * 0.34) }),
            radius: (t) => 0.065 - t * 0.02,
            colorFn: (t) => t > 0.8 ? "#5a3a1a" : t > 0.55 ? "#e0b53a" : "#f5c542"
          });
        })
      )
    },
    { id: "miner-helmet", name: "Miner Helmet", tier: "rare", slot: "head", offset: { y: -0.12 }, build: () => merge(lathe({ profile: [[0.42, 0], [0.41, 0.12], [0.32, 0.26], [0.14, 0.36], [0, 0.38]], segments: 10, color: "#e0b53a" }), box({ w: 0.14, h: 0.12, d: 0.1, color: "#fff2b0", emissive: 1, offset: { y: 0.18, z: 0.4 } })) },
    { id: "tinfoil-hat", name: "Tinfoil Hat", tier: "rare", slot: "head", offset: { y: -0.04 }, build: () => lathe({ profile: [[0.38, 0], [0.27, 0.2], [0.14, 0.38], [0.02, 0.56]], segments: 5, color: "#c9ccd2" }) },
    { id: "golden-club", name: "Golden Club", tier: "rare", slot: "hand", skin: "club", build: () => voxelGeometry(clubVoxels(BL.math.mulberry32(7)), { unit: 1 / 16, palette: GOLD_CLUB_PALETTE, origin: { x: -1 / 16, y: -1 / 16, z: -1 / 16 } }) },
    { id: "crown", name: "Crown", tier: "epic", slot: "head", offset: { y: -0.06 }, build: () => merge(ring({ r: 0.38, thickness: 0.05, y: 0.05, segments: 8, color: "#f0c95a", emissive: 0.3 }), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => box({ w: 0.07, h: 0.18, d: 0.07, color: "#f0c95a", emissive: 0.3, offset: { x: Math.cos(i / 8 * Math.PI * 2) * 0.38, y: 0.19, z: Math.sin(i / 8 * Math.PI * 2) * 0.38 } }))) },
    { id: "golden-ak", name: "Golden AK", tier: "epic", slot: "gun", skin: "gun", build: () => gunGeometry(1, GOLD_GUN_PALETTE) },
    { id: "propeller-beanie", name: "Propeller Beanie", tier: "epic", slot: "head", spin: true, offset: { y: -0.1 }, build: () => merge(lathe({ profile: [[0.4, 0], [0.37, 0.14], [0.22, 0.28], [0, 0.32]], segments: 8, color: (t) => t < 0.5 ? "#6f9fca" : "#c8342a" }), box({ w: 0.03, h: 0.1, d: 0.03, color: "#c9ccd2", offset: { y: 0.36 } })) },
    { id: "halo", name: "Halo", tier: "legendary", slot: "head", float: true, offset: { y: 0.3 }, build: () => ring({ r: 0.26, thickness: 0.03, segments: 14, color: "#fff2b0", emissive: 1 }) },
    { id: "laser-eyes", name: "Laser Eyes", tier: "legendary", slot: "face", build: () => merge(...[-0.125, 0.125].map((x) => polyline({ points: [{ x, y: 0.16, z: 0.19 }, { x, y: 0.16, z: 1.0 }], color: "#ff2d20", emissive: 1 }))) }
  ];
  for (const item of SWAG) {
    if (item.slot === "head" && item.spin) {
      item.buildNode = () => {
        const node = createNode({ geometry: swagGeo(item.id, item.build) });
        const prop = createNode({ position: { x: 0, y: 0.42, z: 0 }, geometry: swagGeo(`${item.id}/prop`, () => box({ w: 0.44, h: 0.02, d: 0.06, color: "#f3efe4" })) });
        prop.spin = true;
        addChild(node, prop);
        return node;
      };
    } else {
      item.buildNode = () => createNode({ geometry: swagGeo(item.id, item.build) });
    }
  }
  BL.models = { box, panel, lathe, tube, ring, polyline, merge, voxelFaces, banana, bananaGeometry, bananaTileGeometry, bananaPileCoreGeometry, bananaPileRadiusScale, bananaPileHeightOffset, BANANA_AMMO_SCALE, BANANA_PILE_PROFILE, particleGeometry, caveman, labRoom, denRoom, buildableGeos, crate, dieRotationFor, SWAG, TIER_COLORS };
})();
