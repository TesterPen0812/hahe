import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { TRAIL_LENGTH, WAKE_STAMPS, finishShader } from './shaders'
import {
  DOOR, UNIVERSES, type RGB, cloud, gateWall, glowingPath, homeHeight, portal, sceneUniforms,
  universeScene, type SceneUniforms, type UniverseDef,
} from './worlds'
import { buildMeadow, qdayGate } from './scenery'
import { buildGallery, type Gallery, type GalleryPhoto } from './gallery'

export type Phase = 'trunk' | 'fork' | 'branch' | 'inside'
export interface EngineState {
  phase: Phase
  branch: number | null     // branch being walked or entered
  hovered: number | null    // portal under the pointer / keyboard focus at the fork
  qday: boolean             // camera is past the Q-Day gate
  started: boolean          // the visitor has moved off the start
}
export interface EngineCallbacks {
  onState: (s: EngineState) => void
  onQDay: (crossed: boolean) => void
}
export type LabelId = 'today' | 'qday' | 'u0' | 'u1' | 'u2'

/** The worlds behind the gate. For now there is one door: into the world that went hybrid. */
export const ACTIVE_UNIVERSES = UNIVERSES.filter(u => u.id === 'hybrid')

const EYE = 1.7
const TRAIL_MS = 16

interface Universe {
  def: UniverseDef
  scene: THREE.Scene
  u: SceneUniforms
  rt: THREE.WebGLRenderTarget
  door: ReturnType<typeof portal>
  cam: THREE.PerspectiveCamera
  curve: THREE.CatmullRomCurve3
  len: number
  base: number
  open: number
  hover: number
  rtScale: number
  wall: THREE.Points
}

const v2 = (x: number, z: number) => new THREE.Vector3(x, 0, z)

export class UniverseEngine {
  private canvas = document.createElement('canvas')
  private renderer: THREE.WebGLRenderer
  private composer: EffectComposer
  private renderPass: RenderPass
  private bloom: UnrealBloomPass
  private finish: ShaderPass
  private camera = new THREE.PerspectiveCamera(55, 1, 0.05, 900)
  private home = new THREE.Scene()
  private homeU = sceneUniforms()
  private universes: Universe[] = []
  private trunk = new THREE.CatmullRomCurve3([v2(0, 8), v2(1.4, -6), v2(-1.6, -20), v2(1.2, -34), v2(-0.6, -46), v2(0, -58)], false, 'centripetal')
  private L0: number
  private gateD: number
  private gateCurtain: THREE.Points
  private homePath: THREE.Points
  private gallery: Gallery | null = null

  // travel state
  private seg = -1
  private d = 0
  private v = 0
  private keys = new Set<string>()
  private target: { seg: number; d: number } | null = { seg: -1, d: 6 }
  private selected: number | null = null
  private hovered: number | null = null
  private qdayAt = -1
  private flash = 0
  private flashColor = new THREE.Color(1, 1, 1)
  private wasInside = -1

  private exposure = 0.95
  private wake = Array.from({ length: WAKE_STAMPS }, () => new THREE.Vector4(-9, -9, 0, 0))
  private wasDown = false
  private flashedQday = -1
  private zoom = 0

  // pointer
  private ndc = new THREE.Vector2(0, 0)
  private look = new THREE.Vector2(0, 0)
  private trail: { x: number; z: number; t: number }[] = []
  private lastTrail = 0
  private down: { x: number; y: number } | null = null
  private touchY: number | null = null

  private startedAt = performance.now()
  private lastFrame = performance.now()
  private raf = 0
  private disposed = false
  private labels = new Map<LabelId, HTMLElement>()
  private lastState = ''
  private lowPower: boolean
  private reducedMotion: boolean
  private raycaster = new THREE.Raycaster()
  private frustum = new THREE.Frustum()
  private projScreen = new THREE.Matrix4()
  private host: HTMLElement
  private cb: EngineCallbacks
  private resizeObserver: ResizeObserver

