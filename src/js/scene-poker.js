(() => {
  "use strict";
  const BL = window.BL, S = BL.scene, PM = BL.pokerModels, R = BL.pokerRules, Themes = BL.pokerThemes;
  const presets = { entrance: { yaw: 0, pitch: 0.48, dist: 18, target: { x: 0, y: 1, z: 17 } } };
  const renderOpts = { clear: [0.1, 0.12, 0.09], sky: [0.62, 0.57, 0.45], ground: [0.31, 0.36, 0.27],
    direct: [0.88, 0.77, 0.58], directStrength: 0.38, ambientFloor: 0.48, sun: { x: 0.2, y: 1, z: 0.3 },
    shadowCenter: { x: 0, y: 1.5, z: 0 }, shadowExtent: 35, bloomStrength: 0.24,
    lights: new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY * 8), lightCount: 13 };
  let root, camera, input, hud, panel, pilot, fx, people, avatar, room, mirror, world, session, go;
  let leaving = false, timer = 0, selected = 0, pendingStand = false, seatTable = -1, shownCountdown = -1;
  const targets = [], snapshots = new Array(10);
  let HERO = "local-player", connecting = false, unsubscribeAccount = null, remotes = null;
  let visit = 0, pendingLive = null;
  const NO_ACTORS = [];
  // On the Worker's page the island's driving rules hold in here too, and the Ooga driven is reported to the room
  // every frame, so signed-in players on the floor hear each other (voice needs a driven Ooga).
  const mayPossess = cave => BL.net.mayDrive(cave.traits.name, BL.contributors.stateFor(cave.contributor) === "working");
  const mayPick = c => !BL.net.mayDrive(c.name, BL.contributors.stateFor(c) === "working");
  const accountChanged = () => {
    if (!avatar) return;
    if (session?.live?.account && session.live.account !== String(BL.net.state.me?.id)) session.live.disconnect("Account changed. Reload and sign in to the original account to recover this game.");
    const released = BL.net.state.released;
    const denied = mayPossess(avatar) || (released && released.name === avatar.traits.name ? "That Ooga is no longer yours to drive" : null);
    BL.net.state.released = null;
    if (denied && people.player === avatar) { pilot.release(true); hud.toast(denied); }
  };
  const nextHand = new Float64Array(10), completed = new Int32Array(10);
  let theme = Themes.get("gatsby");
  const clamp = BL.math.clamp;
  const clampTarget = p => { p.x = clamp(p.x, -22, 22); p.z = clamp(p.z, -34, 34); p.y = clamp(p.y, 0.5, 7); };
  const clampCamera = p => { p.x = clamp(p.x, -23.5, 23.5); p.z = clamp(p.z, -35.7, 35.7); p.y = clamp(p.y, 0.8, 8.5); };
  const activeTable = () => session.tables[selected];
  const setTheme = id => {
    theme = Themes.get(id); room.setTheme(theme.id); panel.setTheme(theme.id);
    session.theme = theme.id;
    renderOpts.sky = theme.sky; renderOpts.ground = theme.ground; renderOpts.direct = theme.direct; renderOpts.ambientFloor = theme.ambient;
  };
  const leaveFloor = () => { if (leaving) return; if (session.live && seatTable >= 0) { panel.notice("Stand between hands before leaving. You can walk the floor while connected."); return; } if (go("bifrost", null, true)) leaving = true; };
  const setView = focused => {
    panel.setFocused(focused); pilot.controls.reset();
    BL.net.setPokerVoice(focused ? selected : null);
    pilot.setActive(!focused);
  };
  const placeInAisle = () => {
    if (!avatar) return;
    const p = PM.TABLES[selected];
    avatar.root.position.x = 0; avatar.root.position.y = avatar.baseY; avatar.root.position.z = p.z;
    avatar.root.rotation.y = Math.PI; avatar.root.visible = true;
    pilot.setActive(true); pilot.controls.reset();
    document.body.removeAttribute("data-poker-seated");
  };
  const sit = index => {
    const p = PM.TABLES[selected], s = PM.SEATS[index];
    avatar.root.position.x = p.x + s.x; avatar.root.position.z = p.z + s.z;
    avatar.root.position.y = avatar.baseY + 0.45; avatar.root.rotation.y = s.yaw;
    pilot.controls.reset(); pilot.setActive(false);
    document.body.dataset.pokerSeated = "true";
  };
  const syncTable = i => {
    const t = session.tables[i], view = room.tables[i], s = t.snapshot(i === seatTable && !pendingStand ? HERO : null);
    snapshots[i] = s; view.version = t.version; view.pulse = 0.7;
    if (s.result && completed[i] !== s.hand) { completed[i] = s.hand; nextHand[i] = 5; }
    for (let j = 0; j < PM.SEATS.length; j++) {
      const p = s.seats[j], slot = PM.SEATS[j];
      view.backs[j].visible = !!p && p.inHand && !p.folded && s.phase !== "showdown";
      view.chips[j].visible = !!p && p.stack > 0;
      view.chips[j].scale.y = p ? Math.min(12, Math.max(1, Math.ceil(p.stack / 200))) : 1;
      const visibleActor = !!p && (p.bot || !!session.live && p.id !== HERO);
      if (visibleActor && !view.actors[j]) {
        // Generic, hashed local bots; no claim of a real contributor being online.
        const actor = BL.models.caveman(BL.contributors.traitsFor("Banana Bot " + j));
        actor.root.position.x = slot.x; actor.root.position.z = slot.z; actor.root.position.y = 0.6;
        actor.root.rotation.y = slot.yaw; actor.root.scale.x = actor.root.scale.y = actor.root.scale.z = 0.82;
        if (actor.parts.club) actor.parts.club.visible = false;
        if (actor.parts.gun) actor.parts.gun.visible = false;
        if (actor.parts.legR) actor.parts.legR.rotation.x = -1.35;
        if (actor.parts.legL) actor.parts.legL.rotation.x = -1.35;
        view.actors[j] = actor; S.addChild(view.root, actor.root);
      }
      if (view.actors[j]) view.actors[j].root.visible = visibleActor;
    }
    for (let j = 0; j < 5; j++) { view.board[j].visible = j < s.board.length && Number.isInteger(s.board[j]); if (view.board[j].visible) view.board[j].geometry = PM.card(s.board[j]); }
    view.button.visible = s.dealer >= 0;
    if (s.dealer >= 0) { const p = PM.SEATS[s.dealer]; view.button.position.x = p.x * 0.72; view.button.position.z = p.z * 0.65; view.button.position.y = 1.4; }
  };
  const updatePanel = () => {
    panel.setLive(session.live ? { ...(session.live.fairness || { phase: "connecting" }), connection: session.live.connection, busy: session.live.busy } : null);
    panel.update(selected, snapshots, seatTable >= 0 && (!pendingStand || session.live) ? HERO : null, session.live ? false : pendingStand, session.paused, session.autoDeal[selected]);
    shownCountdown = -1;
  };
  const refresh = (force = false) => {
    for (let i = 0; i < 10; i++) if (force || !snapshots[i] || room.tables[i].version !== session.tables[i].version) syncTable(i);
    updatePanel();
  };
  const select = i => {
    if (!Number.isInteger(i) || i < 0 || i >= 10) return;
    if (seatTable >= 0 && i !== seatTable) { panel.notice("Stand from your current table before switching tables."); return; }
    if (session.live && i !== selected) { try { session.live.action("watch", i); } catch (e) { panel.notice(e.message); return; } }
    selected = i;
    if (seatTable >= 0 && !pendingStand) sit(session.tables[i].snapshot().seats.findIndex(s => s?.id === HERO));
    updatePanel(); setView(true);
  };
  const connectLive = async (retry = false) => {
    if (connecting || session.live && !retry) return;
    if (!session.live && seatTable >= 0) throw new Error("Leave your practice seat before connecting");
    if (retry && session.live?.connection !== "failed") return;
    if (retry) session.live.dispose();
    const visitId = visit;
    connecting = true;
    panel.setConnecting(true); updatePanel();
    let restoring = true;
    const live = BL.pokerLive.create(() => {
      if (!panel || session?.live !== live) return;
      HERO = live.identity || "connecting";
      if (restoring && live.connected) { selected = live.table; restoring = false; if (panel.focused) BL.net.setPokerVoice(selected); }
      const previous = seatTable;
      seatTable = live.tables.findIndex(t => t.snapshot().seats.some(s => s?.id === HERO));
      if (seatTable >= 0 && previous < 0) { selected = seatTable; pendingStand = false; sit(live.tables[seatTable].snapshot().seats.findIndex(s => s?.id === HERO)); setView(true); }
      if (previous >= 0 && seatTable < 0) { pendingStand = false; placeInAisle(); }
      refresh(true);
    }, message => { if (panel && session?.live === live) panel.notice(message); });
    pendingLive = live;
    try {
      await live.connect(selected);
      if (visitId !== visit || !panel || leaving) { live.dispose(); return; }
      if (seatTable >= 0) placeInAisle();
      session = { tables: live.tables, live, selected, paused: false, pendingStand: false, autoDeal: new Array(10).fill(false), theme: theme.id };
      HERO = live.identity || "connecting"; seatTable = -1; pendingStand = false; snapshots.fill(null); refresh(true);
      if (scene.debug) scene.debug.poker.session = session;
    } catch (error) { live.dispose(); if (visitId === visit) throw error; }
    finally { if (visitId === visit) { pendingLive = null; connecting = false; if (panel) { panel.setConnecting(false); updatePanel(); } } }
  };
  const addBots = (table, count) => {
    const s = table.snapshot(); let added = 0;
    for (let i = 0; i < BL.pokerRules.SEATS && added < count; i++) if (!s.seats[i]) { table.join(`bot-${selected}-${i}`, `Bot ${i + 1}`, true, i); added++; }
  };
  const action = (name, value, expectedVersion) => {
    let table = activeTable();
    try {
      // A cosmetic switch must not reset turn timing, raise input or hand state.
      if (name === "theme") { setTheme(value); Themes.save(theme.id); return; }
      if (name === "connect") { connectLive().catch(error => panel?.notice(error.message)); return; }
      if (name === "reconnect") { connectLive(true).catch(error => panel?.notice(error.message)); return; }
      if (name === "return") { select(seatTable >= 0 ? seatTable : selected); return; }
      if (name === "walk") { if (seatTable >= 0) placeInAisle(); setView(false); return; }
      if (session.live) {
        if (name === "practice") {
          if (seatTable >= 0) throw new Error("Stand before returning to practice");
          session.live.dispose(); session = world.poker; HERO = "local-player"; pendingStand = false; selected = session.selected || 0;
          seatTable = session.tables.findIndex(t => t.snapshot().seats.some(s => s?.id === HERO));
          snapshots.fill(null); refresh(true); setView(false); if (scene.debug) scene.debug.poker.session = session; return;
        }
        if (name === "exit") { leaveFloor(); return; }
        if (name === "verify" || name === "export" || name === "verify-file") { session.live.action(name === "verify-file" ? "verify" : name, name === "verify-file" ? value : null); return; }
        const nickname = document.querySelector('[data-poker="nickname"]').value.trim() || "Ooga";
        session.live.action(name, name === "seat" ? { name: nickname, seat: value } : name === "join" ? { name: nickname } : value, expectedVersion); return;
      }
      if (name === "fold" || name === "call" || name === "raise") {
        if (session.paused || pendingStand) throw new Error("Resume your game before acting");
        if (expectedVersion !== undefined && expectedVersion !== table.version) { refresh(); throw new Error("The table changed. Please choose your action again."); }
      }
      if (name === "quick") {
        if (pendingStand) throw new Error("Your previous seat releases after the hand");
        if (seatTable < 0) {
          const available = t => !t.playing && t.snapshot().seats.some(s => !s);
          if (!available(table)) selected = session.tables.findIndex(available);
          if (selected < 0) { selected = 0; throw new Error("Every table is playing. Watch a table and join between hands."); }
          table = activeTable(); table.join(HERO, "You"); seatTable = selected;
        }
        session.paused = false;
        if (!table.playing) {
          const occupied = table.snapshot().seats.filter(Boolean).length;
          addBots(table, Math.max(0, 4 - occupied));
          for (const p of table.snapshot().seats) if (p?.bot && p.stack === 0) table.refill(p.id);
          table.refill(HERO); table.start();
        }
        sit(table.snapshot().seats.findIndex(p => p?.id === HERO)); setView(true);
      } else if (name === "join" || name === "seat") {
        if (seatTable >= 0) throw new Error("You already have a seat");
        const index = table.join(HERO, "You", false, name === "seat" ? value : -1);
        seatTable = selected; pendingStand = false; sit(index); setView(true);
      } else if (name === "bots") addBots(table, 3);
      else if (name === "start") table.start();
      else if (name === "refill") table.refill(HERO);
      else if (name === "stand") {
        if (seatTable >= 0 && !pendingStand) {
          if (table.playing) pendingStand = true;
          else { table.leave(HERO); seatTable = -1; }
          placeInAisle();
        }
        setView(false);
      } else if (name === "call") { const l = table.snapshot(HERO).legal; table.act(HERO, l?.check ? "check" : "call"); }
      else if (name === "fold" || name === "raise") table.act(HERO, name, value);
      else if (name === "auto") { session.autoDeal[selected] = !!value; if (value) nextHand[selected] = 5; }
      else if (name === "pause") session.paused = !session.paused;
      else if (name === "exit") { leaveFloor(); return; }
      timer = 0; refresh(name === "stand" || name === "walk");
    } catch (error) { panel.notice(error.message); }
  };
  const enter = ctx => {
    visit++;
    world = ctx.world; go = ctx.go; leaving = false; timer = 0; HERO = "local-player"; connecting = false;
    if (ctx.from === "bifrost") document.querySelector('[data-intro="poker"]').hidden = true;
    session = world.poker || (world.poker = { tables: Array.from({ length: 10 }, () => R.create()), selected: 0, pendingStand: false });
    if (!session.autoDeal) session.autoDeal = new Array(10).fill(true);
    theme = Themes.get(session.theme || Themes.load());
    session.paused = !!session.paused; nextHand.fill(5); completed.fill(0); shownCountdown = -1;
    selected = session.selected; pendingStand = session.pendingStand;
    seatTable = session.tables.findIndex(t => t.snapshot().seats.some(s => s?.id === HERO));
    if (seatTable >= 0) selected = seatTable;
    root = S.createNode(); camera = S.createCamera({ fov: 55, near: 0.2, far: 110 });
    hud = BL.hud.create({ roster: BL.contributors.activeRoster, catalog: BL.models.SWAG, tierColors: BL.models.TIER_COLORS, renderIcon: BL.hud.renderIcon, lootEnabled: ctx.lootEnabled });
    const hooks = {};
    input = BL.interact.create({ canvas: ctx.canvas, renderer: ctx.renderer, camera, hooks });
    pilot = BL.pilot.create({ renderer: ctx.renderer, canvas: ctx.canvas, camera, hud, presets, landing: "entrance", pitch: [-0.1, 1.3], dist: [3, 32],
      follow: { y: 0.9, min: 3, max: 7, pitch: [0.25, 0.8] }, fly: { speed: 6, perDist: 0.4, climb: 4, yMax: 8 },
      clampTarget, clampCamera, ceilingAt: () => 8.5, coarse: matchMedia("(pointer: coarse)").matches, mayPossess,
      close: { eyeHeight: 1.1, eyeRatio: 0.95, eyeForward: 0.16, pitch: [-1.35, 1.35], trailingDist: 4, orbitDist: 5, maxStep: 0.6, groundAt: () => 0 } });
    Object.assign(hooks, pilot.hooks, {
      onHover: (hit, p) => { if (hit?.owner.kind === "poker") hud.tooltip.show(`Table ${hit.owner.index + 1} · select to play or watch`, p.x, p.y); else hud.tooltip.hide(); },
      onTap: hit => { if (hit?.owner.kind === "poker") select(hit.owner.index); else if (hit?.owner.kind === "poker-exit") leaveFloor(); }
    });
    hud.onPreset(pilot.goPreset);
    hud.onAction((a, v) => { if (a === "leave") leaveFloor(); else if (a === "reset-view") pilot.goPreset("entrance"); else if (a === "act") pilot.action(); else if (a.startsWith("mode-")) pilot.modeAction(a, v); });
    fx = BL.fx.create({ root, input, hooks, hud, game: ctx.game, world, renderer: ctx.renderer, camera, overlay: ctx.overlay, tickerAt: { x: 0, y: 5, z: -34 } });
    room = PM.build(theme.id); S.addChild(root, room.root);
    for (let i = 0; i < 10; i++) { input.add(room.tables[i].top, { kind: "poker", index: i }); targets.push(room.tables[i].top); }
    // The return mirror is set into the far wall, facing down the central aisle.
    const BM = BL.bifrostModels, face = BM.mirror(4);
    const frame = S.createNode({ position: { x: 0, y: 0, z: 35.2 }, rotation: { x: 0, y: Math.PI, z: 0 } });
    const stone = S.createNode({ geometry: BM.archStone() });
    const glass = S.createNode({ geometry: face.glass, position: { x: 0, y: 0, z: -BM.MIRROR_Z }, sightHidden: true, rippleTint: [0.3, 0.62, 1] });
    const label = BL.factoryModels.label("BIFROST", "", { height: 1.1 });
    const board = S.createNode({ position: { x: 0, y: BM.WINDOW_TOP + BM.FRAME.band + 1.15, z: BM.FRAME.front + 0.2 } });
    S.addChild(board, S.createNode({ geometry: BM.hanger(label.width, 1.35, BM.FRAME.front + 0.2) }), S.createNode({ geometry: label.back }), S.createNode({ geometry: label.face }));
    S.addChild(frame, stone, S.createNode({ geometry: BM.archGlow(), sightHidden: true }), S.createNode({ geometry: face.backing }), glass, board);
    S.addChild(root, frame);
    const opening = { minX: -BM.WINDOW.halfW, maxX: BM.WINDOW.halfW, floorY: 0, ceilingY: BM.WINDOW_TOP };
    const phase = BL.labPhase.create(frame, { x: 0, z: 35.2, ry: Math.PI, floorY: 0, room: { w: 2 * BM.WINDOW.halfW, h: BM.WINDOW_TOP, from: 0, to: 1 } }, opening, -BM.MIRROR_Z, [0.3, 0.62, 1]);
    phase.node.visible = false;
    glass.mirrorRipples = phase.ripples;
    mirror = { phase, glass, body: BL.mirrorBody.create(glass, new Map()) };
    input.add(stone, { kind: "poker-exit" }); targets.push(stone);
    const requested = new URLSearchParams(location.search).get("character");
    const name = [world.pilot, requested].find(n => BL.contributors.activeRoster.some(c => c.name === n && mayPick(c))) || (BL.contributors.activeRoster.find(mayPick) || BL.contributors.activeRoster[0]).name;
    world.pilot = null;
    const playerWorld = { level: 0, weapons: new Map(), magazine: { owned: false, count: 0, ammo: 0, carrier: null } };
    const shared = { root, input, hud, game: ctx.game, world: playerWorld, playerName: name, fx, viewYaw: 0, outsideActors: () => remotes ? remotes.actors() : NO_ACTORS, outsideActorHeight: BL.remotePlayers.BODY_HEIGHT, groundAt: () => 0, walkable: PM.walkable, useNear: () => select(selected) };
    people = shared.crew = BL.crew.create(shared); pilot.bind(shared); avatar = people.cavemen.get(name);
    avatar.root.position.x = 0; avatar.root.position.y = avatar.baseY; avatar.root.position.z = 29;
    avatar.root.rotation.y = Math.PI; pilot.possess(avatar);
    unsubscribeAccount = BL.net.subscribe(accountChanged);
    // Other signed-in players on the floor, as the Oogas they drive.
    remotes = BL.remotePlayers.create({ root, crew: people });
    mirror.body.track(avatar.root, avatar.traits.height * 2, Math.max(avatar.headOpen.verts.length, avatar.headClosed.verts.length));
    if (seatTable >= 0 && !pendingStand) sit(session.tables[seatTable].snapshot().seats.findIndex(s => s?.id === HERO));
    panel = BL.pokerHud.create(action, select); setTheme(theme.id); refresh(); setView(seatTable >= 0 && !pendingStand);
    scene.root = root; scene.camera = camera; scene.input = input;
    scene.debug = { camera, pilot, hud, crew: people, cavemen: people.cavemen, controls: pilot.controls, poker: { session, room, action, select, snapshots } };
    if (new URLSearchParams(location.search).get("pokerLive") === "1") action("connect");
  };
  const update = (dt, elapsed) => {
    pilot.readInput(dt);
    if (!panel.focused) people.update(dt, elapsed);
    pilot.update(dt);
    // The Ooga driven here goes to the room with where it stands and its health; other players here are shown.
    const drivenHere = people.player;
    BL.net.setBody(drivenHere ? drivenHere.traits.name : null);
    if (drivenHere) { const p = drivenHere.root.position; BL.net.sendPose(p.x, p.y - drivenHere.baseY, p.z, drivenHere.root.rotation.y); BL.net.setHealth(drivenHere.health.value, drivenHere.health.stunned); }
    remotes.update(dt);
    mirror.phase.update(dt, elapsed); mirror.body.update(dt); mirror.body.time = mirror.phase.ripples.time;
    if (!leaving && (seatTable < 0 || pendingStand) && Math.abs(avatar.root.position.x) < BL.bifrostModels.WINDOW.halfW
      && avatar.root.position.z > PM.EXIT_Z) leaveFloor();
    // All ten table lights fit the lowest renderer tier; selected table goes first.
    const near = selected, lights = renderOpts.lights;
    for (let slot = 0; slot < 10; slot++) {
      const i = (near + slot) % 10, p = PM.TABLES[i], o = slot * 8;
      lights[o] = p.x; lights[o + 1] = 5.1; lights[o + 2] = p.z; lights[o + 3] = 14;
      lights[o + 4] = theme.tableLight[0]; lights[o + 5] = theme.tableLight[1]; lights[o + 6] = theme.tableLight[2];
      const v = room.tables[i]; v.pulse = Math.max(0, v.pulse - dt);
      v.agent.parts.armL.rotation.x = -0.5 - Math.sin(v.pulse / 0.7 * Math.PI) * 0.75;
      v.agent.parts.armR.rotation.x = -0.45;
      v.dealCard.visible = v.pulse > 0 && snapshots[i].phase !== "waiting";
      v.dealCard.position.z = -2.4 + (1 - v.pulse / 0.7) * 2.1;
    }
    for (let i = 0; i < 3; i++) {
      const o = (10 + i) * 8;
      lights[o] = 0; lights[o + 1] = 6.15; lights[o + 2] = (i - 1) * 24; lights[o + 3] = 13;
      lights[o + 4] = theme.roomLight[0]; lights[o + 5] = theme.roomLight[1]; lights[o + 6] = theme.roomLight[2];
    }
    if (!session.live && !session.paused) {
      timer += dt;
      for (let i = 0; i < 10; i++) if (session.autoDeal[i] && snapshots[i].result) nextHand[i] = Math.max(0, nextHand[i] - dt);
    }
    if (!session.live && timer >= 0.8) {
      timer %= 0.8;
      let changed = false;
      for (let i = 0; i < 10; i++) {
        const t = session.tables[i], s = snapshots[i], player = s.seats[s.turn];
        try {
          if (s.result && session.autoDeal[i] && nextHand[i] === 0) {
            const hero = s.seats.find(p => p?.id === HERO);
            if (hero && hero.stack === 0 && !pendingStand) session.autoDeal[i] = false;
            else {
              for (const p of s.seats) if (p?.bot && p.stack === 0) t.refill(p.id);
              if (t.snapshot().seats.filter(p => p && p.stack > 0).length >= 2) t.start();
              else session.autoDeal[i] = false;
            }
            changed = true;
          } else if (player?.bot) R.botAction(t, player.id);
          else if (i === seatTable && pendingStand && player?.id === HERO) { const l = t.snapshot(HERO).legal; if (l) t.act(HERO, l.check ? "check" : "fold"); }
        } catch (error) { session.autoDeal[i] = false; panel.notice(error.message); }
        if (i === seatTable && pendingStand && !t.playing) { t.leave(HERO); seatTable = -1; pendingStand = false; }
        if (t.version !== room.tables[i].version) { syncTable(i); changed = true; }
      }
      if (changed) updatePanel();
    }
    const seconds = session.live ? session.live.deadline === null ? -1 : Math.max(0, Math.ceil((session.live.deadline - BL.net.serverNow()) / 1000)) : Math.ceil(nextHand[selected]);
    if (shownCountdown !== seconds) { shownCountdown = seconds; panel.countdown(seconds, session.autoDeal[selected]); }
    S.stepTweens(dt); fx.update(dt, elapsed);
  };
  const extra = (c, project) => remotes.drawNames(c, project);
  const onKey = e => { if (e.key === "Escape") { if (panel.focused) action("walk"); else if (seatTable >= 0 && !pendingStand) action("stand"); else leaveFloor(); return true; } if (e.key === "0") { pilot.goPreset("entrance"); return true; } return false; };
  const leave = () => {
    visit++; pendingLive?.dispose(); pendingLive = null;
    session.selected = selected; session.pendingStand = pendingStand;
    if (session.live) session.live.dispose();
    BL.net.setPokerVoice(null);
    world.pilot = avatar.traits.name;
    unsubscribeAccount(); unsubscribeAccount = null; BL.net.setBody(null);
    for (const t of room.tables) t.agent.dispose();
    remotes.dispose(); remotes = null;
    people.dispose(); fx.dispose(); pilot.dispose();
    for (const n of targets) input.remove(n); targets.length = 0;
    mirror.phase.dispose(); mirror.body.dispose(); mirror.glass.mirrorRipples = null;
    panel.dispose(); hud.dispose();
    while (root.children.length) S.removeChild(root, root.children[root.children.length - 1]);
    const count = input.targetCount; input.dispose();
    document.body.removeAttribute("data-poker-seated");
    document.body.removeAttribute("data-poker-table-view");
    scene.input = scene.debug = null;
    hud = panel = pilot = fx = people = avatar = room = mirror = input = session = world = go = null;
    snapshots.fill(null);
    return { targets: count };
  };
  const liveGeometry = set => { if (room) for (const t of room.tables) t.agent.liveGeometry(set); if (avatar) set.add(avatar.headOpen).add(avatar.headClosed); if (remotes) remotes.liveGeometry(set); };
  const stats = () => { let allNodes = 0, visibleNodes = 0; const walk = n => { allNodes++; for (const c of n.children) walk(c); }; walk(root); S.traverseVisible(root, () => visibleNodes++); return { allNodes, visibleNodes, targets: input.targetCount, tweens: S.tweenCount(), ...fx.stats(), ...(remotes ? remotes.stats() : {}) }; };
  // Voice zone: the Ember Den, a portal of its own off the Bifrost chamber.
  const scene = { id: "poker", voiceZone: "ember-den", enter, update, overlay: dt => fx.drawOverlay(dt, extra), onKey, leave, liveGeometry, stats, renderOpts,
    onDonation() {}, onLootCleared() {}, root: null, camera: null, input: null, debug: null,
    agent: null, agentView: null, agentControls: null, agentHandoff: null, get inMotion() { return !!room; } };
  BL.scenes.poker = scene;
})();
