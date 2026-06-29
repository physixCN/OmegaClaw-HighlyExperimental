/* Attention.jsx — Phase 2 system surface: the salience ribbon.

   "What Omega is attending to right now, and why." The OS view of the
   scheduler's run-queue / ECAN-lite &attention organ. It ranks salience
   evidence from several sources:
     • conversation / memory-pressure / failure / spin  (seed evidence)
     • active agenda goals                              (agenda pressure)
     • the current energy mode                          (posture)
   The top-ranked candidate is the CURRENT_FRAME — what Omega is oriented
   toward this cycle.

   Crucially this is EVIDENCE, not a gate: it informs Omega's choice but
   never controls speech or action (a core OmegaClaw rule). The surface
   says so out loud. It subscribes to omegaState, so changing the energy
   mode visibly re-ranks attention live. */

(function () {
  const ENERGY_WHY = {
    asleep:    "dormant — wake on fresh input or a scheduled wake only",
    listening: "receptive standby for short replies and light checks",
    warm:      "quiet maintenance and housekeeping",
    focused:   "active task execution with broad tool use",
    creative:  "deep generative work and complex synthesis",
  };

  function Row({ r, frame }) {
    const pct = Math.round(Math.max(0, Math.min(1, r.salience)) * 100);
    return (
      <div className={`attn-row cat-${r.category} ${frame ? "is-frame" : ""}`}>
        <div className="attn-row-top">
          <span className="attn-cat">{r.category}</span>
          {frame ? <span className="attn-frame-tag">current frame</span> : null}
          <span className="attn-sal">{r.salience.toFixed(2)}</span>
        </div>
        <div className="attn-label">{r.label}</div>
        <div className="attn-bar"><div className="attn-bar-fill" style={{ width: pct + "%" }}></div></div>
        <div className="attn-why">{r.why}</div>
      </div>
    );
  }

  function AttentionBody() {
    const [mode, setMode] = React.useState(window.omegaState ? window.omegaState.mode : "warm");
    React.useEffect(() => {
      if (!window.omegaState) return;
      return window.omegaState.subscribe((m) => setMode(m));
    }, []);

    const cat = window.omegaCatalog || {};
    const rows = [];
    (cat.attentionSeeds || []).forEach((s) => rows.push(Object.assign({}, s)));
    /* Agenda pressure — top active goals become salience evidence. */
    (cat.agenda || [])
      .filter((g) => g.status === "active")
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3)
      .forEach((g) => rows.push({
        id: "ag-" + g.id, category: "agenda",
        label: g.goal,
        salience: Math.min(0.95, g.priority),
        why: "agenda pressure → " + g.next,
      }));
    /* Energy posture — the current mode as an evidence row. */
    const prof = window.omegaState && window.omegaState.profiles[mode];
    rows.push({
      id: "en", category: "energy",
      label: "energy mode · " + mode,
      salience: prof ? Math.max(0.15, prof.busy * 0.6 + 0.18) : 0.3,
      why: ENERGY_WHY[mode] || "",
    });
    rows.sort((a, b) => b.salience - a.salience);

    return (
      <div className="attn">
        <div className="attn-head">
          <span className="attn-title">attention</span>
          <span className="attn-note">evidence · not a gate</span>
        </div>
        <div className="attn-scroll">
          {rows.map((r, i) => <Row key={r.id} r={r} frame={i === 0} />)}
        </div>
        <div className="attn-src">&amp;attention · role immune · ECAN-lite · speech is never gated</div>
      </div>
    );
  }

  window.AttentionBody = AttentionBody;
})();
