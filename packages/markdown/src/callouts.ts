/** What a callout is, in one place.
 *
 *  `> [!warning]- Mind the gap` is Obsidian's, and it is file content: the
 *  editor never rewrites it, every exporter carries it through, and a note
 *  written here opens the same way over there. So the grammar for it lives
 *  here and nowhere else. It used to live in four places - the renderer, the
 *  glasses, the editor's decorations and the exporters' document model - each
 *  with its own regular expression and its own list of kinds, and each list was
 *  a different length.
 *
 *  A marker line is a type, an optional fold sign, and an optional title:
 *
 *      > [!tip]                     the type on its own
 *      > [!tip] Watch the step      a title of the writer's own
 *      > [!tip]- Watch the step     folded to begin with
 *      > [!tip]+ Watch the step     open to begin with, and foldable
 *
 *  **A type nothing knows is still a callout.** It renders as one, carrying its
 *  own name in `data-callout`, so a theme can dress `[!recipe]` with a rule of
 *  its own and there is no registry anywhere to add it to first. That is
 *  Obsidian's "custom callout types via CSS" without the ceremony.
 *
 *  **Fifteen looks for thirteen types.** Obsidian folds `important` into `tip`
 *  and `caution` into `warning`. Nib had both of those as GitHub alert kinds
 *  before it had any of the others, with colours of their own that people have
 *  notes full of, so here they keep their own look and their own colour token.
 *  Everything else resolves through `ALIASES`, so `[!tldr]` and `[!summary]`
 *  wear `abstract`'s icon and `abstract`'s colour while still saying `tldr` and
 *  `summary` in `data-callout`.
 *
 *  The icons are Lucide's, one file each so nothing here drags the whole set
 *  in, and they are handed out as markup rather than as a component: the
 *  renderer writes HTML, the editor builds DOM, and an EPUB is read by an XML
 *  parser that wants every child element closed. One string serves all three. */

import type { IconNode } from 'lucide'
import Bug from 'lucide/dist/esm/icons/bug.mjs'
import Check from 'lucide/dist/esm/icons/check.mjs'
import CircleCheck from 'lucide/dist/esm/icons/circle-check.mjs'
import CircleQuestionMark from 'lucide/dist/esm/icons/circle-question-mark.mjs'
import ClipboardList from 'lucide/dist/esm/icons/clipboard-list.mjs'
import Flame from 'lucide/dist/esm/icons/flame.mjs'
import Info from 'lucide/dist/esm/icons/info.mjs'
import List from 'lucide/dist/esm/icons/list.mjs'
import MessageSquareWarning from 'lucide/dist/esm/icons/message-square-warning.mjs'
import OctagonAlert from 'lucide/dist/esm/icons/octagon-alert.mjs'
import Pencil from 'lucide/dist/esm/icons/pencil.mjs'
import Quote from 'lucide/dist/esm/icons/quote.mjs'
import TriangleAlert from 'lucide/dist/esm/icons/triangle-alert.mjs'
import X from 'lucide/dist/esm/icons/x.mjs'
import Zap from 'lucide/dist/esm/icons/zap.mjs'

/** Every look there is, and the icon it wears. The name is also the class the
 *  stylesheets colour it by - `.callout-warning` - and the only names those
 *  need to know, since an alias has resolved to one of these before any markup
 *  is written. */
const LOOKS: Record<string, IconNode> = {
  note: Pencil,
  abstract: ClipboardList,
  info: Info,
  todo: CircleCheck,
  tip: Flame,
  important: MessageSquareWarning,
  success: Check,
  question: CircleQuestionMark,
  warning: TriangleAlert,
  caution: OctagonAlert,
  failure: X,
  danger: Zap,
  bug: Bug,
  example: List,
  quote: Quote,
}

/** The other words for those, Obsidian's own. */
const ALIASES: Record<string, string> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
}

/** Words that are not words. Title case would make these "Tldr" and "Faq". */
const SHOUTED = new Set(['tldr', 'faq'])

