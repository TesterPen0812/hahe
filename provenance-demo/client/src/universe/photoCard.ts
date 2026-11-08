// A photo as a print on smoked glass, with a museum label and its seal. Used by the galleries, the
// live frames and the forgery, so every photo in the walk speaks the same language.
//
// Card layout (card width W, photo aspect a):
//   ┌───────────────────────────────┐   hairline glass edge, soft shadow underneath
//   │  photo (W − 2·pad wide)       │
//   ├───────────────────────────────┤
//   │ KICKER                   ◎    │   small caps, then the seals in mono; the emblem on the right
//   │ ● ML-DSA-65  ● Ed25519        │
//   └───────────────────────────────┘
//
// The seal emblem is drawn in the shader: one hairline ring per signature, post-quantum outermost.
// A ring that holds is solid; one held by the signed log turns brass with a small log mark; a broken
// one parts into arcs that drift and fade; a missing one is a dotted outline.
import * as THREE from 'three'
import type { SealPart } from './contract'
import { MONO, SANS, SHORT, TONE, canvasScale, isFace, isPq, mark, tracked, trackedWidth, type Label } from './photoStyle'

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
  uniform vec2 uPlane;      // plane size (card plus shadow margin)
  uniform vec3 uCard;       // half width, half height, corner radius
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
  uniform float uSweep;     // when a light sweep crossed the glass (Q-Day's wave)
  uniform float uSeed;
  uniform vec3 uSealTone;   // the emblem's overall tone (centre mark and ticks)
  uniform float uSealVis;   // 0: no seal at all
  uniform vec2 uFog;
  uniform vec3 uIce;
  uniform vec3 uMint;
  uniform vec3 uBrass;
  uniform vec3 uRose;
  uniform vec3 uAsh;
  varying vec2 vUv;
  varying float vDist;

  const float TAU = 6.2831853;
  float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
  float h1(float n) { return fract(sin(n) * 43758.5453); }
  float fill(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }
  vec3 desat(vec3 c, float k) { return mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), k); }

  void main() {
    vec2 p = (vUv - 0.5) * uPlane;
    float W = uCard.x * 2.0;
    float aa = fwidth(p.x) * 1.2;

    // Soft shadow beneath the card, a little low, so it seems to hang off the world.
    float dShadow = sdBox(p - vec2(0.0, -W * 0.025), uCard.xy, uCard.z);
    float shadow = 0.5 * exp(-max(dShadow, 0.0) / (W * 0.06));
    float dCard = sdBox(p, uCard.xy, uCard.z);
    float inCard = fill(dCard, aa);
    vec4 col = vec4(0.0, 0.0, 0.0, shadow * (1.0 - inCard));

    if (dCard < aa) {
      // Smoked glass, a touch lighter at the top; dense enough that the bright path behind a card
      // doesn't shine through its label.
      float up = p.y / uCard.y;
      vec3 glass = vec3(0.026, 0.03, 0.042) + vec3(0.012, 0.013, 0.016) * up;
      col = mix(col, vec4(glass, 0.975), inCard);

      // The print.
      vec2 pp = p - uPhoto.xy;
      float dPhoto = sdBox(pp, uPhoto.zw, W * 0.004);
      if (dPhoto < aa) {
        vec2 uv = pp / (uPhoto.zw * 2.0) + 0.5;
        vec3 img = texture2D(uPhotoTex, uv).rgb * 0.86;
        // a soft knee on the highlights: a print, not a light box, so skies and lamps don't bloom
        float il = dot(img, vec3(0.2126, 0.7152, 0.0722));
        img *= il > 0.48 ? (0.48 + (il - 0.48) * 0.3) / il : 1.0;
        img = desat(img, 0.65 * uLost + 0.35 * uReject) * (1.0 - 0.4 * uLost - 0.16 * uReject);
        // the empty frame: deep, with a slow breath of light
        float breath = 0.5 + 0.5 * sin(uTime * 1.3);
        vec3 empty = vec3(0.016, 0.022, 0.028) + uMint * 0.035 * (0.55 + 0.45 * breath) * exp(-dot(pp, pp) / (W * W * 0.12));
        vec3 shown = mix(empty, img, uPhotoOn);
        // a photo develops from the centre out as it arrives
        float dev = smoothstep(0.0, 1.0, uPhotoOn * 1.6 - length(pp) / (W * 0.9));
        shown = mix(empty, img, max(dev, step(0.999, uPhotoOn)));
        float pe = fill(dPhoto, aa);
        col.rgb = mix(col.rgb, shown, pe);
        col.a = mix(col.a, 1.0, pe);   // the print is opaque: nothing behind shows through it
        // inner hairline so the print sits in the glass
        col.rgb *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, aa * 2.5, abs(dPhoto + aa))) * pe;
      }

      // The empty live frame: viewfinder corners that breathe.
      if (uWaiting > 0.001) {
        vec2 a = abs(p - uPhoto.xy);
        float inset = W * (0.045 + 0.006 * sin(uTime * 1.6));
        vec2 k = uPhoto.zw - inset;
        float arm = W * 0.1;
        float dL = min(sdSeg(a, k, k - vec2(arm, 0.0)), sdSeg(a, k, k - vec2(0.0, arm)));
        float corner = fill(dL - W * 0.0035, aa);
        col.rgb = mix(col.rgb, vec3(0.86, 0.92, 0.9), corner * uWaiting * 0.85);
      }

      // The label.
      vec2 cp = (p - uCap.xy) / (uCap.zw * 2.0) + 0.5;
      if (cp.x >= 0.0 && cp.x <= 1.0 && cp.y >= 0.0 && cp.y <= 1.0) {
        vec4 ta = texture2D(uCapA, cp), tb = texture2D(uCapB, cp);
        float k = smoothstep(0.0, 1.0, uCapMix);
        // cross-fade through nothing, so two lines never sit on top of each other
        vec4 t = k < 0.5 ? vec4(ta.rgb, ta.a * (1.0 - k * 2.0)) : vec4(tb.rgb, tb.a * (k * 2.0 - 1.0));
        // type stays just under the bloom threshold, so it reads crisp rather than glowing
        float tl = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722));
        col.rgb = mix(col.rgb, t.rgb * min(1.0, 0.54 / max(tl, 1e-3)), t.a * uCapOn);
      }

      // The seal emblem.
      vec2 q = p - uSeal.xy;
      float rr = length(q);
      float w = uSeal.z * 0.055;
      if (rr < uSeal.z * 1.35) {
        float a01 = fract(atan(q.x, q.y) / TAU + 1.0);   // 0 at the top, clockwise
        // the seal's own edge: a fine ring of ticks, and a small centre mark
        float all = clamp((uTime - uDrawT0) / 1.3, 0.0, 1.0);
        float allOn = all >= 0.999 ? 1.0 : 1.0 - smoothstep(all - 0.004, all + 0.004, a01);
        float tr = uSeal.z * 1.2;
        float ts = fract(a01 * 36.0) - 0.5;
        float tarc = ts / 36.0 * TAU * tr;
        float ticks = fill(max(abs(tarc) - w * 0.3, abs(rr - tr) - w * 0.9), aa);
        col.rgb = mix(col.rgb, uSealTone, ticks * 0.32 * allOn * uSealVis);
        // a rejected seal has no heart: the centre mark goes, so nothing glows over the empty slot
        float centre = fill(rr - uSeal.z * 0.1, aa) * smoothstep(0.55, 1.0, all) * (1.0 - uReject);
        col.rgb = mix(col.rgb, uSealTone, centre * 0.9 * uSealVis);
        for (int i = 0; i < 4; i++) {
          vec4 R = uRing[i];
          if (R.y < -0.5) continue;
          float age = uTime - R.z;
          float rad = R.x;
          vec3 base = R.w > 0.5 && R.w < 1.5 ? uMint : uIce;
          vec3 c = base;
          float alpha = 1.0;
          float on = 1.0;
          // drawn on, ring by ring, clockwise from the top
          float draw = clamp((uTime - uDrawT0 - float(i) * 0.22) / 0.8, 0.0, 1.0);
          draw = 1.0 - pow(1.0 - draw, 3.0);
          on = 1.0 - smoothstep(draw - 0.004, draw + 0.004, a01);
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
            float k = smoothstep(0.0, 1.6, max(age, 0.0));
            float n = 7.0;
            float sid = floor(fract(a01 + uSeed * 0.13) * n);
            float seg = fract(fract(a01 + uSeed * 0.13) * n);
            float gap = mix(0.0, 0.26, k);
            float keep = smoothstep(gap, gap + 0.04, min(seg, 1.0 - seg));
            rad += k * uSeal.z * (0.05 + 0.12 * h1(sid + R.x * 31.0));
            ringD = abs(rr - rad) - w * 0.5;
            m = fill(ringD, aa) * mix(1.0, keep, step(0.0001, k));
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
            float n = 26.0;
            float s = fract(a01 * n) - 0.5;
            float arc = s / n * TAU * rad;
            m = fill(length(vec2(arc, rr - rad)) - w * 0.75, aa);
            c = mix(uAsh, vec3(0.78, 0.8, 0.86), 0.55);
            alpha = 0.95;
          }
          m *= on * alpha;
          col.rgb = mix(col.rgb, c, m);
          // a faint bloom of the ring's own colour on the glass
          col.rgb += c * exp(-max(ringD, 0.0) / (w * 1.6)) * 0.07 * on * alpha * step(R.y, 2.5) * (1.0 - uReject);
        }
      }

      // Glass edge: a hairline, brighter at the top; rose on a rejected forgery.
      float edge = 1.0 - smoothstep(0.0, aa * 1.6, abs(dCard + aa * 0.8));
      vec3 edgeCol = mix(vec3(1.0) * (0.1 + 0.09 * (up * 0.5 + 0.5)), uRose * 0.55, uReject);
      col.rgb += edgeCol * edge;

      // Q-Day's wave passing: one diagonal sheen across the glass.
      float sa = uTime - uSweep;
      if (sa > 0.0 && sa < 1.8) {
        float along = (p.x * 0.55 + p.y) / W;
        float band = exp(-pow((along - (sa * 1.5 - 0.9)) / 0.07, 2.0));
        col.rgb += vec3(0.9, 0.95, 1.0) * band * 0.08 * inCard;
      }
    }

    float fog = 1.0 - smoothstep(uFog.x, uFog.y, vDist);
    gl_FragColor = vec4(col.rgb, col.a * uAlpha * fog);
  }
