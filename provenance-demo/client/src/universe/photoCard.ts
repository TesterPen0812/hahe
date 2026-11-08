// A photo hung in the world: the print itself, lit by the world's light, with its label written in
// light beneath it and its seal floating beside the label. Used by the galleries, the live frames
// and the forgery, so every photo in the walk speaks the same language.
//
// There is no panel and no frame. The print's edges dissolve into the world (a feathered, slowly
// breathing alpha edge with a few of the world's characters shimmering just outside it, like the
// doors), it takes a little of the world's ambient light and melts into its fog with distance, and
// a soft pool of that light lies on the ground beneath it. The world's own particles drift off its
// edges and round its foot (cardLight.ts: one instanced draw per owner, not per card).
//
// Layout (photo width W, photo aspect a):
//      photo (W × W/a)
//      KICKER                       ◎      small caps in light; the seal emblem to the right
//      ● ML-DSA-65  ● Ed25519              the seals in mono, each with its mark
//
// The seal emblem: one hairline ring of light per signature, post-quantum outermost. A ring that
// holds is solid; one held by the signed log turns brass with a small log mark; a broken one parts
// into arcs that drift and fade; a missing one is a dotted outline.
import * as THREE from 'three'
import type { SealPart } from './contract'
import { CARD_LOOKS, lookGlsl, type CardLook, type MoteSource } from './cardLight'
import { GLYPH_COLUMNS, GLYPH_ROWS } from './shaders'
import { MONO, SANS, SHORT, TONE, canvasScale, isFace, isPq, mark, tracked, trackedWidth, type Label } from './photoStyle'
import { glyphAtlas } from './worlds'

const STATE = { holds: 0, broken: 1, anchored: 2, missing: 3 } as const

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying float vDist;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

