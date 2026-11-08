import { renderMarkdown, type RenderOptions } from '@orden/markdown'
import { deckOf, type SlideShape } from '@orden/markdown/slides'
import { type Note, pointer, withPictures } from '../reading/render'
import type { Scheme } from '../theme.svelte'

export interface StageSlide {
  html: string
  notes: string
  vertical: boolean
  fragments: number[]
  shape: SlideShape
  from: number
}

const MEASURE = 'orden:deck'

export async function deckHtml(
  note: Note,
  scheme: Scheme,
  trusted: boolean,
): Promise<StageSlide[]> {
  const slides = deckOf(note.text)

  const { prepareEmbeds, prepareFences } = await import('../before-render')
  const { links } = await import('../link-index.svelte')

  const [fence, embed] = await Promise.all([
    prepareFences(note.text, scheme),
    prepareEmbeds(note.text, (target) => links.embedNote(target, note.path)),
  ])

  const at = performance.now()
  const resolveLink = pointer(note)
  const shared = {
    code: fence,
    resolveEmbed: embed,
    resolveLink,
    escapeHtml: !trusted,
    breaks: true,
    fragments: true,
  }

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

function page(markdown: string, note: Note, options: RenderOptions): string {
  if (!markdown) return ''

  return withPictures(renderMarkdown(markdown, options), note)
}
