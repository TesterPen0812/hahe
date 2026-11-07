// A small 2D fluid the pointer stirs, used to ripple the final image like disturbed water.
// It is the classic "stable fluids" method (Jos Stam, 1999): add force where the pointer moves,
// carry the velocity along itself, then remove its divergence with a few pressure iterations so
// it swirls instead of spreading out. It runs on a coarse grid; only the velocity is kept.
import * as THREE from 'three'

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const splatFrag = /* glsl */ `
  uniform sampler2D uVel;
  uniform vec2 uPoint;     // uv
  uniform vec2 uForce;     // uv per second
  uniform float uRadius;
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    vec2 d = (vUv - uPoint) * vec2(uAspect, 1.0);
    vec2 v = texture2D(uVel, vUv).xy + uForce * exp(-dot(d, d) / uRadius);
    gl_FragColor = vec4(v, 0.0, 1.0);
  }
`

const advectFrag = /* glsl */ `
  uniform sampler2D uVel;
  uniform vec2 uTexel;
  uniform float uDt;
  uniform float uKeep;     // fraction of velocity kept per second
  varying vec2 vUv;
  void main() {
    vec2 back = vUv - uDt * texture2D(uVel, vUv).xy;
    gl_FragColor = vec4(texture2D(uVel, back).xy * pow(uKeep, uDt), 0.0, 1.0);
  }
`

const divergenceFrag = /* glsl */ `
  uniform sampler2D uVel;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    float l = texture2D(uVel, vUv - vec2(uTexel.x, 0.0)).x;
    float r = texture2D(uVel, vUv + vec2(uTexel.x, 0.0)).x;
    float b = texture2D(uVel, vUv - vec2(0.0, uTexel.y)).y;
    float t = texture2D(uVel, vUv + vec2(0.0, uTexel.y)).y;
    gl_FragColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
  }
`

const pressureFrag = /* glsl */ `
  uniform sampler2D uPressure;
  uniform sampler2D uDiv;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    float l = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float r = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float b = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float t = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    gl_FragColor = vec4((l + r + b + t - texture2D(uDiv, vUv).x) * 0.25, 0.0, 0.0, 1.0);
  }
`

const projectFrag = /* glsl */ `
  uniform sampler2D uVel;
  uniform sampler2D uPressure;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    float l = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float r = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float b = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float t = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    vec2 v = texture2D(uVel, vUv).xy - 0.5 * vec2(r - l, t - b);
    gl_FragColor = vec4(v, 0.0, 1.0);
  }
`

const clearFrag = /* glsl */ `
  uniform sampler2D uPressure;
  varying vec2 vUv;
  void main() { gl_FragColor = vec4(texture2D(uPressure, vUv).x * 0.8, 0.0, 0.0, 1.0); }
`

type RT = THREE.WebGLRenderTarget

export class Fluid {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private quad: THREE.Mesh
  private vel: [RT, RT]
  private pressure: [RT, RT]
  private div: RT
  private texel = new THREE.Vector2()
  private aspect = 1
  private mats: Record<'splat' | 'advect' | 'divergence' | 'pressure' | 'project' | 'clear', THREE.ShaderMaterial>
  private iterations: number

  constructor(renderer: THREE.WebGLRenderer, lowPower: boolean) {
    this.renderer = renderer
    this.iterations = lowPower ? 8 : 14
    const make = () => new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    })
    this.vel = [make(), make()]
    this.pressure = [make(), make()]
    this.div = make()
    const mat = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader: quadVertex, fragmentShader, uniforms, depthTest: false, depthWrite: false })
    const tx = { value: this.texel }
    this.mats = {
      splat: mat(splatFrag, { uVel: { value: null }, uPoint: { value: new THREE.Vector2() }, uForce: { value: new THREE.Vector2() }, uRadius: { value: 0.0016 }, uAspect: { value: 1 } }),
      advect: mat(advectFrag, { uVel: { value: null }, uTexel: tx, uDt: { value: 0 }, uKeep: { value: 0.35 } }),
      divergence: mat(divergenceFrag, { uVel: { value: null }, uTexel: tx }),
      pressure: mat(pressureFrag, { uPressure: { value: null }, uDiv: { value: null }, uTexel: tx }),
      project: mat(projectFrag, { uVel: { value: null }, uPressure: { value: null }, uTexel: tx }),
      clear: mat(clearFrag, { uPressure: { value: null } }),
    }
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mats.splat)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  /** The velocity field, in uv per second. */
  get texture() { return this.vel[0].texture }

  resize(w: number, h: number) {
    this.aspect = w / h
    const gh = 96, gw = Math.max(16, Math.round(gh * this.aspect))
    for (const t of [...this.vel, ...this.pressure, this.div]) t.setSize(gw, gh)
    this.texel.set(1 / gw, 1 / gh)
    this.mats.splat.uniforms.uAspect.value = this.aspect
  }

  private pass(m: THREE.ShaderMaterial, target: RT) {
    this.quad.material = m
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
  }
  private swapVel() { this.vel.reverse() }
  private swapP() { this.pressure.reverse() }

  /** Push the fluid at `point` (uv) with `force` (uv per second). */
  splat(point: THREE.Vector2, force: THREE.Vector2) {
    const m = this.mats.splat
    m.uniforms.uVel.value = this.vel[0].texture
    m.uniforms.uPoint.value.copy(point)
    m.uniforms.uForce.value.copy(force)
    this.pass(m, this.vel[1]); this.swapVel()
  }

  step(dt: number) {
    const prev = this.renderer.getRenderTarget()
    const a = this.mats.advect
    a.uniforms.uVel.value = this.vel[0].texture
    a.uniforms.uDt.value = Math.min(dt, 1 / 30)
    this.pass(a, this.vel[1]); this.swapVel()

    this.mats.divergence.uniforms.uVel.value = this.vel[0].texture
    this.pass(this.mats.divergence, this.div)

    this.mats.clear.uniforms.uPressure.value = this.pressure[0].texture
    this.pass(this.mats.clear, this.pressure[1]); this.swapP()
    const p = this.mats.pressure
    p.uniforms.uDiv.value = this.div.texture
    for (let i = 0; i < this.iterations; i++) {
      p.uniforms.uPressure.value = this.pressure[0].texture
      this.pass(p, this.pressure[1]); this.swapP()
    }
    const pr = this.mats.project
    pr.uniforms.uVel.value = this.vel[0].texture
    pr.uniforms.uPressure.value = this.pressure[0].texture
    this.pass(pr, this.vel[1]); this.swapVel()
    this.renderer.setRenderTarget(prev)
  }

  dispose() {
    for (const t of [...this.vel, ...this.pressure, this.div]) t.dispose()
    for (const m of Object.values(this.mats)) m.dispose()
    this.quad.geometry.dispose()
  }
}
