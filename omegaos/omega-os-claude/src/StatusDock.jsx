/* StatusDock.jsx — the ambient status console (charter: "calm by default,
   depth on request"; the Floor_Console / always-on HUD).

   A small persistent strip that answers "what is Omega doing?" at a glance
   without opening anything: presence + energy mode, open-surface count
   (multitask load), the current focus (top agenda pressure), and the last
   thing that changed. Click → opens the timeline (depth on request).

   Purely representational: it mirrors omegaState + the surface traces. */

(function () {
  function StatusDock({ surfaceCount, awake }) {
    const [mode, setMode] = React.useState(window.omegaState ? window.omegaState.mode : "warm");
    const [last, setLast] = React.useState(null);

    React.useEffect(() => {
      const offS = window.omegaState ? window.omegaState.subscribe((m) => setMode(m)) : null;
      const offE = window.omegaEvents.subscribe((ev) => {
        if (ev.type !== "surface-state") return;
        setLast((ev.state === "active" ? "opened " : "closed ") + ev.kind +
                (ev.origin === "omega" ? " · Ω" : ev.origin === "user" ? " · you" : ""));
      });
      return () => { offS && offS(); offE(); };
    }, []);

    if (!awake) return null;

    const cat = window.omegaCatalog || {};
    const focus = (cat.agenda || [])
      .filter((g) => g.status === "active")
      .sort((a, b) => b.priority - a.priority)[0];
    const prof = window.omegaState && window.omegaState.profiles[mode];

    const openTimeline = (e) => {
      e.stopPropagation();
      window.omegaIntents.emit({ type: "open-surface", surface: { kind: "timeline" }, origin: "user" });
    };

    return (
      <div className="status-dock" onClick={openTimeline} title="open timeline">
        <div className="sd-row">
          <span className="sd-orb" style={{ color: `oklch(0.72 0.16 ${prof ? prof.hue : 215})` }}></span>
          <span className="sd-mode">{mode}</span>
          <span className="sd-count">{surfaceCount} open</span>
        </div>
        {focus ? <div className="sd-focus">focus · {focus.goal}</div> : null}
        {last ? <div className="sd-last">{last}</div> : null}
      </div>
    );
  }

  window.StatusDock = StatusDock;
})();
