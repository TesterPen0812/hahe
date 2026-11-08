import * as THREE from 'three'
import { scenePath } from './scenePath'
import { asciiRain } from './asciiRain'
import { cloud, sky, type RGB, type SceneUniforms } from './worlds'

/** The green of the tunnel's character strands; door 2's character wall is the same green. */
export const TUNNEL_GLYPH_GREEN: RGB = [0.34, 1.0, 0.5]

const TAU = Math.PI * 2
const PATH_AMPLITUDE = 1.5
const START = 8
const BEYOND = 3
const WIDTH = 2.1
const SPRING = 1.6
const RISE = 1.5
const DEPTH = 0.7

/** How long the tunnel runs and how it bends. Its cross-section, materials, density, colours and rain
 *  are the Foliage tunnel's whatever the length: a longer tunnel only bends more and holds more of
 *  the same. */
export interface TunnelShape {
  length: number
  /** S-bends along its length (the original tunnel has one). */
  turns: number
  /** Widen toward the far end, where door 1 used to stand. */
  flare: boolean
}

/** The Foliage tunnel as it was designed: 48 long, one bend, flaring at its mouth. */
export const FOLIAGE_TUNNEL: TunnelShape = { length: 48, turns: 1, flare: true }
/** The walk's post-quantum world: the same tunnel, long enough for the after gallery, the live frames,
 *  the break and the end, bending through S-bends as it goes. */
export const PQ_TUNNEL: TunnelShape = { length: 140, turns: 3, flare: false }
/** The original's grain counts were for its 48 + 11 units; longer tunnels keep the same density. */
const perUnit = (sh: TunnelShape) => (sh.length + START + BEYOND) / (48 + START + BEYOND)

const fract = (value: number) => value - Math.floor(value)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (value: number) => Math.max(0, Math.min(1, value))

function smoothstep(lo: number, hi: number, value: number) {
  const t = clamp((value - lo) / (hi - lo))
  return t * t * (3 - 2 * t)
}

function pcg(value: number) {
  const state = (Math.imul(value, 747796405) + 2891336453) >>> 0
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0
  return ((word >>> 22) ^ word) >>> 0
}

function fixed(index: number, salt: number) {
  return pcg(index ^ pcg(pcg(salt))) / 4294967295
}

function gradient(x: number, y: number, z: number, dx: number, dy: number, dz: number) {
  let a = fract(x * 0.1031), b = fract(y * 0.103), c = fract(z * 0.0973)
  const sum = a * (b + 33.33) + b * (a + 33.33) + c * (c + 33.33)
  a += sum; b += sum; c += sum
  return (fract((a + b) * c) * 2 - 1) * dx
    + (fract((a + a) * b) * 2 - 1) * dy
    + (fract((b + a) * a) * 2 - 1) * dz
}

function noise3(x: number, y: number, z: number) {
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z)
  const fx = fract(x), fy = fract(y), fz = fract(z)
  const curve = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const ux = curve(fx), uy = curve(fy), uz = curve(fz)
  const n = (dx: number, dy: number, dz: number) => gradient(cx + dx, cy + dy, cz + dz, fx - dx, fy - dy, fz - dz)
  return mix(
    mix(mix(n(0, 0, 0), n(1, 0, 0), ux), mix(n(0, 1, 0), n(1, 1, 0), ux), uy),
    mix(mix(n(0, 0, 1), n(1, 0, 1), ux), mix(n(0, 1, 1), n(1, 1, 1), ux), uy), uz,
  ) * 1.8
}

const pathXOf = (sh: TunnelShape) => (z: number) => {
  const amount = clamp(-z / sh.length)
  const envelope = Math.sin(amount * Math.PI)
  return PATH_AMPLITUDE * envelope * envelope * Math.sin(amount * TAU * sh.turns)
}

/** Exact analytic centerline is shared by the tube, path particles and camera. */
class TunnelPath extends THREE.Curve<THREE.Vector3> {
  private sh: TunnelShape
  private x: (z: number) => number
  constructor(sh: TunnelShape) { super(); this.sh = sh; this.x = pathXOf(sh); this.arcLengthDivisions = Math.round(600 * sh.length / 48) }

