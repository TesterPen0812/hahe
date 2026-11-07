// The home meadow ("today") and the Q-Day gate. Original scene design for this app.
// The look is deliberately spare: one colour family, soft out-of-focus light everywhere,
// a cavern of hanging threads, and a single bright stream leading to the door.
import * as THREE from 'three'
import { fbm, rng } from './noise'
import { cloud, homeHeight, particleField, sky, type RGB, type SceneUniforms } from './worlds'

const MEADOW_FOG: RGB = [0.02, 0.035, 0.11]

/** Strand ceiling: high over the path, curving down toward the sides like a cave roof. */
const ceiling = (x: number) => 13 - 0.008 * x * x

/** Night meadow inside a cavern of hanging light. */
export function buildMeadow(scene: THREE.Scene, u: SceneUniforms, lowPower: boolean) {
  const k = lowPower ? 0.45 : 1
  const fog = { fogColor: MEADOW_FOG }

  // A near-black navy sky with a faint lift at the horizon. No moon, no mountains.
  scene.add(sky(
    [0.004, 0.006, 0.02], [0.025, 0.035, 0.09], [0.004, 0.006, 0.018],
    new THREE.Vector3(0.2, -0.8, -1), [0, 0, 0], 0.001,
    { glow: [0.03, 0.04, 0.1] },
  ))

  // The ground: a deep field of navy and periwinkle grains that blur into bokeh near and far.
  scene.add(particleField(u, {
    count: Math.floor(130000 * k), x: [-60, 60], z: [-140, 16], height: homeHeight, mode: 0, seed: 1, fog: [18, 120], ...fog,
    color: (r, x, z) => {
      const patch = 0.6 + 0.55 * fbm(x * 0.05 + 4, z * 0.05, 3)
      if (r() < 0.06) { const w = 0.7 + r() * 0.5; return [0.72 * w, 0.8 * w, 1.0 * w] }
      const b = (0.45 + r() * 0.6) * patch
      return [(0.16 + r() * 0.1) * b, (0.24 + r() * 0.12) * b, (0.72 + r() * 0.3) * b]
    },
    size: (r) => 0.06 + r() * r() * 0.12,
    yJitter: (r) => r() * r() * 0.35,
  }))

  // Pale clumps scattered over the ground, like frosted shrubs catching the light.
  const cr = rng(31), clumps = Math.floor(70 * k)
  const cp: number[] = [], cc: number[] = [], cs: number[] = []
  for (let c = 0; c < clumps; c++) {
    const x0 = (cr() - 0.5) * 70, z = 10 - cr() * 110
    const x = Math.abs(x0) < 2.5 ? x0 + Math.sign(x0 || 1) * 2.5 : x0 // keep the walk clear
    const base = homeHeight(x, z), rad = 0.4 + cr() * 0.7, n = 90 + Math.floor(cr() * 120)
    for (let i = 0; i < n; i++) {
      const a = cr() * Math.PI * 2, rr = Math.sqrt(cr()) * rad, h = cr() * rad * 1.3
      cp.push(x + Math.cos(a) * rr, base + h * (1 - rr / rad * 0.5), z + Math.sin(a) * rr)
      const b = 0.35 + cr() * 0.45
      cc.push(0.62 * b, 0.7 * b, 0.95 * b)
      cs.push(0.035 + cr() * 0.035)
    }
  }
  scene.add(cloud(u, new Float32Array(cp), new Float32Array(cc), new Float32Array(cs), 9, [8, 90], 32, 1, fog))

  // The cavern: thousands of strands hanging from an unseen roof, each dripping slow beads of light.
  const sr = rng(41), strands = Math.floor(2200 * k)
  const sp: number[] = [], sc: number[] = [], ss: number[] = []
  for (let i = 0; i < strands; i++) {
    const x = (sr() - 0.5) * 2 * (6 + sr() * 34)
    const z = 14 - sr() * 140
    const top = ceiling(x) + (sr() - 0.5) * 2.5
    if (top < 2.5) continue
    // keep a clear corridor above the walk so strands frame the path instead of blocking it
    const ground = homeHeight(x, z)
    const len = (1.5 + sr() * sr() * 8) * (Math.abs(x) < 4 ? 0.35 : 1)
    const beads = 10 + Math.floor(len * 5)
    const bright = sr() < 0.15 ? 2.0 : 0.8 + sr() * 0.7
    for (let b = 0; b < beads; b++) {
      const f = b / beads
      sp.push(x + (sr() - 0.5) * 0.04, Math.max(ground + 0.5, ground + top - f * len), z + (sr() - 0.5) * 0.04)
      const w = bright * (0.5 + 0.5 * (1 - f)) * (0.7 + sr() * 0.4)
      sc.push(0.6 * w, 0.68 * w, 1.0 * w)
      ss.push(0.045 + sr() * 0.05)
    }
  }
  scene.add(cloud(u, new Float32Array(sp), new Float32Array(sc), new Float32Array(ss), 11, [10, 110], 42, 1, fog))

  // A light snow of motes falling through the cavern.
  scene.add(particleField(u, {
    count: Math.floor(3500 * k), x: [-35, 35], z: [-110, 12], height: (x, z) => homeHeight(x, z) + 0.5, mode: 8, seed: 2,
    fog: [6, 70], opacity: 0.35, ...fog,
    color: (r) => { const b = 0.5 + r() * 0.5; return [0.7 * b, 0.78 * b, 1.0 * b] },
    size: (r) => 0.03 + r() * 0.05,
    yJitter: (r) => r() * 10,
  }))
}

/**
 * The Q-Day gate: a dense curtain of hanging strands across the path. Its material's uOpacity
 * doubles as its state: 0.55 closed, falling toward 0.12 as the curtain parts once crossed.
 */
export function qdayGate(u: SceneUniforms, center: THREE.Vector3, tangent: THREE.Vector3, lowPower: boolean) {
  const r = rng(77), strands = lowPower ? 260 : 620
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
  const pos: number[] = [], col: number[] = [], size: number[] = []
  for (let i = 0; i < strands; i++) {
    const s = (r() - 0.5) * 2 * 9 * Math.sqrt(r())
    const depth = (r() - 0.5) * 0.8
    const x = center.x + side.x * s + tangent.x * depth, z = center.z + side.z * s + tangent.z * depth
    const ground = homeHeight(x, z)
    const top = 6.5 + (1 - Math.abs(s) / 9) * 3 + r() * 1.5
    const reach = top * (0.55 + r() * 0.45)
    const beads = 26 + Math.floor(reach * 5)
    const violet = r() < 0.18
    for (let b = 0; b < beads; b++) {
      const f = b / beads
      pos.push(x, ground + top - f * reach, z)
      const w = (0.9 + r() * 0.9) * (0.45 + 0.55 * (1 - f))
      col.push(...((violet ? [0.95 * w, 0.55 * w, 1.0 * w] : [0.72 * w, 0.66 * w, 1.0 * w]) as RGB))
      size.push(0.04 + r() * 0.035)
    }
  }
  return cloud(u, new Float32Array(pos), new Float32Array(col), new Float32Array(size), 12, [12, 110], 78, 0.55, { center, fogColor: MEADOW_FOG })
}
