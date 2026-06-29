/* src/r3d/bloom.js — additive SELECTIVE bloom overlay.

   Goal (handoff task 3): make every atom read as a real light
   source, and let the comet's bright reflected highlights glow —
   WITHOUT disturbing the chamber's carefully-tuned ACES tone-
   mapping pipeline.

   Why not EffectComposer/UnrealBloomPass + OutputPass? Those move
   tone-mapping + colour-space conversion to the END of the chain,
   which would re-tonemap the whole frame and break the per-material
   `toneMapped:false` trick the atom shells rely on to keep their
   pure fluorescent hues. So instead this is a self-contained
   additive overlay that never touches the main render:

     loop():
       renderer.render(scene, camera)   // untouched main image → canvas
       bloom.render()                   // adds glow ON TOP

   bloom.render():
     1. CAPTURE — render the scene with the camera restricted to the
        BLOOM layer, into a half-res HDR target. Only objects that
        opted in (atom cores + the comet) draw; everything else is
        black. Render targets aren't tone-mapped (r152+), so the
        emitters land here in linear HDR — brighter than 1.0, great
        bloom fuel.
     2. EXTRACT — soft-threshold highpass so only genuinely bright
        pixels (core points, hot chrome highlights) survive; dim
        chrome reflecting the void is cut.
     3. BLUR — separable Gaussian, ping-pong, widening each
        iteration for a soft volumetric spread.
     4. COMPOSITE — draw the blurred glow additively over the canvas
        (autoClear off, AdditiveBlending) so it only ever brightens.

   Everything runs through ONE shared window.THREE instance (the UMD
   build the rest of src/r3d uses) — no ESM/importmap duality. */

