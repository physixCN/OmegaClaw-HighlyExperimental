/* anatomyGraph.js — live typed hypergraph for Omega.

   ─── BACKEND CONTRACT ─────────────────────────────────────────────
   This module is the bridge between Omega's real symbolic network
   (AtomSpace / MeTTa / Assume / events / skills / etc.) and the
   embossing renderer. The renderer reads ONLY from this module —
   nothing else — so swapping the mock data below for live data from
   OmegaClaw is a single integration point.

   Two integration paths:

     1. window.omegaGraph.applySnapshot({ nodes, edges })
        Replace the entire graph atomically. Use on startup, after a
        space reload, or whenever the source-of-truth is best
        re-broadcast wholesale. Subscribers fire once.

     2. window.omegaGraph.applyDelta({ addNodes, removeNodeIds,
                                       addEdges, removeEdgeIds,
                                       updateNodes, updateEdges })
        Incremental update. Use for live mutation — a new atom
        spawned, a belief retired, an edge added by an inference.
        All fields optional; subscribers fire once at the end.

   ─── REQUIRED NODE FIELDS ─────────────────────────────────────────
     id              unique string
     label           display name
     kind            fine-grained type (e.g. "history-trace",
                     "belief", "skill.web.fetch")
     group           coarse family — one of:
                       spaces, atoms, skills, channels, body-apps,
                       memories, traces, goals, predictions,
                       attention, immune, errors, people, devices,
                       rooms.
                     Unknown groups fall back to 'atoms'.
     surface         OPTIONAL — 'back' | 'floor' | 'ceiling' | 'left'
                     | 'right'. If omitted, derived from group via
                     GROUP_PLACEMENT.
     x, y            OPTIONAL — % within that surface (0..100). If
                     omitted, layoutFromGroup() scatters around the
                     group's centre.
     family          OPTIONAL — visual family ('atom', 'space',
                     'skill', 'memory', etc.). If omitted, derived
                     from group via GROUP_FAMILY.
     sides           OPTIONAL — number of polygon sides for this
                     atom's silhouette (3 = triangle, 4 = square,
                     5 = pentagon, 6 = hexagon (default), 7+ → more
                     round). Defaults from GROUP_SIDES table. The
                     symbolic graph can override per-node so a real
                     space, skill or memory carries its own shape.
     rotation        OPTIONAL — degrees of polygon rotation. Default 0.
     space           which AtomSpace / scope (e.g. 'main', 'world')
     confidence      0..1
     salience        0..1 — drives node size
     status          'active' | 'sleeping' | 'retired' | 'error'
     created_at      ms timestamp
     updated_at      ms timestamp
     metadata        free-form object

   ─── REQUIRED EDGE FIELDS ─────────────────────────────────────────
     id              unique string
     source, target  node ids (must exist in nodes)
     kind            one of: contains, calls, reads, writes, derives,
                     supports, contradicts, promotes, demotes,
                     retires, touches, routes-to, observes, acts-on,
                     verifies, mutates, guards, sleeps, wakes,
                     belongs-to, aliases, depends-on.
                     Unknown kinds → 'data'.
     bulge           OPTIONAL — 0..0.3, how curved the vein is.
                     Default 0.08. The symbolic graph can override
                     so e.g. 'supports' bows out, 'contradicts' is
                     straighter, etc.
     thickness       OPTIONAL — 0.5..3 multiplier on vein stroke.
                     Default 1. Drives visual heft.
     confidence, salience, updated_at, metadata as above

   Below the contract block: mock data + helpers that fill in the
   missing optional fields. Replace the mock seed with applySnapshot()
   when OmegaClaw is wired. */

