/* App.jsx — orchestrates the room, the conversation, and the
   OmegaWindow command bus.

   The chat lives inside an OmegaWindow now (opened via the bus on
   first user send). A second placeholder "lorem" window can be
   opened via the bus for the demo (button in the Tweaks panel +
   keyboard shortcut). All open/close/merge operations route through
   useOmegaCommands so a future OmegaClaw can issue the same intents. */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "coreSize": 14,
  "coreGround": 70,
  "breathDur": 6.0,
  "glowDur": 7.3,
  "omegaOpacity": 1.0,
  "walls": "off",
  "busyness": 0,
  "renderer": "webgl",
  "palette": "spectrum"
}/*EDITMODE-END*/;

/* resolveOmegaSurface — maps an open-ended surface KIND to the React
   content node + default size that renders it. Kinds are NOT
   whitelisted: anything Omega asks to open renders, with unknown kinds
   falling back to a generic surface labelled by kind. This is the
   nascent "Omega can open any filetype / app" capability; Phase 0.2
   grows each branch into a real player / host (video, audio, terminal,
   browser, game, …). */
window.resolveOmegaSurface = function resolveOmegaSurface(kind, payload, title) {
  const P = window;
  const wrap = (n) => <div className="surface-dark">{n}</div>;
  switch (kind) {
    /* System surfaces keep their dedicated bodies. */
    case "agenda":   return { content: wrap(<P.AgendaBody />), w: 420, h: 444 };
    case "attention":return { content: wrap(<P.AttentionBody />), w: 420, h: 460 };
    case "timeline":
    case "activity": return { content: wrap(<P.TimelineBody />), w: 400, h: 460 };
    case "inspect":  return { content: wrap(<P.InspectorBody target={payload && payload.target} />), w: 400, h: 410 };
    case "reasoning":return { content: wrap(<P.ReasoningReceiptBody payload={payload} />), w: 420, h: 480 };
    /* Everything else → the one adaptive surface host (real working
       image / video / audio / browser / terminal / document / map /
       folder, unknown → generic). "Omega can open whatever she opens." */
    default: {
      const r = P.OmegaSurface
        ? P.OmegaSurface.resolve(kind, payload, title)
        : { content: <P.ContentPlaceholder label={kind || "surface"} hue={200} />, w: 340, h: 260 };
      return { content: wrap(r.content), w: r.w, h: r.h };
    }
  }
};

