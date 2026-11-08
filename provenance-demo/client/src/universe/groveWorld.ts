// The grove: the amber grove (codex/worlds-two-scenes, mapleWorld.ts) as the walk's post-quantum world.
// An open particle landscape: banks of trees either side of a white path that wanders to the horizon,
// a low sun far ahead, dark leaf litter underfoot. Its form, materials and motion are the amber
// grove's; its colours are the green tunnel's (greenWorld.ts), and it is long enough for the after
// gallery, the live frames, the break and the end. The end is a place: the path runs into a pillar of
// light in a clearing, under the sun, and stops (setEnd moves all three with the walk's end stop).
import * as THREE from 'three'
import { asciiRain } from './asciiRain'
import { curveStream } from './scenePath'
import { TUNNEL_GLYPH_GREEN } from './greenWorld'
import { cloud, sky, type RGB, type SceneUniforms } from './worlds'

const TAU = Math.PI * 2
const mix = THREE.MathUtils.lerp
const clamp = (v: number) => THREE.MathUtils.clamp(v, 0, 1)
const smooth = THREE.MathUtils.smoothstep

/** How long the grove's path runs and how it wanders. */
export interface GroveShape { length: number; amplitude: number; turns: number }
/** As long as the tunnel it replaces (PQ_TUNNEL), wandering like the amber grove's path. */
export const PQ_GROVE: GroveShape = { length: 140, amplitude: 1.6, turns: 3 }

/** Trees stand this far along the walk, either side of the path's start and end. */
const BEHIND = 10
const BEYOND = 45
/** A slice of the grove (simulated and drawn as one) covers this much of the walk. */
const SLICE = 16
/** The pillar of light stands this far past the walk's end stop; the clearing is centred short of it. */
export const END_LIGHT_PAST = 17
const CLEARING_PAST = 14
const CLEARING_RADIUS = 8
/** The sun, placed from the end stop: how far, how far left of the path's end, how high (the amber grove's). */
const SUN_DISTANCE = 140
const SUN_LEFT = 0.17
const SUN_ELEVATION = 0.19
const UP = new THREE.Vector3(0, 1, 0)

function pcg(value: number) {
  const state = (Math.imul(value, 747796405) + 2891336453) >>> 0
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0
  return ((word >>> 22) ^ word) >>> 0
}
const random = (index: number, salt: number) => pcg(index ^ pcg(pcg(salt))) / 4294967295
function direction(index: number, salt: number) {
  const y = random(index, salt) * 2 - 1, angle = random(index, salt + 1) * TAU
  const ring = Math.sqrt(Math.max(1 - y * y, 0))
  return new THREE.Vector3(Math.cos(angle) * ring, y, Math.sin(angle) * ring)
}

const pathXOf = (sh: GroveShape) => (z: number) => {
  const amount = clamp(-z / sh.length), envelope = Math.sin(amount * Math.PI)
  return sh.amplitude * envelope * envelope * Math.sin(amount * TAU * sh.turns)
}

class GrovePath extends THREE.Curve<THREE.Vector3> {
  private sh: GroveShape
  private x: (z: number) => number
  constructor(sh: GroveShape) { super(); this.sh = sh; this.x = pathXOf(sh); this.arcLengthDivisions = Math.round(640 * sh.length / 28) }
  getPoint(t: number, target = new THREE.Vector3()) {
    const z = -clamp(t) * this.sh.length
    return target.set(this.x(z), 0, z)
  }
}

/** The path between two depths (straight on behind the start), for the white stream. */
class Trail extends THREE.Curve<THREE.Vector3> {
  private x: (z: number) => number
  from: number
  to: number
  constructor(x: (z: number) => number, from: number, to: number) { super(); this.x = x; this.from = from; this.to = to; this.arcLengthDivisions = 1200 }
  getPoint(t: number, target = new THREE.Vector3()) {
    const z = mix(this.from, this.to, t)
    return target.set(this.x(z), 0, z)
  }
}

