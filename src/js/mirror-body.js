// A small distance atlas follows moving geometry's actual section through glass.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {}, { mat4 } = BL.math;
  const SIZE = 96, CAPACITY = 4, RANGE = 1.5, WIDTH = 0.06, SPEED = 1.2, LIFETIME = 0.9;
  const INTERVAL = 1 / 30;
  const strengthAt = age => Math.exp(-3 * age) * Math.max(0, 1 - age / LIFETIME);
  const visible = node => {
    for (let part = node; part; part = part.parent) if (!part.visible) return false;
    return true;
  };
  const create = (node, cavemen) => {
    const count = SIZE * SIZE, layerBytes = count * 4, pixels = new Uint8Array(layerBytes * (CAPACITY + 1));
    const waves = new Float32Array(CAPACITY * 4), inverse = mat4.create(), matrix = mat4.create();
    const bounds = BL.scene.boundsOf(node.geometry), point = new Float64Array(3);
    const minX = bounds.min[0], minY = bounds.min[1], plane = bounds.min[2];
    const dx = (bounds.max[0] - minX) / SIZE, dy = (bounds.max[1] - minY) / SIZE, diagonal = Math.hypot(dx, dy);
    const mask = new Uint8Array(count), union = new Uint8Array(count), lastUnion = new Uint8Array(count);
    const parity = new Uint8Array(count), rowParity = new Uint8Array(SIZE), distance = new Float32Array(count), glass = new Uint8Array(count);
    const actors = [], records = new WeakMap();
    let vertices = new Float64Array(0), alive = true;
    // Registration follows the scene's bounded actor and object pools. Only
    // model changes walk a subtree or resize scratch; sampling never scans the scene.
    function refresh(body) {
      if (!alive) return false;
      const actor = records.get(body);
      if (!actor) return false;
      const parts = [];
      let maximum = actor.vertexCapacity;
      const visit = part => {
        if (part.geometry) { parts.push(part); maximum = Math.max(maximum, part.geometry.verts.length); }
        for (const child of part.children) visit(child);
      };
      visit(body);
      actor.parts = parts;
      actor.previous = parts.map(() => mat4.create()); actor.current = parts.map(() => mat4.create());
      actor.sampled = false;
      if (vertices.length < maximum) vertices = new Float64Array(maximum);
      return true;
    }
    function track(body, radius = Infinity, vertexCapacity = 0) {
      if (!alive) return false;
      let actor = records.get(body);
      if (actor?.active) return false;
      if (!actor) {
        actor = { body, radius, vertexCapacity, parts: null, previous: null, current: null,
          lastMask: new Uint8Array(count), touching: false, sampled: false, active: false };
        records.set(body, actor); refresh(body);
      } else {
        actor.radius = radius; actor.touching = actor.sampled = false; actor.lastMask.fill(0);
        let maximum = vertexCapacity;
        for (const part of actor.parts) maximum = Math.max(maximum, part.geometry.verts.length);
        if (vertices.length < maximum) vertices = new Float64Array(maximum);
      }
      actor.active = true;
      actors.push(actor);
      return true;
    }
    function untrack(body) {
      const index = actors.findIndex(actor => actor.body === body);
      if (index < 0) return false;
      actors[index].active = false;
      actors.splice(index, 1);
      return true;
    }
    for (const cave of cavemen.values()) track(cave.root, cave.traits.height * 2,
      Math.max(cave.headOpen.verts.length, cave.headClosed.verts.length));
    let root = node;
    while (root.parent) root = root.parent;
    BL.scene.updateWorld(root);
    mat4.invert(inverse, node.world);
    let next = 0, sampleTime = INTERVAL, bottom = minY, blocked = false, glassVersion = -1;
    const state = { width: SIZE, height: SIZE, layers: CAPACITY + 1, pixels, version: 0,
      contacts: 0, active: 0, hits: 0, waves, time: 0, track, untrack, refresh, update, dispose,
      get tracked() { return actors.length; } };
    function clearLayer(layer) {
      const end = (layer + 1) * layerBytes;
      for (let i = layer * layerBytes; i < end; i += 4) {
        pixels[i] = 255; pixels[i + 1] = pixels[i + 2] = 128; pixels[i + 3] = 0;
      }
    }
    for (let layer = 0; layer <= CAPACITY; layer++) clearLayer(layer);
    // Each polygon/plane section toggles scanline parity. The prefix fill is
    // bounded by atlas size and preserves gaps between legs, arms and fingers.
    function segment(ax, ay, bx, by) {
      if (Math.abs(by - ay) < 1e-10) return;
      const first = Math.max(0, Math.ceil((Math.max(bottom, Math.min(ay, by)) - minY) / dy - 0.5));
      const end = Math.min(SIZE, Math.ceil((Math.max(ay, by) - minY) / dy - 0.5));
      for (let row = first; row < end; row++) {
        const y = minY + (row + 0.5) * dy, x = ax + (bx - ax) * (y - ay) / (by - ay);
        const col = Math.max(0, Math.ceil((x - minX) / dx - 0.5));
        if (col < SIZE) { parity[row * SIZE + col] ^= 1; rowParity[row] ^= 1; }
      }
    }
    function partMask(part, transform) {
      if (!visible(part)) return;
      const geometry = part.geometry, box = BL.scene.boundsOf(geometry);
      let lowX = Infinity, lowY = Infinity, lowZ = Infinity, highX = -Infinity, highY = -Infinity, highZ = -Infinity;
      for (let i = 0; i < 8; i++) {
        mat4.transformPoint(point, transform, (i & 1 ? box.max : box.min)[0], (i & 2 ? box.max : box.min)[1], (i & 4 ? box.max : box.min)[2]);
        lowX = Math.min(lowX, point[0]); highX = Math.max(highX, point[0]);
        lowY = Math.min(lowY, point[1]); highY = Math.max(highY, point[1]);
        lowZ = Math.min(lowZ, point[2]); highZ = Math.max(highZ, point[2]);
      }
      if (lowZ > plane || highZ < plane || highX < minX || lowX > bounds.max[0] || highY < bottom || lowY > bounds.max[1]) return;
      // Keep a grazing face inside the solid by an imperceptible amount. This
      // avoids ambiguous duplicate edges when a voxel face is exactly coplanar.
      const cut = Math.max(lowZ + 1e-6, Math.min(highZ - 1e-6, plane));
      const verts = geometry.verts;
      for (let i = 0; i < verts.length; i += 3) {
        mat4.transformPoint(point, transform, verts[i], verts[i + 1], verts[i + 2]);
        vertices[i] = point[0]; vertices[i + 1] = point[1]; vertices[i + 2] = point[2] - cut;
      }
      parity.fill(0); rowParity.fill(0);
      for (const face of geometry.faces) {
        const indices = face.i;
        let found = false, ax = 0, ay = 0, bx = 0, by = 0, farthest = 0;
        for (let i = 0; i < indices.length; i++) {
          const ai = indices[i] * 3, bi = indices[(i + 1) % indices.length] * 3;
          const az = vertices[ai + 2], bz = vertices[bi + 2];
          if ((az > 0) === (bz > 0)) continue;
          const t = az / (az - bz), x = vertices[ai] + (vertices[bi] - vertices[ai]) * t;
          const y = vertices[ai + 1] + (vertices[bi + 1] - vertices[ai + 1]) * t;
          if (!found) { ax = x; ay = y; found = true; }
          else {
            const d = (x - ax) ** 2 + (y - ay) ** 2;
            if (d > farthest) { bx = x; by = y; farthest = d; }
          }
        }
        if (farthest > 1e-16) segment(ax, ay, bx, by);
      }
      const first = Math.max(0, Math.ceil((Math.max(bottom, lowY) - minY) / dy - 0.5));
      const end = Math.min(SIZE, Math.ceil((highY - minY) / dy - 0.5));
      const firstCol = Math.max(0, Math.floor((lowX - minX) / dx - 0.5));
      const endCol = Math.min(SIZE, Math.ceil((highX - minX) / dx + 0.5));
      for (let row = first; row < end; row++) {
        // A closed mesh has paired scanline crossings unless it continues
        // through the pane's right edge. A grazing polygon can degenerate to
        // one unmatched section. Never let that remnant flood from the body
        // across the rest of the mirror.
        if (rowParity[row] && highX < bounds.max[0] - dx * 0.5) continue;
        let inside = 0;
        for (let col = firstCol, i = row * SIZE + col; col < endCol; col++, i++) {
          inside ^= parity[i];
          if (!inside || mask[i]) continue;
          if (node.mirrorDamage?.stage) {
            // Test only touched texels, once per immutable fracture version.
            // Repeated held contacts never rescan the pane polygons.
            if (!glass[i]) glass[i] = node.mirrorDamage.contains(minX + (col + 0.5) * dx, minY + (row + 0.5) * dy) ? 2 : 1;
            if (glass[i] === 1) continue;
          }
          mask[i] = 1;
        }
      }
    }
    function bodyMask(actor, blend = 1) {
      mask.fill(0);
      for (let p = 0; p < actor.parts.length; p++) {
        const current = actor.current[p];
        if (blend === 1) partMask(actor.parts[p], current);
        else {
          const previous = actor.previous[p];
          for (let i = 0; i < 16; i++) matrix[i] = previous[i] + (current[i] - previous[i]) * blend;
          partMask(actor.parts[p], matrix);
        }
      }
      for (let i = 0; i < count; i++) if (mask[i]) return true;
      return false;
    }
    function crossing(actor, elapsed) {
      // A held weapon can cross while its owner's body stays still. Check
      // each part's swept centre, then rasterize its real interpolated mesh.
      for (let p = 0; p < actor.parts.length; p++) {
        const part = actor.parts[p];
        if (!visible(part)) continue;
        const box = BL.scene.boundsOf(part.geometry), previous = actor.previous[p], current = actor.current[p];
        const x = (box.min[0] + box.max[0]) * 0.5, y = (box.min[1] + box.max[1]) * 0.5, z = (box.min[2] + box.max[2]) * 0.5;
        mat4.transformPoint(point, previous, x, y, z);
        const px = point[0], py = point[1], pz = point[2] - plane;
        mat4.transformPoint(point, current, x, y, z);
        const cz = point[2] - plane;
        if (pz * cz >= 0 || (point[0] - px) ** 2 + (point[1] - py) ** 2 + (cz - pz) ** 2 >= 4) continue;
        const t = pz / (pz - cz);
        if (bodyMask(actor, t)) { emit(mask, (1 - t) * elapsed); emit(mask, (1 - t) * elapsed * 0.5); return; }
      }
    }
    // Two chamfer passes turn any union mask into a bounded signed field. The
    // renderers sample five texels rather than walking every limb per pixel.
    function field(source, layer) {
      for (let row = 0; row < SIZE; row++) for (let col = 0, i = row * SIZE; col < SIZE; col++, i++) {
        const inside = source[i];
        let d = RANGE;
        if ((col ? source[i - 1] : 0) !== inside || (col + 1 < SIZE ? source[i + 1] : 0) !== inside) d = dx * 0.5;
        if ((row ? source[i - SIZE] : 0) !== inside || (row + 1 < SIZE ? source[i + SIZE] : 0) !== inside) d = Math.min(d, dy * 0.5);
        distance[i] = d;
      }
      for (let row = 0; row < SIZE; row++) for (let col = 0, i = row * SIZE; col < SIZE; col++, i++) {
        let d = distance[i];
        if (col) d = Math.min(d, distance[i - 1] + dx);
        if (row) {
          d = Math.min(d, distance[i - SIZE] + dy);
          if (col) d = Math.min(d, distance[i - SIZE - 1] + diagonal);
          if (col + 1 < SIZE) d = Math.min(d, distance[i - SIZE + 1] + diagonal);
        }
        distance[i] = d;
      }
      for (let row = SIZE - 1; row >= 0; row--) for (let col = SIZE - 1, i = row * SIZE + col; col >= 0; col--, i--) {
        let d = distance[i];
        if (col + 1 < SIZE) d = Math.min(d, distance[i + 1] + dx);
        if (row + 1 < SIZE) {
          d = Math.min(d, distance[i + SIZE] + dy);
          if (col) d = Math.min(d, distance[i + SIZE - 1] + diagonal);
          if (col + 1 < SIZE) d = Math.min(d, distance[i + SIZE + 1] + diagonal);
        }
        distance[i] = d;
      }
      for (let i = 0; i < count; i++) if (source[i]) distance[i] = -distance[i];
      const offset = layer * layerBytes;
      for (let row = 0; row < SIZE; row++) for (let col = 0, i = row * SIZE; col < SIZE; col++, i++) {
        const gx = (distance[col + 1 < SIZE ? i + 1 : i] - distance[col ? i - 1 : i]) / dx;
        const gy = (distance[row + 1 < SIZE ? i + SIZE : i] - distance[row ? i - SIZE : i]) / dy;
        const length = Math.hypot(gx, gy), at = offset + i * 4;
        pixels[at] = Math.round((0.5 + distance[i] / (2 * RANGE)) * 255);
        pixels[at + 1] = Math.round((0.5 + (length ? gx / length : 0) * 0.5) * 255);
        pixels[at + 2] = Math.round((0.5 + (length ? gy / length : 0) * 0.5) * 255);
        pixels[at + 3] = 255;
      }
      state.version++;
    }
    function emit(source, age = 0) {
      const at = next * 4;
      if (!waves[at + 1]) state.active++;
      field(source, next + 1);
      waves[at] = age; waves[at + 1] = strengthAt(age);
      next = (next + 1) % CAPACITY;
      state.hits++;
    }
    function sample(elapsed) {
      union.fill(0);
      const version = node.mirrorDamage ? node.mirrorDamage.version : -1;
      if (version !== glassVersion) { glass.fill(0); glassVersion = version; }
      bottom = minY + (bounds.max[1] - minY) * (node.mirrorReveal || 0);
      let contacts = 0;
      for (const actor of actors) {
        const body = actor.body, position = body.position;
        if (body.parent) {
          mat4.transformPoint(point, body.parent.world, position.x, position.y, position.z);
          mat4.transformPoint(point, inverse, point[0], point[1], point[2]);
        } else mat4.transformPoint(point, inverse, position.x, position.y, position.z);
        const x = point[0], y = point[1], z = point[2] - plane, radius = actor.radius;
        const shown = visible(body), nearby = shown && x + radius >= minX && x - radius <= bounds.max[0]
          && y + radius >= bottom && y - radius <= bounds.max[1] && Math.abs(z) <= radius;
        let touching = false;
        if (nearby) {
          BL.scene.updateWorld(body, body.parent?.world);
          for (let p = 0; p < actor.parts.length; p++) mat4.multiply(actor.current[p], inverse, actor.parts[p].world);
          touching = bodyMask(actor);
          if (touching) {
            contacts++;
            if (!actor.touching) emit(mask);
            actor.lastMask.set(mask);
            for (let i = 0; i < count; i++) union[i] |= mask[i];
          } else if (!actor.touching && actor.sampled) crossing(actor, elapsed);
          for (let p = 0; p < actor.parts.length; p++) actor.previous[p].set(actor.current[p]);
        }
        if (!touching && actor.touching && shown) emit(actor.lastMask);
        actor.touching = touching; actor.sampled = nearby;
      }
      let changed = false;
      for (let i = 0; i < count; i++) if (lastUnion[i] !== union[i]) { changed = true; break; }
      if (changed) {
        if (contacts) field(union, 0);
        else { clearLayer(0); state.version++; }
        lastUnion.set(union);
      }
      state.contacts = contacts;
    }
    function clear() {
      if (state.version || state.contacts || state.active) {
        for (let layer = 0; layer <= CAPACITY; layer++) clearLayer(layer);
        state.version++;
      }
      state.contacts = state.active = 0;
      waves.fill(0); lastUnion.fill(0);
      for (const actor of actors) { actor.touching = actor.sampled = false; actor.lastMask.fill(0); }
    }
    function update(dt) {
      if (!alive) return;
      state.time += dt;
      if (!visible(node) || node.mirrorPortal || node.mirrorReveal >= 1) {
        if (!blocked) clear();
        blocked = true; return;
      }
      if (blocked) { sampleTime = INTERVAL; blocked = false; }
      let active = 0;
      for (let at = 0; at < waves.length; at += 4) {
        if (!waves[at + 1]) continue;
        const age = waves[at] + dt;
        waves[at] = age; waves[at + 1] = age < LIFETIME ? strengthAt(age) : 0;
        if (waves[at + 1]) active++;
      }
      state.active = active;
      sampleTime += dt;
      if (sampleTime >= INTERVAL) { const elapsed = sampleTime; sampleTime %= INTERVAL; sample(elapsed); }
    }
    function dispose() {
      clear(); actors.length = 0; vertices = null; alive = false; node.mirrorBody = null;
    }
    node.mirrorBody = state;
    return state;
  };
  BL.mirrorBody = { create, SIZE, CAPACITY, RANGE, WIDTH, SPEED, LIFETIME };
})();
