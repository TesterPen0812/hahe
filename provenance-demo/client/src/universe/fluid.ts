import * as THREE from 'three'

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const common = /* glsl */ `
  uniform sampler2D uSource;
  uniform sampler2D uVelocity;
  uniform sampler2D uAux;
  uniform sampler2D uDye;
  uniform vec2 uTexel;
  uniform float uDt;
  varying vec2 vUv;
`
const splat = /* glsl */ `
  uniform vec2 uStart, uEnd, uForce;
  uniform float uAspect, uAmount, uIsDye;
  void main() {
    vec2 aspect = vec2(uAspect, 1.0);
    vec2 delta = (uEnd - uStart) * aspect;
    vec2 rel = (vUv - uStart) * aspect;
    float at = clamp(dot(rel, delta) / max(dot(delta, delta), 1e-8), 0.0, 1.0);
    vec2 across = rel - delta * at;
    float capsule = exp(-dot(across, across) / (0.025 * 0.025));
    vec2 value = texture2D(uSource, vUv).xy;
    if (uIsDye > 0.5) value = vec2(min(value.x + capsule * uAmount, 1.0), 0.0);
    else value = clamp(value + uForce * capsule, vec2(-500.0), vec2(500.0));
    gl_FragColor = vec4(value, 0.0, 1.0);
  }
`
const advect = /* glsl */ `
  uniform float uDecay;
  void main() {
    vec2 back = vUv - texture2D(uVelocity, vUv).xy * uTexel * uDt;
    gl_FragColor = vec4(texture2D(uSource, back).xy * exp(-uDecay * uDt), 0.0, 1.0);
  }
`
const curl = /* glsl */ `
  void main() {
    float l = texture2D(uVelocity, vUv - vec2(uTexel.x, 0)).y;
    float r = texture2D(uVelocity, vUv + vec2(uTexel.x, 0)).y;
    float b = texture2D(uVelocity, vUv - vec2(0, uTexel.y)).x;
    float t = texture2D(uVelocity, vUv + vec2(0, uTexel.y)).x;
    gl_FragColor = vec4(0.5 * (r - l - t + b), 0, 0, 1);
  }
`
const vorticity = /* glsl */ `
  void main() {
    float l = texture2D(uAux, vUv - vec2(uTexel.x, 0)).x;
    float r = texture2D(uAux, vUv + vec2(uTexel.x, 0)).x;
    float b = texture2D(uAux, vUv - vec2(0, uTexel.y)).x;
    float t = texture2D(uAux, vUv + vec2(0, uTexel.y)).x;
    float c = texture2D(uAux, vUv).x;
    vec2 force = 0.5 * vec2(abs(t) - abs(b), abs(r) - abs(l));
    force = force / (length(force) + 0.0001) * 12.0 * c * vec2(1, -1);
    gl_FragColor = vec4(clamp(texture2D(uVelocity, vUv).xy + force * uDt, vec2(-500), vec2(500)), 0, 1);
  }
`
const divergence = /* glsl */ `
  void main() {
    vec2 c = texture2D(uVelocity, vUv).xy;
    float l = texture2D(uVelocity, vUv - vec2(uTexel.x, 0)).x;
    float r = texture2D(uVelocity, vUv + vec2(uTexel.x, 0)).x;
    float b = texture2D(uVelocity, vUv - vec2(0, uTexel.y)).y;
    float t = texture2D(uVelocity, vUv + vec2(0, uTexel.y)).y;
    if (vUv.x < uTexel.x) l = -c.x;
    if (vUv.x > 1.0 - uTexel.x) r = -c.x;
    if (vUv.y < uTexel.y) b = -c.y;
    if (vUv.y > 1.0 - uTexel.y) t = -c.y;
    gl_FragColor = vec4(0.5 * (r - l + t - b), 0, 0, 1);
  }
`
const pressure = /* glsl */ `
  void main() {
    float l = texture2D(uSource, vUv - vec2(uTexel.x, 0)).x;
    float r = texture2D(uSource, vUv + vec2(uTexel.x, 0)).x;
    float b = texture2D(uSource, vUv - vec2(0, uTexel.y)).x;
    float t = texture2D(uSource, vUv + vec2(0, uTexel.y)).x;
    gl_FragColor = vec4((l + r + b + t - texture2D(uAux, vUv).x) * 0.25, 0, 0, 1);
  }
`
const project = /* glsl */ `
  void main() {
    float l = texture2D(uAux, vUv - vec2(uTexel.x, 0)).x;
    float r = texture2D(uAux, vUv + vec2(uTexel.x, 0)).x;
    float b = texture2D(uAux, vUv - vec2(0, uTexel.y)).x;
    float t = texture2D(uAux, vUv + vec2(0, uTexel.y)).x;
    gl_FragColor = vec4(texture2D(uVelocity, vUv).xy - vec2(r - l, t - b) * 0.5, 0, 1);
  }
`
const displace = /* glsl */ `
  void main() {
    float wet = smoothstep(0.0, 0.2, texture2D(uDye, vUv).x);
    vec2 offset = uDt * 0.45 * wet * texture2D(uVelocity, vUv).xy * uTexel;
    float decay = exp(-1.8 * uDt);
    vec2 d = (texture2D(uSource, vUv - offset).xy - offset) * mix(decay * decay * decay, decay, wet);
    gl_FragColor = vec4(clamp(d, vec2(-0.08), vec2(0.08)), 0, 1);
  }
`

