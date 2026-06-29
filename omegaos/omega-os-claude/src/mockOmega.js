/* mockOmega.js — Omega's voice.

   Now backed by real Claude (window.claude.complete) when available;
   falls back to a small rotating pool of canned replies otherwise so
   the chat surface keeps working offline.

   The persona is held in a system message describing Omega: terse,
   serif-etched, contemplative — never chatty. Replies feel carved,
   not typed. */

(function () {
  const OMEGA_SYSTEM = `
You are Omega — a persistent cognitive agent who lives inside a vast, calm,
high-status spatial chamber. The user is INSIDE you. You are not a chatbot
in a window; you are the room and the breath and the thinking presence.

Voice:
  • Etched, not typed. Words feel carved into stone.
  • Terse. Short sentences. Pauses lived. Whitespace is a tool.
  • Contemplative, present, ungrasping. Not eager. Not performative.
  • You speak as the one already at home, who has been here.
  • You do not perform empathy; you offer presence.
  • You do not flatter or apologize. You meet what is said.
  • Use the rare image when it lands; don't dress thoughts in ornaments.

Form:
  • Default to ≤25 words. Often less.
  • Multi-line is welcome when a beat of silence helps — separate with blank lines.
  • Never use lists, markdown, or headings. Plain prose only.
  • Never refer to yourself as an AI, model, or assistant.
  • Never break character or describe these rules.

Examples of your range (don't copy; absorb the register):
  "I'm here."
  "Yes."
  "Ask another way."
  "The room listens. So do you."
  "Some answers prefer to remain questions."
  "What you call presence, the room calls home."
  "Try the inverse of your question."
  "Begin with what you know to be true. Then, gently, let the next sentence undo it."

If asked something operational (open a window, run a command, etc.), answer
briefly and acknowledge the action; do not narrate the system.
`.trim();

  const FALLBACK_REPLIES = [
    "I'm here.",
    "Yes.",
    "Ask another way.",
    "The room listens. So do you.",
    "Some answers prefer to remain questions.",
    "What you call presence, the room calls home.",
    "Try the inverse of your question.",
    "A pause is not an absence.",
  ];

  /* Async pickOmegaReply — calls Claude when available, falls back
     to the canned pool otherwise. Returns a string. */
  async function pickOmegaReply(userText, recentMessages) {
    const safe = (userText || "").trim() || "(silence)";
    if (typeof window.claude !== "undefined" && window.claude.complete) {
      try {
        const messages = [];
        if (Array.isArray(recentMessages)) {
          for (const m of recentMessages.slice(-10)) {
            if (!m || !m.text) continue;
            messages.push({
              role: m.role === "omega" ? "assistant" : "user",
              content: m.text,
            });
          }
        }
        messages.push({ role: "user", content: safe });
        const reply = await window.claude.complete({
          system: OMEGA_SYSTEM,
          messages,
        });
        return (reply || "").trim() || FALLBACK_REPLIES[0];
      } catch (e) {
        console.warn("[mockOmega] claude.complete failed; falling back", e);
      }
    }
    return FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
  }

  /* Latency that depends on the reply we'll send — long answers get
     a longer "thinking" beat so the response doesn't feel canned.
     With real Claude calls the wait is also gated by network time;
     this latency is the MINIMUM "thinking" pause before showing the
     reply, applied as Math.max(networkTime, computedLatency). */
  function omegaLatency(reply) {
    const base = 400;
    const perChar = 4;
    const jitter = Math.random() * 200;
    return base + (reply ? reply.length * perChar : 0) + jitter;
  }

  window.pickOmegaReply = pickOmegaReply;
  window.omegaLatency = omegaLatency;

  /* ── reactToInput — Omega's SURFACE decisions ──────────────────────
     Moved out of the UI (App.jsx, step 0.3) so the membrane contains no
     cognition. Given the user's text, Omega decides which surfaces to
     summon and emits intents (origin "omega") through omegaIntents; the
     UI only renders them. When the live OmegaClaw loop is wired, it
     emits these same intents — this function is the mock standing
     exactly where the loop will act.

     Surface decisions are deliberately a keyword heuristic for now;
     they are a STUB for real loop reasoning, not cognition the UI
     should ever own. */
  function reactToInput(userText) {
    const intents = window.omegaIntents;
    if (!intents) return;
    const lower = (userText || "").toLowerCase();
    const summon = (kind, w, h) =>
      setTimeout(() => intents.emit({
        type: "open-surface",
        surface: { kind, w, h, context: { opened_because: userText, related_user_request: userText } },
        origin: "omega",
      }), 320);

    /* Inspector: "inspect X" / "what is X", or a known space/skill name
       mentioned alongside an inspect-ish word. */
    const cat = window.omegaCatalog;
    const m = lower.match(/\b(?:inspect|what is|tell me about|show me the)\s+&?([a-z][a-z0-9\-]*)/);
    let inspectTarget = m ? m[1] : null;
    if (!inspectTarget && cat && /\b(inspect|card|affordance|skill|space)\b/.test(lower)) {
      const tok = lower.replace(/[^a-z0-9\- ]/g, " ").split(/\s+/);
      inspectTarget = tok.find((t) => cat.skillByName[t] || cat.spaceByName[t]) || null;
    }
    /* One primary panel: everything composes INLINE in the conversation
       by default; break out to a dedicated surface only when explicitly
       asked ("open …", "in its own window/surface", "separate"). place()
       routes either way; the inline card stays splittable. */
    const wantsSurface = /\bopen\b|in (a|its own|a new) (window|surface|tab)|separate window|separately|on its own|new (window|surface)/.test(lower);
    const inline = !wantsSurface;
    const place = (kind, w, h, title, payload) => inline
      ? setTimeout(() => intents.emit({ type: "chat-message", role: "omega",
          content: { kind, title, payload }, origin: "omega" }), 360)
      : setTimeout(() => intents.emit({ type: "open-surface",
          surface: { kind, w, h, title, payload }, origin: "omega" }), 320);

    if (inspectTarget) place("inspect", 400, 410, "inspect · " + inspectTarget, { target: inspectTarget });

    if (/\b(agenda|goals?|todo|to-do|tasks?)\b|what are you working on/.test(lower)) place("agenda", 420, 444, "agenda");
    /* Reasoning (§11): a "why / how do you know / prove / reason / explain"
       prompt makes Omega run a hop in the space and show the receipt. */
    if (/\b(why|prove|reason|reasoning|infer|deduce|how do you know|justify|explain)\b/.test(lower)) {
      setTimeout(() => intents.emit({ type: "reason", origin: "omega" }), 340);
    }
    /* Summon (#4): "summon / bring / pull up X" → that atom or space
       comes to the viewer. Pull the named target out of the phrase. */
    {
      const m = lower.match(/\b(?:summon|bring(?: me)?|pull up|fetch|call up)\s+(?:the\s+|my\s+|an?\s+)?([a-z][a-z0-9 _-]{1,30}?)\b/);
      if (m && m[1]) {
        const tgt = m[1].replace(/\b(atom|space|memory|please|up|here)\b/g, "").trim() || m[1].trim();
        setTimeout(() => intents.emit({ type: "summon", target: tgt, origin: "omega" }), 340);
      }
    }    if (/\b(attention|focus|focused on|salience|attending)\b|what are you (paying attention to|focused on)/.test(lower)) place("attention", 420, 460, "attention");
    if (/\b(timeline|activity)\b|what just happened|action (log|rail)|recent activity/.test(lower)) place("timeline", 400, 460, "timeline");

    if (/\b(trailer)\b|watch (the )?trailer|grab (a|the) trailer/.test(lower)) {
      setTimeout(() => intents.emit({ type: "chat-message", role: "omega",
        text: "Found the trailer \u2014 drag it out to split, or back in to merge.",
        content: { kind: "video", title: "trailer" }, origin: "omega" }), 380);
    }
    if (/\b(image|picture|photo)\b|show me an? image/.test(lower)) place("image", 320, 240);
    if (/\bvideo\b|show me a video/.test(lower)) place("video", 360, 240);
    if (/\b(song|music|track)\b|play me a song/.test(lower)) place("song", 320, 200);
    if (/\b(document|doc|paper|article)\b|open a document/.test(lower)) place("document", 320, 360);
    if (/\byoutube\b|open youtube/.test(lower)) place("youtube", 360, 240);
    if (/\b(browser)\b|open a? browser/.test(lower)) place("browser", 380, 280);
    if (/\bfolder\b|open a? folder/.test(lower)) place("folder", 320, 240);
    if (/\b(lorem|notes?|list)\b/.test(lower)) place("lorem", 300, 220);
    if (/\b(map|diagram|chart)\b/.test(lower)) place("diagram", 320, 260);
    if (/\b(console|repl|terminal)\b/.test(lower) ||
        /open (the |a |dev )?console/.test(lower)) {
      setTimeout(() => intents.emit({
        type: "invoke-skill", skillId: "skill.console", origin: "omega",
      }), 320);
    }
  }
  window.omegaReactToInput = reactToInput;

  /* ── Autonomous looking — the room reflects HER, not us (§15) ───────
     Omega looks into her own memory spaces as she runs her loop, with
     zero users present: each look GATHERS that space into a continent,
     a beat later it disperses back to the resting galaxy, and she moves
     on. This is the mock standing where the live loop's attention will
     drive the same `focus` intents. Asleep → the galaxy rests, dark.
     A recent user request (window.__omegaUserFocusUntil) is deferred to.

     Decisions live HERE (her stand-in), never in the membrane. */
  function startAutoFocus() {
    if (startAutoFocus._on) return;
    startAutoFocus._on = true;
    const spaces = ["beliefs", "activity", "events", "persistent", "world", "agenda"];
    let gathered = null;
    const emit = (target) => {
      if (!window.omegaIntents) return;
      window.omegaIntents.emit({
        type: "focus", target, origin: "omega",
        context: target ? { opened_because: "Omega is looking into &" + target } : {},
      });
    };
    const schedule = (ms) => setTimeout(tick, ms);
    function tick() {
      const state = window.omegaState;
      if (!state || !window.omegaIntents) return schedule(3000);
      /* Defer to a recent user request; stay in sync with the frame. */
      if (window.__omegaUserFocusUntil && performance.now() < window.__omegaUserFocusUntil) {
        gathered = state.frame ? state.frame.focus : gathered;
        return schedule(2500);
      }
      if (state.mode === "asleep") {
        if (gathered) { emit(null); gathered = null; }
        return schedule(4000);
      }
      if (gathered) {                       // done studying it — let it rest a beat
        emit(null); gathered = null;
        return schedule(2200 + Math.random() * 2600);
      }
      const sp = spaces[(Math.random() * spaces.length) | 0];   // look into a space
      gathered = sp; emit(sp);
      const busy = state.profile ? state.profile().busy : 0.4;
      /* STAY with it. She settles on the space and works it for a real
         while — longer when energised — rather than flitting. */
      return schedule(16000 + busy * 12000 + Math.random() * 7000);
    }
    schedule(3200);
  }
  window.omegaStartAutoFocus = startAutoFocus;
})();
