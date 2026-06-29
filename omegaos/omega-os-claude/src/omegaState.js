/* omegaState.js — "what Omega IS right now."

   A small published store for live agent state. Today it holds the
   ENERGY MODE; later it grows attention focus, current frame, and the
   active instance id. Pub/sub like omegaEvents/omegaIntents.

   Energy modes are real (see what-is-omegaclaw.md §"Energy-loop profile"
   and src/loop.metta's &energyMode, which boots "warm"). Each mode has
   a posture; here we also carry the VISUAL profile that maps the mode
   onto the chamber so the room reads as Omega's state:

     busy        scheduler tempo/burst (0..1)
     breathDur   core breathing period (s) — slow when calm, fast when active
     hue         --glow-hue for core aura / glow / window edge
     bright/sat  atom-field brightness & saturation (canvas filter)

   The live OmegaClaw loop sets the mode through the same setMode() —
   this store is the seam, the visual profile is the membrane's choice. */

(function () {
  const MODE_PROFILES = {
    asleep:    { label: "asleep",    busy: 0.00, breathDur: 12.0, hue: 265, bright: 0.42, sat: 0.55 },
    listening: { label: "listening", busy: 0.12, breathDur: 8.0,  hue: 235, bright: 0.80, sat: 0.82 },
    warm:      { label: "warm",      busy: 0.32, breathDur: 6.0,  hue: 215, bright: 1.00, sat: 1.00 },
    focused:   { label: "focused",   busy: 0.68, breathDur: 3.8,  hue: 150, bright: 1.12, sat: 1.12 },
    creative:  { label: "creative",  busy: 1.00, breathDur: 2.6,  hue: 305, bright: 1.26, sat: 1.26 },
  };
  const order = ["asleep", "listening", "warm", "focused", "creative"];

  let mode = "warm";          // boot posture — matches the loop's &energyMode
  let cameraMode = "follow";  // follow (default) | free (vantage). The rig keeps this in sync.
  let bootTimer = null;       // the ~20s wake-up ramp timer
  let bootingUntil = 0;       // performance.now()-relative end of the boot
  /* The FRAME (Evolution Plan §15) — "what the space is doing right now."
     layoutMode: 'resting' (the idle galaxy) | 'gather' (a space has
     pulled itself into a knowledge-graph continent). `focus` names the
     gathered space. Driven by a `focus` intent (Omega looking into a
     space, or us asking her to); the renderer reads it to gather. */
  let frame = { layoutMode: "resting", focus: null };
  const subs = new Set();
  const frameSubs = new Set();

  function profile() { return MODE_PROFILES[mode]; }
  function fire() {
    const p = profile();
    for (const fn of subs) { try { fn(mode, p); } catch (e) { /* never break the bus */ } }
  }
  function setMode(m) {
    if (!MODE_PROFILES[m] || m === mode) return;
    mode = m;
    fire();
  }
  /* wake() — an event-driven WAKE tick (a human arriving, an inbound
     signal). Waking is the one transition that moves UP the energy ladder
     (the idle step-down lives in App). If she's asleep she stirs to
     'listening' immediately, then BOOTS over ~20s before settling to
     'warm' — honest about the real backend spin-up (SWI-Prolog, embeddings,
     channels). The live loop calls this same primitive on a real wake. */
  function wake() {
    if (mode === "asleep") {
      bootingUntil = (typeof performance !== "undefined" ? performance.now() : Date.now()) + 20000;
      setMode("listening");                 // she stirs online
      if (bootTimer) clearTimeout(bootTimer);
      bootTimer = setTimeout(() => {
        bootingUntil = 0;
        if (mode === "listening") setMode("warm");   // ready
      }, 20000);
    }
    return bootingUntil;
  }

  window.omegaState = {
    get mode() { return mode; },
    set mode(m) { setMode(m); },
    setMode,
    wake,
    /* True while she's spinning up from asleep (~20s). UI can say so. */
    get booting() {
      const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
      return bootingUntil > 0 && now < bootingUntil;
    },
    profile,
    get profiles() { return MODE_PROFILES; },
    order,
    /* Camera frame (Evolution Plan §15). The living-camera rig writes
       this so the rest of the UI can read "following Omega" vs. a
       user taking vantage. */
    get cameraMode() { return cameraMode; },
    setCameraMode(m) { if (m && m !== cameraMode) cameraMode = m; },
    /* The layout frame — resting galaxy ⇄ gathered continent. setFrame
       merges a partial and notifies frame subscribers (the renderer).
       The membrane never decides to gather on its own; it only relays
       a `focus` intent into this frame. */
    get frame() { return frame; },
    setFrame(partial) {
      if (!partial) return;
      const next = { ...frame, ...partial };
      if (next.layoutMode === frame.layoutMode && next.focus === frame.focus) return;
      frame = next;
      for (const fn of frameSubs) { try { fn(frame); } catch (e) {} }
    },
    subscribeFrame(fn) {
      frameSubs.add(fn);
      try { fn(frame); } catch (e) {}
      return () => frameSubs.delete(fn);
    },
    /* subscribe fires immediately with the current state so callers
       can sync without waiting for the next change. */
    subscribe(fn) {
      subs.add(fn);
      try { fn(mode, profile()); } catch (e) {}
      return () => subs.delete(fn);
    },
  };
})();
