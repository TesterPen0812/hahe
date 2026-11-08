export const PRISM_RING_TILT = 0.3

/** Include in fieldPlacement after its attribute/uniform declarations. */
export const prismHelpers = /* glsl */ `
  uniform float uPalette;          // 0: prism meadow; 1: Today's blues
  vec3 prismHash(vec3 p) {
    vec3 v = fract(p * vec3(0.1031, 0.1030, 0.0973));
    v += dot(v, v.yxz + 33.33);
    return fract((v.xxy + v.yxx) * v.zyx) * 2.0 - 1.0;
  }
  float prismNoise(vec3 p) {
    vec3 c = floor(p), f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(
      mix(mix(dot(prismHash(c), f), dot(prismHash(c + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
          mix(dot(prismHash(c + vec3(0,1,0)), f - vec3(0,1,0)), dot(prismHash(c + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
      mix(mix(dot(prismHash(c + vec3(0,0,1)), f - vec3(0,0,1)), dot(prismHash(c + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
          mix(dot(prismHash(c + vec3(0,1,1)), f - vec3(0,1,1)), dot(prismHash(c + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z) * 1.8;
  }
  vec3 prismPalette(float tone) {
    vec3 cyan = vec3(0.025, 0.76, 0.88), violet = vec3(0.44, 0.13, 0.91);
    vec3 rose = vec3(0.98, 0.23, 0.60), lemon = vec3(0.90, 0.85, 0.19);
    if (tone < 0.333333) return mix(cyan, violet, tone * 3.0);
    if (tone < 0.666667) return mix(violet, rose, tone * 3.0 - 1.0);
    return mix(rose, lemon, tone * 3.0 - 2.0);
  }
  // Today's meadow keeps its own family: navy, periwinkle, ice and a little violet.
  vec3 todayPalette(float tone) {
    vec3 navy = vec3(0.16, 0.26, 0.86), periwinkle = vec3(0.42, 0.52, 1.0);
    vec3 ice = vec3(0.74, 0.82, 1.0), violet = vec3(0.6, 0.42, 1.0);
    if (tone < 0.333333) return mix(navy, periwinkle, tone * 3.0);
    if (tone < 0.666667) return mix(periwinkle, ice, tone * 3.0 - 1.0);
    return mix(ice, violet, tone * 3.0 - 2.0);
  }
  vec3 meadowPalette(float tone) { return uPalette > 0.5 ? todayPalette(tone) : prismPalette(tone); }
  vec3 prismColor(vec3 base, float mode, vec4 hang, vec4 detail, float time) {
    if (mode < 15.5 || mode > 16.5) return base;
    float wave = sin(hang.x * 0.32 + hang.y * 0.21 + sin(hang.y * 0.09) * 2.0 - time * 0.35) * 0.5 + 0.5;
    float tone = clamp(wave * 1.1 - 0.05 + detail.z, 0.0, 1.0);
    vec3 tint = hang.w < 0.0 ? meadowPalette(0.15) : detail.w > 0.5 ? vec3(0.91, 0.96, 1.0) : meadowPalette(tone);
    return base * tint;
  }
`

/** Insert before the existing uMode > 12.5 cave branch. Expects p, velocity, t. */
export const prismPlacement = /* glsl */ `
    } else if (uMode > 15.5 && uMode < 16.5) {
      float breeze = prismNoise(vec3(aHang.x * 0.08 - t * 0.25, aHang.y * 0.08, 1.0)) * 0.6;
      float up = abs(aHang.w);
      vec3 sway = vec3(aHang.z * 0.25 * up * up, 0.0, aHang.z * 0.1 * up);
      p += sway * breeze;
      // Persistent state derives exact velocity from this and the previous target.
      vTwinkle = 0.75 + 0.25 * sin(t * aPrism.y + aPrism.x);
    } else if (uMode > 16.5 && uMode < 17.5) {
      if (aHang.w > 1.5) {
        // Sky grains remain at infinity relative to the current camera.
        p += uPointerFrom;
        vTwinkle = 0.7 + 0.3 * sin(t * aHang.x + aHang.y);
      } else if (aHang.w > 0.5) {
        float angle = aHang.x + t * 0.004;
        float ct = cos(${PRISM_RING_TILT}), st = sin(${PRISM_RING_TILT});
        vec3 ringPlane = vec3(cos(angle) * aHang.y, aHang.z, sin(angle) * aHang.y);
        p = aPrism.xyz + vec3(ringPlane.x, ringPlane.y * ct - ringPlane.z * st, ringPlane.y * st + ringPlane.z * ct);
        vec3 turn = vec3(-sin(angle), 0.0, cos(angle)) * aHang.y * 0.004;
        velocity = vec3(turn.x, -turn.z * st, turn.z * ct);
        vec3 sight = normalize(uPointerFrom - p);
        float along = dot(aPrism.xyz - p, sight);
        float closest = length(aPrism.xyz - p - sight * along);
        vFade = along > 0.0 && closest < aPrism.w ? 0.0 : 1.0;
      }
`
