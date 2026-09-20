(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { mulberry32, hexToRgb, clamp } = BL.math;
  // Dense voxel grid, 0 and outside both empty
  const makeGrid = (sx, sy, sz) => {
    const data = new Uint8Array(sx * sy * sz);
    const inside = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz;
    const index = (x, y, z) => (x * sy + y) * sz + z;
    return {
      data,
      sx,
      sy,
      sz,
      index,
      get: (x, y, z) => inside(x, y, z) ? data[index(x, y, z)] : 0,
      set: (x, y, z, c) => {
        data[index(x, y, z)] = c;
      },
      has: (x, y, z) => inside(x, y, z) && data[index(x, y, z)] !== 0
    };
  };
  // Exposed grid faces, greedy-merged a slice at a time
  const DIR_BIT = 0x100, FLOOR_DETAIL_BIT = 0x4000;
  const gridGeometry = (grid, { unit, palette, origin = { x: 0, y: 0, z: 0 }, matrixCaves = null, floorRooms = [] }) => {
    const { data, sx, sy, sz } = grid;
    const dims = [sx, sy, sz], strides = [sy * sz, sz, 1];
    const geo = { verts: [], faces: [], lines: [] };
    const mask = new Int16Array(Math.max(sx * sy, sy * sz, sz * sx));
    const floorDetails = floorRooms.map((room) => ({ ...room, cr: Math.cos(room.angle), sr: Math.sin(room.angle) }));
    // Rooms bucketed by the slice their floor lands on, so the y sweep stops
    // filtering the whole list once per slice
    const floorsByRow = new Map();
    for (const room of floorDetails) {
      const row = Math.round((room.floor - origin.y) / unit);
      // Keep the original tolerance: a floor that lands between slices
      // matched no slice, and still must not match the nearest one.
      if (Math.abs(origin.y + row * unit - room.floor) > 1e-7) continue;
      let list = floorsByRow.get(row);
      if (!list) floorsByRow.set(row, list = []);
      list.push(room);
    }
    const NO_ROOMS = [];
    const corner = new Float64Array(3);
    const at = (d, k, u, i, v, j) => {
      corner[d] = k;
      corner[u] = i;
      corner[v] = j;
      geo.verts.push(origin.x + corner[0] * unit, origin.y + corner[1] * unit, origin.z + corner[2] * unit);
      return geo.verts.length / 3 - 1;
    };
    // First and last solid cell of every z-row: a slice only reads rows that can show a face.
    const rowLo = new Int16Array(sx * sy).fill(sz), rowHi = new Int16Array(sx * sy).fill(-1);
    const slabLo = new Int16Array(sx).fill(sz), slabHi = new Int16Array(sx).fill(-1);
    for (let r = 0; r < sx * sy; r++) {
      const base = r * sz, x = Math.floor(r / sy);
      let lo = 0, hi = sz - 1;
      while (lo < sz && !data[base + lo]) lo++;
      if (lo === sz) continue;
      while (!data[base + hi]) hi--;
      rowLo[r] = lo; rowHi[r] = hi;
      if (lo < slabLo[x]) slabLo[x] = lo;
      if (hi > slabHi[x]) slabHi[x] = hi;
    }
    for (let d = 0; d < 3; d++) {
      const u = (d + 1) % 3, v = (d + 2) % 3;
      const nd = dims[d], nu = dims[u], nv = dims[v];
      const sd = strides[d], su = strides[u], sv = strides[v];
      for (let k = 0; k <= nd; k++) {
        // Faces between cells k-1 and k along d
        let i0 = nu, i1 = -1, j0 = nv, j1 = -1;
        const rooms = d === 1 ? floorsByRow.get(k) || NO_ROOMS : floorDetails;
        const cell = (i, j) => {
          const base = i * su + j * sv + k * sd;
          const a = k > 0 ? data[base - sd] : 0, b = k < nd ? data[base] : 0;
          if (!a === !b) return;
          const n = j * nu + i;
          const cave = matrixCaves && (a && !b && k < nd ? matrixCaves[base] : !a && b && k > 0 ? matrixCaves[base - sd] : 0);
          mask[n] = a && !b ? a | DIR_BIT | (cave << 9) : b | (cave << 9);
          if (i < i0) i0 = i;
          if (i > i1) i1 = i;
          if (j < j0) j0 = j;
          if (j > j1) j1 = j;
          if (d === 1 && a && !b) for (const room of rooms) {
            const dx = origin.x + (j + 0.5) * unit - room.x, dz = origin.z + (i + 0.5) * unit - room.z;
            if (Math.abs(dx * room.cr + dz * room.sr) < room.width / 2 + unit && Math.abs(dx * room.sr - dz * room.cr) < room.depth / 2 + unit) { mask[n] |= FLOOR_DETAIL_BIT; break; }
          }
        };
        if (d === 2) {
          // Rows are along z: one cell per row, in memory order
          for (let x = 0; x < sx; x++) if (slabLo[x] <= k && slabHi[x] >= k - 1) for (let y = 0; y < sy; y++) {
            const r = x * sy + y;
            if (rowLo[r] <= k && rowHi[r] >= k - 1) cell(x, y);
          }
        } else {
          // The two rows either side of the slice, over their joint solid span
          const count = d === 0 ? sy : sx;
          for (let m = 0; m < count; m++) {
            const near = d === 0 ? k * sy + m : m * sy + k, far = d === 0 ? near - sy : near - 1;
            const lo = Math.min(k < nd ? rowLo[near] : sz, k > 0 ? rowLo[far] : sz), hi = Math.max(k < nd ? rowHi[near] : -1, k > 0 ? rowHi[far] : -1);
            for (let z = lo; z <= hi; z++) if (d === 0) cell(m, z); else cell(z, m);
          }
        }
        for (let j = j0; j <= j1; j++) {
          let n = j * nu + i0;
          for (let i = i0; i <= i1;) {
            const c = mask[n];
            if (!c) {
              i++;
              n++;
              continue;
            }
            // Detail only furnished room floors; the common areas keep their
            // greedy mesh. This prevents Canvas floors painting over low beds.
            const span = c & FLOOR_DETAIL_BIT ? Math.max(1, Math.round(1 / unit)) : Infinity;
            let w = 1;
            while (w < span && i + w < nu && mask[n + w] === c) w++;
            let h = 1;
            for (; h < span && j + h < nv; h++) {
              let same = true;
              for (let x = 0; x < w && same; x++) same = mask[n + x + h * nu] === c;
              if (!same) break;
            }
            // (d, u, v) is cyclic, so this order faces +d
            const c0 = at(d, k, u, i, v, j), c1 = at(d, k, u, i + w, v, j), c2 = at(d, k, u, i + w, v, j + h), c3 = at(d, k, u, i, v, j + h);
            geo.faces.push({ i: c & DIR_BIT ? [c0, c1, c2, c3] : [c0, c3, c2, c1], color: palette[c & 0xff], emissive: 0, matrixCave: (c & ~FLOOR_DETAIL_BIT) >> 9, matrixLocalGlyphSurface: ((c & ~FLOOR_DETAIL_BIT) >> 9) !== 0 });
            for (let y = 0; y < h; y++) mask.fill(0, n + y * nu, n + y * nu + w);
            i += w;
            n += w;
          }
        }
      }
    }
    return geo;
  };
  // Keep only the carved labels near cave-owned render surfaces. The full
  // construction grid must not survive through a material-sampling closure.
  const compactCaveLabels = (labels, geometry, grid, unit, origin) => {
    const extents = new Int32Array(8 * 6), regions = [];
    for (let cave = 0; cave < 8; cave++) {
      const at = cave * 6;
      extents[at] = grid.sx; extents[at + 1] = grid.sy; extents[at + 2] = grid.sz;
      extents[at + 3] = extents[at + 4] = extents[at + 5] = -1;
    }
    const v = geometry.verts;
    for (const face of geometry.faces) {
      const cave = face.matrixCave || 0;
      if (cave < 1 || cave > 8) continue;
      const at = (cave - 1) * 6;
      for (const vertex of face.i) {
        const n = vertex * 3, x = Math.floor((v[n] - origin.x) / unit), y = Math.floor((v[n + 1] - origin.y) / unit), z = Math.floor((v[n + 2] - origin.z) / unit);
        extents[at] = Math.min(extents[at], x); extents[at + 1] = Math.min(extents[at + 1], y); extents[at + 2] = Math.min(extents[at + 2], z);
        extents[at + 3] = Math.max(extents[at + 3], x); extents[at + 4] = Math.max(extents[at + 4], y); extents[at + 5] = Math.max(extents[at + 5], z);
      }
    }
    let bytes = 0;
    for (let cave = 0; cave < 8; cave++) {
      const at = cave * 6;
      if (extents[at + 3] < 0) continue;
      const x = Math.max(0, extents[at] - 1), y = Math.max(0, extents[at + 1] - 1), z = Math.max(0, extents[at + 2] - 1);
      const sx = Math.min(grid.sx, extents[at + 3] + 2) - x, sy = Math.min(grid.sy, extents[at + 4] + 2) - y, sz = Math.min(grid.sz, extents[at + 5] + 2) - z;
      const data = new Uint8Array(sx * sy * sz);
      for (let dx = 0; dx < sx; dx++) for (let dy = 0; dy < sy; dy++) {
        const source = ((x + dx) * grid.sy + y + dy) * grid.sz + z, target = (dx * sy + dy) * sz;
        for (let dz = 0; dz < sz; dz++) {
          const label = labels[source + dz];
          if (label > 0 && label <= 8) data[target + dz] = label;
        }
      }
      regions.push({ x, y, z, sx, sy, sz, data }); bytes += data.byteLength;
    }
    return { regions, bytes };
  };
  // Smooth value noise, three octaves, roughly 0..1
  const LATTICE = 64;
  const valueNoise = (rand) => {
    const cells = new Float32Array(LATTICE * LATTICE);
    for (let i = 0; i < cells.length; i++) cells[i] = rand();
    const at = (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const tx = fx * fx * (3 - 2 * fx), ty = fy * fy * (3 - 2 * fy);
      const x0 = ix & (LATTICE - 1), x1 = (ix + 1) & (LATTICE - 1);
      const y0 = (iy & (LATTICE - 1)) * LATTICE, y1 = ((iy + 1) & (LATTICE - 1)) * LATTICE;
      const a = cells[y0 + x0] + (cells[y0 + x1] - cells[y0 + x0]) * tx;
      const b = cells[y1 + x0] + (cells[y1 + x1] - cells[y1 + x0]) * tx;
      return a + (b - a) * ty;
    };
    return (x, y) => at(x, y) * 0.6 + at(x * 2.1 + 17.3, y * 2.1 + 5.7) * 0.3 + at(x * 4.3 + 3.1, y * 4.3 + 11.9) * 0.1;
  };
  const smooth = (t) => {
    const k = clamp(t, 0, 1);
    return k * k * (3 - 2 * k);
  };

  // ---------- hub island ----------
  // Quarter-unit cells, clocks running clockwise from -z
  const UNIT = 0.25;
  const SX = 248, SY = 156, SZ = 248;
  // Paths sit on a grid twice as fine as the voxels, so their edges step at half a voxel
  const PX = SX * 2, PZ = SZ * 2;
  const SURFACE = 120;
  const ORIGIN = { x: -SX / 2 * UNIT, y: -SURFACE * UNIT, z: -SZ / 2 * UNIT };
  const RADIUS = 30, MEADOW = 22, DEPTH = RADIUS / Math.SQRT2;
  const UNDER_SPHERE_RADIUS = DEPTH * 1.5;
  const UNDER_SPHERE_CENTER = DEPTH - UNDER_SPHERE_RADIUS;
  const MAX_HEIGHT = 8;
  const BLUFF = 6;
  const MOUTH = { w: 5, h: 3, depth: 5 };
  const ROOM = { w: 6, h: 4, from: 2.5, to: 6.5 };
  const PATH_HALF = 0.75;
  const PATH_UNIT = UNIT / 2;
  const PATH_CAPACITY = 32768;
  const PATH_LIFT = 0.006;
  const MASTER_PATH_CENTER = 2;
  const GATE_Z = -(RADIUS - 2), PASS_HALF = 2.5, PASS_TOP = 5, TRAIL_HALF = 1;
  // Bluff, apron and trail measures
  const BLUFF_LEN = 8, SIDE_OUT = 2.5, APRON = 3, TRAIL_LEAN = 1.2;
  const P = { grass: 1, grassLight: 2, grassDark: 3, path: 4, stone: 5, stoneDark: 6, inner: 7, dirt: 8, floor: 9 };
  const PALETTE = [null, "#6f7d3e", "#7b8945", "#65733a", "#a3874f", "#877869", "#5e5449", "#2f2824", "#6a4e39", "#3a302a"].map((hex) => hex && hexToRgb(hex));
  const PATH_TILE = {
    verts: [-PATH_UNIT / 2, 0, -PATH_UNIT / 2, PATH_UNIT / 2, 0, -PATH_UNIT / 2, PATH_UNIT / 2, 0, PATH_UNIT / 2, -PATH_UNIT / 2, 0, PATH_UNIT / 2],
    faces: [{ i: [0, 3, 2, 1], color: PALETTE[P.path], emissive: 0 }],
    lines: [],
    depthOffset: true
  };
  const UNDER_BANDS = [P.dirt, P.stoneDark, P.dirt, P.stone];
  const undersideDepthAt = (radius) => Math.max(0, UNDER_SPHERE_CENTER + Math.sqrt(Math.max(0, UNDER_SPHERE_RADIUS * UNDER_SPHERE_RADIUS - radius * radius)));
  const undersideRadiusAt = (floor) => {
    const reach = -floor - UNDER_SPHERE_CENTER;
    return Math.sqrt(Math.max(0, UNDER_SPHERE_RADIUS * UNDER_SPHERE_RADIUS - reach * reach));
  };
  // Slot, its ring clock, and its tunnel clock
  const CLOCKS = [["c11", 11], ["c10", 10], ["c9", 9], ["c730", 7.25, 10.25], ["c1", 1], ["c2", 2], ["c3", 3], ["c5", 4.75, 1.75]];
  const HEADQUARTERS_CAVE = 9;
  const HEADQUARTERS_FLOOR = -7;
  const HEADQUARTERS_CEILING = -2.75;
  const HEADQUARTERS_HEIGHT = HEADQUARTERS_CEILING - HEADQUARTERS_FLOOR;
  const HEADQUARTERS_ROCK = 0.75;
  const HEADQUARTERS_ROOM = { x: 0, z: 0, radius: 14 };
  const HEADQUARTERS_RAMP_ARC = 1.4;
  const HEADQUARTERS_RAMP_SAMPLES = 96;
  const facing = (angle) => {
    const ry = (Math.PI * 2 - angle) % (Math.PI * 2);
    return ry > Math.PI ? ry - Math.PI * 2 : ry;
  };
  const segmentRectangle = (x, z, dx, dz, minX, maxX, minZ, maxZ, lo, hi) => {
    if (!dx) { if (x <= minX || x >= maxX) return false; }
    else {
      const a = (minX - x) / dx, b = (maxX - x) / dx;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    }
    if (!dz) { if (z <= minZ || z >= maxZ) return false; }
    else {
      const a = (minZ - z) / dz, b = (maxZ - z) / dz;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    }
    return lo < hi - 1e-9;
  };
  // Exact moving vertical cylinder against a box. The horizontal footprint is
  // the box's two expanded strips plus four round corners; no scratch arrays.
  const segmentBoxClear = (x, y, z, dx, dy, dz, radius, height, minX, minY, minZ, maxX, maxY, maxZ) => {
    radius = Math.max(0, radius - 1e-7);
    minY += 1e-7 - height; maxY -= 1e-7;
    let lo = 0, hi = 1;
    if (!dy) { if (y <= minY || y >= maxY) return true; }
    else {
      const a = (minY - y) / dy, b = (maxY - y) / dy;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      if (lo >= hi - 1e-9) return true;
    }
    if (segmentRectangle(x, z, dx, dz, minX - radius, maxX + radius, minZ, maxZ, lo, hi) || segmentRectangle(x, z, dx, dz, minX, maxX, minZ - radius, maxZ + radius, lo, hi)) return false;
    const span2 = dx * dx + dz * dz;
    for (let corner = 0; corner < 4; corner++) {
      const cx = x - (corner & 1 ? maxX : minX), cz = z - (corner & 2 ? maxZ : minZ), c = cx * cx + cz * cz - radius * radius;
      if (!span2) { if (c < 0) return false; continue; }
      const b = cx * dx + cz * dz, discriminant = b * b - span2 * c;
      if (discriminant <= 0) continue;
      const root = Math.sqrt(discriminant);
      if (Math.max(lo, (-b - root) / span2) < Math.min(hi, (-b + root) / span2) - 1e-9) return false;
    }
    return true;
  };
  // Build-time clipping keeps the window's sloping stone inside the original
  // island shell. Every remaining piece is convex, sharing one terrain mesh.
  const cutCube = (x, y, z, size) => {
    const p = [[x, y, z], [x + size, y, z], [x + size, y + size, z], [x, y + size, z], [x, y, z + size], [x + size, y, z + size], [x + size, y + size, z + size], [x, y + size, z + size]];
    return [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [0, 1, 5, 4], [3, 7, 6, 2]].map((indices) => ({ points: indices.map((i) => p[i]), reveal: false }));
  };
  // Math.hypot is never below its largest component, so only near-coincident points reach it.
  const near = (points, p) => {
    for (let n = 0; n < points.length; n++) {
      const q = points[n], dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
      if (Math.abs(dx) < 2e-7 && Math.abs(dy) < 2e-7 && Math.abs(dz) < 2e-7 && Math.hypot(dx, dy, dz) < 1e-7) return n;
    }
    return -1;
  };
  const clipCut = (faces, plane, direction, windowIndex) => {
    const nx = plane[0] * direction, ny = plane[1] * direction, nz = plane[2] * direction, offset = plane[3] * direction;
    let inside = false, outside = false;
    for (const face of faces) for (const p of face.points) {
      const distance = nx * p[0] + ny * p[1] + nz * p[2] - offset;
      if (distance < -1e-8) inside = true;
      if (distance > 1e-8) outside = true;
    }
    if (!inside) return null;
    if (!outside) return faces;
    const clipped = [], rim = [];
    for (const face of faces) {
      const points = [];
      for (let i = 0; i < face.points.length; i++) {
        const a = face.points[i], b = face.points[(i + 1) % face.points.length];
        const da = nx * a[0] + ny * a[1] + nz * a[2] - offset, db = nx * b[0] + ny * b[1] + nz * b[2] - offset;
        if (da <= 1e-8) points.push(a);
        if (da < -1e-8 && db > 1e-8 || da > 1e-8 && db < -1e-8) {
          const k = da / (da - db), p = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
          points.push(p);
          if (near(rim, p) < 0) rim.push(p);
        } else if (Math.abs(da) <= 1e-8 && near(rim, a) < 0) rim.push(a);
      }
      if (points.length >= 3) clipped.push({ points, reveal: face.reveal, windowIndex: face.windowIndex });
    }
    if (rim.length >= 3) {
      const center = [0, 0, 0];
      for (const p of rim) for (let i = 0; i < 3; i++) center[i] += p[i] / rim.length;
      const length = Math.hypot(nx, ny, nz), normal = [nx / length, ny / length, nz / length];
      const axis = Math.abs(normal[1]) < 0.9 ? [normal[2], 0, -normal[0]] : [0, -normal[2], normal[1]];
      const axisLength = Math.hypot(...axis); for (let i = 0; i < 3; i++) axis[i] /= axisLength;
      const tangent = [normal[1] * axis[2] - normal[2] * axis[1], normal[2] * axis[0] - normal[0] * axis[2], normal[0] * axis[1] - normal[1] * axis[0]];
      const angle = (p) => Math.atan2((p[0] - center[0]) * tangent[0] + (p[1] - center[1]) * tangent[1] + (p[2] - center[2]) * tangent[2], (p[0] - center[0]) * axis[0] + (p[1] - center[1]) * axis[1] + (p[2] - center[2]) * axis[2]);
      rim.sort((a, b) => angle(a) - angle(b));
      clipped.push({ points: rim, reveal: true, windowIndex });
    }
    return clipped;
  };
  const clipReveal = (points, plane) => {
    const result = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const da = plane[0] * a[0] + plane[1] * a[1] + plane[2] * a[2] - plane[3], db = plane[0] * b[0] + plane[1] * b[1] + plane[2] * b[2] - plane[3];
      if (da <= 1e-8) result.push(a);
      if (da < -1e-8 && db > 1e-8 || da > 1e-8 && db < -1e-8) {
        const k = da / (da - db);
        result.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
      }
    }
    return result.length >= 3 ? result : null;
  };
  const ISLANDS = new Map();
  const island = ({ seed = 1 } = {}) => {
    const hit = ISLANDS.get(seed);
    if (hit) return hit;
    const rand = mulberry32(seed);
    const noise = valueNoise(rand);
    // A spoke from the ring path to the cliff face
    const spoke = (angle, axis = angle) => {
      const ox = Math.sin(axis), oz = -Math.cos(axis);
      const lean = Math.cos(angle) * ox + Math.sin(angle) * oz;
      const sign = rand() < 0.5 ? -1 : 1, amp = 0.8 + rand() * 0.7;
      const reach = MEADOW + (lean ? SIDE_OUT : 0);
      return { angle, axis, ox, oz, lean, x: Math.sin(angle) * reach, z: -Math.cos(angle) * reach, e: UNIT / 2 * (Math.abs(ox) + Math.abs(oz)) - 1e-6, wobble: (lean ? -Math.sign(lean) : sign) * amp };
    };
    const frames = CLOCKS.map(([id, clock, axis = clock]) => ({ id, clock, ...spoke(clock / 12 * Math.PI * 2, axis / 12 * Math.PI * 2) }));
    const pass = spoke(0);
    const spokes = [...frames.filter((frame) => frame.id !== "c730" && frame.id !== "c5"), pass, spoke(Math.PI)];
    const headquartersFrames = [frames.find((f) => f.id === "c730"), frames.find((f) => f.id === "c5")];
    const headquartersFronts = headquartersFrames.map((f) => ({
      id: f.id,
      center: { x: f.x - f.ox * 1.6, z: f.z - f.oz * 1.6 },
      tangent: { x: -f.oz, z: f.ox },
      halfLength: 4.75,
      halfWidth: 1
    }));
    const grid = makeGrid(SX, SY, SZ);
    // Ownership follows carved empty cells, so merged exterior faces cannot inherit
    // a cave's local Matrix layer merely because they share a bounding box.
    let matrixCaves = new Uint8Array(grid.data.length);
    // Exact carved column ownership, floor and ceiling in quarter-unit cells.
    // Six bits apiece cover -8..7.5; ceiling 63 means open sky.
    const cavities = new Uint16Array(SX * SZ);
    const lowerCavities = new Uint16Array(SX * SZ);
    // Basement intervals have their own six-bit range, -16..-0.25.
    const basementCavities = new Uint16Array(SX * SZ);
    const basementCells = new Uint8Array(SX * SZ);
    const basementCollision = new Uint32Array(SX * SZ);
    const basementHeights = new Float32Array((SX + 1) * (SZ + 1));
    const rampCells = new Uint8Array(SX * SZ);
    const frontageCells = new Uint8Array(SX * SZ);
    const rampCollision = new Uint32Array(SX * SZ);
    const rampHeights = new Float32Array((SX + 1) * (SZ + 1));
    const height = new Float32Array(SX * SZ);
    const paths = new Uint8Array(PX * PZ);
    const meadow = new Uint8Array(SX * SZ);
    // Walkable top, colour and underside per column
    const NONE = -SY;
    let tops = new Float32Array(SX * SZ).fill(NONE);
    let surfaces = new Uint8Array(SX * SZ);
    let bottoms = new Uint8Array(SX * SZ);
    // Colours sample a half-unit lattice so quads merge
    const q = (w) => Math.floor(w * 2) / 2;
    // Seamless noise around the island, by sector
    const around = (theta, k, c) => noise(Math.cos(theta) * k + c, Math.sin(theta) * k + c);
    const grassAt = (wx, wz) => {
      const g = noise(q(wx) / 3 + 120, q(wz) / 3 + 60);
      return g < 0.38 ? P.grassDark : g < 0.68 ? P.grass : P.grassLight;
    };
    // Blocky stone and dirt strata on cliff faces
    const strata = (wx, wz, gy) => {
      const s = noise(q(wx) / 2 + q(gy * UNIT) * 1.8 + 400, q(wz) / 2 + 400);
      return s < 0.35 ? P.stoneDark : s < 0.7 ? P.stone : P.dirt;
    };
    const shapeColumn = (gx, gz, wx) => {
      const wz = (gz + 0.5) * UNIT + ORIGIN.z;
      const i = gx * SZ + gz;
      const r = Math.hypot(wx, wz);
      if (r >= RADIUS) return;
      // Flatten a bluff and apron around each mouth
      let bluff = 0, apron = false;
      for (const f of frames) {
        const dx = wx - f.x, dz = wz - f.z;
        const along = dx * f.ox + dz * f.oz, across = Math.abs(dz * f.ox - dx * f.oz);
        if (along > -f.e && across < 5) bluff = Math.max(bluff, (1 - smooth((across - 3) / 2)) * (1 - smooth((along - BLUFF_LEN) / 2)));
        else if (f.lean && along > -APRON && across < 3.5) {
          apron = true;
          // The old cave apron and its extended frontage form the same
          // corridor. Keep that union's identity through greedy meshing.
          const frontage = headquartersFrames.indexOf(f);
          if (frontage >= 0) frontageCells[i] = frontage + 1;
        }
      }
      const theta = Math.atan2(wx, -wz);
      // The rim erodes, except around the mouths
      const rim = bluff > 0 ? r : r + (noise(wx / 6 + 40, wz / 6 + 40) - 0.5) * 2 + (around(theta, 3, 120) - 0.5) * 4;
      if (rim >= RADIUS) return;
      // Edge, slope and plateau vary by sector
      let near = 0;
      for (const f of frames) near = Math.max(near, 1 - smooth((Math.hypot(wx - f.x, wz - f.z) - 5) / 5));
      const edge = MEADOW + (around(theta, 2.2, 30) - 0.5) * 7 * (1 - near);
      const ramp = 3 + around(theta, 1.7, 60) * 6;
      const plateau = 2.5 + around(theta, 1.4, 90) * 5;
      let top = 0, surface = grassAt(wx, wz);
      if (r < edge && bluff <= 0) {
        meadow[i] = 1;
      } else {
        // Terraces to a plateau, dipping at rim and six
        let h = 0.4 + (plateau + noise(wx / 12 + 80, wz / 12 + 80) * 2.5) * smooth((r - edge) / ramp) - 1.2 * smooth((r - (RADIUS - 2)) / 2) + (noise(wx / 5 + 20, wz / 5 + 20) - 0.5) * 1.2;
        h *= 1 - 0.6 * smooth(1 - (Math.PI - Math.abs(theta)) / 0.5);
        const crest = BLUFF + noise(wx / 4 + 500, wz / 4 + 500) * 1.5;
        if (h < crest) h += (crest - h) * bluff;
        const patch = noise(q(wx) / 4 + 700, q(wz) / 4 + 700);
        if (apron) h = 0;
        else if (patch <= 0.58) surface = patch < 0.3 ? P.stoneDark : P.stone;
        if (Math.abs(wx) < PASS_HALF && wz < 0) {
          h = Math.min(PASS_TOP, Math.floor((r - MEADOW) / UNIT) * UNIT);
          surface = grassAt(wx, wz);
        }
        top = clamp(Math.round(h / UNIT) * UNIT, 0, MAX_HEIGHT);
      }
      // Carry the ground-level frontage across the outer ridge without
      // lowering any column behind the headquarters doorway plane.
      for (let fi = 0; fi < headquartersFronts.length; fi++) {
        const front = headquartersFronts[fi];
        const dx = wx - front.center.x, dz = wz - front.center.z;
        const across = dx * front.tangent.x + dz * front.tangent.z, depth = dx * -front.tangent.z + dz * front.tangent.x;
        const padding = UNIT / 2 * (Math.abs(front.tangent.x) + Math.abs(front.tangent.z));
        if (Math.abs(across) < front.halfLength + padding && Math.abs(depth) < front.halfWidth + padding && depth > -1.1) {
          top = 0;
          surface = grassAt(wx, wz);
          meadow[i] = 1;
          frontageCells[i] = fi + 1;
          break;
        }
      }
      // A voxel-stepped bottom-third spherical cap under the unchanged playable surface
      const depth = undersideDepthAt(r);
      tops[i] = top;
      surfaces[i] = surface;
      bottoms[i] = Math.max(0, SURFACE - 1 - Math.floor(depth / UNIT));
    };
    for (let gx = 0; gx < SX; gx++) {
      const wx = (gx + 0.5) * UNIT + ORIGIN.x;
      for (let gz = 0; gz < SZ; gz++) shapeColumn(gx, gz, wx);
    }
    // Fill columns, with stone showing at step edges
    const row = (j) => tops[j] === NONE ? -1 : SURFACE - 1 + Math.round(tops[j] / UNIT);
    const { data } = grid;
    for (let gx = 0; gx < SX; gx++) {
      const wx = (gx + 0.5) * UNIT + ORIGIN.x;
      for (let gz = 0; gz < SZ; gz++) {
        const i = gx * SZ + gz;
        const top = tops[i];
        if (top === NONE) continue;
        const wz = (gz + 0.5) * UNIT + ORIGIN.z;
        const gyTop = SURFACE - 1 + Math.round(top / UNIT);
        const band = Math.floor(noise(q(wx) / 6 + 300, q(wz) / 6 + 300) * 3);
        const edge = top > 0 && top - Math.min(tops[i - SZ], tops[i + SZ], tops[i - 1], tops[i + 1]) >= 1;
        const walled = Math.min(row(i - SZ), row(i + SZ), row(i - 1), row(i + 1));
        const column = (gx * SY) * SZ + gz;
        for (let gy = bottoms[i]; gy <= gyTop; gy++) {
          data[column + gy * SZ] = gy === gyTop && !edge ? surfaces[i] : gy < SURFACE ? UNDER_BANDS[Math.floor((SURFACE - 1 - gy + band * 2) / 6) % 4] : gy <= walled && gy < gyTop ? P.stone : strata(wx, wz, gy);
        }
      }
    }
    const encodeCavity = (caveIndex, floor, ceiling, offset = 32) => {
      const floorCell = Math.round(floor / UNIT) + offset;
      const ceilingCell = Number.isFinite(ceiling) ? Math.round(ceiling / UNIT) + offset : 63;
      return caveIndex | (floorCell << 4) | (ceilingCell << 10);
    };
    // Carve tunnel and room as rotated boxes
    const carve = (f, caveIndex) => {
      const e = f.e;
      const cx = f.x + f.ox * 4, cz = f.z + f.oz * 4;
      const gx0 = Math.max(0, Math.floor((cx - 7 - ORIGIN.x) / UNIT)), gx1 = Math.min(SX - 1, Math.ceil((cx + 7 - ORIGIN.x) / UNIT));
      const gz0 = Math.max(0, Math.floor((cz - 7 - ORIGIN.z) / UNIT)), gz1 = Math.min(SZ - 1, Math.ceil((cz + 7 - ORIGIN.z) / UNIT));
      const columns = [];
      for (let gx = gx0; gx <= gx1; gx++) {
        const wx = (gx + 0.5) * UNIT + ORIGIN.x;
        for (let gz = gz0; gz <= gz1; gz++) {
          const wz = (gz + 0.5) * UNIT + ORIGIN.z;
          const dx = wx - f.x, dz = wz - f.z;
          const along = dx * f.ox + dz * f.oz, across = Math.abs(dz * f.ox - dx * f.oz);
          const room = along > ROOM.from - e && along < ROOM.to + e && across < ROOM.w / 2 + e;
          if (!room && !(along > -0.5 && along < MOUTH.depth + e && across < MOUTH.w / 2 + e)) continue;
          const gyTop = SURFACE - 1 + Math.round((room ? ROOM.h : MOUTH.h) / UNIT);
          for (let gy = SURFACE; gy <= gyTop; gy++) {
            grid.set(gx, gy, gz, 0);
            // The opening lies at local z=.5; the exterior rim remains global.
            if (along > e - 0.48) matrixCaves[grid.index(gx, gy, gz)] = caveIndex;
          }
          if (grid.has(gx, SURFACE - 1, gz)) {
            const ceiling = grid.has(gx, gyTop + 1, gz) ? Math.round((gyTop + 1 - SURFACE) * UNIT) : 0;
            cavities[gx * SZ + gz] = encodeCavity(caveIndex, 0, ceiling || Infinity);
          }
          if (along > -e) columns.push(gx, gyTop, gz);
        }
      }
      for (let i = 0; i < columns.length; i += 3) {
        const gx = columns[i], gyTop = columns[i + 1], gz = columns[i + 2];
        if (grid.has(gx, SURFACE - 1, gz)) grid.set(gx, SURFACE - 1, gz, P.floor);
        if (grid.has(gx, gyTop + 1, gz)) grid.set(gx, gyTop + 1, gz, P.inner);
        for (let gy = SURFACE; gy <= gyTop; gy++) {
          if (grid.has(gx + 1, gy, gz)) grid.set(gx + 1, gy, gz, P.inner);
          if (grid.has(gx - 1, gy, gz)) grid.set(gx - 1, gy, gz, P.inner);
          if (grid.has(gx, gy, gz + 1)) grid.set(gx, gy, gz + 1, P.inner);
          if (grid.has(gx, gy, gz - 1)) grid.set(gx, gy, gz - 1, P.inner);
        }
      }
    };
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].id !== "c730" && frames[i].id !== "c5") carve(frames[i], i + 1);
    }
    const headquartersRamps = headquartersFrames.map((f, i) => {
      const from = { x: f.x - f.ox * 0.5, z: f.z - f.oz * 0.5 };
      const startAngle = Math.atan2(from.x, -from.z), direction = i ? -1 : 1;
      const startRadius = Math.hypot(from.x, from.z), endRadius = HEADQUARTERS_ROOM.radius - 0.8;
      const samples = [];
      for (let n = 0; n <= HEADQUARTERS_RAMP_SAMPLES; n++) {
        const t = n / HEADQUARTERS_RAMP_SAMPLES;
        const angle = startAngle + direction * HEADQUARTERS_RAMP_ARC * t;
        const radius = startRadius + (endRadius - startRadius) * smooth((t - 0.38) / 0.62);
        samples.push({ x: Math.sin(angle) * radius, z: -Math.cos(angle) * radius, y: HEADQUARTERS_FLOOR * Math.min(t / 0.54, 1), t });
      }
      const to = samples[samples.length - 1];
      return { id: f.id, from, to: { x: to.x, z: to.z }, width: 4, startAngle, endAngle: startAngle + direction * HEADQUARTERS_RAMP_ARC, direction, slope: -samples[1].y / Math.hypot(samples[1].x - from.x, samples[1].z - from.z), axis: { x: f.ox, z: f.oz }, samples };
    });
    const headquartersRooms = [120, 138, 152, 166, 180, 194, 208, 238, 255].map((degrees, index) => {
      const angle = degrees / 180 * Math.PI, sx = Math.sin(angle), sz = -Math.cos(angle);
      const radius = 23.25, width = 5, depth = 5;
      return { index, angle, radius, window: true, floor: HEADQUARTERS_FLOOR, ceiling: HEADQUARTERS_CEILING, height: HEADQUARTERS_HEIGHT, x: sx * radius, z: sz * radius, width, depth, approach: { x: sx * 13.25, z: sz * 13.25 }, entrance: { x: sx * 18.5, z: sz * 18.5 }, back: { x: sx * (radius + depth / 2 - 0.2), z: sz * (radius + depth / 2 - 0.2) } };
    }).filter((room) => room.index >= 2 && room.index <= 6);
    const headquartersGallery = { startAngle: -39.5 * Math.PI / 180, endAngle: 39.5 * Math.PI / 180, radius: 24.5 };
    // Broad, level offshoots grow from the flat ends of both entrance ramps.
    // The outer edge follows the ramp only after it has reached this floor;
    // the last ramp window remains above the cut while the side rooms stay
    // behind the opposite edge.
    const headquartersBalconies = [-1, 1].map((side) => ({
      side,
      startAngle: side < 0 ? -100 * Math.PI / 180 : 63 * Math.PI / 180,
      endAngle: side < 0 ? -63 * Math.PI / 180 : 100 * Math.PI / 180,
      radius: undersideRadiusAt(HEADQUARTERS_FLOOR),
      openingRadius: undersideRadiusAt(HEADQUARTERS_CEILING),
      floor: HEADQUARTERS_FLOOR,
      ceiling: HEADQUARTERS_CEILING
    }));
    // The two spare nooks open sideways off the window gallery, away from the
    // clear ramp landings. Their entrances face the gallery, not the island centre.
    for (const side of [-1, 1]) {
      const edge = side < 0 ? headquartersGallery.startAngle : headquartersGallery.endAngle, angle = edge + side * Math.PI / 2;
      const edgeRadius = 21.25, width = 7, depth = 6;
      const sx = Math.sin(angle), sz = -Math.cos(angle), edgeX = Math.sin(edge) * edgeRadius, edgeZ = -Math.cos(edge) * edgeRadius;
      // The window faces outward through the long side wall, not toward the ramp.
      const x = edgeX + sx * 3.7, z = edgeZ + sz * 3.7, windowScale = (edgeRadius + width / 2 - 0.2) / edgeRadius;
      // Keep the frame's front outside the gallery so its corners leave turning room.
      headquartersRooms.push({ index: side < 0 ? 9 : 10, angle, radius: Math.hypot(x, z), window: true, floor: HEADQUARTERS_FLOOR, ceiling: HEADQUARTERS_CEILING, height: HEADQUARTERS_HEIGHT, windowAngle: Math.atan2(x, -z), windowAt: { x: x * windowScale, z: z * windowScale }, nook: true, x, z, width, depth, approach: { x: edgeX - sx * 1.1, z: edgeZ - sz * 1.1 }, entrance: { x: edgeX + sx * 0.35, z: edgeZ + sz * 0.35 }, back: { x: x + sx * (depth / 2 - 0.2), z: z + sz * (depth / 2 - 0.2) } });
    }
    const carveHeadquartersColumn = (gx, gz, floor, ceiling, deep = false, ceilingMaterial = P.inner) => {
      const floorGy = SURFACE - 1 + Math.round(floor / UNIT);
      const ceilingGy = SURFACE + Math.round(ceiling / UNIT);
      grid.set(gx, floorGy, gz, P.floor);
      for (let gy = floorGy + 1; gy < ceilingGy; gy++) grid.set(gx, gy, gz, 0);
      if (grid.has(gx, ceilingGy, gz)) grid.set(gx, ceilingGy, gz, ceilingMaterial);
      if (!deep) lowerCavities[gx * SZ + gz] = encodeCavity(HEADQUARTERS_CAVE, floor, ceiling);
      for (let gy = floorGy + 1; gy < ceilingGy; gy++) {
        if (grid.has(gx + 1, gy, gz)) grid.set(gx + 1, gy, gz, strata((gx + 1) * UNIT + ORIGIN.x, gz * UNIT + ORIGIN.z, gy));
        if (grid.has(gx - 1, gy, gz)) grid.set(gx - 1, gy, gz, strata((gx - 1) * UNIT + ORIGIN.x, gz * UNIT + ORIGIN.z, gy));
        if (grid.has(gx, gy, gz + 1)) grid.set(gx, gy, gz + 1, strata(gx * UNIT + ORIGIN.x, (gz + 1) * UNIT + ORIGIN.z, gy));
        if (grid.has(gx, gy, gz - 1)) grid.set(gx, gy, gz - 1, strata(gx * UNIT + ORIGIN.x, (gz - 1) * UNIT + ORIGIN.z, gy));
      }
    };
    const carveBalconyOpening = (balcony) => {
      const reach = balcony.openingRadius + UNIT, gx0 = Math.max(0, Math.floor((-reach - ORIGIN.x) / UNIT)), gx1 = Math.min(SX - 1, Math.ceil((reach - ORIGIN.x) / UNIT));
      const gz0 = Math.max(0, Math.floor((-reach - ORIGIN.z) / UNIT)), gz1 = Math.min(SZ - 1, Math.ceil((reach - ORIGIN.z) / UNIT));
      const floorGy = SURFACE - 1 + Math.round(balcony.floor / UNIT), ceilingGy = SURFACE + Math.round(balcony.ceiling / UNIT);
      for (let gx = gx0; gx <= gx1; gx++) {
        const x = (gx + 0.5) * UNIT + ORIGIN.x;
        for (let gz = gz0; gz <= gz1; gz++) {
          const z = (gz + 0.5) * UNIT + ORIGIN.z, radius = Math.hypot(x, z);
          if (radius < balcony.radius || radius >= balcony.openingRadius) continue;
          const angle = Math.atan2(x, -z);
          if (!insideBalcony(balcony, radius, angle)) continue;
          for (let gy = floorGy + 1; gy < ceilingGy; gy++) grid.set(gx, gy, gz, 0);
        }
      }
    };
    const insideBalcony = (balcony, radius, angle) => {
      let start = balcony.startAngle, end = balcony.endAngle;
      const join = balcony.roomJoin;
      if (join && radius < join.toRadius) {
        const t = clamp((radius - join.fromRadius) / (join.toRadius - join.fromRadius), 0, 1);
        const boundary = join.angle + ((balcony.side < 0 ? end : start) - join.angle) * t;
        if (balcony.side < 0) end = boundary;
        else start = boundary;
      }
      return angle > start && angle < end;
    };
    const rampProbe = { distance: 0, floor: 0 };
    const sampleRamp = (ramp, x, z, out) => {
      let distance = Infinity, floor = 0, station = 0;
      for (let i = 1; i < ramp.samples.length; i++) {
        const a = ramp.samples[i - 1], b = ramp.samples[i], dx = b.x - a.x, dz = b.z - a.z;
        const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
        const ex = x - a.x - dx * t, ez = z - a.z - dz * t, d = ex * ex + ez * ez;
        if (d < distance) { distance = d; floor = a.y + (b.y - a.y) * t; if (ramp.basement) station = a.s + (b.s - a.s) * t; }
      }
      out.distance = Math.sqrt(distance);
      if (ramp.basement) { out.floor = floor; out.station = station; return; }
      const along = (x - ramp.from.x) * ramp.axis.x + (z - ramp.from.z) * ramp.axis.z;
      // A short planar throat meets the doorway exactly, then bends into the curve.
      const join = clamp((along - 1) / 0.75, 0, 1);
      out.floor = -Math.max(0, along) * ramp.slope * (1 - join) + floor * join;
    };
    const roomAxes = new Map();
    const insideRoom = (room, x, z) => {
      let axes = roomAxes.get(room);
      if (!axes) {
        // Room and corridor both lie within this radius of the room's centre
        const sx = Math.sin(room.angle), sz = -Math.cos(room.angle), approach = (room.approach.x - room.x) * sx + (room.approach.z - room.z) * sz;
        const reach = Math.hypot(Math.max(room.depth / 2, Math.abs(approach)), Math.max(room.width, room.corridorWidth ?? room.width - 1.3) / 2) + UNIT;
        roomAxes.set(room, axes = { sx, sz, reach2: reach * reach });
      }
      if ((x - room.x) * (x - room.x) + (z - room.z) * (z - room.z) > axes.reach2) return false;
      const sx = axes.sx, sz = axes.sz;
      const dx = x - room.x, dz = z - room.z, along = dx * sx + dz * sz, across = Math.abs(dx * -sz + dz * sx);
      const depth = Math.abs(along), approach = (room.approach.x - room.x) * sx + (room.approach.z - room.z) * sz;
      return across < room.width / 2 && depth < room.depth / 2 && across + depth < (room.width + room.depth) / 2 - 0.55 || along > approach && along < -room.depth / 2 + 1.15 && across < (room.corridorWidth ?? room.width - 1.3) / 2;
    };
    // Stone tunnel walls keep their voxels; their walking surfaces are continuous slopes.
    for (let ri = 0; ri < headquartersRamps.length; ri++) {
      const ramp = headquartersRamps[ri];
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const sample of ramp.samples) {
        minX = Math.min(minX, sample.x - ramp.width / 2);
        maxX = Math.max(maxX, sample.x + ramp.width / 2);
        minZ = Math.min(minZ, sample.z - ramp.width / 2);
        maxZ = Math.max(maxZ, sample.z + ramp.width / 2);
      }
      const gx0 = Math.max(0, Math.floor((minX - ORIGIN.x) / UNIT)), gx1 = Math.min(SX - 1, Math.ceil((maxX - ORIGIN.x) / UNIT));
      const gz0 = Math.max(0, Math.floor((minZ - ORIGIN.z) / UNIT)), gz1 = Math.min(SZ - 1, Math.ceil((maxZ - ORIGIN.z) / UNIT));
      for (let gx = gx0; gx <= gx1; gx++) {
        const wx = (gx + 0.5) * UNIT + ORIGIN.x;
        for (let gz = gz0; gz <= gz1; gz++) {
          const wz = (gz + 0.5) * UNIT + ORIGIN.z;
          sampleRamp(ramp, wx, wz, rampProbe);
          if (rampProbe.distance > ramp.width / 2 || (wx - ramp.from.x) * ramp.axis.x + (wz - ramp.from.z) * ramp.axis.z < -UNIT / 2) continue;
          const floor = rampProbe.floor;
          rampCells[gx * SZ + gz] = ri + 1;
          const frame = headquartersFrames[ri], dx = wx - frame.x, dz = wz - frame.z;
          const along = dx * frame.ox + dz * frame.oz, across = Math.abs(dz * frame.ox - dx * frame.oz);
          const ceiling = Math.ceil((floor + 3.5) / UNIT) * UNIT;
          // The ramp ceiling begins as an exposed lintel and remains visible
          // down the open stairwell. Keep it in the cliff palette throughout
          // instead of introducing a black interior-material strip.
          const ceilingMaterial = strata(wx, wz, SURFACE + Math.round(ceiling / UNIT));
          carveHeadquartersColumn(gx, gz, Math.max(HEADQUARTERS_FLOOR - UNIT, Math.floor(floor / UNIT) * UNIT - UNIT), ceiling, false, ceilingMaterial);
          if (along > frame.e - 0.48 && along < ROOM.to && across < ROOM.w / 2) {
            const index = frames.indexOf(frame) + 1;
            for (let gy = SURFACE + Math.floor(floor / UNIT) - 1; gy < SURFACE + Math.ceil((floor + 3.5) / UNIT); gy++) {
              if (!grid.has(gx, gy, gz)) matrixCaves[grid.index(gx, gy, gz)] = index;
            }
          }
        }
      }
    }
    const roomGX0 = Math.floor((-RADIUS - ORIGIN.x) / UNIT), roomGX1 = Math.ceil((RADIUS - ORIGIN.x) / UNIT);
    const roomGZ0 = Math.floor((-RADIUS - ORIGIN.z) / UNIT), roomGZ1 = Math.ceil((RADIUS - ORIGIN.z) / UNIT);
    for (let gx = roomGX0; gx <= roomGX1; gx++) {
      const wx = (gx + 0.5) * UNIT + ORIGIN.x;
      for (let gz = roomGZ0; gz <= roomGZ1; gz++) {
        const wz = (gz + 0.5) * UNIT + ORIGIN.z;
        const radius = Math.hypot(wx, wz), angle = Math.atan2(wx, -wz);
        let inside = radius < HEADQUARTERS_ROOM.radius || radius < headquartersGallery.radius && angle > headquartersGallery.startAngle && angle < headquartersGallery.endAngle;
        for (const balcony of headquartersBalconies) if (tops[gx * SZ + gz] !== NONE && radius < balcony.radius && insideBalcony(balcony, radius, angle)) inside = true;
        for (const room of headquartersRooms) {
          if (insideRoom(room, wx, wz)) inside = true;
        }
        if (!inside) continue;
        // Both ramps are level before they meet the common floor or personal caves.
        if (rampCells[gx * SZ + gz]) {
          sampleRamp(headquartersRamps[rampCells[gx * SZ + gz] - 1], wx, wz, rampProbe);
          if (rampProbe.floor > HEADQUARTERS_FLOOR) continue;
        }
        rampCells[gx * SZ + gz] = 0;
        carveHeadquartersColumn(gx, gz, HEADQUARTERS_FLOOR, HEADQUARTERS_CEILING);
      }
    }
    for (const balcony of headquartersBalconies) carveBalconyOpening(balcony);
    let rampGeometry = { verts: [], faces: [], lines: [] };
    for (let gx = 0; gx <= SX; gx++) {
      for (let gz = 0; gz <= SZ; gz++) {
        const ri = (gx < SX && gz < SZ && rampCells[gx * SZ + gz]) || (gx > 0 && gz < SZ && rampCells[(gx - 1) * SZ + gz]) || (gx < SX && gz > 0 && rampCells[gx * SZ + gz - 1]) || (gx > 0 && gz > 0 && rampCells[(gx - 1) * SZ + gz - 1]);
        if (!ri) continue;
        sampleRamp(headquartersRamps[ri - 1], gx * UNIT + ORIGIN.x, gz * UNIT + ORIGIN.z, rampProbe);
        rampHeights[gx * (SZ + 1) + gz] = rampProbe.floor;
      }
    }
    for (let gx = 0; gx < SX; gx++) {
      for (let gz = 0; gz < SZ; gz++) {
        if (!rampCells[gx * SZ + gz]) continue;
        const wx = gx * UNIT + ORIGIN.x, wz = gz * UNIT + ORIGIN.z, v = rampGeometry.verts.length / 3, i = gx * (SZ + 1) + gz;
        const ramp = headquartersRamps[rampCells[gx * SZ + gz] - 1];
        const corners = [[wx, rampHeights[i], wz], [wx, rampHeights[i + 1], wz + UNIT], [wx + UNIT, rampHeights[i + SZ + 2], wz + UNIT], [wx + UNIT, rampHeights[i + SZ + 1], wz]], clipped = [];
        for (let n = 0; n < 4; n++) {
          const a = corners[n], b = corners[(n + 1) % 4];
          const da = (a[0] - ramp.from.x) * ramp.axis.x + (a[2] - ramp.from.z) * ramp.axis.z, db = (b[0] - ramp.from.x) * ramp.axis.x + (b[2] - ramp.from.z) * ramp.axis.z;
          if (da >= 0) clipped.push(a);
          if ((da < 0) !== (db < 0)) { const t = da / (da - db); clipped.push([a[0] + (b[0] - a[0]) * t, 0, a[2] + (b[2] - a[2]) * t]); }
        }
        if (clipped.length < 3) continue;
        for (const p of clipped) rampGeometry.verts.push(...p);
        const frame = headquartersFrames[rampCells[gx * SZ + gz] - 1], dx = wx + UNIT / 2 - frame.x, dz = wz + UNIT / 2 - frame.z;
        const along = dx * frame.ox + dz * frame.oz, across = Math.abs(dz * frame.ox - dx * frame.oz);
        const cave = along > frame.e - 0.48 && along < ROOM.to && across < ROOM.w / 2 ? frames.indexOf(frame) + 1 : 0;
        // Curving slopes are not coplanar quads: glyphs and collision share the
        // renderer's exact triangles, including the clipped doorway boundary.
        rampCollision[gx * SZ + gz] = (rampGeometry.faces.length << 2) | (clipped.length - 2);
        for (let n = 1; n < clipped.length - 1; n++) rampGeometry.faces.push({ i: [v, v + n, v + n + 1], color: PALETTE[(Math.floor(gx / 4) + Math.floor(gz / 4)) % 5 === 0 ? P.stoneDark : P.floor], emissive: 0, headquartersRamp: true, matrixCave: cave, matrixWorldGlyphSurface: cave !== 0 });
      }
    }
    // The curved ramp tops are separate from their stepped voxel supports.
    // Close exposed boundary edges so balcony cuts cannot reveal that seam.
    for (let gx = 0; gx < SX; gx++) for (let gz = 0; gz < SZ; gz++) {
      const cell = gx * SZ + gz, ri = rampCells[cell];
      if (!ri) continue;
      const x = gx * UNIT + ORIGIN.x, z = gz * UNIT + ORIGIN.z, i = gx * (SZ + 1) + gz;
      const corners = [[x, rampHeights[i], z], [x, rampHeights[i + 1], z + UNIT], [x + UNIT, rampHeights[i + SZ + 2], z + UNIT], [x + UNIT, rampHeights[i + SZ + 1], z]];
      const base = (((lowerCavities[cell] >> 4) & 63) - 32) * UNIT;
      const neighbors = [gx ? rampCells[cell - SZ] : 0, gz + 1 < SZ ? rampCells[cell + 1] : 0, gx + 1 < SX ? rampCells[cell + SZ] : 0, gz ? rampCells[cell - 1] : 0];
      for (let edge = 0; edge < 4; edge++) {
        if (neighbors[edge] === ri) continue;
        const a = corners[edge], b = corners[(edge + 1) % 4];
        if (a[1] <= base + 1e-7 && b[1] <= base + 1e-7) continue;
        const v = rampGeometry.verts.length / 3;
        rampGeometry.verts.push(a[0], a[1], a[2], a[0], base, a[2], b[0], base, b[2], b[0], b[1], b[2]);
        rampGeometry.faces.push({ i: [v, v + 1, v + 2, v + 3], color: PALETTE[P.stoneDark], emissive: 0, headquartersRampSkirt: ri });
      }
    }
    // Build-time route geometry; heights are solved separately from the upper tunnels.
    const buildBasementRoute = (main, angle) => {
      const samples = [], first = 27;
      const inset = (point) => {
        const blend = Math.max(0, Math.min(1, (point.t - 0.78) / 0.22));
        // The high end reaches the outer shell; the lower arc follows its
        // narrowing underside with three solid voxels beneath the full width.
        const radius = Math.hypot(point.x, point.z), limit = 19 + 2.2 * (1 - smooth((point.t - 0.28) / 0.18));
        const outer = Math.max(1.4, radius - limit), shift = outer + (5.2 - outer) * blend * blend * (3 - 2 * blend), scale = (radius - shift) / radius;
        return { x: point.x * scale, z: point.z * scale };
      };
      const append = (x, z) => {
        const previous = samples[samples.length - 1];
        samples.push({ x, z, s: previous ? previous.s + Math.hypot(x - previous.x, z - previous.z) : 0 });
      };
      const curve = (a, b, c, d, count, skip) => {
        for (let n = skip; n <= count; n++) {
          const t = n / count, u = 1 - t;
          append(u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
            u * u * u * a.z + 3 * u * u * t * b.z + 3 * u * t * t * c.z + t * t * t * d.z);
        }
      };
      const sx = Math.sin(angle), sz = -Math.cos(angle), a = { x: sx * 14, z: sz * 14 };
      const end = inset(main.samples[first]), before = inset(main.samples[first - 1]), after = inset(main.samples[first + 1]);
      const scale = 3 / Math.hypot(after.x - before.x, after.z - before.z);
      curve(a, { x: sx * 19.75, z: sz * 19.75 },
        { x: end.x - (after.x - before.x) * scale, z: end.z - (after.z - before.z) * scale }, end, 40, 0);
      for (let n = first + 1; n < main.samples.length; n++) {
        const point = inset(main.samples[n]);
        append(point.x, point.z);
      }
      return { samples, mainId: main.id, width: 3.7, length: samples[samples.length - 1].s, firstMainSample: first, entrySamples: 40, from: samples[0], to: samples[samples.length - 1] };
    };
    const basement = { floor: HEADQUARTERS_FLOOR, ceiling: 0, height: HEADQUARTERS_HEIGHT, rockCover: HEADQUARTERS_ROCK, room: { x: 0, z: 0, radius: 9 }, rooms: [], ramps: [] };
    const basementHole = basement.hole = { x: 0, z: 0, radius: 4, mouthRadius: 4.5, rimDepth: 0.5, floor: 0, bottom: -Math.ceil(undersideDepthAt(0) / UNIT) * UNIT };
    basementHole.contains = (x, z) => {
      const dx = (Math.floor((x - ORIGIN.x) / UNIT) + 0.5) * UNIT + ORIGIN.x - basementHole.x;
      const dz = (Math.floor((z - ORIGIN.z) / UNIT) + 0.5) * UNIT + ORIGIN.z - basementHole.z;
      return dx * dx + dz * dz < basementHole.radius * basementHole.radius;
    };
    for (const [index, degrees] of [-50, -30, -10, 10, 30, 50, 146, 169, 191, 214].entries()) {
      const angle = degrees * Math.PI / 180, sx = Math.sin(angle), sz = -Math.cos(angle), radius = 18, width = Math.abs(degrees) <= 50 ? 5.5 : 5, depth = 5;
      basement.rooms.push({ index, basement: true, angle, radius, width, depth, corridorWidth: 2.6, height: HEADQUARTERS_HEIGHT, window: true, x: sx * radius, z: sz * radius, approach: { x: sx * 8.25, z: sz * 8.25 }, entrance: { x: sx * 9.25, z: sz * 9.25 }, back: { x: sx * (radius + depth / 2 - 0.2), z: sz * (radius + depth / 2 - 0.2) } });
    }
    for (const [index, degrees, mainId] of [[1, 130, "c5"], [7, 230, "c730"]]) {
      const angle = degrees * Math.PI / 180, ramp = buildBasementRoute(headquartersRamps.find((entry) => entry.id === mainId), angle);
      ramp.basement = true; ramp.index = index; ramp.angle = angle;
      ramp.entrance = { x: Math.sin(angle) * 14.5, y: HEADQUARTERS_FLOOR, z: -Math.cos(angle) * 14.5 };
      for (const sample of ramp.samples) sample.y = HEADQUARTERS_FLOOR;
      basement.ramps.push(ramp);
    }
    // The full lower footprint determines the shallowest shared level. Measure
    // from the bottom of the actual upper floor voxels, including both ramps.
    let basementRampBounds = basement.ramps.map((ramp) => {
      const reach = ramp.width / 2 + UNIT, bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const sample of ramp.samples) {
        bounds.minX = Math.min(bounds.minX, sample.x - reach); bounds.maxX = Math.max(bounds.maxX, sample.x + reach);
        bounds.minZ = Math.min(bounds.minZ, sample.z - reach); bounds.maxZ = Math.max(bounds.maxZ, sample.z + reach);
      }
      return bounds;
    });
    for (let gx = 0; gx < SX; gx++) for (let gz = 0; gz < SZ; gz++) {
      const x = (gx + 0.5) * UNIT + ORIGIN.x, z = (gz + 0.5) * UNIT + ORIGIN.z, i = gx * SZ + gz;
      let inside = Math.hypot(x, z) < basement.room.radius;
      for (const room of basement.rooms) if (insideRoom(room, x, z)) inside = true;
      if (inside) basementCells[i] = 3;
      else for (let ri = 0; ri < basement.ramps.length; ri++) {
        const ramp = basement.ramps[ri], bounds = basementRampBounds[ri];
        if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
        sampleRamp(ramp, x, z, rampProbe);
        if (rampProbe.distance <= ramp.width / 2) { basementCells[i] = ri + 1; break; }
      }
      if (!basementCells[i] || !lowerCavities[i]) continue;
      const floor = (((lowerCavities[i] >> 4) & 63) - 32) * UNIT;
      basement.floor = Math.min(basement.floor, floor - UNIT - HEADQUARTERS_ROCK - HEADQUARTERS_HEIGHT);
    }
    basement.clearanceDrop = HEADQUARTERS_FLOOR - basement.floor;
    basement.floor = Math.floor(basement.floor / UNIT) * UNIT;
    basement.ceiling = basement.floor + HEADQUARTERS_HEIGHT;
    basementHole.floor = basement.floor;
    for (const room of basement.rooms) { room.floor = basement.floor; room.ceiling = basement.ceiling; }
    // Ease the grade at the ends, then solve how far each ramp may take to
    // descend. The starting doorway is a connection, not two stacked rooms.
    const descentAt = (station, length) => {
      const ease = 0.5;
      if (station <= 0) return 0;
      if (station >= length) return 1;
      return (station < ease ? station * station / (2 * ease) : station > length - ease ? length - ease - (length - station) * (length - station) / (2 * ease) : station - ease / 2) / (length - ease);
    };
    for (let ri = 0; ri < basement.ramps.length; ri++) {
      const ramp = basement.ramps[ri], constraints = [];
      for (let gx = 0; gx < SX; gx++) for (let gz = 0; gz < SZ; gz++) {
        const i = gx * SZ + gz;
        if (basementCells[i] !== ri + 1 || !lowerCavities[i]) continue;
        const x = gx * UNIT + ORIGIN.x, z = gz * UNIT + ORIGIN.z;
        let station = Infinity;
        for (const [dx, dz] of [[0, 0], [UNIT, 0], [0, UNIT], [UNIT, UNIT]]) {
          sampleRamp(ramp, x + dx, z + dz, rampProbe);
          station = Math.min(station, rampProbe.station);
        }
        if (station < 1) continue;
        const floor = (((lowerCavities[i] >> 4) & 63) - 32) * UNIT;
        let sample = 1;
        while (sample < ramp.samples.length - 1 && ramp.samples[sample].s < station) sample++;
        const a = ramp.samples[sample - 1].s, b = ramp.samples[sample].s;
        constraints.push({ a, b, t: (station - a) / (b - a), ceiling: floor - UNIT - HEADQUARTERS_ROCK });
      }
      let lo = 1, hi = ramp.length;
      for (let n = 0; n < 24; n++) {
        const length = (lo + hi) / 2;
        const clear = constraints.every((p) => HEADQUARTERS_FLOOR + (basement.floor - HEADQUARTERS_FLOOR) * (descentAt(p.a, length) * (1 - p.t) + descentAt(p.b, length) * p.t) + HEADQUARTERS_HEIGHT <= p.ceiling);
        if (clear) lo = length; else hi = length;
      }
      ramp.descentLength = lo;
      for (const sample of ramp.samples) sample.y = HEADQUARTERS_FLOOR + (basement.floor - HEADQUARTERS_FLOOR) * descentAt(sample.s, lo);
      sampleRamp(ramp, ramp.entrance.x, ramp.entrance.z, rampProbe);
      ramp.entrance.y = rampProbe.floor;
    }
    // The lower balconies match the arcs above, beginning beyond the six-room
    // bank and ending where both basement ramps have finished descending. They
    // stop at this floor's own tapered cliff edge.
    basement.balconies = [-1, 1].map((side) => {
      const room = basement.rooms[side < 0 ? 0 : 5], fromRadius = Math.hypot(room.entrance.x, room.entrance.z);
      const archHalfAngle = Math.asin((room.corridorWidth / 2 + UNIT * 2) / fromRadius);
      return {
        side,
        startAngle: side < 0 ? -100 * Math.PI / 180 : 63 * Math.PI / 180,
        endAngle: side < 0 ? -63 * Math.PI / 180 : 100 * Math.PI / 180,
        roomJoin: { angle: room.angle + side * archHalfAngle, fromRadius, toRadius: 14.25 },
        radius: undersideRadiusAt(basement.floor),
        openingRadius: undersideRadiusAt(basement.ceiling),
        floor: basement.floor,
        ceiling: basement.ceiling
      };
    });
    basement.connectors = [];
    const basementRoutes = basement.ramps, basementCommon = 3;
    for (let gx = 0; gx < SX; gx++) {
      const x = (gx + 0.5) * UNIT + ORIGIN.x;
      for (let gz = 0; gz < SZ; gz++) {
        const z = (gz + 0.5) * UNIT + ORIGIN.z, cell = gx * SZ + gz, radius = Math.hypot(x, z), angle = Math.atan2(x, -z);
        for (const balcony of basement.balconies) if (tops[cell] !== NONE && radius < balcony.radius && insideBalcony(balcony, radius, angle)) basementCells[cell] = basementCommon;
      }
    }
    // The slopes use the same two triangles per voxel as their support queries.
    for (let gx = 0; gx <= SX; gx++) for (let gz = 0; gz <= SZ; gz++) {
      let ri = 0;
      for (let dx = -1; dx <= 0; dx++) for (let dz = -1; dz <= 0; dz++) {
        const x = gx + dx, z = gz + dz, cell = x >= 0 && z >= 0 && x < SX && z < SZ ? basementCells[x * SZ + z] : 0;
        if (cell && cell < basementCommon) ri = cell;
      }
      if (!ri) continue;
      sampleRamp(basementRoutes[ri - 1], gx * UNIT + ORIGIN.x, gz * UNIT + ORIGIN.z, rampProbe);
      basementHeights[gx * (SZ + 1) + gz] = rampProbe.floor;
    }
    for (let gx = 0; gx < SX; gx++) for (let gz = 0; gz < SZ; gz++) {
      const cell = gx * SZ + gz, ri = basementCells[cell];
      if (!ri) continue;
      const x = gx * UNIT + ORIGIN.x, z = gz * UNIT + ORIGIN.z, i = gx * (SZ + 1) + gz;
      const a = ri < basementCommon ? basementHeights[i] : basement.floor, b = ri < basementCommon ? basementHeights[i + 1] : basement.floor, c = ri < basementCommon ? basementHeights[i + SZ + 2] : basement.floor, d = ri < basementCommon ? basementHeights[i + SZ + 1] : basement.floor;
      const low = Math.min(a, b, c, d), high = Math.max(a, b, c, d), sloped = high - low > 1e-9;
      const floor = sloped ? Math.floor(low / UNIT) * UNIT - UNIT : low, ceiling = Math.ceil((high + HEADQUARTERS_HEIGHT) / UNIT) * UNIT;
      carveHeadquartersColumn(gx, gz, floor, ceiling, true);
      basementCavities[cell] = encodeCavity(HEADQUARTERS_CAVE, floor, ceiling, 64);
      if (ri === basementCommon) basementCells[cell] = 0;
      if (!sloped) continue;
      const v = rampGeometry.verts.length / 3;
      rampGeometry.verts.push(x, a, z, x, b, z + UNIT, x + UNIT, c, z + UNIT, x + UNIT, d, z);
      basementCollision[cell] = (rampGeometry.faces.length << 2) | 2;
      rampGeometry.faces.push({ i: [v, v + 1, v + 2], color: PALETTE[P.floor], emissive: 0, headquartersBasementRamp: ri }, { i: [v, v + 2, v + 3], color: PALETTE[P.floor], emissive: 0, headquartersBasementRamp: ri });
    }
    // The wider openings expose the outer edge of each lower ramp. Continue
    // its visible sides down to the carved support instead of leaving slivers
    // of sky between the smooth ramp and its stepped voxel base.
    for (let gx = 0; gx < SX; gx++) for (let gz = 0; gz < SZ; gz++) {
      const cell = gx * SZ + gz, ri = basementCells[cell];
      if (!ri || ri >= basementCommon) continue;
      const x = gx * UNIT + ORIGIN.x, z = gz * UNIT + ORIGIN.z, i = gx * (SZ + 1) + gz;
      const corners = [[x, basementHeights[i], z], [x, basementHeights[i + 1], z + UNIT], [x + UNIT, basementHeights[i + SZ + 2], z + UNIT], [x + UNIT, basementHeights[i + SZ + 1], z]];
      const base = (((basementCavities[cell] >> 4) & 63) - 64) * UNIT;
      const neighbors = [gx ? basementCells[cell - SZ] : 0, gz + 1 < SZ ? basementCells[cell + 1] : 0, gx + 1 < SX ? basementCells[cell + SZ] : 0, gz ? basementCells[cell - 1] : 0];
      for (let edge = 0; edge < 4; edge++) {
        if (neighbors[edge] === ri) continue;
        const a = corners[edge], b = corners[(edge + 1) % 4];
        if (a[1] <= base + 1e-7 && b[1] <= base + 1e-7) continue;
        const v = rampGeometry.verts.length / 3;
        rampGeometry.verts.push(a[0], a[1], a[2], a[0], base, a[2], b[0], base, b[2], b[0], b[1], b[2]);
        rampGeometry.faces.push({ i: [v, v + 1, v + 2, v + 3], color: PALETTE[P.stoneDark], emissive: 0, headquartersBasementRampSkirt: ri });
      }
    }
    for (const balcony of basement.balconies) carveBalconyOpening(balcony);
    // The central shaft opens through the underside, leaving a broad walking
    // ring around it. Two shallow voxel steps bevel its mouth; render faces
    // and footing use these same cells, with no decorative collision lip.
    const holeGX0 = Math.floor((basementHole.x - basementHole.mouthRadius - UNIT - ORIGIN.x) / UNIT), holeGX1 = Math.ceil((basementHole.x + basementHole.mouthRadius + UNIT - ORIGIN.x) / UNIT);
    const holeGZ0 = Math.floor((basementHole.z - basementHole.mouthRadius - UNIT - ORIGIN.z) / UNIT), holeGZ1 = Math.ceil((basementHole.z + basementHole.mouthRadius + UNIT - ORIGIN.z) / UNIT);
    const basementFloorGy = SURFACE + Math.round(basement.floor / UNIT) - 1;
    for (let gx = holeGX0; gx <= holeGX1; gx++) for (let gz = holeGZ0; gz <= holeGZ1; gz++) {
      const x = (gx + 0.5) * UNIT + ORIGIN.x, z = (gz + 0.5) * UNIT + ORIGIN.z, radius = Math.hypot(x - basementHole.x, z - basementHole.z);
      if (radius >= basementHole.mouthRadius + UNIT) continue;
      if (radius >= basementHole.mouthRadius) { grid.set(gx, basementFloorGy, gz, P.stoneDark); continue; }
      const shaft = radius < basementHole.radius;
      const floor = basement.floor - Math.min(basementHole.rimDepth, Math.ceil((basementHole.mouthRadius - radius) / UNIT) * UNIT);
      const bottomGy = shaft ? 0 : SURFACE + Math.round(floor / UNIT);
      for (let gy = bottomGy; gy <= basementFloorGy; gy++) grid.set(gx, gy, gz, 0);
      if (!shaft) {
        grid.set(gx, bottomGy - 1, gz, P.stoneDark);
        basementCavities[gx * SZ + gz] = encodeCavity(HEADQUARTERS_CAVE, floor, basement.ceiling, 64);
      }
    }
    // Window openings cut through the cliff, with solid stone below each sill.
    const headquartersWindows = [];
    for (const ramp of headquartersRamps) {
      for (const index of [18, 30, 43]) {
        const sample = ramp.samples[index], angle = Math.atan2(sample.x, -sample.z);
        headquartersWindows.push({ kind: "ramp", x: sample.x, z: sample.z, floor: sample.y, y: sample.y + 2, sill: Math.ceil((sample.y + 1.05) / UNIT) * UNIT, angle, width: 3, height: 1.75 });
      }
    }
    for (const ramp of basement.ramps) {
      for (const sampleIndex of [42, 56, 72]) {
        const sample = ramp.samples[sampleIndex], angle = Math.atan2(sample.x, -sample.z), sill = Math.ceil((sample.y + 1.15) / UNIT) * UNIT, height = 1.75;
        headquartersWindows.push({ kind: "ramp", basement: true, rampIndex: ramp.index, sampleIndex, station: sample.s, x: sample.x, z: sample.z, floor: sample.y, y: sill + height / 2, sill, angle, width: 3, height });
      }
    }
    for (const room of [...headquartersRooms, ...basement.rooms]) {
      if (!room.window) continue;
      const sill = room.floor + 1, height = 2, at = room.windowAt || room.back;
      headquartersWindows.push({ kind: "room", roomIndex: room.index, basement: !!room.basement, x: at.x, z: at.z, floor: room.floor, y: sill + height / 2, sill, angle: room.windowAngle ?? room.angle, width: 3.5, height });
    }
    const panoramaStart = headquartersGallery.startAngle + Math.PI / 90, panoramaEnd = headquartersGallery.endAngle - Math.PI / 90;
    const panoramaAngle = (panoramaStart + panoramaEnd) / 2, panoramaRadius = headquartersGallery.radius - UNIT;
    headquartersWindows.push({ kind: "panorama", x: Math.sin(panoramaAngle) * panoramaRadius, z: -Math.cos(panoramaAngle) * panoramaRadius, floor: HEADQUARTERS_FLOOR, y: HEADQUARTERS_FLOOR + 2.125, sill: HEADQUARTERS_FLOOR + 1, angle: panoramaAngle, startAngle: panoramaStart, endAngle: panoramaEnd, radius: panoramaRadius, width: panoramaRadius * (panoramaEnd - panoramaStart), height: 2.25 });
    const windowCuts = new Map(), windowColumns = new Array(SX * SZ), windowGeometry = { verts: [], faces: [], lines: [] };
    const windowSightIds = new Map(), windowSightExact = new Map(), windowSightValues = [], windowSightIndices = [];
    const windowFlareWidth = 2, windowFlareHeight = 1.3;
    for (const [index, window] of headquartersWindows.entries()) {
      const sx = Math.sin(window.angle), sz = -Math.cos(window.angle), start = Math.hypot(window.x, window.z);
      window.index = index;
      window.outer = { x: sx * 31, z: sz * 31 };
      let edge = start + UNIT;
      // Size the flare against this window's actual shell, including its top
      // and bottom edges, rather than the island's nominal maximum radius.
      for (let radius = start; radius <= 31; radius += UNIT / 2) for (let y = window.sill - windowFlareHeight; y <= window.sill + window.height + windowFlareHeight; y += UNIT) {
        if (grid.has(Math.floor((sx * radius - ORIGIN.x) / UNIT), Math.floor((y - ORIGIN.y) / UNIT), Math.floor((sz * radius - ORIGIN.z) / UNIT))) edge = radius + UNIT;
      }
      let innerRadius = start;
      if (window.kind === "ramp") {
        // The window marker sits on the ramp centerline. Keep its rectangular
        // opening unchanged through the full corridor, then flare beyond the
        // real voxel wall across every corner of that opening.
        for (let across = -window.width / 2; across <= window.width / 2 + 1e-7; across += UNIT / 2) for (const y of [window.sill + 0.025, window.y, window.sill + window.height - 0.025]) {
          for (let radius = start; radius <= edge; radius += UNIT / 4) {
            const x = sx * radius - sz * across, z = sz * radius + sx * across;
            if (!grid.has(Math.floor((x - ORIGIN.x) / UNIT), Math.floor((y - ORIGIN.y) / UNIT), Math.floor((z - ORIGIN.z) / UNIT))) continue;
            innerRadius = Math.max(innerRadius, radius + UNIT * Math.SQRT2 / 2);
            break;
          }
        }
      }
      window.flare = { edge, innerRadius, horizontal: windowFlareWidth, vertical: windowFlareHeight, frusta: [] };
    }
    // Keep rock between neighboring mouths and stacked levels. The inner
    // frame stays fixed; only the available exterior reveal widens.
    for (let i = 0; i < headquartersWindows.length; i++) for (let j = i + 1; j < headquartersWindows.length; j++) {
      const a = headquartersWindows[i], b = headquartersWindows[j], radius = Math.min(a.flare.edge, b.flare.edge);
      const angle = Math.abs(Math.atan2(Math.sin(a.angle - b.angle), Math.cos(a.angle - b.angle)));
      const aw = a.kind === "panorama" ? radius * (a.endAngle - a.startAngle) : a.width;
      const bw = b.kind === "panorama" ? radius * (b.endAngle - b.startAngle) : b.width;
      const gap = angle * radius - (aw + bw) / 2, vertical = Math.max(b.sill - a.sill - a.height, a.sill - b.sill - b.height);
      if (vertical < 0.75 + a.flare.vertical + b.flare.vertical) {
        const room = Math.max(0, (gap - 0.75) / 2);
        a.flare.horizontal = Math.min(a.flare.horizontal, room); b.flare.horizontal = Math.min(b.flare.horizontal, room);
      }
      if (gap < 0.75 + a.flare.horizontal + b.flare.horizontal && vertical > 0) {
        const room = Math.max(0, (vertical - 0.75) / 2);
        a.flare.vertical = Math.min(a.flare.vertical, room); b.flare.vertical = Math.min(b.flare.vertical, room);
      }
    }
    const cutColumn = (window, planes, lower, upper, gx, gz, x, z, cx, cz) => {
      for (let gy = Math.max(0, Math.floor((lower - ORIGIN.y) / UNIT)); gy < Math.min(SY, Math.ceil((upper - ORIGIN.y) / UNIT)); gy++) {
        const id = grid.index(gx, gy, gz), prior = windowCuts.get(id), color = prior ? prior.color : data[id];
        if (!color) continue;
        const y = gy * UNIT + ORIGIN.y;
        let outside = false, whollyInside = true;
        for (const p of planes) {
          const mid = p[0] * cx + p[1] * (y + UNIT / 2) + p[2] * cz - p[3], reach = (Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2])) * UNIT / 2;
          if (mid - reach >= -1e-8) { outside = true; break; }
          if (mid + reach > 1e-8) whollyInside = false;
        }
        if (outside) continue;
        if (whollyInside) { data[id] = 0; windowCuts.delete(id); continue; }
        const remaining = [];
        for (const fragment of prior ? prior.fragments : [cutCube(x, y, z, UNIT)]) {
          let inside = fragment;
          for (const plane of planes) {
            const piece = clipCut(inside, plane, -1, window.index);
            if (piece) remaining.push(piece);
            inside = clipCut(inside, plane, 1, window.index);
            if (!inside) break;
          }
        }
        data[id] = 0;
        if (remaining.length) {
          const cuts = prior ? prior.cuts : [];
          cuts.push(planes);
          windowCuts.set(id, { color, fragments: remaining, cuts, gx, gz, minX: x, minY: y, minZ: z, matrixCave: prior ? prior.matrixCave : matrixCaves[id] || matrixCaves[id + SZ] || matrixCaves[id - SZ] || matrixCaves[id + 1] || matrixCaves[id - 1] || matrixCaves[id + SY * SZ] || matrixCaves[id - SY * SZ] || 0 });
        }
        else windowCuts.delete(id);
      }
    };
    for (const window of headquartersWindows) {
      const segments = window.kind === "panorama" ? 12 : 2;
      for (let segment = 0; segment < segments; segment++) {
        const span = window.kind === "panorama" ? (window.endAngle - window.startAngle) / segments : 0;
        const inner = window.kind !== "panorama" && segment === 1;
        const angle = span ? window.startAngle + span * (segment + 0.5) : window.angle;
        const sx = Math.sin(angle), sz = -Math.cos(angle), tx = -sz, tz = sx;
        const marker = Math.hypot(window.x, window.z), frame = window.flare.innerRadius;
        const start = span ? window.radius * Math.cos(span / 2) : inner ? marker - (window.kind === "room" ? UNIT * Math.SQRT2 : 0) : frame, end = inner ? frame : 31;
        const half = span ? window.radius * Math.sin(span / 2) : window.width / 2;
        const horizontal = inner ? 0 : span ? Math.tan(span / 2) : window.flare.horizontal / Math.max(UNIT, window.flare.edge - start);
        const vertical = inner ? 0 : window.flare.vertical / Math.max(UNIT, window.flare.edge - start);
        // A constant-width inner throat overlaps the existing room by one
        // voxel diagonal, removing thin strips at its quantized wall edge.
        const planes = [[-sx, 0, -sz, -start], [sx, 0, sz, end], [tx - horizontal * sx, 0, tz - horizontal * sz, half - horizontal * start], [-tx - horizontal * sx, 0, -tz - horizontal * sz, half - horizontal * start], [-vertical * sx, -1, -vertical * sz, -window.sill - vertical * start], [-vertical * sx, 1, -vertical * sz, window.sill + window.height - vertical * start]];
        window.flare.frusta.push({ angle, start, end, half, horizontal, vertical, planes, inner });
        const lower = window.sill - vertical * (end - start);
        // A basement reveal may flare through its outer cliff face, but it
        // must stop at that level's ceiling instead of cutting the HQ slab.
        const upper = Math.min(window.sill + window.height + vertical * (end - start), window.basement ? basement.ceiling : Infinity);
        // The footprint test below only passes inside this rectangle's bounds; one spare column absorbs rounding.
        const reach = half + horizontal * (end - start) + UNIT;
        const spanX = Math.abs(tx) * reach, spanZ = Math.abs(tz) * reach;
        const minX = Math.min((start - UNIT) * sx, (end + UNIT) * sx) - spanX, maxX = Math.max((start - UNIT) * sx, (end + UNIT) * sx) + spanX;
        const minZ = Math.min((start - UNIT) * sz, (end + UNIT) * sz) - spanZ, maxZ = Math.max((start - UNIT) * sz, (end + UNIT) * sz) + spanZ;
        const gx0 = Math.max(0, Math.floor((minX - ORIGIN.x) / UNIT) - 2), gx1 = Math.min(SX - 1, Math.ceil((maxX - ORIGIN.x) / UNIT) + 1);
        const gz0 = Math.max(0, Math.floor((minZ - ORIGIN.z) / UNIT) - 2), gz1 = Math.min(SZ - 1, Math.ceil((maxZ - ORIGIN.z) / UNIT) + 1);
        for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
          const x = gx * UNIT + ORIGIN.x, z = gz * UNIT + ORIGIN.z, cx = x + UNIT / 2, cz = z + UNIT / 2;
          if (cx * sx + cz * sz < start - UNIT || cx * sx + cz * sz > end + UNIT || Math.abs(cx * tx + cz * tz) > half + horizontal * (end - start) + UNIT) continue;
          cutColumn(window, planes, lower, upper, gx, gz, x, z, cx, cz);
        }
      }
    }
    const flatAt = (points, axis, value, offset) => {
      for (let n = 0; n < points.length; n++) if (!(Math.abs(points[n][axis] - value - offset) < 1e-7)) return false;
      return true;
    };
    let windowFragmentCount = 0;
    // The reveal mesh and the fragment pool arrive as arguments so no surviving closure keeps them.
    const addFragment = (cut, polygons, column, windowGeometry, pool) => {
      const points = [], triangles = [], exposed = [];
      for (const polygon of polygons) {
        const indices = polygon.points.map((p) => {
          let index = near(points, p);
          if (index < 0) { index = points.length; points.push(p); }
          return index;
        });
        for (let i = 1; i < indices.length - 1; i++) triangles.push(indices[0], indices[i], indices[i + 1]);
        if (!polygon.reveal) {
          let neighbor = -1;
          if (flatAt(polygon.points, 0, cut.minX, 0)) neighbor = grid.index(cut.gx - 1, Math.round((cut.minY - ORIGIN.y) / UNIT), cut.gz);
          else if (flatAt(polygon.points, 0, cut.minX, UNIT)) neighbor = grid.index(cut.gx + 1, Math.round((cut.minY - ORIGIN.y) / UNIT), cut.gz);
          else if (flatAt(polygon.points, 1, cut.minY, 0)) neighbor = grid.index(cut.gx, Math.round((cut.minY - ORIGIN.y) / UNIT) - 1, cut.gz);
          else if (flatAt(polygon.points, 1, cut.minY, UNIT)) neighbor = grid.index(cut.gx, Math.round((cut.minY - ORIGIN.y) / UNIT) + 1, cut.gz);
          else if (flatAt(polygon.points, 2, cut.minZ, 0)) neighbor = grid.index(cut.gx, Math.round((cut.minY - ORIGIN.y) / UNIT), cut.gz - 1);
          else if (flatAt(polygon.points, 2, cut.minZ, UNIT)) neighbor = grid.index(cut.gx, Math.round((cut.minY - ORIGIN.y) / UNIT), cut.gz + 1);
          if (neighbor < 0 || !data[neighbor] && !windowCuts.has(neighbor)) exposed.push(polygon);
          continue;
        }
        const a = polygon.points[0], b = polygon.points[1], c = polygon.points[2];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const frustum of headquartersWindows[polygon.windowIndex].flare.frusta) {
          if (!frustum.planes.some((p) => nx * p[0] + ny * p[1] + nz * p[2] < -1e-10 && polygon.points.every((point) => Math.abs(point[0] * p[0] + point[1] * p[1] + point[2] * p[2] - p[3]) < 1e-7))) continue;
          let visible = polygon.points;
          for (const plane of frustum.planes) { visible = clipReveal(visible, plane); if (!visible) break; }
          if (visible) exposed.push({ ...polygon, points: visible });
        }
      }
      if (points.length < 4) return;
      const origin = points[0];
      let volume = 0;
      for (let n = 0; n < triangles.length; n += 3) {
        const a = points[triangles[n]], b = points[triangles[n + 1]], c = points[triangles[n + 2]];
        const ax = a[0] - origin[0], ay = a[1] - origin[1], az = a[2] - origin[2], bx = b[0] - origin[0], by = b[1] - origin[1], bz = b[2] - origin[2], cx = c[0] - origin[0], cy = c[1] - origin[1], cz = c[2] - origin[2];
        volume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
      }
      if (Math.abs(volume) < 1e-11) return;
      const vertexStart = pool.vertices.length, triangleStart = pool.triangles.length;
      for (let n = 0; n < points.length; n++) { const p = points[n]; pool.vertices.push(p[0], p[1], p[2]); }
      for (let n = 0; n < triangles.length; n++) pool.triangles.push(triangles[n]);
      const planeIds = [];
      for (const polygon of polygons) {
        const a = polygon.points[0];
        for (let i = 2; i < polygon.points.length; i++) {
          const b = polygon.points[i - 1], c = polygon.points[i], ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, length = Math.hypot(nx, ny, nz);
          if (length < 1e-12) continue;
          const px = nx / length, py = ny / length, pz = nz / length, distance = (nx * a[0] + ny * a[1] + nz * a[2]) / length;
          // Many fragments reuse the same voxel or window plane. Merge
          // coefficients only far below the collision tolerance, retaining
          // the original Float64 plane in one shared construction-time pool.
          // Identical coefficients print identically: reach the printed key only for unseen ones.
          const kx = Math.abs(px) < 1e-12 ? 0 : px, ky = Math.abs(py) < 1e-12 ? 0 : py, kz = Math.abs(pz) < 1e-12 ? 0 : pz;
          let exact = windowSightExact, next = exact.get(kx);
          if (!next) exact.set(kx, next = new Map());
          exact = next; next = exact.get(ky);
          if (!next) exact.set(ky, next = new Map());
          exact = next; next = exact.get(kz);
          if (!next) exact.set(kz, next = new Map());
          let id = next.get(distance);
          if (id === undefined) {
            const key = `${kx.toPrecision(12)},${ky.toPrecision(12)},${kz.toPrecision(12)},${distance.toPrecision(12)}`;
            id = windowSightIds.get(key);
            if (id === undefined) { id = windowSightValues.length / 4; windowSightIds.set(key, id); windowSightValues.push(px, py, pz, distance); }
            next.set(distance, id);
          }
          planeIds.push(id);
          break;
        }
      }
      for (const polygon of exposed) {
        const offset = windowGeometry.verts.length / 3;
        for (const p of polygon.points) windowGeometry.verts.push(...p);
        // Keep coplanar cuts together for Canvas shading and sorting. Seven
        // vertices leave room for its height/near clips; GL emits the same
        // triangle fan, and physical fragments retain their closed triangles.
        for (let i = 1; i < polygon.points.length - 1; i += 5) {
          const indices = [offset];
          for (let k = i; k < Math.min(i + 6, polygon.points.length); k++) indices.push(offset + k);
          windowGeometry.faces.push({ i: indices, color: PALETTE[cut.color], emissive: 0, headquartersWindowReveal: polygon.reveal, windowIndex: polygon.windowIndex, matrixCave: cut.matrixCave, matrixLocalGlyphSurface: cut.matrixCave !== 0 });
        }
      }
      const sightOffset = windowSightIndices.length;
      for (const id of planeIds) windowSightIndices.push(id);
      const piece = { vertices: null, triangles: { i: null }, sightOffset, sightCount: planeIds.length, cuts: cut.cuts, color: PALETTE[cut.color], matrixCave: cut.matrixCave, minX: cut.minX, minY: cut.minY, minZ: cut.minZ, maxX: cut.minX + UNIT, maxY: cut.minY + UNIT, maxZ: cut.minZ + UNIT  };
      windowColumns[column].push(piece);
      pool.pieces.push(piece, vertexStart, pool.vertices.length, triangleStart, pool.triangles.length);
      windowFragmentCount++;
    };
    const fragmentPool = { vertices: [], triangles: [], pieces: [] };
    for (const cut of windowCuts.values()) {
      const column = cut.gx * SZ + cut.gz;
      if (!windowColumns[column]) windowColumns[column] = [];
      for (const polygons of cut.fragments) addFragment(cut, polygons, column, windowGeometry, fragmentPool);
    }
    // Every piece views one shared vertex and one shared index buffer
    // instead of owning two small allocations each.
    const vertexPool = new Float64Array(fragmentPool.vertices), trianglePool = new Uint16Array(fragmentPool.triangles), pieces = fragmentPool.pieces;
    for (let n = 0; n < pieces.length; n += 5) {
      pieces[n].vertices = vertexPool.subarray(pieces[n + 1], pieces[n + 2]);
      pieces[n].triangles.i = trianglePool.subarray(pieces[n + 3], pieces[n + 4]);
    }
    fragmentPool.vertices.length = fragmentPool.triangles.length = fragmentPool.pieces.length = 0;
    roomAxes.clear();
    windowCuts.clear();
    const windowSightPlanes = new Float64Array(windowSightValues), windowSightRefs = new Uint32Array(windowSightIndices);
    windowSightIds.clear(); windowSightExact.clear(); windowSightValues.length = windowSightIndices.length = 0;
    // Walkable height is the lowest run's top
    const surface = new Float32Array(SX * SZ);
    const land = new Uint8Array(SX * SZ);
    for (let gx = 0; gx < SX; gx++) {
      for (let gz = 0; gz < SZ; gz++) {
        const column = (gx * SY) * SZ + gz;
        let gy = 0;
        while (gy < SY && !data[column + gy * SZ]) gy++;
        if (gy === SY) continue;
        while (gy < SY && data[column + gy * SZ]) gy++;
        const i = gx * SZ + gz;
        height[i] = (gy - SURFACE) * UNIT;
        land[i] = 1;
        let top = SY;
        while (top > gy && !data[column + (top - 1) * SZ]) top--;
        surface[i] = (top - SURFACE) * UNIT;
      }
    }
    const column = (x, z) => {
      const gx = Math.floor((x - ORIGIN.x) / UNIT), gz = Math.floor((z - ORIGIN.z) / UNIT);
      return gx >= 0 && gz >= 0 && gx < SX && gz < SZ ? gx * SZ + gz : -1;
    };
    const rampFloorAt = (x, z) => {
      const px = (x - ORIGIN.x) / UNIT, pz = (z - ORIGIN.z) / UNIT;
      const gx = Math.floor(px), gz = Math.floor(pz), tx = px - gx, tz = pz - gz, i = gx * (SZ + 1) + gz;
      const ramp = headquartersRamps[rampCells[gx * SZ + gz] - 1], along = (x - ramp.from.x) * ramp.axis.x + (z - ramp.from.z) * ramp.axis.z;
      if (along <= 0) return 0;
      if (along < 0.75) return -along * ramp.slope;
      const a = rampHeights[i], b = rampHeights[i + 1], c = rampHeights[i + SZ + 2], d = rampHeights[i + SZ + 1];
      return tz >= tx ? a * (1 - tz) + b * (tz - tx) + c * tx : a * (1 - tx) + c * tz + d * (tx - tz);
    };
    const basementFloorAt = (x, z) => {
      if (basementHole.contains(x, z)) return -Infinity;
      const px = (x - ORIGIN.x) / UNIT, pz = (z - ORIGIN.z) / UNIT, gx = Math.floor(px), gz = Math.floor(pz);
      const cell = gx * SZ + gz;
      if (!basementCells[cell]) return (((basementCavities[cell] >> 4) & 63) - 64) * UNIT;
      const i = gx * (SZ + 1) + gz, tx = px - gx, tz = pz - gz;
      const a = basementHeights[i], b = basementHeights[i + 1], c = basementHeights[i + SZ + 2], d = basementHeights[i + SZ + 1];
      return tz >= tx ? a * (1 - tz) + b * (tz - tx) + c * tx : a * (1 - tx) + c * tz + d * (tx - tz);
    };
    const heightAt = (x, z) => {
      const i = column(x, z);
      return i < 0 ? 0 : rampCells[i] ? rampFloorAt(x, z) : lowerCavities[i] ? (((lowerCavities[i] >> 4) & 63) - 32) * UNIT : basementCavities[i] ? basementFloorAt(x, z) : height[i];
    };
    const surfaceAt = (x, z) => {
      const i = column(x, z);
      return i < 0 ? 0 : rampCells[i] ? Math.max(surface[i], rampFloorAt(x, z)) : surface[i];
    };
    // Select the actual supporting run by height, including shelves and window
    // sills. A rock column taller than the permitted step returns its own top,
    // so callers can reject it instead of falling back to the room below it.
    const voxelSupportAt = (x, z, y = Infinity, maxStep = 0.6, emptyFloor = null) => {
      const i = column(x, z);
      if (i < 0 || !land[i]) return emptyFloor === null ? 0 : emptyFloor;
      if (y + maxStep < ORIGIN.y && emptyFloor !== null) return emptyFloor;
      if (y >= surface[i] - maxStep) return surfaceAt(x, z);
      const gx = Math.floor(i / SZ), gz = i % SZ, base = gx * SY * SZ + gz;
      let gy = clamp(Math.floor((y + maxStep - ORIGIN.y) / UNIT), 0, SY - 1);
      if (data[base + gy * SZ]) {
        while (gy < SY && data[base + gy * SZ]) gy++;
      } else {
        while (gy >= 0 && !data[base + gy * SZ]) gy--;
        if (gy < 0 && emptyFloor !== null) return emptyFloor;
        gy++;
      }
      const floor = (gy - SURFACE) * UNIT;
      if (basementCells[i] && y < ((basementCavities[i] >> 10) - 64) * UNIT) return Math.max(floor, basementFloorAt(x, z));
      const rampBase = (((lowerCavities[i] >> 4) & 63) - 32) * UNIT;
      return rampCells[i] && y + maxStep >= rampBase ? Math.max(floor, rampFloorAt(x, z)) : floor;
    };
    const windowPieceTop = (piece, x, z, radius, direction = 1) => {
      let top = -Infinity;
      for (let i = 0; i < piece.triangles.i.length; i += 3) top = Math.max(top, rampTriangleTop(piece.triangles, x, z, radius, direction, piece.vertices, i));
      return top;
    };
    const pointSupportAt = (x, z, y = Infinity, maxStep = 0.6, emptyFloor = null) => {
      let floor = voxelSupportAt(x, z, y, maxStep, emptyFloor);
      const pieces = windowColumns[column(x, z)];
      if (pieces) for (const piece of pieces) {
        if (piece.minY > y + maxStep || piece.maxY < floor) continue;
        const top = windowPieceTop(piece, x, z, 0), bottom = -windowPieceTop(piece, x, z, 0, -1);
        if (bottom <= y + maxStep + 1e-7) floor = Math.max(floor, top);
      }
      return floor;
    };
    // A circle overlaps a column exactly; corner-only contact is not a wall.
    const overlapsColumn = (x, z, radius2, gx, gz) => {
      const dx = Math.max(0, Math.abs((gx + 0.5) * UNIT + ORIGIN.x - x) - UNIT / 2);
      const dz = Math.max(0, Math.abs((gz + 0.5) * UNIT + ORIGIN.z - z) - UNIT / 2);
      return radius2 ? dx * dx + dz * dz < radius2 - 1e-12 : true;
    };
    // Keep feet on a discrete sill until their whole footprint clears its edge.
    // Rendered ramps retain their continuous centre height; only neighboring
    // discrete rock and window sills can raise the footprint above that slope.
    const supportAt = (x, z, y = Infinity, maxStep = 0.6, emptyFloor = null, radius = 0) => {
      let floor = pointSupportAt(x, z, y, maxStep, emptyFloor);
      if (!radius || floor > y + maxStep) return floor;
      const gx0 = Math.max(0, Math.floor((x - radius - ORIGIN.x) / UNIT)), gx1 = Math.min(SX - 1, Math.floor((x + radius - ORIGIN.x) / UNIT));
      const gz0 = Math.max(0, Math.floor((z - radius - ORIGIN.z) / UNIT)), gz1 = Math.min(SZ - 1, Math.floor((z + radius - ORIGIN.z) / UNIT));
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        if (!overlapsColumn(x, z, radius * radius, gx, gz)) continue;
        const cell = gx * SZ + gz, px = (gx + 0.5) * UNIT + ORIGIN.x, pz = (gz + 0.5) * UNIT + ORIGIN.z;
        const pieces = windowColumns[cell];
        if (pieces) for (const piece of pieces) {
          if (piece.minY > y + maxStep || piece.maxY < floor) continue;
          const top = windowPieceTop(piece, x, z, radius), bottom = -windowPieceTop(piece, x, z, radius, -1);
          if (bottom <= y + maxStep + 1e-7 && top <= y + maxStep + 1e-7) floor = Math.max(floor, top);
        }
        const support = voxelSupportAt(px, pz, y, maxStep, emptyFloor);
        if (support <= floor || support > y + maxStep) continue;
        if (rampCells[cell] && Math.abs(support - rampFloorAt(px, pz)) < 1e-7 || basementCells[cell] && Math.abs(support - basementFloorAt(px, pz)) < 1e-7) continue;
        floor = support;
      }
      return floor;
    };
    // Highest point of a rendered slope triangle under a circular footprint.
    // The maximum is on an edge or at the disk's uphill point; no samples or
    // temporary vectors are needed, even at the clipped doorway triangles.
    const rampTriangleTop = (face, x, z, radius, direction = 1, verts = geometry.verts, triangle = 0) => {
      const indices = face.i;
      const a = indices[triangle] * 3, b = indices[triangle + 1] * 3, c = indices[triangle + 2] * 3;
      const ax = verts[a], ay = verts[a + 1] * direction, az = verts[a + 2];
      const bx = verts[b] - ax, by = verts[b + 1] * direction - ay, bz = verts[b + 2] - az;
      const cx = verts[c] - ax, cy = verts[c + 1] * direction - ay, cz = verts[c + 2] - az;
      const determinant = bx * cz - bz * cx;
      if (Math.abs(determinant) < 1e-12) return -Infinity;
      const gradientX = (by * cz - cy * bz) / determinant, gradientZ = (bx * cy - cx * by) / determinant;
      const length = Math.hypot(gradientX, gradientZ), scale = length ? radius / length : 0;
      const px = x + gradientX * scale - ax, pz = z + gradientZ * scale - az;
      const u = (px * cz - pz * cx) / determinant, v = (bx * pz - bz * px) / determinant;
      let top = u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9 ? ay + gradientX * px + gradientZ * pz : -Infinity;
      for (let edge = 0; edge < 3; edge++) {
        const p = indices[triangle + edge] * 3, q = indices[triangle + (edge + 1) % 3] * 3;
        const dx = verts[q] - verts[p], dz = verts[q + 2] - verts[p + 2], dy = (verts[q + 1] - verts[p + 1]) * direction;
        const ex = x - verts[p], ez = z - verts[p + 2], length2 = dx * dx + dz * dz;
        const middle = (ex * dx + ez * dz) / length2;
        const perpendicularX = ex - dx * middle, perpendicularZ = ez - dz * middle;
        const remaining = radius * radius - perpendicularX * perpendicularX - perpendicularZ * perpendicularZ;
        if (remaining < 0) continue;
        const half = Math.sqrt(remaining / length2), lo = Math.max(0, middle - half), hi = Math.min(1, middle + half);
        if (lo <= hi) top = Math.max(top, verts[p + 1] * direction + dy * (dy > 0 ? hi : lo));
      }
      return top;
    };
    // Exact voxel overlap for a vertical cylinder, bottom y and upward height.
    // Slopes fill the small gap above their voxel bases using the render mesh.
    const clearAt = (x, y, z, radius = 0, bodyHeight = 0) => {
      const epsilon = 1e-7, edge = radius ? epsilon : 0, cap = bodyHeight ? epsilon : 0;
      const gx0 = Math.max(0, Math.floor((x - radius - ORIGIN.x + edge) / UNIT)), gx1 = Math.min(SX - 1, Math.floor((x + radius - ORIGIN.x - edge) / UNIT));
      const gz0 = Math.max(0, Math.floor((z - radius - ORIGIN.z + edge) / UNIT)), gz1 = Math.min(SZ - 1, Math.floor((z + radius - ORIGIN.z - edge) / UNIT));
      const gy0 = Math.max(0, Math.floor((y - ORIGIN.y + cap) / UNIT)), gy1 = Math.min(SY - 1, Math.floor((y + bodyHeight - ORIGIN.y - cap) / UNIT));
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        if (!overlapsColumn(x, z, radius * radius, gx, gz)) continue;
        const base = gx * SY * SZ + gz, i = gx * SZ + gz;
        for (let gy = gy0; gy <= gy1; gy++) if (data[base + gy * SZ]) return false;
        const pieces = windowColumns[i];
        if (pieces) for (const piece of pieces) {
          if (y >= piece.maxY - epsilon || y + bodyHeight <= piece.minY + epsilon) continue;
          if (BL.convex.sweptCylinder(piece.vertices, x, y, z, x, y, z, radius, bodyHeight)) return false;
        }
        for (let layer = 0; layer < 2; layer++) {
          const range = layer ? basementCollision[i] : rampCollision[i];
          const base = layer ? (((basementCavities[i] >> 4) & 63) - 64) * UNIT : (((lowerCavities[i] >> 4) & 63) - 32) * UNIT;
          if (!range || y + bodyHeight <= base + epsilon) continue;
          for (let n = 0; n < (range & 3); n++) {
            const face = geometry.faces[rampFaceOffset + (range >>> 2) + n], verts = geometry.verts;
            if (Math.max(verts[face.i[0] * 3 + 1], verts[face.i[1] * 3 + 1], verts[face.i[2] * 3 + 1]) <= y + epsilon) continue;
            if (rampTriangleTop(face, x, z, radius) > y + epsilon) return false;
          }
        }
      }
      return true;
    };
    // Camera substeps already test rendered ramp triangles with clearAt.
    // Sweep their intervening volume exactly against the solid voxel boxes.
    const voxelSegmentClearAt = (x, y, z, toX, toY, toZ, radius, height) => {
      const gx0 = Math.max(0, Math.floor((Math.min(x, toX) - radius - ORIGIN.x) / UNIT)), gx1 = Math.min(SX - 1, Math.floor((Math.max(x, toX) + radius - ORIGIN.x) / UNIT));
      const gz0 = Math.max(0, Math.floor((Math.min(z, toZ) - radius - ORIGIN.z) / UNIT)), gz1 = Math.min(SZ - 1, Math.floor((Math.max(z, toZ) + radius - ORIGIN.z) / UNIT));
      const gy0 = Math.max(0, Math.floor((Math.min(y, toY) - ORIGIN.y) / UNIT)), gy1 = Math.min(SY - 1, Math.floor((Math.max(y, toY) + height - ORIGIN.y) / UNIT));
      const dx = toX - x, dy = toY - y, dz = toZ - z;
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const base = gx * SY * SZ + gz, minX = gx * UNIT + ORIGIN.x, minZ = gz * UNIT + ORIGIN.z;
        for (let gy = gy0; gy <= gy1; gy++) {
          if (!data[base + gy * SZ]) continue;
          const minY = gy * UNIT + ORIGIN.y;
          if (!segmentBoxClear(x, y, z, dx, dy, dz, radius, height, minX, minY, minZ, minX + UNIT, minY + UNIT, minZ + UNIT)) return false;
        }
        const pieces = windowColumns[gx * SZ + gz];
        if (pieces) for (const piece of pieces) {
          if (Math.min(y, toY) >= piece.maxY - 1e-7 || Math.max(y, toY) + height <= piece.minY + 1e-7) continue;
          if (BL.convex.sweptCylinder(piece.vertices, x, y, z, toX, toY, toZ, radius, height)) return false;
        }
      }
      return true;
    };
    const ceilingAt = (x, y, z, radius = 0) => {
      const gx0 = Math.max(0, Math.floor((x - radius - ORIGIN.x) / UNIT)), gx1 = Math.min(SX - 1, Math.floor((x + radius - ORIGIN.x) / UNIT));
      const gz0 = Math.max(0, Math.floor((z - radius - ORIGIN.z) / UNIT)), gz1 = Math.min(SZ - 1, Math.floor((z + radius - ORIGIN.z) / UNIT));
      let ceiling = Infinity;
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        if (!overlapsColumn(x, z, radius * radius, gx, gz)) continue;
        const base = gx * SY * SZ + gz;
        let gy = Math.max(0, Math.floor((y - ORIGIN.y + 1e-7) / UNIT));
        // The initial solid run is the floor at a slope's uphill edge.
        while (gy < SY && data[base + gy * SZ]) gy++;
        while (gy < SY && !data[base + gy * SZ]) gy++;
        if (gy < SY) ceiling = Math.min(ceiling, (gy - SURFACE) * UNIT);
        const pieces = windowColumns[gx * SZ + gz];
        if (pieces) for (const piece of pieces) {
          if (piece.maxY <= y + 1e-7 || piece.minY >= ceiling) continue;
          const bottom = -windowPieceTop(piece, x, z, radius, -1);
          if (bottom > y + 1e-7) ceiling = Math.min(ceiling, bottom);
        }
      }
      return ceiling;
    };
    // Continuous movement-only support across neighboring walkable voxel tops.
    // Rendering and collision continue to use the exact stepped arrays above.
    const upperFloorAt = (i, fallback, y, maxStep) => {
      for (let layer = 0; layer < 2; layer++) {
        const cavity = layer ? lowerCavities[i] : cavities[i], floor = (((cavity >> 4) & 63) - 32) * UNIT;
        if (cavity && floor <= y + maxStep && floor > fallback) fallback = floor;
      }
      return fallback;
    };
    const smoothSupportAt = (x, z, y, maxStep, radius = 0) => {
      const center = column(x, z);
      if (center >= 0 && basementCells[center] && y < ((basementCavities[center] >> 10) - 64) * UNIT) return basementFloorAt(x, z);
      if (center >= 0 && rampCells[center] && y + maxStep >= (((lowerCavities[center] >> 4) & 63) - 32) * UNIT && (y < surface[center] - maxStep || surface[center] <= rampFloorAt(x, z))) return upperFloorAt(center, rampFloorAt(x, z), y, maxStep);
      const px = (x - ORIGIN.x) / UNIT - 0.5, pz = (z - ORIGIN.z) / UNIT - 0.5;
      const gx = Math.floor(px), gz = Math.floor(pz), tx = px - gx, tz = pz - gz;
      if (gx < 0 || gz < 0 || gx + 1 >= SX || gz + 1 >= SZ) return y;
      const i00 = gx * SZ + gz, i10 = i00 + SZ, i01 = i00 + 1, i11 = i10 + 1;
      let a = land[i00] ? y >= surface[i00] - maxStep ? surface[i00] : height[i00] : y;
      let b = land[i10] ? y >= surface[i10] - maxStep ? surface[i10] : height[i10] : y;
      let c = land[i01] ? y >= surface[i01] - maxStep ? surface[i01] : height[i01] : y;
      let d = land[i11] ? y >= surface[i11] - maxStep ? surface[i11] : height[i11] : y;
      if (radius) {
        // Interpolate the same footprint that lands on the leading edge of a
        // step. Center-only samples lag that contact and pin the visual lift.
        const x0 = (gx + 0.5) * UNIT + ORIGIN.x, z0 = (gz + 0.5) * UNIT + ORIGIN.z;
        if (land[i00]) a = supportAt(x0, z0, y, maxStep, null, radius);
        if (land[i10]) b = supportAt(x0 + UNIT, z0, y, maxStep, null, radius);
        if (land[i01]) c = supportAt(x0, z0 + UNIT, y, maxStep, null, radius);
        if (land[i11]) d = supportAt(x0 + UNIT, z0 + UNIT, y, maxStep, null, radius);
      }
      a = upperFloorAt(i00, a, y, maxStep);
      b = upperFloorAt(i10, b, y, maxStep);
      c = upperFloorAt(i01, c, y, maxStep);
      d = upperFloorAt(i11, d, y, maxStep);
      if (Math.abs(a - y) > maxStep) a = y;
      if (Math.abs(b - y) > maxStep) b = y;
      if (Math.abs(c - y) > maxStep) c = y;
      if (Math.abs(d - y) > maxStep) d = y;
      return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    };
    const cavityAt = (x, z, out, caveIndex = 0, y = Infinity) => {
      if (Number.isFinite(y) && y < basementHole.bottom && basementHole.contains(x, z)) return false;
      const i = column(x, z), cavity = i < 0 ? 0 : caveIndex === HEADQUARTERS_CAVE ? lowerCavities[i] : cavities[i] || lowerCavities[i];
      if (i >= 0 && basementCavities[i] && (!caveIndex || caveIndex === HEADQUARTERS_CAVE)) {
        const ceiling = ((basementCavities[i] >> 10) - 64) * UNIT;
        if (!cavity || y < ceiling) {
          out.caveIndex = HEADQUARTERS_CAVE;
          out.floor = basementFloorAt(x, z);
          out.ceiling = ceiling;
          return true;
        }
      }
      if (!cavity) return false;
      out.caveIndex = cavity & 15;
      out.floor = out.caveIndex === HEADQUARTERS_CAVE && rampCells[i] ? rampFloorAt(x, z) : (((cavity >> 4) & 63) - 32) * UNIT;
      const ceiling = cavity >> 10;
      out.ceiling = ceiling === 63 ? Infinity : (ceiling - 32) * UNIT;
      return true;
    };
    // Structural guides use the carved footprint to distinguish a tunnel's
    // side wall from the vertical risers of its stepped ceiling.
    const rampColumnAt = (x, z, basement, out) => {
      const i = column(x, z), id = i < 0 ? 0 : basement ? basementCells[i] : rampCells[i];
      if (!id) return 0;
      const cavity = basement ? basementCavities[i] : lowerCavities[i], offset = basement ? 64 : 32;
      out.floor = (((cavity >> 4) & 63) - offset) * UNIT;
      out.ceiling = ((cavity >> 10) - offset) * UNIT;
      return id;
    };
    const frontageColumnAt = (x, z) => { const i = column(x, z); return i < 0 ? 0 : frontageCells[i]; };
    const pathColumn = (x, z) => {
      const gx = Math.floor((x - ORIGIN.x) / PATH_UNIT), gz = Math.floor((z - ORIGIN.z) / PATH_UNIT);
      return gx >= 0 && gz >= 0 && gx < PX && gz < PZ ? gx * PZ + gz : -1;
    };
    const isPath = (x, z) => {
      const i = pathColumn(x, z);
      return i >= 0 && paths[i] === 1;
    };
    const onLand = (x, z) => {
      const i = column(x, z);
      return i >= 0 && land[i] === 1;
    };
    // Banana-independent master spokes. Ring changes only clip this fixed mask.
    let masterPaths = new Uint8Array(PX * PZ);
    const masterList = [];
    // Meet the nearer end of each frontage along its own tangent, keeping the
    // doorway clear. Rasterize these fixed curves once; the ring only clips them.
    for (const front of headquartersFronts) {
      const side = front.center.x * front.tangent.x + front.center.z * front.tangent.z > 0 ? -1 : 1;
      const end = { x: front.center.x + front.tangent.x * side * (front.halfLength - 1), z: front.center.z + front.tangent.z * side * (front.halfLength - 1) };
      const radius = Math.hypot(end.x, end.z), start = { x: end.x * MASTER_PATH_CENTER / radius, z: end.z * MASTER_PATH_CENTER / radius };
      const bend = { x: end.x + front.tangent.x * side * 4, z: end.z + front.tangent.z * side * 4 };
      const control = { x: start.x + (bend.x - start.x) * 0.48 - end.z / radius * side * 0.9, z: start.z + (bend.z - start.z) * 0.48 + end.x / radius * side * 0.9 };
      const samples = front.connector = [];
      for (let n = 0; n <= 48; n++) {
        const t = n / 48, u = 1 - t;
        samples.push({ x: u * u * u * start.x + 3 * u * u * t * control.x + 3 * u * t * t * bend.x + t * t * t * end.x, z: u * u * u * start.z + 3 * u * u * t * control.z + 3 * u * t * t * bend.z + t * t * t * end.z });
      }
      for (let n = 1; n < samples.length; n++) {
        const a = samples[n - 1], b = samples[n], dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
        const gx0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - PATH_HALF - ORIGIN.x) / PATH_UNIT)), gx1 = Math.min(PX - 1, Math.floor((Math.max(a.x, b.x) + PATH_HALF - ORIGIN.x) / PATH_UNIT));
        const gz0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - PATH_HALF - ORIGIN.z) / PATH_UNIT)), gz1 = Math.min(PZ - 1, Math.floor((Math.max(a.z, b.z) + PATH_HALF - ORIGIN.z) / PATH_UNIT));
        for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
          const x = (gx + 0.5) * PATH_UNIT + ORIGIN.x, z = (gz + 0.5) * PATH_UNIT + ORIGIN.z;
          const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / length2, 0, 1);
          if ((x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2 < PATH_HALF * PATH_HALF && Math.hypot(x, z) >= MASTER_PATH_CENTER) masterPaths[gx * PZ + gz] = 1;
        }
      }
    }
    let masterPathCount = 0, masterHashValue = 2166136261;
    const masterCell = (gx, gz, wx) => {
      const i = gx * PZ + gz, c = (gx >> 1) * SZ + (gz >> 1);
      if (!land[c]) return;
      const wz = (gz + 0.5) * PATH_UNIT + ORIGIN.z, r = Math.hypot(wx, wz);
      let path = !!masterPaths[i], headquartersPath = false;
      if (!path && meadow[c] && r >= MASTER_PATH_CENTER) {
        const theta = Math.atan2(wx, -wz);
        for (const s of spokes) {
          const d = theta - s.angle;
          const lateral = r * Math.atan2(Math.sin(d), Math.cos(d));
          const t = (r - MASTER_PATH_CENTER) / (MEADOW - MASTER_PATH_CENTER);
          let bend = Math.sin(t * Math.PI * 2);
          if (s.id === "c1") bend *= 1 - smooth((t - 0.5) / 0.35);
          if (Math.abs(lateral + s.lean * TRAIL_LEAN - s.wobble * (s.lean ? Math.abs(bend) : bend)) < PATH_HALF) {
            path = true;
            break;
          }
        }
      }
      if (!path && !meadow[c]) {
        if (Math.abs(wx) < PASS_HALF && wz < 0) {
          path = Math.abs(wx - pass.wobble * Math.sin((r - MEADOW) / (-GATE_Z - MEADOW) * Math.PI * 2)) < TRAIL_HALF;
        } else if (Math.abs(wx) < PATH_HALF && wz > 0) path = true;
      }
      for (let n = 0; n < headquartersFronts.length && !headquartersPath; n++) {
        const front = headquartersFronts[n], dx = wx - front.center.x, dz = wz - front.center.z;
        const across = dx * front.tangent.x + dz * front.tangent.z;
        const depth = dx * -front.tangent.z + dz * front.tangent.x;
        headquartersPath = Math.abs(across) < front.halfLength && Math.abs(depth) < front.halfWidth && tops[c] === 0;
      }
      if (headquartersPath) {
        path = true;
      }
      if (!path) return;
      masterPaths[i] = 1;
      masterList.push(i);
      masterPathCount++;
      masterHashValue = Math.imul(masterHashValue ^ i, 16777619);
    };
    for (let gx = 0; gx < PX; gx++) {
      const wx = (gx + 0.5) * PATH_UNIT + ORIGIN.x;
      for (let gz = 0; gz < PZ; gz++) masterCell(gx, gz, wx);
    }
    // The column scaffolding has served its purpose; do not retain it in the
    // closures the island hands out.
    masterPaths = tops = surfaces = bottoms = null;
    const masterPathHash = (masterHashValue >>> 0).toString(16).padStart(8, "0");
    const pathData = new Float32Array(PATH_CAPACITY * 20);
    let pathCount = 0, pathVersion = 0, pathReflows = 0, ringPathCount = 0, visibleSpokeCount = 0;
    let requestedInner = 0, ringInner = 0, ringCenter = 0, ringOuter = 0, pathVisible = false;
    const tileInnerRadius = (x, z) => Math.hypot(Math.max(0, Math.abs(x) - PATH_UNIT / 2), Math.max(0, Math.abs(z) - PATH_UNIT / 2));
    const writePathTile = (i, x, z) => {
      if (pathCount >= PATH_CAPACITY) throw new Error("Dynamic path instance capacity exceeded");
      paths[i] = 1;
      const o = pathCount++ * 20;
      pathData[o] = 1;
      pathData[o + 1] = 0;
      pathData[o + 2] = 0;
      pathData[o + 3] = 0;
      pathData[o + 4] = 0;
      pathData[o + 5] = 1;
      pathData[o + 6] = 0;
      pathData[o + 7] = 0;
      pathData[o + 8] = 0;
      pathData[o + 9] = 0;
      pathData[o + 10] = 1;
      pathData[o + 11] = 0;
      pathData[o + 12] = x;
      pathData[o + 13] = surfaceAt(x, z) + PATH_LIFT;
      pathData[o + 14] = z;
      pathData[o + 15] = 1;
      pathData[o + 16] = 1;
      pathData[o + 17] = 0;
      pathData[o + 18] = 0;
      pathData[o + 19] = 0;
    };
    // The ring scans only its own square of cells, the spokes only their master list
    const setPathRadius = (platformRadius) => {
      requestedInner = platformRadius + PATH_UNIT;
      const quantized = Math.ceil((requestedInner - 1e-9) / PATH_UNIT) * PATH_UNIT;
      if (quantized === ringInner) return false;
      ringInner = quantized;
      ringCenter = ringInner + PATH_HALF;
      ringOuter = ringCenter + PATH_HALF;
      pathVisible = ringOuter <= MEADOW;
      pathCount = 0;
      ringPathCount = 0;
      visibleSpokeCount = 0;
      paths.fill(0);
      if (pathVisible) {
        const g0 = Math.max(0, Math.floor((-ringOuter - ORIGIN.x) / PATH_UNIT)), g1 = Math.min(PX - 1, Math.ceil((ringOuter - ORIGIN.x) / PATH_UNIT));
        for (let gx = g0; gx <= g1; gx++) {
          const wx = (gx + 0.5) * PATH_UNIT + ORIGIN.x;
          for (let gz = g0; gz <= g1; gz++) {
            const i = gx * PZ + gz, c = (gx >> 1) * SZ + (gz >> 1);
            if (!land[c] || !meadow[c]) continue;
            const wz = (gz + 0.5) * PATH_UNIT + ORIGIN.z;
            const innerRadius = tileInnerRadius(wx, wz);
            if (innerRadius < ringInner || innerRadius >= ringOuter) continue;
            writePathTile(i, wx, wz);
            ringPathCount++;
          }
        }
      }
      for (let n = 0; n < masterList.length; n++) {
        const i = masterList[n], gx = Math.floor(i / PZ), gz = i % PZ;
        const wx = (gx + 0.5) * PATH_UNIT + ORIGIN.x, wz = (gz + 0.5) * PATH_UNIT + ORIGIN.z;
        if (tileInnerRadius(wx, wz) < ringOuter) continue;
        writePathTile(i, wx, wz);
        visibleSpokeCount++;
      }
      pathVersion++;
      pathReflows++;
      return true;
    };
    const overlapsPath = (x, z, radius) => {
      const gx0 = Math.max(0, Math.floor((x - radius - ORIGIN.x) / PATH_UNIT));
      const gx1 = Math.min(PX - 1, Math.floor((x + radius - ORIGIN.x) / PATH_UNIT));
      const gz0 = Math.max(0, Math.floor((z - radius - ORIGIN.z) / PATH_UNIT));
      const gz1 = Math.min(PZ - 1, Math.floor((z + radius - ORIGIN.z) / PATH_UNIT));
      const half = PATH_UNIT / 2, radius2 = radius * radius;
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = (gx + 0.5) * PATH_UNIT + ORIGIN.x;
        const dx = Math.max(0, Math.abs(cx - x) - half);
        for (let gz = gz0; gz <= gz1; gz++) {
          const i = gx * PZ + gz;
          if (!paths[i]) continue;
          const cz = (gz + 0.5) * PATH_UNIT + ORIGIN.z;
          const dz = Math.max(0, Math.abs(cz - z) - half);
          if (dx * dx + dz * dz <= radius2) return true;
        }
      }
      return false;
    };
    // Walking centerlines use the same bends as the rendered path mask.
    // Keep the master curves fixed; navigation clips them to the growing ring.
    const centerlines = spokes.map((s) => {
      const points = [];
      for (let r = MASTER_PATH_CENTER; r <= MEADOW; r += PATH_UNIT) {
        const t = (r - MASTER_PATH_CENTER) / (MEADOW - MASTER_PATH_CENTER);
        let bend = Math.sin(t * Math.PI * 2);
        if (s.id === "c1") bend *= 1 - smooth((t - 0.5) / 0.35);
        const angle = s.angle + (-s.lean * TRAIL_LEAN + s.wobble * (s.lean ? Math.abs(bend) : bend)) / r;
        points.push({ x: Math.sin(angle) * r, z: -Math.cos(angle) * r });
      }
      return points;
    });
    for (const north of [true, false]) {
      const points = [];
      for (let r = MEADOW; r <= RADIUS; r += PATH_UNIT) {
        const x = north ? pass.wobble * Math.sin((r - MEADOW) / (-GATE_Z - MEADOW) * Math.PI * 2) : 0;
        points.push({ x, z: (north ? -1 : 1) * Math.sqrt(r * r - x * x) });
      }
      centerlines.push(points);
    }
    for (const front of headquartersFronts) {
      centerlines.push(front.connector);
      const points = [];
      for (let n = -front.halfLength + PATH_HALF; n <= front.halfLength - PATH_HALF; n += PATH_UNIT) points.push({ x: front.center.x + front.tangent.x * n, z: front.center.z + front.tangent.z * n });
      centerlines.push(points);
    }
    const path = {
      geometry: PATH_TILE,
      instanceData: pathData,
      centerlines,
      get version() { return pathVersion; },
      setRadius: setPathRadius,
      overlaps: overlapsPath,
      apply(node) {
        node.instanceCount = pathCount;
        node.instanceVersion = pathVersion;
        node.visible = pathCount > 0;
      },
      debug: {
        get active() { return pathVisible; },
        get requestedInnerRadius() { return requestedInner; },
        get ringInnerRadius() { return ringInner; },
        get ringCenterRadius() { return ringCenter; },
        get ringOuterRadius() { return ringOuter; },
        get quantizedRadius() { return ringInner; },
        get visibleInstanceCount() { return pathCount; },
        masterSpokeCellCount: masterPathCount,
        get visibleSpokeCellCount() { return visibleSpokeCount; },
        get ringCellCount() { return ringPathCount; },
        get clippedSpokeCellCount() { return masterPathCount - visibleSpokeCount; },
        masterMaskBuildCount: 1,
        masterMaskHash: masterPathHash,
        bufferCapacity: PATH_CAPACITY,
        get reflowCount() { return pathReflows; }
      }
    };
    const inside = (ROOM.from + ROOM.to) / 2;
    const mouths = frames.map((f) => ({ id: f.id, clock: f.clock, angle: f.angle, x: f.x, z: f.z, ry: facing(f.axis), floorY: 0, inside: { x: f.x + f.ox * inside, z: f.z + f.oz * inside }, apron: { x: f.x - f.ox * 1.6, z: f.z - f.oz * 1.6 } }));
    const geometry = gridGeometry(grid, { unit: UNIT, palette: PALETTE, origin: ORIGIN, matrixCaves, floorRooms: [...headquartersRooms, ...basement.rooms] });
    const rampOffset = geometry.verts.length / 3;
    const rampFaceOffset = geometry.faces.length;
    for (const v of rampGeometry.verts) geometry.verts.push(v);
    for (const face of rampGeometry.faces) geometry.faces.push({ ...face, i: face.i.map((i) => i + rampOffset) });
    const windowOffset = geometry.verts.length / 3;
    for (const value of windowGeometry.verts) geometry.verts.push(value);
    for (const face of windowGeometry.faces) geometry.faces.push({ ...face, i: face.i.map((i) => i + windowOffset) });
    const rockCaves = compactCaveLabels(matrixCaves, geometry, grid, UNIT, ORIGIN);
    matrixCaves = null;
    // Four half-spaces describe each continuous ramp's triangular footprint
    // and sloping top. Its column supplies the fifth, horizontal bottom plane.
    const rampFaceCount = rampGeometry.faces.length;
    const rampSight = new Float64Array(rampFaceCount * 17);
    for (let i = 0; i < rampFaceCount; i++) {
      const face = geometry.faces[rampFaceOffset + i], v = geometry.verts, a = face.i[0] * 3, b = face.i[1] * 3, c = face.i[2] * 3, at = i * 17;
      const ax = v[a], ay = v[a + 1], az = v[a + 2], bx = v[b] - ax, by = v[b + 1] - ay, bz = v[b + 2] - az, cx = v[c] - ax, cy = v[c + 1] - ay, cz = v[c + 2] - az;
      const determinant = bx * cz - bz * cx;
      if (Math.abs(determinant) < 1e-12) { rampSight[at + 16] = -Infinity; continue; }
      const sign = Math.sign(determinant), gradientX = (by * cz - cy * bz) / determinant, gradientZ = (bx * cy - cx * by) / determinant;
      for (let edge = 0; edge < 3; edge++) {
        const p = face.i[edge] * 3, q = face.i[(edge + 1) % 3] * 3, nx = (v[q + 2] - v[p + 2]) * sign, nz = (v[p] - v[q]) * sign, length = Math.hypot(nx, nz), k = at + edge * 4;
        rampSight[k] = nx / length; rampSight[k + 2] = nz / length; rampSight[k + 3] = (nx * v[p] + nz * v[p + 2]) / length;
      }
      const length = Math.hypot(gradientX, 1, gradientZ);
      rampSight[at + 12] = -gradientX / length; rampSight[at + 13] = 1 / length; rampSight[at + 14] = -gradientZ / length; rampSight[at + 15] = (ay - gradientX * ax - gradientZ * az) / length;
      rampSight[at + 16] = Math.max(ay, v[b + 1], v[c + 1]);
    }
    const windowPieceAt = (x, y, z) => {
      const pieces = windowColumns[column(x, z)];
      if (pieces) for (const piece of pieces) {
        if (y < piece.minY || y >= piece.maxY) continue;
        // Occupancy includes internal faces shared by adjacent fragments.
        // A zero-size swept body treats each as a harmless touch, which would
        // otherwise report an infinitesimal air seam through solid rock.
        const v = piece.vertices, indices = piece.triangles.i;
        let inside = true;
        for (let n = 0; n < indices.length; n += 3) {
          const a = indices[n] * 3, b = indices[n + 1] * 3, c = indices[n + 2] * 3;
          const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], vx = v[c] - v[a], vy = v[c + 1] - v[a + 1], vz = v[c + 2] - v[a + 2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const distance = nx * (x - v[a]) + ny * (y - v[a + 1]) + nz * (z - v[a + 2]);
          if (distance > 0 && distance * distance > 1e-18 * (nx * nx + ny * ny + nz * nz)) { inside = false; break; }
        }
        if (inside) return piece;
      }
      return null;
    };
    const voxelMaterialAt = (x, y, z) => {
      const material = grid.get(Math.floor((x - ORIGIN.x) / UNIT), Math.floor((y - ORIGIN.y) / UNIT), Math.floor((z - ORIGIN.z) / UNIT));
      if (material) return PALETTE[material];
      const piece = windowPieceAt(x, y, z);
      return piece ? piece.color : null;
    };
    const solidAt = (x, y, z) => voxelMaterialAt(x, y, z) !== null;
    const rockCaveCell = (gx, gy, gz) => {
      for (let n = 0; n < rockCaves.regions.length; n++) {
        const region = rockCaves.regions[n], x = gx - region.x, y = gy - region.y, z = gz - region.z;
        if (x < 0 || y < 0 || z < 0 || x >= region.sx || y >= region.sy || z >= region.sz) continue;
        const cave = region.data[(x * region.sy + y) * region.sz + z];
        if (cave) return cave;
      }
      return 0;
    };
    // Match the nearest actual voxel boundary, not the cave's bounding box.
    // Unowned exterior air competes too, so the top of a thin cave roof keeps
    // its radial material while the underside follows the carved cave's wave.
    let caveCell = -1;
    const caveOpen = new Uint8Array(6), caveOwner = new Int32Array(6);
    const rockCaveAt = (x, y, z) => {
      const px = (x - ORIGIN.x) / UNIT, py = (y - ORIGIN.y) / UNIT, pz = (z - ORIGIN.z) / UNIT;
      const gx = Math.floor(px), gy = Math.floor(py), gz = Math.floor(pz);
      if (gx < 0 || gy < 0 || gz < 0 || gx >= SX || gy >= SY || gz >= SZ) return 0;
      if (!grid.has(gx, gy, gz)) {
        // Window cuts leave solid convex pieces in otherwise empty grid cells.
        // Their ownership is the same one carried by their rendered faces.
        const piece = windowPieceAt(x, y, z);
        return piece ? piece.matrixCave : rockCaveCell(gx, gy, gz);
      }
      // A stone texture samples one voxel many times in a row. Its open sides
      // and their owners never change, so keep them for the last voxel.
      const cell = grid.index(gx, gy, gz);
      if (cell !== caveCell) {
        caveCell = cell;
        for (let side = 0; side < 6; side++) {
          const axis = side >> 1, step = side & 1 ? 1 : -1;
          const nx = gx + (axis === 0 ? step : 0), ny = gy + (axis === 1 ? step : 0), nz = gz + (axis === 2 ? step : 0);
          caveOpen[side] = grid.has(nx, ny, nz) ? 0 : 1;
          caveOwner[side] = caveOpen[side] ? rockCaveCell(nx, ny, nz) : 0;
        }
      }
      let nearest = Infinity, owner = 0;
      for (let side = 0; side < 6; side++) {
        if (!caveOpen[side]) continue;
        const axis = side >> 1, positive = side & 1;
        const fraction = axis === 0 ? px - gx : axis === 1 ? py - gy : pz - gz, distance = positive ? 1 - fraction : fraction;
        if (distance > nearest) continue;
        const cave = caveOwner[side];
        if (distance < nearest || !cave) { nearest = distance; owner = cave; }
      }
      return owner;
    };
    // A section uses the same authored material as the surrounding mesh.
    // Return shared palette RGB arrays; air and points outside the island are null.
    const rockMaterialAt = (x, y, z) => {
      const material = voxelMaterialAt(x, y, z);
      if (material) return material;
      const i = column(x, z);
      if (i < 0) return null;
      // Smooth ramps occupy the gap between their voxel base and rendered
      // triangles. Read the actual triangle color, including the main ramp's
      // dark stone patches, rather than guessing a material from elevation.
      for (let layer = 0; layer < 2; layer++) {
        const range = layer ? basementCollision[i] : rampCollision[i];
        const base = layer ? (((basementCavities[i] >> 4) & 63) - 64) * UNIT : (((lowerCavities[i] >> 4) & 63) - 32) * UNIT;
        if (!range || y <= base + 1e-7) continue;
        for (let n = 0; n < (range & 3); n++) {
          const face = geometry.faces[rampFaceOffset + (range >>> 2) + n];
          if (rampTriangleTop(face, x, z, 0) > y + 1e-7) return face.color;
        }
      }
      return null;
    };
    const sightConvexHit = (planes, offset, count, x, y, z, dx, dy, dz, lo, hi, ids = null) => {
      let tangent = false;
      for (let i = 0; i < count; i++) {
        const n = ids ? ids[offset + i] * 4 : offset + i * 4;
        const nx = planes[n], ny = planes[n + 1], nz = planes[n + 2], distance = planes[n + 3] - nx * x - ny * y - nz * z, speed = nx * dx + ny * dy + nz * dz;
        if (Math.abs(speed) < 1e-12) { if (distance < -1e-9) return false; if (Math.abs(distance) <= 1e-9) tangent = true; }
        else {
          const t = distance / speed;
          if (speed > 0) hi = Math.min(hi, t); else lo = Math.max(lo, t);
          if (lo >= hi - 1e-12) return false;
        }
      }
      if (tangent) {
        const middle = (lo + hi) / 2, px = x + dx * middle, py = y + dy * middle, pz = z + dz * middle;
        for (let i = 0; i < count; i++) {
          const n = ids ? ids[offset + i] * 4 : offset + i * 4;
          const nx = planes[n], ny = planes[n + 1], nz = planes[n + 2];
          if (Math.abs(nx * dx + ny * dy + nz * dz) >= 1e-12 || Math.abs(planes[n + 3] - nx * x - ny * y - nz * z) > 1e-9) continue;
          // A tangent to an exposed face is clear. Shared fragment/triangle
          // planes inside the solid union must not become transparent seams.
          if (!rockMaterialAt(px + nx * 1e-6, py + ny * 1e-6, pz + nz * 1e-6) || !rockMaterialAt(px - nx * 1e-6, py - ny * 1e-6, pz - nz * 1e-6)) return false;
        }
      }
      return lo < hi - 1e-12;
    };
    // A point ray visits only the voxels it crosses. Window fragments and
    // continuous ramp prisms are clipped exactly once per crossed column.
    // Most columns hold no window pieces or ramp prisms: rays cross them on voxels alone
    const sightColumnWork = new Uint8Array(SX * SZ);
    for (let i = 0; i < SX * SZ; i++) if (windowColumns[i] || rampCollision[i] || basementCollision[i]) sightColumnWork[i] = 1;
    const sightClearAt = (x, y, z, toX, toY, toZ) => {
      const dx = toX - x, dy = toY - y, dz = toZ - z;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-12) return rockMaterialAt(x, y, z) === null;
      let lo = 0, hi = 1;
      for (let axis = 0; axis < 3; axis++) {
        const start = axis === 0 ? x : axis === 1 ? y : z, speed = axis === 0 ? dx : axis === 1 ? dy : dz, min = axis === 0 ? ORIGIN.x : axis === 1 ? ORIGIN.y : ORIGIN.z, max = min + (axis === 0 ? SX : axis === 1 ? SY : SZ) * UNIT;
        if (!speed) { if (start < min || start >= max) return true; }
        else {
          const a = (min - start) / speed, b = (max - start) / speed;
          lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
          if (lo >= hi - 1e-12) return true;
        }
      }
      let gx = clamp(Math.floor((x + dx * lo - ORIGIN.x) / UNIT), 0, SX - 1), gy = clamp(Math.floor((y + dy * lo - ORIGIN.y) / UNIT), 0, SY - 1), gz = clamp(Math.floor((z + dz * lo - ORIGIN.z) / UNIT), 0, SZ - 1);
      const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz), stepX = dx ? UNIT / Math.abs(dx) : Infinity, stepY = dy ? UNIT / Math.abs(dy) : Infinity, stepZ = dz ? UNIT / Math.abs(dz) : Infinity;
      let tx = dx ? (ORIGIN.x + (gx + (dx > 0 ? 1 : 0)) * UNIT - x) / dx : Infinity, ty = dy ? (ORIGIN.y + (gy + (dy > 0 ? 1 : 0)) * UNIT - y) / dy : Infinity, tz = dz ? (ORIGIN.z + (gz + (dz > 0 ? 1 : 0)) * UNIT - z) / dz : Infinity;
      let t = lo, previousColumn = -1;
      for (let step = 0; step < SX + SY + SZ + 3; step++) {
        const end = Math.min(tx, ty, tz, hi), column = gx * SZ + gz;
        if (end > t + 1e-12) {
          if (data[(gx * SY + gy) * SZ + gz]) return false;
          if (column !== previousColumn && sightColumnWork[column]) {
            const columnEnd = Math.min(tx, tz, hi), a = y + dy * t, b = y + dy * columnEnd, minY = Math.min(a, b), maxY = Math.max(a, b), pieces = windowColumns[column];
            if (pieces) for (const piece of pieces) {
              if (minY > piece.maxY || maxY < piece.minY) continue;
              if (sightConvexHit(windowSightPlanes, piece.sightOffset, piece.sightCount, x, y, z, dx, dy, dz, t, columnEnd, windowSightRefs)) return false;
            }
            for (let layer = 0; layer < 2; layer++) {
              const range = layer ? basementCollision[column] : rampCollision[column], base = layer ? (((basementCavities[column] >> 4) & 63) - 64) * UNIT : (((lowerCavities[column] >> 4) & 63) - 32) * UNIT;
              if (!range || maxY <= base + 1e-9) continue;
              const bottom = dy ? (base - y) / dy : 0, start = dy > 0 ? Math.max(t, bottom) : t, finish = dy < 0 ? Math.min(columnEnd, bottom) : columnEnd;
              if (start >= finish - 1e-12) continue;
              for (let n = 0; n < (range & 3); n++) {
                const at = ((range >>> 2) + n) * 17;
                if (minY > rampSight[at + 16]) continue;
                if (sightConvexHit(rampSight, at, 4, x, y, z, dx, dy, dz, start, finish)) return false;
              }
            }
            previousColumn = column;
          }
        }
        if (end >= hi - 1e-12) break;
        if (tx <= end + 1e-12) { gx += sx; tx += stepX; }
        if (ty <= end + 1e-12) { gy += sy; ty += stepY; }
        if (tz <= end + 1e-12) { gz += sz; tz += stepZ; }
        if (gx < 0 || gx >= SX || gy < 0 || gy >= SY || gz < 0 || gz >= SZ) break;
        t = end;
      }
      return true;
    };
    // A conservative empty-volume certificate for batches of sight rays.
    // Partial window cells and sloping ramp prisms retain their whole bounds;
    // uncertainty therefore falls back to the exact ray query above.
    const sightBoxClearAt = (minX, minY, minZ, maxX, maxY, maxZ) => {
      const x0 = Math.max(0, Math.floor((minX - ORIGIN.x - 1e-7) / UNIT)), x1 = Math.min(SX - 1, Math.floor((maxX - ORIGIN.x + 1e-7) / UNIT));
      const y0 = Math.max(0, Math.floor((minY - ORIGIN.y - 1e-7) / UNIT)), y1 = Math.min(SY - 1, Math.floor((maxY - ORIGIN.y + 1e-7) / UNIT));
      const z0 = Math.max(0, Math.floor((minZ - ORIGIN.z - 1e-7) / UNIT)), z1 = Math.min(SZ - 1, Math.floor((maxZ - ORIGIN.z + 1e-7) / UNIT));
      if (x0 > x1 || y0 > y1 || z0 > z1) return true;
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const column = x * SZ + z;
        for (let y = y0; y <= y1; y++) if (data[(x * SY + y) * SZ + z]) return false;
        const pieces = windowColumns[column];
        if (pieces) for (let n = 0; n < pieces.length; n++) if (minY <= pieces[n].maxY && maxY >= pieces[n].minY) return false;
        for (let layer = 0; layer < 2; layer++) {
          const range = layer ? basementCollision[column] : rampCollision[column];
          if (!range) continue;
          const base = layer ? (((basementCavities[column] >> 4) & 63) - 64) * UNIT : (((lowerCavities[column] >> 4) & 63) - 32) * UNIT;
          if (maxY < base) continue;
          for (let n = 0; n < (range & 3); n++) if (minY <= rampSight[((range >>> 2) + n) * 17 + 16]) return false;
        }
      }
      return true;
    };
    const sightConvexBox = (planes, offset, count, minX, minY, minZ, maxX, maxY, maxZ, ids = null) => {
      for (let i = 0; i < count; i++) {
        const n = ids ? ids[offset + i] * 4 : offset + i * 4, nx = planes[n], ny = planes[n + 1], nz = planes[n + 2];
        if (nx * (nx < 0 ? minX : maxX) + ny * (ny < 0 ? minY : maxY) + nz * (nz < 0 ? minZ : maxZ) > planes[n + 3]) return false;
      }
      return true;
    };
    const sightCutBoxClear = (cuts, minX, minY, minZ, maxX, maxY, maxZ) => {
      for (let n = 0; n < cuts.length; n++) {
        const planes = cuts[n];
        let separate = false;
        for (let i = 0; i < planes.length; i++) {
          const p = planes[i], nearest = p[0] * (p[0] < 0 ? maxX : minX) + p[1] * (p[1] < 0 ? maxY : minY) + p[2] * (p[2] < 0 ? maxZ : minZ);
          if (nearest > p[3] + 1e-8) { separate = true; break; }
        }
        if (!separate) return false;
      }
      return true;
    };
    // Every part of a blocking cross-section must be rock. At a flared window,
    // certify the clipped cell volume against a complete convex stone fragment;
    // a few occupied sample points cannot rule out a narrow opening between them.
    const sightBoxSolidAt = (minX, minY, minZ, maxX, maxY, maxZ) => {
      minX -= 1e-7; minY -= 1e-7; minZ -= 1e-7; maxX += 1e-7; maxY += 1e-7; maxZ += 1e-7;
      const x0 = Math.floor((minX - ORIGIN.x) / UNIT), x1 = Math.floor((maxX - ORIGIN.x) / UNIT);
      const y0 = Math.floor((minY - ORIGIN.y) / UNIT), y1 = Math.floor((maxY - ORIGIN.y) / UNIT);
      const z0 = Math.floor((minZ - ORIGIN.z) / UNIT), z1 = Math.floor((maxZ - ORIGIN.z) / UNIT);
      if (x0 < 0 || y0 < 0 || z0 < 0 || x1 >= SX || y1 >= SY || z1 >= SZ) return false;
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) {
        if (data[(x * SY + y) * SZ + z]) continue;
        const pieces = windowColumns[x * SZ + z];
        if (!pieces) return false;
        const ax = Math.max(minX, ORIGIN.x + x * UNIT), ay = Math.max(minY, ORIGIN.y + y * UNIT), az = Math.max(minZ, ORIGIN.z + z * UNIT);
        const bx = Math.min(maxX, ORIGIN.x + (x + 1) * UNIT), by = Math.min(maxY, ORIGIN.y + (y + 1) * UNIT), bz = Math.min(maxZ, ORIGIN.z + (z + 1) * UNIT);
        let covered = false;
        for (let n = 0; n < pieces.length; n++) {
          const p = pieces[n];
          if (ay < p.minY || by > p.maxY) continue;
          // All fragments in one cut cell are panels of the same logical wall.
          // Prove the box misses every authored opening before falling back to
          // containment in one convex fragment, so their joins cannot flicker.
          if (sightCutBoxClear(p.cuts, ax, ay, az, bx, by, bz)) { covered = true; break; }
          if (sightConvexBox(windowSightPlanes, p.sightOffset, p.sightCount, ax, ay, az, bx, by, bz, windowSightRefs)) { covered = true; break; }
        }
        if (!covered) return false;
      }
      return true;
    };
    const built = {
      geometry,
      path,
      heightAt,
      surfaceAt,
      supportAt,
      clearAt,
      voxelSegmentClearAt,
      ceilingAt,
      smoothSupportAt,
      cavityAt,
      rampColumnAt,
      frontageColumnAt,
      cavityBytes: cavities.byteLength + lowerCavities.byteLength + basementCavities.byteLength,
      solidAt,
      rockMaterialAt,
      rockCaveAt,
      rockCaveBytes: rockCaves.bytes,
      sightClearAt,
      sightBoxClearAt,
      sightBoxSolidAt,
      sightGrid: new Float64Array([UNIT, ORIGIN.x, ORIGIN.y, ORIGIN.z]),
      sightBytes: rampSight.byteLength + windowSightPlanes.byteLength + windowSightRefs.byteLength,
      windowPiecesAt: (x, z) => windowColumns[column(x, z)],
      isPath,
      onLand,
      mouths,
      headquarters: { caveIndex: HEADQUARTERS_CAVE, floor: HEADQUARTERS_FLOOR, ceiling: HEADQUARTERS_CEILING, rockCover: HEADQUARTERS_ROCK, room: HEADQUARTERS_ROOM, rooms: headquartersRooms, windows: headquartersWindows, windowFragments: windowFragmentCount, windowFaces: windowGeometry.faces.length, gallery: headquartersGallery, balconies: headquartersBalconies, ramps: headquartersRamps, fronts: headquartersFronts, basement },
      gate: { x: 0, z: GATE_Z, ry: 0 },
      radius: RADIUS,
      undersideDepth: DEPTH,
      undersideDepthAt,
      meadowRadius: MEADOW,
      passHalf: PASS_HALF,
      unit: UNIT,
      pathUnit: PATH_UNIT
    };
    ISLANDS.set(seed, built);
    return built;
  };
  BL.terrain = { makeGrid, gridGeometry, island, segmentBoxClear, PALETTE, MAX_HEIGHT };
})();
