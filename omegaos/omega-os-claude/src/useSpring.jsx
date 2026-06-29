/* useSpring.jsx — a tiny RAF-driven spring hook.
   Returns the animated value chasing `target`. Underdamped by default,
   automatically critically-damped under prefers-reduced-motion so the
   value still ends up where it should without visual oscillation. */

(function () {
  function useSpring(target, opts) {
    opts = opts || {};
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const stiffness = opts.stiffness != null ? opts.stiffness : 170;
    const damping   = opts.damping   != null ? opts.damping
                       : (reduce ? 40 : 22);
    const mass      = opts.mass      != null ? opts.mass : 1;
    const precision = opts.precision != null ? opts.precision : 0.02;

    const [value, setValue] = React.useState(target);
    const state = React.useRef({ value: target, velocity: 0 });

    React.useEffect(() => {
      let raf;
      let last = performance.now();
      const step = (now) => {
        const dt = Math.min(0.064, (now - last) / 1000);
        last = now;
        const s = state.current;
        const spring = -stiffness * (s.value - target);
        const damp   = -damping   * s.velocity;
        const acc    = (spring + damp) / mass;
        s.velocity += acc * dt;
        s.value    += s.velocity * dt;
        setValue(s.value);
        if (
          Math.abs(s.velocity) < precision &&
          Math.abs(s.value - target) < precision
        ) {
          s.value = target;
          s.velocity = 0;
          setValue(target);
          return;
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }, [target, stiffness, damping, mass, precision]);

    return value;
  }

  window.useSpring = useSpring;
})();
