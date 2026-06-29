/* DevConsole.jsx — eval console rendered as the CONTENT of an
   OmegaWindow, backed by a SHARED global session.

   The session lives at window.devConsole and is module-level state
   shared across every open console window AND across other callers
   (e.g. the AI working with you). Any entry pushed to the session
   appears in every open console window in real time. */

(function () {
  const { useState, useEffect, useRef, useCallback } = React;

  function safeStringify(v) {
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "function") return v.toString().slice(0, 200);
    try {
      const seen = new WeakSet();
      return JSON.stringify(v, (k, val) => {
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[circular]";
          seen.add(val);
        }
        if (typeof val === "function") return "[fn]";
        if (val instanceof Element) return `<${val.tagName.toLowerCase()}>`;
        return val;
      }, 2);
    } catch (e) {
      try { return String(v); } catch { return "[unprintable]"; }
    }
  }

  /* Async eval — wraps the expression so `await` works inline. */
  async function runEval(src) {
    const trimmed = src.trim();
    if (!trimmed) return undefined;
    const isStmt = /^(const|let|var|function|class|if|for|while|switch|return|throw|try|do|;)/.test(trimmed);
    const body = isStmt ? trimmed : `return (${trimmed});`;
    const AsyncFn = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFn(body);
    return await fn();
  }

  /* ── Shared session (module-level state) ─────────────────────── */
  /* All open console windows subscribe to this. Any caller can
     push by calling window.devConsole.run(src) or .push({src,out}). */
  const session = {
    history: [],            // [{src, out?, err?, who?}]
    subs: new Set(),
    fire() { for (const fn of this.subs) try { fn(this.history); } catch {} },
    push(entry) {
      this.history = [...this.history, entry].slice(-200);
      this.fire();
    },
    async run(src, who) {
      const entry = { src, who: who || "you" };
      try {
        const out = await runEval(src);
        entry.out = safeStringify(out);
      } catch (e) {
        entry.err = (e && e.message) || String(e);
      }
      this.push(entry);
      return entry;
    },
    subscribe(fn) {
      this.subs.add(fn);
      return () => this.subs.delete(fn);
    },
    clear() { this.history = []; this.fire(); },
  };
  window.devConsole = session;

  /* Quick actions — buttons for the diagnostics most useful during
     the renderer pivot. Each runs through the shared session so
     other open consoles see the call + result too. */
  const QUICK_ACTIONS = [
    {
      label: "fps",
      run: `
let f=0,s=performance.now();
await new Promise(r=>{(function t(){f++;performance.now()-s<1500?requestAnimationFrame(t):r()})()});
({fps:(f/1.5).toFixed(1)})
      `.trim(),
    },
    {
      label: "canvas",
      run: `document.querySelector('.omega-3d-canvas')?.getBoundingClientRect()`,
    },
    {
      label: "scene",
      run: `({three:!!window.THREE,r3d:!!window.omegaR3D?.createOmegaScene,core:!!window.omegaR3D?.createCoreSphere,canvas:!!document.querySelector('.omega-3d-canvas')})`,
    },
    {
      label: "beat",
      run: `window.omegaScheduler.beatNow();'beat fired'`,
    },
    {
      label: "atoms",
      run: `({total:document.querySelectorAll('circle.atom').length,bloomed:document.querySelectorAll('circle.atom.bloomed').length,active:window.omegaPulses.active.length})`,
    },
    {
      label: "skills",
      run: `omegaSkills.registered`,
    },
  ];

  const DevConsoleBody = function DevConsoleBody() {
    const [history, setHistory] = useState(session.history);
    const [input, setInput] = useState("");
    const [histCursor, setHistCursor] = useState(-1);
    const taRef = useRef(null);
    const outRef = useRef(null);

    useEffect(() => session.subscribe(setHistory), []);

    useEffect(() => {
      if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
    }, [history]);

    useEffect(() => {
      if (taRef.current) taRef.current.focus();
    }, []);

    const run = useCallback((src) => session.run(src, "you"), []);

    const onKeyDown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!input.trim()) return;
        run(input);
        setInput("");
        setHistCursor(-1);
        return;
      }
      if (e.key === "ArrowUp") {
        if (!history.length) return;
        const next = Math.min(history.length - 1, (histCursor < 0 ? 0 : histCursor + 1));
        e.preventDefault();
        setHistCursor(next);
        setInput(history[history.length - 1 - next].src);
        return;
      }
      if (e.key === "ArrowDown") {
        if (histCursor <= 0) {
          e.preventDefault();
          setHistCursor(-1);
          setInput("");
          return;
        }
        e.preventDefault();
        const next = histCursor - 1;
        setHistCursor(next);
        setInput(history[history.length - 1 - next].src);
      }
    };

    const focusPrompt = () => taRef.current && taRef.current.focus();

    return (
      <div className="devconsole-body" onClick={focusPrompt}>
        <div className="devconsole-actions">
          {QUICK_ACTIONS.map((a) => (
            <button key={a.label}
              onClick={(e) => { e.stopPropagation(); run(a.run); focusPrompt(); }}>
              {a.label}
            </button>
          ))}
          <button className="devconsole-clear"
            onClick={(e) => { e.stopPropagation(); session.clear(); focusPrompt(); }}>
            clear
          </button>
        </div>
        <div className="devconsole-out" ref={outRef}>
          {history.length === 0 && (
            <div className="devconsole-hint">
              shared REPL session — type any expression, Enter to run · ↑/↓ history · `await` works inline
            </div>
          )}
          {history.map((h, i) => (
            <div className={`devconsole-entry who-${h.who || "you"}`} key={i}>
              <div className="devconsole-src">
                <span className="devconsole-who">{h.who === "ai" ? "ai" : "›"}</span>
                {h.src}
              </div>
              {h.err
                ? <div className="devconsole-err">{h.err}</div>
                : <pre className="devconsole-result">{h.out}</pre>}
            </div>
          ))}
        </div>
        <div className="devconsole-prompt">
          <span className="devconsole-caret">›</span>
          <input
            ref={taRef}
            className="devconsole-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="eval…"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      </div>
    );
  };

  window.DevConsoleBody = DevConsoleBody;
})();
