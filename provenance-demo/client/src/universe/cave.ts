const TAU = Math.PI * 2
const ROOT_GRAINS = 160
const THREAD_GRAINS = 48

function pcg(value: number) {
  const state = (Math.imul(value, 747796405) + 2891336453) >>> 0
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0
  return ((word >>> 22) ^ word) >>> 0
}

function random(index: number, salt: number) {
  return pcg(index ^ pcg(pcg(salt))) / 4294967295
}

function bell(index: number, salt: number) {
  return (random(index, salt) + random(index, salt + 1) + random(index, salt + 2)) * (2 / 3) - 1
}

function smoothstep(lo: number, hi: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

const fract = (value: number) => value - Math.floor(value)
const mix = (a: number, b: number, t: number) => a + (b - a) * t

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
    mix(mix(n(0, 0, 1), n(1, 0, 1), ux), mix(n(0, 1, 1), n(1, 1, 1), ux), uy),
    uz,
  ) * 1.8
}

function fbm3(x: number, y: number, z: number) {
  let sum = 0, amplitude = 0.5
  for (let octave = 0; octave < 4; octave++) {
    sum += noise3(x, y, z) * amplitude
    x = x * 2.02 + 17.1; y = y * 2.02 + 31.7; z = z * 2.02 + 7.3
    amplitude *= 0.5
  }
  return sum
}

interface HangingOptions {
  walls: number
  roots: number
  threads: number
  length: number
  pathX: (z: number) => number
  ground: (x: number, z: number) => number
}

interface HangingLayer {
  positions: Float32Array
  colors: Float32Array
  sizes: Float32Array
  /** frequency/rate, phase, along²/drop/side; kind: 0 root / 1 silk / 2 wall. */
  hang: Float32Array
}

function layer(count: number): HangingLayer {
  return {
    positions: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    sizes: new Float32Array(count),
    hang: new Float32Array(count * 4),
  }
}

function anchor(options: HangingOptions, z: number, angle: number) {
  const width = 3.8 * (1 + Math.sin(z * 0.12) * 0.08)
  const height = 3.9 * (1 + Math.sin(z * 0.09 + 1) * 0.07)
  const cross = Math.sin(angle) * width
  // A narrow clear nave leaves the path legible at eye height.
  const x = options.pathX(z) + Math.sign(cross || 1) * (1.15 + Math.abs(cross))
  const headroom = (Math.cos(angle) + 0.35) * height
  const y = options.ground(x, z) + headroom
  // Side curtains descend with the dome without growing roots beneath our floor.
  return { x, y, height: headroom / 1.35 }
}

