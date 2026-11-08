import * as THREE from 'three'
import { fbm, rng } from './noise'
import { hangingCave } from './cave'
import {
  TRAIL_LENGTH, fieldFragment, fieldVertex, pathFragment, pathVertex,
  portalFragment, portalVertex, skyFragment, skyVertex, sparkFragment, sparkVertex,
  starFragment, starVertex,
} from './shaders'

export type RGB = [number, number, number]

/** Uniforms every particle field in one scene shares, so the engine updates them once. */
export interface SceneUniforms {
  uTime: { value: number }
  uPixelRatio: { value: number }
  uSizeScale: { value: number }
  uTrail: { value: THREE.Vector4[] }
  uShock: { value: THREE.Vector4 }
  /** Click: xyz ray direction, w start time (very negative: none). */
  uPulse: { value: THREE.Vector4 }
  /** Live pointer: xyz ray direction, w presence 0..1; rays start at uPointerFrom (the camera). */
  uPointer: { value: THREE.Vector4 }
  uPointerFrom: { value: THREE.Vector3 }
  uWakeN: { value: number }
  uTrailWeight: { value: Float32Array }
  uPointerSpeed: { value: number }
  uPointerRadius: { value: number }
  uPointerDrag: { value: THREE.Vector3 }
  uTrailSweep: { value: THREE.Vector3[] }
  uPulseFrom: { value: THREE.Vector3 }
  /** Lens: focal distance (m), aperture radius, largest bokeh disc (css px). */
  uFocus: { value: number }
  uAperture: { value: number }
  uMaxBlur: { value: number }
}

export function sceneUniforms(): SceneUniforms {
  return {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uSizeScale: { value: 900 },
    uTrail: { value: Array.from({ length: TRAIL_LENGTH }, () => new THREE.Vector4(0, 0, -1, 99)) },
    uShock: { value: new THREE.Vector4(0, 0, -99, 0) },
    uPulse: { value: new THREE.Vector4(0, 0, -1, -99) },
    uPointer: { value: new THREE.Vector4(0, 0, -1, 0) },
    uPointerFrom: { value: new THREE.Vector3() },
    uWakeN: { value: 0 },
    uTrailWeight: { value: new Float32Array(TRAIL_LENGTH) },
    uPointerSpeed: { value: 0 },
    uPointerRadius: { value: 0.06075 },
    uPointerDrag: { value: new THREE.Vector3() },
    uTrailSweep: { value: Array.from({ length: TRAIL_LENGTH }, () => new THREE.Vector3()) },
    uPulseFrom: { value: new THREE.Vector3() },
    uFocus: { value: 10 },
    uAperture: { value: 0.0025 },
    uMaxBlur: { value: 48 },
  }
}

export interface FieldStyle {
  fogColor?: RGB
  center?: THREE.Vector3
  /** Sideways direction for clouds that part (the Q-Day curtain). */
  axis?: THREE.Vector3
  /** Structural portal particles remain aligned with the aperture. */
  interaction?: number
}

