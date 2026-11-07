// GLSL for the branching-universes scene. Original shaders written for this app.

export const TRAIL_LENGTH = 24
/** Pointer stamps the finishing pass uses for its lingering screen-space ripple. */
export const WAKE_STAMPS = 10

/**
 * Shared particle lens model. A point's sharp footprint grows into a bokeh disc the further it
 * sits from the focal distance; its brightness is spread over the larger disc so blurred
 * particles keep the same total light instead of flaring.
 */
const lens = /* glsl */ `
  uniform float uFocus;      // metres from the camera that are in focus
  uniform float uAperture;   // lens radius (world units, exaggerated for effect)
  uniform float uMaxBlur;    // largest disc, in css pixels
  varying float vBlur;       // 0 = sharp point, 1 = full bokeh disc
  varying float vEnergy;     // brightness left after spreading the light over the disc

  float lensSize(float baseSize, float dist) {
    float px = baseSize * uPixelRatio * uSizeScale / max(dist, 0.05);
    float defocus = 1.0 / max(dist, 0.05) - 1.0 / uFocus;
    // The far side blurs much less than the near side, like a real wide lens focused close.
    defocus *= defocus < 0.0 ? 0.35 : 1.0;
    float coc = min(abs(defocus) * uAperture * uSizeScale * uPixelRatio, uMaxBlur * uPixelRatio);
    float size = max(sqrt(px * px + coc * coc), 1.25 * uPixelRatio);
    vBlur = clamp(coc / size, 0.0, 1.0);
    // Light conservation, with a gentle lift so discs read as luminous rather than faint.
    vEnergy = clamp(px * px / (size * size), 0.0, 1.0);
    vEnergy = mix(vEnergy, pow(vEnergy, 0.72), vBlur);
    return size;
  }
`

/** Sprite shape: a soft-cored point when sharp, a flat glassy disc with a lit rim when blurred. */
const sprite = /* glsl */ `
  varying float vBlur;
  varying float vEnergy;
  float spriteShape(vec2 pc, out float inside) {
    vec2 q = pc * 2.0 - 1.0;
    float r = length(q);
    inside = step(r, 1.0);
    float sharp = exp(-r * r * 5.5);
    float disc = smoothstep(1.0, 0.82, r) * (0.62 + 0.38 * smoothstep(0.45, 0.93, r));
    // a faint glass-bead highlight toward the upper left
    disc += exp(-dot(q - vec2(-0.32, 0.36), q - vec2(-0.32, 0.36)) * 9.0) * 0.35;
    // a disc covers ~3.4x the area of the soft core, so even out their total light
    return mix(sharp, disc * 0.3, smoothstep(0.15, 0.75, vBlur));
  }
`