(function () {
  const VERT = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  /* Soft-threshold highpass. Uses the MAX channel (HSV "value") as
     the brightness metric, not luma — luma is hue-weighted and would
     starve red/blue emitters of bloom while over-blooming green. A
     hue-fair metric lets every family colour glow equally. */
  const EXTRACT_FRAG = `
    uniform sampler2D tSrc;
    uniform float threshold;
    uniform float knee;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tSrc, vUv);
      float v = max(max(c.r, c.g), c.b);
      /* smooth knee around the threshold */
      float soft = clamp(v - threshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee + 1e-5);
      float contrib = max(soft, v - threshold) / max(v, 1e-5);
      gl_FragColor = vec4(c.rgb * contrib, 1.0);
    }
  `;

  /* Separable 9-tap Gaussian. `direction` already carries the texel
     size × per-iteration spread. */
  const BLUR_FRAG = `
    uniform sampler2D tSrc;
    uniform vec2 direction;
    varying vec2 vUv;
    void main() {
      vec4 sum = vec4(0.0);
      sum += texture2D(tSrc, vUv + direction * -4.0) * 0.0162;
      sum += texture2D(tSrc, vUv + direction * -3.0) * 0.0540;
      sum += texture2D(tSrc, vUv + direction * -2.0) * 0.1216;
      sum += texture2D(tSrc, vUv + direction * -1.0) * 0.1946;
      sum += texture2D(tSrc, vUv                    ) * 0.2270;
      sum += texture2D(tSrc, vUv + direction *  1.0) * 0.1946;
      sum += texture2D(tSrc, vUv + direction *  2.0) * 0.1216;
      sum += texture2D(tSrc, vUv + direction *  3.0) * 0.0540;
      sum += texture2D(tSrc, vUv + direction *  4.0) * 0.0162;
      gl_FragColor = sum;
    }
  `;

  /* Composite — additive, with a hue-preserving HDR shoulder (§27g/h):
     the bloom's max-channel ≤0.5 passes untouched, above that it
     compresses toward an asymptote of 1.0 with ALL THREE channels
     scaled together — the glow keeps its hue and a near atom's HDR
     flare can't balloon into a screen-eating blob. Blending stayed
     ADDITIVE (a screen-blend variant was tried and muted the colour
     of bright reflections on the comet's chrome — reverted). */
  const COMPOSITE_FRAG = `
    uniform sampler2D tBloom;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tBloom, vUv).rgb * strength;
      float m = max(c.r, max(c.g, c.b));
      if (m > 0.5) {
        float x = 2.0 * (m - 0.5);
        float m2 = 0.5 + 0.5 * x / (1.0 + x);   // shoulder: ≤0.5 linear → asymptote 1.0
        c *= m2 / m;                             // scale all channels together — hue kept
      }
      gl_FragColor = vec4(c, 1.0);
    }
  `;

  function createBloom(renderer, scene, camera, opts) {
    const THREE = window.THREE;
    if (!THREE) return { render() {}, setSize() {}, dispose() {}, layer: 1 };

    const o = opts || {};
    const BLOOM_LAYER = o.layer != null ? o.layer : 1;
    const OCCLUDER_LAYER = o.occluderLayer != null ? o.occluderLayer : 2;
    /* Layer carrying ATOM-body depth for the depth-aware mask (the atom
       shells are opted onto it in scene.js). */
    const MASK_DEPTH_LAYER = o.maskDepthLayer != null ? o.maskDepthLayer : 3;
    const SCALE       = o.scale != null ? o.scale : 0.5;   // half-res
    const ITERATIONS  = o.iterations != null ? o.iterations : 5;

    /* Depth-only material for laying opaque occluders (the comet)
       into the capture depth buffer so emitter glow behind them is
       z-culled. colorWrite off → writes depth, not colour. */
    const occluderMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    /* (maskMat removed — the flat silhouette stencil is gone; capture-
       stage depth occlusion does the work.) */

    /* HDR float targets where available so emitters keep values
       above 1.0 through the blur (richer, non-clipped glow). */
    const halfFloat =
      (renderer.capabilities && renderer.capabilities.isWebGL2) ||
      (renderer.extensions && renderer.extensions.get("OES_texture_half_float"));
    const TEX_TYPE = halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;

    function makeRT(w, h) {
      return new THREE.WebGLRenderTarget(w, h, {
        type: TEX_TYPE,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,   // capture needs depth for the comet
        stencilBuffer: false,
      });
    }

    let rtBright = makeRT(2, 2);   // emitter capture (with depth)
    let rtA = makeRT(2, 2);        // ping
    let rtB = makeRT(2, 2);        // pong
    rtA.depthBuffer = false;
    rtB.depthBuffer = false;
    let bw = 2, bh = 2;

    /* ── Fullscreen-quad rig ─────────────────────────────────── */
    const quadScene = new THREE.Scene();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeom = new THREE.PlaneGeometry(2, 2);

    const extractMat = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: null },
        threshold: { value: o.threshold != null ? o.threshold : 0.30 },
        knee: { value: o.knee != null ? o.knee : 0.35 },
      },
      vertexShader: VERT,
      fragmentShader: EXTRACT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: null },
        direction: { value: new THREE.Vector2() },
      },
      vertexShader: VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tBloom: { value: null },
        strength: { value: o.strength != null ? o.strength : 1.0 },
      },
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      transparent: true,
      /* ADDITIVE restored (§27h — the screen blend muted the colour-fire
         of bright reflections on the comet's chrome; the user preferred
         the old look). The shoulder in COMPOSITE_FRAG stays: bloom is
         capped ≤1×strength with hue preserved, which alone kills the
         screen-eating HDR flares without dulling bright-over-bright. */
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(quadGeom, extractMat);
    quad.frustumCulled = false;
    quadScene.add(quad);

    const _col = new THREE.Color();
    function blit(material, target, clear) {
      quad.material = material;
      renderer.setRenderTarget(target || null);
      if (clear) renderer.clear();
      renderer.render(quadScene, quadCam);
    }

    function setSize(width, height) {
      bw = Math.max(2, Math.round(width * SCALE));
      bh = Math.max(2, Math.round(height * SCALE));
      rtBright.setSize(bw, bh);
      rtA.setSize(bw, bh);
      rtB.setSize(bw, bh);
    }

    function render() {
      if (!camera || !scene) return;
      const camMask     = camera.layers.mask;
      const oldTarget   = renderer.getRenderTarget();
      const oldAutoClear = renderer.autoClear;
      const oldClear     = renderer.getClearColor(_col).clone();
      const oldAlpha     = renderer.getClearAlpha();

      /* 1 ── capture emitters on the bloom layer into rtBright.
         First lay opaque OCCLUDERS (the comet) into the depth buffer,
         colour-masked, so emitter glow HIDDEN BEHIND the comet is
         z-culled — the comet then truly blocks the atoms behind it
         instead of the additive overlay painting their glow over the
         chrome. */
      renderer.setRenderTarget(rtBright);
      renderer.setClearColor(0x000000, 1);
      renderer.autoClear = true;
      renderer.clear();                        // clears colour + depth
      renderer.autoClear = false;              // keep occluder depth below
      const prevOverride = scene.overrideMaterial;
      scene.overrideMaterial = occluderMat;    // depth-only
      camera.layers.set(OCCLUDER_LAYER);
      renderer.render(scene, camera);
      scene.overrideMaterial = prevOverride;
      camera.layers.set(BLOOM_LAYER);          // emitters, depth-tested
      renderer.render(scene, camera);
      camera.layers.mask = camMask;

      /* From here the quad passes don't want auto-clear surprises. */
      renderer.autoClear = false;

      /* 2 ── extract bright → rtA. */
      extractMat.uniforms.tSrc.value = rtBright.texture;
      blit(extractMat, rtA, true);

      /* 3 ── separable Gaussian ping-pong, widening each pass. */
      let src = rtA, dst = rtB;
      const texelX = 1 / bw, texelY = 1 / bh;
      for (let i = 0; i < ITERATIONS; i++) {
        const spread = 1.0 + i;   // 1,2,3,… texels — grows the radius
        // horizontal
        blurMat.uniforms.tSrc.value = src.texture;
        blurMat.uniforms.direction.value.set(texelX * spread, 0);
        blit(blurMat, dst, true);
        let tmp = src; src = dst; dst = tmp;
        // vertical
        blurMat.uniforms.tSrc.value = src.texture;
        blurMat.uniforms.direction.value.set(0, texelY * spread);
        blit(blurMat, dst, true);
        tmp = src; src = dst; dst = tmp;
      }
      // final blurred bloom lives in `src`

      /* (Silhouette mask removed.) The comet's real occlusion already
         happens at the CAPTURE stage above — she's drawn into the bloom
         depth buffer as a solid occluder, so atom glow physically BEHIND
         her is z-culled before the blur. The old flat silhouette stencil
         was a crude extra that ignored depth for the glow SPREAD, biting
         comet-tail-shaped chunks out of atoms in FRONT of her (the "wake
         mask that doesn't fit"). Gone — depth does the work now. */

      /* 4 ── composite additively over the canvas (no clear). */
      renderer.setRenderTarget(oldTarget);
      compositeMat.uniforms.tBloom.value = src.texture;
      quad.material = compositeMat;
      renderer.render(quadScene, quadCam);

      /* restore renderer state for the next main frame. */
      renderer.autoClear = oldAutoClear;
      renderer.setClearColor(oldClear, oldAlpha);
      renderer.setRenderTarget(oldTarget);
    }

    function dispose() {
      rtBright.dispose(); rtA.dispose(); rtB.dispose();
      quadGeom.dispose();
      occluderMat.dispose();
      extractMat.dispose(); blurMat.dispose(); compositeMat.dispose();
    }

    return {
      render, setSize, dispose,
      layer: BLOOM_LAYER,
      get strength() { return compositeMat.uniforms.strength.value; },
      set strength(v) { compositeMat.uniforms.strength.value = v; },
      get threshold() { return extractMat.uniforms.threshold.value; },
      set threshold(v) { extractMat.uniforms.threshold.value = v; },
    };
  }

  window.omegaR3D = window.omegaR3D || {};
  window.omegaR3D.createBloom = createBloom;
})();