  getPoint(t: number, target = new THREE.Vector3()) {
    const z = -clamp(t) * this.sh.length
    return target.set(this.x(z), 0, z)
  }
}

/** The tunnel flares wider and taller toward its mouth, where door 1 stood. */
export function tunnelFlare(z: number, sh: TunnelShape = FOLIAGE_TUNNEL) {
  const exit = sh.flare ? smoothstep(-sh.length + 6, -sh.length, z) : 0
  return { width: 1 + exit * 0.4, rise: 1 + exit * 0.45 }
}

function tube(sh: TunnelShape, pathX: (z: number) => number, z: number, angle: number, out: number): RGB {
  const flare = tunnelFlare(z, sh)
  const width = (WIDTH + out) * flare.width
  const rise = (RISE + out) * flare.rise
  if (Math.abs(angle) < 1.2) {
    return [pathX(z) + Math.sin(angle) * width, SPRING + Math.cos(angle) * rise, z]
  }
  return [pathX(z) + Math.sign(angle) * width * 0.97,
    SPRING + Math.cos(1.2) * rise - (Math.abs(angle) - 1.2) * 2.4, z]
}

/** The tunnel's arch in a cross-section at z, across x (from the centre line) and up y: inside it? */
export function insideTunnel(z: number, pad = 0, sh: TunnelShape = FOLIAGE_TUNNEL) {
  const flare = tunnelFlare(z, sh)
  const w = WIDTH * flare.width * 0.97 + pad, spring = SPRING + Math.cos(1.2) * RISE * flare.rise
  const top = SPRING + RISE * flare.rise + pad
  return (x: number, y: number) => {
    if (y < 0 || Math.abs(x) > w) return false
    if (y <= spring) return true
    const ry = (y - SPRING) / (top - SPRING), rx = x / w
    return rx * rx + ry * ry <= 1
  }
}

/** The foliage, in slices along the walk, each with its bounds, so the engine skips the slices out of
 *  view or far down a long tunnel (their simulation and their draw). The grains are the original's. */
function foliage(u: SceneUniforms, sh: TunnelShape, count: number) {
  const pathX = pathXOf(sh)
  const LENGTH = sh.length
  const slices = Math.max(1, Math.round((LENGTH + START + BEYOND) / 16))
  const per = Math.ceil(count / slices)
  const group = new THREE.Group()
  group.name = 'Green tunnel foliage'
  for (let k = 0; k < slices; k++) {
    const positions = new Float32Array(per * 3)
    const colors = new Float32Array(per * 3)
    const sizes = new Float32Array(per)
    const metadata = new Float32Array(per * 4)
    const z0 = mix(START, -LENGTH - BEYOND, k / slices), z1 = mix(START, -LENGTH - BEYOND, (k + 1) / slices)
    for (let n = 0; n < per; n++) {
      const i = k * per + n
      const z = slices === 1 ? mix(START, -LENGTH - BEYOND, fixed(i, 1601)) : mix(z0, z1, fixed(i, 1601))
      const angle = (fixed(i, 1602) * 2 - 1) * 2.1
      const depth = Math.pow(fixed(i, 1603), 1.8) * DEPTH
      const clump = noise3(z * 1.6, angle * 4, 3) * 0.5 + 0.5
      positions.set(tube(sh, pathX, z, angle, depth - clump * clump * 0.45), n * 3)
      metadata.set([i, angle, fixed(i, 1604), 0], n * 4)
      // toward the mouth the original brightens; a long tunnel keeps the light of its middle stretch
      const toward = sh.flare ? smoothstep(-LENGTH * 0.4, -LENGTH, z) * 0.6 : 0.12
      const brightness = 1.25 * (0.08 + clump * clump * 1.5) * (1 - depth / DEPTH * 0.75) * (0.75 + toward)
      const tone = clamp(0.2 + clump * 0.55 + toward * 0.3 + (fixed(i, 1606) - 0.5) * 0.15)
      colors.set(fixed(i, 1607) < 0.012
        ? [brightness * 0.94, brightness, brightness * 0.62]
        : [brightness * (0.08 + tone * 0.6), brightness * (0.23 + tone * 0.77), brightness * (0.018 + tone * 0.10)], n * 3)
      sizes[n] = 0.0145 * mix(0.9, 1.6, fixed(i, 1608))
    }
    const leaves = cloud(u, positions, colors, sizes, 15, [0, 115], 1601 + k, 1)
    leaves.geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1))
    leaves.geometry.setAttribute('aHang', new THREE.InstancedBufferAttribute(metadata, 4))
    leaves.name = slices === 1 ? 'Green tunnel foliage' : `Green tunnel foliage ${k + 1}/${slices}`
    if (slices > 1) {
      setBounds(leaves, positions)
      leaves.userData.cullFar = 80
    }
    group.add(leaves)
  }
  return group
}

