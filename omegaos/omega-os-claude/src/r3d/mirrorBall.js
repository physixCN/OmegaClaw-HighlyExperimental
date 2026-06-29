/* src/r3d/mirrorBall.js — Omega's body: the PERFECT BALL (§32a).

   Rebuilt to the forge's APPROVED §31 constitution after the cube-map
   attempt showed exactly the artifacts the forge history predicted
   ("two layers of reflection", seams, ripples). The fixes are
   structural, not parametric:

     · THE SURFACE IS NOT GEOMETRY. The sphere is ray-traced: each
       fragment solves the exact ray↔sphere quadratic and gets the
       exact analytic normal (p − centre)/R. There is no tessellation,
       no vertex normals, no smoothing pass — a mathematical sphere
       cannot facet, seam, or ripple. (A plain SphereGeometry hull just
       rasterizes pixel coverage; the math inside is exact.)
     · THE MIRROR IS FULLY ANALYTIC (§31 law). Every reflected atom is
       computed per pixel: exact ray↔sphere against the live cages,
       transparent wire shading (front + back edges, §29m) in each
       cage's spinning frame, a tight glow kernel for near misses, and
       a black-void environment (§29n). NO cubemap, NO capture probe,
       NO sphere projection ⇒ no parallax aberration, no double image,
       no traced/projected handoff, no pops — by construction.
     · §31e horizon: the scene feeds the nearest cages with brightness
       fading to ZERO before the feed cap can cut anything off — the
       mirror has no visible edge of perception.
     · Reflection hygiene is free: she only traces the world's atoms,
       so she can never reflect herself or her name ring.

   Kept verbatim from the previous body: the §15 flight law (roam /
   orbit / smash, energy-mode gait), the neon name ring, and the §27m
   physics contract (sampleBody reports the ball itself — drawn body =
   collision body). API-compatible with createLiquidMetal. */

