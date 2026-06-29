/* omegaScheduler.js — the BEHAVIOR side.

   Owns the heartbeat, mock event queue, cascade planning, and
   return planning. EMITS only the five event types defined by
   omegaEvents.js — never touches the renderer.

   The renderer is downstream and may be swapped (2.5D CSS today,
   Three.js tomorrow) without touching this file. */

(function () {
  const reduce = typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── Tunables ───────────────────────────────────────────────── */
  const DART_MS         = reduce ? 1000 : 720;    // dispatch travel time
  const CASCADE_STEP_MS = reduce ? 220  : 120;    // hop between chain atoms
  const STEPS_MAX       = 7;                      // max chain length
  const FORK_INITIAL    = 3;                      // seed bloom chains at origin
  const FORK_CHANCE     = 0.35;
  const FORK_MAX        = 2;

  /* Heartbeat tempo + burst scale with busyness. */
  const BEAT_MS_CALM = reduce ? 8000 : 5000;
  const BEAT_MS_BUSY = reduce ? 1400 : 250;
  const BURST_CALM   = 5;
  const BURST_BUSY   = reduce ? 12 : 80;
  function beatMsAt(b) { return BEAT_MS_CALM + (BEAT_MS_BUSY - BEAT_MS_CALM) * b; }
  function burstAt(b)  { return Math.max(1, Math.round(BURST_CALM + (BURST_BUSY - BURST_CALM) * b)); }

  /* Mock activity-kind palette. The renderer chooses how to paint
     each kind; the scheduler just labels them. */
  const PULSE_KINDS = [
    "memory", "reasoning", "skill-call", "message",
    "perception", "prediction", "house",
  ];

  /* ── State (scheduler-private — NEVER exposed to renderers) ── */
  let busyness   = 0.0;
  let lastBeatMs = 0;
  let _pulseId   = 1;
  let _loopId    = 0;
  let _thoughtId = 1;
  const dispatchQueue = [];

  function enqueueDispatch(targetAtomId, kind) {
    if (!targetAtomId) return;
    dispatchQueue.push({ targetAtomId, kind: kind || "reasoning" });
  }

  function refillMockEvents() {
    const g = window.omegaGraph;
    if (!g || !g.nodes.length) return;
    /* §38 — the random demo dispatches exist ONLY to animate the CSS
       reference chamber (anatomyPulses darts/blooms on the wall SVGs).
       Under the WebGL renderer those visuals never mount, yet the storm
       still ran — at creative (busy=1) that was ~320 dispatches/s, each
       paying planCascade (an id map over EVERY node + repeated sorts of
       the surface pool) plus 2 timers — the main suspect for "slows to
       a crawl above warm", all of it invisible. EXPLICIT dispatches
       (skill invokes, surface ignites via cascade()/enqueueDispatch)
       bypass this refill and keep working in both renderers. */
    if (document.documentElement.dataset.renderer !== "css") return;
    const want = Math.max(0, burstAt(busyness) * 2 - dispatchQueue.length);
    for (let i = 0; i < want; i++) {
      const n = g.nodes[Math.floor(Math.random() * g.nodes.length)];
      const k = PULSE_KINDS[Math.floor(Math.random() * PULSE_KINDS.length)];
      enqueueDispatch(n.id, k);
    }
  }

  /* ── Cascade planner ────────────────────────────────────────── */
  /* Builds the cascade structure for a given origin atom:
       order        — the SPINE (origin → deepest leaf), what the
                      thought-thread walker traverses.
       bloomChains  — additional propagation paths for the bloom
                      WIDTH (fan-out around the spine).
     Walks SPATIALLY (proximity) so even sparse-edge surfaces have
     somewhere to propagate. Returns null if the origin is isolated
     (deepestDepth === 0), in which case kind === 'single'. */
  function planCascade(origin) {
    const g = window.omegaGraph;
    if (!g || !origin) return null;
    const surface = origin.surface;
    const surfacePool = g.nodes.filter((n) => n.surface === surface);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));

    const times = new Map();
    const parents = new Map();
    times.set(origin.id, 0);
    parents.set(origin.id, null);

    function pickNeighbours(id, n, visited) {
      const node = byId[id];
      if (!node) return [];
      const ns = surfacePool
        .filter((o) => o.id !== id && !visited.has(o.id))
        .map((o) => ({ o, d: Math.hypot(o.x - node.x, o.y - node.y) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, Math.max(n + 1, 4))
        .map((x) => x.o);
      for (let i = ns.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ns[i], ns[j]] = [ns[j], ns[i]];
      }
      return ns.slice(0, n);
    }

    function walk(headId, depth) {
      if (depth >= STEPS_MAX) return;
      const visited = new Set(times.keys());
      const fork = Math.random() < FORK_CHANCE;
      const want = fork ? FORK_MAX : 1;
      const next = pickNeighbours(headId, want, visited);
      for (const nb of next) {
        if (!times.has(nb.id)) {
          times.set(nb.id, depth + 1);
          parents.set(nb.id, headId);
        }
        walk(nb.id, depth + 1);
      }
    }

    const seeds = pickNeighbours(origin.id, FORK_INITIAL, new Set([origin.id]));
    for (const s of seeds) {
      if (!times.has(s.id)) {
        times.set(s.id, 1);
        parents.set(s.id, origin.id);
      }
      walk(s.id, 1);
    }

    /* Single-atom case — nothing reachable. */
    let deepestId = origin.id;
    let deepestDepth = 0;
    for (const [id, depth] of times) {
      if (depth > deepestDepth) { deepestDepth = depth; deepestId = id; }
    }
    if (deepestDepth === 0) {
      return { kind: "single", order: [origin.id], bloomChains: [], deepestId: origin.id, deepestDepth: 0 };
    }

    /* Spine: back-walk parents from deepest to origin. */
    const order = [];
    let cur = deepestId;
    let safety = 64;
    while (cur != null && safety-- > 0) {
      order.unshift(cur);
      cur = parents.get(cur);
    }

    /* Bloom-width chains: for each atom that ISN'T on the spine,
       group by depth into bloomChains[depth]. The renderer can then
       light each ring at time origin + depth*stepMs the same way it
       does the spine. */
    const onSpine = new Set(order);
    const bloomChains = [];
    for (const [id, depth] of times) {
      if (onSpine.has(id)) continue;
      if (!bloomChains[depth]) bloomChains[depth] = [];
      bloomChains[depth].push(id);
    }
    /* Compact undefined slots to empty arrays so the renderer sees a
       well-formed 2D list. */
    for (let i = 0; i < bloomChains.length; i++) {
      if (!bloomChains[i]) bloomChains[i] = [];
    }

    return {
      kind: "cascade",
      order,
      bloomChains,
      deepestId,
      deepestDepth,
    };
  }

  /* ── Return planner ─────────────────────────────────────────── */
  /* "One loop-back may pulse 1, 2, or 3 times — count and timing
     are event-driven, the system decides." This is the mock policy.
     Real OmegaClaw stream replaces this function wholesale. */
  function planReturn(cascadePlan) {
    const depth = (cascadePlan && cascadePlan.deepestDepth) || 0;
    /* Routine results: 1 pulse. Notable: 2. Strong / contradictory
       / very deep: 3. Busyness nudges the boundaries slightly so a
       busy chamber feels denser. */
    let pulses = 1;
    const r = Math.random();
    if (depth >= 5 || r < 0.08 + busyness * 0.12) pulses = 3;
    else if (depth >= 3 || r < 0.30 + busyness * 0.15) pulses = 2;

    /* Timing: relative offsets from ReturnEvent.time. First pulse
       always at 0. Subsequent gaps accelerate slightly so the burst
       reads as a "double/triple knock" rather than evenly metered. */
    const timing = [0];
    if (pulses >= 2) timing.push(timing[timing.length - 1] + 240);
    if (pulses >= 3) timing.push(timing[timing.length - 1] + 200);
    return { pulses, timing };
  }

  /* ── Per-dispatch lifecycle ─────────────────────────────────── */
  function fireDispatch(target, kindName, loopId, beatTime) {
    if (!target) return;
    const pulseId   = _pulseId++;
    const thoughtId = _thoughtId++;
    const emittedAt = beatTime;
    const scheduledArrival = emittedAt + DART_MS * (0.85 + Math.random() * 0.3);

    window.omegaEvents.emit({
      type: "dispatch",
      pulseId, loopId, thoughtId,
      targetAtom: target.id,
      kind: kindName || "reasoning",
      emittedAt,
      scheduledArrival,
    });

    /* Arrival → reasoning → return are scheduled as setTimeouts so
       they fire AT their time. The renderer is purely reactive. */
    const delay = Math.max(0, scheduledArrival - performance.now());
    setTimeout(() => {
      const g = window.omegaGraph;
      if (!g) return;
      const live = g.nodes.find((n) => n.id === target.id);
      if (!live) return;                // target retired mid-flight

      const arrivalTime = performance.now();
      window.omegaEvents.emit({
        type: "arrival",
        pulseId, loopId, thoughtId,
        atomId: live.id,
        time: arrivalTime,
      });

      const plan = planCascade(live);
      window.omegaEvents.emit({
        type: "reasoning",
        pulseId, loopId, thoughtId,
        atomId: live.id,
        kind: plan.kind,
        order: plan.order,
        bloomChains: plan.bloomChains,
        stepMs: CASCADE_STEP_MS,
        time: arrivalTime,
      });

      /* Return fires after the spine walker would have reached the
         deepest leaf. For 'single' (no chain) return immediately. */
      const spineHops = Math.max(0, plan.order.length - 1);
      const walkMs    = spineHops * CASCADE_STEP_MS * 1.05;
      const returnDelay = plan.kind === "single" ? 80 : walkMs;
      const ret = planReturn(plan);

      setTimeout(() => {
        const g2 = window.omegaGraph;
        if (!g2) return;
        const deep = g2.nodes.find((n) => n.id === plan.deepestId);
        if (!deep) return;              // deepest retired before return

        window.omegaEvents.emit({
          type: "return",
          loopId, pulseId, thoughtId,
          fromAtomId: deep.id,
          pulses: ret.pulses,
          timing: ret.timing,
          time: performance.now(),
        });
      }, returnDelay);
    }, delay);
  }

  /* ── Heartbeat ──────────────────────────────────────────────── */
  function emitBeat() {
    const g = window.omegaGraph;
    if (!g) return;
    const burst = burstAt(busyness);
    refillMockEvents();
    const loopId = ++_loopId;
    const beatTime = performance.now();

    window.omegaEvents.emit({
      type: "loop-beat",
      loopId, time: beatTime, busyness,
    });

    let fired = 0;
    while (fired < burst && dispatchQueue.length) {
      const ev = dispatchQueue.shift();
      const target = g.nodes.find((n) => n.id === ev.targetAtomId);
      if (!target) continue;
      fireDispatch(target, ev.kind, loopId, beatTime);
      fired++;
    }
  }

  function maybeBeat(now) {
    const interval = beatMsAt(busyness);
    if (now - lastBeatMs < interval) return;
    lastBeatMs = now;
    emitBeat();
  }

  /* Heartbeat loop. We piggyback on rAF for tempo only — actual
     event emission is timer-driven downstream. Also tick the graph
     so structural diffs advance. */
  let lastNow = performance.now();
  function loop(now) {
    const dt = now - lastNow;
    lastNow = now;
    if (window.omegaGraph && window.omegaGraph.tick) {
      window.omegaGraph.tick(dt);
    }
    maybeBeat(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* Public scheduler API. Renderer-facing wrappers (omegaPulses)
     forward these so existing callers keep working. */
  window.omegaScheduler = {
    get busyness() { return busyness; },
    set busyness(v) { busyness = Math.max(0, Math.min(1, v)); },
    beatNow() { emitBeat(); lastBeatMs = performance.now(); },
    enqueueDispatch,
    /* Manual cascade trigger — runs the SAME dispatch lifecycle as
       a heartbeat-driven event, so the renderer plays back the
       full dispatch → arrival → reasoning → return cycle. */
    cascade(target) {
      const g = window.omegaGraph;
      if (!g) return;
      let origin = null;
      if (typeof target === "string" && target.startsWith("&")) {
        const space = target.slice(1);
        const pool = g.nodes.filter((n) => n.space === space);
        if (pool.length) origin = pool[Math.floor(Math.random() * pool.length)];
      } else if (typeof target === "string") {
        origin = g.nodes.find((n) => n.id === target);
      }
      if (!origin) return;
      const loopId = ++_loopId;
      window.omegaEvents.emit({
        type: "loop-beat", loopId, time: performance.now(), busyness,
      });
      fireDispatch(origin, "reasoning", loopId, performance.now());
    },
  };
})();
