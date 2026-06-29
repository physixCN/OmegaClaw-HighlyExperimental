/* OmegaSurface.jsx — ONE adaptive surface host (Evolution Plan 0.2).

   Replaces the coloured placeholders with real, working hosts. A
   single component renders whatever KIND Omega (or the user) asks for
   — image, video, audio, browser, terminal, document, map, folder —
   and an unknown kind falls back to a sane generic surface instead of
   a crash ("Omega can open whatever she's opening").

   Design rule (per the user): ADAPTIVE SINGLE SURFACE first — each
   host fills its surface and is useful on its own; the existing
   drag-out-to-split / drag-in-to-merge stays the optional layer on
   top. Hosts are functional even with an EMPTY payload (drop an image,
   type a URL, type at the prompt) so the abilities are real, not mock.

   window.OmegaSurface.resolve(kind, payload) → { content, w, h }
   so resolveOmegaSurface in App.jsx can delegate to it. */

(function () {
  const { useState, useRef, useEffect, useCallback } = React;

  /* ── shared bits ─────────────────────────────────────────── */
  const Drop = function Drop({ accept, onFile, hint, icon }) {
    const [over, setOver] = useState(false);
    const inputRef = useRef(null);
    const take = (f) => { if (f) onFile(f); };
    return (
      <label
        className={`osurf-drop ${over ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          data-no-drag
          onChange={(e) => take(e.target.files[0])}
        />
        <span className="osurf-drop-icon" aria-hidden="true">{icon}</span>
        <span className="osurf-drop-hint">{hint}</span>
        <span className="osurf-drop-sub">drop a file · or click to browse</span>
      </label>
    );
  };

  /* ── IMAGE ───────────────────────────────────────────────── */
  function ImageHost({ payload }) {
    const [src, setSrc] = useState((payload && payload.src) || null);
    if (!src) return (
      <Drop accept="image/*" icon="⬡" hint="image surface"
            onFile={(f) => setSrc(URL.createObjectURL(f))} />
    );
    return <div className="osurf-img" data-no-drag><img src={src} alt={(payload && payload.alt) || "image"} /></div>;
  }

  /* ── VIDEO ───────────────────────────────────────────────── */
  function VideoHost({ payload }) {
    const [src, setSrc] = useState((payload && payload.src) || null);
    if (!src) return (
      <Drop accept="video/*" icon="▷" hint="video surface"
            onFile={(f) => setSrc(URL.createObjectURL(f))} />
    );
    return <div className="osurf-video" data-no-drag><video src={src} controls autoPlay loop playsInline /></div>;
  }

  /* ── AUDIO (custom transport) ────────────────────────────── */
  function AudioHost({ payload }) {
    const [src, setSrc] = useState((payload && payload.src) || null);
    const [playing, setPlaying] = useState(false);
    const [t, setT] = useState(0);
    const [dur, setDur] = useState(0);
    const aRef = useRef(null);
    const fmt = (s) => isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00";
    const toggle = () => {
      const a = aRef.current; if (!a) return;
      if (a.paused) { a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); }
    };
    if (!src) return (
      <Drop accept="audio/*" icon="♫" hint="audio surface"
            onFile={(f) => setSrc(URL.createObjectURL(f))} />
    );
    const bars = Array.from({ length: 40 }, (_, i) => i);
    const prog = dur ? t / dur : 0;
    return (
      <div className="osurf-audio" data-no-drag>
        <audio
          ref={aRef} src={src}
          onTimeUpdate={(e) => setT(e.target.currentTime)}
          onLoadedMetadata={(e) => setDur(e.target.duration)}
          onEnded={() => setPlaying(false)}
        />
        <div className="osurf-wave" onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const a = aRef.current; if (a && dur) a.currentTime = ((e.clientX - r.left) / r.width) * dur;
        }}>
          {bars.map((i) => {
            const h = 18 + Math.abs(Math.sin(i * 1.3) * Math.cos(i * 0.7)) * 64;
            const on = i / bars.length <= prog;
            return <span key={i} className={`osurf-wave-bar ${on ? "on" : ""}`} style={{ height: `${h}%` }} />;
          })}
        </div>
        <div className="osurf-audio-ctl">
          <button type="button" className="osurf-play" onClick={toggle}>{playing ? "❚❚" : "▶"}</button>
          <span className="osurf-time">{fmt(t)} / {fmt(dur)}</span>
        </div>
      </div>
    );
  }

  /* ── BROWSER (URL bar + iframe) ──────────────────────────── */
  function BrowserHost({ payload }) {
    const start = (payload && payload.url) || "";
    const [url, setUrl] = useState(start);
    const [src, setSrc] = useState(start);
    const go = (raw) => {
      let u = (raw || "").trim();
      if (!u) return;
      if (!/^https?:\/\//i.test(u)) u = "https://" + u;
      setUrl(u); setSrc(u);
    };
    return (
      <div className="osurf-browser" data-no-drag>
        <form className="osurf-urlbar" onSubmit={(e) => { e.preventDefault(); go(url); }}>
          <span className="osurf-url-lock">⌖</span>
          <input
            value={url} placeholder="enter a URL…"
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false} autoCapitalize="off"
          />
          <button type="submit" className="osurf-url-go">→</button>
        </form>
        {src
          ? <iframe className="osurf-frame" src={src} title="browser" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" />
          : <div className="osurf-browser-empty"><span aria-hidden="true">◍</span><p>type a URL to open a page</p><small>some sites block embedding</small></div>}
      </div>
    );
  }

  /* ── YOUTUBE / map: trusted embeds ───────────────────────── */
  function YouTubeHost({ payload }) {
    const id = payload && (payload.videoId || payload.id);
    if (!id) return <BrowserHost payload={{ url: "https://www.youtube.com" }} />;
    return <div className="osurf-video" data-no-drag>
      <iframe className="osurf-frame" src={`https://www.youtube.com/embed/${id}`} title="youtube" allow="autoplay; encrypted-media" allowFullScreen />
    </div>;
  }
  function MapHost({ payload }) {
    const q = (payload && payload.query) || "world";
    const bbox = (payload && payload.bbox) || "-12,35,30,60";
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik`;
    return <div className="osurf-map" data-no-drag><iframe className="osurf-frame" src={src} title={`map ${q}`} /></div>;
  }

  /* ── DOCUMENT (markdown-lite) ────────────────────────────── */
  function DocHost({ payload }) {
    const text = (payload && (payload.text || payload.body)) ||
      "# Document\n\nThis surface renders text & lightweight Markdown.\n\nOmega can drop a note, a recalled memory, or a generated draft here — **bold**, *italic*, and `code` all render.\n\n- a list item\n- another one\n\n> A quoted line.";
    const html = mdLite(text);
    return <div className="osurf-doc" data-no-drag dangerouslySetInnerHTML={{ __html: html }} />;
  }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function mdLite(src) {
    const lines = esc(src).split("\n");
    let out = "", inList = false, inQuote = false;
    const inline = (s) => s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
    const closeList = () => { if (inList) { out += "</ul>"; inList = false; } };
    const closeQuote = () => { if (inQuote) { out += "</blockquote>"; inQuote = false; } };
    for (const ln of lines) {
      if (/^#{1,3}\s/.test(ln)) { closeList(); closeQuote(); const lvl = ln.match(/^#+/)[0].length; out += `<h${lvl}>${inline(ln.replace(/^#+\s/, ""))}</h${lvl}>`; }
      else if (/^[-*]\s/.test(ln)) { closeQuote(); if (!inList) { out += "<ul>"; inList = true; } out += `<li>${inline(ln.replace(/^[-*]\s/, ""))}</li>`; }
      else if (/^>\s?/.test(ln)) { closeList(); if (!inQuote) { out += "<blockquote>"; inQuote = true; } out += inline(ln.replace(/^>\s?/, "")) + "<br>"; }
      else if (ln.trim() === "") { closeList(); closeQuote(); }
      else { closeList(); closeQuote(); out += `<p>${inline(ln)}</p>`; }
    }
    closeList(); closeQuote();
    return out;
  }

  /* ── TERMINAL (functional faux shell) ────────────────────── */
  function TerminalHost({ payload }) {
    const [lines, setLines] = useState(() => [
      { k: "sys", t: "omega-os terminal · type `help`" },
    ]);
    const [val, setVal] = useState("");
    const scrollRef = useRef(null);
    useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [lines]);
    const run = (raw) => {
      const cmd = raw.trim();
      const echo = { k: "cmd", t: cmd };
      let res = null;
      const [c, ...rest] = cmd.split(/\s+/);
      const arg = rest.join(" ");
      switch (c) {
        case "": break;
        case "help": res = { k: "out", t: "commands: help · whoami · date · echo <text> · ls · pwd · clear" }; break;
        case "whoami": res = { k: "out", t: "ω — omega (membrane surface). cognition lives in the loop." }; break;
        case "date": res = { k: "out", t: new Date().toString() }; break;
        case "echo": res = { k: "out", t: arg }; break;
        case "pwd": res = { k: "out", t: "/omega/&activity" }; break;
        case "ls": res = { k: "out", t: "&persistent  &agenda  &beliefs  &world  &events  &activity" }; break;
        case "clear": setLines([]); setVal(""); return;
        default: res = { k: "err", t: `${c}: not a known surface command` };
      }
      setLines((ls) => res ? [...ls, echo, res] : [...ls, echo]);
      setVal("");
    };
    return (
      <div className="osurf-term" data-no-drag onClick={() => { const i = scrollRef.current && scrollRef.current.parentElement.querySelector("input"); i && i.focus(); }}>
        <div className="osurf-term-scroll" ref={scrollRef}>
          {lines.map((l, i) => (
            <div key={i} className={`osurf-term-ln k-${l.k}`}>
              {l.k === "cmd" ? <span className="osurf-term-pr">ω&nbsp;❯</span> : null}{l.t}
            </div>
          ))}
        </div>
        <form className="osurf-term-input" onSubmit={(e) => { e.preventDefault(); run(val); }}>
          <span className="osurf-term-pr">ω&nbsp;❯</span>
          <input value={val} onChange={(e) => setVal(e.target.value)} autoFocus spellCheck={false} autoCapitalize="off" />
        </form>
      </div>
    );
  }

  /* ── FOLDER ──────────────────────────────────────────────── */
  function FolderHost({ payload }) {
    const items = (payload && payload.items) || [
      { name: "agenda.metta", kind: "doc" }, { name: "beliefs.metta", kind: "doc" },
      { name: "snapshot.json", kind: "doc" }, { name: "render.png", kind: "image" },
      { name: "loop.log", kind: "doc" }, { name: "voice.wav", kind: "audio" },
    ];
    const glyph = (k) => k === "image" ? "⬡" : k === "audio" ? "♫" : k === "video" ? "▷" : "▤";
    return (
      <div className="osurf-folder" data-no-drag>
        {items.map((it, i) => (
          <button type="button" key={i} className="osurf-file" title={it.name}>
            <span className="osurf-file-ico" aria-hidden="true">{glyph(it.kind)}</span>
            <span className="osurf-file-name">{it.name}</span>
          </button>
        ))}
      </div>
    );
  }

  /* ── GENERIC fallback (unknown kind) ─────────────────────── */
  function GenericHost({ kind, payload }) {
    const body = payload && Object.keys(payload).length
      ? JSON.stringify(payload, null, 2) : null;
    return (
      <div className="osurf-generic" data-no-drag>
        <div className="osurf-generic-badge">surface</div>
        <div className="osurf-generic-kind">{kind || "surface"}</div>
        <p className="osurf-generic-note">A general surface for <b>{kind || "?"}</b>. A dedicated host renders here when one exists.</p>
        {body ? <pre className="osurf-generic-payload">{body}</pre> : null}
      </div>
    );
  }

  /* ── host registry + sizes ───────────────────────────────── */
  const HOSTS = {
    image: ImageHost, video: VideoHost, audio: AudioHost, song: AudioHost,
    youtube: YouTubeHost, browser: BrowserHost, web: BrowserHost,
    document: DocHost, doc: DocHost, note: DocHost,
    terminal: TerminalHost, shell: TerminalHost,
    folder: FolderHost, files: FolderHost, map: MapHost,
  };
  const SIZES = {
    image: [340, 280], video: [420, 280], audio: [360, 200], song: [360, 200],
    youtube: [440, 300], browser: [480, 380], web: [480, 380],
    document: [380, 420], doc: [380, 420], note: [360, 360],
    terminal: [460, 320], shell: [460, 320], folder: [380, 300],
    files: [380, 300], map: [440, 320], lorem: [320, 240], diagram: [340, 280],
  };

  function OmegaSurface({ kind, payload, title }) {
    const Host = HOSTS[kind];
    const inner = Host ? <Host payload={payload} kind={kind} /> : <GenericHost kind={kind} payload={payload} />;
    /* Provenance footer — names the atom this surface opened FROM, the
       same way the inspector card footers its source. Ties the surface to
       its cause and reads as the same family of card. */
    const sa = window.omegaSurfaceAtoms;
    const atom = sa && sa.causingAtomFor ? sa.causingAtomFor(kind) : null;
    const foot = (atom && atom[0] !== "&") ? "from · " + atom : "surface · " + (kind || "?");
    const name = (title && title !== kind) ? title : null;
    /* Self-hue to the causing atom's ACTUAL colour, set on our own root, so
       the card reads atom-hued in EVERY context — a morph window, inline in
       the chat stage, or a plain open. Without this, any surface NOT inside a
       .morph-atom window (e.g. shown inline mid-conversation, or after the
       morph chrome is gone) loses --awin-hue and falls back to the old blue —
       which reads as "it morphs back to the old styling once open". */
    let hue = null;
    const sh = window.omegaR3D && window.omegaR3D.__sceneHandle;
    if (sh && sh.screenPosOf && atom && atom[0] !== "&") {
      const sp = sh.screenPosOf(atom);
      if (sp && typeof sp.hue === "number") hue = sp.hue;
    }
    const rootStyle = hue != null ? { "--awin-hue": hue } : undefined;
    return (
      <div className={`osurf osurf-${kind || "generic"}`} style={rootStyle}>
        <div className="osurf-head">
          <span className="osurf-kind">{kind || "surface"}</span>
          {name ? <span className="osurf-title">{name}</span> : null}
        </div>
        <div className="osurf-body">{inner}</div>
        <div className="osurf-foot">{foot}</div>
      </div>
    );
  }

  /* resolve(kind, payload, title) → { content, w, h } for resolveOmegaSurface */
  OmegaSurface.resolve = function resolve(kind, payload, title) {
    const [w, h] = SIZES[kind] || [360, 280];
    return { content: <OmegaSurface kind={kind} payload={payload} title={title} />, w, h };
  };

  window.OmegaSurface = OmegaSurface;
})();
