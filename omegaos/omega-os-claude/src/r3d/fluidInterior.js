/* src/r3d/fluidInterior.js — §33: the INNER FLUID (the "iog.io GPU
   fluid" look, caged inside Omega's sphere).

   A classic GPU stable-fluids simulation (Stam / the well-known WebGL
   fluid family): half-float ping-pong targets, per frame —
     advect velocity → apply splats → divergence → Jacobi pressure
     solve → gradient subtract (projection) → advect dye.

   One twist makes it HERS: the domain is a DISC — the camera-facing
   cross-section of her ball — and the disc's rim is a solid WALL (the
   inside of the sphere). The projection pass strips the outward
   velocity component approaching the rim, so a jet aimed at the wall
   SPLASHES: it piles up and spreads tangentially along the glass,
   exactly like ink thrown at the inside of a sphere.

   mirrorBall.js drives it (jet toward her heading, slosh on turns,
   dye in her energy-mode hue) and composites the dye texture as the
   ball's luminous interior, under the analytic mirror.

   API: createFluidInterior(renderer[, opts]) →
     { get texture, splat(x,y,vx,vy,r,g,b,velRad,dyeRad), update(dt), dispose }
   Positions in UV [0,1] (disc centre 0.5,0.5 · rim at radius 0.5);
   velocities in UV units/second. */

