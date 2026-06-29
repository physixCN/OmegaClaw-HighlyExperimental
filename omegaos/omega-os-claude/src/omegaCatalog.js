/* omegaCatalog.js — the grounded mirror of OmegaClaw's real shapes.

   This is the single place that encodes Omega's ACTUAL runtime spaces
   and core skill cards, transcribed from physixCN/OmegaClaw-Core@main
   (lib_omegaclaw_core.metta, lib_omegaclaw_attention.metta,
   src/skill_affordance_core.metta, docs/reference-omega-organ-map.md).

   It is intentionally a small, truthful SUBSET — the live system has
   ~780 skills and module-provided spaces. The point is shape fidelity,
   not completeness: anything built on top reads real atoms, and when
   live OmegaClaw is wired, omegaGraph.applySnapshot() replaces this
   wholesale. Mock behind live shapes — never a mock that bakes in
   assumptions the live loop can't override.

   ── Space shape ────────────────────────────────────────────────────
     { name, role, budget, note }
       role   — register-space role: 'memory' | 'immune' | 'module'
       budget — per-space char-pressure bound from initLoop (chars), or
                null when the space has no hard char bound
   ── Skill card shape (subset of the real affordance atoms) ──────────
     { name, topics[], arg, risk, effect, pw:{situation,weight}, card }
       pw.weight — the PreferredWhen affordance/salience score (0..1)
*/