/** The material every particle cloud uses; `mode` picks its motion (see fieldVertex). */
export function fieldMaterial(u: SceneUniforms, mode: number, fog: [number, number], opacity = 1, style: FieldStyle = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: fieldVertex,
    fragmentShader: fieldFragment,
    uniforms: {
      ...u,
      uPositions: { value: null }, uVelocities: { value: null },
      uOffsets: { value: null }, uDrifts: { value: null },
      uStateReady: { value: 0 }, uDelta: { value: 1 / 60 },
      uMode: { value: mode },
      uInteraction: { value: style.interaction ?? 1 },
      uFogNear: { value: fog[0] },
      uFogFar: { value: fog[1] },
      uOpacity: { value: opacity },
      uFogColor: { value: new THREE.Color(...(style.fogColor ?? [0, 0, 0])) },
      uCenter: { value: style.center?.clone() ?? new THREE.Vector3() },
      uAxis: { value: style.axis?.clone() ?? new THREE.Vector3(1, 0, 0) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

export function cloud(
  u: SceneUniforms, pos: Float32Array, col: Float32Array, size: Float32Array, mode: number,
  fog: [number, number], seed: number, opacity = 1, style: FieldStyle = {},
) {
  const n = pos.length / 3, r = rng(seed)
  const sd = new Float32Array(n)
  for (let i = 0; i < n; i++) sd[i] = r()
  const width = Math.min(1024, n), height = Math.ceil(n / width)
  const stateUv = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) stateUv.set([(i % width + 0.5) / width, (Math.floor(i / width) + 0.5) / height], i * 2)
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
  g.setIndex([0, 1, 2, 0, 2, 3])
  g.instanceCount = n
  g.setAttribute('aBasePosition', new THREE.InstancedBufferAttribute(pos, 3))
  g.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3))
  g.setAttribute('aSize', new THREE.InstancedBufferAttribute(mode === 13 ? size : size.map(s => s * 0.5), 1))
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd, 1))
  g.setAttribute('aHang', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4))
  g.setAttribute('aStateUv', new THREE.InstancedBufferAttribute(stateUv, 2))
  const p = new THREE.Mesh(g, fieldMaterial(u, mode, fog, opacity, style))
  p.userData.particleCloud = true
  p.frustumCulled = false
  return p
}

interface FieldOptions extends FieldStyle {
  count: number
  x: [number, number]
  z: [number, number]
  height: (x: number, z: number) => number
  color: (r: () => number, x: number, z: number) => RGB
  size: (r: () => number) => number
  mode: number
  seed: number
  fog: [number, number]
  opacity?: number
  yJitter?: (r: () => number) => number
  lattice?: boolean
}

export function particleField(u: SceneUniforms, o: FieldOptions) {
  const r = rng(o.seed)
  const pos = new Float32Array(o.count * 3)
  const col = new Float32Array(o.count * 3)
  const size = new Float32Array(o.count)
  const [x0, x1] = o.x, [z0, z1] = o.z
  // Hex-lattice spacing that fills the area with exactly `count` points.
  const spacing = o.lattice ? Math.sqrt(((x1 - x0) * (z1 - z0)) / (o.count * 0.866)) : 0
  const cols = spacing ? Math.max(1, Math.floor((x1 - x0) / spacing)) : 0
  for (let i = 0; i < o.count; i++) {
    let x: number, z: number
    if (spacing && cols) {
      const row = Math.floor(i / cols), c = i % cols
      x = x0 + (c + (row % 2) * 0.5) * spacing
      z = z1 - row * spacing * 0.866
      if (z < z0) { x = x0 + r() * (x1 - x0); z = z0 + r() * (z1 - z0) }
    } else {
      x = x0 + r() * (x1 - x0)
      z = z0 + r() * (z1 - z0)
    }
    pos[i * 3] = x
    pos[i * 3 + 1] = o.height(x, z) + (o.yJitter ? o.yJitter(r) : 0)
    pos[i * 3 + 2] = z
    col.set(o.color(r, x, z), i * 3)
    size[i] = o.size(r)
  }
  return cloud(u, pos, col, size, o.mode, o.fog, o.seed + 1000, o.opacity ?? 1, o)
}

export interface SkyExtras {
  glow?: RGB
  band?: RGB
  ridge?: { near: RGB; far: RGB; height: number; seed: number }
  sun?: THREE.Vector3
  body?: 'moon' | 'planet'
  ring?: RGB
  aurora?: number
}

