/* src/r3d/liquidMetal.js — Omega's body. §32 (2026-06-11): a PERFECT
   MIRROR BALL. User decision: no teardrop, no tail — one rigid chrome
   sphere riding the same flight law, the same photographic mirror
   (live cubemap + sphere-projected parallax correction) and the same
   neon name ring. The tube-body builder + trail machinery below are
   RETIRED but kept dormant for reference (they are no longer called).

   Historical — one seamless mercury body (head + tail):

   The comet was a SINGLE Mesh whose geometry includes both the
   spherical head and the tapered tail in one continuous tube.
   Each frame the geometry is rebuilt from a curve that runs:
     head tip (one radius ahead of headPos along velocity) →
     headPos (live) →
     historical positions (oldest last).

   SEAMLESSNESS comes from three things working together:
     1. ONE SMOOTH radius function R(t) = r·t^A·(1−t)^B (a beta /
        water-droplet profile) over the whole curve — NOT a piecewise
        nose+body. A single analytic function has continuous CURVATURE
        (C²) everywhere, and a perfect mirror reflects curvature: a
        piecewise C¹ join (matching slope but jumping curvature) shows
        up as a reflected seam line even though the surface is one
        piece. One smooth function ⇒ the reflection flows unbroken.
     2. ANALYTICALLY-correct surface normals. The tube radius changes
        along its length, so the true outward normal is
        n ∝ r̂ − (dR/ds)·T, not the pure radial r̂ the old code used.
     3. Parallel-transport frames (not Frenet) carry the cross-section
        along the curve without the binormal flip that rippled the
        body at inflection points.

   Real-time scene reflections via THREE.CubeCamera at 512² —
   re-rendered every other frame for performance. */

