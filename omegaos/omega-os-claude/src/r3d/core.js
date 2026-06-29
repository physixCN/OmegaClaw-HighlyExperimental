/* src/r3d/core.js — Omega's body, hidden for now.

   The viewer is at the centre of the chamber (camera at origin)
   surrounded by a sea of atoms. The orb is not visible in this
   "sea" state — the user IS where the orb would be.

   The collapse animation (atoms condensing onto a central sphere
   to form Omega's body) will bring the orb back in a later pass.
   For now this module is a no-op stub that other code can still
   call (dispose / update) without crashing. */

(function () {
  function createCoreSphere(_scene) {
    return {
      dispose() {},
      update() {},
      group: null,
    };
  }
  window.omegaR3D = window.omegaR3D || {};
  window.omegaR3D.createCoreSphere = createCoreSphere;
})();
