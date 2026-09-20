// Perceived wall sections and the basement rim for views through island stone.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const LIMIT = 96, EPS = 1e-5, RADIUS = 12, FADE_START = 10.5, FADE_SECONDS = 0.25, SURFACE_PATCH = 0.6;
  const OUTDOOR_CHUNK = 6, OUTDOOR_PATCH = 1.5;
  // Wall geometry is a pure function of the memoised island. Each visit gets
  // fresh fade and camera state over one shared, never-written build.
  const BUILDS = new WeakMap(), round = (n) => Math.round(n / EPS);
  // Room, ramp and common walls in station order, keyed by the shared sample order
  const STATION_ORDERS = new WeakMap();
  const build = (island) => {
    const H = island.headquarters, contexts = [], windowOwners = new Map();
    const slopes = BL.slopeGuides.create({ island }), slopeSample = { side: 0, sector: 0 };
    const probe = { distance: Infinity, floor: 0, side: 0, station: 0 };
    // These routes are immutable. Floor clipping revisits their grid vertices
    // many times, so keep each segment's exact measures instead of rebuilding
    // them for every point query. Bounds only reject strictly farther spans.
    const rampSegments = new Map(), rampBlocks = new Map();
    for (const ramp of [...H.ramps, ...H.basement.ramps]) {
      const segments = new Float64Array((ramp.samples.length - 1) * 13 + 1), blocks = new Float64Array(Math.ceil((ramp.samples.length - 1) / 8) * 4);
      for (let n = 0; n < blocks.length; n += 4) { blocks[n] = blocks[n + 1] = Infinity; blocks[n + 2] = blocks[n + 3] = -Infinity; }
      rampBlocks.set(ramp, blocks);
      let station = 0;
      for (let i = 1; i < ramp.samples.length; i++) {
        const a = ramp.samples[i - 1], b = ramp.samples[i], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz), at = (i - 1) * 13;
        segments.set([a.x, a.y, a.z, dx, b.y - a.y, dz, dx * dx + dz * dz, length, station, Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)], at);
        station += length;
        const block = ((i - 1) >> 3) * 4;
        blocks[block] = Math.min(blocks[block], a.x, b.x); blocks[block + 1] = Math.min(blocks[block + 1], a.z, b.z); blocks[block + 2] = Math.max(blocks[block + 2], a.x, b.x); blocks[block + 3] = Math.max(blocks[block + 3], a.z, b.z);
      }
      rampSegments.set(ramp, segments);
    }
    const rampAt = (ramp, x, z, out, limit = Infinity) => {
      out.distance = limit;
      const segments = rampSegments.get(ramp), blocks = rampBlocks.get(ramp), end = segments.length - 1, last = segments[end];
      const lx = segments[last], lz = segments[last + 2], ldx = segments[last + 3], ldz = segments[last + 5];
      const lt = Math.max(0, Math.min(1, ((x - lx) * ldx + (z - lz) * ldz) / segments[last + 6]));
      const bound = (x - lx - ldx * lt) ** 2 + (z - lz - ldz * lt) ** 2 + 1e-9;
      let hit = last;
      for (let at = 0; at < end; at += 13) {
        if (at % 104 === 0) {
          const block = at / 26, cx = Math.max(blocks[block] - x, 0, x - blocks[block + 2]), cz = Math.max(blocks[block + 1] - z, 0, z - blocks[block + 3]);
          if (cx * cx + cz * cz > bound) { at += 91; continue; }
        }
        const bx = Math.max(segments[at + 9] - x, 0, x - segments[at + 11]), bz = Math.max(segments[at + 10] - z, 0, z - segments[at + 12]), b2 = bx * bx + bz * bz;
        if (b2 > bound || b2 > out.distance + 1e-12) continue;
        const ax = segments[at], az = segments[at + 2], dx = segments[at + 3], dz = segments[at + 5];
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / segments[at + 6]));
        const d = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
        if (d < out.distance) { hit = at; out.distance = d; out.floor = segments[at + 1] + segments[at + 4] * t; out.side = dx * (z - az) - dz * (x - ax); out.station = segments[at + 8] + segments[at + 7] * t; }
      }
      segments[end] = hit;
    };
    const rampWithin = (ramp, x, z, margin) => {
      const first = ramp.samples[0], next = ramp.samples[1], last = ramp.samples[ramp.samples.length - 1], previous = ramp.samples[ramp.samples.length - 2];
      let dx = next.x - first.x, dz = next.z - first.z, length = Math.hypot(dx, dz);
      if ((x - first.x) * dx / length + (z - first.z) * dz / length < -margin) return false;
      dx = last.x - previous.x; dz = last.z - previous.z; length = Math.hypot(dx, dz);
      return (x - last.x) * dx / length + (z - last.z) * dz / length <= margin;
    };
    const add = (kind, source, basement, index) => {
      const sx = Math.sin(source.angle || 0), sz = -Math.cos(source.angle || 0);
      const floor = kind === "ramp" ? basement ? H.basement.floor : H.floor : source.floor;
      const height = kind === "ramp" ? basement ? H.ceiling - H.floor : 3.5 : source.ceiling - floor;
      const ceiling = kind === "ramp" ? source.samples[0].y + height : source.ceiling;
      const context = { kind, index, basement, source, sx, sz, floor, ceiling, height, windows: [], groups: new Map(), surfaceFaces: [], surfaceGroupMap: new Map(), surfaceGroups: [], surfaceGroupSums: [], surfaceColumns: [], surfaceColumnMap: new Map(), surface: null, surfaceCount: 0, surfaceGroupCount: 0, lines: null, count: 0, bounds: new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]), searchBounds: new Float64Array([Infinity, floor - 0.4, Infinity, -Infinity, ceiling + 0.4, -Infinity]) };
      context.walls = []; context.wallMap = new Map(); context.surfaceWallGroups = []; context.surfaceSamples = [];
      const search = context.searchBounds;
      const gallery = kind === "common" && !basement ? H.gallery : null;
      const balconies = kind === "common" ? basement ? H.basement.balconies : H.balconies : null;
      const balconyContains = (balcony, radius, angle, margin) => {
        const angularMargin = radius > margin ? margin / radius : 0;
        let start = balcony.startAngle, end = balcony.endAngle;
        const join = balcony.roomJoin;
        if (join && radius < join.toRadius + margin) {
          const t = Math.max(0, Math.min(1, (radius - join.fromRadius) / (join.toRadius - join.fromRadius)));
          const boundary = join.angle + ((balcony.side < 0 ? end : start) - join.angle) * t;
          if (balcony.side < 0) end = boundary;
          else start = boundary;
        }
        return radius <= balcony.openingRadius + margin && angle >= start - angularMargin && angle <= end + angularMargin;
      };
      if (kind === "ramp") for (const p of source.samples) {
        const width = source.width / 2 + 0.4;
        search[0] = Math.min(search[0], p.x - width); search[2] = Math.min(search[2], p.z - width);
        search[3] = Math.max(search[3], p.x + width); search[5] = Math.max(search[5], p.z + width);
      } else {
        const radius = kind === "common" ? Math.max(gallery ? gallery.radius : source.radius, ...(balconies || []).map((balcony) => balcony.openingRadius)) + 0.4 : Math.hypot(source.width, source.depth) / 2 + 0.4;
        search[0] = source.x - radius; search[2] = source.z - radius; search[3] = source.x + radius; search[5] = source.z + radius;
        if (kind === "room") {
          const corridor = (source.corridorWidth ?? source.width - 1.3) / 2 + 0.4;
          search[0] = Math.min(search[0], source.approach.x - corridor); search[2] = Math.min(search[2], source.approach.z - corridor);
          search[3] = Math.max(search[3], source.approach.x + corridor); search[5] = Math.max(search[5], source.approach.z + corridor);
        }
      }
      context.contains = (x, y, z, margin = 0.38, includeWindows = true) => {
        if (includeWindows) for (const window of context.windows) for (const frustum of window.flare.frusta) {
          let inside = true;
          for (const plane of frustum.planes) if (plane[0] * x + plane[1] * y + plane[2] * z > plane[3] + margin) { inside = false; break; }
          if (inside) return true;
        }
        if (kind === "ramp") {
          const reach = (source.width / 2 + margin) ** 2;
          if (x < search[0] - margin || x > search[3] + margin || z < search[2] - margin || z > search[5] + margin) return false;
          rampAt(source, x, z, probe, reach * (1 + 1e-9) + 1e-9);
          return rampWithin(source, x, z, margin) && probe.distance <= reach && y >= probe.floor - margin && y <= Math.ceil((probe.floor + height) / island.unit) * island.unit + margin;
        }
        if (y < floor - margin || y > ceiling + margin) return false;
        if (kind === "common") {
          const radius = Math.hypot(x - source.x, z - source.z), angle = Math.atan2(x - source.x, source.z - z);
          const angularMargin = radius > margin ? margin / radius : 0;
          if (radius <= source.radius + margin || !!gallery && radius <= gallery.radius + margin && angle >= gallery.startAngle - angularMargin && angle <= gallery.endAngle + angularMargin) return true;
          if (balconies) for (const balcony of balconies) if (balconyContains(balcony, radius, angle, margin)) return true;
          return false;
        }
        const dx = x - source.x, dz = z - source.z, along = dx * sx + dz * sz, across = Math.abs(dx * -sz + dz * sx);
        const approach = (source.approach.x - source.x) * sx + (source.approach.z - source.z) * sz;
        return across <= source.width / 2 + margin && Math.abs(along) <= source.depth / 2 + margin && across + Math.abs(along) <= (source.width + source.depth) / 2 - 0.55 + margin * 2 || along >= approach - margin && along <= -source.depth / 2 + 1.15 + margin && across <= (source.corridorWidth ?? source.width - 1.3) / 2 + margin;
      };
      contexts.push(context);
      return context;
    };
    for (const room of H.rooms) add("room", room, false, room.index);
    for (const room of H.basement.rooms) add("room", room, true, room.index);
    for (let i = 0; i < H.ramps.length; i++) add("ramp", H.ramps[i], false, i);
    for (let i = 0; i < H.basement.ramps.length; i++) add("ramp", H.basement.ramps[i], true, i);
    add("common", { ...H.room, floor: H.floor, ceiling: H.ceiling }, false, -1);
    add("common", { ...H.basement.room, floor: H.basement.floor, ceiling: H.basement.ceiling }, true, -1);
    const outdoorContexts = [], outdoorMap = new Map();
    for (const window of H.windows) {
      let owner = null, distance = Infinity;
      for (const context of contexts) {
        if (context.basement !== !!window.basement) continue;
        if (window.kind === "room" && context.kind === "room" && context.index === window.roomIndex) owner = context;
        else if (window.kind === "ramp" && context.kind === "ramp") {
          rampAt(context.source, window.x, window.z, probe);
          const d = probe.distance + (probe.floor - window.floor) ** 2 * 16;
          if (d < distance) { distance = d; owner = context; }
        } else if (window.kind === "panorama" && context.kind === "common") owner = context;
      }
      if (owner) { owner.windows.push(window); windowOwners.set(window.index, owner); }
    }
    // Match the rendered ramp's grid vertices, including its clipped landing.
    // Wall faces are clipped at that same piecewise-linear floor during build.
    const floorVertices = new Map();
    const floorKey = (context, x, z) => `${context.basement ? 1 : 0}:${context.index}:${round(x)},${round(z)}`;
    for (const face of island.geometry.faces) if (face.headquartersRamp || face.headquartersBasementRamp) {
      const v = island.geometry.verts;
      let x = 0, z = 0, owner = null, nearest = Infinity;
      for (const i of face.i) { x += v[i * 3]; z += v[i * 3 + 2]; } x /= face.i.length; z /= face.i.length;
      for (const context of contexts) if (context.kind === "ramp" && context.basement === !!face.headquartersBasementRamp) {
        rampAt(context.source, x, z, probe);
        if (probe.distance < nearest) { nearest = probe.distance; owner = context; }
      }
      for (const i of face.i) floorVertices.set(floorKey(owner, v[i * 3], v[i * 3 + 2]), v[i * 3 + 1]);
    }
    const floorVertex = (context, x, z) => {
      const key = floorKey(context, x, z), value = floorVertices.get(key);
      if (value !== undefined) return value;
      rampAt(context.source, x, z, probe);
      floorVertices.set(key, probe.floor);
      return probe.floor;
    };
    const floorSpan = Math.ceil(island.radius * 2 / island.unit) + 9, floorGrids = new Map();
    const floorCorner = (grid, context, gx, gz) => {
      const at = gx * floorSpan + gz;
      let value = grid[at];
      if (value !== value) value = grid[at] = floorVertex(context, island.sightGrid[1] + gx * island.unit, island.sightGrid[3] + gz * island.unit);
      return value;
    };
    const floorAt = (context, x, z) => {
      const unit = island.unit, ox = island.sightGrid[1], oz = island.sightGrid[3], gx = Math.floor((x - ox) / unit), gz = Math.floor((z - oz) / unit);
      const ax = ox + gx * unit, az = oz + gz * unit, tx = (x - ax) / unit, tz = (z - az) / unit;
      let grid = floorGrids.get(context);
      if (!grid) { grid = new Float64Array(floorSpan * floorSpan).fill(NaN); floorGrids.set(context, grid); }
      const a = floorCorner(grid, context, gx, gz), b = floorCorner(grid, context, gx, gz + 1), c = floorCorner(grid, context, gx + 1, gz + 1), d = floorCorner(grid, context, gx + 1, gz);
      return tz >= tx ? a * (1 - tz) + b * (tz - tx) + c * tx : a * (1 - tx) + c * tz + d * (tx - tz);
    };
    const clipFace = (points, axis, value, direction) => {
      const output = [];
      for (let n = 0; n < points.length; n++) {
        const a = points[n], b = points[(n + 1) % points.length], da = (a[axis] - value) * direction, db = (b[axis] - value) * direction;
        if (da >= 0) output.push(a);
        if ((da < 0) !== (db < 0)) { const t = da / (da - db); output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
      }
      return output;
    };
    const triangleHasArea = (a, b, c) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      return (uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2 > EPS * EPS;
    };
    const faceHasArea = (polygon) => {
      for (let fan = 1; fan + 1 < polygon.length; fan++) if (triangleHasArea(polygon[0], polygon[fan], polygon[fan + 1])) return true;
      return false;
    };
    const splitFace = (points, size, visit, height = size) => {
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const p of points) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); minZ = Math.min(minZ, p[2]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); maxZ = Math.max(maxZ, p[2]); }
      const flatX = maxX - minX < EPS, flatY = maxY - minY < EPS, flatZ = maxZ - minZ < EPS;
      const px0 = Math.floor((minX + (flatX ? 0 : EPS)) / size), px1 = Math.floor((maxX - (flatX ? 0 : EPS)) / size);
      const py0 = Math.floor((minY + (flatY ? 0 : EPS)) / height), py1 = Math.floor((maxY - (flatY ? 0 : EPS)) / height);
      const pz0 = Math.floor((minZ + (flatZ ? 0 : EPS)) / size), pz1 = Math.floor((maxZ - (flatZ ? 0 : EPS)) / size);
      for (let px = px0; px <= px1; px++) for (let pz = pz0; pz <= pz1; pz++) for (let py = py0; py <= py1; py++) {
        let polygon = points;
        if (!flatX) { polygon = clipFace(polygon, 0, px * size, 1); polygon = clipFace(polygon, 0, (px + 1) * size, -1); }
        if (!flatZ) { polygon = clipFace(polygon, 2, pz * size, 1); polygon = clipFace(polygon, 2, (pz + 1) * size, -1); }
        if (!flatY) { polygon = clipFace(polygon, 1, py * height, 1); polygon = clipFace(polygon, 1, (py + 1) * height, -1); }
        if (polygon.length >= 3) visit(polygon);
      }
    };
    const outdoorContextAt = (gx, gz, frontage = -1, side = -1, sector = -1) => {
      const key = frontage >= 0 ? `front:${frontage}` : `slope:${side}`;
      let context = outdoorMap.get(key);
      if (context) return context;
      const minX = gx * OUTDOOR_CHUNK, minZ = gz * OUTDOOR_CHUNK, maxX = minX + OUTDOOR_CHUNK, maxZ = minZ + OUTDOOR_CHUNK;
      const wall = { key: 0, bounds: new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]), distance: Infinity, target: 0, phase: 0, perceived: false, visibleMin: Infinity, visibleMax: -Infinity, surfaceTree: null, surfaceOrder: null };
      context = { kind: "surface", index: outdoorContexts.length, basement: false, source: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }, floor: -Infinity, ceiling: Infinity, height: Infinity, windows: [], groups: new Map(), surfaceFaces: [], surfaceGroupMap: new Map(), surfaceGroups: [], surfaceGroupSums: [], surfaceColumns: [], surfaceColumnMap: new Map(), surfaceWallGroups: [], surfaceSamples: [], walls: [wall], wallMap: new Map([[0, 0]]), lines: null, count: 0, bounds: new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]), searchBounds: new Float64Array([minX, -Infinity, minZ, maxX, Infinity, maxZ]) };
      context.contains = (x, y, z, margin = 0) => x >= minX - margin && x <= maxX + margin && z >= minZ - margin && z <= maxZ + margin;
      if (side >= 0) {
        context.source.slopeSide = side; context.source.sector = sector;
        context.contains = (x, y, z, margin = 0) => x >= wall.bounds[0] - margin && x <= wall.bounds[3] + margin && y >= wall.bounds[1] - margin && y <= wall.bounds[4] + margin && z >= wall.bounds[2] - margin && z <= wall.bounds[5] + margin;
      }
      if (frontage >= 0) {
        const front = H.fronts[frontage];
        context.kind = "front"; context.index = frontage; context.source = { x: front.center.x, z: front.center.z, front };
        context.contains = (x, y, z, margin = 0) => {
          const dx = x - front.center.x, dz = z - front.center.z;
          return y >= -margin && Math.abs(dx * front.tangent.x + dz * front.tangent.z) <= front.halfLength + margin
            && Math.abs(dx * -front.tangent.z + dz * front.tangent.x) <= front.halfWidth + margin;
        };
        // Each entrance has two long walls and an end wall. Their jagged
        // panels share perception and fading as a complete section.
        context.walls.length = 0;
        for (let section = 0; section < 3; section++) context.walls.push({ ...wall, key: section, bounds: new Float32Array(wall.bounds) });
      }
      outdoorMap.set(key, context); outdoorContexts.push(context);
      return context;
    };
    const appendOutdoor = (context, polygon, nx, ny, nz, wallIndex = 0) => {
      if (!faceHasArea(polygon)) return;
      let cx = 0, cy = 0, cz = 0;
      for (const p of polygon) { cx += p[0]; cy += p[1]; cz += p[2]; }
      cx /= polygon.length; cy /= polygon.length; cz /= polygon.length;
      const group = context.surfaceGroupSums.length / 4, wall = context.walls[wallIndex], bounds = wall.bounds;
      context.surfaceGroupSums.push(cx, cy, cz, 1); context.surfaceWallGroups.push(wallIndex);
      let column = group;
      if (Math.abs(ny) <= 0.1) {
        const key = Math.abs(nx) > Math.abs(nz) ? `x:${Math.sign(nx)}:${round(cx)}:${Math.floor(cz / OUTDOOR_PATCH)}` : `z:${Math.sign(nz)}:${Math.floor(cx / OUTDOOR_PATCH)}:${round(cz)}`;
        column = context.surfaceColumnMap.get(key);
        if (column === undefined) { column = context.surfaceColumnMap.size; context.surfaceColumnMap.set(key, column); }
      } else { column = context.surfaceColumnMap.size; context.surfaceColumnMap.set(`t:${group}`, column); }
      context.surfaceColumns.push(column);
      const direction = island.clearAt(cx + nx * 0.025, cy + ny * 0.025, cz + nz * 0.025, 0, 0) ? 0.025 : -0.025;
      context.surfaceSamples.push(cx + nx * direction, cy + ny * direction, cz + nz * direction);
      for (const point of polygon) for (let axis = 0; axis < 3; axis++) {
        bounds[axis] = Math.min(bounds[axis], point[axis]); bounds[axis + 3] = Math.max(bounds[axis + 3], point[axis]);
      }
      for (let fan = 1; fan + 1 < polygon.length; fan++) {
        if (!triangleHasArea(polygon[0], polygon[fan], polygon[fan + 1])) continue;
        for (const point of [polygon[0], polygon[fan], polygon[fan + 1]]) context.surfaceFaces.push(point[0], point[1], point[2]);
        context.surfaceGroups.push(group);
      }
    };
    const appendOutdoorFace = (points, nx, ny, nz) => {
      const emit = (polygon, frontage, section, side, sector) => splitFace(polygon, frontage ? island.unit : OUTDOOR_PATCH, (part) => {
        let x = 0, y = 0, z = 0;
        for (const p of part) { x += p[0]; y += p[1]; z += p[2]; }
        x /= part.length; y /= part.length; z /= part.length;
        if (ny > 0.9 && y < island.surfaceAt(x, z) - EPS) return;
        const context = frontage ? outdoorContextAt(0, 0, frontage - 1) : outdoorContextAt(Math.floor(x / OUTDOOR_CHUNK), Math.floor(z / OUTDOOR_CHUNK), -1, side, sector);
        appendOutdoor(context, part, nx, ny, nz, section);
      }, OUTDOOR_PATCH);
      if (ny > 0.9) {
        splitFace(points, island.unit, (part) => {
          let x = 0, y = 0, z = 0;
          for (const p of part) { x += p[0]; y += p[1]; z += p[2]; }
          x /= part.length; y /= part.length; z /= part.length;
          if (slopes.classify(x, y, z, nx, ny, nz, slopeSample)) emit(part, 0, 0, slopeSample.side, slopeSample.sector);
        });
        return;
      }
      // Greedy faces can cross a corridor corner or mix its wall with a
      // hillside. Ownership comes from the actual flattened air columns,
      // before sky clipping, not a padded box around the finished mesh.
      const axis = Math.abs(nx) > Math.abs(nz) ? 2 : 0, origin = island.sightGrid[axis === 0 ? 1 : 3];
      let min = Infinity, max = -Infinity, top = -Infinity, x = 0, z = 0;
      for (const p of points) { min = Math.min(min, p[axis]); max = Math.max(max, p[axis]); top = Math.max(top, p[1]); x += p[0]; z += p[2]; }
      x /= points.length; z /= points.length;
      let start = min, previous = NaN, frontage = 0, section = 0, side = -1, sector = -1;
      const flush = (end) => {
        if (end <= start + EPS || previous >= top - EPS) return;
        const part = clipFace(clipFace(clipFace(points, axis, start, 1), axis, end, -1), 1, previous, 1);
        if (part.length >= 3) emit(part, frontage, section, side, sector);
      };
      for (let cell = Math.floor((min - origin + EPS) / island.unit); cell < Math.ceil((max - origin - EPS) / island.unit); cell++) {
        const along = origin + (cell + 0.5) * island.unit, cx = axis === 0 ? along : x, cz = axis === 2 ? along : z;
        const air = island.frontageColumnAt(cx + nx * 0.025, cz + nz * 0.025), solid = island.frontageColumnAt(cx - nx * 0.025, cz - nz * 0.025);
        const owner = air && air !== solid ? air : 0;
        let wall = 0;
        if (owner) {
          const front = H.fronts[owner - 1], dx = cx - front.center.x, dz = cz - front.center.z;
          const across = dx * front.tangent.x + dz * front.tangent.z, depth = dx * -front.tangent.z + dz * front.tangent.x;
          wall = Math.abs(Math.abs(across) - front.halfLength) < Math.abs(Math.abs(depth) - front.halfWidth) ? 2 : depth < 0 ? 0 : 1;
        }
        let floor = owner ? 0 : Math.max(0, island.surfaceAt(cx + nx * 0.025, cz + nz * 0.025)), slope = -1, aspect = -1;
        if (!owner && top > floor) {
          if (slopes.classify(cx, (floor + top) / 2, cz, nx, ny, nz, slopeSample)) { slope = slopeSample.side; aspect = slopeSample.sector; }
          else floor = Infinity;
        }
        if (floor !== previous || frontage !== owner || section !== wall || side !== slope) {
          const edge = Math.max(min, origin + cell * island.unit); flush(edge);
          start = edge; previous = floor; frontage = owner; section = wall; side = slope; sector = aspect;
        }
      }
      flush(max);
    };
    const rampColumn = { floor: 0, ceiling: 0 };
    const rampSide = (context, x, y, z, nx, nz) => {
      const solid = island.rampColumnAt(x - nx * 0.025, z - nz * 0.025, context.basement, rampColumn);
      const air = island.rampColumnAt(x + nx * 0.025, z + nz * 0.025, context.basement, rampColumn);
      return air === context.index + 1 && solid !== air && y >= rampColumn.floor - EPS && y < rampColumn.ceiling + SURFACE_PATCH;
    };
    const rampWallFaces = (context, points, nx, ny, nz) => {
      let low = false;
      for (const p of points) if (p[1] < floorAt(context, p[0], p[2]) + island.unit) low = true;
      if (!low) return [points];
      // Vertical voxel panels need only split along their horizontal axis;
      // each resulting lower edge matches one actual floor grid edge.
      if (Math.abs(ny) > 0.5) return [];
      const axis = Math.abs(nx) > Math.abs(nz) ? 2 : 0, origin = island.sightGrid[axis === 0 ? 1 : 3], unit = island.unit;
      let min = Infinity, max = -Infinity, bottom = Infinity;
      for (const p of points) { min = Math.min(min, p[axis]); max = Math.max(max, p[axis]); bottom = Math.min(bottom, p[1]); }
      const faces = [];
      for (let cell = Math.floor((min - origin) / unit); cell < Math.ceil((max - origin) / unit); cell++) {
        const part = clipFace(clipFace(points, axis, origin + cell * unit, 1), axis, origin + (cell + 1) * unit, -1), output = [];
        // A cut voxel can start just above the physical slope. Join that
        // last fraction of a cell to the floor instead of leaving a notch.
        for (let n = 0; n < part.length; n++) {
          const p = part[n], floor = floorAt(context, p[0], p[2]);
          if (Math.abs(p[1] - bottom) < EPS && p[1] > floor && p[1] - floor < unit) part[n] = [p[0], floor, p[2]];
        }
        for (let n = 0; n < part.length; n++) {
          const a = part[n], b = part[(n + 1) % part.length], da = a[1] - floorAt(context, a[0], a[2]), db = b[1] - floorAt(context, b[0], b[2]);
          if (da >= 0) output.push(a);
          if ((da < 0) !== (db < 0)) { const t = da / (da - db); output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
        }
        if (output.length >= 3) faces.push(output);
      }
      return faces;
    };
    const append = (context, ax, ay, az, bx, by, bz, priority) => {
      let dx = bx - ax, dy = by - ay, dz = bz - az, length = Math.hypot(dx, dy, dz);
      if (length < EPS) return;
      dx /= length; dy /= length; dz /= length;
      if (Math.abs(dx) > EPS ? dx < 0 : Math.abs(dy) > EPS ? dy < 0 : dz < 0) { dx = -dx; dy = -dy; dz = -dz; }
      const key = `${round(dx)},${round(dy)},${round(dz)}:${round(ay * dz - az * dy)},${round(az * dx - ax * dz)},${round(ax * dy - ay * dx)}`;
      let group = context.groups.get(key);
      if (!group) { group = { ax, ay, az, dx, dy, dz, origin: ax * dx + ay * dy + az * dz, spans: [] }; context.groups.set(key, group); }
      const a = ax * dx + ay * dy + az * dz, b = bx * dx + by * dy + bz * dz;
      group.spans.push({ lo: Math.min(a, b), hi: Math.max(a, b), priority });
    };
    const relevant = (context, x, y, z, vertical, windowOwner) => {
      if (context.kind !== "ramp" && (y < context.floor - EPS || y > context.ceiling + EPS)) return 0;
      if (!context.contains(x, y, z, 0.38, false)) return 0;
      if (context.kind === "ramp") return vertical ? 1 : 4;
      if (Math.abs(y - context.floor) < island.unit * 0.6 || Math.abs(y - context.ceiling) < island.unit * 0.6) return 4;
      if (!vertical || context.kind !== "room") return 0;
      const room = context.source, dx = x - room.x, dz = z - room.z;
      const across = Math.abs(dx * -context.sz + dz * context.sx), along = dx * context.sx + dz * context.sz;
      const corner = Math.abs(across - room.width / 2) < 0.75 && Math.abs(Math.abs(along) - room.depth / 2) < 0.75;
      const doorway = Math.abs(along + room.depth / 2) < 0.5 && Math.abs(across - (room.corridorWidth ?? room.width - 1.3) / 2) < 0.5;
      return corner || doorway ? 5 : 0;
    };
    const surfaceRelevant = (context, x, y, z, ny) => {
      const inset = island.unit * 0.65, source = context.source;
      if (ny < -0.5) return false;
      if (context.kind === "ramp") return Math.abs(ny) <= 0.2;
      // A window extends navigation through the shell, but must not extend
      // the wall mask. Its original voxel faces are not tagged as reveals;
      // accepting the aperture here turns them into floating sill fragments.
      if (!context.contains(x, y, z, island.unit * 0.65, false)) return false;
      // Include the little ledges connecting jagged wall faces, while keeping
      // the open floor and ceiling out of the wall silhouette.
      if (y <= context.floor + EPS || y >= context.ceiling - EPS) return false;
      if (Math.abs(ny) <= 0.82) return true;
      if (context.kind === "common") return Math.hypot(x - source.x, z - source.z) >= source.radius - inset;
      const dx = x - source.x, dz = z - source.z, across = Math.abs(dx * -context.sz + dz * context.sx), along = dx * context.sx + dz * context.sz;
      return along < -source.depth / 2 ? across >= (source.corridorWidth ?? source.width - 1.3) / 2 - inset
        : across >= source.width / 2 - inset || Math.abs(along) >= source.depth / 2 - inset;
    };
    const wallAt = (context, x, z) => {
      const source = context.source;
      let key;
      if (context.kind === "ramp") { rampAt(source, x, z, probe); key = probe.side < 0 ? 0 : 1; }
      else if (context.kind === "common") key = Math.floor((Math.atan2(z - source.z, x - source.x) + Math.PI) * 4 / Math.PI) % 8;
      else {
        const dx = x - source.x, dz = z - source.z, across = dx * -context.sz + dz * context.sx, along = dx * context.sx + dz * context.sz;
        key = along < -source.depth / 2 - island.unit ? across < 0 ? 4 : 5
          : Math.abs(across) / source.width > Math.abs(along) / source.depth ? across < 0 ? 0 : 1 : along < 0 ? 2 : 3;
      }
      let index = context.wallMap.get(key);
      if (index === undefined) {
        index = context.walls.length; context.wallMap.set(key, index);
        context.walls.push({ key, bounds: new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]), distance: Infinity, target: 0, phase: 0, perceived: false, visibleMin: Infinity, visibleMax: -Infinity, surfaceTree: null, surfaceOrder: null });
      }
      return index;
    };
    const appendInteriorSurface = (context, polygon, nx, ny, nz) => {
      let tx = 0, ty = 0, tz = 0;
      for (const point of polygon) { tx += point[0]; ty += point[1]; tz += point[2]; }
      tx /= polygon.length; ty /= polygon.length; tz /= polygon.length;
      if (ny < -0.5) return false;
      const direction = island.clearAt(tx + nx * 0.025, ty + ny * 0.025, tz + nz * 0.025, 0, 0) ? 0.025 : -0.025;
      if (!surfaceRelevant(context, tx, ty, tz, ny * Math.sign(direction))) return false;
      if (context.kind === "ramp" && !rampSide(context, tx, ty, tz, nx * Math.sign(direction), nz * Math.sign(direction))) return false;
      if (context.kind === "ramp") {
        polygon = clipFace(polygon, 1, rampColumn.ceiling, -1);
        const air = island.frontageColumnAt(tx + nx * direction, tz + nz * direction), solid = island.frontageColumnAt(tx - nx * direction, tz - nz * direction);
        // The entrance facade owns this shared strip above ground. Let the
        // ramp continue it only below the corridor floor, with one fade each.
        if (air && air !== solid) polygon = clipFace(polygon, 1, 0, -1);
        if (polygon.length < 3) return false;
      }
      // Clipping at a floor/ceiling can collapse a triangle to a line. The
      // outline mask strokes its polygons, so such remnants must be omitted.
      if (!faceHasArea(polygon)) return false;
      const wall = wallAt(context, tx, tz), bounds = context.walls[wall].bounds;
      for (const point of polygon) for (let axis = 0; axis < 3; axis++) {
        const value = point[axis]; bounds[axis] = Math.min(bounds[axis], value); bounds[axis + 3] = Math.max(bounds[axis + 3], value);
      }
      for (let fan = 1; fan + 1 < polygon.length; fan++) {
        if (!triangleHasArea(polygon[0], polygon[fan], polygon[fan + 1])) continue;
        let cx = 0, cy = 0, cz = 0;
        for (const point of [polygon[0], polygon[fan], polygon[fan + 1]]) {
          context.surfaceFaces.push(point[0], point[1], point[2]);
          cx += point[0]; cy += point[1]; cz += point[2];
        }
        cx /= 3; cy /= 3; cz /= 3;
        // Opposite faces must keep separate exposed-air samples. A sample
        // retreated toward the actor can be buried on a self-hidden facet.
        const key = `${wall}:${Math.round(nx * 4)},${Math.round(ny * 4)},${Math.round(nz * 4)}:${Math.floor(cx / SURFACE_PATCH)},${Math.floor(cy / SURFACE_PATCH)},${Math.floor(cz / SURFACE_PATCH)}`;
        let group = context.surfaceGroupMap.get(key);
        if (group === undefined) {
          group = context.surfaceGroupSums.length / 4; context.surfaceGroupMap.set(key, group); context.surfaceGroupSums.push(0, 0, 0, 0);
          context.surfaceWallGroups.push(wall);
          const sampleDirection = island.clearAt(cx + nx * 0.025, cy + ny * 0.025, cz + nz * 0.025, 0, 0) ? 0.025 : -0.025;
          context.surfaceSamples.push(cx + nx * sampleDirection, cy + ny * sampleDirection, cz + nz * sampleDirection);
        }
        context.surfaceGroups.push(group);
        context.surfaceGroupSums[group * 4] += cx; context.surfaceGroupSums[group * 4 + 1] += cy; context.surfaceGroupSums[group * 4 + 2] += cz; context.surfaceGroupSums[group * 4 + 3]++;
      }
      return true;
    };
    const boundaryAt = (x, y, z) => {
      let air = false, rock = false;
      const step = island.unit * 0.1;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) {
        if (island.clearAt(x + dx * step, y + dy * step, z + dz * step, 0, 0)) air = true;
        else rock = true;
        if (air && rock) return true;
      }
      return false;
    };
    // No point of a box lies inside planes that its nearest corner already fails.
    const boxOutside = (planes, minX, minY, minZ, maxX, maxY, maxZ) => {
      for (const plane of planes) if (plane[0] * (plane[0] < 0 ? maxX : minX) + plane[1] * (plane[1] < 0 ? maxY : minY) + plane[2] * (plane[2] < 0 ? maxZ : minZ) > plane[3] + EPS * 8 + 1e-9) return true;
      return false;
    };
    const v = island.geometry.verts, candidates = new Uint8Array(contexts.length), faceContexts = new Uint8Array(contexts.length);
    let tested = 0, creases = 0, windowReveals = 0;
    for (const face of island.geometry.faces) {
      if (face.i.length < 3) continue;
      // Window reveal polygons are authored explicitly after the voxel shell
      // is carved. Exclude them by identity before spatial classification;
      // plane matching alone can miss clipped fragments at frustum joins.
      if (face.headquartersWindowReveal) { windowReveals++; continue; }
      const windowOwner = face.windowIndex === undefined ? null : windowOwners.get(face.windowIndex);
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, nearby = 0;
      for (const index of face.i) { const i = index * 3; minX = Math.min(minX, v[i]); minY = Math.min(minY, v[i + 1]); minZ = Math.min(minZ, v[i + 2]); maxX = Math.max(maxX, v[i]); maxY = Math.max(maxY, v[i + 1]); maxZ = Math.max(maxZ, v[i + 2]); }
      for (let j = 0; j < contexts.length; j++) {
        const b = contexts[j].searchBounds;
        if (windowOwner ? contexts[j] === windowOwner : minX <= b[3] && maxX >= b[0] && minY <= b[4] && maxY >= b[1] && minZ <= b[5] && maxZ >= b[2]) faceContexts[nearby++] = j;
      }
      if (!nearby) continue;
      const ia = face.i[0] * 3, ib = face.i[1] * 3, ic = face.i[2] * 3;
      const ux = v[ib] - v[ia], uy = v[ib + 1] - v[ia + 1], uz = v[ib + 2] - v[ia + 2], vx = v[ic] - v[ia], vy = v[ic + 1] - v[ia + 1], vz = v[ic + 2] - v[ia + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const normalLength = Math.hypot(nx, ny, nz);
      if (normalLength < EPS) continue;
      nx /= normalLength; ny /= normalLength; nz /= normalLength;
      let cx = 0, cy = 0, cz = 0;
      for (const index of face.i) { const i = index * 3; cx += v[i]; cy += v[i + 1]; cz += v[i + 2]; }
      cx /= face.i.length; cy /= face.i.length; cz /= face.i.length;
      let windowCap = false;
      for (const window of H.windows) {
        // The four reveal planes identify side panels, sills and soffits even
        // on steep flares that a normal-angle cutoff would misclassify.
        for (const frustum of window.flare.frusta) {
          if (boxOutside(frustum.planes, minX, minY, minZ, maxX, maxY, maxZ)) continue;
          let inside = true;
          for (const plane of frustum.planes) if (plane[0] * cx + plane[1] * cy + plane[2] * cz > plane[3] + EPS * 8) { inside = false; break; }
          // A quad can straddle the opening even when its center lies outside;
          // one triangulated half still belongs to the sill at that boundary.
          if (!inside) for (const index of face.i) {
            const at = index * 3;
            inside = true;
            for (const plane of frustum.planes) if (plane[0] * v[at] + plane[1] * v[at + 1] + plane[2] * v[at + 2] > plane[3] + EPS * 8) { inside = false; break; }
            if (inside) break;
          }
          if (!inside) continue;
          for (let side = 2; side <= 5; side++) {
            const plane = frustum.planes[side];
            let onPlane = true;
            for (const index of face.i) {
              const at = index * 3;
              if (Math.abs(plane[0] * v[at] + plane[1] * v[at + 1] + plane[2] * v[at + 2] - plane[3]) > EPS * 8) { onPlane = false; break; }
            }
            if (onPlane) windowCap = true;
          }
        }
        if (windowCap) break;
      }
      for (let j = 0; j < nearby; j++) {
        const context = contexts[faceContexts[j]];
        if (windowCap || face.headquartersRamp || face.headquartersBasementRamp) continue;
        const points = face.i.map((i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]]);
        const polygons = context.kind === "ramp" ? rampWallFaces(context, points, nx, ny, nz) : [points];
        if (!polygons.length) continue;
        for (const polygon of polygons) {
          if (context.kind === "ramp") splitFace(polygon, island.unit, (part) => {
            for (let n = 0; n < part.length; n++) {
              const p = part[n], floor = floorAt(context, p[0], p[2]), gap = p[1] - floor;
              if (gap >= -EPS && gap < island.unit * 0.2) part[n] = [p[0], floor, p[2]];
            }
            appendInteriorSurface(context, part, nx, ny, nz);
          }, SURFACE_PATCH);
          else appendInteriorSurface(context, polygon, nx, ny, nz);
        }
      }
      for (let edge = 0; edge < face.i.length; edge++) {
        const a = face.i[edge] * 3, b = face.i[(edge + 1) % face.i.length] * 3;
        const dx = v[b] - v[a], dy = v[b + 1] - v[a + 1], dz = v[b + 2] - v[a + 2], length = Math.hypot(dx, dy, dz);
        if (length < EPS || Math.min(v[a + 1], v[b + 1]) > 4.3 || Math.max(v[a + 1], v[b + 1]) < H.basement.floor - island.unit) continue;
        const vertical = Math.hypot(dx, dz) < EPS, count = Math.max(1, Math.ceil(length / island.unit));
        const ix = (ny * dz - nz * dy) / length, iy = (nz * dx - nx * dz) / length, iz = (nx * dy - ny * dx) / length;
        for (let i = 0; i < count; i++) {
          const t = (i + 0.5) / count, x = v[a] + dx * t, y = v[a + 1] + dy * t, z = v[a + 2] + dz * t;
          let owners = 0;
          for (let j = 0; j < nearby; j++) { const priority = relevant(contexts[faceContexts[j]], x, y, z, vertical, windowOwner); candidates[j] = priority; owners += priority; }
          if (!owners) continue;
          // Across a tessellation edge the same plane still separates air and
          // rock. A true floor/wall/window corner changes that physical pair.
          const ox = x - ix * 0.02, oy = y - iy * 0.02, oz = z - iz * 0.02;
          tested++;
          const front = island.clearAt(ox + nx * 0.012, oy + ny * 0.012, oz + nz * 0.012, 0, 0);
          const back = island.clearAt(ox - nx * 0.012, oy - ny * 0.012, oz - nz * 0.012, 0, 0);
          if (front && !back) continue;
          // Union carving can leave a buried source face. Its edge is not a
          // room boundary unless the face side still has exposed air above
          // solid stone. Concave corners may be solid on the other side.
          const fx = x + ix * 0.02, fy = y + iy * 0.02, fz = z + iz * 0.02;
          if (!island.clearAt(fx + nx * 0.012, fy + ny * 0.012, fz + nz * 0.012, 0, 0) || island.clearAt(fx - nx * 0.012, fy - ny * 0.012, fz - nz * 0.012, 0, 0)) continue;
          if (!boundaryAt(Math.fround(x), Math.fround(y), Math.fround(z))) continue;
          creases++;
          const lo = i / count, hi = (i + 1) / count;
          for (let j = 0; j < nearby; j++) if (candidates[j]) {
            const context = contexts[faceContexts[j]], ax = v[a] + dx * lo, ay = v[a + 1] + dy * lo, az = v[a + 2] + dz * lo, bx = v[a] + dx * hi, by = v[a + 1] + dy * hi, bz = v[a + 2] + dz * hi;
            if (context.contains(ax, ay, az) && context.contains(bx, by, bz)) append(context, ax, ay, az, bx, by, bz, candidates[j]);
          }
        }
      }
    }
    // Keep each connected hillside aspect together, including its short
    // stair treads. Opposing aspects stop at the crest and qualify separately.
    for (const face of island.geometry.faces) {
      if (face.i.length < 3 || face.headquartersWindowReveal || face.windowIndex !== undefined) continue;
      const ia = face.i[0] * 3, ib = face.i[1] * 3, ic = face.i[2] * 3;
      const ux = v[ib] - v[ia], uy = v[ib + 1] - v[ia + 1], uz = v[ib + 2] - v[ia + 2], vx = v[ic] - v[ia], vy = v[ic + 1] - v[ia + 1], vz = v[ic + 2] - v[ia + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length < EPS) continue;
      nx /= length; ny /= length; nz /= length;
      const points = face.i.map((i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]]);
      let cx = 0, cy = 0, cz = 0, minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const p of points) {
        cx += p[0]; cy += p[1]; cz += p[2];
        minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); minZ = Math.min(minZ, p[2]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); maxZ = Math.max(maxZ, p[2]);
      }
      cx /= points.length; cy /= points.length; cz /= points.length;
      const front = island.clearAt(cx + nx * 0.025, cy + ny * 0.025, cz + nz * 0.025, 0, 0), back = island.clearAt(cx - nx * 0.025, cy - ny * 0.025, cz - nz * 0.025, 0, 0);
      if (front === back) continue;
      const outwardY = front ? ny : -ny, riser = Math.abs(outwardY) <= 0.1, tread = outwardY > 0.9 && cy > EPS;
      if (!riser && !tread || riser && maxY < -EPS) continue;
      let reveal = false;
      for (const window of H.windows) {
        for (const frustum of window.flare.frusta) {
          if (boxOutside(frustum.planes, minX, minY, minZ, maxX, maxY, maxZ)) continue;
          for (const p of points) {
            let inside = true;
            for (const plane of frustum.planes) if (plane[0] * p[0] + plane[1] * p[1] + plane[2] * p[2] > plane[3] + EPS * 8) { inside = false; break; }
            if (inside) for (let side = 2; side <= 5; side++) {
              const plane = frustum.planes[side];
              if (points.every((point) => Math.abs(plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2] - plane[3]) <= EPS * 8)) { reveal = true; break; }
            }
            if (reveal) break;
          }
          if (reveal) break;
        }
        if (reveal) break;
      }
      if (!reveal) appendOutdoorFace(points, front ? nx : -nx, outwardY, front ? nz : -nz);
    }
    contexts.push(...outdoorContexts);
    floorVertices.clear(); floorGrids.clear();
    const finish = (context) => {
      const merged = [];
      for (const group of context.groups.values()) {
        group.spans.sort((a, b) => a.lo - b.lo);
        let lo = Infinity, hi = -Infinity, priority = 0;
        const emit = () => { if (hi - lo > EPS) merged.push({ group, lo, hi, priority }); };
        for (const span of group.spans) {
          if (span.lo > hi + EPS * 4) { emit(); lo = span.lo; hi = span.hi; priority = span.priority; }
          else { hi = Math.max(hi, span.hi); priority = Math.max(priority, span.priority); }
        }
        emit();
      }
      merged.sort((a, b) => b.priority - a.priority || b.hi - b.lo - (a.hi - a.lo));
      // Reserve most of the budget for the room itself: the many clipped
      // polygons around a flared mouth must not crowd out its floor and roof.
      let windows = 0, accepted = 0;
      for (const line of merged) {
        if (line.priority === 6 && windows++ >= 32) continue;
        merged[accepted++] = line;
        if (accepted === LIMIT) break;
      }
      context.count = accepted;
      context.lines = new Float32Array(context.count * 6);
      context.surface = new Float32Array(context.surfaceFaces);
      context.surfaceCount = context.surface.length / 9;
      context.surfaceGroups = new Uint16Array(context.surfaceGroups);
      context.surfaceWallGroups = new Uint8Array(context.surfaceWallGroups);
      context.surfaceColumns = new Uint16Array(context.surfaceColumns);
      context.surfaceColumnTargets = new Float32Array(context.surfaceColumnMap.size);
      context.surfaceSamples = new Float32Array(context.surfaceSamples);
      context.surfaceGroupCount = context.surfaceGroupSums.length / 4;
      context.surfaceCenters = new Float32Array(context.surfaceGroupCount * 3);
      context.surfaceStations = new Float32Array(context.surfaceGroupCount);
      for (let group = 0; group < context.surfaceGroupCount; group++) {
        const source = group * 4, target = group * 3, count = context.surfaceGroupSums[source + 3];
        context.surfaceCenters[target] = context.surfaceGroupSums[source] / count; context.surfaceCenters[target + 1] = context.surfaceGroupSums[source + 1] / count; context.surfaceCenters[target + 2] = context.surfaceGroupSums[source + 2] / count;
        const x = context.surfaceCenters[target], z = context.surfaceCenters[target + 2], owner = context.source, wall = context.walls[context.surfaceWallGroups[group]];
        if (context.kind === "ramp") { rampAt(owner, x, z, probe); context.surfaceStations[group] = probe.station; }
        else if (context.kind === "common") context.surfaceStations[group] = ((Math.atan2(z - owner.z, x - owner.x) + Math.PI) % (Math.PI * 2)) * owner.radius;
        else if (context.kind === "surface" || context.kind === "front" || context.kind === "cave" || context.kind === "sealed") context.surfaceStations[group] = 0;
        else context.surfaceStations[group] = wall.key === 2 || wall.key === 3 ? (x - owner.x) * -context.sz + (z - owner.z) * context.sx : (x - owner.x) * context.sx + (z - owner.z) * context.sz;
      }
      // Per-visit fields keep their places; arm() fills them for each visit.
      context.surfacePhases = null; context.surfaceWholePhases = null; context.surfacePerceived = null; context.surfaceSections = null; context.surfaceTerrainSeen = null; context.surfaceTargets = null;
      context.surfaceEye = null; context.surfacePosition = null; context.surfaceActor = null; context.surfaceOcclusion = -1; context.surfaceCamera = null; context.surfaceView = null; context.surfaceHidden = null; context.surfaceAperture = null;
      context.surfaceGroupBounds = new Float32Array(context.surfaceGroupCount * 6);
      for (let group = 0; group < context.surfaceGroupCount; group++) context.surfaceGroupBounds.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], group * 6);
      for (let at = 0; at < context.surface.length; at += 9) {
        const group = context.surfaceGroups[at / 9] * 6, bounds = context.surfaceGroupBounds;
        for (let n = 0; n < 9; n += 3) for (let axis = 0; axis < 3; axis++) {
          const value = context.surface[at + n + axis]; bounds[group + axis] = Math.min(bounds[group + axis], value); bounds[group + axis + 3] = Math.max(bounds[group + axis + 3], value);
        }
      }
      context.apertures = null;
      context.surfaceActive = context.surfaceWholeActive = context.surfaceVersion = 0;
      // A long curved wall rarely fits behind one solid cross-section. Split
      // its fixed air samples spatially so smaller branches can share a proof.
      for (let wallIndex = 0; wallIndex < context.walls.length; wallIndex++) {
        const wall = context.walls[wallIndex], order = [], samples = context.surfaceSamples;
        for (let group = 0; group < context.surfaceGroupCount; group++) if (context.surfaceWallGroups[group] === wallIndex) order.push(group);
        const scratch = BL.math.sortScratch(order.length);
        const buildTree = (start, end) => {
          const bounds = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
          for (let n = start; n < end; n++) for (let axis = 0; axis < 3; axis++) {
            const value = samples[order[n] * 3 + axis]; bounds[axis] = Math.min(bounds[axis], value); bounds[axis + 3] = Math.max(bounds[axis + 3], value);
          }
          const node = { bounds, start, end, left: null, right: null };
          if (end - start > 16) {
            let axis = 0;
            for (let n = 1; n < 3; n++) if (bounds[n + 3] - bounds[n] > bounds[axis + 3] - bounds[axis]) axis = n;
            BL.math.sortByKey(order, start, end, samples, 3, axis, scratch);
            const middle = (start + end) >>> 1;
            node.left = buildTree(start, middle); node.right = buildTree(middle, end);
          }
          return node;
        };
        wall.surfaceTree = buildTree(0, order.length);
        wall.surfaceOrder = new Uint16Array(order);
        if (context.kind === "room" || context.kind === "ramp" || context.kind === "common") {
          const stations = context.surfaceStations;
          STATION_ORDERS.set(wall.surfaceOrder, new Uint16Array(order).sort((a, b) => stations[a] - stations[b] || a - b));
        }
      }
      context.surfaceFaces = context.surfaceGroupSums = null;
      context.surfaceGroupMap.clear(); context.surfaceGroupMap = null;
      context.surfaceColumnMap.clear(); context.surfaceColumnMap = null;
      context.wallMap.clear(); context.wallMap = null;
      for (let i = 0; i < context.count; i++) {
        const line = merged[i], g = line.group;
        for (let end = 0; end < 2; end++) {
          const distance = (end ? line.hi : line.lo) - g.origin, at = i * 6 + end * 3;
          context.lines[at] = g.ax + g.dx * distance; context.lines[at + 1] = g.ay + g.dy * distance; context.lines[at + 2] = g.az + g.dz * distance;
          for (let axis = 0; axis < 3; axis++) { context.bounds[axis] = Math.min(context.bounds[axis], context.lines[at + axis]); context.bounds[axis + 3] = Math.max(context.bounds[axis + 3], context.lines[at + axis]); }
        }
      }
      context.groups = null;
      for (const wall of context.walls) for (let axis = 0; axis < 3; axis++) {
        context.bounds[axis] = Math.min(context.bounds[axis], wall.bounds[axis]);
        context.bounds[axis + 3] = Math.max(context.bounds[axis + 3], wall.bounds[axis + 3]);
      }
      return context.count;
    };
    let total = 0;
    for (const context of contexts) total += finish(context);
    outdoorMap.clear(); windowOwners.clear();
    return { contexts, total, tested, creases, windowReveals, surfaceContexts: outdoorContexts.filter((context) => context.kind === "surface").length, frontageContexts: outdoorContexts.filter((context) => context.kind === "front").length, rampAt, probe, splitFace, appendOutdoor, finish };
  };
  const arm = (context, island) => {
    const count = context.surfaceGroupCount;
    context.surfaceColumnTargets = new Float32Array(context.surfaceColumnTargets.length);
    context.surfacePhases = new Float32Array(count);
    context.surfaceWholePhases = new Float32Array(count);
    context.surfacePerceived = new Float32Array(count);
    context.surfaceSections = new Float32Array(count);
    context.surfaceTerrainSeen = new Uint8Array(count);
    context.surfaceTargets = new Float32Array(count);
    context.surfaceEye = new Float64Array([NaN, NaN, NaN]);
    context.surfacePosition = new Float64Array([NaN, NaN, NaN]);
    context.surfaceActor = null; context.surfaceOcclusion = -1;
    context.surfaceCamera = new Float64Array([NaN, NaN, NaN]);
    context.surfaceView = new Float64Array([NaN, NaN, NaN, NaN]);
    context.surfaceHidden = new Uint8Array(count);
    context.surfaceAperture = new Uint8Array(count);
    context.apertures = context.windows.length ? BL.wallApertures.create({ windows: context.windows, island }) : null;
    return context;
  };
  const create = ({ island, sealed = [] }) => {
    let built = BUILDS.get(island);
    if (!built) BUILDS.set(island, built = build(island));
    const { rampAt, probe, splitFace, appendOutdoor, finish } = built;
    const contexts = built.contexts.map((template) => arm({ ...template, walls: template.walls.map((wall) => ({ ...wall })) }, island));
    let total = built.total;
    const caves = BL.caveGuides.create({ island, sealed });
    for (const descriptor of caves.contexts) {
      const context = { kind: descriptor.kind, index: descriptor.index, basement: false, source: descriptor.source, floor: descriptor.floor, ceiling: descriptor.ceiling, height: descriptor.ceiling - descriptor.floor,
        windows: [], groups: new Map(), surfaceFaces: [], surfaceGroupMap: new Map(), surfaceGroups: [], surfaceGroupSums: [], surfaceColumns: [], surfaceColumnMap: new Map(), surfaceWallGroups: [], surfaceSamples: [], walls: [], wallMap: new Map(),
        lines: null, count: 0, bounds: new Float32Array(descriptor.bounds), searchBounds: new Float64Array(descriptor.bounds), contains: descriptor.contains };
      for (const face of descriptor.faces) {
        let wallIndex = context.wallMap.get(face.wall);
        if (wallIndex === undefined) {
          wallIndex = context.walls.length; context.wallMap.set(face.wall, wallIndex);
          context.walls.push({ key: face.wall, bounds: new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]), distance: Infinity, target: 0, phase: 0, perceived: false, visibleMin: Infinity, visibleMax: -Infinity, surfaceTree: null, surfaceOrder: null });
        }
        splitFace(face.points, SURFACE_PATCH, (polygon) => appendOutdoor(context, polygon, face.nx, face.ny, face.nz, wallIndex));
      }
      descriptor.faces.length = 0;
      contexts.push(context);
      total += finish(context);
      arm(context, island);
    }
    contexts.push(BL.holeGuides.create({ island }));
    for (const context of contexts) {
      context.surfacePerception = -1;
      for (const wall of context.walls) wall.cameraReady = false;
    }
    // The observer can see through a doorway into a second space. Keep one
    // deduplicated world set for sight filtering, independent of the orbit eye.
    const unique = new Map();
    for (const context of contexts) for (let i = 0; i < context.lines.length; i += 6) {
      const v = context.lines, a = `${round(v[i])},${round(v[i + 1])},${round(v[i + 2])}`, b = `${round(v[i + 3])},${round(v[i + 4])},${round(v[i + 5])}`;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!unique.has(key)) unique.set(key, { context, i });
    }
    const all = { lines: new Float32Array(unique.size * 6), count: unique.size, kind: "structure", index: -1, basement: false };
    let offset = 0;
    for (const entry of unique.values()) for (let n = 0; n < 6; n++) all.lines[offset++] = entry.context.lines[entry.i + n];
    unique.clear();
    const stats = { contexts: contexts.length, surfaceContexts: built.surfaceContexts, frontageContexts: built.frontageContexts, caveContexts: caves.contexts.length, lines: total, uniqueLines: all.count, surfaces: contexts.reduce((sum, context) => sum + context.surfaceCount, 0), surfacePatches: contexts.reduce((sum, context) => sum + context.surfaceGroupCount, 0), windowReveals: built.windowReveals, limit: LIMIT, tested: built.tested, creases: built.creases, surfaceRays: 0, surfaceCertificates: 0 };
    const updateSurfaceBranch = (context, wall, node, p, fx, fy, fz, near, objectClear, actor) => {
      const b = node.bounds;
      let hidden = ((fx < 0 ? b[0] : b[3]) - p.x) * fx + ((fy < 0 ? b[1] : b[4]) - p.y) * fy + ((fz < 0 ? b[2] : b[5]) - p.z) * fz <= near;
      // Every sample ray passes through this eye-to-bounds cross-section.
      // An aperture defeats the proof and descends to smaller branches/rays.
      for (let n = 1; n <= 7 && !hidden && (context.kind !== "surface" || node.left); n++) {
        const t = n / 8, ax = p.x + (b[0] - 0.03 - p.x) * t, ay = p.y + (b[1] - 0.03 - p.y) * t, az = p.z + (b[2] - 0.03 - p.z) * t;
        const bx = p.x + (b[3] + 0.03 - p.x) * t, by = p.y + (b[4] + 0.03 - p.y) * t, bz = p.z + (b[5] + 0.03 - p.z) * t;
        const depth = ((fx < 0 ? bx : ax) - p.x) * fx + ((fy < 0 ? by : ay) - p.y) * fy + ((fz < 0 ? bz : az) - p.z) * fz;
        if (depth > near && island.sightBoxSolidAt(ax, ay, az, bx, by, bz)) { hidden = true; stats.surfaceCertificates++; }
      }
      const order = wall.surfaceOrder;
      if (hidden) {
        for (let n = node.start; n < node.end; n++) context.surfaceHidden[order[n]] = 1;
      } else if (node.left) {
        updateSurfaceBranch(context, wall, node.left, p, fx, fy, fz, near, objectClear, actor);
        updateSurfaceBranch(context, wall, node.right, p, fx, fy, fz, near, objectClear, actor);
      } else {
        const samples = context.surfaceSamples;
        for (let n = node.start; n < node.end; n++) {
          const group = order[n], at = group * 3, x = samples[at], y = samples[at + 1], z = samples[at + 2], dx = x - p.x, dy = y - p.y, dz = z - p.z;
          const depth = dx * fx + dy * fy + dz * fz, start = near / depth;
          context.surfaceHidden[group] = depth <= near ? 1 : !island.sightClearAt(p.x + dx * start, p.y + dy * start, p.z + dz * start, x, y, z);
          if (!context.surfaceHidden[group] && objectClear && (context.kind === "cave" || context.kind === "sealed")) context.surfaceHidden[group] = !objectClear(p.x + dx * start, p.y + dy * start, p.z + dz * start, x, y, z, actor, null, true);
          stats.surfaceRays += depth > near ? 1 : 0;
        }
      }
    };
    const select = (px, feet, pz, ex, ey, ez) => {
      let selected = null, best = Infinity;
      for (const context of contexts) {
        let score = Infinity;
        if (context.kind === "ramp") {
          rampAt(context.source, px, pz, probe);
          if (feet >= probe.floor - 0.3 && feet <= Math.ceil((probe.floor + context.height) / island.unit) * island.unit + 0.3 && probe.distance <= (context.source.width / 2 + 0.3) ** 2) score = probe.distance + 0.5;
        } else if (context.contains(px, feet, pz, 0.3)) {
          score = context.kind === "common" ? 0.25 : 0;
        }
        if (score < best && context.count) { best = score; selected = context; }
      }
      if (selected) return selected;
      // A nearby exterior eye may still look through its actor's window, but
      // a distant sky view never selects an unrelated underground wireframe.
      for (const context of contexts) if (context.count && context.kind === "room" && ey >= context.floor - 0.5 && ey <= context.ceiling + 0.5) {
        const room = context.source, d = (ex - room.x) ** 2 + (ez - room.z) ** 2;
        if (d < 64 && d < best) { selected = context; best = d; }
      }
      return selected;
    };
    let surfacesActive = false;
    const perceives = (context, group, ex, ey, ez, actor, objectClear) => {
      const at = group * 3, samples = context.surfaceSamples, x = samples[at], y = samples[at + 1], z = samples[at + 2];
      if (context.surfaceTerrainSeen[group] === 2) context.surfaceTerrainSeen[group] = island.sightClearAt(ex, ey, ez, x, y, z) ? 1 : 0;
      return context.surfaceTerrainSeen[group] && (!objectClear || objectClear(ex, ey, ez, x, y, z, actor, null));
    };
    // Every eye ray to a sample inside a branch crosses this scaled, padded
    // cross-section; solid rock there proves the whole branch unseen.
    const perceiveBranch = (context, wall, node, ex, ey, ez) => {
      const b = node.bounds;
      for (let n = 1; n <= 7; n++) {
        const t = n / 8, ax = ex + (b[0] - 0.03 - ex) * t, ay = ey + (b[1] - 0.03 - ey) * t, az = ez + (b[2] - 0.03 - ez) * t;
        const bx = ex + (b[3] + 0.03 - ex) * t, by = ey + (b[4] + 0.03 - ey) * t, bz = ez + (b[5] + 0.03 - ez) * t;
        if (!island.sightBoxSolidAt(ax, ay, az, bx, by, bz)) continue;
        const order = wall.surfaceOrder;
        for (let i = node.start; i < node.end; i++) context.surfaceTerrainSeen[order[i]] = 0;
        return;
      }
      if (node.left) {
        perceiveBranch(context, wall, node.left, ex, ey, ez);
        perceiveBranch(context, wall, node.right, ex, ey, ez);
      }
    };
    const updateSurface = (context, ex, ey, ez, camera, dt, actor = null, objectClear = null, occlusion = 0, perception = occlusion) => {
      if (!context) return null;
      surfacesActive = true;
      const center = actor ? actor.root.position : null, px = center ? center.x : ex, py = center ? center.y : ey, pz = center ? center.z : ez;
      const eye = context.surfaceEye, position = context.surfacePosition, eyeMoved = context.surfaceActor !== actor || !Number.isFinite(eye[0])
        || Math.hypot(ex - eye[0], ey - eye[1], ez - eye[2]) > 0.025 || Math.hypot(px - position[0], py - position[1], pz - position[2]) > 0.025;
      const occlusionChanged = context.surfaceOcclusion !== occlusion, moved = eyeMoved || context.surfacePerception !== perception;
      context.surfaceOcclusion = occlusion;
      const walls = context.walls, centers = context.surfaceCenters, wallGroups = context.surfaceWallGroups, outdoor = context.kind === "surface" && context.source.slopeSide === undefined;
      const wholeSection = !outdoor && (context.kind === "surface" || context.kind === "front" || context.kind === "cave" || context.kind === "sealed" || context.kind === "hole");
      if (moved) {
        context.surfaceActor = actor; context.surfacePerception = perception;
        // Whole sections need one reachable witness. Mark untested samples
        // separately so a later prop movement can safely search past it.
        if (eyeMoved) {
          eye[0] = ex; eye[1] = ey; eye[2] = ez;
          position[0] = px; position[1] = py; position[2] = pz;
          context.surfaceTerrainSeen.fill(2);
        }
        if (outdoor) context.surfacePerceived.fill(0);
        for (const wall of walls) { wall.distance = Infinity; wall.target = 0; wall.perceived = false; wall.visibleMin = Infinity; wall.visibleMax = -Infinity; }
        for (let group = 0; group < context.surfaceGroupCount; group++) {
          const at = group * 3, wall = walls[wallGroups[group]], distance = Math.hypot(centers[at] - px, centers[at + 1] - py, centers[at + 2] - pz);
          wall.distance = Math.min(wall.distance, distance);
        }
        if (eyeMoved) for (const wall of walls) if (wall.distance <= RADIUS) perceiveBranch(context, wall, wall.surfaceTree, ex, ey, ez);
        // Stations only matter at a wall's first and last perceived sample.
        // Scan inward from both ends instead of tracing every sample.
        if (context.kind === "room" || context.kind === "ramp" || context.kind === "common") for (const wall of walls) {
          if (!(wall.distance <= RADIUS)) continue;
          const order = STATION_ORDERS.get(wall.surfaceOrder), stations = context.surfaceStations;
          let low = 0, high = order.length - 1, near = false;
          for (; low <= high; low++) if (perceives(context, order[low], ex, ey, ez, actor, objectClear)) break;
          if (low > high) continue;
          for (; high > low; high--) if (perceives(context, order[high], ex, ey, ez, actor, objectClear)) break;
          wall.visibleMin = stations[order[low]]; wall.visibleMax = stations[order[high]];
          for (let n = low; n <= high && !near; n++) {
            const group = order[n], at = group * 3;
            if (Math.hypot(centers[at] - px, centers[at + 1] - py, centers[at + 2] - pz) <= RADIUS && (n === low || n === high || perceives(context, group, ex, ey, ez, actor, objectClear))) near = true;
          }
          wall.perceived = near;
        }
        else for (let group = 0; group < context.surfaceGroupCount; group++) {
          const at = group * 3, wall = walls[wallGroups[group]];
          if (wholeSection && wall.perceived) continue;
          if (wall.distance <= RADIUS) {
            const samples = context.surfaceSamples, x = samples[at], y = samples[at + 1], z = samples[at + 2];
            if (context.surfaceTerrainSeen[group] === 2) context.surfaceTerrainSeen[group] = island.sightClearAt(ex, ey, ez, x, y, z) ? 1 : 0;
            if (context.surfaceTerrainSeen[group] && (!objectClear || objectClear(ex, ey, ez, x, y, z, actor, null))) {
              const distance = Math.hypot(centers[at] - px, centers[at + 1] - py, centers[at + 2] - pz);
              if (outdoor && distance <= RADIUS) {
                const target = Math.max(0, Math.min(1, (RADIUS - distance) / (RADIUS - FADE_START)));
                context.surfacePerceived[group] = target; wall.target = Math.max(wall.target, target); wall.perceived = true;
              } else if (!outdoor) {
                if (distance <= RADIUS) wall.perceived = true;
                wall.visibleMin = Math.min(wall.visibleMin, context.surfaceStations[group]);
                wall.visibleMax = Math.max(wall.visibleMax, context.surfaceStations[group]);
              }
            }
            else if (outdoor) context.surfacePerceived[group] = 0;
          }
          else if (outdoor) context.surfacePerceived[group] = 0;
        }
        if (outdoor) {
          const columns = context.surfaceColumns, columnTargets = context.surfaceColumnTargets;
          columnTargets.fill(0);
          for (let group = 0; group < context.surfaceGroupCount; group++) columnTargets[columns[group]] = Math.max(columnTargets[columns[group]], context.surfacePerceived[group]);
          for (let group = 0; group < context.surfaceGroupCount; group++) {
            const target = columnTargets[columns[group]];
            if (target > context.surfacePerceived[group]) context.surfacePerceived[group] = target;
          }
        }
        if (!outdoor) for (const wall of walls) wall.target = wall.perceived ? Math.max(0, Math.min(1, (RADIUS - wall.distance) / (RADIUS - FADE_START))) : 0;
      }
      const p = camera.position, target = camera.target, cameraEye = context.surfaceCamera, view = context.surfaceView;
      const length = Math.hypot(target.x - p.x, target.y - p.y, target.z - p.z), fx = (target.x - p.x) / length, fy = (target.y - p.y) / length, fz = (target.z - p.z) / length;
      // Passing bodies affect the camera's cave rays, but never the actor's
      // perception of a wall. Keep those invalidation epochs independent.
      const cameraMoved = (eyeMoved || occlusionChanged) && (context.kind === "cave" || context.kind === "sealed") || !Number.isFinite(cameraEye[0]) || Math.hypot(p.x - cameraEye[0], p.y - cameraEye[1], p.z - cameraEye[2]) > 0.025
        || context.windows?.length && (p.x !== cameraEye[0] || p.y !== cameraEye[1] || p.z !== cameraEye[2])
        || Math.abs(fx - view[0]) + Math.abs(fy - view[1]) + Math.abs(fz - view[2]) > 0.001 || view[3] !== camera.near;
      if (cameraMoved) {
        cameraEye[0] = p.x; cameraEye[1] = p.y; cameraEye[2] = p.z;
        view[0] = fx; view[1] = fy; view[2] = fz; view[3] = camera.near;
        context.surfaceHidden.fill(0);
        for (const wall of walls) wall.cameraReady = false;
      }
      // A fixed camera's terrain rays survive actor/NPC motion. Newly
      // perceived walls still need their first camera query immediately.
      for (const wall of walls) if ((wall.target || wall.phase) && !wall.cameraReady) {
        updateSurfaceBranch(context, wall, wall.surfaceTree, p, fx, fy, fz, camera.near, objectClear, actor);
        wall.cameraReady = true;
      }
      if (cameraMoved) {
        if (context.apertures) {
          context.apertures.update(camera, !context.contains(p.x, p.y, p.z, 0, false));
          if (!context.apertures.count) context.surfaceAperture.fill(0);
          else for (let group = 0; group < context.surfaceGroupCount; group++) {
            const portal = context.apertures.overlaps(context.surfaceGroupBounds, group * 6);
            context.surfaceAperture[group] = portal ? 2 : 0;
          }
          // Bounds can overlap a window while all of a patch's actual
          // triangles miss it. Those patches retain normal visibility.
          if (context.apertures.count) for (let at = 0; at < context.surface.length; at += 9) {
            const group = context.surfaceGroups[at / 9];
            if (context.surfaceAperture[group] !== 2) continue;
            for (let aperture = 0; aperture < context.apertures.count; aperture++) if (context.apertures.clip(aperture, context.surface, at).count) { context.surfaceAperture[group] = 1; break; }
          }
          for (let group = 0; group < context.surfaceGroupCount; group++) {
            if (context.surfaceAperture[group] === 2) context.surfaceAperture[group] = 0;
          }
        }
      }
      // Retain the full patch. The overlay cuts only the visible window
      // polygon, including when a new wall uses the cached camera aperture.
      if (context.apertures && context.apertures.count) for (let group = 0; group < context.surfaceGroupCount; group++) if (context.surfaceAperture[group]) context.surfaceHidden[group] = 1;
      const step = Math.max(0, dt) / FADE_SECONDS;
      for (const wall of walls) wall.phase = wall.phase < wall.target ? Math.min(wall.target, wall.phase + step) : Math.max(wall.target, wall.phase - step);
      context.surfaceActive = context.surfaceWholeActive = 0;
      let changed = false;
      for (let group = 0; group < context.surfaceGroupCount; group++) {
        const wall = walls[wallGroups[group]];
        if (outdoor) {
          const desired = context.surfacePerceived[group], eased = desired * desired * (3 - 2 * desired), beforeWhole = context.surfaceWholePhases[group];
          let whole = beforeWhole < eased ? Math.min(eased, beforeWhole + step) : Math.max(eased, beforeWhole - step);
          if (Math.abs(whole - eased) < 1e-9) whole = eased;
          if (Math.abs(beforeWhole - whole) > 1e-7) changed = true;
          context.surfaceWholePhases[group] = whole; context.surfaceSections[group] = 1;
          const target = context.surfaceHidden[group] ? eased : 0, before = context.surfacePhases[group];
          let phase = before < target ? Math.min(target, before + step) : Math.max(target, before - step);
          if (Math.abs(phase - target) < 1e-9) phase = target;
          context.surfaceTargets[group] = target; phase = Math.min(phase, whole);
          if (Math.abs(before - phase) > 1e-7) changed = true;
          context.surfacePhases[group] = phase;
          if (phase > 0) context.surfaceActive++;
          if (whole > 0) context.surfaceWholeActive++;
          continue;
        }
        const whole = wall.phase * wall.phase * (3 - 2 * wall.phase);
        context.surfacePerceived[group] = wall.target;
        if (Math.abs(context.surfaceWholePhases[group] - whole) > 1e-7) changed = true;
        context.surfaceWholePhases[group] = whole;
        // Join the first and last visible stations into one solid wall run.
        // Its jagged faces cannot punch independent holes, while the ends
        // taper over one patch and old coverage fades as the Ooga moves.
        const station = context.surfaceStations[group], edge = Math.min(station - wall.visibleMin, wall.visibleMax - station);
        const section = context.kind === "hole" || context.kind === "front" || context.kind === "surface" || context.kind === "cave" || context.kind === "sealed" ? 1 : Math.max(0, Math.min(1, (edge + SURFACE_PATCH / 2) / SURFACE_PATCH));
        const easedSection = section * section * (3 - 2 * section);
        if (Math.abs(context.surfaceSections[group] - easedSection) > 1e-7) changed = true;
        context.surfaceSections[group] = easedSection;
        const target = context.surfaceHidden[group] ? wall.target * context.surfaceSections[group] : 0, before = context.surfacePhases[group];
        let phase = before < target ? Math.min(target, before + step) : Math.max(target, before - step);
        if (Math.abs(phase - target) < 1e-9) phase = target;
        context.surfaceTargets[group] = target;
        phase = Math.min(phase, wall.phase);
        if (Math.abs(before - phase) > 1e-7) changed = true;
        context.surfacePhases[group] = phase;
        if (context.surfacePhases[group] > 0) context.surfaceActive++;
        if (whole > 0) context.surfaceWholeActive++;
      }
      if (changed) context.surfaceVersion++;
      return context;
    };
    const updateSurfaces = (ex, ey, ez, camera, dt, actor = null, objectClear = null, occlusion = 0, perception = occlusion) => {
      stats.surfaceRays = stats.surfaceCertificates = 0;
      const center = actor ? actor.root.position : null, px = center ? center.x : ex, py = center ? center.y : ey, pz = center ? center.z : ez;
      // Fixed authored registry; broad-phase rejection prevents the nearby
      // view from turning into a whole-island visibility pass.
      for (const context of contexts) {
        let nearby = context.surfaceWholeActive > 0;
        if (!nearby) for (const wall of context.walls) {
          const b = wall.bounds, dx = Math.max(b[0] - px, 0, px - b[3]), dy = Math.max(b[1] - py, 0, py - b[4]), dz = Math.max(b[2] - pz, 0, pz - b[5]);
          if (dx * dx + dy * dy + dz * dz < RADIUS * RADIUS) { nearby = true; break; }
        }
        if (nearby) updateSurface(context, ex, ey, ez, camera, dt, actor, objectClear, occlusion, perception);
      }
      return contexts;
    };
    const resetSurface = () => {
      if (!surfacesActive) return;
      surfacesActive = false;
      for (const context of contexts) {
        if (context.surfaceWholeActive || context.surfaceActive) context.surfaceVersion++;
        context.surfacePhases.fill(0); context.surfaceWholePhases.fill(0); context.surfaceTargets.fill(0); context.surfacePerceived.fill(0);
        context.surfaceActive = context.surfaceWholeActive = 0;
        context.surfaceEye.fill(NaN); context.surfaceCamera.fill(NaN);
        context.surfaceOcclusion = context.surfacePerception = -1;
        for (const wall of context.walls) wall.phase = wall.target = 0;
      }
    };
    const dispose = () => { contexts.length = 0; all.count = stats.contexts = stats.surfaceContexts = stats.frontageContexts = stats.caveContexts = stats.lines = stats.uniqueLines = stats.surfaces = stats.surfacePatches = stats.windowReveals = 0; };
    return { select, updateSurface, updateSurfaces, resetSurface, dispose, stats, contexts, all };
  };
  BL.rockGuides = { create };
})();
