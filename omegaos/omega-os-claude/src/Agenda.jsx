/* Agenda.jsx — Phase 2 system surface: Omega's agenda as a process list.

   The OS "task manager" view of &agenda. Goals are PROCESSES, grouped
   by status: active (running) · dormant (parked, NOT done) · complete
   (finished, archived to events + persistent). This honors the
   agenda-complete semantics from OmegaClaw: dormant ≠ done.

   Data comes from omegaCatalog.agenda (grounded mock); the live loop
   replaces it via graph/state sync. Opened via an open-surface intent
   (kind "agenda") — human or Omega, same bus. */

(function () {
  const STATUS_ORDER = { active: 0, dormant: 1, complete: 2 };
  const STATUS_LABEL = { active: "active", dormant: "dormant", complete: "complete" };

  function Row({ g }) {
    const isComplete = g.status === "complete";
    return (
      <div className={`agenda-row status-${g.status}`}>
        <span className="agenda-dot" aria-hidden="true"></span>
        <div className="agenda-main">
          <div className="agenda-goal">
            {g.goal}
            {g.meta ? <span className="agenda-meta-tag">self-model</span> : null}
          </div>
          {isComplete ? (
            <div className="agenda-sub agenda-done">{g.done || "archived"}</div>
          ) : (
            <div className="agenda-sub">
              <span className="agenda-arrow">→</span> {g.next}
            </div>
          )}
        </div>
        <div className="agenda-side">
          <span className="agenda-status">{STATUS_LABEL[g.status]}</span>
          <span className="agenda-topic">{g.topic}</span>
        </div>
      </div>
    );
  }

  function AgendaBody() {
    const cat = window.omegaCatalog || {};
    const goals = (cat.agenda || []).slice().sort((a, b) => {
      const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      return s !== 0 ? s : (b.priority || 0) - (a.priority || 0);
    });
    const count = (st) => goals.filter((g) => g.status === st).length;

    return (
      <div className="agenda">
        <div className="agenda-head">
          <span className="agenda-title">agenda</span>
          <span className="agenda-summary">
            <b>{count("active")}</b> active · {count("dormant")} dormant · {count("complete")} done
          </span>
        </div>
        <div className="agenda-scroll">
          {goals.map((g) => <Row key={g.id} g={g} />)}
        </div>
        <div className="agenda-src">&amp;agenda · register-space · role memory · 20,000 ch</div>
      </div>
    );
  }

  window.AgendaBody = AgendaBody;
})();
