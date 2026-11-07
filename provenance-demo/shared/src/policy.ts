// The Q-Day rule, in one place:
//   A signature made with a broken algorithm only counts if the item's log entry
//   is older than world.qDayAt ("anchored"). For hybrid signatures, every unbroken
//   part must be valid; broken parts are ignored unless anchored.
// Naive mode ignores the world entirely and trusts any valid signature.
import { ALG_NAMES, type Alg, type LogEntry, type SealCheck, type WorldState } from './manifest.js';
import { describeHybrid, type HybridResult } from './hybrid.js';
import { todayWorld } from './world.js';

export interface VerifyOptions { naive?: boolean }

export interface Policy {
  world: WorldState;
  naive: boolean;
  anchored: boolean;               // q-day, and the (already validated) log entry predates qDayAt
  counts(alg: Alg): boolean;       // does a signature with this algorithm count?
  brokenNow(alg: Alg): boolean;    // broken in this world (ignores anchoring and naive)
}

/** `entry` must already be checked to belong to this manifest (logEntryMatches). */
export function makePolicy(world: WorldState, entry: LogEntry | null, naive = false): Policy {
  const qDay = world.mode === 'q-day' && world.qDayAt ? Date.parse(world.qDayAt) : NaN;
  const logged = entry ? Date.parse(entry.timestamp) : NaN;
  const anchored = !naive && Number.isFinite(qDay) && Number.isFinite(logged) && logged < qDay;
  const brokenNow = (alg: Alg) => world.brokenAlgorithms.includes(alg);
  return { world, naive, anchored, brokenNow, counts: (alg) => naive || anchored || !brokenNow(alg) };
}

/** Strict "today" policy: every algorithm counts. Default for standalone credential checks. */
export const strictPolicy = (): Policy => makePolicy(todayWorld(), null, false);

const names = (algs: Alg[]) => algs.map((a) => ALG_NAMES[a]).join(' + ');

export interface HybridCheck { pass: boolean; reason: string; parts: SealCheck[]; brokenSinceQDay: boolean }

/**
 * Judge a hybrid signature result under a policy.
 *  okText:   what it proves, e.g. "Capture claim is signed by the certified device"
 *  failText: what failed,    e.g. "Capture signature"
 */
export function judgeHybrid(r: HybridResult, policy: Policy, okText: string, failText: string): HybridCheck {
  const parts: SealCheck[] = r.parts.map((p) => {
    const counted = policy.counts(p.alg);
    return { alg: p.alg, valid: p.valid, counted, brokenSinceQDay: !counted };
  });
  const brokenSinceQDay = parts.some((p) => p.brokenSinceQDay);
  const structural = r.unexpected.length === 0 && r.parts.every((p) => p.problem !== 'missing' && p.problem !== 'duplicate');
  const counted = parts.filter((p) => p.counted);
  const ignored = parts.filter((p) => !p.counted).map((p) => p.alg);
  const pass = structural && counted.length > 0 && counted.every((p) => p.valid);

  if (!structural) return { pass, parts, brokenSinceQDay, reason: `${failText} is malformed (${describeHybrid(r)}).` };
  if (!pass) {
    const pqBad = parts.some((p) => p.alg === 'ml-dsa-65' && !p.valid);
    const classicalNote = ignored.length
      ? ` Its ${names(ignored)} part doesn't count: forgeable since Q-Day.`
      : '';
    return {
      pass, parts, brokenSinceQDay,
      reason: pqBad
        ? `${failText}: post-quantum signature invalid (${describeHybrid(r)}).${classicalNote}`
        : `${failText} is invalid (${describeHybrid(r)}).`,
    };
  }
  if (ignored.length) {
    return { pass, parts, brokenSinceQDay, reason: `${okText}. Post-quantum ML-DSA-65 holds; ${names(ignored)} ignored (forgeable since Q-Day).` };
  }
  const anchoredNote = policy.anchored && parts.some((p) => policy.brokenNow(p.alg)) ? ', anchored in the log before Q-Day' : '';
  return { pass, parts, brokenSinceQDay, reason: `${okText} (${names(parts.map((p) => p.alg))})${anchoredNote}.` };
}