/** Shared by every particle field: idle motion per world, pointer wake, click pulse, Q-Day shock. */
export const fieldVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uMode;
  // 0 meadow · 1 RSA collapse · 2 hybrid lattice · 3 unsigned fog · 4 fireflies · 5 aurora
  // 6 orbiting sphere · 7 Q-Day ring · 8 rising motes · 9 flowers · 10 light pillars
  uniform vec4 uTrail[${TRAIL_LENGTH}]; // x, z, age (s), strength
  uniform vec4 uShock;            // x, z, start time, amplitude
  uniform vec4 uPulse;            // click pulse: x, z, start time, amplitude
  uniform vec3 uCenter;           // pivot for ring / sphere modes
  uniform float uOpacity;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vDist;
  varying float vTwinkle;
  varying float vFade;
  ${lens}

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    vec3 p = position;
    float t = uTime;
    vTwinkle = 1.0;
    vFade = 1.0;

    if (uMode < 0.5) {
      // Wind combs the meadow in long slow waves; tall grains sway more.
      float lift = fract(aSeed * 17.31);
      float gust = sin(p.x * 0.11 + p.z * 0.07 - t * 0.9) * 0.5 + 0.5;
      p.x += sin(t * 1.3 + p.z * 0.4 + aSeed * 3.0) * 0.05 * lift * (0.4 + gust);
      p.y += sin(t * 0.7 + aSeed * 6.2831) * 0.03;
      vTwinkle = 0.7 + 0.3 * sin(t * (0.6 + aSeed) + aSeed * 40.0) + gust * 0.15;
    } else if (uMode < 1.5) {
      float shard = step(0.975, fract(aSeed * 91.37));
      float life = fract(aSeed * 13.7 + t * 0.045);
      p.y += shard * life * 9.0;
      p.x += shard * sin(t * 0.8 + aSeed * 20.0) * 0.6;
      float band = floor(p.y * 1.6 + t * 2.5);
      float tear = step(0.94, hash(band * 12.9898 + floor(t * 7.0) * 78.233));
      p.x += tear * (fract(aSeed * 7.13) - 0.5) * 2.4;
      vTwinkle = mix(0.65, 1.25, step(0.5, hash(aSeed * 31.0 + floor(t * 12.0))));
    } else if (uMode < 2.5) {
      // Proof holds: an ordered lattice, breathing, with slow verification waves sweeping outward.
      p.y += sin(p.x * 0.16 + t * 0.45) * 0.12 + cos(p.z * 0.13 - t * 0.35) * 0.12;
      float r = length(p.xz - vec2(0.0, -2.0));
      float wave = pow(0.5 + 0.5 * sin(r * 0.32 - t * 1.1), 10.0);
      float lane = pow(abs(sin(p.x * 0.5)), 30.0) * 0.4;
      vTwinkle = 0.55 + wave * 1.6 + lane;
    } else if (uMode < 3.5) {
      p.x += sin(t * 0.17 + aSeed * 30.0) * 0.9;
      p.y += sin(t * 0.23 + aSeed * 11.0) * 0.4;
      p.z += cos(t * 0.13 + aSeed * 17.0) * 0.9;
      vTwinkle = 0.8;
    } else if (uMode < 4.5) {
      // Fireflies: lazy wandering loops, blinking on and off.
      float s = aSeed * 61.0;
      p += vec3(sin(t * 0.31 + s), sin(t * 0.47 + s * 1.7) * 0.5, cos(t * 0.27 + s * 2.3)) * 1.6;
      float blink = smoothstep(0.55, 0.95, sin(t * (0.7 + aSeed * 0.9) + s));
      vTwinkle = 0.08 + blink * 1.4;
    } else if (uMode < 5.5) {
      // Aurora curtains: folds travel along the ribbon and the light flickers in vertical rays.
      p.z += sin(p.x * 0.07 + t * 0.12) * 2.5;
      p.x += sin(p.y * 0.2 + t * 0.3 + p.x * 0.02) * 0.6;
      float rays = 0.5 + 0.5 * sin(p.x * 1.7 + t * 0.6 + sin(p.x * 0.3 - t * 0.4) * 3.0);
      vTwinkle = 0.35 + rays * rays * 1.1;
    } else if (uMode < 6.5) {
      // A slowly turning sphere of points about uCenter.
      vec3 d = p - uCenter;
      float a = t * 0.025;
      float c = cos(a), s = sin(a);
      d.xz = mat2(c, -s, s, c) * d.xz;
      p = uCenter + d;
      vTwinkle = 0.8 + 0.2 * sin(t * 0.8 + aSeed * 30.0);
    } else if (uMode < 7.5) {
      // The Q-Day ring: interference fringes chase round it; once crossed it shatters outward.
      vec3 d = p - uCenter;
      float ang = atan(d.y, d.x);
      float fringe = 0.5 + 0.5 * cos(ang * 18.0 - t * 1.6 + length(d) * 2.0);
      float broken = clamp((0.55 - uOpacity) / 0.4, 0.0, 1.0);
      vec3 out_ = normalize(d + vec3(0.0, 0.0, (aSeed - 0.5) * 6.0)) * (6.0 + aSeed * 22.0);
      out_.y += aSeed * 3.0 - 5.0 * broken * fract(aSeed * 7.0);
      p += out_ * broken * broken + vec3(sin(t * 0.3 + aSeed * 40.0), cos(t * 0.21 + aSeed * 30.0), 0.0) * 0.6 * broken;
      vTwinkle = (0.35 + fringe * fringe * 1.7) * mix(1.0, 0.45, broken);
    } else if (uMode < 8.5) {
      // Motes rising slowly, fading in and out over their climb.
      float life = fract(t * (0.025 + aSeed * 0.03) + aSeed * 9.0);
      p.y += life * 9.0;
      p.x += sin(t * 0.4 + aSeed * 20.0) * 0.5;
      vFade = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.7, 1.0, life));
      vTwinkle = 0.8 + 0.4 * sin(t * 2.0 + aSeed * 50.0);
    } else if (uMode < 9.5) {
      // Flowers: blossoms nod in the wind and glow on a slow breath.
      float head = step(0.5, fract(aSeed * 3.0 + 0.5) );
      p.x += sin(t * 1.1 + p.z * 0.3 + aSeed) * 0.04;
      vTwinkle = 0.8 + 0.35 * sin(t * 0.9 + p.x * 0.7 + p.z * 0.5) * head;
    } else {
      // Pillars of light: a quiet pulse climbs each column.
      float climb = fract(t * 0.18 + uCenter.x * 0.0 + p.z * 0.013);
      float h = fract(p.y * 0.2);
      vTwinkle = 0.6 + 1.2 * exp(-pow((h - climb) * 9.0, 2.0));
    }

    // Pointer wake: particles part around the cursor and settle back.
    for (int i = 0; i < ${TRAIL_LENGTH}; i++) {
      vec4 tr = uTrail[i];
      if (tr.w > 0.0) {
        vec2 d = p.xz - tr.xy;
        float r2 = dot(d, d);
        float fall = exp(-r2 / 5.0) * exp(-tr.z * 1.4) * tr.w;
        vec2 dir = d * inversesqrt(max(r2, 1e-4));
        p.xz += dir * fall * 0.9;
        p.y += fall * 0.7;
        vTwinkle += fall * 0.6;
      }
    }

    // Click pulse: a ring of light runs out across the ground.
    if (uPulse.w > 0.0) {
      float age = t - uPulse.z;
      float front = (length(p.xz - uPulse.xy) - age * 11.0) / 1.4;
      float ring = exp(-front * front) * exp(-age * 0.9) * uPulse.w;
      p.y += ring * 0.5;
      vTwinkle += ring * 2.5;
    }

    // Q-Day shock ring.
    if (uShock.w > 0.0) {
      float age = t - uShock.z;
      float r = length(p.xz - uShock.xy);
      float front = (r - age * 24.0) / 3.0;
      float ring = exp(-front * front) * exp(-age * 0.55) * uShock.w;
      p.y += ring * 2.6;
      vTwinkle += ring * 2.0;
    }

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vDist = -mv.z;
    gl_PointSize = lensSize(aSize, vDist);
    vColor = aColor;
  }
