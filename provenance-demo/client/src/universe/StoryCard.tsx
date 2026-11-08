import { useEffect, useState, type CSSProperties } from 'react'
import { DEFAULT_Q_DAY_HEADLINE_YEAR } from '@provenance-demo/shared'
import type { CardId, CardState } from './contract'

// The words are the screen's; where they appear (and how strongly) is the scene's: `strength` rises as
// the walk slows into a card's zone and falls as it leaves, so the text and the blur breathe with it.
const CARDS: Record<CardId, { title: string; line?: string }> = {
  today: { title: 'Today.', line: 'Every seal checks out.' },
  qday: { title: `Q-Day · ${DEFAULT_Q_DAY_HEADLINE_YEAR}`, line: 'A new world. The old locks open.' },
  break: { title: 'Watch a key break.' },
  end: { title: 'We don’t detect fakes.', line: 'We prove what’s real.' },
}

/** About as long as it takes to read the words, then the card lets the world back in. */
const readMs = (c: { title: string; line?: string }) =>
  Math.min(4200, Math.max(2400, 1500 + (c.title.length + (c.line?.length ?? 0)) * 55))

export function StoryCard({ card }: { card: CardState | null }) {
  const s = Math.max(0, Math.min(1, card?.strength ?? 0))
  const id = card && s >= 0.002 ? card.id : null
  const full = !!id && s > 0.9
  // Once a card has been up long enough to read, it fades even if the walk is still standing in its
  // zone (the Q-Day hold keeps the world frozen, not the words). Leaving the zone resets it.
  const [read, setRead] = useState<CardId | null>(null)
  useEffect(() => {
    if (!id) { const t = setTimeout(() => setRead(null), 0); return () => clearTimeout(t) }
    if (!full || read === id) return
    const t = setTimeout(() => setRead(id), readMs(CARDS[id]))
    return () => clearTimeout(t)
  }, [id, full, read])
  if (!card || !id) return null
  const c = CARDS[card.id]
  if (!c) return null
  return (
    <div className={`uv-card uv-card-${card.id} ${read === id ? 'read' : ''}`} style={{ '--s': s } as CSSProperties} aria-live="polite">
      <div className="uv-card-veil" aria-hidden />
      <div className="uv-card-text">
        <h2>{c.title}</h2>
        {c.line && <p>{c.line}</p>}
      </div>
    </div>
  )
}
