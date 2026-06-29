/* InputRidge.jsx — the screen.
   A slim 3D slab anchored to the bottom of the room. The slab grows
   in height with each line of text up to a 3-line cap; past that,
   the textarea scrolls internally and a pair of neumorphic scroll
   buttons grow out of the slab's top and bottom edges. */

const { useState, useEffect, useRef } = React;

const MAX_LINES = 3;

const InputRidge = function InputRidge({ open, value, onChange, onSubmit, centered }) {
  const ref = useRef(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  // Cached line-height of the textarea, read from computed style so
  // the cap math works at any viewport size (font-size is clamped).
  const lineHeightRef = useRef(33);

  /* 0 = sunk, 1 = fully revealed. One stable spring (no opts swap
     by direction) so changing `open` doesn't re-init the physics
     and cause a visible reset/flicker. */
  const reveal = window.useSpring(open ? 1 : 0, {
    stiffness: 120,
    damping:   14,
  });
  // Clamp tightly so overshoot doesn't render negative opacity or
  // shift the glow past its sunk position.
  const r = Math.max(0, Math.min(1, reveal));
  const clipPct = (1 - r) * 100;

  /* Read & cache the textarea's computed line-height once it mounts.
     Re-reads on resize so the cap stays accurate across viewports. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const readLH = () => {
      const lh = parseFloat(window.getComputedStyle(el).lineHeight);
      if (Number.isFinite(lh) && lh > 0) lineHeightRef.current = lh;
    };
    readLH();
    window.addEventListener("resize", readLH);
    return () => window.removeEventListener("resize", readLH);
  }, []);

  /* Resize textarea to fit content, capped at MAX_LINES. Whether the
     content overflows the cap drives the scroll-button reveal. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const cap = lineHeightRef.current * MAX_LINES;
    const desired = el.scrollHeight;
    el.style.height = Math.min(desired, cap) + "px";
    setHasOverflow(desired > cap + 1);
  }, [value]);

  /* Focus when fully arrived; blur when sinking. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      const id = setTimeout(() => el.focus(), 520);
      return () => clearTimeout(id);
    }
    el.blur();
  }, [open]);

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
  };

  const scrollBy = (deltaLines) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ top: deltaLines * lineHeightRef.current, behavior: "smooth" });
  };

  const showButtons = hasOverflow && open;

  return (
    <div
      className={`ridge-stack ${centered ? "centered" : ""}`}
      style={{ pointerEvents: open ? "auto" : "none" }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Edge glow — lives outside the ridge's clip-path so it can be
          its own animated element. Drives off the same `reveal` spring
          as the slab so the glow follows the ridge rising and sinking,
          and shares the core's hue-cycle so they always match.
          Skipped entirely when fully sunk so no stray pixels linger. */}
      {r > 0.001 && (
        <div
          className="ridge-glow"
          style={{
            opacity: r,
            transform: `translateY(${(1 - r) * 100}%)`,
          }}
          aria-hidden="true"
        ></div>
      )}

      <div
        className="ridge"
        style={{
          /* Materialise from the void: scale up from a small blurred
             blob, de-focus and round into the slab as `reveal`
             overshoots (liquid). */
          transform: `scale(${0.5 + 0.5 * r})`,
          transformOrigin: "center",
          opacity: r,
          filter: `blur(${(1 - r) * 13}px)`,
          borderRadius: `${12 + (1 - r) * 46}px`,
        }}
      >
        <div className="ridge-top-edge" aria-hidden="true"></div>
        <textarea
          ref={ref}
          className="ridge-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
          spellCheck={false}
          aria-label="Speak"
        />
        <button
          type="button"
          className={`ridge-scroll ridge-scroll-up ${showButtons ? "visible" : ""}`}
          onClick={() => scrollBy(-1)}
          aria-label="Scroll up"
          tabIndex={showButtons ? 0 : -1}
        >
          <span aria-hidden="true">▲</span>
        </button>
        <button
          type="button"
          className={`ridge-scroll ridge-scroll-down ${showButtons ? "visible" : ""}`}
          onClick={() => scrollBy(1)}
          aria-label="Scroll down"
          tabIndex={showButtons ? 0 : -1}
        >
          <span aria-hidden="true">▼</span>
        </button>
      </div>
    </div>
  );
};

window.InputRidge = InputRidge;
