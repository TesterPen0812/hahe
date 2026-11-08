import { Vector2, Vector3 } from 'three'
import { greenMotion } from './greenMotion'
import { prismHelpers, prismPlacement } from './prismMotion'
import { curveStreamMotion, curveStreamPlacement, scenePathMotion, scenePathPlacement } from './scenePathMotion'
import { curlField } from './curl'

export const TRAIL_LENGTH = 16
/** The glyph atlas the falling characters are drawn from (see glyphAtlas in worlds.ts). */
export const GLYPH_COLUMNS = 8, GLYPH_ROWS = 4, GLYPH_COUNT = GLYPH_COLUMNS * GLYPH_ROWS
/** Seconds a pointer wake stamp lingers. */
export const WAKE_LIFE = 1.6

const portalNoise = /* glsl */ `
vec3 portalHash(vec3 point) {
    vec3 value = fract(point * vec3(0.1031, 0.1030, 0.0973));
    value += vec3(dot(value, value.yxz + 33.33));
    return fract((value.xxy + value.yxx) * value.zyx) * 2.0 - 1.0;
}

// Gradient noise with quintic interpolation, roughly -1..1.
float portalNoise(vec3 point) {
    vec3 cell = floor(point);
    vec3 local = fract(point);
    vec3 curve = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);

    float n000 = dot(portalHash(cell + vec3(0.0, 0.0, 0.0)), local - vec3(0.0, 0.0, 0.0));
    float n100 = dot(portalHash(cell + vec3(1.0, 0.0, 0.0)), local - vec3(1.0, 0.0, 0.0));
    float n010 = dot(portalHash(cell + vec3(0.0, 1.0, 0.0)), local - vec3(0.0, 1.0, 0.0));
    float n110 = dot(portalHash(cell + vec3(1.0, 1.0, 0.0)), local - vec3(1.0, 1.0, 0.0));
    float n001 = dot(portalHash(cell + vec3(0.0, 0.0, 1.0)), local - vec3(0.0, 0.0, 1.0));
    float n101 = dot(portalHash(cell + vec3(1.0, 0.0, 1.0)), local - vec3(1.0, 0.0, 1.0));
    float n011 = dot(portalHash(cell + vec3(0.0, 1.0, 1.0)), local - vec3(0.0, 1.0, 1.0));
    float n111 = dot(portalHash(cell + vec3(1.0, 1.0, 1.0)), local - vec3(1.0, 1.0, 1.0));

    float x00 = mix(n000, n100, curve.x);
    float x10 = mix(n010, n110, curve.x);
    float x01 = mix(n001, n101, curve.x);
    float x11 = mix(n011, n111, curve.x);

    return mix(mix(x00, x10, curve.y), mix(x01, x11, curve.y), curve.z) * 1.8;
}

`

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
    vEnergy = mix(vEnergy, pow(vEnergy, 0.85), vBlur);
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
const fieldPlacement = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uMode;
  // 0 meadow · 1 RSA collapse · 2 hybrid lattice · 3 unsigned fog · 4 fireflies · 5 aurora
  // 6 orbiting sphere · 7 Q-Day ring · 8 rising motes · 9 flowers · 10 light pillars
  uniform vec4 uTrail[${TRAIL_LENGTH}]; // pointer wake: xyz ray direction, w age (s)
  uniform vec4 uShock;            // x, z, start time, amplitude
  uniform vec4 uPointer;          // live pointer: xyz ray direction, w presence 0..1
  uniform float uPointerSpeed;
  uniform float uInteraction;
  uniform float uTrailWeight[16];
  uniform vec3 uPulseFrom;
  varying vec2 vStrokeDirection;
  varying float vStrokeLength;
  uniform float uWakeN;           // how many wake stamps are still alive (newest first)
  uniform vec3 uPointerFrom;      // where the pointer's rays start (the camera)
  uniform vec4 uPulse;            // click: xyz ray direction, w start time
  uniform vec3 uCenter;           // pivot for ring / sphere modes
  uniform float uOpacity;
  uniform vec3 uAxis;
  attribute vec3 aBasePosition;
  attribute vec4 aHang;
  attribute vec4 aPrism;
  attribute vec2 aStateUv;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vDist;
  varying float vTwinkle;
  varying float vFade;
  ${lens}
  #ifdef PORTAL_DUST
    attribute vec4 aPortal;
    uniform float uHalfWidth;
    uniform float uDoorOuter;
    uniform float uDoorSpeed;
    uniform float uDoorOpen;
    uniform float uImpact;
    ${portalNoise}
  #endif

  ${greenMotion}
  ${prismHelpers}
  ${scenePathMotion}
  ${curveStreamMotion}

  float hash(float n) { return fract(sin(n) * 43758.5453); }


  // How close a grain sits to a ray from the camera, as an angle, and its distance along it.
  // Measuring by angle keeps the pointer's reach the same size on screen, near or far.
  vec2 nearRay(vec3 q, vec3 dir) {
    vec3 v = q - uPointerFrom;
    float along = dot(v, dir);
    float ang = length(v - dir * along) / max(along, 0.001);
    return vec2(ang, along);
  }

  void placeParticle(out vec3 p, out vec3 velocity) {
    p = aBasePosition;
    float t = uTime;
    vTwinkle = 1.0;
    vFade = 1.0;
    velocity = vec3(0.0);

    #ifdef PORTAL_DUST
      p += uAxis * aPortal.x * uHalfWidth;
      velocity = uAxis * aPortal.x * uDoorSpeed;
      if (aPortal.w < 0.0) {
        float edge = exp(-aPortal.y * (uDoorOuter - uHalfWidth) * 6.0) * mix(1.0, 0.2, aPortal.z);
        float slit = 1.0 - smoothstep(0.0, 0.4, uDoorOpen);
        vec3 local = p - uCenter;
        float across = mix(abs(dot(local, uAxis)), dot(local, uAxis), aPortal.z);
        float grain = 0.5 + 0.5 * portalNoise(vec3(across * 3.0, local.y * 3.0, 5.0));
        // the slab is grains, not a frame: its edge only glows bright as the closed slit, before it opens
        vTwinkle = 0.04 + grain * 0.05 + edge * (0.16 + slit * 1.6) * (0.8 + uImpact * 0.6);
      } else {
        float distance = aPortal.w;
        float width = uHalfWidth * (1.0 + distance * 0.35) + 0.02;
        float across = dot(p - uCenter, uAxis);
        float ripple = portalNoise(vec3(across * 2.0, distance * 2.0, t * 0.5)) * 0.5 + 0.5;
        p.y += ripple * 0.02;
        float falloff = exp(-distance * 0.45) * (1.0 - smoothstep(width * 0.6, width, abs(across)));
        vTwinkle = smoothstep(0.0, 0.15, uDoorOpen + 0.05) * falloff * (0.4 + ripple * 0.6) * (0.8 + uImpact * 0.5);
      }
    #else
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
      velocity.y = (0.025 + aSeed * 0.03) * 9.0;
      p.x += sin(t * 0.4 + aSeed * 20.0) * 0.5;
      vFade = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.7, 1.0, life));
      vTwinkle = 0.8 + 0.4 * sin(t * 2.0 + aSeed * 50.0);
    } else if (uMode < 9.5) {
      // Flowers: blossoms nod in the wind and glow on a slow breath.
      float head = step(0.5, fract(aSeed * 3.0 + 0.5) );
      p.x += sin(t * 1.1 + p.z * 0.3 + aSeed) * 0.04;
      vTwinkle = 0.8 + 0.35 * sin(t * 0.9 + p.x * 0.7 + p.z * 0.5) * head;
    } else if (uMode < 10.5) {
      // Pillars of light: a quiet pulse climbs each column.
      float climb = fract(t * 0.18 + uCenter.x * 0.0 + p.z * 0.013);
      float h = fract(p.y * 0.2);
      vTwinkle = 0.6 + 1.2 * exp(-pow((h - climb) * 9.0, 2.0));
    } else if (uMode < 11.5) {
      // Hanging threads: beads slide slowly down their strand and fade in at the top,
      // so each strand drips light. aColor.g carries nothing special; length is in the seed.
      float len = 1.5 + fract(aSeed * 37.1) * 7.0;
      float slide = fract(t * (0.03 + fract(aSeed * 11.3) * 0.05) + aSeed * 13.0);
      p.y -= slide * len * 0.35;
      velocity.y = -(0.03 + fract(aSeed * 11.3) * 0.05) * len * 0.35;
      p.x += sin(t * 0.25 + p.y * 0.4 + aSeed * 9.0) * 0.05;
      vFade = smoothstep(0.0, 0.2, slide) * (1.0 - smoothstep(0.75, 1.0, slide));
      vTwinkle = 0.75 + 0.35 * sin(t * (0.8 + aSeed) + aSeed * 60.0);
    } else if (uMode > 14.5 && uMode < 15.5) {
      applyGreenMotion(p, t, aHang);
    ${prismPlacement}
    ${scenePathPlacement}
    ${curveStreamPlacement}
    } else if (uMode > 20.5 && uMode < 21.5) {
      // A door's colour leaking out: each mote leaves the opening, drifts out and settles (on the
      // floor, into the grains beside it, or in the air), lingers, fades, and starts again.
      // aHang = (drifts per second, phase); aPrism.xyz = where it drifts to, from its birth.
      float life = fract(aHang.y + t * aHang.x);
      float go = 1.0 - pow(1.0 - min(life / 0.7, 1.0), 3.0);
      p += aPrism.xyz * go;
      p += vec3(sin(t * 0.7 + aSeed * 40.0), sin(t * 0.9 + aSeed * 23.0) * 0.5, cos(t * 0.6 + aSeed * 31.0)) * 0.04 * go;
      velocity = aPrism.xyz * aHang.x * 3.0 * pow(1.0 - min(life / 0.7, 1.0), 2.0) / 0.7;
      vFade = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.8, 1.0, life));
      vTwinkle = 0.85 + 0.35 * sin(t * (1.5 + aSeed * 2.0) + aSeed * 50.0);
    } else if (uMode > 19.5 && uMode < 20.5) {
      // Character rain: each strand falls as one, down its own column, and starts again at the top.
      // aHang = (falls per second, phase, travel, this glyph's height above the ground).
      float fall = fract(aHang.y + t * aHang.x);
      float drop = fall * aHang.z;
      p.y -= drop;
      velocity = vec3(0.0, -aHang.x * aHang.z, 0.0);
      // in at the top of the fall, out where it meets the ground
      vFade = smoothstep(0.0, 0.06, fall) * (1.0 - smoothstep(aHang.w - 0.6, aHang.w, drop));
      vTwinkle = 1.0;
    } else if (uMode > 12.5) {
      if (aHang.w > 1.5) {
        // Cave walls: one grain in six trickles down its vein and starts again.
        float fall = fract(aHang.y + t * aHang.x);
        p.xy -= vec2(aHang.z * 0.15, 1.6) * fall;
        velocity = -vec3(aHang.z * 0.15, 1.6, 0.0) * aHang.x;
        vTwinkle = smoothstep(-0.3, 0.4, p.y);
      } else {
        float phase = t * aHang.x + aHang.y;
        float amplitude = aHang.w < 0.5 ? 0.12 : 0.012;
        float sideways = aHang.w < 0.5 ? 0.4 : 0.6;
        float sway = sin(phase) * amplitude * aHang.z;
        p.x += sway;
        p.z += sway * sideways;
        velocity = vec3(1.0, 0.0, sideways) * cos(phase) * aHang.x * amplitude * aHang.z;
      }
    } else {
      // The Q-Day curtain: a bead curtain hung from one roof line. Each strand moves as a unit,
      // swinging from its top like a pendulum: idle, it breathes in a slow shared draught; once
      // crossed it swings aside, away from the path, settling with a small overshoot.
      float open = clamp((0.55 - uOpacity) / 0.43, 0.0, 1.0);
      float settle = open * open * (3.0 - 2.0 * open);
      vec3 rel = p - uCenter;
      float lat = dot(rel.xz, uAxis.xz);
      float strand = hash(floor(p.x * 37.0) * 0.131 + floor(p.z * 37.0) * 0.737);
      float hang = clamp((uCenter.y + 5.4 - p.y) / 9.0, 0.0, 1.0);   // 0 at the roof, 1 at the tip
      float swing = sin(t * 0.55 + strand * 6.2831 + lat * 0.35) * 0.18 + sin(t * 0.23 + lat * 0.12) * 0.12;
      float away = sign(lat + 0.001) * (3.2 + abs(lat) * 0.45) * (0.75 + strand * 0.5) * settle;
      float ang = (swing * (1.0 - settle * 0.6) + away * 0.12) * hang;   // swing grows toward the tip
      float reach = (uCenter.y + 5.4 - p.y);
      vec2 dir = uAxis.xz;
      p.xz += dir * sin(ang) * reach * 0.9;
      p.y += (1.0 - cos(ang)) * reach * 0.9;                          // tips rise only as far as the arc allows
      vTwinkle = (0.75 + 0.35 * sin(t * 1.1 + p.y * 0.6 + strand * 20.0)) * mix(1.0, 0.6, settle);
    }

    #endif

    // Q-Day shock ring.
    if (uShock.w > 0.0) {
      float age = t - uShock.z;
      float r = length(p.xz - uShock.xy);
      float front = (r - age * 18.0) / 4.0;
      float ring = exp(-front * front) * exp(-age * 0.45) * uShock.w;
      p.xz += (p.xz - uShock.xy) / max(r, 1.0) * ring * 0.35;
      vTwinkle += ring * 1.6;
    }

  }
