(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, contributors, donations, qr, game: gameMod, hud: hudMod, interact: interactMod, pilot: pilotMod, fx: fxMod, crew: crewMod, pile: pileMod, crates: cratesMod } = BL;
  const { clamp, lerp, ease, fnv1a, randomInt } = math;
  const { createNode, addChild, removeChild, createCamera, addTween, stepTweens, tweenCount, traverseVisible } = BL.scene;
  const { DROP_HEIGHT } = pileMod;
  const { CONFETTI } = fxMod;
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has("debug"), preloadedWeapon = DEBUG ? Number(params.get("weapon")) : 0;
  const preloadedAmmo = DEBUG ? params.get("ammo") : null;
  const preloadedEquipment = preloadedWeapon === 1 || preloadedWeapon === 2 || preloadedAmmo === "unlimited"
    || preloadedAmmo !== null && preloadedAmmo.trim() !== "" && Number.isFinite(Number(preloadedAmmo));
  const METER_CAPACITY = 60;
  const ROOM_HALF = 10;
  // Orbit, follow and flight limits
  const PITCH = [0.12, 1.1], DIST = [4.5, 9.2];
  const FOLLOW = { y: 0.9, min: 3, max: 7, pitch: [0.25, 0.8] };
  const FLY = { speed: 4, perDist: 0.4, climb: 3, yMax: 3.5 };
  const WALL = ROOM_HALF - 0.6;
  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  const yawParam = parseFloat(params.get("yaw"));
  const PRESETS = {
    pile: { yaw: Number.isFinite(yawParam) ? yawParam : -0.45, pitch: 0.3, dist: 9, target: { x: 0, y: 1.2, z: 0 } },
    racks: { yaw: 0.05, pitch: 0.22, dist: 7.5, target: { x: 0, y: 1.6, z: -6 } },
    bunks: { yaw: 1.9, pitch: 0.42, dist: 7, target: { x: -6.5, y: 0.6, z: -3.5 } },
    bench: { yaw: -1.5, pitch: 0.3, dist: 6, target: { x: 6.5, y: 1, z: 1.5 } }
  };
  const RENDER_OPTS = { shadowCenter: { x: 0, y: 1.5, z: 0 }, shadowExtent: 13.5 };
  // Where the crew builds equipment
  const BUILD_SPOTS = [
    { x: 5.4, z: -9.3, ry: 0 }, { x: 6.7, z: -9.3, ry: 0 }, { x: 8, z: -9.3, ry: 0 },
    { x: -5.1, z: -9.3, ry: 0 }, { x: -9.1, z: -9.3, ry: 0 },
    { x: 9.4, z: -6.6, ry: -Math.PI / 2 }, { x: 9.4, z: -1.3, ry: -Math.PI / 2 },
    { x: 9.4, z: 4.6, ry: -Math.PI / 2 }, { x: 9.4, z: 6.4, ry: -Math.PI / 2 },
    { x: -9.4, z: 5, ry: Math.PI / 2 }, { x: -9.4, z: 6.6, ry: Math.PI / 2 }, { x: -9.4, z: 8.2, ry: Math.PI / 2 }
  ];
  // Where eaters walk in from
  const WALK_IN = { x: 0.6, z: 7 };
  // Where the thank-you ticker hangs
  const TICKER_AT = { x: 0, y: 3.3, z: -ROOM_HALF + 0.3 };
  // Keep a dragged banana inside the room
  const clampDrag = (p) => {
    p.x = clamp(p.x, -ROOM_HALF + 0.5, ROOM_HALF - 0.5);
    p.z = clamp(p.z, -ROOM_HALF + 0.5, ROOM_HALF - 0.5);
    return p;
  };
  const mark = (name) => {
    performance.clearMarks(`ooga:${name}`);
    performance.mark(`ooga:${name}`);
  };
  const ledGrey = models.box({ w: 0.07, h: 0.05, d: 0.02, color: "#5a5a5e", emissive: 0.25 });
  const STATE_LED = { working: 0, chilling: 3, sleeping: 1 };

  // One visit's state, made in enter and dropped in leave
  let renderer, game, world, go, lootEnabled, testBananas, root, camera, lab, hud, hooks, input, pilot, fx, pile, crew, crates, pulseNodes;
  let stateTimer = 0, hintTimer = 0, meterTimer = 0, unsubscribeActivity = null;
  const propTargets = [];
  const addProp = (node, owner, opts) => {
    input.add(node, owner, opts);
    propTargets.push(node);
  };
  // A driven step stays inside the walls
  const walkable = (fromX, fromZ, toX, toZ) => Math.abs(toX) < WALL && Math.abs(toZ) < WALL && Math.hypot(toX, toZ) > pile.pileEdge() + 0.4;
  const clampTarget = (t) => {
    t.x = clamp(t.x, -WALL, WALL);
    t.z = clamp(t.z, -WALL, WALL);
  };
  const clampCamera = (p) => {
    p.x = clamp(p.x, -ROOM_HALF + 0.4, ROOM_HALF - 0.4);
    p.z = clamp(p.z, -ROOM_HALF + 0.4, ROOM_HALF - 0.4);
    p.y = clamp(p.y, 0.5, 4.3);
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

  // ---------- props ----------
  const rackInfo = (rack) => {
    if (rack.index === 0) {
      const counts = crew.stateCounts();
      return `Contributor rack · ${counts.working} working · ${counts.chilling} chilling · ${counts.sleeping} sleeping`;
    }
    return rack.index === 1 ? "Entropy rack · hashing quietly" : "Cold storage · do not touch";
  };
  const flaskStir = (flask) => {
    const geo = models.particleGeometry(flask.color, 0.05, 1);
    const p = flask.world;
    for (let i = 0; i < 7; i++) {
      fx.spawnParticle(geo, p[12] + (Math.random() - 0.5) * 0.12, p[13] + 0.55, p[14] + (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.3, 2.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.3, 0.9 + Math.random() * 0.5, 2);
    }
    flask.pulse = 1.2;
  };
  const rollDie = (die) => {
    if (die.rolling) return;
    die.rolling = true;
    const result = randomInt(6) + 1;
    const startY = die.position.y;
    const r0 = { ...die.rotation };
    const final = models.dieRotationFor(result, r0.y + 1.7);
    addTween({ dur: 0.7, ease: ease.linear, update: (k) => {
      die.position.y = startY + Math.sin(k * Math.PI) * 0.6;
      die.rotation.x = r0.x + k * Math.PI * 4;
      die.rotation.z = r0.z + k * Math.PI * 2;
      die.rotation.y = r0.y + k * 1.7;
    }, done: () => {
      Object.assign(die.rotation, final);
      die.position.y = startY;
      die.rolling = false;
      die.lastRoll = result;
      const w = die.world;
      fx.sayAt(w[12], w[13] + die.dieSize * 0.5 + 0.2, w[14], `Rolled ${result}`, 1.8);
    } });
  };
  const flipCard = (card) => {
    if (card.flipping) return;
    card.flipping = true;
    const from = card.rotation.z, to = from > 1 ? 0 : Math.PI;
    const y0 = card.position.y;
    addTween({
      dur: 0.45, ease: ease.inOutQuad, update: (k) => {
        card.rotation.z = lerp(from, to, k);
        card.position.y = y0 + Math.sin(k * Math.PI) * 0.25;
      }, done: () => {
        card.flipping = false;
        card.position.y = y0;
      }
    });
  };
  const syncRackLeds = () => {
    const rack = lab.equipment.racks[0];
    const list = contributors.roster;
    rack.leds.forEach((led, i) => {
      const contributor = list[i];
      if (!contributor) {
        led.geometry = ledGrey;
        return;
      }
      const cave = crew.cavemen.get(contributor.name);
      const idx = cave ? STATE_LED[cave.state] : 3;
      led.geometry = idx === 3 ? ledGrey : led.ledGeos[idx];
    });
  };
  const tooltipFor = (hit) => {
    const o = hit.owner;
    switch (o.kind) {
      case "caveman":
        return o.cave.traits.name;
      case "rack":
        return rackInfo(o.rack);
      case "flask":
        return "Flask · tap to stir";
      case "monitor":
        return `Monitor · ${crew.workingCavemen().length} eating · ${Math.floor(world.level)} bananas`;
      case "tower":
        return "Node · air-gapped · no network";
      case "die":
        return "Die · tap to roll";
      case "card":
        return "Card · tap to flip";
      case "abacus":
        return `Abacus · counting ${pile.shown} bananas`;
      case "crate":
        return `${o.crate.loot.tier} crate · tap to open`;
      default:
        return "";
    }
  };
  const onTap = (hit) => {
    if (!hit) return;
    const o = hit.owner;
    switch (o.kind) {
      case "caveman":
        crew.pokeCave(o.cave);
        break;
      case "flask":
        flaskStir(o.node);
        break;
      case "die":
        rollDie(o.node);
        break;
      case "card":
        flipCard(o.node);
        break;
      case "crate":
        crates.openCrate(o.crate);
        break;
      case "rack":
        hud.toast(rackInfo(o.rack));
        for (const led of o.rack.leds) led.flicker = 0.6;
        break;
      case "monitor":
      case "abacus":
      case "tower":
        hud.toast(tooltipFor(hit));
        o.node.pulse = 1;
        break;
      default:
        break;
    }
  };

  // ---------- per frame ----------
  const updateMeter = () => {
    let reloading = 0;
    for (let i = 0; i < crew.list.length; i++) if (crew.list[i].weapon.reloading) reloading++;
    hud.setMeter(world.level, METER_CAPACITY, reloading ? `${reloading} reloading · 6 shots per banana` : world.level < 1 ? "Waiting for bananas" : "Ready for reloads");
  };
  const update = (dt, elapsed) => {
    pilot.readInput(dt);
    crew.update(dt, elapsed);
    pile.update(dt);
    lab.hatch.set(pile.hatchOpen);
    lab.equipment.abacus.update(dt);
    for (let i = 0; i < lab.leds.length; i++) {
      const led = lab.leds[i];
      let glow = 0.55 + 0.45 * Math.sin(elapsed * (1.5 + i % 5 * 0.7) + i * 2.1);
      if (led.flicker > 0) {
        led.flicker -= dt;
        glow = Math.random() > 0.5 ? 1.4 : 0.2;
      }
      if (led.pulse > 0) {
        led.pulse -= dt * 1.5;
        glow += led.pulse;
      }
      led.glow = glow;
    }
    for (const node of pulseNodes) {
      if (node.pulse > 0) {
        node.pulse -= dt * 2;
        node.highlight = Math.max(0, node.pulse);
      }
    }
    crates.update(dt, elapsed);
    fx.update(dt);
    stepTweens(dt);
    pilot.update(dt);
    meterTimer -= dt;
    if (meterTimer <= 0) {
      meterTimer = 0.25;
      updateMeter();
    }
  };
  const overlay = (dt) => fx.drawOverlay(dt, crew.drawQuotes);

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
    if (e.key === "Escape") {
      if (pilot.player) pilot.release();
      else go("hub");
    }
    if (e.key === "g" || e.key === "G") pilot.weaponAction("weapon-toggle");
    if (e.key === "v" || e.key === "V") pilot.weaponAction("weapon-fire");
    if (e.key === "b" || e.key === "B") addTestBananas(testBananas);
    if (e.key === "l" || e.key === "L") demoTip(120000);
    if (e.key === "p" || e.key === "P") {
      world.level = Math.max(world.level, pile.slots.length);
      pile.syncPile(true);
    }
    const digit = parseInt(e.key, 10);
    if (digit >= 1 && digit <= 9) {
      const contributor = contributors.roster[digit - 1];
      const cave = contributor && crew.cavemen.get(contributor.name);
      if (cave && crew.stateOf(cave) !== "working") {
        cave.override = "working";
        crew.refreshStates();
        syncRackLeds();
      }
    }
  };

  // ---------- scene contract ----------
  const enter = (ctx) => {
    ({ renderer, game, world, go, lootEnabled, testBananas } = ctx);
    camera = createCamera({ fov: 48, near: 0.25, far: 60 });
    root = createNode();
    lab = models.labRoom({ half: ROOM_HALF });
    addChild(root, lab.room);
    mark("room");
    hud = hudMod.create({ roster: contributors.activeRoster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled });
    hooks = {};
    input = interactMod.create({ canvas: ctx.canvas, renderer, camera, hooks });
    pilot = pilotMod.create({ renderer, canvas: ctx.canvas, camera, hud, presets: PRESETS, landing: "pile", pitch: PITCH, dist: DIST, follow: FOLLOW, fly: FLY, clampTarget, clampCamera, ceilingAt: () => 4.3, coarse: COARSE, close: { eyeHeight: 1.1, eyeRatio: 0.95, eyeForward: 0.16, pitch: [-1.35, 1.35], trailingDist: 4, orbitDist: 5, maxStep: 0.6, groundAt: () => 0 } });
    const shared = { root, input, hooks, hud, game, world, renderer, camera, overlay: ctx.overlay, tickerAt: TICKER_AT, buildSpots: BUILD_SPOTS.slice(), walkIn: WALK_IN, clampDrag, viewYaw: PRESETS.pile.yaw, bedrolls: lab.bedrolls, pileScale: 0.45, onShown: (shown) => { lab.equipment.abacus.setValue(shown); meterTimer = 0; }, walkable };
    shared.onWeaponImpact = (source, hit, dx, dy, dz, power) => {
      if (hit.owner.kind === "caveman") crew.damage(hit.owner.cave, power);
    };
    shared.fireReachable = (x, y, z, toX, toY, toZ) => Math.abs(toX) < ROOM_HALF && Math.abs(toZ) < ROOM_HALF && toY > 0 && toY < 4.5;
    fx = shared.fx = fxMod.create(shared);
    pile = shared.pile = pileMod.create(shared);
    shared.workSites = [{
      repo: "oogaboogax/entropylab",
      route: [{ x: 3.5, z: 2.5 }, { x: 3.5, z: -2.5 }],
      position: (cave, out) => {
        out.x = -2.4 + cave.index % 4 * 1.6;
        out.y = 0;
        out.z = -4 - Math.floor(cave.index / 4) * 1.1;
      },
      target: (cave, out) => {
        const rounds = 30 - cave.weapon.ammo;
        out.x = Math.sin(rounds * 1.7 + cave.index) * 4;
        out.y = 0.8 + rounds % 4 * 0.45;
        out.z = -8.6;
      }
    }];
    mark("pile");
    crew = shared.crew = crewMod.create(shared);
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
        if (hit) hud.tooltip.show(tooltipFor(hit), p.x, p.y, hit.owner.cave);
        else hud.tooltip.hide();
      },
      onHoverMove: (hit, p) => hud.tooltip.show(tooltipFor(hit), p.x, p.y, hit.owner.cave),
      onTap,
      ...pilot.hooks
    });
    {
      const eq = lab.equipment;
      for (const rack of eq.racks) addProp(rack.node, { kind: "rack", rack });
      for (const flask of eq.flasks) addProp(flask, { kind: "flask", node: flask }, { radius: 0.32 });
      addProp(eq.monitor, { kind: "monitor", node: eq.monitor });
      addProp(eq.tower, { kind: "tower", node: eq.tower });
      for (const die of eq.dice) addProp(die, { kind: "die", node: die }, { radius: 0.3 });
      for (const card of eq.cards) addProp(card, { kind: "card", node: card }, { radius: 0.25 });
      addProp(eq.abacus.node.children[0], { kind: "abacus", node: eq.abacus.node.children[0] });
    }
    hud.onPreset(pilot.goPreset);
    hud.onAction((action, value) => {
      if (action === "tip") demoTip(1200);
      else if (action === "tip-legendary") demoTip(120000);
      else if (action === "clear-loot") clearLoot();
      else if (action === "reset") resetDemo();
      else if (action === "act") pilot.action();
      else if (action === "mode-preset") pilot.goPreset(value === "pile" ? "pile" : value === "lab" ? "racks" : value === "mirror" ? "bunks" : "bench");
      else if (action.startsWith("mode-")) pilot.modeAction(action);
      else if (action.startsWith("weapon-") || action === "magazine-swap") pilot.weaponAction(action);
      else if (action === "reset-view") pilot.goPreset("pile");
      else if (action === "leave") go("hub");
    });
    pulseNodes = [lab.equipment.monitor, lab.equipment.tower, lab.equipment.abacus.node.children[0]];
    meterTimer = 0;
    crew.refreshStates(true);
    syncRackLeds();
    if (ctx.from === null && preloadedEquipment) {
      const name = params.get("character")?.trim().toLowerCase();
      const contributor = params.has("character") ? contributors.activeRoster.find(entry => entry.name.toLowerCase() === name)
        : contributors.activeRoster.find(entry => crew.stateOf(crew.cavemen.get(entry.name)) === "working") || contributors.activeRoster[0];
      const cave = contributor && crew.cavemen.get(contributor.name);
      if (cave) {
        if (!contributors.debugState && crew.stateOf(cave) !== "working") { cave.override = "working"; crew.refreshStates(true); }
        pilot.possess(cave);
        crew.configureWeapon(cave, preloadedWeapon, preloadedAmmo);
      }
    }
    unsubscribeActivity = contributors.subscribe(() => { crew.refreshStates(); syncRackLeds(); });
    // Once a minute, refresh states, LEDs and the pool
    stateTimer = window.setInterval(() => {
      crew.refreshStates();
      syncRackLeds();
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
    hintTimer = window.setTimeout(() => hud.hint(COARSE ? "Drag to look · pinch to zoom · sticks to fly" : "Drag to orbit · scroll to zoom · WASD to fly"), 1200);
    Object.assign(labScene, {
      root, camera, input,
      debug: {
        slots: pile.slots, drops: pile.drops, core: pile.core, shell: pile.shell, delivery: pile.delivery, cavemen: crew.cavemen, crates: crates.list, lab, hud, applyAllSwag: crew.applyAllSwag, renderLocker: crew.renderLocker, demoTip, setPileLevel: pile.setLevel, refreshStates: crew.refreshStates, trimPool: fx.trimPool,
        get shown() {
          return pile.shown;
        },
        camera, crew, fx, pilot, controls: pilot.controls
      }
    });
    pilot.update(0);
    mark("visibility-start");
    fx.warmVisibility(crew);
    mark("visibility");
  };
  const leave = () => {
    window.clearInterval(stateTimer);
    unsubscribeActivity();
    unsubscribeActivity = null;
    window.clearTimeout(hintTimer);
    crates.dispose();
    pile.dispose();
    crew.dispose();
    fx.dispose();
    pilot.dispose();
    for (const node of propTargets) input.remove(node);
    propTargets.length = 0;
    removeChild(root, lab.room);
    const targets = input.targetCount;
    input.dispose();
    hud.dispose();
    // Drop the room and every system
    lab = hud = hooks = input = pilot = fx = pile = crew = crates = pulseNodes = null;
    labScene.input = labScene.debug = null;
    return { targets };
  };
  const liveGeometry = (set) => {
    pile.liveGeometry(set);
    for (const cave of crew.cavemen.values()) set.add(cave.headOpen).add(cave.headClosed);
  };
  const stats = () => {
    let nodes = 0;
    traverseVisible(root, () => nodes++);
    const all = (n) => 1 + n.children.reduce((sum, c) => sum + all(c), 0);
    return { visibleNodes: nodes, allNodes: all(root), tweens: tweenCount(), targets: input.targetCount, ...fx.stats(), ...crates.stats(), ...crew.stats(), ...pile.stats() };
  };
  const labScene = {
    id: "lab", enter, update, overlay, onDonation, onKey, onLootCleared, renderOpts: RENDER_OPTS, leave, stats, liveGeometry,
    root: null, camera: null, input: null, debug: null,
    get inMotion() {
      return pile.inMotion || fx.inMotion;
    }
  };
  BL.scenes = BL.scenes || {};
  BL.scenes.lab = labScene;
})();
