import type { CSSProperties } from 'react'
import { DEFAULT_Q_DAY_HEADLINE_YEAR } from '@provenance-demo/shared'
import type { CardId, CardState } from './contract'
import { cardLook, scramble } from './stageData'

// The words are the screen's; where they appear is the scene's. Nothing here keeps time: `strength`
// (how deep the camera is in the card's slow zone) sets how much of the card is there, and `progress`
// (entering → leaving) carries the words along with the walk. Scroll fast and the words pass fast.
const CARDS: Record<CardId, { title: string; line?: string }> = {
  today: { title: 'Today.', line: 'Every seal checks out.' },
  qday: { title: `Post-Quantum Day · ${DEFAULT_Q_DAY_HEADLINE_YEAR}` },
  break: { title: 'Watch a key break.' },
  end: { title: 'We don’t detect fakes.', line: 'We prove what’s real.' },
}

/**
 * Letters resolving out of glyphs. Each letter keeps its own width (the real letter is always laid out,
 * only hidden while a glyph stands in its place), so the line never reflows while it decodes.
 * Fully decoded it is plain text.
 */
function Decode({ text, decode, step, offset, length }: { text: string; decode: number; step: number; offset: number; length: number }) {
  if (decode >= 1) return <>{text}</>
  const chars = scramble(text, decode, step, offset, length)
  return <>{chars.map((c, i) => c.show === 'letter' ? c.ch : (
    <span key={i} className="ch">
      <span className="ch-l">{c.ch}</span>
      {c.show === 'glyph' && <span className="ch-g" style={{ opacity: c.alpha }}>{c.glyph}</span>}
    </span>
  ))}</>
}

/** "Post-Quantum Day · 2035": each side of the dot stays whole; on a phone the dot becomes the line break.
 *  Words never break inside, even while they are glyphs. */
function Title({ text, base = 0, ...d }: { text: string; base?: number; decode: number; step: number; length: number }) {
  // Each word's letters keep their place in the whole line (so their moments and glyphs don't repeat).
  const words = (s: string, from: number) => {
    const ws = s.split(' ')
    const starts = ws.map((_, i) => from + ws.slice(0, i).reduce((n, w) => n + w.length + 1, 0))
    return ws.map((w, i) => (
      <span key={i}>{i > 0 && ' '}<span className="nw"><Decode text={w} offset={starts[i]} {...d} /></span></span>
    ))
  }
  const parts = text.split(' · ')
  if (parts.length < 2) return <>{words(text, base)}</>
  const starts = parts.map((_, i) => base + parts.slice(0, i).reduce((n, p) => n + p.length + 3, 0))
  return <>{parts.map((p, i) => (
    <span key={i}>
      {i > 0 && <span className="sep"> <Decode text="·" offset={starts[i] - 2} {...d} /> </span>}
      <span className="nw">{words(p, starts[i])}</span>
    </span>
  ))}</>
}

export function StoryCard({ card }: { card: CardState | null }) {
  if (!card) return null
  const c = CARDS[card.id]
  const look = cardLook(card.strength, card.progress)
  if (!c || look.text <= 0.001) return null
  // Which glyphs stand in is picked by position too, so they only flicker while the camera moves.
  const step = Math.floor(card.strength * 22 + (card.progress ?? 0.5) * 14)
  const length = c.title.length + (c.line?.length ?? 0) + 6
  const style = {
    '--card-text': look.text.toFixed(3),
    '--card-veil': look.veil.toFixed(3),
    '--card-rise': `${look.rise.toFixed(2)}px`,
    '--card-scale': look.scale.toFixed(4),
    '--card-glitch': (1 - look.decode).toFixed(3),
  } as CSSProperties
  return (
    <div className={`uv-card uv-card-${card.id} ${look.text > 0.5 ? 'in' : ''}`} style={style}>
      <div className="uv-card-veil" aria-hidden />
      <div className="uv-card-text">
        <span className="uv-sr">{c.line ? `${c.title} ${c.line}` : c.title}</span>
        <h2 aria-hidden><Title text={c.title} decode={look.decode} step={step} length={length} /></h2>
        {c.line && <p aria-hidden><Title text={c.line} base={c.title.length + 3} decode={look.decode} step={step} length={length} /></p>}
      </div>
    </div>
  )
}