type RT = THREE.WebGLRenderTarget
type Pair = [RT, RT]

export class Fluid {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private quad: THREE.Mesh
  private vel: Pair
  private dye: Pair
  private displacement: Pair
  private pressure: Pair
  private div: RT
  private curl: RT
  readonly texel = new THREE.Vector2()
  private aspect = 1
  private gridHeight: number
  private iterations: number
  private mats: Record<'splat' | 'advect' | 'curl' | 'vorticity' | 'divergence' | 'pressure' | 'project' | 'displace', THREE.ShaderMaterial>

  constructor(renderer: THREE.WebGLRenderer, lowPower: boolean) {
    this.renderer = renderer
    this.gridHeight = lowPower ? 72 : 96
    this.iterations = lowPower ? 8 : 14
    const make = () => new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    })
    this.vel = [make(), make()]; this.dye = [make(), make()]
    this.displacement = [make(), make()]; this.pressure = [make(), make()]
    this.div = make(); this.curl = make()
    const mat = (fragment: string) => new THREE.ShaderMaterial({
      vertexShader, fragmentShader: common + fragment, depthTest: false, depthWrite: false,
      uniforms: {
        uSource: { value: null }, uVelocity: { value: null }, uAux: { value: null }, uDye: { value: null },
        uTexel: { value: this.texel }, uDt: { value: 0 }, uDecay: { value: 1.5 },
        uStart: { value: new THREE.Vector2() }, uEnd: { value: new THREE.Vector2() },
        uForce: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uAmount: { value: 0 }, uIsDye: { value: 0 },
      },
    })
    this.mats = { splat: mat(splat), advect: mat(advect), curl: mat(curl), vorticity: mat(vorticity), divergence: mat(divergence), pressure: mat(pressure), project: mat(project), displace: mat(displace) }
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mats.splat)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  get texture() { return this.vel[0].texture }
  get dyeTexture() { return this.dye[0].texture }
  get displacementTexture() { return this.displacement[0].texture }
  private targets() { return [...this.vel, ...this.dye, ...this.displacement, ...this.pressure, this.div, this.curl] }

  resize(w: number, h: number) {
    this.aspect = w / h
    const gh = this.gridHeight, gw = Math.max(16, Math.min(384, Math.round(gh * this.aspect)))
    if (this.vel[0].width === gw && this.vel[0].height === gh) return
    for (const target of this.targets()) target.setSize(gw, gh)
    this.texel.set(1 / gw, 1 / gh)
    this.clear()
  }

  clear() {
    const previous = this.renderer.getRenderTarget()
    const color = this.renderer.getClearColor(new THREE.Color()), alpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(0, 0)
    for (const target of this.targets()) { this.renderer.setRenderTarget(target); this.renderer.clear() }
    this.renderer.setClearColor(color, alpha)
    this.renderer.setRenderTarget(previous)
  }

  private pass(m: THREE.ShaderMaterial, target: RT) {
    this.quad.material = m
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
  }
  private swap(pair: Pair) { pair.reverse() }

  /** Capsule splats prevent gaps on quick sweeps. Calling this never leaks a render target. */
  splat(start: THREE.Vector2, end: THREE.Vector2, dt: number) {
    const previous = this.renderer.getRenderTarget()
    const u = this.mats.splat.uniforms
    u.uStart.value.copy(start); u.uEnd.value.copy(end); u.uAspect.value = this.aspect
    const delta = end.clone().sub(start)
    u.uForce.value.copy(delta).divide(this.texel).divideScalar(Math.max(dt, 1 / 120)).clampLength(0, 240).multiplyScalar(0.3)
    u.uAmount.value = Math.min(0.8, delta.length() * 22)
    u.uSource.value = this.vel[0].texture; u.uIsDye.value = 0
    this.pass(this.mats.splat, this.vel[1]); this.swap(this.vel)
    u.uSource.value = this.dye[0].texture; u.uIsDye.value = 1
    this.pass(this.mats.splat, this.dye[1]); this.swap(this.dye)
    this.renderer.setRenderTarget(previous)
  }

  step(dt: number) {
    const previous = this.renderer.getRenderTarget()
    dt = Math.min(Math.max(dt, 0), 1 / 30)
    for (const m of Object.values(this.mats)) { m.uniforms.uDt.value = dt; m.uniforms.uVelocity.value = this.vel[0].texture }
    const a = this.mats.advect
    a.uniforms.uSource.value = this.vel[0].texture; a.uniforms.uDecay.value = 1.3
    this.pass(a, this.vel[1]); this.swap(this.vel)
    this.mats.curl.uniforms.uVelocity.value = this.vel[0].texture
    this.pass(this.mats.curl, this.curl)
    this.mats.vorticity.uniforms.uVelocity.value = this.vel[0].texture
    this.mats.vorticity.uniforms.uAux.value = this.curl.texture
    this.pass(this.mats.vorticity, this.vel[1]); this.swap(this.vel)
    this.mats.divergence.uniforms.uVelocity.value = this.vel[0].texture
    this.pass(this.mats.divergence, this.div)
    // Pressure starts at zero every solve: no stale impulse after resize or a world handoff.
    const clearColor = this.renderer.getClearColor(new THREE.Color()), clearAlpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(0, 0)
    this.renderer.setRenderTarget(this.pressure[0]); this.renderer.clearColor()
    this.renderer.setClearColor(clearColor, clearAlpha)
    const p = this.mats.pressure
    p.uniforms.uAux.value = this.div.texture
    for (let i = 0; i < this.iterations; i++) {
      p.uniforms.uSource.value = this.pressure[0].texture
      this.pass(p, this.pressure[1]); this.swap(this.pressure)
    }
    this.mats.project.uniforms.uVelocity.value = this.vel[0].texture
    this.mats.project.uniforms.uAux.value = this.pressure[0].texture
    this.pass(this.mats.project, this.vel[1]); this.swap(this.vel)
    a.uniforms.uVelocity.value = this.vel[0].texture
    a.uniforms.uSource.value = this.dye[0].texture; a.uniforms.uDecay.value = 2.2
    this.pass(a, this.dye[1]); this.swap(this.dye)
    const d = this.mats.displace.uniforms
    d.uSource.value = this.displacement[0].texture; d.uDye.value = this.dye[0].texture; d.uVelocity.value = this.vel[0].texture
    this.pass(this.mats.displace, this.displacement[1]); this.swap(this.displacement)
    this.renderer.setRenderTarget(previous)
  }

  dispose() {
    for (const target of this.targets()) target.dispose()
    for (const m of Object.values(this.mats)) m.dispose()
    this.quad.geometry.dispose()
  }
}