`

export const fieldFragment = /* glsl */ `
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uOpacity;
  uniform float uMode;
  uniform vec3 uFogColor;
  varying vec3 vColor;
  varying float vDist;
  varying float vTwinkle;
  varying float vFade;
  ${sprite}

  void main() {
    float inside;
    float shape = spriteShape(gl_PointCoord, inside);
    if (inside < 0.5) discard;
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    float near = smoothstep(0.15, 1.1, vDist);
    float op = (uMode > 6.5 && uMode < 7.5) ? 1.0 : uOpacity;
    float a = shape * vEnergy * (1.0 - fog * fog) * near * op * vFade;
    // distant grains take on the colour of the air
    vec3 col = mix(vColor * vTwinkle, uFogColor, fog * 0.7);
    gl_FragColor = vec4(col, a);
  }
`

/** The glowing timeline: a stream of light that flows toward the future. */
export const pathVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform vec3 uTintA;
  uniform vec3 uTintB;
  uniform vec3 uTintC;
  uniform vec3 uBranchGain;
  uniform vec4 uShock;
  uniform vec4 uPulse;
  attribute float aT;
  attribute float aBranch;
  attribute float aSeed;
  attribute float aSize;
  attribute float aKind;          // 0 core stream, 1 ground spill, 2 rising spark
  varying vec3 vColor;
  varying float vDist;
  varying float vFade;
  ${lens}

  void main() {
    vec3 p = position;
    float t = uTime;
    vFade = 1.0;
    // Pulses of light travel along the stream toward the future.
    float wave = 0.5 + 0.5 * sin(aT * 150.0 - t * 2.4 + sin(aT * 23.0) * 1.5);
    float flow = 0.35 + 0.65 * pow(wave, 3.0);
    float glint = step(0.985, fract(sin(aSeed * 91.7 + floor(t * 6.0 + aSeed * 13.0)) * 4375.85));
    p.y += sin(t * 1.4 + aSeed * 20.0) * 0.015;
    if (aKind > 1.5) {
      float life = fract(t * (0.12 + aSeed * 0.15) + aSeed * 7.0);
      p.y += life * 2.4;
      p.x += sin(t * 0.9 + aSeed * 30.0) * 0.25 * life;
      p.z += cos(t * 0.8 + aSeed * 20.0) * 0.25 * life;
      vFade = smoothstep(0.0, 0.1, life) * (1.0 - life);
      flow = 1.2;
    } else if (aKind > 0.5) {
      flow = 0.35 + 0.3 * wave;
    }
    vec3 white = vec3(1.0, 0.94, 0.84);
    vec3 tint = white;
    float gain = 1.0;
    if (aBranch > 0.5 && aBranch < 1.5) { tint = uTintA; gain = uBranchGain.x; }
    else if (aBranch > 1.5 && aBranch < 2.5) { tint = uTintB; gain = uBranchGain.y; }
    else if (aBranch > 2.5) { tint = uTintC; gain = uBranchGain.z; }
    float k = aBranch > 0.5 ? smoothstep(0.05, 0.85, aT) : 0.0;
    vec3 base = mix(white, tint, k);
    if (aKind > 0.5 && aKind < 1.5) base = mix(base, vec3(0.45, 0.6, 1.0), 0.35 * (1.0 - k));
    vColor = base * (flow + glint * 2.5) * gain * 0.75;

    if (uShock.w > 0.0) {
      float age = t - uShock.z;
      float front = (length(p.xz - uShock.xy) - age * 24.0) / 2.0;
      vColor += exp(-front * front) * exp(-age * 0.6) * uShock.w * 1.5;
    }
    if (uPulse.w > 0.0) {
      float age = t - uPulse.z;
      float front = (length(p.xz - uPulse.xy) - age * 11.0) / 1.2;
      vColor += exp(-front * front) * exp(-age * 0.9) * uPulse.w * vec3(0.8, 0.9, 1.0);
    }

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vDist = -mv.z;
    gl_PointSize = lensSize(aSize, vDist);
  }
`

