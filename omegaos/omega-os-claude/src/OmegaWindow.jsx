/* OmegaWindow.jsx — the window primitive with reflow springs.

   Each window has its own springs on x/y/w/h that chase the bus's
   target values, so when openWindow or closeWindow triggers a
   reflow, the window glides to its new cell rather than jumping.
   The mount progress spring (0→1) still drives the sphere→panel
   spawn / merge animation. */

(function () {
  const { useState, useEffect, useRef } = React;

  const MERGE_THRESHOLD_PX = 90;
  const SPHERE_SIZE = 80;

  function OmegaWindow({
    win, coreCenter, onUpdate, onTogglePin, onMergeToCore, onClose, onMinimize,
  }) {
    const { id, kind, content, pinned, mounted, w: targetW, h: targetH } = win;
    const targetX = win.x ?? (coreCenter.x - (targetW || 360) / 2);
    const targetY = win.y ?? (coreCenter.y - (targetH || 320) / 2);

    /* Ready flag flips true after first render so useSpring's initial
       value (which always seeds to its target) doesn't skip the morph.
       Without this, on a freshly-opened window mounted is already true
       at first render → progress initialises to 1 → window pops in at
       full size with no visible morph. */
    const [ready, setReady] = React.useState(false);
    React.useEffect(() => { setReady(true); }, []);

    /* Atom→window edge-morph clock (0→1). When the window opens with
       win.morphIn, an rAF eases this while the clip-path expands the
       atom silhouette into the full rect AND dissolves the real 3D atom
       in lockstep, so the atom becomes the surface with no seam. */
    const [morphT, setMorphT] = React.useState(win.morphIn ? 0 : 1);
    React.useEffect(() => {
      if (!win.morphIn) return;
      /* Replace the real 3-D atom with the morph shape INSTANTLY (no
         dissolve, no double image): the shape's first frame is drawn at the
         atom's exact silhouette + hue + glow, so hiding the atom now reads
         as the atom itself becoming the shape — which then opens out. */
      const h = window.omegaR3D && window.omegaR3D.__sceneHandle;
      if (h && h.setSummonReveal) h.setSummonReveal(0);
      let raf, t0 = null;
      const DUR = 900;
      const step = (now) => {
        if (t0 == null) t0 = now;
        const e = Math.min(1, (now - t0) / DUR);
        setMorphT(e);
        if (e < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [!!win.morphIn]);

    /* Reverse morph on close: the card collapses back through the liquid
       blob into the atom's cage (morphT 1→0) while the real 3-D atom fades
       back IN near the end — so it reads as the surface shrinking back into
       the atom. App releases the atom + unmounts when this finishes. */
    React.useEffect(() => {
      if (!win.morphClosing) return;
      const h = window.omegaR3D && window.omegaR3D.__sceneHandle;
      let raf, t0 = null;
      const DUR = 560;
      const step = (now) => {
        if (t0 == null) t0 = now;
        const e = Math.min(1, (now - t0) / DUR);
        setMorphT(1 - e);   // reverse
        if (h && h.setSummonReveal) {
          /* atom reappears as the shape collapses back to cage size */
          const x = Math.max(0, Math.min(1, (e - 0.5) / 0.45));
          h.setSummonReveal(x * x * (3 - 2 * x));
        }
        if (e < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [win.morphClosing]);

    /* Mount progress — 0 at core, 1 at full window. Standardised to
       the same spring as position/size so all morphs (core→window,
       new image spawn, chat reflow) finish on the same cadence. */
    const progress = window.useSpring(ready && mounted ? 1 : 0, {
      stiffness: 84, damping: 12,
    });

    /* Position + size springs — same spring as progress so reflow
       lands in lockstep with the spawn morph. */
    const sX = window.useSpring(targetX, { stiffness: 80, damping: 16 });
    const sY = window.useSpring(targetY, { stiffness: 80, damping: 16 });
    const sW = window.useSpring(targetW || 360, { stiffness: 86, damping: 13 });
    const sH = window.useSpring(targetH || 320, { stiffness: 86, damping: 13 });

    /* Resolve "from" anchor for the morph. Most surfaces grow out of
       the comet CORE. The chat is special: it must FORM FROM SCREEN
       CENTER and span out to a small input (per the interaction
       spec), independent of wherever the comet happens to be. */
    const isChat = kind === "chat";
    /* A summoned atom hands the window a spawn point (the atom's screen
       position) + hue, so the surface GROWS OUT OF THE ATOM: its edges
       stretch to the window's corners, the canvas pulled taut between. */
    const spawn = win.spawnAt;
    /* morphIn: the atom→window EDGE MORPH done right — the real window
       (content and all) is present from frame one, clipped to a tiny
       atom-shaped silhouette, and the CLIP expands into the full rect. The
       content is revealed as the shape stretches, so the morph literally IS
       the surface opening — no separate overlay, no swap, no transition edge.
       {start:{cx,cy,r,hue}} = the atom's screen silhouette at hand-off. */
    const morphIn = win.morphIn || null;
    /* handoff: legacy — mount already-formed (kept as a fallback). */
    const handoff = !!win.morphHandoff;
    const tintAtom = !!spawn || !!morphIn;   // wear the atom-hue palette
    const fromAtom = !!spawn && !handoff && !morphIn;  // legacy grow-from-point
    const fullGeo = handoff || !!morphIn;    // box sits at target; only the clip animates
    const atomHue = (win.context && win.context.atomHue != null) ? win.context.atomHue
      : (morphIn && morphIn.hue != null ? morphIn.hue : 210);
    const anchorX = fromAtom ? spawn.x : (isChat ? window.innerWidth / 2 : coreCenter.x);
    const anchorY = fromAtom ? spawn.y : (isChat ? window.innerHeight / 2 : coreCenter.y);
    const fromX = anchorX - SPHERE_SIZE / 2;
    const fromY = anchorY - SPHERE_SIZE / 2;

    /* Linear blend: rendered = from + (springed - from) * progress.
       When mounted, progress=1 → rendered = spring (at target).
       When closing, progress=0 → rendered = core anchor. */
    const liveX = fullGeo ? sX : fromX + (sX - fromX) * progress;
    const liveY = fullGeo ? sY : fromY + (sY - fromY) * progress;
    const liveW = fullGeo ? sW : SPHERE_SIZE + (sW - SPHERE_SIZE) * progress;
    const liveH = fullGeo ? sH : SPHERE_SIZE + (sH - SPHERE_SIZE) * progress;
    /* Atom morph stays ANGULAR (the cage stretching into a frame), never a
       circle; otherwise the usual sphere→panel rounding. */
    const radius = fullGeo
      ? "14px"
      : fromAtom
        ? `${3 + 11 * progress}px`
        : `calc(${50 * (1 - progress)}% + ${14 * progress}px)`;
    const opacity = progress;
    /* Edge-stretch: the atom-hue border BURNS brightest mid-morph (edges
       pulling out to the corners), settling to a calm frame; the canvas
       (content) is pulled taut between them — fading in only once the
       frame is mostly formed. */
    const edge = Math.sin(Math.max(0, Math.min(1, progress)) * Math.PI);   // 0→1→0
    const canvasOpacity = fromAtom ? Math.max(0, Math.min(1, (progress - 0.42) / 0.5)) : 1;

    /* ── Edge morph: clip-path silhouette → full rect ──────────────
       Build a 16-point polygon (4 exact corners + 3 per edge) in the
       window's local box coords. Each point eases from the atom's
       silhouette ring (centred on the atom's local position) toward its
       rect-perimeter home, so the window opens AS the atom's outline
       stretching into the frame. content is live underneath the whole
       time; the clip just reveals it. */
    const morphing = !!morphIn && morphT < 1;
    let morphClip = null, morphGlow = 0, morphLight = 0, morphContent = 1;
    if (morphIn) {
      const W = sW, H = sH;
      const cage = morphIn.cage || null;
      /* Start CENTRE + outline: the atom's REAL projected cage hull when we
         have it (so the window opens from the atom's own edges), else a
         circular fallback at the atom's screen point. On CLOSE we re-place
         the cage at the atom's CURRENT screen position (morphCloseCenter)
         so the collapse ends exactly where the atom respawns. */
      const baseCx = (win.morphClosing && win.morphCloseCenter) ? win.morphCloseCenter.x
        : (cage ? cage.cx : morphIn.start.cx);
      const baseCy = (win.morphClosing && win.morphCloseCenter) ? win.morphCloseCenter.y
        : (cage ? cage.cy : morphIn.start.cy);
      const Ax = baseCx - sX;
      const Ay = baseCy - sY;
      const r = Math.max(7, morphIn.start.r || 18);
      /* cage hull is centroid-RELATIVE; place it at (Ax,Ay) + ray-sample. */
      const hullRel = cage ? cage.points : null;
      const cageR = (c, s) => {
        if (!hullRel) return r;
        let best = Infinity;
        for (let i = 0; i < hullRel.length; i++) {
          const a = hullRel[i], b = hullRel[(i + 1) % hullRel.length];
          const ax = Ax + a[0], ay = Ay + a[1];
          const ex = b[0] - a[0], ey = b[1] - a[1];
          const denom = c * ey - s * ex;
          if (Math.abs(denom) < 1e-9) continue;
          const ox = ax - Ax, oy = ay - Ay;
          const t = (ox * ey - oy * ex) / denom;
          const u = (ox * s - oy * c) / denom;
          if (t > 0 && u >= -0.001 && u <= 1.001 && t < best) best = t;
        }
        return isFinite(best) ? best : r;
      };
      const tm = Math.max(0, Math.min(1, morphT));
      /* smootherstep — no hard acceleration edges, reads as flowing. */
      const te = tm * tm * tm * (tm * (tm * 6 - 15) + 10);
      const RR = 14;                                  // settle corner radius (matches the window)
      const cxw = W / 2, cyw = H / 2;
      /* the blob's CENTRE flows from the atom's spot to the window centre */
      const ccx = Ax + (cxw - Ax) * te;
      const ccy = Ay + (cyw - Ay) * te;
      /* rounded-rect boundary distance from the window centre along an angle */
      const rectR = (c, s) => {
        const ax = Math.abs(c), ay = Math.abs(s);
        let t = Infinity;
        if (ax > 1e-9) t = Math.min(t, (W / 2) / ax);
        if (ay > 1e-9) t = Math.min(t, (H / 2) / ay);
        const ix = W / 2 - RR, iy = H / 2 - RR;
        const px = c * t, py = s * t;
        if (Math.abs(px) > ix && Math.abs(py) > iy) {   // corner arc
          const kx = (c >= 0 ? ix : -ix), ky = (s >= 0 ? iy : -iy);
          const b = -2 * (c * kx + s * ky);
          const cc = kx * kx + ky * ky - RR * RR;
          const disc = b * b - 4 * cc;
          if (disc >= 0) { const u = (-b + Math.sqrt(disc)) / 2; if (u > 0) t = u; }
        }
        return t;
      };
      /* surface tension: a SUBTLE ripple swells mid-morph, 0 at both ends
         so the start (atom) and the settle (rect) are both clean. Kept low
         so the expanding edge reads as smooth liquid, not a lumpy blob. */
      const ripple = 0.032 * Math.sin(tm * Math.PI);
      const NS = 56;
      const ROT = -Math.PI / 2;
      const pts = [];
      for (let k = 0; k < NS; k++) {
        const th = ROT + (k / NS) * Math.PI * 2;
        const c = Math.cos(th), s = Math.sin(th);
        /* radius lerps the REAL cage silhouette → rounded rect. */
        const Rstart = cageR(c, s);
        const Rrect = rectR(c, s);
        let R = Rstart * (1 - te) + Rrect * te;
        R *= 1 + ripple * Math.sin(th * 2.5 - tm * 6.2);         // liquid surface motion mid
        pts.push([(ccx + c * R).toFixed(1), (ccy + s * R).toFixed(1)]);
      }
      morphClip = "polygon(" + pts.map((p) => `${p[0]}px ${p[1]}px`).join(", ") + ")";
      /* Edge light: blazes like the atom's halo at the start, settles calm. */
      morphGlow = 10 + 13 * Math.sin(tm * Math.PI) + 9 * (1 - tm);
      /* The atom's LIGHT fills the shape at t0 and resolves away by ~55%. */
      morphLight = Math.max(0, 1 - tm / 0.55);
      /* Content emerges as the light clears and keeps showing as it opens. */
      const cprog = Math.max(0, Math.min(1, (tm - 0.2) / 0.42));
      morphContent = cprog * cprog * (3 - 2 * cprog);
    }

    const ref = useRef(null);

    // ── Drag ─────────────────────────────────────────────────────
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef(null);
    const startDrag = (e) => {
      if (e.target.closest('[data-no-drag]')) return;
      e.preventDefault();
      const r = ref.current.getBoundingClientRect();
      dragRef.current = { offX: e.clientX - r.left, offY: e.clientY - r.top };
      setDragging(true);
    };
    useEffect(() => {
      if (!dragging) return;
      const onMove = (e) => {
        const nx = e.clientX - dragRef.current.offX;
        const ny = e.clientY - dragRef.current.offY;
        onUpdate(id, { x: nx, y: ny });
      };
      const onUp = () => {
        setDragging(false);
        const r = ref.current?.getBoundingClientRect();
        if (r) {
          const wx = r.left + r.width / 2;
          const wy = r.top + r.height / 2;
          /* Drag a content surface onto the chat → MERGE it back inline. */
          const MERGEABLE = ["image", "video", "youtube", "song", "audio",
            "document", "browser", "folder", "lorem", "diagram", "map"];
          if (MERGEABLE.includes(kind)) {
            const chat = document.querySelector(".omega-window.kind-chat");
            if (chat) {
              const cb = chat.getBoundingClientRect();
              if (wx > cb.left && wx < cb.right && wy > cb.top && wy < cb.bottom) {
                window.omegaIntents && window.omegaIntents.emit({
                  type: "merge-into-chat", surfaceId: id, kind, origin: "user",
                });
                return;
              }
            }
          }
          const d = Math.hypot(wx - coreCenter.x, wy - coreCenter.y);
          if (d < MERGE_THRESHOLD_PX) onMergeToCore(id);
        }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    }, [dragging, id, coreCenter.x, coreCenter.y, onUpdate, onMergeToCore]);

    // ── Resize ───────────────────────────────────────────────────
    const [resizing, setResizing] = useState(false);
    const resizeRef = useRef(null);
    const startResize = (e) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = {
        startX: e.clientX, startY: e.clientY,
        startW: targetW || 360, startH: targetH || 320,
      };
      setResizing(true);
    };
    useEffect(() => {
      if (!resizing) return;
      const onMove = (e) => {
        const dx = e.clientX - resizeRef.current.startX;
        const dy = e.clientY - resizeRef.current.startY;
        const nw = Math.max(260, resizeRef.current.startW + dx);
        const nh = Math.max(160, resizeRef.current.startH + dy);
        onUpdate(id, { w: nw, h: nh });
      };
      const onUp = () => setResizing(false);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    }, [resizing, id, onUpdate]);

    const style = {
      left: `${liveX}px`,
      top: `${liveY}px`,
      width: `${liveW}px`,
      height: `${liveH}px`,
      borderRadius: radius,
      /* Window stays opaque during the morph so the sphere→panel
         transition reads as one form changing shape (not a crossfade
         with the fading core). Only the unmount flips opacity to 0.
         On CLOSE the morphIn window fades out AS it collapses (so it's
         already gone by the time it reaches the atom — no lingering
         fixed-position ghost when the camera then pans away). */
      opacity: (morphing && win.morphClosing)
        ? Math.max(0, Math.min(1, morphT / 0.35))
        : (mounted ? 1 : 0),
    };
    if (tintAtom) {
      /* The atom's hue flows to the unified .omega-window.morph-atom CSS
         frame (border + glow) — ONE window style, no inline duplicate. We
         set inline styles ONLY DURING the clip morph, where box-shadow must
         be suppressed and the edge is a drop-shadow hugging the clipped
         shape. Settled → the CSS frame (hue-aware) draws it. */
      style["--awin-hue"] = atomHue;
      style.animation = "none";
      if (morphIn && morphing) {
        style.clipPath = morphClip;
        style.WebkitClipPath = morphClip;
        style.boxShadow = "none";
        style.filter = `drop-shadow(0 0 ${morphGlow}px oklch(0.72 0.2 ${atomHue} / 0.85))`;
        style.border = "1px solid transparent";
        style.transition = "none";   // per-frame opacity/clip drive immediately, no 360ms smear
      }
    }

    const contentStyle = morphing ? { opacity: morphContent }
      : (fromAtom ? { opacity: canvasOpacity } : undefined);

    return (
      <div
        ref={ref}
        className={`omega-window kind-${kind} ${tintAtom ? 'morph-atom' : ''} ${pinned ? 'pinned' : ''} ${dragging ? 'dragging' : ''}`}
        style={style}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {morphing ? (
          <div
            className="omega-morph-light"
            style={{
              position: "absolute", inset: 0, borderRadius: "inherit",
              pointerEvents: "none", zIndex: 6, opacity: morphLight,
              mixBlendMode: "screen",
              background: `radial-gradient(circle at center, oklch(0.86 0.2 ${atomHue}) 0%, oklch(0.72 0.22 ${atomHue} / 0.78) 36%, transparent 76%)`,
            }}
          ></div>
        ) : null}
        <div className="omega-win-header" onMouseDown={startDrag} style={contentStyle}>
          <span className="omega-win-head-left">
            <span className="omega-win-kind">{kind}</span>
            {win.controller ? (() => {
              const because = win.context && win.context.opened_because;
              const by = win.openedBy === "omega" ? "Ω" : win.openedBy === "user" ? "you" : (win.openedBy || "?");
              const tip = win.controller === "shared"
                ? `shared · both act freely${because ? ` · opened by ${by}: ${because}` : ` · opened by ${by}`}`
                : (because ? `opened because: ${because}` : `controller: ${win.controller}`);
              return (
                <span className={`omega-win-owner owner-${win.controller}`} title={tip}>
                  {win.controller === "shared"
                    ? (<React.Fragment><span className="pr-you">you</span><span className="pr-sep">·</span><span className="pr-omega">Ω</span></React.Fragment>)
                    : win.controller === "omega" ? "Ω omega"
                    : win.controller === "user" ? "you"
                    : win.controller}
                </span>
              );
            })() : null}
          </span>
          <span className="omega-win-controls" data-no-drag>
            <button
              type="button"
              className={`omega-pin ${pinned ? 'on' : ''}`}
              onClick={() => onTogglePin(id)}
              aria-label={pinned ? 'Unpin' : 'Pin'}
              title={pinned ? 'Unpin' : 'Pin'}
            >◉</button>
            {onMinimize ? (
              <button
                type="button"
                className="omega-min"
                onClick={() => onMinimize(id)}
                aria-label="Minimize"
                title="Minimize to taskbar"
              >–</button>
            ) : null}
            <button
              type="button"
              className="omega-close"
              onClick={() => onClose(id)}
              aria-label="Close"
              title="Close"
            >×</button>
          </span>
        </div>
        <div className="omega-win-body" style={contentStyle}>{content}</div>
        <div
          className="omega-win-resize"
          onMouseDown={startResize}
          aria-label="Resize"
          data-no-drag
        ></div>
      </div>
    );
  }

  window.OmegaWindow = OmegaWindow;
})();
