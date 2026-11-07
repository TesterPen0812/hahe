// GLSL for the branching-universes scene. Original shaders written for this app.

export const TRAIL_LENGTH = 24

/** Shared by every particle field: idle motion per world, pointer wake, and the Q-Day shock ring. */
export const fieldVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uMode;            // 0 home meadow, 1 RSA collapse, 2 hybrid lattice, 3 unsigned fog
  uniform vec4 uTrail[${TRAIL_LENGTH}]; // x, z, age (s), strength
  uniform vec4 uShock;            // x, z, start time, amplitude
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vDist;
  varying float vTwinkle;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    vec3 p = position;
    float t = uTime;
    vTwinkle = 1.0;

    if (uMode < 0.5) {
      p.y += sin(t * 0.7 + aSeed * 6.2831) * 0.035;
      vTwinkle = 0.75 + 0.25 * sin(t * (0.6 + aSeed) + aSeed * 40.0);
    } else if (uMode < 1.5) {
      // The old lock has failed: shards lift off the ground and the image tears in bands.
      float shard = step(0.975, fract(aSeed * 91.37));
      float life = fract(aSeed * 13.7 + t * 0.045);
      p.y += shard * life * 9.0;
      p.x += shard * sin(t * 0.8 + aSeed * 20.0) * 0.6;
      float band = floor(p.y * 1.6 + t * 2.5);
      float tear = step(0.94, hash(band * 12.9898 + floor(t * 7.0) * 78.233));
      p.x += tear * (fract(aSeed * 7.13) - 0.5) * 2.4;
      vTwinkle = mix(0.65, 1.25, step(0.5, hash(aSeed * 31.0 + floor(t * 12.0))));
    } else if (uMode < 2.5) {
      // Proof holds: an ordered lattice breathing in slow waves.
      p.y += sin(p.x * 0.22 + t * 0.7) * 0.22 + cos(p.z * 0.19 - t * 0.55) * 0.22;
      vTwinkle = 0.85 + 0.15 * sin(p.x * 0.6 + p.z * 0.4 - t * 2.0);
    } else {
      // Nothing is provable: everything drifts in a grey haze.
      p.x += sin(t * 0.17 + aSeed * 30.0) * 0.9;
      p.y += sin(t * 0.23 + aSeed * 11.0) * 0.4;
      p.z += cos(t * 0.13 + aSeed * 17.0) * 0.9;
      vTwinkle = 0.8;
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
      }
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
    gl_PointSize = aSize * uPixelRatio * uSizeScale / max(vDist, 0.6);
    vColor = aColor;
  }
`

export const fieldFragment = /* glsl */ `
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vDist;
  varying float vTwinkle;

  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float core = pow(1.0 - r, 1.8);
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    float a = core * (1.0 - fog) * uOpacity;
    gl_FragColor = vec4(vColor * vTwinkle, a);
  }
`

/** The glowing timeline: flows toward the future and tints toward each branch's universe. */
export const pathVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform vec3 uTintA;
  uniform vec3 uTintB;
  uniform vec3 uTintC;
  uniform vec3 uBranchGain;       // brightness per branch (dims the ones you didn't pick)
  uniform vec4 uShock;
  attribute float aT;
  attribute float aBranch;
  attribute float aSeed;
  attribute float aSize;
  varying vec3 vColor;
  varying float vDist;

  void main() {
    vec3 p = position;
    p.y += sin(uTime * 1.4 + aSeed * 20.0) * 0.015;
    float flow = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(aT * 140.0 - uTime * 2.6), 2.0);
    vec3 white = vec3(1.0, 0.97, 0.92);
    vec3 tint = white;
    float gain = 1.0;
    if (aBranch > 0.5 && aBranch < 1.5) { tint = uTintA; gain = uBranchGain.x; }
    else if (aBranch > 1.5 && aBranch < 2.5) { tint = uTintB; gain = uBranchGain.y; }
    else if (aBranch > 2.5) { tint = uTintC; gain = uBranchGain.z; }
    float k = aBranch > 0.5 ? smoothstep(0.05, 0.85, aT) : 0.0;
    vColor = mix(white, tint, k) * flow * gain * 0.6;

    if (uShock.w > 0.0) {
      float age = uTime - uShock.z;
      float r = length(p.xz - uShock.xy);
      float front = (r - age * 24.0) / 2.0;
      vColor += exp(-front * front) * exp(-age * 0.6) * uShock.w * 1.5;
    }

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vDist = -mv.z;
    gl_PointSize = aSize * uPixelRatio * uSizeScale / max(vDist, 0.6);
  }
`

