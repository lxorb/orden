/** The clipper's side of the interpreter: a clip, turned into the question, and
 *  the answer turned back into properties.
 *
 *  `interpret/` knows about pages, templates and providers and nothing about this
 *  extension - which is what makes it the part the app's own ai module will share.
 *  This is the seam: it is the one place that knows a clip is a `Clip`, that the
 *  settings are where the provider lives, and that the popup and the service worker
 *  are two callers of the same question.
 *
 *  Both of them ask it. The popup asks while somebody watches, with a signal so
 *  that closing it, or picking another template, stops the request rather than
 *  paying for an answer nobody will read. The worker asks for a clip from the
 *  page's own menu or a shortcut, where there is nothing to watch and nothing to
 *  abort - and where a failure is silent on purpose: the note lands with its usual
 *  four lines, which is what it would have had anyway. */

import { interpret, type Interpreted } from './interpret'
import { excerpt, type Page } from './interpret/prompt'
import { type Interpreter, setupOf } from './interpret/setup'
import { type Template, templateFor, templatesOf } from './interpret/templates'
import type { Filled } from './interpret/values'
import type { Clip } from './messages'

/** The page a clip is, as much of it as goes to a provider. The markdown rather
 *  than the HTML: it is already the article and nothing else, which is the whole
 *  reason the clip is worth interpreting instead of the tab. */
export function pageOf(clip: Clip): Page {
  return { url: clip.origin.url, title: clip.origin.title, text: excerpt(clip.markdown) }
}

/** One clip interpreted by one template, or the sentence saying why not. Nothing
 *  at all when no provider is chosen, which is what a fresh install is. */
export async function filledFor(
  clip: Clip,
  template: Template,
  held: Interpreter,
  signal?: AbortSignal,
): Promise<Interpreted> {
  const setup = setupOf(held)
  if (!setup) return { filled: [] }

  return interpret(pageOf(clip), template, setup, signal)
}

/** What the interpreter fills in for a clip nobody is looking at.
 *
 *  The template is the one the address claims, and the Interpret switch is the one
 *  remembered for it in the popup: turning it on for Article is what makes a clip
 *  from the page's own menu ask as well. Off, and not a byte of the page leaves the
 *  browser. */
export async function filledQuietly(clip: Clip, held: Interpreter): Promise<Filled[]> {
  const template = templateFor(templatesOf(held.templates), clip.origin.url)
  if (!template || !held.on[template.name]) return []

  const answered = await filledFor(clip, template, held)
  return 'filled' in answered ? answered.filled : []
}
