/* omegaEvents.js — THE published interface between Omega's
   behavior and any renderer.

   ── THE SEAM ──────────────────────────────────────────────────
   This file defines the five event types that are the ONLY contract
   between the system (omegaScheduler) and any renderer (the current
   2.5D anatomyPulses, a future Three.js scene, an audio-only mode,
   a debug-log dump — anything).

   Test of done: delete the renderer, write a brand-new one knowing
   nothing but these five event types, and it works. If a renderer
   ever needs to reach around this seam to read scheduler state,
   that's a leak — add a field to the relevant event INSTEAD.

   ── The five event types ──────────────────────────────────────

   LoopBeat
     { type: 'loop-beat',
       loopId:   number,   // per-beat generation tag (Stage 4 uses
                           // this to recede older in-flight cycles)
       time:     number,   // performance.now() at beat
       busyness: number }  // 0..1 — system pressure right now

   DispatchEvent
     { type: 'dispatch',
       pulseId:           number,   // unique per dispatch
       loopId:            number,   // which beat this belongs to
       thoughtId:         number,   // identity tag carried through
                                    // the entire dispatch → reason →
                                    // return cycle (one moving spark)
       targetAtom:        string,   // atomId the dart is aimed at
       kind:              string,   // activity label (memory,
                                    // reasoning, skill-call, …) —
                                    // renderer may tint within gold
       emittedAt:         number,   // performance.now() at emit
       scheduledArrival:  number }  // when ArrivalEvent will fire;
                                    // dart animation lands here

   ArrivalEvent
     { type: 'arrival',
       pulseId:   number,
       loopId:    number,
       thoughtId: number,
       atomId:    string,    // where the dart landed
       time:      number }   // performance.now() at arrival

   ReasoningEvent
     { type: 'reasoning',
       pulseId:     number,
       loopId:      number,
       thoughtId:   number,
       atomId:      string,         // origin atom (= ArrivalEvent.atomId)
       kind:        'single' | 'cascade',
       order:       string[],       // the SPINE of the thought —
                                    // chain[0] = origin, chain[N-1] =
                                    // deepest leaf. The thought-thread
                                    // spark walks this in order.
       bloomChains: string[][],     // additional chains for the
                                    // bloom WIDTH (fan-out around
                                    // the spine). Each chain's index
                                    // is its depth in the cascade.
       stepMs:      number,         // ms between hops in any chain
       time:        number }        // when reasoning ignites
                                    //   (= ArrivalEvent.time)

   ReturnEvent
     { type: 'return',
       loopId:     number,
       pulseId:    number,   // dispatch pulseId this is closing
       thoughtId:  number,
       fromAtomId: string,   // emerges from here (deepest leaf)
       pulses:     1 | 2 | 3,        // count, system-decided
       timing:     number[], // length === pulses; relative offsets
                             // (ms) from `time` for each return
                             // spark's emission. timing[0] is
                             // typically 0.
       time:       number }  // performance.now() at first emit

   ── Renderer obligations ──────────────────────────────────────
     • Subscribe with omegaEvents.subscribe(fn).
     • Decide all motion (dart trajectory, bloom envelopes, ignition
       flashes, return spark trail) locally from these events.
     • MAY read the static anatomy graph (omegaGraph) for spatial
       positions and family colors — that's shared world data, not
       scheduler state.
     • MUST NOT read internal scheduler state (no buildRoute, no
       cascade tables, no busyness fields outside LoopBeat).

   ── Scheduler obligations ─────────────────────────────────────
     • Emit events in causal order: LoopBeat → DispatchEvent(s) →
       (per dispatch) ArrivalEvent → ReasoningEvent → ReturnEvent.
     • `time` fields use performance.now() so renderers can sync
       their own animation clocks to the same timebase.
     • Future arrivals/returns are emitted AT their time (Option A:
       emit-when-it's-time, simple). A future replay/recording
       layer can switch to emit-ahead with future timestamps.
*/

(function () {
  const subs = new Set();

  /* Per-tab event log — bounded ring buffer. Useful for debugging
     and for a future replay/record layer. Renderers shouldn't read
     this (it's not the seam — events are pushed, not pulled), but
     it's safe for dev tools. */
  const LOG_MAX = 1024;
  const log = [];

  function emit(ev) {
    if (!ev || typeof ev !== "object") return;
    log.push(ev);
    if (log.length > LOG_MAX) log.shift();
    for (const fn of subs) {
      try { fn(ev); } catch (e) { /* a misbehaving subscriber must
                                     never break the bus. */ }
    }
  }

  function subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  }

  window.omegaEvents = { emit, subscribe, get log() { return log; } };
})();
