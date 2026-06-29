/* Anatomy.jsx — renders the typed hypergraph onto a surface.

   Perf model:
     • Nodes + veins are FIXED per render (per surface) — they only
       re-render when the graph data changes. Subscribed to
       omegaGraph (rare).
     • Bloom + edge activity are applied via direct DOM style writes
       on every pulse tick — no React reconciliation per frame.
     • Pulses are NOT rendered here. Since the Stage 3 refactor,
       every pulse is `direct: true` and is drawn by CoreBeams in
       viewport space (so beams visibly emanate from the floating
       core). The legacy per-surface pulse renderer was deleted —
       its subscription was firing setState 60×5 times/second for
       an always-empty list, causing visible flicker.

   This avoids the previous architecture's full-tree reconcile on
   every rAF tick, which was the cause of frame drops + flicker at
   ~1400 atoms × 5 surfaces. */

const { useEffect, useState, useMemo, useRef } = React;

function useGraph() {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!window.omegaGraph) return;
    return window.omegaGraph.subscribe(() => setTick((t) => t + 1));
  }, []);
  return {
    nodes: window.omegaGraph?.nodes || [],
    edges: window.omegaGraph?.edges || [],
  };
}

function veinPathBulged(ax, ay, bx, by, bulgeFrac) {
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const bulge = Math.min(len * (bulgeFrac != null ? bulgeFrac : 0.08), 8);
  return `M ${ax} ${ay} Q ${mx + nx * bulge} ${my + ny * bulge} ${bx} ${by}`;
}