/** Bounds of a cloud's grains, padded for sway and the pointer's push: the engine culls by them. */
function setBounds(mesh: THREE.Object3D, pos: Float32Array, pad = 1.2) {
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.length; i += 3) box.expandByPoint(v.set(pos[i], pos[i + 1], pos[i + 2]))
  mesh.userData.bounds = box.expandByScalar(pad)
}

function rails(u: SceneUniforms, sh: TunnelShape, count: number) {
  const pathX = pathXOf(sh)
  const LENGTH = sh.length
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const metadata = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const z = mix(START, -LENGTH - BEYOND, fixed(i, 1611))
    const rail = fixed(i, 1612) < 0.6
    if (rail) {
      const side = fixed(i, 1613) < 0.5 ? 1 : -1
      positions.set([pathX(z) + side * 0.72 + (fixed(i, 1614) - 0.5) * 0.03, 0.12 + fixed(i, 1615) * 0.02, z], i * 3)
    } else {
      const sleeper = Math.round(z / 0.62) * 0.62
      positions.set([pathX(sleeper) + (fixed(i, 1614) * 2 - 1) * 1.02, 0.06,
        sleeper + (fixed(i, 1615) - 0.5) * 0.18], i * 3)
    }
    const fade = 1 - smoothstep(-LENGTH, -LENGTH - BEYOND, z)
    const brightness = 0.22 * (rail ? 1.2 : 0.3) * fade * 0.8
    colors.set([brightness * 0.72, brightness * 0.79, brightness * 0.54], i * 3)
    sizes[i] = 0.014 * (rail ? 0.8 : 1)
    metadata[i * 4 + 3] = 1
  }
  const track = cloud(u, positions, colors, sizes, 15, [0, 100], 1611)
  track.geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1))
  track.geometry.setAttribute('aHang', new THREE.InstancedBufferAttribute(metadata, 4))
  track.name = 'Green tunnel rails and sleepers'
  return track
}

export interface GroundGrainOptions {
  /** Near and far ends along the walk. */
  z: [number, number]
  pathX: (z: number) => number
  ground?: (x: number, z: number) => number
  /** Sideways reach either side of the path. */
  reach?: number
  /** Colour of one grain from its noise texture (0..1), nearness to the path (0..1) and a random tone. */
  color?: (brightness: number, tone: number, white: boolean) => RGB
  brightness?: number
  size?: number
  fog?: [number, number]
  fogColor?: RGB
  seed?: number
  name?: string
}

const leafColor = (brightness: number, tone: number, white: boolean): RGB => white
  ? [brightness, brightness, brightness * 0.7]
  : [brightness * (0.08 + tone * 0.6), brightness * (0.23 + tone * 0.77), brightness * (0.018 + tone * 0.1)]

/** Fine ground grains: dense along the path, textured by gradient noise, bright where the path lights them. */
export function groundGrains(u: SceneUniforms, count: number, o: GroundGrainOptions) {
  const { pathX: centre, ground = () => 0.02, reach = 2.35, color = leafColor, brightness: gain = 0.9,
    size = 0.0145, fog = [0, 115], seed = 1 } = o
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count), metadata = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const across = fixed(i, 1) * 2 - 1
    const z = mix(o.z[0], o.z[1], fixed(i, 2))
    const offset = Math.sign(across) * Math.pow(Math.abs(across), 0.65) * reach
    const x = centre(z) + offset
    const texture = noise3(x * 0.8, z * 0.8, 11) * 0.5 + 0.5
    const near = 1 - smoothstep(0, Math.min(reach, 2.35) * 0.6, Math.abs(offset))
    const brightness = gain * (0.35 + texture * 0.65) * (0.55 + near * 0.6) * 0.75
    const tone = clamp(0.18 + texture * 0.35 + near * 0.15 + (fixed(i, 7) - 0.5) * 0.15)
    positions.set([x, ground(x, z), z], i * 3)
    colors.set(color(brightness, tone, fixed(i, 6) < 0.01), i * 3)
    sizes[i] = size * mix(0.6, 1.5, fixed(i, 8) ** 2)
    metadata[i * 4 + 3] = 2
  }
  const floor = cloud(u, positions, colors, sizes, 15, fog, seed, 1, { fogColor: o.fogColor })
  floor.geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1))
  floor.geometry.setAttribute('aHang', new THREE.InstancedBufferAttribute(metadata, 4))
  floor.name = o.name ?? 'Ground grains'
  return floor
}

