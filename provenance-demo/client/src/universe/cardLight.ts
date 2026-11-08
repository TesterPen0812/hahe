// How a world lights the photos hung in it, and the motes of that world drifting round them.
//
// Each world gives its prints an ambient tint (the light they're lit by), a fog colour (what they
// melt into far off) and its own kind of particle: soft bulbs of light in the blue world, the same
// bulbs in shifting pastel in the Prism, characters in the green tunnel. The motes are one
// instanced draw per owner (a gallery, the live frames), not one per card: each card writes its
// pose into a slot of a small uniform table once a frame, and the vertex shader places its motes.
import * as THREE from 'three'
import { GLYPH_COLUMNS, GLYPH_ROWS } from './shaders'
import { glyphAtlas, type RGB } from './worlds'

export interface CardLook {
  /** The world's ambient light: tints the print a little, lights its edges, motes and pool. */
  tint: RGB
  /** What the print melts into with distance. */
  fog: RGB
  /** Shifting pastel light instead of one tint (the Prism). */
  iris?: boolean
  /** The world's particles are characters (the green tunnel). */
  glyph?: boolean
}

export const CARD_LOOKS = {
  blue: { tint: [0.5, 0.64, 1.0], fog: [0.02, 0.035, 0.11] },
  prism: { tint: [0.74, 0.68, 1.0], fog: [0.001, 0.0012, 0.003], iris: true },
  green: { tint: [0.34, 1.0, 0.5], fog: [0.001, 0.006, 0.002], glyph: true },
} satisfies Record<string, CardLook>

/** GLSL: the world's light at a point, `h` a slowly travelling hue for the Prism. */
export const lookGlsl = /* glsl */ `
  vec3 worldLight(vec3 tint, float iris, float h) {
    vec3 p = 0.62 + 0.38 * cos(6.2831853 * (h + vec3(0.0, 0.33, 0.67)));
    return mix(tint, p * vec3(0.9, 0.92, 1.0), iris);
  }
`

/** What a mote table needs from a card each frame. */
export interface MoteSource {
  readonly mesh: THREE.Object3D
  /** 0..1 how present its motes are (its alpha, and whether there's a print to drift off). */
  readonly moteLevel: number
  /** The print's centre height in the card's frame and its half size (x, y, half w, half h). */
  readonly photoRect: THREE.Vector4
  /** Card centre to the ground beneath it (negative). */
  readonly groundDy: number
  readonly rejectLevel: number
}

const MAX = 24
const PER_CARD = 54

const vertex = /* glsl */ `
  uniform vec4 uC[${MAX}];   // centre xyz, level
  uniform vec4 uR[${MAX}];   // right x z, scale, reject
  uniform vec4 uP[${MAX}];   // photo centre y, half w, half h, ground dy
  uniform float uTime;
  uniform vec3 uTint;
  uniform float uIris;
  uniform vec3 uRose;
  uniform vec2 uFogRange;
  uniform float uScale;
  attribute float aCard;
  attribute vec4 aSeed;
  varying vec2 vQ;
  varying vec3 vColor;
  varying float vA;
  varying float vGlyph;
  ${lookGlsl}
  float h1(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    int i = int(aCard);
    vec4 C = uC[i];
    vA = 0.0;
    vQ = position.xy;
    if (C.w < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec4 R = uR[i], P = uP[i];
    vec3 right = vec3(R.x, 0.0, R.y);
    vec3 nrm = vec3(-R.y, 0.0, R.x);
    float life = mix(4.5, 9.0, aSeed.x);
    float ph = fract(uTime / life + aSeed.y);
    float cyc = floor(uTime / life + aSeed.y);
    float r1 = h1(aSeed.z * 91.7 + cyc * 13.1), r2 = h1(aSeed.w * 57.3 + cyc * 7.7);
    vec3 local;
    float size;
    if (aSeed.w < 0.74) {
      // off the print's edges: born on the rim, drifting out and up as it fades
      float t = r1 * 4.0;
      vec2 hw = P.yz;
      vec2 e, n;
      if (t < 1.0) { e = vec2(mix(-hw.x, hw.x, t), hw.y); n = vec2(0.0, 1.0); }
      else if (t < 2.0) { e = vec2(hw.x, mix(hw.y, -hw.y, t - 1.0)); n = vec2(1.0, 0.0); }
      else if (t < 3.0) { e = vec2(mix(hw.x, -hw.x, t - 2.0), -hw.y); n = vec2(0.0, -1.0); }
      else { e = vec2(-hw.x, mix(-hw.y, hw.y, t - 3.0)); n = vec2(-1.0, 0.0); }
      float out_ = 0.03 + ph * mix(0.18, 0.55, r2);
      vec2 q = e + n * out_ + vec2(sin(uTime * 0.7 + aSeed.z * 30.0) * 0.06, ph * 0.3);
      local = vec3(q.x, P.x + q.y, (r2 - 0.5) * 0.35);
      size = mix(0.05, 0.12, aSeed.x * aSeed.x);
    } else {
      // round its foot: rising slowly off the ground
      float a = r1 * 6.2831853;
      vec2 d = vec2(cos(a), sin(a)) * vec2(P.y * 1.15, 0.55) * sqrt(r2);
      local = vec3(d.x, P.w + 0.04 + ph * 0.75, d.y);
      size = mix(0.045, 0.1, aSeed.x);
    }
    vec3 pos = C.xyz + right * local.x * R.z + vec3(0.0, local.y * R.z, 0.0) + nrm * local.z * R.z;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mv.z;
    mv.xy += position.xy * size * uScale;
    gl_Position = projectionMatrix * mv;
    vec3 c = worldLight(uTint, uIris, aSeed.z * 0.9 + uTime * 0.03);
    vColor = mix(c, uRose, R.w);
    float fog = 1.0 - smoothstep(uFogRange.x, uFogRange.y, dist);
    vA = sin(3.14159 * ph) * C.w * fog * mix(0.55, 1.0, aSeed.x);
    vGlyph = floor(h1(aSeed.y * 31.0 + cyc) * ${GLYPH_COLUMNS * GLYPH_ROWS}.0);
  }
`