export function sky(
  top: RGB, horizon: RGB, ground: RGB, moonDir: THREE.Vector3, moonColor: RGB, moonSize: number,
  x: SkyExtras = {},
) {
  // Older callers passed a cosine-style size; anything tiny is converted to an angular radius.
  const radius = moonSize < 0.02 ? Math.acos(1 - moonSize) * 0.7 : moonSize
  const m = new THREE.ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    uniforms: {
      uTime: { value: 0 },
      uTop: { value: new THREE.Color(...top) },
      uHorizon: { value: new THREE.Color(...horizon) },
      uGround: { value: new THREE.Color(...ground) },
      uGlow: { value: new THREE.Color(...(x.glow ?? [0, 0, 0])) },
      uBand: { value: new THREE.Color(...(x.band ?? [0, 0, 0])) },
      uRidgeNear: { value: new THREE.Color(...(x.ridge?.near ?? [0, 0, 0])) },
      uRidgeFar: { value: new THREE.Color(...(x.ridge?.far ?? [0, 0, 0])) },
      uRidgeHeight: { value: x.ridge?.height ?? 0 },
      uRidgeSeed: { value: x.ridge?.seed ?? 1 },
      uMoonDir: { value: moonDir.clone().normalize() },
      uMoonColor: { value: new THREE.Color(...moonColor) },
      uMoonSize: { value: radius },
      uSunDir: { value: (x.sun ?? new THREE.Vector3(0.3, 0.4, 1)).clone().normalize() },
      uBodyKind: { value: x.body === 'planet' ? 1 : 0 },
      uRingColor: { value: new THREE.Color(...(x.ring ?? moonColor)) },
      uAurora: { value: x.aurora ?? 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(600, 64, 32), m)
  mesh.renderOrder = -10
  mesh.frustumCulled = false
  return mesh
}

export function stars(count: number, seed: number, tint: RGB) {
  const r = rng(seed)
  const pos = new Float32Array(count * 3)
  const s = new Float32Array(count)
  const col = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // denser toward a band across the sky, like a galaxy seen edge-on
    const inBand = r() < 0.45
    let x: number, y: number, z: number
    if (inBand) {
      const a = r() * Math.PI * 2, w = (r() - 0.5) * 0.35
      const axis = new THREE.Vector3(0.35, 0.25, 0.9).normalize()
      const t1 = new THREE.Vector3(1, 0, 0).cross(axis).normalize(), t2 = axis.clone().cross(t1)
      const v = t1.multiplyScalar(Math.cos(a)).add(t2.multiplyScalar(Math.sin(a))).addScaledVector(axis, w).normalize()
      x = v.x; y = Math.abs(v.y) * 0.95 + 0.04; z = v.z
    } else {
      const th = r() * Math.PI * 2
      y = 0.04 + Math.pow(r(), 0.7) * 0.94
      const rad = Math.sqrt(1 - y * y)
      x = Math.cos(th) * rad; z = Math.sin(th) * rad
    }
    pos.set([x * 500, y * 500, z * 500], i * 3)
    s[i] = r()
    const k = r()
    col.set(k < 0.15 ? [1.0, 0.8, 0.6] : k < 0.35 ? [0.7, 0.8, 1.0] : [1, 1, 1], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1))
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uTint: { value: new THREE.Color(...tint) } },
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const p = new THREE.Points(g, m)
  p.frustumCulled = false
  p.renderOrder = -9
  return p
}

export interface PathPiece { curve: THREE.Curve<THREE.Vector3>; branch: number; density: number }

/**
 * A stream of light along curves: a tight bright core, a wide faint spill of light on the
 * ground around it, and sparks lifting off it.
 */