`

const particleState = /* glsl */ `
  uniform sampler2D uPositions, uVelocities, uOffsets, uDrifts;
  uniform float uStateReady, uDelta;
`

export const particleSimulationVertex = /* glsl */ `
  ${fieldPlacement}
  ${particleState}
  ${curlField}
  uniform float uPointerRadius;
  uniform sampler2D uFluidVelocity;
  uniform vec2 uFluidTexel;
  uniform mat4 uViewProjection;
  uniform vec3 uCameraRight, uCameraUp, uCameraPosition;
  uniform float uFluidCoupling;
  uniform vec3 uMoteBox, uWind;
  uniform float uRise, uTurbulence;
  varying vec4 nextPosition, nextVelocity, nextOffset, nextDrift;

  vec4 pointerField(vec3 point) {
    vec3 relative = point - uPointerFrom;
    float along = dot(relative, uPointer.xyz);
    vec4 result = vec4(0.0);
    if (uPointer.w <= 0.001 || along < 0.3) return result;
    vec3 across = relative - uPointer.xyz * along;
    float angle = length(across) / along;
    float reach = max(uPointerRadius, 0.0001);
    float falloff = exp(-angle * angle / (reach * reach));
    if (falloff > 0.01) {
      vec3 swirl = pointerCurl(point, uTime) * along * reach * 0.22 * falloff * (0.3 + uPointerSpeed * 0.9);
      result = vec4(swirl * uPointer.w, falloff * uPointer.w * (0.25 + uPointerSpeed * 0.8));
    }
    float age = uTime - uPulse.w;
    if (age >= 0.0 && age < 3.0) {
      float pulseAlong = dot(relative, uPulse.xyz);
      vec3 pulseAcross = relative - uPulse.xyz * pulseAlong;
      float pulseAngle = length(pulseAcross) / max(pulseAlong, 0.0001);
      float front = pulseAngle - age * 0.9;
      float band = exp(-front * front / 0.0025) * exp(-age * 1.6) * step(0.3, pulseAlong);
      result += vec4(pulseAcross / max(length(pulseAcross), 0.0001) * pulseAlong * 0.015 * band, band * 2.0);
    }
    return result;
  }

  vec3 wakeFlow(vec3 point) {
    vec3 relative = point - uPointerFrom;
    float distance = length(relative);
    if (distance < 0.3) return vec3(0.0);
    float reach = max(uPointerRadius * 1.6, 0.0001);
    float weight = 0.0;
    for (int i = 0; i < ${TRAIL_LENGTH}; i++) {
      if (float(i) >= uWakeN) break;
      vec4 ray = uTrail[i];
      if (ray.w >= 1.6 || uTrailWeight[i] <= 0.001) continue;
      float along = max(dot(relative, ray.xyz), 0.3);
      vec3 across = (relative - ray.xyz * along) / along;
      float fade = 1.0 - ray.w / 1.6;
      weight += exp(-dot(across, across) / (reach * reach)) * fade * fade * uTrailWeight[i];
    }
    if (weight < 0.01) return vec3(0.0);
    return curlNoise(point * 1.4 + vec3(7.0), uTime * 0.35 + 7.0) * distance * min(weight, 2.0) * 0.18;
  }

  vec3 fluidPush(vec3 point) {
    vec4 clip = uViewProjection * vec4(point, 1.0);
    if (clip.w < 0.2 || uFluidCoupling <= 0.0) return vec3(0.0);
    vec2 device = clip.xy / clip.w;
    if (any(greaterThan(abs(device), vec2(1.0)))) return vec3(0.0);
    // WebGL fluid textures use bottom-left UV, unlike wgpu's top-left origin.
    vec2 uv = device * 0.5 + 0.5;
    ivec2 dimensions = textureSize(uFluidVelocity, 0);
    ivec2 cell = ivec2(min(uv * vec2(dimensions), vec2(dimensions - 1)));
    vec2 flow = texelFetch(uFluidVelocity, cell, 0).xy * uFluidTexel;
    return (uCameraRight * flow.x + uCameraUp * flow.y) * clip.w * uFluidCoupling;
  }

  uint particlePcg(uint value) {
    uint state = value * 747796405u + 2891336453u;
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
  }
  float fixedRandom(uint salt) {
    return float(particlePcg(uint(gl_VertexID) ^ particlePcg(particlePcg(salt)))) / 4294967295.0;
  }

  void main() {
    vec3 place, baseVelocity;
    placeParticle(place, baseVelocity);
    vec4 oldPosition = texture2D(uPositions, aStateUv);
    vec3 oldOffset = texture2D(uOffsets, aStateUv).xyz;
    vec4 oldDrift = texture2D(uDrifts, aStateUv);
    vec3 velocity = texture2D(uVelocities, aStateUv).xyz;
    float delta = max(uDelta, 0.0001);
    vec3 offset = oldOffset, drift = oldDrift.xyz;
    vec3 p = place;
    vec4 field;
    bool fresh = uStateReady < 0.5 || oldDrift.w < 0.5 || any(isnan(oldPosition)) || any(isnan(oldDrift));
    if (uMode > 7.5 && uMode < 8.5) {
      // Free motes retain velocity and wrap in a box travelling with the camera.
      p = oldPosition.xyz;
      if (fresh) {
        vec3 random = vec3(fixedRandom(42u), fixedRandom(43u), fixedRandom(44u));
        p = uCameraPosition + (random * 2.0 - 1.0) * uMoteBox;
        velocity = vec3(0.0);
      }
      field = pointerField(p);
      vec3 flow = uWind + vec3(0.0, uRise * mix(0.5, 1.5, fixedRandom(45u)), 0.0)
        + curlNoise(p * 0.35, uTime * 0.15) * uTurbulence * 0.6;
      velocity = mix(velocity, flow, 1.0 - exp(-1.5 * delta)) + (field.xyz * 9.0 + wakeFlow(p) * 3.0) * delta * uInteraction;
      vec3 push = fluidPush(p) * uInteraction;
      velocity = mix(velocity, push, clamp(length(push) * 0.5, 0.0, 1.0) * (1.0 - exp(-8.0 * delta)));
      p += velocity * delta;
      vec3 wrapped = (fract((p - uCameraPosition) / (uMoteBox * 2.0) + 0.5) - 0.5) * uMoteBox * 2.0;
      p = uCameraPosition + wrapped;
      vec3 edge = abs(wrapped) / uMoteBox;
      vFade = 1.0 - smoothstep(0.7, 1.0, max(edge.x, max(edge.y, edge.z)));
      vTwinkle = 0.4 * mix(0.3, 1.0, pow(fixedRandom(46u), 2.0)) * (1.0 + min(field.w, 2.0) * 1.5);
      offset = vec3(0.0); drift = vec3(0.0);
    } else {
      vec3 previous = oldPosition.xyz - oldOffset;
      fresh = fresh || distance(place, previous) > 4.0;
      field = pointerField(place);
      if (fresh) { offset = vec3(0.0); drift = vec3(0.0); velocity = vec3(0.0); }
      else {
        drift += ((field.xyz * uInteraction - offset) * 12.0 + wakeFlow(place) * 3.0 * uInteraction) * delta;
        drift *= exp(-6.5 * delta);
        offset += (drift + fluidPush(place + offset) * uInteraction) * delta;
        velocity = (place - previous) / delta + drift;
      }
      p = place + offset;
      vTwinkle *= 1.0 + min(field.w, 2.0) * 1.2;
    }
    nextPosition = vec4(p, vTwinkle);
    nextVelocity = vec4(velocity, vFade);
    nextOffset = vec4(offset, min(field.w, 2.0));
    nextDrift = vec4(drift, 1.0);
    gl_Position = vec4(aStateUv * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 1.0;
  }
`

export const particleSimulationFragment = /* glsl */ `
  varying vec4 nextPosition, nextVelocity, nextOffset, nextDrift;
  layout(location = 0) out vec4 statePosition;
  layout(location = 1) out vec4 stateVelocity;
  layout(location = 2) out vec4 stateOffset;
  layout(location = 3) out vec4 stateDrift;
  void main() {
    statePosition = nextPosition; stateVelocity = nextVelocity;
    stateOffset = nextOffset; stateDrift = nextDrift;
  }
`

export const fieldVertex = /* glsl */ `
  ${fieldPlacement}
  ${particleState}
  uniform float uGlyphShare;      // share of this layer's falling beads drawn as characters
  varying vec2 vLocal;
  varying float vFocus;
  varying float vGlyph;           // glyph atlas cell, or -1 for a round bead
  void main() {
    vec3 p, velocity;
    float glow = 0.0;
    if (uStateReady > 0.5) {
      vec4 state = texture2D(uPositions, aStateUv);
      vec4 motion = texture2D(uVelocities, aStateUv);
      p = state.xyz; vTwinkle = state.w; velocity = motion.xyz; vFade = motion.w;
      glow = texture2D(uOffsets, aStateUv).w;
    } else placeParticle(p, velocity);
    vec4 head = modelViewMatrix * vec4(p, 1.0);
    vec4 tail = modelViewMatrix * vec4(p - velocity * 0.03, 1.0);
    vDist = -head.z;
    if (vDist <= 0.05 || any(isnan(p)) || any(isnan(velocity))) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;
    }
    if (tail.z > -0.05) tail = head;
    vec4 clipHead = projectionMatrix * head, clipTail = projectionMatrix * tail;
    vec2 halfResolution = vec2(projectionMatrix[1][1] / projectionMatrix[0][0], 1.0) * uSizeScale * uPixelRatio / projectionMatrix[1][1];
    float margin = 1.0 + 48.0 / halfResolution.y;
    if (any(greaterThan(abs(clipHead.xy), vec2(clipHead.w * margin)))) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;
    }
    float scale = uSizeScale * uPixelRatio / vDist;
    float large = fract(aSeed * 91.7) < 0.08 ? 2.8 : 1.0;
    float sharp = max(aSize * large * scale, 0.5);
    float blur = min(abs(vDist - uFocus) * uAperture * scale, 48.0);
    float radius = sqrt(sharp * sharp + blur * blur);
    float energy = sharp * sharp / (radius * radius);
    vFocus = smoothstep(0.15, 0.7, energy);
    if (radius < 1.0) { energy *= radius * radius; radius = 1.0; }
    vec2 screenHead = clipHead.xy / clipHead.w * halfResolution;
    vec2 screenTail = clipTail.xy / clipTail.w * halfResolution;
    vec2 axis = screenHead - screenTail;
    float axisLength = length(axis);
    vec2 direction = axisLength > 0.001 ? axis / axisLength : vec2(1.0, 0.0);
    float halfLength = axisLength * 0.5;
    energy *= sqrt(radius / (radius + halfLength));
    vec2 normal = vec2(-direction.y, direction.x);
    vec2 extent = vec2(halfLength + radius, radius);
    vec2 center = screenHead - direction * halfLength;
    // Some falling beads are drawn as characters instead: upright, unstretched, carried by the
    // same motion and light. Blurred ones stay round, so the glyphs live in the focused band.
    // Each one changes character now and then, slowly and out of step with its neighbours.
    vGlyph = -1.0;
    bool falls = (uMode > 10.5 && uMode < 12.5) || (uMode > 12.5 && uMode < 14.5 && (aHang.w > 1.5 ? aHang.x > 0.0 : aHang.w > 0.5));
    // The character rain is all characters; a door's dust turns to characters for a moment as it's crossed.
    bool rain = uMode > 19.5 && uMode < 20.5;
    bool burst = uMode > 13.5 && uMode < 14.5;
    if ((rain || burst || (falls && vFocus > 0.12)) && fract(aSeed * 53.17 + 0.37) < uGlyphShare) {
      float rate = 0.08 + fract(aSeed * 7.77) * 0.35;
      float tick = floor(uTime * rate + aSeed * 31.0);
      vGlyph = floor(hash(aSeed * 97.31 + tick * 1.618) * ${GLYPH_COUNT}.0);
      radius = clamp(sharp * 3.2, 5.5 * uPixelRatio, 11.0 * uPixelRatio);
      halfLength = 0.0;
      direction = vec2(1.0, 0.0);
      normal = vec2(0.0, 1.0);
      extent = vec2(radius);
      center = screenHead;
      energy = max(energy, 0.35) * 1.8;
    }
    vec2 screen = center + direction * position.x * extent.x + normal * position.y * extent.y;
    vLocal = position.xy * extent / radius;
    vStrokeLength = halfLength / radius;
    vStrokeDirection = direction;
    float twinkle = pow(max(sin(uTime * (2.0 + aSeed * 7.0) + aSeed * 100.0), 0.0), 24.0) * step(0.8, fract(aSeed * 13.7));
    vec3 color = prismColor(aColor, uMode, aHang, aPrism, uTime);
    vColor = mix(color, vec3(max(color.r, max(color.g, color.b))), clamp(glow * 0.4, 0.0, 1.0));
    vEnergy = energy * smoothstep(0.05, 0.8, vDist) * (1.0 + twinkle * 5.0);
    gl_Position = vec4(screen / halfResolution * clipHead.w, clipHead.z, clipHead.w);
  }