const fragment = /* glsl */ `
  uniform float uGlyph;
  uniform sampler2D uGlyphs;
  varying vec2 vQ;
  varying vec3 vColor;
  varying float vA;
  varying float vGlyph;
  void main() {
    if (vA < 0.003) discard;
    float a;
    if (uGlyph > 0.5) {
      vec2 g = vec2(mod(vGlyph, ${GLYPH_COLUMNS}.0), floor(vGlyph / ${GLYPH_COLUMNS}.0));
      vec2 q = vQ * 0.5 + 0.5;
      a = texture2D(uGlyphs, vec2((g.x + q.x) / ${GLYPH_COLUMNS}.0, 1.0 - (g.y + 1.0 - q.y) / ${GLYPH_ROWS}.0)).r;
    } else {
      // a bulb of light: a bright core in a soft disc, like the world's own out-of-focus grains
      float r = length(vQ);
      if (r > 1.0) discard;
      a = exp(-r * r * 7.0) * 0.85 + (1.0 - smoothstep(0.55, 1.0, r)) * 0.22;
    }
    // additive blending scales by alpha; characters stay as faint as the tunnel's own rain
    gl_FragColor = vec4(vColor, a * vA * (uGlyph > 0.5 ? 0.5 : 1.0));
  }
`

/** The motes round every card one owner hangs: one draw, up to 24 cards. */
export class CardMotes {
  readonly mesh: THREE.Mesh
  private cards: (MoteSource | null)[] = new Array(MAX).fill(null)
  private u: Record<string, THREE.IUniform>
  private right = new THREE.Vector3()

  constructor(look: CardLook, fog: [number, number]) {
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
    g.setIndex([0, 1, 2, 0, 2, 3])
    const n = MAX * PER_CARD
    g.instanceCount = n
    const card = new Float32Array(n), seed = new Float32Array(n * 4)
    let s = 0x2f6b
    const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296)
    for (let i = 0; i < n; i++) {
      card[i] = Math.floor(i / PER_CARD)
      // the last quarter of each card's motes gather round its foot
      const k = i % PER_CARD
      seed.set([rnd(), rnd(), rnd(), k < PER_CARD * 0.74 ? rnd() * 0.73 : 0.75 + rnd() * 0.25], i * 4)
    }
    g.setAttribute('aCard', new THREE.InstancedBufferAttribute(card, 1))
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
    this.u = {
      uC: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
      uR: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
      uP: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
      uTime: { value: 0 },
      uTint: { value: new THREE.Vector3(...look.tint) },
      uIris: { value: look.iris ? 1 : 0 },
      uRose: { value: new THREE.Vector3(0.95, 0.5, 0.5) },
      uFogRange: { value: new THREE.Vector2(fog[0], fog[1]) },
      uScale: { value: look.glyph ? 0.85 : 1 },
      uGlyph: { value: look.glyph ? 1 : 0 },
      uGlyphs: { value: look.glyph ? glyphAtlas() : null },
    }
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, uniforms: this.u,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 6
    this.mesh.name = 'Card motes'
  }

  add(card: MoteSource) {
    const i = this.cards.indexOf(null)
    if (i >= 0) this.cards[i] = card
  }

  remove(card: MoteSource) {
    const i = this.cards.indexOf(card)
    if (i >= 0) { this.cards[i] = null; (this.u.uC.value as THREE.Vector4[])[i].w = 0 }
  }

  /** After the cards are posed this frame. */
  update(t: number) {
    this.u.uTime.value = t
    const C = this.u.uC.value as THREE.Vector4[], R = this.u.uR.value as THREE.Vector4[], P = this.u.uP.value as THREE.Vector4[]
    for (let i = 0; i < MAX; i++) {
      const c = this.cards[i]
      if (!c) { C[i].w = 0; continue }
      const m = c.mesh
      this.right.set(1, 0, 0).applyQuaternion(m.quaternion)
      this.right.y = 0
      this.right.normalize()
      C[i].set(m.position.x, m.position.y, m.position.z, m.visible ? c.moteLevel : 0)
      R[i].set(this.right.x, this.right.z, m.scale.x, c.rejectLevel)
      const r = c.photoRect
      P[i].set(r.y, r.z, r.w, c.groundDy)
    }
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
