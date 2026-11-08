// The live demo's stage, inside the world that went hybrid: an empty frame on the path that waits
// for a photo ("Live · waiting for a photo"). When one is taken on the phone, it flies in from the
// light down the tunnel, lands in the frame, its seal ring draws itself on and the caption shows
// the server's real verdict.
import * as THREE from 'three'

/** Where the phone opens the camera. Passkeys are bound to this exact domain. */
export const PHONE_HOST = 'tahas-macbook-pro.tailc3868a.ts.net'

export type ArrivalStatus = 'green' | 'amber' | 'grey'
export interface Arrival { url: string; status: ArrivalStatus; title: string; note: string }

// Canvas and plane layout: photo on top (4:3), caption below.
const CW = 640, PHOTO_H = 480, CH = 720
const W = 3.2, H = W * (CH / CW)
const PHOTO_BOTTOM = H / 2 - H * (PHOTO_H / CH)

const COLOURS: Record<ArrivalStatus, { css: string; gl: [number, number, number] }> = {
  green: { css: '#8dffbf', gl: [0.35, 1.0, 0.65] },
  amber: { css: '#ffd27a', gl: [1.0, 0.78, 0.36] },
  grey: { css: '#c4c8d2', gl: [0.62, 0.64, 0.72] },
}
const FONT = 'ui-sans-serif, system-ui, -apple-system, sans-serif'

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

const common = /* glsl */ `
  const float PI = 3.14159265;
  float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
`

// The empty frame: a dashed outline, the waiting line, and a pulsing dot.
const placeholderFragment = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uTime;
  uniform float uAlpha;
  uniform vec2 uDot;       // dot centre, in plane units
  varying vec2 vUv;
  ${common}
  void main() {
    vec2 p = (vUv - 0.5) * vec2(${W.toFixed(3)}, ${H.toFixed(3)});
    vec4 tex = texture2D(uTex, vUv);
    vec4 col = vec4(tex.rgb, tex.a * 0.92);
    float pulse = 0.5 + 0.5 * sin(uTime * 3.2);
    float d = length(p - uDot);
    float bead = smoothstep(0.075, 0.05, d);
    float halo = exp(-max(d - 0.06, 0.0) * (14.0 - pulse * 8.0)) * (0.35 + 0.5 * pulse) * step(0.06, d);
    vec3 g = vec3(0.35, 1.0, 0.65);
    col.rgb = mix(col.rgb, g * 1.4, bead);
    col.rgb += g * halo;
    col.a = max(col.a, max(bead, halo));
    // a soft breathing glow around the whole frame
    float edge = sdBox(p, vec2(${(W / 2).toFixed(3)}, ${(H / 2).toFixed(3)}) - 0.02, 0.12);
    float rim = exp(-abs(edge) * 26.0) * (0.25 + 0.2 * pulse);
    col.rgb += g * rim * 0.6;
    col.a = max(col.a, rim * 0.5);
    gl_FragColor = vec4(col.rgb, col.a * uAlpha);
  }
`

// The arrived photo: image and caption from the canvas, the seal ring drawn on in the shader.
const cardFragment = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uTime;
  uniform float uRing;     // 0..1 how much of the seal ring has drawn on
  uniform float uCap;      // 0..1 caption reveal
  uniform float uAlpha;
  uniform vec3 uCol;       // status colour
  uniform float uSeal;     // 1 when there is a seal to draw (green / amber)
  varying vec2 vUv;
  ${common}
  void main() {
    vec2 p = (vUv - 0.5) * vec2(${W.toFixed(3)}, ${H.toFixed(3)});
    vec4 tex = texture2D(uTex, vUv);
    vec4 col = tex;
    // the caption rises in once the photo has landed
    if (p.y < ${PHOTO_BOTTOM.toFixed(3)}) {
      float k = smoothstep(0.0, 1.0, uCap * 1.4 - (${PHOTO_BOTTOM.toFixed(3)} - p.y) * 0.5);
      col.rgb = mix(vec3(0.02, 0.05, 0.045), tex.rgb, k);
    }
    // status light around the card
    float edge = sdBox(p, vec2(${(W / 2).toFixed(3)}, ${(H / 2).toFixed(3)}) - 0.02, 0.12);
    float rim = exp(-max(edge, 0.0) * 18.0) * step(-0.01, edge) * uRing;
    col.rgb += uCol * rim * (0.6 + 0.15 * sin(uTime * 2.0));
    col.a = max(col.a, rim * 0.7);
    // the seal: beads drawn on one after another round the ring, then a ripple as it closes
    vec2 sp = p - vec2(${(W / 2 - 0.36).toFixed(3)}, ${(PHOTO_BOTTOM + 0.36).toFixed(3)});
    float n = 18.0;
    float a = atan(sp.x, sp.y);                       // 0 at the top, clockwise
    float i = floor((a + PI) / (2.0 * PI) * n);
    vec3 seal = vec3(0.0); float sa = 0.0;
    for (int k = -1; k <= 1; k++) {
      float j = mod(i + float(k), n);
      float ang = (j + 0.5) / n * 2.0 * PI - PI;
      float on = smoothstep(j / n, (j + 1.0) / n, uRing * 1.08);
      vec2 c = vec2(sin(ang), cos(ang)) * 0.24;
      float d = length(sp - c);
      float core = smoothstep(0.034, 0.012, d) * on;
      float glow = exp(-d / 0.034 * 1.4) * 0.4 * on;
      seal += uCol * (core * 1.3 + glow);
      sa = max(sa, core + glow);
    }
    float rr = length(sp);
    float closed = smoothstep(0.98, 1.0, uRing);
    float since = (uRing - 1.0) * 3.0;
    float wave = exp(-pow((rr - 0.24 - max(since, 0.0) * 0.5) * 16.0, 2.0)) * closed * exp(-max(since, 0.0) * 2.5);
    seal += uCol * wave; sa = max(sa, wave * 0.6);
    // a dark disc behind the ring, so it reads on a bright photo
    float disc = smoothstep(0.36, 0.3, rr) * uSeal * min(uRing * 3.0, 1.0);
    col.rgb *= 1.0 - 0.65 * disc;
    col.rgb = col.rgb * (1.0 - sa * 0.55 * uSeal) + seal * uSeal;
    col.a = max(col.a, sa * uSeal);
    gl_FragColor = vec4(col.rgb, col.a * uAlpha);
  }
`

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, max: number) {
  do { ctx.font = `${weight} ${size}px ${FONT}` } while (ctx.measureText(text).width > max && --size > 14)
}

