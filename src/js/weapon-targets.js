// Precise weapon contacts share the interactive targets, without hover padding.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {}, { mat4 } = BL.math;
  const EPS = 1e-7, geometries = new WeakMap();
  const geometryOf = geometry => {
    let result = geometries.get(geometry);
    if (result) return result;
    const verts = geometry.verts, triangles = [], boxes = [], order = [], nodes = [];
    for (const face of geometry.faces) for (let i = 1; i + 1 < face.i.length; i++) {
      const a = face.i[0] * 3, b = face.i[i] * 3, c = face.i[i + 1] * 3;
      triangles.push(a, b, c); order.push(order.length);
      boxes.push(Math.min(verts[a], verts[b], verts[c]), Math.min(verts[a + 1], verts[b + 1], verts[c + 1]), Math.min(verts[a + 2], verts[b + 2], verts[c + 2]),
        Math.max(verts[a], verts[b], verts[c]), Math.max(verts[a + 1], verts[b + 1], verts[c + 1]), Math.max(verts[a + 2], verts[b + 2], verts[c + 2]));
    }
    const keys = new Float64Array(order.length * 3), scratch = BL.math.sortScratch(order.length);
    for (let i = 0; i < order.length; i++) for (let axis = 0; axis < 3; axis++) keys[i * 3 + axis] = boxes[i * 6 + axis] + boxes[i * 6 + axis + 3];
    const build = (from, to) => {
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = from; i < to; i++) for (let axis = 0; axis < 3; axis++) {
        box[axis] = Math.min(box[axis], boxes[order[i] * 6 + axis]);
        box[axis + 3] = Math.max(box[axis + 3], boxes[order[i] * 6 + axis + 3]);
      }
      const index = nodes.length, node = { box, from, to, left: -1, right: -1 };
      nodes.push(node);
      if (to - from > 8) {
        let axis = 0;
        if (box[4] - box[1] > box[3] - box[0]) axis = 1;
        if (box[5] - box[2] > box[axis + 3] - box[axis]) axis = 2;
        BL.math.sortByKey(order, from, to, keys, 3, axis, scratch);
        const middle = (from + to) >>> 1;
        node.left = build(from, middle); node.right = build(middle, to);
      }
      return index;
    };
    if (order.length) build(0, order.length);
    result = { verts, triangles: new Uint32Array(triangles), order: new Uint32Array(order), nodes, bounds: BL.scene.boundsOf(geometry) };
    geometries.set(geometry, result);
    return result;
  };
  const overlaps = (a, b) => a[0] <= b[3] + EPS && a[3] >= b[0] - EPS && a[1] <= b[4] + EPS && a[4] >= b[1] - EPS && a[2] <= b[5] + EPS && a[5] >= b[2] - EPS;
  const rayBox = (box, ox, oy, oz, dx, dy, dz, limit) => {
    let enter = 0, leave = limit;
    for (let axis = 0; axis < 3; axis++) {
      const origin = axis === 0 ? ox : axis === 1 ? oy : oz, direction = axis === 0 ? dx : axis === 1 ? dy : dz;
      if (Math.abs(direction) < 1e-12) { if (origin < box[axis] - EPS || origin > box[axis + 3] + EPS) return false; }
      else {
        const a = (box[axis] - origin) / direction, b = (box[axis + 3] - origin) / direction;
        enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
        if (enter > leave + EPS) return false;
      }
    }
    return true;
  };
  const triangleRay = (verts, a, b, c, ox, oy, oz, dx, dy, dz) => {
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
    const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
    const px = dy * vz - dz * vy, py = dz * vx - dx * vz, pz = dx * vy - dy * vx;
    const determinant = ux * px + uy * py + uz * pz;
    if (Math.abs(determinant) < 1e-12) return Infinity;
    const tx = ox - verts[a], ty = oy - verts[a + 1], tz = oz - verts[a + 2];
    const u = (tx * px + ty * py + tz * pz) / determinant;
    if (u < -EPS || u > 1 + EPS) return Infinity;
    const qx = ty * uz - tz * uy, qy = tz * ux - tx * uz, qz = tx * uy - ty * ux;
    const v = (dx * qx + dy * qy + dz * qz) / determinant;
    if (v < -EPS || u + v > 1 + EPS) return Infinity;
    const t = (vx * qx + vy * qy + vz * qz) / determinant;
    return t >= -EPS ? Math.max(0, t) : Infinity;
  };
  const transformBox = (out, matrix, low, high) => {
    const x = (low[0] + high[0]) / 2, y = (low[1] + high[1]) / 2, z = (low[2] + high[2]) / 2;
    const hx = (high[0] - low[0]) / 2, hy = (high[1] - low[1]) / 2, hz = (high[2] - low[2]) / 2;
    for (let axis = 0; axis < 3; axis++) {
      const center = matrix[axis] * x + matrix[axis + 4] * y + matrix[axis + 8] * z + matrix[axis + 12];
      const reach = Math.abs(matrix[axis]) * hx + Math.abs(matrix[axis + 4]) * hy + Math.abs(matrix[axis + 8]) * hz;
      out[axis] = center - reach; out[axis + 3] = center + reach;
    }
  };
  const create = targets => {
    const entries = new WeakMap(), transforms = new WeakMap(), clubs = new WeakMap();
    const stack = new Int32Array(64), point = new Float64Array(3), triangle = new Float64Array(9), swept = new Float64Array(9), clipped = new Float64Array(12);
    const sweepBox = new Float64Array(6), queryBox = new Float64Array(6), low = new Float64Array(3), high = new Float64Array(3);
    const verticalTriangle = new Float64Array(9), verticalSegment = new Float64Array(6);
    const verticalHit = { node: null, owner: null, type: "none", distance: Infinity, x: 0, y: 0, z: 0 };
    const stats = { queries: 0, candidates: 0, triangleTests: 0, transforms: 0 };
    let generation = 0, originX = 0, originY = 0, originZ = 0;
    let contactDistance = Infinity, contactTriangle = Infinity, contactX = 0, contactY = 0, contactZ = 0;
    const transformState = () => ({ stamp: 0, active: false, version: 0, parent: null, parentVersion: -1, values: new Float64Array(14) });
    const register = node => {
      if (!entries.has(node)) entries.set(node, { geometry: node.geometry, data: null, bounds: node.geometry ? BL.scene.boundsOf(node.geometry) : null, world: mat4.create(), inverse: mat4.create(), box: new Float64Array(6), version: -1, valid: false });
      for (let at = node; at; at = at.parent) if (!transforms.has(at)) transforms.set(at, transformState());
    };
    const refreshWorld = node => {
      let state = transforms.get(node);
      if (!state) { state = transformState(); transforms.set(node, state); }
      if (state.stamp === generation) return state.active;
      state.stamp = generation;
      state.active = node.visible && !node.cameraHidden && (!node.parent || refreshWorld(node.parent));
      if (!state.active) return false;
      const values = state.values, p = node.position, r = node.rotation, s = node.scale, q = node.quaternion;
      const parentVersion = node.parent ? transforms.get(node.parent).version : 0;
      const changed = !state.version || state.parent !== node.parent || state.parentVersion !== parentVersion
        || values[0] !== p.x || values[1] !== p.y || values[2] !== p.z || values[3] !== s.x || values[4] !== s.y || values[5] !== s.z
        || values[6] !== r.x || values[7] !== r.y || values[8] !== r.z || values[9] !== (q ? q[0] : 0) || values[10] !== (q ? q[1] : 0)
        || values[11] !== (q ? q[2] : 0) || values[12] !== (q ? q[3] : 0) || values[13] !== node.poseYaw;
      if (!changed) return true;
      values[0] = p.x; values[1] = p.y; values[2] = p.z; values[3] = s.x; values[4] = s.y; values[5] = s.z;
      values[6] = r.x; values[7] = r.y; values[8] = r.z; values[9] = q ? q[0] : 0; values[10] = q ? q[1] : 0;
      values[11] = q ? q[2] : 0; values[12] = q ? q[3] : 0; values[13] = node.poseYaw;
      state.parent = node.parent; state.parentVersion = parentVersion; state.version++;
      if (node.quaternion) mat4.fromTQS(node.local, node.position, node.quaternion, node.scale);
      else mat4.fromTRS(node.local, node.position, node.rotation, node.scale);
      if (node.poseYaw) {
        const m = node.local, c = Math.cos(node.poseYaw), s = Math.sin(node.poseYaw);
        for (let i = 0; i < 16; i += 4) { const x = m[i], z = m[i + 2]; m[i] = c * x + s * z; m[i + 2] = c * z - s * x; }
      }
      if (node.parent) mat4.multiply(node.world, node.parent.world, node.local);
      else node.world.set(node.local);
      stats.transforms++;
      return true;
    };
    const eligible = (target, ignore) => {
      const { node, owner } = target;
      return !!node.geometry && owner.active !== false && owner.weaponType !== "none" && (!ignore || owner.cave !== ignore)
        && !(node.mirror && (node.mirrorPortal || node.mirrorReveal >= 1)) && refreshWorld(node);
    };
    const sync = node => {
      let entry = entries.get(node);
      if (!entry) { register(node); entry = entries.get(node); }
      if (entry.geometry !== node.geometry) { entry.geometry = node.geometry; entry.data = null; entry.bounds = BL.scene.boundsOf(node.geometry); entry.version = -1; }
      const version = transforms.get(node).version;
      if (entry.version !== version) {
        entry.version = version;
        const m = node.world, determinant = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
        entry.valid = Math.abs(determinant) >= 1e-12;
        if (!entry.valid) return null;
        entry.world.set(m); mat4.invert(entry.inverse, m);
        transformBox(entry.box, m, entry.bounds.min, entry.bounds.max);
      }
      return entry.valid ? entry : null;
    };
    const begin = out => {
      generation++; stats.queries++; stats.candidates = stats.triangleTests = stats.transforms = 0;
      out.node = out.owner = null; out.type = "none"; out.distance = Infinity;
    };
    const hit = (out, target, distance, x, y, z) => {
      out.node = target.node; out.owner = target.owner; out.distance = distance;
      out.x = x; out.y = y; out.z = z;
      out.type = target.owner.weaponType || (target.owner.cave ? target.owner.cave.hostile ? "enemy" : "friendly" : "object");
    };
    const onMirror = (node, bounds, x, y) => x >= bounds.min[0] - EPS && x <= bounds.max[0] + EPS
      && y >= bounds.min[1] + (bounds.max[1] - bounds.min[1]) * (node.mirrorReveal || 0) - EPS && y <= bounds.max[1] + EPS
      && (!node.mirrorDamage || node.mirrorDamage.contains(x, y));
    const ray = (out, ox, oy, oz, dx, dy, dz, maxDistance, ignore = null, accept = null) => {
      begin(out);
      const length = Math.hypot(dx, dy, dz);
      if (!length || maxDistance < 0) return false;
      dx /= length; dy /= length; dz /= length;
      let nearest = maxDistance;
      for (const target of targets) {
        if (!eligible(target, ignore) || accept && !accept(target.owner, target.node)) continue;
        const entry = sync(target.node);
        if (!entry || !rayBox(entry.box, ox, oy, oz, dx, dy, dz, nearest)) continue;
        stats.candidates++;
        const m = entry.inverse;
        mat4.transformPoint(point, m, ox, oy, oz);
        const lx = point[0], ly = point[1], lz = point[2];
        const ux = m[0] * dx + m[4] * dy + m[8] * dz, uy = m[1] * dx + m[5] * dy + m[9] * dz, uz = m[2] * dx + m[6] * dy + m[10] * dz;
        let found = Infinity;
        if (target.node.mirror) {
          const t = Math.abs(uz) > 1e-12 ? (entry.bounds.min[2] - lz) / uz : -1;
          if (t >= 0 && t <= nearest && onMirror(target.node, entry.bounds, lx + ux * t, ly + uy * t)) found = t;
        } else {
          const data = entry.data || (entry.data = geometryOf(target.node.geometry));
          if (!data.nodes.length) continue;
          let size = 1; stack[0] = 0;
          while (size) {
            const node = data.nodes[stack[--size]];
            if (!rayBox(node.box, lx, ly, lz, ux, uy, uz, Math.min(nearest, found))) continue;
            if (node.left >= 0) { stack[size++] = node.left; stack[size++] = node.right; continue; }
            for (let i = node.from; i < node.to; i++) {
              const at = data.order[i] * 3;
              const t = triangleRay(data.verts, data.triangles[at], data.triangles[at + 1], data.triangles[at + 2], lx, ly, lz, ux, uy, uz);
              stats.triangleTests++;
              if (t < found && t <= nearest) found = t;
            }
          }
        }
        if (found < Infinity) { nearest = found; hit(out, target, found, ox + dx * found, oy + dy * found, oz + dz * found); }
      }
      return !!out.node;
    };
    // A carry-view shot may adjust height, but never turn toward the orbit
    // camera. Slice eligible meshes with the body's forward vertical plane;
    // precise rays and the scene's solid sweep still decide visibility.
    const verticalRay = (out, ox, oy, oz, dx, dz, maxDistance, ignore = null, clear = null, accept = null) => {
      begin(out);
      const length = Math.hypot(dx, dz);
      if (!length || maxDistance <= 0) return false;
      dx /= length; dz /= length;
      const consider = (ax, ay, az, bx, by, bz) => {
        const vx = bx - ax, vy = by - ay, vz = bz - az, norm = vx * vx + vy * vy + vz * vz;
        const nearest = norm ? Math.max(0, Math.min(1, ((ox - ax) * vx + (oy - ay) * vy + (oz - az) * vz) / norm)) : 0;
        // Endpoints let a partly exposed surface remain a candidate when its
        // nearest point is hidden behind scenery.
        for (let sample = 0; sample < 3; sample++) {
          const t = sample === 0 ? nearest : sample - 1, x = ax + vx * t, y = ay + vy * t, z = az + vz * t;
          const rx = x - ox, ry = y - oy, rz = z - oz, distance = Math.hypot(rx, ry, rz);
          if (rx * dx + rz * dz <= EPS || distance > maxDistance || distance >= out.distance || distance < EPS) continue;
          if (!ray(verticalHit, ox, oy, oz, rx, ry, rz, distance + 1e-5, ignore, accept)) continue;
          const margin = Math.max(0, 1 - 1e-5 / verticalHit.distance);
          if (clear && !clear(ox, oy, oz, ox + (verticalHit.x - ox) * margin, oy + (verticalHit.y - oy) * margin,
            oz + (verticalHit.z - oz) * margin, verticalHit.node, true)) continue;
          if (verticalHit.distance < out.distance) Object.assign(out, verticalHit);
        }
      };
      for (const target of targets) {
        if (!eligible(target, ignore) || accept && !accept(target.owner, target.node)) continue;
        const entry = sync(target.node);
        if (!entry) continue;
        // A damaged mirror remains one aimable surface even when the forward
        // slice crosses a hole. Resolve that slice against the original pane,
        // then let mirror damage choose the closest surviving panel.
        if (target.node.mirror && target.node.mirrorDamage?.aimCenter) {
          const m = entry.inverse, source = geometryOf(target.node.mirrorCaptureGeometry || target.node.geometry).bounds;
          mat4.transformPoint(point, m, ox, oy, oz);
          const ux = m[0] * dx + m[8] * dz, uz = m[2] * dx + m[10] * dz;
          const t = Math.abs(uz) > 1e-12 ? (source.min[2] - point[2]) / uz : -1;
          const lx = point[0] + ux * t, ly = point[1];
          if (t > EPS && lx >= source.min[0] - EPS && lx <= source.max[0] + EPS
            && ly >= source.min[1] - EPS && ly <= source.max[1] + EPS) {
            const x = ox + dx * t, z = oz + dz * t;
            if (target.node.mirrorDamage.aimCenter(verticalHit, x, oy, z)) {
              const rx = verticalHit.x - ox, ry = verticalHit.y - oy, rz = verticalHit.z - oz;
              const distance = Math.hypot(rx, ry, rz), forward = rx * dx + rz * dz;
              if (forward > EPS && distance <= maxDistance && distance < out.distance
                && (!clear || clear(ox, oy, oz, verticalHit.x, verticalHit.y, verticalHit.z, target.node, true))) {
                hit(out, target, distance, verticalHit.x, verticalHit.y, verticalHit.z);
              }
            }
          }
          continue;
        }
        const box = entry.box, cx = (box[0] + box[3]) / 2 - ox, cz = (box[2] + box[5]) / 2 - oz;
        const hx = (box[3] - box[0]) / 2, hz = (box[5] - box[2]) / 2;
        if (Math.abs(cx * dz - cz * dx) > Math.abs(dz) * hx + Math.abs(dx) * hz + EPS
          || cx * dx + cz * dz + Math.abs(dx) * hx + Math.abs(dz) * hz <= 0) continue;
        const bx = Math.max(box[0] - ox, 0, ox - box[3]), by = Math.max(box[1] - oy, 0, oy - box[4]), bz = Math.max(box[2] - oz, 0, oz - box[5]);
        const limit = Math.min(maxDistance, out.distance);
        if (bx * bx + by * by + bz * bz > limit * limit) continue;
        const data = entry.data || (entry.data = geometryOf(target.node.geometry)), m = entry.world;
        for (let at = 0; at < data.triangles.length; at += 3) {
          for (let vertex = 0; vertex < 3; vertex++) {
            const index = data.triangles[at + vertex], x = data.verts[index], y = data.verts[index + 1], z = data.verts[index + 2];
            for (let axis = 0; axis < 3; axis++) verticalTriangle[vertex * 3 + axis] = m[axis] * x + m[axis + 4] * y + m[axis + 8] * z + m[axis + 12];
          }
          let count = 0;
          for (let edge = 0; edge < 3; edge++) {
            const a = edge * 3, b = (edge + 1) % 3 * 3;
            const sa = (verticalTriangle[a] - ox) * dz - (verticalTriangle[a + 2] - oz) * dx;
            const sb = (verticalTriangle[b] - ox) * dz - (verticalTriangle[b + 2] - oz) * dx;
            if (Math.abs(sa) <= EPS && Math.abs(sb) <= EPS) {
              consider(verticalTriangle[a], verticalTriangle[a + 1], verticalTriangle[a + 2], verticalTriangle[b], verticalTriangle[b + 1], verticalTriangle[b + 2]);
              continue;
            }
            if (sa * sb > 0 || Math.abs(sa - sb) < EPS) continue;
            const t = sa / (sa - sb);
            for (let axis = 0; axis < 3; axis++) verticalSegment[count * 3 + axis] = verticalTriangle[a + axis] + (verticalTriangle[b + axis] - verticalTriangle[a + axis]) * t;
            if (count && Math.hypot(verticalSegment[3] - verticalSegment[0], verticalSegment[4] - verticalSegment[1], verticalSegment[5] - verticalSegment[2]) < EPS) continue;
            if (++count === 2) {
              consider(verticalSegment[0], verticalSegment[1], verticalSegment[2], verticalSegment[3], verticalSegment[4], verticalSegment[5]);
              break;
            }
          }
        }
      }
      return !!out.node;
    };
    const valid = (contact, ignore = null) => {
      generation++;
      for (const target of targets) if (target.node === contact.node && target.owner === contact.owner) return eligible(target, ignore);
      return false;
    };
    // Segment against a triangle, including the coplanar contact at the start
    // of a swing. Every accepted point belongs to both actual mesh surfaces.
    const segment = (verts, a, b, c, ax, ay, az, bx, by, bz) => {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      let t = triangleRay(verts, a, b, c, ax, ay, az, dx, dy, dz);
      if (t <= 1 + EPS) { point[0] = ax + dx * t; point[1] = ay + dy * t; point[2] = az + dz * t; return true; }
      const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
      const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, norm = Math.hypot(nx, ny, nz);
      if (norm < 1e-12 || Math.abs(nx * (ax - verts[a]) + ny * (ay - verts[a + 1]) + nz * (az - verts[a + 2])) > EPS * norm
        || Math.abs(nx * dx + ny * dy + nz * dz) > EPS * norm) return false;
      // Clip the coplanar segment against the triangle's three inward edges.
      let enter = 0, leave = 1;
      for (let i = 0; i < 3; i++) {
        const from = i === 0 ? a : i === 1 ? b : c, to = i === 0 ? b : i === 1 ? c : a;
        const ex = verts[to] - verts[from], ey = verts[to + 1] - verts[from + 1], ez = verts[to + 2] - verts[from + 2];
        const hx = ny * ez - nz * ey, hy = nz * ex - nx * ez, hz = nx * ey - ny * ex;
        const start = hx * (ax - verts[from]) + hy * (ay - verts[from + 1]) + hz * (az - verts[from + 2]), delta = hx * dx + hy * dy + hz * dz;
        if (Math.abs(delta) < 1e-12) { if (start < -EPS * norm) return false; }
        else { t = -start / delta; if (delta > 0) enter = Math.max(enter, t); else leave = Math.min(leave, t); if (enter > leave + EPS) return false; }
      }
      point[0] = ax + dx * enter; point[1] = ay + dy * enter; point[2] = az + dz * enter;
      return true;
    };
    const saveContact = index => {
      const dx = point[0] - originX, dy = point[1] - originY, dz = point[2] - originZ, distance = dx * dx + dy * dy + dz * dz;
      // BVH order never decides a hit. Original triangle order breaks exact
      // distance ties; contacts within one triangle keep their fixed edge order.
      if (distance > contactDistance || distance === contactDistance && index >= contactTriangle) return;
      contactDistance = distance; contactTriangle = index;
      contactX = point[0]; contactY = point[1]; contactZ = point[2];
    };
    const triangleContacts = (verts, a, b, c, index) => {
      stats.triangleTests++;
      for (let axis = 0; axis < 3; axis++) if (Math.max(verts[a + axis], verts[b + axis], verts[c + axis]) < Math.min(triangle[axis], triangle[axis + 3], triangle[axis + 6]) - EPS
        || Math.min(verts[a + axis], verts[b + axis], verts[c + axis]) > Math.max(triangle[axis], triangle[axis + 3], triangle[axis + 6]) + EPS) return;
      for (let i = 0; i < 3; i++) {
        const from = i * 3, to = (i + 1) % 3 * 3;
        if (segment(verts, a, b, c, triangle[from], triangle[from + 1], triangle[from + 2], triangle[to], triangle[to + 1], triangle[to + 2])) saveContact(index);
        const j = i === 0 ? a : i === 1 ? b : c, k = i === 0 ? b : i === 1 ? c : a;
        if (segment(triangle, 0, 3, 6, verts[j], verts[j + 1], verts[j + 2], verts[k], verts[k + 1], verts[k + 2])) saveContact(index);
      }
    };
    const sweepContacts = (data, before, after, index) => {
      for (let i = 0; i < data.triangles.length; i += 3) {
        const a = data.triangles[i], b = data.triangles[i + 1], c = data.triangles[i + 2];
        let separated = false;
        for (let axis = 0; axis < 3; axis++) if (Math.max(before[a + axis], before[b + axis], before[c + axis], after[a + axis], after[b + axis], after[c + axis]) < Math.min(triangle[axis], triangle[axis + 3], triangle[axis + 6]) - EPS
          || Math.min(before[a + axis], before[b + axis], before[c + axis], after[a + axis], after[b + axis], after[c + axis]) > Math.max(triangle[axis], triangle[axis + 3], triangle[axis + 6]) + EPS) { separated = true; break; }
        if (separated) continue;
        triangleContacts(before, a, b, c, index); triangleContacts(after, a, b, c, index);
        // A moving triangle sweeps three edge quads. Testing both triangles of
        // each quad also catches a thin target crossing between club vertices.
        for (let edge = 0; edge < 3; edge++) {
          const j = edge === 0 ? a : edge === 1 ? b : c, k = edge === 0 ? b : edge === 1 ? c : a;
          for (let axis = 0; axis < 3; axis++) { swept[axis] = before[j + axis]; swept[axis + 3] = before[k + axis]; swept[axis + 6] = after[k + axis]; }
          triangleContacts(swept, 0, 3, 6, index);
          for (let axis = 0; axis < 3; axis++) { swept[axis + 3] = after[k + axis]; swept[axis + 6] = after[j + axis]; }
          triangleContacts(swept, 0, 3, 6, index);
        }
      }
    };
    const revealedContacts = (verts, a, b, c, bottom, matrix, data, before, after, index) => {
      // Cutting a shard at the reveal height leaves at most four vertices.
      // Clip before testing so a hidden contact cannot mask visible glass.
      let count = 0;
      for (let edge = 0; edge < 3; edge++) {
        const from = edge === 0 ? a : edge === 1 ? b : c, to = edge === 0 ? b : edge === 1 ? c : a;
        const inside = verts[from + 1] >= bottom, nextInside = verts[to + 1] >= bottom;
        if (inside) {
          for (let axis = 0; axis < 3; axis++) clipped[count * 3 + axis] = verts[from + axis];
          count++;
        }
        if (inside !== nextInside) {
          const t = (bottom - verts[from + 1]) / (verts[to + 1] - verts[from + 1]);
          for (let axis = 0; axis < 3; axis++) clipped[count * 3 + axis] = verts[from + axis] + (verts[to + axis] - verts[from + axis]) * t;
          count++;
        }
      }
      for (let i = 1; i + 1 < count; i++) {
        for (let vertex = 0; vertex < 3; vertex++) {
          const at = (vertex === 0 ? 0 : vertex === 1 ? i : i + 1) * 3, x = clipped[at], y = clipped[at + 1], z = clipped[at + 2];
          for (let axis = 0; axis < 3; axis++) triangle[vertex * 3 + axis] = matrix[axis] * x + matrix[axis + 4] * y + matrix[axis + 8] * z + matrix[axis + 12];
        }
        sweepContacts(data, before, after, index);
      }
    };
    const strike = (out, previousWorld, currentWorld, geometry, ignore = null) => {
      begin(out);
      originX = currentWorld[12]; originY = currentWorld[13]; originZ = currentWorld[14];
      let nearest = Infinity;
      const data = geometryOf(geometry);
      let buffers = clubs.get(geometry);
      if (!buffers) { buffers = { before: new Float64Array(data.verts.length), after: new Float64Array(data.verts.length) }; clubs.set(geometry, buffers); }
      const { before, after } = buffers;
      sweepBox[0] = sweepBox[1] = sweepBox[2] = Infinity; sweepBox[3] = sweepBox[4] = sweepBox[5] = -Infinity;
      for (let i = 0; i < data.verts.length; i += 3) {
        const x = data.verts[i], y = data.verts[i + 1], z = data.verts[i + 2];
        for (let axis = 0; axis < 3; axis++) {
          const a = previousWorld[axis] * x + previousWorld[axis + 4] * y + previousWorld[axis + 8] * z + previousWorld[axis + 12];
          const b = currentWorld[axis] * x + currentWorld[axis + 4] * y + currentWorld[axis + 8] * z + currentWorld[axis + 12];
          before[i + axis] = a; after[i + axis] = b;
          sweepBox[axis] = Math.min(sweepBox[axis], a, b); sweepBox[axis + 3] = Math.max(sweepBox[axis + 3], a, b);
        }
      }
      for (const target of targets) {
        if (!eligible(target, ignore)) continue;
        const entry = sync(target.node);
        if (!entry || !overlaps(entry.box, sweepBox)) continue;
        stats.candidates++;
        const m = entry.world;
        contactDistance = contactTriangle = Infinity;
        if (target.node.mirror && !target.node.mirrorDamage?.stage) {
          const bounds = entry.bounds, bottom = bounds.min[1] + (bounds.max[1] - bounds.min[1]) * (target.node.mirrorReveal || 0);
          for (let face = 0; face < 2; face++) {
            for (let vertex = 0; vertex < 3; vertex++) {
              const corner = face ? vertex === 0 ? 0 : vertex + 1 : vertex;
              const x = corner === 0 || corner === 3 ? bounds.min[0] : bounds.max[0], y = corner < 2 ? bottom : bounds.max[1], z = bounds.min[2];
              for (let axis = 0; axis < 3; axis++) triangle[vertex * 3 + axis] = m[axis] * x + m[axis + 4] * y + m[axis + 8] * z + m[axis + 12];
            }
            sweepContacts(data, before, after, face);
          }
        } else {
          const targetData = entry.data || (entry.data = geometryOf(target.node.geometry));
          if (!targetData.nodes.length) continue;
          for (let axis = 0; axis < 3; axis++) { low[axis] = sweepBox[axis]; high[axis] = sweepBox[axis + 3]; }
          transformBox(queryBox, entry.inverse, low, high);
          let size = 1; stack[0] = 0;
          while (size) {
            const node = targetData.nodes[stack[--size]];
            if (!overlaps(node.box, queryBox)) continue;
            if (node.left >= 0) { stack[size++] = node.left; stack[size++] = node.right; continue; }
            for (let i = node.from; i < node.to; i++) {
              const index = targetData.order[i] * 3;
              if (target.node.mirror && target.node.mirrorReveal > 0) {
                const bounds = entry.bounds, bottom = bounds.min[1] + (bounds.max[1] - bounds.min[1]) * target.node.mirrorReveal;
                revealedContacts(targetData.verts, targetData.triangles[index], targetData.triangles[index + 1], targetData.triangles[index + 2], bottom, m, data, before, after, index);
                continue;
              }
              for (let vertex = 0; vertex < 3; vertex++) {
                const at = targetData.triangles[index + vertex], x = targetData.verts[at], y = targetData.verts[at + 1], z = targetData.verts[at + 2];
                for (let axis = 0; axis < 3; axis++) triangle[vertex * 3 + axis] = m[axis] * x + m[axis + 4] * y + m[axis + 8] * z + m[axis + 12];
              }
              sweepContacts(data, before, after, index);
            }
          }
        }
        // Equal target distances keep the first registered target.
        if (contactDistance < nearest) {
          nearest = contactDistance;
          hit(out, target, Math.sqrt(contactDistance), contactX, contactY, contactZ);
        }
      }
      return !!out.node;
    };
    return { ray, verticalRay, strike, valid, register, stats };
  };
  BL.weaponTargets = { create };
})();