(function () {
  function createFluidInterior(renderer, opts) {
    const THREE = window.THREE;
    if (!THREE || !renderer) return null;
    const o = opts || {};
    const SIM_RES = o.simRes || 144;
    const DYE_RES = o.dyeRes || 320;
    const PRESSURE_ITERS = o.pressureIters || 16;   // §34 — 22→16: visually identical, ~27% off the sim cost
    const VEL_DISS = 1.1;    // /s — velocity drag (snappy, darty fluid)
    const DYE_DISS = 0.75;   // /s — dye fades over ~1.5–3s

    function makeRT(res) {
      return new THREE.WebGLRenderTarget(res, res, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
      });
    }
    const vel = [makeRT(SIM_RES), makeRT(SIM_RES)];
    const pre = [makeRT(SIM_RES), makeRT(SIM_RES)];
    const div = makeRT(SIM_RES);
    const dye = [makeRT(DYE_RES), makeRT(DYE_RES)];
    let vi = 0, pi = 0, di = 0;

    /* ── fullscreen blit rig ─────────────────────────────────── */
    const quadScene = new THREE.Scene();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    quad.frustumCulled = false;
    quadScene.add(quad);
    function blit(target, material) {
      quad.material = material;
      renderer.setRenderTarget(target);
      renderer.render(quadScene, quadCam);
    }

    const VERT = /* glsl */`
      out vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `;
    function pass(frag, uniforms) {
      return new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: frag, uniforms,
        glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
      });
    }

    const advectMat = pass(/* glsl */`
      precision highp float;
      in vec2 vUv; out vec4 outColor;
      uniform sampler2D uVel; uniform sampler2D uSrc;
      uniform float uDt; uniform float uDiss;
      void main() {
        vec2 coord = vUv - uDt * texture(uVel, vUv).xy;
        outColor = texture(uSrc, coord) * uDiss;
      }
    `, {
      uVel: { value: null }, uSrc: { value: null },
      uDt: { value: 0 }, uDiss: { value: 1 },
    });

    const splatMat = pass(/* glsl */`
      precision highp float;
      in vec2 vUv; out vec4 outColor;
      uniform sampler2D uSrc; uniform vec2 uPoint;
      uniform vec3 uValue; uniform float uRadius;
      void main() {
        vec4 base = texture(uSrc, vUv);
        vec2 d = vUv - uPoint;
        float a = exp(-dot(d, d) / uRadius);
        outColor = vec4(base.xyz + uValue * a, 1.0);
      }
    `, {
      uSrc: { value: null }, uPoint: { value: new THREE.Vector2(0.5, 0.5) },
      uValue: { value: new THREE.Vector3() }, uRadius: { value: 0.004 },
    });

    const divMat = pass(/* glsl */`
      precision highp float;
      in vec2 vUv; out vec4 outColor;
      uniform sampler2D uVel; uniform vec2 uTexel;
      void main() {
        float L = texture(uVel, vUv - vec2(uTexel.x, 0.0)).x;
        float R = texture(uVel, vUv + vec2(uTexel.x, 0.0)).x;
        float B = texture(uVel, vUv - vec2(0.0, uTexel.y)).y;
        float T = texture(uVel, vUv + vec2(0.0, uTexel.y)).y;
        outColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
      }
    `, {
      uVel: { value: null }, uTexel: { value: new THREE.Vector2(1 / SIM_RES, 1 / SIM_RES) },
    });

    const preMat = pass(/* glsl */`
      precision highp float;
      in vec2 vUv; out vec4 outColor;
      uniform sampler2D uPre; uniform sampler2D uDiv; uniform vec2 uTexel;
      void main() {
        float L = texture(uPre, vUv - vec2(uTexel.x, 0.0)).x;
        float R = texture(uPre, vUv + vec2(uTexel.x, 0.0)).x;
        float B = texture(uPre, vUv - vec2(0.0, uTexel.y)).x;
        float T = texture(uPre, vUv + vec2(0.0, uTexel.y)).x;
        float dv = texture(uDiv, vUv).x;
        outColor = vec4((L + R + B + T - dv) * 0.25, 0.0, 0.0, 1.0);
      }
    `, {
      uPre: { value: null }, uDiv: { value: null },
      uTexel: { value: new THREE.Vector2(1 / SIM_RES, 1 / SIM_RES) },
    });

    /* projection + THE WALL: gradient subtract, then strip the outward
       velocity component approaching the rim (the inside of her glass)
       so jets SPLASH and slide along it; hard zero at/past the rim. */
    const gradMat = pass(/* glsl */`
      precision highp float;
      in vec2 vUv; out vec4 outColor;
      uniform sampler2D uPre; uniform sampler2D uVel; uniform vec2 uTexel;
      void main() {
        float L = texture(uPre, vUv - vec2(uTexel.x, 0.0)).x;
        float R = texture(uPre, vUv + vec2(uTexel.x, 0.0)).x;
        float B = texture(uPre, vUv - vec2(0.0, uTexel.y)).x;
        float T = texture(uPre, vUv + vec2(0.0, uTexel.y)).x;
        vec2 v = texture(uVel, vUv).xy - 0.5 * vec2(R - L, T - B);
        vec2 d = vUv - 0.5;
        float r = length(d) * 2.0;
        if (r > 0.84) {
          vec2 nrm = d / max(length(d), 1e-5);
          float vn = dot(v, nrm);
          if (vn > 0.0) v -= nrm * vn * smoothstep(0.84, 0.97, r);
        }
        v *= 1.0 - smoothstep(0.985, 1.0, r);
        outColor = vec4(v, 0.0, 1.0);
      }
    `, {
      uPre: { value: null }, uVel: { value: null },
      uTexel: { value: new THREE.Vector2(1 / SIM_RES, 1 / SIM_RES) },
    });

    /* initial clear — render targets must start at exact zero */
    {
      const prevRT = renderer.getRenderTarget();
      [vel[0], vel[1], pre[0], pre[1], div, dye[0], dye[1]].forEach((rt) => {
        renderer.setRenderTarget(rt);
        renderer.clear(true, false, false);
      });
      renderer.setRenderTarget(prevRT);
    }

    /* ── splat queue ─────────────────────────────────────────── */
    const queue = [];
    function splat(x, y, vx, vy, r, g, b, velRad, dyeRad) {
      queue.push([x, y, vx, vy, r, g, b, velRad || 0.004, dyeRad || 0.0025]);
    }

    function update(dt) {
      const prevRT = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      renderer.autoClear = false;

      /* advect velocity */
      advectMat.uniforms.uVel.value = vel[vi].texture;
      advectMat.uniforms.uSrc.value = vel[vi].texture;
      advectMat.uniforms.uDt.value = dt;
      advectMat.uniforms.uDiss.value = Math.exp(-VEL_DISS * dt);
      blit(vel[1 - vi], advectMat);
      vi = 1 - vi;

      /* splats */
      for (let k = 0; k < queue.length; k++) {
        const s = queue[k];
        if (s[2] !== 0 || s[3] !== 0) {
          splatMat.uniforms.uSrc.value = vel[vi].texture;
          splatMat.uniforms.uPoint.value.set(s[0], s[1]);
          splatMat.uniforms.uValue.value.set(s[2], s[3], 0);
          splatMat.uniforms.uRadius.value = s[7];
          blit(vel[1 - vi], splatMat);
          vi = 1 - vi;
        }
        if (s[4] !== 0 || s[5] !== 0 || s[6] !== 0) {
          splatMat.uniforms.uSrc.value = dye[di].texture;
          splatMat.uniforms.uPoint.value.set(s[0], s[1]);
          splatMat.uniforms.uValue.value.set(s[4], s[5], s[6]);
          splatMat.uniforms.uRadius.value = s[8];
          blit(dye[1 - di], splatMat);
          di = 1 - di;
        }
      }
      queue.length = 0;

      /* projection: divergence → pressure → gradient subtract + wall */
      divMat.uniforms.uVel.value = vel[vi].texture;
      blit(div, divMat);
      for (let it = 0; it < PRESSURE_ITERS; it++) {
        preMat.uniforms.uPre.value = pre[pi].texture;
        preMat.uniforms.uDiv.value = div.texture;
        blit(pre[1 - pi], preMat);
        pi = 1 - pi;
      }
      gradMat.uniforms.uPre.value = pre[pi].texture;
      gradMat.uniforms.uVel.value = vel[vi].texture;
      blit(vel[1 - vi], gradMat);
      vi = 1 - vi;

      /* advect dye */
      advectMat.uniforms.uVel.value = vel[vi].texture;
      advectMat.uniforms.uSrc.value = dye[di].texture;
      advectMat.uniforms.uDt.value = dt;
      advectMat.uniforms.uDiss.value = Math.exp(-DYE_DISS * dt);
      blit(dye[1 - di], advectMat);
      di = 1 - di;

      renderer.setRenderTarget(prevRT);
      renderer.autoClear = prevAuto;
    }

    return {
      get texture() { return dye[di].texture; },
      splat,
      update,
      dispose() {
        [vel[0], vel[1], pre[0], pre[1], div, dye[0], dye[1]].forEach((rt) => rt.dispose());
        [advectMat, splatMat, divMat, preMat, gradMat].forEach((m) => m.dispose());
        quad.geometry.dispose();
      },
    };
  }

  window.omegaR3D = window.omegaR3D || {};
  window.omegaR3D.createFluidInterior = createFluidInterior;
})();