function floorGrains(u: SceneUniforms, sh: TunnelShape, count: number) {
  return groundGrains(u, count, { z: [START, -sh.length - BEYOND], pathX: pathXOf(sh), name: 'Green tunnel ground grains' })
}

/** A local exit light: its position stays with the world as the camera approaches. */
function exitLight(sh: TunnelShape) {
  const LENGTH = sh.length
  const material = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        float r = length((vUv - 0.5) * 20.0);
        float halo = exp(-r * r * 0.18) * 0.72;
        float rim = exp(-pow((r - 1.02) * 5.5, 2.0)) * 3.1;
        float center = exp(-r * r * 1.8) * 0.18;
        vec3 color = vec3(0.82, 1.0, 0.24) * halo + vec3(1.0, 1.0, 0.76) * rim + vec3(0.4, 0.6, 0.08) * center;
        gl_FragColor = vec4(color, 1.0 - smoothstep(7.0, 10.0, r));
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), material)
  glow.position.set(pathXOf(sh)(-LENGTH), 1.52, -LENGTH - 0.3)
  glow.name = 'Green tunnel exit light'
  return glow
}

export function buildGreenWorld(u: SceneUniforms, lowPower: boolean, sh: TunnelShape = FOLIAGE_TUNNEL) {
  const LENGTH = sh.length
  const pathX = pathXOf(sh)
  const k = perUnit(sh)
  const scene = new THREE.Scene()
  scene.name = 'Green tunnel'
  scene.background = new THREE.Color(0.001, 0.004, 0.0005)
  const path = new TunnelPath(sh)
  const ground: (x: number, z: number) => number = () => 0
  scene.add(sky([0.001, 0.004, 0.0005], [0.003, 0.008, 0.001], [0.001, 0.003, 0.0003],
    new THREE.Vector3(0, 0, -1), [0, 0, 0], 0.05))
  scene.add(foliage(u, sh, Math.round((lowPower ? 90_000 : 150_000) * k)), rails(u, sh, Math.round((lowPower ? 2_500 : 4_000) * k)),
    floorGrains(u, sh, Math.round((lowPower ? 18_000 : 30_000) * k)))
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, LENGTH + START + BEYOND + 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.001, 0.003, 0.0004) }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, -0.025, -LENGTH * 0.5)
  floor.name = 'Green tunnel ground'
  scene.add(floor)
  const trail = scenePath(u, { length: LENGTH, amplitude: PATH_AMPLITUDE, turns: sh.turns, lowPower })
  scene.add(trail, exitLight(sh))
  // Characters drip from the upper walls of the tunnel, in its own green, and never over the path.
  scene.add(asciiRain(u, {
    strands: Math.round((lowPower ? 90 : 170) * k), seed: 1701, name: 'Green tunnel character drips',
    place: r => {
      const z = mix(START - 2, -LENGTH, r())
      const angle = (r() < 0.5 ? -1 : 1) * mix(0.62, 1.12, r())
      const out = -0.18 - r() * 0.2
      return { x: pathX(z) + Math.sin(angle) * (WIDTH + out), z, top: SPRING + Math.cos(angle) * (RISE + out) }
    },
    ground: () => 0, tint: TUNNEL_GLYPH_GREEN, length: [4, 9], gap: 0.17, size: 0.05, speed: [0.16, 0.32], fog: [0, 60],
  }))
  return { scene, path, length: path.getLength(), ground, pathX }
}