export const pathFragment = /* glsl */ `
  uniform float uFogFar;
  varying vec3 vColor;
  varying float vDist;
  varying float vFade;
  ${sprite}
  void main() {
    float inside;
    float shape = spriteShape(gl_PointCoord, inside);
    if (inside < 0.5) discard;
    float a = shape * vEnergy * vFade * (1.0 - smoothstep(uFogFar * 0.35, uFogFar, vDist)) * smoothstep(0.1, 0.9, vDist);
    gl_FragColor = vec4(vColor, a);
  }
`

/** Sky dome: gradient, horizon glow, a star band, mountain ridges and a lit celestial body. */
export const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`

export const skyFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uGlow;          // warm/cool light pooled on the horizon
  uniform vec3 uBand;          // colour of the galactic band (black = none)
  uniform vec3 uRidgeNear;
  uniform vec3 uRidgeFar;
  uniform float uRidgeHeight;  // 0 = no mountains
  uniform float uRidgeSeed;
  uniform vec3 uMoonDir;
  uniform vec3 uMoonColor;
  uniform float uMoonSize;     // angular radius (radians)
  uniform vec3 uSunDir;        // light falling on the body, in world space
  uniform float uBodyKind;     // 0 cratered moon, 1 gas giant with lattice + rings
  uniform vec3 uRingColor;
  varying vec3 vDir;

  float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float n3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += n3(p) * a; p *= 2.07; a *= 0.5; } return s; }
  float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h31(vec3(i, uRidgeSeed, 1.0)), h31(vec3(i + 1.0, uRidgeSeed, 1.0)), f); }
  float ridge(float az, float scale, float sharp) {
    float s = 0.0, a = 0.5, f = scale;
    for (int i = 0; i < 5; i++) { float v = n1(az * f); s += mix(v, 1.0 - abs(v * 2.0 - 1.0), sharp) * a; f *= 2.1; a *= 0.48; }
    return s;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    float az = atan(dir.x, -dir.z);

    // Gradient with a glow pooled at the horizon, strongest under the moon.
    vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.6, h));
    float toMoon = max(dot(normalize(dir.xz), normalize(uMoonDir.xz)), 0.0);
    col += uGlow * exp(-max(h, 0.0) * 9.0) * (0.45 + 0.55 * pow(toMoon, 3.0));

    // A diffuse galactic band arcing over the sky.
    if (dot(uBand, uBand) > 0.0) {
      vec3 axis = normalize(vec3(0.35, 0.25, 0.9));
      float b = dot(dir, axis);
      float dust = fbm3(dir * 6.0 + 3.0);
      float lanes = smoothstep(0.35, 0.75, fbm3(dir * 13.0 - 5.0));
      float band = exp(-b * b * 26.0) * (0.35 + dust) * (1.0 - lanes * 0.6);
      col += uBand * band * smoothstep(0.0, 0.25, h);
    }

    // Celestial body: a real sphere with terminator, limb and atmosphere.
    vec3 md = normalize(uMoonDir);
    float ca = dot(dir, md);
    float ang = acos(clamp(ca, -1.0, 1.0));
    vec3 tu = normalize(cross(md, vec3(0.0, 1.0, 0.0)));
    vec3 tv = cross(tu, md);
    vec2 o = vec2(dot(dir, tu), dot(dir, tv)) / max(sin(uMoonSize), 1e-4);
    float rr = dot(o, o);
    float edge = fwidth(ang) * 1.5;
    float disc = 1.0 - smoothstep(uMoonSize - edge, uMoonSize, ang);
    vec3 nrm = normalize(o.x * tu + o.y * tv - md * sqrt(max(1.0 - rr, 0.0)));
    float lit = dot(nrm, normalize(uSunDir));
    vec3 body;
    if (uBodyKind < 0.5) {
      float maria = smoothstep(0.42, 0.68, fbm3(nrm * 3.2 + 7.0));
      float craters = fbm3(nrm * 14.0);
      vec3 surf = uMoonColor * (1.0 - maria * 0.35) * (0.82 + craters * 0.3);
      body = surf * smoothstep(-0.08, 0.25, lit) * (0.75 + 0.25 * sqrt(max(1.0 - rr, 0.0)));
      body += uMoonColor * 0.025; // earthshine
    } else {
      float lat = asin(clamp(nrm.y, -1.0, 1.0));
      float bands = fbm3(vec3(lat * 9.0, lat * 2.0 + nrm.x * 0.6, nrm.z * 0.6));
      vec3 surf = uMoonColor * (0.55 + bands * 0.7);
      float day = smoothstep(-0.05, 0.35, lit);
      // the night side carries a faint glowing lattice
      float lon = atan(nrm.x, nrm.z);
      vec2 g = abs(fract(vec2(lon * 3.8197, lat * 3.8197 * 1.6)) - 0.5);
      float grid = smoothstep(0.035, 0.0, min(g.x, g.y)) * (1.0 - day);
      body = surf * day + uRingColor * grid * 0.5 * sqrt(max(1.0 - rr, 0.0));
      body += uRingColor * pow(1.0 - sqrt(max(1.0 - rr, 0.0)), 3.0) * 0.6; // atmosphere rim
    }
    col = mix(col, body, disc);
    // halo: tight glow + broad scatter + a faint 22-degree ring around the moon
    float outside = 1.0 - disc;
    col += uMoonColor * outside * (exp(-(ang - uMoonSize) * 40.0) * 0.35 + exp(-ang * 4.0) * 0.08);
    if (uBodyKind < 0.5) {
      float halo = exp(-pow((ang - 0.384) * 26.0, 2.0));
      col += uMoonColor * halo * 0.035;
    } else {
      // a thin tilted ring system
      vec3 rn = normalize(vec3(0.15, 1.0, 0.35));
      vec3 rel = dir - md * ca;
      float side = dot(rel, rn) / max(sin(uMoonSize), 1e-4);
      float rad = length(rel) / max(sin(uMoonSize), 1e-4);
      float ring = exp(-side * side * 900.0) * smoothstep(1.25, 1.4, rad) * (1.0 - smoothstep(2.1, 2.3, rad));
      float behind = step(0.0, dot(rel, tv)) ;
      ring *= mix(1.0, 1.0 - disc, behind) * (0.6 + 0.4 * sin(rad * 40.0));
      col += uRingColor * ring * 0.55;
    }

    // Mountain silhouettes: a far hazy range and a nearer dark one.
    if (uRidgeHeight > 0.0) {
      float far = 0.004 + ridge(az * 1.6 + 2.0, 1.7, 0.6) * uRidgeHeight * 0.75;
      float nearR = -0.004 + ridge(az * 1.1 - 4.0, 1.3, 0.85) * uRidgeHeight;
      float af = fwidth(h) * 1.2;
      float mFar = 1.0 - smoothstep(far - af, far + af, h);
      float mNear = 1.0 - smoothstep(nearR - af, nearR + af, h);
      vec3 hazeF = mix(uRidgeFar, uHorizon, 0.4) + uGlow * 0.4 * pow(toMoon, 3.0);
      col = mix(col, hazeF + uGlow * 0.6 * exp(-(far - h) * 60.0) * 0.5, mFar);
      col = mix(col, uRidgeNear + uGlow * 0.25 * exp(-(nearR - h) * 80.0), mNear);
    }

    col = mix(uGround, col, smoothstep(-0.14, -0.005, h));
    gl_FragColor = vec4(col, 1.0);
  }
`

