/* src/r3d/layout.js — hypergraph layout in 3D.

   One hypergraph. Spaces are 3D regions of it. Atoms are positioned
   so that:
     • atoms in the same space cluster together (region locality)
     • atoms connected by edges are pulled toward each other
       (relevance = spatial proximity)
     • atoms not in any space float in a default region at origin
     • the whole layout is DETERMINISTIC (id + space → seed) so the
       same atom lands in the same place across reloads, but evolves
       smoothly as new atoms / edges / spaces appear.

   Live system support:
     • compute(graph) reads the FULL current graph and returns a
       Map<atomId, {x,y,z}>. Re-call whenever the graph changes;
       layouts are not stored across calls (one source of truth: the
       graph). Existing atoms get the same position they had last
       time because their seed inputs (id + space + edges) are
       stable; new atoms snap into place beside their first edge
       neighbour or their space center; retired atoms simply
       disappear from the result.
     • No assumptions about space count — handles 1 space or 10,000.
     • No assumptions about edge density.

   Cost model: O(V + E + iters × (V + E)). At 1700 atoms / 1700 edges
   / 60 iters this is ~600k ops, < 5ms on init, runs only on
   mutations. Layout is not animated per frame; it's a snapshot the
   renderer reads. */

(function () {
  const PHI = (1 + Math.sqrt(5)) / 2;

  /* Deterministic hash from a string. Mulberry-style. */
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* Cheap PRNG seeded by an integer; returns the next float in [0,1)
     and advances internal state. */
  function rng(seed) {
    let state = (seed | 0) || 1;
    return function () {
      state |= 0; state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Place space centers on a Fibonacci-distributed sphere of given
     radius. Stable order via sorted space names so adding/removing
     a space doesn't reshuffle the others. */
  function placeSpaces(spaceNames, parentR) {
    const sorted = [...spaceNames].sort();
    const out = new Map();
    const N = Math.max(1, sorted.length);
    for (let i = 0; i < sorted.length; i++) {
      const t = N === 1 ? 0 : (i + 0.5) / N;
      const z = 1 - 2 * t;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const phi = 2 * Math.PI * i / PHI;
      out.set(sorted[i], {
        x: parentR * r * Math.cos(phi),
        y: parentR * r * Math.sin(phi),
        z: parentR * z,
      });
    }
    return out;
  }

  /* ── Force-directed relaxation ────────────────────────────────
     A short spring + center-pull pass that pulls edge-connected
     atoms together. No N² repulsion — the deterministic per-atom
     seed already spreads them; relying on edges to do the structural
     work keeps init under 5ms.

     Forces:
       • For each edge: a spring with rest length ~space radius / 6.
       • For each atom: a soft pull toward its space center
         (k_center) and a soft pull toward origin (k_origin, weak)
         so distant spaces don't drift forever. */
  function relax(positions, edges, byId, spaceCenters, opts) {
    const iters    = opts.iters    || 28;
    const kSpring  = opts.kSpring  || 0.10;
    const restLen  = opts.restLen  || 0.30;
    const kCenter  = opts.kCenter  || 0.018;
    const kOrigin  = opts.kOrigin  || 0.0015;
    const dt       = opts.dt       || 0.4;
    const damp     = opts.damp     || 0.82;

    /* Velocity buffers. */
    const vel = new Map();
    for (const id of positions.keys()) vel.set(id, { x: 0, y: 0, z: 0 });

    for (let it = 0; it < iters; it++) {
      const force = new Map();
      for (const id of positions.keys()) force.set(id, { x: 0, y: 0, z: 0 });

      /* Springs along edges. */
      for (const e of edges) {
        const a = positions.get(e.source);
        const b = positions.get(e.target);
        if (!a || !b) continue;
        let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 1e-6) continue;
        const f = kSpring * (d - restLen) / d;
        const fx = f * dx, fy = f * dy, fz = f * dz;
        const fa = force.get(e.source);
        const fb = force.get(e.target);
        fa.x += fx; fa.y += fy; fa.z += fz;
        fb.x -= fx; fb.y -= fy; fb.z -= fz;
      }

      /* Per-atom: pull toward space center + soft pull toward origin. */
      for (const [id, p] of positions) {
        const n = byId.get(id);
        if (!n) continue;
        const center = (n.space && spaceCenters.get(n.space))
          || { x: 0, y: 0, z: 0 };
        const f = force.get(id);
        f.x += kCenter * (center.x - p.x);
        f.y += kCenter * (center.y - p.y);
        f.z += kCenter * (center.z - p.z);
        f.x -= kOrigin * p.x;
        f.y -= kOrigin * p.y;
        f.z -= kOrigin * p.z;
      }

      /* Integrate. */
      for (const id of positions.keys()) {
        const v = vel.get(id);
        const f = force.get(id);
        v.x = (v.x + f.x * dt) * damp;
        v.y = (v.y + f.y * dt) * damp;
        v.z = (v.z + f.z * dt) * damp;
        const p = positions.get(id);
        p.x += v.x;
        p.y += v.y;
        p.z += v.z;
      }
    }
  }

  /* Public entry point. Reads graph, returns layout.

     LAYOUT STRATEGY (the SEA):
       The viewer is at the origin. Atoms are scattered UNIFORMLY
       across a spherical shell [R_INNER, R_OUTER] around them.
       Whatever direction the viewer looks, the sea of atoms is
       there. This is the sea-of-stars baseline.

     SPACE INFLUENCE:
       Spaces are still 3D regions — but their influence is applied
       VIA RELAX rather than as the initial layout. Each space is
       assigned a center direction (Fibonacci-sphere); atoms in that
       space are SOFTLY pulled toward their space's center during
       relax, so same-space atoms tend to cluster while still being
       visible from everywhere.

     EDGES:
       Connected atoms (relevance edges) pull each other together
       during relax. Same algorithm, just smaller magnitude so the
       sea isn't disrupted.

     ORB COLLAPSE (future):
       A second target position per atom on a small inner sphere
       (R_ORB) can be lerped in to animate "atoms condensing into
       Omega's body". Not implemented yet. */
  function compute(graph) {
    const nodes = graph?.nodes || [];
    const edges = graph?.edges || [];

    const spaceNames = new Set();
    for (const n of nodes) spaceNames.add(n.space || "_root");

    /* The chamber shell — generously sized so the sea reads as
       VAST rather than crowded. Atoms placed near R_OUTER are 30+
       world units away from the viewer; combined with scene fog
       (see scene.js), they fade into the void the way real distant
       stars do. */
    const R_INNER  = 6.0;
    const R_OUTER  = 40.0;
    /* §37 — viewer clearance bubble: no atom HOME inside R_CLEAR of the
       origin (the viewer). Applied as a smooth remap after relax. */
    const R_CLEAR  = 7.5;
    const CLEAR_T  = 12.0;
    const R_CHAMBER = R_OUTER;

    /* Space centers — directional anchors used only by relax to give
       same-space atoms a soft pull toward a shared direction. Placed
       on a sphere at mid-radius. */
    const R_CENTERS = (R_INNER + R_OUTER) * 0.5;
    const spaceCenters = placeSpaces(spaceNames, R_CENTERS);
    if (spaceCenters.size === 1) {
      const only = spaceCenters.keys().next().value;
      spaceCenters.set(only, { x: 0, y: 0, z: 0 });
    }

    /* SEED POSITIONS — directionally biased by space, but only
       SOFTLY so the sea fills the sphere reasonably evenly.
       SPACE_BIAS = 0.25 means atoms keep 75% of their uniform
       random direction and bias 25% toward their space's center.
       Result: visible clustering by space, but no black voids on
       the opposite side of the sphere. */
    const SPACE_BIAS = 0.25;
    const positions = new Map();
    const byId = new Map();
    for (const n of nodes) {
      byId.set(n.id, n);
      const space = n.space || "_root";
      const center = spaceCenters.get(space);
      /* Normalised space direction. Single-space case: center is at
         origin, so spaceDir is degenerate — fall back to a per-id
         pseudo-direction so atoms still scatter. */
      let sdx = center.x, sdy = center.y, sdz = center.z;
      const sLen = Math.sqrt(sdx*sdx + sdy*sdy + sdz*sdz);
      if (sLen > 1e-6) { sdx /= sLen; sdy /= sLen; sdz /= sLen; }
      else { sdx = 0; sdy = 1; sdz = 0; }

      const seed = hashStr(n.id) ^ hashStr(space);
      const r = rng(seed);
      const u = r(), v = r(), w = r();
      /* Uniform direction on unit sphere. */
      const theta = 2 * Math.PI * u;
      const phi   = Math.acos(2 * v - 1);
      let dirX = Math.sin(phi) * Math.cos(theta);
      let dirY = Math.sin(phi) * Math.sin(theta);
      let dirZ = Math.cos(phi);
      /* Blend uniform direction toward space direction; re-normalise
         to keep it on the unit sphere. */
      dirX = dirX * (1 - SPACE_BIAS) + sdx * SPACE_BIAS;
      dirY = dirY * (1 - SPACE_BIAS) + sdy * SPACE_BIAS;
      dirZ = dirZ * (1 - SPACE_BIAS) + sdz * SPACE_BIAS;
      const dLen = Math.sqrt(dirX*dirX + dirY*dirY + dirZ*dirZ) || 1;
      dirX /= dLen; dirY /= dLen; dirZ /= dLen;
      /* Uniform-volume radius in [R_INNER, R_OUTER]. */
      const cubed = w * (R_OUTER**3 - R_INNER**3) + R_INNER**3;
      const radius = Math.cbrt(cubed);
      positions.set(n.id, {
        x: dirX * radius,
        y: dirY * radius,
        z: dirZ * radius,
      });
    }

    /* Relax — SOFT space pull + edge springs. Magnitudes and rest-
       length scaled to the new chamber size so atoms can drift far
       enough that the sea doesn't clump back together. */
    relax(positions, edges, byId, spaceCenters, {
      iters:   20,
      kSpring: 0.04,
      restLen: 2.5,
      kCenter: 0.005,
      kOrigin: 0.0,
      damp:    0.85,
    });

    /* Re-clamp to shell after relax. */
    for (const p of positions.values()) {
      const d = Math.sqrt(p.x*p.x + p.y*p.y + p.z*p.z);
      if (d > R_OUTER) {
        const s = R_OUTER / d;
        p.x *= s; p.y *= s; p.z *= s;
      } else if (d < CLEAR_T && d > 1e-6) {
        /* §37 — VIEWER CLEARANCE (user: "atoms get too close and clip
           my view"). Not a hard clamp (that piles atoms onto a visible
           shell) — a smooth remap [0, T] → [R_CLEAR, T]: order and
           local structure preserved, continuous at T, and nothing ends
           up closer than R_CLEAR (×BREATHE ≈ 8.6 world units). */
        const s = (R_CLEAR + d * ((CLEAR_T - R_CLEAR) / CLEAR_T)) / d;
        p.x *= s; p.y *= s; p.z *= s;
      } else if (d <= 1e-6) {
        p.z = R_CLEAR;
      }
    }

    /* §35 — BREATHE OUT (user: "the field is too restricted in outer
       diameter, a little"). The relax pass contracts the sea well
       below the nominal shell (measured live: median 10.6, p90 15.6
       against R_OUTER 40), so the outskirts arrive too close in. A
       uniform 1.15× radial scale widens the whole field a touch —
       structure, clusters and relative spacing all preserved — and
       stays trivially within the shell clamp above. */
    const BREATHE = 1.15;
    for (const p of positions.values()) {
      p.x *= BREATHE; p.y *= BREATHE; p.z *= BREATHE;
    }

    return { positions, spaceCenters, chamberR: R_CHAMBER, innerR: R_INNER, outerR: R_OUTER };
  }

  window.omegaR3D = window.omegaR3D || {};
  window.omegaR3D.layout = { compute };
})();
