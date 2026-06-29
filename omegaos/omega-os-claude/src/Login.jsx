/* Login.jsx — the front door (Evolution Plan §21.2).

   Omega is always working; the chamber keeps running behind a slight dim
   whether or not anyone is signed in. Logging in only grants the HUMAN the
   ability to interact — it never pauses or fakes her state.

   The experience, in four phases:
     idle      logged out — only the soft dim veil (clicks pass to the room,
               which calls beginLogin → flips us to `marks`).
     marks     the Apple + Google marks SHIMMER into being like entities
               crossing from another dimension. Click one →
     panel      it expands into a floating glass panel (the surface-OS card
               language): "Continue with {provider}" + the family roster as
               identity chips. Pick a person →
     success   the panel + marks SHATTER into ethereal sparkling colour that
               dissipates, then signIn fires and the dim lifts.

   Auth itself is the omegaSession seam; this file is pure membrane —
   it decides nothing about Omega, only relays a chosen identity. */

(function () {
  const R = React;

  /* Pre-rendered soft glow sprites (one per hue) so we can draw thousands of
     sparkles cheaply via drawImage instead of a gradient per particle. */
  const SPECTRAL = [188, 202, 214, 230, 262, 290, 318, 338, 44, 96, 150, 0];
  function makeGlowSprites(hues) {
    return hues.map((h, i) => {
      const s = 64, c = document.createElement("canvas"); c.width = c.height = s;
      const x = c.getContext("2d");
      const white = i % 5 === 0;   // a few near-white sparkles for sparkle pop
      const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0.0, "hsla(" + h + "," + (white ? 35 : 100) + "%,97%,1)");
      g.addColorStop(0.22, "hsla(" + h + ",96%,76%,0.92)");
      g.addColorStop(0.5, "hsla(" + h + ",92%,62%,0.34)");
      g.addColorStop(1.0, "hsla(" + h + ",90%,58%,0)");
      x.fillStyle = g; x.fillRect(0, 0, s, s);
      return c;
    });
  }

  /* Motion is reduced by the OS pref OR the signed-in user's own preference. */
  function motionReduced() {
    return (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      || (document.documentElement.dataset.userMotion === "reduced");
  }
  /* Compact relative time for "here since". */
  function relTime(ts) {
    if (!ts) return "just now";
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    const m = s / 60; if (m < 60) return Math.floor(m) + "m ago";
    const h = m / 60; if (h < 24) return Math.floor(h) + "h ago";
    return Math.floor(h / 24) + "d ago";
  }

  /* Space (void) colour options for the profile preference. Dark tints sit
     beautifully under the additive-bloom field; White is the literal option
     the field is NOT tuned for (it washes the glow — offered anyway). */
  const SPACE_OPTIONS = [
    { id: "void",   label: "Void",   val: null,      css: "#06070e" },
    { id: "cobalt", label: "Cobalt", val: "#15276f", css: "#15276f" },
    { id: "nebula", label: "Nebula", val: "#3a165f", css: "#3a165f" },
    { id: "cyan",   label: "Cyan",   val: "#0a3a55", css: "#0a3a55" },
    { id: "ember",  label: "Ember",  val: "#4a2406", css: "#4a2406" },
    { id: "halo",   label: "Halo",   val: "#eef1f6", css: "#eef1f6" },
  ];

  /* ── Provider marks (used for their real sign-in purpose) ───────── */
  const GoogleMark = (
    <svg viewBox="0 0 48 48" className="login-mark-svg" aria-label="Google">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
  const AppleMark = (
    <svg viewBox="0 0 24 24" className="login-mark-svg" aria-label="Apple">
      <path fill="#f5f5f7" d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
    </svg>
  );
  const MARKS = {
    google: { svg: GoogleMark, label: "Google", glow: 220 },
    apple:  { svg: AppleMark,  label: "Apple",  glow: 250 },
  };

  /* ── The shatter — thousands of tiny shimmering lights dissipating ── */
  const LoginShatter = function LoginShatter({ at }) {
    const ref = R.useRef(null);
    R.useEffect(() => {
      const cv = ref.current; if (!cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = cv.width = Math.round(window.innerWidth * dpr);
      const H = cv.height = Math.round(window.innerHeight * dpr);
      cv.style.width = window.innerWidth + "px";
      cv.style.height = window.innerHeight + "px";
      const ctx = cv.getContext("2d");
      const reduce = motionReduced();
      const cx = (at && at.x != null ? at.x : window.innerWidth / 2) * dpr;
      const cy = (at && at.y != null ? at.y : window.innerHeight / 2) * dpr;
      const pw = (at && at.w ? at.w : 360) * dpr;
      const ph = (at && at.h ? at.h : 240) * dpr;
      const sprites = makeGlowSprites(SPECTRAL);
      /* Thousands: density-scaled to the viewport, capped for perf. */
      const N = reduce ? 400 : Math.min(2600, Math.round((window.innerWidth * window.innerHeight) / 520));
      const ps = new Array(N);
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2;
        /* spawn across the whole panel footprint — the WINDOW shatters */
        const sx = cx + (Math.random() - 0.5) * pw;
        const sy = cy + (Math.random() - 0.5) * ph;
        /* many slow (lingering dust) + few fast (the spray) */
        const speed = Math.pow(Math.random(), 1.7) * 7.2 * dpr + 0.3 * dpr;
        const dx = sx - cx, dy = sy - cy, dl = Math.hypot(dx, dy) || 1;
        const ox = (dx / dl) * 0.6 + Math.cos(a) * 0.9;
        const oy = (dy / dl) * 0.6 + Math.sin(a) * 0.9;
        ps[i] = {
          x: sx, y: sy, vx: ox * speed, vy: oy * speed - 0.6 * dpr,
          size: (1.3 + Math.pow(Math.random(), 2) * 7) * dpr,
          hi: (Math.random() * sprites.length) | 0,
          life: 1, decay: 0.0035 + Math.random() * 0.008,
          tw: 0.006 + Math.random() * 0.018, ph: Math.random() * 7,
          swirl: (Math.random() - 0.5) * 0.05,
        };
      }
      const grav = 0.012 * dpr, drag = 0.986;
      let raf, flash = 1, ring = 0;
      const t0 = performance.now();
      const tick = (now) => {
        const t = now - t0;
        ctx.clearRect(0, 0, W, H);
        ctx.globalCompositeOperation = "lighter";
        /* central flash bloom */
        if (flash > 0) {
          const fr = (1 - flash) * 280 * dpr + 16;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, fr);
          g.addColorStop(0, "rgba(234,242,255," + (0.62 * flash) + ")");
          g.addColorStop(1, "rgba(234,242,255,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, fr, 0, 7); ctx.fill();
          flash -= 0.05;
        }
        /* expanding shimmer shockwave */
        if (ring < 1) {
          ctx.globalAlpha = (1 - ring) * 0.4;
          ctx.lineWidth = 2.4 * dpr;
          ctx.strokeStyle = "hsla(208,92%,84%,1)";
          ctx.beginPath(); ctx.arc(cx, cy, ring * 420 * dpr, 0, 7); ctx.stroke();
          ctx.globalAlpha = 1; ring += 0.028;
        }
        for (let i = 0; i < N; i++) {
          const p = ps[i]; if (p.life <= 0) continue;
          /* gentle swirl curl */
          const c = Math.cos(p.swirl), s = Math.sin(p.swirl);
          const nvx = p.vx * c - p.vy * s, nvy = p.vx * s + p.vy * c;
          p.vx = nvx * drag; p.vy = nvy * drag + grav;
          p.x += p.vx; p.y += p.vy; p.life -= p.decay;
          if (p.life <= 0) continue;
          const sh = 0.5 + 0.5 * Math.sin(now * p.tw + p.ph);   // shimmer, not crackle
          const al = p.life * (0.22 + 0.78 * sh);
          if (al <= 0.012) continue;
          const size = p.size * (0.55 + 0.7 * sh) * (0.45 + 0.55 * p.life);
          ctx.globalAlpha = al;
          ctx.drawImage(sprites[p.hi], p.x - size, p.y - size, size * 2, size * 2);
        }
        ctx.globalAlpha = 1;
        if (t < 2800) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [at]);
    return <canvas ref={ref} className="login-shatter" aria-hidden="true" />;
  };

  /* ── The aura — the marks ARRIVE like entities from another universe ──
     A vortex of multicolour light spirals IN to form each mark; a portal
     ring blooms; then a living shimmer-aura lingers around them. */
  const LoginAura = function LoginAura() {
    const ref = R.useRef(null);
    R.useEffect(() => {
      const cv = ref.current; if (!cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const resize = () => {
        cv.width = Math.round(window.innerWidth * dpr);
        cv.height = Math.round(window.innerHeight * dpr);
        cv.style.width = window.innerWidth + "px";
        cv.style.height = window.innerHeight + "px";
      };
      resize();
      const ctx = cv.getContext("2d");
      const reduce = motionReduced();
      const sprites = makeGlowSprites(SPECTRAL);
      let anchors = [];
      const measure = () => {
        anchors = Array.prototype.map.call(document.querySelectorAll(".login-mark-inner"), (el) => {
          const r = el.getBoundingClientRect();
          return { x: (r.left + r.width / 2) * dpr, y: (r.top + r.height / 2) * dpr };
        });
      };
      measure();
      const nA = anchors.length || 1;
      const arr = [];
      const M = reduce ? 40 : 230;
      for (let ai = 0; ai < nA; ai++) {
        for (let i = 0; i < M; i++) {
          const rad = (80 + Math.random() * 175) * dpr;
          arr.push({
            ai, ang: Math.random() * Math.PI * 2, rad, rad0: rad,
            spin: (Math.random() < 0.5 ? -1 : 1) * (0.02 + Math.random() * 0.06),
            inSpeed: 0.014 + Math.random() * 0.022,
            size: (1.1 + Math.pow(Math.random(), 2) * 5) * dpr,
            hi: (Math.random() * sprites.length) | 0,
            delay: Math.random() * 430,
            tw: 0.006 + Math.random() * 0.018, ph: Math.random() * 7, life: 1,
          });
        }
      }
      const rings = [];
      const amb = [];
      let raf;
      const t0 = performance.now();
      const tick = (now) => {
        const t = now - t0;
        measure();
        while (rings.length < nA) rings.push({ r: 0, life: 1 });
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.globalCompositeOperation = "lighter";
        /* portal rings */
        for (let i = 0; i < nA; i++) {
          const an = anchors[i], rg = rings[i]; if (!an || !rg || rg.life <= 0) continue;
          rg.r += 5.2 * dpr; rg.life -= 0.02;
          ctx.globalAlpha = Math.max(0, rg.life) * 0.5;
          ctx.lineWidth = 2.2 * dpr;
          ctx.strokeStyle = "hsla(" + SPECTRAL[(i * 4) % SPECTRAL.length] + ",92%,84%,1)";
          ctx.beginPath(); ctx.arc(an.x, an.y, rg.r, 0, 7); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        /* arrival convergence — the entity coalescing */
        for (const p of arr) {
          if (t < p.delay || p.life <= 0) continue;
          const an = anchors[p.ai]; if (!an) continue;
          p.ang += p.spin; p.rad -= p.rad * p.inSpeed + 0.4 * dpr;
          if (p.rad < 2 * dpr) p.life -= 0.09;
          if (p.life <= 0) continue;
          const x = an.x + Math.cos(p.ang) * p.rad, y = an.y + Math.sin(p.ang) * p.rad;
          const sh = 0.5 + 0.5 * Math.sin(now * p.tw + p.ph);
          const arrive = 1 - Math.min(1, p.rad / p.rad0);
          const al = p.life * (0.3 + 0.7 * sh) * (0.35 + 0.65 * arrive);
          const size = p.size * (0.6 + 0.7 * sh) * (0.5 + arrive);
          ctx.globalAlpha = Math.max(0, Math.min(1, al));
          ctx.drawImage(sprites[p.hi], x - size, y - size, size * 2, size * 2);
        }
        ctx.globalAlpha = 1;
        /* living shimmer-aura around each settled entity */
        if (t > 420 && !reduce && amb.length < 320) {
          for (let i = 0; i < nA; i++) {
            const an = anchors[i]; if (!an) continue;
            if (Math.random() < 0.75) {
              const ang = Math.random() * Math.PI * 2, rad = (8 + Math.random() * 52) * dpr;
              amb.push({
                x: an.x + Math.cos(ang) * rad, y: an.y + Math.sin(ang) * rad,
                vx: Math.cos(ang) * 0.25 * dpr, vy: Math.sin(ang) * 0.25 * dpr - 0.18 * dpr,
                size: (1 + Math.pow(Math.random(), 2) * 3.4) * dpr, hi: (Math.random() * sprites.length) | 0,
                life: 1, decay: 0.012 + Math.random() * 0.02, tw: 0.01 + Math.random() * 0.02, ph: Math.random() * 7,
              });
            }
          }
        }
        for (let i = amb.length - 1; i >= 0; i--) {
          const p = amb[i]; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
          if (p.life <= 0) { amb.splice(i, 1); continue; }
          const sh = 0.5 + 0.5 * Math.sin(now * p.tw + p.ph);
          const al = p.life * (0.25 + 0.75 * sh) * 0.72;
          const size = p.size * (0.6 + 0.7 * sh);
          ctx.globalAlpha = Math.max(0, Math.min(1, al));
          ctx.drawImage(sprites[p.hi], p.x - size, p.y - size, size * 2, size * 2);
        }
        ctx.globalAlpha = 1;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      window.addEventListener("resize", resize);
      return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
    }, []);
    return <canvas ref={ref} className="login-aura" aria-hidden="true" />;
  };

  /* ── The overlay ────────────────────────────────────────────────── */
  const Login = function Login({ active, onAuthed, onCancel }) {
    const signedIn = window.omegaSession && window.omegaSession.signedIn;
    const [phase, setPhase] = R.useState("idle");   // idle | marks | panel | success
    const [provider, setProvider] = R.useState(null);
    const [shatterAt, setShatterAt] = R.useState(null);
    const [altOpen, setAltOpen] = R.useState(false);
    const panelRef = R.useRef(null);

    /* App owns `active` (a logged-out interaction engaged the threshold).
       Bring the marks in when it turns on; reset when it turns off (unless
       we're mid-success, which finishes on its own). */
    R.useEffect(() => {
      if (active && phase === "idle") setPhase("marks");
      if (!active && phase !== "idle" && phase !== "success") {
        setPhase("idle"); setProvider(null);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    /* Once signed in, reset the flow to idle so a later sign-out starts at
       the clean threshold (not a stale panel/success frame). */
    R.useEffect(() => {
      if (signedIn) { setPhase("idle"); setProvider(null); setAltOpen(false); }
    }, [signedIn]);

    /* Esc backs all the way out. */
    R.useEffect(() => {
      if (phase === "idle" || phase === "success") return;
      const onKey = (e) => { if (e.key === "Escape") { setProvider(null); onCancel && onCancel(); } };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    if (signedIn) return null;

    const chooseProvider = (key) => (e) => {
      e.stopPropagation();
      setProvider(key);
      setAltOpen(false);
      setPhase("panel");
    };
    const onBackdrop = () => {
      if (phase === "success") return;
      if (phase === "panel") { setProvider(null); setAltOpen(false); setPhase("marks"); }
      else { onCancel && onCancel(); }
    };
    const pick = (person) => (e) => {
      e.stopPropagation();
      const r = panelRef.current ? panelRef.current.getBoundingClientRect() : null;
      setShatterAt(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
                     : { x: window.innerWidth / 2, y: window.innerHeight / 2, w: 360, h: 240 });
      setPhase("success");
      /* The seam: hand the chosen profile up. Real OAuth returns the same
         shape. Let the shatter breathe, then sign in + lift the dim. */
      setTimeout(() => { onAuthed && onAuthed(person); }, 2050);
    };

    const booting = window.omegaState && window.omegaState.booting;
    const owner = provider && window.omegaSession ? window.omegaSession.primaryFor(provider) : null;
    const others = provider && window.omegaSession
      ? window.omegaSession.rosterFor(provider).filter((p) => !owner || p.id !== owner.id)
      : [];
    const M = provider ? MARKS[provider] : null;
    const days = window.omegaSession ? window.omegaSession.sessionDays : 14;

    const accountRow = (p, primary) => (
      <button key={p.id} className={"login-id" + (primary ? " primary" : "")} style={{ "--h": p.hue }} onClick={pick(p)}>
        <span className="login-id-av">{(p.first || p.name || "?").charAt(0)}</span>
        <span className="login-id-text">
          <span className="login-id-name">{p.name}</span>
          <span className="login-id-email">{p.email}</span>
        </span>
        <span className="login-id-go">{primary ? "continue →" : "→"}</span>
      </button>
    );

    return (
      <React.Fragment>
        <div className="login-dim" style={{ opacity: phase === "success" ? 0 : 1 }} aria-hidden="true" />

        {phase !== "idle" && (
          <div className={"login-stage phase-" + phase} onClick={onBackdrop}>

            {phase === "marks" && (
              <React.Fragment>
                <LoginAura />
                <div className="login-marks" role="group" aria-label="Choose a sign-in provider">
                  {["google", "apple"].map((key, i) => (
                    <button key={key} className="login-mark" style={{ animationDelay: (i * 130) + "ms" }}
                      onClick={chooseProvider(key)} aria-label={"Continue with " + MARKS[key].label}>
                      <span className="login-mark-glow" style={{ "--g": MARKS[key].glow }} />
                      <span className="login-mark-inner">{MARKS[key].svg}</span>
                      <span className="login-mark-label">{MARKS[key].label}</span>
                    </button>
                  ))}
                  <div className="login-marks-hint">a presence approaches the membrane</div>
                </div>
              </React.Fragment>
            )}

            {(phase === "panel" || phase === "success") && M && owner && (
              <div ref={panelRef}
                className={"login-panel" + (phase === "success" ? " dissolving" : "")}
                style={{ "--awin-hue": M.glow }}
                onClick={(e) => e.stopPropagation()}>
                <div className="login-panel-head">
                  <span className="login-panel-mark">{M.svg}</span>
                  <div className="login-panel-titles">
                    <div className="login-panel-title">Continue with {M.label}</div>
                    <div className="login-panel-sub">you'll stay signed in for {days} days</div>
                  </div>
                </div>

                <div className="login-account-wrap">
                  {accountRow(owner, true)}
                  {others.length > 0 && (
                    <React.Fragment>
                      <button className="login-alt-toggle"
                        onClick={(e) => { e.stopPropagation(); setAltOpen((v) => !v); }}>
                        {altOpen ? "hide other accounts" : "use a different account"}
                      </button>
                      {altOpen && (
                        <div className="login-roster">
                          {others.map((p) => accountRow(p, false))}
                        </div>
                      )}
                    </React.Fragment>
                  )}
                </div>

                <div className="login-panel-foot">
                  {booting
                    ? <span className="login-foot-boot">Omega is booting — she'll be ready in a moment</span>
                    : <span>simulated session · real {M.label} OAuth on connect</span>}
                </div>
              </div>
            )}

            {phase === "success" && <LoginShatter at={shatterAt} />}
          </div>
        )}
      </React.Fragment>
    );
  };

  /* ── Brand + presence ───────────────────────────────────────────── */
  const OmegaProfile = function OmegaProfile({ session, onSignOut }) {
    const M = MARKS[session.provider] || MARKS.google;
    const days = window.omegaSession ? window.omegaSession.daysLeft() : 14;
    const since = relTime(session.since);
    const prefs = session.prefs || {};
    const reduce = !!prefs.reduceMotion;
    const setPref = (k, v) => window.omegaSession && window.omegaSession.setPref(k, v);
    return (
      <div className="omega-profile" style={{ "--h": session.hue || 230 }} onClick={(e) => e.stopPropagation()}>
        <div className="oprof-head">
          <span className="oprof-av">{(session.first || session.name || "?").charAt(0)}</span>
          <div className="oprof-id">
            <div className="oprof-name">{session.name}</div>
            <div className="oprof-role">{session.role === "admin" ? "Administrator" : "Family"}</div>
          </div>
        </div>
        <div className="oprof-rows">
          <div className="oprof-row"><span className="oprof-k">signed in with</span>
            <span className="oprof-v"><span className="oprof-mark">{M.svg}</span>{M.label}</span></div>
          <div className="oprof-row"><span className="oprof-k">session</span>
            <span className="oprof-v">{days + " " + (days === 1 ? "day" : "days") + " left"}</span></div>
          <div className="oprof-row"><span className="oprof-k">here since</span>
            <span className="oprof-v">{since}</span></div>
          {session.role === "admin" && (
            <div className="oprof-row"><span className="oprof-k">access</span>
              <span className="oprof-v oprof-admin">manages OmegaOS</span></div>
          )}
        </div>
        <div className="oprof-prefs">
          <div className="oprof-prefs-label">preferences</div>
          <button className={"oprof-toggle" + (reduce ? " on" : "")} role="switch" aria-checked={reduce}
            onClick={() => setPref("reduceMotion", !reduce)}>
            <span className="oprof-toggle-track"><span className="oprof-toggle-knob" /></span>
            <span className="oprof-toggle-label">Reduce motion</span>
          </button>
          <div className="oprof-pref-row">
            <span className="oprof-pref-name">Space</span>
            <div className="oprof-swatches">
              {SPACE_OPTIONS.map((o) => (
                <button key={o.id} className={"oprof-sw" + (((prefs.spaceColor || null) === o.val) ? " sel" : "")}
                  style={{ background: o.css }} title={o.label} aria-label={"Space: " + o.label}
                  onClick={() => setPref("spaceColor", o.val)} />
              ))}
            </div>
          </div>
          <div className="oprof-prefs-note">more in Settings · soon</div>
        </div>
        <button className="oprof-signout" onClick={onSignOut}>Sign out</button>
      </div>
    );
  };

  const OmegaBrand = function OmegaBrand({ session, onSignOut }) {
    const [open, setOpen] = R.useState(false);
    R.useEffect(() => { if (!session) setOpen(false); }, [session]);
    return (
      <React.Fragment>
        <div className="omega-brand" aria-label="OmegaOS by OmegaOS Lab">
          <span className="omega-brand-glyph">Ω</span>
          <span className="omega-brand-stack">
            <span className="omega-brand-name">OmegaOS</span>
            <span className="omega-brand-by">by OmegaOS Lab</span>
          </span>
        </div>
        {session && (
          <button className={"omega-presence" + (open ? " open" : "")} style={{ "--h": session.hue || 230 }}
            title={(session.name || session.first) + " — profile"}
            onClick={() => setOpen((o) => !o)}>
            <span className="omega-presence-av">{(session.first || session.name || "?").charAt(0)}</span>
            <span className="omega-presence-name">{session.first || session.name}</span>
            <span className="omega-presence-chev">⌄</span>
          </button>
        )}
        {session && open && (
          <React.Fragment>
            <div className="omega-profile-scrim" onClick={() => setOpen(false)} />
            <OmegaProfile session={session}
              onSignOut={() => { setOpen(false); onSignOut(); }} />
          </React.Fragment>
        )}
      </React.Fragment>
    );
  };

  window.Login = Login;
  window.OmegaBrand = OmegaBrand;
})();
