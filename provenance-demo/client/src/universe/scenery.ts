// The home meadow ("today") and the Q-Day gate. Original scene design for this app.
import * as THREE from 'three'
import { fbm, rng } from './noise'
import { cloud, homeHeight, particleField, sky, stars, type RGB, type SceneUniforms } from './worlds'

const MEADOW_FOG: RGB = [0.05, 0.08, 0.2]

/** Night meadow under a low moon: grass, flower patches, fireflies, haze and mountains. */
export function buildMeadow(scene: THREE.Scene, u: SceneUniforms, lowPower: boolean) {
  const k = lowPower ? 0.45 : 1
  const fog = { fogColor: MEADOW_FOG }
  scene.add(sky(
    [0.002, 0.004, 0.018], [0.05, 0.07, 0.17], [0.004, 0.006, 0.016],
    new THREE.Vector3(-0.42, 0.24, -1), [2.1, 2.05, 1.95], 0.034,
    {
      glow: [0.09, 0.11, 0.24],
      band: [0.05, 0.055, 0.09],
      ridge: { near: [0.004, 0.006, 0.018], far: [0.03, 0.045, 0.11], height: 0.07, seed: 3 },
      sun: new THREE.Vector3(-0.1, 0.25, 1),
      body: 'moon',
    },
  ))
  scene.add(stars(lowPower ? 1100 : 2800, 3, [0.85, 0.9, 1.0]))

  // The ground: indigo grains in drifting patches of light and shade.
  scene.add(particleField(u, {
    count: Math.floor(170000 * k), x: [-80, 80], z: [-160, 16], height: homeHeight, mode: 0, seed: 1, fog: [16, 135], ...fog,
    color: (r, x, z) => {
      const f = r()
      if (f < 0.02) return [1.0, 0.75, 0.5]
      if (f < 0.035) return [0.95, 0.55, 0.75]
      if (f < 0.05) return [0.7, 0.85, 1.0]
      const patch = 0.55 + 0.6 * fbm(x * 0.06 + 4, z * 0.06, 3)
      const b = (0.3 + r() * 0.7) * patch
      return [(0.08 + r() * 0.08) * b, (0.13 + r() * 0.1) * b, (0.36 + r() * 0.3) * b]
    },
    size: (r) => (r() < 0.06 ? 0.08 + r() * 0.06 : 0.03 + r() * 0.04),
    yJitter: (r) => r() * r() * 0.3,
  }))

  // Grass blades near the walk: short vertical strokes that catch the wind.
  const gr = rng(41), blades = Math.floor(9000 * k)
  const gp: number[] = [], gc: number[] = [], gs: number[] = []
  for (let i = 0; i < blades; i++) {
    const x = (gr() - 0.5) * 60 * (0.3 + gr()), z = 14 - gr() * 85
    const base = homeHeight(x, z), tall = 0.18 + gr() * 0.45, lean = (gr() - 0.5) * 0.12
    const steps = 4
    for (let s = 0; s < steps; s++) {
      const f = s / (steps - 1)
      gp.push(x + lean * f * f, base + f * tall, z)
      const b = (0.12 + 0.5 * f) * (0.6 + gr() * 0.5)
      gc.push(0.18 * b, 0.32 * b, 0.75 * b)
      gs.push(0.022 + gr() * 0.012)
    }
  }
  scene.add(cloud(u, new Float32Array(gp), new Float32Array(gc), new Float32Array(gs), 0, [8, 60], 42, 1, fog))

  // Flowers in drifts: dim stems and luminous heads in warm and cool colours.
  const fr = rng(51)
  const palette: RGB[] = [[1.0, 0.62, 0.38], [1.0, 0.48, 0.66], [0.62, 0.78, 1.0], [1.0, 0.9, 0.7], [0.75, 0.55, 1.0]]
  const fp: number[] = [], fc: number[] = [], fs: number[] = []
  const want = Math.floor(900 * k)
  for (let tries = 0, made = 0; made < want && tries < want * 12; tries++) {
    const x = (fr() - 0.5) * 70, z = 12 - fr() * 110
    if (fbm(x * 0.05 + 11, z * 0.05 - 3, 3) < 0.12 || Math.abs(x) < 1.2) continue
    made++
    const base = homeHeight(x, z), tall = 0.35 + fr() * 0.55
    const c = palette[Math.floor(fr() * palette.length)]
    const bend = (fr() - 0.5) * 0.2
    for (let s = 0; s < 6; s++) {
      const f = s / 6
      fp.push(x + bend * f * f, base + f * tall, z)
      fc.push(0.04, 0.09, 0.08); fs.push(0.018)
    }
    const petals = 5 + Math.floor(fr() * 4)
    for (let p = 0; p < petals; p++) {
      const a = (p / petals) * Math.PI * 2, rr = 0.05 + fr() * 0.04
      fp.push(x + bend + Math.cos(a) * rr, base + tall + (fr() - 0.5) * 0.03, z + Math.sin(a) * rr)
      const b = 0.7 + fr() * 0.5
      fc.push(c[0] * b, c[1] * b, c[2] * b); fs.push(0.04 + fr() * 0.03)
    }
    fp.push(x + bend, base + tall + 0.02, z); fc.push(1.6, 1.5, 1.3); fs.push(0.06)
  }
  scene.add(cloud(u, new Float32Array(fp), new Float32Array(fc), new Float32Array(fs), 9, [10, 90], 52, 1, fog))

  // Fireflies drifting over the grass.
  const ff = rng(61), fn = Math.floor(420 * k)
  const ffp = new Float32Array(fn * 3), ffc = new Float32Array(fn * 3), ffs = new Float32Array(fn)
  for (let i = 0; i < fn; i++) {
    const x = (ff() - 0.5) * 60, z = 12 - ff() * 95
    ffp.set([x, homeHeight(x, z) + 0.4 + ff() * 2.2, z], i * 3)
    const warm = ff() < 0.7
    ffc.set(warm ? [1.4, 1.1, 0.45] : [0.7, 1.3, 0.8], i * 3)
    ffs[i] = 0.05 + ff() * 0.04
  }
  scene.add(cloud(u, ffp, ffc, ffs, 4, [6, 80], 62, 1, fog))

  // Dust hanging in the air.
  scene.add(particleField(u, {
    count: Math.floor(5000 * k), x: [-40, 40], z: [-110, 12], height: (x, z) => homeHeight(x, z) + 0.3, mode: 0, seed: 2,
    fog: [10, 70], opacity: 0.35, ...fog,
    color: (r) => { const b = 0.4 + r() * 0.6; return [0.6 * b, 0.7 * b, 1.0 * b] },
    size: (r) => 0.04 + r() * 0.08,
    yJitter: (r) => r() * 8,
  }))
}