/** The tunnel's leaf colours (greenWorld.ts `foliage`), deep green through leaf green to lime, where
 *  the amber grove ran red through amber to gold. Its accent trees (green among the amber) become the
 *  pale light-green of the tunnel's brightest grains. */
function palette(tone: number, accent = false): RGB {
  if (accent) return [0.5, 0.62, 0.34]
  // a touch darker than the tunnel's: green reads brighter than amber at the same value
  const k = 0.82
  return [k * (0.08 + tone * 0.6), k * (0.23 + tone * 0.77), k * (0.018 + tone * 0.1)]
}

interface Layer { mesh: ReturnType<typeof cloud>; position: Float32Array; color: Float32Array; size: Float32Array; hang: Float32Array; root: Float32Array }
function layer(u: SceneUniforms, count: number, seed: number, fog = 180, center?: THREE.Vector3): Layer {
  const position = new Float32Array(count * 3), color = new Float32Array(count * 3)
  const size = new Float32Array(count), hang = new Float32Array(count * 4), root = new Float32Array(count * 4)
  const mesh = cloud(u, position, color, size, 22, [0, fog], seed, 1, center ? { center } : {})
  mesh.geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1))
  mesh.geometry.setAttribute('aHang', new THREE.InstancedBufferAttribute(hang, 4))
  mesh.geometry.setAttribute('aPrism', new THREE.InstancedBufferAttribute(root, 4))
  return { mesh, position, color, size, hang, root }
}

/** Bounds of a cloud's grains, padded for sway and the pointer's push: the engine culls by them. */
function setBounds(mesh: THREE.Object3D, pos: Float32Array, cullFar: number, pad = 1.2) {
  const box = new THREE.Box3(), v = new THREE.Vector3()
  for (let i = 0; i < pos.length; i += 3) box.expandByPoint(v.set(pos[i], pos[i + 1], pos[i + 2]))
  mesh.userData.bounds = box.expandByScalar(pad)
  mesh.userData.cullFar = cullFar
}

interface Tree { x: number; z: number; side: number; trunk: number; radius: number; seed: number; grains: number; id: number }

