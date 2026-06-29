/* CoreBeams.jsx — viewport-space overlay drawing real beams from
   the FLOATING core sphere to each direct dart's target.

   The pre-existing dart pulses live inside per-surface 3D SVGs and
   travel from the wall's local "anchor" point — so visually they
   start at the centre of the wall, not at the core sphere that
   floats in the middle of the room. This overlay fixes that by
   rendering a second layer in screen-space:

     • measure the .core element's screen rect each frame (the core
       sphere)
     • for each active direct dart, locate its target's polygon via
       data-node-id, get its screen rect
     • interpolate the dart's progress between those two screen
       positions, draw a glowing head + a faint trailing line from
       the core to the head

   The screen-space layer ignores 3D perspective entirely — its
   coordinate space IS the viewport, so the line truly emanates from
   the visible core regardless of which wall the target is on. */

(function () {
  const { useState, useEffect } = React;

  const CoreBeams = function CoreBeams() {
    const [, setTick] = useState(0);
    useEffect(() => {
      if (!window.omegaPulses) return;
      /* Re-render only when there's something to render. The pulse
         subscriber fires 60Hz; a naive setTick on every fire forced
         60 React reconciliations per second even when no beams or
         flashes were live — visible as background jitter in other
         layers. Gate on (active.length > 0 || ignitions.length > 0)
         so the bus quiets the moment the chamber goes idle. */
      let lastHadWork = false;
      return window.omegaPulses.subscribe((s) => {
        const hasWork =
          (s.pulses && s.pulses.length > 0) ||
          (window.omegaPulses.ignitions && window.omegaPulses.ignitions.length > 0);
        if (hasWork || lastHadWork) {
          // Render this frame; if work just ended, render ONE more
          // frame so beams + flashes clear cleanly.
          lastHadWork = hasWork;
          setTick((t) => t + 1);
        }
      });
    }, []);

    const coreEl = typeof document !== "undefined"
      ? document.querySelector(".core") : null;
    const coreRect = coreEl && coreEl.getBoundingClientRect();
    const ox = coreRect ? coreRect.left + coreRect.width  / 2 : 0;
    const oy = coreRect ? coreRect.top  + coreRect.height / 2 : 0;

    const beams = [];
    const flashes = [];
    /* Snapshot the renderer's current loopId for the recede math
       below. We can't call the renderer's own ageMult() from here
       (no leak), so we compute it locally from any pulse's loopId
       and the highest seen in the active list. */
    let _maxSeenLoopId = -1;
    if (window.omegaPulses) {
      for (const p of window.omegaPulses.active) {
        if (typeof p.loopId === "number" && p.loopId > _maxSeenLoopId) {
          _maxSeenLoopId = p.loopId;
        }
      }
      const igs = window.omegaPulses.ignitions || [];
      for (const ig of igs) {
        if (typeof ig.loopId === "number" && ig.loopId > _maxSeenLoopId) {
          _maxSeenLoopId = ig.loopId;
        }
      }
    }
    const RECEDE_PER_GEN = 0.40;
    const RECEDE_FLOOR   = 0.18;
    function ageMultFor(loopId) {
      if (typeof loopId !== "number" || _maxSeenLoopId < 0) return 1;
      const age = Math.max(0, _maxSeenLoopId - loopId);
      if (age === 0) return 1;
      return Math.max(RECEDE_FLOOR, 1 - age * RECEDE_PER_GEN);
    }
    if (coreRect && window.omegaPulses) {
      function screenOf(wp) {
        if (!wp) return null;
        if (wp.anchor) return { x: ox, y: oy };
        const el = document.querySelector(`[data-node-id="${wp.nodeId}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      /* Ignition flashes — a brief expanding ring + bright dot at
       each landing site, drawn for the lifetime of the ignition.
       This is the visible IMPACT that makes the dart→cascade hand-
       off read as causal ("the spark just hit") rather than as two
       unrelated effects nearby. Sourced from omegaPulses.ignitions
       so the data lives in one place. */
      const FLASH_MS = 360;
      const now = performance.now();
      const igs = window.omegaPulses.ignitions || [];
      for (const ig of igs) {
        const t = now - ig.startMs;
        if (t < 0 || t > FLASH_MS) continue;
        const el = document.querySelector(`[data-node-id="${ig.nodeId}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const k = t / FLASH_MS;                  // 0..1
        const radius = 4 + k * 28;               // expand outward
        /* Stage 4 — fade older loop generations so the freshest beat
           dominates. ageMultFor returns 1 for the current loopId, a
           soft floor for many-generations-old. */
        const am = ageMultFor(ig.loopId);
        const ringOpacity = Math.max(0, 1 - k) * 0.9 * am;
        const coreOpacity = Math.max(0, 1 - k * 1.6) * am;
        flashes.push({
          id: ig.startMs + ":" + ig.nodeId,
          cx, cy, radius, ringOpacity, coreOpacity,
        });
      }
      for (const p of window.omegaPulses.active) {
        if (!p.direct) continue;
        const wps = p.waypoints;
        if (!wps || wps.length < 2) continue;
        /* Walk the spark along the ACTIVE segment so multi-waypoint
           pulses (the thought-thread cascade walker) visibly turn
           corners through each intermediate atom, rather than
           straight-lining from first waypoint to last. */
        const segments = wps.length - 1;
        const tNorm = Math.min(1, Math.max(0, p.progress || 0));
        const totalProgress = tNorm * segments;
        const stage = Math.min(segments - 1, Math.max(0, Math.floor(totalProgress)));
        const local = totalProgress - stage;
        const from = screenOf(wps[stage]);
        const to   = screenOf(wps[stage + 1]);
        if (!from || !to) continue;
        const x = from.x + (to.x - from.x) * local;
        const y = from.y + (to.y - from.y) * local;
        /* Shooting-star tail — short streak behind the head in the
           direction of travel along the CURRENT segment, so the tail
           bends with the chain rather than pointing at the final
           waypoint. */
        const dx = to.x - from.x, dy = to.y - from.y;
        const dist = Math.hypot(dx, dy) || 1;
        const tailLen = Math.min(34, dist * 0.22);
        const tailX = x - (dx / dist) * tailLen;
        const tailY = y - (dy / dist) * tailLen;
        beams.push({
          id: p.id, x, y, tailX, tailY, color: p.color,
          thread: !!p._thread, ret: !!p._return,
          ageMult: typeof p._ageMult === "number" ? p._ageMult : ageMultFor(p.loopId),
        });
      }
    }

    return (
      <svg className="core-beams" aria-hidden="true">
        <defs>
          <filter id="core-beam-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#core-beam-glow)">
          {flashes.map((f) => (
            <g key={f.id}>
              <circle
                cx={f.cx} cy={f.cy} r={f.radius}
                fill="none"
                stroke="#FFF6D8"
                strokeOpacity={f.ringOpacity}
                strokeWidth="1.2"
              />
              <circle
                cx={f.cx} cy={f.cy} r="3.2"
                fill="#FFF6D8"
                fillOpacity={f.coreOpacity}
              />
            </g>
          ))}
          {beams.map((b) => (
            <g key={b.id}>
              <line
                x1={b.tailX} y1={b.tailY}
                x2={b.x}     y2={b.y}
                stroke={b.color}
                strokeOpacity={0.55 * b.ageMult}
                strokeWidth="0.9"
                strokeLinecap="round"
              />
              <circle cx={b.x} cy={b.y} r="2.4" fill={b.color} fillOpacity={0.22 * b.ageMult} />
              <circle cx={b.x} cy={b.y} r="1.3" fill={b.color} fillOpacity={0.65 * b.ageMult} />
              <circle cx={b.x} cy={b.y} r="0.6" fill="#FFF6D8" fillOpacity={0.95 * b.ageMult} />
            </g>
          ))}
        </g>
      </svg>
    );
  };

  window.CoreBeams = CoreBeams;
})();