const fragment = /* glsl */ `
  uniform vec2 uPlane;      // plane size (card plus the margin its light spills into)
  uniform vec4 uPhoto;      // photo centre xy, half size zw
  uniform vec4 uCap;        // label centre xy, half size zw
  uniform vec3 uSeal;       // emblem centre xy, outer radius
  uniform sampler2D uPhotoTex;
  uniform float uPhotoOn;   // 0..1 the print has developed
  uniform sampler2D uCapA;
  uniform sampler2D uCapB;
  uniform float uCapMix;    // 0 label A, 1 label B
  uniform float uCapOn;
  uniform vec4 uRing[4];    // radius, state (-1 none, 0 holds, 1 broken, 2 anchored, 3 missing), t0, class (0 classical, 1 pq, 2 face)
  uniform float uDrawT0;    // the seal started drawing on
  uniform float uTime;
  uniform float uAlpha;
  uniform float uLost;      // 0..1 nothing proves this photo any more
  uniform float uReject;    // 0..1 rejected forgery
  uniform float uWaiting;   // 0..1 the empty live frame
  uniform float uSweep;     // when a light sweep crossed the print (Q-Day's wave)
  uniform float uSeed;
  uniform vec3 uSealTone;   // the emblem's overall tone (centre mark and ticks)
  uniform float uSealVis;   // 0: no seal at all
  uniform vec2 uFog;
  uniform vec3 uFogColor;
  uniform vec3 uTint;
  uniform float uIris;
  uniform sampler2D uGlyphs;
  uniform vec3 uIce;
  uniform vec3 uMint;
  uniform vec3 uBrass;
  uniform vec3 uRose;
  uniform vec3 uAsh;
  varying vec2 vUv;
  varying float vDist;

  const float TAU = 6.2831853;
  ${lookGlsl}
  float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
  float h1(float n) { return fract(sin(n) * 43758.5453); }
  float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + 1.0), f.x), f.y);
  }
  float fill(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }
  vec3 desat(vec3 c, float k) { return mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), k); }
  // premultiplied "over"
  vec4 over(vec4 dst, vec4 src) { return src + dst * (1.0 - src.a); }

  void main() {
    vec2 p = (vUv - 0.5) * uPlane;
    float W = uPhoto.z * 2.0;
    float aa = fwidth(p.x) * 1.2;
    vec2 pp = p - uPhoto.xy;
    float dPhoto = sdBox(pp, uPhoto.zw, 0.0);
    // the world's light here, rose on a rejected forgery
    vec3 light = mix(worldLight(uTint, uIris, (p.x + p.y) / W * 0.45 + uTime * 0.04 + uSeed), uRose, uReject);
    float far = smoothstep(6.0, 30.0, vDist);
    float shown = max(uPhotoOn, 0.0);
    vec4 col = vec4(0.0);
    vec3 add = vec3(0.0);   // light laid over everything (it has no cover of its own)

    // Dark breath behind the label and seal, so the stream and rain behind never run through the type.
    vec2 cp = (p - uCap.xy) / (uCap.zw * 2.0) + 0.5;
    bool inCap = cp.x >= 0.0 && cp.x <= 1.0 && cp.y >= 0.0 && cp.y <= 1.0;
    vec4 ta = vec4(0.0), tb = vec4(0.0), haloA = vec4(0.0), haloB = vec4(0.0);
    if (inCap) {
      ta = texture2D(uCapA, cp); tb = texture2D(uCapB, cp);
      haloA = textureLod(uCapA, cp, 3.5); haloB = textureLod(uCapB, cp, 3.5);
    }
    float k = smoothstep(0.0, 1.0, uCapMix);
    // cross-fade through nothing, so two lines never sit on top of each other
    float wa = k < 0.5 ? 1.0 - k * 2.0 : 0.0, wb = k < 0.5 ? 0.0 : k * 2.0 - 1.0;
    float capVis = uCapOn * (1.0 - 0.45 * uWaiting);
    float halo = clamp((haloA.a * wa + haloB.a * wb) * 2.6, 0.0, 1.0) * capVis;
    vec2 q = p - uSeal.xy;
    float rr = length(q);
    halo = max(halo, uSealVis * exp(-pow(max(rr - uSeal.z * 0.9, 0.0) / (uSeal.z * 0.5), 2.0)) * smoothstep(-0.5, 1.0, uTime - uDrawT0));
    col = over(col, vec4(0.0, 0.0, 0.0, halo * 0.7));

    // The print.
    if (dPhoto < W * 0.01) {
      vec2 uv = pp / (uPhoto.zw * 2.0) + 0.5;
      vec3 img = texture2D(uPhotoTex, clamp(uv, 0.0, 1.0)).rgb * 0.9;
      // a soft knee on the highlights: a print, not a light box, so skies and lamps don't bloom
      float il = dot(img, vec3(0.2126, 0.7152, 0.0722));
      img *= il > 0.5 ? (0.5 + (il - 0.5) * 0.3) / il : 1.0;
      img = desat(img, 0.65 * uLost + 0.35 * uReject) * (1.0 - 0.4 * uLost - 0.16 * uReject);
      // lit by the world: true colour up close, taking the world's light as it recedes
      float lum = dot(img, vec3(0.2126, 0.7152, 0.0722));
      img = mix(img, light * lum * 1.2, mix(0.06, 0.3, far)) + light * 0.012;
      // a gentle fall of light from the top, as if lit from above
      img *= 0.94 + 0.08 * (pp.y / uPhoto.w);
      // The edge dissolves into the world's own grains: inside a band along the rim the print breaks
      // into small round dots of its own colour, fewer toward the edge, slowly coming and going.
      float band = W * 0.1;
      float n = vnoise(pp / W * 2.6 + vec2(uTime * 0.08, uSeed * 9.0)) - 0.5;
      float inner = clamp((-dPhoto + n * band * 0.5) / band, 0.0, 1.0);   // 0 at the rim, 1 past the band
      float cs = W * 0.016;
      vec2 cg = pp / cs;
      vec2 cid = floor(cg);
      float r = h2(cid + uSeed * 3.1);
      float keepDot = step(r, inner * 1.2 - 0.12 + 0.12 * sin(uTime * 0.9 + r * 30.0));
      vec2 jit = vec2(h2(cid + 1.3), h2(cid + 5.7)) - 0.5;
      float rad = mix(0.16, 0.4, h2(cid + 7.1));
      float dot_ = 1.0 - smoothstep(rad - 0.12, rad, length(fract(cg) - 0.5 - jit * (0.9 - rad * 2.0)));
      float edge = max(smoothstep(0.45, 1.0, inner), dot_ * keepDot * step(-dPhoto, band));
      // a photo develops from the centre out as it arrives
      float dev = smoothstep(0.0, 1.0, uPhotoOn * 1.6 - length(pp) / (W * 0.9));
      float a = edge * max(dev, step(0.999, uPhotoOn));
      // where it dissolves, the world's light shows through it
      img = mix(img, img * 0.7 + light * 0.25, 1.0 - smoothstep(0.3, 1.0, inner));
      // Q-Day's wave passing: one diagonal sheen across the print
      float sa = uTime - uSweep;
      if (sa > 0.0 && sa < 1.8) {
        float along = (pp.x * 0.55 + pp.y) / W;
        img += vec3(0.9, 0.95, 1.0) * exp(-pow((along - (sa * 1.5 - 0.9)) / 0.07, 2.0)) * 0.12;
      }
      col = over(col, vec4(img * a, a));
    }

    // Light spilling round the print, and the world's characters shimmering just outside its edge.
    float out_ = max(dPhoto, 0.0);
    add += light * exp(-out_ / (W * 0.06)) * 0.045 * shown * (1.0 + uReject * 2.0);
    if (dPhoto > -W * 0.01 && dPhoto < W * 0.1) {
      float cell = W * 0.042;
      vec2 grid = pp / cell;
      vec2 c = floor(grid);
      float seed = h2(c + uSeed * 17.0);
      float tick = floor(uTime * (0.6 + seed * 1.8) + seed * 13.0);
      float lit = step(0.8, h2(c * 1.7 + tick * 0.37));
      if (lit > 0.5) {
        float g = floor(h2(c + tick * 1.618) * ${GLYPH_COLUMNS * GLYPH_ROWS}.0);
        vec2 gg = vec2(mod(g, ${GLYPH_COLUMNS}.0), floor(g / ${GLYPH_COLUMNS}.0));
        vec2 f = fract(grid);
        float ink = textureLod(uGlyphs, vec2((gg.x + f.x) / ${GLYPH_COLUMNS}.0, 1.0 - (gg.y + 1.0 - f.y) / ${GLYPH_ROWS}.0), 1.0).r;
        float flicker = 0.5 + 0.5 * sin(uTime * (3.0 + seed * 5.0) + seed * 40.0);
        float band = smoothstep(-W * 0.01, W * 0.01, dPhoto) * (1.0 - smoothstep(W * 0.03, W * 0.1, dPhoto));
        band *= smoothstep(-uPhoto.w * 0.9, -uPhoto.w * 0.5, pp.y);
        add += mix(light, vec3(1.0), 0.3) * ink * (0.3 + 0.7 * flicker) * band * 0.6 * max(shown, uWaiting * 0.5);
      }
    }

    // The empty live frame: four viewfinder corners of light that breathe.
    if (uWaiting > 0.001) {
      vec2 av = abs(pp);
      float breath = 0.5 + 0.5 * sin(uTime * 1.6);
      float inset = W * (0.03 + 0.008 * breath);
      vec2 kk = uPhoto.zw - inset;
      float arm = W * 0.11;
      float dL = min(sdSeg(av, kk, kk - vec2(arm, 0.0)), sdSeg(av, kk, kk - vec2(0.0, arm)));
      vec3 cc = mix(light, vec3(1.0), 0.55);
      add += cc * (fill(dL - W * 0.004, aa) * 0.62 + exp(-max(dL, 0.0) / (W * 0.018)) * 0.08) * uWaiting * (0.7 + 0.3 * breath);
      // and the faintest mist of the world's light inside, where a photo will be
      add += light * 0.018 * exp(-dot(pp, pp) / (W * W * 0.12)) * uWaiting * (1.0 - shown);
    }

    // The label, written in light.
    if (inCap) {
      vec4 t = ta * wa + tb * wb;
      vec4 tg = haloA * wa + haloB * wb;
      // letters just under the bloom threshold, so they read crisp; a gentle glow of their own colour round them
      float tl = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 ink = t.rgb * min(1.3, 0.66 / max(tl, 1e-3));
      col = over(col, vec4(ink * t.a, t.a) * capVis);
      add += tg.rgb * tg.a * 0.22 * capVis;
    }

    // The seal emblem, drawn in light.
    float w = uSeal.z * 0.06;
    if (rr < uSeal.z * 1.4) {
      float a01 = fract(atan(q.x, q.y) / TAU + 1.0);   // 0 at the top, clockwise
      // the seal's own edge: a fine ring of ticks, and a small centre mark
      float all_ = clamp((uTime - uDrawT0) / 1.3, 0.0, 1.0);
      float allOn = all_ >= 0.999 ? 1.0 : 1.0 - smoothstep(all_ - 0.004, all_ + 0.004, a01);
      float tr = uSeal.z * 1.22;
      float ts = fract(a01 * 36.0) - 0.5;
      float tarc = ts / 36.0 * TAU * tr;
      float ticks = fill(max(abs(tarc) - w * 0.3, abs(rr - tr) - w * 0.9), aa);
      add += uSealTone * ticks * 0.22 * allOn * uSealVis;
      // a rejected seal has no heart: the centre mark goes, so nothing glows over the empty slot
      float centre = fill(rr - uSeal.z * 0.1, aa) * smoothstep(0.55, 1.0, all_) * (1.0 - uReject);
      add += uSealTone * centre * 0.6 * uSealVis;
      for (int i = 0; i < 4; i++) {
        vec4 R = uRing[i];
        if (R.y < -0.5) continue;
        float age = uTime - R.z;
        float rad = R.x;
        vec3 base = R.w > 0.5 && R.w < 1.5 ? uMint : uIce;
        vec3 c = base;
        float alpha = 1.0;
        // drawn on, ring by ring, clockwise from the top
        float draw = clamp((uTime - uDrawT0 - float(i) * 0.22) / 0.8, 0.0, 1.0);
        draw = 1.0 - pow(1.0 - draw, 3.0);
        float on = 1.0 - smoothstep(draw - 0.004, draw + 0.004, a01);
        if (draw >= 0.999) on = 1.0;
        float ringD = abs(rr - rad) - w * 0.5;
        float m = 0.0;
        if (R.y < 0.5) {
          // holds; a post-quantum ring flares once when Q-Day passes and it doesn't break
          float flare = R.w > 0.5 && R.w < 1.5 && R.z > -50.0 ? exp(-max(age, 0.0) * 1.4) * step(0.0, age) : 0.0;
          c = base * (1.0 + flare * 1.2);
          m = fill(ringD - flare * w * 0.6, aa);
          // a slow glint travels round a ring that holds (not on a forgery: its valid ring is no
          // reason to shine)
          float g = pow(max(cos((a01 - fract(uTime * 0.07 + uSeed + float(i) * 0.31)) * TAU), 0.0), 60.0);
          c += vec3(0.6) * g * 0.5 * (1.0 - uReject);
          c *= 1.0 - 0.35 * uReject;
        } else if (R.y < 1.5) {
          // broken: the ring parts into arcs that drift outward and fade
          float kb = smoothstep(0.0, 1.6, max(age, 0.0));
          float nseg = 7.0;
          float sid = floor(fract(a01 + uSeed * 0.13) * nseg);
          float seg = fract(fract(a01 + uSeed * 0.13) * nseg);
          float gap = mix(0.0, 0.26, kb);
          float keep = smoothstep(gap, gap + 0.04, min(seg, 1.0 - seg));
          rad += kb * uSeal.z * (0.05 + 0.12 * h1(sid + R.x * 31.0));
          ringD = abs(rr - rad) - w * 0.5;
          m = fill(ringD, aa) * mix(1.0, keep, step(0.0001, kb));
          c = mix(base, uRose, smoothstep(0.0, 0.35, age));
          c = mix(c, uAsh, smoothstep(0.9, 2.4, age));
          alpha = mix(1.0, 0.4, smoothstep(0.6, 2.4, age));
        } else if (R.y < 2.5) {
          // anchored: it stays, turns brass, and wears a small log mark at the top
          c = mix(base, uBrass, smoothstep(0.0, 0.9, max(age, 0.0)));
          m = fill(ringD, aa);
          float tick = fill(max(abs(q.x) - w * 0.45, abs(q.y - rad) - w * 2.4), aa);
          m = max(m, tick * smoothstep(0.3, 1.2, age + (R.z < -50.0 ? 9.0 : 0.0)));
        } else {
          // missing: an empty, dotted slot
          float nd = 26.0;
          float s = fract(a01 * nd) - 0.5;
          float arc = s / nd * TAU * rad;
          m = fill(length(vec2(arc, rr - rad)) - w * 0.75, aa);
          c = mix(uAsh, vec3(0.78, 0.8, 0.86), 0.55);
          alpha = 0.95;
        }
        m *= on * alpha;
        // the ring is light: just under the bloom threshold, with a faint glow of its own colour
        add += c * 0.62 * m;
        add += c * exp(-max(ringD, 0.0) / (w * 1.8)) * 0.06 * on * alpha * step(R.y, 2.5) * (1.0 - uReject);
      }
    }

    col.rgb += add;
    // the world's atmosphere: far prints melt into its fog colour, then into nothing
    float fogMix = smoothstep(uFog.x * 0.5, uFog.y, vDist);
    col.rgb = mix(col.rgb, uFogColor * col.a, fogMix * 0.85);
    float fade = 1.0 - smoothstep(mix(uFog.x, uFog.y, 0.55), uFog.y, vDist);
    col *= uAlpha * fade;
    if (col.a < 0.002 && dot(col.rgb, vec3(1.0)) < 0.002) discard;
    gl_FragColor = col;
  }
`