/** The marker line, in four parts: the marker itself with the space after it,
 *  the type, the fold sign, and whatever is left of the line. Four rather than
 *  three, so how much of the line the marker took is a length and not a sum
 *  that trimming can throw off. */
const MARKER = /^([ \t]*\[!([^\]\n]+)\]([-+])?[ \t]*)([^\n]*)/

/** A callout's opening line, read. */
export interface Callout {
  /** The type as the writer wrote it, lowercased. What a theme selects on, and
   *  what an unknown type carries so it can be styled without being registered
   *  anywhere. */
  type: string
  /** The look nib knows for that type, or null for one it has never heard of.
   *  An alias has already resolved: `tldr` answers `abstract`. */
  look: string | null
  /** What the title reads as when the writer wrote none: the type, as a word. */
  label: string
  /** The writer's own title, or the empty string. Plain words - a title is a
   *  name for the block, not a paragraph, so markdown inside one is not read. */
  title: string
  /** Whether a fold sign was written at all, and whether it was the `-` that
   *  says "start this folded". */
  foldable: boolean
  folded: boolean
  /** How much of the text the whole marker line took - the leading space, the
   *  brackets, the fold sign, the title and the line break after it - so
   *  anything reading the words rather than the source can cut exactly that
   *  much off the front and have the body. */
  taken: number
  /** What is left after that, which is the body. */
  rest: string
}

/** The callout a blockquote's first line opens, or nothing at all.
 *
 *  Given the quote's own text with the `>` marks already off it - which is what
 *  a token carries, and what the editor takes off itself. */
export function calloutOf(text: string): Callout | null {
  const found = MARKER.exec(text)
  if (!found) return null

  const type = (found[2] ?? '').trim().toLowerCase()
  if (!type) return null

  const sign = found[3]
  const title = (found[4] ?? '').trim()
  const after = text.slice(found[0].length)
  const body = after.startsWith('\n') ? after.slice(1) : after

  return {
    type,
    look: LOOKS[type] ? type : (ALIASES[type] ?? null),
    label: SHOUTED.has(type) ? type.toUpperCase() : type.charAt(0).toUpperCase() + type.slice(1),
    title,
    foldable: sign !== undefined,
    folded: sign === '-',
    taken: text.length - body.length,
    rest: body,
  }
}

/** How an icon's own `<svg>` is dressed. One list, so the markup below and the
 *  elements the editor builds out of `calloutIconParts` are the same drawing. */
export const ICON_ATTRIBUTES: Readonly<Record<string, string>> = {
  class: 'callout-icon',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.9',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
}

/** An icon as data: the elements it is drawn from, in order.
 *
 *  Lucide's own shape, restated without its name, so anything that builds DOM
 *  rather than markup - the editor's callout widget - can draw one without
 *  importing the library. Data and not a drawing, because this package is read
 *  by the Worker that publishes a note, and a Worker has no `document`. */
export type IconParts = readonly (readonly [
  string,
  Readonly<Record<string, string | number | undefined>>,
])[]

export function calloutIconParts(look: string | null): IconParts | null {
  const node = look === null ? undefined : LOOKS[look]
  return node ?? null
}

/** A look's icon as markup: one `<svg>`, its children self-closed.
 *
 *  Self-closed because an EPUB is read by an XML parser, which takes a `<path>`
 *  as an element left open and refuses the book. Empty for a type nothing
 *  knows, which is what makes an unknown callout read as a plain one with its
 *  own name on it rather than as a broken known one. */
export function calloutIcon(look: string | null): string {
  const node = calloutIconParts(look)
  if (!node) return ''

  const written = (attributes: Readonly<Record<string, string | number | undefined>>) =>
    Object.entries(attributes)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => ` ${name}="${String(value)}"`)
      .join('')

  const parts = node.map(([tag, attributes]) => `<${tag}${written(attributes)} />`)
  return `<svg${written(ICON_ATTRIBUTES)}>${parts.join('')}</svg>`
}