/** Stars: varied colour and brightness; the brightest get a faint diffraction cross. */
export const starVertex = /* glsl */ `
  uniform float uTime; uniform float uPixelRatio;
  attribute float aSeed; attribute vec3 aColor;
  varying float vA; varying float vBig; varying vec3 vC;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position + cameraPosition, 1.0);
    gl_Position = projectionMatrix * mv;
    float bright = pow(aSeed, 6.0);
    vBig = step(0.985, aSeed);
    vA = (0.25 + 0.75 * aSeed) * (0.75 + 0.25 * sin(uTime * (0.5 + aSeed * 2.0) + aSeed * 50.0));
    vC = aColor;
    gl_PointSize = (1.0 + bright * 2.5 + vBig * 9.0) * uPixelRatio;
  }
`

export const starFragment = /* glsl */ `
  uniform vec3 uTint; varying float vA; varying float vBig; varying vec3 vC;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r = length(q);
    if (r > 1.0) discard;
    float core = exp(-r * r * (vBig > 0.5 ? 40.0 : 5.0));
    float spikes = vBig * (exp(-abs(q.x) * 28.0) + exp(-abs(q.y) * 28.0)) * (1.0 - r) * 0.5;
    float a = (core + spikes) * vA;
    gl_FragColor = vec4(uTint * vC * (1.0 + vBig * 2.0), a);
  }
`