(function () {
  function buildBodyGeometry(curvePoints, baseRadius, tubularSegments, radialSegments, bExp) {
    const THREE = window.THREE;
    if (curvePoints.length < 2) return new THREE.BufferGeometry();
    /* Centripetal CatmullRom — eliminates the loops/cusps that the
       default uniform parameterisation produces when the control
       points have wildly varying spacing. */
    const curve = new THREE.CatmullRomCurve3(curvePoints, false, "centripetal", 0.5);
    /* Total arc length — used to convert the head radius into a
       fraction of the curve (the nose hemisphere should span an
       arc length ≈ baseRadius so it reads spherical) and to convert
       dR/dt into a real-world dR/ds for the surface normals. */
    const totalLen = Math.max(1e-4, curve.getLength());

    /* CUSTOM tube construction with PARALLEL-TRANSPORT FRAMES.
       Three's TubeGeometry uses Frenet–Serret frames internally;
       at inflection points (where the curve transitions from
       curving one way to the other) the Frenet binormal FLIPS
       direction discontinuously. The flip rotates the ring's
       cross-section instantaneously by π, producing a visible
       "ripple" or twist artifact at the inflection — exactly the
       rippling lip the user is seeing where the snake turns.

       Parallel-transport frames don't flip: we compute the first
       ring's normal/binormal once (perpendicular to the initial
       tangent), then for each subsequent ring rotate the previous
       normal by the minimal rotation that aligns with the new
       tangent. The cross-section's "up" direction propagates
       smoothly along the curve regardless of curvature direction. */
    const ringCount = tubularSegments + 1;
    const ringVerts = radialSegments + 1;
    const positions = new Float32Array(ringCount * ringVerts * 3);
    const normals   = new Float32Array(ringCount * ringVerts * 3);
    const indices   = [];

    /* Sample curve points along arc length. */
    const points   = new Array(ringCount);
    const tangents = new Array(ringCount);
    for (let r = 0; r < ringCount; r++) {
      points[r] = curve.getPointAt(r / tubularSegments).clone();
    }

    /* ── Centerline smoothing — THE seam fix ──────────────────
       A Catmull-Rom curve is only C¹ at its control points, so its
       CURVATURE jumps at every knot. The head's knots are wildly
       uneven (a tip one radius ahead, then headPos, then history
       points barely a tenth of a unit apart), so the jump there is
       large — and a mirror renders that curvature crease as a hard
       SEAM between "head" and "tail" even though it's one mesh.
       Several Laplacian passes over the evenly-sampled centerline
       wash out the high-frequency curvature spikes (endpoints pinned
       so the nose/tail tips stay put), leaving a path whose curvature
       is smooth and continuous → one seamless reflective body. The
       radius profile is applied over the same t, so the droplet
       silhouette is unchanged. */
    /* Feathered smoothing weight: full strength mid-curve, easing to
       zero over the last few rings at EACH end. Hard-pinning the
       endpoints while fully smoothing their neighbours made the
       smoothing OPERATOR discontinuous at ring 1 — a curvature spike
       right behind the nose tip that printed as an occasional crease
       ring ("seam") in the mirror at certain poses. Feathering makes
       the transition C¹: the tips still hold position exactly, but
       the smoothing fades in over ~6 rings instead of switching on. */
    const FEATHER_RINGS = 6;
    const _smW = new Float32Array(ringCount);
    for (let r = 0; r < ringCount; r++) {
      let e = Math.min(r, ringCount - 1 - r) / FEATHER_RINGS;
      if (e > 1) e = 1;
      _smW[r] = e * e * (3 - 2 * e);
    }
    const _sm = new THREE.Vector3();
    for (let pass = 0; pass < 32; pass++) {
      let p0x = points[0].x, p0y = points[0].y, p0z = points[0].z;
      for (let r = 1; r < ringCount - 1; r++) {
        const cx = points[r].x, cy = points[r].y, cz = points[r].z;
        _sm.set(
          (p0x + points[r + 1].x) * 0.5,
          (p0y + points[r + 1].y) * 0.5,
          (p0z + points[r + 1].z) * 0.5
        );
        points[r].lerp(_sm, 0.5 * _smW[r]);
        p0x = cx; p0y = cy; p0z = cz;   // use the PRE-smoothing value as left neighbour
      }
    }

    /* Tangents from central differences of the smoothed centerline.
       (§27i tried Laplacian-smoothing this tangent FIELD to kill
       mirror wiggle — REVERTED §27j: smoothed tangents diverge from
       the true path direction at bends, tilting the cross-section
       rings so the body visibly sheared into "two parts at the
       shoulder/hip". Ring frames must follow the REAL path; mirror
       wiggle is treated in the normal-smoothing pass below instead.) */
    for (let r = 0; r < ringCount; r++) {
      const a = points[r === 0 ? 0 : r - 1];
      const b = points[r === ringCount - 1 ? ringCount - 1 : r + 1];
      tangents[r] = new THREE.Vector3().subVectors(b, a);
      if (tangents[r].lengthSq() < 1e-12) tangents[r].copy(curve.getTangentAt(r / tubularSegments));
      tangents[r].normalize();
    }

    /* Build parallel-transport frames: pick an initial up that's
       not parallel to the first tangent, derive the first ring's
       normal/binormal, then propagate. */
    const tmpUp = new THREE.Vector3(0, 1, 0);
    if (Math.abs(tangents[0].dot(tmpUp)) > 0.95) tmpUp.set(1, 0, 0);
    const normalsArr  = new Array(ringCount);
    const binormalsArr = new Array(ringCount);
    normalsArr[0] = new THREE.Vector3().crossVectors(tangents[0], tmpUp).normalize();
    binormalsArr[0] = new THREE.Vector3().crossVectors(tangents[0], normalsArr[0]).normalize();

    const axis = new THREE.Vector3();
    const mat4 = new THREE.Matrix4();
    for (let r = 1; r < ringCount; r++) {
      normalsArr[r]  = normalsArr[r - 1].clone();
      binormalsArr[r] = binormalsArr[r - 1].clone();
      const dot = tangents[r - 1].dot(tangents[r]);
      if (dot < 0.99999) {
        axis.crossVectors(tangents[r - 1], tangents[r]).normalize();
        const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
        mat4.makeRotationAxis(axis, theta);
        normalsArr[r].applyMatrix4(mat4);
        binormalsArr[r].applyMatrix4(mat4);
      }
    }

    /* ── Radius profile R(t) — the water-droplet shape ───────────
       ONE smooth function over the whole curve (NOT piecewise):
         R(t) = baseRadius · t^A·(1−t)^B,  normalised to peak 1.
       • A = 0.5 → the nose rises like √t, a rounded pole (vertical
         tangent at t=0), and the peak sits near t = A/(A+B) ≈ 0.1,
         giving the fat rounded HEAD just behind the tip.
       • B = 4.5 → the long, smoothly-tapering pointed TAIL.
       This is a beta-distribution droplet — exactly the shape we
       want — but the KEY property for reflections is that it is one
       analytic function, so its CURVATURE is continuous everywhere.

       Why that matters: a perfect mirror (roughness 0) reflects
       CURVATURE, not just position/normal. A piecewise profile that
       joins the head and tail with matching value + slope is only
       C¹ — its second derivative (curvature) JUMPS at the join, and
       the mirror renders that jump as a hard reflected seam even
       though the surface is physically one piece. A single smooth
       function is C∞ in the interior, so the reflection flows across
       the head→tail transition with no seam. */
    /* A = 0.5 keeps the head a round sphere pole (√t rise). B drives
       the TAIL: B = 0.5 → a TRUE SPHERE (symmetric droplet); larger B
       → a longer liquid tail. The caller raises B with speed, so her
       true form is a sphere at rest and a teardrop streak running. */
    const A = 0.5, B = (bExp != null ? bExp : 4.5);
    const PEAK_T = A / (A + B);
    const PEAK_V = Math.pow(PEAK_T, A) * Math.pow(1 - PEAK_T, B);
    function radiusAt(t) {
      const tc = t < 0 ? 0 : (t > 1 ? 1 : t);
      return baseRadius * Math.pow(tc, A) * Math.pow(1 - tc, B) / PEAK_V;
    }

    /* Precompute radius per ring, then dR/ds (world units) from the
       ANALYTIC derivative of the beta profile — NOT a finite difference.
       FD is noisiest exactly at the head (R = t^A has a near-vertical
       slope as t→0), and that FD noise tilts the normals unevenly there,
       which a roughness-0 mirror renders as a crease. The exact derivative
       is smooth (C∞) in the interior:
         R(t) = k·t^A·(1−t)^B  ⇒  dR/dt = R(t)·(A/t − B/(1−t)).
       dR/ds tilts the surface normal off pure-radial wherever the tube
       grows/shrinks. */
    const ringR  = new Float32Array(ringCount);
    const dRds   = new Float32Array(ringCount);
    for (let r = 0; r < ringCount; r++) ringR[r] = radiusAt(r / tubularSegments);
    const _tEps = 0.5 / tubularSegments;   // clamp off the poles (slope →±∞ there; n collapses to ∓T anyway)
    for (let r = 0; r < ringCount; r++) {
      let t = r / tubularSegments;
      if (t < _tEps) t = _tEps; else if (t > 1 - _tEps) t = 1 - _tEps;
      const dRdt = radiusAt(t) * (A / t - B / (1 - t));   // analytic, smooth
      dRds[r] = dRdt / totalLen;
    }

    /* Generate ring vertices + analytically-correct normals using
       the parallel-transport frames. Surface point is
         P = C(s) + R·r̂,   r̂ = cosθ·N + sinθ·B
       and the exact outward normal of the swept-circle tube is
         n ∝ r̂ − (dR/ds)·T
       (derived from ∂P/∂θ × ∂P/∂s). At the poles R→0 and dR/ds→±∞,
       which collapses n to ∓T — a single consistent pole normal,
       so head and tail caps shade smoothly with no pinch artifact. */
    const nx = new THREE.Vector3();
    for (let r = 0; r < ringCount; r++) {
      const radius = ringR[r];
      const slope  = dRds[r];
      const cp  = points[r];
      const nrm = normalsArr[r];
      const bin = binormalsArr[r];
      const tan = tangents[r];
      for (let v = 0; v < ringVerts; v++) {
        const u = (v / radialSegments) * Math.PI * 2;
        const cu = Math.cos(u), su = Math.sin(u);
        const idx = (r * ringVerts + v) * 3;
        /* Outward radial unit vector r̂. */
        const rx = cu * nrm.x + su * bin.x;
        const ry = cu * nrm.y + su * bin.y;
        const rz = cu * nrm.z + su * bin.z;
        positions[idx + 0] = cp.x + rx * radius;
        positions[idx + 1] = cp.y + ry * radius;
        positions[idx + 2] = cp.z + rz * radius;
        /* n = r̂ − slope·T, normalized. */
        nx.set(rx - slope * tan.x, ry - slope * tan.y, rz - slope * tan.z);
        const len = nx.length() || 1;
        normals[idx + 0] = nx.x / len;
        normals[idx + 1] = nx.y / len;
        normals[idx + 2] = nx.z / len;
      }
    }

    /* ── REFLECTION-SEAM FIX: smooth the NORMAL FIELD along the tube ──
       The centerline is a Catmull-Rom spline — only C¹ at its knots, so
       its CURVATURE jumps at every knot (worst at the dense head lead-in
       where the round head meets the tapering tail). Positions are fine,
       but a roughness-0 mirror reflects CURVATURE, so each curvature jump
       shows up as a CREASE in the reflection — the long-standing "the
       reflection isn't smooth across the ball→teardrop join" seam. The
       analytic normals inherit that kink via the tangent T.

       A few Laplacian passes over the per-vertex normals ALONG the tube
       (parallel-transport frames keep the radial index v aligned ring to
       ring, so same-v normals across rings are directly comparable) wash
       out the C¹ kinks → dn/ds becomes continuous → the reflection flows
       unbroken. The poles (first/last ring) are pinned so the nose/tail
       caps keep their single consistent pole normal. Silhouette
       (positions) is untouched, so the droplet shape is unchanged. */
    const SMOOTH_PASSES = 15;   // §27o: back to the §26-era count — 26 was
                                // compensating for knot-pop noise that the
                                // §27m sliding knots removed at the source
    if (ringCount > 4) {
      const tmpN = new Float32Array(normals.length);
      for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
        tmpN.set(normals);
        for (let r = 1; r < ringCount - 1; r++) {
          for (let v = 0; v < ringVerts; v++) {
            const i  = (r * ringVerts + v) * 3;
            const im = ((r - 1) * ringVerts + v) * 3;
            const ip = ((r + 1) * ringVerts + v) * 3;
            const xx = 0.25 * tmpN[im]     + 0.5 * tmpN[i]     + 0.25 * tmpN[ip];
            const yy = 0.25 * tmpN[im + 1] + 0.5 * tmpN[i + 1] + 0.25 * tmpN[ip + 1];
            const zz = 0.25 * tmpN[im + 2] + 0.5 * tmpN[i + 2] + 0.25 * tmpN[ip + 2];
            const l = Math.sqrt(xx * xx + yy * yy + zz * zz) || 1;
            normals[i]     = xx / l;
            normals[i + 1] = yy / l;
            normals[i + 2] = zz / l;
          }
        }
      }
    }

    /* Indices — winding set so the OUTER surface is front-facing
       (its outward normals then match, so the mirror reflects the
       surroundings off the outside; the old order rendered the inner
       far wall → reflections looked like they were "inside" and the
       nearby atoms never showed). */
    for (let r = 0; r < tubularSegments; r++) {
      for (let v = 0; v < radialSegments; v++) {
        const a = r * ringVerts + v;
        const b = (r + 1) * ringVerts + v;
        const c = (r + 1) * ringVerts + v + 1;
        const d = r * ringVerts + v + 1;
        indices.push(a, d, b);
        indices.push(b, d, c);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("normal",   new THREE.BufferAttribute(normals, 3));
    geom.setIndex(indices);
    /* §27m — expose the DRAWN skeleton (smoothed ring centers + ring
       radii) so the collision proxy can sample the exact surface the
       renderer just built, instead of re-tracing its own curve from
       raw control points (which diverges from the smoothed body in
       turns — the photographed proxy-vs-chrome offset). */
    geom.userData.ringCenters = points;
    geom.userData.ringRadii = ringR;
    return geom;
  }

  function createLiquidMetal(scene, renderer, opts) {
    const THREE = window.THREE;
    if (!THREE) return { update() {}, dispose() {} };

    const o = opts || {};
    const center  = o.center      || new THREE.Vector3(0, 0, 0);
    const pathR   = o.pathRadius  || 9;
    const bodyR   = o.radius      || 1.0;

    /* ── Real-time scene reflections via CubeCamera ──────────────
       512² (up from 256²) so the reflected atom field reads as
       crisp specks of light on the chrome rather than a smeared
       blur. Mipmapped + trilinear so the roughness=0 mirror stays
       clean at grazing angles. Re-rendered every other frame
       (see update) — the comet drifts slowly enough that a 30Hz
       reflection update is visually indistinguishable from 60Hz
       while paying half the cost, which buys headroom for bloom. */
    const cubeTarget = new THREE.WebGLCubeRenderTarget(768, {
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    const cubeCamera = new THREE.CubeCamera(0.1, 200, cubeTarget);

    /* ── Reflection-only studio environment ───────────────────────
       The chamber's void is pure black, so a roughness-0 mirror has
       essentially nothing to reflect and reads as invisible. We give
       the CUBE CAMERA ONLY (not the main scene) a subtle dark
       vertical-gradient environment to reflect: a soft cool highlight
       overhead fading to near-black below. That gradient reveals the
       chrome's curved form — the classic way liquid metal reads —
       while the main scene background stays pure black and the bright
       atoms still reflect as crisp coloured speckles on top of it.
       Equirectangular mapping so up/down reflect different tones (a
       real environment), not a flat same-on-every-face fill. */
    const envCanvas = document.createElement("canvas");
    envCanvas.width = 16; envCanvas.height = 256;
    const ectx = envCanvas.getContext("2d");
    const egrad = ectx.createLinearGradient(0, 0, 0, 256);
    /* A real studio gradient with strong top-to-bottom contrast so
       the chrome ALWAYS reads as a solid light-catching mirror — even
       the thin tail. A near-black env (the chamber void) made the
       body look transparent: the mirror just showed the dark field
       "through" itself. A bright overhead highlight fading to a dark
       floor gives every part of the body a clear bright-to-dark sheen
       (solid metal), with the atom speckles reflecting on top. */
    egrad.addColorStop(0.00, "#2c3754");  // faint cool sheen
    egrad.addColorStop(0.45, "#0e121c");
    egrad.addColorStop(1.00, "#04050a");  // near-black floor
    ectx.fillStyle = egrad; ectx.fillRect(0, 0, 16, 256);
    const envTex = new THREE.CanvasTexture(envCanvas);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;

    /* ── Material (one surface, shared by head + tail) ───────── */
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 1.0,
      /* Perfect mirror. The smoothed centerline keeps it seamless, so
         no roughness is needed to hide anything. */
      roughness: 0.0,
      envMap: cubeTarget.texture,
      /* PURELY reflective — and now actually 1:1 (§27k: this comment
         said "no boost" while shipping 1.5×, which is exactly why her
         mirror read BRIGHTER than the atoms it reflects). Dialable via
         setReflectStrength / the Tweaks + forge sliders. */
      envMapIntensity: (o.reflectStrength != null ? o.reflectStrength : 1.0),
    });

    /* ── Parallax-corrected reflections (near-field cube sampling) ──
       A cube map assumes the reflected world is at INFINITY, so a single
       centre-probe reflects NEAR objects (atoms close to / touching the
       chrome) at the wrong apparent position — the source of both the
       "contact reflection sits inset" bug and the faint reflection crease
       where the surface sweeps across the bulge. We re-aim each reflection
       ray to a point a fixed DISTANCE (uProbeRadius) along it, then sample
       the cube (rendered from uProbePos) in that point's direction —
       "assume the reflected object is uProbeRadius away." DISTANCE-based
       (not a probe-centred sphere) so the SAME correction applies across
       the whole body — head and tail stay continuous when she stretches (a
       probe-centred sphere left far tail points outside it → uncorrected →
       head & tail reflected "two different items"). As uProbeRadius→∞ it's
       the old infinite-env behaviour; small pulls near reflections out to
       meet their source. Tunable live: window.__omegaReflectProxy,
       setProbeRadius(v), or Tweaks "Reflection · parallax depth" (default
       2u). Patched into three's getIBLRadiance (r160 PMREMs the cube → the
       CUBE_UV branch runs), but we sample the RAW cube (uRawEnv) to stay
       sharp under magnification. */
    const _probePosUniform = new THREE.Vector3();
    let probeRadius = (o.probeRadius != null ? o.probeRadius : 2.0);
    /* Sphere-projected reflection: the atoms live on a shell around the
       WORLD ORIGIN (the camera) and the comet floats INSIDE that shell, so
       a physically-faithful mirror reflects each ray against that real
       sphere — not a fixed per-ray distance (which made near-face
       reflections read as sitting INSIDE the body and put atoms at the
       wrong angle). envRadius = the real atom-shell radius (fed from the
       live atom positions by the scene); 0 ⇒ fall back to the old
       fixed-distance probeRadius. Centre defaults to the origin. */
    let envRadius = (o.envRadius != null ? o.envRadius : 0);
    const _envCenterUniform = new THREE.Vector3(0, 0, 0);
    let _lmShader = null;
    const ENV_CHUNK_PATCHED = [
      "#ifdef USE_ENVMAP",
      "  vec3 getIBLIrradiance( const in vec3 normal ) {",
      "    #ifdef ENVMAP_TYPE_CUBE_UV",
      "      vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );",
      "      vec4 envMapColor = textureCubeUV( envMap, worldNormal, 1.0 );",
      "      return PI * envMapColor.rgb * envMapIntensity;",
      "    #else",
      "      return vec3( 0.0 );",
      "    #endif",
      "  }",
      "  vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {",
      "    #ifdef ENVMAP_TYPE_CUBE_UV",
      "      vec3 reflectVec = reflect( - viewDir, normal );",
      "      reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );",
      "      reflectVec = inverseTransformDirection( reflectVec, viewMatrix );",
      "      if ( uEnvRadius > 0.001 ) {",
      "        vec3 _ro = vWorldPositionLM - uEnvCenter;",                       // surface point, relative to the env-sphere centre
      "        float _b = dot( _ro, reflectVec );",
      "        float _c = dot( _ro, _ro ) - uEnvRadius * uEnvRadius;",
      "        float _disc = _b * _b - _c;",                                    // comet is INSIDE the shell ⇒ _c<0 ⇒ always a forward hit
      "        if ( _disc > 0.0 ) {",
      "          float _t = - _b + sqrt( _disc );",                            // distance along the ray to the real atom shell
      "          vec3 _hit = vWorldPositionLM + reflectVec * max( _t, 0.0 );",  // the true point the ray reflects toward
      "          reflectVec = normalize( _hit - uProbePos );",                  // sample the cube from the probe toward that real point
      "        }",
      "      } else if ( uProbeRadius > 0.001 ) {",
      "        vec3 _hit = vWorldPositionLM + reflectVec * uProbeRadius;",       // fallback: fixed-distance parallax
      "        reflectVec = normalize( _hit - uProbePos );",
      "      }",
      "      vec4 envMapColor = textureCube( uRawEnv, reflectVec );",
      "      return envMapColor.rgb * envMapIntensity;",
      "    #else",
      "      return vec3( 0.0 );",
      "    #endif",
      "  }",
      "  #ifdef USE_ANISOTROPY",
      "    vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {",
      "      #ifdef ENVMAP_TYPE_CUBE_UV",
      "        vec3 bentNormal = cross( bitangent, viewDir );",
      "        bentNormal = normalize( cross( bentNormal, bitangent ) );",
      "        bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );",
      "        return getIBLRadiance( viewDir, bentNormal, roughness );",
      "      #else",
      "        return vec3( 0.0 );",
      "      #endif",
      "    }",
      "  #endif",
      "#endif",
    ].join("\n");
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uProbePos = { value: _probePosUniform };
      shader.uniforms.uProbeRadius = { value: probeRadius };
      shader.uniforms.uEnvCenter = { value: _envCenterUniform };
      shader.uniforms.uEnvRadius = { value: envRadius };
      /* Sample the RAW cube render-target directly (not three's PMREM,
         whose limited base resolution blurs once parallax magnifies a near
         reflection). The comet is roughness 0 — a pure mirror — so it wants
         the full-res sharp cube, not a prefiltered one. */
      shader.uniforms.uRawEnv = { value: cubeTarget.texture };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPositionLM;")
        .replace("#include <project_vertex>", "#include <project_vertex>\n  vWorldPositionLM = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPositionLM;\nuniform vec3 uProbePos;\nuniform float uProbeRadius;\nuniform vec3 uEnvCenter;\nuniform float uEnvRadius;\nuniform samplerCube uRawEnv;")
        .replace("#include <envmap_physical_pars_fragment>", ENV_CHUNK_PATCHED);
      _lmShader = shader;
    };
    mat.needsUpdate = true;

    /* ── One body mesh — §32: a perfect chrome sphere ──────────
       High segment count on purpose: a roughness-0 mirror reflects
       CURVATURE, so polygonal faceting prints straight into the
       reflection. 96×64 keeps the ball optically round at her
       on-screen size. */
    const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(bodyR, 96, 64), mat);
    scene.add(bodyMesh);

    /* ── LLM name band — a neon ticker scrolling the comet's girth ─
       The comet IS the currently-routed LLM, so its name runs around
       the head like a neon sign scrolling a circular billboard. The
       text lives on a vertical-axis open cylinder hugging the head
       just outside the chrome; depthTest lets the chrome occlude the
       far side so the sign reads as wrapping the solid body. The
       MARQUEE is the texture's offset (not the mesh), so it scrolls
       smoothly around regardless of how the comet banks. Additive +
       a baked glow + the bloom layer give it the neon burn.
       setLabel(name) lets the OmegaClaw harness swap in whatever the
       routing profile reports. */
    let labelName = (o.label != null ? o.label : "GLM 5.1");
    const LABEL_TILES = 3;                  // times the name repeats around
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
      /* Asleep = no LLM routed → she's SLEEPING. */
      return m === "asleep" ? "SLEEPING" : labelName;
    }
    function drawLabel() {
      const W = labelCanvas.width, H = labelCanvas.height;
      const h = modeHue();                       // each energy mode has its own hue
      const textCol = `hsl(${h}, 100%, 92%)`;
      const glowCol = `hsla(${h}, 100%, 68%, 0.95)`;
      const pipCol  = `hsla(${h}, 100%, 75%, 0.9)`;
      const txt = displayText();
      lctx.clearRect(0, 0, W, H);
      lctx.textAlign = "center";
      lctx.textBaseline = "middle";
      lctx.font = '700 70px ui-monospace, "SF Mono", Menlo, monospace';
      /* Neon glow baked into the glyphs, tinted to the mode. A wide soft
         halo pass + a tight hot pass + a near-white core = a sign that
         actually burns (this is what gives the name its "pop"). */
      lctx.shadowColor = glowCol;
      lctx.shadowBlur = 40;                    // wide outer halo
      lctx.fillStyle = glowCol;
      lctx.fillText(txt, W / 2, H / 2 + 2);
      lctx.shadowBlur = 20;                    // tighter inner burn
      lctx.fillStyle = textCol;
      lctx.fillText(txt, W / 2, H / 2 + 2);
      lctx.shadowBlur = 8;                     // near-white hot core
      lctx.fillStyle = `hsl(${h}, 100%, 99%)`;
      lctx.fillText(txt, W / 2, H / 2 + 2);
      /* Separator pip at the tile seam (x=0 ≡ x=W when tiled). */
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
      side: THREE.FrontSide,   // only the camera-facing text; no mirrored far-wall
      depthTest: true,      // chrome occludes the far side of the ring
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const LABEL_R = bodyR * 1.07;   // hugs the chrome at its widest cross-section (was a floating 1.16 ring that read as a seam)
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
      /* Recolour + relabel when the energy mode changes: each mode
         carries its own hue, and asleep shows SLEEPING (no LLM). */
      const m = window.omegaState ? window.omegaState.mode : "warm";
      if (m !== lastLabelMode) { lastLabelMode = m; drawLabel(); }
      /* Tie the ring to the TRUE circumference: a band perpendicular
         to the body axis (cylinder axis = heading), parked on the
         widest part of the head — the seam where the round head meets
         the tapering tail. Because it's perpendicular to the body it
         never reaches into the thin tail. */
      _lblHeading.copy(headVel);
      if (_lblHeading.lengthSq() < 1e-6) _lblHeading.set(0, 0, -1);
      else _lblHeading.normalize();
      labelMesh.position.copy(headPos).addScaledVector(_lblHeading, bodyR * 0.30);
      /* Detached orbiting ring: align to the body axis, then give it
         its OWN slow rotation about that axis so the name orbits the
         comet a touch wider than the chrome (replaces the old texture
         marquee — the ring itself turns now). */
      labelMesh.quaternion.setFromUnitVectors(_LBL_Y, _lblHeading);
      labelSpin += dt * 0.85;                         // its OWN steady spin (~7s per turn), on top of the heading-follow
      _lblSpinQ.setFromAxisAngle(_LBL_Y, labelSpin);
      labelMesh.quaternion.multiply(_lblSpinQ);
      /* Fade the name-band only when she genuinely STREAKS (focused jog /
         smash), not during ordinary cruise — otherwise it sat permanently
         half-dimmed and never popped. Ramp starts at real elongation and
         never fully vanishes, so the name stays legible while she swims.
         (The dim *0.7 base was a seam-hunt over-correction; the real seam
         was head→tail geometry, not this band.) */
      const sN = Math.max(0, Math.min(1, (bodyStretch - 1.28) * 3.2));
      labelMat.opacity = 1 - 0.7 * sN;
      const lblScale = 1 - 0.08 * sN;
      labelMesh.scale.set(lblScale, 1, lblScale);
    }

    /* ── Free-roaming swim through the whole VISIBLE sea ────────
       The atom field is a shell around the camera at the origin; the
       comet must swim the part of it the viewer can SEE — the
       forward view cone (camera looks down −Z, ~93° FOV) — at all
       depths and across the full width/height, not orbit one pocket.

       Model: the comet chases a TARGET point that sweeps the visible
       forward volume on slow Lissajous curves (depth −10…−28, lateral
       extent growing with depth so it stays in frame). Curl noise
       adds organic waviness on top, and the heading turns toward the
       target at a limited rate so the path banks in graceful arcs. */
    const CRUISE = 3.0;       // swim speed (world units / sec) — halved
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
    let bodyStretch = 1;     // liquid-metal elongation, 1 (rest) → ~1.5 (full speed)
    /* ── Focus / smash (the Memory gather, §15) ──────────────────
       When Omega looks into a space, her locus ORBITS the gathered
       continent (setFocus); when she stops, she SMASHES straight
       through it on her way out (clearFocus(true)). Both just retarget
       the existing steering — no separate path system. */
    let focusPt = null;       // continent centroid to orbit, or null
    let focusR = 7;           // orbit radius around the focus
    let orbitPhase = Math.random() * 6.28;
    let smashUntil = 0;       // while now < this, barrel straight through
    let curLeash = 12;        // EASED leash radius (no hard switch → no teleport)
    let boostCur = 1;         // EASED orbit/smash speed multiplier (no instant ×3.2 jolt)
    let gait = 0.4;           // EASED energy level → realistic accel/decel + stretch on a mode change
    const smashTarget = new THREE.Vector3();
    const _fu = new THREE.Vector3(), _fv = new THREE.Vector3(), _fd = new THREE.Vector3();
    const _WUP = new THREE.Vector3(0, 1, 0);
    function stepFlow(timeMs) {
      if (window.__omegaFreezeComet) { lastFlowMs = timeMs; return; }
      let dt = (timeMs - lastFlowMs) / 1000;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 1 / 30) dt = 1 / 30;
      lastFlowMs = timeMs;

      /* Roaming target — Omega's locus freely roams the WHOLE
         atomspace interior, every direction (including behind the
         viewer), never the empty outer edge. A 3D wander on a shell
         of radius R from the origin keeps her deep inside the field
         so she is always surrounded by atoms to reflect; the camera
         follows her wherever she goes. */
      /* Energy mode drives how alive she is: coasting when listening,
         livelier when warm, rapid when focused, racing when creative
         (every motion caused). busy ∈ [0,1] from omegaState. */
      const busy = (window.omegaState && window.omegaState.profile)
        ? window.omegaState.profile().busy : 0.4;
      /* Ease the gait toward the mode's energy so her speed — and so the
         stretch — RAMP up/down on a mode change instead of stepping: she
         accelerates into a streak and decelerates back into a sphere
         realistically, rather than popping shape. */
      gait += (busy - gait) * (1 - Math.exp(-dt / 2.2));
      /* Energy mode sets her whole GAIT, not just speed:
           asleep   → crawl, long slow loping turns, smooth
           listening→ between a crawl and a walk — a slow amble
           warm     → a weaving walk, wandering more randomly
           focused  → a jog, quick directed darts here and there
           creative → a run all over the place, erratic
         Speed, wander-rate, turn-agility and curl all rise with gait. */
      const speedMul   = 0.16 + 1.75 * gait;    // crawl → run
      const wanderRate = 0.13 + 1.30 * gait;    // slow arcs → fast darting target
      const turnBase   = 0.58 - 0.54 * gait;    // long slow turns → snappy turns
      const curlAmt    = 0.13 + 0.66 * gait;    // smooth → erratic weaving
      roamPhase += dt * wanderRate;
      const tf = roamPhase;
      const R  = 7.1 + 2.5 * Math.sin(tf * 0.50);        // ~4.6..9.6 from origin
      const az = tf * 0.60 + 1.30 * Math.sin(tf * 0.23);  // azimuth sweeps the full 360°
      const el = 0.95 * Math.sin(tf * 0.83 + 0.6);        // elevation, up and down
      const ce = Math.cos(el);
      target.set(
        R * ce * Math.sin(az),
        R * Math.sin(el),
        R * ce * Math.cos(az)
      );

      /* Mode override: ORBIT the focused continent, or SMASH through
         it on exit. Roam target above is the default. */
      let speedBoost = 1, turnOverride = null, curlOverride = null;
      if (timeMs < smashUntil) {
        target.copy(smashTarget);     // barrel straight out through the space
        speedBoost = 3.2;
        turnOverride = 0.02;          // snap onto the smash line, then fly straight
      } else if (focusPt) {
        orbitPhase += dt * (0.18 + 0.30 * gait);
        _fd.copy(focusPt); if (_fd.lengthSq() < 1e-6) _fd.set(0, 0, -1); else _fd.normalize();
        _fu.crossVectors(_WUP, _fd); if (_fu.lengthSq() < 1e-6) _fu.set(1, 0, 0); else _fu.normalize();
        _fv.crossVectors(_fd, _fu).normalize();
        const oc = Math.cos(orbitPhase), os = Math.sin(orbitPhase);
        /* Ring the continent in its facing PLANE (perpendicular to the
           view axis), at radius focusR from its centroid — so every orbit
           point is ~√(14²+focusR²) from the viewer, always well out front,
           never near us. Track it TIGHTLY (snappy turn, ~no curl) so she
           stays on the ring instead of cutting chords inward toward the
           viewer. She only enters the space on her deliberate smash. */
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

      /* Desired = toward target + a little curl waviness. */
      desired.subVectors(target, headPos);
      if (desired.lengthSq() > 1e-6) desired.normalize(); else desired.copy(heading);
      curlSteer(headPos, roamPhase * 0.7 + timeMs * 0.00004, steer);
      desired.addScaledVector(steer, curlOverride != null ? curlOverride : curlAmt);
      if (desired.lengthSq() > 1e-6) desired.normalize();

      /* Heading agility scales with energy: long lazy arcs when calm,
         snappy direction changes when racing. Orbit/smash can override. */
      const turn = turnOverride != null ? turnOverride : turnBase;
      heading.lerp(desired, 1 - Math.pow(turn, dt)).normalize();
      /* Ease the orbit/smash speed multiplier so entering/leaving focus or
         the smash RAMPS instead of stepping — an instant ×3.2 read as a
         teleport/jolt. The flutter is gentle + slow now (was a fast ±30%
         wobble that looked jittery at speed). */
      boostCur += (speedBoost - boostCur) * (1 - Math.exp(-dt / 0.22));
      const cruise = CRUISE * speedMul * boostCur * (0.92 + 0.10 * Math.sin(tf * 2.2));
      headVel.copy(heading).multiplyScalar(cruise);
      headPos.addScaledVector(headVel, dt);
      const _r = headPos.length();
      /* Leash extends while focused/smashing so she can reach the
         continent (seated ~14u out). EASED (not switched) so when focus
         ends she's drawn back in smoothly instead of teleporting. */
      const targetLeash = (focusPt || timeMs < smashUntil) ? 30 : 12;
      curLeash += (targetLeash - curLeash) * (1 - Math.exp(-dt / 0.7));
      if (_r > curLeash) {
        headPos.multiplyScalar(curLeash / _r);      // stay inside the populated field
        /* Shed the OUTWARD velocity component so she doesn't grind against
           the leash (that grinding read as rubber-banding); she slides
           tangentially and the steering turns her back in. */
        const inv = 1 / curLeash;
        const nx = headPos.x * inv, ny = headPos.y * inv, nz = headPos.z * inv;
        const vr = headVel.x * nx + headVel.y * ny + headVel.z * nz;
        if (vr > 0) { headVel.x -= nx * vr; headVel.y -= ny * vr; headVel.z -= nz * vr; }
      } else if (_r < 4.6) {
        /* No-go sphere around the viewer at the origin — she never
           swims into us / clips the screen corners. */
        if (_r < 1e-3) headPos.set(0, 0, -4.6);
        else headPos.multiplyScalar(4.6 / _r);
      }

      /* Liquid-metal stretch: the faster she moves the more she
         elongates along motion — and thins to keep constant mass.
         Eased so it flows rather than snaps. */
      /* Drive the stretch from the SMOOTH gait-speed (gait + eased boost,
         WITHOUT the per-frame sinusoidal flutter) so her LENGTH flows with
         her energy instead of pulsing with the wobble; dt-normalized so the
         ease is framerate-independent and gentle. */
      /* §32 — perfect ball: she never elongates. The stretch channel
         is pinned at 1 so the label/cube readers stay inert. */
      bodyStretch = 1;
    }

    /* ── History ring buffer for the tail ─────────────────────── */
    const HISTORY = 135;
    const SAMPLE_DIST = 0.16;          // world units between trail samples — even spacing = a stable curve at any speed
    const historyPts = [];
    let lastSamplePos = null;
    function pushHistory(timeMs) {
      if (window.__omegaFreezeComet) return;
      if (lastSamplePos && headPos.distanceTo(lastSamplePos) < SAMPLE_DIST) return;
      lastSamplePos = headPos.clone();
      if (historyPts.length < HISTORY) {
        historyPts.push(headPos.clone());
      } else {
        historyPts.shift();
        historyPts.push(headPos.clone());
      }
    }

    const tmpFwd = new THREE.Vector3();
    /* §27k — GEOMETRIC heading, time-smoothed. The body is built along
       headVel's direction; during turns (and near-stationary moments)
       that direction wobbles frame-to-frame, swinging the nose lead-in
       and flexing the head→tail junction — the "seam when she turns in
       some directions". The FLIGHT keeps its raw velocity; only the
       geometry's forward axis is EMA-smoothed (τ ≈ 0.12s). */
    const _geoFwd = new THREE.Vector3(0, 0, -1);
    let _lastRebuildMs = 0;
    /* (The old shared render→collision stash (_collidePts/_collideTailB)
       is gone — §27m: sampleBody now reads the DRAWN skeleton straight
       from geometry.userData, so render and collision can never diverge.) */
    function rebuildBody(timeMs) {
      if (historyPts.length < 4) return;
      let gdt = (timeMs - _lastRebuildMs) / 1000;
      _lastRebuildMs = timeMs;
      if (!isFinite(gdt) || gdt <= 0 || gdt > 0.25) gdt = 1 / 60;
      tmpFwd.copy(headVel);
      if (tmpFwd.lengthSq() < 1e-6) {
        tmpFwd.copy(_geoFwd);          // coasting/stopped → hold the last heading
      } else {
        tmpFwd.normalize();
      }
      _geoFwd.lerp(tmpFwd, 1 - Math.exp(-gdt / 0.12));
      if (_geoFwd.lengthSq() > 1e-12) _geoFwd.normalize(); else _geoFwd.copy(tmpFwd);
      tmpFwd.copy(_geoFwd);
      /* Curve points: head tip → live headPos → history (newest
         first). The head tip is one bodyR ahead of headPos along
         the velocity direction; the curve smoothly joins from the
         tip through the sphere centre and out into the trail. */
      const sN = Math.max(0, Math.min(1, (bodyStretch - 1) * 2));   // 0 at rest → 1 at full speed
      const tailB = 0.6 + 4.0 * sN;          // 0.6 ≈ sphere, 4.6 ≈ long liquid tail

      const pts = [];
      pts.push(headPos.clone().addScaledVector(tmpFwd, bodyR));        // round front pole (tip)
      /* Intermediate points down the (straight) head axis so the control-
         point spacing isn't an abrupt 2.2u → 0.16u jump at headPos — that
         jump was an under-resolved curvature kink that survived the
         smoothing when the tail grew long, reading as a seam at the
         head→tail junction. A graded lead-in resolves the head evenly. */
      pts.push(headPos.clone().addScaledVector(tmpFwd, bodyR * 0.62));
      pts.push(headPos.clone().addScaledVector(tmpFwd, bodyR * 0.28));
      pts.push(headPos.clone());
      /* Tail length grows SMOOTHLY with speed via arc-length
         truncation (NOT an integer point count), so speeding up never
         pops/stutters the geometry.

         §27m — knots SLIDE, never pop. Previously the control points
         WERE the raw history samples: the gap between the live head
         and the newest sample stretched 0→SAMPLE_DIST, then a new
         sample popped in — the knot spacing at the head oscillated in
         a sawtooth (period = SAMPLE_DIST of travel), twitching the
         curve sideways on every pop; each twitch then AGED down the
         trail as a ripple edge marching along the body at her speed —
         worst in turns ("she shifts to the side a step"), and visible
         in the collision x-ray as jumping "bubbles". Now the control
         points are RESAMPLED each frame at exact multiples of STEP
         measured back from the live head along the recorded polyline —
         every knot slides continuously with her, spacing constant. */
      const targetTail = sN * 18;            // units of trail behind the head
      const STEP = SAMPLE_DIST;
      const wantD = [];
      for (let d = STEP; d < targetTail; d += STEP) wantD.push(d);
      if (targetTail > 0.02) wantD.push(targetTail);
      let wi = 0, acc = 0;
      let prev = headPos;
      for (let i = historyPts.length - 1; i >= 0 && wi < wantD.length; i--) {
        const p = historyPts[i];
        const d = prev.distanceTo(p);
        if (d < 1e-5) continue;
        while (wi < wantD.length && acc + d >= wantD[wi]) {
          pts.push(prev.clone().lerp(p, (wantD[wi] - acc) / d));
          wi++;
        }
        acc += d;
        prev = p;
      }
      /* Smoothly close the back into a full sphere when the trail is
         short (slow): extend by exactly the shortfall, fading to zero
         as speed grows — no popping. */
      const lastPt = pts[pts.length - 1];
      const trailSpan = lastPt.distanceTo(headPos);
      if (trailSpan < bodyR) {
        pts.push(lastPt.clone().addScaledVector(tmpFwd, -(bodyR - trailSpan)));
      }

      const newGeom = buildBodyGeometry(pts, bodyR, 180, 56, tailB);
      if (bodyMesh.geometry) bodyMesh.geometry.dispose();
      bodyMesh.geometry = newGeom;
    }

    /* §28a — meshes excluded from her reflection (the new SDF body must
       not be captured into its own cubemap — self-reflection ghost). */
    const _reflectExcluded = [];
    const _cubeFwd = new THREE.Vector3();
    let cubeUpdateTick = 0;
    function update(timeMs) {
      stepFlow(timeMs);
      /* §32 — perfect ball: no trail, no per-frame geometry rebuild;
         the sphere simply rides her locus. */
      bodyMesh.position.copy(headPos);
      updateLabel(timeMs);
      /* Live cubemap reflections — every OTHER frame, every frame only
         when genuinely racing (§27n: the §27l "turning" gate fired on
         ~every frame of her perpetually-wandering flight → de-facto
         60Hz cube → 22fps. Her §27m sliding-knot body no longer
         produces the step-ripple the 60Hz cube was meant to mask, so
         half-rate is fine outside racing. Real 60Hz wants the §26
         cube-LOD — cheap atom material for the 6-face capture.) */
      cubeUpdateTick++;
      const fastMove = headVel.length() > 4.0;
      if (fastMove || cubeUpdateTick % 2 === 0) {
        const wasVisible = bodyMesh.visible;
        bodyMesh.visible = false;
        const _exVis = [];
        for (let i = 0; i < _reflectExcluded.length; i++) {
          _exVis.push(_reflectExcluded[i].visible);
          _reflectExcluded[i].visible = false;
        }
        /* Hide the LABEL too (§27h): the neon name ticker rides with
           her, point-blank from the probe — captured into the cube it
           projected back onto the chrome as a bright ghost shape
           swimming INSIDE the body ("a whole other comet inside"). She
           reflects the world, not her own nameplate. */
        const labelWasVisible = labelMesh ? labelMesh.visible : false;
        if (labelMesh) labelMesh.visible = false;
        /* §32 — ball: the cube probe sits at her centre. (The old
           stretch-aware probe pullback retired with the tail.) */
        cubeCamera.position.copy(headPos);
        /* Keep the parallax probe-position uniform in lockstep with the
           cube render position, and read a live proxy-radius override. */
        _probePosUniform.copy(cubeCamera.position);
        if (_lmShader) {
          _lmShader.uniforms.uProbeRadius.value =
            (typeof window.__omegaReflectProxy === "number") ? window.__omegaReflectProxy : probeRadius;
          _lmShader.uniforms.uEnvRadius.value =
            (typeof window.__omegaEnvRadius === "number") ? window.__omegaEnvRadius : envRadius;
        }
        cubeCamera.update(renderer, scene);
        bodyMesh.visible = wasVisible;
        for (let i = 0; i < _reflectExcluded.length; i++) _reflectExcluded[i].visible = _exVis[i];
        if (labelMesh) labelMesh.visible = labelWasVisible;
      }
    }

    /* Body-sample positions — N evenly-spaced points along the
       current curve. Exposed via the `positions` / `count` interface
       so downstream code (atom proximity glow) can sample the
       SNAKE'S WHOLE BODY, not just the head. Rebuilt each update
       from the same curve that drives the geometry. */
    const BODY_SAMPLES = 48;
    const positions = new Float32Array(BODY_SAMPLES * 3);
    const radii     = new Float32Array(BODY_SAMPLES);
    /* Same beta-droplet profile as buildBodyGeometry, so the local
       comet RADIUS at each body sample is known for true surface
       collision (an atom contacts when it reaches cometRadius, which
       is fat at the head and ~0 at the tail tip). */
    const tmpSamplePt  = new THREE.Vector3();
    function sampleBody() {
      /* §32 — perfect ball: every sample IS the ball (centre headPos,
         radius bodyR). The §27m law still holds by construction —
         drawn body = physics body — and scene.js's capsule chain
         degenerates to exact sphere contact (zero-length segments
         collapse to point-distance in its narrow phase). */
      for (let i = 0; i < BODY_SAMPLES; i++) {
        positions[i * 3 + 0] = headPos.x;
        positions[i * 3 + 1] = headPos.y;
        positions[i * 3 + 2] = headPos.z;
        radii[i] = bodyR;
      }
    }
    return {
      mesh: bodyMesh,
      update(timeMs) {
        update(timeMs);
        sampleBody();
      },
      get positions() { return positions; },
      get radii() { return radii; },
      get count() { return BODY_SAMPLES; },
      get velocity() { return headVel; },
      get headPosition() { return headPos; },
      get labelMesh() { return labelMesh; },
      /* §28 — shared organs for the raymarched body rebuild: the new
         surface renders from the SAME skeleton + cubemap, so flight,
         physics and reflections stay identical during the A/B. */
      get envTexture() { return cubeTarget.texture; },
      get probePosition() { return _probePosUniform; },
      get envCenter() { return _envCenterUniform; },
      get envRadiusValue() {
        return (typeof window.__omegaEnvRadius === "number") ? window.__omegaEnvRadius : envRadius;
      },
      get reflectStrength() { return mat.envMapIntensity; },
      excludeFromReflection(m) { if (m && _reflectExcluded.indexOf(m) < 0) _reflectExcluded.push(m); },
      setLabel(name) { labelName = String(name == null ? "" : name); drawLabel(); },
      /* Reflection proxy-sphere radius (parallax correction). Smaller =
         near reflections pulled out to meet their source; large/Infinity
         = the old infinite-environment behaviour. */
      setProbeRadius(v) { probeRadius = Math.max(0, +v || 0); },
      /* The real atom-shell radius for sphere-projected reflection (the
         scene feeds the live mean atom distance from the origin). */
      setEnvRadius(v) { envRadius = Math.max(0, +v || 0); },
      /* Mirror brightness — 1.0 = true 1:1 reflection of the scene. */
      setReflectStrength(v) { mat.envMapIntensity = Math.max(0, +v || 0); },
      setEnvCenter(x, y, z) { _envCenterUniform.set(x, y, z); },
      /* Orbit a gathered continent (centroid + its radius). */
      setFocus(centroid, radius) {
        focusPt = focusPt ? focusPt.copy(centroid) : centroid.clone();
        focusR = (radius != null ? radius : 6) + 4;   // ring OUTSIDE the continent (4u clearance) without cutting toward the viewer
      },
      /* Stop focusing. smash=true → barrel straight through the space
         on the way out (a dramatic exit that scatters its atoms). */
      clearFocus(smash) {
        if (smash && focusPt) {
          smashTarget.copy(focusPt).sub(headPos);
          if (smashTarget.lengthSq() < 1e-6) smashTarget.set(0, 0, -1); else smashTarget.normalize();
          smashTarget.multiplyScalar(16).add(focusPt);   // a point well past the continent
          smashUntil = performance.now() + 1500;
        }
        focusPt = null;
      },
      dispose() {
        scene.remove(bodyMesh);
        if (bodyMesh.geometry) bodyMesh.geometry.dispose();
        mat.dispose();
        scene.remove(labelMesh);
        labelGeom.dispose();
        labelMat.dispose();
        labelTex.dispose();
        if (envTex) envTex.dispose();
        if (cubeTarget) cubeTarget.dispose();
      },
    };
  }

  window.omegaR3D = window.omegaR3D || {};
  window.omegaR3D.createLiquidMetal = createLiquidMetal;
})();
