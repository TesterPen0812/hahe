// Real photos from the live feed line the walk, before the Q-Day gate and after it, each wearing
// its seal. Today every seal checks out. When Q-Day's wave reaches a photo, the classical seals
// (RSA-2048, Ed25519) crack and fall away. The ML-DSA-65 ring on our hybrid photos flares and
// holds. An old camera's photo that was logged before Q-Day keeps a small log-anchor ring: the
// signed log still proves it, so it stays verified. The captions after Q-Day are the server's
// verdict for that photo (setVerdicts), not a guess.
import * as THREE from 'three'
import { homeHeight } from './worlds'

export type SealKind = 'legacy' | 'hybrid'
export interface GalleryPhoto { id: string; url: string; kind: SealKind }
/** What the verifier says about a photo after Q-Day. */
export interface SealVerdict { status: 'green' | 'amber' | 'grey'; anchored: boolean }

// Canvas layout: photo on top, then two caption rows (before / after Q-Day).
const CW = 512, PHOTO_H = 384, ROW = 76, CH = PHOTO_H + ROW * 2
// Plane layout, in world units.
const PW = 2.7, PH = 2.5

const BEFORE: Record<SealKind, string> = {
  legacy: 'Old camera · RSA-2048 ✓',
  hybrid: 'Our app · Ed25519 + ML-DSA-65 ✓',
}
const BEFORE_COLOUR = '#c9d3ff'

/** The caption, caption colour and edge light after Q-Day, from the photo's real verdict. */
function after(kind: SealKind, v: SealVerdict): { text: string; colour: string; edge: [number, number, number]; lost: number; anchor: number } {
  if (kind === 'legacy') {
    return v.status === 'green'
      ? { text: 'RSA broken · logged before Q-Day ✓', colour: '#ffd27a', edge: [1.0, 0.78, 0.36], lost: 0, anchor: 1 }
      : { text: 'RSA broken · no proof left', colour: '#ff9d8f', edge: [0.55, 0.5, 0.85], lost: 1, anchor: 0 }
  }
  if (v.status === 'green') return { text: 'ML-DSA-65 holds · still proven ✓', colour: '#8dffbf', edge: [0.35, 1.0, 0.65], lost: 0, anchor: 0 }
  if (v.status === 'amber') return { text: 'ML-DSA-65 holds · edits logged', colour: '#ffd27a', edge: [1.0, 0.78, 0.36], lost: 0, anchor: 0 }
  return { text: 'Not proven', colour: '#b9bdc8', edge: [0.55, 0.5, 0.85], lost: 1, anchor: 0 }
}
// Every photo in the gallery was logged before the gate is crossed, so until the server's verdict
// arrives this is what it will say; setVerdicts() then draws exactly what the server returned.
const PREDICTED: SealVerdict = { status: 'green', anchored: true }