export const pathFragment = /* glsl */ `
  uniform float uFogFar;
  varying vec3 vColor;
  varying float vDist;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float a = pow(1.0 - r, 2.2) * (1.0 - smoothstep(uFogFar * 0.4, uFogFar, vDist));
    gl_FragColor = vec4(vColor, a);
  }
`

/** Vertical gradient sky with a soft horizon band. */
export const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`

export const skyFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uMoonDir;
  uniform vec3 uMoonColor;
  uniform float uMoonSize;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
    col = mix(uGround, col, smoothstep(-0.12, 0.02, h));
    float m = max(dot(normalize(vDir), normalize(uMoonDir)), 0.0);
    col += uMoonColor * (smoothstep(1.0 - uMoonSize, 1.0 - uMoonSize * 0.6, m) * 1.6
         + pow(m, 260.0) * 0.4 + pow(m, 40.0) * 0.05);
    gl_FragColor = vec4(col, 1.0);
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
  void main() {
    float halfW = mix(0.012, 0.5, uOpen);
    float dx = abs(vUv.x - 0.5);
    if (dx > halfW) discard;
    vec3 world = texture2D(uTex, gl_FragCoord.xy / uRes).rgb;
    float rim = smoothstep(halfW - 0.05, halfW, dx);
    float slit = 1.0 - smoothstep(0.0, 0.25, uOpen);
    vec3 col = mix(world, vec3(1.2), max(rim * 0.5, slit));
    col += uTint * (0.03 + 0.07 * uHover) * (0.6 + 0.4 * sin(uTime * 2.0 + vUv.y * 6.0));
    gl_FragColor = vec4(col, 1.0);
  }
`

/** Glow around a door: distance to the opening's border, additive. */
export const frameFragment = /* glsl */ `
  uniform float uOpen;
  uniform float uHover;
  uniform vec3 uTint;
  uniform vec2 uDoor;   // door half-size in this plane's uv units
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    vec2 halfDoor = vec2(mix(0.004, uDoor.x, uOpen), uDoor.y);
    vec2 q = abs(c) - halfDoor;
    float outside = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    if (outside < 0.0) discard;
    float line = exp(-outside * 220.0);
    float halo = exp(-outside * 18.0) * 0.12;
    float floorGlow = exp(-abs(c.y + halfDoor.y) * 30.0) * exp(-abs(c.x) * 4.0) * 0.25;
    vec3 col = mix(vec3(1.0), uTint, 0.35) * (line * 1.1 + halo * (0.6 + uHover)) + uTint * floorGlow;
    gl_FragColor = vec4(col, clamp(line + halo + floorGlow, 0.0, 1.0));
  }
`

/** Film grain + vignette, applied after bloom. */
export const finishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.9 },
    uGrain: { value: 0.045 },
    uFlash: { value: 0 },
    uFlashColor: { value: [1, 1, 1] },
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
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      vec2 c = vUv - 0.5;
      col *= mix(1.0, smoothstep(0.85, 0.2, length(c)), uVignette);
      col += (rand(vUv * 1000.0 + fract(uTime) * 61.0) - 0.5) * uGrain;
      col = mix(col, uFlashColor, uFlash);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}