/**
 * The Q-Day gate: a great ring of light standing over the path, ticking like a clock face.
 * Its material's uOpacity doubles as its state: 0.55 whole, falling toward 0.12 as it shatters.
 */
export function qdayGate(u: SceneUniforms, center: THREE.Vector3, tangent: THREE.Vector3, lowPower: boolean) {
  const n = lowPower ? 5000 : 12000, r = rng(77)
  const radius = 5.6
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
  const up = new THREE.Vector3(0, 1, 0)
  const pos: number[] = [], col: number[] = [], size: number[] = []
  const push = (a: number, rad: number, depth: number, c: RGB, s: number) => {
    const p = center.clone().addScaledVector(side, Math.cos(a) * rad).addScaledVector(up, Math.sin(a) * rad).addScaledVector(tangent, depth)
    if (p.y < homeHeight(p.x, p.z) + 0.02) return
    pos.push(p.x, p.y, p.z); col.push(...c); size.push(s)
  }
  for (let i = 0; i < n; i++) {
    const kind = r()
    const a = r() * Math.PI * 2
    if (kind < 0.55) {
      // the main ring: a tight bright band
      const g = (r() + r() - 1) * 0.08
      const b = 0.7 + r() * 0.6
      push(a, radius + g, (r() - 0.5) * 0.08, [0.72 * b, 0.68 * b, 1.0 * b], 0.03 + r() * 0.03)
    } else if (kind < 0.75) {
      // a second faint ring, offset, like an interference fringe
      const b = 0.25 + r() * 0.3
      push(a, radius * 1.12 + (r() - 0.5) * 0.25, (r() - 0.5) * 0.4, [0.5 * b, 0.55 * b, 1.0 * b], 0.03 + r() * 0.03)
    } else if (kind < 0.85) {
      // sixty tick marks, every fifth one long and amber
      const tick = Math.floor(r() * 60), major = tick % 5 === 0
      const ta = (tick / 60) * Math.PI * 2 + Math.PI / 2
      const len = major ? 0.7 : 0.25
      const b = major ? 1.3 : 0.6
      push(ta + (r() - 0.5) * 0.004, radius - 0.25 - r() * len, 0, major ? [1.0 * b, 0.7 * b, 0.4 * b] : [0.7 * b, 0.7 * b, 1.0 * b], 0.03)
    } else {
      // a thin veil drifting inside the ring
      const rad = Math.sqrt(r()) * radius * 0.95
      const b = 0.08 + r() * 0.12
      push(a, rad, (r() - 0.5) * 0.3, [0.55 * b, 0.5 * b, 1.0 * b], 0.04 + r() * 0.06)
    }
  }
  return cloud(u, new Float32Array(pos), new Float32Array(col), new Float32Array(size), 7, [14, 110], 78, 0.55, { center, fogColor: MEADOW_FOG })
}