/** The amber grove's trees, the same per unit of walk, in slices along it so the far ones drop out. */
function grove(u: SceneUniforms, sh: GroveShape, lowPower: boolean, clearing: THREE.Vector3) {
  const pathX = pathXOf(sh)
  const near = BEHIND, far = -sh.length - BEYOND
  // the amber grove had 144 trees over its 63 units: the same density here
  const count = Math.round(144 * (near - far) / 63)
  const trees: Tree[] = []
  for (let tree = 0; tree < count; tree++) {
    const across = 2.2 + random(tree, 1703) ** 1.6 * 30
    const z = mix(near, far, random(tree, 1701))
    const side = random(tree, 1702) < 0.5 ? 1 : -1
    trees.push({
      id: tree, z, side, x: pathX(z) + side * across,
      trunk: mix(2.6, 4.2, random(tree, 1704)), radius: mix(2, 3.8, random(tree, 1705)),
      seed: random(tree, 1706) * 10,
      grains: across < 15 ? (lowPower ? 850 : 1900) : (lowPower ? 300 : 650),
    })
  }
  const group = new THREE.Group()
  group.name = 'Grove crowns and branches'
  const slices = Math.ceil((near - far) / SLICE)
  for (let k = 0; k < slices; k++) {
    const z0 = near - k * SLICE, z1 = z0 - SLICE
    const mine = trees.filter(t => t.z <= z0 && t.z > z1)
    if (!mine.length) continue
    const data = layer(u, mine.reduce((sum, t) => sum + t.grains, 0), 1701 + k, 180, clearing)
    let offset = 0
    for (const { id: tree, x, z, side, trunk, radius, seed, grains } of mine) {
      const lean = -side * radius * 0.35
      const center = new THREE.Vector3(x + lean, trunk + radius * 0.35, z)
      for (let grain = 0; grain < grains; grain++) {
        const i = offset + grain, index = tree * 4000 + Math.floor(grain * 4000 / grains)
        data.root.set([x, z, 0, 0], i * 4)
        if (random(index, 1707) < 0.1) {
          const up = random(index, 1708), angle = random(index, 1709) * TAU
          const thickness = mix(0.18, 0.06, up)
          data.position.set([x + lean * up + Math.cos(angle) * thickness, center.y * up,
            z + Math.sin(angle) * thickness], i * 3)
          const lit = smooth(-side * Math.cos(angle), 0, 1)
          data.color.set(palette(0.08).map(v => v * (0.06 + lit * 0.16)), i * 3)
          data.size[i] = 0.024
          data.hang.set([up, seed, 0, 0], i * 4)
          continue
        }
        const clump = Math.floor(random(index, 1710) * 28)
        const heart = direction(tree * 31 + clump, 1711).multiply(new THREE.Vector3(1, 0.5, 1)).multiplyScalar(radius * 0.85).add(center)
        const leaf = direction(index, 1712).multiply(new THREE.Vector3(1, 0.6, 1)).multiplyScalar(random(index, 1713) ** 0.6 * radius * 0.32)
        const place = heart.add(leaf)
        const lit = smooth((place.y - center.y) / radius, -0.6, 0.8)
        const band = random(tree * 31 + clump, 1714)
        // the amber grove leant its left bank red and its right bank gold; here deep green and lime
        const tone = mix(clamp(random(tree, 1715) * 0.9 + (band - 0.5) * 0.25 + lit * 0.1), x - pathX(z) < 0 ? 0.1 : 0.8, 0.3)
        const brightness = (0.2 + lit * 0.8) * 0.95
        data.position.set(place.toArray(), i * 3)
        data.color.set(palette(tone, x - pathX(z) > 0 && random(tree, 1716) < 0.22).map(v => v * brightness), i * 3)
        data.size[i] = 0.024 * mix(1, 1.8, random(index, 1717))
        data.hang.set([seed, index * 0.3, 0, 1], i * 4)
      }
      offset += grains
    }
    data.mesh.name = `Grove crowns ${k + 1}/${slices}`
    setBounds(data.mesh, data.position, 110, 1.6)
    group.add(data.mesh)
  }
  return group
}

function leafLitter(u: SceneUniforms, sh: GroveShape, lowPower: boolean) {
  const pathX = pathXOf(sh)
  const near = BEHIND - 2, far = -sh.length - BEYOND + 1
  const total = Math.round((lowPower ? 14000 : 28000) * (near - far) / 66)
  const slices = Math.ceil((near - far) / SLICE), per = Math.ceil(total / slices)
  const group = new THREE.Group()
  group.name = 'Grove leaf litter'
  for (let k = 0; k < slices; k++) {
    const z0 = near - k * SLICE, z1 = Math.max(far, z0 - SLICE)
    const data = layer(u, per, 1801 + k, 125)
    for (let n = 0; n < per; n++) {
      const i = k * per + n
      const z = mix(z0, z1, random(i, 1801))
      const x = pathX(z) + (random(i, 1802) * 2 - 1) * 27
      const edge = smooth(Math.abs(x - pathX(z)), 0.25, 3)
      data.position.set([x, random(i, 1803) ** 3 * 0.16, z], n * 3)
      data.color.set(palette(random(i, 1804) * 0.8).map(v => v * (0.018 + edge * 0.12)), n * 3)
      data.size[n] = mix(0.012, 0.038, random(i, 1805))
      data.hang[n * 4 + 3] = -1
    }
    data.mesh.name = `Grove leaf litter ${k + 1}/${slices}`
    setBounds(data.mesh, data.position, 90)
    group.add(data.mesh)
  }
  return group
}