(function () {
  /* The registered runtime spaces. persistent…cleanup are bound in
     lib_omegaclaw_core.metta; attention in lib_omegaclaw_attention
     (role immune); scratch/assume are module organs. */
  const spaces = [
    { name: "persistent", role: "memory", budget: 10000, note: "durable identity, facts, rules, reusable knowledge" },
    { name: "agenda",     role: "memory", budget: 20000, note: "goals and operating commitments" },
    { name: "beliefs",    role: "memory", budget: 50000, note: "uncertain / inferred self & world claims" },
    { name: "world",      role: "memory", budget: 50000, note: "stable world & habitat facts" },
    { name: "events",     role: "memory", budget: 50000, note: "dated observations and outcomes" },
    { name: "activity",   role: "memory", budget: 60000, note: "exact action & runtime traces" },
    { name: "cleanup",    role: "memory", budget: null,  note: "memory cleanup proposals & commits" },
    { name: "attention",  role: "immune", budget: null,  note: "ECAN-lite salience / pressure / spin" },
    { name: "scratch",    role: "module", budget: 20000, note: "temporary structured work (TTL / GC)" },
    { name: "assume",     role: "module", budget: null,  note: "predictive reasoning organ" },
  ];

  /* Core skill cards — transcribed real affordances. pw.weight is the
     literal PreferredWhen score from the repo. */
  const skills = [
    { name: "send",                 topics: ["core","conversation"],        arg: "message", risk: "external-communication", effect: "message-sent",        pw: { situation: "open-conversation",            weight: 0.88 }, card: "reply through the latest routed control channel" },
    { name: "wait",                 topics: ["core"],                        arg: "reason",  risk: null,                     effect: "no-external-action",  pw: { situation: "deliberate-no-action",         weight: 0.86 }, card: "deliberately take no external action this cycle" },
    { name: "pin",                  topics: ["core","working-memory"],       arg: "state",   risk: null,                     effect: "working-memory-state",pw: { situation: "volatile-continuity-needed",   weight: 0.90 }, card: "one-line volatile continuity vector for the next cycle" },
    { name: "remember",             topics: ["core","memory"],               arg: "lesson",  risk: "memory-noise",           effect: "ltm-entry",           pw: { situation: "compact-future-useful-lesson", weight: 0.84 }, card: "store compact future-useful continuity" },
    { name: "query",                topics: ["core","memory"],               arg: "phrase",  risk: null,                     effect: "ltm-search-results",  pw: { situation: "memory-could-matter",          weight: 0.86 }, card: "search long-term memory before guessing" },
    { name: "search",               topics: ["core","web"],                  arg: "phrase",  risk: "external-fetch",         effect: "web-results",         pw: { situation: "fact-could-be-online",         weight: 0.74 }, card: "web search (DuckDuckGo Lite by default)" },
    { name: "episodes-at",          topics: ["core","history"],              arg: "time",    risk: null,                     effect: "history-snippet",     pw: { situation: "history-could-matter",         weight: 0.84 }, card: "inspect history around a flexible timestamp" },
    { name: "promote",              topics: ["core","memory"],               arg: "time",    risk: "stale-memory-if-overused",effect: "memory-promoted",    pw: { situation: "memory-was-reused",            weight: 0.86 }, card: "promote a useful recalled memory" },
    { name: "demote",               topics: ["core","memory"],               arg: "time",    risk: null,                     effect: "memory-demoted",      pw: { situation: "memory-was-noisy",             weight: 0.82 }, card: "demote a noisy or stale recalled memory" },
    { name: "current-swipl-pid",    topics: ["core","runtime"],              arg: null,      risk: null,                     effect: "runtime-observation", pw: { situation: "verify-reboot",                weight: 0.92 }, card: "confirm process identity after restart" },
    { name: "body-status",          topics: ["core","runtime"],              arg: null,      risk: null,                     effect: "runtime-observation", pw: { situation: "inspect-embodiment",           weight: 0.84 }, card: "inspect basic runtime body state" },
    { name: "skill-help",           topics: ["core","affordance"],           arg: "topic",   risk: null,                     effect: "help-lines",          pw: { situation: "need-body-manual-topic",       weight: 0.90 }, card: "show body-manual help for a topic" },
    { name: "prepare-reboot",       topics: ["core","runtime"],              arg: "reason",  risk: "runtime-transition",     effect: "reboot-breadcrumb",   pw: { situation: "planned-restart",              weight: 0.86 }, card: "write a reboot breadcrumb before restart" },
    { name: "complete-reboot-check",topics: ["core","runtime"],              arg: "reason",  risk: null,                     effect: "reboot-checked",      pw: { situation: "after-restart",                weight: 0.88 }, card: "inspect & clear a reboot breadcrumb" },
    { name: "restart-self",         topics: ["core","runtime"],              arg: "reason",  risk: "runtime-restart",        effect: "self-restart",        pw: { situation: "self-restart-needed",          weight: 0.72 }, card: "restart this agent process after preparing continuity" },
    { name: "reboot-self",          topics: ["core","runtime"],              arg: "reason",  risk: "vm-reboot",              effect: "vm-reboot",           pw: { situation: "vm-reboot-needed",             weight: 0.66 }, card: "reboot the embodied VM after preparing continuity" },
    { name: "restart-omega",        topics: ["core","runtime"],              arg: "reason",  risk: "runtime-restart",        effect: "agent-restart",       pw: { situation: "restart-supervised-agent",     weight: 0.70 }, card: "restart the supervised agent process" },
    { name: "shell",                topics: ["core","system","shell"],       arg: "command", risk: "vm-command",             effect: "stdout-observation",  pw: { situation: "inspect-filesystem-or-runtime",weight: 0.70 }, card: "run a non-risky shell command inside the VM body" },
    { name: "shell-confirm",        topics: ["core","system","shell"],       arg: "command", risk: "vm-command-risky",       effect: "stdout-observation",  pw: { situation: "approved-risky-shell",         weight: 0.52 }, card: "run a shell command after the boundary asks to confirm" },
    { name: "read-file",            topics: ["core","file"],                 arg: "path",    risk: "file-read",              effect: "file-content",        pw: { situation: "inspect-file",                 weight: 0.84 }, card: "inspect text files through the file hand" },
    { name: "write-file",           topics: ["core","file"],                 arg: "path content", risk: "file-write",        effect: "file-written",        pw: { situation: "write-artifact-or-code",       weight: 0.72 }, card: "write a file through the file hand (lowers to base64 safely)" },
    { name: "append-file",          topics: ["core","file"],                 arg: "path content", risk: "file-write",        effect: "file-appended",       pw: { situation: "append-artifact-or-log",       weight: 0.68 }, card: "append to a file through the file hand" },
    { name: "cost-last-call",       topics: ["core","runtime"],              arg: null,      risk: null,                     effect: "cost-observation",    pw: { situation: "inspect-model-cost",           weight: 0.78 }, card: "inspect the most recent model call cost" },
    { name: "context-organ-status", topics: ["core","runtime"],              arg: null,      risk: null,                     effect: "context-observation", pw: { situation: "inspect-context-economy",      weight: 0.82 }, card: "inspect context organ state & input recall" },
    { name: "cycle-status",         topics: ["core","runtime"],              arg: null,      risk: null,                     effect: "cycle-observation",   pw: { situation: "inspect-loop-position",        weight: 0.84 }, card: "inspect current loop cycle & practice state" },
    { name: "activity-traces",      topics: ["core","activity"],             arg: null,      risk: null,                     effect: "activity-observation",pw: { situation: "inspect-recent-actions",       weight: 0.78 }, card: "inspect activity trace atoms" },
    { name: "events-all",           topics: ["core","events"],               arg: null,      risk: null,                     effect: "event-observation",   pw: { situation: "inspect-event-space",          weight: 0.76 }, card: "inspect compact event atoms" },
  ];

  const skillByName = Object.fromEntries(skills.map((s) => [s.name, s]));
  const spaceByName = Object.fromEntries(spaces.map((s) => [s.name, s]));

  /* Agenda goals — Omega's operating commitments, the shape held in
     &agenda. Goals are PROCESSES with a status: active (running),
     dormant (parked/stopped — NOT done), or complete (finished →
     archived to events + persistent, salience cleared, AttentionLeaving
     emitted). `next` is the pin-style "-> next" pointer; `meta` marks a
     self-model goal. Grounded, plausible commitments for Operator's live
     Omega; the live loop replaces these via applySnapshot-style sync. */
  const agenda = [
    { id: "g-whatsapp",   goal: "Stay current on Operator's WhatsApp; answer or pin reply-debt before silence", status: "active",   priority: 0.92, topic: "conversation", next: "clear open conversations this cycle" },
    { id: "g-glucose",    goal: "Watch the glucose stream; flag lows to the family channel",                status: "active",   priority: 0.85, topic: "health",       next: "poll LibreLinkUp on the next warm wake" },
    { id: "g-continuity", goal: "Preserve continuity across reboots",                                       status: "active",   priority: 0.70, topic: "continuity",  next: "pin REBOOT shape before any restart", meta: true },
    { id: "g-digest",     goal: "Publish the weekly family digest to the webhost",                          status: "active",   priority: 0.58, topic: "publishing",  next: "draft from this week's events, then write-file to public/" },
    { id: "g-metta",      goal: "Study MeTTa pattern-matching for sharper skill synthesis",                 status: "dormant",  priority: 0.42, topic: "self-study",  next: "resume when a focused / creative cycle is free" },
    { id: "g-house",      goal: "Learn the living-room evening lighting routine",                           status: "dormant",  priority: 0.34, topic: "house",       next: "observe a few more WorldState samples first" },
    { id: "g-channelcfg", goal: "Reconcile duplicate (commchannel) config atoms",                          status: "complete", priority: 0.50, topic: "runtime",     done: "archived to events + persistent" },
    { id: "g-smoke",      goal: "Add runtime smoke tests for sense routes",                                 status: "complete", priority: 0.45, topic: "runtime",     done: "archived to events + persistent" },
  ];

  /* Attention evidence seeds — the NON-derived salience signals held in
     &attention (ECAN-lite immune organ). The Attention surface merges
     these with live evidence (active agenda goals + current energy mode)
     and ranks them. Attention is a SUGGESTION surface: evidence the agent
     weighs, never a gate on speech or action. */
  const attentionSeeds = [
    { id: "a-wa",   category: "conversation",    label: "Fresh inbound · Operator · WhatsApp", salience: 0.90, why: "unread human message; open conversation, not yet answered" },
    { id: "a-mem",  category: "memory-pressure", label: "&activity near char budget",     salience: 0.55, why: "≈58k / 60,000 ch — a cleanup proposal is pending" },
    { id: "a-fail", category: "failure",         label: "Last write-file retried",         salience: 0.40, why: "one syntax-error recovered via base64; watch for a repeat" },
    { id: "a-spin", category: "spin",            label: "Spin-counter steady",             salience: 0.18, why: "no repeated-action pressure this window" },
  ];

  window.omegaCatalog = {
    spaces, skills, agenda, attentionSeeds, skillByName, spaceByName,
    /* Energy modes — from the loop's posture model (see plan §1, §7).
       Kept here so Phase 1 can bind the living environment to them. */
    energyModes: ["asleep", "listening", "warm", "focused", "creative"],
  };
})();