`

export const fieldFragment = /* glsl */ `
  uniform float uFogFar, uOpacity, uMode;
  uniform sampler2D uGlyphs;
  varying vec3 vColor;
  varying float vDist, vTwinkle, vFade, vEnergy, vFocus, vGlyph;
  varying vec2 vLocal, vStrokeDirection;
  varying float vStrokeLength;
  void main() {
    if (vGlyph > -0.5) {
      // A character from the atlas (${GLYPH_COLUMNS} × ${GLYPH_ROWS} cells, row 0 at the top).
      vec2 cell = vec2(mod(vGlyph, ${GLYPH_COLUMNS}.0), floor(vGlyph / ${GLYPH_COLUMNS}.0));
      vec2 uv = vLocal * 0.5 + 0.5;
      float ink = texture2D(uGlyphs, vec2((cell.x + uv.x) / ${GLYPH_COLUMNS}.0, 1.0 - (cell.y + 1.0 - uv.y) / ${GLYPH_ROWS}.0)).r;
      if (ink < 0.02) discard;
      vec3 glyphColor = vColor * vTwinkle * vEnergy * exp(-vDist * 2.0 / uFogFar);
      float glyphOpacity = (uMode > 6.5 && uMode < 7.5) ? 1.0 : uOpacity;
      gl_FragColor = vec4(glyphColor, ink * 0.8 * glyphOpacity * vFade);
      return;
    }
    float along = max(abs(vLocal.x) - vStrokeLength, 0.0);
    float rr = along * along + vLocal.y * vLocal.y;
    if (rr > 1.0) discard;
    float radius = sqrt(rr);
    float disc = 1.0 - smoothstep(0.82, 1.0, radius);
    float rim = smoothstep(0.5, 0.92, radius);
    float taper = mix(0.15, 1.0, clamp(vLocal.x / (vStrokeLength + 1.0) * 0.5 + 0.5, 0.0, 1.0));
    vec3 color = vColor * vTwinkle * vEnergy * exp(-vDist * 2.0 / uFogFar);
    vec3 bokeh = color * (0.55 + rim * 0.6);
    vec3 shaded = bokeh;
    if (vFocus > 0.0) {
      vec2 side = vec2(-vStrokeDirection.y, vStrokeDirection.x);
      vec2 planar = vStrokeDirection * sign(vLocal.x) * along + side * vLocal.y;
      vec3 normal = normalize(vec3(planar, sqrt(max(1.0 - rr, 0.0))));
      vec3 light = vec3(-0.42, 0.55, 0.72);
      float diffuse = max(dot(normal, light), 0.0);
      float highlight = pow(max(reflect(-light, normal).z, 0.0), 36.0);
      float fresnel = pow(1.0 - normal.z, 3.0);
      float peak = max(color.r, max(color.g, color.b));
      vec3 bead = color * (0.18 + diffuse * 1.1 + fresnel * 0.7) + vec3(peak) * highlight * 2.2;
      shaded = mix(bokeh, bead, vFocus);
    }
    float opacity = (uMode > 6.5 && uMode < 7.5) ? 1.0 : uOpacity;
    gl_FragColor = vec4(shaded, disc * taper * 0.42 * opacity * vFade);
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
  uniform vec3 uPointerFrom;
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
    if (uPulse.w > -50.0) {
      float age = t - uPulse.w;
      vec3 v = p - uPointerFrom;
      float along = dot(v, uPulse.xyz);
      float ang = length(v - uPulse.xyz * along) / max(along, 0.001);
      float front = (ang - age * 0.32) / 0.025;
      vColor += exp(-front * front) * exp(-age * 1.1) * step(0.9, along) * vec3(0.8, 0.9, 1.0);
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
    float a = shape * vEnergy * vFade * (1.0 - smoothstep(uFogFar * 0.35, uFogFar, vDist)) * smoothstep(0.6, 2.4, vDist);
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
  uniform float uAurora;       // 0 = none
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
      float grid = smoothstep(0.02, 0.0, min(g.x, g.y)) * (1.0 - day) * 0.5;
      body = surf * day + uRingColor * grid * 0.5 * sqrt(max(1.0 - rr, 0.0));
      body += uRingColor * pow(1.0 - sqrt(max(1.0 - rr, 0.0)), 3.0) * 0.6; // atmosphere rim
    }
    col = mix(col, body, disc);
    // halo: tight glow + broad scatter + a faint 22-degree ring around the moon
    float outside = 1.0 - disc;
    col += uMoonColor * outside * (exp(-(ang - uMoonSize) * 60.0) * 0.12 + exp(-ang * 6.0) * 0.025);
    // Aurora: folded curtains of light hanging above the horizon, rays drifting along them.
    if (uAurora > 0.0 && h > 0.0) {
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float fold = az * (1.4 + fi * 0.6) + sin(az * 3.0 + uTime * 0.05 + fi) * 0.8 + fi * 2.1;
        float base = 0.07 + fi * 0.035 + 0.035 * sin(fold + uTime * 0.03);
        float above = h - base;
        float hem = smoothstep(-0.006, 0.004, above);
        float rise = exp(-max(above, 0.0) * (16.0 - fi * 3.0));
        float rays = n3(vec3(az * 70.0 + fi * 13.0, uTime * 0.12, fi)) * 0.7 + n3(vec3(az * 190.0, uTime * 0.3, fi + 4.0)) * 0.5;
        float span = smoothstep(0.0, 0.5, sin(az * 0.9 + fi * 1.7 + 0.6) * 0.5 + 0.5);
        float k = hem * rise * pow(rays, 2.2) * span;
        vec3 c = mix(vec3(0.18, 1.0, 0.62), vec3(0.25, 0.45, 1.0), smoothstep(0.0, 0.12, above));
        c = mix(c, vec3(0.6, 0.3, 0.9), smoothstep(0.1, 0.25, above));
        acc += c * k * (0.5 - fi * 0.13);
      }
      col += acc * uAurora * (1.0 - disc * 0.85);
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
    gl_PointSize = (1.3 + bright * 2.5 + vBig * 9.0) * uPixelRatio;
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
  uniform vec2 uSize;
  uniform float uHalfWidth;
  uniform float uOpen;
  uniform float uImpact;
  uniform float uTime;
  uniform vec3 uTint;
  varying vec2 vUv;
  ${portalNoise}

  void main() {
    vec2 local = (vUv - 0.5) * uSize;
    float edge = min(uHalfWidth - abs(local.x), uSize.y * 0.5 - abs(local.y));
    if (edge < 0.0) discard;
    vec2 pixel = gl_FragCoord.xy;
    // WGSL uses downward screen Y; preserve its noise field, then convert its UV offset.
    vec2 nativePixel = vec2(pixel.x, uRes.y - pixel.y);
    vec2 wobble = vec2(
      portalNoise(vec3(nativePixel * 0.012, uTime * 0.7)),
      portalNoise(vec3(nativePixel * 0.012 + 17.0, uTime * 0.7))
    ) * exp(-edge * 5.0) * 0.006 * vec2(1.0, -1.0);
    float shown = smoothstep(0.0, 0.25, uOpen);
    vec3 next = texture2D(uTex, clamp(pixel / uRes + wobble, 0.0, 1.0)).rgb;
    float slit = 1.0 - smoothstep(0.0, 0.35, uOpen);
    // No glass rim: the view through darkens softly into the edge (the grains crowding round it
    // and the glow outside hide where it stops), with only a breath of the door's colour inside it.
    float feather = smoothstep(0.0, 0.16, edge);
    vec3 inner = uTint * exp(-edge * 9.0) * (0.12 + uImpact * 0.4);
    gl_FragColor = vec4(next * shown * feather * 0.85 + inner * shown + uTint * slit * 2.5, 1.0);
  }
`

export const sparkVertex = /* glsl */ `
  uniform float uTime;
  uniform float uOpen;
  uniform float uPresence;
  uniform float uHalfWidth;
  uniform float uImpact;
  uniform float uScale;
  attribute float aSeed;
  varying float vA;
  void main() {
    float span = mix(3.0, 6.0, aSeed);
    float progress = fract(uTime / span + aSeed * 17.0);
    float age = progress * span;
    vec3 p = position;
    p.x *= uHalfWidth;
    p.x += (fract(aSeed * 37.0) - 0.5) * 0.3 * age;
    p.y += fract(aSeed * 43.0) * 0.15 * age + 0.01 * age * age;
    p.z += mix(0.1, 0.45, fract(aSeed * 59.0)) * age;
    vA = smoothstep(0.0, 0.15, progress) * (1.0 - smoothstep(0.6, 1.0, progress))
       * smoothstep(0.0, 0.3, uOpen) * uPresence * (0.5 + uImpact);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(32.0, uScale * (0.5 + aSeed * 0.7) / max(-mv.z, 0.5));
  }
`

export const sparkFragment = /* glsl */ `
  uniform vec3 uTint;
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float a = exp(-r * r * 6.0) * vA;
    gl_FragColor = vec4(mix(vec3(1.0), uTint, 0.75) * 1.2, a);
  }
