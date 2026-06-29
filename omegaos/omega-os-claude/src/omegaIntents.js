/* omegaIntents.js — published INTENT bus. The second published seam,
   sibling to omegaEvents.

     omegaEvents  = what Omega's behavior IS DOING (heartbeat telemetry,
                    render-facing: dispatch / arrival / reasoning / return).
     omegaIntents = what Omega (or the user) WANTS to happen — symmetric
                    commands that drive the surface / OS layer.

   Both human actions and Omega decisions flow through here, each tagged
   by `origin`, so that:
     (a) the UI never decides what matters on its own — it only renders
         the intents it receives, and
     (b) every action is auditable and replayable (origin + timestamp).

   When the live OmegaClaw loop is wired, it emits the SAME intents the
   mock + user emit today. That makes the cutover a swap, not a rewrite —
   exactly the membrane discipline the OmegaClaw paper asks for.

   ── Intent vocabulary ──────────────────────────────────────────────
   open-surface   { type, surface: { kind, title?, payload?, w?, h?,
                    pinned?, id? }, origin }
       Summon a surface. `kind` is OPEN-ENDED — image, video, audio,
       terminal, browser, app, game, document, map, chat, console, or
       anything Omega can render / run. The UI does NOT whitelist kinds;
       unknown kinds fall back to a generic surface. "Omega can open
       whatever she is opening" lives here.
   close-surface  { type, id, origin }
   invoke-skill   { type, skillId, args?, origin }
       Fire a skill atom (dart → ignite → action) — same path whether the
       caller is the user, a Tweaks button, or Omega.
   set-mode       { type, mode, origin }      // energy mode   (Phase 1)
   attend-to      { type, target, origin }    // attention     (Phase 2)
   focus          { type, target, origin }    // gather a memory space into a
       knowledge-graph continent (Evolution Plan §12.1/§15). `target` is a
       space name to gather, or null to disperse back to the resting
       galaxy. Origin 'omega' = she looked there of her own loop; 'user'
       = we asked her to. The membrane only relays this into omegaState's
       frame; the renderer reads the frame and animates the gather.
   reason         { type, spec, origin }       // play a reasoning HOP in the
       space (Evolution Plan §11). `spec` optionally names {premises:[…],
       conclusion} atom labels; omitted ⇒ a few salient belief atoms are
       chosen. The renderer gathers premises+conclusion into a tiny
       knowledge-graph continent (links premise→conclusion, conclusion at
       its heart) and the UI opens the mathematical RECEIPT on it. The
       decision to reason lives in Omega; the membrane only relays.
   summon         { type, target, origin }      // bring an atom (or space)
       TO the viewer (roadmap #4 — "atoms come to us"). `target` is an
       atom label or a space name. The renderer flies it to a dock point
       close in front of the camera (looms large), brightens it, dims the
       rest. The membrane only relays; the renderer does the motion.
   inspect        { type, target, origin }    // inspector     (Phase 3)
   speak          { type, text, origin }      // voice         (later)

   origin: 'user' | 'omega' | 'system'   (defaults to 'system')

   ── Obligations ────────────────────────────────────────────────────
     • Emitters: never reach into the surface/window bus directly for
       open/close/invoke — emit an intent so the action is visible and
       symmetric.
     • Subscribers (the UI): render intents faithfully; do not add policy
       deciding WHICH intents to honor. Validation/safety belongs in the
       symbolic layer, not the membrane.
   ────────────────────────────────────────────────────────────────────
*/

(function () {
  const subs = new Set();

  /* Bounded ring buffer — the activity/audit trail of intents. A future
     inspector (Phase 3) reads this to show "who asked for what, when".
     Subscribers are push-based; this log is for tooling, not the seam. */
  const LOG_MAX = 512;
  const log = [];

  function emit(intent) {
    if (!intent || typeof intent !== "object" || !intent.type) return null;
    const stamped = { ts: performance.now(), origin: "system", ...intent };
    log.push(stamped);
    if (log.length > LOG_MAX) log.shift();
    for (const fn of subs) {
      try { fn(stamped); }
      catch (e) { /* a misbehaving subscriber must never break the bus */ }
    }
    return stamped;
  }

  function subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  }

  window.omegaIntents = { emit, subscribe, get log() { return log; } };
})();
