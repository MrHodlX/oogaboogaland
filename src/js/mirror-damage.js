// Fixed glass panes regrow from their centers before the remaining cracks seal.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { mat4, mulberry32, hexToRgb, sortByKey, sortScratch } = BL.math;
  const { createNode, addChild, removeChild, boundsOf } = BL.scene;
  const PANEL_DAMAGE = 20, PANEL_HEALTH = 1, PANEL_LIMIT = 48, DEBRIS_LIMIT = 48, DEBRIS_LIFE = 1.2, HEAL_DELAY = 3, HEAL_RATE = 2;
  const MAX_DAMAGE = PANEL_DAMAGE + PANEL_LIMIT * PANEL_HEALTH, DAMAGE_STEP = 0.5, STATE_LIMIT = MAX_DAMAGE / DAMAGE_STEP;
  const PANEL_HEAL_RATE = HEAL_RATE / PANEL_LIMIT;
  const CRACK_HEAL_TIME = 1.5, CRACK_STEPS = 6, REPAIR_STEPS = 96, REPAIR_CACHES = 2;
  const GLASS = hexToRgb("#8298a0"), EDGE = hexToRgb("#d5e4e8");
  const areaOf = polygon => {
    let area = 0;
    for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) area += polygon[j] * polygon[i + 1] - polygon[i] * polygon[j + 1];
    return Math.abs(area) * 0.5;
  };
  const clip = (polygon, nx, ny, offset) => {
    const result = [];
    const push = (x, y) => {
      const n = result.length;
      if (!n || Math.abs(result[n - 2] - x) + Math.abs(result[n - 1] - y) > 1e-8) result.push(x, y);
    };
    for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
      const ax = polygon[j], ay = polygon[j + 1], bx = polygon[i], by = polygon[i + 1];
      const a = ax * nx + ay * ny - offset, b = bx * nx + by * ny - offset;
      if ((a >= 0) !== (b >= 0)) {
        const t = a / (a - b);
        push(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
      if (b >= 0) push(bx, by);
    }
    const n = result.length;
    if (n > 2 && Math.abs(result[0] - result[n - 2]) + Math.abs(result[1] - result[n - 1]) < 1e-8) result.length -= 2;
    return result;
  };
  const geometry = (verts = [], faces = []) => ({ verts, faces, lines: [], castShadow: false });
  const appendFace = (geo, polygon, z, color, reverse = false) => {
    const base = geo.verts.length / 3;
    for (let i = 0; i < polygon.length; i += 2) geo.verts.push(polygon[i], polygon[i + 1], z);
    for (let i = 1; i + 1 < polygon.length / 2; i++) geo.faces.push({ i: reverse ? [base, base + i + 1, base + i] : [base, base + i, base + i + 1], color, emissive: 0 });
  };
  const create = (node, releaseGeometry = null, groundAt = null) => {
    const original = node.geometry, bounds = boundsOf(original), inverse = mat4.create(), point = new Float64Array(3);
    const minX = bounds.min[0], minY = bounds.min[1], maxX = bounds.max[0], maxY = bounds.max[1], plane = bounds.min[2];
    const panels = [[minX, minY, maxX, minY, maxX, maxY, minX, maxY]];
    const pieces = [], seams = [], debris = [], repairCaches = [], crackStates = new Array(CRACK_STEPS + 1), random = mulberry32(0x4d495252);
    const order = new Uint32Array(PANEL_LIMIT), keys = new Float64Array(PANEL_LIMIT);
    const hitSort = sortScratch(PANEL_LIMIT);
    let repairCache = null, repairClock = 0, panelHealTime = 0;
    const edgeNode = createNode({ visible: false, sightHidden: true, matrixExterior: true });
    Object.assign(edgeNode.position, node.position);
    addChild(node.parent, edgeNode);
    for (let i = 0; i < DEBRIS_LIMIT; i++) {
      const part = createNode({ visible: false, sightHidden: true, matrixExterior: true, mirrorShard: node, smokeOpacity: 1 });
      addChild(node.parent, part);
      debris.push({ node: part, life: 0, landed: false, vx: 0, vy: 0, vz: 0, spinX: 0, spinY: 0, spinZ: 0 });
    }
    let root = node;
    while (root.parent) root = root.parent;
    BL.scene.updateWorld(root);
    mat4.invert(inverse, node.world);
    let quiet = 0, selected = null, paneSize = original.verts.length, bevelSize = 0;
    let healCrackDamage = 0;
    const panelHealth = new Float64Array(PANEL_LIMIT).fill(PANEL_HEALTH);
    const state = { damage: 0, crackDamage: 0, panelHealth, stage: 0, version: 0, broken: false, active: 0, healing: 0, cracks: 0, holes: 0, seams: 0, hit, contains, aimCenter, update, restore, liveGeometry, dispose };
    function cut(nx, ny, offset, limit) {
      for (let i = panels.length - 1; i >= 0 && panels.length < limit; i--) {
        const polygon = panels[i], a = clip(polygon, nx, ny, offset), b = clip(polygon, -nx, -ny, -offset);
        if (a.length < 6 || b.length < 6 || areaOf(a) < 0.003 || areaOf(b) < 0.003) continue;
        panels[i] = a; panels.push(b);
      }
    }
    function fracture(x, y, stage) {
      const count = stage === 1 ? 5 : 3, phase = random() * Math.PI, limit = stage === 1 ? 6 : stage === 2 ? 10 : 14;
      for (let i = 0; i < count; i++) {
        const angle = phase + i * Math.PI / count + (random() - 0.5) * 0.18, nx = Math.cos(angle), ny = Math.sin(angle);
        cut(nx, ny, nx * x + ny * y + (random() - 0.5) * 0.055, limit);
      }
      const radius = stage === 1 ? 0.18 : stage === 2 ? 0.65 : 1.1;
      for (let i = 0; i < 5; i++) {
        const angle = phase + i * Math.PI * 2 / 5, nx = Math.cos(angle), ny = Math.sin(angle);
        cut(nx, ny, nx * x + ny * y + radius * (0.8 + random() * 0.4), limit);
      }
    }
    function buildLayout(x, y) {
      const width = maxX - minX, height = maxY - minY;
      const centers = [[x, y], [minX + width * (0.2 + random() * 0.2), minY + height * (0.2 + random() * 0.25)], [minX + width * (0.6 + random() * 0.2), minY + height * (0.5 + random() * 0.25)]];
      for (let stage = 1; stage < 4; stage++) fracture(centers[stage - 1][0], centers[stage - 1][1], stage);
      // Split the largest remaining pane so distributed impacts never leave
      // a single oversized border slab beside a cluster of tiny fragments.
      while (panels.length < PANEL_LIMIT) {
        let largest = 0;
        for (let i = 1; i < panels.length; i++) if (areaOf(panels[i]) > areaOf(panels[largest])) largest = i;
        const polygon = panels[largest];
        let cx = 0, cy = 0, lowX = Infinity, highX = -Infinity, lowY = Infinity, highY = -Infinity;
        for (let i = 0; i < polygon.length; i += 2) { cx += polygon[i]; cy += polygon[i + 1]; lowX = Math.min(lowX, polygon[i]); highX = Math.max(highX, polygon[i]); lowY = Math.min(lowY, polygon[i + 1]); highY = Math.max(highY, polygon[i + 1]); }
        cx /= polygon.length / 2; cy /= polygon.length / 2;
        const angle = (highX - lowX > highY - lowY ? 0 : Math.PI / 2) + (random() - 0.5) * 1.1, nx = Math.cos(angle), ny = Math.sin(angle), offset = nx * cx + ny * cy;
        panels[largest] = clip(polygon, nx, ny, offset); panels.push(clip(polygon, -nx, -ny, -offset));
      }
      for (let p = 0; p < panels.length; p++) {
        const polygon = panels[p], count = polygon.length / 2;
        let cx = 0, cy = 0;
        for (let i = 0; i < polygon.length; i += 2) { cx += polygon[i]; cy += polygon[i + 1]; }
        cx /= count; cy /= count;
        const paneFaces = [], bevelFaces = [], chip = geometry(), local = [];
        let insetLimit = Infinity;
        for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
          const dx = polygon[i] - polygon[j], dy = polygon[i + 1] - polygon[j + 1];
          insetLimit = Math.min(insetLimit, (dx * (cy - polygon[j + 1]) - dy * (cx - polygon[j])) / Math.hypot(dx, dy) * 0.2);
          local.push(polygon[i] - cx, polygon[i + 1] - cy);
        }
        appendFace(chip, local, 0, GLASS); appendFace(chip, local, -0.004, EDGE, true);
        chip.mirrorSource = new Float32Array(chip.verts.length);
        for (let i = 0; i < chip.verts.length; i += 3) {
          chip.mirrorSource[i] = chip.verts[i] + cx;
          chip.mirrorSource[i + 1] = chip.verts[i + 1] + cy;
          chip.mirrorSource[i + 2] = plane;
        }
        const base = paneSize / 3;
        for (let i = 1; i + 1 < count; i++) paneFaces.push({ i: [base, base + i, base + i + 1], color: GLASS, emissive: 0 });
        for (let i = 0; i < count; i++) {
          const j = (i + count - 1) % count, b = bevelSize / 3 + i * 4;
          bevelFaces.push({ i: [b, b + 1, b + 2, b + 3], color: EDGE, emissive: 0 });
        }
        const area = areaOf(polygon);
        pieces.push({ polygon, x: cx, y: cy, area, insetLimit, paneOffset: paneSize, bevelOffset: bevelSize, paneFaces, bevelFaces, chip, edges: [] });
        boundsOf(chip);
        paneSize += count * 3; bevelSize += count * 12;
      }
      const shared = new Map();
      for (const piece of pieces) {
        const polygon = piece.polygon;
        for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
          const ax = polygon[j], ay = polygon[j + 1], bx = polygon[i], by = polygon[i + 1];
          const outer = Math.abs(ax - bx) < 1e-8 && (Math.abs(ax - minX) < 1e-8 || Math.abs(ax - maxX) < 1e-8)
            || Math.abs(ay - by) < 1e-8 && (Math.abs(ay - minY) < 1e-8 || Math.abs(ay - maxY) < 1e-8);
          if (outer) { piece.edges.push(null); continue; }
          const a = `${Math.round(ax * 1e7)},${Math.round(ay * 1e7)}`, b = `${Math.round(bx * 1e7)},${Math.round(by * 1e7)}`;
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          let seam = shared.get(key);
          if (!seam) {
            const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
            seam = { id: seams.length, activation: 0, ax, ay, bx, by, score: (ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2 + ((ax + bx) * 0.5 - x) ** 2 * 0.02 + ((ay + by) * 0.5 - y) ** 2 * 0.02 };
            shared.set(key, seam); seams.push(seam);
          }
          piece.edges.push(seam);
        }
      }
      const seamOrder = new Uint32Array(seams.length), seamKeys = new Float64Array(seams.length);
      for (let i = 0; i < seams.length; i++) { seamOrder[i] = i; seamKeys[i] = seams[i].score; }
      sortByKey(seamOrder, 0, seams.length, seamKeys, 1, 0, sortScratch(seams.length));
      for (let i = 0; i < seams.length; i++) seams[seamOrder[i]].activation = i * (PANEL_DAMAGE - DAMAGE_STEP) / Math.max(1, seams.length - 1);
      const crackCenters = [centers[0], [minX + width * 0.25, minY + height * 0.25], [minX + width * 0.75, minY + height * 0.25],
        [minX + width * 0.25, minY + height * 0.75], [minX + width * 0.75, minY + height * 0.75]];
      for (const center of crackCenters) {
        for (let seed = 0; seed < 9; seed++) {
          let closest = null, best = Infinity;
          for (const seam of seams) {
            if (seam.activation === 0) continue;
            const dx = seam.bx - seam.ax, dy = seam.by - seam.ay;
            const t = Math.max(0, Math.min(1, ((center[0] - seam.ax) * dx + (center[1] - seam.ay) * dy) / (dx * dx + dy * dy)));
            const score = (seam.ax + dx * t - center[0]) ** 2 + (seam.ay + dy * t - center[1]) ** 2;
            if (score < best) { best = score; closest = seam; }
          }
          if (closest) closest.activation = 0;
        }
      }
    }
    function repairShape(template, growth, health) {
      let complete = true;
      for (let p = 0; p < growth.length; p++) if (growth[p] < 1) { complete = false; break; }
      // Weakened, unbroken panes regain health without changing their mesh.
      if (complete) return { ...template, growth, health };
      const pane = geometry(new Float32Array(template.pane.verts)), bevel = geometry(new Float32Array(template.bevel.verts));
      const ranges = new Uint32Array(pieces.length * 2), opening = new Float32Array(pieces.length);
      let absent = 0;
      for (let p = 0; p < pieces.length; p++) {
        const piece = pieces[p], scale = growth[p];
        ranges[p * 2] = ranges[p * 2 + 1] = pane.faces.length;
        opening[p] = 1 - scale;
        if (scale < 1) absent++;
        if (scale <= 0) continue;
        const end = piece.paneOffset + template.counts[p] * 3;
        for (let i = piece.paneOffset; i < end; i += 3) {
          pane.verts[i] = piece.x + (pane.verts[i] - piece.x) * scale;
          pane.verts[i + 1] = piece.y + (pane.verts[i + 1] - piece.y) * scale;
        }
        for (let f = template.ranges[p * 2]; f < template.ranges[p * 2 + 1]; f++) pane.faces.push(template.pane.faces[f]);
        ranges[p * 2 + 1] = pane.faces.length;
        for (let f = template.bevelRanges[p * 2]; f < template.bevelRanges[p * 2 + 1]; f++) {
          const face = template.bevel.faces[f];
          for (const vertex of face.i) {
            const i = vertex * 3;
            bevel.verts[i] = piece.x + (bevel.verts[i] - piece.x) * scale;
            bevel.verts[i + 1] = piece.y + (bevel.verts[i + 1] - piece.y) * scale;
          }
          bevel.faces.push(face);
        }
      }
      return { pane, bevel, counts: template.counts, opening, ranges, absent, cracks: template.cracks, seams: template.seams,
        growth, health, fractureDamage: template.fractureDamage, fractureLevel: template.fractureLevel, crackScale: template.crackScale };
    }
    function repairsFor(base, health, fractureDamage, fractureLevel, template) {
      for (const entry of repairCaches) if (sameField(entry.base, base) && sameField(entry.health, health)
        && sameField(entry.fractureDamage, fractureDamage) && sameField(entry.fractureLevel, fractureLevel)) {
        entry.stamp = ++repairClock; return entry;
      }
      let entry;
      if (repairCaches.length < REPAIR_CACHES) { entry = {}; repairCaches.push(entry); }
      else { entry = repairCaches[0]; for (const candidate of repairCaches) if (candidate.stamp < entry.stamp) entry = candidate; }
      entry.base = base; entry.health = health; entry.fractureDamage = fractureDamage; entry.fractureLevel = fractureLevel;
      entry.states = []; entry.stamp = ++repairClock;
      for (let step = 0; step <= REPAIR_STEPS; step++) {
        const growth = new Float64Array(pieces.length), restored = new Float64Array(pieces.length), progress = step / REPAIR_STEPS;
        for (let p = 0; p < pieces.length; p++) {
          restored[p] = step === REPAIR_STEPS ? PANEL_HEALTH : Math.min(PANEL_HEALTH, health[p] + panelHealTime * progress * PANEL_HEAL_RATE);
          // Health measures returned glass area, not its linear width. A hit
          // may weaken existing glass; it only falls when its health is gone.
          growth[p] = Math.max(base[p], Math.sqrt(restored[p] / PANEL_HEALTH));
        }
        const shape = repairShape(template, growth, restored);
        shape.repair = progress;
        entry.states.push(shape);
      }
      return entry;
    }
    function inset(piece, amount, damage) {
      const polygon = piece.polygon;
      let result = polygon;
      amount = Math.min(amount, piece.insetLimit);
      for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
        const ax = polygon[j], ay = polygon[j + 1], bx = polygon[i], by = polygon[i + 1];
        const seam = piece.edges[i / 2];
        if (!seam || damage <= seam.activation) continue;
        // A fresh seam starts as a visible hairline, then widens with damage.
        const width = amount * (0.6 + 0.4 * Math.min(1, (damage - seam.activation) / 8));
        const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy), nx = -dy / length, ny = dx / length;
        // Outer vertices remain on the cave border. Interior cracks widen
        // toward the impact, instead of shrinking the complete pane inwards.
        const a = Math.min(1, Math.min(ax - minX, maxX - ax, ay - minY, maxY - ay) / 0.8) * width;
        const b = Math.min(1, Math.min(bx - minX, maxX - bx, by - minY, maxY - by) / 0.8) * width;
        if (a <= 1e-10 && b <= 1e-10) continue;
        const x = ax + nx * a, y = ay + ny * a, ex = bx + nx * b - x, ey = by + ny * b - y;
        result = clip(result, -ey, ex, -ey * x + ex * y);
      }
      return result;
    }
    function buildShape(growth, fractureDamage, fractureLevel, crackScale) {
      const pane = geometry(new Float32Array(paneSize)), bevel = geometry(new Float32Array(crackScale ? bevelSize : 0));
      const counts = new Uint8Array(pieces.length), opening = new Float32Array(pieces.length), ranges = new Uint32Array(pieces.length * 2), bevelRanges = new Uint32Array(pieces.length * 2);
      pane.verts.set(original.verts);
      const visibleSeams = new Uint8Array(seams.length);
      let absent = 0, activeSeams = 0;
      for (let p = 0; p < pieces.length; p++) {
        const piece = pieces[p], scale = growth[p], damage = fractureDamage[p], cracks = fractureLevel[p] * crackScale;
        ranges[p * 2] = ranges[p * 2 + 1] = pane.faces.length;
        bevelRanges[p * 2] = bevelRanges[p * 2 + 1] = bevel.faces.length;
        opening[p] = 1 - scale;
        if (scale < 1) absent++;
        if (scale <= 0) continue;
        const polygon = cracks ? inset(piece, (0.0045 + damage * 0.00009) * cracks, damage) : piece.polygon;
        const count = polygon.length / 2, base = piece.paneOffset;
        counts[p] = count;
        // Every convex pane grows about its own fixed center. At full size
        // it meets its original cracked border, which closes only afterward.
        for (let i = 0; i < count; i++) {
          pane.verts[base + i * 3] = piece.x + (polygon[i * 2] - piece.x) * scale;
          pane.verts[base + i * 3 + 1] = piece.y + (polygon[i * 2 + 1] - piece.y) * scale;
          pane.verts[base + i * 3 + 2] = plane;
        }
        for (let i = 0; i < count - 2; i++) pane.faces.push(piece.paneFaces[i]);
        ranges[p * 2 + 1] = pane.faces.length;
        if (!cracks) continue;
        for (let i = 0, j = count - 1; i < count; j = i++) {
          const ax = polygon[j * 2], ay = polygon[j * 2 + 1], bx = polygon[i * 2], by = polygon[i * 2 + 1];
          let closest = -1, distance = Infinity;
          for (let k = 0, last = piece.polygon.length - 2; k < piece.polygon.length; last = k, k += 2) {
            const dx = piece.polygon[k] - piece.polygon[last], dy = piece.polygon[k + 1] - piece.polygon[last + 1];
            const d = Math.abs(dx * ((ay + by) * 0.5 - piece.polygon[last + 1]) - dy * ((ax + bx) * 0.5 - piece.polygon[last])) / Math.hypot(dx, dy);
            if (d < distance) { distance = d; closest = k / 2; }
          }
          const seam = piece.edges[closest];
          if (!seam || damage <= seam.activation) continue;
          if (!visibleSeams[seam.id]) { visibleSeams[seam.id] = 1; activeSeams++; }
          const extent = 0.6 + 0.4 * Math.min(1, (damage - seam.activation) / 8);
          const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy), width = Math.min(0.0025 * cracks * extent, length * 0.1);
          const nx = -dy / length * width, ny = dx / length * width, at = piece.bevelOffset + i * 12, verts = bevel.verts;
          const edgeA = Math.min(1, Math.min(ax - minX, maxX - ax, ay - minY, maxY - ay) / 0.8);
          const edgeB = Math.min(1, Math.min(bx - minX, maxX - bx, by - minY, maxY - by) / 0.8);
          verts[at] = piece.x + (ax - piece.x) * scale; verts[at + 1] = piece.y + (ay - piece.y) * scale; verts[at + 2] = plane + 0.0015;
          verts[at + 3] = piece.x + (bx - piece.x) * scale; verts[at + 4] = piece.y + (by - piece.y) * scale; verts[at + 5] = plane + 0.0015;
          verts[at + 6] = piece.x + (bx + nx * edgeB - piece.x) * scale; verts[at + 7] = piece.y + (by + ny * edgeB - piece.y) * scale; verts[at + 8] = plane + 0.0015;
          verts[at + 9] = piece.x + (ax + nx * edgeA - piece.x) * scale; verts[at + 10] = piece.y + (ay + ny * edgeA - piece.y) * scale; verts[at + 11] = plane + 0.0015;
          bevel.faces.push(piece.bevelFaces[i]);
        }
        bevelRanges[p * 2 + 1] = bevel.faces.length;
      }
      return { pane, bevel, counts, opening, ranges, bevelRanges, absent, cracks: crackScale, seams: activeSeams, growth, fractureDamage, fractureLevel, crackScale };
    }
    function selectShape(shape) {
      if (shape) panelHealth.set(shape.health); else panelHealth.fill(PANEL_HEALTH);
      state.damage = state.crackDamage;
      for (let p = 0; p < panelHealth.length; p++) state.damage += PANEL_HEALTH - panelHealth[p];
      state.stage = state.damage > 0 ? Math.max(1, Math.min(state.broken ? STATE_LIMIT : STATE_LIMIT - 1, Math.ceil(state.damage / DAMAGE_STEP - 1e-9))) : 0;
      state.cracks = shape ? shape.cracks : 0; state.holes = shape ? Math.ceil(shape.absent) : 0; state.seams = shape ? shape.seams : 0;
      if (selected === shape) return;
      const pane = shape ? shape.pane : original, bevel = shape ? shape.bevel : null;
      selected = shape;
      if (node.geometry === pane && edgeNode.geometry === bevel) return;
      if (releaseGeometry) {
        if (node.geometry !== original && node.geometry !== pane) releaseGeometry(node.geometry);
        if (edgeNode.geometry && edgeNode.geometry !== bevel) releaseGeometry(edgeNode.geometry);
      }
      node.geometry = pane;
      edgeNode.geometry = bevel;
      state.version++;
      edgeNode.visible = !!shape && !!shape.cracks && !state.broken && !node.mirrorPortal && !node.mirrorReveal;
    }
    function drop(piece, index) {
      const shard = debris[index], part = shard.node;
      let chip = piece.chip;
      if (selected) {
        chip = geometry();
        const source = selected.pane;
        for (let f = selected.ranges[index * 2]; f < selected.ranges[index * 2 + 1]; f++) {
          const polygon = [];
          for (const i of source.faces[f].i) polygon.push(source.verts[i * 3] - piece.x, source.verts[i * 3 + 1] - piece.y);
          appendFace(chip, polygon, 0, GLASS); appendFace(chip, polygon, -0.004, EDGE, true);
        }
        chip.mirrorSource = new Float32Array(chip.verts.length);
        for (let i = 0; i < chip.verts.length; i += 3) {
          chip.mirrorSource[i] = chip.verts[i] + piece.x; chip.mirrorSource[i + 1] = chip.verts[i + 1] + piece.y; chip.mirrorSource[i + 2] = plane;
        }
      }
      boundsOf(chip);
      if (releaseGeometry && part.geometry && part.geometry !== chip) releaseGeometry(part.geometry);
      part.geometry = chip;
      part.position.x = node.position.x + piece.x; part.position.y = node.position.y + piece.y; part.position.z = node.position.z + plane + 0.012;
      part.rotation.x = part.rotation.y = part.rotation.z = 0;
      part.scale.x = part.scale.y = part.scale.z = 1;
      part.visible = true; part.smokeOpacity = 1;
      if (!shard.life) state.active++;
      shard.life = DEBRIS_LIFE; shard.landed = false;
      shard.vx = (random() - 0.5) * 0.6; shard.vy = 0.1 + random() * 0.25; shard.vz = 0.25 + random() * 0.45;
      shard.spinX = (random() - 0.5) * 3; shard.spinY = (random() - 0.5) * 3; shard.spinZ = (random() - 0.5) * 2;
    }
    function sameField(a, b) {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }
    function paneDistance(index, x, y) {
      const piece = pieces[index];
      let nearest = Infinity;
      const faceDistance = (verts, ids, stride) => {
        let inside = true, distance = Infinity;
        for (let i = 0, j = ids.length - 1; i < ids.length; j = i++) {
          const a = ids[j] * stride, b = ids[i] * stride, ax = verts[a], ay = verts[a + 1], dx = verts[b] - ax, dy = verts[b + 1] - ay;
          if (dx * (y - ay) - dy * (x - ax) < 0) inside = false;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
          distance = Math.min(distance, (ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2);
        }
        return inside ? 0 : distance;
      };
      if (selected) {
        for (let f = selected.ranges[index * 2]; f < selected.ranges[index * 2 + 1]; f++) nearest = Math.min(nearest, faceDistance(selected.pane.verts, selected.pane.faces[f].i, 3));
      } else {
        const ids = [];
        for (let i = 0; i < piece.polygon.length / 2; i++) ids.push(i);
        nearest = faceDistance(piece.polygon, ids, 2);
      }
      return nearest + ((piece.x - x) ** 2 + (piece.y - y) ** 2) * 1e-8;
    }
    function hit(power, x, y, z) {
      if (state.broken || !(power > 0)) return false;
      mat4.transformPoint(point, inverse, x, y, z);
      const cx = Math.max(minX + 0.12, Math.min(maxX - 0.12, point[0]));
      const cy = Math.max(minY + 0.12, Math.min(maxY - 0.12, point[1]));
      if (!pieces.length) buildLayout(cx, cy);
      const preserved = selected && (selected.repair !== undefined || selected.preserve || state.healing > 0);
      const growth = new Float64Array(pieces.length), health = new Float64Array(panelHealth);
      const fractureDamage = new Float64Array(pieces.length), fractureLevel = new Float64Array(pieces.length);
      if (selected && selected.growth) growth.set(selected.growth); else growth.fill(1);
      const crackHit = Math.min(power, PANEL_DAMAGE - state.crackDamage);
      state.crackDamage += crackHit;
      let remaining = power - crackHit;
      if (preserved) {
        fractureDamage.set(selected.fractureDamage);
        for (let p = 0; p < pieces.length; p++) fractureLevel[p] = selected.fractureLevel[p] * selected.crackScale;
      } else { fractureDamage.fill(state.crackDamage); fractureLevel.fill(1); }
      for (let p = 0; p < pieces.length; p++) { order[p] = p; keys[p] = paneDistance(p, point[0], point[1]); }
      sortByKey(order, 0, pieces.length, keys, 1, 0, hitSort);
      if (preserved && Number.isFinite(keys[order[0]])) {
        // Other panels retain their exact repair and crack contours. Further
        // force is absorbed by the nearest remaining glass, one HP per pane.
        fractureDamage[order[0]] = Math.max(fractureDamage[order[0]], state.crackDamage); fractureLevel[order[0]] = 1;
      }
      for (let i = 0; i < pieces.length && remaining > 0 && Number.isFinite(keys[order[i]]); i++) {
        const p = order[i], absorbed = Math.min(health[p], remaining);
        health[p] -= absorbed; remaining -= absorbed;
        if (!health[p]) { drop(pieces[p], p); growth[p] = 0; }
        fractureDamage[p] = Math.max(fractureDamage[p], state.crackDamage); fractureLevel[p] = 1;
      }
      let damaged = false;
      state.broken = true;
      panelHealTime = 0;
      for (let p = 0; p < health.length; p++) {
        if (health[p] > 0) state.broken = false;
        if (health[p] < PANEL_HEALTH) damaged = true;
        panelHealTime = Math.max(panelHealTime, (PANEL_HEALTH - health[p]) / PANEL_HEAL_RATE);
      }
      quiet = 0; state.healing = 0; healCrackDamage = state.crackDamage;
      if (state.broken) {
        const shape = buildShape(growth, fractureDamage, fractureLevel, 0);
        shape.health = health;
        selectShape(shape);
        repairCache = null;
        return true;
      }
      const full = new Float64Array(pieces.length).fill(1);
      for (let step = 0; step <= CRACK_STEPS; step++) {
        const shape = buildShape(full, fractureDamage, fractureLevel, 1 - step / CRACK_STEPS);
        shape.health = full;
        shape.preserve = !!preserved;
        crackStates[step] = shape;
      }
      repairCache = damaged ? repairsFor(growth, health, fractureDamage, fractureLevel, crackStates[0]) : null;
      selectShape(repairCache ? repairCache.states[0] : crackStates[0]);
      return true;
    }
    function contains(x, y) {
      if (state.broken || x < minX || x > maxX || y < minY || y > maxY) return false;
      if (!selected) return true;
      const geo = selected.pane, verts = geo.verts;
      for (let p = 0; p < pieces.length; p++) {
        const piece = pieces[p], bounds = boundsOf(piece.chip);
        if (x < piece.x + bounds.min[0] - 1e-8 || x > piece.x + bounds.max[0] + 1e-8 || y < piece.y + bounds.min[1] - 1e-8 || y > piece.y + bounds.max[1] + 1e-8) continue;
        for (let f = selected.ranges[p * 2]; f < selected.ranges[p * 2 + 1]; f++) {
          const face = geo.faces[f]; let inside = true;
          for (let i = 0, j = face.i.length - 1; i < face.i.length; j = i++) {
            const a = face.i[j] * 3, b = face.i[i] * 3;
            if ((verts[b] - verts[a]) * (y - verts[a + 1]) - (verts[b + 1] - verts[a + 1]) * (x - verts[a]) < -1e-8) { inside = false; break; }
          }
          if (inside) return true;
        }
      }
      return false;
    }
    function aimCenter(out, x, y, z) {
      if (state.broken) return false;
      mat4.transformPoint(point, inverse, x, y, z);
      let cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5;
      if (state.holes && selected && pieces.length) {
        let nearest = Infinity, index = -1;
        for (let p = 0; p < pieces.length; p++) {
          const distance = paneDistance(p, point[0], point[1]);
          if (distance < nearest) { nearest = distance; index = p; }
        }
        if (index < 0 || !Number.isFinite(nearest)) return false;
        cx = pieces[index].x; cy = pieces[index].y;
      }
      mat4.transformPoint(point, node.world, cx, cy, plane);
      out.x = point[0]; out.y = point[1]; out.z = point[2];
      return true;
    }
    function update(dt) {
      if (state.damage > 0 && !state.broken) {
        quiet += dt;
        if (quiet > HEAL_DELAY) {
          const elapsed = quiet - HEAL_DELAY;
          if (elapsed < panelHealTime) {
            state.healing = 1;
            const progress = elapsed / panelHealTime;
            selectShape(repairCache.states[Math.min(REPAIR_STEPS, Math.floor(progress * REPAIR_STEPS))]);
          } else {
            state.healing = 2;
            const progress = Math.min(1, (elapsed - panelHealTime) / CRACK_HEAL_TIME);
            state.crackDamage = healCrackDamage * (1 - progress);
            if (progress === 1) { state.healing = 0; selectShape(null); }
            else selectShape(crackStates[Math.min(CRACK_STEPS, Math.floor(progress * CRACK_STEPS))]);
          }
        }
      }
      edgeNode.visible = !!selected && !!selected.cracks && !state.broken && !node.mirrorPortal && !node.mirrorReveal;
      if (!state.active) return;
      for (let i = 0; i < debris.length; i++) {
        const shard = debris[i];
        if (!shard.life) continue;
        const part = shard.node;
        let resting = shard.landed ? dt : 0;
        if (!shard.landed) {
          const parent = node.parent.world;
          BL.scene.updateWorld(part, parent);
          const w = part.world, bounds = boundsOf(part.geometry), low = bounds.min, high = bounds.max;
          // A spinning panel lands when its projected lower bound reaches
          // support, rather than burying half its face below its centre.
          const bottom = w[13] + Math.min(w[1] * low[0], w[1] * high[0]) + Math.min(w[5] * low[1], w[5] * high[1]) + Math.min(w[9] * low[2], w[9] * high[2]);
          const floor = groundAt ? groundAt(w[12], w[14], w[13]) : parent[13] + (node.position.y + minY) * parent[5];
          const height = Math.max(0, (bottom - floor - 0.006) / parent[5]);
          const landAt = (shard.vy + Math.sqrt(shard.vy * shard.vy + 14 * height)) / 7;
          const falling = Math.min(dt, landAt);
          part.position.x += shard.vx * falling; part.position.z += shard.vz * falling;
          part.position.y += shard.vy * falling - 3.5 * falling * falling;
          shard.vy -= falling * 7;
          part.rotation.x += shard.spinX * falling; part.rotation.y += shard.spinY * falling; part.rotation.z += shard.spinZ * falling;
          if (dt >= landAt) {
            part.rotation.x = -Math.PI / 2; part.rotation.z = 0;
            BL.scene.updateWorld(part, parent);
            let lift = -Infinity;
            const verts = part.geometry.verts;
            for (let v = 0; v < verts.length; v += 3) {
              mat4.transformPoint(point, part.world, verts[v], verts[v + 1], verts[v + 2]);
              const support = groundAt ? groundAt(point[0], point[2], point[1]) : floor;
              lift = Math.max(lift, support + 0.006 - point[1]);
            }
            part.position.y += lift / parent[5];
            shard.landed = true; resting = dt - landAt;
          }
        }
        if (resting > 0) {
          shard.life = Math.max(0, shard.life - resting);
          part.smokeOpacity = Math.min(1, shard.life / 0.7);
          if (!shard.life) { part.visible = false; state.active--; }
        }
      }
    }
    function restore() {
      state.crackDamage = PANEL_DAMAGE; state.broken = true; state.healing = 0; state.active = 0;
      panelHealth.fill(0);
      for (const shard of debris) { shard.life = 0; shard.node.visible = false; }
      selectShape({ pane: geometry(original.verts), bevel: geometry(), counts: new Uint8Array(0), opening: new Float32Array(0), health: panelHealth, absent: PANEL_LIMIT, cracks: 0, seams: 0 });
    }
    function liveGeometry(set) {
      set.add(original); set.add(node.geometry);
      if (edgeNode.geometry) set.add(edgeNode.geometry);
      for (const shard of debris) if (shard.node.geometry) set.add(shard.node.geometry);
    }
    function dispose() {
      if (releaseGeometry) {
        if (node.geometry !== original) releaseGeometry(node.geometry);
        if (edgeNode.geometry) releaseGeometry(edgeNode.geometry);
        for (const shard of debris) if (shard.node.geometry) releaseGeometry(shard.node.geometry);
      }
      removeChild(edgeNode.parent, edgeNode);
      for (const shard of debris) removeChild(shard.node.parent, shard.node);
      state.active = 0;
      node.geometry = original; node.mirrorDamage = null;
      panels.length = pieces.length = seams.length = debris.length = repairCaches.length = crackStates.length = 0;
      repairCache = null;
      node.mirrorCaptureGeometry = null;
      selected = null;
    }
    node.mirrorCaptureGeometry = original;
    node.mirrorDamage = state;
    return state;
  };
  BL.mirrorDamage = { create, MAX_DAMAGE, DAMAGE_STEP, STATE_LIMIT, PANEL_DAMAGE, PANEL_HEALTH, PANEL_HEAL_RATE, PANEL_LIMIT, DEBRIS_LIMIT, HEAL_DELAY, HEAL_RATE, CRACK_HEAL_TIME, REPAIR_STEPS, REPAIR_CACHES };
})();
