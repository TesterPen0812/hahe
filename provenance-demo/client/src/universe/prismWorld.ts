import * as THREE from 'three'
import { asciiRain } from './asciiRain'
import { scenePath } from './scenePath'
import { cloud, glyphAtlas, sky, type FieldStyle, type RGB, type SceneUniforms } from './worlds'
import { GLYPH_COLUMNS, GLYPH_COUNT, GLYPH_ROWS } from './shaders'
import { PRISM_RING_TILT } from './prismMotion'

const TAU = Math.PI * 2
const LENGTH = 72
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const fract = (v: number) => v - Math.floor(v)
const clamp = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t) }

function pcg(value: number) {
  const state = (Math.imul(value, 747796405) + 2891336453) >>> 0
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0
  return ((word >>> 22) ^ word) >>> 0
}

const random = (index: number, salt: number) => pcg(index ^ pcg(pcg(salt))) / 4294967295
function direction(index: number, salt: number) {
  const y = random(index, salt) * 2 - 1, angle = random(index, salt + 1) * TAU
  const ring = Math.sqrt(Math.max(1 - y * y, 0))
  return [Math.cos(angle) * ring, y, Math.sin(angle) * ring]
}

function noise3(x: number, y: number, z: number) {
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z)
  const fx = fract(x), fy = fract(y), fz = fract(z)
  const curve = (v: number) => v * v * v * (v * (v * 6 - 15) + 10)
  const gradient = (dx: number, dy: number, dz: number) => {
    let a = fract((cx + dx) * 0.1031), b = fract((cy + dy) * 0.103), c = fract((cz + dz) * 0.0973)
    const sum = a * (b + 33.33) + b * (a + 33.33) + c * (c + 33.33)
    a += sum; b += sum; c += sum
    return (fract((a + b) * c) * 2 - 1) * (fx - dx)
      + (fract((a + a) * b) * 2 - 1) * (fy - dy)
      + (fract((b + a) * a) * 2 - 1) * (fz - dz)
  }
  const ux = curve(fx), uy = curve(fy), uz = curve(fz)
  return mix(
    mix(mix(gradient(0, 0, 0), gradient(1, 0, 0), ux), mix(gradient(0, 1, 0), gradient(1, 1, 0), ux), uy),
    mix(mix(gradient(0, 0, 1), gradient(1, 0, 1), ux), mix(gradient(0, 1, 1), gradient(1, 1, 1), ux), uy), uz,
  ) * 1.8
}

function fbm(x: number, y: number, z: number) {
  let sum = 0, amplitude = 0.5
  for (let octave = 0; octave < 4; octave++) {
    sum += noise3(x, y, z) * amplitude
    x = x * 2.02 + 17.1; y = y * 2.02 + 31.7; z = z * 2.02 + 7.3
    amplitude *= 0.5
  }
  return sum
}

function pathX(z: number) {
  const amount = clamp(-z / LENGTH), envelope = Math.sin(amount * Math.PI)
  return 1.7 * envelope * envelope * Math.sin(amount * TAU * 1.25)
}

function ground(x: number, z: number) {
  const away = smooth(0.7, 7.7, Math.abs(x - pathX(z)))
  return (fbm(x * 0.055, z * 0.055, 0) * 0.5 + 0.5) * 3.5 * away * away
}

class PrismPath extends THREE.Curve<THREE.Vector3> {
  constructor() { super(); this.arcLengthDivisions = 720 }
  getPoint(t: number, target = new THREE.Vector3()) {
    const z = -clamp(t) * LENGTH
    return target.set(pathX(z), 0, z)
  }
}

function arrays(count: number) {
  return {
    position: new Float32Array(count * 3), color: new Float32Array(count * 3),
    size: new Float32Array(count), hang: new Float32Array(count * 4), detail: new Float32Array(count * 4),
  }
}

function particles(u: SceneUniforms, data: ReturnType<typeof arrays>, mode: number, fog: number | [number, number], seed: number, style: FieldStyle = {}) {
  const mesh = cloud(u, data.position, data.color, data.size, mode, typeof fog === 'number' ? [0, fog] : fog, seed, 1, style)
  mesh.geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(data.size, 1))
  mesh.geometry.setAttribute('aHang', new THREE.InstancedBufferAttribute(data.hang, 4))
  mesh.geometry.setAttribute('aPrism', new THREE.InstancedBufferAttribute(data.detail, 4))
  return mesh
}

