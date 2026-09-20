// The visitor's camera, flight and possession
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { clamp, damp, mat4, quat } = BL.math;
  const { boundsOf, updateWorld } = BL.scene;
  const { create: createControls } = BL.controls;
  const BASE_FOV = 48 * Math.PI / 180;
  const MAX_FOV = 64 * Math.PI / 180;
  const MIN_HFOV = 58 * Math.PI / 180;
  const YAW_RATE = 1.7, PITCH_RATE = 1.1;
  // Keep a tiny horizontal component so the vertical view retains its yaw.
  const TRAILING_PITCH = [-Math.PI / 2 + 1e-4, Math.PI / 2 - 1e-4];
  const CLOSE_RATE = 12, CLOSE_SNAP = 0.001, CLOSE_PINCH_EXIT = 1.08, CLOSE_LOOK_DIST = 4;
  const AIM_ENTRY_RATE = 8, CARRY_FOCUS_TIME = 0.22;
  const SHOT_SPREAD = 0.015, ADS_SPREAD = 0.005, SPREAD_MASS = 1 - Math.exp(-4.5);
  const TARGET_INTERVAL = 0.05, HIT_TIME = 0.16, TARGET_MARGIN = 0.035;
  const ORBIT_CLOSE_HIT = 0.9, ORBIT_SPREAD_NEAR = 6, ORBIT_SPREAD_MAX = 2.4;
  const ORBIT_AUTO_PROPS = new Set(["crate", "barrel", "rock"]);
  const SHOULDER_PITCH = 0.42, SHOULDER_LIFT = 0.16, SHOULDER_DISTANCE = 2.85, SHOULDER_SIDE = 0.6;
  const CLOSE_GROUND_RATE = 9, CLOSE_TELEPORT = 0.8;
  const WALK = { speed: 7.75, gravity: 9.8, step: 0.6, ledgeRise: 2.4, ledgeSpeed: 3, ledgeDrag: 1.5 };
  // The camera swings behind while walking forward
  const FOLLOW_TURN = 1.8, DRAG_HOLD = 1.5;
  // Act button labels, action or jetpack throttle
  const ACT_DO = "JUMP!", ACT_FLY = "Blast off!";
  // Camera rotations carry look and up together, including a sleeper's roll.
  // Local -Z looks forward; local +Y is the top of the rendered image.
  const viewRotation = (out, fx, fy, fz, ux, uy, uz, yaw) => {
    let length = Math.hypot(fx, fy, fz);
    if (length < 1e-9) { fx = -Math.sin(yaw); fy = 0; fz = -Math.cos(yaw); length = 1; }
    const bx = -fx / length, by = -fy / length, bz = -fz / length;
    let rx = uy * bz - uz * by, ry = uz * bx - ux * bz, rz = ux * by - uy * bx;
    length = Math.hypot(rx, ry, rz);
    if (length < 1e-9) { rx = Math.cos(yaw); ry = 0; rz = -Math.sin(yaw); length = 1; }
    rx /= length; ry /= length; rz /= length;
    ux = by * rz - bz * ry; uy = bz * rx - bx * rz; uz = bx * ry - by * rx;
    const trace = rx + uy + bz;
    if (trace > 0) {
      const s = Math.sqrt(trace + 1) * 2;
      out[0] = (uz - by) / s; out[1] = (bx - rz) / s; out[2] = (ry - ux) / s; out[3] = s / 4;
    } else if (rx > uy && rx > bz) {
      const s = Math.sqrt(1 + rx - uy - bz) * 2;
      out[0] = s / 4; out[1] = (ux + ry) / s; out[2] = (bx + rz) / s; out[3] = (uz - by) / s;
    } else if (uy > bz) {
      const s = Math.sqrt(1 + uy - rx - bz) * 2;
      out[0] = (ux + ry) / s; out[1] = s / 4; out[2] = (by + uz) / s; out[3] = (bx - rz) / s;
    } else {
      const s = Math.sqrt(1 + bz - rx - uy) * 2;
      out[0] = (bx + rz) / s; out[1] = (by + uz) / s; out[2] = s / 4; out[3] = (ry - ux) / s;
    }
    quat.normalize(out);
  };
  const create = (ctx) => {
    const { renderer, canvas, camera, hud, presets, dist: [DIST_MIN, DIST_MAX], follow, fly, clampTarget, clampCamera, coarse, close = null, ceilingAt = null } = ctx;
    let crew = null, fx = null, input = null;
    let restoredPose = null;
    const freeTarget = { x: 0, y: 0, z: 0 };
    const followTarget = { x: 0, y: 0, z: 0 };
    const view = presets[ctx.landing];
    const orbit = { ...view, tYaw: view.yaw, tPitch: view.pitch, tDist: view.dist, tx: view.target.x, ty: view.target.y, tz: view.target.z };
    let freeStrafe = 0, freeForward = 0, freeClimb = 0, freeMoveYaw = view.yaw;
    let closeWanted = false, shoulderView = false, closeMix = 0, closeVelocity = 0, closeRate = CLOSE_RATE, distanceVelocity = 0, closeExitScale = 1, closeCave = null, hiddenHead = null, hiddenHeadCameraHidden = false, viewPitch = orbit.pitch;
    let groundView = 0, groundTarget = 0, groundX = 0, groundZ = 0, groundZone = 0, groundValid = false, groundLift = 0, groundEasing = false;
    let freeFeetY = 0, freeFloorY = 0, freeFallV = 0, freeLeapX = 0, freeLeapZ = 0, freeFallValid = false, freeFalling = false;
    let freeCloud = null;
    let sleepingView = false, sleepYaw = 0, sleepPitch = 0, trailingPitchChosen = false;
    const sleepForward = new Float64Array(3), sleepUp = new Float64Array(3), sleepRight = new Float64Array(3);
    const sleepCameraUp = { x: 0, y: 1, z: 0 };
    const orbitRotation = quat.create(), headRotation = quat.create(), cameraRotation = quat.create(), releaseRotation = quat.create();
    const sleepViewRotation = quat.create(), entryRoll = quat.create(), inverseRotation = quat.create(), relativeRotation = quat.create();
    let releaseMix = 0, closeCameraActive = false;
    let headOrbit = false, exitAngleHold = false, exitBodyX = 0, exitBodyY = 0, exitBodyZ = 0;
    const headOrbitOffset = { x: 0, y: 0, z: 0 };
    const headInverse = mat4.create(), headPartMatrix = mat4.create(), headEye = new Float64Array(3), headNear = new Float64Array(3), headBounds = new Float64Array(6);
    const rollingForward = new Float64Array(3), rollingUp = new Float64Array(3), rollingRight = new Float64Array(3), rollingBaseForward = new Float64Array(3);
    const entryPosition = { x: 0, y: 0, z: 0 };
    let entryRebase = false, entryOffsetActive = false, freeEntry = false;
    const previousEye = { x: 0, y: 0, z: 0 }, eyeVelocity = { x: 0, y: 0, z: 0 }, dollyVelocity = { x: 0, y: 0, z: 0 };
    const previousAnchor = { x: 0, y: 0, z: 0 }, motionAnchor = { x: 0, y: 0, z: 0 }, anchorVelocity = { x: 0, y: 0, z: 0 };
    const DOLLY_HANDOFF = 0.25;
    let eyeMotionValid = false, dollyTime = DOLLY_HANDOFF;
    const carryDollyVelocity = (following = false) => {
      dollyVelocity.x = eyeVelocity.x - (following ? anchorVelocity.x : 0);
      dollyVelocity.y = eyeVelocity.y - (following ? anchorVelocity.y : 0);
      dollyVelocity.z = eyeVelocity.z - (following ? anchorVelocity.z : 0);
      dollyTime = eyeMotionValid ? 0 : DOLLY_HANDOFF;
    };
    const headAnchor = (cave, out) => {
      const p = crew.sleeping && cave.root.quaternion ? cave.sleepHead : cave.root.position;
      out.x = p.x; out.z = p.z;
      out.y = p.y + (p === cave.sleepHead ? 0 : -cave.baseY + cave.headOffset * close.eyeRatio + cave.viewLift);
    };
    const resetFreeFall = () => {
      freeFallV = freeLeapX = freeLeapZ = 0;
      freeFallValid = freeFalling = false;
      freeCloud = null;
    };
    const bind = (systems) => {
      crew = systems.crew;
      input = systems.input;
      sightClear = systems.fireReachable || null;
      cursorClear = systems.cursorReachable || sightClear;
      aimSurface = systems.aimSurface || null;
      systems.aimTarget = aimTarget;
      systems.meleeTarget = meleeTarget;
      systems.onWeaponHit = weaponHit;
      fx = systems.fx;
    };
    const player = () => crew ? crew.player : null;
    const reticle = document.getElementById("weapon-reticle");
    const targetHit = { node: null, owner: null, x: 0, y: 0, z: 0, distance: 0, type: "object" };
    const orbitTargetHit = { node: null, owner: null, x: 0, y: 0, z: 0, distance: 0, type: "object" };
    const orbitTargetScreen = { x: 0, y: 0 }, orbitProjection = new Float64Array(3), orbitCenter = new Float64Array(3);
    const targetOrigin = { x: 0, y: 0, z: 0 };
    let targetWait = 0, targetPrimary = false, targetActive = false, hitRemaining = 0, hitStrength = 0;
    let battleTooltipCave = null;
    let orbitTargetActive = false, orbitTargetClose = false, orbitTargetDistance = Infinity, orbitTargetWait = 0, orbitReticleX = NaN, orbitReticleY = NaN;
    const targetFeedback = (type) => {
      if (reticle.dataset.target !== type) reticle.dataset.target = type;
    };
    const setBattleTooltip = (hit) => {
      const cave = hit && hit.owner && hit.owner.kind === "caveman" ? hit.owner.cave : null;
      if (cave === battleTooltipCave) return;
      battleTooltipCave = cave;
      if (cave) hud.tooltip.show(cave.traits.name, 0, 0, cave);
      else hud.tooltip.hide();
    };
    const clearFeedback = () => {
      targetWait = hitRemaining = hitStrength = 0;
      targetActive = false;
      setBattleTooltip(null);
      targetFeedback("none");
      if (reticle.dataset.hit !== "none") reticle.dataset.hit = "none";
      reticle.style.removeProperty("--reticle-hit");
    };
    const weaponHit = (source, type) => {
      if (source !== player() || !armed()) return;
      hitRemaining = HIT_TIME;
      hitStrength = 1;
      if (reticle.dataset.hit !== type) reticle.dataset.hit = type;
      reticle.style.setProperty("--reticle-hit", "1");
    };
    const aimEntryBody = { x: 0, y: 0, z: 0 };
    const aimEntry = { x: 0, y: 0, z: 0 };
    const aimEntryRotation = quat.create(), aimLookRotation = quat.create(), aimPanRotation = quat.create();
    const aimForward = new Float64Array(3);
    let aimEntryRadius = 0, aimEntryYaw = 0, aimEntryHeight = 0, aimBodyYaw = 0, aimBodyPitch = 0, aimBodyHeadYaw = 0, aimAtCursor = false, aimPreserveFacing = false;
    let aimScreenX = 0, aimScreenY = 0;
    const aimPoint = { x: 0, y: 0, z: 0 };
    const cursorItem = { x: 0, y: 0, z: 0 };
    const cursorPoint = { x: 0, y: 0, z: 0 }, cursorRay = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
    const cursorView = mat4.create(), cursorUp = { x: 0, y: 1, z: 0 };
    let cursorAim = false, cursorOccluded = false, shoulderSide = SHOULDER_SIDE;
    let aimCave = null, aimMix = 0, aimVelocity = 0, adsMix = 0, ads = false, disposed = false;
    let aimLeftAccepted = false, aimLeftFocused = false, aimReleaseEvent = null;
    let primaryButtonCave = null;
    const buttonTarget = { x: 0, y: 0, z: 0 };
    let reticleRadius = -1;
    let zoomTilt = false, zoomPitchVelocity = 0, zoomAnchorPitch = 0, zoomAnchorDistance = DIST_MIN;
    let carryExitMode = 0, carryExitBase = 0, carryExitHeight = 0, carryExitVelocity = 0, carryFocusRemaining = 0;
    const stopCarryExit = () => {
      if (!carryExitMode) return;
      carryExitMode = 0;
      carryFocusRemaining = 0;
      orbit.tPitch = orbit.pitch;
      zoomTilt = false;
      zoomPitchVelocity = 0;
    };
    let lockPending = false, aimLocked = false, softAimFocused = false, unlockedAt = -Infinity, cursorUnlockedAt = -Infinity;
    let savedPitch = 0, savedDist = 0, savedNear = camera.near, sightClear = null, cursorClear = null, aimSurface = null;
    const weaponViewReady = (cave) => !!cave && !crew.sleeping && (closeWanted || !cave.camp.seat && !cave.bedTravel.mode);
    const shoulderBoomPitch = (pitch) => Math.max(pitch, Math.min(0, pitch + 0.22));
    const shoulderDistance = (cave, pitch) => {
      // Keep the feet above the bottom 5% while the head stays near the
      // crosshair. Looking toward the horizon needs a little more room.
      const height = (cave.headOffset * 0.95 + cave.viewLift) / cave.traits.height + SHOULDER_LIFT;
      const margin = 0.9 * Math.tan(BASE_FOV / 2), angle = pitch - shoulderBoomPitch(pitch);
      return Math.max(SHOULDER_DISTANCE, height * (Math.cos(pitch) - margin * Math.sin(pitch)) / (margin * Math.cos(angle) + Math.sin(angle)));
    };
    const armed = () => {
      const cave = player();
      return weaponViewReady(cave) && cave.weapon.aiming;
    };
    const aimView = () => {
      const cave = player();
      return weaponViewReady(cave) && (closeWanted || shoulderView);
    };
    const viewMode = () => !player() ? "detached" : closeWanted ? "first-person" : shoulderView ? "shoulder" : "orbit";
    const orbitBattle = () => armed() && !closeWanted && !shoulderView;
    const carryCursor = BL.cursor.create({ canvas, requestLock: () => lockAim(), unlock: () => unlockAim() });
    const setSoftAimFocus = (active) => {
      softAimFocused = !!active;
      document.body.classList.toggle("aim-cursor-focused", softAimFocused);
      if (softAimFocused) {
        canvas.tabIndex = -1;
        canvas.focus({ preventScroll: true });
      } else if (document.activeElement === canvas) canvas.blur();
    };
    const resetPointer = () => {
      if (input) input.reset();
      controls.clearPointer();
    };
    const unlockAim = () => {
      setSoftAimFocus(false);
      ads = false;
      primaryButtonCave = null;
      aimLeftAccepted = aimLeftFocused = false;
      carryCursor.endAim();
      if (crew) {
        const cave = player();
        if (cave) crew.stopBurst(cave);
        crew.releaseSwing(cave, true);
      }
      if (carryCursor.active) {
        cursorUnlockedAt = performance.now();
        carryCursor.stop();
      }
      resetPointer();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
    const retireAimLock = () => {
      document.removeEventListener("pointerlockchange", aimLockChanged);
      document.removeEventListener("pointerlockerror", aimLockFailed);
    };
    const aimLockFailed = () => {
      lockPending = false;
      carryCursor.endAim();
      if (disposed) retireAimLock();
      if (!disposed && armed()) hud.hint("Click the island to hide the cursor and aim · 1 melee · 2 AK · scroll to change view");
    };
    const lockAim = () => {
      if (coarse || disposed || !(armed() || carryCursor.active) || lockPending || document.pointerLockElement === canvas || !canvas.requestPointerLock) return;
      lockPending = true;
      const request = canvas.requestPointerLock();
      if (request && request.then) request.then(() => {
        lockPending = false;
        if (disposed || !(armed() || carryCursor.active)) unlockAim();
        if (disposed) retireAimLock();
      }, aimLockFailed);
    };
    const focusAim = () => {
      if (coarse || disposed || !armed()) return false;
      setSoftAimFocus(true);
      return true;
    };
    const captureAimEntry = (cave) => {
      const p = cave.root.position, up = camera.up || cursorUp;
      aimEntry.x = camera.position.x; aimEntry.y = camera.position.y; aimEntry.z = camera.position.z;
      aimEntryBody.x = p.x; aimEntryBody.y = p.y; aimEntryBody.z = p.z;
      viewRotation(aimEntryRotation, camera.target.x - aimEntry.x, camera.target.y - aimEntry.y, camera.target.z - aimEntry.z, up.x, up.y, up.z, orbit.yaw);
      aimBodyYaw = cave.root.rotation.y; aimBodyPitch = cave.parts.head.rotation.x;
      aimBodyHeadYaw = cave.parts.head.rotation.y;
      const x = aimEntry.x - p.x, z = aimEntry.z - p.z;
      const y = aimEntry.y - p.y + cave.baseY - cave.headOffset * 0.95 - cave.viewLift;
      aimEntryRadius = Math.hypot(x, z);
      aimEntryYaw = Math.atan2(x, z);
      aimEntryHeight = y;
    };
    const releaseCursorAim = () => {
      if (!aimAtCursor && !aimPreserveFacing) return;
      aimAtCursor = aimPreserveFacing = false;
      // A new look gesture takes over from the displayed eye and heading.
      // Reusing the old arc origin would jump sideways when its endpoint turns.
      const dx = camera.target.x - camera.position.x, dy = camera.target.y - camera.position.y, dz = camera.target.z - camera.position.z;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(-dy, Math.hypot(dx, dz));
      const changed = Math.abs(Math.atan2(Math.sin(yaw - orbit.yaw), Math.cos(yaw - orbit.yaw))) + Math.abs(pitch - orbit.pitch);
      orbit.yaw = orbit.tYaw = yaw;
      orbit.pitch = orbit.tPitch = pitch;
      if (aimMix === 1 && changed < 1e-4) return;
      captureAimEntry(player());
      carryCursor.rebaseAim();
      aimMix = aimVelocity = 0;
    };
    const syncAim = () => {
      const controlled = player(), battle = armed();
      reticle.hidden = !battle;
      if (!battle) setBattleTooltip(null);
      if (!orbitBattle()) resetOrbitAssist();
      if (!battle && (carryCursor.active || document.pointerLockElement === canvas)) unlockAim();
      const cave = aimView() ? controlled : null;
      if (cave === aimCave) return;
      if (carryCursor.active) {
        ads = false;
        if (controlled) crew.stopBurst(controlled);
        crew.releaseSwing(controlled, true);
        if (cave) { carryCursor.stop(); resetPointer(); }
      } else unlockAim();
      if (aimCave) {
        camera.near = savedNear;
        const p = aimCave.root.position;
        orbit.tx = p.x; orbit.ty = p.y - aimCave.baseY + follow.y + aimCave.viewLift; orbit.tz = p.z;
        if (!closeWanted) {
          // Rebase the displayed eye around the real follow anchor. A fake
          // focus below it would sink toward the body on the first exit frame.
          const dx = camera.position.x - orbit.tx, dy = camera.position.y - orbit.ty, dz = camera.position.z - orbit.tz;
          orbit.dist = Math.hypot(dx, dy, dz);
          orbit.yaw = Math.atan2(dx, dz);
          const behind = aimCave.root.rotation.y + Math.PI;
          orbit.tYaw = orbit.yaw + Math.atan2(Math.sin(behind - orbit.yaw), Math.cos(behind - orbit.yaw));
          orbit.pitch = Math.atan2(dy, Math.hypot(dx, dz));
          followTarget.x = orbit.tx; followTarget.y = orbit.ty; followTarget.z = orbit.tz;
          orbit.target = followTarget;
          carryExitMode = aimCave === player() && weaponViewReady(aimCave)
            ? ceilingAt && ceilingAt(p.x, p.z, p.y - aimCave.baseY, aimCave) < Infinity ? 1 : 2 : 0;
          carryFocusRemaining = carryExitMode ? CARRY_FOCUS_TIME : 0;
          carryExitBase = carryExitHeight = dy;
          carryExitVelocity = 0;
          closeMix = closeVelocity = 0;
          trailingPitchChosen = true;
          distanceVelocity = zoomPitchVelocity = 0;
          orbit.tPitch = Math.max(0.08, savedPitch); orbit.tDist = Math.max(orbit.dist, savedDist);
          viewRotation(cameraRotation, camera.target.x - camera.position.x, camera.target.y - camera.position.y, camera.target.z - camera.position.z, 0, 1, 0, orbit.yaw);
          closeCameraActive = true;
        }
        aimCave.weapon.aimYaw = 0;
      }
      aimCave = cave;
      clearFeedback();
      reticle.hidden = !battle;
      if (!cave) return;
      carryExitMode = 0;
      carryFocusRemaining = 0;
      savedPitch = orbit.tPitch; savedDist = orbit.tDist; savedNear = camera.near;
      captureAimEntry(cave);
      sleepingView = false;
      const dx = camera.target.x - camera.position.x, dy = camera.target.y - camera.position.y, dz = camera.target.z - camera.position.z;
      aimPreserveFacing = cursorOccluded && !closeWanted;
      aimAtCursor = cursorAim && !aimPreserveFacing && !closeWanted;
      orbit.yaw = orbit.tYaw = Math.atan2(-dx, -dz);
      orbit.pitch = orbit.tPitch = closeWanted ? Math.atan2(-dy, Math.hypot(dx, dz)) : SHOULDER_PITCH;
      shoulderSide = SHOULDER_SIDE;
      if (aimPreserveFacing) {
        // A wall in front of the orbit eye is an obstruction to navigation,
        // not an instruction to turn the character back toward that wall.
        orbit.yaw = orbit.tYaw = aimBodyYaw + aimBodyHeadYaw + Math.PI;
        orbit.pitch = orbit.tPitch = aimBodyPitch;
      } else if (aimAtCursor) {
        const h = cave.traits.height, p = cave.root.position;
        const x = cursorPoint.x - p.x, z = cursorPoint.z - p.z, horizontal = Math.hypot(x, z);
        // Keep a nearby target reachable by the offset camera; a target at
        // the character's feet needs less side offset than one across the island.
        const side = Math.min(SHOULDER_SIDE * h, horizontal * 0.5);
        shoulderSide = side / h;
        if (horizontal > 1e-6) orbit.yaw = orbit.tYaw = Math.atan2(-x, -z) + Math.asin(side / horizontal);
        const forward = Math.sqrt(Math.max(0, horizontal * horizontal - side * side));
        const y = p.y - cave.baseY + cave.headOffset * 0.95 + cave.viewLift + SHOULDER_LIFT * h - cursorPoint.y;
        // Solve the viewing angle from the safe shoulder eye. Aiming slightly
        // above eye level must not drag the physical boom under the character.
        let low = TRAILING_PITCH[0], high = TRAILING_PITCH[1];
        for (let i = 0; i < 32; i++) {
          const pitch = (low + high) * 0.5, boom = shoulderBoomPitch(pitch), distance = shoulderDistance(cave, pitch) * h;
          const look = Math.atan2(y + Math.sin(boom) * distance, forward + Math.cos(boom) * distance);
          if (pitch < look) low = pitch; else high = pitch;
        }
        orbit.pitch = orbit.tPitch = (low + high) * 0.5;
        // Preserve the selected point's screen position while the pointer
        // approaches the reticle. Camera translation and pan share this aim.
        mat4.lookAt(cursorView, camera.position, camera.target, camera.up || cursorUp);
        const rx = cursorPoint.x - camera.position.x, ry = cursorPoint.y - camera.position.y, rz = cursorPoint.z - camera.position.z;
        const depth = -(cursorView[2] * rx + cursorView[6] * ry + cursorView[10] * rz);
        const tangent = Math.tan(camera.fov * 0.5);
        aimScreenX = (cursorView[0] * rx + cursorView[4] * ry + cursorView[8] * rz) / depth / tangent / (renderer.size.width / renderer.size.height);
        aimScreenY = (cursorView[1] * rx + cursorView[5] * ry + cursorView[9] * rz) / depth / tangent;
      }
      cursorAim = cursorOccluded = false;
      aimMix = aimVelocity = adsMix = zoomPitchVelocity = 0;
      zoomTilt = false;
      // Carry an ongoing inward dolly into shoulder view instead of braking
      // to a stop just because the scroll crossed the camera-mode boundary.
      if (eyeMotionValid) {
        const h = cave.traits.height, sy = Math.sin(orbit.yaw), cy = Math.cos(orbit.yaw), boomPitch = shoulderBoomPitch(orbit.pitch);
        const distance = shoulderDistance(cave, orbit.pitch) * h * (1 - closeMix), side = shoulderSide * h * (1 - closeMix);
        const horizontal = Math.cos(boomPitch) * distance - Math.cos(orbit.pitch) * 0.16 * h * closeMix;
        const endX = sy * horizontal + cy * side, endZ = cy * horizontal - sy * side;
        const endY = Math.sin(boomPitch) * distance + SHOULDER_LIFT * h * (1 - closeMix);
        const radial = Math.hypot(endX, endZ) - aimEntryRadius;
        const yaw = Math.atan2(Math.sin(Math.atan2(endX, endZ) - aimEntryYaw), Math.cos(Math.atan2(endX, endZ) - aimEntryYaw));
        const es = Math.sin(aimEntryYaw), ec = Math.cos(aimEntryYaw);
        // Carry the incoming velocity along the arc's tangent, not a chord
        // through the character when the new target is off to one side.
        const vx = es * radial + aimEntryRadius * ec * yaw;
        const vy = endY - aimEntryHeight;
        const vz = ec * radial - aimEntryRadius * es * yaw;
        const length2 = vx * vx + vy * vy + vz * vz;
        if (length2 > 1e-8) aimVelocity = clamp(((eyeVelocity.x - anchorVelocity.x) * vx + (eyeVelocity.y - anchorVelocity.y) * vy + (eyeVelocity.z - anchorVelocity.z) * vz) / length2, 0, AIM_ENTRY_RATE);
      }
      headOrbit = exitAngleHold = entryOffsetActive = entryRebase = false;
      releaseMix = 0;
      camera.near = Math.min(savedNear, 0.06);
      hud.tooltip.hide();
    };
    // Resolve the viewing ray on a shot or cursor-directed entry. Bounded
    // bisection reuses terrain/prop sweeps without per-frame geometry scans.
    const pointAlongAim = (out, x, y, z, dx, dy, dz, reach = 60, clear = sightClear, iterations = 12) => {
      let lo = 0, hi = reach;
      if (clear && !clear(x, y, z, x + dx * hi, y + dy * hi, z + dz * hi)) {
        for (let i = 0; i < iterations; i++) {
          const mid = (lo + hi) * 0.5;
          if (clear(x, y, z, x + dx * mid, y + dy * mid, z + dz * mid)) lo = mid;
          else hi = mid;
        }
        hi = lo;
      } else hi = 60;
      out.x = x + dx * hi; out.y = y + dy * hi; out.z = z + dz * hi;
      if (aimSurface) aimSurface(out, x, y, z);
    };
    const spreadRadius = () => renderer.size.height * (SHOT_SPREAD + (ADS_SPREAD - SHOT_SPREAD) * adsMix) / (2 * Math.tan(camera.fov / 2));
    const orbitSpreadRadius = () => spreadRadius() * Math.min(ORBIT_SPREAD_MAX, Math.max(0.35, orbitTargetDistance / ORBIT_SPREAD_NEAR));
    const targetAlongAim = (out, x, y, z, dx, dy, dz) => {
      if (!input || !input.weaponTargets || !input.weaponTargets.ray(targetHit, x, y, z, dx, dy, dz, 60, player())) return false;
      const clear = sightClear || cursorClear, near = Math.max(0, targetHit.distance - 1e-5);
      // The real target must precede scenery padding, especially at grazing
      // angles. Exclude its own shell while keeping intervening cover solid.
      if (clear && !clear(x, y, z, x + dx * near, y + dy * near, z + dz * near, targetHit.node, true)) return false;
      out.x = targetHit.x; out.y = targetHit.y; out.z = targetHit.z;
      return true;
    };
    const aimTarget = (out, spread = false) => {
      if (orbitBattle()) {
        const cave = player();
        crew.weaponOrigin(targetOrigin, cave, false);
        if (orbitTargetActive) {
          if (!spread || orbitTargetClose) {
            out.x = orbitTargetHit.x; out.y = orbitTargetHit.y; out.z = orbitTargetHit.z;
            return;
          }
          const radius = orbitSpreadRadius() * Math.sqrt(-2 * Math.log(1 - Math.random() * SPREAD_MASS)) / 3;
          const angle = Math.random() * Math.PI * 2;
          mat4.lookAt(cursorView, camera.position, camera.target, camera.up || cursorUp);
          mat4.rayFromView(cursorRay, cursorView, renderer.size.width, renderer.size.height, camera.fov, camera.position,
            orbitTargetScreen.x + Math.cos(angle) * radius, orbitTargetScreen.y + Math.sin(angle) * radius);
          if (!targetAlongAim(out, cursorRay.ox, cursorRay.oy, cursorRay.oz, cursorRay.dx, cursorRay.dy, cursorRay.dz)) {
            pointAlongAim(out, cursorRay.ox, cursorRay.oy, cursorRay.oz, cursorRay.dx, cursorRay.dy, cursorRay.dz);
          }
          return;
        }
        const yaw = cave.root.rotation.y;
        out.x = targetOrigin.x + Math.sin(yaw) * 60;
        out.y = targetOrigin.y;
        out.z = targetOrigin.z + Math.cos(yaw) * 60;
        return;
      }
      if (spread) {
        // A circular Gaussian, truncated at three sigma so the ring bounds
        // the shot cone. Inverse sampling needs two draws and no retry loop.
        const radius = spreadRadius() * Math.sqrt(-2 * Math.log(1 - Math.random() * SPREAD_MASS)) / 3;
        const angle = Math.random() * Math.PI * 2;
        mat4.lookAt(cursorView, camera.position, camera.target, camera.up || cursorUp);
        mat4.rayFromView(cursorRay, cursorView, renderer.size.width, renderer.size.height, camera.fov, camera.position,
          renderer.size.width / 2 + Math.cos(angle) * radius, renderer.size.height / 2 + Math.sin(angle) * radius);
        if (!targetAlongAim(out, cursorRay.ox, cursorRay.oy, cursorRay.oz, cursorRay.dx, cursorRay.dy, cursorRay.dz)) {
          pointAlongAim(out, cursorRay.ox, cursorRay.oy, cursorRay.oz, cursorRay.dx, cursorRay.dy, cursorRay.dz);
        }
        return;
      }
      const p = camera.position, dx = camera.target.x - p.x, dy = camera.target.y - p.y, dz = camera.target.z - p.z;
      const length = Math.hypot(dx, dy, dz);
      if (!targetAlongAim(out, p.x, p.y, p.z, dx / length, dy / length, dz / length)) pointAlongAim(out, p.x, p.y, p.z, dx / length, dy / length, dz / length);
    };
    const resolveReticleTarget = (out, cave, primary) => {
      if (!input || !input.weaponTargets) return false;
      crew.weaponOrigin(targetOrigin, cave, primary);
      const eye = camera.position, dx = camera.target.x - eye.x, dy = camera.target.y - eye.y, dz = camera.target.z - eye.z;
      const length = Math.hypot(dx, dy, dz), reach = primary ? crew.meleeReach(cave) : 60;
      const eyeReach = reach + Math.hypot(eye.x - targetOrigin.x, eye.y - targetOrigin.y, eye.z - targetOrigin.z);
      if (!input.weaponTargets.ray(out, eye.x, eye.y, eye.z, dx / length, dy / length, dz / length, Math.min(60, eyeReach), cave)) return false;
      const mx = out.x - targetOrigin.x, my = out.y - targetOrigin.y, mz = out.z - targetOrigin.z;
      const distance = Math.hypot(mx, my, mz), near = Math.max(0, 1 - TARGET_MARGIN / Math.max(distance, TARGET_MARGIN));
      const cameraNear = Math.max(0, out.distance - TARGET_MARGIN) / length;
      const clear = sightClear || cursorClear;
      // Share the exact reach and cover checks between the reticle and a
      // released melee strike; a displayed orange target promises a hit.
      return distance <= reach && (!clear || clear(eye.x, eye.y, eye.z, eye.x + dx * cameraNear, eye.y + dy * cameraNear, eye.z + dz * cameraNear, out.node, true))
        && (!clear || clear(targetOrigin.x, targetOrigin.y, targetOrigin.z, targetOrigin.x + mx * near, targetOrigin.y + my * near, targetOrigin.z + mz * near, out.node, true));
    };
    const meleeTarget = (out, cave) => {
      if (cave !== player() || !armed() || !cave.weapon.primaryEquipped) return false;
      if (orbitBattle()) {
        if (!orbitTargetActive || orbitTargetDistance > crew.meleeReach(cave) || orbitTargetHit.type !== "object") return false;
        Object.assign(out, orbitTargetHit);
        return true;
      }
      return resolveReticleTarget(out, cave, true) && out.type === "object";
    };
    const updateFeedback = (cave, dt) => {
      if (hitRemaining > 0) {
        hitRemaining = Math.max(0, hitRemaining - dt);
        const strength = Math.round(hitRemaining / HIT_TIME * 100) / 100;
        if (strength !== hitStrength) {
          hitStrength = strength;
          reticle.style.setProperty("--reticle-hit", String(strength));
        }
        if (!hitRemaining) reticle.dataset.hit = "none";
      }
      targetWait -= dt;
      const primary = cave.weapon.primaryEquipped;
      if (targetWait > 0 && primary === targetPrimary) {
        setBattleTooltip(orbitBattle() ? orbitTargetActive ? orbitTargetHit : null : targetActive ? targetHit : null);
        return;
      }
      targetWait = TARGET_INTERVAL;
      targetPrimary = primary;
      if (orbitBattle()) {
        targetFeedback(orbitTargetActive ? orbitTargetHit.type : "none");
        setBattleTooltip(orbitTargetActive ? orbitTargetHit : null);
        return;
      }
      targetActive = resolveReticleTarget(targetHit, cave, primary);
      targetFeedback(targetActive ? targetHit.type : "none");
      setBattleTooltip(targetActive ? targetHit : null);
    };
    const positionReticle = (x, y) => {
      x = Math.round(x * 100) / 100; y = Math.round(y * 100) / 100;
      if (x !== orbitReticleX) { orbitReticleX = x; reticle.style.left = `${x}px`; }
      if (y !== orbitReticleY) { orbitReticleY = y; reticle.style.top = `${y}px`; }
    };
    const resetOrbitAssist = () => {
      orbitTargetActive = orbitTargetClose = false;
      orbitTargetDistance = Infinity;
      orbitTargetWait = 0;
      if (!Number.isNaN(orbitReticleX)) {
        orbitReticleX = orbitReticleY = NaN;
        reticle.style.removeProperty("left");
        reticle.style.removeProperty("top");
      }
      if (reticle.dataset.close !== "false") reticle.dataset.close = "false";
    };
    const orbitAutoTarget = (owner, node) => !!(owner && (owner.kind === "caveman" || owner.kind === "room-sign"
      || owner.kind === "prop" && ORBIT_AUTO_PROPS.has(owner.prop)) || node && node.mirror);
    const centerOrbitTarget = (hit) => {
      const owner = hit.owner, node = hit.node;
      if (!owner || !node) return;
      if (node.mirrorDamage?.aimCenter && node.mirrorDamage.aimCenter(hit, hit.x, hit.y, hit.z)) return;
      if (owner.kind === "caveman") {
        const target = owner.cave, p = target.root.position;
        hit.x = p.x; hit.y = p.y - target.baseY + target.bodyHeight * 0.5; hit.z = p.z;
        return;
      }
      const bounds = boundsOf(node.geometry);
      mat4.transformPoint(orbitCenter, node.world, (bounds.min[0] + bounds.max[0]) * 0.5,
        (bounds.min[1] + bounds.max[1]) * 0.5, (bounds.min[2] + bounds.max[2]) * 0.5);
      hit.x = orbitCenter[0]; hit.y = orbitCenter[1]; hit.z = orbitCenter[2];
    };
    const updateOrbitBattle = (cave, dt) => {
      const p = cave.root.position, h = cave.traits.height, heading = orbit.yaw + Math.PI;
      const dx = Math.sin(heading), dz = Math.cos(heading), y = p.y + h * 0.45;
      const reach = cave.weapon.primaryEquipped ? crew.meleeReach(cave) : 60;
      orbitTargetWait -= dt;
      if (orbitTargetWait <= 0) {
        orbitTargetWait = TARGET_INTERVAL;
        orbitTargetActive = !!(input && input.weaponTargets
          && input.weaponTargets.verticalRay(orbitTargetHit, p.x, y, p.z, dx, dz, reach, cave, sightClear || cursorClear, orbitAutoTarget));
        if (orbitTargetActive) centerOrbitTarget(orbitTargetHit);
      }
      let pitch = 0;
      if (orbitTargetActive) {
        const tx = orbitTargetHit.x - p.x, ty = orbitTargetHit.y - y, tz = orbitTargetHit.z - p.z;
        orbitTargetDistance = Math.hypot(tx, ty, tz);
        orbitTargetClose = orbitTargetDistance <= h * ORBIT_CLOSE_HIT;
        pitch = -Math.atan2(ty, Math.hypot(tx, tz));
        mat4.lookAt(cursorView, camera.position, camera.target, camera.up || cursorUp);
        mat4.transformPoint(orbitProjection, cursorView, orbitTargetHit.x, orbitTargetHit.y, orbitTargetHit.z);
        if (orbitProjection[2] < -0.01) {
          const focal = renderer.size.height / (2 * Math.tan(camera.fov / 2));
          orbitTargetScreen.x = renderer.size.width / 2 + orbitProjection[0] * focal / -orbitProjection[2];
          orbitTargetScreen.y = renderer.size.height / 2 - orbitProjection[1] * focal / -orbitProjection[2];
          positionReticle(orbitTargetScreen.x, orbitTargetScreen.y);
        }
      } else {
        orbitTargetClose = false;
        orbitTargetDistance = ORBIT_SPREAD_NEAR;
        orbitTargetScreen.x = renderer.size.width / 2;
        orbitTargetScreen.y = renderer.size.height / 2;
        positionReticle(orbitTargetScreen.x, orbitTargetScreen.y);
      }
      const close = String(orbitTargetActive && orbitTargetClose);
      if (reticle.dataset.close !== close) reticle.dataset.close = close;
      const radius = Math.round((orbitTargetActive ? orbitSpreadRadius() : spreadRadius()) * 100) / 100;
      if (radius !== reticleRadius) {
        reticleRadius = radius;
        reticle.style.setProperty("--reticle-radius", `${radius}px`);
      }
      crew.look(heading, pitch, 1);
      cave.weapon.aimYaw = 0;
      cave.weapon.aimPitch = pitch;
      crew.poseWeapon(cave);
      updateFeedback(cave, dt);
    };
    const aimMouseMove = (e) => {
      if (!armed() || document.pointerLockElement !== canvas && (!softAimFocused || e.target !== canvas)) return;
      if (e.movementX || e.movementY) resumePose();
      if (e.movementX || e.movementY) releaseCursorAim();
      const sensitivity = ads ? 0.0015 : 0.0025;
      orbit.yaw = orbit.tYaw -= e.movementX * sensitivity;
      orbit.pitch = orbit.tPitch = clamp(orbit.tPitch + e.movementY * sensitivity, TRAILING_PITCH[0], TRAILING_PITCH[1]);
    };
    // Mouse and trackpad taps expose the same buttons. Classify the release
    // by its held duration, shared with the displayed charge and HUD button.
    const releasePrimary = (cave, focused = null) => crew.releaseSwing(cave, false, focused,
      !!cave && cave.weapon.meleeHeldTime < BL.crew.MELEE_TAP_TIME);
    const aimPointer = (e) => {
      if (e.pointerType !== "mouse") return;
      if (!armed()) {
        if (!weaponViewReady(player()) || e.button !== 2 || !(e.type === "pointerdown" || e.type === "pointermove" && (e.buttons & 2))) return;
        e.preventDefault(); e.stopImmediatePropagation();
        const cave = player();
        cave.weapon.aiming = true;
        if (!closeWanted) {
          const rect = canvas.getBoundingClientRect();
          shooterView(true, e.clientX - rect.left, e.clientY - rect.top, true);
        } else {
          syncAim();
          syncModeHud();
          syncWeaponHud();
          lockAim();
        }
        return;
      }
      if (orbitBattle() && e.button === 2 && e.type === "pointerdown") {
        e.preventDefault(); e.stopImmediatePropagation();
        shooterView(true, renderer.size.width / 2, renderer.size.height / 2);
        return;
      }
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.type === "pointercancel") {
        ads = false;
        aimLeftAccepted = aimLeftFocused = false;
        const cave = player();
        crew.stopBurst(cave);
        crew.releaseSwing(cave, true);
        return;
      }
      if (e.button !== 0 && e.button !== 2) return;
      // While another mouse button is held, presses and releases arrive as
      // pointermove with the changed button, not pointerdown / pointerup.
      const pressed = e.type === "pointerdown" || e.type === "pointermove" && (e.buttons & (e.button === 0 ? 1 : 2));
      if (pressed) {
        // An ordinary capture click never attacks. A page that loaded already
        // focused in first person upgrades to pointer lock without swallowing
        // the click because mouse-look was active before the gesture.
        if (document.pointerLockElement !== canvas) {
          const alreadyFocused = softAimFocused;
          lockAim();
          if (!alreadyFocused) return;
        }
        resumePose();
        if (e.button === 0) {
          if (player().weapon.primaryEquipped) crew.swingWeapon(player(), true, ads);
          else {
            const w = player().weapon, before = w.shotsFired + w.triggerQueued;
            aimLeftFocused = ads;
            weaponAction("weapon-fire", true);
            aimLeftAccepted = !ads || w.shotsFired + w.triggerQueued > before;
          }
        }
        if (e.button === 2) ads = true;
      } else if (e.type === "pointerup" || e.type === "pointermove") {
        if (e.button === 0) {
          releaseAimAttack(e);
          releasePrimary(player(), ads);
        }
        if (e.button === 2) ads = false;
      }
    };
    const aimKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest && e.target.closest("input, textarea, dialog")) return;
      if (!armed()) {
        if (carryCursor.active && (e.key === "Escape" || e.key === "Tab") || e.key === "Escape" && performance.now() - cursorUnlockedAt < 100) {
          e.preventDefault(); e.stopImmediatePropagation(); unlockAim();
        }
        return;
      }
      if (e.key === "Escape" && (document.pointerLockElement === canvas || performance.now() - unlockedAt < 100) || e.key === "Tab") {
        e.preventDefault(); e.stopImmediatePropagation(); unlockAim();
      } else if (e.key.toLowerCase() === "r" && !e.shiftKey && player().weapon.equipped) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!e.repeat) weaponAction("magazine-swap");
      }
    };
    const releaseAimAttack = (e) => {
      if (!crew || aimReleaseEvent === e) return;
      aimReleaseEvent = e;
      const cave = player(), focused = aimLeftFocused || ads;
      // Chorded mouse buttons do not consistently emit a second pointerdown:
      // some browsers report only the release while right-click remains held.
      // Count that release as the click only when its press did not already
      // fire or queue a focused single shot.
      if (cave && cave.weapon.equipped && focused && !aimLeftAccepted && armed()) crew.setWeaponTrigger(true, true);
      crew.setWeaponTrigger(false);
      aimLeftAccepted = aimLeftFocused = false;
    };
    const aimMouseUp = (e) => {
      if (e.target.closest && e.target.closest(".equipment-hud")) return;
      if (e.button === 0 && crew) { releaseAimAttack(e); releasePrimary(player(), ads); }
      if (e.button === 2) ads = false;
    };
    const aimLockChanged = () => {
      lockPending = false;
      const locked = document.pointerLockElement === canvas;
      if (locked) setSoftAimFocus(false);
      if (aimLocked && !locked) unlockedAt = performance.now();
      aimLocked = locked;
      if (!locked) {
        ads = false;
        aimLeftAccepted = aimLeftFocused = false;
        carryCursor.endAim();
        if (crew) {
          const cave = player();
          if (cave) crew.stopBurst(cave);
          crew.releaseSwing(cave, true);
        }
        if (carryCursor.active) {
          cursorUnlockedAt = performance.now();
          carryCursor.stop();
          resetPointer();
        }
      } else if (disposed || !(armed() || carryCursor.active)) document.exitPointerLock();
      if (disposed) retireAimLock();
    };
    window.addEventListener("mousemove", aimMouseMove);
    window.addEventListener("pointerup", aimMouseUp);
    window.addEventListener("keydown", aimKey, true);
    window.addEventListener("blur", unlockAim);
    document.addEventListener("pointerlockchange", aimLockChanged);
    document.addEventListener("pointerlockerror", aimLockFailed);
    canvas.addEventListener("pointerdown", aimPointer, true);
    canvas.addEventListener("pointermove", aimPointer, true);
    canvas.addEventListener("pointerup", aimPointer, true);
    canvas.addEventListener("pointercancel", aimPointer, true);

    const resetGroundView = () => {
      freeEntry = false;
      const cave = player();
      if (cave) crew.elevate(0);
      groundView = groundTarget = groundLift = 0;
      groundEasing = false;
      groundValid = false;
      resetFreeFall();
    };
    const restoreHead = () => {
      if (!hiddenHead) return;
      hiddenHead.parts.head.cameraHidden = hiddenHeadCameraHidden;
      hiddenHead = null;
    };
    const hideHead = (cave) => {
      if (hiddenHead === cave) return;
      restoreHead();
      hiddenHead = cave;
      hiddenHeadCameraHidden = cave.parts.head.cameraHidden;
      cave.parts.head.cameraHidden = true;
    };
    const includeHeadPart = (node) => {
      if (!node.visible) return;
      if (node.geometry) {
        const b = boundsOf(node.geometry), m = headPartMatrix;
        mat4.multiply(m, headInverse, node.world);
        const cx = b.center[0], cy = b.center[1], cz = b.center[2];
        const hx = (b.max[0] - b.min[0]) * 0.5, hy = (b.max[1] - b.min[1]) * 0.5, hz = (b.max[2] - b.min[2]) * 0.5;
        for (let axis = 0; axis < 3; axis++) {
          const center = m[axis] * cx + m[axis + 4] * cy + m[axis + 8] * cz + m[axis + 12];
          const extent = Math.abs(m[axis]) * hx + Math.abs(m[axis + 4]) * hy + Math.abs(m[axis + 8]) * hz;
          headBounds[axis] = Math.min(headBounds[axis], center - extent);
          headBounds[axis + 3] = Math.max(headBounds[axis + 3], center + extent);
        }
      }
      for (const child of node.children) includeHeadPart(child);
    };
    const syncHeadVisibility = (cave) => {
      if (!cave) { restoreHead(); return; }
      // The near plane can expose interior faces before the eye enters.
      // Include the whole head subtree so hats and masks cannot flash either.
      updateWorld(cave.root, cave.root.parent ? cave.root.parent.world : undefined);
      const head = cave.parts.head;
      mat4.invert(headInverse, head.world);
      headBounds[0] = headBounds[1] = headBounds[2] = Infinity;
      headBounds[3] = headBounds[4] = headBounds[5] = -Infinity;
      includeHeadPart(head);
      mat4.transformPoint(headEye, headInverse, camera.position.x, camera.position.y, camera.position.z);
      if (headEye[0] >= headBounds[0] && headEye[0] <= headBounds[3]
        && headEye[1] >= headBounds[1] && headEye[1] <= headBounds[4]
        && headEye[2] >= headBounds[2] && headEye[2] <= headBounds[5]) { hideHead(cave); return; }
      let fx = camera.target.x - camera.position.x, fy = camera.target.y - camera.position.y, fz = camera.target.z - camera.position.z;
      const length = Math.hypot(fx, fy, fz);
      fx /= length; fy /= length; fz /= length;
      const up = camera.up, ux = up ? up.x : 0, uy = up ? up.y : 1, uz = up ? up.z : 0;
      let rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux;
      const rightLength = Math.hypot(rx, ry, rz);
      rx /= rightLength; ry /= rightLength; rz /= rightLength;
      const vx = ry * fz - rz * fy, vy = rz * fx - rx * fz, vz = rx * fy - ry * fx;
      const halfH = camera.near * Math.tan(camera.fov * 0.5), halfW = halfH * renderer.size.width / Math.max(1, renderer.size.height);
      mat4.transformPoint(headNear, headInverse, camera.position.x + fx * camera.near, camera.position.y + fy * camera.near, camera.position.z + fz * camera.near);
      for (let axis = 0; axis < 3; axis++) {
        const m = headInverse;
        const extent = Math.abs(m[axis] * rx + m[axis + 4] * ry + m[axis + 8] * rz) * halfW
          + Math.abs(m[axis] * vx + m[axis + 4] * vy + m[axis + 8] * vz) * halfH;
        if (headNear[axis] + extent < headBounds[axis] || headNear[axis] - extent > headBounds[axis + 3]) { restoreHead(); return; }
      }
      hideHead(cave);
    };
    const setFreeEye = () => {
      resetFreeFall();
      const eyeHeight = close.eyeHeight;
      freeTarget.x = camera.position.x;
      freeTarget.z = camera.position.z;
      freeFloorY = close.groundAt(freeTarget.x, freeTarget.z, camera.position.y - eyeHeight);
      freeTarget.y = Math.max(camera.position.y, freeFloorY + eyeHeight);
      freeFeetY = freeTarget.y - eyeHeight;
      freeFallValid = true;
      freeFalling = freeFeetY - freeFloorY > WALK.step;
      const cave = player();
      if (freeFalling && cave) {
        freeFallV = cave.hopV;
        freeLeapX = cave.leap.vx;
        freeLeapZ = cave.leap.vz;
      }
      clampTarget(freeTarget);
      orbit.target = freeTarget;
    };
    const faceWith = (cave) => {
      closeCave = cave;
      entryPosition.x = camera.position.x; entryPosition.y = camera.position.y; entryPosition.z = camera.position.z;
      entryRebase = true;
      carryDollyVelocity();
      closeRate = 10;
      entryOffsetActive = false;
      closeMix = closeVelocity = 0;
      headOrbit = exitAngleHold = false;
      // The physical boom and close-distance flattening can differ from the
      // requested orbit. Enter along the direction actually on screen.
      const dx = camera.target.x - camera.position.x, dy = camera.target.y - camera.position.y, dz = camera.target.z - camera.position.z, up = camera.up;
      viewRotation(cameraRotation, dx, dy, dz, up ? up.x : 0, up ? up.y : 1, up ? up.z : 0, orbit.yaw);
      orbit.yaw = orbit.tYaw = Math.atan2(-dx, -dz);
      orbit.pitch = orbit.tPitch = Math.atan2(-dy, Math.hypot(dx, dz));
      closeCameraActive = true;
      sleepingView = !!(cave && crew.sleeping && cave.root.quaternion);
      if (sleepingView) {
        // Keep the approach as an offset from this pose; a later roll still
        // carries the head and view together without moving the sleeping body.
        const q = cave.root.quaternion;
        inverseRotation[0] = -q[0]; inverseRotation[1] = -q[1]; inverseRotation[2] = -q[2]; inverseRotation[3] = q[3];
        quat.multiply(sleepViewRotation, inverseRotation, cameraRotation);
        sleepYaw = orbit.yaw; sleepPitch = orbit.pitch;
      } else {
        viewRotation(headRotation, dx, dy, dz, 0, 1, 0, orbit.yaw);
        inverseRotation[0] = -headRotation[0]; inverseRotation[1] = -headRotation[1]; inverseRotation[2] = -headRotation[2]; inverseRotation[3] = headRotation[3];
        quat.multiply(entryRoll, inverseRotation, cameraRotation);
      }
    };
    const enterClose = (battle = false) => {
      if (!close || closeWanted) return;
      closeWanted = true;
      shoulderView = false;
      closeExitScale = 1;
      const cave = player();
      if (battle && weaponViewReady(cave)) cave.weapon.aiming = true;
      syncAim();
      if (aimView()) {
        releaseCursorAim();
        headOrbit = exitAngleHold = entryOffsetActive = entryRebase = false;
        return;
      }
      if (cave) faceWith(cave);
      else {
        // Finish zooming to the displayed focal point before walking physics
        // takes over. Resolve an embedded destination before the dolly, so
        // recovery cannot teleport the eye when it reaches first person.
        freeTarget.x = headOrbit ? orbit.tx : camera.target.x;
        freeTarget.y = headOrbit ? orbit.ty : camera.target.y;
        freeTarget.z = headOrbit ? orbit.tz : camera.target.z;
        if (ctx.enterFreeView) ctx.enterFreeView(freeTarget);
        freeTarget.y = Math.max(freeTarget.y, close.groundAt(freeTarget.x, freeTarget.z, freeTarget.y - close.eyeHeight) + close.eyeHeight);
        clampTarget(freeTarget);
        orbit.target = freeTarget;
        resetFreeFall();
        faceWith(null);
        headOrbit = freeEntry = true;
      }
    };
    const exitClose = () => {
      if (!closeWanted) return;
      shoulderView = !!player();
      if (aimView()) {
        closeWanted = false;
        closeExitScale = 1;
        headOrbit = exitAngleHold = entryOffsetActive = entryRebase = false;
        closeCave = null;
        return;
      }
      freeEntry = false;
      if (closeMix < 1) carryDollyVelocity(true);
      else dollyTime = DOLLY_HANDOFF;
      closeRate = closeMix < 1 ? 10 : CLOSE_RATE;
      distanceVelocity = 0;
      const cave = player(), up = camera.up, dx = camera.target.x - camera.position.x, dy = camera.target.y - camera.position.y, dz = camera.target.z - camera.position.z;
      if (dollyTime < DOLLY_HANDOFF) {
        // Outward zoom changes distance along the held viewing ray. Keep its
        // longitudinal velocity without carrying a fading sideways head turn.
        const along = (dollyVelocity.x * dx + dollyVelocity.y * dy + dollyVelocity.z * dz) / (dx * dx + dy * dy + dz * dz);
        dollyVelocity.x = dx * along; dollyVelocity.y = dy * along; dollyVelocity.z = dz * along;
      }
      viewRotation(cameraRotation, dx, dy, dz, up ? up.x : 0, up ? up.y : 1, up ? up.z : 0, orbit.yaw);
      orbit.yaw = orbit.tYaw = Math.atan2(-dx, -dz);
      orbit.pitch = orbit.tPitch = Math.atan2(-dy, Math.hypot(dx, dz));
      viewRotation(headRotation, dx, dy, dz, 0, 1, 0, orbit.yaw);
      inverseRotation[0] = -headRotation[0]; inverseRotation[1] = -headRotation[1]; inverseRotation[2] = -headRotation[2]; inverseRotation[3] = headRotation[3];
      quat.multiply(entryRoll, inverseRotation, cameraRotation);
      // Zoom back on the ray already being viewed, including its roll. The
      // starting eye becomes the head-relative orbit anchor, so only distance
      // changes even when collision previously displaced that eye slightly.
      if (cave) {
        headAnchor(cave, followTarget);
        headOrbitOffset.x = camera.position.x - followTarget.x; headOrbitOffset.y = camera.position.y - followTarget.y; headOrbitOffset.z = camera.position.z - followTarget.z;
        followTarget.x = camera.position.x; followTarget.y = camera.position.y; followTarget.z = camera.position.z;
        orbit.target = followTarget;
      } else {
        freeTarget.x = camera.position.x; freeTarget.y = camera.position.y; freeTarget.z = camera.position.z;
        orbit.target = freeTarget;
      }
      orbit.tx = orbit.target.x; orbit.ty = orbit.target.y; orbit.tz = orbit.target.z;
      const body = cave ? cave.root.position : freeTarget;
      exitBodyX = body.x; exitBodyY = body.y; exitBodyZ = body.z;
      headOrbit = exitAngleHold = closeCameraActive = trailingPitchChosen = true;
      releaseMix = 0;
      closeWanted = false;
      syncHeadVisibility(cave);
      // The new orbit starts at the displayed eye, including an interrupted
      // entry. Begin its outward dolly there without changing that position.
      closeMix = 1;
      closeVelocity = 0;
      entryRebase = entryOffsetActive = false;
      closeExitScale = 1;
      closeCave = null;
      resetFreeFall();
      orbit.tDist = clamp(cave ? close.trailingDist : close.orbitDist, DIST_MIN, DIST_MAX);
      if (cave && crew.sleeping) crew.look(0, 0, 0);
    };
    // ---------- possession ----------
    // Relabel the act button for what the press does
    const syncJetpackHud = () => {
      const cave = player(), status = ctx.jetpackStatus && ctx.jetpackStatus(cave);
      if (status) hud.setJetpack(status.owned, status.equipped, status.fuel, status.blocked);
      else hud.setJetpack(!!(cave && cave.jet), !!(cave && cave.jet), cave ? cave.jetFuel : 0);
    };
    const syncModeHud = () => {
      if (hud.setMode) hud.setMode(player(), armed(), viewMode());
    };
    let reloadPrompt = false;
    const syncWeaponHud = () => {
      const cave = player(), weapon = cave && cave.weapon;
      const ready = !!weapon && !crew.sleeping && !cave.camp.seat && !cave.bedTravel.mode;
      const primaryReady = ready && weapon.primaryOwned;
      const secondaryReady = ready && weapon.secondaryOwned;
      if (primaryButtonCave && (primaryButtonCave !== cave || !primaryReady || !weapon.primaryEquipped)) {
        crew.releaseSwing(primaryButtonCave, true);
        primaryButtonCave = null;
      }
      const reload = secondaryReady && weapon.equipped && crew.canReload(cave);
      hud.setPrimary(primaryReady, !!weapon && !weapon.equipped, primaryReady ? cave.parts.club.geometry : null,
        weapon ? weapon.meleeCharge : 0, !!weapon && weapon.meleeHeld,
        weapon && weapon.meleeTime > 0 && !(weapon.meleeHeld && weapon.meleeHeldTime < BL.crew.MELEE_TAP_TIME)
          ? weapon.meleePower : 0.5, !!weapon && weapon.aiming);
      hud.setWeapon(secondaryReady, !!weapon && weapon.equipped, weapon ? weapon.ammo : 0, !!weapon && weapon.reloading, reload, !!weapon && weapon.unlimited);
      const count = secondaryReady && crew ? crew.magazineCount(cave) : 0, canSwap = !!crew && secondaryReady && crew.canSwapMagazine(cave);
      hud.setMagazine(count, crew ? crew.magazineAmmo(cave, 0) : 0, crew ? crew.magazineAmmo(cave, 1) : 0, canSwap,
        weapon && weapon.reloading && weapon.reloadSpare ? weapon.reloadMagazine : -1);
      if (reload && !weapon.reloading) {
        hud.setAct("RELOAD +6");
        reloadPrompt = true;
      } else if (reloadPrompt) {
        reloadPrompt = false;
        showAct();
      }
    };
    const showAct = () => {
      const cave = player();
      if (cave) hud.setAct(cave.camp.burning ? "DROP & ROLL!" : cave.camp.seat ? "STAND UP!" : crew.sleeping ? "WAKE UP!" : cave.jet && !cave.jetRecovering ? ACT_FLY : ACT_DO);
      syncModeHud();
      syncJetpackHud();
    };
    const weaponAction = (action, held = false) => {
      if (action === "weapon-primary-up" || action === "weapon-primary-cancel") {
        if (primaryButtonCave) {
          if (action === "weapon-primary-cancel") crew.releaseSwing(primaryButtonCave, true);
          else releasePrimary(primaryButtonCave);
        }
        primaryButtonCave = null;
        if (crew) syncWeaponHud();
        return true;
      }
      const cave = player();
      if (!cave || crew.sleeping) return false;
      resumePose();
      if (action === "weapon-primary" || action === "weapon-primary-down") {
        const alreadyHeld = !cave.weapon.equipped;
        if (!cave.weapon.primaryEquipped) {
          crew.selectWeapon(1, cave);
          syncAim();
        }
        if (alreadyHeld && (!armed() || closeWanted)) {
          const charge = action === "weapon-primary-down";
          if (crew.swingWeapon(cave, true)) {
            if (charge) primaryButtonCave = cave;
            else releasePrimary(cave);
          }
        }
      } else if (action === "weapon-secondary") {
        if (!cave.weapon.equipped) {
          crew.selectWeapon(2, cave);
          syncAim();
        } else {
          // Navigation looks back toward the character. A HUD shot follows
          // the character's facing instead of that unrelated orbit-camera ray.
          let target = null;
          if (!armed()) {
            const p = cave.root.position, yaw = cave.root.rotation.y;
            const dx = Math.sin(yaw), dz = Math.cos(yaw), y = p.y + cave.traits.height * 0.45;
            if (input && input.weaponTargets.verticalRay(targetHit, p.x, y, p.z, dx, dz, 60, cave, sightClear || cursorClear, orbitAutoTarget)) {
              centerOrbitTarget(targetHit);
              buttonTarget.x = targetHit.x; buttonTarget.y = targetHit.y; buttonTarget.z = targetHit.z;
            } else {
              buttonTarget.x = p.x + dx * 60;
              buttonTarget.y = y;
              buttonTarget.z = p.z + dz * 60;
            }
            target = buttonTarget;
          }
          if (!crew.fireWeapon(cave, target, ads ? 1 : undefined) && !cave.weapon.unlimited && !cave.weapon.ammo) hud.hint("Empty magazine · press Space within reach of the pile to reload");
        }
      } else if (action === "weapon-toggle") {
        crew.toggleWeapon(cave);
        syncAim();
        if (armed() && cave.weapon.equipped) lockAim();
        if (cave.weapon.equipped) hud.hint(armed() ? "Left-click bursts · hold right-click for single-shot aim · 1 melee · 2 AK · scroll to change view · Space reloads or jumps / jetpacks" : "AK equipped · right-click or scroll in to aim · 1 melee · Space reloads beside the pile or jumps / jetpacks");
        else hud.hint(armed() ? "Hold left-click to raise the club · release to strike · right-click focuses a harder swing · 2 AK · scroll out for navigation" : "Club equipped · right-click or scroll in to aim · 2 AK");
      } else if (action === "weapon-fire") {
        if (cave.weapon.primaryEquipped) crew.swingWeapon(cave, false, ads);
        else if (!(held ? crew.setWeaponTrigger(true, ads) : crew.fireWeapon(cave, null, ads ? 1 : undefined)) && cave.weapon.equipped && !cave.weapon.unlimited && !cave.weapon.ammo) hud.hint("Empty magazine · press Space within reach of the pile to reload");
      } else if (action === "magazine-swap" || action === "weapon-magazine") {
        if (!crew.swapMagazine(cave) && !crew.hasMagazine(cave)) hud.hint("Find a spare magazine · Space reloads the AK and both spares beside the pile");
      } else return false;
      syncWeaponHud();
      return true;
    };
    const weaponMode = (slot) => {
      const cave = player();
      if (!cave) return false;
      if (slot === 0) return true;
      resumePose();
      if (!crew.selectWeapon(slot, cave)) return true;
      ads = false;
      syncAim();
      if (armed()) lockAim();
      syncWeaponHud();
      hud.hint(armed() ? slot === 1 ? "Hold left-click to raise the club · release to strike · right-click focuses a harder swing · 2 AK · scroll out for navigation" : "Left-click bursts · hold right-click for single-shot aim · 1 melee · scroll out for navigation · Space reloads beside the pile" : "1 melee · 2 AK · right-click or scroll in to aim · Space reloads beside the pile or jumps / jetpacks");
      return true;
    };
    const shooterView = (active, px = null, py = null, battle = null) => {
      resumePose();
      const cave = player();
      if (!weaponViewReady(cave)) return;
      if (active && orbitBattle() && orbitTargetActive && !closeWanted) {
        cursorPoint.x = orbitTargetHit.x; cursorPoint.y = orbitTargetHit.y; cursorPoint.z = orbitTargetHit.z;
        cursorOccluded = false;
        cursorAim = true;
      } else if (active && px !== null && py !== null && !closeWanted) {
        mat4.lookAt(cursorView, camera.position, camera.target, camera.up || cursorUp);
        mat4.rayFromView(cursorRay, cursorView, renderer.size.width, renderer.size.height, camera.fov, camera.position, px, py);
        // Navigation can place the eye farther away than a weapon's range.
        // Reach across the island from that eye, not just sixty units into
        // the air above the floor, then retain that world point throughout.
        const position = cave.root.position;
        const reach = Math.max(60, Math.hypot(camera.position.x - position.x, camera.position.y - position.y, camera.position.z - position.z) + DIST_MAX);
        pointAlongAim(cursorPoint, cursorRay.ox, cursorRay.oy, cursorRay.oz, cursorRay.dx, cursorRay.dy, cursorRay.dz, reach, cursorClear, 18);
        const hitDepth = Math.hypot(cursorPoint.x - cursorRay.ox, cursorPoint.y - cursorRay.oy, cursorPoint.z - cursorRay.oz);
        const p = cave.root.position, headY = p.y - cave.baseY + cave.headOffset * 0.95 + cave.viewLift;
        const actorDepth = (p.x - cursorRay.ox) * cursorRay.dx + (headY - cursorRay.oy) * cursorRay.dy + (p.z - cursorRay.oz) * cursorRay.dz;
        // Classify only on entry, using the same solids as the aim ray. A
        // surface nearer than the character must also obstruct their head;
        // visible targets beyond the character retain normal cursor aiming.
        cursorOccluded = hitDepth < actorDepth - cave.traits.height * 0.25 && !!sightClear
          && !sightClear(cursorRay.ox, cursorRay.oy, cursorRay.oz, p.x, headY, p.z);
        if (hitDepth < 0.1) {
          // An orbit eye inside scenery has no surface in front of its ray.
          // Do not turn that zero-depth hit into a target behind the character.
          cursorPoint.x = cursorRay.ox + cursorRay.dx * reach;
          cursorPoint.y = cursorRay.oy + cursorRay.dy * reach;
          cursorPoint.z = cursorRay.oz + cursorRay.dz * reach;
        }
        if (input && input.aimPoint(px, py, cursorItem, cave)) {
          const solidDepth = Math.hypot(cursorPoint.x - cursorRay.ox, cursorPoint.y - cursorRay.oy, cursorPoint.z - cursorRay.oz);
          const itemDepth = Math.hypot(cursorItem.x - cursorRay.ox, cursorItem.y - cursorRay.oy, cursorItem.z - cursorRay.oz);
          const forwardDepth = -(cursorView[2] * (cursorItem.x - cursorRay.ox) + cursorView[6] * (cursorItem.y - cursorRay.oy) + cursorView[10] * (cursorItem.z - cursorRay.oz));
          if (forwardDepth > 0.1 && itemDepth <= solidDepth + 0.1) {
            cursorPoint.x = cursorItem.x; cursorPoint.y = cursorItem.y; cursorPoint.z = cursorItem.z;
          }
        }
        cursorAim = true;
      }
      if (active && !cave.weapon.equipped && !cave.weapon.primaryEquipped) crew.selectWeapon(cave.weapon.selectedSlot, cave);
      shoulderView = active && !closeWanted;
      if (battle !== null) cave.weapon.aiming = battle;
      if (!active) {
        closeWanted = false;
        crew.releaseSwing(cave, true);
        crew.stopBurst(cave);
        if (!coarse) {
          resetPointer();
          if (armed()) carryCursor.stop();
          else carryCursor.start();
        }
      }
      syncAim();
      if (active) {
        if (armed() && !coarse && px !== null && py !== null && !closeWanted) {
          const rect = canvas.getBoundingClientRect();
          carryCursor.beginAim(rect.left + px, rect.top + py);
        }
        if (armed()) lockAim();
      } else {
        if (armed()) lockAim();
        zoomTilt = false;
        zoomPitchVelocity = 0;
        orbit.tDist = Math.max(orbit.dist, clamp(close ? close.trailingDist : savedDist, follow.min, follow.max));
        restoreHead();
      }
      crew.poseWeapon(cave);
      syncWeaponHud();
      syncModeHud();
    };
    const modeAction = (action) => {
      const cave = player();
      if (action === "mode-release") {
        if (cave) release();
        return !!cave;
      }
      if (action !== "mode-toggle" || !cave) return false;
      if (!weaponViewReady(cave)) {
        hud.hint(crew.sleeping ? "Wake this Ooga Booga before entering shooter mode" : "Stand up before entering shooter mode");
        return true;
      }
      cave.weapon.aiming = !cave.weapon.aiming;
      if (!cave.weapon.aiming) {
        crew.stopBurst(cave);
        crew.releaseSwing(cave, true);
        unlockAim();
      } else {
        focusAim();
        lockAim();
      }
      crew.poseWeapon(cave);
      syncAim();
      syncWeaponHud();
      syncModeHud();
      return true;
    };
    const possess = (cave) => {
      restoredPose = null;
      if (!crew.control(cave)) return;
      shoulderView = false;
      carryExitMode = carryFocusRemaining = 0;
      cave.weapon.aiming = false;
      hud.setWeapon(false, false, 0);
      eyeMotionValid = false;
      dollyTime = DOLLY_HANDOFF;
      distanceVelocity = 0;
      zoomTilt = false;
      zoomPitchVelocity = 0;
      headOrbit = exitAngleHold = false;
      releaseMix = 0;
      resetGroundView();
      orbit.tDist = clamp(orbit.tDist, follow.min, follow.max);
      orbit.tPitch = clamp(orbit.tPitch, TRAILING_PITCH[0], TRAILING_PITCH[1]);
      if (closeWanted) {
        closeMix = closeVelocity = 0;
        faceWith(cave);
      }
      hud.el.act.hidden = false;
      showAct();
      hud.tooltip.hide();
      fx.say(cave, crew.sleeping ? "zzz..." : "Ooga? Me?", 1.6);
      if (crew.sleeping) hud.hint(coarse ? "Tap WAKE UP! to get up" : cave.bedroll.sleep ? "Space wakes up · WASD changes sleeping pose" : "Space wakes up · Escape leaves them sleeping");
      else if (cave.jet && cave.jetRecovering) hud.hint("Jetpack recharges on the ground · restart above 20% fuel");
      else if (cave.jet) hud.hint(coarse ? "Left stick flies · pinch in for first person · hold Blast off to climb" : "WASD flies · scroll in for first person · hold Space to climb · Escape to let go");
      else hud.hint(coarse ? "Left stick walks · pinch in for first person · JUMP! jumps or uses a nearby control" : "WASD walks · right-click to aim · scroll to change view · Space to jump or use a nearby control");
    };
    const rememberSleepView = () => {
      const up = camera.up;
      viewRotation(releaseRotation, camera.target.x - camera.position.x, camera.target.y - camera.position.y, camera.target.z - camera.position.z, up ? up.x : 0, up ? up.y : 1, up ? up.z : 0, orbit.yaw);
      releaseMix = 1;
    };
    const release = (quiet = false) => {
      restoredPose = null;
      const cave = player();
      if (!cave) return;
      cave.weapon.aiming = false;
      shoulderView = false;
      unlockAim();
      eyeMotionValid = false;
      dollyTime = DOLLY_HANDOFF;
      if (crew.sleeping && closeWanted) {
        const dx = camera.target.x - camera.position.x, dy = camera.target.y - camera.position.y, dz = camera.target.z - camera.position.z;
        rememberSleepView();
        // Close-view input was relative to the sleeping head. Free navigation
        // starts from that same world direction and eases only its roll upright.
        orbit.yaw = orbit.tYaw = Math.atan2(-dx, -dz);
        orbit.pitch = orbit.tPitch = clamp(Math.atan2(-dy, Math.hypot(dx, dz)), TRAILING_PITCH[0], TRAILING_PITCH[1]);
      }
      const recovered = (closeWanted || closeMix > 0) && ctx.releaseView && ctx.releaseView(cave, camera.position);
      resetGroundView();
      if (closeWanted) {
        setFreeEye();
        closeMix = 1;
        closeVelocity = 0;
      }
      else if (recovered) {
        // A solid-rock third-person view hands free navigation a clear eye.
        // Rebase its orbit so the next frame keeps that accepted position.
        const cp = Math.cos(orbit.pitch), distance = orbit.dist;
        freeTarget.x = camera.position.x - Math.sin(orbit.yaw) * cp * distance;
        freeTarget.y = camera.position.y - Math.sin(orbit.pitch) * distance;
        freeTarget.z = camera.position.z - Math.cos(orbit.yaw) * cp * distance;
        orbit.target = freeTarget;
        orbit.tx = freeTarget.x; orbit.ty = freeTarget.y; orbit.tz = freeTarget.z;
      }
      restoreHead();
      entryRebase = entryOffsetActive = false;
      closeCave = null;
      crew.release();
      syncAim();
      carryExitMode = carryFocusRemaining = 0;
      hud.el.act.hidden = true;
      syncJetpackHud();
      syncWeaponHud();
      syncModeHud();
      if (!quiet) hud.toast(`${cave.traits.name} ${cave.state === "sleeping" ? "keeps sleeping" : "wanders off"}`);
    };
    // Nearby actions consume a press; a ready jetpack leaves Space as throttle.
    const action = () => {
      resumePose();
      const cave = player();
      return cave ? crew.playerAction() : !!ctx.onFreeAction && ctx.onFreeAction();
    };
    // Held it climbs, clicked it acts; both mouse buttons on the canvas walk
    const controls = createControls({ move: document.getElementById("joy-move"), look: document.getElementById("joy-look"), boost: hud.el.act, chord: canvas, onAction: action, pressActions: true, shooter: armed });
    let dragHold = 0, trailingViewInput = false, trailingZoomInput = false, stoppedZoomGesture = null;
    const zoomPitch = (cave, fromDistance) => {
      if (!weaponViewReady(cave)) return;
      if (carryExitMode === 1) return;
      if (!zoomTilt) {
        zoomAnchorPitch = trailingPitchChosen ? orbit.tPitch : viewPitch;
        zoomAnchorDistance = fromDistance;
      }
      // Add a small tilt relative to the chosen view over the full zoom range.
      // Below a ceiling, keep the chosen angle exactly; the horizontal boom is
      // only the one-time transition out of shooter view.
      const span = Math.log(DIST_MAX / DIST_MIN);
      const change = Math.log(orbit.tDist / zoomAnchorDistance) / span;
      const p = cave.root.position, covered = ceilingAt && ceilingAt(p.x, p.z, p.y - cave.baseY, cave) < Infinity;
      orbit.tPitch = covered ? zoomAnchorPitch
        : clamp(zoomAnchorPitch + 0.32 * change, Math.min(0.08, zoomAnchorPitch), Math.max(0.68, zoomAnchorPitch));
      trailingPitchChosen = true;
      zoomTilt = true;
    };
    const hooks = {
      onOrbit: (dx, dy) => {
        if (dx || dy) resumePose();
        if (aimView()) {
          if (dx || dy) releaseCursorAim();
          orbit.yaw = orbit.tYaw -= dx * 0.0025;
          orbit.pitch = orbit.tPitch = clamp(orbit.tPitch + dy * 0.0025, TRAILING_PITCH[0], TRAILING_PITCH[1]);
          return;
        }
        dragHold = DRAG_HOLD;
        if (dx || dy) stopCarryExit();
        if (dy) { zoomTilt = false; zoomPitchVelocity = 0; }
        orbit.tYaw -= dx * 4e-3;
        const cave = player(), pitch = close && !cave && (closeWanted || closeMix > 0.5) ? close.pitch : TRAILING_PITCH;
        if (dy) orbit.tPitch = clamp(orbit.tPitch + dy * 3.5e-3, pitch[0], pitch[1]);
        if (cave && !closeWanted) {
          trailingViewInput = true;
          if (dy) trailingPitchChosen = true;
        }
      },
      onZoom: (factor, gesture = null, px = null, py = null) => {
        if (factor === 1) return;
        resumePose();
        if (gesture !== null && gesture === stoppedZoomGesture) return;
        const cave = player();
        if (aimView()) {
          // Stop the entire gesture at shoulder view, including its momentum.
          // A fresh scroll is needed to cross the next mode boundary.
          if (factor < 1 && shoulderView) enterClose();
          else if (factor > 1) {
            if (closeWanted) {
              exitClose();
              stoppedZoomGesture = gesture;
            }
            else {
              shooterView(false);
              const fromDistance = Math.max(DIST_MIN, orbit.dist);
              orbit.tDist = clamp(Math.max(DIST_MIN, orbit.tDist) * factor, DIST_MIN, DIST_MAX);
              zoomPitch(cave, fromDistance);
              trailingZoomInput = true;
            }
          }
          return;
        }
        if (!close) {
          orbit.tDist = clamp(orbit.tDist * factor, DIST_MIN, DIST_MAX);
          return;
        }
        if (closeWanted) {
          if (factor > 1) {
            closeExitScale *= factor;
            if (closeExitScale >= CLOSE_PINCH_EXIT) {
              exitClose();
              if (player()) trailingZoomInput = true;
            }
          } else closeExitScale = 1;
          return;
        }
        const fromDistance = orbit.tDist;
        if (factor < 1 && carryExitMode === 2) stopCarryExit();
        orbit.tDist = clamp(fromDistance * factor, DIST_MIN, DIST_MAX);
        zoomPitch(cave, fromDistance);
        if (player()) {
          // Ease the chosen distance in the orbit itself. A wheel event must
          // not teleport the eye before its close-view dolly starts.
          trailingZoomInput = true;
        }
        if (factor < 1 && orbit.tDist <= DIST_MIN + 0.001) {
          if (weaponViewReady(cave)) {
            shooterView(true, px, py);
            stoppedZoomGesture = gesture;
          }
          else enterClose();
        }
      },
      onDoubleTap: (hit) => {
        if (hit && hit.owner.kind === "caveman") {
          const cave = hit.owner.cave;
          if (cave === player()) release();
          else possess(cave);
        } else if (player()) release();
      }
    };
    // ---------- camera ----------
    const goPreset = (name) => {
      const p = presets[name];
      if (!p) return;
      eyeMotionValid = false;
      dollyTime = DOLLY_HANDOFF;
      distanceVelocity = 0;
      release(true);
      shoulderView = false;
      closeWanted = false;
      closeMix = closeVelocity = 0;
      closeExitScale = 1;
      closeCave = null;
      trailingPitchChosen = false;
      zoomTilt = false;
      zoomPitchVelocity = 0;
      headOrbit = exitAngleHold = false;
      entryRebase = entryOffsetActive = false;
      releaseMix = 0;
      restoreHead();
      resetFreeFall();
      orbit.target = p.target;
      orbit.tYaw = p.yaw;
      orbit.tPitch = p.pitch;
      orbit.tDist = p.dist;
    };
    // Read keys and sticks before the crew moves
    const readInput = (dt) => {
      syncAim();
      const a = controls.read();
      const cave = player();
      if (restoredPose) {
        if (a.x || a.y || a.up || a.yaw || a.pitch) resumePose();
        else return;
      }
      if (aimView()) {
        if (a.x || a.y || a.up || a.yaw || a.pitch) releaseCursorAim();
        orbit.yaw = orbit.tYaw += a.yaw * YAW_RATE * dt;
        orbit.pitch = orbit.tPitch = clamp(orbit.tPitch + a.pitch * PITCH_RATE * dt, TRAILING_PITCH[0], TRAILING_PITCH[1]);
        if (armed()) poseAim();
      }
      const fx0 = -Math.sin(orbit.yaw), fz0 = -Math.cos(orbit.yaw);
      const rx = Math.cos(orbit.yaw), rz = -Math.sin(orbit.yaw);
      if (cave) {
        freeStrafe = freeForward = freeClimb = 0;
        const p = cave.root.position;
        followTarget.x = p.x;
        followTarget.y = p.y - cave.baseY + follow.y;
        followTarget.z = p.z;
        orbit.target = followTarget;
        if (cave.jet) crew.thrust(a.up > 0);
        crew.steer(fx0 * a.y + rx * a.x, fz0 * a.y + rz * a.x, armed() ? 1 : close ? closeMix : 0, a.y, a.x, armed() ? ads ? 0.65 : a.sprint && a.y > 0.05 && !cave.weapon.reloading ? 1.35 : 1 : 1);
        if (dragHold > 0) dragHold -= dt;
        else if (!armed() && !crew.sleeping && !closeWanted && a.y > 0.05 && Math.abs(a.x) > 0.05 && !a.yaw) {
          const behind = cave.root.rotation.y + Math.PI;
          orbit.tYaw += Math.atan2(Math.sin(behind - orbit.tYaw), Math.cos(behind - orbit.tYaw)) * Math.min(1, FOLLOW_TURN * dt);
        }
      } else {
        if (orbit.target === freeTarget) {
          const stopStrafe = freeStrafe && (!a.x || freeStrafe * a.x < 0), stopForward = freeForward && (!a.y || freeForward * a.y < 0);
          const stopClimb = freeClimb && (!a.up || freeClimb * a.up < 0);
          if (stopStrafe || stopForward || stopClimb) {
            // Consume released or reversed input's remaining damping. The eye's
            // current center also keeps close-view release from snapping back.
            const offset = orbit.dist * (1 - closeMix), cp = Math.cos(viewPitch);
            const centerX = camera.position.x - Math.sin(orbit.yaw) * cp * offset;
            const centerY = camera.position.y - Math.sin(viewPitch) * offset;
            const centerZ = camera.position.z - Math.cos(orbit.yaw) * cp * offset;
            const sr = Math.sin(freeMoveYaw), cr = Math.cos(freeMoveYaw);
            if (stopStrafe) {
              const target = (centerX - freeTarget.x) * cr - (centerZ - freeTarget.z) * sr;
              const current = (centerX - orbit.tx) * cr - (centerZ - orbit.tz) * sr;
              freeTarget.x += target * cr; freeTarget.z -= target * sr;
              orbit.tx += current * cr; orbit.tz -= current * sr;
            }
            if (stopForward) {
              const target = (centerX - freeTarget.x) * sr + (centerZ - freeTarget.z) * cr;
              const current = (centerX - orbit.tx) * sr + (centerZ - orbit.tz) * cr;
              freeTarget.x += target * sr; freeTarget.z += target * cr;
              orbit.tx += current * sr; orbit.tz += current * cr;
            }
            if (stopClimb) freeTarget.y = orbit.ty = centerY;
          }
        }
        if (a.x || a.y || a.up) {
          if (orbit.target !== freeTarget) {
            freeTarget.x = orbit.target.x;
            freeTarget.y = orbit.target.y;
            freeTarget.z = orbit.target.z;
            orbit.target = freeTarget;
          }
          const speed = (closeWanted ? WALK.speed / Math.max(1, Math.hypot(a.x, a.y)) : fly.speed + orbit.tDist * fly.perDist) * dt;
          freeTarget.x += (fx0 * a.y + rx * a.x) * speed;
          freeTarget.z += (fz0 * a.y + rz * a.x) * speed;
          if (a.up && !closeWanted) {
            // Underground bounds apply to the eye. A pitched orbit's focus can
            // sit below its floor, and horizontal input must leave it there.
            const offset = fly.yMin === undefined ? 0 : Math.sin(viewPitch) * orbit.dist * (1 - closeMix);
            freeTarget.y = clamp(freeTarget.y + a.up * fly.climb * dt, (fly.yMin === undefined ? 0 : fly.yMin) - offset, fly.yMax - offset);
          }
          clampTarget(freeTarget);
        }
        if (closeWanted && freeFalling && freeFeetY + (freeFallV - WALK.gravity * dt) * dt > freeFloorY && (freeLeapX || freeLeapZ)) {
          freeTarget.x += freeLeapX * dt;
          freeTarget.z += freeLeapZ * dt;
          freeLeapX = damp(freeLeapX, 0, WALK.ledgeDrag, dt);
          freeLeapZ = damp(freeLeapZ, 0, WALK.ledgeDrag, dt);
          clampTarget(freeTarget);
        }
        freeStrafe = a.x; freeForward = a.y; freeClimb = a.up;
        freeMoveYaw = orbit.yaw;
      }
      if (a.yaw || a.pitch) stopCarryExit();
      if (a.yaw) {
        orbit.tYaw += a.yaw * YAW_RATE * dt;
        if (cave && !closeWanted) trailingViewInput = true;
      }
      if (a.pitch) {
        zoomTilt = false;
        zoomPitchVelocity = 0;
        const pitch = close && !cave && (closeWanted || closeMix > 0.5) ? close.pitch : TRAILING_PITCH;
        orbit.tPitch = clamp(orbit.tPitch + a.pitch * PITCH_RATE * dt, pitch[0], pitch[1]);
        if (cave && !closeWanted) trailingViewInput = trailingPitchChosen = true;
      }
    };
    // The camera moves only on input, no drift

    const poseAim = () => {
      if (aimPreserveFacing) {
        crew.look(aimBodyYaw, aimBodyPitch, 1);
        player().parts.head.rotation.y = aimBodyHeadYaw;
        return;
      }
      const turn = Math.atan2(Math.sin(orbit.yaw + Math.PI - aimBodyYaw), Math.cos(orbit.yaw + Math.PI - aimBodyYaw));
      crew.look(aimBodyYaw + turn * aimMix, aimBodyPitch + (orbit.pitch - aimBodyPitch) * aimMix, 1);
    };
    const updateAim = (cave, dt) => {
      syncJetpackHud(); syncWeaponHud();
      crew.elevate(0);
      // Match the navigation dolly: zoom starts with continuous velocity,
      // rather than taking its largest sideways/backward step on entry.
      const target = closeWanted ? 1 : 0, decay = Math.exp(-CLOSE_RATE * dt);
      let delta = closeMix - target, impulse = (closeVelocity + CLOSE_RATE * delta) * dt;
      closeMix = target + (delta + impulse) * decay;
      closeVelocity = (closeVelocity - CLOSE_RATE * impulse) * decay;
      if (closeMix < 0 || closeMix > 1 || Math.abs(closeMix - target) < CLOSE_SNAP && Math.abs(closeVelocity) < CLOSE_SNAP * CLOSE_RATE) {
        closeMix = clamp(closeMix, 0, 1);
        if (Math.abs(closeMix - target) < CLOSE_SNAP) closeMix = target;
        closeVelocity = 0;
      }
      const entryDecay = Math.exp(-AIM_ENTRY_RATE * dt);
      delta = aimMix - 1; impulse = (aimVelocity + AIM_ENTRY_RATE * delta) * dt;
      aimMix = 1 + (delta + impulse) * entryDecay;
      aimVelocity = (aimVelocity - AIM_ENTRY_RATE * impulse) * entryDecay;
      if (1 - aimMix < CLOSE_SNAP && Math.abs(aimVelocity) < CLOSE_SNAP * AIM_ENTRY_RATE) { aimMix = 1; aimVelocity = 0; }
      poseAim();
      adsMix = damp(adsMix, ads ? 1 : 0, CLOSE_RATE, dt);
      if (Math.abs(adsMix - (ads ? 1 : 0)) < CLOSE_SNAP) adsMix = ads ? 1 : 0;
      const h = cave.traits.height, p = cave.root.position;
      if (cave.camp.rolling && closeWanted) {
        // First person belongs to the rolling head rather than an upright
        // world-space boom. Pointer look stays in body-local yaw and pitch,
        // then the physical root roll carries both the view and its up axis.
        updateWorld(cave.root, cave.root.parent ? cave.root.parent.world : undefined);
        const head = cave.parts.head, bounds = boundsOf(head.geometry), m = head.world;
        mat4.transformPoint(headEye, m, bounds.center[0], bounds.center[1], bounds.max[2] + 0.01);
        quat.rotateVec(rollingRight, cave.root.quaternion, 1, 0, 0);
        quat.rotateVec(rollingUp, cave.root.quaternion, 0, 1, 0);
        quat.rotateVec(rollingBaseForward, cave.root.quaternion, 0, 0, 1);
        const yaw = Math.atan2(Math.sin(orbit.yaw + Math.PI - cave.camp.heading), Math.cos(orbit.yaw + Math.PI - cave.camp.heading));
        const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(orbit.pitch), sp = Math.sin(orbit.pitch);
        const fx = rollingBaseForward[0] * cy + rollingRight[0] * sy;
        const fy = rollingBaseForward[1] * cy + rollingRight[1] * sy;
        const fz = rollingBaseForward[2] * cy + rollingRight[2] * sy;
        rollingForward[0] = fx * cp - rollingUp[0] * sp;
        rollingForward[1] = fy * cp - rollingUp[1] * sp;
        rollingForward[2] = fz * cp - rollingUp[2] * sp;
        sleepCameraUp.x = rollingUp[0] * cp + fx * sp;
        sleepCameraUp.y = rollingUp[1] * cp + fy * sp;
        sleepCameraUp.z = rollingUp[2] * cp + fz * sp;
        camera.position.x = headEye[0]; camera.position.y = headEye[1]; camera.position.z = headEye[2];
        camera.target.x = headEye[0] + rollingForward[0] * CLOSE_LOOK_DIST;
        camera.target.y = headEye[1] + rollingForward[1] * CLOSE_LOOK_DIST;
        camera.target.z = headEye[2] + rollingForward[2] * CLOSE_LOOK_DIST;
        camera.up = sleepCameraUp;
        camera.fov = Math.min(MAX_FOV, Math.max(BASE_FOV, 2 * Math.atan(Math.tan(MIN_HFOV / 2) / (renderer.size.width / Math.max(1, renderer.size.height))))) * (1 - 0.2 * adsMix);
        cave.weapon.aimYaw = yaw;
        cave.weapon.aimPitch = orbit.pitch;
        crew.poseWeapon(cave);
        if (armed()) updateFeedback(cave, dt);
        syncHeadVisibility(cave);
        carryCursor.updateAim(aimMix);
        eyeMotionValid = false;
        return;
      }
      const cp = Math.cos(orbit.pitch), sp = Math.sin(orbit.pitch), sy = Math.sin(orbit.yaw), cy = Math.cos(orbit.yaw);
      const eyeClearance = cave.headOffset * 0.95 + cave.viewLift;
      const eyeY = p.y - cave.baseY + eyeClearance;
      const distance = (shoulderDistance(cave, orbit.pitch) - 0.3 * adsMix) * h * (1 - closeMix), side = shoulderSide * (1 - 0.14 * adsMix) * h * (1 - closeMix);
      const eyeForward = 0.16 * h * closeMix;
      // Ordinary aim stays above the head. Only a steep upward look lowers
      // the boom; distance supplies the room needed to keep the feet in view.
      const boomPitch = shoulderBoomPitch(orbit.pitch), horizontal = Math.cos(boomPitch) * distance - cp * eyeForward;
      const x = p.x + sy * horizontal + cy * side;
      const y = eyeY + Math.sin(boomPitch) * distance + SHOULDER_LIFT * h * (1 - closeMix);
      const z = p.z + cy * horizontal - sy * side;
      if (aimMix < 1 && closeMix > 0) {
        // A fresh inward scroll may arrive before shoulder entry finishes.
        // Approach the eyes directly; a polar arc flips sides as it crosses
        // the head to reach the first-person eye just in front of the face.
        camera.position.x = aimEntry.x + p.x - aimEntryBody.x + (x - aimEntry.x - p.x + aimEntryBody.x) * aimMix;
        camera.position.y = aimEntry.y + p.y - aimEntryBody.y + (y - aimEntry.y - p.y + aimEntryBody.y) * aimMix;
        camera.position.z = aimEntry.z + p.z - aimEntryBody.z + (z - aimEntry.z - p.z + aimEntryBody.z) * aimMix;
      } else if (aimMix < 1) {
        const endX = x - p.x, endY = y - eyeY, endZ = z - p.z;
        const endYaw = Math.atan2(endX, endZ);
        const arcYaw = aimEntryYaw + Math.atan2(Math.sin(endYaw - aimEntryYaw), Math.cos(endYaw - aimEntryYaw)) * aimMix;
        const arcHorizontal = aimEntryRadius + (Math.hypot(endX, endZ) - aimEntryRadius) * aimMix;
        camera.position.x = p.x + Math.sin(arcYaw) * arcHorizontal;
        camera.position.y = eyeY + aimEntryHeight + (endY - aimEntryHeight) * aimMix;
        camera.position.z = p.z + Math.cos(arcYaw) * arcHorizontal;
      } else {
        camera.position.x = x; camera.position.y = y; camera.position.z = z;
      }
      // The outward dolly is an orbit path. Keep it unrestricted throughout
      // the handoff instead of dropping physical clearance only at mix zero.
      clampCamera(camera.position, closeMix, eyeClearance, false, dt, false, true, false, !closeWanted);
      camera.fov = Math.min(MAX_FOV, Math.max(BASE_FOV, 2 * Math.atan(Math.tan(MIN_HFOV / 2) / (renderer.size.width / Math.max(1, renderer.size.height))))) * (1 - 0.2 * adsMix);
      if (aimAtCursor) {
        // Solve a world-up view that puts the selected point under the gliding
        // cursor. Interpolating an unrelated camera rotation lets it drift off
        // the object or even push that object outside the screen mid-swoop.
        const dx = cursorPoint.x - camera.position.x, dy = cursorPoint.y - camera.position.y, dz = cursorPoint.z - camera.position.z;
        const tangent = Math.tan(camera.fov * 0.5), remaining = 1 - aimMix;
        const sx = aimScreenX * remaining * tangent * renderer.size.width / renderer.size.height, sy = aimScreenY * remaining * tangent;
        const pitch = Math.atan(sy) - Math.asin(clamp(dy / Math.hypot(dx, dy, dz) * Math.sqrt((1 + sx * sx + sy * sy) / (1 + sy * sy)), -1, 1));
        const yaw = Math.atan2(-dx, -dz) + Math.atan2(sx, Math.cos(pitch) + sy * Math.sin(pitch));
        viewRotation(aimPanRotation, -Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch), 0, 1, 0, yaw);
      } else {
        viewRotation(aimLookRotation, -sy * cp, -sp, -cy * cp, 0, 1, 0, orbit.yaw);
        aimPanRotation.set(aimEntryRotation);
        quat.slerpTo(aimPanRotation, aimLookRotation, aimMix);
      }
      quat.rotateVec(aimForward, aimPanRotation, 0, 0, -1);
      camera.target.x = camera.position.x + aimForward[0] * CLOSE_LOOK_DIST;
      camera.target.y = camera.position.y + aimForward[1] * CLOSE_LOOK_DIST;
      camera.target.z = camera.position.z + aimForward[2] * CLOSE_LOOK_DIST;
      // A sleeper may wake from a rolled view. Carry its full orientation
      // through the existing aim dolly before returning to world-up.
      if (aimMix < 1) {
        quat.rotateVec(sleepUp, aimPanRotation, 0, 1, 0);
        sleepCameraUp.x = sleepUp[0]; sleepCameraUp.y = sleepUp[1]; sleepCameraUp.z = sleepUp[2];
        camera.up = sleepCameraUp;
      } else camera.up = null;
      if (reticle.dataset.ads !== String(ads)) reticle.dataset.ads = String(ads);
      // Use the same cone and current FOV as the emitted shots, including
      // the ADS transition. Write the DOM only while its visible size changes.
      const radius = Math.round(spreadRadius() * 100) / 100;
      if (radius !== reticleRadius) {
        reticleRadius = radius;
        reticle.style.setProperty("--reticle-radius", `${radius}px`);
      }
      // Pose tracks the same ray without collision work between shots.
      if (aimPreserveFacing) {
        aimPoint.x = p.x - sy * cp * 60;
        aimPoint.y = eyeY - sp * 60;
        aimPoint.z = p.z - cy * cp * 60;
      } else {
        aimPoint.x = camera.position.x + (camera.target.x - camera.position.x) * 15;
        aimPoint.y = camera.position.y + (camera.target.y - camera.position.y) * 15;
        aimPoint.z = camera.position.z + (camera.target.z - camera.position.z) * 15;
      }
      cave.weapon.aimPitch = -Math.atan2(aimPoint.y - p.y - h * 0.45, Math.hypot(aimPoint.x - p.x, aimPoint.z - p.z));
      const yaw = Math.atan2(aimPoint.x - p.x, aimPoint.z - p.z) - cave.root.rotation.y;
      cave.weapon.aimYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      crew.poseWeapon(cave);
      if (armed()) updateFeedback(cave, dt);
      syncHeadVisibility(cave);
      carryCursor.updateAim(aimMix);
      eyeMotionValid = false;
    };
    const update = (dt) => {
      if (restoredPose) {
        applyPose(restoredPose);
        syncJetpackHud(); syncWeaponHud();
        if (armed()) updateFeedback(player(), dt);
        syncHeadVisibility(player());
        return;
      }
      syncAim();
      const cave = player();
      syncModeHud();
      // A bed or seated pose has its own camera anchor; a held carry-exit
      // height must not turn its later zoom into a vertical, singular orbit.
      if (carryExitMode && !weaponViewReady(cave)) stopCarryExit();
      if (aimView()) { updateAim(cave, dt); return; }
      const sleeping = !!(cave && crew.sleeping && cave.root.quaternion);
      if (sleepingView && !sleeping && cave && closeWanted && closeMix > 0) {
        rememberSleepView();
        // Waking restores the bed's upright stance. Ease the rendered roll
        // toward that heading without applying sleeping-relative Euler angles.
        orbit.yaw = orbit.tYaw = cave.root.rotation.y + Math.PI;
        orbit.pitch = orbit.tPitch = 0;
        quat.fromEuler(entryRoll, 0, 0, 0);
      }
      if (sleeping && !sleepingView) {
        sleepYaw = orbit.yaw; sleepPitch = orbit.pitch;
        quat.fromEuler(sleepViewRotation, 0, Math.PI, 0);
      }
      sleepingView = sleeping;
      if ((cave || headOrbit) && (closeWanted || closeMix > 0 || closeCameraActive)) {
        if (!closeCameraActive) {
          const up = camera.up;
          viewRotation(cameraRotation, camera.target.x - camera.position.x, camera.target.y - camera.position.y, camera.target.z - camera.position.z, up ? up.x : 0, up ? up.y : 1, up ? up.z : 0, orbit.yaw);
          closeCameraActive = true;
        }
      } else closeCameraActive = false;
      camera.up = null;
      syncJetpackHud();
      syncWeaponHud();
      if (cave) {
        const p = cave.root.position;
        if (headOrbit) {
          headAnchor(cave, followTarget);
          followTarget.x += headOrbitOffset.x; followTarget.y += headOrbitOffset.y; followTarget.z += headOrbitOffset.z;
        } else {
          followTarget.x = sleeping ? cave.sleepHead.x : p.x;
          followTarget.y = sleeping ? cave.sleepHead.y : p.y - cave.baseY + follow.y;
          followTarget.z = sleeping ? cave.sleepHead.z : p.z;
        }
      }
      if (exitAngleHold && !closeWanted && closeMix === 0 && !sleeping) {
        const body = cave ? cave.root.position : freeTarget;
        if (Math.hypot(body.x - exitBodyX, body.y - exitBodyY, body.z - exitBodyZ) > 1e-5) exitAngleHold = false;
      }
      const directTrailingView = trailingViewInput && !!cave && !closeWanted;
      // Crossing into first person starts a dolly, even when the same wheel
      // event changed the trailing distance. Its physical corridor recovery
      // must keep the normal motion budget instead of acting as a direct drag.
      const directCameraPosition = directTrailingView || trailingZoomInput && !!cave && !closeWanted;
      trailingViewInput = false;
      trailingZoomInput = false;
      let groundReset = false;
      if (closeWanted && cave !== closeCave) {
        if (cave) {
          resetGroundView();
          closeMix = closeVelocity = 0;
          faceWith(cave);
        } else {
          resetGroundView();
          if (closeCave) setFreeEye();
          closeCave = null;
          restoreHead();
        }
      }
      if (close) {
        // An analytic critically damped dolly starts with continuous speed.
        // First-order easing adds its largest step exactly when the wheel
        // reaches first person, on top of the still-moving orbit distance.
        const target = closeWanted ? 1 : 0, delta = closeMix - target;
        const decay = Math.exp(-closeRate * dt), impulse = (closeVelocity + closeRate * delta) * dt;
        closeMix = target + (delta + impulse) * decay;
        closeVelocity = (closeVelocity - closeRate * impulse) * decay;
        if (closeMix < 0 || closeMix > 1 || Math.abs(closeMix - target) < CLOSE_SNAP && Math.abs(closeVelocity) < CLOSE_SNAP * closeRate) {
          closeMix = closeMix < 0 ? 0 : closeMix > 1 ? 1 : target;
          closeVelocity = 0;
        }
      } else closeMix = closeVelocity = 0;
      orbit.yaw = directTrailingView ? orbit.tYaw : damp(orbit.yaw, orbit.tYaw, 14, dt);
      if (carryExitMode && cave && !closeWanted) {
        zoomPitchVelocity = 0;
      } else if (zoomTilt && cave && !closeWanted && !directTrailingView) {
        const delta = orbit.pitch - orbit.tPitch, decay = Math.exp(-14 * dt), impulse = (zoomPitchVelocity + 14 * delta) * dt;
        orbit.pitch = orbit.tPitch + (delta + impulse) * decay;
        zoomPitchVelocity = (zoomPitchVelocity - 14 * impulse) * decay;
      } else {
        orbit.pitch = directTrailingView ? orbit.tPitch : damp(orbit.pitch, orbit.tPitch, 14, dt);
        zoomPitchVelocity = 0;
      }
      if (cave && close && !sleeping) crew.look(orbit.yaw + Math.PI, orbit.pitch, closeMix);
      if (cave && close && !sleeping) {
        const p = cave.root.position;
        const ground = p.y - cave.baseY - cave.hop;
        const zone = close.zone ? close.zone() : 0;
        const moved = Math.hypot(p.x - groundX, p.z - groundZ);
        const airborne = cave.hop > 0.001 || Math.abs(cave.hopV) > 0.001 || !!cave.jet && cave.jet.thrust;
        groundReset = !groundValid || airborne || zone !== groundZone || moved > CLOSE_TELEPORT || Math.abs(ground - groundTarget) > close.maxStep + 1e-6;
        if (groundReset) groundView = ground;
        else {
          const visualGround = close.visualGroundAt ? close.visualGroundAt(p.x, p.z, ground) : ground;
          // The terrain sample removes the voxel-sized stair jump spatially.
          // Bound its remaining correction by horizontal travel so an uneven
          // footprint cannot transfer a one-frame kick into the body and
          // follow camera. Unlike time damping this keeps pace on a long
          // staircase instead of accumulating height lag. First person stays
          // fixed to the physical eye for precise aiming.
          const groundStep = moved > 1e-6 ? moved * 1.05 : CLOSE_GROUND_RATE * dt * 0.08;
          groundView = closeMix > 0.5 ? visualGround : clamp(visualGround, groundView - groundStep, groundView + groundStep);
        }
        groundLift = clamp(groundView - ground, -cave.baseY * 0.5, cave.baseY * 0.75);
        groundTarget = ground;
        groundX = p.x;
        groundZ = p.z;
        groundZone = zone;
        groundValid = true;
        groundEasing = !airborne;
        crew.elevate(groundLift);
        groundLift = cave.viewLift;
        groundView = ground + groundLift;
        followTarget.y = p.y - cave.baseY + (headOrbit ? cave.headOffset * close.eyeRatio + headOrbitOffset.y : follow.y) + cave.viewLift;
      } else {
        if (cave && close && !sleeping) crew.elevate(0);
        groundLift = 0;
        groundEasing = false;
        groundValid = false;
      }
      {
        // Repeated wheel events change the destination, never the current
        // distance velocity. Use the exact critically damped spring step.
        const delta = orbit.dist - orbit.tDist, decay = Math.exp(-CLOSE_RATE * dt);
        const impulse = (distanceVelocity + CLOSE_RATE * delta) * dt;
        orbit.dist = orbit.tDist + (delta + impulse) * decay;
        distanceVelocity = (distanceVelocity - CLOSE_RATE * impulse) * decay;
      }
      orbit.tx = damp(orbit.tx, orbit.target.x, 5, dt);
      orbit.ty = damp(orbit.ty, orbit.target.y, 5, dt);
      orbit.tz = damp(orbit.tz, orbit.target.z, 5, dt);
      if (carryExitMode && cave && !closeWanted) {
        // Below a ceiling, extend the boom at the displayed eye's height.
        // Outdoors, ease height separately so a down-aim cannot first dip
        // while its steep viewing angle returns to the chosen carry angle.
        if (carryExitMode === 2) {
          const target = Math.max(carryExitBase, Math.sin(orbit.tPitch) * orbit.tDist);
          const delta = carryExitHeight - target, decay = Math.exp(-CLOSE_RATE * dt);
          const impulse = (carryExitVelocity + CLOSE_RATE * delta) * dt;
          carryExitHeight = target + (delta + impulse) * decay;
          carryExitVelocity = (carryExitVelocity - CLOSE_RATE * impulse) * decay;
        }
        orbit.pitch = Math.asin(clamp(carryExitHeight / orbit.dist, -1, 1));
      }
      const { width, height } = renderer.size;
      const aspect = width / Math.max(1, height);
      camera.fov = clamp(2 * Math.atan(Math.tan(MIN_HFOV / 2) / aspect), BASE_FOV, MAX_FOV);
      const portrait = clamp(1 - aspect, 0, 0.6);
      let flatten = 0;
      if (cave && close && !trailingPitchChosen && !headOrbit) {
        const span = close.trailingDist - DIST_MIN;
        flatten = span > 0 ? clamp((close.trailingDist - orbit.dist) / span, 0, 1) : 1;
        flatten = flatten * flatten * (3 - 2 * flatten);
      }
      viewPitch = orbit.pitch * (1 - flatten);
      const cp = Math.cos(viewPitch), sp = Math.sin(viewPitch);
      let targetX = orbit.tx, targetY = orbit.ty - portrait * 0.6, targetZ = orbit.tz;
      const orbitX = orbit.tx + Math.sin(orbit.yaw) * cp * orbit.dist;
      const orbitY = orbit.ty + sp * orbit.dist;
      const orbitZ = orbit.tz + Math.cos(orbit.yaw) * cp * orbit.dist;
      let eyeX = freeTarget.x, eyeZ = freeTarget.z, eyeY = freeTarget.y, eyeClearance = close ? close.eyeHeight : 0;
      let freeLedge = false, previousFloor = freeFloorY;
      if ((cave || headOrbit) && closeCameraActive) {
        if (sleeping && !headOrbit) {
          quat.multiply(relativeRotation, cave.root.quaternion, sleepViewRotation);
          quat.rotateVec(sleepForward, relativeRotation, 0, 0, -1);
          quat.rotateVec(sleepUp, relativeRotation, 0, 1, 0);
          quat.rotateVec(sleepRight, relativeRotation, 1, 0, 0);
          const cy = Math.cos(orbit.yaw - sleepYaw), sy = Math.sin(orbit.yaw - sleepYaw), cp = Math.cos(orbit.pitch - sleepPitch), sp = Math.sin(orbit.pitch - sleepPitch);
          const fx = sleepForward[0] * cy - sleepRight[0] * sy, fy = sleepForward[1] * cy - sleepRight[1] * sy, fz = sleepForward[2] * cy - sleepRight[2] * sy;
          viewRotation(headRotation, fx * cp - sleepUp[0] * sp, fy * cp - sleepUp[1] * sp, fz * cp - sleepUp[2] * sp, sleepUp[0] * cp + fx * sp, sleepUp[1] * cp + fy * sp, sleepUp[2] * cp + fz * sp, orbit.yaw);
        } else {
          const cp = Math.cos(orbit.pitch);
          viewRotation(headRotation, -Math.sin(orbit.yaw) * cp, -Math.sin(orbit.pitch), -Math.cos(orbit.yaw) * cp, 0, 1, 0, orbit.yaw);
          quat.multiply(headRotation, headRotation, entryRoll);
        }
      }
      if (closeMix > 0) {
        if (headOrbit && !closeWanted) {
          eyeX = orbit.tx; eyeY = orbit.ty; eyeZ = orbit.tz;
        } else if (sleeping) {
          quat.rotateVec(sleepForward, headRotation, 0, 0, -1);
          eyeX = cave.sleepHead.x + sleepForward[0] * 0.28;
          eyeY = cave.sleepHead.y + sleepForward[1] * 0.28;
          eyeZ = cave.sleepHead.z + sleepForward[2] * 0.28;
          // Author the dolly toward a clear resting eye, including the full
          // near-plane volume above its pillow, before blending positions.
          if (close.sleepEyeFloorAt) eyeY = Math.max(eyeY, close.sleepEyeFloorAt(cave));
          eyeClearance = Math.max(0.1, eyeY - close.groundAt(eyeX, eyeZ, eyeY - 0.1));
        } else if (cave) {
          const heading = cave.root.rotation.y, forward = close.eyeForward;
          eyeX = cave.root.position.x + Math.sin(heading) * forward;
          eyeY = cave.root.position.y - cave.baseY + cave.headOffset * close.eyeRatio + cave.viewLift;
          eyeZ = cave.root.position.z + Math.cos(heading) * forward;
          eyeClearance = eyeY - close.groundAt(eyeX, eyeZ, cave.root.position.y - cave.baseY - cave.hop);
        } else if (closeWanted && !freeEntry) {
          if (!freeFallValid) {
            freeFeetY = freeFloorY = close.groundAt(eyeX, eyeZ, camera.position.y - close.eyeHeight);
            freeFallValid = true;
          }
          previousFloor = freeFloorY;
          if (freeCloud && !freeFalling && !freeCloud.wrapped && freeCloud.node.visible && freeCloud.node.parent) {
            eyeX += freeCloud.dx; eyeZ += freeCloud.dz;
            freeTarget.x += freeCloud.dx; freeTarget.z += freeCloud.dz;
          }
          const previousFeet = freeFeetY;
          if (freeFalling) {
            freeFallV -= WALK.gravity * dt;
            freeFeetY += freeFallV * dt;
          }
          const ground = close.groundAt(eyeX, eyeZ, freeFeetY, Math.max(previousFeet, freeFeetY));
          if (!freeFalling && freeFloorY - ground > WALK.step) {
            freeFalling = freeLedge = true;
            freeFallV = freeCloud ? 0 : WALK.ledgeRise;
            freeLeapX = freeCloud ? 0 : -Math.sin(orbit.yaw) * WALK.ledgeSpeed;
            freeLeapZ = freeCloud ? 0 : -Math.cos(orbit.yaw) * WALK.ledgeSpeed;
          }
          if (!freeFalling) freeFeetY = ground;
          else freeFeetY = Math.max(ground, freeFeetY);
          freeFloorY = ground;
          eyeY = freeFeetY + close.eyeHeight;
        } else if (!freeEntry) eyeY = close.groundAt(eyeX, eyeZ, camera.position.y - close.eyeHeight) + close.eyeHeight;
      }
      camera.position.x = orbitX + (eyeX - orbitX) * closeMix;
      camera.position.y = orbitY + (eyeY - orbitY) * closeMix;
      camera.position.z = orbitZ + (eyeZ - orbitZ) * closeMix;
      if (entryRebase) {
        // A reversed dolly or a new possession may use another orbit pivot.
        // Its zero-distance-time endpoint is still the eye already displayed.
        entryRebase = false;
        entryOffsetActive = true;
      }
      if (entryOffsetActive) {
        camera.position.x += (entryPosition.x - orbitX) * (1 - closeMix);
        camera.position.y += (entryPosition.y - orbitY) * (1 - closeMix);
        camera.position.z += (entryPosition.z - orbitZ) * (1 - closeMix);
        if (closeMix === 1) entryOffsetActive = false;
      }
      if (dollyTime < DOLLY_HANDOFF) {
        dollyTime = Math.min(DOLLY_HANDOFF, dollyTime + dt);
        const u = dollyTime / DOLLY_HANDOFF, remaining = 1 - u;
        // This finite handoff starts with the previous rendered velocity and
        // zero acceleration, then ends with zero offset, velocity and
        // acceleration. The new dolly can brake before reversing direction.
        const carry = dollyTime * remaining * remaining * remaining * (1 + 3 * u);
        camera.position.x += dollyVelocity.x * carry;
        camera.position.y += dollyVelocity.y * carry;
        camera.position.z += dollyVelocity.z * carry;
      }
      const desiredX = camera.position.x, desiredY = camera.position.y, desiredZ = camera.position.z;
      const collided = clampCamera(camera.position, closeMix, eyeClearance, groundEasing, dt, groundReset, directCameraPosition, !cave && orbit.target === freeTarget, freeEntry || headOrbit && !closeWanted && (exitAngleHold || closeMix > 0));
      if (freeEntry && closeMix === 1) {
        freeEntry = false;
        setFreeEye();
        orbit.tx = freeTarget.x; orbit.ty = freeTarget.y; orbit.tz = freeTarget.z;
      }
      if (!cave && closeWanted && closeMix === 1 && freeFallValid) {
        const feet = camera.position.y - close.eyeHeight;
        const ground = close.groundAt(camera.position.x, camera.position.z, feet);
        // Collision may reject the requested ledge crossing. Only accepted
        // movement starts a fall, and a landing clears its velocity and drift.
        if (freeLedge && previousFloor - ground <= WALK.step || freeFalling && freeFallV <= 0 && feet <= ground + 1e-6) {
          freeFalling = false;
          freeFallV = freeLeapX = freeLeapZ = 0;
        } else if (freeFalling && freeFallV > 0 && feet < freeFeetY - 1e-6) freeFallV = 0;
        freeFeetY = feet;
        freeFloorY = ground;
        freeCloud = !freeFalling && close.cloudAt ? close.cloudAt(camera.position.x, camera.position.z, feet) : null;
        freeTarget.y = camera.position.y;
      }
      if (collided && !cave && orbit.target === freeTarget) {
        // A blocked eye consumes its blocked movement. Keep the orbit offset,
        // but discard hidden target travel so reversing responds immediately.
        const orbitMix = 1 - closeMix;
        if (Math.abs(camera.position.x - desiredX) > 1e-7) freeTarget.x = orbit.tx = camera.position.x - (orbitX - targetX) * orbitMix;
        if (Math.abs(camera.position.y - desiredY) > 1e-7) freeTarget.y = orbit.ty = camera.position.y - (orbitY - orbit.ty) * orbitMix;
        if (Math.abs(camera.position.z - desiredZ) > 1e-7) freeTarget.z = orbit.tz = camera.position.z - (orbitZ - targetZ) * orbitMix;
        targetX = orbit.tx;
        targetY = orbit.ty - portrait * 0.6;
        targetZ = orbit.tz;
      }
      const lookCp = Math.cos(orbit.pitch), lookSp = Math.sin(orbit.pitch);
      let lookX = camera.position.x - Math.sin(orbit.yaw) * lookCp * CLOSE_LOOK_DIST;
      let lookY = camera.position.y - lookSp * CLOSE_LOOK_DIST;
      let lookZ = camera.position.z - Math.cos(orbit.yaw) * lookCp * CLOSE_LOOK_DIST;
      if ((cave || headOrbit) && closeCameraActive) {
        viewRotation(orbitRotation, targetX - camera.position.x, targetY - camera.position.y, targetZ - camera.position.z, 0, 1, 0, orbit.yaw);
        // Follow the previously rendered rotation: choosing a fresh shortest
        // arc between two moving endpoints can reverse that arc at 180°.
        if (headOrbit || closeMix === 1) quat.copy(cameraRotation, headRotation);
        else if (carryExitMode && !closeWanted && closeMix === 0) {
          // Finish recentering promptly, independently of the zoom spring
          // or later wheel events. Keep following the body's moving anchor.
          const remaining = Math.max(0, carryFocusRemaining - dt);
          const blend = carryFocusRemaining > 0 ? 1 - (remaining / carryFocusRemaining) ** 2 : 1;
          quat.slerpTo(cameraRotation, orbitRotation, blend);
          carryFocusRemaining = remaining;
          if (!remaining) closeCameraActive = false;
        } else quat.slerpTo(cameraRotation, closeWanted ? headRotation : orbitRotation, 1 - Math.exp(-CLOSE_RATE * dt));
        if (!headOrbit && !closeWanted && closeMix === 0) {
          // The physical close-view boom may end on a different side of the
          // head from the unrestricted orbit. Settle its orientation too,
          // rather than discarding a still-rolled camera at the position snap.
          const sign = cameraRotation[0] * orbitRotation[0] + cameraRotation[1] * orbitRotation[1] + cameraRotation[2] * orbitRotation[2] + cameraRotation[3] * orbitRotation[3] < 0 ? -1 : 1;
          const error = Math.hypot(cameraRotation[0] - sign * orbitRotation[0], cameraRotation[1] - sign * orbitRotation[1], cameraRotation[2] - sign * orbitRotation[2], cameraRotation[3] - sign * orbitRotation[3]);
          if (error < 1e-4) closeCameraActive = false;
        }
      }
      camera.target.x = targetX + (lookX - targetX) * closeMix;
      camera.target.y = targetY + (lookY - targetY) * closeMix;
      camera.target.z = targetZ + (lookZ - targetZ) * closeMix;
      if (releaseMix > 0) {
        releaseMix = damp(releaseMix, 0, CLOSE_RATE, dt);
        if (releaseMix < CLOSE_SNAP) releaseMix = 0;
        viewRotation(orbitRotation, camera.target.x - camera.position.x, camera.target.y - camera.position.y, camera.target.z - camera.position.z, 0, 1, 0, orbit.yaw);
        quat.copy(cameraRotation, releaseRotation);
        quat.slerpTo(cameraRotation, orbitRotation, 1 - releaseMix);
      }
      if ((cave || headOrbit) && closeCameraActive || releaseMix > 0) {
        quat.rotateVec(sleepForward, cameraRotation, 0, 0, -1);
        quat.rotateVec(sleepUp, cameraRotation, 0, 1, 0);
        camera.target.x = camera.position.x + sleepForward[0] * CLOSE_LOOK_DIST;
        camera.target.y = camera.position.y + sleepForward[1] * CLOSE_LOOK_DIST;
        camera.target.z = camera.position.z + sleepForward[2] * CLOSE_LOOK_DIST;
        sleepCameraUp.x = sleepUp[0]; sleepCameraUp.y = sleepUp[1]; sleepCameraUp.z = sleepUp[2];
        camera.up = sleepCameraUp;
      }
      if (sleeping && closeWanted && closeMix > 0) crew.look(0, 0, closeMix, cameraRotation);
      if (orbitBattle()) updateOrbitBattle(cave, dt);
      syncHeadVisibility(cave);
      if (cave && close) headAnchor(cave, motionAnchor);
      else {
        const anchor = cave ? cave.root.position : freeTarget;
        motionAnchor.x = anchor.x; motionAnchor.y = anchor.y; motionAnchor.z = anchor.z;
      }
      if (dt > 0 && eyeMotionValid) {
        eyeVelocity.x = (camera.position.x - previousEye.x) / dt;
        eyeVelocity.y = (camera.position.y - previousEye.y) / dt;
        eyeVelocity.z = (camera.position.z - previousEye.z) / dt;
        anchorVelocity.x = (motionAnchor.x - previousAnchor.x) / dt;
        anchorVelocity.y = (motionAnchor.y - previousAnchor.y) / dt;
        anchorVelocity.z = (motionAnchor.z - previousAnchor.z) / dt;
      } else if (!eyeMotionValid) {
        eyeVelocity.x = eyeVelocity.y = eyeVelocity.z = 0;
        anchorVelocity.x = anchorVelocity.y = anchorVelocity.z = 0;
      }
      previousEye.x = camera.position.x; previousEye.y = camera.position.y; previousEye.z = camera.position.z;
      previousAnchor.x = motionAnchor.x; previousAnchor.y = motionAnchor.y; previousAnchor.z = motionAnchor.z;
      eyeMotionValid = true;
    };
    // The scene supplies a safe arrival and resets its collision history first.
    // Navigation changes location, not the visitor's mode or chosen Ooga.
    const navigate = (destination) => {
      restoredPose = null;
      carryExitMode = carryFocusRemaining = 0;
      eyeMotionValid = false;
      dollyTime = DOLLY_HANDOFF;
      distanceVelocity = 0;
      sleepingView = false;
      headOrbit = exitAngleHold = false;
      entryRebase = entryOffsetActive = false;
      closeCameraActive = false;
      releaseMix = 0;
      quat.fromEuler(entryRoll, 0, 0, 0);
      trailingPitchChosen = false;
      zoomTilt = false;
      zoomPitchVelocity = 0;
      camera.up = null;
      const cave = player(), position = destination.position;
      resetGroundView();
      freeStrafe = freeForward = freeClimb = dragHold = 0;
      trailingViewInput = trailingZoomInput = false;
      closeMix = closeWanted ? 1 : 0;
      closeVelocity = 0;
      closeExitScale = 1;
      closeCave = closeWanted ? cave : null;
      orbit.yaw = orbit.tYaw = freeMoveYaw = destination.yaw;
      orbit.pitch = orbit.tPitch = destination.pitch;
      orbit.dist = orbit.tDist = destination.dist;
      if (cave) {
        crew.relocatePlayer(position, destination.yaw + Math.PI);
        followTarget.x = position.x;
        followTarget.y = position.y + follow.y;
        followTarget.z = position.z;
        orbit.target = followTarget;
      } else {
        const target = closeWanted ? position : destination.target;
        freeTarget.x = target.x;
        freeTarget.y = target.y + (closeWanted ? close.eyeHeight : 0);
        freeTarget.z = target.z;
        orbit.target = freeTarget;
        if (closeWanted) {
          // Support selection must start on the destination's elevation layer.
          camera.position.x = freeTarget.x;
          camera.position.y = freeTarget.y;
          camera.position.z = freeTarget.z;
        }
      }
      orbit.tx = orbit.target.x;
      orbit.ty = orbit.target.y;
      orbit.tz = orbit.target.z;
      if (closeWanted && armed()) {
        // Navigation is a new physical arrival, not a dolly from the old
        // scene position. Start directly at its selected first-person eye.
        aimMix = 1; aimVelocity = 0;
        aimAtCursor = aimPreserveFacing = false;
      }
      update(0);
    };
    // Debug replay holds the recorded view until a navigation gesture. This
    // preserves an interrupted camera dolly as well as an ordinary settled view.
    const copyVector = (out, value) => { out[0] = value.x; out[1] = value.y; out[2] = value.z; };
    const readVector = (out, value) => { out.x = value[0]; out.y = value[1]; out.z = value[2]; };
    const capturePose = (out) => {
      const cave = player();
      copyVector(out.position, camera.position); copyVector(out.target, camera.target);
      const up = camera.up || cursorUp;
      copyVector(out.up, up); out.fov = camera.fov;
      out.mode = viewMode();
      out.battle = armed();
      out.character = cave ? cave.traits.name : "";
      out.orbit[0] = orbit.yaw; out.orbit[1] = orbit.pitch; out.orbit[2] = orbit.dist;
      out.orbit[3] = orbit.tx; out.orbit[4] = orbit.ty; out.orbit[5] = orbit.tz;
      out.shoulderSide = shoulderSide; out.closeMix = closeMix; out.ads = adsMix;
      out.headOrbit = headOrbit; copyVector(out.headOffset, headOrbitOffset);
      if (cave) {
        copyVector(out.actor, cave.root.position); copyVector(out.body, cave.root.rotation); copyVector(out.head, cave.parts.head.rotation);
        out.bodyRolled = !!cave.root.quaternion; out.headRolled = !!cave.parts.head.quaternion;
        for (let i = 0; i < 4; i++) {
          out.bodyQuaternion[i] = cave.root.quaternion ? cave.root.quaternion[i] : i === 3 ? 1 : 0;
          out.headQuaternion[i] = cave.parts.head.quaternion ? cave.parts.head.quaternion[i] : i === 3 ? 1 : 0;
        }
        out.selectedSlot = cave.weapon.equipped ? 2 : cave.weapon.primaryEquipped ? 1 : cave.weapon.selectedSlot;
        out.ammo = cave.weapon.ammo; out.unlimited = !!cave.weapon.unlimited;
        out.magazines[0] = crew.magazineAmmo(cave, 0); out.magazines[1] = crew.magazineAmmo(cave, 1); out.magazineCount = crew.magazineCount(cave);
        out.aimYaw = cave.weapon.aimYaw; out.aimPitch = cave.weapon.aimPitch;
        out.jetpack = !!cave.jet; out.fuel = cave.jetFuel;
        out.hop = cave.hop; out.hopV = cave.hopV; out.lift = cave.viewLift;
      } else {
        out.actor.fill(0); out.body.fill(0); out.head.fill(0); out.magazines.fill(0);
        out.bodyQuaternion.fill(0); out.bodyQuaternion[3] = 1;
        out.headQuaternion.fill(0); out.headQuaternion[3] = 1;
        out.bodyRolled = out.headRolled = out.unlimited = out.jetpack = false;
        out.selectedSlot = 1; out.ammo = out.magazineCount = out.aimYaw = out.aimPitch = out.hop = out.hopV = out.lift = 0;
        out.fuel = 1;
      }
      return out;
    };
    const applyPose = (pose) => {
      const cave = player();
      if (cave) {
        readVector(cave.root.position, pose.actor); readVector(cave.root.rotation, pose.body); readVector(cave.parts.head.rotation, pose.head);
        cave.root.quaternion = pose.bodyRolled ? pose.bodyQuaternion : null;
        cave.parts.head.quaternion = pose.headRolled ? pose.headQuaternion : null;
        cave.hop = pose.hop; cave.hopV = pose.hopV;
        crew.elevate(pose.lift);
        crew.poseWeapon(cave);
      }
      readVector(camera.position, pose.position); readVector(camera.target, pose.target);
      readVector(sleepCameraUp, pose.up); camera.up = sleepCameraUp; camera.fov = pose.fov;
    };
    const restorePose = (pose, exactCamera = true) => {
      const cave = player();
      closeWanted = pose.mode === "first-person" || pose.mode === "eye-level";
      shoulderView = !!cave && pose.mode === "shoulder";
      if (cave) {
        cave.weapon.aiming = pose.battle === undefined ? pose.mode === "shoulder" || closeWanted && !crew.sleeping : !!pose.battle;
        crew.steer(0, 0, 0, 0, 0);
      }
      applyPose(pose);
      syncAim();
      orbit.yaw = orbit.tYaw = pose.orbit[0]; orbit.pitch = orbit.tPitch = pose.orbit[1]; orbit.dist = orbit.tDist = pose.orbit[2];
      orbit.tx = pose.orbit[3]; orbit.ty = pose.orbit[4]; orbit.tz = pose.orbit[5];
      const target = cave ? followTarget : freeTarget;
      target.x = orbit.tx; target.y = orbit.ty; target.z = orbit.tz; orbit.target = target;
      headOrbit = pose.headOrbit; readVector(headOrbitOffset, pose.headOffset);
      closeMix = pose.closeMix; closeVelocity = distanceVelocity = aimVelocity = 0; aimMix = 1;
      closeCave = cave; shoulderSide = pose.shoulderSide;
      ads = pose.ads > 0.5; adsMix = pose.ads;
      carryExitMode = carryFocusRemaining = 0; eyeMotionValid = false;
      trailingPitchChosen = true; zoomTilt = false;
      aimAtCursor = aimPreserveFacing = false;
      if (cave) {
        aimBodyYaw = pose.body[1]; aimBodyPitch = pose.head[0]; aimBodyHeadYaw = pose.head[1];
        cave.weapon.aimYaw = pose.aimYaw; cave.weapon.aimPitch = pose.aimPitch;
      }
      if (!exactCamera) { update(0); capturePose(pose); }
      restoredPose = pose;
      update(0);
    };
    const resumePose = () => {
      if (!restoredPose) return;
      restoredPose = null;
      const cave = player();
      if (cave && !crew.sleeping) { cave.root.quaternion = null; cave.parts.head.quaternion = null; }
      if (armed()) {
        captureAimEntry(player());
        aimMix = aimVelocity = 0;
      }
      resetGroundView();
    };
    const dispose = () => {
      restoredPose = null;
      disposed = true;
      unlockAim();
      carryCursor.dispose();
      clearFeedback();
      reticle.hidden = true;
      camera.near = savedNear;
      window.removeEventListener("mousemove", aimMouseMove);
      window.removeEventListener("pointerup", aimMouseUp);
      window.removeEventListener("keydown", aimKey, true);
      window.removeEventListener("blur", unlockAim);
      if (!lockPending) retireAimLock();
      canvas.removeEventListener("pointerdown", aimPointer, true);
      canvas.removeEventListener("pointermove", aimPointer, true);
      canvas.removeEventListener("pointerup", aimPointer, true);
      canvas.removeEventListener("pointercancel", aimPointer, true);
      resetGroundView();
      restoreHead();
      hud.el.act.hidden = true;
      hud.setAct(ACT_DO);
      hud.setPrimary(false, false, null, 0, false, 0.5, false);
      hud.setWeapon(false, false, 0);
      hud.setMagazine(0, 0, 0, false);
      if (hud.setMode) hud.setMode(null, false, "detached", false);
      controls.dispose();
      crew = fx = input = null;
    };
    return { orbit, hooks, controls, cursor: carryCursor, capturePose, restorePose, focusAim, get poseHeld() { return !!restoredPose; }, get aiming() { return armed(); }, bind, readInput, update, goPreset, navigate, enterClose, possess, release, action, modeAction, weaponAction, weaponMode, showAct, dispose, get player() {
      return player();
    }, get assistedTarget() {
      if (orbitBattle() && orbitTargetActive) return orbitTargetHit;
      return aimView() && (cursorAim || aimAtCursor) ? cursorPoint : null;
    }, get assistedTargetDistance() {
      return orbitBattle() && orbitTargetActive ? orbitTargetDistance : Infinity;
    }, get moving() {
      // A press can arrive between frames, before readInput updates crew steer.
      const cave = player(), a = controls.read();
      return !!cave && (Math.hypot(a.x, a.y) > 0.05 || cave.hop > 0 || cave.hopV > 0);
    }, get mode() {
      return viewMode();
    }, get closeMix() {
      return closeMix;
    }, get closeWanted() {
      return closeWanted;
    }, get preserveExitAngle() {
      return headOrbit && !closeWanted && (exitAngleHold || closeMix > 0);
    }, get freeFalling() {
      return freeFalling;
    }, get groundLift() {
      return groundLift;
    }, get groundView() {
      return groundView;
    }, get groundTarget() {
      return groundTarget;
    }, get viewPitch() {
      return viewPitch;
    } };
  };
  BL.pilot = { create, WALK };
})();
