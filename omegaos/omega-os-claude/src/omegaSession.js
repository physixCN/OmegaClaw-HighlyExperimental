/* omegaSession.js — the OBSERVER's session, NOT Omega's state.

   Deliberately separate from omegaState (which is "what Omega IS"):
   Omega runs whether or not anyone is watching (Evolution Plan §15 —
   "the room reflects her, not the observer"). A session only governs
   the HUMAN's ability to interact — to cross the membrane and talk to
   her. Logging in changes nothing about Omega; it changes what *we* can
   reach.

   ── THE LIVE-AUTH SEAM ──────────────────────────────────────────────
   This is the one swap point. The webhost backend has Google + Apple
   OAuth prepared; when it's connected, the real token exchange returns a
   profile and calls signIn(profile). Nothing else in the app knows or
   cares whether that profile came from real OAuth or this mock roster —
   exactly the "mock behind live shapes" discipline. (Plan §21.2.)

   Published store, pub/sub like omegaState / omegaEvents / omegaIntents. */

(function () {
  const STORE_KEY = "omega.session.v1";
  /* One device per person; each signs in once and stays in for 14 days. */
  const SESSION_MS = 14 * 24 * 60 * 60 * 1000;

  /* The family roster. The provider binding is a stand-in ASSUMPTION
     (trivially changed): real OAuth reports the provider + profile per
     account. Hues are drawn from the chamber's atom palette so each
     person reads as a coloured presence. */
  const ROSTER = [
    { id: "operator",   name: "OmegaOS Lab", first: "Operator",   role: "admin",  provider: "google", hue: 150, email: "user@example.test" },
    { id: "family-a", name: "Family Member A",     first: "Family Member A", role: "family", provider: "google", hue: 305, email: "user@example.test" },
    { id: "family-b",  name: "Family Member B",      first: "Family Member B",  role: "family", provider: "google", hue: 35,  email: "user@example.test" },
    { id: "family-c", name: "Family Member C",     first: "Family Member C", role: "family", provider: "apple",  hue: 215, email: "user@example.test" },
    { id: "family-d",  name: "Family Member D",      first: "Family Member D",  role: "family", provider: "apple",  hue: 265, email: "user@example.test" },
  ];
  /* The account bound to each provider on a given device (no sharing, so
     one each). The prototype defaults to the owner for Google and a family
     member for Apple; real OAuth simply returns whoever's account it is. */
  const PRIMARY = { google: "operator", apple: "family-c" };

  let user = null;
  const subs = new Set();

  /* Rehydrate a persisted session so a refresh keeps you in. Sessions
     last 14 days; an older one is dropped so you sign in fresh. */
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const u = JSON.parse(raw);
      if (u && u.since && (Date.now() - u.since) < SESSION_MS) user = u;
      else localStorage.removeItem(STORE_KEY);
    }
  } catch (e) { /* private mode / disabled storage — fine, start signed-out */ }

  function persist() {
    try {
      if (user) localStorage.setItem(STORE_KEY, JSON.stringify(user));
      else localStorage.removeItem(STORE_KEY);
    } catch (e) { /* ignore */ }
  }
  function fire() { for (const fn of subs) { try { fn(user); } catch (e) { /* never break the bus */ } } }

  window.omegaSession = {
    get user() { return user; },
    get signedIn() { return !!user; },
    get roster() { return ROSTER; },
    /* People who'd authenticate through a given provider. Pass nothing for
       the whole roster. */
    rosterFor(provider) { return ROSTER.filter((p) => !provider || p.provider === provider); },
    /* The single account bound to a provider on this device (no sharing). */
    primaryFor(provider) { return ROSTER.find((p) => p.id === PRIMARY[provider]) || ROSTER.filter((p) => p.provider === provider)[0] || null; },
    byId(id) { return ROSTER.find((p) => p.id === id) || null; },
    get sessionDays() { return Math.round(SESSION_MS / 86400000); },

    /* THE SEAM. Real Google/Apple OAuth hands a profile here:
       signIn({ id, name, first, role, provider, hue, ...claims }).
       Mock today; the backend swap touches only this call. */
    signIn(profile) {
      if (!profile) return;
      user = { ...profile, since: Date.now() };
      persist();
      fire();
    },
    signOut() {
      if (!user) return;
      user = null;
      persist();
      fire();
    },
    /* Per-user preferences — the seed Settings will read/write. Persisted
       on the user object (so they ride the 14-day session). */
    setPref(key, val) {
      if (!user) return;
      user = { ...user, prefs: { ...(user.prefs || {}), [key]: val } };
      persist();
      fire();
    },
    /* Whole days remaining in the 14-day session. */
    daysLeft() {
      if (!user || !user.since) return Math.round(SESSION_MS / 86400000);
      return Math.max(0, Math.ceil((SESSION_MS - (Date.now() - user.since)) / 86400000));
    },

    /* subscribe fires immediately with the current user so callers sync
       without waiting for the next change. */
    subscribe(fn) {
      subs.add(fn);
      try { fn(user); } catch (e) { /* ignore */ }
      return () => subs.delete(fn);
    },
  };
})();
