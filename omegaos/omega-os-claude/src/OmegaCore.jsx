/* OmegaCore.jsx — the persistent sphere.
   No longer holds the chat — OmegaWindows do. The core stays as a
   pure sphere at all times; windows spawn from its position via the
   OmegaWindow primitive's morph. */

const OmegaCore = function OmegaCore({ coreStyle, sphereStyle }) {
  return (
    <div className="core-float">
      <div className="core" style={coreStyle} role="img" aria-label="Omega">
        <div className="core-aura" aria-hidden="true"></div>
        <div className="core-sphere" style={sphereStyle}>
          <div className="core-glow" aria-hidden="true"></div>
          <div className="core-spec" aria-hidden="true"></div>
          <div className="core-omega" aria-hidden="true">Ω</div>
        </div>
      </div>
    </div>
  );
};

window.OmegaCore = OmegaCore;
