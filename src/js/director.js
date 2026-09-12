(() => {
  "use strict";
  const { scene, models, donations, glRenderer, canvasRenderer, game: gameMod, pile: pileMod, scenes } = window.BL;
  const { clearTweens, tweenCount } = scene;
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has("debug");
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
  let renderer = null;
  if (!params.has("canvas2d") && glRenderer.isSupported()) {
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
  // The banana level, shared by every scene, and the Ooga handed from the hub to a launched scene
  const world = { level: START_BANANAS, pilot: null };

  // ---------- scenes ----------
  // One active scene owns its root, camera and systems
  let active = null;
  let sceneTime = 0;
  let transition = null;
  let fade = 0;
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
    for (const el of sceneSections) el.hidden = el.dataset.scene !== next.id;
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
  const perf = { frames: 0, total: 0, checked: 0 };
  const QUALITY_ORDER = ["high", "medium", "low"];
  const autoTier = (frameMs) => {
    if (renderer.kind !== "webgl2" || perf.checked >= 2) return;
    perf.frames++;
    perf.total += frameMs;
    if (perf.frames < 120) return;
    const avg = perf.total / perf.frames;
    perf.frames = 0;
    perf.total = 0;
    perf.checked++;
    const idx = QUALITY_ORDER.indexOf(renderer.quality);
    if (avg > 19 && idx < QUALITY_ORDER.length - 1) {
      renderer.setQuality(QUALITY_ORDER[idx + 1]);
      showQuality();
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
  const frame = (now) => {
    raf = window.requestAnimationFrame(frame);
    const interval = frameInterval();
    if (interval && now - lastRender < interval - 1) return;
    lastRender = now;
    renderedFrames++;
    if (renderedFrames <= 3) mark(`frame${renderedFrames}`);
    const t0 = performance.now();
    const dt = Math.min(0.1, (now - lastTime) / 1e3);
    lastTime = now;
    elapsed += dt;
    if (transition) stepTransition(dt);
    sceneTime += dt;
    active.update(dt, sceneTime);
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
    active.overlay(dt);
    active.input.update();
    if (fade > 0) drawFade();
    autoTier(performance.now() - t0);
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
    } else if (!raf) {
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
  enter(Object.hasOwn(scenes, sceneId) ? scenes[sceneId] : scenes[Object.keys(scenes)[0]]);
  mark("ready");
  raf = window.requestAnimationFrame(frame);
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
      get scene() {
        return active.id;
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
    for (const key of ["slots", "drops", "core", "shell", "delivery", "cavemen", "crates", "lab", "hud", "applyAllSwag", "renderLocker", "demoTip", "setPileLevel", "refreshStates", "trimPool", "shown", "island", "mouths", "labels", "camera", "cameraCave", "crew", "controls", "props", "altar", "path", "scenery", "jetpack", "mirrorCave", "matrixCave", "pilot", "renderOpts", "lamps", "entranceLights", "lighting", "fireSeats", "critters", "daylight", "setHour", "track", "racers", "items", "race", "audio", "weather", "launchers", "drop", "diver", "plane", "course", "den", "bed", "spots", "lanterns", "sleep", "wake", "sleeping", "zzzTimer"]) {
      Object.defineProperty(ooga, key, { get: () => active.debug[key], enumerable: true });
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