export function glowingPath(
  u: SceneUniforms, pieces: PathPiece[], tints: [RGB, RGB, RGB], seed: number, fogFar: number,
  height: (x: number, z: number) => number = () => 0,
) {
  const r = rng(seed)
  const counts = pieces.map(p => Math.floor(p.curve.getLength() * p.density))
  const total = counts.reduce((a, b) => a + b, 0)
  const pos = new Float32Array(total * 3)
  const t = new Float32Array(total), b = new Float32Array(total)
  const sd = new Float32Array(total), sz = new Float32Array(total), kind = new Float32Array(total)
  const tmp = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3()
  let i = 0
  pieces.forEach((piece, pi) => {
    for (let k = 0; k < counts[pi]; k++, i++) {
      const u0 = r()
      piece.curve.getPointAt(u0, tmp)
      piece.curve.getTangentAt(u0, tan)
      side.set(-tan.z, 0, tan.x).normalize()
      const roll = r()
      const kd = roll < 0.8 ? 0 : roll < 0.93 ? 1 : 2
      // Gaussian-ish spread: a hot narrow core with soft edges.
      const g = (r() + r() + r() - 1.5) / 1.5
      const spread = kd === 0 ? g * 0.16 : kd === 1 ? g * 1.1 : g * 0.5
      const px = tmp.x + side.x * spread, pz = tmp.z + side.z * spread
      pos.set([px, height(px, pz) + 0.04 + r() * (kd === 1 ? 0.02 : 0.06), pz], i * 3)
      t[i] = u0
      b[i] = piece.branch
      sd[i] = r()
      sz[i] = kd === 0 ? 0.03 + r() * 0.045 : kd === 1 ? 0.06 + r() * 0.08 : 0.022 + r() * 0.025
      kind[i] = kd
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1))
  g.setAttribute('aBranch', new THREE.BufferAttribute(b, 1))
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1))
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1))
  const m = new THREE.ShaderMaterial({
    vertexShader: pathVertex,
    fragmentShader: pathFragment,
    uniforms: {
      uTime: u.uTime, uPixelRatio: u.uPixelRatio, uSizeScale: u.uSizeScale, uShock: u.uShock, uPulse: u.uPulse, uPointerFrom: u.uPointerFrom,
      uFocus: u.uFocus, uAperture: u.uAperture, uMaxBlur: u.uMaxBlur,
      uTintA: { value: new THREE.Color(...tints[0]) },
      uTintB: { value: new THREE.Color(...tints[1]) },
      uTintC: { value: new THREE.Color(...tints[2]) },
      uBranchGain: { value: new THREE.Vector3(1, 1, 1) },
      uFogFar: { value: fogFar },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const p = new THREE.Points(g, m)
  p.frustumCulled = false
  return p
}

/** The gate is round: a circle of radius width/2 whose top is at `height`. */
export const DOOR = { width: 2.3, height: 3.4, frame: 1.1, slit: 0.012 }

/** Shared by the membrane, sliding dust and CPU picking. */
export function doorHalfWidth(open: number) {
  return DOOR.slit + 1.138 * THREE.MathUtils.clamp(open, 0, 1)
}

export function doorProgress(remaining: number) {
  const reveal = THREE.MathUtils.smoothstep(44 - remaining, 0, 14)
  const approach = THREE.MathUtils.smoothstep(26 - remaining, 0, 18)
  return { presence: reveal, open: THREE.MathUtils.smoothstep(approach, 0, 1) }
}

function portalRandom(index: number, salt: number) {
  const pcg = (v: number) => {
    const state = (Math.imul(v, 747796405) + 2891336453) >>> 0
    const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0
    return ((word >>> 22) ^ word) >>> 0
  }
  return pcg(index ^ pcg(pcg(salt))) / 4294967295
}

/**
 * A depth-writing window into another universe and sparks drifting out of it.
 * The frame and ground spill are rendered as particles by gateWall.
 */
export function portal(tint: RGB, target: THREE.WebGLRenderTarget, lowPower = false) {
  const group = new THREE.Group()
  const contentMat = new THREE.ShaderMaterial({
    vertexShader: portalVertex,
    fragmentShader: portalFragment,
    uniforms: {
      uTex: { value: target.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uOpen: { value: 0 },
      uHalfWidth: { value: DOOR.slit },
      uImpact: { value: 0 },
      uPresence: { value: 0 },
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(...tint) },
      uSize: { value: new THREE.Vector2(DOOR.width, DOOR.height) },
    },
  })
  const content = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.width, DOOR.height), contentMat)
  content.position.y = DOOR.height / 2
  const shared = {
    uOpen: contentMat.uniforms.uOpen,
    uTint: contentMat.uniforms.uTint,
    uTime: contentMat.uniforms.uTime,
    uHalfWidth: contentMat.uniforms.uHalfWidth,
    uImpact: contentMat.uniforms.uImpact,
    uPresence: contentMat.uniforms.uPresence,
  }
  const n = lowPower ? 320 : 800, r = rng(Math.floor(tint[0] * 97 + tint[1] * 31))
  const sp = new Float32Array(n * 3), ss = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    sp.set([r() * 2 - 1, r() * DOOR.height, 0.1], i * 3)
    ss[i] = r()
  }
  const sg = new THREE.BufferGeometry()
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
  sg.setAttribute('aSeed', new THREE.BufferAttribute(ss, 1))
  const sparkMat = new THREE.ShaderMaterial({
    vertexShader: sparkVertex, fragmentShader: sparkFragment,
    uniforms: { ...shared, uScale: { value: 70 * Math.min(window.devicePixelRatio || 1, 1.75) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const sparks = new THREE.Points(sg, sparkMat)
  sparks.frustumCulled = false
  sparks.renderOrder = 6

  group.add(content, sparks)
  group.visible = false
  return { group, content, contentMat, sparkMat }
}

export function gateWall(tint: RGB, lowPower: boolean) {
  const n = lowPower ? 3680 : 9200
  const pos: number[] = [], col: number[] = [], size: number[] = [], shape: number[] = []
  const outer = DOOR.width / 2 + DOOR.frame
  for (let i = 0; i < n; i++) {
    const r = (salt: number) => portalRandom(i, salt)
    if (i < n * (0.6 / 0.92)) {
      const side = r(81) < 0.5 ? 1 : -1, reach = Math.pow(r(82), 1.8), top = r(83) < 0.18
      const x = top ? (r(86) * 2 - 1) * outer : side * reach * outer
      const y = top ? DOOR.height + r(85) * DOOR.frame * 0.6 : r(84) * DOOR.height
      pos.push(x, y, (r(87) - 0.5) * 0.35)
      // x: movement per unit half-width, y: reach, z: top beam, w: -1 for slab.
      shape.push(top ? 0 : side * (1 - reach), reach, top ? 1 : 0, -1)
      const b = r(88) < 0.09 ? 1.5 : 0.65 + r(89) * 0.35
      col.push((tint[0] * 0.7 + 0.3) * b, (tint[1] * 0.7 + 0.3) * b, (tint[2] * 0.7 + 0.3) * b)
      size.push(0.04 * THREE.MathUtils.lerp(0.6, 1.2, r(89)))
    } else {
      const distance = Math.pow(r(91), 1.6) * 7
      const bell = (r(92) + r(93) + r(94)) * (2 / 3) - 1
      pos.push(bell * 0.02, 0.015, distance + 0.175)
      shape.push(bell * (1 + distance * 0.35), 0, 0, distance)
      col.push(tint[0] * 0.7 + 0.3, tint[1] * 0.7 + 0.3, tint[2] * 0.7 + 0.3)
      size.push(0.04 * THREE.MathUtils.lerp(0.6, 1.2, r(94)))
    }
  }
  return { pos: new Float32Array(pos), col: new Float32Array(col), size: new Float32Array(size), shape: new Float32Array(shape) }
}

// ── The home meadow (today) ────────────────────────────────────────────────

export function homeHeight(x: number, z: number) {
  return 2.2 * fbm(x * 0.03 + 3.1, z * 0.03 - 1.7, 4) + 0.5 * fbm(x * 0.11 + 9, z * 0.11, 3)
}

// ── The universes past Q-Day ───────────────────────────────────────────────

export interface UniverseDef {
  id: 'rsa' | 'hybrid' | 'unsigned'
  title: string
  line: string
  rule: string
  tint: RGB
}

export const UNIVERSES: UniverseDef[] = [
  {
    id: 'rsa',
    title: 'The world stayed on RSA',
    line: 'Proof collapses. Forgeries pass as real.',
    rule: 'Checked the way today’s apps check: any valid old-style seal counts, even after Q-Day.',
    tint: [1.0, 0.42, 0.16],
  },
  {
    id: 'hybrid',
    title: 'The world went hybrid',
    line: 'Proof survives. Forgery caught.',
    rule: 'Checked by us: broken algorithms only count if the photo was logged before Q-Day. ML-DSA-65 still holds.',
    tint: [0.28, 1.0, 0.62],
  },
  {
    id: 'unsigned',
    title: 'Nobody signed anything',
    line: 'Only AI guesses left. Nothing is provable.',
    rule: 'No seals anywhere. Every photo is a guess — real and fake look the same.',
    tint: [0.72, 0.74, 0.8],
  },
]

/** Flatten the ground near a universe's entrance so the floor meets the doorway. */
const entrance = (x: number, z: number) => Math.min(1, Math.hypot(x, z + 2) / 26)

export function universeScene(def: UniverseDef, u: SceneUniforms, lowPower: boolean) {
  const scene = new THREE.Scene()
  const k = lowPower ? 0.45 : 1
  const pathCurve = new THREE.LineCurve3(new THREE.Vector3(0, 0, -0.5), new THREE.Vector3(0, 0, -70))
  let h: (x: number, z: number) => number

  if (def.id === 'rsa') {
    h = (x, z) => entrance(x, z) * (3.4 * fbm(x * 0.05, z * 0.05, 5) + 1.4 * Math.abs(fbm(x * 0.14, z * 0.14, 3)))
    scene.add(sky([0.03, 0.004, 0.002], [0.32, 0.07, 0.02], [0.02, 0.005, 0.0], new THREE.Vector3(0.15, 0.05, -1), [0.55, 0.18, 0.05], 0.006))
    scene.add(particleField(u, {
      count: Math.floor(90000 * k), x: [-70, 70], z: [-160, -1], height: h, mode: 1, seed: 11, fog: [20, 120],
      color: (r) => r() < 0.12 ? [1.0, 0.62 + r() * 0.2, 0.25] : [0.55 + r() * 0.4, 0.12 + r() * 0.12, 0.04],
      size: (r) => 0.04 + r() * 0.06,
    }))
    const ringCount = Math.floor(5000 * k), rr = rng(5)
    const ring = new Float32Array(ringCount * 3)
    for (let i = 0; i < ringCount; i++) {
      const a = (0.25 + rr() * 0.75) * Math.PI * 2 + 0.5
      const rad = 26 + (rr() - 0.5) * 1.6
      ring.set([Math.cos(a) * rad, 30 + Math.sin(a) * rad, -120 + (rr() - 0.5) * 2], i * 3)
    }
    scene.add(looseParticles(u, ring, [1.0, 0.45, 0.15], 0.25, 1, 21, [60, 220]))
  } else if (def.id === 'hybrid') {
    h = hybridHeight
    buildHybrid(scene, u, lowPower)
  } else {
    h = (x, z) => entrance(x, z) * 0.5 * fbm(x * 0.03, z * 0.03, 2)
    scene.add(sky([0.05, 0.05, 0.06], [0.11, 0.11, 0.125], [0.05, 0.05, 0.06], new THREE.Vector3(0, 0.2, -1), [0.1, 0.1, 0.11], 0.012))
    scene.add(particleField(u, {
      count: Math.floor(70000 * k), x: [-70, 70], z: [-160, -1], height: h, mode: 3, seed: 13, fog: [8, 70], opacity: 0.55,
      color: (r) => { const g = 0.35 + r() * 0.35; return [g, g, g * 1.04] },
      size: (r) => 0.07 + r() * 0.12,
      yJitter: (r) => r() * 4,
    }))
  }
  const tint = def.tint
  const walk = def.id === 'hybrid' ? HYBRID_PATH : pathCurve
  scene.add(glowingPath(u, [{ curve: walk, branch: 1, density: lowPower ? 60 : 120 }], [tint, tint, tint], 31, 110, h))
  return scene
}

// ── The hybrid world: post-quantum, ordered, calm ──────────────────────────

// Our world: a tunnel of hanging glass beads, quiet and exact, lit by one light ahead.
// Gentle floor, nearly flat near the door so the threshold is level.
export const hybridHeight = (x: number, z: number) =>
  entrance(x, z) * (0.6 * fbm(x * 0.04, z * 0.04, 3) + 0.25 * Math.sin(x * 0.08))

const HYBRID_FOG: RGB = [0.01, 0.06, 0.05]

/** The walk inside our world: straight through the door, then winding toward the light. */
export const HYBRID_PATH = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -16), new THREE.Vector3(1.6, 0, -30),
  new THREE.Vector3(-1.8, 0, -44), new THREE.Vector3(1.2, 0, -58), new THREE.Vector3(-0.6, 0, -72),
  new THREE.Vector3(0.8, 0, -86),
], false, 'centripetal')