`

/**
 * Finishing pass, after tone mapping: a lingering pointer ripple, crossing zoom blur,
 * lens dispersion at the edges, vignette, flash, grain and dither. Crossing into Post-Quantum Day
 * the whole picture breaks into falling characters (uAscii) and resolves out of them again.
 */
export const finishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.024 },
    uFlash: { value: 0 },
    uFlashColor: { value: [1, 1, 1] },
    uAspect: { value: 1 },
    uZoom: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
    uFluidTexel: { value: new Vector2(1, 1) },
    uDye: { value: null },
    uDisplacement: { value: null },
    uFluid: { value: null },
    uFluidAmt: { value: 0 },
    uAscii: { value: 0 },
    uAsciiTint: { value: new Vector3(0.55, 0.72, 1.0) },
    uCell: { value: 11 },
    uGlyphs: { value: null },
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
    uniform sampler2D uFluid;
    uniform sampler2D uDye;
    uniform sampler2D uDisplacement;
    uniform vec2 uFluidTexel;
    uniform vec2 uResolution;
    uniform float uFluidAmt;
    uniform float uAscii;        // 0..1: how far the picture has broken into characters
    uniform vec3 uAsciiTint;     // the world the characters belong to (blue before, violet after)
    uniform float uCell;         // character cell, in output pixels
    uniform sampler2D uGlyphs;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    float h1(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }

    // The picture as a dense grid of characters. Columns fall at their own pace, each character
    // flickers to another now and then, and a bright head runs down every column with its trail
    // above it, like the scene's own character rain. Each cell takes the colour and light of the
    // picture beneath it, so the world breaks up into characters rather than under a filter.
    vec3 asciiPicture(vec2 px, out float reveal) {
      float column = floor(px.x / uCell);
      float rate = 2.5 + 7.0 * h1(column + 3.0);                   // cells per second
      float fall = uTime * rate + h1(column) * 40.0;
      float rowF = px.y / uCell + fall;
      float row = floor(rowF);
      vec2 cell = vec2(column, row);
      vec2 local = vec2(fract(px.x / uCell), fract(rowF));
      // the picture under this character, at its centre as it falls past
      vec2 centre = vec2(column + 0.5, row + 0.5 - fall) * uCell / uResolution;
      vec3 under = texture2D(tDiffuse, clamp(centre, 0.0, 1.0)).rgb;
      float lum = dot(under, vec3(0.299, 0.587, 0.114));
      float seed = rand(cell * 0.173 + 0.31);
      float tick = floor(uTime * (1.5 + 6.0 * seed) + seed * 17.0);
      float glyph = floor(rand(cell + tick * 0.618) * ${GLYPH_COUNT}.0);
      vec2 g = vec2(mod(glyph, ${GLYPH_COLUMNS}.0), floor(glyph / ${GLYPH_COLUMNS}.0));
      vec2 q = (local - 0.5) * 1.12 + 0.5;
      float ink = 0.0;
      if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0)
        // one fixed level of detail: the cell edges' jump in uv would otherwise pick a blurry one
        ink = textureLod(uGlyphs, vec2((g.x + q.x) / ${GLYPH_COLUMNS}.0, 1.0 - (g.y + 1.0 - q.y) / ${GLYPH_ROWS}.0), log2(64.0 / uCell)).r;
      // a head falling down each column, its trail fading out above it
      float u = fract(vUv.y * (0.9 + h1(column + 9.0) * 0.8) + uTime * (0.35 + 0.5 * h1(column + 5.0)) + h1(column + 1.0));
      float trail = pow(1.0 - u, 3.0);
      float head = smoothstep(0.035, 0.0, u);
      vec3 hue = under / max(max(under.r, max(under.g, under.b)), 0.05);
      vec3 colour = mix(hue, uAsciiTint, 0.7);
      float light = (0.42 + 0.58 * trail) * (0.3 + sqrt(lum) * 3.2);
      // cells give way one by one, scattered, the upper rows a moment before the lower
      reveal = smoothstep(0.0, 0.22, uAscii * 1.3 - rand(vec2(column, floor(px.y / uCell)) * 0.71) * 0.7 - (1.0 - vUv.y) * 0.3 + 0.15);
      return (colour * light + vec3(0.85, 0.9, 1.0) * head * (0.4 + lum)) * ink;
    }
    float surfaceHeight(vec2 uv) {
      return texture2D(uDye, uv).x + length(texture2D(uFluid, uv).xy * uFluidTexel) * 0.12;
    }
    void main() {
      vec2 uv = vUv;
      // The image ripples where the pointer stirred it, like disturbed water, and settles.
      vec2 flow = vec2(0.0);
      if (uFluidAmt > 0.0) {
        vec2 tx = vec2(uFluidTexel.x, 0.0), ty = vec2(0.0, uFluidTexel.y);
        vec2 gradient = vec2(surfaceHeight(uv + tx) - surfaceHeight(uv - tx), surfaceHeight(uv + ty) - surfaceHeight(uv - ty));
        vec3 normal = normalize(vec3(-gradient * 1.8, 1.0));
        vec2 pixels = (texture2D(uDisplacement, uv).xy * 0.35 - normal.xy * 0.007) * uResolution;
        // Preserve the portal silhouette under sustained input: strictly less than 2 output pixels.
        flow = pixels * (2.0 / (2.0 + length(pixels))) / uResolution;
        uv += flow;
      }
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
        vec2 off = c * r2 * 0.0015 + flow * 0.08;
        col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      }
      if (uAscii > 0.001) {
        // the picture sinks away evenly while its characters light up one by one over it
        float reveal;
        vec3 chars = asciiPicture(vUv * uResolution, reveal);
        float k = smoothstep(0.0, 1.0, uAscii);
        col = col * (1.0 - 0.94 * k) + chars * reveal;
      }
      col *= max(0.0, 1.0 - dot(c, c) * uVignette * 2.0);
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
