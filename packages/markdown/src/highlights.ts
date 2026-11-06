export interface HighlightColour {
  emoji: string | null
  tone: number | null
  className: string
  name: string
}

const PLAIN: HighlightColour = { emoji: null, tone: null, className: '', name: 'No colour' }

export const HIGHLIGHT_COLOURS: readonly HighlightColour[] = [
  PLAIN,
  { emoji: '🔴', tone: 1, className: 'tone-1', name: 'Red' },
  { emoji: '🟠', tone: 2, className: 'tone-2', name: 'Orange' },
  { emoji: '🟢', tone: 4, className: 'tone-4', name: 'Green' },
  { emoji: '🔵', tone: 5, className: 'tone-5', name: 'Blue' },
  { emoji: '🟣', tone: 6, className: 'tone-6', name: 'Violet' },
]

export function readHighlight(inner: string): { colour: HighlightColour; from: number } {
  for (const colour of HIGHLIGHT_COLOURS) {
    if (colour.emoji === null || !inner.startsWith(colour.emoji)) continue

    const after = colour.emoji.length
    const from = inner[after] === ' ' ? after + 1 : after
    if (from >= inner.length) break

    return { colour, from }
  }

  return { colour: PLAIN, from: 0 }
}

export function highlightTone(tone: number | null): HighlightColour {
  return HIGHLIGHT_COLOURS.find((one) => one.tone === tone) ?? PLAIN
}

export function writeHighlight(words: string, colour: HighlightColour): string {
  return colour.emoji === null ? words : `${colour.emoji} ${words}`
}