function buildHybrid(scene: THREE.Scene, u: SceneUniforms, lowPower: boolean) {
  const k = lowPower ? 0.45 : 1
  const fog = { fogColor: HYBRID_FOG }

  // Near-black green air and one bright light hanging far down the tunnel.
  scene.add(sky(
    [0.002, 0.01, 0.009], [0.008, 0.035, 0.03], [0.004, 0.018, 0.015],
    new THREE.Vector3(0.12, 0.2, -1), [1.5, 1.6, 1.5], 0.022,
    { glow: [0.03, 0.12, 0.1], sun: new THREE.Vector3(0, 0, 1), body: 'moon' },
  ))

  // The floor: dark, sparse grains so the beads and the path carry the light.
  scene.add(particleField(u, {
    count: Math.floor(90000 * k), x: [-40, 40], z: [-150, -1], height: hybridHeight, mode: 0, seed: 12, fog: [14, 120], ...fog,
    color: (r) => { if (r() < 0.05) return [0.5, 1.0, 0.85]; const b = 0.35 + r() * 0.65; return [0.08 * b, 0.5 * b, 0.4 * b] },
    size: (r) => 0.04 + r() * r() * 0.08,
    yJitter: (r) => r() * r() * 0.2,
  }))

  const hanging = hangingCave({
    walls: Math.floor(189235 * k), roots: Math.floor(252 * k), threads: Math.floor(1190 * k), length: 96,
    pathX: (z) => HYBRID_PATH.getPointAt(Math.min(1, Math.max(0, -z / 86))).x,
    ground: hybridHeight,
  })
  for (const [index, layer] of [hanging.walls, hanging.roots, hanging.threads].entries()) {
    const beads = cloud(u, layer.positions, layer.colors, layer.sizes, 13, [10, 120], 14 + index, 1, fog)
    beads.geometry.setAttribute('aHang', new THREE.InstancedBufferAttribute(layer.hang, 4))
    scene.add(beads)
  }

  // Loose beads drifting in the air of the nave, lit by the light ahead.
  const mr = rng(10), mn = Math.floor(4500 * k)
  const mp = new Float32Array(mn * 3), mc = new Float32Array(mn * 3), ms = new Float32Array(mn)
  for (let i = 0; i < mn; i++) {
    const z = -2 - mr() * 120, x = (mr() - 0.5) * 10
    mp.set([x, hybridHeight(x, z) + 0.3 + mr() * 9, z], i * 3)
    const b = 0.6 + mr() * 0.7
    mc.set([0.5 * b, 1.0 * b, 0.88 * b], i * 3)
    ms[i] = mr() < 0.1 ? 0.07 + mr() * 0.08 : 0.025 + mr() * 0.03
  }
  scene.add(cloud(u, mp, mc, ms, 8, [6, 90], 24, 0.8, fog))
}

export function looseParticles(u: SceneUniforms, pos: Float32Array, c: RGB, size: number, mode: number, seed: number, fog: [number, number], opacity = 1, style: FieldStyle = {}) {
  const n = pos.length / 3, r = rng(seed)
  const col = new Float32Array(n * 3), sz = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const b = 0.5 + r() * 0.8
    col.set([c[0] * b, c[1] * b, c[2] * b], i * 3)
    sz[i] = size * (0.5 + r())
  }
  return cloud(u, pos, col, sz, mode, fog, seed + 7, opacity, style)
}
