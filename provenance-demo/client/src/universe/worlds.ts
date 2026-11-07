import * as THREE from 'three'
import { fbm, rng } from './noise'
import {
  TRAIL_LENGTH, fieldFragment, fieldVertex, frameFragment, pathFragment, pathVertex,
  portalFragment, portalVertex, skyFragment, skyVertex,
} from './shaders'

export type RGB = [number, number, number]

/** Uniforms every particle field in one scene shares, so the engine updates them once. */
export interface SceneUniforms {
  uTime: { value: number }
  uPixelRatio: { value: number }
  uSizeScale: { value: number }
  uTrail: { value: THREE.Vector4[] }
  uShock: { value: THREE.Vector4 }
}

export function sceneUniforms(): SceneUniforms {
  return {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uSizeScale: { value: 900 },
    uTrail: { value: Array.from({ length: TRAIL_LENGTH }, () => new THREE.Vector4(0, 0, 99, 0)) },
    uShock: { value: new THREE.Vector4(0, 0, -99, 0) },
  }
}

interface FieldOptions {
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
  const seed = new Float32Array(o.count)
  const [x0, x1] = o.x, [z0, z1] = o.z
  // Hex-lattice spacing that fills the area with exactly `count` points.
  const spacing = o.lattice ? Math.sqrt(((x1 - x0) * (z1 - z0)) / (o.count * 0.866)) : 0
  const cols = spacing ? Math.max(1, Math.floor((x1 - x0) / spacing)) : 0
  for (let i = 0; i < o.count; i++) {
    let x: number, z: number
    if (spacing && cols) {
      // Hex lattice: ordered, but rows offset so it reads as structure rather than a grid.
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
    const c = o.color(r, x, z)
    col.set(c, i * 3)
    size[i] = o.size(r)
    seed[i] = r()
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  const m = new THREE.ShaderMaterial({
    vertexShader: fieldVertex,
    fragmentShader: fieldFragment,
    uniforms: {
      ...u,
      uMode: { value: o.mode },
      uFogNear: { value: o.fog[0] },
      uFogFar: { value: o.fog[1] },
      uOpacity: { value: o.opacity ?? 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(g, m)
  points.frustumCulled = false
  return points
}

export function sky(top: RGB, horizon: RGB, ground: RGB, moonDir: THREE.Vector3, moonColor: RGB, moonSize: number) {
  const m = new THREE.ShaderMaterial({
    vertexShader: skyVertex.replace('vDir = normalize(position);',
      'vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);'),
    fragmentShader: skyFragment,
    uniforms: {
      uTop: { value: new THREE.Color(...top) },
      uHorizon: { value: new THREE.Color(...horizon) },
      uGround: { value: new THREE.Color(...ground) },
      uMoonDir: { value: moonDir.clone().normalize() },
      uMoonColor: { value: new THREE.Color(...moonColor) },
      uMoonSize: { value: moonSize },
    },
    side: THREE.BackSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), m)
  mesh.renderOrder = -10
  mesh.frustumCulled = false
  return mesh
}

export function stars(count: number, seed: number, tint: RGB) {
  const r = rng(seed)
  const pos = new Float32Array(count * 3)
  const s = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const th = r() * Math.PI * 2, y = 0.08 + Math.pow(r(), 0.7) * 0.9
    const rad = Math.sqrt(1 - y * y)
    pos.set([Math.cos(th) * rad * 500, y * 500, Math.sin(th) * rad * 500], i * 3)
    s[i] = r()
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1))
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uTint: { value: new THREE.Color(...tint) } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uPixelRatio; attribute float aSeed; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = (0.35 + 0.65 * aSeed) * (0.7 + 0.3 * sin(uTime * (0.5 + aSeed * 2.0) + aSeed * 50.0));
        gl_PointSize = (1.0 + aSeed * 1.6) * uPixelRatio;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; varying float vA;
      void main() { float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard; gl_FragColor = vec4(uTint, (1.0 - r) * vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const p = new THREE.Points(g, m)
  p.frustumCulled = false
  p.renderOrder = -9
  return p
}

export interface PathPiece { curve: THREE.Curve<THREE.Vector3>; branch: number; density: number }

export function glowingPath(
  u: SceneUniforms, pieces: PathPiece[], tints: [RGB, RGB, RGB], seed: number, fogFar: number,
  height: (x: number, z: number) => number = () => 0,
) {
  const r = rng(seed)
  const total = pieces.reduce((n, p) => n + Math.floor(p.curve.getLength() * p.density), 0)
  const pos = new Float32Array(total * 3)
  const t = new Float32Array(total), b = new Float32Array(total)
  const sd = new Float32Array(total), sz = new Float32Array(total)
  const tmp = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3()
  let i = 0
  for (const piece of pieces) {
    const n = Math.floor(piece.curve.getLength() * piece.density)
    for (let k = 0; k < n; k++, i++) {
      const u0 = r()
      piece.curve.getPointAt(u0, tmp)
      piece.curve.getTangentAt(u0, tan)
      side.set(-tan.z, 0, tan.x).normalize()
      // A narrow core with a few strays, so it reads as a stream of light rather than a line.
      const spread = r() < 0.85 ? (r() - 0.5) * 0.22 : (r() - 0.5) * 0.9
      const px = tmp.x + side.x * spread, pz = tmp.z + side.z * spread
      pos.set([px, height(px, pz) + 0.05 + r() * 0.06, pz], i * 3)
      t[i] = u0
      b[i] = piece.branch
      sd[i] = r()
      sz[i] = 0.05 + r() * 0.07
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1))
  g.setAttribute('aBranch', new THREE.BufferAttribute(b, 1))
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1))
  const m = new THREE.ShaderMaterial({
    vertexShader: pathVertex,
    fragmentShader: pathFragment,
    uniforms: {
      uTime: u.uTime, uPixelRatio: u.uPixelRatio, uSizeScale: u.uSizeScale, uShock: u.uShock,
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

export const DOOR = { width: 4.2, height: 7.2 }

/** A doorway: an opaque window showing another universe, plus an additive glowing frame. */
export function portal(tint: RGB, target: THREE.WebGLRenderTarget) {
  const group = new THREE.Group()
  const contentMat = new THREE.ShaderMaterial({
    vertexShader: portalVertex,
    fragmentShader: portalFragment,
    uniforms: {
      uTex: { value: target.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uOpen: { value: 0 },
      uHover: { value: 0 },
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(...tint) },
    },
  })
  const content = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.width, DOOR.height), contentMat)
  content.position.y = DOOR.height / 2
  const fw = DOOR.width * 3.2, fh = DOOR.height * 1.9
  const frameMat = new THREE.ShaderMaterial({
    vertexShader: portalVertex,
    fragmentShader: frameFragment,
    uniforms: {
      uOpen: contentMat.uniforms.uOpen,
      uHover: contentMat.uniforms.uHover,
      uTint: contentMat.uniforms.uTint,
      uDoor: { value: new THREE.Vector2(DOOR.width / 2 / fw, DOOR.height / 2 / fh) },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), frameMat)
  frame.position.set(0, DOOR.height / 2, 0.01)
  frame.renderOrder = 5
  group.add(content, frame)
  return { group, content, contentMat }
}

// ── The home meadow (today) ────────────────────────────────────────────────

export function homeHeight(x: number, z: number) {
  return 2.2 * fbm(x * 0.03 + 3.1, z * 0.03 - 1.7, 4) + 0.5 * fbm(x * 0.11 + 9, z * 0.11, 3)
}

// ── The three universes past Q-Day ─────────────────────────────────────────

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
    // A broken ring hanging in the sky: the old lock, cracked open.
    const ringCount = Math.floor(5000 * k), rr = rng(5)
    const ring = new Float32Array(ringCount * 3)
    for (let i = 0; i < ringCount; i++) {
      const a = (0.25 + rr() * 0.75) * Math.PI * 2 + 0.5
      const rad = 26 + (rr() - 0.5) * 1.6
      ring.set([Math.cos(a) * rad, 30 + Math.sin(a) * rad, -120 + (rr() - 0.5) * 2], i * 3)
    }
    scene.add(looseParticles(u, ring, [1.0, 0.45, 0.15], 0.25, 1, 21, [60, 220]))
  } else if (def.id === 'hybrid') {
    h = (x, z) => entrance(x, z) * (1.6 * Math.sin(x * 0.07) * Math.cos(z * 0.045) + 0.9 * fbm(x * 0.04, z * 0.04, 3))
    scene.add(sky([0.0, 0.015, 0.02], [0.01, 0.12, 0.1], [0.0, 0.01, 0.01], new THREE.Vector3(-0.3, 0.35, -1), [0.3, 0.45, 0.4], 0.003))
    scene.add(particleField(u, {
      count: Math.floor(100000 * k), x: [-70, 70], z: [-160, -1], height: h, mode: 2, seed: 12, fog: [25, 140],
      lattice: true,
      color: (r) => r() < 0.08 ? [0.75, 1.0, 0.9] : [0.06 + r() * 0.1, 0.45 + r() * 0.4, 0.3 + r() * 0.35],
      size: (r) => 0.045 + r() * 0.04,
    }))
    // Aurora curtains: the quantum-safe layer, steady overhead.
    const n = Math.floor(14000 * k), ar = rng(8)
    const au = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const x = -90 + ar() * 180
      au.set([x, 18 + ar() * 16, -110 + Math.sin(x * 0.05) * 18 + (ar() - 0.5) * 3], i * 3)
    }
    scene.add(looseParticles(u, au, [0.3, 1.0, 0.7], 0.35, 2, 22, [80, 260], 0.55))
    scene.add(stars(lowPower ? 600 : 1400, 4, [0.8, 1.0, 0.95]))
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
  scene.add(glowingPath(u, [{ curve: pathCurve, branch: 1, density: lowPower ? 60 : 110 }], [tint, tint, tint], 31, 90, h))
  return scene
}

export function looseParticles(u: SceneUniforms, pos: Float32Array, c: RGB, size: number, mode: number, seed: number, fog: [number, number], opacity = 1) {
  const n = pos.length / 3, r = rng(seed)
  const col = new Float32Array(n * 3), sz = new Float32Array(n), sd = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const b = 0.5 + r() * 0.8
    col.set([c[0] * b, c[1] * b, c[2] * b], i * 3)
    sz[i] = size * (0.5 + r())
    sd[i] = r()
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1))
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
  const m = new THREE.ShaderMaterial({
    vertexShader: fieldVertex, fragmentShader: fieldFragment,
    uniforms: { ...u, uMode: { value: mode }, uFogNear: { value: fog[0] }, uFogFar: { value: fog[1] }, uOpacity: { value: opacity } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const p = new THREE.Points(g, m)
  p.frustumCulled = false
  return p
}