/** A window into another universe: samples that universe's render at screen position. */
export const portalVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const portalFragment = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec2 uRes;
  uniform float uOpen;
  uniform float uHover;
  uniform float uTime;
  uniform vec3 uTint;
  varying vec2 vUv;

  float hn(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hn(i), hn(i + vec2(1, 0)), f.x), mix(hn(i + vec2(0, 1)), hn(i + vec2(1, 1)), f.x), f.y); }

  void main() {
    // The opening starts as a hairline slit and eases wide, its edge shimmering like a heat haze.
    float open = smoothstep(0.0, 1.0, uOpen);
    float halfW = mix(0.006, 0.5, open);
    float wobble = (vn(vec2(vUv.y * 9.0, uTime * 0.8)) - 0.5) * 0.03 * open;
    float dx = abs(vUv.x - 0.5) - wobble;
    if (dx > halfW) discard;
    float edgeDist = (halfW - dx) / max(halfW, 1e-3);
    vec2 suv = gl_FragCoord.xy / uRes;
    // Light bends near the rim: the view through the door lenses slightly at its edges.
    float bend = exp(-edgeDist * 8.0);
    vec2 drift = vec2(vn(vUv * 6.0 + uTime * 0.3), vn(vUv * 6.0 - uTime * 0.27)) - 0.5;
    suv += (drift * 0.02 + vec2(sign(vUv.x - 0.5), 0.0) * -0.012) * bend;
    vec3 world = texture2D(uTex, suv).rgb;
    float rim = exp(-edgeDist * 26.0);
    float slit = 1.0 - smoothstep(0.0, 0.35, uOpen);
    vec3 col = world * (1.0 + 0.25 * uHover);
    col += mix(vec3(1.0), uTint, 0.4) * rim * (0.9 + 0.6 * uHover);
    col = mix(col, vec3(1.6, 1.55, 1.5), slit);
    // a faint inner veil of light near the floor of the opening
    col += uTint * exp(-vUv.y * 9.0) * 0.25;
    gl_FragColor = vec4(col, 1.0);
  }