const App = function App() {
  const [t, setTweak]               = window.useTweaks(TWEAK_DEFAULTS);
  const [awake, setAwake]           = React.useState(true);
  const [ridgeOpen, setRidgeOpen]   = React.useState(false);
  const [text, setText]             = React.useState("");
  const [busy, setBusy]             = React.useState(false);
  const [messages, setMessages]     = React.useState([]);
  const [omegaThinking, setThinking] = React.useState(false);

  /* Atom wire cages (§32 — the Comet Forge field, mainlined). One dial:
     filament thickness as a fraction of the cage circumradius; pushed to
     window.__omegaAtomCage, which rebuilds the shared cage geometry. */
  const [cageEdge, setCageEdge] = React.useState(0.0286);   // §40 — forge filament ratio
  const setCageParam = (v) => {
    setCageEdge(v);
    if (window.__omegaAtomCage) window.__omegaAtomCage.set(v);
  };
  /* §32c — field readability dials: cage size (forge proportion 0.355
     reads crowded in the chamber's far denser sea) and the depth fade
     (what makes the sea read VAST instead of a flat ball of lights). */
  const [cageSize, setCageSize] = React.useState(0.355);   // §40 — forge proportion
  const setCageSizeParam = (v) => {
    setCageSize(v);
    if (window.__omegaAtomCage && window.__omegaAtomCage.setScale) window.__omegaAtomCage.setScale(v);
  };
  const [cageFog, setCageFog] = React.useState(false);   // §40 — forge design: no fog
  const setCageFogParam = (v) => {
    setCageFog(v);
    if (window.__omegaAtomCage && window.__omegaAtomCage.setFog) window.__omegaAtomCage.setFog(v);
  };
  /* §40 — the SHINE: per-atom additive halo level (the forge's "shine"
     dial, the missing half of the atom design). Read live by scene.js +
     her mirror via window.__omegaShine. */
  const [shine, setShine] = React.useState(60);
  React.useEffect(() => { window.__omegaShine = shine / 100; }, [shine]);
  /* §33 — inner lava level (0 = off, sim fully skipped). Read live by
     mirrorBall each frame via window.__omegaFluidAmt. */
  const [lavaAmt, setLavaAmt] = React.useState(100);
  React.useEffect(() => { window.__omegaFluidAmt = lavaAmt / 100; }, [lavaAmt]);
  /* §33f — inner-light treatment: flowing lava vs pure angel white. */
  const [lightStyle, setLightStyle] = React.useState("angel");
  React.useEffect(() => { window.__omegaAngel = lightStyle === "angel" ? 1 : 0; }, [lightStyle]);

  // Command bus — single source of truth for windows.
  const bus = window.useOmegaCommands([]);

  /* Atom-field palette — a curated colour direction for the whole field
     (positions.js PALETTES). Applied live via the scene handle's retint;
     retries until the renderer handle is mounted (same pattern as the
     space-colour pref). */
  React.useEffect(() => {
    let tries = 0, alive = true;
    const apply = () => {
      if (!alive) return;
      const h = window.omegaR3D && window.omegaR3D.__sceneHandle;
      if (h && h.setPalette) { h.setPalette(t.palette || "spectrum"); return; }
      /* Pre-mount: set the preset on positions.js directly so the first
         rebuildAtoms seeds with it (no flash of the wrong palette). */
      if (window.omegaR3D && window.omegaR3D.setPalette) window.omegaR3D.setPalette(t.palette || "spectrum");
      if (tries++ < 40) setTimeout(apply, 150);
    };
    apply();
    return () => { alive = false; };
  }, [t.palette]);

  /* Omega's mirror brightness (§27k) — 1.0 = true 1:1 reflection. */
  React.useEffect(() => {
    let tries = 0, alive = true;
    const apply = () => {
      if (!alive) return;
      const h = window.omegaR3D && window.omegaR3D.__sceneHandle;
      if (h && h.setCometReflect) { h.setCometReflect((t.cometReflect != null ? t.cometReflect : 100) / 100); return; }
      if (tries++ < 40) setTimeout(apply, 150);
    };
    apply();
    return () => { alive = false; };
  }, [t.cometReflect]);

  /* Energy mode — omegaState is the source of truth; this mirrors it
     so the Tweaks selector + cssVars react. lastActivity drives the
     idle step-down (focused → warm → listening → asleep). */
  const [energyMode, setEnergyMode] = React.useState("warm");
  const lastActivity = React.useRef(performance.now());
  const markActivity = () => { lastActivity.current = performance.now(); };

  /* ── Session — the OBSERVER's permission to interact, NOT Omega's
     state. Omega runs regardless; logging in only lets the human reach
     her (Evolution Plan §15/§21.2). Kept in its own store (omegaSession)
     so it never tangles with omegaState ("what Omega IS"). */
  const [session, setSession] = React.useState(window.omegaSession ? window.omegaSession.user : null);
  React.useEffect(() => {
    if (!window.omegaSession) return;
    return window.omegaSession.subscribe(setSession);
  }, []);
  const signedIn = !!session;
  const [loginActive, setLoginActive] = React.useState(false);
  /* Logged-out → the chamber dims slightly (a veil); she keeps working. */
  React.useEffect(() => {
    document.documentElement.dataset.session = signedIn ? "in" : "out";
  }, [signedIn]);
  /* The signed-in user's "reduce motion" preference calms UI entrance FX. */
  React.useEffect(() => {
    const rm = !!(session && session.prefs && session.prefs.reduceMotion);
    document.documentElement.dataset.userMotion = rm ? "reduced" : "full";
  }, [session]);
  /* The signed-in user's "space colour" preference. The void itself is the
     page background (behind the transparent canvas); the fog matches it so
     distant atoms blend to the space colour — no clear-colour change (that
     flickers). A LIGHT space inverts the whole field (a "negative"/blueprint
     mode) so the additive-glow atoms read as dark ink on a light ground
     instead of washing out; dark tints render normally. */
  React.useEffect(() => {
    const sc = (session && session.prefs && session.prefs.spaceColor) || null;
    const lum = (() => {
      if (!sc) return 0;
      const m = /^#?([0-9a-f]{6})$/i.exec(String(sc).trim());
      if (!m) return 0;
      const n = parseInt(m[1], 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    })();
    const invert = lum > 0.55;
    document.documentElement.dataset.spaceInvert = invert ? "on" : "off";
    /* Expose the space HUE so the chrome glass can subtly harmonise to it. */
    const hue = (() => {
      if (!sc) return 250;
      const m = /^#?([0-9a-f]{6})$/i.exec(String(sc).trim());
      if (!m) return 250;
      const n = parseInt(m[1], 16);
      const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d < 1e-4) return 250;
      let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
      return Math.round(h);
    })();
    document.documentElement.style.setProperty("--space-hue", hue);
    document.body.style.background = "";
    let tries = 0, alive = true;
    const apply = () => {
      if (!alive) return;
      const h = window.omegaR3D && window.omegaR3D.__sceneHandle;
      /* invert mode: give the canvas a near-black backdrop so the CSS invert
         filter flips it to light (and the bright atoms flip to dark ink). */
      if (h && h.setSpaceColor) { h.setSpaceColor(invert ? "#060709" : sc); return; }
      if (tries++ < 40) setTimeout(apply, 150);
    };
    apply();
    return () => { alive = false; };
  }, [session]);
  /* beginLogin — a logged-out interaction summons the front door AND fires
     a WAKE TICK: mark activity, kick a heartbeat, and wake Omega if asleep
     (she boots ~20s, started now so she's online by the time you're in).
     Waking is principled: a human arriving is a real signal, like an
     inbound message rippling the channel wall. */
  const beginLogin = () => {
    markActivity();
    if (window.omegaState && window.omegaState.wake) window.omegaState.wake();
    if (window.omegaScheduler && window.omegaScheduler.beatNow) window.omegaScheduler.beatNow();
    setLoginActive(true);
  };

  const thinkTimer = React.useRef(null);
  const cancelThinking = () => {
    if (thinkTimer.current) {
      if (typeof thinkTimer.current.cancel === "function") {
        thinkTimer.current.cancel();
      } else {
        clearTimeout(thinkTimer.current);
      }
      thinkTimer.current = null;
    }
    setThinking(false);
  };

  /* A conversation/surface can be closed OR minimized independently — the
     workspace is panes you manage one at a time. Closed = gone; minimized =
     parked on the left taskbar (restore by clicking its card). */
  const [convoClosed, setConvoClosed] = React.useState(false);
  const [convoMin, setConvoMin]       = React.useState(false);
  /* Bumped on every send so the (local-state) composer clears reliably,
     regardless of whether the seed `value` changed. */
  const [clearNonce, setClearNonce]   = React.useState(0);

  /* Hue for a surface kind = its causing atom's real colour (for taskbar
     card tint), matching the surface card. */
  const hueForKind = (kind) => {
    const sa = window.omegaSurfaceAtoms;
    const sh = window.omegaR3D && window.omegaR3D.__sceneHandle;
    const atom = sa && sa.causingAtomFor ? sa.causingAtomFor(kind) : null;
    if (sh && sh.screenPosOf && atom && atom[0] !== "&") {
      const sp = sh.screenPosOf(atom);
      if (sp && typeof sp.hue === "number") return sp.hue;
    }
    return 250;
  };
  /* How many panes are currently VISIBLE in the chat workspace. */
  const visiblePaneCount = (msgs, cClosed, cMin) =>
    ((!cClosed && !cMin) ? 1 : 0) +
    msgs.filter((m) => m.content && !m.detached && !m.minimized).length;
  /* When the workspace has no visible panes left, hide the shell (minimize
     the bus window); restoring any pane brings it back. */
  const syncChatShell = (msgs, cClosed, cMin) => {
    const cw = winsRef.current.find((w) => w.kind === "chat" && w.mounted);
    if (!cw) return;
    const vis = visiblePaneCount(msgs, cClosed, cMin);
    if (vis === 0 && !cw.minimized) bus.minimizeWindow(cw.id);
  };
  const ensureChatShell = () => {
    const cw = winsRef.current.find((w) => w.kind === "chat" && w.mounted);
    if (cw && cw.minimized) bus.restoreWindow(cw.id);
  };

  /* Close ONE stage surface (keep conversation + other surfaces). */
  const removeSurface = (idx) => {
    setMessages((m) => m.filter((_, i) => i !== idx));
  };
  /* Minimize / restore ONE stage surface → its own taskbar card. */
  const minimizeSurface = (idx) => {
    setMessages((m) => {
      const next = m.map((msg, i) => (i === idx ? { ...msg, minimized: true } : msg));
      syncChatShell(next, convoClosed, convoMin);
      return next;
    });
  };
  const restoreSurface = (idx) => {
    ensureChatShell();
    setMessages((m) => m.map((msg, i) => (i === idx ? { ...msg, minimized: false } : msg)));
  };
  /* Close the conversation pane: if surfaces remain, the workspace becomes
     stage-only; if nothing remains, close the whole window. */
  const closeConversation = () => {
    const hasSurface = messages.some((m) => m.content && !m.detached);
    if (hasSurface) { setConvoClosed(true); return; }
    const cw = winsRef.current.find((w) => w.kind === "chat" && w.mounted);
    if (cw) closeSurface(cw.id);
  };
  /* Minimize / restore the conversation pane → a "conversation" taskbar card. */
  const minimizeConversation = () => {
    setConvoMin(true);
    syncChatShell(messages, convoClosed, true);
  };
  const restoreConversation = () => { ensureChatShell(); setConvoMin(false); };
  /* Minimize the WHOLE workspace = minimize each visible pane to its own
     card (conversation + every visible surface). Used by click-off and the
     window's – button. */
  const minimizeAllPanes = () => {
    setConvoMin(true);
    setMessages((m) => {
      const next = m.map((msg) => (msg.content && !msg.detached && !msg.minimized)
        ? { ...msg, minimized: true } : msg);
      syncChatShell(next, convoClosed, true);
      return next;
    });
  };

  // Memoize content nodes so OmegaWindow doesn't unmount on each render.
  const chatContent = (
    <window.ChatWindow messages={messages} omegaThinking={omegaThinking}
      value={text} onChange={setText} convoClosed={convoClosed} convoMin={convoMin}
      clearNonce={clearNonce}
      onSend={(v) => handleRidgeSubmit(v)}
      onCloseSurface={removeSurface} onMinimizeSurface={minimizeSurface}
      onCloseConversation={closeConversation} onMinimizeConversation={minimizeConversation} />
  );
  /* Latest content node, so a DELAYED chat open (after the receive-atom
     fly-in) mounts with the CURRENT text — not the node captured when the
     open was scheduled (which would drop the keystroke that summoned it). */
  const chatContentRef = React.useRef(chatContent);
  chatContentRef.current = chatContent;
  const seenChatEventIds = React.useRef(new Set());

  // Refresh the chat window's content whenever messages change, and
  // size it: a narrow conversation panel when chatting, a wide
  // workspace (chat + right stage) when Omega is showing something.
  React.useEffect(() => {
    const hasStage = messages.some((m) => m.content && !m.detached);
    const hasMsgs = messages.length > 0;
    const vw = window.innerWidth, vh = window.innerHeight;
    /* ONE window that IS the input and grows: compact composer when
       empty (centered, low), taller once messages exist (rises), full
       workspace when a surface is shown. */
    const W = hasStage ? Math.min(1240, Math.max(720, vw * 0.84))
            : hasMsgs ? Math.min(620, Math.max(440, vw * 0.46))
            : 560;
    const H = hasStage ? Math.min(vh * 0.82, vh - 80)
            : hasMsgs ? Math.min(vh * 0.72, Math.max(320, vh * 0.5))
            : 68;
    const X = (vw - W) / 2;
    const Y = (hasMsgs || hasStage) ? Math.max(20, vh * 0.08) : Math.round(vh * 0.52);
    bus.windows.forEach((w) => {
      if (w.kind === "chat") bus.updateWindow(w.id, { content: chatContent, w: W, h: H, x: X, y: Y });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, omegaThinking, convoClosed, convoMin]);

  /* ── Omega responder ─────────────────────────────────────────── */
  const askOmega = (userText) => {
    setThinking(true);
    /* pickOmegaReply is async — it calls real Claude when available,
       falls back to a canned pool otherwise. We snapshot the current
       message history so Claude has multi-turn context, then wait
       for the network reply OR a minimum "thinking" latency,
       whichever is greater. */
    const recent = messages;
    let replyText = null;
    let waitTimer = null;
    let networkDone = false;
    let minWaitDone = false;
    const settle = () => {
      if (networkDone && minWaitDone && replyText != null) {
        thinkTimer.current = null;
        setThinking(false);
        setMessages((m) => [...m, { role: "omega", text: replyText }]);
        /* Omega speaking → the `send` atom (Voice) fires. */
        if (window.omegaSurfaceAtoms) window.omegaSurfaceAtoms.ignite("send");
      }
    };
    /* Kick off the reply request. */
    Promise.resolve(window.pickOmegaReply(userText, recent)).then((reply) => {
      if (reply == null || reply === "") {
        replyText = null;
        networkDone = true;
        minWaitDone = true;
        thinkTimer.current = null;
        setThinking(false);
        return;
      }
      replyText = reply;
      const wait = window.omegaLatency(reply);
      // Minimum thinking time — gives the conversation cadence even
      // when the network is fast.
      waitTimer = setTimeout(() => { minWaitDone = true; settle(); }, wait);
      networkDone = true;
      // If wait timer already fired (shouldn't, but defensive), settle now.
      settle();
    }).catch((e) => {
      console.warn("[Omega] reply failed", e);
      replyText = "…";
      networkDone = true; minWaitDone = true;
      thinkTimer.current = null;
      setThinking(false);
      setMessages((m) => [...m, { role: "omega", text: "…" }]);
    });
    thinkTimer.current = { cancel() {
      if (waitTimer) clearTimeout(waitTimer);
      networkDone = true; minWaitDone = true; replyText = null;
    } };
  };

  React.useEffect(() => {
    const onChatMessage = (event) => {
      const detail = event.detail || {};
      const payload = detail.payload || {};
      if (payload.direction !== "outbound" && detail.source !== "omega") return;
      const id = payload.id || `${detail.seq || ""}:${payload.text || ""}`;
      if (seenChatEventIds.current.has(id)) return;
      seenChatEventIds.current.add(id);
      setThinking(false);
      setMessages((m) => [...m, {
        role: "omega",
        text: payload.text || "",
        content: payload.content,
      }]);
      if (window.omegaSurfaceAtoms) window.omegaSurfaceAtoms.ignite("send");
    };
    window.addEventListener("omegaos:chat-message", onChatMessage);
    return () => window.removeEventListener("omegaos:chat-message", onChatMessage);
  }, []);

  /* ── Global keyboard router ─────────────────────────────────── */
  React.useEffect(() => {
    const onKey = (e) => {
      /* Bail if ANY input/textarea owns focus — not just the event
         target. This protects in-chamber windows (dev console, etc.)
         from having their keystrokes hijacked by the chamber's
         "speak to Omega" router when focus drifts (e.g. user
         clicked the window header). */
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const active = document.activeElement;
      const activeTag = active && active.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (busy) return;
      const isPrintable = e.key.length === 1;
      const isWakeKey   = e.key === "Enter" || e.key === " ";
      if (!isPrintable && !isWakeKey) return;
      /* Logged out → any wake key opens the front door (and wakes her),
         never the chat. */
      if (!window.omegaSession || !window.omegaSession.signedIn) {
        e.preventDefault();
        beginLogin();
        return;
      }
      if (!awake) {
        e.preventDefault();
        setAwake(true);
        openChat();
        if (isPrintable && e.key !== " ") {
          setText((p) => p + e.key);
          setTimeout(() => document.querySelector(".chat-composer-input")?.focus(), 340);
        }
        return;
      }
      if (omegaThinking) return;
      if (!isPrintable) return;
      e.preventDefault();
      openChat();
      setText((p) => p + e.key);
      requestAnimationFrame(() => {
        document.querySelector(".chat-composer-input")?.focus();
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [awake, busy, omegaThinking, ridgeOpen]);

  /* ── One chat window that IS the input (compact) and grows ───── */
  const winsRef = React.useRef(bus.windows);
  winsRef.current = bus.windows;
  const openingChatRef = React.useRef(false);
  const openChat = () => {
    if (!awake) setAwake(true);
    const existing = winsRef.current.find((w) => w.kind === "chat" && w.mounted);
    if (existing) {
      /* Already open — if it's minimized (backgrounded), restore it. */
      if (existing.minimized) bus.restoreWindow(existing.id);
      return;
    }
    if (openingChatRef.current) return;
    setConvoClosed(false); setConvoMin(false);   // fresh chat shows its conversation
    setText("");                                  // start with an empty composer buffer
    openingChatRef.current = true;
    const vw = window.innerWidth, vh = window.innerHeight;
    const W = 560, H = 68;
    const x = Math.round((vw - W) / 2), y = Math.round(vh * 0.52);
    const sceneH = window.omegaR3D && window.omegaR3D.__sceneHandle;
    /* New user input requested → PULL the `receive` atom into view exactly
       like pin (summon: it flies to front-centre, brightens), then the chat
       composer morphs OUT OF it — the new-input atom becomes the input box.
       The keystroke that summoned it is buffered in `text` and the composer
       auto-focuses on mount, so the brief fly-in doesn't drop typing. */
    const res = (sceneH && sceneH.summon) ? sceneH.summon("receive", { quiet: true }) : null;
    const openIt = () => {
      let morphIn;
      if (res && res.kind === "atom") {
        window.__omegaUserFocusUntil = performance.now() + 15000;
        const sp = sceneH.screenPosOf ? sceneH.screenPosOf(res.target) : null;
        const cg = sceneH.cageSilhouette ? sceneH.cageSilhouette(res.target) : null;
        const hue = cg ? cg.hue : (sp ? sp.hue : 235);
        const start = sp ? { cx: sp.x, cy: sp.y, r: sp.radius || 18, hue }
                         : { cx: x + W / 2, cy: y + H / 2, r: 18, hue };
        morphIn = { start, hue, cage: cg, target: res.target };
      } else if (window.omegaSurfaceAtoms) {
        window.omegaSurfaceAtoms.ignite("receive");
      }
      bus.openWindow("chat", chatContentRef.current, {
        w: W, h: H, selfLayout: true, x, y,
        morphIn, context: morphIn ? { atomHue: morphIn.hue } : {},
      });
      openingChatRef.current = false;
      /* KEEP morphIn — the chat retains the receive-atom hue (the card
         styling) instead of reverting to the old blue glass-edge once the
         pull-in settles. It collapses back into the receive atom on close. */
    };
    if (res && res.kind === "atom") setTimeout(openIt, 480);  // let it fly in first
    else openIt();
  };

  /* ── Room interaction ───────────────────────────────────────── */
  /* LEFT click anywhere → summon the chat (one window: a compact
     input that grows). RIGHT click → inspect the atom under the
     cursor (contextmenu effect below). */
  const handleRoomClick = (e) => {
    if (busy) return;
    /* A look-drag (vantage) swallows its click so dragging to look
       around never also summons the chat. */
    if (window.__omegaCameraDragging) return;
    /* Logged out → the click summons the front door (and wakes her),
       never the chat. */
    if (!window.omegaSession || !window.omegaSession.signedIn) { beginLogin(); return; }
    markActivity();
    /* Click on the ROOM (outside any surface): MINIMIZE the focused panes
       to the left taskbar — they stay open, just out of focus. The chat
       workspace minimizes per-pane (conversation + each surface get their
       own card); standalone windows minimize whole. Click a card to
       restore. If nothing is visible to background, summon the chat. */
    const chatVisible = winsRef.current.find((w) => w.kind === "chat" && w.mounted && !w.minimized);
    const otherVisible = winsRef.current.filter((w) => w.mounted && !w.minimized && !w.pinned && w.kind !== "chat");
    if (chatVisible || otherVisible.length) {
      if (chatVisible) minimizeAllPanes();
      otherVisible.forEach((w) => bus.minimizeWindow(w.id));
      return;
    }
    openChat();
  };

  /* Ask Omega to look into a space (gather) — or disperse on null. We
     request; the gather is her action, relayed through the frame. The
     15s window lets her autonomous looking defer to us briefly. */
  const focusSpace = (sp) => {
    markActivity();
    window.__omegaUserFocusUntil = performance.now() + 15000;
    window.omegaIntents.emit({ type: "focus", target: sp || null, origin: "user" });
  };

  /* Close a surface. A summoned-atom (morphIn) window REVERSES its edge
     morph first — the card collapses back through the liquid blob into the
     atom's cage — and only then unmounts + releases the atom (endSummon).
     Other surfaces close immediately. */
  const closeSurface = (id) => {
    const w = winsRef.current.find((x) => x.id === id);
    const h = window.omegaR3D && window.omegaR3D.__sceneHandle;
    if (w && w.morphIn && !w.morphClosing) {
      /* Re-read the atom's CURRENT screen position so the collapse ends
         exactly where the atom respawns (it/camera may have drifted since
         open). screenPosOf reads the world position, valid even while the
         atom is hidden during the open card. */
      const sp = (h && h.screenPosOf && w.morphIn.target) ? h.screenPosOf(w.morphIn.target) : null;
      bus.updateWindow(id, { morphClosing: true, morphCloseCenter: sp ? { x: sp.x, y: sp.y } : null });
      setTimeout(() => {
        if (h && h.endSummon) h.endSummon();
        bus.closeWindow(id, "user");
      }, 600);
      return;
    }
    if (h && h.endSummon) h.endSummon();
    bus.closeWindow(id, "user");
  };

  React.useEffect(() => {
    const onCtx = (e) => {
      if (e.target.closest &&
          e.target.closest(".omega-window, .twk-panel, .status-dock, .ridge-stack")) return;
      e.preventDefault();
      markActivity();
      const h = window.omegaR3D && window.omegaR3D.__sceneHandle;
      if (h && h.pickAtomAt && typeof e.clientX === "number") {
        const node = h.pickAtomAt(e.clientX, e.clientY);
        if (node) {
          const isSpace = node.metadata && node.metadata.atomKind === "space";
          const chatOpen = !!document.querySelector(".omega-window.kind-chat");
          if (isSpace) {
            /* A space → look into it: inspect the anchor + gather its
               continent. We ask; she acts. */
            window.omegaIntents.emit({ type: "inspect", target: node.label, origin: "user" });
            window.__omegaUserFocusUntil = performance.now() + 15000;
            window.omegaIntents.emit({ type: "focus", target: node.label, origin: "user" });
          } else if (chatOpen) {
            /* Mid-conversation: compose the card inline so the chat isn't
               disrupted. */
            window.omegaIntents.emit({ type: "inspect", target: node.label, origin: "user" });
          } else {
            /* Any other atom in the open field → SUMMON it: it flies to you
               and its real card blooms out of the atom — the unified
               drill-to-exact gesture, the same flow as Summon, for EVERY
               atom (now that every atom has a real card). */
            window.__omegaUserFocusUntil = performance.now() + 15000;
            window.omegaIntents.emit({ type: "summon", target: node.label, origin: "user" });
          }
        }
      }
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Submit (ridge → bus) ─────────────────────────────────── */
  const handleRidgeSubmit = (override) => {
    const src = override != null ? override : text;
    if (busy || omegaThinking || !src.trim()) return;
    const userMsg = src.trim();
    setText("");   // clear the send buffer
    setClearNonce((n) => n + 1);   // tell the composer to clear its local draft
    markActivity();
    if (window.omegaState) window.omegaState.setMode("focused");

    const chatExists = bus.windows.some((w) => w.kind === "chat" && w.mounted);

    if (!chatExists) {
      setBusy(true);
      setMessages([{ role: "user", text: userMsg }]);
      bus.openWindow("chat", chatContent, { w: 460, h: 420 });
      setTimeout(() => askOmega(userMsg), 900);
      setTimeout(() => setBusy(false), 800);
    } else {
      setMessages((m) => [...m, { role: "user", text: userMsg }]);
      setTimeout(() => askOmega(userMsg), 250);
    }

    /* Surface decisions live in Omega, not the UI. mockOmega's
       reactToInput emits open-surface / invoke-skill / inspect intents
       (origin "omega"); the UI only renders them. Live OmegaClaw's loop
       emits the same intents — the membrane holds zero decision logic. */
    if (window.omegaReactToInput) window.omegaReactToInput(userMsg);
  };

  /* ── Springs (core position) ─────────────────────────────────── */
  const groundPct = window.useSpring(awake ? 50 : t.coreGround, {
    stiffness: 55, damping: 22,
  });
  const halfCore = t.coreSize / 2;
  const coreSlotStyle = {
    top: `calc(${groundPct}% - ${halfCore}vmin)`,
  };
  const hintSlotStyle = {
    top: `calc(${t.coreGround}% + ${halfCore}vmin + 4vmin)`,
  };
  const coreStyle = {
    width:  `${t.coreSize}vmin`,
    height: `${t.coreSize}vmin`,
  };
  const sphereStyle = { borderRadius: "50%" };

  /* ── Core center (px) for OmegaWindow morph anchor ──────────── */
  const [coreCenter, setCoreCenter] = React.useState({ x: 0, y: 0 });
  React.useEffect(() => {
    /* §38 — CSS renderer only: under WebGL the .core element is
       display:none, so this 200ms measuring interval ran forever just
       to read a zero rect. */
    if (t.renderer !== "css") return;
    const measure = () => {
      const el = document.querySelector(".core");
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCoreCenter({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    };
    measure();
    window.addEventListener("resize", measure);
    const id = setInterval(measure, 200); // track the spring-driven core
    return () => {
      window.removeEventListener("resize", measure);
      clearInterval(id);
    };
  }, [t.renderer]);

  /* Energy mode supplies breath + field-grade vars (mode is the
     source of truth via omegaState); the rest stay tweak-driven.
     --glow-hue is set on :root by the energy effect so it transitions. */
  const ep = window.omegaState && window.omegaState.profiles[energyMode];
  const cssVars = {
    "--core-size":      `${t.coreSize}vmin`,
    "--breath-dur":     `${ep ? ep.breathDur : t.breathDur}s`,
    "--glow-dur":       `${t.glowDur}s`,
    "--omega-opacity":  t.omegaOpacity,
  };

  /* Walls on/off — sets a single root attribute that CSS keys off
     to nuke all surface fills, the room background, the body bg,
     and the room vignette. Perspective + surface transforms stay
     intact, so atoms still float on invisible 3D planes. */
  React.useEffect(() => {
    document.documentElement.dataset.walls = t.walls || "on";
  }, [t.walls]);

  /* Busyness — push the scheduler's tempo/burst directly. The
     slider is the dev trigger called out in the brief; cranking it
     up forces overlapping loop generations so the Stage 4 recede is
     visible. */
  /* ── Energy mode → chamber visuals ──────────────────────────
     omegaState is the single source of truth for Omega's energy mode
     (asleep…creative). The mode drives the core's breath + hue (via
     cssVars below), the atom-field brightness/saturation, and the
     scheduler tempo — so the room reads as Omega's current state.
     Live OmegaClaw sets the mode through the same store. */
  /* Kick off Omega's autonomous looking — she gathers her memory spaces
     as she runs, so the room is alive on load with no user present. */
  React.useEffect(() => {
    /* Plant the surface-affordance atoms (receive / show image / play
       video / play audio / open browser) so every surface has a real
       causing atom on the wall to ignite + emanate from. */
    if (window.omegaSurfaceAtoms) window.omegaSurfaceAtoms.plant();
    if (window.omegaStartAutoFocus) window.omegaStartAutoFocus();
  }, []);

  React.useEffect(() => {
    if (!window.omegaState) return;
    return window.omegaState.subscribe((mode, p) => {
      setEnergyMode(mode);
      const root = document.documentElement;
      root.dataset.energyMode = mode;
      /* --glow-hue lives on :root (it has the @property transition),
         so set it here for a smooth hue ease between modes. */
      root.style.setProperty("--glow-hue", p.hue);
      /* Field brightness via the renderer's tone-mapping exposure (a
         CSS filter on the WebGL canvas doesn't take). The scene eases
         toward this target each frame. */
      const h = window.omegaR3D && window.omegaR3D.__sceneHandle;
      if (h && h.setExposure) h.setExposure(p.bright);
      if (window.omegaScheduler) window.omegaScheduler.busyness = p.busy;
    });
  }, []);

  /* ── Living energy: activity wakes, silence settles ─────────
     Sending wakes Omega to 'focused'; quiet steps her down over time,
     so the chamber breathes with attention rather than holding one
     state. Step-down ladder only (waking is event-driven). */
  React.useEffect(() => {
    const id = setInterval(() => {
      if (!window.omegaState) return;
      const idle = (performance.now() - lastActivity.current) / 1000;
      const m = window.omegaState.mode;
      if (idle > 90 && m !== "asleep") window.omegaState.setMode("asleep");
      else if (idle > 35 && (m === "warm" || m === "focused")) window.omegaState.setMode("listening");
      else if (idle > 10 && m === "focused") window.omegaState.setMode("warm");
    }, 3000);
    return () => clearInterval(id);
  }, []);

  /* Renderer selector — css | webgl. WebGL is the canonical view.
     The CSS chamber stays in the codebase as a legacy reference but
     does not mount (no 1700-atom React tree, no per-frame style
     mutations) unless explicitly chosen. */
  React.useEffect(() => {
    document.documentElement.dataset.renderer = t.renderer || "webgl";
  }, [t.renderer]);

  /* Plant the console SKILL atom in the chamber + register its
     action. The atom is real — it sits on the left wall with the
     other skills, ignites when called, and is the visible target
     the metaphor revolves around. Calling the skill (chat or
     button) dispatches a thought at this atom; on arrival the
     action runs and the window materializes. */
  React.useEffect(() => {
    if (!window.omegaGraph || !window.omegaSkills) return;
    const SKILL_ID = "skill.console";
    const exists = window.omegaGraph.nodes.some((n) => n.id === SKILL_ID);
    if (!exists) {
      /* §38 — applyDelta (one rebuild), NOT addNode: addNode's born-from-
         nothing tween (_lifeScale 0→1) kept graph.tick() dirty for ~1s,
         and every dirty tick fires subscribers — the WebGL scene was
         re-running its FULL field rebuild (force layout + instanced
         geometry) ~60× during startup. */
      window.omegaGraph.applyDelta({ addNodes: [{
        id: SKILL_ID,
        label: "console",
        kind: "skill.console",
        group: "skills",
        space: "main",       // join the main hypergraph region
        surface: "left",
        x: 50, y: 32,
        confidence: 1.0,
        salience: 0.95,
        status: "active",
        sides: 5,
      }] });
    }
    window.omegaSkills.register(SKILL_ID, () => {
      /* Open the console window via the command bus — same path
         any other window opens through. */
      bus.openWindow("console",
        <window.DevConsoleBody />, { w: 520, h: 380 });
    });
    return () => window.omegaSkills.unregister(SKILL_ID);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Intent bus → surface layer ──────────────────────────
     The single place the UI listens for open / close / invoke
     intents. Human actions and Omega decisions both arrive here as
     intents (tagged by origin), so the UI never decides what to
     summon on its own — it only renders what it is told. When live
     OmegaClaw is wired, its loop emits these same intents. */
  React.useEffect(() => {
    const off = window.omegaIntents.subscribe((intent) => {
      if (intent.type === "open-surface") {
        const s = intent.surface || {};
        /* console is a real skill atom — route through the skill so
           the dispatch→ignite→action heartbeat plays out. */
        if (s.kind === "console") { window.omegaSkills && window.omegaSkills.invoke("skill.console"); return; }
        /* ── ONE WINDOW ───────────────────────────────────────────────
           If the chat/workspace is already open, a surface DOCKS INTO its
           right-hand stage (as a content message) — it is NOT a separate
           floating window. The causing atom still fires on its wall. This
           is the single-workspace rule: conversation ⊕ surfaces in ONE
           window. (With no chat open, it opens as its own surface below.) */
        const chatOpen = !!winsRef.current.find((w) => w.kind === "chat" && w.mounted);
        if (chatOpen) {
          const sa0 = window.omegaSurfaceAtoms;
          const fromL0 = s.fromAtom || (sa0 && sa0.causingAtomFor(s.kind));
          if (sa0 && fromL0) sa0.ignite(fromL0);
          setMessages((m) => [...m, {
            role: intent.origin === "user" ? "user" : "omega",
            content: { kind: s.kind, title: s.title || s.kind, payload: s.payload },
          }]);
          return;
        }
        const r = window.resolveOmegaSurface(s.kind, s.payload, s.title);
        const W = s.w != null ? s.w : r.w, H = s.h != null ? s.h : r.h;
        const baseOpts = {
          w: W, h: H, pinned: s.pinned, id: s.id,
          title: s.title || s.kind,
          controller: s.controller, layout: s.layout,
          context: s.context || {}, traceRef: s.traceRef,
          origin: intent.origin,
        };
        /* ── Every surface opens FROM the atom that caused it ──────────
           Resolve the causing affordance/skill atom (intent-supplied
           fromAtom, else the grounded kind→atom map). An ATOM-backed
           surface PULLS that atom into view exactly like `pin` (summon:
           it flies to front-centre, brightens, the field dims), then the
           surface opens as an EDGE-MORPH out of it — the atom literally
           BECOMES the surface, and collapses back into it on close. A
           SPACE-backed panel (&agenda / &attention) instead ignites a
           member in place and opens plainly. */
        const sceneH = window.omegaR3D && window.omegaR3D.__sceneHandle;
        const sa = window.omegaSurfaceAtoms;
        const fromLabel = s.fromAtom || (sa && sa.causingAtomFor(s.kind));
        if (sceneH && sceneH.summon && fromLabel && fromLabel[0] !== "&") {
          const res = sceneH.summon(fromLabel, { quiet: true });
          if (res && res.kind === "atom") {
            window.__omegaUserFocusUntil = performance.now() + 15000;
            /* Let it fly to centre (~700ms), then open the surface as the
               morph out of the now-centred atom. */
            setTimeout(() => {
              const sp = sceneH.screenPosOf ? sceneH.screenPosOf(res.target) : null;
              const cg = sceneH.cageSilhouette ? sceneH.cageSilhouette(res.target) : null;
              const vw = window.innerWidth, vh = window.innerHeight;
              const ex = Math.round((vw - W) / 2);
              const ey = Math.round(Math.max(24, (vh - H) / 2 - 10));
              const hue = cg ? cg.hue : (sp ? sp.hue : 210);
              const start = sp
                ? { cx: sp.x, cy: sp.y, r: sp.radius || 20, hue }
                : { cx: ex + W / 2, cy: ey + H / 2, r: 20, hue };
              bus.openWindow(s.kind || "surface", r.content, {
                ...baseOpts, selfLayout: true, x: ex, y: ey,
                morphIn: { start, hue, cage: cg, target: res.target },
                context: { ...baseOpts.context, atomHue: hue },
              });
            }, 700);
            return;
          }
        }
        /* Space-backed (or no causing atom) → ignite a member + open plainly. */
        if (sa && fromLabel) sa.ignite(fromLabel);
        bus.openWindow(s.kind || "surface", r.content, baseOpts);
      } else if (intent.type === "close-surface") {
        bus.closeWindow(intent.id, intent.origin);
      } else if (intent.type === "invoke-skill") {
        window.omegaSkills && window.omegaSkills.invoke(intent.skillId);
      } else if (intent.type === "focus") {
        /* Relay a focus into the layout frame — the renderer gathers the
           named space into a continent (or disperses on null). The
           membrane decides nothing; Omega (or our request) drove this. */
        if (window.omegaState) window.omegaState.setFrame({
          layoutMode: intent.target ? "gather" : "resting",
          focus: intent.target || null,
        });
      } else if (intent.type === "reason") {
        /* A reasoning HOP (§11): the renderer gathers premises+conclusion
           into a tiny continent in the space, then we open the receipt
           on it. The renderer chooses the atoms (salient beliefs) unless
           `spec` names them; the UI just relays + shows the view. */
        const h = window.omegaR3D && window.omegaR3D.__sceneHandle;
        const r = h && h.reason ? h.reason(intent.spec) : null;
        if (r) {
          window.__omegaUserFocusUntil = performance.now() + 15000;
          const payload = { premises: r.premises, conclusion: r.conclusion };
          setTimeout(() => {
            if (document.querySelector(".omega-window.kind-chat")) {
              setMessages((mm) => [...mm, { role: "omega", content: {
                kind: "reasoning", title: "reasoning · " + r.conclusion, payload } }]);
            } else {
              bus.openWindow("reasoning",
                window.resolveOmegaSurface("reasoning", payload).content, {
                  w: 420, h: 480, title: "reasoning · " + r.conclusion,
                  context: { opened_because: "reasoned to " + r.conclusion },
                  origin: intent.origin,
                });
            }
          }, 1400);   // let the continent assemble first, then dock the receipt
        }
      } else if (intent.type === "summon") {
        /* Summon (roadmap #4): a SPACE → its atoms orbit Omega as a galaxy;
           an ATOM → it flies to screen-centre and EXPANDS into its detail
           card. The renderer does the motion + tells us which kind it was;
           for an atom we then open its inspector card (the "expand into
           details" — why you'd summon a single atom). */
        const h = window.omegaR3D && window.omegaR3D.__sceneHandle;
        const res = h && h.summon ? h.summon(intent.target) : null;
        if (res) {
          window.__omegaUserFocusUntil = performance.now() + 15000;
          if (res.kind === "atom") {
            /* Once the atom has flown to the forefront, open its inspector
               window AS an edge-morph: the window mounts at its target rect
               but clipped to the atom's silhouette, then the clip expands
               into the full frame while the real 3D atom dissolves — the
               morph IS the surface, content live throughout (roadmap #2). */
            setTimeout(() => {
              const sp = h.screenPosOf ? h.screenPosOf(res.target) : null;
              const cg = h.cageSilhouette ? h.cageSilhouette(res.target) : null;
              const vw = window.innerWidth, vh = window.innerHeight;
              const W = 384, H = 452;
              const ex = Math.round((vw - W) / 2);
              const ey = Math.round(Math.max(24, (vh - H) / 2 - 28));
              const hue = cg ? cg.hue : (sp ? sp.hue : 210);
              const start = sp
                ? { cx: sp.x, cy: sp.y, r: sp.radius || 22, hue }
                : { cx: ex + W / 2, cy: ey + H / 2, r: 22, hue };
              bus.openWindow("inspect",
                window.resolveOmegaSurface("inspect", { target: res.target }).content, {
                  title: "inspect · " + res.target,
                  selfLayout: true, x: ex, y: ey, w: W, h: H,
                  morphIn: { start, hue, cage: cg, target: res.target },
                  context: { opened_because: "summoned " + res.target, atomHue: hue },
                  origin: intent.origin || "user",
                });
            }, 700);
          }
        }
      } else if (intent.type === "inspect") {
        /* Inspect composes into the primary panel when a conversation is
           open; otherwise it floats as its own surface. */
        if (document.querySelector(".omega-window.kind-chat")) {
          setMessages((mm) => [...mm, { role: "omega", content: {
            kind: "inspect", title: "inspect · " + intent.target,
            payload: { target: intent.target } } }]);
        } else {
          bus.openWindow("inspect",
            window.resolveOmegaSurface("inspect", { target: intent.target }).content, {
              w: 400, h: 410, title: "inspect · " + intent.target,
              context: { opened_because: "inspected " + intent.target },
              origin: intent.origin,
            });
        }
      } else if (intent.type === "chat-message") {
        /* Omega placing rich content INTO the conversation surface
           (adaptable surface — same container, new content kind). */
        setMessages((m) => [...m, {
          role: intent.role || "omega",
          text: intent.text,
          content: intent.content,
        }]);
        /* Omega speaking into the conversation → the `send` atom fires. */
        if ((intent.role || "omega") === "omega" && window.omegaSurfaceAtoms)
          window.omegaSurfaceAtoms.ignite("send");
      } else if (intent.type === "detach-media") {
        /* Split: the inline tile becomes its own surface; mark the
           message detached so the chat shows a "moved out" stub. */
        setMessages((m) => m.map((msg, i) =>
          i === intent.index ? { ...msg, detached: true } : msg));
        const k = intent.content.kind;
        const r = window.resolveOmegaSurface(k, intent.content.payload);
        bus.openWindow(k, r.content, {
          w: r.w, h: r.h, title: k,
          context: { opened_because: "split from the conversation" },
          origin: intent.origin,
        });
      } else if (intent.type === "merge-into-chat") {
        /* Merge: a content surface dropped on the chat re-embeds inline
           (closes the surface, un-detaches the matching stub). */
        bus.closeWindow(intent.surfaceId, intent.origin || "user");
        setMessages((m) => {
          let merged = false;
          return m.map((msg) =>
            (!merged && msg.detached && msg.content && msg.content.kind === intent.kind)
              ? (merged = true, { ...msg, detached: false })
              : msg);
        });
      }
    });
    return off;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* When the conversation is closed AND no surfaces remain, the workspace
     is empty → close the window and reset (so a fresh chat shows convo). */
  React.useEffect(() => {
    if (!convoClosed) return;
    const hasSurface = messages.some((m) => m.content && !m.detached);
    if (!hasSurface) {
      const cw = winsRef.current.find((w) => w.kind === "chat" && w.mounted);
      if (cw) closeSurface(cw.id);
      setConvoClosed(false);
    }
  }, [convoClosed, messages]);

  return (
    <div style={cssVars}>
      <window.Renderer3D enabled={t.renderer !== "css"} />
      <window.Room
        renderer={t.renderer}
        awake={awake}
        hasWindows={bus.windows.some((w) => w.mounted)}
        onRoomClick={handleRoomClick}
        coreSlotStyle={coreSlotStyle}
        hintSlotStyle={hintSlotStyle}
        core={
          <window.OmegaCore coreStyle={coreStyle} sphereStyle={sphereStyle} />
        }
        hint={null}
        ridge={
          bus.windows.some((w) => w.kind === "chat" && w.mounted) ? null : (
            <window.InputRidge
              open={ridgeOpen}
              centered={true}
              value={text}
              onChange={setText}
              onSubmit={handleRidgeSubmit}
            />
          )
        }
        windows={bus.windows.filter((w) => !w.minimized).map((w) => (
          <window.OmegaWindow
            key={w.id}
            win={w}
            coreCenter={coreCenter}
            onUpdate={bus.updateWindow}
            onTogglePin={bus.togglePin}
            onMergeToCore={bus.mergeToCore}
            onMinimize={(id) => {
              const ww = winsRef.current.find((x) => x.id === id);
              if (ww && ww.kind === "chat") minimizeAllPanes();
              else bus.minimizeWindow(id);
            }}
            onClose={(id) => closeSurface(id)}
          />
        ))}
      />

      <window.OmegaTaskbar items={(() => {
        const items = [];
        if (convoMin && !convoClosed) items.push({ key: "convo", label: "conversation", hue: hueForKind("chat"), onClick: restoreConversation });
        messages.forEach((m, i) => {
          if (m.content && !m.detached && m.minimized)
            items.push({ key: "surf-" + i, label: m.content.title || m.content.kind, hue: hueForKind(m.content.kind), onClick: () => restoreSurface(i) });
        });
        bus.windows.filter((w) => w.mounted && w.minimized && w.kind !== "chat").forEach((w) =>
          items.push({ key: w.id, label: w.title || w.kind, hue: (w.context && w.context.atomHue) || 250, onClick: () => bus.restoreWindow(w.id) }));
        return items;
      })()} />

      <window.StatusDock
        awake={awake}
        surfaceCount={bus.windows.filter((w) => w.mounted).length}
      />

      <window.Login
        active={loginActive}
        onAuthed={(profile) => { if (window.omegaSession) window.omegaSession.signIn(profile); setLoginActive(false); markActivity(); }}
        onCancel={() => setLoginActive(false)}
      />
      <window.OmegaBrand session={session}
        onSignOut={() => window.omegaSession && window.omegaSession.signOut()} />

      <window.TweaksPanel title="Tweaks">
        <window.TweakSection label="The Core" />
        <window.TweakSlider label="Size" value={t.coreSize}
          min={6} max={32} step={0.5} unit="vmin"
          onChange={(v) => setTweak("coreSize", v)} />
        <window.TweakSlider label="Ground line" value={t.coreGround}
          min={50} max={92} step={0.5} unit="%"
          onChange={(v) => setTweak("coreGround", v)} />
        <window.TweakSlider label="Ω visibility"
          value={Math.round(t.omegaOpacity * 100)}
          min={0} max={100} step={1} unit="%"
          onChange={(v) => setTweak("omegaOpacity", v / 100)} />
        <window.TweakSection label="Chamber" />
        <window.TweakRadio label="Walls" value={t.walls}
          options={["on", "off"]}
          onChange={(v) => setTweak("walls", v)} />
        <window.TweakSection label="Energy mode" />
        <window.TweakRadio label="Mode" value={energyMode}
          options={["asleep", "listening", "warm", "focused", "creative"]}
          onChange={(m) => { markActivity(); if (window.omegaState) window.omegaState.setMode(m); }} />
        <window.TweakButton label="Beat now"
          onClick={() => window.omegaScheduler && window.omegaScheduler.beatNow()} />
        <window.TweakSection label="Renderer" />
        <window.TweakRadio label="View" value={t.renderer}
          options={["webgl", "css"]}
          onChange={(v) => setTweak("renderer", v)} />
        <window.TweakSection label="Command bus demo" />
        <window.TweakButton
          label="Open dev console"
          onClick={() => window.omegaIntents.emit({
            type: "invoke-skill", skillId: "skill.console", origin: "user",
          })}
        />
        <window.TweakButton
          label="Open lorem window"
          onClick={() => window.omegaIntents.emit({
            type: "open-surface", surface: { kind: "lorem" }, origin: "user",
          })}
        />
        <window.TweakButton
          label="Collapse unpinned"
          onClick={() => bus.collapseUnpinned()}
        />
        <window.TweakSection label="Palette · atom field" />
        <window.TweakRadio label="Direction" value={t.palette || "spectrum"}
          options={["jewel", "aurora", "mineral", "starlight", "spectrum"]}
          onChange={(v) => setTweak("palette", v)} />
        <window.TweakSection label="Omega · atoms (§32)" />
        <window.TweakSlider label="Omega · mirror" value={t.cometReflect != null ? t.cometReflect : 100}
          min={0} max={200} step={5} unit="%"
          onChange={(v) => setTweak("cometReflect", v)} />
        <window.TweakSlider label="Cage filament" value={Math.round(cageEdge * 1000)}
          min={10} max={80} step={1} unit="‰"
          onChange={(v) => setCageParam(v / 1000)} />
        <window.TweakSlider label="Cage size" value={Math.round(cageSize * 100)}
          min={10} max={60} step={1}
          onChange={(v) => setCageSizeParam(v / 100)} />
        <window.TweakToggle label="Depth fade" value={cageFog}
          onChange={(v) => setCageFogParam(v)} />
        <window.TweakSlider label="Shine" value={shine}
          min={0} max={150} step={5} unit="%"
          onChange={(v) => setShine(v)} />
        <window.TweakSlider label="Inner lava" value={lavaAmt}
          min={0} max={250} step={5} unit="%"
          onChange={(v) => setLavaAmt(v)} />
        <window.TweakRadio label="Inner light" value={lightStyle}
          options={["angel", "lava"]}
          onChange={(v) => setLightStyle(v)} />
        <window.TweakSection label="Inspect (Phase 2)" />
        <window.TweakButton
          label="Inspect skill · pin"
          onClick={() => window.omegaIntents.emit({
            type: "inspect", target: "pin", origin: "user",
          })}
        />
        <window.TweakButton
          label="Inspect space · agenda"
          onClick={() => window.omegaIntents.emit({
            type: "inspect", target: "agenda", origin: "user",
          })}
        />
        <window.TweakButton
          label="Open agenda"
          onClick={() => window.omegaIntents.emit({
            type: "open-surface", surface: { kind: "agenda" }, origin: "user",
          })}
        />
        <window.TweakButton
          label="Open attention"
          onClick={() => window.omegaIntents.emit({
            type: "open-surface", surface: { kind: "attention" }, origin: "user",
          })}
        />
        <window.TweakButton
          label="Open timeline"
          onClick={() => window.omegaIntents.emit({
            type: "open-surface", surface: { kind: "timeline" }, origin: "user",
          })}
        />
        <window.TweakSection label="Memory · gather (Plan §12.1)" />
        <window.TweakButton label="Gather · beliefs"  onClick={() => focusSpace("beliefs")} />
        <window.TweakButton label="Gather · activity" onClick={() => focusSpace("activity")} />
        <window.TweakButton label="Gather · events"   onClick={() => focusSpace("events")} />
        <window.TweakButton label="Gather · persistent" onClick={() => focusSpace("persistent")} />
        <window.TweakButton label="Disperse → resting" onClick={() => focusSpace(null)} />
        <window.TweakSection label="Reasoning · the receipt (Plan §11)" />
        <window.TweakButton label="Reason · sample hop" onClick={() => {
          markActivity();
          window.omegaIntents.emit({ type: "reason", origin: "user" });
        }} />
        <window.TweakSection label="Summon · it comes to you (#4)" />
        <window.TweakButton label="Summon · atom (pin)" onClick={() => {
          markActivity();
          window.omegaIntents.emit({ type: "summon", target: "pin", origin: "user" });
        }} />
        <window.TweakButton label="Summon · space (beliefs)" onClick={() => {
          markActivity();
          window.omegaIntents.emit({ type: "summon", target: "beliefs", origin: "user" });
        }} />
      </window.TweaksPanel>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