export function hangingCave(options: HangingOptions) {
  const walls = layer(options.walls)
  for (let i = 0; i < options.walls; i++) {
    const z = mix(8, -options.length - 1.2, random(i, 121))
    const angle = (random(i, 122) * 2 - 1) * Math.PI * 0.88
    const hall = smoothstep(-options.length + 20, -options.length + 5, z)
    const breathe = 1 + noise3(z * 0.12, 0, 3) * 0.25
    const width = 3.8 * breathe * (1 + hall * 0.35)
    const height = 3.9 * breathe * (1 + hall * 0.35)
    const rough = fbm3(angle * 1.4, z * 0.22, 1) * 0.4
    const depth = Math.pow(random(i, 123), 2) * 0.8
    const radius = 1 + rough + depth / Math.max(width, 0.001)
    const x = options.pathX(z) + Math.sin(angle) * width * radius
    const y = Math.cos(angle) * height * radius + height * 0.35
    const isDrip = random(i, 124) < 0.16
    walls.hang.set([
      isDrip ? mix(0.04, 0.12, random(i, 126)) : 0,
      isDrip ? random(i, 125) : 0,
      Math.sign(Math.sin(angle)), 2,
    ], i * 4)
    const vein = Math.pow(Math.max(0, Math.min(1, noise3(angle * 7, z * 0.5, 2) * 0.5 + 0.5)), 3) * 2.5
    const crown = 1 - smoothstep(0.35, 0.9, Math.cos(angle)) * 0.75
    // Footing is applied after the animated drip in the vertex placement shader.
    const brightness = 1.4 * crown * (0.15 + vein) * (1 - depth * 0.8) * 0.7 * (isDrip ? 1.6 : 1)
    const tone = Math.max(0, Math.min(1, 0.2 + vein * 0.25 + (random(i, 128) - 0.5) * 0.2))
    const accent = random(i, 129) < 0.015
    walls.positions.set([x, y + options.ground(x, z), z], i * 3)
    walls.colors.set(accent
      ? [brightness * 0.75, brightness, brightness * 0.94]
      : [brightness * (0.18 + tone * 0.4), brightness * (0.55 + tone * 0.45), brightness * (0.44 + tone * 0.4)], i * 3)
    walls.sizes[i] = 0.024 * (0.6 + Math.pow(random(i, 130), 2))
  }

  const roots = layer(options.roots * ROOT_GRAINS)
  for (let root = 0; root < options.roots; root++) {
    const z = 4 + (-options.length + 2 - 4) * random(root, 141)
    const angle = (random(root, 142) * 2 - 1) * 1.35
    const ceiling = anchor(options, z, angle)
    const reach = 0.6 + (ceiling.height * 1.1 - 0.6) * Math.pow(random(root, 143), 1.5)
    const frequency = 0.4 + random(root, 144) * 0.5
    const phase = random(root, 145) * TAU
    for (let bead = 0; bead < ROOT_GRAINS; bead++) {
      const i = root * ROOT_GRAINS + bead
      const along = bead / ROOT_GRAINS
      const tangle = 0.03 * (1 + along * 2)
      roots.positions.set([
        ceiling.x + bell(i, 146) * tangle,
        ceiling.y - along * reach,
        z + bell(i, 149) * tangle,
      ], i * 3)
      roots.hang.set([frequency, phase, along * along, 0], i * 4)
      const tip = smoothstep(0.7, 1, along)
      const brightness = 1.4 * (0.25 + tip * 1.2) * 0.7
      const accent = tip > 0.8 && random(i, 153) < 0.3
      const tone = 0.35 + 0.45 * along
      roots.colors.set(accent
        ? [brightness * 0.75, brightness, brightness * 0.94]
        : [brightness * (0.18 + tone * 0.4), brightness * (0.55 + tone * 0.45), brightness * (0.44 + tone * 0.4)], i * 3)
      roots.sizes[i] = 0.024 * (0.5 + random(i, 154) * 0.5)
    }
  }

  const threads = layer(options.threads * THREAD_GRAINS)
  for (let silk = 0; silk < options.threads; silk++) {
    const z = 8 + (-options.length - 0.6 - 8) * random(silk, 181)
    const angle = (random(silk, 182) * 2 - 1) * 1.42
    const ceiling = anchor(options, z, angle)
    const reach = 0.15 + 1.15 * Math.pow(random(silk, 183), 1.8)
    const frequency = 1 + random(silk, 185) * 1.5
    const phase = random(silk, 186) * TAU
    for (let bead = 0; bead < THREAD_GRAINS; bead++) {
      const i = silk * THREAD_GRAINS + bead
      const along = bead / (THREAD_GRAINS - 1)
      const onBead = random(i, 184) < 0.75
      const drop = onBead ? Math.round(along * 9) / 9 : along
      threads.positions.set([
        ceiling.x + bell(i, 187) * 0.004,
        ceiling.y - drop * reach,
        z + bell(i, 190) * 0.004,
      ], i * 3)
      threads.hang.set([frequency, phase, drop, 1], i * 4)
      const worm = along < 0.03
      const glow = worm ? 3 : (onBead ? 0.6 : 0.08) * (1 - drop * 0.5)
      const brightness = 1.4 * glow * 0.7
      threads.colors.set([brightness * 0.6, brightness, brightness * 0.87], i * 3)
      threads.sizes[i] = 0.018 * (worm ? 1.3 : 0.6)
    }
  }
  return { walls, roots, threads }
}