export interface BulbMeadowOptions {
  bulbs: number
  /** Near and far ends of the meadow along the walk. */
  z: [number, number]
  pathX: (z: number) => number
  ground: (x: number, z: number) => number
  /** How far the meadow reaches sideways from the path. */
  spread?: number
  /** Clear lane either side of the path. */
  lane?: number
  fog?: [number, number]
  seed?: number
  /** 0: the prism palette; 1: Today's blues (see prismMotion). */
  palette?: number
  fogColor?: RGB
  name?: string
  /** Split into this many slices along the walk, each with its bounds, so the engine can skip the
   *  slices out of view (their simulation and their draw). */
  chunks?: number
}

/** Bounds of a cloud's grains, padded for sway and the pointer's push: the engine culls by them. */
export function setCloudBounds(mesh: THREE.Object3D, pos: Float32Array, pad = 1.2) {
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.length; i += 3) box.expandByPoint(v.set(pos[i], pos[i + 1], pos[i + 2]))
  mesh.userData.bounds = box.expandByScalar(pad)
}

/** Bulbs of 20 grains: a stem and a round head that sway in a noise breeze and carry travelling colour bands. */
export function bulbMeadow(u: SceneUniforms, o: BulbMeadowOptions): THREE.Object3D {
  const n = o.chunks ?? 1
  if (n > 1) {
    const group = new THREE.Group()
    group.name = o.name ?? 'bulb-meadow'
    for (let k = 0; k < n; k++) {
      const z: [number, number] = [mix(o.z[0], o.z[1], k / n), mix(o.z[0], o.z[1], (k + 1) / n)]
      const slice = bulbMeadow(u, { ...o, chunks: 1, bulbs: Math.round(o.bulbs / n), z, seed: (o.seed ?? 1401) + k * 7919, name: `${group.name} ${k + 1}/${n}` })
      group.add(slice)
    }
    return group
  }
  const { bulbs, pathX: centre, ground: height, spread = 12.5, lane = 0.7, fog = [0, 175], seed = 1401, palette = 0 } = o
  const data = arrays(bulbs * 20)
  for (let bulb = 0; bulb < bulbs; bulb++) {
    const z = mix(o.z[0], o.z[1], random(bulb, seed))
    const across = random(bulb, seed + 1) * 2 - 1
    const x = centre(z) + Math.sign(across) * (lane + Math.abs(across) ** 1.5 * spread)
    const y = height(x, z), stem = mix(0.35, 0.8, random(bulb, seed + 2))
    const frequency = mix(0.5, 1.2, random(bulb, seed + 7)), jitter = (random(bulb, seed + 6) - 0.5) * 0.35
    const accent = random(bulb, seed + 9) < 0.05 ? 1 : 0
    for (let grain = 0; grain < 20; grain++) {
      const i = bulb * 20 + grain, isStem = random(i, seed + 3) < 0.3
      const up = isStem ? random(i, seed + 4) : 1
      const delta = isStem ? [0, 0, 0] : direction(i, seed + 5).map(v => v * 0.07)
      data.position.set([x + delta[0], y + stem * up + delta[1], z + delta[2]], i * 3)
      const brightness = 0.95 * 0.75 * (isStem ? 0.08 : 1)
      data.color.set([brightness, brightness, brightness], i * 3)
      data.size[i] = 0.024 * (isStem ? 0.7 : 1.3)
      // w<0: stem, |w|: fraction up the stem; w=1: bulb head.
      data.hang.set([x, z, stem, isStem ? -up : 1], i * 4)
      data.detail.set([bulb, frequency, jitter, accent], i * 4)
    }
  }
  const mesh = particles(u, data, 16, fog, seed, { palette, fogColor: o.fogColor })
  mesh.name = o.name ?? 'bulb-meadow'
  setCloudBounds(mesh, data.position)
  return mesh
}

function meadow(u: SceneUniforms, lowPower: boolean) {
  return bulbMeadow(u, {
    bulbs: lowPower ? 6000 : 12000, z: [10, -LENGTH - 12], pathX, ground, name: 'prism-bulb-meadow', chunks: 6,
  })
}

/**
 * The ringed planet, drawn entirely in characters. A camera-facing card at the planet's centre works
 * out, for each character cell, the sphere and its tilted ring under that cell's centre: lit by a
 * low sun, banded and slowly turning, the ring striped with gaps and darkened where the planet
 * shades it. A cell's brightness picks its character from a density ramp (: + = * % # & @), so the
 * shading is in the type itself; now and then a cell flickers to another character.
 */