  constructor(host: HTMLElement, cb: EngineCallbacks) {
    this.host = host
    this.cb = cb
    this.lowPower = Math.min(window.innerWidth, window.innerHeight) < 700 || (navigator.hardwareConcurrency ?? 8) <= 4
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    this.canvas.className = 'uv-canvas'
    host.appendChild(this.canvas)

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = this.exposure
    this.renderer.setClearColor(0x020308, 1)

    this.L0 = this.trunk.getLength()
    this.gateD = this.L0 - 9

    this.buildHome()
    this.buildUniverses()
    this.gateCurtain = this.buildGate()
    this.homePath = this.buildPaths()

    this.renderPass = new RenderPass(this.home, this.camera)
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(this.renderPass)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.lowPower ? 0.55 : 0.7, 0.5, 0.58)
    this.composer.addPass(this.bloom)
    // Tone map first, then finish in display space so grain and dither sit on the final image.
    this.composer.addPass(new OutputPass())
    this.finish = new ShaderPass(finishShader)
    this.finish.uniforms.uFlashColor.value = this.flashColor
    this.finish.uniforms.uWake.value = this.wake
    this.composer.addPass(this.finish)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    this.resize()
    this.bind()
    this.placeCamera(1)
    this.raf = requestAnimationFrame(this.frame)
  }

  // ── public API ────────────────────────────────────────────────────────────

  setLabel(id: LabelId, el: HTMLElement | null) {
    if (el) this.labels.set(id, el)
    else this.labels.delete(id)
  }

  /** Walk into a universe. */
  choose(branch: number) {
    if (!this.pastGate()) {
      this.target = { seg: -1, d: this.L0 }
      this.selected = branch
      return
    }
    this.selected = branch
    this.target = { seg: branch, d: this.universes[branch].len + 14 }
  }

  /** A short glow when a new photo lands in the world the visitor is standing in. */
  celebrate(status: 'green' | 'amber' | 'grey') {
    const c = status === 'green' ? [0.3, 1, 0.6] : status === 'amber' ? [1, 0.7, 0.25] : [0.7, 0.72, 0.8]
    this.flashColor.setRGB(c[0], c[1], c[2])
    this.flash = Math.max(this.flash, 0.22)
  }

  /** Hang real photos from the feed along the path to our door; Q-Day's wave tests their seals. */
  setGallery(photos: GalleryPhoto[]) {
    if (this.gallery) { this.home.remove(this.gallery.group); this.gallery.dispose(); this.gallery = null }
    if (!photos.length || !this.universes[0]) return
    this.gallery = buildGallery(photos, this.universes[0].curve)
    this.home.add(this.gallery.group)
  }

  /** Walk back to the fork. */
  back() { this.target = { seg: -1, d: this.L0 } }

  /** Walk back to today, before Q-Day. */
  rewind() { this.selected = null; this.target = { seg: -1, d: 5 } }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.unbind()
    const scenes = [this.home, ...this.universes.map(u => u.scene)]
    for (const s of scenes) {
      s.traverse(o => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach(x => x.dispose())
        else mat?.dispose()
      })
    }
    this.gallery?.dispose()
    this.universes.forEach(u => u.rt.dispose())
    this.composer.dispose()
    this.renderer.dispose()
    this.canvas.remove()
  }

  // ── scene construction ───────────────────────────────────────────────────

  private buildHome() {
    buildMeadow(this.home, this.homeU, this.lowPower)
  }

  private buildUniverses() {
    // Branches fan out from the end of the trunk (the fork) to three doors.
    const fork = this.trunk.getPointAt(1)
    const fan = {
      rsa: [v2(fork.x, fork.z), v2(-3.2, -64), v2(-9, -72), v2(-13, -82)],
      hybrid: [v2(fork.x, fork.z), v2(0, -66), v2(0, -76), v2(0, -88)],
      unsigned: [v2(fork.x, fork.z), v2(3.2, -64), v2(9, -72), v2(13, -82)],
    }
    const ends = ACTIVE_UNIVERSES.map(u => fan[u.id])
    ACTIVE_UNIVERSES.forEach((def, i) => {
      const curve = new THREE.CatmullRomCurve3(ends[i], false, 'centripetal')
      const end = curve.getPointAt(1)
      const tan = curve.getTangentAt(1).setY(0).normalize()
      const base = homeHeight(end.x, end.z)
      const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType })
      const door = portal(def.tint, rt)
      door.group.position.set(end.x, base, end.z)
      door.group.lookAt(end.x - tan.x, base, end.z - tan.z) // +z faces the visitor; -z leads into the universe
      door.group.updateMatrixWorld(true)
      this.home.add(door.group)
      // the long wall of dust the round gate is cut into, placed in world space
      const w = gateWall(def.tint, this.lowPower)
      const tmp = new THREE.Vector3()
      for (let k = 0; k < w.pos.length; k += 3) {
        tmp.set(w.pos[k], w.pos[k + 1], w.pos[k + 2]).applyMatrix4(door.group.matrixWorld)
        w.pos.set([tmp.x, tmp.y, tmp.z], k)
      }
      const wall = cloud(this.homeU, w.pos, w.col, w.size, 9, [10, 95], 61, 0)
      this.home.add(wall)
      const u = sceneUniforms()
      this.universes.push({
        def, u, rt, door, curve, base, open: 0, hover: 0, rtScale: RT_SCALE, wall,
        len: curve.getLength(),
        scene: universeScene(def, u, this.lowPower),
        cam: new THREE.PerspectiveCamera(55, 1, 0.05, 900),
      })
    })
  }

  private buildGate() {
    // A curtain of hanging light across the path: the moment Q-Day arrives.
    const p = this.trunk.getPointAt(this.gateD / this.L0)
    const tan = this.trunk.getTangentAt(this.gateD / this.L0).setY(0).normalize()
    const center = new THREE.Vector3(p.x, homeHeight(p.x, p.z) + 4.6, p.z)
    const gate = qdayGate(this.homeU, center, tan, this.lowPower)
    this.home.add(gate)
    return gate
  }

  private buildPaths() {
    const fork = this.trunk.getPointAt(1)
    const gate = this.trunk.getPointAt(this.gateD / this.L0)
    const tan = this.trunk.getTangentAt(this.gateD / this.L0)
    const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize()
    const dens = this.lowPower ? 70 : 140
    const path = glowingPath(this.homeU, [
      { curve: this.trunk, branch: 0, density: dens },
      ...this.universes.map((u, i) => ({ curve: u.curve, branch: i + 1, density: dens })),
      // the Q-Day threshold line across the path
      { curve: new THREE.LineCurve3(gate.clone().addScaledVector(side, -5.6), gate.clone().addScaledVector(side, 5.6)), branch: 0, density: 60 },
    ], [0, 1, 2].map(i => (this.universes[i] ?? this.universes[0]).def.tint) as [RGB, RGB, RGB], 9, 130, homeHeight)
    void fork
    this.home.add(path)
    return path
  }

  // ── input ────────────────────────────────────────────────────────────────

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.target = null
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
    this.v = THREE.MathUtils.clamp(this.v + dy * 0.011, -14, 14)
  }
  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return
    const k = e.key.toLowerCase()
    if (['w', 's', 'arrowup', 'arrowdown'].includes(k)) { this.keys.add(k); this.target = null; e.preventDefault() }
    if (this.atFork() || this.seg >= 0) {
      const n = Number(k)
      if (n >= 1 && n <= this.universes.length) this.choose(n - 1)
      if (k === 'arrowleft') this.hovered = Math.max(0, (this.hovered ?? 0) - 1)
      if (k === 'arrowright') this.hovered = Math.min(this.universes.length - 1, (this.hovered ?? 0) + 1)
      if (k === 'enter' && this.hovered !== null) this.choose(this.hovered)
    }
    if (k === 'escape' && this.seg >= 0) this.back()
  }
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()) }
  private onPointerMove = (e: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    const now = performance.now()
    if (now - this.lastTrail > TRAIL_MS) {
      this.lastTrail = now
      const hit = this.groundHit()
      if (hit) {
        this.trail.unshift({ x: hit.x, z: hit.z, t: now })
        if (this.trail.length > TRAIL_LENGTH) this.trail.length = TRAIL_LENGTH
      }
    }
  }
  private onPointerDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY } }
  private onPointerUp = (e: PointerEvent) => {
    if (!this.down) return
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y)
    this.down = null
    if (moved < 8 && this.hovered !== null && this.pastGate() && this.seg < 0) this.choose(this.hovered)
  }
  private onTouchStart = (e: TouchEvent) => { this.touchY = e.touches[0]?.clientY ?? null }
  private onTouchMove = (e: TouchEvent) => {
    const y = e.touches[0]?.clientY
    if (y === undefined || this.touchY === null) return
    e.preventDefault()
    this.target = null
    this.v = THREE.MathUtils.clamp(this.v + (this.touchY - y) * 0.05, -14, 14)
    this.touchY = y
  }
  private onBlur = () => this.keys.clear()

  private bind() {
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: true })
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }
  private unbind() {
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('touchstart', this.onTouchStart)
    this.canvas.removeEventListener('touchmove', this.onTouchMove)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }

  // ── travel ───────────────────────────────────────────────────────────────

  private route() { return this.seg < 0 ? this.d : this.L0 + this.d }
  private pastGate() { return this.route() >= this.gateD }
  private atFork() { return this.seg < 0 && this.d >= this.L0 - 0.6 }
  private insideIndex() { return this.seg >= 0 && this.d > this.universes[this.seg].len ? this.seg : -1 }

  private travel(dt: number, t: number) {
    const before = this.route()
    const fwd = this.keys.has('w') || this.keys.has('arrowup')
    const bwd = this.keys.has('s') || this.keys.has('arrowdown')

    if (this.target) {
      const tg = this.target
      if (this.seg < 0 && tg.seg >= 0) this.selected = tg.seg
      const goal = this.seg >= 0 && tg.seg !== this.seg ? this.L0 : (tg.seg < 0 ? tg.d : this.L0 + tg.d)
      const err = goal - before
      const want = THREE.MathUtils.clamp(err * 1.3, -15, 15)
      this.v += (want - this.v) * Math.min(1, dt * 3)
      if (Math.abs(err) < 0.04 && (tg.seg === this.seg || (tg.seg < 0 && this.seg < 0))) { this.target = null; this.v = 0 }
    } else if (fwd || bwd) {
      this.v = THREE.MathUtils.clamp(this.v + (fwd ? 16 : -16) * dt, -9, 9)
    } else {
      this.v *= Math.exp(-dt * 2.4)
    }

    let r = before + this.v * dt
    if (this.seg < 0) {
      if (r < 0) { r = 0; this.v = Math.max(0, this.v) }
      if (r >= this.L0) {
        // With a single door there is nothing to choose: keep walking straight through it.
        if (this.selected === null && this.universes.length === 1) this.selected = 0
        const b = this.selected
        if (b !== null && this.universes[b].open > 0.6) { this.seg = b; this.d = r - this.L0 }
        else { this.d = this.L0; this.v = Math.min(0, this.v) }
      } else this.d = r
    }
    if (this.seg >= 0) {
      let d = this.seg >= 0 && r >= this.L0 ? r - this.L0 : -1
      if (d < 0) {
        // walked back past the fork
        this.seg = -1
        this.selected = null
        this.d = Math.max(0, r)
      } else {
        const u = this.universes[this.seg]
        // a door that hasn't opened can't be walked through
        if (u.open < 0.95 && d > u.len - 1.2) { d = u.len - 1.2; this.v = Math.min(0, this.v) }
        if (d > u.len + 22) { d = u.len + 22; this.v = Math.min(0, this.v) }
        this.d = d
      }
    }

    // Q-Day gate crossings
    const after = this.route()
    if (before < this.gateD && after >= this.gateD) {
      this.qdayAt = t
      const g = this.trunk.getPointAt(this.gateD / this.L0)
      this.homeU.uShock.value.set(g.x, g.z, t, this.reducedMotion ? 0.35 : 1)
      this.cb.onQDay(true)
    } else if (before >= this.gateD && after < this.gateD) {
      this.qdayAt = -1
      this.cb.onQDay(false)
    }
  }

  /** Point on the walk for (segment, distance); extends straight through a door into its universe. */
  private pointAt(seg: number, d: number, out = new THREE.Vector3()) {
    if (seg < 0) return this.trunk.getPointAt(THREE.MathUtils.clamp(d / this.L0, 0, 1), out)
    const u = this.universes[seg]
    if (d <= u.len) return u.curve.getPointAt(Math.max(0, d / u.len), out)
    const end = u.curve.getPointAt(1, out)
    const tan = u.curve.getTangentAt(1).setY(0).normalize()
    return end.addScaledVector(tan, d - u.len)
  }

  private groundAt(seg: number, d: number) {
    const p = this.pointAt(seg, d)
    if (seg >= 0) {
      const u = this.universes[seg]
      if (d >= u.len) return u.base
      // ease into the doorway's floor height so there's no step at the threshold
      const k = THREE.MathUtils.smoothstep(d, u.len - 6, u.len)
      return THREE.MathUtils.lerp(this.smoothHeight(seg, d, p), u.base, k)
    }
    return this.smoothHeight(seg, d, p)
  }

  private smoothHeight(seg: number, d: number, p: THREE.Vector3) {
    const a = this.pointAt(seg, d - 2), b = this.pointAt(seg, d + 2)
    return (homeHeight(a.x, a.z) + homeHeight(p.x, p.z) * 2 + homeHeight(b.x, b.z)) / 4
  }

  private tmpM = new THREE.Matrix4()
  private tmpQ = new THREE.Quaternion()
  private tmpE = new THREE.Euler(0, 0, 0, 'YXZ')

  private placeCamera(blend: number) {
    const seg = this.seg, d = this.d
    // On a portrait screen the camera stands back from the fork so all three doors fit.
    const pull = seg < 0 && this.camera.aspect < 0.8 && this.universes.length > 1 ? THREE.MathUtils.smoothstep(d, this.L0 - 20, this.L0) * 15 : 0
    const pos = this.pointAt(seg, d - pull)
    pos.y = this.groundAt(seg, d - pull) + EYE + Math.sin(this.d * 1.6) * 0.025 * Math.min(1, Math.abs(this.v) / 4)

    let target: THREE.Vector3
    if (seg < 0) {
      const ahead = this.pointAt(-1, d + 7)
      ahead.y = this.groundAt(-1, Math.min(d + 7, this.L0)) + EYE - 0.55
      // Near the fork, turn to take in all three doors.
      const k = THREE.MathUtils.smoothstep(d, this.L0 - 14, this.L0)
      const mid = this.universes[Math.floor(this.universes.length / 2)]
      const focus = new THREE.Vector3(mid.door.group.position.x, mid.base + 2.6, mid.door.group.position.z + 4)
      target = ahead.lerp(focus, k * 0.85)
    } else {
      const u = this.universes[seg]
      const ahead = this.pointAt(seg, d + 7)
      ahead.y = (d + 7 >= u.len ? u.base : this.groundAt(seg, d + 7)) + EYE - (d < u.len ? 0.45 : 0)
      target = ahead
    }

    this.tmpM.lookAt(pos, target, THREE.Object3D.DEFAULT_UP)
    this.tmpQ.setFromRotationMatrix(this.tmpM)
    // The view leans gently toward the pointer.
    this.tmpE.set(this.look.y * 0.1, -this.look.x * 0.2, 0)
    this.tmpQ.multiply(new THREE.Quaternion().setFromEuler(this.tmpE))
    this.camera.position.copy(pos)
    this.camera.quaternion.slerp(this.tmpQ, blend)
    this.camera.updateMatrixWorld()
  }

  // ── per-frame ────────────────────────────────────────────────────────────

  private frame = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    const now = performance.now()
    this.adapt(now - this.lastFrame)
    const dt = Math.min((now - this.lastFrame) / 1000, 1 / 20)
    this.lastFrame = now
    const t = (now - this.startedAt) / 1000

    this.look.lerp(this.ndc, 1 - Math.exp(-dt * 5))
    this.travel(dt, t)
    this.placeCamera(1 - Math.exp(-dt * 6))
    this.updateDoors(dt, t)
    this.updateUniforms(t, dt)
    this.updateLabels()
    this.emitState()
    this.render()
  }

  // Adaptive resolution: drop quality quickly when frames run long, recover it slowly.
  private quality = 1
  private perf = { sum: 0, n: 0, good: 0 }
  private adapt(ms: number) {
    if (ms > 250) return // tab was hidden or paused; not a real frame
    const p = this.perf
    p.sum += ms; p.n++
    if (p.sum < 1000) return
    const avg = p.sum / p.n
    p.sum = 0; p.n = 0
    if (avg > 21 && this.quality > 0.55) {
      this.quality = Math.max(0.55, this.quality * 0.82); p.good = 0; this.resize()
    } else if (avg < 15.5 && this.quality < 1) {
      if (++p.good >= 3) { this.quality = Math.min(1, this.quality * 1.12); p.good = 0; this.resize() }
    } else p.good = 0
  }

  private updateDoors(dt: number, t: number) {
    const past = this.pastGate()
    const since = this.qdayAt < 0 ? 99 : t - this.qdayAt
    // Hover by pointer (raycast) when we're on the home side past the gate.
    if (past && this.insideIndex() < 0 && this.seg < 0) {
      this.raycaster.setFromCamera(this.ndc, this.camera)
      const hits = this.raycaster.intersectObjects(this.universes.map(u => u.door.content), false)
      const idx = hits.length ? this.universes.findIndex(u => u.door.content === hits[0].object) : -1
      if (idx >= 0) this.hovered = idx
      else if (this.hovered !== null && !this.atFork()) this.hovered = null
      this.canvas.style.cursor = idx >= 0 ? 'pointer' : ''
    } else this.canvas.style.cursor = ''

    this.universes.forEach((u, i) => {
      let want = 0
      if (past) {
        if (this.seg < 0) want = since > 0.9 + i * 0.45 ? 1 : 0
        else want = this.seg === i ? 1 : 0.3
      }
      u.open += (want - u.open) * Math.min(1, dt * (want > u.open ? 1.5 : 3))
      const hov = (this.hovered === i && this.seg < 0) || this.seg === i ? 1 : 0
      u.hover += (hov - u.hover) * Math.min(1, dt * 5)
      const m = u.door.contentMat.uniforms
      m.uOpen.value = u.open
      m.uHover.value = u.hover
      m.uTime.value = t
      // Walking up to the door, the opening widens until it fills the view, so stepping
      // through is one continuous move instead of a cut.
      const e = this.seg !== i ? 0 : this.d >= u.len ? 1 : THREE.MathUtils.smoothstep(this.d, u.len - 8, u.len - 0.3)
      m.uEnter.value = e
      u.door.content.scale.setScalar(1 + e * e * 4)
      ;(u.wall.material as THREE.ShaderMaterial).uniforms.uOpacity.value = u.open * (1 - e * 0.7)
      // render the world behind the door at full resolution once it's about to fill the screen
      const rtWant = this.seg === i && this.d > u.len - 10 ? 1 : RT_SCALE
      if (rtWant !== u.rtScale) { u.rtScale = rtWant; this.resize() }
    })
    if (this.gallery) this.gallery.update(t, this.qdayAt, this.trunk.getPointAt(this.gateD / this.L0))
    const gains = this.homePath.material as THREE.ShaderMaterial
    const g = gains.uniforms.uBranchGain.value as THREE.Vector3
    const sel = this.seg >= 0 ? this.seg : this.hovered
    g.set(...([0, 1, 2].map(i => (sel === null ? (past ? 1 : 0.55) : sel === i ? 1.25 : 0.35)) as [number, number, number]))
    const curtain = (this.gateCurtain.material as THREE.ShaderMaterial).uniforms.uOpacity
    // the curtain starts to part as you walk up to it, so you pass through an opening, not a wall
    const near = this.route() >= this.gateD - 7
    curtain.value += ((near ? 0.12 : 0.55) - curtain.value) * Math.min(1, dt * 1.3)
  }

  private updateUniforms(t: number, dt: number) {
    const inside = this.insideIndex()
    const pr = this.renderer.getPixelRatio()
    const all = [this.homeU, ...this.universes.map(u => u.u)]
    for (const u of all) u.uTime.value = t
    this.homeU.uPixelRatio.value = pr
    this.universes.forEach((u, i) => { u.u.uPixelRatio.value = i === inside ? pr : pr * u.rtScale })
    this.updateLens(inside)

    // Pointer trail goes to whichever world the camera is in.
    const now = performance.now()
    const active = inside >= 0 ? this.universes[inside].u : this.homeU
    for (const u of all) {
      const arr = u.uTrail.value
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        const e = u === active ? this.trail[i] : undefined
        if (e) arr[i].set(e.x, e.z, (now - e.t) / 1000, 1)
        else arr[i].set(0, 0, 99, 0)
      }
    }
    // A click (press without drag) sends a ring of light across the ground.
    const pressed = this.down !== null
    if (pressed && !this.wasDown) {
      const hit = this.groundHit()
      if (hit) active.uPulse.value.set(hit.x, hit.z, t, this.reducedMotion ? 0.4 : 1)
    }
    this.wasDown = pressed
    this.updateWake(now, inside)

    // Q-Day lands with a cold violet flash and a jolt of zoom.
    if (this.qdayAt >= 0 && this.flashedQday !== this.qdayAt) {
      this.flashedQday = this.qdayAt
      this.flash = Math.max(this.flash, this.reducedMotion ? 0.12 : 0.3)
      this.flashColor.setRGB(0.62, 0.55, 1.0)
      this.zoom = this.reducedMotion ? 0 : 0.2
    }
    if (this.flash > 0.5) this.zoom = this.reducedMotion ? 0 : 1 // crossing a doorway
    this.zoom = Math.max(0, this.zoom - dt * 1.6)

    // The eye adapts: a crossing over-exposes for a moment, then settles.
    const want = (inside >= 0 ? 1.05 : 0.95) + this.flash * 1.2
    this.exposure += (want - this.exposure) * Math.min(1, dt * (want > this.exposure ? 8 : 1.4))
    this.renderer.toneMappingExposure = this.exposure

    const f = this.finish.uniforms
    f.uTime.value = t
    this.flash = Math.max(0, this.flash - dt * 1.4)
    f.uFlash.value = this.flash * 0.8
    f.uZoom.value = this.zoom * this.zoom
    for (const s of this.home.children) {
      const m = (s as THREE.Points).material as THREE.ShaderMaterial | undefined
      if (m?.uniforms?.uPixelRatio && !('uSizeScale' in m.uniforms)) m.uniforms.uPixelRatio.value = pr
      if (m?.uniforms?.uTime && !('uSizeScale' in m.uniforms)) m.uniforms.uTime.value = t
    }
    for (const u of this.universes) {
      for (const s of u.scene.children) {
        const m = (s as THREE.Points).material as THREE.ShaderMaterial | undefined
        if (m?.uniforms?.uPixelRatio && !('uSizeScale' in m.uniforms)) m.uniforms.uPixelRatio.value = pr
        if (m?.uniforms?.uTime && !('uSizeScale' in m.uniforms)) m.uniforms.uTime.value = t
      }
    }
  }

  /** Focus the lens on what the visitor is walking toward: the path ahead, then the door. */
  private tmpV = new THREE.Vector3()
  private updateLens(inside: number) {
    const aperture = this.lowPower ? 0.08 : 0.12
    const maxBlur = this.lowPower ? 30 : 56
    let focus = 8
    if (inside < 0) {
      const sel = this.seg >= 0 ? this.seg : this.pastGate() ? Math.min(this.hovered ?? Math.floor(this.universes.length / 2), this.universes.length - 1) : -1
      if (sel >= 0) {
        const g = this.universes[sel].door.group.position
        this.tmpV.set(g.x, g.y + DOOR.height * 0.45, g.z)
        focus = THREE.MathUtils.clamp(this.camera.position.distanceTo(this.tmpV), 4, 40)
      }
    }
    const h = this.homeU
    h.uFocus.value += (focus - h.uFocus.value) * 0.06
    h.uAperture.value = aperture
    h.uMaxBlur.value = maxBlur
    this.universes.forEach((u, i) => {
      u.u.uFocus.value = i === inside ? 10 : 18
      u.u.uAperture.value = aperture
      u.u.uMaxBlur.value = i === inside ? maxBlur : maxBlur * 0.5
    })
  }

  /** Project recent pointer stamps to the screen for the finishing pass's lingering ripple. */
  private updateWake(now: number, inside: number) {
    const cam = inside >= 0 ? this.universes[inside].cam : this.camera
    const strength = 0 // screen ripple retired: it smeared the image; the particle wake carries the effect
    let prev: THREE.Vector3 | null = null, prevT = 0
    for (let i = WAKE_STAMPS - 1; i >= 0; i--) {
      const e = this.trail[i]
      const w = this.wake[i]
      if (!e) { w.set(-9, -9, 0, 0); prev = null; continue }
      const y = inside >= 0 ? 0 : homeHeight(e.x, e.z)
      const sp = new THREE.Vector3(e.x, y, e.z).project(cam)
      const uv = new THREE.Vector3((sp.x + 1) / 2, (sp.y + 1) / 2, 0)
      const age = (now - e.t) / 1000
      if (prev && sp.z < 1) {
        const dtS = Math.max((e.t - prevT) / 1000, 0.016)
        const k = Math.exp(-age * 1.6) * strength
        const vx = THREE.MathUtils.clamp((uv.x - prev.x) / dtS, -3, 3) * k
        const vy = THREE.MathUtils.clamp((uv.y - prev.y) / dtS, -3, 3) * k
        w.set(uv.x, uv.y, vx, vy)
      } else w.set(uv.x, uv.y, 0, 0)
      prev = uv; prevT = e.t
    }
  }

  private groundHit() {
    const inside = this.insideIndex()
    const cam = inside >= 0 ? this.universes[inside].cam : this.camera
    const floorY = inside >= 0 ? 0 : this.camera.position.y - EYE
    this.raycaster.setFromCamera(this.ndc, cam)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY)
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3())
  }

  private updateLabels() {
    const inside = this.insideIndex() >= 0
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight
    const past = this.pastGate()
    const route = this.route()
    const spots: Record<LabelId, { p: THREE.Vector3; show: boolean }> = {
      today: { p: this.at(-1, 9, 2.6), show: route < 30 },
      qday: { p: this.at(-1, this.gateD, 6.2), show: route < this.gateD + 3 },
      u0: { p: this.doorTop(0), show: past && this.seg < 0 },
      u1: { p: this.doorTop(1), show: past && this.seg < 0 && this.universes.length > 1 },
      u2: { p: this.doorTop(2), show: past && this.seg < 0 && this.universes.length > 2 },
    }
    for (const [id, el] of this.labels) {
      const s = spots[id]
      const p = s.p.clone().project(this.camera)
      const visible = !inside && s.show && p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2
      el.style.opacity = visible ? '1' : '0'
      el.style.pointerEvents = visible ? 'auto' : 'none'
      // keep a label's centre far enough from the edges that its text stays on screen
      const half = Math.min(el.offsetWidth / 2 + 8, w / 2)
      const x = THREE.MathUtils.clamp(((p.x + 1) / 2) * w, half, w - half)
      el.style.transform = `translate(${x}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -100%)`
      if (id.startsWith('u')) el.dataset.hover = String(this.hovered === Number(id.slice(1)))
    }
  }

  private at(seg: number, d: number, up: number) {
    const p = this.pointAt(seg, d)
    p.y = homeHeight(p.x, p.z) + up
    return p
  }
  private doorTop(i: number) {
    const g = (this.universes[i] ?? this.universes[0]).door.group.position
    return new THREE.Vector3(g.x, g.y + DOOR.height + 0.9, g.z)
  }

  private emitState() {
    const inside = this.insideIndex()
    const phase: 'trunk' | 'fork' | 'branch' | 'inside' = inside >= 0 ? 'inside' : this.seg >= 0 ? 'branch' : this.atFork() ? 'fork' : 'trunk'
    if (inside !== this.wasInside) {
      if (inside >= 0) {
        this.flash = 0.12
        this.flashColor.setRGB(...this.universes[inside].def.tint)
      }
      this.wasInside = inside
    }
    const s: EngineState = {
      phase,
      branch: this.seg >= 0 ? this.seg : null,
      hovered: this.hovered,
      qday: this.pastGate(),
      started: this.route() > 8,
    }
    const key = JSON.stringify(s)
    if (key !== this.lastState) { this.lastState = key; this.cb.onState(s) }
  }

  private render() {
    const inside = this.insideIndex()
    for (const u of this.universes) {
      // Map the visitor's camera through the doorway into that universe's own space.
      this.tmpM.copy(u.door.group.matrixWorld).invert().multiply(this.camera.matrixWorld)
      this.tmpM.decompose(u.cam.position, u.cam.quaternion, new THREE.Vector3())
      u.cam.updateMatrixWorld()
    }
    if (inside >= 0) {
      const u = this.universes[inside]
      this.renderPass.scene = u.scene
      this.renderPass.camera = u.cam
    } else {
      this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
      this.frustum.setFromProjectionMatrix(this.projScreen)
      for (const u of this.universes) {
        if (u.open < 0.004) continue
        const c = u.door.group.position
        if (!this.frustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(c.x, c.y + DOOR.height / 2, c.z), DOOR.height))) continue
        this.renderer.setRenderTarget(u.rt)
        this.renderer.render(u.scene, u.cam)
      }
      this.renderer.setRenderTarget(null)
      this.renderPass.scene = this.home
      this.renderPass.camera = this.camera
    }
    this.composer.render()
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight)
    // Render to a pixel budget rather than full Retina density: soft bokeh looks the same at a
    // lower resolution, and fill rate is what this scene spends. Quality adapts to the frame rate.
    const budget = this.lowPower ? 1.1e6 : 2.3e6
    const pr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, Math.sqrt(budget / (w * h))) * this.quality)
    const fov = w / h < 0.8 ? 78 : 55
    for (const cam of [this.camera, ...this.universes.map(u => u.cam)]) {
      cam.fov = fov
      cam.aspect = w / h
      cam.updateProjectionMatrix()
    }
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(pr)
    this.composer.setSize(w, h)
    const sizeScale = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2))
    for (const u of [this.homeU, ...this.universes.map(x => x.u)]) u.uSizeScale.value = sizeScale
    this.finish.uniforms.uAspect.value = w / h
    for (const u of this.universes) {
      u.rt.setSize(Math.ceil(w * pr * u.rtScale), Math.ceil(h * pr * u.rtScale))
      ;(u.door.contentMat.uniforms.uRes.value as THREE.Vector2).set(w * pr, h * pr)
    }
  }
}

const RT_SCALE = 0.45
