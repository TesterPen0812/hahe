// What the capture log says about a photo, derived only from the server's real verdict: one step per
// check the verifier ran, in its order. Nothing here is invented: a step exists because a check exists.
// (The seal parts the 3D scene draws come from sealParts.ts.)
import type { Alg, Check, ItemSummary, SealCheck, TrustLabel, VerificationResult } from '@provenance-demo/shared'

export const ALG_SHORT: Record<Alg, string> = {
  ed25519: 'Ed25519',
  'ml-dsa-65': 'ML-DSA-65',
  es256: 'ES256',
  'rsa-pss-2048': 'RSA-2048',
  'rsa-toy-96': 'RSA-96',
}
const short = (alg: Alg | string) => ALG_SHORT[alg as Alg] ?? alg

export const LABEL_TEXT: Record<TrustLabel, string> = {
  'verified-human': 'Verified human',
  'device-verified': 'Device verified',
  'camera-verified': 'Camera verified',
  unknown: 'Unknown origin',
}

export type StepTone = 'ok' | 'fail' | 'warn' | 'info'
export interface StepPart { alg: string; ok: boolean; broken: boolean }
export interface CaptureStep {
  key: string
  tone: StepTone
  text: string
  /** Right-hand detail: a time, a hash prefix, an algorithm. */
  detail?: string
  parts?: StepPart[]
}

const clock = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour12: false })
}

/**
 * When the log entry was written, read against when the photo was received: a live capture is logged
 * moments later, so that reads as "+40 ms". Anything else (an imported or backdated item) shows its
 * own clock time, so the two lines never contradict each other.
 */
export function loggedAfter(received: string, logged: string): string {
  const ms = Date.parse(logged) - Date.parse(received)
  if (!Number.isFinite(ms) || ms < 0 || ms >= 60_000) return clock(logged)
  return ms < 1000 ? `+${Math.max(1, Math.round(ms))} ms` : `+${(ms / 1000).toFixed(1)} s`
}

const partsOf = (parts: SealCheck[] | undefined): StepPart[] | undefined =>
  parts?.length ? parts.map(p => ({ alg: short(p.alg), ok: p.valid && p.counted, broken: p.brokenSinceQDay })) : undefined

/** A failed check that the verifier marked non-fatal (the photo can still be green) reads as a warning. */
function tone(c: Check, v: VerificationResult): StepTone {
  if (c.pass) return 'ok'
  return c.brokenSinceQDay && v.status !== 'grey' ? 'warn' : 'fail'
}

function stepFor(c: Check, item: ItemSummary, i: number): CaptureStep {
  const v = item.verification
  const t = tone(c, v)
  // Only the capture signature shows its algorithm halves; repeating them on every hybrid check is noise.
  const base = { key: `${i}:${c.name}`, tone: t, parts: c.name === 'Capture signature' || c.name === 'Camera signature' ? partsOf(c.parts) : undefined }
  switch (c.name) {
    case 'Content hash':
      return { ...base, text: c.pass ? 'Content hash matches' : 'Pixels changed after signing', detail: item.contentHash.slice(0, 12) }
    case 'Device certificate':
      return { ...base, text: c.pass ? 'Device certificate' : 'Device certificate fails' }
    case 'Device match':
      return { ...base, text: 'Certificate names another device' }
    case 'Capture signature':
      return { ...base, text: c.pass ? 'Capture signature' : 'Capture signature fails' }
    case 'Person approved capture':
      return {
        ...base,
        text: c.pass ? 'Face ID approved' : c.brokenSinceQDay ? 'Face ID · broken since Post-Quantum Day' : 'Face ID not proven',
        detail: short(c.alg ?? 'es256'),
      }
    case 'Verified human':
      return { ...base, text: c.pass ? 'Verified human' : 'Personhood not proven' }
    case 'Trusted camera':
      return { ...base, text: c.pass ? 'Camera on the trust list' : 'Camera not trusted' }
    case 'Camera signature':
      return {
        ...base,
        text: c.pass ? 'Camera signature' : c.brokenSinceQDay ? 'Camera signature · broken since Post-Quantum Day' : 'Camera signature fails',
        detail: c.alg ? short(c.alg) : undefined,
      }
    case 'Logged': {
      const e = item.logEntry
      if (c.pass && e) return { ...base, text: `Logged · entry ${e.seq}`, detail: `${loggedAfter(item.createdAt, e.timestamp)} · ${short('ml-dsa-65')}` }
      return { ...base, text: 'Not in the log' }
    }
    case 'Provenance':
      return { ...base, text: 'No provenance attached' }
    default:
      if (c.name.startsWith('Edit ')) return { ...base, text: c.name.replace(/^Edit (\d+): /, 'Edit $1 · ') }
      return { ...base, text: c.name }
  }
}