/** Grains drifting in the air round the visitor (they travel with the camera). */
function driftingGrains(u: SceneUniforms, lowPower: boolean) {
  const count = lowPower ? 500 : 1000
  const position = new Float32Array(count * 3), color = new Float32Array(count * 3), size = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    position.set([(random(i, 1901) - 0.5) * 18, random(i, 1902) * 6, -random(i, 1903) * 32], i * 3)
    color.set(palette(random(i, 1904), random(i, 1905) < 0.1).map(v => v * 0.22), i * 3)
    size[i] = mix(0.018, 0.065, random(i, 1906))
  }
  const mesh = cloud(u, position, color, size, 8, [0, 70], 1901)
  mesh.name = 'Grove drifting grains'
  return mesh
}

/** The low sun far ahead (the amber grove's moon glow, in the tunnel exit light's green-white). */
function sun() {
  const material = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        float r = length((vUv - 0.5) * 2.0);
        float core = (1.0 - smoothstep(0.13, 0.23, r)) * 5.0;
        float halo = exp(-r * r * 12.0) * 0.1 + exp(-r * r * 45.0) * 0.35;
        vec3 color = vec3(0.92, 1.0, 0.84) * core + vec3(0.62, 1.0, 0.5) * halo;
        gl_FragColor = vec4(color, 1.0 - smoothstep(0.7, 1.0, r));
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), material)
  mesh.name = 'Grove sun'
  mesh.renderOrder = 5 // after the photo cards' depth-only faces, so a card hides it
  return mesh
}

/** Where the path stops: it runs into a thin pillar of light standing on a pool of it. */
function endLight() {
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(3, 4.4), new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vNear;
      void main() {
        vUv = uv;
        // from far down the path it is a faint mark at the path's end; it gathers as the walk nears
        // it, and never glares at the last step
        float d = distance(cameraPosition, (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
        vNear = mix(0.3, 1.0, 1.0 - smoothstep(18.0, 60.0, d)) * mix(0.55, 1.0, smoothstep(6.0, 14.0, d));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vNear;
      void main() {
        float x = abs(vUv.x - 0.5) * 2.0;
        float ends = smoothstep(0.0, 0.045, vUv.y) * (1.0 - smoothstep(0.955, 1.0, vUv.y));
        float beam = exp(-x * x * 1800.0) * 5.0 + exp(-x * x * 35.0) * 0.14;
        gl_FragColor = vec4(vec3(0.84, 1.0, 0.86) * beam * vNear, ends);
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }))
  beam.position.y = 2.2
  beam.name = 'Grove end pillar'
  beam.renderOrder = 5 // behind a card, like the stream
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        float r = length((vUv - 0.5) * 2.0);
        float glow = exp(-r * r * 12.0) * 0.22 + exp(-r * r * 70.0) * 0.35;
        gl_FragColor = vec4(vec3(0.62, 1.0, 0.6) * glow, 1.0 - smoothstep(0.75, 1.0, r));
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }))
  pool.rotation.x = -Math.PI / 2
  pool.position.y = 0.02
  pool.name = 'Grove end pool'
  pool.renderOrder = 5
  const group = new THREE.Group()
  group.name = 'Grove end light'
  group.add(beam, pool)
  return group
}

