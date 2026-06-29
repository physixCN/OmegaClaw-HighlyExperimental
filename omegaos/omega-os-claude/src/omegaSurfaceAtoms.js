/* omegaSurfaceAtoms.js — grounds WHICH atom CAUSES each surface, so a
   window emanates from (and ignites) the affordance / skill atom that
   opened it. "Every surface opens from the right atom."

   ── Why this is representation, not cognition ──────────────────────
   The DECISION to open a surface is the intent (Omega or the user, via
   omegaIntents). This module only answers a rendering/provenance
   question: "which atom embodies this action?" — mirroring the real
   (ActionAffordance …) / skill affordance cards. When live OmegaClaw
   opens a surface it already knows the skill it invoked and will pass it
   as intent.surface.fromAtom (its trace_ref). Until then this map +
   planted affordance atoms stand in (mock-behind-live-shape). The
   membrane decides nothing; it just lets the window grow out of its cause.

   ── How a surface uses it ──────────────────────────────────────────
   On an open-surface intent, App resolves the causing atom
   (intent.surface.fromAtom ?? causingAtomFor(kind)), IGNITES it (a visible
   dispatch dart — cascade, NOT invoke, so no registered action re-fires),
   and — if the atom is on-screen — opens the window as an edge-morph out of
   that atom's silhouette (the atom stays lit on its wall; it is the cause,
   not consumed like a drilled-into / inspected atom). */

(function () {
  /* surface kind → causing atom LABEL. Existing catalog / loop atoms are
     reused where they already live on a wall; the media affordances are
     PLANTed below as real atoms. A `&space` value lets cascade pick a
     member of that space as the origin (e.g. agenda / attention regions). */
  const KIND_ATOM = {
    /* Senses — a fresh user input arriving (loop receive()). */
    chat:       "receive",
    receive:    "receive",
    /* Hands — media / IO affordances. */
    image:      "show image",
    video:      "play video",
    youtube:    "play video",
    audio:      "play audio",
    song:       "play audio",
    browser:    "open browser",
    web:        "open browser",
    map:        "open browser",
    /* Existing core skills (already atoms on the skills wall). */
    document:   "read-file",
    doc:        "read-file",
    note:       "read-file",
    folder:     "read-file",
    files:      "read-file",
    terminal:   "shell",
    shell:      "shell",
    console:    "console",
    timeline:   "activity-traces",
    activity:   "activity-traces",
    events:     "events-all",
    /* System organ surfaces — emanate from their space region. */
    agenda:     "&agenda",
    attention:  "&attention",
    /* Voice — Omega speaking out. */
    send:       "send",
    /* No grounded cause yet → opens without a morph anchor. */
    lorem:      null,
    reasoning:  null,
    inspect:    null,
  };

  /* Affordances to PLANT if missing — the ones that aren't already a
     catalog skill or loop primitive. Senses → channels (right wall);
     Hands → skills (left wall). Positions are a hint; the webgl layout
     places by group/space, so they join the right cluster either way. */
  const PLANT = [
    { label: "receive",      group: "channels", space: "events", surface: "right", x: 50, y: 28, sides: 6, salience: 0.82, family: "channel" },
    { label: "show image",   group: "skills",   space: "skills", surface: "left",  x: 36, y: 22, sides: 5, salience: 0.70 },
    { label: "play video",   group: "skills",   space: "skills", surface: "left",  x: 64, y: 22, sides: 5, salience: 0.72 },
    { label: "play audio",   group: "skills",   space: "skills", surface: "left",  x: 36, y: 46, sides: 5, salience: 0.66 },
    { label: "open browser", group: "skills",   space: "skills", surface: "left",  x: 64, y: 46, sides: 5, salience: 0.70 },
  ];

  let planted = false;
  function plant() {
    if (planted) return;
    const g = window.omegaGraph;
    if (!g || !g.applyDelta) return;
    planted = true;
    const have = new Set(g.nodes.map((n) => n.label));
    const addNodes = PLANT
      .filter((p) => !have.has(p.label))
      .map((p) => ({
        id: "afford-" + p.label.replace(/\s+/g, "-"),
        label: p.label, group: p.group, kind: p.group,
        family: p.family || "skill", space: p.space, surface: p.surface,
        x: p.x, y: p.y, sides: p.sides, confidence: 1.0, salience: p.salience,
        status: "active",
        metadata: { real: true, atomKind: "affordance",
                    note: "opens the " + p.label + " surface" },
      }));
    if (addNodes.length) g.applyDelta({ addNodes });   // one rebuild
  }

  /* label → node id (cascade ignites by id; a `&space` passes through). */
  function idForLabel(label) {
    if (typeof label === "string" && label[0] === "&") return label;
    const g = window.omegaGraph;
    if (!g) return null;
    const n = g.nodes.find((x) => x.label === label);
    return n ? n.id : null;
  }

  function causingAtomFor(kind) {
    if (!kind) return null;
    return Object.prototype.hasOwnProperty.call(KIND_ATOM, kind)
      ? KIND_ATOM[kind] : null;
  }

  /* Ignite the causing atom — a visible dispatch dart + ignition — WITHOUT
     firing any registered skill action (cascade is gated separately from
     invoke). Purely the "it fired" visual: the atom that caused the surface
     lights up as the surface opens. */
  function ignite(label) {
    const tgt = idForLabel(label);
    if (tgt && window.omegaScheduler && window.omegaScheduler.cascade) {
      window.omegaScheduler.cascade(tgt);
    }
  }

  window.omegaSurfaceAtoms = {
    plant, causingAtomFor, idForLabel, ignite,
    get map() { return KIND_ATOM; },
  };
})();