export function verdictText(v: VerificationResult): string {
  if (v.status === 'amber') return `${LABEL_TEXT[v.label]} · edited`
  return LABEL_TEXT[v.label]
}

/** Received → one step per verifier check → the verdict. */
export function captureSteps(item: ItemSummary): CaptureStep[] {
  const v = item.verification
  const steps: CaptureStep[] = [{ key: 'received', tone: 'info', text: 'Received', detail: clock(item.createdAt) }]
  v.checks.forEach((c, i) => steps.push(stepFor(c, item, i)))
  steps.push({ key: 'verdict', tone: v.status === 'grey' ? 'fail' : 'ok', text: verdictText(v) })
  return steps
}

/** The phone's own steps, shown live while the photo is taken and sealed, before it arrives. */
export function phoneSteps(p: { steps: { step: string; at: string; detail?: string }[] }): CaptureStep[] {
  const hybrid: StepPart[] = [{ alg: 'Ed25519', ok: true, broken: false }, { alg: 'ML-DSA-65', ok: true, broken: false }]
  const out: CaptureStep[] = []
  for (const s of p.steps) {
    const key = `ph-${s.step}`
    if (s.step === 'taken') out.push({ key, tone: 'info', text: 'Photo taken', detail: clock(s.at) })
    else if (s.step === 'hashed') out.push({ key, tone: 'ok', text: 'Exact bytes hashed', detail: s.detail ? `${s.detail}…` : 'SHA-256' })
    else if (s.step === 'signed') out.push({ key, tone: 'ok', text: 'Signed on the phone', parts: hybrid })
    else if (s.step === 'faceid') out.push({ key, tone: 'ok', text: 'Face ID: a person approved it' })
    else if (s.step === 'sending') out.push({ key, tone: 'info', text: 'Sending' })
    else if (s.step === 'logged') out.push({ key, tone: 'ok', text: 'Received and logged', detail: s.detail })
    else if (s.step === 'stopped') out.push({ key, tone: 'warn', text: 'Stopped on the phone' })
  }
  return out
}

// ── story cards: everything follows where the camera is, nothing follows the clock ──

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }

export interface CardLook {
  /** Words: fully there from strength ~0.42, so the line is legible well before the middle of the zone. */
  text: number
  /** The blurred veil behind the words. */
  veil: number
  /** How far the words have decoded out of glyphs (1 = clean). */
  decode: number
  /** Drift with travel, in px: below on the way in, above on the way out. */
  rise: number
  scale: number
}

/** A card's look from where the camera is: `strength` 0..1 through its zone, `progress` 0 entering → 1 leaving. */
export function cardLook(strength: number, progress = 0.5): CardLook {
  const s = clamp01(strength), p = clamp01(progress)
  return {
    text: smooth(0.04, 0.42, s),
    veil: smooth(0, 0.36, s),
    decode: smooth(0.1, 0.5, s),
    rise: (0.5 - p) * 32,
    scale: 0.975 + 0.05 * p,
  }
}

/** Whether a card is on stage at all (the verdict waits for it to clear). */
export const cardShowing = (strength: number | undefined) => cardLook(strength ?? 0).text > 0.001

/** The scene's ASCII, plus a few of its neighbours. */
export const SCRAMBLE_GLYPHS = '0123456789ABCDEF{}[]<>/\\*+=~?!@#$%&'

export interface ScrambleChar {
  ch: string
  /** What sits in the letter's place: the letter, a stand-in glyph, or nothing yet. */
  show: 'letter' | 'glyph' | 'none'
  glyph: string
  /** How strongly the glyph shows (0..1). */
  alpha: number
}

