/* skillRegistry.js — the bridge between the heartbeat event stream
   and runnable actions.

   A skill is an atom in the chamber. When a thought arrives at a
   skill atom, the registered action fires. This makes the metaphor
   actually executable: "use the console skill" = dispatch a thought
   at the console atom = atom ignites = the skill's action runs (in
   this case: open a console window).

   Same path applies whether the dispatch was triggered by:
     • the user typing in chat,
     • a Tweaks button,
     • the future OmegaClaw stream deciding to use the skill,
     • or any other source.

   The renderer is unaware — it just paints the dart + ignition.
   The data layer (scheduler / events / graph) is untouched — this
   module is downstream of the seam, registering as an ordinary
   omegaEvents subscriber. */

(function () {
  const actions = new Map();   // atomId → fn(event)

  function register(atomId, action) {
    if (!atomId || typeof action !== "function") return;
    actions.set(atomId, action);
  }

  function unregister(atomId) {
    actions.delete(atomId);
  }

  /* Invoke a skill by atom id — fires a single dispatch dart at it
     via omegaScheduler.cascade(). The dart's arrival ignites the
     atom and triggers the registered action. The whole metaphor
     plays out visibly on the chamber walls.

     `pending` gates this: only EXPLICIT invocations run the action.
     Otherwise random heartbeat darts that happen to land on a skill
     atom would fire it (e.g. the console opening itself unbidden). */
  const pending = new Map();   // atomId → queued invocation count
  function invoke(atomId) {
    if (!atomId) return;
    if (!actions.has(atomId)) {
      console.warn("[omegaSkills] no action registered for", atomId);
    }
    pending.set(atomId, (pending.get(atomId) || 0) + 1);
    if (window.omegaScheduler && window.omegaScheduler.cascade) {
      window.omegaScheduler.cascade(atomId);
    }
  }

  /* Subscribe to arrivals — when a thought lands on a registered
     skill atom, run its action. The event carries thoughtId/loopId
     so an action could correlate multiple invocations if it cared
     to; most just need the arrival itself. */
  if (window.omegaEvents) {
    window.omegaEvents.subscribe((ev) => {
      if (ev.type !== "arrival") return;
      const action = actions.get(ev.atomId);
      if (!action) return;
      /* Only fire when this atom was explicitly invoked — ignore the
         random heartbeat darts that constantly land on skill atoms. */
      const n = pending.get(ev.atomId) || 0;
      if (n <= 0) return;
      pending.set(ev.atomId, n - 1);
      try { action(ev); }
      catch (e) { console.error("[omegaSkills]", ev.atomId, e); }
    });
  }

  window.omegaSkills = { register, unregister, invoke,
                         get registered() { return [...actions.keys()]; } };
})();
