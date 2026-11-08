// Seams between the three walk-v2 workstreams. Change only by agreement, and say so in the report.
//
//  scene   (branch v2-scene):  engine.ts, worlds.ts, scenery.ts, greenWorld/prismWorld/scenePath(+Motion),
//                              shaders.ts, particles/fluid/curl/cave/input. Builds the walk:
//                              green Foliage tunnel → door 1 → blue world (today) → door 2 "Q-Day · 2035"
//                              (replaces the bead curtain; crossing it flips /api/world) → Prism meadow.
//  screen  (branch v2-screen): UniversePage.tsx, universe.css, LivePanel.tsx, fonts, new overlay components
//                              (cards, capture log panel, door colour picker, forge readout), gesture UI chrome.
//  photos  (branch v2-photos): gallery.ts, liveFrame.ts, liveSequence.ts and new photo/seal modules.
//                              How photos and seals look in 3D, the live frames, and the rejected forgery.
import type * as THREE from 'three'
import type { CardLook } from './cardLight'

export type RGB = [number, number, number]

/** Which world the camera is in. */
/** The walk's worlds by role: the entrance (the Prism), today (the blue world), and Post-Quantum Day
 *  (the green tunnel). 'tunnel' is the old name of the entrance, kept so older screens still type-check. */
export type Region = 'entrance' | 'tunnel' | 'today' | 'qday'

/** The two doors on the walk. door2 is the Q-Day door, labelled "Q-Day · 2035". */
export type DoorId = 'door1' | 'door2'
export type DoorTints = Record<DoorId, RGB>

/** Story cards. The scene decides WHERE (slow zones on the path); the screen decides the words and the look. */
export type CardId = 'today' | 'qday' | 'break'
/** strength 0..1 rises as the camera enters the card's zone and falls as it leaves; it drives text + blur. */
export interface CardState {
  id: CardId
  strength: number
  /** Where the camera is through the card's words: 0 coming, 0.5 at the stop, 1 leaving. Position alone,
   *  so scrolling fast through a card moves the text and the slowness together. */
  progress?: number
  /** How fast the walk is going (0 a walk, 1 fast): the arrival's glitch shortens with it. */
  pace?: number
}

/** Emitted by the engine as `EngineState.walk`. */
export interface WalkState {
  region: Region
  card: CardState | null
  /** Index of the live photo the camera is stopped at in the Prism meadow, or null. */
  liveIndex: number | null
  /** The forgery's frame has flown in and landed in the Prism (the screen waits for it before its verdict). */
  forgeryLanded?: boolean
  /** The ending: darkness on its way (either direction), or fully black. */
  ending?: 'none' | 'fading' | 'black'
  /** How far each closing line has come in on the black (0..1). */
  closing?: [number, number]
}

/** Engine methods the screen calls (scene implements them on UniverseEngine). */
export interface WalkControls {
  setDoorTint(door: DoorId, rgb: RGB): void
  doorTints(): DoorTints
  /** The toy-RSA fake has been uploaded and judged; show it next to the live photos. */
  showForgery(f: ForgeryArrival): void
  /** B was pressed: glide to the break stop, where the forgery will hang, unless already there. */
  goToBreak?(): void
}

// ---- photos → scene: the live photos in the Prism meadow ----

export type ArrivalStatus = 'green' | 'amber' | 'grey'
/** One seal on a photo, as the server judged it in the current world. */
export interface SealPart {
  alg: 'rsa-pss-2048' | 'rsa-toy-96' | 'ed25519' | 'ml-dsa-65' | 'es256'
  state: 'holds' | 'broken' | 'anchored' | 'missing'
}
export interface LiveArrival {
  id: string
  url: string
  status: ArrivalStatus
  label: string          // e.g. 'verified-human', 'device-verified', 'camera-verified', 'unknown'
  parts: SealPart[]
}
/** The forged photo: its RSA signature is genuinely valid (ring intact), ML-DSA is missing, ours rejects it. */
export interface ForgeryArrival extends LiveArrival { naiveStatus: ArrivalStatus }

/** Where the sequence hangs: a path the scene owns, sampled by distance. */
export interface LivePath {
  at(distance: number): { position: THREE.Vector3; tangent: THREE.Vector3 }
  ground(x: number, z: number): number
}
export interface LiveSequenceOptions {
  path: LivePath
  /** Path distance of the first frame. */
  start: number
  /** Path distance between frames. */
  spacing: number
  /** Address shown in the waiting frame. */
  host: string
  onLand?: (index: number, a: LiveArrival) => void
  /** The world the frames stand in: its light, fog and particles. */
  look?: CardLook
  /** Frame width (2.5 by default), how far a frame steps aside as the visitor reaches it (its centre's
   *  offset from the path), and the ground-to-label gap. */
  cardWidth?: number
  aside?: number
  lift?: number
  /** The forgery's frame, relative to a photo's: larger, so it reads from the break stop. */
  forgeryScale?: number
  /** Show the empty waiting frame (default). The forgery's own sequence has none. */
  waiting?: boolean
  /** Where earlier photos stand once a newer one (or the visitor) has moved them on, most recent first. */
  sideSlots?: SideSlot[]
}
/** A place at the side of the path: `at` along it, on one side, `off` from the centre line. */
export interface SideSlot { at: number; side: 1 | -1; off?: number }
export interface LiveSequence {
  readonly group: THREE.Group
  /** A new phone photo: it takes the next free frame (the waiting frame moves one along). */
  arrive(a: LiveArrival): void
  showForgery(f: ForgeryArrival): void
  /** Path distances where each frame (photos, the forgery, then the waiting frame) is best viewed.
   *  The scene makes each one a slow zone and a walk stop. */
  stations(): number[]
  update(t: number, camera: THREE.Camera): void
  reset(): void
  dispose(): void
}
