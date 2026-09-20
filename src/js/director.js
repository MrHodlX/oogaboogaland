(() => {
  "use strict";
  const { scene, models, donations, glRenderer, canvasRenderer, game: gameMod, pile: pileMod, scenes } = window.BL;
  // The optional build-time Oogatron snapshot loads before the director.
  // Activity uses each contributor's timestamp, never the snapshot build time.
  if (window.BL.jumbotronData) window.BL.contributors.applySnapshot(window.BL.jumbotronData);
  const { clearTweens, tweenCount } = scene;
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has("debug");
  if (DEBUG) window.BL.contributors.seedDebugActivity();
  // Donation loot crates, the locker tab and worn swag; the suite turns them on with ?debug=1&loot=1
  const LOOT_DEFAULT = false;
  const LOOT_ENABLED = DEBUG && params.has("loot") ? params.get("loot") === "1" : LOOT_DEFAULT;
  const requestedBananas = Number(params.get("bananas"));
  const START_BANANAS = DEBUG && params.has("bananas") && Number.isFinite(requestedBananas) && requestedBananas >= 0
    ? Math.min(pileMod.MAX_BANANAS, Math.floor(requestedBananas))
    : 1000;
  const requestedTestBananas = Number(params.get("b"));
  const TEST_BANANAS = DEBUG && params.has("b") && Number.isFinite(requestedTestBananas) && requestedTestBananas >= 0
    ? Math.min(pileMod.MAX_BANANAS, Math.floor(requestedTestBananas))
    : 100;
  const FADE = 0.25;
  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  const $ = (id) => document.getElementById(id);
  const mark = (name) => performance.mark(`ooga:${name}`);
  mark("boot");
  let sceneCanvas = $("scene");
  const overlayCanvas = $("overlay");
  const overlayCtx = overlayCanvas.getContext("2d");
  const qualityLabel = $("quality");
  const curtain = $("curtain");
  // One saying on the curtain per load, a throwaway pick
  const SAYINGS = [
    "growing the island…", "counting the bananas…", "waking the Oogas…", "polishing the rocks…", "herding the clouds…",
    "lighting the torches…", "packing the leaf chutes…", "lashing sticks into a rocket…", "filling barrels with banana mash…",
    "warming up the Fire Pot…", "sweeping the rope bridge…", "feeding the fireflies…", "teaching cavemen to drive…",
    "hiding the jetpack…", "Ooga NASA has no budget. Wink.", "tightening the Vine Knots…", "fluffing the leaf beds…"
  ];
  $("curtain-saying").textContent = SAYINGS[Math.floor(Math.random() * SAYINGS.length)];
  const worldClock = $("world-clock");
  let renderer = null;
  if (!params.has("canvas2d")) {
    try {
      renderer = glRenderer.createRenderer(sceneCanvas, { quality: COARSE ? "medium" : "high" });
    } catch (err) {
      console.warn("WebGL2 renderer failed, using Canvas 2D fallback", err);
      // A WebGL canvas cannot become 2D, so swap it
      const fresh = sceneCanvas.cloneNode(false);
      sceneCanvas.replaceWith(fresh);
      sceneCanvas = fresh;
    }
  }
  if (!renderer) renderer = canvasRenderer.createRenderer(sceneCanvas);
  mark("renderer");
  const showQuality = () => {
    qualityLabel.textContent = `${renderer.kind} · ${renderer.quality}`;
  };
  showQuality();
  const game = gameMod.create({ catalog: models.SWAG });
  // The banana level, equipment ownership, and Ooga handed from the hub to a
  // launched scene persist while scenes exchange their own temporary systems.
  const world = { level: START_BANANAS, pilot: null, jetpack: { owned: false, fuel: 1 }, mirrorBroken: false };
  const debugMagazines = DEBUG ? (params.get("mag") === "2" ? 2 : params.get("mag") === "1" ? 1 : 0) : 0;
  world.magazine = { owned: debugMagazines > 0, count: debugMagazines, ammo: debugMagazines ? 30 : 0, carrier: null };

  // ---------- scenes ----------
  // One active scene owns its root, camera and systems
  let active = null;
  let sceneTime = 0;
  let transition = null;
  let fade = 0;
  const CLOCK_NS = "http://www.w3.org/2000/svg";
  const clockSvg = document.createElementNS(CLOCK_NS, "svg");
  const clockPath = document.createElementNS(CLOCK_NS, "path");
  const clockTime = DEBUG ? window.BL.daylight.parseTime(params.get("time")) : NaN;
  const clockDaylen = DEBUG ? Number(params.get("daylen")) : NaN;
  const clockStartDate = new Date();
  const requestedClockHour = DEBUG && params.has("hour") ? Number(params.get("hour")) : NaN;
  const clockBaseHour = Number.isFinite(requestedClockHour) ? requestedClockHour : clockStartDate.getHours() + clockStartDate.getMinutes() / 60 + clockStartDate.getSeconds() / 3600;
  let clockNextUpdate = 0, clockMinute = -1;
  const CLOCK_DATE = new Date();
  clockSvg.setAttribute("viewBox", "0 0 30 6");
  clockSvg.setAttribute("class", "sign");
  clockSvg.setAttribute("aria-hidden", "true");
  clockPath.setAttribute("fill", "currentColor");
  clockSvg.append(clockPath);
  worldClock.replaceChildren(clockSvg);
  const updateWorldClock = (now) => {
    if (now < clockNextUpdate) return;
    clockNextUpdate = now + 100;
    let hours, minutes;
    if (Number.isFinite(clockTime)) {
      const total = Math.round(clockTime * 60);
      hours = Math.floor(total / 60);
      minutes = total % 60;
    } else if (clockDaylen > 0) {
      const sceneDaylight = active && active.debug && active.debug.daylight;
      const relative = sceneDaylight && Number.isFinite(sceneDaylight.hour) ? sceneDaylight.hour : clockBaseHour + elapsed * 24 / clockDaylen;
      const total = Math.floor(((relative % 24 + 24) % 24) * 60) % 1440;
      hours = Math.floor(total / 60);
      minutes = total % 60;
    } else {
      CLOCK_DATE.setTime(Date.now());
      hours = CLOCK_DATE.getHours();
      minutes = CLOCK_DATE.getMinutes();
    }
    const minute = hours * 60 + minutes;
    if (minute === clockMinute) return;
    clockMinute = minute;
    const twelve = hours % 12 || 12;
    const text = `${twelve < 10 ? " " : Math.floor(twelve / 10)}${twelve % 10}:${Math.floor(minutes / 10)}${minutes % 10} ${hours < 12 ? "AM" : "PM"}`;
    let d = "", cursor = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === " ") {
        cursor += i === 0 ? 4 : 2;
        continue;
      }
      const glyph = window.BL.hubModels.SIGN_GLYPHS[ch];
      for (let row = 0; row < glyph.length; row++) for (let col = 0; col < glyph[row].length; col++) if (glyph[row][col] === "1") d += `M${cursor + col} ${row}h.82v.82h-.82z`;
      cursor += 4;
    }
    const label = text.trimStart();
    clockPath.setAttribute("d", d);
    worldClock.dateTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    worldClock.setAttribute("aria-label", `${Number.isFinite(clockTime) || clockDaylen > 0 ? "Ooga Booga time" : "Local time"} ${label}`);
  };
  const go = (id) => {
    const next = scenes[id];
    if (!next) throw new Error(`Unknown scene "${id}"`);
    if (transition) return;
    transition = { next, out: true, t: 0 };
  };
  const ctx = { renderer, canvas: sceneCanvas, overlay: overlayCanvas, game, world, go, lootEnabled: LOOT_ENABLED, testBananas: TEST_BANANAS, from: null };
  // data-scene sections show only with their scene
  const sceneSections = [...document.querySelectorAll("[data-scene]")];
  const enter = (next) => {
    ctx.from = active ? active.id : null;
    for (const el of sceneSections) el.hidden = el.classList.contains("hub-presets") || el.dataset.scene !== next.id;
    next.enter(ctx);
    active = next;
    sceneTime = 0;
  };
  const live = new Set();
  const visit = (node) => {
    if (node.geometry) live.add(node.geometry);
    for (const child of node.children) visit(child);
  };
  const liveGeometry = () => {
    live.clear();
    visit(active.root);
    active.liveGeometry(live);
    return live;
  };
  // Swap scenes at full black
  const swap = (next) => {
    const leaving = active;
    const left = leaving.leave();
    if (DEBUG && leaving.root.children.length) throw new Error(`${leaving.id}.leave left ${leaving.root.children.length} nodes in its root`);
    if (DEBUG && left.targets) throw new Error(`${leaving.id}.leave left ${left.targets} input targets`);
    clearTweens();
    if (DEBUG && tweenCount()) throw new Error(`${tweenCount()} tweens survived clearTweens`);
    enter(next);
    renderer.releaseUnused(liveGeometry());
    if (DEBUG && renderer.stats.records > live.size) throw new Error(`${next.id}: ${renderer.stats.records} GPU records for ${live.size} live geometries`);
  };
  const stepTransition = (dt) => {
    transition.t += dt;
    if (transition.out) {
      fade = Math.min(1, transition.t / FADE);
      if (fade < 1) return;
      swap(transition.next);
      transition.out = false;
      transition.t = 0;
      return;
    }
    fade = 1 - Math.min(1, transition.t / FADE);
    if (fade === 0) transition = null;
  };
  // Drawn over the overlay in CSS pixels
  const drawFade = () => {
    overlayCtx.globalAlpha = fade;
    overlayCtx.fillStyle = "#000000";
    overlayCtx.fillRect(0, 0, overlayCanvas.clientWidth, overlayCanvas.clientHeight);
    overlayCtx.globalAlpha = 1;
  };

  // ---------- quality auto-tier ----------
  const perf = { frames: 0, total: 0, elapsed: 0, slow: 0, settleUntil: 0 };
  const QUALITY_ORDER = ["high", "medium", "low"];
  const autoTier = (frameMs, intervalMs, now) => {
    if (renderer.kind !== "webgl2" || renderer.quality === "low") return;
    // Keep measuring after startup: the pile, effects and camera can all add
    // load later. Frame cadence also catches GPU work that finishes after JS.
    // Pauses, background throttling and scene construction are not evidence
    // that the current rendering tier is too expensive.
    if (!document.hasFocus() || transition || renderedFrames < 30 || intervalMs > 100 && frameMs < 19 || now < perf.settleUntil) {
      perf.frames = perf.total = perf.elapsed = perf.slow = 0;
      return;
    }
    perf.frames++;
    perf.total += frameMs;
    perf.elapsed += intervalMs;
    if (intervalMs > 22) perf.slow++;
    if (perf.frames < 120 || perf.elapsed < 2000) return;
    const overloaded = perf.total / perf.frames > 19 || perf.elapsed / perf.frames > 22 && perf.slow / perf.frames > 0.6;
    perf.frames = perf.total = perf.elapsed = perf.slow = 0;
    const idx = QUALITY_ORDER.indexOf(renderer.quality);
    if (overloaded && idx < QUALITY_ORDER.length - 1) {
      renderer.setQuality(QUALITY_ORDER[idx + 1]);
      showQuality();
      perf.settleUntil = now + 6000;
    }
  };

  // ---------- frame governor ----------
  // Full rate when focused, 30fps behind another window
  const WARMUP = 8;
  const UNFOCUSED_INTERVAL = 1000 / 30;
  let lastRender = 0;
  let renderedFrames = 0;
  let firstDraw = false;
  // Part the curtain on the first drawn frame
  const openCurtain = () => {
    curtain.addEventListener("transitionend", (e) => {
      if (e.propertyName === "transform") curtain.remove();
    });
    curtain.dataset.open = "true";
  };
  const frameInterval = () => (elapsed > WARMUP && !document.hasFocus() && !active.inMotion ? UNFOCUSED_INTERVAL : 0);

  // ---------- housekeeping ----------
  // Release GPU buffers the scene no longer references
  const housekeep = () => renderer.releaseUnused(liveGeometry());

  // ---------- main loop ----------
  let elapsed = 0;
  let lastTime = performance.now();
  let raf = 0;
  // One frame of simulation and drawing, shared by the display loop and the
  // debug `advance`, so a stepped frame is exactly a displayed one
  const step = (dt, now, t0, intervalMs = dt * 1e3) => {
    elapsed += dt;
    if (transition) stepTransition(dt);
    sceneTime += dt;
    active.update(dt, sceneTime);
    updateWorldClock(now);
    const drawn = renderer.render(active.root, active.camera, active.renderOpts);
    if (drawn && !firstDraw) {
      firstDraw = true;
      mark("drawn");
      openCurtain();
    }
    if (!drawn && renderer.failure && !params.has("canvas2d")) {
      console.warn("WebGL2 programs failed, reloading with the Canvas 2D fallback", renderer.failure);
      params.set("canvas2d", "1");
      location.replace(`${location.pathname}?${params}`);
      return;
    }
    active.input.update();
    active.overlay(dt);
    if (fade > 0) drawFade();
    autoTier(performance.now() - t0, intervalMs, now);
  };
  const frame = (now) => {
    raf = window.requestAnimationFrame(frame);
    const interval = frameInterval();
    if (interval && now - lastRender < interval - 1) return;
    lastRender = now;
    renderedFrames++;
    if (renderedFrames <= 3) mark(`frame${renderedFrames}`);
    const t0 = performance.now();
    const intervalMs = now - lastTime;
    const dt = Math.min(0.1, intervalMs / 1e3);
    lastTime = now;
    step(dt, now, t0, intervalMs);
  };

  // ---------- lifecycle ----------
  const onKeyDown = (e) => {
    if (e.repeat) return;
    const typing = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
    if (typing || (e.target && e.target.closest && e.target.closest("dialog"))) return;
    if (LOOT_ENABLED && e.shiftKey && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      game.clearLoot();
      active.onLootCleared();
      return;
    }
    if (e.shiftKey && !e.metaKey && !e.ctrlKey && (e.key === "R" || e.key === "r")) {
      e.preventDefault();
      game.resetAll();
      location.reload();
      return;
    }
    active.onKey(e);
  };
  const onVisibility = () => {
    if (document.hidden) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf && active) {
      lastTime = performance.now();
      raf = window.requestAnimationFrame(frame);
    }
  };
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("visibilitychange", onVisibility);
  if (params.has("nosim")) donations.config.simulate = false;
  const unsubscribeDonations = donations.subscribe((donation) => active.onDonation(donation), { identity: () => game.state });
  const housekeepTimer = window.setInterval(housekeep, 6e4);
  // Only a registered id picks the scene
  const sceneId = params.get("scene");
  // Building the first scene holds the main thread, and nothing has been
  // painted yet: run it from a task after the first frame so the leaf curtain
  // is on screen while the island is built, instead of the previous page.
  const boot = () => {
    enter(Object.hasOwn(scenes, sceneId) ? scenes[sceneId] : scenes[Object.keys(scenes)[0]]);
    mark("ready");
    raf = window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(() => window.setTimeout(boot, 0));
  if (DEBUG) {
    const ooga = {
      game,
      renderer,
      startLevel: START_BANANAS,
      lootEnabled: LOOT_ENABLED,
      testBananas: TEST_BANANAS,
      project: renderer.project,
      housekeep,
      go,
      // Whole frames at a fixed step, without waiting on the display: a check
      // can run seconds of simulated play in far less wall time
      advance: (seconds, dt = 1 / 60) => {
        for (let n = Math.round(seconds / dt); n > 0; n--) {
          renderedFrames++;
          const t0 = performance.now();
          step(dt, t0, t0);
        }
        lastTime = performance.now();
      },
      get scene() {
        return active.id;
      },
      get transitioning() {
        return transition !== null;
      },
      get input() {
        return active.input;
      },
      get renderedFrames() {
        return renderedFrames;
      },
      get frameInterval() {
        return frameInterval();
      },
      get mirror() {
        return renderer.mirror;
      },
      get timing() {
        return Object.fromEntries(performance.getEntriesByType("mark").filter((m) => m.name.startsWith("ooga:")).map((m) => [m.name.slice(5), Math.round(m.startTime)]));
      },
      stats: () => ({ ...active.stats(), gl: renderer.stats || null, dom: document.getElementsByTagName("*").length }),
      get level() {
        return world.level;
      }
    };
    for (const key of ["slots", "drops", "core", "shell", "delivery", "spillEffect", "cavemen", "crates", "lab", "headquarters", "hud", "applyAllSwag", "renderLocker", "demoTip", "setPileLevel", "refreshStates", "trimPool", "shown", "island", "mouths", "labels", "camera", "cameraCave", "crew", "fx", "controls", "props", "altar", "path", "scenery", "jetpack", "magazine", "mirrorCave", "matrixCave", "matrixGate", "pilot", "renderOpts", "lamps", "entranceLights", "lighting", "fireSeats", "critters", "daylight", "setHour", "track", "racers", "items", "race", "audio", "weather", "launchers", "drop", "diver", "plane", "course", "jumbotron", "orbit", "flight", "site"]) {
      Object.defineProperty(ooga, key, { get: () => active.debug && active.debug[key], enumerable: true });
    }
    window.__ooga = ooga;
  }
  const destroy = () => {
    window.cancelAnimationFrame(raf);
    window.clearInterval(housekeepTimer);
    unsubscribeDonations();
    window.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("visibilitychange", onVisibility);
    active.leave();
    renderer.dispose();
  };
  window.addEventListener("pagehide", (e) => {
    if (!e.persisted) destroy();
  });
})();