`

/** Glow around a door: distance to the opening's border, additive. */
export const frameFragment = /* glsl */ `
  uniform float uOpen;
  uniform float uHover;
  uniform float uTime;
  uniform vec3 uTint;
  uniform vec2 uDoor;   // door half-size in this plane's uv units
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float open = smoothstep(0.0, 1.0, uOpen);
    vec2 halfDoor = vec2(mix(0.0025, uDoor.x, open), uDoor.y);
    vec2 q = abs(c) - halfDoor;
    float outside = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    if (outside < 0.0) discard;
    float line = exp(-outside * 420.0) * 1.4;
    float halo = exp(-outside * 22.0) * 0.16 + exp(-outside * 6.0) * 0.05;
    // light rays fanning up and out from the threshold
    float bottom = c.y + halfDoor.y;
    float spread = abs(c.x) / max(bottom * 0.9 + halfDoor.x, 1e-3);
    float rays = (0.5 + 0.5 * sin(atan(c.x, bottom + 0.02) * 40.0 + uTime * 0.5)) * exp(-spread * 1.8)
      * smoothstep(0.0, 0.02, bottom) * exp(-bottom * 3.0) * 0.08 * open;
    float pulse = 0.85 + 0.15 * sin(uTime * 1.3);
    vec3 col = mix(vec3(1.0), uTint, 0.45) * (line + halo * (0.7 + uHover) * pulse) + uTint * rays;
    float a = clamp(line + halo + rays, 0.0, 1.0);
    gl_FragColor = vec4(col, a);
  }