/** The waiting frame's canvas; returns the dot centre in plane units. */
function drawPlaceholder(host: string) {
  const canvas = document.createElement('canvas')
  canvas.width = CW; canvas.height = CH
  const ctx = canvas.getContext('2d')!
  roundRect(ctx, 6, 6, CW - 12, CH - 12, 26)
  ctx.fillStyle = 'rgba(4, 18, 15, 0.62)'
  ctx.fill()
  ctx.setLineDash([14, 12]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(141, 255, 191, 0.55)'
  roundRect(ctx, 30, 30, CW - 60, PHOTO_H - 40, 18)
  ctx.stroke()
  ctx.setLineDash([])
  const line = 'Live · waiting for a photo'
  fit(ctx, line, 500, 40, CW - 160)
  const tw = ctx.measureText(line).width
  const x0 = (CW - tw) / 2 + 22, y0 = PHOTO_H / 2 - 4
  ctx.fillStyle = '#e8fff3'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
  ctx.fillText(line, x0, y0)
  ctx.textAlign = 'center'
  ctx.font = `400 26px ${FONT}`
  ctx.fillStyle = 'rgba(200, 235, 220, 0.8)'
  ctx.fillText('Take a photo on the phone', CW / 2, PHOTO_H + 70)
  fit(ctx, `${host}/capture`, 400, 22, CW - 80)
  ctx.font = ctx.font.replace(FONT, 'ui-monospace, SFMono-Regular, Menlo, monospace')
  ctx.fillStyle = 'rgba(141, 255, 191, 0.75)'
  ctx.fillText(`${host}/capture`, CW / 2, PHOTO_H + 120)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const dot = new THREE.Vector2(((x0 - 30) / CW - 0.5) * W, (0.5 - y0 / CH) * H)
  return { tex, dot }
}

/** The arrived photo's canvas: the image cover-cropped, then the verdict. */
function drawCard(a: Arrival, onReady: () => void) {
  const canvas = document.createElement('canvas')
  canvas.width = CW; canvas.height = CH
  const ctx = canvas.getContext('2d')!
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const paint = (img: HTMLImageElement | null) => {
    ctx.clearRect(0, 0, CW, CH)
    roundRect(ctx, 0, 0, CW, CH, 26)
    ctx.fillStyle = '#05130f'
    ctx.fill()
    ctx.save()
    roundRect(ctx, 0, 0, CW, PHOTO_H, 26); ctx.clip()
    if (img) {
      const s = Math.max(CW / img.width, PHOTO_H / img.height)
      ctx.drawImage(img, (CW - img.width * s) / 2, (PHOTO_H - img.height * s) / 2, img.width * s, img.height * s)
    }
    ctx.restore()
    const c = COLOURS[a.status].css
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
    ctx.fillStyle = c
    ctx.beginPath(); ctx.arc(44, PHOTO_H + 72, 12, 0, Math.PI * 2); ctx.fill()
    fit(ctx, a.title, 600, 40, CW - 110)
    ctx.fillText(a.title, 70, PHOTO_H + 72)
    fit(ctx, a.note, 400, 26, CW - 64)
    ctx.fillStyle = 'rgba(220, 235, 230, 0.85)'
    ctx.fillText(a.note, 32, PHOTO_H + 150)
    tex.needsUpdate = true
  }
  const img = new Image()
  img.onload = () => { paint(img); onReady() }
  img.onerror = () => { paint(null); onReady() }
  img.src = a.url
  return tex
}

const ease = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 3)

