/* Taskbar.jsx — the left-edge dock of BACKGROUNDED panes/windows.

   Minimizing a pane (the conversation, a surface) or a standalone window
   parks it here as a card instead of closing it. Click a card to restore
   it to focus. Each card wears its content's atom hue (--awin-hue). App
   builds the `items` (each {key, label, hue, onClick}) since panes live in
   the chat's message state, not the window bus. */

(function () {
  function OmegaTaskbar({ items }) {
    if (!items || !items.length) return null;
    return (
      <div className="omega-taskbar" aria-label="backgrounded panes">
        {items.map((it) => (
          <button
            type="button"
            key={it.key}
            className="taskbar-card"
            style={{ "--awin-hue": it.hue != null ? it.hue : 250 }}
            onClick={(e) => { e.stopPropagation(); it.onClick(); }}
            title={"restore " + it.label}
          >
            <span className="taskbar-dot" aria-hidden="true"></span>
            <span className="taskbar-label">{it.label}</span>
          </button>
        ))}
      </div>
    );
  }
  window.OmegaTaskbar = OmegaTaskbar;
})();