`

/** Light spilled from an open doorway onto the ground in front of it. */
export const spillFragment = /* glsl */ `
  uniform float uOpen;
  uniform float uHover;
  uniform vec3 uTint;
  varying vec2 vUv;
  void main() {
    vec2 c = (vUv - vec2(0.5, 1.0)) * vec2(1.0, 1.0);
    float fan = exp(-abs(c.x) / (0.12 + -c.y * 0.45) * 1.4) * exp(c.y * 3.2);
    float a = fan * 0.35 * smoothstep(0.0, 1.0, uOpen) * (0.8 + 0.4 * uHover);
    gl_FragColor = vec4(uTint, a);
  }
`

/** Sparks lifting off a doorway's frame. */
export const sparkVertex = /* glsl */ `
  uniform float uTime;
  uniform float uOpen;
  uniform float uScale;
  attribute float aSeed;
  varying float vA;
  void main() {
    vec3 p = position;
    float life = fract(uTime * (0.08 + aSeed * 0.12) + aSeed * 17.0);
    p.y += life * 3.5;
    p.x += sin(uTime * 0.7 + aSeed * 40.0) * 0.25 * life;
    p.z += cos(uTime * 0.6 + aSeed * 30.0) * 0.4 * life;
    vA = smoothstep(0.0, 0.1, life) * (1.0 - life) * smoothstep(0.2, 0.9, uOpen);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uScale * (0.6 + aSeed) / max(-mv.z, 0.5);
  }
`

export const sparkFragment = /* glsl */ `
  uniform vec3 uTint;
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float a = exp(-r * r * 6.0) * vA;
    gl_FragColor = vec4(mix(vec3(1.0), uTint, 0.5) * 1.5, a);
  }
`

/**
 * Finishing pass, after tone mapping: a lingering pointer ripple, crossing zoom blur,
 * lens dispersion at the edges, vignette, flash, grain and dither.
 */
export const finishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.75 },
    uGrain: { value: 0.035 },
    uFlash: { value: 0 },
    uFlashColor: { value: [1, 1, 1] },
    uAspect: { value: 1 },
    uZoom: { value: 0 },
    uWake: { value: [] as unknown[] },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform float uAspect;
    uniform float uZoom;
    uniform vec4 uWake[${WAKE_STAMPS}]; // screen uv xy, velocity xy (uv/s); strength baked into velocity
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      // The image is gently dragged along behind the pointer and slowly lets go.
      vec2 disp = vec2(0.0);
      for (int i = 0; i < ${WAKE_STAMPS}; i++) {
        vec4 w = uWake[i];
        vec2 d = (uv - w.xy) * vec2(uAspect, 1.0);
        float f = exp(-dot(d, d) * 90.0);
        vec2 sw = vec2(-d.y, d.x) * 0.6;
        disp -= (w.zw + sw * length(w.zw) * 4.0) * f;
      }
      uv += disp * 0.012;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      vec3 col;
      if (uZoom > 0.002) {
        // radial zoom blur while crossing a threshold
        col = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float k = 1.0 - uZoom * 0.06 * float(i);
          col += texture2D(tDiffuse, 0.5 + c * k).rgb;
        }
        col /= 8.0;
      } else {
        // dispersion grows toward the frame edges
        vec2 off = c * r2 * 0.012;
        col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      }
      col *= mix(1.0, smoothstep(0.95, 0.15, length(c * vec2(1.0, 1.15))), uVignette);
      col = mix(col, uFlashColor, uFlash);
      float g = rand(vUv * 1000.0 + fract(uTime * 7.13) * 61.0) - 0.5;
      // grain is strongest in the mid-tones, like film
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col += g * uGrain * (0.4 + 1.2 * lum * (1.0 - lum));
      col += (rand(vUv * 731.0 + 3.1) - 0.5) / 255.0;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}
