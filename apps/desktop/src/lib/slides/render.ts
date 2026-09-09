/** A deck's slides as pages of HTML.
 *
 *  The same renderer the reading view uses and the same one an export writes
 *  with, one slide at a time: a deck is a note read in pages, not a second way
 *  of reading a note. So the fences are coloured, the diagrams drawn, the maths
 *  set, the pictures resolved and the wikilinks pointed into the space exactly
 *  as they are on the page the reading view shows.
 *
 *  What a note needs before it can be rendered - a parser for every language,
 *  a drawing for every diagram, the words of every embedded note - is prepared
 *  once for the whole deck rather than once per slide, because all of it is
 *  asked of the disk and none of it is per page. */

import { renderMarkdown, type RenderOptions } from '@nib/markdown'
import { deckOf, type SlideShape } from '@nib/markdown/slides'
import { type Note, pointer, withPictures } from '../reading/render'
import type { Scheme } from '../theme.svelte'

/** One slide, ready to put on the stage. */
export interface StageSlide {
  /** The slide itself. */
  html: string
  /** What only the presenter reads, rendered too: notes are prose and deserve
   *  their emphasis and their lists. */
  notes: string
  /** Whether the slide continues the one before it downwards. */
  vertical: boolean
  /** Which list items wait for a click, by their place among the items the
   *  slide renders. */
  fragments: number[]
  shape: SlideShape
  /** Where the slide's markdown starts in the note, so the editor can be put
   *  on the slide that is up. */
  from: number
}

/** How long rendering a whole deck took, under a name a profiler and a test can
 *  both read. Opening a deck is one keystroke and a page, so it is worth being
 *  able to ask what the page cost. */
const MEASURE = 'nib:deck'

/** `trusted` is whether the HTML in the note is markup rather than the characters
 *  it is made of; the same question the reading view asks, on the same note. See
 *  trust.ts. */
export async function deckHtml(
  note: Note,
  scheme: Scheme,
  trusted: boolean,
): Promise<StageSlide[]> {
  const slides = deckOf(note.text)

  // The exporter carries the diagram drawers and the syntax parsers, which are
  // most of what the app can load; asked for here rather than at startup, since
  // a deck is presented after the app is open.
  const { prepareEmbeds, prepareFences } = await import('../export')
  const { links } = await import('../link-index.svelte')

  const [fence, embed] = await Promise.all([
    prepareFences(note.text, scheme),
    prepareEmbeds(note.text, (target) => links.embedSource(target, note.path)),
  ])

  const at = performance.now()
  const resolveLink = pointer(note)
  const shared = { code: fence, resolveEmbed: embed, resolveLink, escapeHtml: !trusted }

  const pages = slides.map((slide) => ({
    html: page(slide.markdown, note, shared),
    notes: page(slide.notes, note, shared),
    vertical: slide.vertical,
    fragments: slide.fragments,
    shape: slide.shape,
    from: slide.from,
  }))

  performance.measure(MEASURE, { start: at, detail: { slides: pages.length } })

  return pages
}

/** One slide's markdown as HTML. No table of contents and no footnotes: both
 *  gather what a whole document said, and a slide is a page of one. */
function page(markdown: string, note: Note, options: RenderOptions): string {
  if (!markdown) return ''

  return withPictures(renderMarkdown(markdown, options), note)
}
