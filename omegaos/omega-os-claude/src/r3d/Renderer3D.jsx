/* src/r3d/Renderer3D.jsx — React wrapper for the WebGL renderer.

   Mounts a fullscreen canvas when enabled; tears down the scene
   cleanly when disabled. The scene lives in src/r3d/scene.js;
   this file is the React boundary so the WebGL substrate can be
   toggled on/off from the Tweaks panel without touching the host
   tree.

   Pointer events disabled so the canvas doesn't intercept clicks
   destined for the room / windows / ridge during the side-by-side
   development phase. */

const Renderer3D = function Renderer3D({ enabled }) {
  const canvasRef = React.useRef(null);
  const [threeReady, setThreeReady] = React.useState(typeof window.THREE !== "undefined");

  /* Lazily load Three.js once, the first time the WebGL renderer is
     enabled. Using a dynamic <script> here (instead of a <script> in
     index.html) means the rest of the app loads even if the CDN is
     slow or unreachable. The 2.5D renderer keeps working in that
     case; only the WebGL substrate is unavailable. */
  React.useEffect(() => {
    if (!enabled) return;
    if (typeof window.THREE !== "undefined") {
      setThreeReady(true);
      return;
    }
    if (window.__omegaThreeLoading) {
      window.__omegaThreeLoading.then(() => setThreeReady(true));
      return;
    }
    window.__omegaThreeLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = (e) => {
        console.warn("[Renderer3D] Three.js failed to load from CDN", e);
        reject(e);
      };
      document.head.appendChild(s);
    });
    window.__omegaThreeLoading.then(() => setThreeReady(true)).catch(() => {});
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled || !threeReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!window.omegaR3D || !window.omegaR3D.createOmegaScene) {
      console.warn("[Renderer3D] omegaR3D.createOmegaScene not loaded");
      return;
    }
    const handle = window.omegaR3D.createOmegaScene(canvas);
    /* Expose the live handle for dev-console probes. */
    window.omegaR3D.__sceneHandle = handle;
    return () => { handle.dispose(); };
  }, [enabled, threeReady]);

  if (!enabled) return null;
  return (
    <canvas
      ref={canvasRef}
      className="omega-3d-canvas"
      aria-hidden="true"
    />
  );
};

window.Renderer3D = Renderer3D;
