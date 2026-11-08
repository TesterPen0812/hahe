// The ending: after the last checkpoint the walk goes dark. Darkness closes in from the screen's edges
// so the light at the end of the path is the last thing to go, then the closing line stands alone on
// black. This is only a mask over the finished image, driven from the walk: it knows nothing of any
// world's materials, so it carries over whichever world the walk ends in.

/** The closing words, one beat each: the first fades in on the black, then the second beneath it. */
export const CLOSING_LINES: readonly string[] = ['There are many worlds unexplored.', 'One fewer than yesterday.']

/** Seconds for darkness to take the screen, and to lift again when stepping back out of it. */
export const ENDING_FADE = 7
export const ENDING_LIFT = 1.1

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** One frame of the fade: `on` takes it to 1, off lifts it back to 0. */
export function stepEnding(k: number, on: boolean, dt: number) {
  return clamp01(k + (on ? dt / ENDING_FADE : -dt / ENDING_LIFT))
}

export interface EndingMask {
  /** The mask's overall strength: it rises gently rather than appearing. */
  opacity: number
  /** Fully clear inside `inner`, solid black outside `outer` (as fractions of the farthest corner). */
  inner: number
  outer: number
  /** How dark even the clear centre is by now. */
  core: number
}

/** The shape of the dark at progress k (0..1): slow at first, closing, and the last light lingers. */
export function endingMask(k: number): EndingMask {
  const closing = smoothstep(0, 1, k)
  // squared, so the circle gets small early and then takes its time over the last of the light
  const reach = (1 - closing) * (1 - closing)
  const outer = reach * 2.1
  return {
    opacity: smoothstep(0, 0.12, k),
    inner: outer * 0.32,
    outer,
    core: smoothstep(0.82, 1, k),
  }
}

/** The CSS for the mask, the circle centred on (x, y) px, `far` px to the screen's farthest corner. */
export function endingBackground(k: number, x: number, y: number, far: number) {
  if (k >= 1) return '#000'
  const m = endingMask(k)
  const inner = m.inner * far, outer = Math.max(m.outer * far, inner + 1)
  // an eased falloff: a plain two-stop ramp shows a visible ring on the dark scene
  const a = (t: number) => (m.core + (1 - m.core) * t).toFixed(3)
  const at = (t: number) => (inner + (outer - inner) * t).toFixed(1)
  return `radial-gradient(circle at ${x.toFixed(1)}px ${y.toFixed(1)}px, rgba(0,0,0,${a(0)}) ${inner.toFixed(1)}px, `
    + `rgba(0,0,0,${a(0.12)}) ${at(0.3)}px, rgba(0,0,0,${a(0.5)}) ${at(0.6)}px, rgba(0,0,0,${a(0.88)}) ${at(0.85)}px, #000 ${outer.toFixed(1)}px)`
}
