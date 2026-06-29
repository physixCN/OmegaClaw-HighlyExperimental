/* ChatWindow.jsx — the primary conversation panel.

   Messages are plain text OR rich content ({content:{kind,title?,
   payload?}}). Content composes INLINE in this one panel — media kinds
   as compact tiles (with a play affordance for video), everything else
   (agenda/attention/timeline/inspect/doc/…) as a framed "panel card"
   rendered through the SAME resolveOmegaSurface surfaces use. Any inline
   card is draggable out to SPLIT into its own surface; the surface can be
   dragged back onto the chat to MERGE inline again. No separation of
   "what" unless someone splits it. */

const { useEffect, useRef } = React;

const MEDIA_KINDS = ["image", "photo", "picture", "video", "youtube", "song", "audio"];

function etchTier(text) {
  const len = (text || "").length;
  if (len < 60)  return "msg-short";
  if (len < 200) return "msg-medium";
  return "msg-long";
}

function Message({ msg }) {
  const isOmega = msg.role === "omega";
  const role  = isOmega ? "msg-omega" : "msg-user";
  const label = isOmega ? "Omega" : "you";
  return (
    <div className={`msg ${role} ${etchTier(msg.text)}`}>
      <span className="msg-label">{label}</span>
      <span className="msg-body">{msg.text}</span>
      {isOmega && <span className="msg-mark" aria-hidden="true">Ω</span>}
    </div>
  );
}

/* Drag helper — starts a split-drag from `handleEl`, translating
   `cardEl`; past the threshold on release it emits detach-media. */
function useSplitDrag(cardRef, index, content) {
  return (e) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    const onMove = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      const far = Math.hypot(dx, dy);
      if (cardRef.current) {
        cardRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
        cardRef.current.style.opacity = far > 50 ? "0.55" : "1";
        cardRef.current.classList.toggle("splitting", far > 50);
      }
    };
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const far = Math.hypot(ev.clientX - x0, ev.clientY - y0);
      if (cardRef.current) {
        cardRef.current.style.transform = "";
        cardRef.current.style.opacity = "";
        cardRef.current.classList.remove("splitting");
      }
      if (far > 50 && window.omegaIntents) {
        window.omegaIntents.emit({
          type: "detach-media", index, content,
          x: ev.clientX, y: ev.clientY, origin: "user",
        });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
}

function SurfaceCard({ msg, index }) {
  const isOmega = msg.role === "omega";
  const role  = isOmega ? "msg-omega" : "msg-user";
  const label = isOmega ? "Omega" : "you";
  const kind  = msg.content.kind;
  const isMedia = MEDIA_KINDS.includes(kind);
  const cardRef = useRef(null);
  const startSplit = useSplitDrag(cardRef, index, msg.content);

  if (msg.detached) {
    return (
      <div className={`msg ${role} msg-detached`}>
        <span className="msg-label">{label}</span>
        <span className="msg-detached-chip">↗ {msg.content.title || kind} — in its own surface; drag it back to merge</span>
        {isOmega && <span className="msg-mark" aria-hidden="true">Ω</span>}
      </div>
    );
  }

  const resolved = window.resolveOmegaSurface
    ? window.resolveOmegaSurface(kind, msg.content.payload)
    : { content: kind };

  if (isMedia) {
    return (
      <div className={`msg ${role} msg-media`}>
        <span className="msg-label">{label}</span>
        {msg.text ? <span className="msg-body">{msg.text}</span> : null}
        <div className="msg-image" ref={cardRef} onMouseDown={startSplit}
          title="drag out to split into its own surface">
          <div className="media-inner">{resolved.content}</div>
          {(kind === "video" || kind === "youtube") && (
            <span className="media-play" aria-hidden="true">▶</span>
          )}
          <span className="msg-grab" aria-hidden="true">⠿</span>
        </div>
        {isOmega && <span className="msg-mark" aria-hidden="true">Ω</span>}
      </div>
    );
  }

  return (
    <div className={`msg ${role} msg-panel`}>
      <span className="msg-label">{label}</span>
      {msg.text ? <span className="msg-body">{msg.text}</span> : null}
      <div className="panel-card" ref={cardRef}>
        <div className="panel-card-head" onMouseDown={startSplit}
          title="drag out to split into its own surface">
          <span className="panel-card-kind">{msg.content.title || kind}</span>
          <span className="msg-grab" aria-hidden="true">⠿</span>
        </div>
        <div className="panel-card-body">{resolved.content}</div>
      </div>
      {isOmega && <span className="msg-mark" aria-hidden="true">Ω</span>}
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="msg msg-omega msg-short msg-thinking" aria-label="Omega is thinking">
      <span className="msg-label">Omega</span>
      <span className="msg-body">
        <span className="dot"></span>
        <span className="dot"></span>
        <span className="dot"></span>
      </span>
      <span className="msg-mark" aria-hidden="true">Ω</span>
    </div>
  );
}

/* WorkspaceSurface — a "thing" Omega is showing, rendered in the
   RIGHT stage of the single workspace surface (not inline in the
   conversation, not a separate window). Multiple stack here and the
   stage scrolls independently of the chat. */
