import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { TRAIL_LENGTH, WAKE_LIFE, finishShader } from './shaders'
import {
  DOOR, type RGB, cloud, doorHalfWidth, doorProgress, gateWall, homeHeight, portal, sceneUniforms,
  tintGateWall, type SceneUniforms,
} from './worlds'
import { buildMeadow } from './scenery'
import { buildGallery, type Gallery, type GalleryPhoto, type SealVerdict } from './gallery'
import { PHONE_HOST } from './liveFrame'
import { createLiveSequence, LIVE_VIEW } from './liveSequence'
import { Fluid } from './fluid'
import { buildGreenWorld } from './greenWorld'
import { buildPrismWorld } from './prismWorld'
import { curveStream } from './scenePath'
import { ParticleSimulation } from './particles'
import { POINTER_REACH, WAKE_INTERVAL, dragDistance, dragVelocity, releasedVelocity, wheelDistance } from './input'
import { driveVelocity, type HandControl } from '../gesture/handControl'
import { doorCaption, type DoorCaption } from './doorCaption'
import { Warp, cardAt, glideSeconds, slowFactor, type Zone } from './walk'
import type {
  DoorId, DoorTints, ForgeryArrival, LiveArrival, LiveSequence, Region, WalkControls, WalkState,
} from './contract'

export type WorldView = 'journey' | 'foliage' | 'prism'

interface Showcase {
  scene: THREE.Scene
  path: THREE.Curve<THREE.Vector3>
  length: number
  ground: (x: number, z: number) => number
  u: SceneUniforms
  distance: number
  desired: number
}

export type Phase = 'trunk' | 'fork' | 'branch' | 'inside'
export interface EngineState {
  phase: Phase              // 'inside' in the Prism (after Q-Day), 'trunk' before it
  branch: number | null     // 0 in the Prism, else null
  hovered: number | null    // door under the pointer: 0 door 1, 1 door 2
  qday: boolean             // camera is past door 2
  started: boolean          // the visitor has moved off the start
  stop: number              // the story stop reached, or being glided to (index into the walk's stops)
  gliding: boolean          // the autopilot is walking to that stop
  stopCount: number         // stops on the walk now (grows as live photos arrive)
  walk: WalkState
}
export interface EngineCallbacks {
  onState: (s: EngineState) => void
  onQDay: (crossed: boolean) => void
}
export type LabelId = 'today' | 'qday' | 'u0' | 'u1' | 'u2' | 'door1' | 'door2'


// ── The walk ────────────────────────────────────────────────────────────────
// Green Foliage tunnel → door 1 → the blue world (today) → door 2 "Q-Day · 2035" → the Prism.
// Stops, one press each (Space / → / PageDown on, ← / PageUp back, or the hand's "next"):
//   0 tunnel start · 1 blue arrival (card 'today') · 2 just inside the Prism (card 'qday'; the
//   freeze: wheel, drag, keys and hands hold here until "next") · 3… each live photo station ·
//   then a break (card 'break') and the end (card 'end').
// Glides keep an even pace through the warped route (walk.ts, GLIDE_PACE 6.5), so they ease to
// 25 % in every slow zone. Glide times (scratch calculation over this route): tunnel → today 10.0 s,
// today → Q-Day 12.2 s, Q-Day → first live photo 6.2 s, photo → photo about 3.2 s, last photo →
// break 3.6 s, break → end 3.8 s: about 36 s of walking with one live photo, leaving the rest of
// two minutes for talking. Walking back runs at twice the pace.
// Slow zones (centre ± full-slow / back-to-speed, in route units): today 2 / 9, Q-Day 2 / 7 (it
// begins right at door 2), each live station 1.2 / 4, break and end 1.5 / 5.
export const STOP_COUNT = 6 // with one live station; EngineState.stopCount is authoritative
const TUNNEL_STOP = 4
const DOOR1_AT = 46        // door 1 on the tunnel's path (48 long)
const TODAY_AT = 10        // blue arrival, after door 1
const DOOR2_BEFORE_END = 9 // door 2 stands this far before the blue path's end
const QDAY_AT = 7          // the freeze, just inside the Prism
const LIVE_START = 30      // first live frame station on the Prism path (its middle)
const LIVE_SPACING = 8
const BREAK_AFTER = 9
const END_AFTER = 9
const PRISM_TAIL = 3       // the walk ends this far before the Prism path's end
const DOOR_TINTS: DoorTints = { door1: [0.55, 0.75, 1.0], door2: [1.0, 0.38, 0.22] }
const DOOR_CAPTIONS: Partial<Record<DoorId, string>> = { door2: 'Q-Day · 2035' }

const EYE = 1.15
const FOV = 50
const RT_SCALE = 0.45
const HEIGHT_STEP = 0.25

interface Door {
  id: DoorId
  s: number                 // distance along its world's path
  tint: RGB
  rt: THREE.WebGLRenderTarget
  portal: ReturnType<typeof portal>
  wall: ReturnType<typeof cloud>
  wallBright: Float32Array
  caption: DoorCaption | null
  open: number
  presence: number
  rtScale: number
  toNext: THREE.Matrix4     // this world's coordinates → the next world's
  fromNext: THREE.Matrix4
}

interface Stage {
  region: Region
  scene: THREE.Scene
  u: SceneUniforms
  path: THREE.Curve<THREE.Vector3>
  len: number
  ground: (x: number, z: number) => number
  start: number             // route distance at this world's path start
  cam: THREE.PerspectiveCamera
  door: Door | null         // the door at the far end, into the next world
  exposure: number
  lift: number              // how far above the path ahead the eye looks
  heights: Float32Array     // smoothed ground under the walk, from s = -8 every HEIGHT_STEP
}

const v2 = (x: number, z: number) => new THREE.Vector3(x, 0, z)

/** A stretch [0, upTo] of a curve, as its own curve. */
class SubCurve extends THREE.Curve<THREE.Vector3> {
  private base: THREE.Curve<THREE.Vector3>
  private f: number
  constructor(base: THREE.Curve<THREE.Vector3>, upTo: number) {
    super(); this.base = base; this.f = upTo / base.getLength(); this.arcLengthDivisions = 600
  }
  getPoint(t: number, target = new THREE.Vector3()) { return this.base.getPointAt(t * this.f, target) }
}

