(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, hubModels } = BL;
  const { randomInt, mat4, ease } = BL.math;
  const { createNode, addChild, removeChild, updateWorld, traverseVisible } = BL.scene;
  const MAX_PROPS = 26;
  const TYPES = {
    crate: { health: 1, weights: [60, 24, 9, 4, 2, 1], debris: [models.particleGeometry("#805432", 0.07, 0)] },
    barrel: { health: 2.25, weights: [45, 28, 14, 7, 4, 2], debris: [models.particleGeometry("#67462d", 0.07, 0)] },
    rock: { health: 4.25, weights: [30, 30, 20, 11, 6, 3], debris: [models.particleGeometry("#88847a", 0.07, 0)] }
  };
  const REWARDS = [
    null,
    { kind: "banana", amount: 10, label: "+10", scale: 0.75 },
    { kind: "banana", amount: 20, label: "+20", scale: 0.75 },
    { kind: "banana", amount: 30, label: "+30", scale: 0.75 },
    { kind: "magazine", amount: 30, label: "", scale: 2.4 },
    { kind: "jetpack", amount: 1, label: "", scale: 1.2 }
  ];
  const magazineGeometries = new Array(31);
  const magazineGeometry = (rounds = 30) => {
    const ammo = Math.max(0, Math.min(30, Math.floor(rounds)));
    if (magazineGeometries[ammo]) return magazineGeometries[ammo];
    // Bake each ammunition state into a shared mesh on first use instead of
    // keeping indicator children animated on every ground pickup.
    const model = models.spareMagazine(), parts = [], point = new Float32Array(3);
    model.setAmmo(ammo);
    updateWorld(model.node);
    traverseVisible(model.node, (node) => {
      if (!node.geometry) return;
      const source = node.geometry, verts = [];
      for (let i = 0; i < source.verts.length; i += 3) {
        mat4.transformPoint(point, node.world, source.verts[i], source.verts[i + 1], source.verts[i + 2]);
        verts.push(point[0], point[1], point[2]);
      }
      parts.push({ verts, faces: source.faces, lines: source.lines });
    });
    magazineGeometries[ammo] = models.merge(...parts);
    return magazineGeometries[ammo];
  };
  const create = (ctx) => {
    const { root, renderer, fx, crew } = ctx;
    const records = [];
    const rewardGeometry = { banana: models.bananaGeometry(), magazine: magazineGeometry(), jetpack: hubModels.jetpack() };
    const screen = { x: 0, y: 0, depth: 0 };
    let time = 0, brokenCount = 0, rewardCount = 0, revealingCount = 0;
    const register = (owner) => {
      if (owner.kind !== "prop" || !Object.hasOwn(TYPES, owner.prop)) return null;
      if (owner.breakable) return owner.breakable;
      if (records.length >= MAX_PROPS) throw new Error("Outdoor breakable capacity exceeded");
      const type = TYPES[owner.prop];
      const node = createNode({ visible: false, sightHidden: true });
      addChild(root, node);
      const scale = owner.node.scale;
      const record = { owner, type, health: type.health, maxHealth: type.health, broken: false, respawnAt: 0, reward: null, rewardAmount: 0, node, hoverY: 0, phase: records.length * 2.4,
        reveal: 0, revealY: owner.node.position.y, scaleX: scale.x, scaleY: scale.y, scaleZ: scale.z };
      records.push(record);
      owner.breakable = record;
      return record;
    };
    const hideReward = (record) => {
      if (!record.reward) return;
      record.reward = null;
      record.rewardAmount = 0;
      record.node.visible = false;
      if (ctx.untrackMirrorObject) ctx.untrackMirrorObject(record.node);
      rewardCount--;
    };
    const dropReward = (record) => {
      const weights = record.type.weights;
      let roll = randomInt(100), reward = null;
      for (let i = 0; i < weights.length; i++) {
        if (roll < weights[i]) { reward = REWARDS[i]; break; }
        roll -= weights[i];
      }
      if (!reward) return;
      const node = record.node, origin = record.owner.node.position;
      record.reward = reward;
      record.rewardAmount = reward.amount;
      record.hoverY = origin.y + 0.48;
      node.geometry = rewardGeometry[reward.kind];
      node.position.x = origin.x;
      node.position.y = record.hoverY;
      node.position.z = origin.z;
      node.rotation.x = node.rotation.z = 0;
      node.rotation.y = record.phase;
      node.scale.x = node.scale.y = node.scale.z = reward.scale;
      node.visible = true;
      if (ctx.trackMirrorObject) ctx.trackMirrorObject(node, 2);
      rewardCount++;
    };
    const hit = (source, contact, power = 1) => {
      const owner = contact && contact.owner, record = owner && owner.breakable;
      if (!record || record.broken || !owner.active || !owner.node.visible || !(power > 0)) return false;
      record.health = Math.max(0, record.health - power);
      fx.burst(contact.x, contact.y, contact.z, record.health ? 2 : 7, record.type.debris, record.health ? 0.8 : 1.5);
      if (record.health) return true;
      if (record.reveal) { record.reveal = 0; revealingCount--; }
      record.broken = true;
      record.respawnAt = time + 30 + randomInt(31);
      brokenCount++;
      dropReward(record);
      ctx.deactivate(owner);
      return true;
    };
    const update = (dt, elapsed) => {
      time = elapsed;
      const cave = crew.player, playerPosition = cave && cave.root.position;
      const feet = cave ? playerPosition.y - cave.baseY : 0;
      const reach = cave ? cave.bodyRadius + 0.35 : 0;
      const cap = cave ? Math.min(cave.bodyRadius, cave.bodyHeight / 2) : 0;
      const bottom = feet + cap, top = cave ? feet + cave.bodyHeight - cap : 0;
      for (const record of records) {
        if (record.reveal) {
          record.reveal = Math.min(1, record.reveal + dt / 0.65);
          const node = record.owner.node;
          if (record.owner.prop === "rock") {
            const k = ease.outQuad(record.reveal), lift = 0.05 + 0.95 * k;
            node.scale.x = record.scaleX * (0.7 + 0.3 * k);
            node.scale.y = record.scaleY * lift;
            node.scale.z = record.scaleZ * (0.7 + 0.3 * k);
            node.position.y = record.revealY - BL.scene.boundsOf(node.geometry).max[1] * record.scaleY * 0.05 * (1 - k);
          } else {
            const k = Math.max(0.01, ease.outBack(record.reveal));
            node.scale.x = record.scaleX * k;
            node.scale.y = record.scaleY * k;
            node.scale.z = record.scaleZ * k;
          }
          if (record.reveal === 1) {
            record.reveal = 0;
            node.position.y = record.revealY;
            node.scale.x = record.scaleX; node.scale.y = record.scaleY; node.scale.z = record.scaleZ;
            revealingCount--;
          }
        }
        if (!record.broken) continue;
        if (elapsed >= record.respawnAt) {
          // Expire the old drop even if all safe respawn spots are occupied.
          // Relocation reactivates the existing prop and its existing collider.
          hideReward(record);
          record.broken = false;
          if (ctx.relocate(record.owner)) {
            record.health = record.maxHealth;
            record.respawnAt = 0;
            record.reveal = 1e-7;
            record.revealY = record.owner.node.position.y;
            revealingCount++;
            if (record.owner.prop === "rock") {
              record.owner.node.scale.x = record.scaleX * 0.7;
              record.owner.node.scale.y = record.scaleY * 0.05;
              record.owner.node.scale.z = record.scaleZ * 0.7;
              record.owner.node.position.y = record.revealY - BL.scene.boundsOf(record.owner.node.geometry).max[1] * record.owner.node.scale.y;
            } else record.owner.node.scale.x = record.owner.node.scale.y = record.owner.node.scale.z = 0.01;
            brokenCount--;
          } else {
            record.broken = true;
            record.respawnAt = elapsed + 1;
          }
          continue;
        }
        if (!record.reward) continue;
        const node = record.node, p = node.position;
        p.y = record.hoverY + Math.sin(elapsed * 2.1 + record.phase) * 0.08;
        node.rotation.y += dt * 0.7;
        if (!cave) continue;
        const dx = playerPosition.x - p.x, dz = playerPosition.z - p.z;
        const dy = Math.max(bottom - p.y, p.y - top, 0);
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
        if (record.reward.kind === "magazine") {
          const before = record.rewardAmount;
          const remaining = crew.collectGroundMagazine(before, cave);
          if (remaining === before) continue;
          record.rewardAmount = remaining;
          if (ctx.onAmmoPickup) ctx.onAmmoPickup(before - remaining, remaining);
          if (!remaining) hideReward(record);
          else node.geometry = magazineGeometry(remaining);
        } else if (ctx.collectReward(record.reward.kind, record.reward.amount, cave)) hideReward(record);
      }
    };
    const drawOverlay = (overlay) => {
      if (!rewardCount) return;
      const size = renderer.size;
      overlay.save();
      overlay.font = "bold 13px ui-monospace, monospace";
      overlay.textAlign = "center";
      overlay.textBaseline = "bottom";
      overlay.fillStyle = "#ffe291";
      overlay.shadowColor = "#17130b";
      overlay.shadowBlur = 4;
      overlay.shadowOffsetY = 1;
      for (const record of records) {
        if (!record.reward || !record.reward.label) continue;
        const p = record.node.position;
        if (!renderer.project(p.x, p.y + 0.4, p.z, screen) || screen.x < -20 || screen.x > size.width + 20 || screen.y < -20 || screen.y > size.height + 20) continue;
        overlay.fillText(record.reward.label, screen.x, screen.y);
      }
      overlay.restore();
    };
    const liveGeometry = (set) => {
      set.add(rewardGeometry.banana);
      set.add(rewardGeometry.magazine);
      set.add(rewardGeometry.jetpack);
      for (const type of Object.values(TYPES)) for (const geometry of type.debris) set.add(geometry);
    };
    const dispose = () => {
      for (const record of records) {
        if (record.reward && ctx.untrackMirrorObject) ctx.untrackMirrorObject(record.node);
        removeChild(root, record.node);
        record.owner.breakable = null;
      }
      records.length = 0;
      brokenCount = rewardCount = revealingCount = 0;
    };
    const stats = () => ({ breakablesProps: records.length, breakablesBroken: brokenCount, breakablesRewards: rewardCount, breakablesRevealing: revealingCount });
    return { list: records, register, hit, update, drawOverlay, dispose, stats, liveGeometry, get inMotion() { return rewardCount > 0 || revealingCount > 0; } };
  };
  BL.breakables = { create, MAX_PROPS };
})();