const poolFragment = /* glsl */ `
  uniform vec3 uTint;
  uniform float uIris;
  uniform float uTime;
  uniform float uOn;
  uniform vec2 uFog;
  varying vec2 vUv;
  varying float vDist;
  ${lookGlsl}
  void main() {
    vec2 q = (vUv - 0.5) * 2.0;
    float a = exp(-dot(q, q) * 4.0) * uOn;
    a *= 1.0 - smoothstep(uFog.x, uFog.y, vDist);
    if (a < 0.002) discard;
    vec3 c = worldLight(uTint, uIris, q.x * 0.3 + uTime * 0.04);
    gl_FragColor = vec4(c * 0.11, a);   // additive blending scales by alpha
  }
`

export interface CardOptions {
  /** Photo width in world units. */
  width: number
  /** Photo aspect (width / height); refined once the image loads. */
  aspect?: number
  seed?: number
  /** Fade with distance: [start, end]. */
  fog?: [number, number]
  /** Height of the label beneath the photo, as a share of its width (0.2 by default). */
  band?: number
  /** The world it hangs in: its light, fog and particles. */
  look?: CardLook
}

const PHOTO_PX = 960
const ease = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 3)

/** Order rings outermost first: post-quantum, then classical, then Face ID. */
function ringOrder(parts: SealPart[]) {
  const rank = (p: SealPart) => (isPq(p.alg) ? 0 : isFace(p.alg) ? 2 : 1)
  return [...parts].sort((a, b) => rank(a) - rank(b)).slice(0, 4)
}

