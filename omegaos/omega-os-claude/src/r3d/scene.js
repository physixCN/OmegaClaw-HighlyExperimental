/* src/r3d/scene.js — Three.js scene for the Omega chamber.

   Architecture (post-hypergraph pivot):
     • Scene + camera + lights.
     • Core sphere (Omega's body) — now a near-transparent ghost
       placeholder, will be replaced later.
     • Atoms as InstancedMesh of small icosahedrons — positions
       come from omegaR3D.layout (one hypergraph, spaces = 3D
       regions). One draw call for the full field.
     • Edges as a single LineSegments mesh — the relevance signal
       made visible. One draw call for the full edge set.
     • Frame loop ticks the core hooks and renders.

   Re-runs layout + rebuilds atoms/edges on omegaGraph mutations,
   so growth / merge / retire / relink all flow through and the
   chamber re-arranges naturally. */

(function () {
  /* Build a unit-icosahedron "wireframe" out of solid CYLINDER tubes
     along each of the 30 edges. The result is a single merged
     BufferGeometry suitable for instancing — every atom shell uses
     this same geometry, scaled per instance.

     Why not THREE.WireframeGeometry + LineBasicMaterial? GL_LINES
     are 1-px wide and look dim against multi-fragment sphere cores
     at HDR. Tube edges have actual thickness, so additive HDR
     blending saturates them to brilliance just like the cores. */
  function buildTubedIcosahedron(tubeRadius, lengthFrac) {
    const THREE = window.THREE;
    const base = new THREE.IcosahedronGeometry(1, 0);
    const edgeGeom = new THREE.EdgesGeometry(base);
    const posAttr = edgeGeom.attributes.position;

    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    const tmpDir = new THREE.Vector3();
    const tmpMid = new THREE.Vector3();
    const tmpMat = new THREE.Matrix4();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const tmpQuat = new THREE.Quaternion();
    const tmpScale = new THREE.Vector3(1, 1, 1);

    const positions = [];
    const normals   = [];
    const indices   = [];
    let baseIdx = 0;

    for (let i = 0; i < posAttr.count; i += 2) {
      tmpA.fromBufferAttribute(posAttr, i);
      tmpB.fromBufferAttribute(posAttr, i + 1);
      const fullLen = tmpA.distanceTo(tmpB);
      /* Truncate each cylinder so it ends short of the icosahedron's
         vertices. With 5 edges meeting at every vertex, allowing
         tubes to reach the vertex causes 5-way additive pile-ups
         that saturate to a "white rim" around each atom. Shrinking
         each tube to 86% of the edge length leaves a small gap at
         every vertex — no overlap, no pile-up, uniform colour.
         (§32: with OPAQUE shading there is no additive pile-up, so the
         live cages pass lengthFrac=1.0 — full edges meeting in real
         vertex knots, exactly like the forge.) */
      const len = fullLen * (lengthFrac != null ? lengthFrac : 0.86);
      tmpDir.subVectors(tmpB, tmpA).normalize();
      tmpMid.copy(tmpA).add(tmpB).multiplyScalar(0.5);

      const cyl = new THREE.CylinderGeometry(
        tubeRadius, tubeRadius, len, 6, 1, true
      );
      tmpQuat.setFromUnitVectors(yAxis, tmpDir);
      tmpMat.compose(tmpMid, tmpQuat, tmpScale);
      cyl.applyMatrix4(tmpMat);

      const cylPos  = cyl.attributes.position.array;
      const cylNorm = cyl.attributes.normal.array;
      const cylIdx  = cyl.index.array;
      for (let k = 0; k < cylPos.length;  k++) positions.push(cylPos[k]);
      for (let k = 0; k < cylNorm.length; k++) normals.push(cylNorm[k]);
      for (let k = 0; k < cylIdx.length;  k++) indices.push(cylIdx[k] + baseIdx);
      baseIdx += cylPos.length / 3;

      cyl.dispose();
    }
    base.dispose();
    edgeGeom.dispose();

    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    out.setAttribute("normal",   new THREE.Float32BufferAttribute(normals, 3));
    out.setIndex(indices);
    return out;
  }

  function createOmegaScene(canvas) {
    const THREE = window.THREE;
    if (!THREE) {
      console.warn("[omegaR3D] THREE not loaded");
      return { dispose() {} };
    }
    const { colorFor, magicColorFor, cameraDefault } = window.omegaR3D;

    /* ── Renderer + scene + camera ─────────────────────────────── */
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    /* §40 — the void's resting tint is the forge's 0x04060c (a breath of
       blue in the black), via the canvas CSS backdrop behind the
       transparent clear — same path the space-colour pref uses. */
    canvas.style.background = "#04060c";
    /* HDR-style rendering. ACES Filmic tone mapping compresses the
       very-bright additive core colors into the LDR framebuffer
       gracefully — the cores can have RGB values well above 1.0
       ("HDR values") and the tonemap handles the rolloff so they
       read as truly blown-out bright at the center rather than
       clipped flat. Combined with the halo layer below this gives a
       film-grade bloom feel without a full postprocess chain. */
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    /* Energy-mode exposure — the frame loop eases the live exposure
       toward exposureTarget so the field brightens (creative) or dims
       (asleep) smoothly. Driven by App via the handle's setExposure(). */
    let exposureTarget = renderer.toneMappingExposure;

    const scene = new THREE.Scene();
    /* Scene fog — atoms close to camera render at full brightness;
       distant atoms (toward chamber edge) fade into the dark void.
       This is what makes the sea read as VAST: depth through
       gradient, not just position. Linear fog so the falloff is
       readable, near = R_INNER edge, far = R_OUTER edge. Numbers
       match the layout in layout.js. */
    scene.fog = new THREE.Fog(0x000000, 8, 36);
    const camera = new THREE.PerspectiveCamera(
      cameraDefault.fov, 1, cameraDefault.near, cameraDefault.far
    );
    camera.position.set(
      cameraDefault.position.x,
      cameraDefault.position.y,
      cameraDefault.position.z
    );
    camera.lookAt(
      cameraDefault.target.x,
      cameraDefault.target.y,
      cameraDefault.target.z
    );

    /* Selective additive bloom (handoff task 3) — created further
       down once atoms + comet exist; declared up here so resize()
       can size its render targets from first call. */
    const BLOOM_LAYER = 1;
    let bloom = null;
    const _dbSize = new THREE.Vector2();

    function resize() {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      /* Bloom targets track the DRAWING-BUFFER size (× pixelRatio)
         so the glow's texel density matches the rendered frame. */
      if (bloom) {
        const db = renderer.getDrawingBufferSize(_dbSize);
        bloom.setSize(db.x, db.y);
      }
    }
    resize();
    window.addEventListener("resize", resize);

    /* ── Lights ────────────────────────────────────────────────── */
    const ambient = new THREE.AmbientLight(0xffffff, 0.42);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xfff4d8, 1.15);
    key.position.set(3, 4, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.32);
    fill.position.set(-4, -2, 3);
    scene.add(fill);

    /* §40 — STARFIELD backdrop (forge §28e, ported): 700 faint blue-white
       specks on a shell behind the atom field (48–93u; far plane 200).
       One draw call, additive, never blooms (layer 0). */
    let starfield = null;
    {
      const SN = 700, sp = [];
      for (let i = 0; i < SN; i++) {
        const r = 48 + Math.random() * 45, t = Math.random() * 6.28, p = Math.acos(2 * Math.random() - 1);
        sp.push(r * Math.sin(p) * Math.cos(t), r * Math.sin(p) * Math.sin(t), r * Math.cos(p));
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
      starfield = new THREE.Points(sg, new THREE.PointsMaterial({
        color: 0x6688bb, size: 0.16, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      scene.add(starfield);
    }

    /* §40 — the SHINE sprite (forge haloTexture, verbatim). */
    function haloTexture() {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const x = c.getContext("2d");
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,255,255,0.85)");
      g.addColorStop(0.25, "rgba(255,255,255,0.28)");
      g.addColorStop(0.6, "rgba(255,255,255,0.07)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    }
    const _haloTex = haloTexture();

    /* ── Core sphere (Omega's body — placeholder) ──────────────── */
    let core = null;
    if (window.omegaR3D && window.omegaR3D.createCoreSphere) {
      core = window.omegaR3D.createCoreSphere(scene);
    }

    /* ── Atoms + edges ─────────────────────────────────────────── */
    /* Two layers per atom for the "jewel with a shining heart":
         atoms     — outer icosahedron, faceted, lit by the scene,
                     translucent so the inner light bleeds through.
         atomCores — small additive-blended sphere at each atom
                     centre, full-bright family color. Reads as a
                     tiny brilliantly shining particle of light
                     inside its containing atom — same hue, much
                     more luminous. */
    let atoms = null;           // THE atom: one instanced WIRE CAGE (30 cylinder filaments, §32)
    let atomCores = null;       // tiny invisible proxy (layer 3) — bloom-mask depth only (§32)
    let atomHalos = null;       // (old halo spheres removed — the energy field carries its own glow)
    let atomOuterHalos = null;  // (removed)

    /* ── §32: THE ATOM IS A WIRE CAGE (the Comet Forge field, mainlined) ──
       The §22h energy field below is RETIRED (kept dormant for reference,
       like liquidMetal's tube builder). The live atom is the forge's §28f
       solid-body cage: 30 real cylinder filaments along the icosahedron's
       edges (full-length — no additive pile-up with opaque shading), bare
       of halo and bloom (§28m noir: shine 0). Colour still flows from each
       atom's instanceColor (magicColorFor + proximity glow), so the field
       keeps its semantic families. Opaque + depthWrite ⇒ cages occlude
       each other, the comet and the label natively. */
    let atomScale = 0.355;     // §40 — BACK TO THE FORGE PROPORTION (user: "the atoms in
                               //   index.html do NOT match the design we created"). §32d's
                               //   density shrink to 0.16 is retired — the forge look wins.
                               //   Live via Tweaks "Cage size".
    let cageTubeR = 0.0286;    // §40 — the forge's exact filament ratio (edge 0.012 ÷
                               //   ATOM_R 0.42): thin crisp lines, not chunky tubes.
    /* §40 — depth fade OFF by default: the forge design has NO fog — far
       atoms stay fully saturated, smaller only by perspective (the
       screenshot law). It also fixes a mirror/world mismatch: the §35a
       feed carries unfogged colours, so with fog on the ball reflected
       far atoms BRIGHTER than the eye saw them. Toggle lives in Tweaks. */
    let cageFog = false;
    /* Live tuning hook (Tweaks): window.__omegaAtomCage.set(v) rebuilds
       the shared cage geometry at the new filament thickness. */
    window.__omegaAtomCage = {
      get() { return cageTubeR; },
      set(v) {
        const r = Math.max(0.01, Math.min(0.2, +v || 0.05));
        if (r === cageTubeR) return;
        cageTubeR = r;
        rebuildAtoms();
      },
      getScale() { return atomScale; },
      setScale(v) {
        const s = Math.max(0.08, Math.min(0.7, +v || 0.16));
        if (s === atomScale) return;
        atomScale = s;
        rebuildAtoms();
      },
      getFog() { return cageFog; },
      setFog(on) {
        const f = !!on;
        if (f === cageFog) return;
        cageFog = f;
        rebuildAtoms();
      },
    };
    function makeAtomCageMaterial() {
      return new THREE.MeshBasicMaterial({
        toneMapped: false,   // §28m noir: exact colour, no ACES rolloff
        fog: cageFog,        // §32c — depth fade (default on; forge-crisp = off via Tweaks)
      });
    }

    /* (retired §22h energy field — dormant) Unit-icosahedron edges
       (circumradius 1) shared by every atom's energy field. (Backend
       note: when OmegaClaw feeds real per-atom structure (4–15 edges
       typically), this becomes per-atom; the shader already generalises
       to any edge count via the NE define.) */
    function unitIcosaEdges() {
      const t = (1 + Math.sqrt(5)) / 2, n = Math.sqrt(1 + t * t);
      const raw = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],
                   [0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]];
      const V = raw.map((v) => new THREE.Vector3(v[0]/n, v[1]/n, v[2]/n));
      let min = Infinity;
      for (let i=0;i<V.length;i++) for (let j=i+1;j<V.length;j++) min = Math.min(min, V[i].distanceTo(V[j]));
      const A = [], B = [];
      for (let i=0;i<V.length;i++) for (let j=i+1;j<V.length;j++)
        if (V[i].distanceTo(V[j]) < min*1.05) { A.push(V[i]); B.push(V[j]); }
      return { A, B };
    }
    const ATOM_EDGES = unitIcosaEdges();
    /* Energy recipe (the Forge "Electric" look, ported). Colour is NOT here —
       it comes from each atom's instanceColor (magicColorFor + proximity glow);
       the hot core is that hue pushed toward white. uTime is ticked per frame. */
    const atomEnergyUniforms = {
      uTime:{value:0}, uThick:{value:0.038}, uCore:{value:3.6}, uHalo:{value:1.8},
      uIntensity:{value:2.1}, uFlow:{value:6.0}, uFlowSharp:{value:3.0}, uArc:{value:3.0},
      uFlicker:{value:0.5}, uHotMix:{value:0.45}, uHueHold:{value:0.85},
      uEA:{value:ATOM_EDGES.A}, uEB:{value:ATOM_EDGES.B},
    };
    /* Live tuning hook (Tweaks panel). Set a uniform by name, e.g.
       window.__omegaAtomEnergy.set('uCore', 3.6). */
    window.__omegaAtomEnergy = {
      get(k) { return atomEnergyUniforms[k] ? atomEnergyUniforms[k].value : undefined; },
      set(k, v) { if (atomEnergyUniforms[k]) atomEnergyUniforms[k].value = v; },
    };
    /* The atom material: a MeshBasicMaterial (so it inherits three's
       instancing, fog, tonemapping & colorspace plumbing) whose fragment is
       replaced via onBeforeCompile with the analytic energy field — exact
       closest distance from the view ray to each edge, summed (seamless
       vertices, one object), driven by the atom's own colour. */
    function makeAtomEnergyMaterial() {
      const m = new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, depthTest: true, side: THREE.FrontSide,
        toneMapped: true, fog: true,
      });
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, atomEnergyUniforms);
        shader.vertexShader = "varying vec3 vLocalCam;\nvarying vec3 vLocalPos;\nvarying float vCamDist;\n" +
          shader.vertexShader.replace("#include <begin_vertex>",
            "#include <begin_vertex>\n" +
            " mat3 _M3 = mat3(instanceMatrix);\n" +
            " float _s2 = max(dot(_M3[0], _M3[0]), 1e-6);\n" +
            " mat3 _inv = transpose(_M3) / _s2;\n" +
            " vLocalCam = _inv * (cameraPosition - instanceMatrix[3].xyz);\n" +
            " vLocalPos = position;\n" +
            " vCamDist = length(cameraPosition - instanceMatrix[3].xyz);\n");
        shader.fragmentShader =
          "#define NE " + ATOM_EDGES.A.length + "\n" +
          "uniform float uTime,uThick,uCore,uHalo,uIntensity,uFlow,uFlowSharp,uArc,uFlicker,uHotMix,uHueHold;\n" +
          "uniform vec3 uEA[NE]; uniform vec3 uEB[NE];\n" +
          "varying vec3 vLocalCam; varying vec3 vLocalPos; varying float vCamDist;\n" +
          "float _shim(float s){return 0.5+0.5*(0.6*sin(uTime*6.0+s*4.0)+0.4*sin(uTime*11.3+s*9.1));}\n" +
          "float _raySeg(vec3 ro,vec3 rd,vec3 a,vec3 b,out float s){vec3 v=b-a;vec3 w=ro-a;float bb=dot(rd,v);float cc=dot(v,v);float dd=dot(rd,w);float ee=dot(v,w);float den=cc-bb*bb;float sc,tc;if(den<1e-5){tc=0.0;sc=clamp(ee/cc,0.0,1.0);}else{tc=(bb*ee-cc*dd)/den;sc=clamp((ee-bb*dd)/den,0.0,1.0);}tc=max(tc,0.0);return length((ro+rd*tc)-(a+v*sc));}\n" +
          shader.fragmentShader.replace("#include <color_fragment>",
            "#include <color_fragment>\n" +
            " vec3 _base = diffuseColor.rgb;\n" +
            /* Distance washout fix: far atoms cover few pixels, so each\n
               lit pixel's ray passes near MANY edges at once — the additive\n
               sum + white hot-core + ACES clipping bleaches hue exactly\n
               where the atom is smallest. _far eases in over 5→24u and\n
               (scaled by uHueHold) (a) fades the white core out so far\n
               atoms render pure hue, and (b) lowers a HUE-PRESERVING\n
               ceiling — the max channel is capped by scaling all three\n
               together, so brightness compresses but chroma survives the\n
               tonemap. Near (_far=0) the recipe is untouched. */
            /* CHROMATIC core: luminescence through OVERBRIGHT HUE, never a
               white mix. The old vec3(1.0) mix bleached every filament
               centre to paper; an overbright copy of the atom's own colour
               tonemaps to an intense saturated core instead (white only
               appears when all three channels rise together). uHotMix now
               means "how incandescent", not "how white". */
            " float _far = smoothstep(4.0, 18.0, vCamDist) * uHueHold;\n" +
            " vec3 _hot = _base * (1.0 + 2.2 * uHotMix * (1.0 - _far));\n" +
            " vec3 _rd = normalize(vLocalPos - vLocalCam);\n" +
            " vec3 _acc = vec3(0.0); float _g = 0.0;\n" +
            " for(int e=0;e<NE;e++){ float s; float d=_raySeg(vLocalCam,_rd,uEA[e],uEB[e],s);\n" +
            "   float xc=d/uThick; float gc=1.0/(1.0+xc*xc*uCore);\n" +
            "   float xh=d/(uThick*uHalo); float gh=1.0/(1.0+xh*xh)*mix(0.16, 0.62, _far);\n" +
            "   float fw=pow(0.5+0.5*sin(s*6.2831*uArc-uTime*uFlow+float(e)*1.7),uFlowSharp);\n" +
            "   float fl=mix(1.0,_shim(float(e)),uFlicker);\n" +
            "   float ec=gc*(0.55+0.7*fw)*fl;\n" +
            "   _acc += mix(_base,_hot,clamp(gc*0.85,0.0,1.0))*ec + _base*gh;\n" +
            "   _g += ec + gh*0.4; }\n" +
            " _acc *= uIntensity;\n" +
            /* Luminescent far-field: rather than capping brightness (dims)
               or letting channels clip (whitens), re-project the colour onto
               its PURE family hue at a vivid HDR level — far atoms read as
               bright saturated gems, not white dust. */
            " float _mx = max(_acc.r, max(_acc.g, _acc.b));\n" +
            " vec3 _pure = _base / max(max(_base.r, max(_base.g, _base.b)), 1e-4);\n" +
            " float _lvl = min(_mx, mix(3.2, 1.8, _far));\n" +
            " _acc = mix(_acc, _pure * _lvl, _far);\n" +
            " float _aout = clamp(_g, 0.0, 1.0);\n" +
            " if(_aout < 0.004) discard;\n" +
            " diffuseColor = vec4(_acc, _aout);\n");
      };
      m.customProgramCacheKey = () => "atomEnergyField";
      return m;
    }
    /* Mini-mirror — a TINY entangled copy of the chamber, sitting
       in front of the viewer as a navigational core/control centre.
       Same atoms (same omegaGraph), so future per-atom state lights
       up in BOTH layers. */
    /* Chamber-scale push state — populated by rebuildAtoms. World
       positions + rest matrices for every chamber atom shell, so
       updateChamberPush can displace them around the giant chamber
       snake just like the mini does around the mini snake. */
    let chamberAtomWorldPositions = null;
    let chamberAtomRestMatrices = null;
    let chamberAtomDisplaceState = null;
    /* §38 — declared: these three were assigned in rebuildAtoms without
       declaration (accidental window globals — shared across scene
       instances on a renderer toggle). */
    let atomsRestMatrices = null;
    let atomsPositionsXYZ = null;
    let chamberDisplaceState = null;
    /* Base shell colour per chamber atom — captured once in
       rebuildAtoms, used each frame as the "rest" colour that the
       snake-proximity boost multiplies on top of. */
    let chamberAtomBaseColors = null;
    /* Per-atom rigid-body state for true 3D collision response:
       baseQuat — the baked random orientation; scale — uniform shell
       scale; radius — collision radius (icosa circumradius ≈ scale);
       spin — dynamic tumble quaternion accumulated from impacts;
       angVel — angular velocity (world axis · rad/s) that decays. */
    let chamberAtomBaseQuat = null;
    let chamberAtomScale = null;
    let chamberAtomRadius = null;
    let chamberAtomSpin = null;
    let chamberAtomAngVel = null;
    let chamberAtomFloating = null;   // 0 = home/resting · 1 = weightless drift
    let chamberAtomFloatAge = null;
    let edgeLines = null;
    let atomPositions = new Map();

    /* ── Gather state (Evolution Plan §12.1/§15) ───────────────────
       Per-atom TRANSITION model: each atom eases gFrom → gTo along an
       arced path (a perpendicular BOW so motion curves naturally, not
       a straight elastic line), over a staggered duration. `gOwner` is
       the space it's gathered into (or null = resting). On disperse it
       eases to a NEW jittered spot near its base and settles there —
       so atoms scatter and find a fresh home, never snapping back to an
       identical point; they only re-unite when summoned again. The
       collision spring still tracks the (moving) home, so cores, halos
       and glow ride along for free. */
    let baseShellPositions = null;   // immutable layout home (jitter measured from here)
    let restShellPositions = null;   // current resting home per atom
    let gatherTargets = null;        // continent slot per member (workspace)
    let gFrom = null, gTo = null, gBow = null, gDur = null, gEase = null, gGlow = null;
    let gOwner = null;               // Array<string|null> — gathered-into space per atom
    let gatherDelay = null;          // per-atom stagger 0..1
    let gatherCycle = 0;             // advances each transition batch → fresh bows/jitter
    let atomNodes = null;            // the node array backing the current atoms mesh
    let gatherSpace = null;          // currently-gathered space name, or null
    let lastGatherMs = 0;
    let gatherActiveEase = 0;        // 0..1 eased — 1 while a continent is gathered (dims non-members)
    /* Satellites — summoned atoms that ORBIT Omega's locus (the comet)
       like moons / a galaxy disc, following her as she roams. Each entry:
       { i, r, phase, speed, ax,ay,az, bx,by,bz } where (a,b) are the two
       in-plane unit axes of that satellite's tilted orbit. */
    let satellites = [];
    const satelliteSet = new Set();
    /* A single summoned atom is pinned to the VIEWPORT CENTRE (tracks the
       camera each frame), so it's always centred + visible for its detail
       card to grow out of. */
    let summonAtomIdx = -1;
    /* 1 = the summoned atom renders normally; eased toward 0 during the
       atom→window edge morph so the real atom DISSOLVES into the morphing
       shape (instead of sitting inside the opened window). Set via
       setSummonReveal(); reset to 1 on a fresh summon / endSummon. */
    let summonReveal = 1;
    /* When the summoned atom is released, its core/halo instance scale was
       last written shrunk — flag it so the next compose restores full
       scale (the lockstep loop normally only writes translation). */
    let summonScaleDirtyIdx = -1;
    const _camDir2 = new THREE.Vector3();
    const _summonDock = new THREE.Vector3();   // fixed world point the summoned atom holds at (in front of the comet)
    let summonQuiet = false;                   // quiet summon (surface/chat): park the comet AWAY, don't orbit the dock
    const _summonPark = new THREE.Vector3();   // where the comet parks during a quiet summon (far + off to the side)
    let smashHoldUntil = 0;          // hold the camera on a continent while she smashes out
    const _gCentroid = new THREE.Vector3();
    const _tmpHSL2 = new THREE.Color();   // scratch for atom hue extraction (screenPosOf)
    let focusTarget = null;          // camera look-target override (continent centroid) or null

    /* ── Brightness consistency helpers ────────────────────────
       The old inconsistency came from THREE things stacking: each
       layer used a different colour formula, the core brightness
       swung with salience (×0.95–1.6), and the halos used the flat
       family base hue (≠ the shell's jittered hue → "two colours").

       Fix: every layer derives from the SAME magicColorFor hue and
       is normalised to a CONSTANT peak channel per layer (setPeak).
       Peak-normalising keeps full fluorescent saturation (no
       whitening) while giving every atom the same brightness ceiling
       regardless of hue or salience. A gentle optional luma-even
       (evenLuma, small amount) takes the edge off the natural
       yellow-vs-blue luminance gap WITHOUT washing colours out. */
    const _LR = 0.2126, _LG = 0.7152, _LB = 0.0722;
    function setPeak(c, peak) {
      const m = Math.max(c.r, c.g, c.b) || 1;
      const k = peak / m;
      c.r *= k; c.g *= k; c.b *= k;
    }
    function evenLuma(c, target, amount) {
      const l = _LR * c.r + _LG * c.g + _LB * c.b;
      if (l <= 1e-4) return;
      let er, eg, eb;
      if (l < target) {
        const t = (target - l) / (1 - l);
        er = c.r + (1 - c.r) * t; eg = c.g + (1 - c.g) * t; eb = c.b + (1 - c.b) * t;
      } else {
        const k = target / l; er = c.r * k; eg = c.g * k; eb = c.b * k;
      }
      c.r += (er - c.r) * amount;
      c.g += (eg - c.g) * amount;
      c.b += (eb - c.b) * amount;
    }

    function rebuildAtoms() {
      const g = window.omegaGraph;
      if (!g) return;
      const nodes = g.nodes;
      const edges = g.edges || [];
      if (!nodes.length) return;

      /* Layout the hypergraph. Spaces auto-discovered, edges pull
         relevant atoms toward each other. Returns a Map<id, {x,y,z}>. */
      const layout = window.omegaR3D.layout.compute(g);
      atomPositions = layout.positions;
      /* Alloc/refresh chamber-atom collision buffers — match the
         current node count. */
      atomsRestMatrices = new Float32Array(nodes.length * 16);
      atomsPositionsXYZ = new Float32Array(nodes.length * 3);
      chamberDisplaceState = new Float32Array(nodes.length * 3);
      /* Aliases used by the per-frame chamber push (downstream code
         references these names). */
      chamberAtomRestMatrices = atomsRestMatrices;
      chamberAtomWorldPositions = atomsPositionsXYZ;
      chamberAtomDisplaceState = chamberDisplaceState;
      /* Rigid-body state buffers for collision spin. */
      chamberAtomBaseQuat = new Float32Array(nodes.length * 4);
      chamberAtomScale    = new Float32Array(nodes.length);
      chamberAtomRadius   = new Float32Array(nodes.length);
      chamberAtomSpin     = new Float32Array(nodes.length * 4);
      chamberAtomAngVel   = new Float32Array(nodes.length * 3);
      chamberAtomFloating = new Uint8Array(nodes.length);
      chamberAtomFloatAge = new Float32Array(nodes.length);
      for (let i = 0; i < nodes.length; i++) chamberAtomSpin[i * 4 + 3] = 1; // identity

      /* ── Atoms (instanced tube-edge polyhedra) ─────────────── */
      /* Each atom is rendered as the 30 EDGES of a unit
         icosahedron, where every edge is a thin CYLINDER (a "tube").
         Wireframe mode gave us 1-px GL_LINES which looked dim next
         to the multi-fragment sphere cores; tube edges have actual
         pixel-width and saturate at HDR the same way the cores do.
         The shell is pre-baked once into a single merged geometry
         and instanced across the field — still one draw call. */
      const geom = buildTubedIcosahedron(cageTubeR, 1.0);   // §32 — the forge cage: 30 full-length filaments, unit circumradius
      const mat = makeAtomCageMaterial();
      const instanced = new THREE.InstancedMesh(geom, mat, nodes.length);
      instanced.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(nodes.length * 3), 3
      );

      const tmpMat   = new THREE.Matrix4();
      const tmpPos   = new THREE.Vector3();
      const tmpQuat  = new THREE.Quaternion();
      const tmpScale = new THREE.Vector3();
      const tmpEuler = new THREE.Euler();
      const tmpColor = new THREE.Color();

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const p = atomPositions.get(n.id) || { x: 0, y: 0, z: 0 };
        tmpPos.set(p.x, p.y, p.z);

        /* Deterministic rotation per atom id so light catches each
           one differently. */
        let h = 0;
        for (let k = 0; k < n.id.length; k++) h = (h * 31 + n.id.charCodeAt(k)) | 0;
        const a = ((h       & 0xff) / 255) * Math.PI * 2;
        const b = ((h >> 8) & 0xff) / 255 * Math.PI * 2;
        const c = ((h >> 16)& 0xff) / 255 * Math.PI * 2;
        tmpEuler.set(a, b, c);
        tmpQuat.setFromEuler(tmpEuler);

        const sal = n.salience != null ? n.salience : 0.5;
        /* Uniform world-size on purpose: apparent size = DISTANCE only,
           so perspective reads honestly (near = bigger). Importance
           (salience) now lives in GLOW BRIGHTNESS, not scale. */
        const s = atomScale;
        tmpScale.set(s, s, s);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        instanced.setMatrixAt(i, tmpMat);
        /* Capture rigid-body rest state for collision spin. */
        if (chamberAtomBaseQuat) {
          chamberAtomBaseQuat[i * 4 + 0] = tmpQuat.x;
          chamberAtomBaseQuat[i * 4 + 1] = tmpQuat.y;
          chamberAtomBaseQuat[i * 4 + 2] = tmpQuat.z;
          chamberAtomBaseQuat[i * 4 + 3] = tmpQuat.w;
          chamberAtomScale[i]  = s;
          chamberAtomRadius[i] = s;   // icosa circumradius (unit) × scale
        }
        /* Capture chamber atom rest state so collision push can
           displace + restore each frame without losing the
           orientation/scale. Positions also stored as a flat XYZ
           buffer for the distance loop. */
        if (atomsRestMatrices) {
          for (let k = 0; k < 16; k++) {
            atomsRestMatrices[i * 16 + k] = tmpMat.elements[k];
          }
        }
        if (atomsPositionsXYZ) {
          atomsPositionsXYZ[i * 3 + 0] = tmpPos.x;
          atomsPositionsXYZ[i * 3 + 1] = tmpPos.y;
          atomsPositionsXYZ[i * 3 + 2] = tmpPos.z;
        }

        /* (§38 — a second “capture rest state” block was here, re-writing
           the SAME values into the same buffers through the aliases and
           guarding a re-alloc that could never trigger — removed.) */

        /* §32a — EXACT forge colour: the flat family hex, no per-atom
           hue jitter, no peak/luma processing. The forge cages are the
           raw palette (its FAM list IS the "spectrum" preset) — that
           flatness is the look. */
        tmpColor.setHex(colorFor(n.family));
        instanced.setColorAt(i, tmpColor);
        /* Save the boosted base colour so the per-frame snake-glow
           routine can multiply on top of it. */
        if (!chamberAtomBaseColors || chamberAtomBaseColors.length !== nodes.length * 3) {
          chamberAtomBaseColors = new Float32Array(nodes.length * 3);
        }
        chamberAtomBaseColors[i * 3 + 0] = tmpColor.r;
        chamberAtomBaseColors[i * 3 + 1] = tmpColor.g;
        chamberAtomBaseColors[i * 3 + 2] = tmpColor.b;
      }
      instanced.instanceMatrix.needsUpdate = true;
      if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;

      /* ── Gather buffers ────────────────────────────────────────
         Snapshot the resting galaxy as each atom's base + current home,
         seed every atom "settled at rest" (gEase=1, no owner), and reset
         the gather frame — node indices just changed, so any in-flight
         gather is void. A per-atom stagger from the id hash de-syncs the
         motion so a gather "pulls itself together" rather than snapping
         as one rigid body. */
      const cnt = nodes.length;
      baseShellPositions = new Float32Array(cnt * 3);
      restShellPositions = new Float32Array(cnt * 3);
      gatherTargets      = new Float32Array(cnt * 3);
      gFrom = new Float32Array(cnt * 3);
      gTo   = new Float32Array(cnt * 3);
      gBow  = new Float32Array(cnt * 3);
      gDur  = new Float32Array(cnt);
      gEase = new Float32Array(cnt);
      gGlow = new Float32Array(cnt);
      gOwner = new Array(cnt).fill(null);
      gatherDelay = new Float32Array(cnt);
      atomNodes = nodes;
      for (let i = 0; i < cnt; i++) {
        const ix = i * 3;
        for (let k = 0; k < 3; k++) {
          const v = chamberAtomWorldPositions[ix + k];
          baseShellPositions[ix + k] = v;
          restShellPositions[ix + k] = v;
          gFrom[ix + k] = v; gTo[ix + k] = v;
        }
        gEase[i] = 1; gDur[i] = 1;
        const id = nodes[i].id;
        let h = 2166136261 >>> 0;
        for (let c = 0; c < id.length; c++) { h ^= id.charCodeAt(c); h = Math.imul(h, 16777619); }
        gatherDelay[i] = ((h >>> 9) & 0xffff) / 0xffff;
      }
      gatherSpace = null;
      focusTarget = null;

      if (atoms) {
        scene.remove(atoms);
        atoms.geometry.dispose();
        atoms.material.dispose();
        atoms.dispose && atoms.dispose();
      }
      atoms = instanced;
      scene.add(atoms);
      /* §32 — noir cages do NOT bloom (§28m: shine 0, bare filaments);
         only the neon name ring blooms. The cages are solid geometry
         (depthWrite true), so they occlude natively in the main pass —
         no bloom layer, no depth tricks. */

      /* ── Atom DEPTH PROXY (bloom mask only — §32) ──────────────
         The solid cages write their own depth in the main pass now, so
         the old main-buffer depth pre-pass is gone. This invisible
         layer-3 proxy remains ONLY for the bloom pass's mask depth
         (atoms in front of the name ring cull its glow). */
      const proxyGeom = new THREE.SphereGeometry(1, 8, 6);
      const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
      const proxy = new THREE.InstancedMesh(proxyGeom, proxyMat, nodes.length);
      const proxyMat4 = new THREE.Matrix4();
      const proxyQuat = new THREE.Quaternion();
      const proxyScaleV = new THREE.Vector3();
      const proxyPos = new THREE.Vector3();
      const PROXY_R = atomScale * 0.6;   // ~0.6× the cage radius: fair atom-occlusion ball
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const p = atomPositions.get(n.id) || { x: 0, y: 0, z: 0 };
        proxyPos.set(p.x, p.y, p.z);
        proxyQuat.identity();
        proxyScaleV.set(PROXY_R, PROXY_R, PROXY_R);
        proxyMat4.compose(proxyPos, proxyQuat, proxyScaleV);
        proxy.setMatrixAt(i, proxyMat4);
      }
      proxy.instanceMatrix.needsUpdate = true;
      if (atomCores) {
        scene.remove(atomCores);
        atomCores.geometry.dispose();
        atomCores.material.dispose();
        atomCores.dispose && atomCores.dispose();
      }
      atomCores = proxy;
      scene.add(atomCores);
      atomCores.layers.set(3);   // ONLY layer 3 → invisible in main, drives the depth pre-pass
      /* §40 — THE SHINE (the forge halo layer, mainlined): one additive
         radial sprite per atom, vertex-coloured from the SAME base-colour
         buffer the cages use (palette retints flow through for free).
         Size/opacity ride the "Shine" tweak each frame; positions ride
         the live (collided/gathered) atom positions in lockstep below. */
      if (atomHalos) {
        scene.remove(atomHalos);
        atomHalos.geometry.dispose();
        atomHalos.material.dispose();
      }
      {
        const hg = new THREE.BufferGeometry();
        const hp = new Float32Array(cnt * 3);
        hp.set(chamberAtomWorldPositions);
        hg.setAttribute("position", new THREE.BufferAttribute(hp, 3));
        hg.setAttribute("color", new THREE.BufferAttribute(chamberAtomBaseColors, 3));
        const hm = new THREE.PointsMaterial({
          map: _haloTex, vertexColors: true, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false,
          size: 2.0, sizeAttenuation: true, opacity: 0.33,
          fog: cageFog,
        });
        atomHalos = new THREE.Points(hg, hm);
        atomHalos.frustumCulled = false;
        scene.add(atomHalos);
      }
      atomOuterHalos = null;

      /* (mini-mirror layer removed — it was dead code: buildMiniMirror
         returned null on its first line, so all mini shells/cores/halos
         were null and never rendered.) */

      /* ── Edges (LineSegments) ───────────────────────────────── */
      /* One geometry holds every edge as two vertices. Faint
         additive blending so dense bundles build brightness
         organically. Cross-space edges are the long lines
         connecting separate regions of the hypergraph. */
      /* Edges as line segments. Slightly more opaque so they read
         clearly against the dark void at chamber distance — the
         relevance signal is the whole point of the hypergraph view. */
      const edgePositions = [];
      for (const e of edges) {
        const a = atomPositions.get(e.source);
        const b = atomPositions.get(e.target);
        if (!a || !b) continue;
        edgePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      const edgeGeom = new THREE.BufferGeometry();
      edgeGeom.setAttribute("position",
        new THREE.Float32BufferAttribute(edgePositions, 3));
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x2a3b52,
        transparent: true,
        opacity: 0.10,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
      });
      if (edgeLines) {
        scene.remove(edgeLines);
        edgeLines.geometry.dispose();
        edgeLines.material.dispose();
      }
      edgeLines = new THREE.LineSegments(edgeGeom, edgeMat);
      scene.add(edgeLines);
    }
    rebuildAtoms();

    /* (§38 — `liquidLight` removed: the legacy mini-snake variable was
       permanently null; the frame loop tested it forever.) */

    /* ── Chamber-scale snake (entangled mirror) ─────────────────
       Same snake, rendered at universe scale around the viewer.
       Reads the mini-snake's positions each frame and re-emits
       them through the inverse mini-mirror transform so the body
       traces the SAME path in the giant chamber, scaled up. Shares
       the colour buffer so the rainbow cycles in lockstep with
       the mini version — true quantum entanglement. */
    /* ── Universe-scale liquid-metal mass ──────────────────────
       Replaces the old chamber-scale rainbow snake. A cinematic
       floating chrome/mercury blob with elastic trailing tendrils,
       reflecting baked environment lighting. See liquidMetal.js. */
    let liquidMetal = null;
    /* (§38 — _envRadiusSet/_shellMeanR/_envSmoothR removed: the §27d
       sphere-projection radius machinery fed liquidMetal.setEnvRadius,
       which is a NO-OP stub on the analytic mirrorBall — every frame
       was accumulating mean distances for nothing.) */
    /* §32a — the ball's analytic-mirror feed (forge §31): each frame the
       collision pass collects the nearest cages; brightness fades to ZERO
       before the cap can cut anything off (§31e — invisible horizon).
       §36 — the horizon is CAMERA-AWARE: the viewer is pinned at the
       origin, and the visible mirror face reflects the hemisphere TOWARD
       the viewer — i.e. the atoms behind/around the camera, not the ones
       behind the ball. Selection + fade run on an EFFECTIVE distance
       (true distance, penalised up to ×1.84 for atoms on the ball's far
       side), so the 64 slots and the 16u reach go to what her face
       actually shows. Fix for: "orb close to me, loads of atoms behind
       me, but none reflect" — they were outside the old 9.5u radius. */
    const BALL_FEED_CAP = 256;      // §39 — space: 64 → 256 cages in the mirror
    const MIRROR_HORIZON = 1e3;     // §39 — no distance ceiling (was 16): the §32e
                                    //   dynamic horizon (the first EXCLUDED candidate's
                                    //   distance) is the only boundary, and the fade
                                    //   reaches zero exactly there
    /* §41 — the VIEWER's hemisphere wins the slots (user: "my own
       viewpoint blocks atoms behind me from reflecting"). Her visible
       face-centre reflects the region BEHIND the camera — but those
       atoms sit 15–25u from the ball (the §37 bubble guarantees nothing
       is near the origin), so nearest-first selection spent every slot
       on her own local neighbourhood and the behind-you region starved.
       §36 only PENALISED the far side; now the weighting is a full
       linear ramp over facing: camera-side atoms compete at ×0.45 their
       true distance (a 21u atom behind your head competes as 9.5u),
       far-side at ×1.84 as before. The fade also runs in this space, so
       camera-side reflections stay bright deeper into the field. */
    const MIRROR_W_FRONT = 0.45;    // §41 — dEff multiplier at facing = +1 (toward viewer)
    const MIRROR_W_BACK  = 1.84;    // §36 — dEff multiplier at facing = −1 (behind the ball)
    const _mfA = (MIRROR_W_FRONT + MIRROR_W_BACK) / 2;   // linear ramp: dEff = d·(_mfA − _mfB·facing)
    const _mfB = (MIRROR_W_BACK - MIRROR_W_FRONT) / 2;
    const _ballFeed = {
      n: 0,
      pos: new Float32Array(BALL_FEED_CAP * 3),
      col: new Float32Array(BALL_FEED_CAP * 3),
      quat: new Float32Array(BALL_FEED_CAP * 4),
      rad: atomScale,
    };
    const _feedD = new Float32Array(4096);  // §34/§39 — preallocated candidate buffers
    const _feedI = new Int32Array(4096);    //   (§39: the WHOLE field is a candidate now)
    let _feedN = 0;
    /* §35a — sRGB OETF (the renderer's output transform), applied to the
       mirror feed so reflected hues match displayed cage hues exactly. */
    function _srgbEnc(v) {
      if (v <= 0) return 0;
      if (v >= 1) return 1;
      return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    }
    const _fqSpin = new THREE.Quaternion(), _fqBase = new THREE.Quaternion();
    if (window.omegaR3D && (window.omegaR3D.createMirrorBall || window.omegaR3D.createLiquidMetal)) {
      /* §32 — her body is the brand-new mirrorBall.js (one perfect chrome
         sphere, seamless by construction). The variable keeps its old
         name so the 50+ downstream references (gather/summon/camera/
         collision) stay untouched; the API is identical. liquidMetal.js
         remains on disk as the dormant tube-body reference. */
      const _makeBody = window.omegaR3D.createMirrorBall || window.omegaR3D.createLiquidMetal;
      liquidMetal = _makeBody(scene, renderer, {
        radius: 2.2,
        camera: camera,                  // for the analytic surface's gl_FragDepth
        getAtoms: () => _ballFeed,       // the world her mirror traces (§31)
      });
    }
    /* Opt the comet into the BLOOM layer so its bright reflected
       highlights (the chrome catching a cluster of glowing atoms)
       bloom too. Being a roughness-0 metal it has no diffuse
       response, so only genuine specular hotspots clear the bloom
       threshold — the body itself doesn't wash out. */
    /* The comet body itself does NOT bloom (it was self-glowing into
       a white blob); only the neon name ticker blooms so it reads as
       a glowing sign. The chrome still shows bright reflected
       highlights — they just don't bleed a halo. */
    /* The GLM name-band is drawn in its OWN pass in loop() so it can be
       occluded by atoms (which never write depth). It lives on its own
       LABEL_LAYER (+ the bloom layer), OFF the main layer 0, so the
       normal scene.render skips it. `atomDepthMat` lays atom depth into
       the main buffer just before the label draws. */
    const LABEL_LAYER = 4;
    const atomDepthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    if (liquidMetal && liquidMetal.labelMesh) {
      liquidMetal.labelMesh.layers.set(LABEL_LAYER);
      liquidMetal.labelMesh.layers.enable(BLOOM_LAYER);
    }

    /* ── Bloom overlay ─────────────────────────────────────────
       Now that the emitters (atom cores) and the comet exist, build
       the additive selective-bloom pass. It renders AFTER the main
       frame in loop() and only ever brightens the canvas, so the
       chamber's ACES pipeline and per-atom hues are untouched. */
    if (window.omegaR3D && window.omegaR3D.createBloom) {
      bloom = window.omegaR3D.createBloom(renderer, scene, camera, {
        strength: 0.9,
        threshold: 0.50,
        knee: 0.40,
        iterations: 6,
        scale: 0.5,
        layer: BLOOM_LAYER,
        occluderLayer: 2,
        maskDepthLayer: 3,
      });
      const _db = renderer.getDrawingBufferSize(_dbSize);
      bloom.setSize(_db.x, _db.y);
      /* Make the comet a bloom OCCLUDER: enable the occluder layer on
         its body so the bloom pass lays its depth down and culls the
         glow of atoms behind it. (Body stays on layer 0 for the main
         render; this only adds layer 2 for the depth pre-pass.) */
      if (liquidMetal && liquidMetal.mesh) liquidMetal.mesh.layers.enable(2);
    }

    /* ── Living camera rig ───────────────────────────
       Pinned at the origin — the viewer never leaves the centre of the
       atomspace; the camera only ROTATES to follow Omega's locus (the
       comet) as she roams. Left-drag = vantage (look around yourself).
       See cameraRig.js. */
    let cameraRig = null;
    if (window.omegaR3D && window.omegaR3D.createCameraRig) {
      cameraRig = window.omegaR3D.createCameraRig(camera, {
        /* Follow Omega's locus (the comet) — UNLESS a space has gathered
           into a continent, in which case the camera settles on the
           continent centroid so we read the knowledge graph she pulled
           together. Disperse → focusTarget clears → eases back to her. */
        getTarget: () => {
          if (focusTarget) return focusTarget;
          return (liquidMetal && liquidMetal.headPosition) ? liquidMetal.headPosition : null;
        },
      });
    }

    /* ── Gather: the Memory organ as a living place (§12.1/§15) ─────
       computeContinent runs a small force layout over ONE space's
       members + their intra-space edges, seats it as a facing slab in
       front of the camera (toward Omega's current locus), and stores
       per-atom continent targets. updateGather eases the field there
       and back each frame. setGatherFrame is the seam the omegaState
       frame drives. */
    function _h2(a, b) {
      let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      return (h ^ (h >>> 16)) >>> 0;
    }
    /* Start an arced transition for atom i to (ex,ey,ez). owner = the
       space it's gathering into, or null = resting. A perpendicular BOW
       (scaled by travel distance) curves the path so it reads natural,
       not like a straight elastic band; the duration is staggered. Any
       weightless drift is released so the atom is spring-governed to its
       new home. */
    function startTransition(i, ex, ey, ez, owner, baseDur) {
      const ix = i * 3;
      /* Start from where the atom VISUALLY is (home + any drift), folding
         that drift into the path and zeroing it — so a previously
         drifted/struck atom doesn't snap when its spring re-engages
         (no teleport). The home is moved to the visual spot too, so this
         frame and the first updateGather frame agree. */
      const dvx = chamberAtomDisplaceState ? chamberAtomDisplaceState[ix] : 0;
      const dvy = chamberAtomDisplaceState ? chamberAtomDisplaceState[ix + 1] : 0;
      const dvz = chamberAtomDisplaceState ? chamberAtomDisplaceState[ix + 2] : 0;
      const fx0 = chamberAtomWorldPositions[ix] + dvx;
      const fy0 = chamberAtomWorldPositions[ix + 1] + dvy;
      const fz0 = chamberAtomWorldPositions[ix + 2] + dvz;
      gFrom[ix] = fx0; gFrom[ix + 1] = fy0; gFrom[ix + 2] = fz0;
      chamberAtomWorldPositions[ix] = fx0; chamberAtomWorldPositions[ix + 1] = fy0; chamberAtomWorldPositions[ix + 2] = fz0;
      if (chamberAtomDisplaceState) { chamberAtomDisplaceState[ix] = 0; chamberAtomDisplaceState[ix + 1] = 0; chamberAtomDisplaceState[ix + 2] = 0; }
      if (chamberVelocity) { chamberVelocity[ix] = 0; chamberVelocity[ix + 1] = 0; chamberVelocity[ix + 2] = 0; }
      gTo[ix] = ex; gTo[ix + 1] = ey; gTo[ix + 2] = ez;
      gEase[i] = 0;
      gOwner[i] = owner;
      gDur[i] = baseDur * (0.72 + gatherDelay[i] * 0.95);
      if (chamberAtomFloating) chamberAtomFloating[i] = 0;
      let dx = ex - gFrom[ix], dy = ey - gFrom[ix + 1], dz = ez - gFrom[ix + 2];
      const dist = Math.hypot(dx, dy, dz) || 1;
      dx /= dist; dy /= dist; dz /= dist;
      const r = _h2(i, gatherCycle);
      let rx = ((r & 0xff) / 127.5) - 1, ry = (((r >>> 8) & 0xff) / 127.5) - 1, rz = (((r >>> 16) & 0xff) / 127.5) - 1;
      const rd = rx * dx + ry * dy + rz * dz;          // remove the along-path component → perpendicular
      rx -= rd * dx; ry -= rd * dy; rz -= rd * dz;
      const rl = Math.hypot(rx, ry, rz) || 1;
      const amp = Math.min(3.0, dist * 0.16) * (0.45 + ((r >>> 24) & 0xff) / 255);
      gBow[ix] = (rx / rl) * amp; gBow[ix + 1] = (ry / rl) * amp; gBow[ix + 2] = (rz / rl) * amp;
    }
    /* (jitterRest removed — was unused/vestigial.) */
    /* gatherSet — the generalized continent former. Takes an EXPLICIT
       list of atom indices (members), an owner tag, optional local edges
       (flat [a0,b0,a1,b1,…] in member-local indices) and an optional
       center-local index to pin at the continent's middle. Runs the
       force layout, seats the slab in front of the viewer, and starts
       the per-atom arced transitions. No lower/upper bound on N — a
       2-atom reasoning hop and a 561-atom space both go through here. */
    function gatherSet(members, ownerTag, localEdges, centerLocal, distOverride, noOrbit) {
      if (!atomNodes || !gatherTargets) return false;
      /* Any new continent/reasoning gather releases orbiting satellites
         (unless this IS a summon, which manages its own). */
      if (ownerTag && ownerTag.indexOf("summon:") !== 0) releaseSatellites();
      const N = members.length;
      if (N < 1) return false;
      const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
      for (let k = 0; k < N; k++) {
        const id = atomNodes[members[k]].id;
        let h = 2166136261 >>> 0;
        for (let c = 0; c < id.length; c++) { h ^= id.charCodeAt(c); h = Math.imul(h, 16777619); }
        const u = (h & 0xffff) / 0xffff, v = ((h >>> 16) & 0xffff) / 0xffff, w = ((h >>> 8) & 0xff) / 0xff;
        const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1), rr = 1.4 * Math.cbrt(w + 0.05);
        px[k] = rr * Math.sin(ph) * Math.cos(th);
        py[k] = rr * Math.sin(ph) * Math.sin(th);
        pz[k] = rr * Math.cos(ph);
      }
      const le = localEdges || [];
      /* force relaxation — spring along edges, soft all-pairs repulsion,
         gentle center pull. Iters scale down with N to stay one-frame.
         Tiny sets (a reasoning hop) still relax — edges pull premises in
         around the conclusion. */
      const ITER = N <= 8 ? 90 : (N <= 200 ? 70 : (N <= 400 ? 48 : 32));
      const fx = new Float32Array(N), fy = new Float32Array(N), fz = new Float32Array(N);
      const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
      const REST = 0.95, KS = 0.09, KREP = 0.55, KCEN = 0.022, DAMP = 0.82, DT = 0.5, REP_R2 = 9;
      for (let it = 0; it < ITER; it++) {
        fx.fill(0); fy.fill(0); fz.fill(0);
        for (let m = 0; m < le.length; m += 2) {
          const a = le[m], b = le[m + 1];
          let dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
          const d = Math.hypot(dx, dy, dz) || 1e-4;
          const f = KS * (d - REST) / d;
          dx *= f; dy *= f; dz *= f;
          fx[a] += dx; fy[a] += dy; fz[a] += dz;
          fx[b] -= dx; fy[b] -= dy; fz[b] -= dz;
        }
        for (let a = 0; a < N; a++) {
          for (let b = a + 1; b < N; b++) {
            const dx = px[a] - px[b], dy = py[a] - py[b], dz = pz[a] - pz[b];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > REP_R2 || d2 < 1e-5) continue;
            const f = KREP / (d2 + 0.12);
            fx[a] += dx * f; fy[a] += dy * f; fz[a] += dz * f;
            fx[b] -= dx * f; fy[b] -= dy * f; fz[b] -= dz * f;
          }
          fx[a] -= KCEN * px[a]; fy[a] -= KCEN * py[a]; fz[a] -= KCEN * pz[a];
        }
        for (let a = 0; a < N; a++) {
          vx[a] = (vx[a] + fx[a] * DT) * DAMP; px[a] += vx[a] * DT;
          vy[a] = (vy[a] + fy[a] * DT) * DAMP; py[a] += vy[a] * DT;
          vz[a] = (vz[a] + fz[a] * DT) * DAMP; pz[a] += vz[a] * DT;
        }
      }
      /* center on the centroid (or on the pinned center node, e.g. the
         reasoning conclusion, so it sits at the continent's heart). */
      let cx = 0, cy = 0, cz = 0;
      if (centerLocal != null) {
        cx = px[centerLocal]; cy = py[centerLocal]; cz = pz[centerLocal];
      } else {
        for (let k = 0; k < N; k++) { cx += px[k]; cy += py[k]; cz += pz[k]; }
        cx /= N; cy /= N; cz /= N;
      }
      let maxr = 1e-3;
      for (let k = 0; k < N; k++) {
        const d = Math.hypot(px[k] - cx, py[k] - cy, pz[k] - cz);
        if (d > maxr) maxr = d;
      }
      const R = Math.min(9, Math.max(2.4, 1.6 + Math.sqrt(N) * 0.4));
      const factor = R / maxr;
      /* seat the continent IN FRONT OF THE VIEWER — along the camera's
         current look direction — so it always forms up in view, as a slab
         that faces the viewer (thin axis = the look direction). */
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1); else dir.normalize();
      const DIST = distOverride != null ? distOverride : 14;
      _gCentroid.copy(dir).multiplyScalar(DIST);
      const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const u = new THREE.Vector3().crossVectors(up, dir).normalize();
      const vv = new THREE.Vector3().crossVectors(dir, u).normalize();
      const FLAT = 0.42;   // compress along the look axis → a facing "continent on a map"
      for (let k = 0; k < N; k++) {
        const lx = (px[k] - cx) * factor, ly = (py[k] - cy) * factor, lz = (pz[k] - cz) * factor;
        const gi = members[k] * 3;
        gatherTargets[gi]     = _gCentroid.x + u.x * lx + vv.x * ly + dir.x * lz * FLAT;
        gatherTargets[gi + 1] = _gCentroid.y + u.y * lx + vv.y * ly + dir.y * lz * FLAT;
        gatherTargets[gi + 2] = _gCentroid.z + u.z * lx + vv.z * ly + dir.z * lz * FLAT;
      }
      gatherCycle++;
      const memberSet = new Set(members);
      for (let i = 0; i < atomNodes.length; i++) {
        if (memberSet.has(i)) {
          const gi = i * 3;
          startTransition(i, gatherTargets[gi], gatherTargets[gi + 1], gatherTargets[gi + 2], ownerTag, 1.5);
        } else if (gOwner[i]) {
          gOwner[i] = null;   // a previously-gathered continent is LEFT IN PLACE, never pulled back
        }
      }
      gatherSpace = ownerTag;
      focusTarget = _gCentroid;
      /* Her locus flies over and ORBITS the continent while she studies it
         — unless noOrbit (a single atom summoned right up close, where an
         orbit would swing the comet behind the viewer). */
      if (!noOrbit && liquidMetal && liquidMetal.setFocus) liquidMetal.setFocus(_gCentroid, R);
      else if (noOrbit && liquidMetal && liquidMetal.clearFocus) liquidMetal.clearFocus(false);
      return true;
    }

    function computeContinent(spaceName) {
      if (!atomNodes || !gatherTargets || !window.omegaGraph) return false;
      const members = [];
      for (let i = 0; i < atomNodes.length; i++) {
        if (atomNodes[i].space === spaceName) members.push(i);
      }
      if (members.length < 2) return false;
      /* local id → local index, for edge lookup. */
      const idIdx = new Map();
      for (let k = 0; k < members.length; k++) idIdx.set(atomNodes[members[k]].id, k);
      const le = [];
      for (const e of window.omegaGraph.edges) {
        const a = idIdx.get(e.source), b = idIdx.get(e.target);
        if (a != null && b != null && a !== b) le.push(a, b);
      }
      return gatherSet(members, spaceName, le, null);
    }

    /* playReasoning — a reasoning HOP made visible in the space (§11).
       Premise atoms (already in the sea) + a conclusion atom gather into
       a small knowledge-graph continent with the conclusion pinned at its
       heart and links premise→conclusion; the comet flies over to study
       it. `idxs` = member atom indices, last is the conclusion. Returns
       the centroid + chosen labels so the receipt can dock to it. Any
       count (a 2-premise hop or a wide fan-in) — no bound. */
    function playReasoning(premiseIdxs, conclusionIdx) {
      if (!atomNodes) return null;
      const members = premiseIdxs.concat([conclusionIdx]);
      const concLocal = members.length - 1;
      /* star edges: every premise → the conclusion (the hop's links). */
      const le = [];
      for (let k = 0; k < premiseIdxs.length; k++) le.push(k, concLocal);
      const ok = gatherSet(members, "reason:" + atomNodes[conclusionIdx].id, le, concLocal);
      if (!ok) return null;
      return {
        centroid: { x: _gCentroid.x, y: _gCentroid.y, z: _gCentroid.z },
        premises: premiseIdxs.map((i) => atomNodes[i].label),
        conclusion: atomNodes[conclusionIdx].label,
      };
    }

    function setGatherFrame(fr) {
      const want = (fr && fr.layoutMode === "gather" && fr.focus) ? fr.focus : null;
      if (want) {
        if (want !== gatherSpace) computeContinent(want);  // keep old if too sparse to gather
      } else if (gatherSpace) {
        gatherSpace = null;
        releaseSatellites();   // any orbiting summon also lets go on disperse
        /* The continent is NOT pulled back — it simply EXISTS where it
           formed. We only release the hold (stop recalling its atoms);
           each stays spring-pinned at its slot until Omega LEAVES by
           ploughing straight through it, and the atoms she actually
           hits react like any other — knocked weightless, spinning off
           into the void (the normal collision / zero-g drift). The ones
           she misses just remain as a formed continent in that place. */
        for (let i = 0; i < gOwner.length; i++) gOwner[i] = null;
        if (liquidMetal && liquidMetal.clearFocus) liquidMetal.clearFocus(true);
        smashHoldUntil = performance.now() + 1500;
      }
    }

    function updateGather(now) {
      if (!gEase || !gFrom || !gTo || !chamberAtomWorldPositions || !atomNodes) return;
      let dt = (now - lastGatherMs) / 1000;
      lastGatherMs = now;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 0.05) dt = 0.05;
      const glowA = 1 - Math.exp(-dt / 0.5);
      /* Global "a continent is being studied" level — eases up while a
         space is gathered, drives the dimming of NON-member atoms so the
         focused continent stands out (the rest recede in brightness, but
         stay in place). */
      gatherActiveEase += ((gatherSpace ? 1 : 0) - gatherActiveEase) * glowA;
      const count = gEase.length;
      for (let i = 0; i < count; i++) {
        const owner = gOwner[i];
        gGlow[i] += ((owner ? 1 : 0) - gGlow[i]) * glowA;     // continent brightness eases in/out
        /* Satellites + the summoned atom brighten like any owned atom, but
           their POSITION is driven elsewhere (orbit / viewport-centre) —
           skip the gather-transition move for them. */
        if (satelliteSet.has(i) || i === summonAtomIdx) continue;
        if (gEase[i] >= 1 && owner == null) continue;          // settled at rest → nothing to move
        if (gEase[i] < 1) gEase[i] = Math.min(1, gEase[i] + dt / gDur[i]);
        const e = gEase[i];
        const s = e * e * (3 - 2 * e);                         // smoothstep along the path
        const bow = Math.sin(Math.PI * e);                     // arc peaks mid-transition
        const ix = i * 3;
        chamberAtomWorldPositions[ix]     = gFrom[ix]     + (gTo[ix]     - gFrom[ix])     * s + gBow[ix]     * bow;
        chamberAtomWorldPositions[ix + 1] = gFrom[ix + 1] + (gTo[ix + 1] - gFrom[ix + 1]) * s + gBow[ix + 1] * bow;
        chamberAtomWorldPositions[ix + 2] = gFrom[ix + 2] + (gTo[ix + 2] - gFrom[ix + 2]) * s + gBow[ix + 2] * bow;
        /* Gathered atoms follow their continent slot RIGIDLY. The collision
           spring is underdamped, so letting it drag them to the slot made
           the whole continent lag the arc then overshoot on arrival — the
           "rubber banding". Zeroing disp/vel makes each atom EQUAL its
           (arcing) home, so it tracks cleanly and the formed continent is
           still. Released on disperse (owner→null), where the comet's
           smash scatters them via the normal collision. */
        if (owner != null) {
          if (chamberAtomDisplaceState) { chamberAtomDisplaceState[ix] = 0; chamberAtomDisplaceState[ix + 1] = 0; chamberAtomDisplaceState[ix + 2] = 0; }
          if (chamberVelocity) { chamberVelocity[ix] = 0; chamberVelocity[ix + 1] = 0; chamberVelocity[ix + 2] = 0; }
          if (chamberAtomFloating) chamberAtomFloating[i] = 0;
        }
        /* Once a disperse completes, lock the new spot as the resting home. */
        if (e >= 1 && owner == null) {
          restShellPositions[ix] = gTo[ix]; restShellPositions[ix + 1] = gTo[ix + 1]; restShellPositions[ix + 2] = gTo[ix + 2];
        }
        /* keep the pick-map honest while displaced so the Inspector lands right. */
        const p = atomPositions.get(atomNodes[i].id);
        if (p) { p.x = chamberAtomWorldPositions[ix]; p.y = chamberAtomWorldPositions[ix + 1]; p.z = chamberAtomWorldPositions[ix + 2]; }
      }
      /* After the smash beat, release the camera so it follows her out. */
      if (!gatherSpace && focusTarget && now > smashHoldUntil) focusTarget = null;
    }

    /* Pin the summoned atom to a fixed dock in FRONT of the comet (closer
       to the viewer than the comet roams), holding it at viewport centre
       while the comet orbits it (out of the atom's path) and its detail
       card grows out of it. */
    function updateSummonAtom(now) {
      if (summonAtomIdx < 0 || !chamberAtomWorldPositions || !atomNodes) return;
      let dt = (now - lastGatherMs) / 1000;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 0.05) dt = 0.05;
      const a = 1 - Math.exp(-dt / 0.4);
      const i = summonAtomIdx, ix = i * 3;
      chamberAtomWorldPositions[ix]     += (_summonDock.x - chamberAtomWorldPositions[ix])     * a;
      chamberAtomWorldPositions[ix + 1] += (_summonDock.y - chamberAtomWorldPositions[ix + 1]) * a;
      chamberAtomWorldPositions[ix + 2] += (_summonDock.z - chamberAtomWorldPositions[ix + 2]) * a;
      if (chamberAtomDisplaceState) { chamberAtomDisplaceState[ix] = 0; chamberAtomDisplaceState[ix + 1] = 0; chamberAtomDisplaceState[ix + 2] = 0; }
      if (chamberVelocity) { chamberVelocity[ix] = 0; chamberVelocity[ix + 1] = 0; chamberVelocity[ix + 2] = 0; }
      if (chamberAtomFloating) chamberAtomFloating[i] = 0;
      /* Keep the comet placed: DRILL summon orbits the docked atom; QUIET
         summon (a surface/chat) parks it FAR + aside so it isn't behind /
         orbiting the surface (which reads as "the surface is behind omega"). */
      if (liquidMetal && liquidMetal.setFocus) {
        if (summonQuiet) liquidMetal.setFocus(_summonPark, 4.0);
        else liquidMetal.setFocus(_summonDock, 0.5);
      }
      const p = atomPositions.get(atomNodes[i].id);
      if (p) { p.x = chamberAtomWorldPositions[ix]; p.y = chamberAtomWorldPositions[ix + 1]; p.z = chamberAtomWorldPositions[ix + 2]; }
    }

    /* Build two perpendicular in-plane unit axes for an orbit whose
       normal is (nx,ny,nz). Writes a0..2 / b0..2 into `out`. */
    function orbitBasis(nx, ny, nz, out) {
      let l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      let ux = 0, uy = 1, uz = 0;
      if (Math.abs(ny) > 0.92) { ux = 1; uy = 0; uz = 0; }   // avoid parallel
      // a = normalize(u × n)
      let ax = uy * nz - uz * ny, ay = uz * nx - ux * nz, az = ux * ny - uy * nx;
      l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
      // b = n × a
      const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;
      out.a0 = ax; out.a1 = ay; out.a2 = az; out.b0 = bx; out.b1 = by; out.b2 = bz;
    }

    /* Release all satellites — each KEEPS its current position and is set
       weightless with the momentum it had (orbital tangential velocity +
       the comet's own velocity), so it simply coasts off on its own path
       and drifts like any struck atom — never snaps home or vanishes. */
    function releaseSatellites() {
      if (!satellites.length) return;
      const cv = liquidMetal && liquidMetal.velocity ? liquidMetal.velocity : { x: 0, y: 0, z: 0 };
      for (const s of satellites) {
        const i = s.i, ix = i * 3;
        /* current position becomes the home; zero the displacement so the
           atom sits exactly where it is, then coast from here. */
        const cx = chamberAtomWorldPositions[ix], cy = chamberAtomWorldPositions[ix + 1], cz = chamberAtomWorldPositions[ix + 2];
        if (chamberAtomDisplaceState) { chamberAtomDisplaceState[ix] = 0; chamberAtomDisplaceState[ix + 1] = 0; chamberAtomDisplaceState[ix + 2] = 0; }
        chamberAtomWorldPositions[ix] = cx; chamberAtomWorldPositions[ix + 1] = cy; chamberAtomWorldPositions[ix + 2] = cz;
        /* orbital tangential velocity at the current phase = d/dt of the
           orbit point = (−a·sin + b·cos)·r·angularSpeed, plus the comet's
           velocity (the orbit centre was moving with her). */
        const c = Math.cos(s.phase), sn = Math.sin(s.phase), w = s.r * s.speed;
        if (chamberVelocity) {
          chamberVelocity[ix]     = (-s.a0 * sn + s.b0 * c) * w + cv.x;
          chamberVelocity[ix + 1] = (-s.a1 * sn + s.b1 * c) * w + cv.y;
          chamberVelocity[ix + 2] = (-s.a2 * sn + s.b2 * c) * w + cv.z;
        }
        if (chamberAtomFloating) chamberAtomFloating[i] = 1;   // weightless → zero-g drift coasts it
        if (chamberAtomFloatAge) chamberAtomFloatAge[i] = 0;
        gOwner[i] = null;
      }
      satellites = [];
      satelliteSet.clear();
      /* the pinned summoned atom also lets go — floats off and drifts,
         and the camera/comet resume their normal behaviour. */
      if (summonAtomIdx >= 0) {
        if (chamberAtomFloating) chamberAtomFloating[summonAtomIdx] = 1;
        if (chamberAtomFloatAge) chamberAtomFloatAge[summonAtomIdx] = 0;
        gOwner[summonAtomIdx] = null;
        summonScaleDirtyIdx = summonAtomIdx;   // restore its heart/glow scale
        summonReveal = 1;
        summonAtomIdx = -1;
        summonQuiet = false;
        focusTarget = null;
        if (liquidMetal && liquidMetal.clearFocus) liquidMetal.clearFocus(false);
      }
    }

    /* Each frame, ease every satellite's HOME toward its point on a tilted
       orbit around Omega's locus (the comet head), so they swirl around
       her like moons / a galaxy disc and follow as she roams. Smoothing
       makes them fly IN on summon, then track. */
    function updateSatellites(now) {
      if (!satellites.length || !liquidMetal) return;
      const head = liquidMetal.headPosition;
      if (!head) return;
      let dt = (now - lastGatherMs) / 1000;   // shares the gather clock (already advanced)
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 0.05) dt = 0.05;
      const a = 1 - Math.exp(-dt / 0.45);     // fly-in / track smoothing
      for (const s of satellites) {
        s.phase += s.speed * dt;
        const c = Math.cos(s.phase), sn = Math.sin(s.phase);
        const tx = head.x + (s.a0 * c + s.b0 * sn) * s.r;
        const ty = head.y + (s.a1 * c + s.b1 * sn) * s.r;
        const tz = head.z + (s.a2 * c + s.b2 * sn) * s.r;
        const i = s.i, ix = i * 3;
        chamberAtomWorldPositions[ix]     += (tx - chamberAtomWorldPositions[ix])     * a;
        chamberAtomWorldPositions[ix + 1] += (ty - chamberAtomWorldPositions[ix + 1]) * a;
        chamberAtomWorldPositions[ix + 2] += (tz - chamberAtomWorldPositions[ix + 2]) * a;
        if (chamberAtomDisplaceState) { chamberAtomDisplaceState[ix] = 0; chamberAtomDisplaceState[ix + 1] = 0; chamberAtomDisplaceState[ix + 2] = 0; }
        if (chamberVelocity) { chamberVelocity[ix] = 0; chamberVelocity[ix + 1] = 0; chamberVelocity[ix + 2] = 0; }
        if (chamberAtomFloating) chamberAtomFloating[i] = 0;
        const p = atomPositions.get(atomNodes[i].id);
        if (p) { p.x = chamberAtomWorldPositions[ix]; p.y = chamberAtomWorldPositions[ix + 1]; p.z = chamberAtomWorldPositions[ix + 2]; }
      }
    }

    /* Summon a SPACE as an orbiting galaxy of satellites around Omega.
       Members become satellites on a shared, slightly-tilted disc (a few
       degrees of scatter per atom for thickness), radii spread out, inner
       ones sweeping faster (Keplerian feel). Returns the space name. */
    function summonSpaceAsGalaxy(spaceName) {
      const members = [];
      for (let i = 0; i < atomNodes.length; i++) if (atomNodes[i].space === spaceName) members.push(i);
      if (!members.length) return null;
      releaseSatellites();
      /* Tighter swarm: smaller radii + slower radial growth so the galaxy
         hugs her rather than scattering thinly. */
      const RMIN = 2.7, RMAX = Math.min(7.5, 3.4 + Math.sqrt(members.length) * 0.42);
      for (let k = 0; k < members.length; k++) {
        const mi = members[k];
        const id = atomNodes[mi].id;
        let h = 2166136261 >>> 0;
        for (let c = 0; c < id.length; c++) { h ^= id.charCodeAt(c); h = Math.imul(h, 16777619); }
        /* four independent hash streams → each atom gets its OWN orbit:
           radius, inclination, angular speed, phase & direction. */
        const u = (h & 0x3ff) / 0x3ff;
        const v = ((h >>> 10) & 0x3ff) / 0x3ff;
        const w = ((h >>> 20) & 0x3ff) / 0x3ff;
        const q = ((h >>> 7) & 0x3ff) / 0x3ff;
        const r = RMIN + (RMAX - RMIN) * Math.pow(u, 1.35);    // bias inward → denser core, tighter swarm
        /* Each atom on its OWN tilted plane — a preferred disc (normal
           ≈ +Y) but with wide INCLINATION scatter so orbits cross and
           weave instead of lying in one rigid sheet. */
        const tilt = {};
        orbitBasis((v - 0.5) * 1.4, 1, (q - 0.5) * 1.4, tilt);
        /* Strongly DIFFERENTIAL angular speed (Keplerian-ish ∝ r^-1.5):
           inner moons clearly lap outer ones, so the field never reads as
           a rigid body. Per-atom jitter + random direction. */
        const speed = (5.4 / Math.pow(r, 1.5)) * (0.78 + w * 0.5) * (q < 0.5 ? 1 : -1);
        satellites.push({
          i: mi, r, phase: u * Math.PI * 2, speed,
          a0: tilt.a0, a1: tilt.a1, a2: tilt.a2, b0: tilt.b0, b1: tilt.b1, b2: tilt.b2,
        });
        satelliteSet.add(mi);
        gOwner[mi] = "summon:" + spaceName;   // brighten (and dim non-members)
        gEase[mi] = 1;                        // settled — updateGather won't transition it
      }
      gatherSpace = "summon:" + spaceName;
      focusTarget = null;                     // camera follows the comet (so we watch the galaxy swirl her)
      if (liquidMetal && liquidMetal.clearFocus) liquidMetal.clearFocus(false);  // comet roams; it's the centre
      return spaceName;
    }

    /* ── Chamber-atom push (same physics as mini) ──────────────
       Each chamber atom sits at its layout position. The chamber-
       scale snake swims through the universe; atoms within its
       push radius get displaced outward, like the mini-mirror but
       at universe scale.

       Push radius is scaled up to match the chamber snake's body
       size. Mini snake body ≈ 0.20 radius × 1.105 = 0.22 sprite ≈
       0.055 push. Chamber snake droplets are ~80× bigger, but the
       atoms are also packed across a 40-unit chamber, so the push
       radius is tuned by feel rather than direct scaling. */
    /* ── Physics: snake-atom collisions, spring-back, damping ──
       Replaces the previous lerp-based "smooth toward target"
       displacement with a real spring-mass-damper system per atom.
       Each frame: integrate forces (snake repulsion + spring toward
       rest + velocity damping) into velocity, integrate velocity
       into displacement. Atoms get pushed, overshoot, wobble back,
       settle. Reads as physical rather than animated.

       SPRING_K — pull-back strength. Higher = snappier return.
       DAMPING  — velocity drag. Higher = less overshoot/wobble.
       REPULSE_STRENGTH — force magnitude at contact with snake.
       PUSH_RADIUS — beyond this distance the snake doesn't push. */
    /* (physicsTick removed — only the dead updateChamberPush /
       updateMiniPush called it; the live collision is updateCometInteraction.) */


    /* Velocity buffers — created lazily once we know the atom
       counts. */
    let chamberVelocity = null;

    /* (§38 — updateAtomGlowFromSnake + its module-level GLOW_* constants
       removed: dead since the one-pass updateCometInteraction took over
       proximity glow (§27). Nothing called it; it duplicated the glow
       with an O(atoms × bodySamples) loop.) */

    /* (updateChamberPush removed — never called; the comet doesn't push
       atoms via physicsTick. The live comet↔atom physics is
       updateCometInteraction.) */

    /* Outer comet: VISIBLE, renderer-only. Roves on its own through
       the atom field; doesn't yet affect the atoms (that comes in
       a later step). The liquidMetal module already implements the
       chrome shooting-star — tapered body, env-map reflections,
       smooth wandering path. */
    if (liquidMetal && liquidMetal.mesh) liquidMetal.mesh.visible = true;

    /* (updateMiniLighting + its LIQUID_THRESHOLD/PUSH_RADIUS constants
       removed — mini-mirror is gone and nothing called it.) */


    /* (updateMiniPush removed — mini-mirror is gone and nothing called it.) */

    let graphUnsub = null;
    /* §38 — COALESCED + RATE-LIMITED rebuilds. graph.tick() fires its
       subscribers on EVERY dirty frame while any node tween runs (born /
       retire / move), and rebuildAtoms is the most expensive call in the
       module (full force layout + instanced geometry). Bursts of deltas
       now cost one rebuild, and tween storms at most ~5/s, with a
       trailing rebuild so the settled state always lands. */
    let rebuildQueued = false;
    let lastRebuildMs = 0;
    const REBUILD_MIN_MS = 200;
    function scheduleRebuild() {
      if (rebuildQueued || stopped) return;
      rebuildQueued = true;
      const wait = Math.max(0, REBUILD_MIN_MS - (performance.now() - lastRebuildMs));
      setTimeout(() => {
        rebuildQueued = false;
        if (stopped) return;
        lastRebuildMs = performance.now();
        rebuildAtoms();
      }, wait);
    }
    if (window.omegaGraph && window.omegaGraph.subscribe) {
      graphUnsub = window.omegaGraph.subscribe(scheduleRebuild);
    }

    /* React to the layout frame — Omega looking into a space gathers it
       into a continent; resting disperses it. The membrane only relays
       the `focus` intent into omegaState's frame; the gather lives here. */
    let frameUnsub = null;
    if (window.omegaState && window.omegaState.subscribeFrame) {
      frameUnsub = window.omegaState.subscribeFrame((fr) => setGatherFrame(fr));
    }

    /* ── Comet ↔ atom interaction (true 3D collision) ───────────
       ONE pass over the atoms each frame that does everything tied
       to the comet's position:

         • PROXIMITY GLOW — brightness ramps up smoothly as the
           comet SURFACE nears the atom (distance to the comet's
           actual body radius at the nearest point, not the
           centreline), so the glow is consistent and physical.
         • TRUE COLLISION — an atom is only pushed when the comet
           SURFACE actually reaches it (penetration of the atom's
           radius into the comet's local radius). It's shoved out
           along the contact normal to the surface, not nudged by a
           distant force field.
         • 3D RIGID RESPONSE — the impact also imparts ANGULAR
           velocity (the atom tumbles/rolls about the axis ⟂ to the
           contact normal and the comet's motion, like a ball rolled
           by a passing swimmer), integrated into a spin quaternion.
         • SPRING-BACK — a spring + damping rolls each shoved atom
           back to its spot; the spin decays so it settles.

       Shells get a full transform recompose (position + base⋅spin
       orientation + scale). Cores and both halo layers are spheres,
       so they only need the translation copied in lockstep. */
    const _ciQd = new THREE.Quaternion();
    const _ciSpin = new THREE.Quaternion();
    const _ciBase = new THREE.Quaternion();
    const _ciM4 = new THREE.Matrix4();
    const _ciPos = new THREE.Vector3();
    const _ciScl = new THREE.Vector3();
    let lastInteractMs = 0;
    /* §34 — allocation-free spatial hash for the chain reaction: fixed
       bucket table + linked lists in typed arrays, rebuilt in place.
       (The old per-frame Map of JS arrays allocated thousands of
       objects a frame once many atoms were adrift — exactly the
       high-energy case — and the GC churn read as "heavy".) */
    const GRID_BUCKETS = 4096;
    const gridHead = new Int32Array(GRID_BUCKETS);
    let gridNext = null;
    let gridCell = null;
    let chainTick = 0;
    /* §27o — broad-phase bounds: 6 coarse spheres spanning the comet body,
       rebuilt each frame from the 48 proxy samples. Only atoms inside a
       coarse sphere (+6u) pay for the 47-segment narrow phase — running
       the capsule loop for ALL 1715 atoms was the chamber's frame budget
       (verifier: 28fps chamber vs 48fps forge with 170 atoms). */
    const COARSE_N = 6;
    const _coarseX = new Float32Array(COARSE_N), _coarseY = new Float32Array(COARSE_N),
          _coarseZ = new Float32Array(COARSE_N), _coarseRad = new Float32Array(COARSE_N);
    function updateCometInteraction() {
      if (!atoms || !liquidMetal || !chamberAtomWorldPositions
          || !chamberAtomDisplaceState || !chamberAtomBaseColors
          || !chamberAtomBaseQuat || !chamberAtomFloating) return;
      const snakePos = liquidMetal.positions;
      const snakeRad = liquidMetal.radii;
      const pCount   = liquidMetal.count;
      if (!pCount || !snakeRad) return;
      const cvel = liquidMetal.velocity;
      const cvx = cvel.x, cvy = cvel.y, cvz = cvel.z;

      /* (§38 — one-shot setEnvRadius seed removed: a no-op against the
         analytic mirrorBall's stub API.) */

      const now = performance.now();
      let dt = (now - lastInteractMs) / 1000;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 1 / 30) dt = 1 / 30;
      lastInteractMs = now;
      _feedN = 0;   // §32a — fresh mirror-feed candidates this frame

      const count = atoms.count;
      if (!chamberVelocity || chamberVelocity.length !== count * 3) {
        chamberVelocity = new Float32Array(count * 3);
      }
      const im  = atoms.instanceMatrix.array;
      const ic  = atoms.instanceColor.array;
      const pos = chamberAtomWorldPositions;
      const disp = chamberAtomDisplaceState;
      const vel = chamberVelocity;
      const ang = chamberAtomAngVel;
      const floatFlag = chamberAtomFloating;
      const floatAge = chamberAtomFloatAge;

      /* Tuning. */
      const GLOW_K = 5.5, GLOW_REACH_SQ = 4.5 * 4.5, GLOW_CAP = 4.5, MAX_CH = 1.7;
      const DIM_NONMEMBER = 0.62;   // how far non-member atoms dim while a continent is studied (→38%)
      const CONTACT_K = 110;   // contact stiffness (penetration → accel)
      const SPRING_K  = 9;     // pull back to rest spot (resting atoms only)
      const DAMP      = 3.2;   // linear damping (resting atoms only)
      /* PHYSICS-BASED contact (replaced the canned launch constants):
         the comet is effectively infinite mass, so a strike is an
         inelastic bounce off a moving wall — impulse J = −(1+e)·(v_rel·n)
         along the contact normal. A lazy drift shoulders atoms aside, a
         racing smash flings them — same law, no tuning constants. Spin
         comes from the TANGENTIAL SLIP at the contact point (rolling
         induced by her surface sliding past), so the tumble axis follows
         the collision geometry instead of a canned formula. */
      const RESTITUTION = 0.45; // bounciness of a strike (0 dead → 1 elastic)
      const SPIN_COUPLE = 0.30; // fraction of pure-rolling spin imparted by slip
      const CONTACT_R   = 0.90; // collide at this fraction of the cage circumradius —
                                //   1.0 reads as an invisible wall (the cage is ~90%
                                //   empty space), deep dips read as clipping; 0.90
                                //   lets vertex tips just kiss/dimple the chrome
                                //   (0.78 was too deep — §27i).
      const ANG_MAX   = 5.0;   // cap angular speed (rad/s) — gentle
      const ANG_DAMP  = 0.9;   // spin decay for RESTING atoms (settle)
      const MAX_DISP  = 3.5;
      /* Zero-gravity drift: a struck atom goes weightless — no spring,
         the faintest drag, spin that PERSISTS (no air in space) — and
         coasts until attention (the comet) sweeps near and recalls it. */
      const FLOAT_DRAG    = 0.18;  // gentle drag while weightless — a gradual slow-down, not a stop
      const FLOAT_GRACE   = 1.0;   // s before a launched atom can be recalled
      const ATTENTION_R   = 4.5;   // comet proximity that recalls a drifting atom
      const RECALL_DISP   = 2.5;   // must have drifted this far before recall
      const CONTACT_SKIN  = 0.06;  // fire the response just as surfaces MEET
      const FLOAT_MAX_DISP = 11;   // max drift from home while weightless
      /* §37 — VIEWER CLEARANCE BUBBLE: the viewer sits at the origin; a
         struck atom could coast straight through the camera. Any free
         atom inside VIEW_CLEAR gets a gentle radial push out + its
         inward velocity damped — a soft invisible bubble around the
         viewer. Gathered / summoned / satellite atoms are exempt (their
         choreography places them deliberately, e.g. the summon dock). */
      const VIEW_CLEAR = 7.0;
      const BUBBLE_K   = 7.0;
      const angDecayRest  = Math.exp(-ANG_DAMP * dt);
      const angDecayFloat = Math.exp(-0.04 * dt);   // weightless → keeps spinning

      /* §36 — camera-side direction for the mirror feed: unit vector from
         the ball toward the viewer (origin). Computed once per frame. */
      let _mfCx = 0, _mfCy = 0, _mfCz = 0;
      {
        const bl = Math.sqrt(snakePos[0] * snakePos[0] + snakePos[1] * snakePos[1] + snakePos[2] * snakePos[2]);
        if (bl > 1e-4) { _mfCx = -snakePos[0] / bl; _mfCy = -snakePos[1] / bl; _mfCz = -snakePos[2] / bl; }
      }
      const _mfBx = snakePos[0], _mfBy = snakePos[1], _mfBz = snakePos[2];

      /* §27o — rebuild the coarse bounding spheres for this frame.
         §34 — the body is a BALL (§32): ONE sphere suffices (was 6 —
         five wasted sqrts per atom per frame). */
      let coarseN = COARSE_N;
      if (pCount <= 2) {
        coarseN = 1;
        _coarseX[0] = snakePos[0]; _coarseY[0] = snakePos[1]; _coarseZ[0] = snakePos[2];
        _coarseRad[0] = snakeRad[0];
      } else {
        const span = (pCount - 1) / COARSE_N;
        for (let c = 0; c < COARSE_N; c++) {
          const j0 = Math.floor(c * span);
          const j1 = Math.min(pCount - 1, Math.ceil((c + 1) * span));
          const mx = (snakePos[j0 * 3] + snakePos[j1 * 3]) * 0.5;
          const my = (snakePos[j0 * 3 + 1] + snakePos[j1 * 3 + 1]) * 0.5;
          const mz = (snakePos[j0 * 3 + 2] + snakePos[j1 * 3 + 2]) * 0.5;
          let r = 0;
          for (let j = j0; j <= j1; j++) {
            const dx = snakePos[j * 3] - mx, dy = snakePos[j * 3 + 1] - my, dz = snakePos[j * 3 + 2] - mz;
            const rr = Math.sqrt(dx * dx + dy * dy + dz * dz) + snakeRad[j];
            if (rr > r) r = rr;
          }
          _coarseX[c] = mx; _coarseY[c] = my; _coarseZ[c] = mz; _coarseRad[c] = r;
        }
      }

      for (let i = 0; i < count; i++) {
        const ix = i * 3;
        const ax = pos[ix]     + disp[ix];
        const ay = pos[ix + 1] + disp[ix + 1];
        const az = pos[ix + 2] + disp[ix + 2];

        /* §27o broad phase — distance to the coarse spheres. Far atoms
           use it directly for the glow falloff (error ≪ the falloff at
           that range) and skip the 47-segment narrow phase; with
           surfaceDist > 6 the contact gap below is always negative, so
           contact is implicitly skipped too. */
        let dApprox = Infinity;
        for (let c = 0; c < coarseN; c++) {
          const dxc = ax - _coarseX[c], dyc = ay - _coarseY[c], dzc = az - _coarseZ[c];
          const dc = Math.sqrt(dxc * dxc + dyc * dyc + dzc * dzc) - _coarseRad[c];
          if (dc < dApprox) dApprox = dc;
        }
        let dist = 1, ndx = 0, ndy = 0, ndz = 0, cometR = 0, surfaceDist;
        if (dApprox < 6) {
          /* Narrow phase — nearest point on the capsule chain (segments
             between consecutive body samples, radius interpolated; the
             chain IS the smooth drawn surface since §27m). */
          let bd2 = Infinity;
          for (let j = 0; j < pCount - 1; j++) {
            const j3 = j * 3, k3 = j3 + 3;
            const sx = snakePos[j3], sy = snakePos[j3 + 1], sz = snakePos[j3 + 2];
            const ex = snakePos[k3] - sx, ey = snakePos[k3 + 1] - sy, ez = snakePos[k3 + 2] - sz;
            const ll = ex * ex + ey * ey + ez * ez;
            let tj = ll > 1e-10 ? ((ax - sx) * ex + (ay - sy) * ey + (az - sz) * ez) / ll : 0;
            if (tj < 0) tj = 0; else if (tj > 1) tj = 1;
            const dx = ax - (sx + ex * tj), dy = ay - (sy + ey * tj), dz = az - (sz + ez * tj);
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bd2) {
              bd2 = d2; ndx = dx; ndy = dy; ndz = dz;
              cometR = snakeRad[j] + (snakeRad[j + 1] - snakeRad[j]) * tj;
            }
          }
          dist = Math.sqrt(bd2) || 1e-4;
          surfaceDist = dist - cometR;
        } else {
          surfaceDist = dApprox;
        }
        const atomR  = chamberAtomRadius[i] * CONTACT_R;
        /* §32a — mirror-feed candidate. §41 — EFFECTIVE distance is a
           full facing ramp: ×MIRROR_W_FRONT toward the viewer (their
           hemisphere is what her visible face shows — it must win
           slots), ×MIRROR_W_BACK behind the ball (silhouette-only). */
        if (surfaceDist < MIRROR_HORIZON && _feedN < _feedD.length) {
          const fdx = ax - _mfBx, fdy = ay - _mfBy, fdz = az - _mfBz;
          const fl = Math.sqrt(fdx * fdx + fdy * fdy + fdz * fdz) || 1e-4;
          const facing = (fdx * _mfCx + fdy * _mfCy + fdz * _mfCz) / fl;
          const dEff = surfaceDist * (_mfA - _mfB * facing);
          if (dEff < MIRROR_HORIZON) {
            _feedD[_feedN] = dEff;
            _feedI[_feedN] = i;
            _feedN++;
          }
        }

        /* Proximity glow off the SURFACE distance. */
        const sd = surfaceDist > 0 ? surfaceDist : 0;
        let boost = Math.min(GLOW_CAP, 1 + GLOW_K / (1 + (sd * sd) / GLOW_REACH_SQ));
        /* A gathered member brightens as it assembles — the continent
           lights up as a legible knowledge graph, not a dim cluster. */
        if (gGlow) {
          const gg = gGlow[i];
          if (gg > 0.001) boost *= 1 + 0.85 * gg;                 // members brighten
          /* Non-members DIM (not recede) while a continent is studied, so
             the focused space reads as the foreground. gg≈1 members are
             unaffected; gg≈0 non-members dim toward DIM_FLOOR. */
          if (gatherActiveEase > 0.001) boost *= 1 - DIM_NONMEMBER * gatherActiveEase * (1 - gg);
        }
        let r = chamberAtomBaseColors[ix] * boost;
        let g = chamberAtomBaseColors[ix + 1] * boost;
        let b = chamberAtomBaseColors[ix + 2] * boost;
        const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        if (mx > MAX_CH) { const k = MAX_CH / mx; r *= k; g *= k; b *= k; }
        ic[ix] = r; ic[ix + 1] = g; ic[ix + 2] = b;

        /* ── Zero-gravity drift ─────────────────────────────
           A resting atom springs home. Once the comet STRIKES it the
           atom goes weightless — no spring, just a coast and a slow
           tumble — keeping the chamber forever in motion. It reforms
           home only when attention (the comet) sweeps near again. */
        const fl = floatFlag[i];
        let fx, fy, fz;
        if (fl) {
          fx = -FLOAT_DRAG * vel[ix];
          fy = -FLOAT_DRAG * vel[ix + 1];
          fz = -FLOAT_DRAG * vel[ix + 2];
          floatAge[i] += dt;
          /* §34 — SETTLE IN PLACE: a drifted atom whose motion has died
             becomes a RESTING atom where it is (§28m law: struck atoms
             "settle where they drifted") — its spot becomes home, the
             displacement folds to zero. Without this every struck atom
             stayed weightless FOREVER, so the chain-reaction pass and
             float integration ran permanently once she'd toured the
             field — the high-mode "heavy". (True attention-driven
             recall remains TODO; FLOAT_GRACE/ATTENTION_R kept.) */
          if (floatAge[i] > 4) {
            const sp2 = vel[ix] * vel[ix] + vel[ix + 1] * vel[ix + 1] + vel[ix + 2] * vel[ix + 2];
            const an2 = ang[ix] * ang[ix] + ang[ix + 1] * ang[ix + 1] + ang[ix + 2] * ang[ix + 2];
            /* §37 — never SETTLE inside the viewer bubble: home would
               land in the clear zone and fight the bubble forever. */
            if (sp2 < 0.0012 && an2 < 0.01
                && ax * ax + ay * ay + az * az > VIEW_CLEAR * VIEW_CLEAR) {
              pos[ix] += disp[ix]; pos[ix + 1] += disp[ix + 1]; pos[ix + 2] += disp[ix + 2];
              if (restShellPositions) {
                restShellPositions[ix] = pos[ix];
                restShellPositions[ix + 1] = pos[ix + 1];
                restShellPositions[ix + 2] = pos[ix + 2];
              }
              disp[ix] = 0; disp[ix + 1] = 0; disp[ix + 2] = 0;
              vel[ix] = 0; vel[ix + 1] = 0; vel[ix + 2] = 0;
              floatFlag[i] = 0;
              const pmap = atomNodes && atomPositions.get(atomNodes[i].id);
              if (pmap) { pmap.x = pos[ix]; pmap.y = pos[ix + 1]; pmap.z = pos[ix + 2]; }
            }
          }
        } else {
          fx = -SPRING_K * disp[ix]     - DAMP * vel[ix];
          fy = -SPRING_K * disp[ix + 1] - DAMP * vel[ix + 1];
          fz = -SPRING_K * disp[ix + 2] - DAMP * vel[ix + 2];
        }

        /* §37 — viewer clearance bubble (see constants above). */
        const _rd2 = ax * ax + ay * ay + az * az;
        if (_rd2 < VIEW_CLEAR * VIEW_CLEAR
            && gOwner[i] == null && i !== summonAtomIdx && !satelliteSet.has(i)) {
          const _rd = Math.sqrt(_rd2) || 1e-4;
          const _bi = 1 / _rd;
          const _bx = ax * _bi, _by = ay * _bi, _bz = az * _bi;
          const _pen = VIEW_CLEAR - _rd;
          fx += _bx * BUBBLE_K * _pen;
          fy += _by * BUBBLE_K * _pen;
          fz += _bz * BUBBLE_K * _pen;
          /* damp the INWARD radial velocity so it eases off the bubble
             instead of oscillating through it. */
          const _vr = vel[ix] * _bx + vel[ix + 1] * _by + vel[ix + 2] * _bz;
          if (_vr < 0) {
            const _k = Math.min(1, dt * 6) * _vr;
            vel[ix] -= _bx * _k; vel[ix + 1] -= _by * _k; vel[ix + 2] -= _bz * _k;
          }
        }

        /* TRUE CONTACT — physics-based. The skin + a predictive margin
           (closing speed × dt) decide WHEN to respond, but the response
           itself is momentum, not teleport: the impulse sets the atom's
           normal velocity to a proper bounce off her (moving) surface, so
           the atom is PUSHED out over the next frames at a physical rate.
           Positional snap is limited to the ACTUAL overlap only — with
           capsule distance + the impulse it stays sub-visual. */
        const cvDotN = (dist > 1e-4) ? (cvx * ndx + cvy * ndy + cvz * ndz) / dist : 0;
        const closing = cvDotN > 0 ? cvDotN : 0;        // comet surface approaching the atom along n
        const predict = closing * dt;
        const gap = atomR - surfaceDist + CONTACT_SKIN + predict;   // >0 ⇒ surfaces (about to) touch
        if (gap > 0) {
          const nx = ndx / dist, ny = ndy / dist, nz = ndz / dist;  // outward (comet→atom)
          /* Resolve only the REAL overlap (no predictive snap — that
             read as a teleport). */
          const pen = atomR - surfaceDist;
          if (pen > 0) {
            disp[ix]     += nx * pen;
            disp[ix + 1] += ny * pen;
            disp[ix + 2] += nz * pen;
          }
          /* Relative velocity at contact (atom vs her rigid translation). */
          const rvx = vel[ix] - cvx, rvy = vel[ix + 1] - cvy, rvz = vel[ix + 2] - cvz;
          const vn = rvx * nx + rvy * ny + rvz * nz;      // <0 ⇒ approaching
          if (vn < 0) {
            if (!floatFlag[i]) { floatFlag[i] = 1; floatAge[i] = 0; }   // struck → weightless
            const J = -(1 + RESTITUTION) * vn;             // bounce impulse (comet ≈ infinite mass)
            vel[ix]     += nx * J;
            vel[ix + 1] += ny * J;
            vel[ix + 2] += nz * J;
            /* Spin transfers IMPULSIVELY, like the bounce — a strike
               lasts 1–2 frames, so EASING toward the rolling rate never
               got there (the §27d no-spin bug). Jump most of the way on
               each strike frame; axis & magnitude still follow the slip. */
            const tvx = rvx - vn * nx, tvy = rvy - vn * ny, tvz = rvz - vn * nz;
            const wtx = (ny * tvz - nz * tvy) / atomR * SPIN_COUPLE;
            const wty = (nz * tvx - nx * tvz) / atomR * SPIN_COUPLE;
            const wtz = (nx * tvy - ny * tvx) / atomR * SPIN_COUPLE;
            const bl = 0.8;
            ang[ix]     += (wtx - ang[ix])     * bl;
            ang[ix + 1] += (wty - ang[ix + 1]) * bl;
            ang[ix + 2] += (wtz - ang[ix + 2]) * bl;
          }
          /* Residual contact spring on the actual overlap keeps her
             surface from re-entering between impulse frames. */
          const k = CONTACT_K * (pen > 0 ? pen : 0);
          fx += nx * k; fy += ny * k; fz += nz * k;
        }

        /* Integrate linear. */
        vel[ix]     += fx * dt; vel[ix + 1] += fy * dt; vel[ix + 2] += fz * dt;
        disp[ix]     += vel[ix] * dt; disp[ix + 1] += vel[ix + 1] * dt; disp[ix + 2] += vel[ix + 2] * dt;
        /* Resting atoms stay near home; weightless ones may drift far
           (but bounded so they remain recallable). */
        const capD = floatFlag[i] ? FLOAT_MAX_DISP : MAX_DISP;
        const dl2 = disp[ix] * disp[ix] + disp[ix + 1] * disp[ix + 1] + disp[ix + 2] * disp[ix + 2];
        if (dl2 > capD * capD) {
          const dl = Math.sqrt(dl2) || 1;
          const s = capD / dl;
          disp[ix] *= s; disp[ix + 1] *= s; disp[ix + 2] *= s;
          if (floatFlag[i]) {
            /* ease to a halt at the boundary instead of sticking to a
               hard wall: remove the outward velocity component. */
            const ux = disp[ix] / capD, uy = disp[ix + 1] / capD, uz = disp[ix + 2] / capD;
            const vo = vel[ix] * ux + vel[ix + 1] * uy + vel[ix + 2] * uz;
            if (vo > 0) { vel[ix] -= ux * vo; vel[ix + 1] -= uy * vo; vel[ix + 2] -= uz * vo; }
          }
        }

        /* Integrate + cap + decay angular velocity. */
        let wx = ang[ix], wy = ang[ix + 1], wz = ang[ix + 2];
        let wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
        if (wl > ANG_MAX) { const s = ANG_MAX / wl; wx *= s; wy *= s; wz *= s; wl = ANG_MAX; }
        if (wl > 1e-5) {
          const a = wl * dt, sh = Math.sin(a * 0.5) / wl;
          _ciQd.set(wx * sh, wy * sh, wz * sh, Math.cos(a * 0.5));
          _ciSpin.set(chamberAtomSpin[i * 4], chamberAtomSpin[i * 4 + 1],
                      chamberAtomSpin[i * 4 + 2], chamberAtomSpin[i * 4 + 3]);
          _ciSpin.premultiply(_ciQd);
          chamberAtomSpin[i * 4]     = _ciSpin.x;
          chamberAtomSpin[i * 4 + 1] = _ciSpin.y;
          chamberAtomSpin[i * 4 + 2] = _ciSpin.z;
          chamberAtomSpin[i * 4 + 3] = _ciSpin.w;
        }
        const angDecay = floatFlag[i] ? angDecayFloat : angDecayRest;
        ang[ix] = wx * angDecay; ang[ix + 1] = wy * angDecay; ang[ix + 2] = wz * angDecay;

        /* Recompose the shell: translation (rest+disp) · (spin·base) · scale.
           §34 — SKIPPED for atoms that are perfectly still (no float, no
           displacement, no spin, settled, unowned): their matrix is
           already correct, and in a calm field that's ~95% of 1715
           quaternion→matrix composes saved per frame. */
        const _still = !floatFlag[i] && dl2 < 1e-10 && wl < 1e-5
          && gOwner[i] == null && gEase[i] >= 1
          && i !== summonAtomIdx && !satelliteSet.has(i);
        if (!_still) {
          _ciBase.set(chamberAtomBaseQuat[i * 4], chamberAtomBaseQuat[i * 4 + 1],
                      chamberAtomBaseQuat[i * 4 + 2], chamberAtomBaseQuat[i * 4 + 3]);
          _ciSpin.set(chamberAtomSpin[i * 4], chamberAtomSpin[i * 4 + 1],
                      chamberAtomSpin[i * 4 + 2], chamberAtomSpin[i * 4 + 3]);
          _ciSpin.multiply(_ciBase);   // spin ∘ base
          let sc = chamberAtomScale[i];
          if (i === summonAtomIdx && summonReveal < 1) sc *= summonReveal;   // dissolve into the morph
          _ciPos.set(pos[ix] + disp[ix], pos[ix + 1] + disp[ix + 1], pos[ix + 2] + disp[ix + 2]);
          _ciScl.set(sc, sc, sc);
          _ciM4.compose(_ciPos, _ciSpin, _ciScl);
          const b16 = i * 16;
          for (let k = 0; k < 16; k++) im[b16 + k] = _ciM4.elements[k];
        }
      }

      /* (§38 — the §27d per-frame projection-radius ease removed with
         the rest of the setEnvRadius machinery: dead under §31/§32's
         fully analytic mirror.) */

      /* §32a — build the ball's analytic-mirror feed: nearest cages by
         surface distance, live positions (home + displacement), the
         CURRENT displayed colour (instanceColor — base × glow/dim),
         and the drawn orientation (spin ∘ base). Brightness fades to
         zero at the §36 EFFECTIVE-distance horizon (16u camera-side),
         so the 64-cap horizon is invisible. */
      {
        /* §39 — QUICKSELECT the nearest cap atoms by effective distance.
           (The §34 partial selection sort was O(cap × N) — fine at 64 × a
           few hundred candidates, ruinous at 256 × the whole field.) One
           in-place Hoare partition pass: indices [0, cap) hold the cap
           smallest (unordered — the shader doesn't care), and _feedD[cap]
           is EXACTLY the (cap+1)-th smallest — so the §32e dynamic
           horizon (fade ends AT the truncation boundary) stays exact. */
        if (_feedN > BALL_FEED_CAP) {
          const k = BALL_FEED_CAP;
          let lo = 0, hi = _feedN - 1;
          while (lo < hi) {
            const pivot = _feedD[(lo + hi) >> 1];
            let i = lo, j = hi;
            while (i <= j) {
              while (_feedD[i] < pivot) i++;
              while (_feedD[j] > pivot) j--;
              if (i <= j) {
                const td = _feedD[i]; _feedD[i] = _feedD[j]; _feedD[j] = td;
                const ti = _feedI[i]; _feedI[i] = _feedI[j]; _feedI[j] = ti;
                i++; j--;
              }
            }
            if (k <= j) hi = j;
            else if (k >= i) lo = i;
            else break;
          }
        }
        const fn = Math.min(_feedN, BALL_FEED_CAP);
        _ballFeed.rad = atomScale;   // §32c — track the live cage size
        /* §32e — DYNAMIC horizon (the pop-in fix): the fade ends AT the
           truncation boundary, so set churn happens at zero brightness. */
        let horizon = MIRROR_HORIZON;
        if (_feedN > BALL_FEED_CAP) {
          horizon = Math.min(MIRROR_HORIZON, _feedD[BALL_FEED_CAP]);
        }
        const fadeBand = Math.max(0.8, horizon * 0.26);   // §39 — scales with the live boundary
        for (let k = 0; k < fn; k++) {
          const d = _feedD[k], i = _feedI[k], i3 = i * 3, i4 = i * 4;
          const w = Math.max(0, Math.min(1, (horizon - d) / fadeBand));
          _ballFeed.pos[k * 3]     = pos[i3]     + disp[i3];
          _ballFeed.pos[k * 3 + 1] = pos[i3 + 1] + disp[i3 + 1];
          _ballFeed.pos[k * 3 + 2] = pos[i3 + 2] + disp[i3 + 2];
          /* §35a — HUE PARITY: the cages render through the renderer's
             linear→sRGB output transform (and clamp), but the ball's
             mirror is a raw shader — feeding it linear values displayed
             them with distorted channel ratios (user: "blue is
             reflecting slightly green"; glow-boosted colours clipped
             blue first and left green standing). Encode each fed colour
             to EXACTLY what the screen shows for that cage — clamp to
             1, then the sRGB OETF — so reflection hue ≡ cage hue by
             construction. (Fade w applies after encode — it ends at 0
             either way, §32e horizon law intact.) */
          _ballFeed.col[k * 3]     = _srgbEnc(ic[i3]) * w;
          _ballFeed.col[k * 3 + 1] = _srgbEnc(ic[i3 + 1]) * w;
          _ballFeed.col[k * 3 + 2] = _srgbEnc(ic[i3 + 2]) * w;
          _fqBase.set(chamberAtomBaseQuat[i4], chamberAtomBaseQuat[i4 + 1], chamberAtomBaseQuat[i4 + 2], chamberAtomBaseQuat[i4 + 3]);
          _fqSpin.set(chamberAtomSpin[i4], chamberAtomSpin[i4 + 1], chamberAtomSpin[i4 + 2], chamberAtomSpin[i4 + 3]);
          _fqSpin.multiply(_fqBase);   // spin ∘ base — the drawn cage orientation
          _ballFeed.quat[k * 4]     = _fqSpin.x;
          _ballFeed.quat[k * 4 + 1] = _fqSpin.y;
          _ballFeed.quat[k * 4 + 2] = _fqSpin.z;
          _ballFeed.quat[k * 4 + 3] = _fqSpin.w;
        }
        _ballFeed.n = fn;
      }

      /* ── Atom ↔ atom chain reaction ──────────────────────
         A drifting (weightless) atom knocks others off their perch,
         which fly and knock more — a chain reaction. Only FLOATING
         atoms initiate; a spatial hash keeps it cheap, and the whole
         pass is skipped when nothing is adrift. */
      let anyFloat = false;
      for (let i = 0; i < count; i++) { if (floatFlag[i]) { anyFloat = true; break; } }
      chainTick++;
      if (anyFloat && (chainTick & 1) === 0) {
        /* §34 — HALF-RATE (impulse exchange at 30Hz is visually identical
           to 60) + the allocation-free typed-array grid. */
        const CS = 0.95, COLL_R2 = 0.85 * 0.85, TRANSFER = 0.55;
        if (!gridNext || gridNext.length < count) {
          gridNext = new Int32Array(count);
          gridCell = new Int32Array(count);
        }
        gridHead.fill(-1);
        for (let k = 0; k < count; k++) {
          const k3 = k * 3;
          const gx = (((pos[k3] + disp[k3]) / CS) | 0) + 512;
          const gy = (((pos[k3 + 1] + disp[k3 + 1]) / CS) | 0) + 512;
          const gz = (((pos[k3 + 2] + disp[k3 + 2]) / CS) | 0) + 512;
          const key = gx | (gy << 10) | (gz << 20);
          const b = (key ^ (key >>> 12)) & (GRID_BUCKETS - 1);
          gridCell[k] = key;
          gridNext[k] = gridHead[b];
          gridHead[b] = k;
        }
        for (let i = 0; i < count; i++) {
          if (!floatFlag[i]) continue;
          const i3 = i * 3;
          const pxi = pos[i3] + disp[i3], pyi = pos[i3 + 1] + disp[i3 + 1], pzi = pos[i3 + 2] + disp[i3 + 2];
          const vxi = vel[i3], vyi = vel[i3 + 1], vzi = vel[i3 + 2];
          if (vxi * vxi + vyi * vyi + vzi * vzi < 0.04) continue;   // too slow to knock anything
          const gx = ((pxi / CS) | 0) + 512, gy = ((pyi / CS) | 0) + 512, gz = ((pzi / CS) | 0) + 512;
          for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
            const key = (gx + ox) | ((gy + oy) << 10) | ((gz + oz) << 20);
            const b = (key ^ (key >>> 12)) & (GRID_BUCKETS - 1);
            for (let j = gridHead[b]; j >= 0; j = gridNext[j]) {
              if (gridCell[j] !== key || j === i) continue;
              const j3 = j * 3;
              const dx = (pos[j3] + disp[j3]) - pxi, dy = (pos[j3 + 1] + disp[j3 + 1]) - pyi, dz = (pos[j3 + 2] + disp[j3 + 2]) - pzi;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > COLL_R2 || d2 < 1e-6) continue;
              const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
              const vn = vxi * nx + vyi * ny + vzi * nz;     // i's approach speed toward j
              if (vn <= 0.05) continue;
              const imp = vn * TRANSFER;
              vel[j3] += nx * imp; vel[j3 + 1] += ny * imp; vel[j3 + 2] += nz * imp;
              if (!floatFlag[j]) { floatFlag[j] = 1; floatAge[j] = 0; }   // knocked loose → weightless
              ang[j3]     += (ny * vzi - nz * vyi) * 3;       // rolling spin from the impact
              ang[j3 + 1] += (nz * vxi - nx * vzi) * 3;
              ang[j3 + 2] += (nx * vyi - ny * vxi) * 3;
              vel[i3] -= nx * imp; vel[i3 + 1] -= ny * imp; vel[i3 + 2] -= nz * imp;   // i loses momentum
            }
          }
        }
      }
      atoms.instanceMatrix.needsUpdate = true;
      atoms.instanceColor.needsUpdate = true;

      /* The depth proxy travels in lockstep (translation only) so atom
         occlusion follows the live (collided/gathered) positions — and
         §40: the shine halos ride the same loop. */
      if (atomCores) {
        const mim = atomCores.instanceMatrix.array;
        const hpArr = atomHalos ? atomHalos.geometry.attributes.position.array : null;
        for (let i = 0; i < count; i++) {
          const ix = i * 3, b16 = i * 16;
          const lx = pos[ix]     + disp[ix];
          const ly = pos[ix + 1] + disp[ix + 1];
          const lz = pos[ix + 2] + disp[ix + 2];
          mim[b16 + 12] = lx;
          mim[b16 + 13] = ly;
          mim[b16 + 14] = lz;
          if (hpArr) { hpArr[ix] = lx; hpArr[ix + 1] = ly; hpArr[ix + 2] = lz; }
        }
        atomCores.instanceMatrix.needsUpdate = true;
        if (hpArr) atomHalos.geometry.attributes.position.needsUpdate = true;
      }
      /* §40 — the SHINE level rides its Tweak (forge tick() law:
         opacity 0.55·sh, size 1.4+1.3·sh at ATOM_R 0.42, scaled to the
         live cage size). */
      if (atomHalos) {
        const sh = (typeof window.__omegaShine === "number") ? window.__omegaShine : 0.6;
        atomHalos.visible = sh > 0.01;
        atomHalos.material.opacity = Math.min(1, 0.55 * sh);
        atomHalos.material.size = (1.4 + 1.3 * sh) * (atomScale / 0.42);
      }
      summonScaleDirtyIdx = -1;   // (kept; summon scale handled on the energy mesh elsewhere)
    }

    /* ── Frame loop ────────────────────────────────────────────── */
    let stopped = false;
    let lastFrame = performance.now();
    function loop() {
      if (stopped) return;
      const now = performance.now();
      const dt = now - lastFrame;
      lastFrame = now;
      if (core && core.update) core.update(dt, now);
      /* Comet swims through the field. */
      if (liquidMetal && liquidMetal.update) liquidMetal.update(now);
      /* Re-point each atom's home toward its continent (or back to the
         resting galaxy) before the collision pass reads those homes. */
      updateGather(now);
      /* Summoned satellites orbit Omega's locus — update after the comet
         moved (so they track her live head) and after gather. */
      updateSatellites(now);
      updateSummonAtom(now);
      /* Comet ↔ atom: proximity glow + true collision + spin, all
         in one pass over the atoms. */
      updateCometInteraction();
      /* Living camera: rotate in place (never translate) to follow
         Omega's locus. Runs before render so the frame uses the new
         orientation. */
      if (cameraRig) cameraRig.update(now);
      /* Ease tone-mapping exposure toward the energy-mode target. */
      renderer.toneMappingExposure += (exposureTarget - renderer.toneMappingExposure) * 0.05;

      /* §32 — no atom depth pre-pass: the solid cages write REAL depth
         in the main render, so atoms, the comet and the label all sort
         natively against each other. */
      renderer.autoClear = false;
      renderer.clear();                         // colour + depth
      renderer.render(scene, camera);           // main image (no clear)
      /* ── GLM name-band pass ───────────────────────────────────────
         The buffer already holds atom + comet depth, so just draw the
         label (its own layer) depth-tested: atoms in front occlude it,
         the chrome occludes its far side. */
      if (liquidMetal && liquidMetal.labelMesh) {
        const _cm = camera.layers.mask;
        camera.layers.set(LABEL_LAYER);
        renderer.render(scene, camera);
        camera.layers.mask = _cm;
      }
      renderer.autoClear = true;
      /* Additive bloom overlay (task 3) — draws ON TOP of the
         finished main frame so atom cores read as real light
         sources and the comet's reflected highlights glow, without
         disturbing the ACES-tonemapped main image underneath. */
      if (bloom) bloom.render();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    /* ── Atom picking (screen-space) ───────────────────────────
       Project every chamber atom's rest position to screen and return
       the front-most node within PICK_PX of the click. The React
       room-click calls this; a hit fires an `inspect` intent (pointing
       at an atom in the sea opens its card). Rest (layout) positions
       are used — the per-frame snake push is subtle enough not to
       matter for a click target. */
    const PICK_PX = 26;
    function pickAtomAt(clientX, clientY) {
      const g = window.omegaGraph;
      if (!g || !g.nodes.length) return null;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const world = new THREE.Vector3();
      let best = null, bestDist = Infinity;
      for (const n of g.nodes) {
        const p = atomPositions.get(n.id);
        if (!p) continue;
        world.set(p.x, p.y, p.z);
        /* In-front test in view space (camera looks down -z). */
        const viewZ = world.clone().applyMatrix4(camera.matrixWorldInverse).z;
        if (viewZ > -0.05) continue;
        const ndc = world.clone().project(camera);
        const sx = (ndc.x * 0.5 + 0.5) * rect.width;
        const sy = (1 - (ndc.y * 0.5 + 0.5)) * rect.height;
        const d = Math.hypot(sx - px, sy - py);
        if (d > PICK_PX) continue;
        const camDist = -viewZ;   /* frontmost candidate wins */
        if (camDist < bestDist) { bestDist = camDist; best = n; }
      }
      return best;
    }

    return {
      dispose() {
        stopped = true;
        window.removeEventListener("resize", resize);
        if (frameUnsub) frameUnsub();
        if (graphUnsub) graphUnsub();

        scene.remove(ambient); ambient.dispose && ambient.dispose();
        scene.remove(key); key.dispose && key.dispose();
        scene.remove(fill); fill.dispose && fill.dispose();
        if (atoms) {
          scene.remove(atoms);
          atoms.geometry.dispose();
          atoms.material.dispose();
          atoms.dispose && atoms.dispose();
        }
        if (atomCores) {
          scene.remove(atomCores);
          atomCores.geometry.dispose();
          atomCores.material.dispose();
          atomCores.dispose && atomCores.dispose();
        }
        if (atomHalos) {
          scene.remove(atomHalos);
          atomHalos.geometry.dispose();
          atomHalos.material.dispose();
          atomHalos.dispose && atomHalos.dispose();
        }
        if (atomOuterHalos) {
          scene.remove(atomOuterHalos);
          atomOuterHalos.geometry.dispose();
          atomOuterHalos.material.dispose();
          atomOuterHalos.dispose && atomOuterHalos.dispose();
        }
        if (edgeLines) {
          scene.remove(edgeLines);
          edgeLines.geometry.dispose();
          edgeLines.material.dispose();
        }
        if (starfield) {
          scene.remove(starfield);
          starfield.geometry.dispose();
          starfield.material.dispose();
        }
        _haloTex.dispose();
        if (bloom) bloom.dispose();
        if (cameraRig) cameraRig.dispose();
        renderer.dispose();
        if (window.omegaR3D) window.omegaR3D.__sceneHandle = null;
      },
      scene, camera, renderer,
      core,
      atoms: () => atoms,
      atomCores: () => atomCores,
      edges: () => edgeLines,
      positions: () => atomPositions,
      pickAtomAt,
      liquidMetal: () => liquidMetal,
      cameraRig: () => cameraRig,
      /* Gather a memory space into a continent (or null to disperse).
         Normally driven via the omegaState frame; exposed for debug. */
      gather(spaceName) {
        setGatherFrame({ layoutMode: spaceName ? "gather" : "resting", focus: spaceName || null });
      },
      gatheredSpace: () => gatherSpace,
      /* Project an atom's current world position to CSS-pixel screen
         coords (for anchoring a window's grow-from-atom morph). Returns
         {x,y,visible} or null. */
      screenPosOf(label) {
        if (!atomNodes) return null;
        let idx = atomNodes.findIndex((n) => n.label === label);
        const node = idx >= 0 ? atomNodes[idx] : (window.omegaGraph && window.omegaGraph.nodes.find((n) => n.label === label));
        if (!node) return null;
        const p = atomPositions.get(node.id);
        if (!p) return null;
        const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
        const rect = renderer.domElement.getBoundingClientRect();
        let hue = 210;
        if (idx >= 0 && chamberAtomBaseColors) {
          _tmpHSL2.setRGB(chamberAtomBaseColors[idx * 3], chamberAtomBaseColors[idx * 3 + 1], chamberAtomBaseColors[idx * 3 + 2]);
          const hsl = {}; _tmpHSL2.getHSL(hsl); hue = Math.round(hsl.h * 360);
        }
        const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
        const sy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
        /* On-screen radius of the atom cage: project a point one cage-radius
           to camera-right and measure the pixel distance — so the morph can
           begin at the atom's TRUE apparent size (looms large when docked
           close, small when far). */
        const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        if (camRight.lengthSq() < 1e-6) camRight.set(1, 0, 0); else camRight.normalize();
        const e = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(camRight, 0.16).project(camera);
        const ex = rect.left + (e.x * 0.5 + 0.5) * rect.width;
        const ey = rect.top + (-e.y * 0.5 + 0.5) * rect.height;
        const radius = Math.hypot(ex - sx, ey - sy);
        return {
          x: sx,
          y: sy,
          hue,
          radius,
          visible: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2,
        };
      },
      /* Project the summoned atom's REAL icosahedron cage to screen and
         return its silhouette (convex hull of the 12 projected vertices,
         CSS-px, ordered CCW) + centroid + hue. The edge morph starts from
         THIS exact outline so the window opens from the atom's own edges,
         not a synthetic ring. Reads the live instance matrix so the spin
         orientation matches what's on screen. */
      cageSilhouette(label) {
        if (!atomNodes || !atoms) return null;
        const idx = atomNodes.findIndex((n) => n.label === label);
        if (idx < 0) return null;
        const m4 = new THREE.Matrix4();
        atoms.getMatrixAt(idx, m4);
        const rect = renderer.domElement.getBoundingClientRect();
        const T = (1 + Math.sqrt(5)) / 2;
        const raw = [
          [-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0],
          [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T],
          [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1],
        ];
        const v = new THREE.Vector3();
        const proj = [];
        for (let i = 0; i < raw.length; i++) {
          v.set(raw[i][0], raw[i][1], raw[i][2]).normalize().applyMatrix4(m4).project(camera);
          proj.push([rect.left + (v.x * 0.5 + 0.5) * rect.width, rect.top + (-v.y * 0.5 + 0.5) * rect.height]);
        }
        /* Convex hull (Andrew's monotone chain). */
        const ptsSorted = proj.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lower = [];
        for (const p of ptsSorted) {
          while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
          lower.push(p);
        }
        const upper = [];
        for (let i = ptsSorted.length - 1; i >= 0; i--) {
          const p = ptsSorted[i];
          while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
          upper.push(p);
        }
        const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
        if (hull.length < 3) return null;
        let cx = 0, cy = 0;
        for (const p of hull) { cx += p[0]; cy += p[1]; }
        cx /= hull.length; cy /= hull.length;
        let hue = 210;
        if (chamberAtomBaseColors) {
          _tmpHSL2.setRGB(chamberAtomBaseColors[idx * 3], chamberAtomBaseColors[idx * 3 + 1], chamberAtomBaseColors[idx * 3 + 2]);
          const hsl = {}; _tmpHSL2.getHSL(hsl); hue = Math.round(hsl.h * 360);
        }
        /* points are returned RELATIVE to the centroid, so the morph can
           re-place the silhouette at the atom's CURRENT screen position
           (e.g. on close, after the atom/camera have drifted). */
        return { cx, cy, hue, points: hull.map((p) => [p[0] - cx, p[1] - cy]) };
      },
      /* Play a reasoning HOP in the space (§11). `spec` may name premise
         + conclusion atom labels; otherwise a few salient belief atoms
         are auto-chosen. Gathers them into a tiny continent (conclusion
         pinned at centre, premise→conclusion links) and returns the
         chosen labels + centroid so a receipt can dock to the conclusion.
         No bound on premise count. */
      reason(spec) {
        if (!atomNodes || !atomNodes.length) return null;
        const byLabel = (lab) => atomNodes.findIndex((n) => n.label === lab);
        let premiseIdxs = null, concIdx = -1;
        if (spec && spec.premises && spec.conclusion) {
          premiseIdxs = spec.premises.map(byLabel).filter((i) => i >= 0);
          concIdx = byLabel(spec.conclusion);
        }
        if (!premiseIdxs || premiseIdxs.length < 1 || concIdx < 0) {
          const pool = [];
          for (let i = 0; i < atomNodes.length; i++) {
            const sp = atomNodes[i].space;
            if (sp === "beliefs" || sp === "assume" || sp === "world") pool.push(i);
          }
          if (pool.length < 3) for (let i = 0; i < atomNodes.length; i++) pool.push(i);
          pool.sort((a, b) => (atomNodes[b].salience || 0) - (atomNodes[a].salience || 0));
          const n = 2 + ((Math.random() * 2) | 0);   // 2–3 premises
          premiseIdxs = pool.slice(1, 1 + n);
          concIdx = pool[0];
        }
        return playReasoning(premiseIdxs, concIdx);
      },
      /* Summon — bring a single atom (or a space) TO the viewer (§ roadmap
         #4: "atoms come to us"). The atom flies to a dock point CLOSE in
         front of the camera (looms large by perspective), brightens, and
         the rest of the field dims — as if pulled into your hand. A space
         name summons its continent closer than a normal gather. Returns
         the chosen label, or null. Reuses the gather machinery. */
      summon(target, opts) {
        if (!atomNodes || !atomNodes.length) return null;
        const t = typeof target === "string" ? target : (target && target.target);
        if (!t) return null;
        const quiet = !!(opts && opts.quiet);   // surfaces/chat: no comet-to-centre, gentler dock
        const isSpace = atomNodes.some((n) => n.space === t && n.metadata && n.metadata.spaceAnchor)
                        || (window.omegaCatalog && window.omegaCatalog.spaceByName && window.omegaCatalog.spaceByName[t]);
        if (isSpace) {
          /* Space → its atoms come and ORBIT Omega like a galaxy disc. */
          const got = summonSpaceAsGalaxy(t);
          return got ? { kind: "space", target: got } : null;
        }
        /* Atom → it flies to screen-CENTRE (like a surface) so the UI can
           expand it into its detail card (roadmap #2). 6u in front, centred
           on the look axis; noOrbit so the comet keeps roaming. Resolve by
           LABEL or ID, so a click / event carrying either can summon it. */
        const idx = atomNodes.findIndex((n) => n.label === t || n.id === t);
        if (idx < 0) return null;
        releaseSatellites();
        /* Dock the atom in front, hold the camera steady on it. DRILL mode
           (pin/inspect) docks CLOSE (≈3× by perspective) and orbits the
           comet there for drama. QUIET mode (a surface/chat opening from its
           causing atom) does NOT pull the comet to centre (no looming blob)
           — but still docks the atom CLOSE so it is the FRONT-MOST item on
           screen: nothing (drifting atoms, the comet) sits in front of it to
           occlude it or bleed bloom over the forming surface. */
        camera.getWorldDirection(_camDir2);
        if (_camDir2.lengthSq() < 1e-6) _camDir2.set(0, 0, -1); else _camDir2.normalize();
        _summonDock.copy(_camDir2).multiplyScalar(quiet ? 1.45 : 1.1);
        summonAtomIdx = idx;
        summonReveal = 1;
        summonQuiet = quiet;
        gOwner[idx] = "summon:" + atomNodes[idx].id;
        gEase[idx] = 1;
        gatherSpace = "summon:" + atomNodes[idx].id;
        focusTarget = _camDir2.clone().multiplyScalar(20);   // camera holds forward, steady
        if (quiet) {
          /* Park Omega FAR + off to the side so she's not behind / orbiting
             the surface. (updateSummonAtom keeps her there each frame.) */
          const _right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
          _summonPark.copy(_camDir2).multiplyScalar(13)
            .addScaledVector(_right, 11).addScaledVector(new THREE.Vector3(0, 1, 0), 3);
          if (liquidMetal && liquidMetal.setFocus) liquidMetal.setFocus(_summonPark, 4.0);
        } else {
          if (liquidMetal && liquidMetal.setFocus) liquidMetal.setFocus(_summonDock, 0.5);
        }
        return { kind: "atom", target: atomNodes[idx].label };
      },
      /* End a summon (e.g. its card closed): let the atom float off and
         release the camera + comet so the view re-finds Omega and follows
         her again (smoothly, via the rig's ease) instead of staying frozen
         on the summon dock. No-op if nothing is summoned. */
      endSummon() {
        if (summonAtomIdx < 0 && !gatherSpace) return;
        if (summonAtomIdx >= 0) {
          if (chamberAtomFloating) chamberAtomFloating[summonAtomIdx] = 1;
          if (chamberAtomFloatAge) chamberAtomFloatAge[summonAtomIdx] = 0;
          gOwner[summonAtomIdx] = null;
          summonScaleDirtyIdx = summonAtomIdx;   // restore its heart/glow scale
          summonReveal = 1;
          summonAtomIdx = -1;
          summonQuiet = false;
        }
        if (gatherSpace && gatherSpace.indexOf("summon:") === 0) gatherSpace = null;
        focusTarget = null;                                   // camera eases back onto the comet
        if (liquidMetal && liquidMetal.clearFocus) liquidMetal.clearFocus(false);
      },
      setExposure(v) { exposureTarget = v; },
      /* Omega's mirror brightness (1.0 = true 1:1; §27k). */
      setCometReflect(v) {
        if (liquidMetal && liquidMetal.setReflectStrength) liquidMetal.setReflectStrength(v);
      },
      /* Palette — switch the family-colour preset (positions.js PALETTES)
         and RETINT the live field in place: every atom's base colour is
         recomputed through the same magicColorFor → setPeak → evenLuma
         pipeline rebuildAtoms uses, written to both the instanceColor
         buffer and chamberAtomBaseColors (which the per-frame proximity
         glow multiplies on top of). Matrices/physics untouched — pure
         colour, no rebuild. Continent edge tints refresh on next gather. */
      setPalette(name) {
        if (!window.omegaR3D.setPalette) return;
        window.omegaR3D.setPalette(name);
        if (!atoms || !atomNodes || !chamberAtomBaseColors) return;
        const c = new THREE.Color();
        for (let i = 0; i < atomNodes.length; i++) {
          const n = atomNodes[i];
          c.setHex(colorFor(n.family));   // §32a — flat forge colour, no jitter/luma pipeline
          atoms.setColorAt(i, c);
          chamberAtomBaseColors[i * 3 + 0] = c.r;
          chamberAtomBaseColors[i * 3 + 1] = c.g;
          chamberAtomBaseColors[i * 3 + 2] = c.b;
        }
        if (atoms.instanceColor) atoms.instanceColor.needsUpdate = true;
        /* §40 — the halos share the base-colour buffer; flag the refresh. */
        if (atomHalos) atomHalos.geometry.attributes.color.needsUpdate = true;
      },
      /* Space (void) colour. Rather than the clear colour (which strobes
         with the every-other-frame reflection pass), the void is a large
         inward-facing BACKGROUND SPHERE (r=100, inside the 200 far plane,
         behind the ~40u atom field) — plain geometry drawn identically every
         frame, so no flicker. Fog matches; a canvas CSS background backstops
         it; the clear colour stays transparent black (the black-void path). */
      setSpaceColor(c) {
        let bg = scene.userData._bgSphere;
        if (!c || c === "default") {
          scene.fog.color.set(0x000000);
          if (bg) bg.visible = false;
          renderer.domElement.style.background = "#04060c";   // §40 — the forge void
        } else {
          const col = new THREE.Color(c);
          scene.fog.color.copy(col);
          if (!bg) {
            const g = new THREE.SphereGeometry(100, 32, 16);
            const m = new THREE.MeshBasicMaterial({
              color: col, side: THREE.BackSide, fog: false,
              depthWrite: false, depthTest: false,
            });
            bg = new THREE.Mesh(g, m);
            bg.renderOrder = -1000;
            bg.frustumCulled = false;
            scene.userData._bgSphere = bg;
            scene.add(bg);
          }
          bg.material.color.copy(col);
          bg.visible = true;
          renderer.domElement.style.background = c;
        }
      },
      /* Drive the summoned atom's dissolve during the edge-morph (1 = full
         atom, 0 = gone). The App eases this from the AtomMorph progress so
         the real atom becomes the morphing shape. */
      setSummonReveal(v) { summonReveal = Math.max(0, Math.min(1, v)); },
    };
  }

  window.omegaR3D = window.omegaR3D || {};
  window.omegaR3D.createOmegaScene = createOmegaScene;
})();