function planet(u: SceneUniforms) {
  const center = new THREE.Vector3(-25, 24, -150), radius = 14
  const tilt = PRISM_RING_TILT
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: u.uTime,
      uCenter: { value: center },
      uRadius: { value: radius },
      uHalf: { value: radius * 2.5 },
      uCell: { value: 1.25 },
      uRingN: { value: new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt)) },
      uRingE2: { value: new THREE.Vector3(0, -Math.sin(tilt), Math.cos(tilt)) },
      uLight: { value: new THREE.Vector3(-0.62, 0.32, 0.72).normalize() },
      uGlyphs: { value: glyphAtlas() },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uCenter;
      uniform float uHalf;
      varying vec2 vLocal;
      void main() {
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vLocal = position.xy * uHalf;
        gl_Position = projectionMatrix * viewMatrix * vec4(uCenter + right * vLocal.x + up * vLocal.y, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uRadius, uCell;
      uniform vec3 uRingN, uRingE2, uLight;
      uniform sampler2D uGlyphs;
      varying vec2 vLocal;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      // the density ramp, darkest to brightest: ~ ^ : + = * % # & @, the faintest picked at random
      // among light marks so the shadows read as texture, not a grid
      float ramp(float v, float r) {
        float k = floor(clamp(v, 0.0, 0.999) * 9.0);
        if (k < 1.5) return r < 0.33 ? 25.0 : r < 0.66 ? 24.0 : 8.0;
        if (k < 2.5) return r < 0.5 ? 6.0 : 8.0;
        if (k < 3.5) return 7.0;
        if (k < 4.5) return 5.0;
        if (k < 5.5) return 3.0;
        if (k < 6.5) return 2.0;
        if (k < 7.5) return 4.0;
        return 23.0;
      }
      void main() {
        // pixels per cell, for the atlas's level of detail (taken before any branch)
        float cellPx = uCell / max(abs(dFdx(vLocal.x)), 1e-5);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 fwd = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);   // toward the camera
        vec2 cell = floor(vLocal / uCell);
        vec2 c = (cell + 0.5) * uCell;
        vec2 q = fract(vLocal / uCell);
        float R = uRadius, r2 = dot(c, c);
        float v = 0.0, front = -1e9;
        vec3 tint = vec3(0.78, 0.8, 1.0);
        if (r2 < R * R) {
          float z = sqrt(max(R * R - r2, 0.0));
          vec3 n = (c.x * right + c.y * up + z * fwd) / R;
          front = z;
          float lit = max(dot(n, uLight), 0.0);
          // bands of latitude, combed by the turning longitude
          float lat = asin(clamp(dot(n, uRingN), -1.0, 1.0));
          float lon = atan(dot(n, uRingE2), n.x) + uTime * 0.035;
          float bands = 0.72 + 0.28 * sin(lat * 11.0 + 1.4 * sin(lon * 2.0 + lat * 4.0));
          float rim = pow(1.0 - max(dot(n, fwd), 0.0), 3.0);
          // the night side stays faintly there, lit by the ring and the stars
          v = (0.3 + 0.7 * smoothstep(-0.35, 0.8, dot(n, uLight))) * bands + rim * 0.45;
          tint = mix(vec3(0.6, 0.6, 1.0), vec3(0.93, 0.95, 1.0), lit);
        }
        float facing = dot(fwd, uRingN);
        if (abs(facing) > 0.02) {
          float t = -(c.x * dot(right, uRingN) + c.y * dot(up, uRingN)) / facing;
          vec3 h = c.x * right + c.y * up + t * fwd;
          float d = length(h) / R;
          if (d > 1.25 && d < 2.4 && t > front) {
            float band = 0.5 + 0.5 * sin(d * 38.0) * sin(d * 11.0 + 1.0);
            band *= smoothstep(1.25, 1.33, d) * (1.0 - smoothstep(2.25, 2.4, d));
            // the planet's shadow across the ring
            float along = dot(h, uLight);
            float shade = along < 0.0 && length(h - uLight * along) < R ? 0.25 : 1.0;
            float ring = band * 0.85 * shade;
            if (ring > v * 0.6) { v = ring; tint = vec3(0.82, 0.78, 1.0); }
          }
        }
        if (v < 0.06) discard;
        float rnd = hash(cell * 1.31 + 0.7);
        // the faintest cells are sparse, thinning out with the light
        if (v < 0.22 && rnd > v * 4.0) discard;
        float glyph = ramp(v, hash(cell + 3.1));
        // a cell now and then flickers to another character and back
        float tick = floor(uTime * 0.6 + hash(cell) * 9.0);
        if (hash(cell * 0.37 + tick) > 0.985) glyph = floor(hash(cell + tick) * ${GLYPH_COUNT}.0);
        vec2 g = vec2(mod(glyph, ${GLYPH_COLUMNS}.0), floor(glyph / ${GLYPH_COLUMNS}.0));
        vec2 uv = (q - 0.5) * 1.1 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
        float ink = textureLod(uGlyphs, vec2((g.x + uv.x) / ${GLYPH_COLUMNS}.0, 1.0 - (g.y + 1.0 - uv.y) / ${GLYPH_ROWS}.0), max(log2(64.0 / cellPx), 0.0)).r;
        if (ink < 0.02) discard;
        vec3 col = tint * (0.25 + v * 1.7) * ink;
        gl_FragColor = vec4(col, ink);
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  mesh.frustumCulled = false
  mesh.name = 'prism-ascii-planet'
  return mesh
}

function stars(u: SceneUniforms, lowPower: boolean) {
  const count = lowPower ? 520 : 1150, data = arrays(count)
  const axis = new THREE.Vector3(0.4, 0.3, -1).normalize()
  for (let i = 0; i < count; i++) {
    const height = random(i, 51) ** 0.7, angle = random(i, 52) * TAU, ring = Math.sqrt(1 - height * height)
    const dir = new THREE.Vector3(Math.cos(angle) * ring, height * 0.9 + 0.02, Math.sin(angle) * ring)
    const across = dir.dot(axis) * 3, band = Math.exp(-across * across)
    const isBand = random(i, 53) < 0.45, bright = random(i, 56) < 0.04
    const weight = bright ? 1 : mix(0.15, 1, band) * (band > 0.3 || !isBand ? 1 : 0.4)
    const gain = 0.34 * weight * (bright ? 3 : 0.5) * 0.8
    dir.normalize().multiplyScalar(420)
    data.position.set(dir.toArray(), i * 3)
    data.color.set([gain * 0.78, gain * 0.86, gain], i * 3)
    data.size[i] = bright ? 0.32 : 0.19
    data.hang.set([mix(1, 4, random(i, 54)), random(i, 55) * TAU, 0, 2], i * 4)
  }
  const mesh = particles(u, data, 17, 4000, 51)
  mesh.material.uniforms.uInteraction.value = 0
  // fixed at infinity and untouched by the pointer: drawn straight from its placement, no simulation
  mesh.userData.particleCloud = false
  mesh.name = 'prism-star-dome'
  return mesh
}

export function buildPrismWorld(u: SceneUniforms, lowPower: boolean) {
  const scene = new THREE.Scene(), path = new PrismPath()
  scene.name = 'Prism Meadow'
  scene.background = new THREE.Color(0.0004, 0.0005, 0.0015)
  scene.add(sky([0.0004, 0.0005, 0.0015], [0.003, 0.0035, 0.009], [0.0003, 0.0004, 0.001],
    new THREE.Vector3(0, 1, -1), [0, 0, 0], 0, { glow: [0.001, 0.001, 0.003] }))
  scene.add(meadow(u, lowPower), planet(u), stars(u, lowPower))
  scene.add(scenePath(u, { length: LENGTH, amplitude: 1.7, turns: 1.25, lowPower }))
  // Character rain over the meadow, pale violet, as present as in the tunnel and the blue world: it
  // falls close beside the walk too, but outside the lane where the photos and prints hang.
  scene.add(asciiRain(u, {
    strands: lowPower ? 260 : 600, seed: 1801, name: 'prism-character-rain',
    place: r => {
      const z = mix(8, -LENGTH - 14, r())
      const x = pathX(z) + (r() < 0.5 ? -1 : 1) * mix(5.8, 34, Math.pow(r(), 1.6))
      return { x, z, top: ground(x, z) + mix(6, 15, r()) }
    },
    ground, tint: [0.7, 0.62, 1.0], length: [6, 16], gap: 0.3, size: 0.08, speed: [0.035, 0.08], fog: [0, 150],
  }))
  return { scene, path, length: path.getLength(), ground }
}
