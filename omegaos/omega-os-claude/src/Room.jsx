/* Room.jsx — the chamber.
   Accepts core, hint, ridge slots plus inline styles for the core/hint
   slot positions (driven by spring physics in App). The `awake` flag
   fades the hint and toggles the .awake class which CSS uses to enable
   the core's outer aura. */

const Room = function Room({
  core, hint, ridge, windows, awake, hasWindows, onRoomClick,
  coreSlotStyle, hintSlotStyle, renderer,
}) {
  /* When the WebGL renderer is showing, we DO NOT mount the CSS
     chamber's surface SVGs (1700 atoms × 5 surfaces × ~57 Hz bloom-
     style writes per atom). They were ~14k inline-style mutations
     per second on content nobody could see. Now they don't mount
     at all when webgl is in charge — pure performance reclaim. */
  const showCssChamber = renderer === "css";
  return (
    <div
      className={`room ${awake ? "awake" : ""} ${hasWindows ? "has-windows" : ""}`}
      onClick={onRoomClick}
    >
      {showCssChamber && (
        <>
          <div className="surface surface-ceiling" aria-hidden="true">
            <window.Anatomy surface="ceiling" />
          </div>
          <div className="surface surface-floor"   aria-hidden="true">
            <window.Anatomy surface="floor" />
          </div>
          <div className="surface surface-left"    aria-hidden="true">
            <window.Anatomy surface="left" />
          </div>
          <div className="surface surface-right"   aria-hidden="true">
            <window.Anatomy surface="right" />
          </div>
          <div className="surface surface-back"    aria-hidden="true">
            <window.Anatomy surface="back" />
          </div>

          <div className="room-vignette" aria-hidden="true"></div>
        </>
      )}

      <div className="stage">
        <div className="core-slot" style={coreSlotStyle}>{core}</div>
        <div className={`hint-slot ${awake ? "hint-slot-out" : ""}`}
          style={hintSlotStyle}>
          {hint}
        </div>
        {ridge}
      </div>
      {/* OmegaWindows live above the stage layer */}
      {windows && (
        <div className="omega-windows" aria-label="Open windows">
          {windows}
        </div>
      )}
      {/* Viewport-space dispatch-dart overlay — only meaningful in the
          CSS reference renderer; suppressed otherwise so it can't
          fire beams toward a hidden .core element at viewport (0,0). */}
      {showCssChamber && (
        <div className="core-beams-host" data-renderer-only="css">
          <window.CoreBeams />
        </div>
      )}
    </div>
  );
};

window.Room = Room;
