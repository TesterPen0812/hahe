// The blue world ("today", before Q-Day). Original scene design for this app.
// The look is deliberately spare: one colour family, soft out-of-focus light everywhere,
// a cavern of hanging threads, and a single bright stream leading to the door.
import * as THREE from 'three'
import { rng } from './noise'
import { cloud, homeHeight, particleField, sky, type RGB, type SceneUniforms } from './worlds'
import { bulbMeadow } from './prismWorld'
import { groundGrains } from './greenWorld'

const MEADOW_FOG: RGB = [0.02, 0.035, 0.11]

/** Strand ceiling: high over the path, curving down toward the sides like a cave roof. */
const ceiling = (x: number) => 13 - 0.008 * x * x

/** Night meadow inside a cavern of hanging light. */
export function buildMeadow(scene: THREE.Scene, u: SceneUniforms, lowPower: boolean, pathX: (z: number) => number) {
  const k = lowPower ? 0.45 : 1
  const fog = { fogColor: MEADOW_FOG }

  // A near-black navy sky with a faint lift at the horizon. No moon, no mountains.
  scene.add(sky(
    [0.004, 0.006, 0.02], [0.025, 0.035, 0.09], [0.004, 0.006, 0.018],
    new THREE.Vector3(0.2, -0.8, -1), [0, 0, 0], 0.001,
    { glow: [0.03, 0.04, 0.1] },
  ))

  // The ground, built like the landscapes: a dense meadow of bulbs (a stem and a round head of
  // fine grains) that sway in a noise breeze, with colour bands travelling across them in Today's
  // blues, over a fine textured floor. Same grain budget as the old bead field and clumps.
  scene.add(bulbMeadow(u, {
    bulbs: Math.floor(6000 * k), z: [14, -96], pathX, ground: homeHeight, spread: 11, lane: 0.8,
    fog: [18, 120], seed: 3101, palette: 1, fogColor: MEADOW_FOG, name: 'today-bulb-meadow',
  }))
  scene.add(groundGrains(u, Math.floor(25000 * k), {
    z: [16, -140], pathX, ground: (x, z) => homeHeight(x, z) + 0.02, reach: 30, size: 0.02,
    fog: [18, 120], fogColor: MEADOW_FOG, seed: 3201, name: 'today-ground-grains',
    color: (b, tone, white) => white
      ? [0.72 * b * 1.6, 0.8 * b * 1.6, 1.0 * b * 1.6]
      : [b * (0.14 + tone * 0.3), b * (0.22 + tone * 0.4), b * (0.7 + tone * 0.35)],
  }))

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