const Anatomy = function Anatomy({ surface }) {
  const { nodes, edges } = useGraph();
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const here = useMemo(
    () => nodes.filter((n) => n.surface === surface),
    [nodes, surface]
  );
  const byId = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n])),
    [nodes]
  );

  /* Same seam logic as before for cross-surface edges. */
  function seamOn(mySurface, src, tgt) {
    if (src.surface === mySurface && tgt.surface === mySurface) return null;
    const back = src.surface === "back" ? src : tgt.surface === "back" ? tgt : null;
    const other = src === back ? tgt : src;
    if (!back) return null;
    let backSeam, otherSeam;
    const o = other.surface;
    if (o === "floor")        { const x = (back.x + other.x) / 2; backSeam = { x, y: 100 }; otherSeam = { x, y: 0 }; }
    else if (o === "ceiling") { const x = (back.x + other.x) / 2; backSeam = { x, y: 0 };   otherSeam = { x, y: 100 }; }
    else if (o === "left")    { const y = (back.y + other.y) / 2; backSeam = { x: 0,   y }; otherSeam = { x: 100, y }; }
    else if (o === "right")   { const y = (back.y + other.y) / 2; backSeam = { x: 100, y }; otherSeam = { x: 100, y }; }
    else return null;
    if (mySurface === "back") return { from: src === back ? back : backSeam, to: src === back ? backSeam : back };
    if (mySurface === o)      return { from: src === other ? other : otherSeam, to: src === other ? otherSeam : other };
    return null;
  }

  const localEdges = useMemo(() => {
    const out = [];
    for (const e of edges) {
      const a = byId[e.source];
      const b = byId[e.target];
      if (!a || !b) continue;
      if (a.surface === surface && b.surface === surface) {
        out.push({ e, fromX: a.x, fromY: a.y, toX: b.x, toY: b.y });
        continue;
      }
      const seg = seamOn(surface, a, b);
      if (seg) {
        out.push({ e, fromX: seg.from.x, fromY: seg.from.y, toX: seg.to.x, toY: seg.to.y });
      }
    }
    return out;
  }, [edges, byId, surface]);

  /* DOM-mutating subscription for bloom + edge activity. Bypasses
     React reconciliation; further, caches last-applied values so we
     only write style on elements that ACTUALLY changed each frame.
     This keeps style recalc cost proportional to actively-blooming
     nodes, not to the full node count. */
  useEffect(() => {
    if (!window.omegaPulses) return;
    const lastBloom = new Map();         // nodeId → last applied bloom
    const lastActivity = new Map();      // edgeId → last applied activity
    /* Per-node pending teardown timers — the class is dropped a beat
       after the inline --bloom hits zero so the renderer eases
       brightness back to baseline before the filter property
       disappears. */
    const fadeTimers = new Map();
    /* Cache the polys + veins lists. With ~1700 atoms across the
       five surfaces, the querySelectorAll lookups were running at
       60Hz and walking the whole subtree each time. Caching brings
       it down to a single lookup per surface mount. */
    let polysCache = null;
    let veinsCache = null;
    return window.omegaPulses.subscribe(({ bloom }) => {
      const svg = svgRef.current;
      if (!svg) return;
      if (!polysCache || polysCache.length === 0) {
        polysCache = svg.querySelectorAll(".atom");
      }
      const polys = polysCache;
      for (const poly of polys) {
        const id = poly.getAttribute("data-node-id");
        const b = bloom.get(id) || 0;
        const prev = lastBloom.get(id) || 0;
        // Tightened threshold so the inline --bloom never freezes
        // at a mid-decay value while the bloomMap quietly slides
        // beneath it — was 0.02, now 0.005. The CSS filter
        // transition smooths the resulting micro-steps.
        if (Math.abs(b - prev) < 0.005) continue;
        lastBloom.set(id, b);
        const isBloomed = poly.classList.contains("bloomed");
        // Hysteresis: enter the bloomed state at a higher threshold
        // than we exit it. Without this, an atom whose bloom hovers
        // near the boundary can ping-pong between "active" and
        // "fading out", each flip restarting the CSS filter
        // transition and causing visible flicker. ENTER_T > EXIT_T
        // produces a stable in/out decision per atom.
        const ENTER_T = 0.012;
        const EXIT_T  = 0.004;
        if (b > ENTER_T || (isBloomed && b > EXIT_T)) {
          // Currently active (or crossing in). Cancel any pending
          // teardown and apply the live value.
          const pending = fadeTimers.get(id);
          if (pending) { clearTimeout(pending); fadeTimers.delete(id); }
          poly.style.setProperty("--bloom", b.toFixed(3));
          if (!isBloomed) poly.classList.add("bloomed");
        } else if (isBloomed) {
          // Decay crossed the EXIT threshold. Drive --bloom to 0 so
          // the CSS `transition: filter 220ms` eases brightness +
          // drop-shadow down. Only AFTER the transition completes do
          // we drop the class — at that point the filter is at
          // brightness(1.0) + 0px shadow, which is visually identical
          // to no filter, so the removal is silent.
          poly.style.setProperty("--bloom", "0");
          const old = fadeTimers.get(id);
          if (old) clearTimeout(old);
          fadeTimers.set(id, setTimeout(() => {
            fadeTimers.delete(id);
            // Bail if the atom re-bloomed during the fade.
            if ((lastBloom.get(id) || 0) > EXIT_T) return;
            poly.classList.remove("bloomed");
            poly.style.removeProperty("--bloom");
          }, 400));
        }
      }
      const veins = veinsCache || (veinsCache = svg.querySelectorAll(".vein-group"));
      for (const v of veins) {
        const from = v.getAttribute("data-from");
        const to   = v.getAttribute("data-to");
        const ba = bloom.get(from) || 0;
        const bb = bloom.get(to)   || 0;
        const a = Math.min(1, Math.min(ba, bb) * 1.5);
        const key = `${from}|${to}`;
        const prev = lastActivity.get(key) || 0;
        if (Math.abs(a - prev) < 0.005) continue;
        lastActivity.set(key, a);
        if (a > 0.005) v.style.setProperty("--vein-active", a.toFixed(3));
        else v.style.removeProperty("--vein-active");
      }
    });
  }, [surface, edges.length, nodes.length]);

  return (
    <div className="anatomy">
      <svg
        ref={svgRef}
        className="anatomy-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <filter id="anatomy-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="0.32" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="veins">
          {localEdges.map(({ e, fromX, fromY, toX, toY }) => {
            const d = veinPathBulged(fromX, fromY, toX, toY, e.bulge);
            const thick = e.thickness != null ? e.thickness : 1;
            return (
              <g
                key={e.id}
                className={`vein-group vein-${e.kind || "data"}`}
                data-from={e.source}
                data-to={e.target}
                style={{ "--vein-thickness": thick }}
              >
                <path className="vein vein-base" d={d} />
                <path className="vein vein-lit"  d={d} />
              </g>
            );
          })}
        </g>
        <g className="nodes">
          {here.map((n) => {
            const life = n._lifeScale != null ? n._lifeScale : 1;
            const r = (0.18 + n.salience * 0.30) * life;
            if (r < 0.02) return null;
            return (
              <circle
                key={n.id}
                data-node-id={n.id}
                className={`atom kind-${n.family} status-${n.status}`}
                cx={n.x}
                cy={n.y}
                r={r}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover((h) => (h?.id === n.id ? null : h))}
              />
            );
          })}
        </g>
      </svg>

      {hover && (
        <div
          className="anatomy-label"
          style={{ left: `${hover.x}%`, top: `${hover.y}%` }}
        >
          {hover.label}
        </div>
      )}
    </div>
  );
};

window.Anatomy = Anatomy;