const hash = (n: number) => {
  let x = (n | 0) ^ 0x9e3779b9
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

/**
 * The words decoding out of glyphs. Each letter has its own moment (mostly left to right, a little
 * shuffled); before it, it is a faint glyph that firms up as its moment nears. `step` picks which glyph,
 * so the glyphs only change when the camera moves. At decode 1 every letter is itself.
 * `offset` keeps a second line's letters distinct from the first's.
 */
export function scramble(text: string, decode: number, step: number, offset = 0, length = text.length): ScrambleChar[] {
  const d = clamp01(decode)
  const chars = Array.from(text)
  return chars.map((ch, i) => {
    if (ch === ' ' || d >= 1) return { ch, show: 'letter', glyph: '', alpha: 0 }
    const k = offset + i
    const order = 0.6 * (k / Math.max(1, length)) + 0.38 * hash(k * 2654435761)
    if (d >= order) return { ch, show: 'letter', glyph: '', alpha: 0 }
    const near = clamp01((d - (order - 0.42)) / 0.42)
    if (near <= 0) return { ch, show: 'none', glyph: '', alpha: 0 }
    const glyph = SCRAMBLE_GLYPHS[Math.floor(hash(k * 7919 + step * 104729) * SCRAMBLE_GLYPHS.length)]
    return { ch, show: 'glyph', glyph, alpha: 0.18 + 0.62 * near }
  })
}

// ── the forge verdict gate ──

export interface VerdictGateState<R> { result: R | null; sawDown: boolean; open: boolean }
export const closedGate = <R,>(result: R | null = null): VerdictGateState<R> => ({ result, sawDown: false, open: false })

/**
 * One step of the verdict gate. The verdict may come up only once THIS result's forgery has landed:
 * after the result arrives, `landed` must be seen false and then true (a stale true left over from an
 * earlier forgery doesn't count). `landed === undefined` means an older scene that never reports it;
 * then the gate stays shut here and the caller opens it on a timer. Returns `g` itself when nothing changed.
 */
export function stepVerdictGate<R>(g: VerdictGateState<R>, result: R | null, landed: boolean | undefined): VerdictGateState<R> {
  if (g.result !== result) g = closedGate(result)
  if (!result || g.open || landed === undefined) return g
  if (!landed) return g.sawDown ? g : { ...g, sawDown: true }
  return g.sawDown ? { ...g, open: true } : g
}

// ── what stays on stage: the presenter puts each panel away; nothing goes by the clock ──

export type Panel = 'log' | 'readout' | 'verdict'

/**
 * The capture log (keyed by its arrival) and the forge run's readout and verdict (keyed by the run).
 * Each stays open until it is put away; a new arrival or a new run opens its panels again.
 */
export interface PanelsState<L, R> {
  log: L | null
  run: R | null
  logClosed: boolean
  readoutClosed: boolean
  verdictClosed: boolean
}
export const noPanels = <L, R>(): PanelsState<L, R> =>
  ({ log: null, run: null, logClosed: false, readoutClosed: false, verdictClosed: false })

/** Follow what is on stage. A new arrival reopens the log; a new run reopens its readout and verdict. Returns `s` when nothing changed. */
export function syncPanels<L, R>(s: PanelsState<L, R>, log: L | null, run: R | null): PanelsState<L, R> {
  if (s.log !== log) s = { ...s, log, logClosed: false }
  if (s.run !== run) s = { ...s, run, readoutClosed: false, verdictClosed: false }
  return s
}

/** Put one panel away (a click on it), or every one (Esc). Returns `s` when nothing changed. */
export function closePanels<L, R>(s: PanelsState<L, R>, which: Panel | 'all'): PanelsState<L, R> {
  const log = which === 'all' || which === 'log'
  const readout = which === 'all' || which === 'readout'
  const verdict = which === 'all' || which === 'verdict'
  if ((!log || s.logClosed) && (!readout || s.readoutClosed) && (!verdict || s.verdictClosed)) return s
  return {
    ...s,
    logClosed: s.logClosed || log,
    readoutClosed: s.readoutClosed || readout,
    verdictClosed: s.verdictClosed || verdict,
  }
}

/** Which panels are up. `verdictReady`: the forgery has landed (the verdict gate is open). */
export function panelsUp<L, R>(s: PanelsState<L, R>, verdictReady: boolean): Record<Panel, boolean> {
  return {
    log: s.log !== null && !s.logClosed,
    readout: s.run !== null && !s.readoutClosed,
    verdict: s.run !== null && verdictReady && !s.verdictClosed,
  }
}

/** After the forge is put away, B does nothing for this long (a double tap can't start a second break). */
export const B_QUIET_MS = 2000

export interface BreakKeyInput {
  /** A key break is still running. */
  running: boolean
  /** A run (finished or failed) is on stage. */
  hasRun: boolean
  /** Its result is in but the forgery hasn't landed yet, so the verdict is still to come. */
  settling: boolean
  /** The verdict is up (not put away; a story card passing over it still counts). */
  verdictUp: boolean
  qday: boolean
  /** ms since the forge was last put away. */
  sinceDismiss: number
}

/**
 * What B does. Mid-run, nothing. With the verdict up, B puts the run away. Otherwise, after Post-Quantum
 * Day and outside the quiet spell, it starts a new run, which replaces the readout left on stage.
 */
export function breakKeyAction(i: BreakKeyInput): 'none' | 'dismiss' | 'start' {
  if (i.running || i.settling) return 'none'
  if (i.verdictUp) return 'dismiss'
  if (!i.qday) return i.hasRun ? 'dismiss' : 'none'
  return i.sinceDismiss < B_QUIET_MS ? 'none' : 'start'
}
