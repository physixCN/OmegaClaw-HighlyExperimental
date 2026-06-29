/* OmegaCommands.jsx — central command bus + entry-layout reflow.

   The bus owns the windows array. Commands (openWindow / closeWindow /
   mergeToCore / collapseUnpinned) are the ONLY way to mutate it from
   outside — so OmegaClaw can drive the same intents a user can.

   When the window count changes, layoutWindows computes a default
   arrangement for the new count (1, 2-up, 2+1, 2×2). That arrangement
   is the ENTRY layout — once placed, windows are free to drag/resize/
   pin afterward. OmegaWindow uses its own springs to glide each
   window to its new x/y so the reflow reads as cells dividing rather
   than panes snapping. */

(function () {
  const { useState, useCallback, useRef } = React;

  let _nextId = 1;
  const genId = (prefix) => `${prefix}-${_nextId++}`;

  // Tunable defaults. The opener can override per-window via opts.
  const DEFAULT_W = 360;
  const DEFAULT_H = 320;

  // The "room canvas" within the viewport that holds windows. Avoids
  // the walls + the floor zone where the ridge lives.
  const CANVAS = {
    padXFrac: 0.10,
    padTopFrac: 0.08,
    floorFrac: 0.70,
  };

  function getCanvas() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left   = vw * CANVAS.padXFrac;
    const right  = vw * (1 - CANVAS.padXFrac);
    const top    = vh * CANVAS.padTopFrac;
    const bottom = vh * CANVAS.floorFrac;
    return { left, right, top, bottom, w: right - left, h: bottom - top };
  }

  /* Entry layouts by count. Each cell is a full rect {x, y, w, h}.
     Bot-opened windows fill their cell exactly so the entry layout
     is uniform and never overlaps — the user can drag/resize later
     to overlap intentionally. 1–4 are special-cased; 5–8 use a
     generic two-row grid (top row gets ceil(n/2), bottom floor(n/2),
     centered when uneven). */
  function cellsFor(n, c) {
    const gap = 18;
    if (n === 1) {
      /* Single = the PRIMARY surface: large, centered, dominant. The
         chat surface additionally auto-sizes its height to content (CSS
         below), so it grows toward full-screen only as needed. */
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = Math.min(960, Math.max(460, vw * 0.66));
      const h = Math.min(vh * 0.80, vh - 96);
      return [{ x: (vw - w) / 2, y: Math.max(20, vh * 0.07), w, h }];
    }
    if (n === 2) {
      const cw = (c.w - gap) / 2;
      return [
        { x: c.left,            y: c.top, w: cw, h: c.h },
        { x: c.left + cw + gap, y: c.top, w: cw, h: c.h },
      ];
    }
    if (n === 3) {
      const cw = (c.w - gap) / 2;
      const ch = (c.h - gap) / 2;
      return [
        { x: c.left,            y: c.top,            w: cw,   h: ch },
        { x: c.left + cw + gap, y: c.top,            w: cw,   h: ch },
        { x: c.left,            y: c.top + ch + gap, w: c.w,  h: ch },
      ];
    }
    if (n === 4) {
      const cw = (c.w - gap) / 2;
      const ch = (c.h - gap) / 2;
      return [
        { x: c.left,            y: c.top,            w: cw, h: ch },
        { x: c.left + cw + gap, y: c.top,            w: cw, h: ch },
        { x: c.left,            y: c.top + ch + gap, w: cw, h: ch },
        { x: c.left + cw + gap, y: c.top + ch + gap, w: cw, h: ch },
      ];
    }
    // 5–8 → two-row grid. Top row holds the ceiling-half; bottom the
    // remainder, centered when fewer.
    const topCount = Math.ceil(n / 2);
    const botCount = n - topCount;
    const ch = (c.h - gap) / 2;
    const topCellW = (c.w - (topCount - 1) * gap) / topCount;
    const botCellW = botCount > 0
      ? (c.w - (botCount - 1) * gap) / botCount
      : 0;
    // Make bottom cells match top width so the grid reads uniformly;
    // center the bottom row.
    const cells = [];
    for (let i = 0; i < topCount; i++) {
      cells.push({
        x: c.left + i * (topCellW + gap),
        y: c.top,
        w: topCellW, h: ch,
      });
    }
    const botRowW = botCount * topCellW + Math.max(0, botCount - 1) * gap;
    const botStartX = c.left + (c.w - botRowW) / 2;
    for (let i = 0; i < botCount; i++) {
      cells.push({
        x: botStartX + i * (topCellW + gap),
        y: c.top + ch + gap,
        w: topCellW, h: ch,
      });
    }
    return cells;
  }

  function layoutWindows(windows) {
    if (windows.length === 0) return windows;
    const c = getCanvas();
    /* Windows flagged selfLayout (the chat — it sizes/places itself
       from the App so it can be a compact input that grows) are left
       exactly where they are AND excluded from the cell count, so a
       lone chat doesn't trigger the big single-window layout. */
    const auto = windows.filter((w) => !w.selfLayout);
    const cells = cellsFor(auto.length, c);
    let ai = 0;
    return windows.map((w) => {
      if (w.selfLayout) return w;
      const cell = cells[ai++] || cells[cells.length - 1];
      return { ...w, x: cell.x, y: cell.y, w: cell.w, h: cell.h };
    });
  }

  /* Emit a SurfaceStateChanged trace so no surface action is hidden
     local state (charter §8). Goes on the omegaEvents bus tagged by
     origin (user / omega / system). */
  function surfaceTrace(win, state, origin) {
    if (!window.omegaEvents || !win) return;
    window.omegaEvents.emit({
      type: "surface-state",
      surfaceId: win.id,
      kind: win.kind,
      title: win.title || win.kind,
      state,
      controller: win.controller || "user",
      layout: win.layout || "floating",
      openedBecause: (win.context && win.context.opened_because) || null,
      origin: origin || "system",
      time: performance.now(),
    });
  }

  function useOmegaCommands(initial = []) {
    const [windows, setWindows] = useState(initial);
    const winsRef = useRef([]);
    winsRef.current = windows;
    const busRef = useRef(null);

    const openWindow = useCallback((kind, content, opts = {}) => {
      const id = opts.id || genId(kind);
      /* Shared by default — both Operator and Omega act freely (charter §8).
         The OS represents co-control; per-action attribution stays in the
         origin-tagged traces. openedBy records who summoned the surface. */
      const controller = opts.controller || "shared";
      /* Full surface descriptor (charter §8). Existing callers that pass
         only {w,h,pinned} still work — the rest defaults. */
      const descriptor = {
        id, kind, content,
        title: opts.title || kind,
        x: opts.x ?? null, y: opts.y ?? null,   // set by layoutWindows
        selfLayout: !!opts.selfLayout,          // chat sizes/places itself
        w: opts.w ?? DEFAULT_W,
        h: opts.h ?? DEFAULT_H,
        pinned: !!opts.pinned,
        mounted: true,
        state: "active",
        controller,
        openedBy: opts.origin || "user",
        layout: opts.layout || "floating",
        spawnAt: opts.spawnAt || null,           // grow-from point (summoned-atom morph)
        morphIn: opts.morphIn || null,           // atom→window clip-path edge morph {start,hue}
        capabilities: opts.capabilities || ["display", "resize", "persist"],
        context: opts.context || {},
        traceRef: opts.traceRef || null,
      };
      setWindows((ws) => {
        const filtered = opts.replaceKind === false
          ? ws
          : ws.filter((w) => w.kind !== kind);
        return layoutWindows([...filtered, descriptor]);
      });
      surfaceTrace(descriptor, "active", opts.origin || controller);
      return id;
    }, []);

    const closeWindow = useCallback((id, origin = "user") => {
      surfaceTrace(winsRef.current.find((w) => w.id === id), "closed", origin);
      setWindows((ws) =>
        ws.map((w) => (w.id === id ? { ...w, mounted: false, state: "closed" } : w))
      );
      // After the close spring settles, drop the entry and reflow the
      // remaining windows back into the entry layout for the new count.
      setTimeout(() => {
        setWindows((ws) => layoutWindows(ws.filter((w) => w.id !== id)));
      }, 700);
    }, []);

    const mergeToCore = useCallback((id, origin = "user") => {
      closeWindow(id, origin);
    }, [closeWindow]);

    const collapseUnpinned = useCallback((origin = "user") => {
      setWindows((ws) => {
        ws.filter((w) => !w.pinned && w.mounted).forEach((w) => {
          surfaceTrace(w, "closed", origin);
          setTimeout(() => {
            setWindows((cur) => layoutWindows(cur.filter((x) => x.id !== w.id)));
          }, 700);
        });
        return ws.map((w) =>
          !w.pinned && w.mounted ? { ...w, mounted: false, state: "closed" } : w
        );
      });
    }, []);

    const updateWindow = useCallback((id, patch) => {
      setWindows((ws) =>
        ws.map((w) => (w.id === id ? { ...w, ...patch } : w))
      );
    }, []);

    const togglePin = useCallback((id) => {
      setWindows((ws) =>
        ws.map((w) => (w.id === id ? { ...w, pinned: !w.pinned } : w))
      );
    }, []);

    /* Minimize → background (out of focus) without closing; restore brings
       it back. The taskbar lists minimized windows. Traces the state. */
    const minimizeWindow = useCallback((id, origin = "user") => {
      surfaceTrace(winsRef.current.find((w) => w.id === id), "background", origin);
      setWindows((ws) =>
        ws.map((w) => (w.id === id ? { ...w, minimized: true, state: "background" } : w))
      );
    }, []);
    const restoreWindow = useCallback((id, origin = "user") => {
      surfaceTrace(winsRef.current.find((w) => w.id === id), "active", origin);
      setWindows((ws) =>
        ws.map((w) => (w.id === id ? { ...w, minimized: false, state: "active" } : w))
      );
    }, []);

    const bus = {
      windows,
      openWindow, closeWindow, mergeToCore,
      collapseUnpinned, updateWindow, togglePin,
      minimizeWindow, restoreWindow,
    };
    busRef.current = bus;
    return bus;
  }

  window.useOmegaCommands = useOmegaCommands;
})();