`

export interface CardOptions {
  /** Card width in world units. */
  width: number
  /** Photo aspect (width / height); refined once the image loads. */
  aspect?: number
  seed?: number
  /** Fade with distance: [start, end]. */
  fog?: [number, number]
  /** Height of the label band, as a share of the card's width (0.2 by default). */
  band?: number
}

const PHOTO_PX = 960
const ease = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 3)

/** Order rings outermost first: post-quantum, then classical, then Face ID. */
function ringOrder(parts: SealPart[]) {
  const rank = (p: SealPart) => (isPq(p.alg) ? 0 : isFace(p.alg) ? 2 : 1)
  return [...parts].sort((a, b) => rank(a) - rank(b)).slice(0, 4)
}

const RADII: Record<number, number[]> = { 1: [0.78], 2: [1, 0.72], 3: [1, 0.74, 0.48], 4: [1, 0.78, 0.56, 0.34] }

/** The card's solid face, depth only: drawn after every card and before the path stream (render
 * order 5), so the stream behind a card is hidden even where the glass is dimmed. */
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

export class PhotoCard {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private face: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private band: number
  width: number
  height = 0
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

  constructor(o: CardOptions) {
    this.width = o.width
    this.band = o.band ?? 0.2
    this.aspect = o.aspect ?? 4 / 3
    const blank = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 4; canvas.height = 4
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 8
      return { canvas, tex }
    }
    this.photo = blank()
    this.caps = [blank(), blank()]
    const v3 = (c: [number, number, number]) => new THREE.Vector3(...c)
    this.u = {
      uPlane: { value: new THREE.Vector2() }, uCard: { value: new THREE.Vector3() },
      uPhoto: { value: new THREE.Vector4() }, uCap: { value: new THREE.Vector4() }, uSeal: { value: new THREE.Vector3() },
      uPhotoTex: { value: this.photo.tex }, uPhotoOn: { value: 0 },
      uCapA: { value: this.caps[0].tex }, uCapB: { value: this.caps[1].tex }, uCapMix: { value: 0 }, uCapOn: { value: 1 },
      uRing: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -1, -100, 0)) },
      uDrawT0: { value: -100 }, uTime: { value: 0 }, uAlpha: { value: 1 },
      uLost: { value: 0 }, uReject: { value: 0 }, uWaiting: { value: 0 }, uSweep: { value: -100 },
      uSeed: { value: o.seed ?? Math.random() }, uSealTone: { value: new THREE.Vector3(...TONE.ice.gl) }, uSealVis: { value: 0 }, uFog: { value: new THREE.Vector2(...(o.fog ?? [34, 60])) },
      uIce: { value: v3(TONE.ice.gl) }, uMint: { value: v3(TONE.mint.gl) }, uBrass: { value: v3(TONE.brass.gl) },
      uRose: { value: v3(TONE.rose.gl) }, uAsh: { value: v3(TONE.ash.gl) },
    }
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, uniforms: this.u,
      transparent: true, depthWrite: false,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat)
    this.mesh.renderOrder = 4
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), depthOnly)
    this.face.renderOrder = DEPTH_ORDER
    this.mesh.add(this.face)
    this.layout()
  }

  /** Recompute the card for the photo's aspect. */
  private layout() {
    const W = this.width
    const a = THREE.MathUtils.clamp(this.aspect, 0.7, 1.6)
    const pad = W * 0.05
    const pw = W - pad * 2, ph = pw / a
    const band = W * this.band
    const H = pad + ph + band
    this.height = H
    const margin = W * 0.22
    const top = H / 2
    const photoY = top - pad - ph / 2
    const bandTop = top - pad - ph
    const bandMid = (bandTop + -H / 2) / 2
    const R = W * 0.066
    const sealX = W / 2 - pad - R * 1.08
    const capLeft = -W / 2 + pad, capRight = sealX - R * 1.5
    const capH = band * 0.78
    this.u.uPlane.value.set(W + margin * 2, H + margin * 2)
    ;(this.u.uCard.value as THREE.Vector3).set(W / 2, H / 2, W * 0.016)
    ;(this.u.uPhoto.value as THREE.Vector4).set(0, photoY, pw / 2, ph / 2)
    ;(this.u.uCap.value as THREE.Vector4).set((capLeft + capRight) / 2, bandMid, (capRight - capLeft) / 2, capH / 2)
    ;(this.u.uSeal.value as THREE.Vector3).set(sealX, bandMid, R)
    this.mesh.geometry.dispose()
    this.mesh.geometry = new THREE.PlaneGeometry(W + margin * 2, H + margin * 2)
    // just inside the rounded corners, so no corner of nothing ever hides what's behind it
    this.face.geometry.dispose()
    this.face.geometry = new THREE.PlaneGeometry(W - W * 0.02, H - W * 0.02)
    this.applyRings()
  }

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
    // kicker: small caps, tracked; a long one breaks onto two lines rather than shrinking to nothing
    const full = Math.round(ch * 0.25)
    const track = full * 0.16
    const kicker = label.kicker.toUpperCase()
    const maxW = cw * 0.98
    const fit = (text: string, from: number) => {
      let size = from
      do { ctx.font = `600 ${size}px ${SANS}` } while (trackedWidth(ctx, text, track) > maxW && --size > 10)
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
      ctx.font = `600 ${size}px ${SANS}`
    }
    const hasLine = !!label.parts?.length || !!label.text
    const two = lines.length > 1
    const y1 = ch * (hasLine ? (two ? 0.17 : 0.28) : two ? 0.36 : 0.5)
    let x = 2 * k
    if (label.live) {
      // a saturated green: the caption's glare limit keeps its hue, so it still reads green under bloom
      ctx.fillStyle = TONE.live.css
      ctx.beginPath(); ctx.arc(x + size * 0.3, y1, size * 0.26, 0, Math.PI * 2); ctx.fill()
      x += size * 0.95
    }
    ctx.fillStyle = label.tone ? TONE[label.tone].css as string : TONE.dim.css
    tracked(ctx, lines[0], x, y1, track)
    if (two) tracked(ctx, lines[1], x, y1 + size * 1.18, track)
    // the line: seals with their marks, or plain text
    const y2 = ch * (two ? 0.76 : 0.7)
    let s2 = Math.round(ch * (two ? 0.27 : 0.31))
    if (label.parts?.length) {
      // the same order as the rings: post-quantum, classical, Face ID
      const items = ringOrder(label.parts).map(p => ({ p, text: SHORT[p.alg] }))
      const layoutW = () => {
        ctx.font = `500 ${s2}px ${MONO}`
        return items.reduce((w, it) => w + s2 * 0.95 + ctx.measureText(it.text).width, 0) + (items.length - 1) * s2 * 1.1
      }
      while (layoutW() > maxW && --s2 > 10) { /* shrink to fit */ }
      x = 2 * k + s2 * 0.32
      for (const it of items) {
        mark(ctx, it.p, x, y2, s2 * 0.27)
        x += s2 * 0.62
        ctx.fillStyle = it.p.state === 'broken' || it.p.state === 'missing' ? TONE.dim.css : TONE.ink.css
        ctx.fillText(it.text, x, y2)
        x += ctx.measureText(it.text).width + s2 * 1.1
      }
    } else if (label.text) {
      do { ctx.font = `500 ${s2}px ${MONO}` } while (ctx.measureText(label.text).width > maxW && --s2 > 10)
      ctx.fillStyle = TONE.ink.css
      ctx.fillText(label.text, 2 * k, y2)
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
  private rejected = false
  set waiting(v: number) { this.u.uWaiting.value = v }
  set captionOn(v: number) { this.u.uCapOn.value = v }
  /** When the seal started drawing on (scene time). */
  get drawStart() { return this.u.uDrawT0.value as number }
  set alpha(v: number) {
    this.u.uAlpha.value = v
    // only a card that's really there hides the stream behind it
    this.face.visible = v > 0.3
  }
  get alpha() { return this.u.uAlpha.value as number }
  /** A sheen across the glass, now (Q-Day's wave passing). */
  sweep(at = this.now) { this.u.uSweep.value = at }

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
  }

  private disposed = false
  dispose() {
    this.disposed = true
    this.photo.tex.dispose()
    this.caps.forEach(c => c.tex.dispose())
    this.mat.dispose()
    this.mesh.geometry.dispose()
    this.face.geometry.dispose()
  }
}

export { ease }
