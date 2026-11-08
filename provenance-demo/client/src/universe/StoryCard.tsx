import { useEffect, useState } from 'react'
import { DEFAULT_Q_DAY_HEADLINE_YEAR } from '@provenance-demo/shared'
import type { CardId, CardState } from './contract'

// The words are the screen's; where they appear is the scene's: `strength` rises as the walk slows
// into a card's zone. A card comes in quickly, holds for a fixed beat, and goes, even if the walk is
// still standing in its zone. Leaving the zone re-arms it.
const CARDS: Record<CardId, { title: string; line?: string }> = {
  today: { title: 'Today.', line: 'Every seal checks out.' },
  qday: { title: `Post-Quantum Day · ${DEFAULT_Q_DAY_HEADLINE_YEAR}` },
  break: { title: 'Watch a key break.' },
  end: { title: 'We don’t detect fakes.', line: 'We prove what’s real.' },
}

const CARD_IN_MS = 400
const CARD_HOLD_MS = 2500
const CARD_OUT_MS = 600
/** The card fires once the walk is this far into its zone… */
const ENTER = 0.5
/** …and is re-armed once the walk has left it (below this). */
const LEAVE = 0.15

type Phase = 'in' | 'out'

/** "Post-Quantum Day · 2035": each side of the dot stays whole; on a phone the dot becomes the line break. */
function Title({ text }: { text: string }) {
  const parts = text.split(' · ')
  if (parts.length < 2) return <>{text}</>
  return <>{parts.map((p, i) => (
    <span key={i}>{i > 0 && <span className="sep"> · </span>}<span className="nw">{p}</span></span>
  ))}</>
}

export function StoryCard({ card }: { card: CardState | null }) {
  const s = card?.strength ?? 0
  const entered = card && s >= ENTER ? card.id : null
  const inZone = card && s >= LEAVE ? card.id : null
  const [shown, setShown] = useState<{ id: CardId; phase: Phase } | null>(null)
  // The card that has fired and must not fire again until the walk leaves its zone.
  const [spent, setSpent] = useState<CardId | null>(null)

  // Derived from the walk during render (no effect round trip): fire on entry, re-arm on leaving.
  if (spent && inZone !== spent) {
    setSpent(null)
    if (shown?.id === spent && shown.phase === 'in') setShown({ id: spent, phase: 'out' })
  } else if (!shown && entered && entered !== spent) {
    setSpent(entered)
    setShown({ id: entered, phase: 'in' })
  }

  useEffect(() => {
    if (!shown) return
    const t = shown.phase === 'in'
      ? setTimeout(() => setShown(c => (c?.phase === 'in' ? { ...c, phase: 'out' } : c)), CARD_IN_MS + CARD_HOLD_MS)
      : setTimeout(() => setShown(null), CARD_OUT_MS)
    return () => clearTimeout(t)
  }, [shown])

  if (!shown) return null
  const c = CARDS[shown.id]
  if (!c) return null
  return (
    <div className={`uv-card uv-card-${shown.id} ${shown.phase}`} aria-live="polite">
      <div className="uv-card-veil" aria-hidden />
      <div className="uv-card-text">
        <h2><Title text={c.title} /></h2>
        {c.line && <p>{c.line}</p>}
      </div>
    </div>
  )
}
