// Character rain: strands of ASCII falling through a world, each one a short column of glyphs that
// drops as a unit and starts again at the top. One tint per world. Original design for this app.
// Strands are kept out of the walk's corridor, so they never fall across a photo's face.
import * as THREE from 'three'
import { rng } from './noise'
import { cloud, type RGB, type SceneUniforms } from './worlds'

export interface RainOptions {
  /** How many strands. */
  strands: number
  /** Where a strand hangs: returns its column (x, z) and the height its fall starts from, or null to skip. */
  place: (r: () => number) => { x: number; z: number; top: number } | null
  ground: (x: number, z: number) => number
  tint: RGB
  /** Glyphs per strand. */
  length?: [number, number]
  /** Gap between glyphs in a strand (world units). */
  gap?: number
  /** Falls per second (a range; each strand picks its own). */
  speed?: [number, number]
  size?: number
  fog: [number, number]
  fogColor?: RGB
  seed: number
  name: string
}

export function asciiRain(u: SceneUniforms, o: RainOptions) {
  const r = rng(o.seed)
  const gap = o.gap ?? 0.26
  const [l0, l1] = o.length ?? [5, 14]
  const [s0, s1] = o.speed ?? [0.05, 0.12]
  const pos: number[] = [], col: number[] = [], size: number[] = [], hang: number[] = []
  for (let i = 0; i < o.strands; i++) {
    const at = o.place(r)
    if (!at) continue
    const floor = o.ground(at.x, at.z)
    const n = l0 + Math.floor(r() * (l1 - l0 + 1))
    const speed = s0 + r() * (s1 - s0)
    const phase = r()
    const bright = r() < 0.12 ? 1.7 : 0.55 + r() * 0.5
    // each strand falls from its top to a little below the ground, so its tail clears the floor too
    const travel = at.top - floor + n * gap
    for (let k = 0; k < n; k++) {
      const y = at.top + k * gap                     // the head leads; the tail trails above it
      pos.push(at.x, y, at.z)
      // the head is brightest, the tail fades
      const w = bright * (k === 0 ? 1.6 : Math.pow(1 - k / n, 1.4))
      col.push(o.tint[0] * w, o.tint[1] * w, o.tint[2] * w)
      size.push((o.size ?? 0.07) * (k === 0 ? 1.15 : 1))
      hang.push(speed, phase, travel, y - floor)
    }
  }
  const mesh = cloud(u, new Float32Array(pos), new Float32Array(col), new Float32Array(size), 20, o.fog, o.seed + 9, 1,
    o.fogColor ? { fogColor: o.fogColor } : {})
  mesh.geometry.setAttribute('aHang', new THREE.InstancedBufferAttribute(new Float32Array(hang), 4))
  mesh.name = o.name
  return mesh
}