/** Speed of Q-Day's wave down the gallery, in world units per second (about 5 s end to end). */
const WAVE_SPEED = 10

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
  uniform sampler2D uTex;
  uniform float uReady;
  uniform float uKind;     // 0 legacy, 1 hybrid
  uniform float uCrack;    // seconds since Q-Day's wave reached this photo (< 0: not yet)
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uAfter;     // edge light once Q-Day has passed this photo
  uniform float uLost;     // 1: nothing proves this photo any more
  uniform float uAnchor;   // 1: an old camera's photo the signed log still proves
  varying vec2 vUv;
  varying float vDist;

  const float PI = 3.14159265;
  float h1(float n) { return fract(sin(n) * 43758.5453); }
  float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

  // A ring of glass beads. 'age' >= 0 makes it crack: beads drift outward, fall and fade.
  vec4 beadRing(vec2 p, float radius, float n, float bead, vec3 col, float age, float seed) {
    float a = atan(p.y, p.x);
    float i = floor((a + PI) / (2.0 * PI) * n);
    vec4 acc = vec4(0.0);
    for (int k = -1; k <= 1; k++) {
      float j = mod(i + float(k), n);
      float ang = (j + 0.5) / n * 2.0 * PI - PI;
      vec2 c = vec2(cos(ang), sin(ang)) * radius;
      float fade = 1.0;
      if (age >= 0.0) {
        float r = h1(j * 7.1 + seed);
        float t = max(age - r * 0.5, 0.0);
        c += vec2(cos(ang), sin(ang)) * t * (0.25 + r * 0.35);
        c.y -= t * t * (0.5 + r * 0.6);
        fade = 1.0 - smoothstep(0.6, 1.8, t);
      }
      float d = length(p - c);
      float core = smoothstep(bead, bead * 0.35, d);
      float glow = exp(-d / bead * 1.4) * 0.35;
      acc.rgb += col * (core * 1.2 + glow) * fade;
      acc.a = max(acc.a, (core + glow) * fade);
    }
    return acc;
  }

  void main() {
    vec2 p = (vUv - 0.5) * vec2(${PW.toFixed(2)}, ${PH.toFixed(2)});
    float cracked = step(0.0, uCrack);
    float since = max(uCrack, 0.0);

    // Photo [-1,1] x [-0.42,1.08], caption strip below it.
    vec2 pc = p - vec2(0.0, 0.33);
    float dPhoto = sdBox(pc, vec2(1.0, 0.75), 0.05);
    vec4 col = vec4(0.0);
    if (dPhoto < 0.0) {
      float t = (pc.y + 0.75) / 1.5;
      vec2 uv = vec2((pc.x + 1.0) / 2.0, 1.0 - (1.0 - t) * ${(PHOTO_H / CH).toFixed(4)});
      vec3 img = mix(vec3(0.05, 0.06, 0.12), texture2D(uTex, uv).rgb, uReady);
      // the photo itself doesn't change; only what can be proved about it does
      col = vec4(img * 0.82, 1.0);
    }
    // Caption: crossfade from the "before" row to the "after" row as the wave passes.
    vec2 lc = p - vec2(0.0, -0.6);
    if (abs(lc.x) < 1.0 && abs(lc.y) < 0.14) {
      float s = (lc.y + 0.14) / 0.28;
      float top = ${(PHOTO_H / CH).toFixed(4)};
      float row = ${(ROW / CH).toFixed(4)};
      vec2 a = vec2((lc.x + 1.0) / 2.0, 1.0 - top - (1.0 - s) * row);
      vec2 b = a - vec2(0.0, row);
      float k = smoothstep(0.2, 0.9, since) * cracked;
      vec4 ta = texture2D(uTex, a), tb = texture2D(uTex, b);
      vec4 txt = mix(ta, tb, k);
      col = mix(col, vec4(txt.rgb, 1.0), txt.a * uReady);
    }

    // Edge light around the photo: green while it can be proved, cold when its seal broke.
    float edge = exp(-max(dPhoto, 0.0) * 22.0) * step(0.0, dPhoto);
    vec3 green = vec3(0.35, 1.0, 0.65);
    vec3 cold = vec3(0.55, 0.5, 0.85);
    float turned = smoothstep(0.0, 1.0, since) * cracked;
    vec3 edgeCol = mix(green, uAfter, turned) * (0.55 + 0.15 * sin(uTime * 1.2 + uSeed * 6.0));
    col.rgb += edgeCol * edge * 0.6 * (1.0 - col.a);
    col.a = max(col.a, edge * 0.5);

    // The seal at the photo's corner.
    vec2 sp = p - vec2(0.86, -0.3);
    vec4 seal = vec4(0.0);
    if (uKind < 0.5) {
      // Old camera: one classical ring. It cracks.
      seal = beadRing(sp, 0.2, 12.0, 0.034, mix(green, vec3(1.0, 0.55, 0.5), cracked), uCrack, uSeed);
      // Logged before Q-Day: a small steady ring settles in its place, the signed log's proof.
      float settle = smoothstep(0.9, 1.8, since) * cracked * uAnchor;
      vec4 anchor = beadRing(sp, 0.11, 10.0, 0.024, vec3(1.0, 0.8, 0.4) * (0.9 + 0.2 * sin(uTime * 1.6)), -1.0, uSeed);
      seal.rgb += anchor.rgb * settle; seal.a = max(seal.a, anchor.a * settle);
    } else {
      // Hybrid: classical inner ring (Ed25519) cracks; the post-quantum outer ring holds and flares.
      seal = beadRing(sp, 0.13, 8.0, 0.03, mix(green, vec3(1.0, 0.55, 0.5), cracked), uCrack, uSeed + 3.0);
      float flare = cracked * exp(-since * 1.2) * 1.6;
      vec4 outer = beadRing(sp, 0.24, 16.0, 0.03, green * (1.0 + flare + 0.25 * sin(uTime * 2.0 - atan(sp.y, sp.x) * 2.0)), -1.0, uSeed);
      seal.rgb += outer.rgb; seal.a = max(seal.a, outer.a);
      // a ripple of light leaves the ring as it holds
      float rr = length(sp);
      float wave = exp(-pow((rr - 0.24 - since * 0.9) * 14.0, 2.0)) * cracked * exp(-since * 1.5);
      seal.rgb += green * wave; seal.a = max(seal.a, wave * 0.6);
    }
    col.rgb = col.rgb * (1.0 - seal.a * 0.6) + seal.rgb;
    col.a = max(col.a, seal.a);

    // fade with distance so far photos sit in the mist
    float fog = 1.0 - smoothstep(26.0, 48.0, vDist);
    col.rgb *= 1.0 - 0.35 * uLost * turned;
    gl_FragColor = vec4(col.rgb, col.a * fog);
  }
