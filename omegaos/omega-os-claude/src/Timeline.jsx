/* Timeline.jsx — Phase 2 / charter #3: the action rail.

   Renders the OBSERVABLE trace stream so the OS shows its own activity:
   "what just changed · who did it · why this surface opened." It reads
   the same traces the surface layer emits — `surface-state` events on
   omegaEvents — plus energy-mode shifts from omegaState, newest first.

   This is a VIEW over exact traces, never a replacement for them: the
   raw omegaEvents.log / omegaIntents.log remain the source of truth. It
   is live (subscribes), so actions appear here the instant they happen. */

(function () {
  const ENERGY_WHY = {
    asleep: "dormant — wake on input or scheduled wake",
    listening: "receptive standby",
    warm: "quiet maintenance",
    focused: "active task execution",
    creative: "deep generative work",
  };

  function whoLabel(who) {
    return who === "omega" ? "Ω" : who === "user" ? "you" : "sys";
  }
  function relTime(ts) {
    const d = (performance.now() - (ts || 0)) / 1000;
    if (d < 2) return "now";
    if (d < 60) return Math.floor(d) + "s";
    if (d < 3600) return Math.floor(d / 60) + "m";
    return Math.floor(d / 3600) + "h";
  }

  function surfaceEntry(ev) {
    if (ev.state === "active")
      return { cat: "open", who: ev.origin, text: "opened " + ev.kind, why: ev.openedBecause || null, ts: ev.time };
    if (ev.state === "closed")
      return { cat: "close", who: ev.origin, text: "closed " + ev.kind, why: null, ts: ev.time };
    return null;
  }

  function seedEntries() {
    const out = [];
    const log = (window.omegaEvents && window.omegaEvents.log) || [];
    log.forEach((ev) => {
      if (ev.type !== "surface-state") return;
      const e = surfaceEntry(ev);
      if (e) out.push(e);
    });
    out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return out.slice(0, 40).map((e, i) => Object.assign({ id: "seed-" + i }, e));
  }

  function TimelineBody() {
    const [entries, setEntries] = React.useState(seedEntries);
    const idRef = React.useRef(1);
    const firstMode = React.useRef(true);

    React.useEffect(() => {
      const push = (e) => {
        if (!e) return;
        setEntries((prev) => [
          Object.assign({ id: "e-" + idRef.current++, ts: performance.now() }, e),
          ...prev,
        ].slice(0, 80));
      };
      const offEv = window.omegaEvents.subscribe((ev) => {
        if (ev.type === "surface-state") push(surfaceEntry(ev));
      });
      const offSt = window.omegaState
        ? window.omegaState.subscribe((mode) => {
            if (firstMode.current) { firstMode.current = false; return; }
            push({ cat: "mode", who: "omega", text: "energy → " + mode, why: ENERGY_WHY[mode] || null });
          })
        : null;
      return () => { offEv(); offSt && offSt(); };
    }, []);

    return (
      <div className="tl">
        <div className="tl-head">
          <span className="tl-title">timeline</span>
          <span className="tl-note">what just changed</span>
        </div>
        <div className="tl-scroll">
          {entries.length === 0 ? (
            <div className="tl-empty">no activity yet — open a surface or speak to Omega</div>
          ) : entries.map((e) => (
            <div className={`tl-row cat-${e.cat}`} key={e.id}>
              <span className="tl-dot" aria-hidden="true"></span>
              <div className="tl-main">
                <div className="tl-line">
                  <span className="tl-text">{e.text}</span>
                  <span className={`tl-who who-${e.who}`}>{whoLabel(e.who)}</span>
                </div>
                {e.why ? <div className="tl-why">{e.why}</div> : null}
              </div>
              <span className="tl-time">{relTime(e.ts)}</span>
            </div>
          ))}
        </div>
        <div className="tl-src">view over omegaEvents · SurfaceStateChanged · exact log preserved</div>
      </div>
    );
  }

  window.TimelineBody = TimelineBody;
})();
