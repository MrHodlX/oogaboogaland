// MrHodl's Den: the island's quiet sleep cave
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, contributors, hubModels, donations, qr, game: gameMod, hud: hudMod, interact: interactMod, pilot: pilotMod, fx: fxMod } = BL;
  const { clamp, ease, randomInt } = math;
  const { createNode, addChild, removeChild, createCamera, addTween, stepTweens, tweenCount, traverseVisible } = BL.scene;
  const params = new URLSearchParams(location.search);
  const ROOM_HALF = 6.4, WALL_H = 3.4;
  const WALL = ROOM_HALF - 0.6;
  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  const yawParam = parseFloat(params.get("yaw"));
  // The bed spot, the reach that lies the visitor down and the zzz beat
  const BED = { x: 0.2, y: 0.66, z: -ROOM_HALF + 2.2 };
  const SLEEP_REACH = 1.7, ZZZ_EVERY = 1.7;
  // Orbit, follow and flight limits
  const PITCH = [0.12, 1.1], DIST = [3, 7.8];
  const FOLLOW = { y: 0.9, min: 3, max: 6, pitch: [0.25, 0.8] };
  const FLY = { speed: 3.2, perDist: 0.35, climb: 2.4, yMax: WALL_H - 0.7 };
  const PRESETS = {
    room: { yaw: Number.isFinite(yawParam) ? yawParam : 0, pitch: 0.34, dist: 6.8, target: { x: 0, y: 1.25, z: -1.1 } },
    bed: { yaw: -0.35, pitch: 0.46, dist: 4.6, target: { x: BED.x, y: 0.9, z: BED.z + 1.2 } },
    sleep: { yaw: -0.55, pitch: 0.7, dist: 3.2, target: { x: BED.x, y: 0.62, z: BED.z } },
    desk: { yaw: -1.3, pitch: 0.3, dist: 4.4, target: { x: -ROOM_HALF + 1.5, y: 0.95, z: -2.2 } },
    pegs: { yaw: 1.25, pitch: 0.24, dist: 4.2, target: { x: ROOM_HALF - 0.7, y: 1.5, z: 0.4 } }
  };
  const RENDER_OPTS = { shadowCenter: { x: 0, y: 1.2, z: 0 }, shadowExtent: 9 };
  // Where the thank-you ticker hangs
  const TICKER_AT = { x: 0, y: 2.95, z: -ROOM_HALF + 0.3 };
  // The mask has the last word on being woken
  const SLEEPY_LINES = ["five more minutes", "zzz", "not yet...", "warm in here"];
  const clampDrag = (p) => {
    p.x = clamp(p.x, -ROOM_HALF + 0.5, ROOM_HALF - 0.5);
    p.z = clamp(p.z, -ROOM_HALF + 0.5, ROOM_HALF - 0.5);
    return p;
  };
  const mark = (name) => {
    performance.clearMarks(`ooga:${name}`);
    performance.mark(`ooga:${name}`);
  };
  // The den has no build quotes to draw between the bubbles and the ticker
  const NO_QUOTES = () => {};
  // One particle set for every gentle burst in the den
  const SLEEP_SPARKS = [models.particleGeometry("#ffb347", 0.08, 1), models.particleGeometry("#f3efe4", 0.07, 0.6)];
  // One visit's state, made in enter and dropped in leave
  let renderer, game, world, go, lootEnabled, root, camera, den, hud, hooks, input, pilot, fx;
  let hintTimer = 0, zzzTimer = 0, sleepyLine = 0, sleeping = false, nearBed = false;
  const propTargets = [];
  const clampTarget = (t) => {
    t.x = clamp(t.x, -WALL, WALL);
    t.z = clamp(t.z, -WALL, WALL);
  };
  const clampCamera = (p) => {
    p.x = clamp(p.x, -ROOM_HALF + 0.4, ROOM_HALF - 0.4);
    p.z = clamp(p.z, -ROOM_HALF + 0.4, ROOM_HALF - 0.4);
    p.y = clamp(p.y, 0.4, WALL_H - 0.3);
  };
  // How far the visitor's view target stands from the bed
  const bedDistance = () => Math.hypot(pilot.orbit.target.x - BED.x, pilot.orbit.target.z - BED.z);
  // ---------- sleep ----------
  // Sleeping is one flag and one view: the camera settles over the bed, zzz drift
  // up and the lanterns stay warm. Space, the act button or Escape wakes.
  // Escape while awake leaves for the island, so the first Escape out of a den
  // you are asleep in wakes you and the second one walks you home.
  const sleep = () => {
    if (sleeping) return false;
    sleeping = true;
    zzzTimer = 0;
    pilot.goPreset("sleep");
    nearBed = true;
    hud.el.act.hidden = false;
    hud.setAct("Wake");
    hud.hint(COARSE ? "zzz... tap Ooga! to wake" : "zzz... Space or Ooga! wakes");
    return true;
  };
  const wake = () => {
    if (!sleeping) return false;
    sleeping = false;
    zzzTimer = 0;
    pilot.goPreset("bed");
    // Waking up on the bedroll must not drop straight back into sleep
    nearBed = bedDistance() <= SLEEP_REACH;
    hud.el.act.hidden = false;
    hud.setAct("Sleep");
    fx.sayAt(BED.x, BED.y + 0.5, BED.z, "Ooga.", 1.6);
    return true;
  };
  // Space and the act button do the same thing: wake, or lie down in reach
  const actKey = () => {
    if (sleeping) return wake();
    if (bedDistance() <= SLEEP_REACH) return sleep();
    hud.toast("The bed is in the back corner");
    return false;
  };
  // ---------- donations ----------
  // A tip only stirs the den: the lanterns flare, a little confetti settles on the
  // bedroll and the mask mutters back. Nothing here touches the shared pile.
  const onDonation = (donation) => {
    game.recordDonation(donation);
    for (const lamp of den.lanterns) lamp.flare = 1;
    fx.burst(BED.x, BED.y + 0.35, BED.z, 14, SLEEP_SPARKS, 1.1);
    fx.zzzAt(BED.x + 0.5, BED.y + 0.45, BED.z);
    fx.sayAt(den.spots.mask.x, den.spots.mask.y, den.spots.mask.z, "zzz... thanks", 2.2);
    hud.toast(`+${gameMod.formatLarge(donation.sats)} sats · the den glows${donation.handle ? ` · @${donation.handle}` : ""}`);
    hud.setStats(game.state);
  };
  const demoTip = (sats) => onDonation({ id: `demo-${Date.now()}`, sats, handle: game.state.handle, message: game.state.message, at: Date.now() });
  // ---------- props ----------
  const rollDie = (dieNode) => {
    if (dieNode.rolling) return;
    dieNode.rolling = true;
    const result = randomInt(6) + 1;
    const startY = dieNode.position.y;
    const r0 = { ...dieNode.rotation };
    const final = models.dieRotationFor(result, r0.y + 1.7);
    addTween({
      dur: 0.7, ease: ease.linear, update: (k) => {
        dieNode.position.y = startY + Math.sin(k * Math.PI) * 0.5;
        dieNode.rotation.x = r0.x + k * Math.PI * 4;
        dieNode.rotation.z = r0.z + k * Math.PI * 2;
        dieNode.rotation.y = r0.y + k * 1.7;
      }, done: () => {
        Object.assign(dieNode.rotation, final);
        dieNode.position.y = startY;
        dieNode.rolling = false;
        dieNode.lastRoll = result;
        const w = dieNode.world;
        fx.sayAt(w[12], w[13] + dieNode.dieSize * 0.5 + 0.2, w[14], `Rolled ${result}`, 1.8);
      }
    });
  };
  // The night snack bobs and takes a bite, then settles back on the nightstand
  const biteSnack = (snack) => {
    const y0 = snack.position.y;
    addTween({
      dur: 0.5, ease: ease.inOutQuad, update: (k) => {
        snack.position.y = y0 + Math.sin(k * Math.PI) * 0.12;
        snack.rotation.z = k * Math.PI * 0.4;
      }, done: () => {
        snack.position.y = y0;
        snack.rotation.z = 0;
      }
    });
    const w = snack.world;
    fx.sayAt(w[12], w[13] + 0.35, w[14], "Nom.", 1.6);
  };
  const tooltipFor = (hit) => {
    const o = hit.owner;
    switch (o.kind) {
      case "bed":
        return sleeping ? "Bedroll · tap to wake" : "Bedroll · tap to sleep";
      case "mask":
        return "Gas-mask peg · MrHodl's";
      case "snack":
        return "Night snack · tap to nibble";
      case "die":
        return "Die · tap to roll";
      case "crate":
        return "Banana crate · tap to peek";
      case "lantern":
        return "Lantern · tap to stoke";
      default:
        return "";
    }
  };
  const onTap = (hit) => {
    if (!hit) return;
    const o = hit.owner;
    switch (o.kind) {
      case "bed":
        if (sleeping) wake();
        else sleep();
        break;
      case "mask": {
        const spot = den.spots.mask;
        fx.sayAt(spot.x, spot.y, spot.z, SLEEPY_LINES[sleepyLine++ % SLEEPY_LINES.length], 2.2);
        break;
      }
      case "snack":
        biteSnack(o.node);
        break;
      case "die":
        rollDie(o.node);
        break;
      case "crate": {
        const w = o.node.world;
        fx.sayAt(w[12], w[13] + 1.1, w[14], "Full of bananas", 2);
        for (const lamp of den.lanterns) lamp.flare = 0.6;
        break;
      }
      case "lantern": {
        o.node.flare = 1;
        const w = o.node.world;
        fx.sayAt(w[12], w[13] - 0.3, w[14], "warm", 1.6);
        break;
      }
      default:
        break;
    }
  };
  // ---------- per frame ----------
  const update = (dt, elapsed) => {
    pilot.readInput(dt);
    // The lanterns breathe; a tap or a donation flares them warm
    const breath = 0.78 + Math.sin(elapsed * 1.6) * 0.05 + Math.sin(elapsed * 4.7) * 0.025;
    for (let i = 0; i < den.lanterns.length; i++) {
      const lamp = den.lanterns[i];
      let glow = breath + Math.sin(elapsed * 2.1 + i * 2.2) * 0.03;
      if (lamp.flare > 0) {
        lamp.flare = Math.max(0, lamp.flare - dt * 1.6);
        glow += lamp.flare * 1.2;
      }
      lamp.glow = glow;
    }
    // The bed zone sleeps on the way in, never on the way out: waking up on the
    // bedroll would otherwise put the visitor straight back to sleep.
    const near = bedDistance() <= SLEEP_REACH;
    if (sleeping) {
      zzzTimer -= dt;
      if (zzzTimer <= 0) {
        zzzTimer = ZZZ_EVERY;
        fx.zzzAt(BED.x + 0.5, BED.y + 0.45, BED.z);
      }
    } else if (near && !nearBed) {
      // Walking the view into the bed zone lies the visitor down
      sleep();
    }
    nearBed = near;
    fx.update(dt);
    stepTweens(dt);
    pilot.update(dt);
  };
  const overlay = (dt) => fx.drawOverlay(dt, NO_QUOTES);
  // ---------- actions and keys ----------
  const onLootCleared = () => {
    if (!lootEnabled) return;
    hud.toast("Loot locker cleared");
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      if (sleeping) wake();
      else go("hub");
    }
    if (e.key === " ") actKey();
    if (e.key === "0") pilot.goPreset("room");
    if (e.key === "l" || e.key === "L") demoTip(120000);
  };
  // ---------- scene contract ----------
  const enter = (ctx) => {
    ({ renderer, game, world, go, lootEnabled } = ctx);
    camera = createCamera({ fov: 48, near: 0.25, far: 40 });
    root = createNode();
    den = models.denRoom({ half: ROOM_HALF, wallH: WALL_H, bed: BED });
    addChild(root, den.room);
    // The bedroll itself is the hub's, laid on the den's platform
    addChild(den.bedNode, createNode({ position: { x: 0, y: 0.3, z: 0.02 }, geometry: hubModels.bedroll() }));
    mark("den");
    hud = hudMod.create({ roster: contributors.roster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled });
    hooks = {};
    input = interactMod.create({ canvas: ctx.canvas, renderer, camera, hooks });
    pilot = pilotMod.create({ renderer, canvas: ctx.canvas, camera, hud, presets: PRESETS, landing: "room", pitch: PITCH, dist: DIST, follow: FOLLOW, fly: FLY, clampTarget, clampCamera, coarse: COARSE });
    const shared = { root, input, hooks, hud, game, world, renderer, camera, overlay: ctx.overlay, tickerAt: TICKER_AT, clampDrag, viewYaw: PRESETS.room.yaw };
    fx = shared.fx = fxMod.create(shared);
    pilot.bind(shared);
    const donationRequest = donations.createRequest(game.state);
    qr.drawTo(hud.el.qr, donationRequest.url, { quiet: 3, dark: "#000000", light: "#f3efe4" });
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
    for (const item of den.interactive) {
      input.add(item.node, { kind: item.kind, node: item.node, den: item }, { radius: item.radius });
      propTargets.push(item.node);
    }
    hud.onPreset(pilot.goPreset);
    hud.onAction((action) => {
      if (action === "act") actKey();
      else if (action === "leave") go("hub");
      else if (action === "reset-view") pilot.goPreset("room");
      else if (action === "tip") demoTip(1200);
      else if (action === "tip-legendary") demoTip(120000);
    });
    sleeping = false;
    zzzTimer = 0;
    sleepyLine = 0;
    nearBed = false;
    hud.el.act.hidden = false;
    hud.setAct("Sleep");
    hud.setStats(game.state);
    if (window.matchMedia("(max-width: 720px), (max-height: 500px)").matches) hud.el.sheet.dataset.open = "false";
    hintTimer = window.setTimeout(() => hud.hint(COARSE ? "Drag to look · walk into the bed · tap Ooga! to sleep" : "Drag to orbit · WASD to move · Space by the bed sleeps"), 1200);
    Object.assign(hodlScene, {
      root, camera, input,
      debug: {
        den, bed: BED, spots: den.spots, props: den.interactive, lanterns: den.lanterns, camera, controls: pilot.controls,
        sleep, wake, demoTip,
        get sleeping() {
          return sleeping;
        },
        get zzzTimer() {
          return zzzTimer;
        }
      }
    });
  };
  const leave = () => {
    window.clearTimeout(hintTimer);
    fx.dispose();
    pilot.dispose();
    for (const node of propTargets) input.remove(node);
    propTargets.length = 0;
    removeChild(root, den.room);
    const targets = input.targetCount;
    input.dispose();
    hud.dispose();
    // Drop the room and every system
    den = hud = hooks = input = pilot = fx = null;
    sleeping = false;
    nearBed = false;
    zzzTimer = 0;
    hodlScene.input = hodlScene.debug = null;
    return { targets };
  };
  const liveGeometry = (set) => {
    // Every den geometry hangs on the room, so the director's walk of the new
    // root already keeps it; nothing is held off the graph here.
  };
  const stats = () => {
    let nodes = 0;
    traverseVisible(root, () => nodes++);
    const all = (n) => 1 + n.children.reduce((sum, c) => sum + all(c), 0);
    return { visibleNodes: nodes, allNodes: all(root), tweens: tweenCount(), targets: input.targetCount, ...fx.stats() };
  };
  const hodlScene = {
    id: "hodl", enter, update, overlay, onDonation, onKey, onLootCleared, renderOpts: RENDER_OPTS, leave, stats, liveGeometry,
    root: null, camera: null, input: null, debug: null,
    get inMotion() {
      return !!fx && fx.inMotion;
    }
  };
  BL.scenes = BL.scenes || {};
  BL.scenes.hodl = hodlScene;
})();
