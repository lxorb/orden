import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { linkTarget, parseWikilink, sectionOf } from '@nib/markdown/links'
import { imageResolver } from '../images'
import { label } from '../labels'
import { openLightbox } from '../live-preview/image/lightbox'
import { NibWidget } from '../live-preview/widget'
import { renderNote } from './preview'
import type { LinkSpan } from './at'
import { jumpFor, noteIndex, noteOpener, resolveLink } from './notes'

/** What `![[…]]` draws: a note inside the note that names it, or a picture.
 *
 *  A note gets a thin frame, its name along the bottom, its content inside, and
 *  a click on the name to open the real thing. Read-only on purpose: what is on
 *  screen belongs to another file, and editing it here would be editing a note
 *  that is not open.
 *
 *  One level deep. The content is rendered without a resolver for the links
 *  inside it, so a `[[…]]` in an embedded note comes out as its own words rather
 *  than as an embed of an embed - which is also what Obsidian does.
 *
 *  A picture is drawn as a picture, plainly: no frame, no handles and no
 *  toolbar. Those belong to `![](…)`, which is the note's own image and the one
 *  a resize may rewrite; this one is a picture that lives somewhere else, and
 *  `![[pic.png|300]]` is how Obsidian says how wide to draw it. */

/** How much of a note an embed shows. Well past any note anyone embeds, and a
 *  ceiling so that pointing an embed at a very large note cannot make the
 *  editor render a megabyte inside a paragraph. */
const MOST_EMBEDDED = 40_000

/** The longest an embed's line can be, so a paragraph is dismissed on its length
 *  before its text is read out of the document at all. */
const EMBED_MAX = 512

/** The embed a block is, when the block is nothing but one: `![[Note]]` on a
 *  line of its own with blank lines around it, which is where Obsidian shows the
 *  note rather than a link to it.
 *
 *  Read from the text rather than from the tree, because blocks.ts asks about a
 *  paragraph it has deliberately not walked into: descending into every
 *  single-line paragraph of a note to look for one would cost more than every
 *  other block construct put together. decorate.ts asks the same question of the
 *  same function, since the two have to agree - one drawing a range the other
 *  also draws is how two decorations come to overlap and throw. */
export function embedOfBlock(state: EditorState, from: number, to: number): LinkSpan | null {
  if (to - from > EMBED_MAX) return null

  const doc = state.doc
  const line = doc.lineAt(from)
  const text = line.text.trim()

  // The block has to be the whole line, whichever node asked: a `Wikilink`
  // leaves the space around it out and a `Paragraph` may take it in.
  if (from !== line.from + (line.text.length - line.text.trimStart().length)) return null
  if (to !== line.from + line.text.trimEnd().length) return null

  const above = line.number > 1 ? doc.line(line.number - 1).text : ''
  const below = line.number < doc.lines ? doc.line(line.number + 1).text : ''
  if (above.trim() !== '' || below.trim() !== '') return null

  if (!text.startsWith('![[') || !text.endsWith(']]')) return null

  const link = parseWikilink(text.slice(3, -2), true)
  return link && { ...link, kind: 'wikilink', from, to }
}

const IMAGE = /\.(a?png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i

/** Whether a target names a picture rather than a note, which `![[…]]` embeds
 *  as an image the way `![](…)` does. */
export function isImageTarget(target: string): boolean {
  return IMAGE.test(target)
}

export class EmbedWidget extends NibWidget {
  constructor(
    private readonly link: LinkSpan,
    /** The path the target resolved to, or null when the space has no such
     *  note: an embed of nothing says so rather than showing an empty frame. */
    private readonly path: string | null,
  ) {
    super()
  }

  override eq(other: EmbedWidget) {
    return (
      other.path === this.path &&
      other.link.target === this.link.target &&
      other.link.heading === this.link.heading &&
      other.link.block === this.link.block &&
      other.link.alias === this.link.alias
    )
  }

  toDOM(view: EditorView) {
    const frame = document.createElement('div')
    frame.className = 'nib-embed'

    const body = document.createElement('div')
    body.className = 'nib-embed-body'
    frame.append(body)

    const caption = document.createElement('button')
    caption.className = 'nib-embed-name'
    caption.type = 'button'
    caption.textContent = this.link.alias ?? linkTarget(this.link)
    caption.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const state = view.state
      state.facet(noteOpener)(jumpFor(state.facet(noteIndex), this.link, this.link.kind))
    })
    frame.append(caption)

    const missing = () => {
      frame.classList.remove('nib-embed-loading')
      frame.classList.add('nib-embed-missing')
      body.textContent = label('noteNotFound')
    }

    if (this.path === null) {
      missing()
      return frame
    }

    // The frame is on screen before the note in it has been read, so an embed
    // appears with the keystroke that made it rather than after a round trip.
    frame.classList.add('nib-embed-loading')

    void view.state
      .facet(noteIndex)
      .read(this.path)
      .then((source) => {
        // The editor may have moved on while the note was being read.
        if (!body.isConnected) return

        const section = source === null ? null : sectionOf(source, this.link)
        if (section === null) {
          missing()
          return
        }

        frame.classList.remove('nib-embed-loading')
        body.innerHTML = renderNote(section.slice(0, MOST_EMBEDDED), view)
      })
      .catch(() => {
        if (body.isConnected) missing()
      })

    return frame
  }

  /** Clicks inside belong to the embed - the caption opens the note - rather
   *  than to the document behind it. */
  override ignoreEvent() {
    return true
  }
}

/** The widget for one embedded note. An embed of a note the space does not hold
 *  still gets a frame, saying so: the markup is there to be corrected, and an
 *  empty space says nothing. */
export function embedWidget(state: EditorState, link: LinkSpan): EmbedWidget {
  const index = state.facet(noteIndex)
  const path = link.target ? (resolveLink(index, link, link.kind)?.path ?? null) : index.path
  return new EmbedWidget(link, path)
}

/** Obsidian's size after the bar: a width in pixels, or `width x height`. */
const SIZE = /^(\d+)(?:x(\d+))?$/

export class EmbedImageWidget extends NibWidget {
  constructor(private readonly link: LinkSpan) {
    super()
  }

  override eq(other: EmbedImageWidget) {
    return other.link.target === this.link.target && other.link.alias === this.link.alias
  }

  toDOM(view: EditorView) {
    const picture = document.createElement('img')
    picture.className = 'nib-embed-image'
    picture.draggable = false
    picture.alt = ''

    const size = SIZE.exec(this.link.alias ?? '')
    if (size) {
      picture.width = Number(size[1])
      if (size[2] !== undefined) picture.height = Number(size[2])
    } else if (this.link.alias) {
      // Anything that is not a size is what the picture is of, as in markdown.
      picture.alt = this.link.alias
    }

    picture.addEventListener('dragstart', (event) => event.preventDefault())
    picture.addEventListener('dblclick', (event) => {
      event.preventDefault()
      openLightbox(view, picture.src, picture.alt)
    })

    picture.src = view.state.facet(imageResolver)(this.link.target)
    return picture
  }

  /** The double click is the widget's own; everything else belongs to the text. */
  override ignoreEvent(event: Event) {
    return event.type === 'dblclick'
  }
}
