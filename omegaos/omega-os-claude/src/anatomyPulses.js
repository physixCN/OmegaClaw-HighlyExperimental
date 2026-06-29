/* anatomyPulses.js — the 2.5D RENDERER.

   Subscribes to omegaEvents (the published seam) and owns all
   motion math + visual state for the current CSS-3D scene:
     • active pulses (dispatch dart, thought-thread walker, return
       sparks) with their waypoints + interpolation
     • bloom map (per-atom 0..2.2)
     • ignition flashes (one-shot impact bloom + ring)
     • cascade bloom timing (per-atom envelope from ReasoningEvent)

   This file is the ONE-WAY DOOR vs. VR: a Three.js renderer will
   replace this file wholesale, subscribing to the same events and
   building scene objects instead of mutating React state + DOM.

   Reads only:
     • omegaEvents.subscribe(...) — the seam
     • omegaGraph (shared world data — positions + family colors)

   Never reads scheduler state directly. */

(function () {
  const reduce = typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── Tunables (renderer-only) ───────────────────────────────── */
  const DART_DURATION_FALLBACK = reduce ? 1000 : 720;
  const RETURN_DART_MS         = reduce ? 1000 : 720;
  const BLOOM_RADIUS           = 9;
  const BLOOM_PER_PULSE        = 0.55;
  const TOUCH_BONUS            = 0.85;
  /* Cap above 1.0 — the CSS color-mix saturates at 100%, but the
     atom's brightness() and drop-shadow() scale linearly past it,
     so ignition flashes get visibly punchier than the cascade peak. */
  const BLOOM_CAP              = 2.2;
  const BLOOM_DECAY            = 0.88;

  /* Cascade bloom envelope — attack → hold → decay, all soft.
     The previous instant-attack + brief hold caused atoms to "pop"
     to peak then snap into a long decay; the eye read every wave
     as flashing. Lengthened attack so each atom EASES to peak
     (reads as breathing, not flashing) and a slightly shorter hold
     so the wave moves through the structure like a thought rather
     than dwelling on each atom. */
  const CASCADE_INITIAL  = 1.20;
  const CASCADE_FALLOFF  = 0.82;
  const CASCADE_ATTACK_MS = 180;
  const CASCADE_HOLD_MS  = 140;
  const CASCADE_FADE_MS  = 800;

  /* Ignition envelope (per-atom impact flash). */
  const IGNITION_PEAK    = 1.9;
  const IGNITION_HOLD_MS = 70;
  const IGNITION_FADE_MS = 320;

  /* Loop generations — the freshest beat (highest loopId we've
     seen) reads at full intensity; older in-flight activity recedes
     by RECEDE_PER_GEN per generation, clamped at RECEDE_FLOOR so
     old thoughts never fully disappear (they're still part of the
     chamber). This is Stage 4 of the heartbeat circulation model. */
  const RECEDE_PER_GEN = 0.40;
  const RECEDE_FLOOR   = 0.18;

  /* Core anchor per surface — where pulses arrive at / leave from
     when the waypoint is `anchor:true`. Same as legacy. */
  const CORE_ANCHOR = {
    back:    { x: 50, y: 50  },
    floor:   { x: 50, y: 100 },
    ceiling: { x: 50, y: 100 },
    left:    { x: 0,  y: 50  },
    right:   { x: 0,  y: 50  },
  };

  /* Family hue map → gold-shifted dart color. Renderer-only choice —
     the event stream is colour-agnostic. */
  const FAMILY_HUE = {
    space: 155, atom: 285, skill: 25, channel: 290, sense: 235,
    memory: 85, belief: 70, predict: 340, attention: 55,
    error: 25, person: 10, device: 220, room: 130, loop: 80,
  };
  function familyHue(node) {
    return FAMILY_HUE[node && node.family] != null
      ? FAMILY_HUE[node.family]
      : 80;
  }
  function beamColorFor(node) {
    return `oklch(0.82 0.22 ${familyHue(node)})`;
  }

  /* ── Renderer state ─────────────────────────────────────────── */
  let _id = 1;
  let active = [];               // currently-travelling pulses
  let bloomMap = new Map();      // nodeId → bloom 0..BLOOM_CAP
  const ignitions = [];          // {nodeId, startMs, loopId}
  const cascades = [];           // {origin, order, bloomChains, stepMs, startMs, loopId}
  let _lastBeatLoopId = -1;      // tracks loopId for hue-shift on first dispatch
  /* The highest loopId we've observed on the event stream. Used to
     age out older in-flight visuals so the freshest beat dominates. */
  let _currentLoopId = -1;
  function noteLoopId(id) {
    if (typeof id === "number" && id > _currentLoopId) _currentLoopId = id;
  }
  /* age = currentLoopId - itsLoopId; 0 = freshest, larger = older.
     Linear fade with a soft floor. */
  function ageMult(loopId) {
    if (typeof loopId !== "number" || _currentLoopId < 0) return 1;
    const age = Math.max(0, _currentLoopId - loopId);
    if (age === 0) return 1;
    return Math.max(RECEDE_FLOOR, 1 - age * RECEDE_PER_GEN);
  }
  const subs = new Set();
  const fire = () => subs.forEach((fn) =>
    fn({ pulses: active, bloom: bloomMap }));

  /* ── Visual primitives spawned from events ──────────────────── */
  function spawnDispatchDart(ev, target) {
    active.push({
      id: _id++,
      surface: target.surface,
      waypoints: [{ anchor: true }, { nodeId: target.id }],
      color: beamColorFor(target),
      kind: ev.kind,
      direct: true,
      startMs: ev.emittedAt,
      duration: Math.max(60, ev.scheduledArrival - ev.emittedAt),
      thoughtId: ev.thoughtId,
      loopId: ev.loopId,
      pulseId: ev.pulseId,
    });
  }

  function spawnThoughtThread(ev, headNode) {
    if (!headNode || ev.order.length < 2) return;
    const waypoints = ev.order.map((id) => ({ nodeId: id }));
    const hops = ev.order.length - 1;
    active.push({
      id: _id++,
      surface: headNode.surface,
      waypoints,
      color: beamColorFor(headNode),
      kind: "thought-thread",
      direct: true,
      _thread: true,
      startMs: performance.now(),
      duration: ev.stepMs * hops * 1.05,
      thoughtId: ev.thoughtId,
      loopId: ev.loopId,
      pulseId: ev.pulseId,
    });
  }

  function spawnReturnSpark(ev, fromNode) {
    if (!fromNode) return;
    active.push({
      id: _id++,
      surface: fromNode.surface,
      waypoints: [{ nodeId: fromNode.id }, { anchor: true }],
      color: beamColorFor(fromNode),
      kind: "return",
      direct: true,
      _return: true,
      startMs: performance.now(),
      duration: RETURN_DART_MS * (0.95 + Math.random() * 0.15),
      thoughtId: ev.thoughtId,
      loopId: ev.loopId,
      pulseId: ev.pulseId,
    });
  }

  /* ── Event handlers ─────────────────────────────────────────── */
  function onLoopBeat(ev) {
    /* Trigger the core's beat-pulse CSS animation — pure renderer
       choice; the event just says "a beat happened". */
    if (typeof document === "undefined") return;
    const core = document.querySelector(".core");
    if (!core) return;
    core.classList.remove("beat-pulse");
    // Force reflow so the animation restarts cleanly each beat.
    // eslint-disable-next-line no-unused-expressions
    core.offsetWidth;
    core.classList.add("beat-pulse");
  }

  function onDispatch(ev) {
    const g = window.omegaGraph;
    if (!g) return;
    const target = g.nodes.find((n) => n.id === ev.targetAtom);
    if (!target) return;
    /* First dispatch in a new loop drives the rear-glow hue toward
       that target's family. CSS transitions ease between hues. */
    if (ev.loopId !== _lastBeatLoopId) {
      _lastBeatLoopId = ev.loopId;
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty(
          "--glow-hue", String(familyHue(target)));
      }
    }
    spawnDispatchDart(ev, target);
  }

  function onArrival(ev) {
    /* Ignition flash on the atom that just got hit. The cascade's
       depth-0 ring contributes too (via cascadeBloomFor below), but
       the ignition is the unmistakable IMPACT signal. */
    ignitions.push({ nodeId: ev.atomId, startMs: ev.time, loopId: ev.loopId });
  }

  function onReasoning(ev) {
    const g = window.omegaGraph;
    if (!g) return;
    const head = g.nodes.find((n) => n.id === ev.atomId);
    if (!head) return;

    /* Cascade plan registers for the bloom envelope. The renderer
       reconstructs per-atom timing from `order` + `bloomChains` —
       depth N atoms light at startMs + N * stepMs. */
    cascades.push({
      id: _id++,
      origin: ev.atomId,
      order: ev.order,
      bloomChains: ev.bloomChains,
      stepMs: ev.stepMs,
      startMs: ev.time,
      thoughtId: ev.thoughtId,
      loopId: ev.loopId,
      /* Cache total lifetime so GC is O(1) per cascade. */
      lifetimeMs:
        Math.max(
          (ev.order.length - 1) * ev.stepMs,
          (ev.bloomChains.length - 1) * ev.stepMs
        ) + CASCADE_ATTACK_MS + CASCADE_HOLD_MS + CASCADE_FADE_MS + 200,
    });

    /* Spawn the thought-thread walker — visible spine of the
       reasoning. The bloom envelope below provides the WIDTH. */
    if (ev.kind === "cascade" && ev.order.length > 1) {
      spawnThoughtThread(ev, head);
    }
  }

  function onReturn(ev) {
    const g = window.omegaGraph;
    if (!g) return;
    const from = g.nodes.find((n) => n.id === ev.fromAtomId);
    if (!from) return;
    /* timing[] gives per-pulse start offsets relative to ev.time.
       Schedule each return spark accordingly. The first spark also
       ignites the source atom — visible hand-off from cascade end
       to return-home. */
    ignitions.push({ nodeId: from.id, startMs: ev.time, loopId: ev.loopId });
    for (let i = 0; i < ev.pulses; i++) {
      const offset = (ev.timing && ev.timing[i]) || 0;
      if (offset <= 0) {
        spawnReturnSpark(ev, from);
      } else {
        setTimeout(() => {
          const liveG = window.omegaGraph;
          if (!liveG) return;
          const liveFrom = liveG.nodes.find((n) => n.id === ev.fromAtomId);
          if (!liveFrom) return;
          /* Subsequent pulses get a small ignition too so each one
             reads as an active emission rather than a particle
             appearing mid-air. */
          ignitions.push({
            nodeId: liveFrom.id,
            startMs: performance.now(),
            loopId: ev.loopId,
          });
          spawnReturnSpark(ev, liveFrom);
        }, offset);
      }
    }
  }

  if (window.omegaEvents) {
    window.omegaEvents.subscribe((ev) => {
      noteLoopId(ev.loopId);
      switch (ev.type) {
        case "loop-beat":  onLoopBeat(ev);  break;
        case "dispatch":   onDispatch(ev);  break;
        case "arrival":    onArrival(ev);   break;
        case "reasoning":  onReasoning(ev); break;
        case "return":     onReturn(ev);    break;
      }
    });
  }

  /* ── Position resolution + interpolation ────────────────────── */
  function resolveWaypoint(w, surface, nodesById) {
    if (w.anchor) {
      const a = CORE_ANCHOR[surface] || CORE_ANCHOR.back;
      return { x: a.x, y: a.y };
    }
    const n = nodesById && nodesById[w.nodeId];
    if (n) return { x: n.x, y: n.y };
    const a = CORE_ANCHOR[surface] || CORE_ANCHOR.back;
    return { x: a.x, y: a.y };
  }

  /* ── Bloom envelopes ────────────────────────────────────────── */
  function cascadeBloomFor(nodeId, now) {
    let max = 0;
    for (let i = cascades.length - 1; i >= 0; i--) {
      const c = cascades[i];
      /* Depth lookup: walk spine first, then bloomChains. The depth
         determines when the atom lights. */
      let depth = -1;
      const spineIdx = c.order.indexOf(nodeId);
      if (spineIdx >= 0) depth = spineIdx;
      else {
        for (let d = 0; d < c.bloomChains.length; d++) {
          if (c.bloomChains[d] && c.bloomChains[d].indexOf(nodeId) >= 0) {
            depth = d;
            break;
          }
        }
      }
      if (depth < 0) continue;
      const t = now - (c.startMs + depth * c.stepMs);
      if (t < 0) continue;
      const peak = CASCADE_INITIAL * Math.pow(CASCADE_FALLOFF, depth);
      /* Attack ramp → hold → fade. The attack uses ease-out so the
         atom RUSHES into peak then settles softly (reads as
         breathing); the fade uses ease-out too so the long tail
         lingers near peak before plunging — atoms don't snap dim. */
      let env;
      if (t < CASCADE_ATTACK_MS) {
        const u = t / CASCADE_ATTACK_MS;
        env = 1 - (1 - u) * (1 - u);                  // ease-out quad
      } else if (t < CASCADE_ATTACK_MS + CASCADE_HOLD_MS) {
        env = 1;
      } else {
        const u = Math.min(1, (t - CASCADE_ATTACK_MS - CASCADE_HOLD_MS) / CASCADE_FADE_MS);
        env = Math.max(0, 1 - u * u);                 // ease-in quad (lingers, then drops)
      }
      if (env > 0) max = Math.max(max, peak * env * ageMult(c.loopId));
    }
    /* GC stale cascades — single pass each frame. */
    for (let i = cascades.length - 1; i >= 0; i--) {
      const c = cascades[i];
      if (now - c.startMs > c.lifetimeMs) cascades.splice(i, 1);
    }
    return max;
  }

  function ignitionBloomFor(nodeId, now) {
    let max = 0;
    for (let i = ignitions.length - 1; i >= 0; i--) {
      const ig = ignitions[i];
      if (ig.nodeId !== nodeId) continue;
      const t = now - ig.startMs;
      if (t < 0) continue;
      if (t > IGNITION_HOLD_MS + IGNITION_FADE_MS) continue;
      const env = t < IGNITION_HOLD_MS
        ? 1
        : Math.max(0, 1 - (t - IGNITION_HOLD_MS) / IGNITION_FADE_MS);
      if (env > 0) max = Math.max(max, IGNITION_PEAK * env * ageMult(ig.loopId));
    }
    for (let i = ignitions.length - 1; i >= 0; i--) {
      if (now - ignitions[i].startMs > IGNITION_HOLD_MS + IGNITION_FADE_MS + 100) {
        ignitions.splice(i, 1);
      }
    }
    return max;
  }

  /* ── Tick ───────────────────────────────────────────────────── */
  let _idleNotified = false;
  function tick(now) {
    /* §38 — idle early-out. With no travelling pulses, cascades,
       ignitions or residual bloom there is nothing to animate; skip
       the whole pass. Before this, the loop built a full node-id map
       (Object.fromEntries over every atom), walked every node for
       bloom, and allocated a fresh Map — at 60Hz, forever, even with
       the CSS chamber unmounted. One final fire() lets subscribers
       clear, then the loop coasts until the next event arrives. */
    if (!active.length && !cascades.length && !ignitions.length && !bloomMap.size) {
      if (!_idleNotified) { _idleNotified = true; fire(); }
      return;
    }
    _idleNotified = false;
    /* Drop completed pulses. */
    const stillActive = [];
    for (const p of active) {
      const expired = now - p.startMs >= p.duration;
      if (!expired) stillActive.push(p);
    }
    active = stillActive;

    /* Position each pulse along its current segment. §38 — the id map
       is only needed to position TRAVELLING pulses; don't build it
       (2000+ entries of garbage) when none are in flight. */
    const g = window.omegaGraph;
    const nodesById = (g && active.length)
      ? Object.fromEntries(g.nodes.map((n) => [n.id, n])) : {};
    for (const p of active) {
      const t = (now - p.startMs) / p.duration;
      const segments = p.waypoints.length - 1;
      const totalProgress = Math.min(1, Math.max(0, t)) * segments;
      const stage = Math.min(segments - 1, Math.max(0, Math.floor(totalProgress)));
      const local = totalProgress - stage;
      const a = resolveWaypoint(p.waypoints[stage], p.surface, nodesById);
      const b = resolveWaypoint(p.waypoints[stage + 1], p.surface, nodesById);
      const x = a.x + (b.x - a.x) * local;
      const y = a.y + (b.y - a.y) * local;
      p.x = x; p.y = y; p.progress = t;
      /* Stage 4 — stamp the recede multiplier on each pulse so the
         viewport-space overlay (CoreBeams) can fade older loops. */
      p._ageMult = ageMult(p.loopId);
    }

    /* Bloom accumulation — proximity from pulses (legacy vein-routed
       only; direct darts and the thought-thread walker DO NOT
       contribute proximity bloom, so the cascade ripple is purely
       the reasoning structure lighting up, not the spark moving past). */
    const nodes = g?.nodes || [];
    const newBloom = new Map();
    const pulsesBySurface = {};
    for (const p of active) {
      if (p.direct) continue;
      (pulsesBySurface[p.surface] = pulsesBySurface[p.surface] || []).push(p);
    }
    for (const n of nodes) {
      const ps = pulsesBySurface[n.surface];
      let acc = 0;
      if (ps) {
        for (const p of ps) {
          const dx = n.x - p.x, dy = n.y - p.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < BLOOM_RADIUS) {
            const t = 1 - d / BLOOM_RADIUS;
            acc += BLOOM_PER_PULSE * t * t;
            if (d < 0.8) acc += TOUCH_BONUS;
          }
        }
      }
      acc += cascadeBloomFor(n.id, now);
      acc += ignitionBloomFor(n.id, now);
      const prev = bloomMap.get(n.id) || 0;
      const decayed = prev * BLOOM_DECAY;
      const next = Math.min(BLOOM_CAP, Math.max(decayed, acc));
      if (next > 0.01) newBloom.set(n.id, next);
    }
    bloomMap = newBloom;
    fire();
  }

  function loop() {
    tick(performance.now());
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ── Public renderer-facing API ─────────────────────────────── */
  /* React components subscribe here for re-renders; the heartbeat
     controls (busyness, beatNow, …) forward to omegaScheduler so the
     existing call sites (Tweaks panel, dev console) keep working. */
  window.omegaPulses = {
    subscribe(fn) { subs.add(fn); fire(); return () => subs.delete(fn); },
    get active()    { return active; },
    get bloom()     { return bloomMap; },
    get ignitions() { return ignitions; },
    /* Scheduler controls — forwarded so old callers don't break.
       New code should call window.omegaScheduler directly. */
    get busyness() { return window.omegaScheduler && window.omegaScheduler.busyness; },
    set busyness(v) { if (window.omegaScheduler) window.omegaScheduler.busyness = v; },
    beatNow()                  { return window.omegaScheduler && window.omegaScheduler.beatNow(); },
    enqueueDispatch(id, kind)  { return window.omegaScheduler && window.omegaScheduler.enqueueDispatch(id, kind); },
    cascade(target)            { return window.omegaScheduler && window.omegaScheduler.cascade(target); },
  };
})();
