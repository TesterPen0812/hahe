// The quantum world, shown with real photos: after the Q-Day gate the path to our door is lined
// with photos from the live feed, each wearing its seal. When Q-Day's wave reaches a photo, the
// classical seals (RSA-2048, Ed25519) crack and fall away. The ML-DSA-65 ring on our hybrid
// photos flares and holds, which is the whole product in one picture.
import * as THREE from 'three'
import { homeHeight } from './worlds'

export type SealKind = 'legacy' | 'hybrid'
export interface GalleryPhoto { url: string; kind: SealKind }

// Canvas layout: photo on top, then two caption rows (before / after Q-Day).
const CW = 512, PHOTO_H = 384, ROW = 76, CH = PHOTO_H + ROW * 2
// Plane layout, in world units.
const PW = 2.7, PH = 2.5

const CAPTIONS: Record<SealKind, [string, string, string, string]> = {
  // before text, before colour, after text, after colour
  legacy: ['Old camera · RSA-2048', '#c9d3ff', 'RSA-2048 cracked · key stolen', '#ff9d8f'],
  hybrid: ['Our app · Ed25519 + ML-DSA-65', '#c9d3ff', 'ML-DSA-65 holds · still proven', '#8dffbf'],
}

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
    float lost = (1.0 - uKind) * smoothstep(0.0, 1.0, since) * cracked;
    vec3 edgeCol = mix(green, cold, lost) * (0.55 + 0.15 * sin(uTime * 1.2 + uSeed * 6.0));
    col.rgb += edgeCol * edge * 0.6 * (1.0 - col.a);
    col.a = max(col.a, edge * 0.5);

    // The seal at the photo's corner.
    vec2 sp = p - vec2(0.86, -0.3);
    vec4 seal = vec4(0.0);
    if (uKind < 0.5) {
      // Legacy camera: one classical ring. It cracks.
      seal = beadRing(sp, 0.2, 12.0, 0.034, mix(green, vec3(1.0, 0.55, 0.5), cracked), uCrack, uSeed);
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
    gl_FragColor = vec4(col.rgb, col.a * fog);
  }
`

/** Draw a photo (cover-cropped) and its two captions into one canvas texture. */
function photoTexture(photo: GalleryPhoto, onReady: () => void) {
  const canvas = document.createElement('canvas')
  canvas.width = CW; canvas.height = CH
  const ctx = canvas.getContext('2d')!
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const [before, bc, after, ac] = CAPTIONS[photo.kind]
  const caption = (text: string, color: string, y: number) => {
    ctx.font = '500 30px ui-sans-serif, system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    ctx.fillText(text, 8, y + ROW / 2)
  }
  const img = new Image()
  img.onload = () => {
    const s = Math.max(CW / img.width, PHOTO_H / img.height)
    const w = img.width * s, h = img.height * s
    ctx.save()
    ctx.beginPath(); ctx.rect(0, 0, CW, PHOTO_H); ctx.clip()
    ctx.drawImage(img, (CW - w) / 2, (PHOTO_H - h) / 2, w, h)
    ctx.restore()
    caption(before, bc, PHOTO_H)
    caption(after, ac, PHOTO_H + ROW)
    tex.needsUpdate = true
    onReady()
  }
  img.src = photo.url
  return tex
}

export interface Gallery {
  group: THREE.Group
  /** qdayAt: scene time Q-Day was crossed (< 0 when it hasn't been); origin: where it happened. */
  update(t: number, qdayAt: number, origin: THREE.Vector3): void
  dispose(): void
}

/**
 * Photos hung along a curve on alternating sides, each turned toward the visitor walking up it.
 * `from` / `to` are the fractions of the curve the gallery spans.
 */
export function buildGallery(photos: GalleryPhoto[], curve: THREE.Curve<THREE.Vector3>, from = 0.12, to = 0.78): Gallery {
  const group = new THREE.Group()
  const frames: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; base: THREE.Vector3; seed: number }[] = []
  const n = photos.length
  photos.forEach((photo, i) => {
    const f = n === 1 ? (from + to) / 2 : from + (to - from) * (i / (n - 1))
    const on = curve.getPointAt(f)
    const tan = curve.getTangentAt(f).setY(0).normalize()
    const side = new THREE.Vector3(-tan.z, 0, tan.x)
    const sgn = i % 2 === 0 ? -1 : 1
    const off = 3.1 + (i % 3) * 0.45
    const pos = on.clone().addScaledVector(side, sgn * off)
    pos.y = homeHeight(pos.x, pos.z) + 1.75 + ((i * 37) % 5) * 0.12
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment,
      uniforms: {
        uTex: { value: null }, uReady: { value: 0 }, uKind: { value: photo.kind === 'hybrid' ? 1 : 0 },
        uCrack: { value: -1 }, uTime: { value: 0 }, uSeed: { value: i * 1.7 + 0.3 },
      },
      transparent: true, depthWrite: false,
    })
    mat.uniforms.uTex.value = photoTexture(photo, () => { mat.uniforms.uReady.value = 1 })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), mat)
    mesh.position.copy(pos)
    // face back down the path, turned a little toward its centre line
    const look = on.clone().addScaledVector(tan, -9)
    look.y = pos.y
    mesh.lookAt(look)
    mesh.renderOrder = 3
    group.add(mesh)
    frames.push({ mesh, mat, base: pos, seed: i * 1.7 })
  })

  return {
    group,
    update(t, qdayAt, origin) {
      for (const fr of frames) {
        const u = fr.mat.uniforms
        u.uTime.value = t
        fr.mesh.position.y = fr.base.y + Math.sin(t * 0.55 + fr.seed) * 0.05
        // Q-Day's wave runs down the gallery ahead of the visitor: nearer photos are hit first.
        u.uCrack.value = qdayAt < 0 ? -1 : t - (qdayAt + 0.35 + fr.base.distanceTo(origin) / 28)
      }
    },
    dispose() {
      for (const fr of frames) {
        ;(fr.mat.uniforms.uTex.value as THREE.Texture | null)?.dispose()
        fr.mat.dispose(); fr.mesh.geometry.dispose()
      }
    },
  }
}