export class LiveFrame {
  readonly group = new THREE.Group()
  private placeholder: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private card: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null
  private home = new THREE.Vector3()
  private from = new THREE.Vector3()
  private pending: { a: Arrival; ready: boolean } | null = null
  private startedAt = -1
  private visibleSince = -1
  private landed = false
  private onLand: (s: ArrivalStatus) => void

  /** `at`: where the frame stands; `toward`: the point it faces (the visitor's stop); `ahead`: the far end it flies in from. */
  constructor(at: THREE.Vector3, toward: THREE.Vector3, ahead: THREE.Vector3, host: string, onLand: (s: ArrivalStatus) => void) {
    this.onLand = onLand
    this.home.copy(at)
    this.from.copy(ahead)
    const { tex, dot } = drawPlaceholder(host)
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: placeholderFragment,
      uniforms: { uTex: { value: tex }, uTime: { value: 0 }, uAlpha: { value: 1 }, uDot: { value: dot } },
      transparent: true, depthWrite: false,
    })
    this.placeholder = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat)
    this.placeholder.renderOrder = 4
    this.group.position.copy(at)
    const look = toward.clone(); look.y = at.y
    this.group.lookAt(look)
    this.group.add(this.placeholder)
  }

  /** A new photo arrived: it flies in the next time the frame is in view. */
  arrive(a: Arrival) {
    this.clearCard()
    const pending = { a, ready: false }
    this.pending = pending
    const tex = drawCard(a, () => { pending.ready = true })
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: cardFragment,
      uniforms: {
        uTex: { value: tex }, uTime: { value: 0 }, uRing: { value: 0 }, uCap: { value: 0 }, uAlpha: { value: 0 },
        uCol: { value: new THREE.Vector3(...COLOURS[a.status].gl) }, uSeal: { value: a.status === 'grey' ? 0 : 1 },
      },
      transparent: true, depthWrite: false,
    })
    this.card = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat)
    this.card.renderOrder = 5
    this.card.visible = false
    this.group.parent?.add(this.card)
    this.startedAt = -1
    this.landed = false
  }

  /** Back to the empty, waiting frame. */
  reset() {
    this.clearCard()
    this.pending = null
    this.placeholder.material.uniforms.uAlpha.value = 1
  }

  /** `inView`: the visitor is inside this world, so the frame can be seen. */
  update(t: number, inView: boolean) {
    this.placeholder.material.uniforms.uTime.value = t
    this.visibleSince = inView ? (this.visibleSince < 0 ? t : this.visibleSince) : -1
    const card = this.card
    if (!card || !this.pending) return
    if (this.startedAt < 0) {
      // wait until the visitor has been inside for a moment and the image has loaded
      if (!this.pending.ready || this.visibleSince < 0 || t - this.visibleSince < 0.6) return
      this.startedAt = t
      card.visible = true
      if (!card.parent) this.group.parent?.add(card)
    }
    const s = t - this.startedAt
    const fly = ease(s / 1.3)
    const u = card.material.uniforms
    u.uTime.value = t
    u.uAlpha.value = THREE.MathUtils.smoothstep(s, 0, 0.35)
    card.position.lerpVectors(this.from, this.home, fly)
    card.position.y += Math.sin(fly * Math.PI) * 0.6
    card.quaternion.copy(this.group.quaternion)
    card.scale.setScalar(0.25 + 0.75 * fly)
    // nudge it a hair in front of the empty frame so it covers it cleanly
    card.translateZ(0.02)
    u.uRing.value = THREE.MathUtils.clamp((s - 1.1) / 1.2, 0, 2)
    u.uCap.value = THREE.MathUtils.clamp((s - 1.5) / 0.8, 0, 1)
    this.placeholder.material.uniforms.uAlpha.value = 1 - THREE.MathUtils.smoothstep(s, 1.0, 1.4)
    if (!this.landed && s >= 1.3) { this.landed = true; this.onLand(this.pending.a.status) }
  }

  private clearCard() {
    if (!this.card) return
    this.card.removeFromParent()
    this.card.material.uniforms.uTex.value?.dispose()
    this.card.material.dispose()
    this.card.geometry.dispose()
    this.card = null
  }

  dispose() {
    this.clearCard()
    this.placeholder.material.uniforms.uTex.value?.dispose()
    this.placeholder.material.dispose()
    this.placeholder.geometry.dispose()
  }
}