export function buildGroveWorld(u: SceneUniforms, lowPower: boolean, sh: GroveShape = PQ_GROVE) {
  const scene = new THREE.Scene(), path = new GrovePath(sh), pathX = pathXOf(sh)
  const length = path.getLength()
  scene.name = 'Grove'
  // the green tunnel's night: its background and sky
  scene.background = new THREE.Color(0.001, 0.004, 0.0005)
  scene.add(sky([0.001, 0.004, 0.0005], [0.003, 0.008, 0.001], [0.001, 0.003, 0.0003],
    new THREE.Vector3(0, 1, -1), [0, 0, 0], 0))
  const clearing = new THREE.Vector3(0, 0, 0)
  const trees = grove(u, sh, lowPower, clearing)
  const theSun = sun()
  scene.add(trees, leafLitter(u, sh, lowPower), driftingGrains(u, lowPower), theSun)
  // the clearing's uniform is shared by every slice (cloud clones the style's centre)
  const clearings = trees.children.map(m => ((m as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uCenter.value as THREE.Vector3)

  // The white stream, from just behind the start to the end light; setEnd re-lays it.
  const trail = new Trail(pathX, 6, -length * 0.8)
  const stream = curveStream(u, trail, { lowPower, brightness: 1.6, fog: 260 })
  const streamUniforms = (stream.material as THREE.ShaderMaterial).uniforms
  const light = endLight()
  scene.add(stream, light)

  // Character rain, the tunnel's own strands at the tunnel's density per unit of walk, dripping from
  // under the crowns either side and never over the path (nor across a print's face beside it).
  const perUnit = (sh.length + 11) / 59
  scene.add(asciiRain(u, {
    strands: Math.round((lowPower ? 90 : 170) * perUnit), seed: 1701, name: 'Grove character drips',
    place: r => {
      const z = mix(6, -sh.length, r())
      const side = r() < 0.5 ? -1 : 1
      return { x: pathX(z) + side * mix(2.1, 4.4, r()), z, top: mix(2.5, 4.2, r()) }
    },
    // a little dimmer than the tunnel's: here they fall against the dark, not lit leaves
    ground: () => 0, tint: TUNNEL_GLYPH_GREEN.map(v => v * 0.75) as RGB, length: [4, 9], gap: 0.17, size: 0.05, speed: [0.16, 0.32], fog: [0, 60],
  }))

  const at = new THREE.Vector3(), ahead = new THREE.Vector3(), stand = new THREE.Vector3()
  /** Where on the path (distance s) the walk's end stop is: the path runs on to the end light past it
   *  and stops, and the trees round it part into a clearing. */
  function setEnd(s: number) {
    const point = (d: number, out: THREE.Vector3) => d <= length
      ? path.getPointAt(Math.max(0, d) / length, out)
      : path.getPointAt(1, out).add(new THREE.Vector3(0, 0, -(d - length)))
    point(s + END_LIGHT_PAST, at)
    light.position.set(at.x, 0, at.z)
    point(s + END_LIGHT_PAST + 1, ahead)
    light.lookAt(at.x * 2 - ahead.x, 0, at.z * 2 - ahead.z)
    // re-lay the stream's curve texture: same grains, now flowing from the start to the light
    trail.to = at.z
    trail.updateArcLengths()
    const tex = streamUniforms.uCurveTex.value as THREE.DataTexture
    const data = tex.image.data as Float32Array, samples = data.length / 4
    for (let i = 0; i < samples; i++) {
      trail.getPointAt(i / (samples - 1), ahead)
      data.set([ahead.x, 0, ahead.z, 1], i * 4)
    }
    tex.needsUpdate = true
    ;(streamUniforms.uCurveInfo.value as THREE.Vector2).y = trail.getLength()
    point(s + CLEARING_PAST, at)
    for (const c of clearings) c.set(at.x, at.z, CLEARING_RADIUS)
    // The sun hangs low over the end, a little to the left of the path's last light, as it was in the
    // amber grove: from the end stop it never stands on top of the pillar.
    point(s, stand)
    point(s + END_LIGHT_PAST, at)
    ahead.copy(at).sub(stand).setY(0).normalize().applyAxisAngle(UP, SUN_LEFT)
    theSun.position.copy(stand).addScaledVector(ahead, SUN_DISTANCE)
    theSun.position.y = 1.15 + SUN_DISTANCE * Math.tan(SUN_ELEVATION)
    theSun.lookAt(stand.x, theSun.position.y, stand.z)
  }
  setEnd(length * 0.75)

  return { scene, path, length, ground: () => 0, pathX, setEnd }
}
