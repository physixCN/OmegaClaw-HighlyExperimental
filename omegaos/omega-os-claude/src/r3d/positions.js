/* src/r3d/positions.js — atom (surface, x%, y%) → point on the
   surface of the central sphere (Omega's body).

   Each of the chamber's five surfaces — back / floor / ceiling /
   left / right — is projected onto the sphere by computing where
   it WOULD sit in a chamber-shaped box (W,H,D below) and then
   normalizing that direction to the sphere's radius. Result:
     back   → back hemisphere
     floor  → bottom + lower-back
     ceiling→ top + upper-back
     left/right → corresponding sides
   The front of the sphere (toward the camera) has no source data
   and stays empty — we look at her surface across an open arc.

   The W/H/D values here are NOT room dimensions any more; they
   just shape how each surface stretches across its sphere region.
   Tweaking them re-weights how much of the sphere each surface
   occupies. */

(function () {
  /* Direction-shaping factors (formerly chamber width/height/depth). */
  const W = 7;
  const H = 4.5;
  const D = 14;

  /* Sphere radius — the SINGLE SOURCE OF TRUTH used by both the
     core sphere mesh and the atom shell. If you change this,
     change nothing else; the orb and the constellations stay in
     lockstep. */
  const SPHERE_R = 2.6;
  const ATOM_OFFSET = 0.04;       // atoms sit just above the surface

  function surfaceToWorld(surface, x, y) {
    const fx = x / 100;
    const fy = y / 100;
    let dx = 0, dy = 0, dz = 0;
    switch (surface) {
      case "back":
        dx = (fx - 0.5) * 2 * W;
        dy = -(fy - 0.5) * 2 * H;
        dz = -D;
        break;
      case "floor":
        dx = (fx - 0.5) * 2 * W;
        dy = -H;
        dz = -D * (1 - fy);
        break;
      case "ceiling":
        dx = (fx - 0.5) * 2 * W;
        dy = H;
        dz = -D * (1 - fy);
        break;
      case "left":
        dx = -W;
        dy = -(fy - 0.5) * 2 * H;
        dz = -D * (1 - fx);
        break;
      case "right":
        dx = W;
        dy = -(fy - 0.5) * 2 * H;
        dz = -D * (1 - fx);
        break;
      default:
        return { x: 0, y: 0, z: 0 };
    }
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const r = SPHERE_R + ATOM_OFFSET;
    /* Flip Z so the chamber's back hemisphere (where the data lives)
       faces the camera. The mechanical chamber→sphere projection
       preserved the chamber's open front-face as a bald cap on the
       viewer's side; negating z rotates the sphere 180° around the
       vertical axis so structure is visible to the user from the
       default camera. Left stays left, right stays right, floor
       stays bottom — only the dorsal/ventral axis flips. */
    return {
      x: (dx / len) * r,
      y: (dy / len) * r,
      z: -(dz / len) * r,
    };
  }

  /* ── Palettes ────────────────────────────────────────────────
     Four curated directions, live-switchable (Tweaks → Palette).
     Each preset carries its family colours AND the jitter envelope
     magicColorFor applies per atom — a wide hue jitter that suits a
     full-spectrum field would destroy a curated band, so the
     envelope is part of the palette, not a constant.

       spectrum  — the original DEMO-TV palette: fully saturated hues
                   at MAXIMUM wheel separation. Electric, loud.
       mineral   — muted jewel tones ("dusty"): every family keeps its
                   hue identity but chroma drops and luminance evens
                   out. Premium, calm, legible.
       aurora    — a curated analogous band (teal → blue → violet)
                   with GOLD reserved for action (skills/loop) and a
                   single warm rose for people. Harmonious, cinematic.
       starlight — near-monochrome silver; hue survives only as faint
                   temperature. The field reads as a real night sky;
                   colour is freed up to mean something (focus, glow,
                   energy mode). The most Apple of the four. */
  const PALETTES = {
    jewel: {
      hueJ: 0.04, sat: [0.92, 1.00], lum: [0.44, 0.56],
      colors: {
        space:     0x10C46A,   // emerald
        atom:      0x8A2BE2,   // amethyst
        skill:     0xFF5A2A,   // fire opal-garnet
        channel:   0xE91E8C,   // pink sapphire
        sense:     0x00E5FF,   // aquamarine
        memory:    0xFFC400,   // topaz
        belief:    0x00D9A0,   // emerald-teal
        predict:   0x7C4DFF,   // tanzanite violet
        attention: 0xFFE14D,   // citrine
        error:     0xFF1744,   // ruby
        person:    0xFF4F9A,   // rose sapphire
        device:    0x2979FF,   // sapphire
        room:      0x4CD964,   // peridot
        loop:      0xFF7A1A,   // fire opal
      },
      fallback: 0xE8C46A,
    },
    spectrum: {
      hueJ: 0.12, sat: [0.85, 1.00], lum: [0.42, 0.62],
      colors: {
        space:     0x00FF66,   // electric lime
        atom:      0x9B00FF,   // ultraviolet
        skill:     0xFF3300,   // hot red-orange
        channel:   0xFF00CC,   // neon magenta
        sense:     0x00DDFF,   // ice cyan
        memory:    0xFFCC00,   // rich gold
        belief:    0x00FFAA,   // electric teal
        predict:   0xAA00FF,   // deep violet
        attention: 0xFFFF00,   // electric yellow
        error:     0xFF0033,   // alarm red
        person:    0xFF4499,   // hot pink
        device:    0x0066FF,   // cobalt blue
        room:      0x33FF00,   // bright green
        loop:      0xFFAA00,   // neon orange
      },
      fallback: 0xE8D8A0,
    },
    mineral: {
      hueJ: 0.025, sat: [0.62, 0.82], lum: [0.44, 0.56],
      colors: {
        space:     0x5FB89A,   // jade
        atom:      0x9D87C9,   // amethyst
        skill:     0xC99577,   // copper
        channel:   0xBC7FAE,   // orchid
        sense:     0x7FAEC4,   // glacier
        memory:    0xC4AE7F,   // brass
        belief:    0x7FBCA8,   // celadon
        predict:   0x8F87C9,   // iris
        attention: 0xC9BC77,   // citrine
        error:     0xC47F7F,   // garnet
        person:    0xC98FA0,   // rose quartz
        device:    0x7F95C9,   // sapphire
        room:      0x8FBC7F,   // moss
        loop:      0xC9A077,   // amber
      },
      fallback: 0xBCB49A,
    },
    aurora: {
      hueJ: 0.03, sat: [0.88, 1.00], lum: [0.42, 0.54],
      colors: {
        space:     0x3DBFAE,   // teal
        atom:      0x8B7BF0,   // indigo
        skill:     0xE8B25A,   // gold — action
        channel:   0x4FD0D8,   // cyan
        sense:     0x5BBCE8,   // sky
        memory:    0x6B8BF0,   // blue
        belief:    0x55C8B0,   // sea green
        predict:   0xA47BE8,   // violet
        attention: 0xF0DC9A,   // pale gold
        error:     0xE87070,   // coral — the one true red
        person:    0xE890A8,   // rose
        device:    0x7BA0E8,   // steel blue
        room:      0x60BC9A,   // green-teal
        loop:      0xE8C175,   // amber — action
      },
      fallback: 0x9AB8D8,
    },
    starlight: {
      hueJ: 0.02, sat: [0.06, 0.22], lum: [0.68, 0.82],
      colors: {
        space:     0xC9D4E2,   // cool silver
        atom:      0xCDC8E2,   // lavender silver
        skill:     0xE2D2C3,   // warm silver
        channel:   0xDCC8D8,   // mauve silver
        sense:     0xC3D8E2,   // ice silver
        memory:    0xE2DAC3,   // gold silver
        belief:    0xC8E2D6,   // sea silver
        predict:   0xD0C8E2,   // violet silver
        attention: 0xEAE2C8,   // candle silver
        error:     0xE2C3C3,   // rose silver
        person:    0xE2CCD4,   // blush silver
        device:    0xC3CCE2,   // steel silver
        room:      0xCCE2CC,   // moss silver
        loop:      0xE2D6C3,   // amber silver
      },
      fallback: 0xD8DCE2,
    },
  };
  let activePalette = "spectrum";
  function setPalette(name) {
    if (PALETTES[name]) activePalette = name;
    return activePalette;
  }
  function colorFor(family) {
    const p = PALETTES[activePalette];
    return p.colors[family] != null ? p.colors[family] : p.fallback;
  }

  /* Deterministic per-atom hue/saturation/lightness shimmer derived
     from the atom's id. Within a family the hue holds its identity
     but every atom is a UNIQUE jewel — slight hue drift, saturation
     wobble, lightness bloom. The chamber stops feeling uniformly
     swatch-coloured and starts feeling like a sky of related but
     individual lights.

     Inputs: family name, atom id, optional THREE.Color to fill.
     Output: THREE.Color in linear-ish RGB ready to be HDR-boosted by
     the caller. */
  function magicColorFor(family, id, out) {
    const THREE = window.THREE;
    const baseHex = colorFor(family);
    const c = out || new THREE.Color();
    c.setHex(baseHex);
    /* Deterministic hash. */
    let h = 2166136261 >>> 0;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    /* Three independent jitter values in [-1, 1]. */
    const j1 = (((h        ) & 0xff) / 127.5) - 1;   // hue shift
    const j2 = ((((h >> 8 ) & 0xff)) / 127.5) - 1;   // saturation shift
    const j3 = ((((h >> 16) & 0xff)) / 127.5) - 1;   // lightness shift
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    /* Apply jitter inside the ACTIVE PALETTE's envelope. The hue
       jitter, saturation clamp, and lightness clamp are per-preset:
       spectrum keeps its wide electric wobble; the curated palettes
       use a tight hue jitter (a ±43° wobble would destroy a curated
       band) and their own chroma/luminance ranges. Lightness is kept
       below the HSL washout zone for saturated presets; starlight
       deliberately lives up there (silver wants to be pale). */
    const env = PALETTES[activePalette];
    let nh = (hsl.h + j1 * env.hueJ) % 1;
    if (nh < 0) nh += 1;
    const ns = Math.max(env.sat[0], Math.min(env.sat[1], hsl.s * (0.90 + j2 * 0.10)));
    const nl = Math.max(env.lum[0], Math.min(env.lum[1], hsl.l * (1.00 + j3 * 0.12)));
    c.setHSL(nh, ns, nl);
    return c;
  }

  /* Camera defaults — YOU ARE AT THE CENTRE OF THE CHAMBER.
     Camera at origin, looking forward into the void. Wider FOV
     gives the "immersed in vastness" feel real space-sim cameras
     use; the chamber radius is huge (layout.js: R_OUTER ≈ 40) so
     atoms 30+ units away naturally read as distant points. */
  const CAMERA_DEFAULT = {
    fov: 93.5,
    near: 0.5,
    far: 200,
    position: { x: 0, y: 0, z: 0 },
    target:   { x: 0, y: 0, z: -1 },
  };

  window.omegaR3D = window.omegaR3D || {};
  window.omegaR3D.surfaceToWorld = surfaceToWorld;
  window.omegaR3D.colorFor = colorFor;
  window.omegaR3D.magicColorFor = magicColorFor;
  window.omegaR3D.setPalette = setPalette;
  window.omegaR3D.getPalette = () => activePalette;
  window.omegaR3D.paletteNames = Object.keys(PALETTES);
  window.omegaR3D.room = { W, H, D };
  window.omegaR3D.sphereR = SPHERE_R;       // exposed for core.js + future modules
  window.omegaR3D.cameraDefault = CAMERA_DEFAULT;
})();