`

/** Write one caption row, shrinking the type until it fits the frame. */
function caption(ctx: CanvasRenderingContext2D, text: string, color: string, y: number) {
  ctx.clearRect(0, y, CW, ROW)
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  let size = 30
  do {
    ctx.font = `500 ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`
  } while (ctx.measureText(text).width > CW - 16 && --size > 18)
  ctx.fillStyle = color
  ctx.fillText(text, 8, y + ROW / 2)
}

/** Draw a photo (cover-cropped) and its two captions into one canvas texture. */
function photoTexture(photo: GalleryPhoto, onReady: () => void) {
  const canvas = document.createElement('canvas')
  canvas.width = CW; canvas.height = CH
  const ctx = canvas.getContext('2d')!
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const img = new Image()
  img.onload = () => {
    const s = Math.max(CW / img.width, PHOTO_H / img.height)
    const w = img.width * s, h = img.height * s
    ctx.save()
    ctx.beginPath(); ctx.rect(0, 0, CW, PHOTO_H); ctx.clip()
    ctx.drawImage(img, (CW - w) / 2, (PHOTO_H - h) / 2, w, h)
    ctx.restore()
    caption(ctx, BEFORE[photo.kind], BEFORE_COLOUR, PHOTO_H)
    tex.needsUpdate = true
    onReady()
  }
  img.src = photo.url
  return { tex, ctx }
}

export interface Gallery {
  group: THREE.Group
  /** qdayAt: scene time Q-Day was crossed (< 0 when it hasn't been); origin: where it happened. */
  update(t: number, qdayAt: number, origin: THREE.Vector3): void
  /** The server's verdicts after Q-Day, by photo id; captions and seals follow them. */
  setVerdicts(verdicts: Map<string, SealVerdict>): void
  dispose(): void
}

/**
 * Photos hung along a curve on alternating sides, each turned toward the visitor walking up it.
 * `from` / `to` are the fractions of the curve the gallery spans.
 */
export function buildGallery(photos: GalleryPhoto[], curve: THREE.Curve<THREE.Vector3>, from = 0.12, to = 0.78, seed = 0): Gallery {
  const group = new THREE.Group()
  type Frame = {
    photo: GalleryPhoto; mesh: THREE.Mesh; mat: THREE.ShaderMaterial; base: THREE.Vector3; seed: number
    ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; ready: boolean; verdict: SealVerdict
  }
  const frames: Frame[] = []
  const n = photos.length
  const paint = (fr: Frame) => {
    const a = after(fr.photo.kind, fr.verdict)
    const u = fr.mat.uniforms
    ;(u.uAfter.value as THREE.Vector3).set(...a.edge)
    u.uLost.value = a.lost
    u.uAnchor.value = a.anchor
    if (fr.ready) { caption(fr.ctx, a.text, a.colour, PHOTO_H + ROW); fr.tex.needsUpdate = true }
  }
  photos.forEach((photo, i) => {
    const f = n === 1 ? (from + to) / 2 : from + (to - from) * (i / (n - 1))
    const on = curve.getPointAt(f)
    const tan = curve.getTangentAt(f).setY(0).normalize()
    const side = new THREE.Vector3(-tan.z, 0, tan.x)
    const k = i + seed
    const sgn = k % 2 === 0 ? -1 : 1
    const off = 3.1 + (k % 3) * 0.45
    const pos = on.clone().addScaledVector(side, sgn * off)
    pos.y = homeHeight(pos.x, pos.z) + 1.75 + ((k * 37) % 5) * 0.12
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment,
      uniforms: {
        uTex: { value: null }, uReady: { value: 0 }, uKind: { value: photo.kind === 'hybrid' ? 1 : 0 },
        uCrack: { value: -1 }, uTime: { value: 0 }, uSeed: { value: k * 1.7 + 0.3 },
        uAfter: { value: new THREE.Vector3() }, uLost: { value: 0 }, uAnchor: { value: 0 },
      },
      transparent: true, depthWrite: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), mat)
    mesh.position.copy(pos)
    // face back down the path, turned a little toward its centre line
    const look = on.clone().addScaledVector(tan, -9)
    look.y = pos.y
    mesh.lookAt(look)
    mesh.renderOrder = 3
    group.add(mesh)
    let ready = () => {}
    const drawn = photoTexture(photo, () => ready())
    const fr: Frame = { photo, mesh, mat, base: pos, seed: k * 1.7, ctx: drawn.ctx, tex: drawn.tex, ready: false, verdict: PREDICTED }
    ready = () => { fr.ready = true; mat.uniforms.uReady.value = 1; paint(fr) }
    mat.uniforms.uTex.value = drawn.tex
    paint(fr)
    frames.push(fr)
  })

  return {
    group,
    update(t, qdayAt, origin) {
      for (const fr of frames) {
        const u = fr.mat.uniforms
        u.uTime.value = t
        fr.mesh.position.y = fr.base.y + Math.sin(t * 0.55 + fr.seed) * 0.05
        // Q-Day's wave runs out from the gate: nearer photos are hit first.
        u.uCrack.value = qdayAt < 0 ? -1 : t - (qdayAt + 0.35 + fr.base.distanceTo(origin) / WAVE_SPEED)
      }
    },
    setVerdicts(verdicts) {
      for (const fr of frames) {
        const v = verdicts.get(fr.photo.id)
        if (!v || (v.status === fr.verdict.status && v.anchored === fr.verdict.anchored)) continue
        fr.verdict = v
        paint(fr)
      }
    },
    dispose() {
      for (const fr of frames) {
        fr.tex.dispose()
        fr.mat.dispose(); fr.mesh.geometry.dispose()
      }
    },
  }
}