function WorkspaceSurface({ msg, index, onClose, onMinimize }) {
  const kind = msg.content.kind;
  const resolved = window.resolveOmegaSurface
    ? window.resolveOmegaSurface(kind, msg.content.payload, msg.content.title)
    : { content: kind };
  return (
    <div className="ws-surface">
      <div className="ws-surface-head">
        <span className="ws-surface-kind">{msg.content.title || kind}</span>
        <span className="ws-surface-ctl">
          <span className="ws-surface-by" aria-hidden="true">{msg.role === "omega" ? "Ω" : "you"}</span>
          {onMinimize ? (
            <button type="button" className="ws-surface-min" data-no-drag
              title="minimize this surface" aria-label="Minimize surface"
              onClick={(e) => { e.stopPropagation(); onMinimize(index); }}>–</button>
          ) : null}
          {onClose ? (
            <button type="button" className="ws-surface-close" data-no-drag
              title="close this surface" aria-label="Close surface"
              onClick={(e) => { e.stopPropagation(); onClose(index); }}>×</button>
          ) : null}
        </span>
      </div>
      <div className="ws-surface-body">{resolved.content}</div>
    </div>
  );
}

const ChatWindow = function ChatWindow({ messages, omegaThinking, onSend, value, onChange, convoClosed, convoMin, clearNonce, onCloseSurface, onMinimizeSurface, onCloseConversation, onMinimizeConversation }) {
  const scrollRef = useRef(null);
  const taRef = useRef(null);
  /* Composer holds its OWN draft state (seeded once from `value` — the
     keystroke buffered before the window mounted). Typing stays LOCAL to
     this component, so it does NOT re-render App / the window bus / the
     ws-stage surfaces on every keystroke (that was the input lag). The app
     reads the draft only on send. */
  const [draft, setDraft] = React.useState(value != null ? value : "");
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, omegaThinking]);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 100) + "px";
  }, [draft]);
  /* Mount focus — when the chat first appears (summoned by a click OR a
     keystroke), grab the composer so typing lands immediately, no matter
     WHEN the window mounts (it may be delayed by the receive-atom pull-in).
     Any character already buffered in the controlled `value` shows here. */
  useEffect(() => { taRef.current && taRef.current.focus(); }, []);
  /* Clear the local draft on send (clearNonce bumps each send). Skip the
     initial run so the seeded buffer (the keystroke that summoned the chat)
     isn't wiped on mount. */
  const firstClear = useRef(true);
  useEffect(() => {
    if (firstClear.current) { firstClear.current = false; return; }
    setDraft("");
  }, [clearNonce]);
  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    if (onSend) onSend(v);
    setDraft("");   /* clear our own draft (app clears its send buffer too) */
  };
  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  /* Split the conversation from the "things being shown". Text stays
     in the LEFT conversation; every content message's surface renders
     in the RIGHT stage — ONE surface, two independently-scrolling
     panes. */
  const surfaces = [];
  messages.forEach((m, i) => { if (m.content && !m.detached && !m.minimized) surfaces.push({ m, i }); });
  const hasStage = surfaces.length > 0;
  const convoHidden = convoClosed || convoMin;

  const hasMsgs = messages.length > 0;

  return (
    <div className={`chat-workspace ${hasStage ? "has-stage" : ""} ${(hasMsgs && !convoHidden) ? "" : "compact"} ${convoHidden ? "convo-closed" : ""}`}>
      {!convoHidden && (
      <div className="chat-panel">
        {hasMsgs && (
        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-stack">
            {messages.map((m, i) => {
              if (m.content && !m.detached) {
                const isO = m.role === "omega";
                return m.text
                  ? <Message key={i} msg={m} />
                  : (
                    <div key={i} className={`msg ${isO ? "msg-omega" : "msg-user"} msg-short msg-ref`}>
                      <span className="msg-label">{isO ? "Omega" : "you"}</span>
                      <span className="msg-ref-chip">↗ opened {m.content.title || m.content.kind}</span>
                      {isO && <span className="msg-mark" aria-hidden="true">Ω</span>}
                    </div>
                  );
              }
              return <Message key={i} msg={m} />;
            })}
            {omegaThinking && <ThinkingDots />}
          </div>
        </div>
        )}
        {hasMsgs && (onCloseConversation || onMinimizeConversation) ? (
          <span className="chat-convo-ctl">
            {onMinimizeConversation ? (
              <button type="button" className="chat-convo-min" data-no-drag
                title="minimize the conversation" aria-label="Minimize conversation"
                onClick={(e) => { e.stopPropagation(); onMinimizeConversation(); }}>–</button>
            ) : null}
            {onCloseConversation ? (
              <button type="button" className="chat-convo-close" data-no-drag
                title="close the conversation" aria-label="Close conversation"
                onClick={(e) => { e.stopPropagation(); onCloseConversation(); }}>×</button>
            ) : null}
          </span>
        ) : null}
        <div className="chat-composer">
          <textarea
            ref={taRef}
            className="chat-composer-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder="message Omega…"
            spellCheck={false}
          ></textarea>
        </div>
      </div>
      )}
      {hasStage && (
        <div className="ws-stage">
          {surfaces.map(({ m, i }) => <WorkspaceSurface key={i} msg={m} index={i} onClose={onCloseSurface} onMinimize={onMinimizeSurface} />)}
        </div>
      )}
    </div>
  );
};

window.ChatWindow = ChatWindow;
