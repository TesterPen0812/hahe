// The ending: after the last checkpoint the walk goes through a threshold into the dark. The whole view
// goes at once, as crossing a door does but across the entire screen: the camera pushes on, the picture
// streaks round it, and the darkness and the falling highlights take everything together, so no single
// spot or shape is left for last. Then the closing lines stand alone on black.
//
// Everything here runs off one clock. With no input it plays at its calm pace; once it has started,
// scrolling or holding forward runs that clock faster, for the passage, the lines and the hold between
// them alike. Nothing here knows any world's materials, so it carries over whichever world the walk ends in.

/** The closing words, one beat each: the first fades in on the black, then the second beneath it. */
export const CLOSING_LINES: readonly string[] = ['There are many worlds unexplored.', 'One fewer than yesterday.']

/** Seconds for the passage into the dark at its calm pace, and to lift again when stepping back out of it. */
export const ENDING_FADE = 4.5
export const ENDING_LIFT = 1.1

/** The two beats on the black, in seconds of the calm clock from when it goes black. */
const LINE_FADE = 3.2
const LINE_STARTS = [0.7, 5.65] as const
export const CLOSING_SECONDS = LINE_STARTS[1] + LINE_FADE

/** How long a scroll keeps counting toward the speed (seconds). */
export const ENDING_SCROLL_MEMORY = 0.3
/** Holding forward runs the clock this many times faster. */
export const ENDING_HOLD_RATE = 4
/** The fastest a scroll can run the clock, and how much speed (route units a second) buys each step of it. */
export const ENDING_MAX_RATE = 10
const SCROLL_GAIN = 0.35

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** How fast the ending's clock runs: 1 with no input, faster the harder the scroll, or held forward. */
export function endingRate(held: boolean, scrollSpeed: number) {
  const scroll = 1 + Math.max(0, scrollSpeed) * SCROLL_GAIN
  return Math.min(ENDING_MAX_RATE, Math.max(scroll, held ? ENDING_HOLD_RATE : 1))
}

/** One frame of the passage: `on` takes it to 1 at `rate` times its calm pace, off lifts it back to 0. */
export function stepEnding(k: number, on: boolean, dt: number, rate = 1) {
  return clamp01(k + (on ? (dt * rate) / ENDING_FADE : -dt / ENDING_LIFT))
}

export interface EndingPassage {
  /** How black the whole view is, evenly, from 0 to 1. */
  dark: number
  /** How far the highlights have been pulled down to the rest of the picture, so nothing outlasts it. */
  flatten: number
  /** Route units the camera has pushed on past the end stop. */
  push: number
  /** The radial streak of going through (0..1). */
  zoom: number
}

/** The passage at progress k (0..1). It only ever depends on k, so stepping back reverses it. */
export function endingPassage(k: number): EndingPassage {
  return {
    dark: k >= 1 ? 1 : smoothstep(0.3, 1, k),
    flatten: smoothstep(0.35, 0.85, k),
    push: 16 * Math.pow(clamp01(k), 1.6),
    zoom: smoothstep(0.1, 0.85, k),
  }
}

/** How far each closing line has come in, `t` seconds of the calm clock after it went black. */
export function closingOpacities(t: number): [number, number] {
  const line = (start: number) => smoothstep(start, start + LINE_FADE, t)
  return [line(LINE_STARTS[0]), line(LINE_STARTS[1])]
}
