/** What colour a `==highlight==` is, and how the file says so.
 *
 *  Obsidian 1.14.0 (2026-09-02) added coloured highlights and encodes the colour
 *  in the markdown itself: "Add a color emoji (🔴, 🟠, 🟢, 🔵, 🟣) to the start of
 *  a highlight to change its color, or pick a color from the new formatting
 *  submenu." So that is exactly what nib writes - a note coloured here opens
 *  coloured there, and one coloured there opens coloured here. Nothing else would
 *  do: a `<mark class="…">` or an attribute of our own would be a syntax nib
 *  invented, and Obsidian would read it as words.
 *
 *  Five colours, because five is what the emoji say. A highlight with no emoji is
 *  the sixth answer and the one every note written before this carries, so it is
 *  drawn exactly as it always was. Obsidian has no yellow emoji for the same
 *  reason: a plain highlight is already its yellow.
 *
 *  A module of its own, next door to links.ts and for the same reason: the editor
 *  needs the grammar - to colour what is being typed, to hide the mark, to write
 *  one - and should not have to take the renderer with it. */

/** One of the six answers to "which colour". */
export interface HighlightColour {
  /** The emoji the file carries, or null for a highlight with no colour of its
   *  own - which is written as it always was, with nothing in front of the
   *  words. */
  emoji: string | null
  /** Which of the six palette tones it is drawn in: `--canvas-1` and the rest.
   *  Null for the plain one, which wears the accent the way it always has. */
  tone: number | null
  /** What the renderer puts on `<mark>`, and what the editor's decoration wears,
   *  so one stylesheet colours both. Empty for the plain one, whose element is
   *  the same `<mark>` every note already holds. */
  className: string
  /** What it is called, in English, for the row that offers it. */
  name: string
}

/** A highlight with no colour of its own: what nib has always written, what every
 *  note written before the colours carries, and what anything unreadable comes
 *  back as. */
const PLAIN: HighlightColour = { emoji: null, tone: null, className: '', name: 'No colour' }

/** The six, in the order they are offered: the plain one first, because it is the
 *  one that was always there, then the five the emoji name. The tones skip
 *  `--canvas-3`, the yellow: Obsidian writes no emoji for it, and a colour nib
 *  could write but Obsidian could not read is not a colour. */
export const HIGHLIGHT_COLOURS: readonly HighlightColour[] = [
  PLAIN,
  { emoji: '🔴', tone: 1, className: 'tone-1', name: 'Red' },
  { emoji: '🟠', tone: 2, className: 'tone-2', name: 'Orange' },
  { emoji: '🟢', tone: 4, className: 'tone-4', name: 'Green' },
  { emoji: '🔵', tone: 5, className: 'tone-5', name: 'Blue' },
  { emoji: '🟣', tone: 6, className: 'tone-6', name: 'Violet' },
]

/** How a highlight opens, once the `==` is off it: which colour it named, and
 *  where its words start.
 *
 *  `from` counts the emoji and the one space that may follow it, so
 *  `==🔴 careful==` shows "careful" and not " careful". A second space is the
 *  writer's and stays.
 *
 *  A highlight that is nothing but the emoji - `==🔴==` - is a highlight of that
 *  emoji rather than an empty one: there is nothing there to colour, so the mark
 *  is the words. */
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

/** The colour of a given tone, or the plain one for anything else. What the app
 *  turns a remembered choice back into. */
export function highlightTone(tone: number | null): HighlightColour {
  return HIGHLIGHT_COLOURS.find((one) => one.tone === tone) ?? PLAIN
}

/** What goes between the `==`: the words, with the colour's mark in front of them
 *  where it has one. The space after the emoji is written, because that is how
 *  Obsidian's own formatting menu writes it and because `🔴careful` reads as one
 *  word. */
export function writeHighlight(words: string, colour: HighlightColour): string {
  return colour.emoji === null ? words : `${colour.emoji} ${words}`
}
