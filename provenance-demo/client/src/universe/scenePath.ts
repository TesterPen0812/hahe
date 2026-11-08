import * as THREE from 'three'
import { cloud, type SceneUniforms } from './worlds'

interface ScenePathOptions {

  length: number
  amplitude: number
  turns: number
  lowPower: boolean
  width?: number
  speed?: number
  height?: number
  brightness?: number
  radius?: number
}

function pcg(value: number) {
  const state = (Math.imul(value, 747796405) + 2891336453) >>> 0
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0
  return ((word >>> 22) ^ word) >>> 0
}

const fixed = (index: number, salt: number) => pcg(index ^ pcg(pcg(salt))) / 4294967295
const mix = (a: number, b: number, t: number) => a + (b - a) * t

export function scenePath(u: SceneUniforms, options: ScenePathOptions) {
  const { length, amplitude, turns, lowPower, width = 0.035, speed = 0.65,
    height = 0.035, brightness = 2, radius = 0.0095 } = options
  const count = Math.ceil((length + 8) * (lowPower ? 70 : 110))
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const metadata = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const lane = ((fixed(i, 22) + fixed(i, 23) + fixed(i, 24)) * (2 / 3) - 1) * width
    const pace = mix(0.6, 1.25, fixed(i, 25))
    const z = mix(6, -length - 2, fixed(i, 27))
    const vertical = fixed(i, 29)
    const amount = Math.max(0, Math.min(1, -z / length))
    const envelope = Math.sin(amount * Math.PI)
    positions.set([amplitude * envelope * envelope * Math.sin(amount * Math.PI * 2 * turns) + lane,
      height + vertical * 0.015, z], i * 3)
    const edge = Math.min(1, Math.abs(lane) / (width * 1.5))
    const center = 1 - edge * edge * (3 - 2 * edge)
    const energy = brightness * (0.45 + center * 0.55) * 0.7
    colors.set([energy, energy, energy], i * 3)
    sizes[i] = radius * mix(0.5, 1.1, fixed(i, 32))
    metadata.set([lane, pace, vertical, z], i * 4)
  }
  const stream = cloud(u, positions, colors, sizes, 18, [0, length * 2.3], 27, 1, {
    center: new THREE.Vector3(length, amplitude, turns),
    axis: new THREE.Vector3(speed, width, height),
  })
  stream.geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1))
  stream.geometry.setAttribute('aHang', new THREE.InstancedBufferAttribute(metadata, 4))
  stream.name = 'White centerline'
  return stream
}

interface CurveStreamOptions {
  lowPower: boolean
  /** Ground height under the curve; the stream rides just above it. */
  ground?: (x: number, z: number) => number
  width?: number
  speed?: number
  height?: number
  brightness?: number
  radius?: number
  samples?: number
  fog?: number
}

/**
 * The landscapes' white stream, on any curve: grains in bell-distributed lanes flow from the
 * curve's start to its end at their own pace. They live in the persistent particle simulation,
 * so the pointer, its wake, clicks and the fluid stir them like every other grain.
 */
export function curveStream(u: SceneUniforms, curve: THREE.Curve<THREE.Vector3>, options: CurveStreamOptions) {
  const { lowPower, ground = () => 0, width = 0.035, speed = 0.65, height = 0.035,
    brightness = 2, radius = 0.0095, samples = 512, fog } = options
  const length = curve.getLength()
  const line = new Float32Array(samples * 4), at = new THREE.Vector3()
  for (let i = 0; i < samples; i++) {
    curve.getPointAt(i / (samples - 1), at)
    line.set([at.x, ground(at.x, at.z), at.z, 1], i * 4)
  }
  const texture = new THREE.DataTexture(line, samples, 1, THREE.RGBAFormat, THREE.FloatType)
  texture.needsUpdate = true
  const count = Math.ceil(length * (lowPower ? 70 : 110))
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const metadata = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const lane = ((fixed(i, 22) + fixed(i, 23) + fixed(i, 24)) * (2 / 3) - 1) * width
    const pace = mix(0.6, 1.25, fixed(i, 25))
    const start = fixed(i, 27)
    const vertical = fixed(i, 29)
    curve.getPointAt(start, at)
    positions.set([at.x, ground(at.x, at.z) + height, at.z], i * 3)
    const edge = Math.min(1, Math.abs(lane) / (width * 1.5))
    const center = 1 - edge * edge * (3 - 2 * edge)
    const energy = brightness * (0.45 + center * 0.55) * 0.7
    colors.set([energy, energy, energy], i * 3)
    sizes[i] = radius * mix(0.5, 1.1, fixed(i, 32))
    metadata.set([lane, pace, vertical, start], i * 4)
  }
  const stream = cloud(u, positions, colors, sizes, 19, [0, fog ?? length * 2.3], 27, 1, {
    axis: new THREE.Vector3(speed, width, height),
    curve: { texture, samples, length },
  })
  stream.geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1))
  stream.geometry.setAttribute('aHang', new THREE.InstancedBufferAttribute(metadata, 4))
  stream.name = 'White path stream'
  return stream
}
