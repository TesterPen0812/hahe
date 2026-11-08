// Which photos hang on the walk. Pure: the page describes the feed, these choose from it.
// Real photographs come first: a phone's captures (device id `device-…`), then any other JPEG in the
// feed, which is what scripts/seed-real.ts puts there. The drawn seed scenes are PNGs, and only fill in.
import type { GalleryPhoto } from './gallery'

export type SealStatus = 'green' | 'amber' | 'grey'
export interface FeedPhoto extends GalleryPhoto {
  /** The verdict today. */
  status: SealStatus
  /** The verdict after Post-Quantum Day. */
  after: SealStatus
  /** Taken with the app on a phone. */
  phone: boolean
  /** A photograph rather than a drawn seed scene. */
  real: boolean
}

export const TODAY_MAX = 4
export const AFTER_MAX = 5
/** With this many real photographs, none of the drawn ones hang beside them. */
const ENOUGH_REAL = 3

/** Old-camera and hybrid photos in turn, so a run of one kind doesn't take every place. */
function alternate(photos: FeedPhoto[]) {
  const legacy = photos.filter(p => p.kind === 'legacy'), hybrid = photos.filter(p => p.kind === 'hybrid')
  const out: FeedPhoto[] = []
  for (let i = 0; i < Math.max(legacy.length, hybrid.length); i++) {
    if (legacy[i]) out.push(legacy[i])
    if (hybrid[i]) out.push(hybrid[i])
  }
  return out
}

/** The Today gallery: everything there is sealed, real photographs first. The feed is newest first. */
export function todayPicks(feed: readonly FeedPhoto[], max = TODAY_MAX): FeedPhoto[] {
  const green = feed.filter(p => p.status === 'green')
  const real = [...green.filter(p => p.phone), ...alternate(green.filter(p => p.real && !p.phone))]
  const drawn = alternate(green.filter(p => !p.real))
  return (real.length >= ENOUGH_REAL ? real : [...real, ...drawn]).slice(0, max)
}

/** First of the photos that best tell this part of the story: real ones, then ones the day changes. */
const best = (photos: FeedPhoto[]) => [...photos].sort((a, b) =>
  Number(b.real) - Number(a.real) || Number(b.status !== b.after) - Number(a.status !== a.after))[0]

/**
 * The post-quantum world's prints, in walking order: the newest phone photos, then one the signed log
 * still partly vouches for (amber), then one that doesn't survive (grey). Amber and grey keep their
 * places however many phone photos arrive, so a new one replaces an older one once it's full.
 */
export function afterPicks(feed: readonly FeedPhoto[], live: readonly GalleryPhoto[], max = AFTER_MAX): GalleryPhoto[] {
  // A grey photo with no seal at all says nothing about Post-Quantum Day, so one that had a seal goes first.
  const greys = feed.filter(p => p.after === 'grey')
  const sealed = greys.filter(p => p.status === 'green')
  const amber = best(feed.filter(p => p.after === 'amber'))
  const grey = best(sealed.length ? sealed : greys)
  const ending = [amber, grey].filter((p): p is FeedPhoto => !!p).slice(0, max)
  const taken = new Set(ending.map(p => p.id))
  const room = max - ending.length
  const opening: GalleryPhoto[] = []
  const add = (p: GalleryPhoto) => {
    if (opening.length >= room || taken.has(p.id)) return
    taken.add(p.id)
    opening.push(p)
  }
  live.forEach(add)
  const green = feed.filter(p => p.after === 'green')
  green.filter(p => p.phone).forEach(add)
  green.filter(p => p.real).forEach(add)
  alternate(green).forEach(add)
  return [...opening, ...ending]
}
