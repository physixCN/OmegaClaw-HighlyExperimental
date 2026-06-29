/* src/r3d/cameraRig.js — the living camera.

   The viewer sits at the ORIGIN, inside Omega's atomspace. The camera
   never dollies out of the centre (that would break "you are inside
   her"); it only ROTATES in place, so the whole space turns around us.

   Three modes (Evolution Plan §15):
     • follow  — the default living mode. The camera eases to face
                 Omega's locus (the comet) wherever she roams the
                 atomspace, so we ride her attention and the surround
                 reveals itself as she moves. Responsiveness + gentle
                 breathing sway scale with the energy mode (calm =
                 slow, wandering gaze; creative = locks onto her work).
     • free    — vantage. Drag to look around for yourself; on release
                 it lingers, then eases back to following her. Changes
                 only OUR viewpoint, never her state.
     • (resting is just the low-energy end of follow.)

   Input: a left-drag past a small threshold becomes a look-drag and is
   swallowed (window.__omegaCameraDragging) so it never triggers the
   click-to-chat. A plain click passes through untouched. Right-click
   (inspect) is left alone.

   Membrane note: the rig only moves the CAMERA. It never moves an atom
   or changes Omega's state — that all routes through her actions.

   AR/VR-ready: world space stays truthful (real positions, real
   scale). On a flat screen the camera rotates at the origin; in a
   headset the head supplies translation/parallax directly. Either way
   the rig just keeps a truthful camera pointed where Omega is. */

(function () {
  function createCameraRig(camera, opts) {
    const THREE = window.THREE;
    if (!THREE || !camera) return { update() {}, dispose() {}, setMode() {} };
    const o = opts || {};
    const getTarget = o.getTarget || (() => null);   // → THREE.Vector3 (Omega's locus) or null

    /* Current camera orientation as yaw (around Y) / pitch (around X).
       yaw=0,pitch=0 looks down −Z, matching the old fixed default. */
    let yaw = 0, pitch = 0;
    let mode = "follow";
    let freeUntil = 0;              // while now < freeUntil after a drag, hold free
    let lastMs = performance.now();

    const PITCH_LIMIT = 1.20;      // ~69°, stops short of gimbal flip
    const tmpDir = new THREE.Vector3();
    const tmpTgt = new THREE.Vector3();

    function dirFromAngles(y, p, out) {
      const cp = Math.cos(p);
      return out.set(Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp);
    }
    function clampPitch(p) { return p < -PITCH_LIMIT ? -PITCH_LIMIT : (p > PITCH_LIMIT ? PITCH_LIMIT : p); }

    function setMode(m) {
      if (m !== "follow" && m !== "free") return;
      if (m === mode) return;
      mode = m;
      if (m === "follow") freeUntil = 0;
      if (window.omegaState && window.omegaState.setCameraMode) window.omegaState.setCameraMode(m);
    }

    /* ── Vantage (pointer) input ─────────────────────────────── */
    let down = false, lastX = 0, lastY = 0, moved = 0;
    const DRAG_PX = 6;             // movement before a press becomes a look-drag
    const SENS = 0.0045;          // radians per pixel
    function blocked(t) {
      return t && t.closest && t.closest(
        ".omega-window, .twk-panel, .status-dock, .ridge-stack, .ws-stage, " +
        ".osurf-host, input, textarea, button, a, select"
      );
    }
    function onDown(e) {
      if (e.button !== 0) return;            // left only; right = inspect
      if (blocked(e.target)) return;
      down = true; moved = 0;
      lastX = e.clientX; lastY = e.clientY;
    }
    function onMove(e) {
      if (!down) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < DRAG_PX) return;
      /* Entered look-drag: take vantage, suppress the pending click. */
      if (mode !== "free") setMode("free");
      window.__omegaCameraDragging = true;
      document.body.style.userSelect = "none";
      yaw += dx * SENS;
      pitch = clampPitch(pitch - dy * SENS);   // drag up → look up
    }
    function onUp() {
      if (!down) return;
      down = false;
      document.body.style.userSelect = "";
      if (moved >= DRAG_PX) {
        freeUntil = performance.now() + 1400;  // linger before easing back to follow
        /* Clear the swallow flag AFTER the click event has fired. */
        setTimeout(() => { window.__omegaCameraDragging = false; }, 0);
      } else {
        window.__omegaCameraDragging = false;
      }
    }
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);

    /* ── Per-frame ───────────────────────────────────────────── */
    function update(nowMs) {
      const now = nowMs != null ? nowMs : performance.now();
      let dt = (now - lastMs) / 1000;
      lastMs = now;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 0.05) dt = 0.05;

      const st = window.omegaState;
      const busy = (st && st.profile) ? st.profile().busy : 0.4;

      /* Free lingers, then auto-returns to follow. */
      if (mode === "free" && !down && now >= freeUntil) setMode("follow");

      if (mode === "free") {
        /* yaw/pitch are driven directly by the drag handler. */
      } else {
        /* FOLLOW — ease toward Omega's locus. Responsiveness tightens
           with energy (locks on when creative; loose, restful gaze
           when calm). A slow breathing sway adds life; bigger when
           calm (looking around), near-zero when focused. While a space
           is GATHERED she STUDIES it: lock on fast and hold a steady
           gaze (almost no sway) so it reads as attention, not drift. */
        const gathering = st && st.frame && st.frame.layoutMode === "gather";
        const tau = gathering ? 0.5 : (1.7 - 1.15 * busy);   // ~1.7s asleep → ~0.55s creative
        const alpha = 1 - Math.exp(-dt / Math.max(0.12, tau));
        const swayAmp = gathering ? 0.018 : (0.13 * (1 - busy) + 0.012);

        let desYaw = yaw, desPitch = pitch;
        const tgt = getTarget();
        if (tgt) {
          tmpTgt.copy(tgt);
          if (tmpTgt.lengthSq() > 1e-6) {
            tmpTgt.normalize();
            desYaw = Math.atan2(tmpTgt.x, -tmpTgt.z);
            desPitch = Math.asin(Math.max(-1, Math.min(1, tmpTgt.y)));
          }
        }
        const t = now * 0.001;
        desYaw += swayAmp * Math.sin(t * 0.17);
        desPitch = clampPitch(desPitch + swayAmp * 0.55 * Math.sin(t * 0.13 + 1.0));

        /* Shortest-arc yaw lerp so wrapping never spins the long way. */
        let dYaw = desYaw - yaw;
        while (dYaw > Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        yaw += dYaw * alpha;
        pitch += (desPitch - pitch) * alpha;
      }

      dirFromAngles(yaw, pitch, tmpDir);
      camera.lookAt(
        camera.position.x + tmpDir.x,
        camera.position.y + tmpDir.y,
        camera.position.z + tmpDir.z
      );
    }

    function dispose() {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.__omegaCameraDragging = false;
      document.body.style.userSelect = "";
    }

    return {
      update, dispose, setMode,
      get yaw() { return yaw; },
      get pitch() { return pitch; },
      get mode() { return mode; },
    };
  }

  window.omegaR3D = window.omegaR3D || {};
  window.omegaR3D.createCameraRig = createCameraRig;
})();
