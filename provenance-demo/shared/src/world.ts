// The demo's world switch: "today" vs "Q-Day" (a quantum computer has broken
// RSA and elliptic-curve signatures). ML-DSA-65 and SHA-256 are not broken.
import type { Alg, WorldMode, WorldState } from './manifest.js';

/** What a large quantum computer breaks: everything built on factoring or discrete logs. */
export const QUANTUM_BROKEN_ALGS: readonly Alg[] = ['rsa-pss-2048', 'ed25519', 'es256'];

export const DEFAULT_Q_DAY_HEADLINE_YEAR = 2035;

export function brokenAlgorithmsFor(mode: WorldMode): Alg[] {
  return mode === 'q-day' ? [...QUANTUM_BROKEN_ALGS] : [];
}

export function makeWorld(mode: WorldMode, qDayAt: string | null, headlineYear: number): WorldState {
  return { mode, qDayAt: mode === 'q-day' ? qDayAt : null, brokenAlgorithms: brokenAlgorithmsFor(mode), headlineYear };
}

/** The real world right now: nothing broken. */
export const todayWorld = (year = new Date().getUTCFullYear()): WorldState => makeWorld('today', null, year);

export const isBroken = (world: WorldState, alg: Alg): boolean => world.brokenAlgorithms.includes(alg);
