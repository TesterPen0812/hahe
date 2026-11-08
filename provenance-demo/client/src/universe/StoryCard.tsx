import type { CSSProperties } from 'react'
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

export function StoryCard({ card }: { card: CardState | null }) {
  const s = Math.max(0, Math.min(1, card?.strength ?? 0))
  if (!card || s < 0.002) return null
  const c = CARDS[card.id]
  if (!c) return null
  return (
    <div className={`uv-card uv-card-${card.id}`} style={{ '--s': s } as CSSProperties} aria-live="polite">
      <div className="uv-card-veil" aria-hidden />
      <div className="uv-card-text">
        <h2>{c.title}</h2>
        {c.line && <p>{c.line}</p>}
      </div>
    </div>
  )
}
