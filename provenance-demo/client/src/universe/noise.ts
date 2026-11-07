// Small deterministic noise helpers for terrain and particle placement (CPU side).

/** Seeded PRNG (mulberry32) so every load builds the same landscape. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  return s - Math.floor(s)
}

const fade = (t: number) => t * t * (3 - 2 * t)

/** Smooth value noise in [0, 1]. */
export function valueNoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = fade(x - ix), fy = fade(y - iy)
  const a = hash2(ix, iy), b = hash2(ix + 1, iy)
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** Fractal noise in roughly [-1, 1]. */
export function fbm(x: number, y: number, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise(x * freq, y * freq) * 2 - 1) * amp
    norm += amp
    amp *= 0.5
    freq *= 2.03
  }
  return sum / norm
}