const RADII: Record<number, number[]> = { 1: [0.78], 2: [1, 0.72], 3: [1, 0.74, 0.48], 4: [1, 0.78, 0.56, 0.34] }

/** The print's solid middle and its label, depth only: drawn after every card and before the path stream (render
 * order 5), so the stream behind a print is hidden where the print is opaque. */
const DEPTH_ORDER = 4.5
// Near cards only: one far down the path, fading into the fog, leaves the stream behind it whole.
const depthOnly = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    varying float vDist;
    void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }
  `,
  fragmentShader: /* glsl */ `
    varying float vDist;
    void main() { if (vDist > 24.0) discard; gl_FragColor = vec4(0.0); }
  `,
  // in the transparent list, so its render order puts it after the cards and before the stream
  transparent: true, colorWrite: false, depthWrite: true,
})

export class PhotoCard implements MoteSource {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private face: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private pool: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private band: number
  width: number
  /** Photo plus label, centred on the mesh's origin. */
  height = 0
  readonly photoRect = new THREE.Vector4()
  groundDy = -2
  private grounded = 1
  private mat: THREE.ShaderMaterial
  private u: Record<string, THREE.IUniform>
  private aspect: number
  private photo: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }
  private caps: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }[]
  private capFront = 0
  private capTarget = 0
  private photoTarget = 0
  private parts: SealPart[] = []
  /** When each ring last changed state, in scene time. */
  private changed = new Map<SealPart['alg'], number>()
  private now = 0
  private photoUrl = ''
  /** Where the label's text starts in its canvas (left padding for its halo), in canvas px / width. */
  private static readonly CAP_PAD = 0.04

  constructor(o: CardOptions) {
    this.width = o.width
    this.band = o.band ?? 0.2
    this.aspect = o.aspect ?? 4 / 3
    const look: CardLook = o.look ?? CARD_LOOKS.blue
    const fog = o.fog ?? [34, 60]
    const blank = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 4; canvas.height = 4
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 8
      return { canvas, tex }
    }
    this.photo = blank()
    this.photo.tex.generateMipmaps = false
    this.photo.tex.minFilter = THREE.LinearFilter
    this.caps = [blank(), blank()]
    const v3 = (c: readonly number[]) => new THREE.Vector3(c[0], c[1], c[2])
    const shared = {
      uTime: { value: 0 }, uTint: { value: v3(look.tint) }, uIris: { value: look.iris ? 1 : 0 },
      uFog: { value: new THREE.Vector2(...fog) },
    }
    this.u = {
      ...shared,
      uPlane: { value: new THREE.Vector2() },
      uPhoto: { value: new THREE.Vector4() }, uCap: { value: new THREE.Vector4() }, uSeal: { value: new THREE.Vector3() },
      uPhotoTex: { value: this.photo.tex }, uPhotoOn: { value: 0 },
      uCapA: { value: this.caps[0].tex }, uCapB: { value: this.caps[1].tex }, uCapMix: { value: 0 }, uCapOn: { value: 1 },
      uRing: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -1, -100, 0)) },
      uDrawT0: { value: -100 }, uAlpha: { value: 1 },
      uLost: { value: 0 }, uReject: { value: 0 }, uWaiting: { value: 0 }, uSweep: { value: -100 },
      uSeed: { value: o.seed ?? Math.random() }, uSealTone: { value: new THREE.Vector3(...TONE.ice.gl) }, uSealVis: { value: 0 },
      uFogColor: { value: v3(look.fog) }, uGlyphs: { value: glyphAtlas() },
      uIce: { value: v3(TONE.ice.gl) }, uMint: { value: v3(TONE.mint.gl) }, uBrass: { value: v3(TONE.brass.gl) },
      uRose: { value: v3(TONE.rose.gl) }, uAsh: { value: v3(TONE.ash.gl) },
    }
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, uniforms: this.u,
      // premultiplied: the print covers what's behind it, its light adds, the label's breath darkens
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat)
    this.mesh.renderOrder = 4
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), depthOnly)
    this.face.renderOrder = DEPTH_ORDER
    this.mesh.add(this.face)
    // a soft pool of the world's light on the ground beneath
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: poolFragment,
      uniforms: { ...shared, uOn: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    this.pool.rotation.x = -Math.PI / 2
    this.pool.renderOrder = 3
    this.mesh.add(this.pool)
    this.layout()
  }

  /** Recompute the card for the photo's aspect. */
  private layout() {
    const W = this.width
    const a = THREE.MathUtils.clamp(this.aspect, 0.7, 1.6)
    const ph = W / a
    const gap = 0.0
    const band = W * this.band
    const H = ph + gap + band
    this.height = H
    const margin = W * 0.24
    const top = H / 2
    const photoY = top - ph / 2
    const bandMid = -H / 2 + band / 2
    const R = W * 0.062
    const sealX = W / 2 - R * 1.25
    // the label's canvas starts a little left of the print, so the halo round its first letter isn't cut
    const pad = W * PhotoCard.CAP_PAD
    const capLeft = -W / 2 - pad, capRight = sealX - R * 1.6
    const capH = band * 1.05
    this.u.uPlane.value.set(W + margin * 2, H + margin * 2)
    this.photoRect.set(0, photoY, W / 2, ph / 2)
    ;(this.u.uPhoto.value as THREE.Vector4).copy(this.photoRect)
    ;(this.u.uCap.value as THREE.Vector4).set((capLeft + capRight) / 2, bandMid, (capRight - capLeft) / 2, capH / 2)
    ;(this.u.uSeal.value as THREE.Vector3).set(sealX, bandMid, R)
    this.mesh.geometry.dispose()
    this.mesh.geometry = new THREE.PlaneGeometry(W + margin * 2, H + margin * 2)
    // the print's solid middle and its label: the path's stream behind them is hidden, so its glow
    // never runs through the type
    const faceTop = top - W * 0.07, faceBottom = -H / 2
    this.face.geometry.dispose()
    this.face.geometry = new THREE.PlaneGeometry(W * 0.86, faceTop - faceBottom)
    this.face.position.y = (faceTop + faceBottom) / 2
    this.placePool()
    this.applyRings()
  }

  private placePool() {
    const W = this.width
    this.pool.geometry.dispose()
    this.pool.geometry = new THREE.PlaneGeometry(W * 1.5, W * 0.9)
    this.pool.position.set(0, this.groundDy + 0.02, W * 0.08)
  }

  /** How far below the card's centre the ground is (a negative number): its pool lies there. */
  setGround(dy: number) {
    if (Math.abs(dy - this.groundDy) < 1e-3) return
    this.groundDy = dy
    this.pool.position.y = dy + 0.02
  }

  /** 0..1 the card stands on the ground (its pool shows); 0 while it flies in. */
  set standing(v: number) { this.grounded = v }

  /** Load the print (cover-cropped to the card, which takes the photo's own aspect). */
  setPhoto(url: string): Promise<void> {
    this.photoUrl = url
    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        if (this.photoUrl !== url || this.disposed) return resolve()
        this.aspect = img.width / img.height
        this.layout()
        const a = THREE.MathUtils.clamp(this.aspect, 0.7, 1.6)
        const cw = a >= 1 ? PHOTO_PX : Math.round(PHOTO_PX * a)
        const ch = Math.round(cw / a)
        const { canvas, tex } = this.photo
        canvas.width = cw; canvas.height = ch
        const ctx = canvas.getContext('2d')!
        const s = Math.max(cw / img.width, ch / img.height)
        ctx.drawImage(img, (cw - img.width * s) / 2, (ch - img.height * s) / 2, img.width * s, img.height * s)
        tex.dispose()
        tex.needsUpdate = true
        resolve()
      }
      img.onerror = () => resolve()
      img.src = url
    })
  }

  /** Show the print: `instant` for photos that are simply there, otherwise it develops. */
  showPhoto(instant = false) {
    this.photoTarget = 1
    if (instant) this.u.uPhotoOn.value = 1
  }

  /** The aspect of the waiting frame, before any photo. */
  setAspect(aspect: number) { this.aspect = aspect; this.layout() }

  /** Write the label. `fade`: cross-fade from the current one. */
  setLabel(label: Label, fade = false) {
    const next = fade ? 1 - this.capFront : this.capFront
    this.drawLabel(this.caps[next], label)
    if (fade) this.capTarget = next
    else { this.capTarget = next; this.u.uCapMix.value = next }
  }

  private drawLabel(target: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }, label: Label) {
    const cap = this.u.uCap.value as THREE.Vector4
    const cw = Math.round(1024 * canvasScale())
    const ch = Math.round(cw * (cap.w / cap.z))
    const { canvas, tex } = target
    canvas.width = cw; canvas.height = ch
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, cw, ch)
    ctx.textBaseline = 'middle'
    const k = cw / 1024
    // the print's left edge, in canvas px: text lines up with it
    const x0 = cw * (this.width * PhotoCard.CAP_PAD) / (cap.z * 2)
    // kicker: small caps, tracked; a long one breaks onto two lines rather than shrinking to nothing
    const full = Math.round(ch * 0.23)
    const track = full * 0.2
    const kicker = label.kicker.toUpperCase()
    const maxW = cw - x0 - 4 * k
    const fit = (text: string, from: number) => {
      let size = from
      do { ctx.font = `500 ${size}px ${SANS}` } while (trackedWidth(ctx, text, track) > maxW && --size > 10)
      return size
    }
    let size = fit(kicker, full)
    let lines = [kicker]
    const words = kicker.split(' ')
    if (size < full * 0.8 && words.length > 1) {
      // break at the space nearest the middle
      let best = 1
      for (let w = 1; w < words.length; w++) {
        const d = Math.abs(words.slice(0, w).join(' ').length - kicker.length / 2)
        if (d < Math.abs(words.slice(0, best).join(' ').length - kicker.length / 2)) best = w
      }
      lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')]
      size = Math.min(fit(lines[0], Math.round(full * 0.82)), fit(lines[1], Math.round(full * 0.82)))
      ctx.font = `500 ${size}px ${SANS}`
    }
    const hasLine = !!label.parts?.length || !!label.text
    const two = lines.length > 1
    const y1 = ch * (hasLine ? (two ? 0.13 : 0.14) : two ? 0.38 : 0.5)
    let x = x0
    if (label.live) {
      // a saturated green: the caption's glare limit keeps its hue, so it still reads green under bloom
      ctx.fillStyle = TONE.live.css
      ctx.beginPath(); ctx.arc(x + size * 0.3, y1, size * 0.24, 0, Math.PI * 2); ctx.fill()
      x += size * 0.95
    }
    ctx.fillStyle = label.tone ? TONE[label.tone].css as string : TONE.ink.css
    tracked(ctx, lines[0], x, y1, track)
    if (two) tracked(ctx, lines[1], x, y1 + size * 1.22, track)
    // the line: seals with their marks, or plain text
    const y2 = ch * (two ? 0.6 : 0.42)
    let s2 = Math.round(ch * (two ? 0.22 : 0.25))
    if (label.parts?.length) {
      // the same order as the rings: post-quantum, classical, Face ID
      const items = ringOrder(label.parts).map(p => ({ p, text: SHORT[p.alg] }))
      const layoutW = () => {
        ctx.font = `400 ${s2}px ${MONO}`
        return items.reduce((w, it) => w + s2 * 0.95 + ctx.measureText(it.text).width, 0) + (items.length - 1) * s2 * 1.1
      }
      while (layoutW() > maxW && --s2 > 10) { /* shrink to fit */ }
      x = x0 + s2 * 0.32
      for (const it of items) {
        mark(ctx, it.p, x, y2, s2 * 0.25)
        x += s2 * 0.62
        ctx.fillStyle = it.p.state === 'broken' || it.p.state === 'missing' ? TONE.dim.css : TONE.ink.css
        ctx.fillText(it.text, x, y2)
        x += ctx.measureText(it.text).width + s2 * 1.1
      }
    } else if (label.text) {
      do { ctx.font = `400 ${s2}px ${MONO}` } while (ctx.measureText(label.text).width > maxW && --s2 > 10)
      ctx.fillStyle = TONE.ink.css
      ctx.fillText(label.text, x0, y2)
    }
    tex.dispose()
    tex.needsUpdate = true
  }

  /** The seals. Rings whose state changes animate from now; `draw` draws the whole emblem on. */
  setParts(parts: SealPart[], opts: { draw?: boolean; at?: number } = {}) {
    const at = opts.at ?? this.now
    const prev = new Map(this.parts.map(p => [p.alg, p.state]))
    this.parts = ringOrder(parts)
    this.changed = new Map(this.parts.map(p => [p.alg, prev.has(p.alg) && prev.get(p.alg) !== p.state ? at : (this.changed.get(p.alg) ?? -100)]))
    if (opts.draw) this.u.uDrawT0.value = at
    this.applyRings()
  }

  private applyRings() {
    // the emblem's tone: what the seal as a whole amounts to
    const ps = this.parts
    const tone = this.rejected ? TONE.rose : ps.some(p => isPq(p.alg) && p.state === 'holds') ? TONE.mint
      : ps.some(p => p.state === 'holds') ? TONE.ice : ps.some(p => p.state === 'anchored') ? TONE.brass : TONE.ash
    ;(this.u.uSealTone.value as THREE.Vector3).set(...tone.gl)
    this.u.uSealVis.value = ps.length ? 1 : 0
    const R = (this.u.uSeal.value as THREE.Vector3).z
    const radii = RADII[this.parts.length] ?? []
    const rings = this.u.uRing.value as THREE.Vector4[]
    rings.forEach((r, i) => {
      const p = this.parts[i]
      if (!p) { r.set(0, -1, -100, 0); return }
      r.set(R * radii[i], STATE[p.state], this.changed.get(p.alg) ?? -100, isPq(p.alg) ? 1 : isFace(p.alg) ? 2 : 0)
    })
  }

  set lost(v: number) { this.u.uLost.value = v }
  set reject(v: number) {
    this.u.uReject.value = v
    if ((v > 0.5) !== this.rejected) { this.rejected = v > 0.5; this.applyRings() }
  }
  get rejectLevel() { return this.u.uReject.value as number }
  private rejected = false
  set waiting(v: number) { this.u.uWaiting.value = v }
  set captionOn(v: number) { this.u.uCapOn.value = v }
  /** When the seal started drawing on (scene time). */
  get drawStart() { return this.u.uDrawT0.value as number }
  set alpha(v: number) {
    this.u.uAlpha.value = v
    this.syncFace()
  }
  get alpha() { return this.u.uAlpha.value as number }
  /** How present the world's motes round it are. */
  get moteLevel() {
    const on = Math.max(this.u.uPhotoOn.value as number, (this.u.uWaiting.value as number) * 0.4)
    return this.alpha * on * this.grounded
  }
  /** A sheen across the print, now (Q-Day's wave passing). */
  sweep(at = this.now) { this.u.uSweep.value = at }

  /** Only a print that's really there hides the stream behind it. */
  private syncFace() {
    this.face.visible = this.alpha > 0.3 && (this.u.uPhotoOn.value as number) > 0.6
  }

  update(t: number, dt = 1 / 60) {
    this.now = t
    this.u.uTime.value = t
    const on = this.u.uPhotoOn.value as number
    if (on < this.photoTarget) this.u.uPhotoOn.value = Math.min(1, on + dt / 1.1)
    const mix = this.u.uCapMix.value as number
    if (mix !== this.capTarget) {
      const step = dt / 0.9
      const nextMix = mix < this.capTarget ? Math.min(this.capTarget, mix + step) : Math.max(this.capTarget, mix - step)
      this.u.uCapMix.value = nextMix
      if (nextMix === this.capTarget) this.capFront = this.capTarget
    }
    this.syncFace()
    this.pool.material.uniforms.uOn.value = this.alpha * this.grounded * Math.max(on, (this.u.uWaiting.value as number) * 0.5)
  }

  private disposed = false
  dispose() {
    this.disposed = true
    this.photo.tex.dispose()
    this.caps.forEach(c => c.tex.dispose())
    this.mat.dispose()
    this.mesh.geometry.dispose()
    this.face.geometry.dispose()
    this.pool.geometry.dispose()
    this.pool.material.dispose()
  }
}

export { ease }