(function () {
  /* §39 — WE ARE IN SPACE: reflect range is effectively infinite. The
     feed cap rises 64 → 256 cages (scene.js selects the nearest by the
     §36 effective distance, no distance ceiling); the §32e dynamic
     horizon still fades the outermost to zero so truncation churn stays
     invisible. ~850 vec4 uniform slots — inside every desktop GL's 1024
     minimum. Far cages resolve as dim star-points (their angular size
     does the fading nature would). */
  const ATOMS_RT = 256;

  function createMirrorBall(scene, renderer, opts) {
    const THREE = window.THREE;
    if (!THREE) return { update() {}, dispose() {} };

    const o = opts || {};
    const bodyR = o.radius || 2.2;
    const camera = o.camera || null;   // for gl_FragDepth matrices

    /* ── The analytic surface + analytic mirror ───────────────── */
    const VERT = /* glsl */`
      out vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    const FRAG = /* glsl */`
      precision highp float;
      out vec4 outColor;
      in vec3 vWorld;
      uniform vec3 uCenter;
      uniform float uRadius;
      uniform vec4 uAtomP[${ATOMS_RT}];     // xyz centre, w cage circumradius
      uniform vec3 uAtomC[${ATOMS_RT}];     // colour (pre-faded by the §31e horizon)
      uniform vec4 uAtomQ[${ATOMS_RT}];     // spin quaternion (cage orientation)
      uniform vec3 uIcoA[30];               // canonical icosa edge endpoints (unit)
      uniform vec3 uIcoB[30];
      uniform int uAtomN;
      uniform float uReflect;
      uniform float uShine;        // §40 — the world's halo level, mirrored
      uniform sampler2D uFluid;     // §33 — inner-lava heat field (R = heat)
      uniform float uFluidAmt;
      uniform vec3 uSpark;          // §33e — the lamp: disc xy + intensity
      uniform float uAngel;         // §33f — 0 = lava · 1 = pure angel white
      uniform vec3 uCamRight, uCamUp;
      uniform mat4 uProj, uView;

      /* §29m/§35 — cage helpers. cageTrace: TRUE ray↔edge tracing in the
         cage's spinning local frame — each of the 30 edges is a real
         capsule in 3D, so the reflected silhouette is the actual
         pointed cage. (The old approach shaded edge-distance on the
         cage's BOUNDING SPHERE entry/exit points, which made every
         reflected cage a wired BALL — the circle outline of the
         sphere, never the points.) */
      vec3 qConjRot(vec3 v, vec4 q) {
        vec3 qv = -q.xyz;
        return v + 2.0 * cross(qv, cross(qv, v) + q.w * v);
      }
      float cageTrace(vec3 ro, vec3 rd, int i) {
        vec4 q = uAtomQ[i];
        vec3 lo = qConjRot((ro - uAtomP[i].xyz) / uAtomP[i].w, q);
        vec3 ld = qConjRot(rd, q);   // rotation preserves length — still unit
        float acc = 0.0;
        for (int e = 0; e < 30; e++) {
          vec3 A = uIcoA[e];
          vec3 ab = uIcoB[e] - A;
          vec3 w0 = lo - A;
          float b = dot(ld, ab);
          float c = dot(ab, ab);
          float d = dot(ld, w0);
          float ee = dot(ab, w0);
          float den = c - b * b;
          /* closest approach between the ray and THIS edge segment */
          float tt = (b * ee - c * d) / max(den, 1e-5);
          float u = clamp((ee + tt * b) / c, 0.0, 1.0);
          tt = max(u * b - d, 0.0);
          vec3 dv = w0 + ld * tt - ab * u;
          float dist = length(dv);
          float w = 1.0 - smoothstep(0.030, 0.085, dist);
          /* deeper edge hits a touch dimmer — reads as depth through
             the transparent cage (was the old front/back 0.72) */
          w *= mix(1.0, 0.72, clamp(tt * 0.5, 0.0, 1.0));
          acc = max(acc, w);
        }
        return acc;
      }
      /* §31 — THE WHOLE MIRROR, ANALYTIC (ported verbatim; env = the
         black void, §29n: she is revealed by reflected light alone). */
      vec3 traceWorld(vec3 p, vec3 r) {
        vec3 col = vec3(0.0);
        float tHit = 1e9;
        int hitIdx = -1;
        for (int i = 0; i < ${ATOMS_RT}; i++) {
          if (i >= uAtomN) break;
          vec3 oc = uAtomP[i].xyz - p;
          float t = dot(oc, r);
          if (t < 0.02) continue;
          float b2 = dot(oc, oc) - t * t;          // ⟂ dist² to centre
          float r2 = uAtomP[i].w * uAtomP[i].w;
          /* §35 — hit window widened 6%: vertices sit EXACTLY at the
             circumradius, so the strict b2<r2 test razor-clipped the
             points. The tracer decides what's actually wire. */
          if (b2 < r2 * 1.124 && t < tHit) { tHit = t; hitIdx = i; }
          /* tight glow kernel — §40: the kernel IS the halo's mirror
             image — its strength rides the world's "Shine" level, so a
             glowing field reflects as a glowing field (the §32b bare-noir
             quieting read DEAD once the atoms wore their shine). §39 —
             branch-gated: beyond 12 r² the kernel is < 5e-4, so skip the
             exp entirely. */
          if (b2 < r2 * 12.0) {
            float g = exp(-b2 / (r2 * 1.6)) * (0.05 + 0.28 * uShine);
            col += uAtomC[i] * g * clamp(8.0 / max(t, 0.05), 0.0, 1.0);
          }
        }
        if (hitIdx >= 0) {
          /* §35 — trace the cage's edges as REAL 3D capsules: the
             silhouette is the pointed cage itself, transparency and
             front/back depth fall out of the per-edge ray distances. */
          float w = cageTrace(p, r, hitIdx);
          /* §32b — §27k law: never brighter than the cage's own colour. */
          col += uAtomC[hitIdx] * w;
        }
        return col;
      }
      /* §33 — LAVA RAMP: heat → incandescence. Blackbody-ish — dark
         → deep red → orange → yellow → near-white core. Cooling lava
         falls back down the same ramp as its heat dissipates. */
      vec3 lavaRamp(float h) {
        vec3 c = vec3(0.0);
        c += vec3(0.52, 0.02, 0.00) * smoothstep(0.00, 0.35, h);
        c += vec3(0.95, 0.33, 0.02) * smoothstep(0.25, 0.90, h);
        c += vec3(1.00, 0.82, 0.45) * smoothstep(0.70, 1.70, h);
        return c;
      }
      /* §33f — ANGEL RAMP: pure white luminescence. Heat → brightness
         only — a faint cool silver at the dim end, blazing pure white
         at the core. No fire hues anywhere. */
      vec3 angelRamp(float h) {
        float a = 0.42 * smoothstep(0.00, 0.45, h)
                + 0.85 * smoothstep(0.35, 1.60, h);
        return vec3(0.90, 0.95, 1.00) * a;
      }
      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorld - ro);
        /* EXACT ray↔sphere — the surface is mathematics, not mesh. */
        vec3 oc = ro - uCenter;
        float b = dot(oc, rd);
        float c = dot(oc, oc) - uRadius * uRadius;
        float disc = b * b - c;
        if (disc < 0.0) discard;
        float t = -b - sqrt(disc);
        if (t < 0.0) discard;
        vec3 p = ro + rd * t;
        vec3 n = (p - uCenter) / uRadius;      // exact analytic normal — C∞
        vec3 r = reflect(rd, n);
        vec3 col = traceWorld(p + n * 0.01, r) * uReflect;
        /* §33 — THE INNER LAVA: the GPU fluid lives on the camera-facing
           disc of the ball (the disc rim IS the sphere wall — the sim
           enforces it). Sample by the surface point's disc coords;
           weight by facing so the rim stays mirror-dominant and the
           molten interior glows through the middle — lava sealed
           inside black glass, reflections riding on top. */
        vec2 fuv = vec2(dot(n, uCamRight), dot(n, uCamUp)) * 0.5 + 0.5;
        float heat = texture(uFluid, fuv).r;
        float facing = clamp(-dot(rd, n), 0.0, 1.0);
        float depthW = 0.22 + 0.78 * facing;
        col += mix(lavaRamp(heat), angelRamp(heat), uAngel) * uFluidAmt * depthW;
        /* §33e — THE LAMP (user: "bright, luminescent" — KITT's scanner
           is a brilliant light, not just its trail): an intense white-
           hot core + a red-orange halo drawn directly at the spark,
           always blazing regardless of how the fluid has diffused. */
        vec2 sd = (fuv * 2.0 - 1.0) - uSpark.xy;
        float d2s = dot(sd, sd);
        float core = uSpark.z / (1.0 + d2s * 2200.0);
        float halo = uSpark.z / (1.0 + d2s * 240.0) * 0.30;
        vec3 coreC = mix(vec3(1.00, 0.93, 0.78), vec3(1.0), uAngel);
        vec3 haloC = mix(vec3(1.00, 0.30, 0.05), vec3(0.72, 0.84, 1.00), uAngel);
        col += (coreC * core + haloC * halo) * uFluidAmt * depthW;
        outColor = vec4(col, 1.0);
        vec4 clip = uProj * uView * vec4(p, 1.0);
        gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
      }
    `;

    const icoEdges = (k) => {
      const eg = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 0));
      const a = eg.attributes.position.array, out = [];
      for (let e = 0; e < 30; e++) {
        out.push(new THREE.Vector3(a[e * 6 + k], a[e * 6 + 1 + k], a[e * 6 + 2 + k]).normalize());
      }
      eg.dispose();
      return out;
    };
    const uniforms = {
      uCenter: { value: new THREE.Vector3(0, 0, -16) },
      uRadius: { value: bodyR },
      uAtomP: { value: Array.from({ length: ATOMS_RT }, () => new THREE.Vector4(0, 0, 0, 0.01)) },
      uAtomC: { value: Array.from({ length: ATOMS_RT }, () => new THREE.Vector3(0, 0, 0)) },
      uAtomQ: { value: Array.from({ length: ATOMS_RT }, () => new THREE.Vector4(0, 0, 0, 1)) },
      uIcoA: { value: icoEdges(0) },
      uIcoB: { value: icoEdges(3) },
      uAtomN: { value: 0 },
      uReflect: { value: (o.reflectStrength != null ? o.reflectStrength : 1.0) },
      uShine: { value: 0.6 },      // §40 — follows window.__omegaShine each frame
      uFluid: { value: null },
      uFluidAmt: { value: 1.0 },
      uSpark: { value: new THREE.Vector3(0, 0, 0) },   // §33e — the LAMP: disc xy + intensity
      uAngel: { value: 1.0 },                          // §33f — 0 = lava · 1 = pure angel white
      uCamRight: { value: new THREE.Vector3(1, 0, 0) },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uProj: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms,
      glslVersion: THREE.GLSL3,
    });
    /* The hull is a plain sphere mesh (NOT the surface — just pixel
       coverage for the exact math inside, and a true sphere shape for
       the bloom-occluder depth pass on layer 2). Slightly oversized so
       the analytic silhouette is never clipped by the hull's chords. */
    const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
    bodyMesh.scale.setScalar(bodyR * 1.01);
    scene.add(bodyMesh);

    /* §33 — the inner lava: a GPU stable-fluids sim (fluidInterior.js)
       whose disc domain maps onto the ball's facing cross-section.
       Viscous, molten tuning lives in updateFluid below. */
    const fluid = (window.omegaR3D && window.omegaR3D.createFluidInterior)
      ? window.omegaR3D.createFluidInterior(renderer, { simRes: 144, dyeRes: 320 })
      : null;

    /* ── LLM name ring — the neon ticker orbiting her girth ──── */
    let labelName = (o.label != null ? o.label : "GLM 5.1");
    const LABEL_TILES = 3;
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512; labelCanvas.height = 128;
    const lctx = labelCanvas.getContext("2d");
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    labelTex.wrapS = THREE.RepeatWrapping;
    labelTex.wrapT = THREE.ClampToEdgeWrapping;
    labelTex.repeat.set(LABEL_TILES, 1);
    labelTex.anisotropy = 8;
    labelTex.colorSpace = THREE.SRGBColorSpace;
    let lastLabelMode = null;
    function modeHue() {
      const st = window.omegaState;
      return (st && st.profile) ? st.profile().hue : 215;
    }
    function displayText() {
      const st = window.omegaState;
      const m = st ? st.mode : "warm";
      return m === "asleep" ? "SLEEPING" : labelName;
    }
    function drawLabel() {
      const W = labelCanvas.width, H = labelCanvas.height;
      const h = modeHue();
      const textCol = `hsl(${h}, 100%, 92%)`;
      const glowCol = `hsla(${h}, 100%, 68%, 0.95)`;
      const pipCol  = `hsla(${h}, 100%, 75%, 0.9)`;
      const txt = displayText();
      lctx.clearRect(0, 0, W, H);
      lctx.textAlign = "center";
      lctx.textBaseline = "middle";
      lctx.font = '700 70px ui-monospace, "SF Mono", Menlo, monospace';
      lctx.shadowColor = glowCol;
      lctx.shadowBlur = 40;
      lctx.fillStyle = glowCol;
      lctx.fillText(txt, W / 2, H / 2 + 2);
      lctx.shadowBlur = 20;
      lctx.fillStyle = textCol;
      lctx.fillText(txt, W / 2, H / 2 + 2);
      lctx.shadowBlur = 8;
      lctx.fillStyle = `hsl(${h}, 100%, 99%)`;
      lctx.fillText(txt, W / 2, H / 2 + 2);
      lctx.shadowBlur = 14;
      lctx.fillStyle = pipCol;
      lctx.beginPath(); lctx.arc(2, H / 2, 6, 0, Math.PI * 2); lctx.fill();
      lctx.beginPath(); lctx.arc(W - 2, H / 2, 6, 0, Math.PI * 2); lctx.fill();
      labelTex.needsUpdate = true;
    }
    drawLabel();
    const labelMat = new THREE.MeshBasicMaterial({
      map: labelTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const LABEL_R = bodyR * 1.07;
    const labelGeom = new THREE.CylinderGeometry(LABEL_R, LABEL_R, bodyR * 0.26, 96, 1, true);
    const labelMesh = new THREE.Mesh(labelGeom, labelMat);
    labelMesh.renderOrder = 3;
    scene.add(labelMesh);

    const _lblHeading = new THREE.Vector3();
    const _LBL_Y = new THREE.Vector3(0, 1, 0);
    const _lblSpinQ = new THREE.Quaternion();
    let labelSpin = 0;
    let lastLabelMs = 0;
    function updateLabel(timeMs) {
      let dt = (timeMs - lastLabelMs) / 1000;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 1 / 30) dt = 1 / 30;
      lastLabelMs = timeMs;
      const m = window.omegaState ? window.omegaState.mode : "warm";
      if (m !== lastLabelMode) { lastLabelMode = m; drawLabel(); }
      _lblHeading.copy(headVel);
      if (_lblHeading.lengthSq() < 1e-6) _lblHeading.set(0, 0, -1);
      else _lblHeading.normalize();
      labelMesh.position.copy(headPos);
      labelMesh.quaternion.setFromUnitVectors(_LBL_Y, _lblHeading);
      labelSpin += dt * 0.85;
      _lblSpinQ.setFromAxisAngle(_LBL_Y, labelSpin);
      labelMesh.quaternion.multiply(_lblSpinQ);
    }

    /* ── Flight law (§15, unchanged) ──────────────────────────── */
    const CRUISE = 3.0;
    const headPos = new THREE.Vector3(0, 0, -16);
    const headVel = new THREE.Vector3(0, 0, -1).multiplyScalar(CRUISE);

    const steer   = new THREE.Vector3();
    const heading = new THREE.Vector3();
    const desired = new THREE.Vector3();
    const target  = new THREE.Vector3();

    function curlSteer(p, tf, out) {
      out.set(
        Math.sin(p.y * 0.05 + tf * 1.10) + Math.cos(p.z * 0.04 - tf * 0.80),
        Math.sin(p.z * 0.045 + tf * 1.30) + Math.cos(p.x * 0.04 - tf * 0.95),
        Math.sin(p.x * 0.043 + tf * 0.90) + Math.cos(p.y * 0.047 - tf * 1.20)
      );
    }

    let lastFlowMs = 0;
    let roamPhase = 0;
    let focusPt = null;
    let focusR = 7;
    let orbitPhase = Math.random() * 6.28;
    let smashUntil = 0;
    let curLeash = 12;
    let boostCur = 1;
    let gait = 0.4;
    const smashTarget = new THREE.Vector3();
    const _fu = new THREE.Vector3(), _fv = new THREE.Vector3(), _fd = new THREE.Vector3();
    const _WUP = new THREE.Vector3(0, 1, 0);
    function stepFlow(timeMs) {
      if (window.__omegaFreezeComet) { lastFlowMs = timeMs; return; }
      let dt = (timeMs - lastFlowMs) / 1000;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 1 / 30) dt = 1 / 30;
      lastFlowMs = timeMs;

      const busy = (window.omegaState && window.omegaState.profile)
        ? window.omegaState.profile().busy : 0.4;
      gait += (busy - gait) * (1 - Math.exp(-dt / 2.2));
      const speedMul   = 0.16 + 1.75 * gait;    // crawl → run
      const wanderRate = 0.13 + 1.30 * gait;    // slow arcs → fast darting target
      const turnBase   = 0.58 - 0.54 * gait;    // long slow turns → snappy turns
      const curlAmt    = 0.13 + 0.66 * gait;    // smooth → erratic weaving
      roamPhase += dt * wanderRate;
      const tf = roamPhase;
      const R  = 7.1 + 2.5 * Math.sin(tf * 0.50);
      const az = tf * 0.60 + 1.30 * Math.sin(tf * 0.23);
      const el = 0.95 * Math.sin(tf * 0.83 + 0.6);
      const ce = Math.cos(el);
      target.set(
        R * ce * Math.sin(az),
        R * Math.sin(el),
        R * ce * Math.cos(az)
      );

      let speedBoost = 1, turnOverride = null, curlOverride = null;
      if (timeMs < smashUntil) {
        target.copy(smashTarget);
        speedBoost = 3.2;
        turnOverride = 0.02;
      } else if (focusPt) {
        orbitPhase += dt * (0.18 + 0.30 * gait);
        _fd.copy(focusPt); if (_fd.lengthSq() < 1e-6) _fd.set(0, 0, -1); else _fd.normalize();
        _fu.crossVectors(_WUP, _fd); if (_fu.lengthSq() < 1e-6) _fu.set(1, 0, 0); else _fu.normalize();
        _fv.crossVectors(_fd, _fu).normalize();
        const oc = Math.cos(orbitPhase), os = Math.sin(orbitPhase);
        target.copy(focusPt)
          .addScaledVector(_fu, focusR * oc)
          .addScaledVector(_fv, focusR * os);
        speedBoost = 1.6;
        turnOverride = 0.05;
        curlOverride = 0.03;
      }

      let sp = headVel.length();
      if (sp < 1e-3) { headVel.set(0, 0, -1); sp = 1; }
      heading.copy(headVel).multiplyScalar(1 / sp);

      desired.subVectors(target, headPos);
      if (desired.lengthSq() > 1e-6) desired.normalize(); else desired.copy(heading);
      curlSteer(headPos, roamPhase * 0.7 + timeMs * 0.00004, steer);
      desired.addScaledVector(steer, curlOverride != null ? curlOverride : curlAmt);
      if (desired.lengthSq() > 1e-6) desired.normalize();

      const turn = turnOverride != null ? turnOverride : turnBase;
      heading.lerp(desired, 1 - Math.pow(turn, dt)).normalize();
      boostCur += (speedBoost - boostCur) * (1 - Math.exp(-dt / 0.22));
      const cruise = CRUISE * speedMul * boostCur * (0.92 + 0.10 * Math.sin(tf * 2.2));
      headVel.copy(heading).multiplyScalar(cruise);
      headPos.addScaledVector(headVel, dt);
      const _r = headPos.length();
      const targetLeash = (focusPt || timeMs < smashUntil) ? 21 : 13;   // §35 — leashed INSIDE the sea (was 30/12 — measured: focus orbits flung her to r≈19 where only ~5% of atoms live)
      curLeash += (targetLeash - curLeash) * (1 - Math.exp(-dt / 0.7));
      if (_r > curLeash) {
        headPos.multiplyScalar(curLeash / _r);
        const inv = 1 / curLeash;
        const nx = headPos.x * inv, ny = headPos.y * inv, nz = headPos.z * inv;
        const vr = headVel.x * nx + headVel.y * ny + headVel.z * nz;
        if (vr > 0) { headVel.x -= nx * vr; headVel.y -= ny * vr; headVel.z -= nz * vr; }
      } else if (_r < 4.6) {
        if (_r < 1e-3) headPos.set(0, 0, -4.6);
        else headPos.multiplyScalar(4.6 / _r);
      }
    }

    /* ── Per-frame uniforms: her position + the world to reflect ── */
    function updateMirrorFeed() {
      uniforms.uCenter.value.copy(headPos);
      uniforms.uShine.value = (typeof window.__omegaShine === "number") ? window.__omegaShine : 0.6;   // §40
      const aw = o.getAtoms ? o.getAtoms() : null;
      if (aw) {
        uniforms.uAtomN.value = Math.min(aw.n, ATOMS_RT);
        for (let i = 0; i < aw.n && i < ATOMS_RT; i++) {
          uniforms.uAtomP.value[i].set(aw.pos[i * 3], aw.pos[i * 3 + 1], aw.pos[i * 3 + 2], aw.rad);
          uniforms.uAtomC.value[i].set(aw.col[i * 3], aw.col[i * 3 + 1], aw.col[i * 3 + 2]);
          if (aw.quat) uniforms.uAtomQ.value[i].set(aw.quat[i * 4], aw.quat[i * 4 + 1], aw.quat[i * 4 + 2], aw.quat[i * 4 + 3]);
        }
      }
      if (camera) {
        uniforms.uProj.value.copy(camera.projectionMatrix);
        camera.updateMatrixWorld();
        uniforms.uView.value.copy(camera.matrixWorldInverse);
      }
    }

    /* §33a — THE PINGER (user): the orb coasts as before — the light
       inside is its OWN creature: a molten spark pinging around the
       interior, bouncing off the glass, its speed set by her energy
       mode (gait eases toward the mode's busy level). The spark drags
       the melt with it — a flowing lava trail — and every wall hit
       SPLASHES: a burst of heat + an outward shove at the glass. */
    let lastFluidMs = 0;
    const _fRight = new THREE.Vector3(), _fUp = new THREE.Vector3();
    let _px = 0.2, _py = -0.3;          // spark position (disc coords; the glass is |p| = 1)
    let _pdx = 0.707, _pdy = 0.707;     // spark direction (unit)
    /* §33c — UFO BEHAVIOUR (user: "kinda like a ufo feeling"): the
       spark HOVERS almost still → DARTS in a straight line to a random
       spot with a rapid-but-smooth ramp → dead-stop hover → sometimes a
       straight multi-bounce PING run. Every speed change is an eased
       ramp (smooth speedup, never a step); every wall contact is a pure
       specular bounce + splash (physics). The energy mode scales how
       often and how hard it moves. */
    let _behave = "hover";
    let _behaveT = 1.5;                     // seconds left in this behaviour
    let _spdCur = 0.05;                     // EASED speed — smooth ramps only
    let _wanderPh = Math.random() * 100;
    let _tgtX = 0, _tgtY = 0;               // dart destination (disc coords)
    let _scanPh = 0, _scanY = 0;            // §33d — KITT sweep phase + bar height
    function updateFluid(timeMs) {
      if (!fluid) { uniforms.uFluidAmt.value = 0; return; }
      const amt = (typeof window.__omegaFluidAmt === "number") ? window.__omegaFluidAmt : 1.0;
      uniforms.uFluidAmt.value = amt;
      uniforms.uFluid.value = fluid.texture;
      if (camera) {
        _fRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        _fUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
        uniforms.uCamRight.value.copy(_fRight);
        uniforms.uCamUp.value.copy(_fUp);
      }
      let dt = (timeMs - lastFluidMs) / 1000;
      lastFluidMs = timeMs;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 1 / 30) dt = 1 / 30;
      if (amt <= 0.001) return;   // lava off → sim off (free)
      /* §33c — the UFO clock: hover → (dart | ping run) → hover … */
      _behaveT -= dt;
      if (_behaveT <= 0) {
        if (_behave !== "hover") {
          _behave = "hover";
          _behaveT = (0.8 + Math.random() * 2.5) * (1.7 - gait);   // calm modes hold station longer
        } else {
          const r = Math.random();
          if (r < 0.28) {
            _behave = "ping";                                      // a straight bouncing run
            _behaveT = 2 + Math.random() * 3;
          } else if (r < 0.63) {
            /* §33d — the KITT scan: settle onto a bar and sweep */
            _behave = "scan";
            _behaveT = 3.5 + Math.random() * 3.5;
            _scanPh = 0;
            _scanY = (Math.random() - 0.5) * 0.5;
          } else {
            _behave = "dart";                                      // zip to a random spot
            const a = Math.random() * Math.PI * 2;
            const rr = Math.sqrt(Math.random()) * 0.7;
            _tgtX = Math.cos(a) * rr; _tgtY = Math.sin(a) * rr;
            _behaveT = 6;                                          // safety cap; arrival ends it
          }
        }
      }
      let spdTarget;
      let drivenThisFrame = false;
      if (_behave === "hover") {
        /* holding station — a tiny saucer bob, the melt pools around it */
        spdTarget = 0.025;
        _wanderPh += dt;
        _pdx = Math.cos(_wanderPh * 0.9); _pdy = Math.sin(_wanderPh * 0.9);
      } else if (_behave === "dart") {
        const dxT = _tgtX - _px, dyT = _tgtY - _py;
        const dT = Math.hypot(dxT, dyT);
        if (dT < 0.05) {
          _behave = "hover";
          _behaveT = (0.8 + Math.random() * 2.5) * (1.7 - gait);
          spdTarget = 0.025;
        } else {
          _pdx = dxT / dT; _pdy = dyT / dT;
          /* full tilt until close, then a swift smooth stop */
          spdTarget = (0.9 + 2.3 * gait) * Math.min(1, dT / 0.22);
        }
      } else if (_behave === "scan") {
        /* §33d — KITT: a rhythmic horizontal sweep across the glass,
           sinusoidal — so it eases into each turnaround and blazes
           through the middle, trailing the classic smear. The spark
           eases ONTO the bar (τ 0.22s), so entry never teleports.
           Sweep tempo follows the mode. */
        const om = (Math.PI * 2) / (1.7 - 0.9 * gait);   // calm ~1.7s/cycle → lively ~0.8s
        _scanPh += dt * om;
        const sx = Math.sin(_scanPh) * 0.62;
        const k = 1 - Math.exp(-dt / 0.22);
        const nxp = _px + (sx - _px) * k;
        const nyp = _py + (_scanY - _py) * k;
        const vx = (nxp - _px) / dt, vy = (nyp - _py) / dt;
        _px = nxp; _py = nyp;
        const v = Math.hypot(vx, vy);
        if (v > 1e-4) { _pdx = vx / v; _pdy = vy / v; }
        _spdCur = v;            // true speed of the sweep — already smooth by construction
        drivenThisFrame = true;
      } else {
        spdTarget = 0.5 + 1.7 * gait;   // ping cruise
      }
      if (!drivenThisFrame) {
        /* rapid but SMOOTH ramps — the UFO acceleration */
        _spdCur += (spdTarget - _spdCur) * (1 - Math.exp(-dt / 0.18));
        _px += _pdx * _spdCur * dt;
        _py += _pdy * _spdCur * dt;
      }
      const pr = Math.hypot(_px, _py);
      const WALL = 0.84;
      let bounced = false;
      if (pr > WALL) {
        const nx = _px / pr, ny = _py / pr;
        const vn = _pdx * nx + _pdy * ny;
        if (vn > 0) {
          _pdx -= 2 * vn * nx;
          _pdy -= 2 * vn * ny;
          bounced = true;
        }
        _px = (_px / pr) * WALL;
        _py = (_py / pr) * WALL;
      }
      const ux = 0.5 + _px * 0.5, uy = 0.5 + _py * 0.5;
      /* the spark drags the melt with it + leaves heat in its wake —
         hotter when it's moving fast, a soft pool when it hovers */
      const stir = _spdCur * 1.6 * dt;
      const hq = (0.6 + 1.3 * gait + _spdCur * 0.8) * dt;   // §33e — hotter, more luminescent trail
      uniforms.uSpark.value.set(_px, _py, 1.1 + 1.1 * gait);   // §33e — the lamp rides the spark
      /* §33f — ease toward the chosen treatment (lava ↔ angel white) */
      const angelTgt = (typeof window.__omegaAngel === "number") ? window.__omegaAngel : 1.0;
      uniforms.uAngel.value += (angelTgt - uniforms.uAngel.value) * (1 - Math.exp(-dt / 0.5));
      fluid.splat(ux, uy, _pdx * stir, _pdy * stir, hq, 0, 0, 0.005, 0.0045);
      if (bounced) {
        /* §33b — a REAL splash: liquid smacking a wall doesn't glow in
           place, it FANS OUT along it. Two hard velocity bursts shoot
           the melt tangentially both ways from the impact point (angled
           a touch inward so the wall-strip doesn't eat them), with hot
           droplets riding each arm and a heat slam at the point of
           impact. Splash energy follows the mode. */
        const nx2 = _px / WALL, ny2 = _py / WALL;   // wall normal at impact
        const tx = -ny2, ty = nx2;                  // wall tangent
        const burst = 0.55 + 1.5 * gait;            // uv/s — the fan-out speed
        const hSlam = 0.9 + 1.3 * gait;
        const off = 0.045;
        fluid.splat(ux, uy, 0, 0, hSlam, 0, 0, 0, 0.010);
        fluid.splat(ux + tx * off, uy + ty * off,
          (tx * 0.92 - nx2 * 0.22) * burst, (ty * 0.92 - ny2 * 0.22) * burst,
          hSlam * 0.45, 0, 0, 0.010, 0.006);
        fluid.splat(ux - tx * off, uy - ty * off,
          (-tx * 0.92 - nx2 * 0.22) * burst, (-ty * 0.92 - ny2 * 0.22) * burst,
          hSlam * 0.45, 0, 0, 0.010, 0.006);
      }
      fluid.update(dt);
    }

    /* ── Body samples — the §27m physics contract ─────────────── */
    const BODY_SAMPLES = 2;
    const positions = new Float32Array(BODY_SAMPLES * 3);
    const radii     = new Float32Array(BODY_SAMPLES);
    function sampleBody() {
      for (let i = 0; i < BODY_SAMPLES; i++) {
        positions[i * 3 + 0] = headPos.x;
        positions[i * 3 + 1] = headPos.y;
        positions[i * 3 + 2] = headPos.z;
        radii[i] = bodyR;
      }
    }
    sampleBody();

    return {
      mesh: bodyMesh,
      update(timeMs) {
        stepFlow(timeMs);
        bodyMesh.position.copy(headPos);
        updateLabel(timeMs);
        updateMirrorFeed();
        updateFluid(timeMs);
        sampleBody();
      },
      get positions() { return positions; },
      get radii() { return radii; },
      get count() { return BODY_SAMPLES; },
      get velocity() { return headVel; },
      get headPosition() { return headPos; },
      get labelMesh() { return labelMesh; },
      get reflectStrength() { return uniforms.uReflect.value; },
      /* API compatibility — the analytic mirror has no cube/probe. */
      get envTexture() { return null; },
      get probePosition() { return uniforms.uCenter.value; },
      get envCenter() { return uniforms.uCenter.value; },
      get envRadiusValue() { return 0; },
      excludeFromReflection() {},
      setProbeRadius() {},
      setEnvRadius() {},
      setEnvCenter() {},
      setLabel(name) { labelName = String(name == null ? "" : name); drawLabel(); },
      setReflectStrength(v) { uniforms.uReflect.value = Math.max(0, +v || 0); },
      setFocus(centroid, radius) {
        focusPt = focusPt ? focusPt.copy(centroid) : centroid.clone();
        focusR = (radius != null ? radius : 6) + 4;
      },
      clearFocus(smash) {
        if (smash && focusPt) {
          smashTarget.copy(focusPt).sub(headPos);
          if (smashTarget.lengthSq() < 1e-6) smashTarget.set(0, 0, -1); else smashTarget.normalize();
          smashTarget.multiplyScalar(16).add(focusPt);
          smashUntil = performance.now() + 1500;
        }
        focusPt = null;
      },
      dispose() {
        scene.remove(bodyMesh);
        bodyMesh.geometry.dispose();
        mat.dispose();
        if (fluid) fluid.dispose();
        scene.remove(labelMesh);
        labelGeom.dispose();
        labelMat.dispose();
        labelTex.dispose();
      },
    };
  }

  window.omegaR3D = window.omegaR3D || {};
  window.omegaR3D.createMirrorBall = createMirrorBall;
})();