export class UniverseEngine implements WalkControls {
  private canvas = document.createElement('canvas')
  private renderer: THREE.WebGLRenderer
  private composer: EffectComposer
  private renderPass: RenderPass
  private bloom: UnrealBloomPass
  private finish: ShaderPass
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 900)
  private stages: Stage[] = []
  private active = 0
  private worldView: WorldView = 'journey'
  private showcases = new Map<WorldView, Showcase>()
  private journeyDesired = 0
  private journeyTarget: number | null = null

  private get showcase() { return this.showcases.get(this.worldView) }
  private trunk = new THREE.CatmullRomCurve3([v2(0, 8), v2(1.4, -6), v2(-1.6, -20), v2(1.2, -34), v2(-0.6, -46), v2(0, -58)], false, 'centripetal')
  private galleries: { gallery: Gallery; stage: number }[] = []
  private live!: LiveSequence
  private liveIds = new Set<string>()
  private fluid: Fluid
  private particles = new Map<THREE.Object3D, { simulation: ParticleSimulation; time: number }>()
  private fluidLast = new THREE.Vector2(-1, -1)

  // the walk's stops, zones and warped route; rebuilt when the live stations change
  private walkKey = ''
  private stopList: number[] = []
  private zones: Zone[] = []
  private warp: Warp | null = null
  private stations: number[] = []
  private maxRoute = 0

  // travel state
  private r = 0                 // route distance the camera stands at
  private desiredRoute = 0
  private v = 0
  private keys = new Set<string>()
  private hands: HandControl | null = null
  private target: number | null = TUNNEL_STOP
  private holdQday = true       // the Q-Day freeze holds continuous travel until "next"
  private hovered: number | null = null
  // autopilot: an eased walk to a story stop, through the warped route
  private glide: { index: number; from: number; to: number; t0: number; dur: number } | null = null
  private glideClock = 0
  private handLatch = false // a hand hold that already counted as "next" doesn't also drive
  private qdayAt = -1
  private flash = 0
  private flashColor = new THREE.Color(1, 1, 1)

  private exposure = 0.95
  private flashedQday = -1
  private zoom = 0

  // pointer
  private ndc = new THREE.Vector2(0, 0)
  private look = new THREE.Vector2(0, 0)
  private trail: { dir: THREE.Vector3; sweep: THREE.Vector3; t: number; weight: number }[] = []
  private pointerIdle = 0
  private idleBlend = 0
  private pulsePending: { ray: THREE.Vector3; origin: THREE.Vector3; world: number; time: number } | null = null
  private pointerSpeed = 0
  private rawPointerSpeed = 0
  private pointerPresence = 0
  private pointerRadius = POINTER_REACH
  private pointerVelocity = new THREE.Vector2()
  private pointerDrag = new THREE.Vector3()
  private pointerIn = false
  private lastTrail = 0
  private down: { id: number; x: number; y: number; lastY: number; lastAt: number; door: number | null } | null = null

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
    this.canvas.tabIndex = 0
    this.canvas.setAttribute('aria-label', 'Interactive world. Scroll, drag, or use W and S to travel.')
    host.appendChild(this.canvas)

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = this.exposure
    this.renderer.setClearColor(0x020308, 1)

    this.fluid = new Fluid(this.renderer, this.lowPower)
    this.buildStages()
    this.refreshWalk()

    this.renderPass = new RenderPass(this.stages[0].scene, this.camera)
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(this.renderPass)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.lowPower ? 0.55 : 0.7, 0.5, 0.58)
    this.composer.addPass(this.bloom)
    // Tone map first, then finish in display space so grain and dither sit on the final image.
    this.composer.addPass(new OutputPass())
    this.finish = new ShaderPass(finishShader)
    this.finish.uniforms.uFlashColor.value = this.flashColor
    this.finish.uniforms.uFluid.value = this.fluid.texture
    this.finish.uniforms.uFluidAmt.value = this.reducedMotion ? 0 : 1
    this.finish.uniforms.uFluidTexel.value = this.fluid.texel
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

  /** The stop the visitor is standing at (autopilot idle), or null between stops. */
  private heldStop(): number | null {
    if (this.glide) return null
    const r = this.desiredRoute
    const i = this.stopList.findIndex(x => Math.abs(r - x) < 0.8)
    return i < 0 ? null : i
  }

  /** The last stop at or behind the visitor. */
  private stopIndex() {
    if (this.glide) return this.glide.index
    const r = this.desiredRoute
    let i = 0
    this.stopList.forEach((x, k) => { if (r >= x - 0.8) i = k })
    return i
  }

  /** Walk on to the next stop of the story. */
  next() {
    if (this.showcase) return
    const r = this.desiredRoute
    // a second press while already walking forward doesn't skip the stop
    if (this.glide && this.stopList[this.glide.index] > r) return
    const held = this.heldStop()
    const i = held !== null ? held + 1 : this.stopList.findIndex(x => x > r + 0.8)
    if (i >= 0 && i < this.stopList.length) this.goStop(i)
  }

  /** Walk back to the previous stop. */
  prev() {
    if (this.showcase) return
    const r = this.desiredRoute
    let i = -1
    this.stopList.forEach((x, k) => { if (x < r - 0.8) i = k })
    this.goStop(Math.max(0, i))
  }

  /** A held right-hand spread at a stop is "next"; it then doesn't also drive until released. */
  handNext() {
    if (this.showcase) return
    const held = this.heldStop()
    if (held === null || held >= this.stopList.length - 1) return
    this.handLatch = true
    this.goStop(held + 1)
  }
  handRelease() { this.handLatch = false }

  private goStop(index: number) {
    const to = this.stopList[index]
    const from = this.desiredRoute
    if (to === undefined || !this.warp) return
    if (index > 2) this.holdQday = false
    if (Math.abs(to - from) < 0.05) { this.glide = null; return }
    const w0 = this.warp.at(from), w1 = this.warp.at(to)
    // walking back is a quick rewind, not the story told again
    const dur = to > from ? glideSeconds(w1 - w0) : Math.max(1.2, glideSeconds(w1 - w0) * 0.5)
    this.target = null
    this.v = 0
    this.glide = { index, from: w0, to: w1, t0: this.glideClock, dur }
  }

  /**
   * A phone photo, as the server judged it: it takes the next live frame in the Prism. The same id
   * again (re-judged after Q-Day) changes that frame's seal in place. Past the frames the meadow has
   * room for, new photos wait off stage; one frame is always kept for the forgery.
   */
  showLive(a: LiveArrival) {
    if (!this.liveIds.has(a.id) && this.liveIds.size >= this.maxLive() - 2) return
    this.liveIds.add(a.id)
    this.live.arrive(a)
  }

  /** The toy-RSA fake has been judged: it hangs beside the live photos. */
  showForgery(f: ForgeryArrival) {
    if (!this.liveIds.has(f.id) && this.liveIds.size >= this.maxLive() - 1) return
    this.liveIds.add(f.id)
    this.live.showForgery(f)
  }

  /** How many live frames (photos, the forgery and the waiting one) fit before the break and end cards. */
  private maxLive() {
    const room = this.stages[2].len - PRISM_TAIL - BREAK_AFTER - END_AFTER - (LIVE_START - LIVE_VIEW)
    return Math.max(3, Math.floor(room / LIVE_SPACING) + 1)
  }

  /** The server's verdicts after Q-Day, by photo id, for the Prism gallery's captions. */
  setVerdicts(v: Map<string, SealVerdict>) {
    for (const g of this.galleries) if (this.stages[g.stage].region === 'qday') g.gallery.setVerdicts(v)
  }

  setDoorTint(id: DoorId, rgb: RGB) {
    const door = this.door(id)
    if (!door) return
    door.tint = [rgb[0], rgb[1], rgb[2]]
    ;(door.portal.contentMat.uniforms.uTint.value as THREE.Color).setRGB(rgb[0], rgb[1], rgb[2])
    const colors = door.wall.geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute
    tintGateWall(colors.array as Float32Array, door.wallBright, rgb)
    colors.needsUpdate = true
    door.caption?.setTint(rgb)
  }

  doorTints(): DoorTints {
    const tint = (id: DoorId) => [...(this.door(id)?.tint ?? DOOR_TINTS[id])] as RGB
    return { door1: tint('door1'), door2: tint('door2') }
  }

  /** Write a door's name in light above its frame, or remove it (null) when the screen pins its own. */
  setDoorCaption(id: DoorId, text: string | null) {
    const door = this.door(id)
    if (!door) return
    if (text === null) {
      if (door.caption) { door.portal.group.remove(door.caption.mesh); door.caption.dispose(); door.caption = null }
      return
    }
    if (door.caption) door.caption.setText(text)
    else {
      door.caption = doorCaption(text, door.tint)
      door.portal.group.add(door.caption.mesh)
    }
  }

  private door(id: DoorId) { return this.stages.find(s => s.door?.id === id)?.door ?? null }

  /** Select a landscape without advancing or rewinding the shared story. */
  setWorld(view: WorldView) {
    if (view === this.worldView) return
    const outgoing = this.showcase
    if (outgoing) outgoing.desired = this.desiredRoute
    else { this.journeyDesired = this.desiredRoute; this.journeyTarget = this.target }
    // Release persistent GPU state when leaving a scene; only visible worlds need it.
    this.particles.forEach(entry => entry.simulation.dispose())
    this.particles.clear()
    if (view !== 'journey' && !this.showcases.has(view)) {
      const u = sceneUniforms()
      const scene = view === 'foliage' ? buildGreenWorld(u, this.lowPower) : buildPrismWorld(u, this.lowPower)
      this.showcases.set(view, { ...scene, u, distance: 0, desired: 0 })
    }
    this.onBlur()
    this.worldView = view
    this.glide = null
    this.desiredRoute = this.showcase?.desired ?? this.journeyDesired
    this.target = this.showcase ? null : this.journeyTarget
    this.trail.length = 0
    this.fluid.clear()
    this.look.set(0, 0); this.ndc.set(0, 0)
    this.pointerSpeed = 0; this.pointerPresence = 0; this.pointerIdle = 0; this.idleBlend = 0
    this.hovered = null; this.flash = 0; this.zoom = 0
    this.canvas.style.cursor = ''
    for (const u of this.allUniforms()) u.uPulse.value.w = -99
    this.resize()
    if (this.showcase) this.placeShowcaseCamera(1)
    else { this.placeCamera(1); this.updatePreviewCamera() }
    this.updateLabels()
    this.canvas.focus({ preventScroll: true })
  }

  restartWorld() {
    if (!this.showcase) return
    this.desiredRoute = 0; this.v = 0
    this.canvas.focus({ preventScroll: true })
  }

  private allUniforms() {
    return [...this.stages.map(s => s.u), ...[...this.showcases.values()].map(x => x.u)]
  }

  private activeWorldIndex() {
    return this.worldView === 'foliage' ? -2 : this.worldView === 'prism' ? -3 : this.active
  }

  /** Walk through the next door ahead (the page's door pins call this). */
  choose(branch: number) {
    void branch
    if (this.showcase) return
    const ahead = this.stages.findIndex((s, i) => s.door && i >= this.active)
    if (ahead >= 0) this.goStop(ahead + 1)
  }

  /** A short glow when a new photo lands in the world the visitor is standing in. */
  celebrate(status: 'green' | 'amber' | 'grey') {
    const c = status === 'green' ? [0.3, 1, 0.6] : status === 'amber' ? [1, 0.7, 0.25] : [0.7, 0.72, 0.8]
    this.flashColor.setRGB(c[0], c[1], c[2])
    this.flash = Math.max(this.flash, 0.12)
  }

  /** Let the presenter's hands (webcam) walk the timeline; null hands control back to scroll. */
  setHands(c: HandControl | null) { this.hands = c }

  /**
   * Hang the feed's photos twice: in the blue world, as they are today, and in the Prism, where
   * Q-Day's wave tests their seals (legacy RSA greys out, hybrid holds).
   */
  setGallery(photos: GalleryPhoto[]) {
    for (const g of this.galleries) { this.stages[g.stage].scene.remove(g.gallery.group); g.gallery.dispose() }
    this.galleries = []
    if (!photos.length) return
    const blue = this.stages[1], prism = this.stages[2]
    const gate = blue.door!.s
    this.galleries.push({ stage: 1, gallery: buildGallery(photos, blue.path, 22 / blue.len, (gate - 6) / blue.len, 0, { ground: blue.ground }) })
    this.galleries.push({ stage: 2, gallery: buildGallery(photos, prism.path, 10 / prism.len, (LIVE_START - 4) / prism.len, 1, { ground: prism.ground }) })
    for (const g of this.galleries) this.stages[g.stage].scene.add(g.gallery.group)
  }

  /** Walk back to the world before the last door. */
  back() {
    if (this.showcase) return
    this.goStop(this.active >= 2 ? 1 : 0)
  }

  /** Walk back to today, before Q-Day. */
  rewind() { if (!this.showcase) this.goStop(1) }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.unbind()
    for (const s of this.stages) s.door?.caption?.dispose()
    this.galleries.forEach(g => g.gallery.dispose())
    this.live.dispose()
    const scenes = [...this.stages.map(s => s.scene), ...[...this.showcases.values()].map(u => u.scene)]
    for (const s of scenes) {
      s.traverse(o => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach(x => x.dispose())
        else mat?.dispose()
      })
    }
    this.stages.forEach(s => s.door?.rt.dispose())
    this.fluid.dispose()
    this.particles.forEach(p => p.simulation.dispose())
    this.particles.clear()
    this.composer.dispose()
    this.renderer.dispose()
    this.canvas.remove()
  }

  // ── scene construction ───────────────────────────────────────────────────

  private buildStages() {
    const lp = this.lowPower
    // 1. The green Foliage tunnel.
    const tu = sceneUniforms()
    const tunnel = buildGreenWorld(tu, lp)
    // Door 1 is the light at the end of the tunnel; the landscape's own exit glow would only wash it out.
    const exit = tunnel.scene.getObjectByName('Green tunnel exit light')
    if (exit) exit.visible = false
    // 2. The blue world: today's meadow under hanging light, the white stream to door 2.
    const bu = sceneUniforms()
    const blueScene = new THREE.Scene()
    blueScene.name = 'Blue world (today)'
    buildMeadow(blueScene, bu, lp, this.trunkX())
    const blueLen = this.trunk.getLength()
    const door2At = blueLen - DOOR2_BEFORE_END
    blueScene.add(curveStream(bu, new SubCurve(this.trunk, door2At), { lowPower: lp, ground: homeHeight, fog: 130 }))
    // 3. The Prism meadow, after Q-Day.
    const pu = sceneUniforms()
    const prism = buildPrismWorld(pu, lp)

    const stage = (region: Region, scene: THREE.Scene, u: SceneUniforms, path: THREE.Curve<THREE.Vector3>, len: number,
      ground: (x: number, z: number) => number, exposure: number, lift: number): Stage => {
      const s: Stage = {
        region, scene, u, path, len, ground, start: 0, exposure, lift, door: null,
        cam: new THREE.PerspectiveCamera(FOV, 1, 0.05, 900), heights: new Float32Array(0),
      }
      s.heights = this.sampleHeights(s)
      return s
    }
    this.stages = [
      stage('tunnel', tunnel.scene, tu, tunnel.path, tunnel.length, tunnel.ground, 1.0, 0.3),
      stage('today', blueScene, bu, this.trunk, blueLen, homeHeight, 0.95, -0.5),
      stage('qday', prism.scene, pu, prism.path, prism.length, prism.ground, 1.05, 0.1),
    ]
    this.addDoor(0, 'door1', DOOR1_AT)
    this.addDoor(1, 'door2', door2At)
    this.stages[1].start = this.stages[0].start + DOOR1_AT
    this.stages[2].start = this.stages[1].start + door2At

    // The live photos stand in the middle of the Prism's path.
    const p = this.stages[2]
    this.live = createLiveSequence({
      path: {
        at: d => {
          const position = this.pointAt(2, d)
          position.y = p.ground(position.x, position.z)
          return { position, tangent: this.tangentAt(2, d) }
        },
        ground: p.ground,
      },
      start: LIVE_START, spacing: LIVE_SPACING, host: PHONE_HOST,
      onLand: (_i, a) => { if (this.active === 2) this.celebrate(a.status) },
    })
    p.scene.add(this.live.group)
  }

  /** A door at distance s on world j's path, and the frame that carries the walk into world j+1. */
  private addDoor(j: number, id: DoorId, s: number) {
    const st = this.stages[j]
    const tint = DOOR_TINTS[id]
    const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType })
    const door = portal(tint, rt, this.lowPower)
    const at = this.pointAt(j, s), tan = this.tangentAt(j, s)
    const base = this.heightAt(j, s)
    door.group.position.set(at.x, base, at.z)
    door.group.lookAt(at.x - tan.x, base, at.z - tan.z) // +z faces the visitor; -z leads into the next world
    door.group.updateMatrixWorld(true)
    st.scene.add(door.group)
    // Sliding slab and ground spill, in this world's coordinates for pointer interactions.
    const w = gateWall(tint, this.lowPower)
    const tmp = new THREE.Vector3()
    for (let k = 0; k < w.pos.length; k += 3) {
      tmp.set(w.pos[k], w.pos[k + 1], w.pos[k + 2]).applyMatrix4(door.group.matrixWorld)
      w.pos.set([tmp.x, tmp.y, tmp.z], k)
    }
    const axis = new THREE.Vector3(1, 0, 0).transformDirection(door.group.matrixWorld)
    const wall = cloud(st.u, w.pos, w.col, w.size, 14, [10, 95], 61, 0, { interaction: 0.35, center: door.group.position, axis })
    wall.geometry.setAttribute('aPortal', new THREE.InstancedBufferAttribute(w.shape, 4))
    const wallMat = wall.material as THREE.ShaderMaterial
    wallMat.defines = { PORTAL_DUST: 1 }
    Object.assign(wallMat.uniforms, {
      uHalfWidth: door.contentMat.uniforms.uHalfWidth,
      uDoorOpen: door.contentMat.uniforms.uOpen,
      uImpact: door.contentMat.uniforms.uImpact,
      uDoorOuter: { value: DOOR.width / 2 + DOOR.frame },
      uDoorSpeed: { value: 0 },
    })
    wall.visible = false
    st.scene.add(wall)
    // The next world's entry frame: its path start, facing back along its path, like the door.
    const p0 = this.pointAt(j + 1, 0), t0 = this.tangentAt(j + 1, 0)
    const entry = new THREE.Object3D()
    entry.position.set(p0.x, this.heightAt(j + 1, 0), p0.z)
    entry.lookAt(p0.x - t0.x, entry.position.y, p0.z - t0.z)
    entry.updateMatrixWorld(true)
    const toNext = entry.matrixWorld.clone().multiply(door.group.matrixWorld.clone().invert())
    st.door = {
      id, s, tint: [...tint] as RGB, rt, portal: door, wall, wallBright: w.bright, caption: null,
      open: 0, presence: 0, rtScale: RT_SCALE, toNext, fromNext: toNext.clone().invert(),
    }
    const text = DOOR_CAPTIONS[id]
    if (text) this.setDoorCaption(id, text)
  }

  /** The blue walk's sideways position at a given depth. */
  private trunkX() {
    const samples = Array.from({ length: 241 }, (_, i) => this.trunk.getPointAt(i / 240))
    return (z: number) => {
      if (z >= samples[0].z) return samples[0].x
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1], b = samples[i]
        if (z >= b.z) return THREE.MathUtils.lerp(a.x, b.x, (z - a.z) / (b.z - a.z || -1))
      }
      return samples[samples.length - 1].x
    }
  }

  // ── paths ────────────────────────────────────────────────────────────────

  /** A point on world j's walk at distance s, continuing straight past either end. */
  private pointAt(j: number, s: number, out = new THREE.Vector3()) {
    const st = this.stages[j]
    if (s < 0) return st.path.getPointAt(0, out).addScaledVector(this.tangentAt(j, 0), s).setY(0)
    if (s > st.len) return st.path.getPointAt(1, out).addScaledVector(this.tangentAt(j, st.len), s - st.len).setY(0)
    return st.path.getPointAt(s / st.len, out).setY(0)
  }

  private tangentAt(j: number, s: number) {
    const st = this.stages[j]
    return st.path.getTangentAt(THREE.MathUtils.clamp(s / st.len, 0, 1)).setY(0).normalize()
  }

  /** Smoothed ground height under the walk, so the eye never steps (and meets the doors exactly). */
  private sampleHeights(st: Stage) {
    const n = Math.ceil((st.len + 24) / HEIGHT_STEP)
    const raw = new Float32Array(n), out = new Float32Array(n)
    const at = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const s = -8 + i * HEIGHT_STEP
      const c = THREE.MathUtils.clamp(s, 0, st.len)
      st.path.getPointAt(c / st.len, at)
      if (s !== c) at.addScaledVector(st.path.getTangentAt(c / st.len).setY(0).normalize(), s - c)
      raw[i] = st.ground(at.x, at.z)
    }
    const k = Math.round(2 / HEIGHT_STEP)
    for (let i = 0; i < n; i++) {
      const a = raw[Math.max(0, i - k)], b = raw[Math.min(n - 1, i + k)]
      out[i] = (a + raw[i] * 2 + b) / 4
    }
    return out
  }

  private heightAt(j: number, s: number) {
    const h = this.stages[j].heights
    const x = THREE.MathUtils.clamp((s + 8) / HEIGHT_STEP, 0, h.length - 1)
    const i = Math.min(h.length - 2, Math.floor(x))
    return h[i] + (h[i + 1] - h[i]) * (x - i)
  }

  /** The world the route is in: each door hands over just before its plane (the near plane). */
  private stageAt(r: number) {
    let a = 0
    for (let j = 1; j < this.stages.length; j++) if (r >= this.stages[j].start - 0.08) a = j
    return a
  }

  /** Rebuild the stops, slow zones and warped route whenever the live stations change. */
  private refreshWalk() {
    const prism = this.stages[2]
    const stations = this.live.stations()
    const key = stations.join(',')
    if (key === this.walkKey && this.warp) return
    this.walkKey = key
    const [s0, s1, s2] = this.stages.map(s => s.start)
    const last = prism.len - PRISM_TAIL
    const live = stations.map(s => s2 + Math.min(s, last - 8))
    const lastLive = live.length ? live[live.length - 1] : s2 + QDAY_AT
    const brk = Math.min(lastLive + BREAK_AFTER, s2 + last - 4)
    const end = Math.max(brk + 4, Math.min(brk + END_AFTER, s2 + last))
    this.stations = live
    this.stopList = [s0 + TUNNEL_STOP, s1 + TODAY_AT, s2 + QDAY_AT, ...live, brk, end]
    this.zones = [
      { at: s1 + TODAY_AT, inner: 2, outer: 9, card: 'today' },
      { at: s2 + QDAY_AT, inner: 2, outer: 7, card: 'qday' },
      ...live.map(at => ({ at, inner: 1.2, outer: 4 })),
      { at: brk, inner: 1.5, outer: 5, card: 'break' as const },
      { at: end, inner: 1.5, outer: 5, card: 'end' as const },
    ]
    this.maxRoute = Math.max(end, s2 + last)
    this.warp = new Warp(this.zones, this.maxRoute + 1)
    // a glide under way keeps going to the same stop, over the new route
    if (this.glide) this.goStop(Math.min(this.glide.index, this.stopList.length - 1))
  }

  // ── input ────────────────────────────────────────────────────────────────

  /** Every way of travelling eases to a quarter speed inside a slow zone. */
  private slow() { return slowFactor(this.desiredRoute, this.zones) }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.target = null
    this.glide = null
    this.v = 0
    const step = wheelDistance(e.deltaY, e.deltaMode, this.canvas.clientHeight)
    this.desiredRoute += this.showcase ? step : step * this.slow()
  }
  private onKeyDown = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null
    if (el?.closest?.('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    const code = e.code
    // The story: space, → and a clicker's PageDown walk on; ← and PageUp walk back. Works even
    // with a button focused (after "Fake one"), so a clicker never re-presses it. Matched on the
    // physical key too, since some remotes and automation send an empty `key`.
    const is = (key: string, phys: string) => k === key || code === phys
    const fwd = is(' ', 'Space') || is('pagedown', 'PageDown') || is('arrowright', 'ArrowRight')
    const back = is('pageup', 'PageUp') || is('arrowleft', 'ArrowLeft')
    if (!this.showcase && (fwd || back)) {
      e.preventDefault()
      if (el?.closest?.('button, a')) el.blur()
      if (!e.repeat) { if (fwd) this.next(); else this.prev() }
      return
    }
    if (el?.closest?.('button, a')) return
    if (['w', 's', 'arrowup', 'arrowdown'].includes(k)) { this.keys.add(k); this.target = null; this.glide = null; e.preventDefault() }
    if (!this.showcase && k === 'enter' && this.hovered !== null) { this.goStop(this.hovered + 1); e.preventDefault() }
    if (!this.showcase && k === 'escape') this.back()
  }
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()) }
  private onPointerMove = (e: PointerEvent) => { this.updatePointer(e, true) }
  private updatePointer(e: PointerEvent, dragging: boolean) {
    if (!e.isPrimary) return
    const rect = this.canvas.getBoundingClientRect()
    this.pointerIn = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
    this.ndc.set(((e.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1, -((e.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1)
    this.pointerIdle = 0
    const now = performance.now()
    const down = this.down
    if (dragging && down?.id === e.pointerId) {
      const distance = dragDistance(down.lastY, e.clientY, rect.height) * (this.showcase ? 1 : this.slow())
      this.desiredRoute += distance
      this.v = dragVelocity(this.v, distance, (now - down.lastAt) / 1000)
      down.lastY = e.clientY
      down.lastAt = now
    }
  }
  private onPointerEnter = (e: PointerEvent) => { if (e.isPrimary) this.pointerIn = true }
  private onPointerLeave = (e?: PointerEvent) => {
    if (e && !e.isPrimary) return
    this.pointerIn = false; this.fluidLast.set(-1, -1)
  }
  private onPointerCancel = (e: PointerEvent) => {
    if (e.isPrimary || this.down?.id === e.pointerId) this.onBlur()
  }
  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return
    this.onPointerMove(e)
    this.target = null
    this.glide = null
    this.v = 0
    this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, lastY: e.clientY, lastAt: performance.now(), door: this.pickDoor() }
    this.canvas.setPointerCapture(e.pointerId)
  }
  private onPointerUp = (e: PointerEvent) => {
    if (!this.down || this.down.id !== e.pointerId || e.button !== 0) return
    this.updatePointer(e, false)
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y)
    const pressed = this.down.door
    this.v = releasedVelocity(this.v, (performance.now() - this.down.lastAt) / 1000)
    this.down = null
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
    if (moved > 6) return
    this.pulsePending = this.reducedMotion ? null : {
      ray: this.pointerRay(this.ndc), origin: this.camera.position.clone(), world: this.activeWorldIndex(),
      time: (performance.now() - this.startedAt) / 1000,
    }
    // Resolve the release against the visible aperture, even between animation frames.
    const released = this.pickDoor()
    if (pressed !== null && pressed === released) {
      this.stages[pressed].door!.portal.contentMat.uniforms.uImpact.value = this.reducedMotion ? 0 : 1
      this.goStop(pressed + 1) // through the door, to the stop just past it
    }
  }
  private onBlur = () => {
    if (this.down && this.canvas.hasPointerCapture(this.down.id)) this.canvas.releasePointerCapture(this.down.id)
    this.keys.clear(); this.pointerIn = false; this.down = null; this.v = 0
    this.pulsePending = null; this.fluidLast.set(-1, -1)
  }

  private bind() {
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerenter', this.onPointerEnter)
    this.canvas.addEventListener('pointerleave', this.onPointerLeave)
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerCancel)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }
  private unbind() {
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerenter', this.onPointerEnter)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }

  // ── travel ───────────────────────────────────────────────────────────────

  private travelShowcase(dt: number) {
    const world = this.showcase!
    const fwd = this.keys.has('w') || this.keys.has('arrowup')
    const bwd = this.keys.has('s') || this.keys.has('arrowdown')
    if (fwd || bwd) this.v = THREE.MathUtils.clamp(this.v + (fwd ? 16 : -16) * dt, -9, 9)
    const step = !this.down && Math.abs(this.v) >= 0.01 ? this.v * dt : 0
    this.desiredRoute = THREE.MathUtils.clamp(this.desiredRoute + step, 0, Math.max(0, world.length - 2))
    if (!this.down && !fwd && !bwd) this.v *= Math.exp(-dt * 3.2)
    world.distance += (this.desiredRoute - world.distance) * (1 - Math.exp(-4 * dt))
  }

  private placeShowcaseCamera(blend: number) {
    const world = this.showcase!
    const at = (distance: number) => world.path.getPointAt(THREE.MathUtils.clamp(distance / world.length, 0, 1))
    const pos = at(world.distance)
    pos.y = world.ground(pos.x, pos.z) + EYE
    const ahead = at(Math.min(world.length, world.distance + 6))
    ahead.y = world.ground(ahead.x, ahead.z) + EYE + 0.3
    ahead.sub(pos)
    ahead.x += this.look.x * 0.36; ahead.y += this.look.y * 0.216
    this.gaze.lerp(ahead, blend)
    this.camera.position.copy(pos)
    this.camera.lookAt(pos.clone().add(this.gaze))
    this.camera.updateMatrixWorld()
  }

  private travel(dt: number, realDt = dt) {
    const before = this.r
    const fwd = this.keys.has('w') || this.keys.has('arrowup')
    const bwd = this.keys.has('s') || this.keys.has('arrowdown')

    // Hands (webcam): the open left palm arms, the right hand's spread walks on, a pinch walks back,
    // a fist stops. A hold that already counted as "next" at a stop doesn't also drive.
    const hand = this.hands && !this.handLatch ? driveVelocity(this.hands, this.v, dt) : null
    if (hand?.active) { this.target = null; this.glide = null }

    // The autopilot keeps wall-clock time, so a stop takes as long on a slow frame rate as a fast one.
    this.glideClock += realDt
    if (this.glide && this.warp) {
      const g = this.glide
      const k = Math.min(1, (this.glideClock - g.t0) / g.dur)
      // ease in and out through the warped route: slow zones slow it, the stop settles it
      this.desiredRoute = this.warp.inverse(g.from + (g.to - g.from) * (0.5 - 0.5 * Math.cos(Math.PI * k)))
      if (k >= 1) { this.desiredRoute = this.stopList[g.index] ?? this.desiredRoute; this.glide = null }
      this.v = 0
    } else if (this.target !== null) {
      const err = this.target - this.desiredRoute
      const want = THREE.MathUtils.clamp(err * 1.3, -15, 15)
      this.v += (want - this.v) * Math.min(1, dt * 3)
      if (Math.abs(this.target - before) < 0.04) { this.target = null; this.v = 0 }
    } else if (hand?.active) {
      this.v = hand.v
    } else if (fwd || bwd) {
      this.v = THREE.MathUtils.clamp(this.v + (fwd ? 16 : -16) * dt, -9, 9)
    }

    const travelStep = !this.down && !this.glide && Math.abs(this.v) >= 0.01 ? this.v * dt * this.slow() : 0
    this.desiredRoute = THREE.MathUtils.clamp(this.desiredRoute + travelStep, 0, this.maxRoute)
    // The Q-Day freeze: continuous travel holds just inside the Prism until "next".
    const q = this.stopList[2]
    if (this.desiredRoute < q - 1) this.holdQday = true
    if (this.holdQday && !this.glide && before <= q + 0.05 && this.desiredRoute > q) {
      this.desiredRoute = q; this.v = Math.min(0, this.v)
    }
    if (this.target === null && !this.down && !fwd && !bwd && !hand?.active) this.v *= Math.exp(-dt * 3.2)
    this.r = before + (this.desiredRoute - before) * (1 - Math.exp(-4 * dt))
    if (this.r < 0) { this.r = 0; this.v = Math.max(0, this.v) }
  }

  /** Crossing a door: the camera now lives in the next (or previous) world's coordinates. */
  private switchStage(to: number, t: number) {
    const from = this.active
    const rot = new THREE.Matrix3()
    for (let j = from; j < to; j++) this.gaze.applyMatrix3(rot.setFromMatrix4(this.stages[j].door!.toNext))
    for (let j = from - 1; j >= to; j--) this.gaze.applyMatrix3(rot.setFromMatrix4(this.stages[j].door!.fromNext))
    // Pointer rays belong to a world's coordinate frame, never the next world's.
    this.trail.length = 0
    this.fluidLast.set(-1, -1)
    this.fluid.clear()
    for (const s of this.stages) s.u.uPulse.value.w = -99
    const crossed = this.stages[Math.min(from, to)].door
    if (crossed) { this.flash = Math.max(this.flash, 0.035); this.flashColor.setRGB(...crossed.tint) }
    const wasQ = this.stages[from].region === 'qday', isQ = this.stages[to].region === 'qday'
    this.active = to
    if (isQ && !wasQ) {
      this.qdayAt = t
      this.stages[to].u.uShock.value.set(0, 0, t, this.reducedMotion ? 0.35 : 1)
      this.cb.onQDay(true)
    } else if (wasQ && !isQ) {
      this.qdayAt = -1
      this.cb.onQDay(false)
    }
  }

  private tmpM = new THREE.Matrix4()
  private tmpQ = new THREE.Quaternion()
  private gaze = new THREE.Vector3(0, 0, -1)

  /** A point on the walk ahead, seen from world j: past a door it is the next world's path, mapped back. */
  private aheadPoint(j: number, s: number) {
    const st = this.stages[j]
    if (st.door && s > st.door.s && this.stages[j + 1]) {
      const n = s - st.door.s
      const p = this.pointAt(j + 1, n)
      p.y = this.heightAt(j + 1, n)
      return p.applyMatrix4(st.door.fromNext)
    }
    const p = this.pointAt(j, s)
    p.y = this.heightAt(j, s)
    return p
  }

  private placeCamera(blend: number) {
    const j = this.active, st = this.stages[j]
    const s = this.r - st.start
    const pos = this.pointAt(j, s)
    pos.y = this.heightAt(j, s) + EYE + Math.sin(this.r * 1.6) * 0.025 * Math.min(1, Math.abs(this.v) / 4)
    const target = this.aheadPoint(j, s + 6)
    // Walking up to a door, the eye levels to look straight through it.
    const toDoor = st.door ? st.door.s - s : 99
    target.y += EYE + THREE.MathUtils.lerp(0.2, st.lift, THREE.MathUtils.smoothstep(toDoor, 2, 12))

    target.sub(pos)
    target.x += this.look.x * 0.36
    target.y += this.look.y * 0.216
    this.gaze.lerp(target, blend)
    this.tmpM.lookAt(pos, target.copy(pos).add(this.gaze), THREE.Object3D.DEFAULT_UP)
    this.tmpQ.setFromRotationMatrix(this.tmpM)
    this.camera.position.copy(pos)
    this.camera.quaternion.copy(this.tmpQ)
    this.camera.updateMatrixWorld()
  }

  /** Map the visitor's camera through the door ahead into the next world's own space. */
  private updatePreviewCamera() {
    const door = this.stages[this.active].door, next = this.stages[this.active + 1]
    if (!door || !next) return
    this.tmpM.multiplyMatrices(door.toNext, this.camera.matrixWorld)
    this.tmpM.decompose(next.cam.position, next.cam.quaternion, new THREE.Vector3())
    next.cam.updateMatrixWorld()
  }

  // ── per-frame ────────────────────────────────────────────────────────────

  private frame = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    const now = performance.now()
    this.adapt(now - this.lastFrame)
    const dt = Math.min((now - this.lastFrame) / 1000, 1 / 20)
    const realDt = Math.min((now - this.lastFrame) / 1000, 0.25)
    this.lastFrame = now
    const t = (now - this.startedAt) / 1000

    this.updatePointerMotion(dt, t)
    if (this.showcase) {
      this.travelShowcase(dt)
      this.placeShowcaseCamera(1 - Math.exp(-dt * 3))
    } else {
      this.refreshWalk()
      this.travel(dt, realDt)
      const a = this.stageAt(this.r)
      if (a !== this.active) this.switchStage(a, t)
      this.placeCamera(1 - Math.exp(-dt * 3))
      this.updatePreviewCamera()
      this.updateDoors(dt, t)
      this.emitState()
    }
    this.updateUniforms(t, dt)
    this.updateLabels()
    this.stirFluid(dt)
    this.render()
  }

  private updatePointerMotion(dt: number, t: number) {
    this.pointerIdle += dt
    const idle = !this.reducedMotion && this.pointerIdle > 3
    this.idleBlend += ((idle ? 1 : 0) - this.idleBlend) * (1 - Math.exp(-dt * (idle ? 0.6 : 4)))
    const idleX = Math.sin(t * 0.37) * 0.55 + Math.sin(t * 0.91 + 1.7) * 0.15
    const idleY = -0.18 + Math.sin(t * 0.53 + 0.6) * 0.22 + Math.sin(t * 1.31) * 0.05
    const targetX = this.ndc.x + (idleX - this.ndc.x) * this.idleBlend
    const targetY = this.ndc.y + (idleY - this.ndc.y) * this.idleBlend
    const alpha = 1 - Math.exp(-dt * 7)
    this.pointerVelocity.set((targetX - this.look.x) * alpha, (targetY - this.look.y) * alpha)
    this.look.add(this.pointerVelocity)
    this.pointerVelocity.multiplyScalar(dt > 0 ? 1 / dt : 0)
    this.rawPointerSpeed = Math.min(1, Math.hypot(this.pointerVelocity.x * this.camera.aspect, this.pointerVelocity.y) / 5)
    const speedRate = this.rawPointerSpeed > this.pointerSpeed ? 10 : 2.5
    this.pointerSpeed += (this.rawPointerSpeed - this.pointerSpeed) * (1 - Math.exp(-dt * speedRate))
    const presence = this.reducedMotion ? 0 : Math.max(this.pointerIn ? 1 : 0, this.idleBlend * 0.65)
    this.pointerPresence += (presence - this.pointerPresence) * (1 - Math.exp(-dt * 3))
    this.pointerRadius += (POINTER_REACH - this.pointerRadius) * (1 - Math.exp(-Math.min(dt, 0.05) * (this.pointerRadius < POINTER_REACH ? 28 : 2.5)))
  }

  /** The pointer pushes the screen fluid along the way it moves. */
  private stirFluid(dt: number) {
    const uv = new THREE.Vector2((this.ndc.x + 1) / 2, (this.ndc.y + 1) / 2)
    if (this.reducedMotion) return
    if (this.pointerIn) {
      if (this.fluidLast.x >= 0 && uv.distanceToSquared(this.fluidLast) > 1e-7) {
        this.fluid.splat(this.fluidLast, uv, dt)
      }
      this.fluidLast.copy(uv)
    } else this.fluidLast.set(-1, -1)
    this.fluid.step(dt)
    this.finish.uniforms.uFluid.value = this.fluid.texture
    this.finish.uniforms.uDye.value = this.fluid.dyeTexture
    this.finish.uniforms.uDisplacement.value = this.fluid.displacementTexture
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

  /** The door under the pointer (its world's index), if its open aperture is under it. */
  private pickDoor(): number | null {
    if (this.showcase || !this.pointerIn) return null
    const door = this.stages[this.active].door
    if (!door || door.presence < 0.05) return null
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const hit = this.raycaster.intersectObject(door.portal.content, false)[0]
    if (!hit?.uv) return null
    return Math.abs(hit.uv.x - 0.5) * DOOR.width <= doorHalfWidth(door.open) ? this.active : null
  }

  private updateDoors(dt: number, t: number) {
    this.stages.forEach((st, j) => {
      const door = st.door
      if (!door) return
      const before = doorHalfWidth(door.open)
      const s = this.r - st.start
      const remaining = door.s - s
      const progress = doorProgress(remaining)
      door.presence = j <= this.active ? progress.presence : 0
      door.open = progress.open
      const m = door.portal.contentMat.uniforms
      m.uOpen.value = door.open
      m.uHalfWidth.value = doorHalfWidth(door.open)
      m.uPresence.value = door.presence
      m.uImpact.value *= Math.exp(-dt * 3.5)
      m.uTime.value = t
      // Clear the last foreground spill grains as the camera crosses the near plane.
      const e = j < this.active ? 1 : THREE.MathUtils.smoothstep(s, door.s - 0.6, door.s - 0.08)
      door.portal.group.visible = door.presence > 0.001
      door.wall.visible = door.presence > 0.001
      const wall = (door.wall.material as THREE.ShaderMaterial).uniforms
      wall.uOpacity.value = door.presence * (1 - e)
      wall.uDoorSpeed.value = dt > 0 ? (m.uHalfWidth.value - before) / dt : 0
      door.portal.sparkMat.uniforms.uScale.value = this.host.clientHeight * this.renderer.getPixelRatio() * 0.055
      // the caption reads from afar and fades once the door fills the view
      door.caption?.setOpacity(door.presence * THREE.MathUtils.smoothstep(remaining, 3, 9))
      // render the world behind the door at full resolution once it's about to fill the screen
      const rtWant = j === this.active && remaining < 10 ? 1 : RT_SCALE
      if (rtWant !== door.rtScale) { door.rtScale = rtWant; this.resize() }
    })
    this.hovered = this.pickDoor()
    this.canvas.style.cursor = this.hovered !== null ? 'pointer' : ''
    for (const g of this.galleries) {
      const q = this.stages[g.stage].region === 'qday'
      g.gallery.update(t, q ? this.qdayAt : -1, q ? this.stages[g.stage].path.getPointAt(0) : this.camera.position)
    }
    const prism = this.stages[2]
    this.live.update(t, this.active === 2 ? this.camera : prism.cam)
  }

  private updateUniforms(t: number, dt: number) {
    const pr = this.renderer.getPixelRatio()
    const all = this.allUniforms()
    for (const u of all) u.uTime.value = t
    this.showcases.forEach(s => { s.u.uPixelRatio.value = pr })
    this.stages.forEach((s, j) => {
      const behind = this.stages[j - 1]?.door
      s.u.uPixelRatio.value = j === this.active + 1 && behind ? pr * behind.rtScale : pr
    })
    this.updateLens(dt)

    // The pointer stirs whichever world the camera is in: its live ray, its wake and clicks.
    const now = performance.now()
    const active = this.showcase?.u ?? this.stages[this.active].u
    const cam = this.camera
    const tanFov = Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5))
    this.pointerDrag.set(this.pointerVelocity.x * cam.aspect, this.pointerVelocity.y, 0).multiplyScalar(tanFov).applyQuaternion(cam.quaternion)
    const direction = this.pointerRay()
    if (t - this.lastTrail >= WAKE_INTERVAL) {
      this.lastTrail = t
      this.trail.unshift({ dir: direction.clone(), sweep: this.pointerDrag.clone(), t: now, weight: this.pointerPresence * this.rawPointerSpeed })
      if (this.trail.length > TRAIL_LENGTH) this.trail.length = TRAIL_LENGTH
    }
    for (const u of all) {
      const arr = u.uTrail.value
      const on = u === active
      let alive = 0
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        const e = on ? this.trail[i] : undefined
        const age = e ? (now - e.t) / 1000 : 99
        u.uTrailWeight.value[i] = e && age < WAKE_LIFE ? e.weight : 0
        if (e && age < WAKE_LIFE) u.uTrailSweep.value[i].copy(e.sweep)
        else u.uTrailSweep.value[i].set(0, 0, 0)
        if (e && age < WAKE_LIFE) { arr[i].set(e.dir.x, e.dir.y, e.dir.z, age); alive = i + 1 }
        else arr[i].set(0, 0, -1, 99)
      }
      u.uWakeN.value = alive
      u.uPointerSpeed.value = this.pointerSpeed
      u.uPointerRadius.value = this.pointerRadius
      u.uPointerDrag.value.copy(this.pointerDrag)
      if (on) {
        u.uPointerFrom.value.copy(cam.position)
        u.uPointer.value.set(direction.x, direction.y, direction.z, this.pointerPresence)
      } else u.uPointer.value.w = 0
    }
    // A click (press without drag) sends a ring of light out from the pointer.
    if (this.pulsePending) {
      const pulse = this.pulsePending
      if (pulse.world === this.activeWorldIndex()) {
        active.uPulse.value.set(pulse.ray.x, pulse.ray.y, pulse.ray.z, pulse.time)
        active.uPulseFrom.value.copy(pulse.origin)
      }
      this.pulsePending = null
    }

    // Q-Day lands with a cold violet flash and a jolt of zoom.
    if (!this.showcase && this.qdayAt >= 0 && this.flashedQday !== this.qdayAt) {
      this.flashedQday = this.qdayAt
      this.flash = Math.max(this.flash, this.reducedMotion ? 0.08 : 0.2)
      this.flashColor.setRGB(0.62, 0.55, 1.0)
      this.zoom = this.reducedMotion ? 0 : 0.2
    }
    if (this.flash > 0.5) this.zoom = this.reducedMotion ? 0 : 1 // crossing a doorway
    this.zoom = Math.max(0, this.zoom - dt * 1.6)

    // The eye adapts: a crossing brightens for a beat, then settles. Kept short and shallow so the
    // Prism never washes out to white (bloom does the rest).
    const want = (this.showcase ? 1 : this.stages[this.active].exposure) + this.flash * 0.5
    this.exposure += (want - this.exposure) * Math.min(1, dt * (want > this.exposure ? 10 : 4))
    this.renderer.toneMappingExposure = this.exposure

    const f = this.finish.uniforms
    f.uTime.value = t
    this.flash = Math.max(0, this.flash - dt * 1.8)
    f.uFlash.value = this.flash * 0.8
    f.uZoom.value = this.zoom * this.zoom
    for (const u of [...this.stages, ...this.showcases.values()]) {
      for (const s of u.scene.children) {
        const m = (s as THREE.Points).material as THREE.ShaderMaterial | undefined
        if (m?.uniforms?.uPixelRatio && !('uSizeScale' in m.uniforms)) m.uniforms.uPixelRatio.value = pr
        if (m?.uniforms?.uTime && !('uSizeScale' in m.uniforms)) m.uniforms.uTime.value = t
      }
    }
  }

  /** Focus the lens on what the visitor is walking toward: the path ahead, then the door. */
  private tmpV = new THREE.Vector3()
  private updateLens(dt: number) {
    if (this.showcase) return
    const aperture = 0.0025
    const maxBlur = 48
    this.stages.forEach((st, j) => {
      st.u.uAperture.value = aperture
      st.u.uMaxBlur.value = maxBlur
      if (j !== this.active) { st.u.uFocus.value = 10; return }
      let focus = 8
      if (st.door && st.door.presence > 0.05) {
        const g = st.door.portal.group.position
        this.tmpV.set(g.x, g.y + DOOR.height * 0.45, g.z)
        focus = THREE.MathUtils.clamp(this.camera.position.distanceTo(this.tmpV), 3, 18)
      }
      st.u.uFocus.value += (focus - st.u.uFocus.value) * (1 - Math.exp(-2.5 * dt))
    })
  }

  /** Direction of the ray from the camera through the pointer, in the active world's space. */
  private pointerRay(position = this.look) {
    this.raycaster.setFromCamera(position, this.camera)
    return this.raycaster.ray.direction.clone()
  }

  private updateLabels() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight
    const j = this.active, st = this.stages[j]
    const s = this.r - st.start
    const doorTop = (id: DoorId) => {
      const d = st.door
      if (!d || d.id !== id) return { p: new THREE.Vector3(), show: false }
      const g = d.portal.group.position
      return { p: new THREE.Vector3(g.x, g.y + DOOR.height + 0.9, g.z), show: d.presence > 0.2 }
    }
    const todayAt = this.aheadPoint(1, TODAY_AT + 3)
    todayAt.y += 2.6
    const hidden = { p: new THREE.Vector3(), show: false }
    const spots: Record<LabelId, { p: THREE.Vector3; show: boolean }> = {
      today: { p: todayAt, show: st.region === 'today' && s < 30 },
      qday: hidden, u0: hidden, u1: hidden, u2: hidden,
      door1: doorTop('door1'),
      door2: doorTop('door2'),
    }
    for (const [id, el] of this.labels) {
      const spot = spots[id]
      if (!spot) continue
      const p = spot.p.clone().project(this.camera)
      const visible = !this.showcase && spot.show && p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2
      el.style.opacity = visible ? '1' : '0'
      el.style.pointerEvents = visible ? 'auto' : 'none'
      // keep a label's centre far enough from the edges that its text stays on screen
      const half = Math.min(el.offsetWidth / 2 + 8, w / 2)
      const x = THREE.MathUtils.clamp(((p.x + 1) / 2) * w, half, w - half)
      el.style.transform = `translate(${x}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -100%)`
      if (id.startsWith('door')) el.dataset.hover = String(this.hovered !== null && this.stages[this.hovered].door?.id === id)
    }
  }

  private emitState() {
    const st = this.stages[this.active]
    const inPrism = st.region === 'qday'
    const card = cardAt(this.r, this.zones)
    const i = this.stations.findIndex(x => Math.abs(this.r - x) < 1.5)
    const walk: WalkState = {
      region: st.region,
      // quantised so the page re-renders a few dozen times across a fade, not every frame
      card: card ? { id: card.id, strength: Math.round(card.strength * 50) / 50 } : null,
      liveIndex: i < 0 ? null : i,
    }
    const s: EngineState = {
      phase: inPrism ? 'inside' : 'trunk',
      branch: inPrism ? 0 : null,
      hovered: this.hovered,
      qday: inPrism,
      started: this.r > TUNNEL_STOP + 2 || this.glide !== null,
      stop: this.stopIndex(),
      gliding: this.glide !== null,
      stopCount: this.stopList.length,
      walk,
    }
    const key = JSON.stringify(s)
    if (key !== this.lastState) { this.lastState = key; this.cb.onState(s) }
  }

  private render() {
    if (this.showcase) {
      this.simulateParticles(this.showcase.scene, this.camera, true)
      this.renderPass.scene = this.showcase.scene
      this.renderPass.camera = this.camera
      this.composer.render()
      return
    }
    const st = this.stages[this.active], door = st.door, next = this.stages[this.active + 1]
    this.simulateParticles(st.scene, this.camera, true)
    if (door && next && door.open >= 0.004) {
      this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
      this.frustum.setFromProjectionMatrix(this.projScreen)
      const c = door.portal.group.position
      if (this.frustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(c.x, c.y + DOOR.height / 2, c.z), DOOR.height))) {
        this.simulateParticles(next.scene, next.cam, false)
        this.renderer.setRenderTarget(door.rt)
        this.renderer.render(next.scene, next.cam)
      }
    }
    this.renderer.setRenderTarget(null)
    this.renderPass.scene = st.scene
    this.renderPass.camera = this.camera
    this.composer.render()
  }

  private simulateParticles(scene: THREE.Scene, camera: THREE.PerspectiveCamera, active: boolean) {
    const time = this.stages[0].u.uTime.value
    scene.traverse(object => {
      if (!object.userData.particleCloud || !object.visible) return
      let entry = this.particles.get(object)
      if (!entry) {
        entry = { simulation: new ParticleSimulation(object as ReturnType<typeof cloud>), time: -1 }
        this.particles.set(object, entry)
      }
      if (entry.time === time) return
      // The distant preview has no pointer; integrate it at 30 Hz while drawing at
      // display refresh. The active world's input/springs always run every frame.
      if (!active && entry.time >= 0 && time - entry.time < 1 / 30 - 0.001) return
      // A dormant scene starts its springs anew; it never inherits a previous world's wake.
      if (entry.time >= 0 && time - entry.time > 0.2) entry.simulation.reset()
      entry.simulation.step(this.renderer, camera, this.fluid, entry.time < 0 ? 1 / 60 : time - entry.time, active && !this.reducedMotion)
      entry.time = time
    })
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight)
    // Render to a pixel budget rather than full Retina density: soft bokeh looks the same at a
    // lower resolution, and fill rate is what this scene spends. Quality adapts to the frame rate.
    const budget = 1.1e6
    const pr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, Math.sqrt(budget / (w * h))) * this.quality)
    const fov = w / h < 0.8 ? 78 : FOV
    for (const cam of [this.camera, ...this.stages.map(s => s.cam)]) {
      cam.fov = fov
      cam.aspect = w / h
      cam.updateProjectionMatrix()
    }
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(pr)
    this.composer.setSize(w, h)
    const sizeScale = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2))
    for (const u of this.allUniforms()) u.uSizeScale.value = sizeScale
    this.finish.uniforms.uAspect.value = w / h
    this.finish.uniforms.uResolution.value.set(Math.floor(w * pr), Math.floor(h * pr))
    this.fluid.resize(w, h)
    for (const s of this.stages) {
      const d = s.door
      if (!d) continue
      d.rt.setSize(Math.ceil(w * pr * d.rtScale), Math.ceil(h * pr * d.rtScale))
      ;(d.portal.contentMat.uniforms.uRes.value as THREE.Vector2).set(w * pr, h * pr)
    }
  }
}
