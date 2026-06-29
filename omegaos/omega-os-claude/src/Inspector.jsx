/* Inspector.jsx — the first Phase 2 system surface.

   Renders an atom's REAL card: a space's role / char-budget, or a
   skill's topics / arg / risk / effect / PreferredWhen weight. Data
   comes from omegaCatalog (the grounded mirror of OmegaClaw); when the
   live loop is wired the same surface reads live atoms instead.

   Opened via an `inspect` intent (origin user or omega) — so the human
   and Omega reach it through the same bus, including by clicking an
   atom in the 3D sea. Layout: the provenance footer is PINNED to the
   bottom (always visible) and the card body scrolls, so the source
   reference is never clipped — exact source is always one glance away. */

(function () {
  function Bar({ value, tone }) {
    const pct = Math.round(Math.max(0, Math.min(1, value || 0)) * 100);
    return (
      <div className="insp-bar">
        <div className={`insp-bar-fill ${tone || ""}`} style={{ width: pct + "%" }}></div>
      </div>
    );
  }

  /* Shell — pinned header + scrollable body + pinned provenance. */
  function Shell({ kind, name, src, children }) {
    return (
      <div className="insp">
        <div className="insp-head">
          <span className="insp-kind">{kind}</span>
          <span className="insp-name">{name}</span>
        </div>
        <div className="insp-scroll">{children}</div>
        <div className="insp-src">{src}</div>
      </div>
    );
  }

  function SkillCard({ s }) {
    return (
      <Shell kind="skill" name={s.name} src="src/skill_affordance_core.metta">
        <p className="insp-card">{s.card}</p>
        <div className="insp-chips">
          {(s.topics || []).map((t) => (
            <span className="insp-chip" key={t}>{t}</span>
          ))}
        </div>
        <dl className="insp-grid">
          {s.arg ? (<React.Fragment><dt>arg</dt><dd>{s.arg}</dd></React.Fragment>) : null}
          <React.Fragment><dt>effect</dt><dd>{s.effect}</dd></React.Fragment>
          {s.risk ? (<React.Fragment><dt>risk</dt><dd className="insp-risk">{s.risk}</dd></React.Fragment>) : null}
        </dl>
        {s.pw ? (
          <div className="insp-pw">
            <div className="insp-pw-row">
              <span className="insp-pw-label">preferred when · {s.pw.situation}</span>
              <span className="insp-pw-val">{s.pw.weight.toFixed(2)}</span>
            </div>
            <Bar value={s.pw.weight} />
          </div>
        ) : null}
      </Shell>
    );
  }

  function SpaceCard({ s }) {
    return (
      <Shell kind="space" name={"\u0026" + s.name} src="lib_omegaclaw_core.metta · register-space">
        <p className="insp-card">{s.note}</p>
        <div className="insp-chips">
          <span className={`insp-chip ${s.role === "immune" ? "warn" : ""}`}>role · {s.role}</span>
        </div>
        {s.budget != null ? (
          <div className="insp-pw">
            <div className="insp-pw-row">
              <span className="insp-pw-label">char-pressure budget</span>
              <span className="insp-pw-val">{s.budget.toLocaleString()} ch</span>
            </div>
            <Bar value={0} />
            <div className="insp-note">live usage arrives with the running loop</div>
          </div>
        ) : (
          <div className="insp-note">no hard char bound</div>
        )}
      </Shell>
    );
  }

  /* Relative "updated 3m ago" from an epoch-ms timestamp. */
  function rel(ts) {
    if (!ts) return null;
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) return Math.round(s) + "s ago";
    const m = s / 60; if (m < 90) return Math.round(m) + "m ago";
    const h = m / 60; if (h < 36) return Math.round(h) + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  /* Per-GROUP descriptor — how each atom family reads and where its exact
     trace lives (provenance). The generic card renders the node's REAL
     fields (confidence / salience / space / status / updated) against this;
     `stv` families note that frequency streams from NAL/PLN (we hold c in
     the mock, f is exact-from-the-loop). Keyed by node.group; falls back to
     the node's own space + family for anything unmapped. Grounded shapes
     mirror the canon (§7 / organ-map): SenseEvent · WorldState ·
     ActionAffordance/Outcome · agenda goals · atomized (stv f c). */
  const GROUP_DESC = {
    goals:       { kind: "goal",       role: "a goal / operating commitment on the agenda",            src: "&agenda · goal",                  weightLabel: "priority" },
    memories:    { kind: "memory",     role: "a stored memory — semantic recall (remember / query)",   src: "memory.metta · long-term recall" },
    traces:      { kind: "trace",      role: "an exact action / runtime trace",                        src: "&activity · exact trace" },
    predictions: { kind: "prediction", role: "a forward expectation in the predictive organ",          src: "&assume · PLN (|~)",              stv: true },
    atoms:       { kind: "atom",       role: "an atomized fact in the AtomSpace",                       src: "AtomSpace · atomized (stv f c)",  stv: true },
    channels:    { kind: "channel",    role: "a communication membrane — sense in, voice out",         src: "channels/* · (SenseEvent …)" },
    "body-apps": { kind: "sense",      role: "a sense / body-app feed",                                 src: "senses · (SenseEvent …)" },
    people:      { kind: "person",     role: "a person in Omega's habitat",                             src: "&world · habitat fact" },
    devices:     { kind: "device",     role: "a device Omega can sense or act on",                      src: "&world · (WorldState …)" },
    rooms:       { kind: "room",       role: "a room / place in the habitat",                           src: "&world · habitat fact" },
    attention:   { kind: "attention",  role: "a salience signal — evidence Omega weighs, never a gate", src: "&attention · ECAN-lite",          weightLabel: "salience" },
    immune:      { kind: "immune",     role: "an immune signal — risk / spin / caution",               src: "&attention · immune",             weightLabel: "pressure" },
    errors:      { kind: "event",      role: "a logged event / outcome",                                src: "&events · dated observation" },
  };

  /* GenericAtomCard — the universal drill-to-exact card for ANY atom that
     isn't a (rich) skill or space. Reads the live omegaGraph node, so every
     atom in the sea is now inspectable instead of dead-ending. */
  function GenericAtomCard({ node }) {
    const d = GROUP_DESC[node.group] || {
      kind: node.family || "atom",
      role: "an atom in the AtomSpace",
      src: node.space ? "\u0026" + node.space : "AtomSpace",
    };
    const wLabel = d.weightLabel || "salience";
    const conf = node.confidence != null ? node.confidence : 0;
    const sal  = node.salience != null ? node.salience : 0;
    const updated = rel(node.updated_at);
    return (
      <Shell kind={d.kind} name={node.label} src={d.src}>
        <p className="insp-card">{d.role}.</p>
        <div className="insp-chips">
          {node.space ? <span className="insp-chip">{"\u0026" + node.space}</span> : null}
          <span className={`insp-chip ${node.status && node.status !== "active" ? "warn" : ""}`}>
            {node.status || "active"}
          </span>
        </div>
        <div className="insp-pw">
          <div className="insp-pw-row">
            <span className="insp-pw-label">{d.stv ? "confidence · c" : "confidence"}</span>
            <span className="insp-pw-val">{conf.toFixed(2)}</span>
          </div>
          <Bar value={conf} tone="conf" />
          {d.stv ? (
            <div className="insp-note">
              f (frequency) streams from NAL / PLN with the running loop — exact, not mocked
            </div>
          ) : null}
        </div>
        <div className="insp-pw">
          <div className="insp-pw-row">
            <span className="insp-pw-label">{wLabel}</span>
            <span className="insp-pw-val">{sal.toFixed(2)}</span>
          </div>
          <Bar value={sal} />
        </div>
        {updated ? <div className="insp-note">updated {updated}</div> : null}
      </Shell>
    );
  }

  function InspectorBody({ target }) {
    const cat = window.omegaCatalog || {};
    const name = typeof target === "string" ? target : (target && target.name);
    const skill = cat.skillByName && cat.skillByName[name];
    const space = cat.spaceByName && cat.spaceByName[name];
    if (skill) return <SkillCard s={skill} />;
    if (space) return <SpaceCard s={space} />;
    /* Resolve the live atom by label OR id, and render its REAL card. */
    const g = window.omegaGraph;
    const node = g && g.nodes
      ? g.nodes.find((n) => n.label === name || n.id === name)
      : null;
    if (node) {
      /* A space anchor that round-trips through the catalog reads as a space. */
      if (node.metadata && node.metadata.atomKind === "space"
          && cat.spaceByName && cat.spaceByName[node.label]) {
        return <SpaceCard s={cat.spaceByName[node.label]} />;
      }
      return <GenericAtomCard node={node} />;
    }
    return (
      <Shell kind="atom" name={name || "?"} src="omegaGraph">
        <p className="insp-card">No atom by that name is in the field right now.</p>
      </Shell>
    );
  }

  window.InspectorBody = InspectorBody;
})();