(function () {
  /* 1–3 groups per surface, distributed across all 5 surfaces so the
     room feels populated on every plane (floor + ceiling included).
     Centres are picked so the groups sit in different quadrants of
     their surface; radii are generous so the scatter doesn't huddle. */
  const GROUP_PLACEMENT = {
    /* BACK wall — cognition (3 quadrants, big radii so atoms reach
       toward the corners of the wall). */
    spaces:     { surface: "back",    x: 50, y: 12, r: 38 },
    atoms:      { surface: "back",    x: 22, y: 58, r: 32 },
    predictions:{ surface: "back",    x: 78, y: 58, r: 32 },

    /* FLOOR — record / intent */
    memories:   { surface: "floor",   x: 25, y: 32, r: 30 },
    traces:     { surface: "floor",   x: 75, y: 32, r: 30 },
    goals:      { surface: "floor",   x: 50, y: 78, r: 26 },

    /* CEILING — sense / situatedness */
    "body-apps":{ surface: "ceiling", x: 50, y: 30, r: 30 },
    devices:    { surface: "ceiling", x: 25, y: 75, r: 22 },
    rooms:      { surface: "ceiling", x: 75, y: 75, r: 20 },

    /* LEFT wall — skills + immune */
    skills:     { surface: "left",    x: 50, y: 32, r: 40 },
    attention:  { surface: "left",    x: 22, y: 80, r: 18 },
    immune:     { surface: "left",    x: 78, y: 80, r: 18 },

    /* RIGHT wall — connections to the world */
    channels:   { surface: "right",   x: 50, y: 30, r: 36 },
    people:     { surface: "right",   x: 22, y: 80, r: 22 },
    errors:     { surface: "right",   x: 78, y: 80, r: 18 },
  };
  const GROUP_FAMILY = {
    spaces: "space", atoms: "atom", skills: "skill", channels: "channel",
    "body-apps": "sense", memories: "memory", traces: "memory",
    goals: "belief", predictions: "predict", attention: "attention",
    immune: "attention", errors: "error", people: "person",
    devices: "device", rooms: "room",
  };

  /* Default polygon-side count per group. Real backend nodes can
     override via the `sides` field; this is just the fallback so
     existing data renders sensibly. */
  const GROUP_SIDES = {
    spaces: 8,       // membrane-ish, more sides
    atoms: 6,
    skills: 5,
    channels: 6,
    "body-apps": 6,
    memories: 6,
    traces: 6,
    goals: 5,
    predictions: 6,
    attention: 6,
    immune: 6,
    errors: 3,       // triangular — visually agitated
    people: 7,
    devices: 4,      // square
    rooms: 4,
  };

  /* Reseed: map each procedural group onto Omega's REAL named runtime
     spaces (omegaCatalog), so atoms are tagged with the space they
     ACTUALLY belong to (not the old 'main'/'world' stand-ins) and seed
     as members INSIDE each space. This is Phase 0.5 + the Memory organ
     (Evolution Plan §12.1): a gathered space only reads as a place if
     its atoms are genuinely its members. `family` still drives colour.
     When live OmegaClaw is wired, applySnapshot() replaces all of it. */
  const SPACE_MAP = {
    memories:    (i) => ["events", "activity", "persistent"][i % 3],
    traces:      (i) => (i % 4 === 3 ? "events" : "activity"),
    goals:       () => "agenda",
    predictions: (i) => (i % 2 ? "beliefs" : "assume"),
    atoms:       (i) => (i % 2 ? "world" : "beliefs"),
    attention:   () => "attention",
    immune:      () => "attention",
    errors:      () => "events",
    channels:    () => "world",
    "body-apps": () => "world",
    people:      () => "world",
    devices:     () => "world",
    rooms:       () => "world",
    skills:      () => "skills",     // the affordance wall (an organ, not a memory space)
  };
  function spaceForGroup(group, i) {
    const f = SPACE_MAP[group];
    return f ? f(i) : "world";
  }

  const now = () => Date.now();

  /* Atom counts — real-ish numbers so the walls feel populated.
     Heartbeat traffic is throttled separately in anatomyPulses.js
     so high density + low traffic gives a calm, large-system feel. */
  const counts = {
    "spaces":         (window.omegaCatalog && window.omegaCatalog.spaces.length) || 3,
    "atoms":         60,
    "skills":       210,
    "channels":       8,
    "body-apps":     14,
    "memories":     420,
    "traces":       560,
    "goals":         54,
    "predictions":  284,
    "attention":     22,
    "immune":        15,
    "errors":         9,
    "people":        14,
    "devices":       22,
    "rooms":          7,
  };

  // Seeded pseudo-random so positions are stable across reloads.
  let _seed = 1;
  function rnd() { _seed = (_seed * 9301 + 49297) % 233280; return _seed / 233280; }

  function scatter(group, i, n) {
    const p = GROUP_PLACEMENT[group] || GROUP_PLACEMENT.atoms;
    // Sunflower-like distribution inside a disk for even coverage.
    const golden = Math.PI * (3 - Math.sqrt(5));
    const angle = i * golden + rnd() * 0.4;
    const radius = p.r * Math.sqrt((i + 0.5) / n);
    return {
      surface: p.surface,
      x: p.x + Math.cos(angle) * radius,
      y: p.y + Math.sin(angle) * radius,
    };
  }

  /* Real-shaped overrides — the `spaces` and `skills` groups are seeded
     from omegaCatalog (the grounded mirror of OmegaClaw) so the walls
     carry the ACTUAL runtime spaces + core skill cards instead of
     random noise. Everything else stays procedurally generated for
     density. When live OmegaClaw is wired, applySnapshot() replaces
     all of this wholesale. */
  function catalogOverride(group, i) {
    const cat = window.omegaCatalog;
    if (!cat) return null;
    if (group === "spaces") {
      const s = cat.spaces[i];
      if (!s) return null;
      return {
        label: s.name,
        salience: 0.86,
        confidence: 1.0,
        sides: 8,
        /* The space-header atom lives IN its own region as the labelled
           anchor — so a space's members cluster around their name, and
           the knowledge-graph continent has a clear centre to gather to. */
        space: s.name,
        status: "active",
        metadata: { real: true, atomKind: "space", spaceAnchor: true,
                    budget: s.budget, role: s.role, note: s.note },
      };
    }
    if (group === "skills") {
      const sk = cat.skills[i];
      if (!sk) return null;
      return {
        label: sk.name,
        salience: sk.pw ? sk.pw.weight : 0.6,
        confidence: 1.0,
        sides: 5,
        status: "active",
        metadata: { real: true, atomKind: "skill", topics: sk.topics,
                    arg: sk.arg, risk: sk.risk, effect: sk.effect,
                    pw: sk.pw, card: sk.card },
      };
    }
    return null;
  }

  const nodes = [];
  for (const [group, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      const pos = scatter(group, i, n);
      const ov = catalogOverride(group, i) || {};
      nodes.push({
        id: `${group}-${i}`,
        label: ov.label || `${group.slice(0, -1)} ${i}`,
        kind: group,
        group,
        family: GROUP_FAMILY[group] || "atom",
        surface: pos.surface,
        x: pos.x,
        y: pos.y,
        sides: ov.sides,
        space: ov.space || spaceForGroup(group, i),
        confidence: ov.confidence != null ? ov.confidence : 0.5 + rnd() * 0.5,
        salience: ov.salience != null ? ov.salience : rnd(),
        status: ov.status || (rnd() < 0.94 ? "active"
              : rnd() < 0.5 ? "sleeping" : "retired"),
        created_at: now() - rnd() * 1e9,
        updated_at: now() - rnd() * 1e7,
        metadata: ov.metadata || {},
      });
    }
  }

  /* ── Intra-space edges (the knowledge-graph veins) ─────────────
     Edges now ground REAL intra-space relationships. Members of the
     same named space are wired into a sparse graph — a continuity
     RING + radial SPOKES to the space's anchor + a few random CHORDS
     — so that when a space GATHERS into a continent (Evolution Plan
     §12.1/§15) it has structure, not just scattered dots. A thin
     layer of cross-space veins links related spaces. ~1.5 edges/node.
     applySnapshot() replaces these with real relationships when the
     live loop is wired. */
  const edges = [];
  function pushEdge(a, b, kind, bulge) {
    if (a == null || b == null || a === b) return;
    edges.push({
      id: `e-${edges.length}`,
      source: nodes[a].id,
      target: nodes[b].id,
      kind, bulge,
      confidence: 0.4 + rnd() * 0.6,
      salience: rnd(),
      updated_at: now(),
      metadata: {},
    });
  }
  const bySpace = {};
  for (let i = 0; i < nodes.length; i++) {
    (bySpace[nodes[i].space] = bySpace[nodes[i].space] || []).push(i);
  }
  for (const sp of Object.keys(bySpace)) {
    const pool = bySpace[sp];
    if (pool.length < 2) continue;
    // hub = the space-header atom if present, else the first member.
    let hub = pool.find((i) => nodes[i].metadata && nodes[i].metadata.spaceAnchor);
    if (hub == null) hub = pool[0];
    for (let k = 0; k < pool.length; k++) {
      const a = pool[k];
      pushEdge(a, pool[(k + 1) % pool.length], "supports", 0.10);          // continuity ring
      if (a !== hub && rnd() < 0.34) pushEdge(a, hub, "contains", 0.05);   // radial spoke to anchor
      if (rnd() < 0.16) pushEdge(a, pool[(rnd() * pool.length) | 0], "derives", 0.16); // chord
    }
  }
  /* Cross-space veins — a few relationships that bridge related spaces
     (events↔activity, beliefs↔assume, …). Sparse, so each space still
     reads as its own continent when gathered. */
  const BRIDGES = [
    ["events", "activity"], ["beliefs", "assume"], ["persistent", "beliefs"],
    ["agenda", "activity"], ["world", "beliefs"], ["events", "persistent"],
  ];
  for (const [sa, sb] of BRIDGES) {
    const pa = bySpace[sa], pb = bySpace[sb];
    if (!pa || !pb) continue;
    const want = Math.min(14, Math.floor(Math.min(pa.length, pb.length) * 0.1));
    for (let i = 0; i < want; i++) {
      pushEdge(pa[(rnd() * pa.length) | 0], pb[(rnd() * pb.length) | 0], "derives", 0.2);
    }
  }

  const subs = new Set();
  const fire = () => subs.forEach((fn) => fn({ nodes, edges }));

  /* Fill in optional fields on an inbound node. Mutates in place.
     Also seeds the per-frame tween fields used by tick(): _lifeScale,
     _targetX, _targetY. New nodes are born at scale 0 and ease to 1. */
  function normaliseNode(n) {
    if (!n.group) n.group = "atoms";
    if (!n.kind) n.kind = n.group;
    if (!n.family) n.family = GROUP_FAMILY[n.group] || "atom";
    if (!n.surface || n.x == null || n.y == null) {
      const p = GROUP_PLACEMENT[n.group] || GROUP_PLACEMENT.atoms;
      if (!n.surface) n.surface = p.surface;
      if (n.x == null || n.y == null) {
        // Sunflower-like scatter using a hash of the id so positions
        // are stable across snapshot reloads.
        let h = 0;
        for (let i = 0; i < n.id.length; i++) h = (h * 31 + n.id.charCodeAt(i)) | 0;
        const idx = (h & 0xffff) / 0xffff;
        const angle = idx * Math.PI * 2 * 7.5;
        const radius = p.r * Math.sqrt(idx);
        n.x = p.x + Math.cos(angle) * radius;
        n.y = p.y + Math.sin(angle) * radius;
      }
    }
    if (n.confidence == null) n.confidence = 0.8;
    if (n.salience  == null) n.salience  = 0.5;
    if (!n.status) n.status = "active";
    if (n.sides == null) n.sides = GROUP_SIDES[n.group] || 6;
    if (n.rotation == null) n.rotation = 0;
    if (n.created_at == null) n.created_at = now();
    n.updated_at = now();
    if (!n.metadata) n.metadata = {};
    // Tween bookkeeping — initialized at the data's current position
    // so existing nodes don't animate from somewhere else on first
    // tick. Born flag means scale animates from 0.
    n._targetX = n._targetX != null ? n._targetX : n.x;
    n._targetY = n._targetY != null ? n._targetY : n.y;
    n._lifeScale = n._lifeScale != null ? n._lifeScale : 1;
    n._lifeTarget = n._lifeTarget != null ? n._lifeTarget : 1;
    return n;
  }

  function normaliseEdge(e) {
    if (!e.id) e.id = `e-${edges.length}-${Math.random().toString(36).slice(2, 7)}`;
    if (!e.kind) e.kind = "data";
    if (e.confidence == null) e.confidence = 0.8;
    if (e.salience   == null) e.salience   = 0.5;
    // Visual overrides — the symbolic graph can shape its links.
    if (e.bulge     == null) e.bulge     = 0.08;
    if (e.thickness == null) e.thickness = 1;
    e.updated_at = now();
    if (!e.metadata) e.metadata = {};
    return e;
  }

  window.omegaGraph = {
    get nodes() { return nodes; },
    get edges() { return edges; },
    placementFor(g) { return GROUP_PLACEMENT[g] || GROUP_PLACEMENT.atoms; },
    familyFor(g)    { return GROUP_FAMILY[g] || "atom"; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

    /* ─── Live ingestion ────────────────────────────────────────
       applySnapshot replaces the entire graph atomically. Use on
       startup or whenever OmegaClaw rebroadcasts. Subscribers fire
       once at the end. Inbound nodes/edges are normalised so
       optional fields (surface, x/y, family, …) are filled in
       deterministically by id. */
    applySnapshot(snap) {
      const { nodes: ns = [], edges: es = [] } = snap || {};
      nodes.length = 0;
      edges.length = 0;
      const ids = new Set();
      for (const n of ns) {
        if (!n.id || ids.has(n.id)) continue;
        ids.add(n.id);
        nodes.push(normaliseNode({ ...n }));
      }
      for (const e of es) {
        if (!ids.has(e.source) || !ids.has(e.target)) continue;
        edges.push(normaliseEdge({ ...e }));
      }
      fire();
    },

    /* applyDelta accepts any combination of incremental changes. All
       fields optional. Subscribers fire once at the end. */
    applyDelta(delta) {
      const {
        addNodes = [], removeNodeIds = [],
        addEdges = [], removeEdgeIds = [],
        updateNodes = [], updateEdges = [],
      } = delta || {};

      // Removes first so adds with new ids can reuse them.
      const rmNodeSet = new Set(removeNodeIds);
      if (rmNodeSet.size) {
        for (let i = nodes.length - 1; i >= 0; i--) {
          if (rmNodeSet.has(nodes[i].id)) nodes.splice(i, 1);
        }
        for (let i = edges.length - 1; i >= 0; i--) {
          if (rmNodeSet.has(edges[i].source) || rmNodeSet.has(edges[i].target)) edges.splice(i, 1);
        }
      }
      const rmEdgeSet = new Set(removeEdgeIds);
      if (rmEdgeSet.size) {
        for (let i = edges.length - 1; i >= 0; i--) {
          if (rmEdgeSet.has(edges[i].id)) edges.splice(i, 1);
        }
      }
      // Adds.
      const nodeIds = new Set(nodes.map((n) => n.id));
      for (const n of addNodes) {
        if (!n.id || nodeIds.has(n.id)) continue;
        nodeIds.add(n.id);
        nodes.push(normaliseNode({ ...n }));
      }
      for (const e of addEdges) {
        if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
        edges.push(normaliseEdge({ ...e }));
      }
      // Patches.
      for (const u of updateNodes) {
        const i = nodes.findIndex((n) => n.id === u.id);
        if (i >= 0) Object.assign(nodes[i], u, { updated_at: now() });
      }
      for (const u of updateEdges) {
        const i = edges.findIndex((e) => e.id === u.id);
        if (i >= 0) Object.assign(edges[i], u, { updated_at: now() });
      }
      fire();
    },

    addNode(n) {
      const node = normaliseNode({ ...n });
      // Born from nothing — scale animates from 0.
      node._lifeScale = 0;
      node._lifeTarget = 1;
      nodes.push(node);
      fire();
      return node.id;
    },
    removeNode(id) {
      const i = nodes.findIndex((n) => n.id === id);
      if (i >= 0) nodes.splice(i, 1);
      for (let j = edges.length - 1; j >= 0; j--) {
        if (edges[j].source === id || edges[j].target === id) edges.splice(j, 1);
      }
      fire();
    },

    /* Retire a node: animate scale → 0, then remove from the graph.
       Edges retract because they read live positions. */
    retireNode(id) {
      const n = nodes.find((x) => x.id === id);
      if (!n) return;
      n._lifeTarget = 0;
      n.status = "retired";
      // Actual removal happens in tick() once _lifeScale near zero.
    },

    /* Move a node to a new (x, y). Tween eases there over ~700ms. */
    moveNode(id, x, y) {
      const n = nodes.find((nn) => nn.id === id);
      if (!n) return;
      n._targetX = x;
      n._targetY = y;
    },

    addEdge(e) { edges.push(normaliseEdge({ ...e })); fire(); },
    removeEdge(id) {
      const i = edges.findIndex((e) => e.id === id);
      if (i >= 0) edges.splice(i, 1);
      fire();
    },

    /* Merge B into A: B's position eases toward A, B's scale eases
       to 0, edges touching B get re-routed to A's id. Once B has
       fully shrunk, it's removed. Pulses that referenced B by id
       follow B's moving position into A and then continue along the
       re-routed edge — the hand-off is seamless. */
    mergeNodes(idA, idB, label) {
      const a = nodes.find((n) => n.id === idA);
      const b = nodes.find((n) => n.id === idB);
      if (!a || !b) return;
      // Re-route edges B → A. Drop any A↔A self-loops.
      for (let i = edges.length - 1; i >= 0; i--) {
        const e = edges[i];
        if (e.source === b.id) e.source = a.id;
        if (e.target === b.id) e.target = a.id;
        if (e.source === e.target) edges.splice(i, 1);
      }
      // B slides toward A and shrinks.
      b._targetX = a.x;
      b._targetY = a.y;
      b._lifeTarget = 0;
      b.status = "retired";
      // A absorbs B's salience.
      a.salience = Math.min(1, Math.max(a.salience, b.salience) + 0.05);
      if (label) a.label = label;
      a.updated_at = now();
      a._lifeScale = Math.min(1.3, (a._lifeScale || 1) + 0.15);  // brief swell
      a._lifeTarget = 1;
      fire();
    },

    /* Per-frame tween — called by the pulse module's rAF loop so all
       motion runs on a single timeline. Eases x/y toward target,
       _lifeScale toward _lifeTarget. Removes nodes whose lifeScale
       has fully collapsed (retired). */
    tick(dtMs) {
      const dt = Math.min(0.064, dtMs / 1000);
      const posK = 6;       // position spring stiffness (1/s)
      const lifeK = 5;      // life-scale spring stiffness
      let dirty = false;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        // Position
        const dx = n._targetX - n.x;
        const dy = n._targetY - n.y;
        if (Math.abs(dx) > 0.002 || Math.abs(dy) > 0.002) {
          n.x += dx * Math.min(1, posK * dt);
          n.y += dy * Math.min(1, posK * dt);
          dirty = true;
        }
        // Life scale
        const dl = n._lifeTarget - n._lifeScale;
        if (Math.abs(dl) > 0.002) {
          n._lifeScale += dl * Math.min(1, lifeK * dt);
          dirty = true;
        } else {
          n._lifeScale = n._lifeTarget;
        }
        // Garbage-collect fully retired nodes.
        if (n._lifeTarget <= 0 && n._lifeScale < 0.04) {
          const removedId = n.id;
          nodes.splice(i, 1);
          for (let j = edges.length - 1; j >= 0; j--) {
            if (edges[j].source === removedId || edges[j].target === removedId) edges.splice(j, 1);
          }
          dirty = true;
        }
      }
      if (dirty) fire();
    },
  };
})();
