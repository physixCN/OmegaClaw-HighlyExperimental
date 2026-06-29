/* liveOmegaBridge.js — attach Claude's OmegaOS shell to OmegaClaw webhost.

   The visual frontend owns rendering only. OmegaClaw/webhost owns session,
   chat, events, and surface intents. This file swaps the mock reply seam for
   real /api/os/chat and replays backend OS events into omegaIntents.
*/
(function () {
  const POLL_MS = 1800;
  let nextSeq = Number(localStorage.getItem("omega.os.nextSeq") || 0);
  let polling = false;
  let sessionHydrating = false;

  function loginPath() {
    return `/login?next=${encodeURIComponent("/os/")}`;
  }

  function goToLogin() {
    if (window.location.pathname !== "/login") {
      window.location.href = loginPath();
    }
  }

  async function request(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401) {
      const error = new Error("unauthorized");
      error.status = 401;
      throw error;
    }
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  async function currentSession() {
    try {
      return await request("GET", "/api/os/session");
    } catch {
      return { authenticated: false };
    }
  }

  function installBackendLoginGuard() {
    const session = window.omegaSession;
    if (!session || session.__omegaLiveLoginGuard) return;
    const originalSignIn = typeof session.signIn === "function" ? session.signIn.bind(session) : null;
    session.__omegaLiveOriginalSignIn = originalSignIn;
    session.signIn = async function guardedSignIn(profile) {
      if (sessionHydrating && originalSignIn) return originalSignIn(profile);
      const backendSession = await currentSession();
      if (backendSession.authenticated && backendSession.user && originalSignIn) {
        return originalSignIn(profile);
      }
      goToLogin();
      return null;
    };
    session.__omegaLiveLoginGuard = true;
  }

  async function hydrateSession() {
    installBackendLoginGuard();
    const session = await currentSession();
    if (session.authenticated && session.user && window.omegaSession && !window.omegaSession.signedIn) {
      const user = session.user;
      const signIn = window.omegaSession.__omegaLiveOriginalSignIn || window.omegaSession.signIn;
      sessionHydrating = true;
      try {
        signIn.call(window.omegaSession, {
          id: user.username || user.member || user.name || "web",
          name: user.name || user.member || user.username || "OmegaOS user",
          first: user.member || user.name || user.username || "User",
          role: user.role || "family",
          provider: "omega-web",
          hue: user.role === "admin" ? 150 : 215,
          email: "",
          conversation_id: session.conversation_id || "",
        });
      } finally {
        sessionHydrating = false;
      }
    }
    return session;
  }

  async function liveReply(userText) {
    let sent;
    try {
      sent = await request("POST", "/api/os/chat", { text: userText });
    } catch (error) {
      if (error && error.status === 401) {
        goToLogin();
        return "Opening the Omega sign-in.";
      }
      throw error;
    }
    if (!sent.ok) return sent.error || "I could not receive that.";

    /* The OmegaClaw loop is asynchronous. Show an honest receipt immediately;
       the real Omega response will arrive through chat.message events when
       the loop sends back to this web conversation. */
    return "";
  }

  function applyEvent(event) {
    if (!event || !event.kind) return;
    if (event.kind === "intent" && window.omegaIntents && event.payload) {
      window.omegaIntents.emit({ origin: "omega", ...event.payload });
      return;
    }
    if (event.kind === "surface.state") {
      window.dispatchEvent(new CustomEvent("omegaos:surface-state", { detail: event.payload || {} }));
      return;
    }
    if (event.kind === "chat.message") {
      window.dispatchEvent(new CustomEvent("omegaos:chat-message", { detail: event }));
    }
  }

  async function pollEvents() {
    if (polling) return;
    polling = true;
    try {
      const result = await request("GET", `/api/os/events?since=${encodeURIComponent(nextSeq)}&limit=200`);
      for (const event of result.events || []) applyEvent(event);
      if (result.next_seq != null) {
        nextSeq = Math.max(nextSeq, Number(result.next_seq || 0));
        localStorage.setItem("omega.os.nextSeq", String(nextSeq));
      }
    } catch {
      /* Offline/startup is allowed. The chamber should still render. */
    } finally {
      polling = false;
    }
  }

  window.omegaLiveBridge = {
    currentSession,
    hydrateSession,
    pollEvents,
    sendIntent(intent) {
      return request("POST", "/api/os/intent", { intent });
    },
  };

  window.pickOmegaReply = liveReply;
  window.omegaLatency = () => 450;
  window.omegaReactToInput = function liveReactToInput(userText) {
    /* In live mode OmegaClaw emits its own surface/chat events. The mock
       surface planner must not impersonate Omega after user input. */
  };

  hydrateSession();
  pollEvents();
  setInterval(pollEvents, POLL_MS);
})();
