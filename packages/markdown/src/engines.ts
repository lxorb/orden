/** The two libraries a note only sometimes needs, and when they arrive.
 *
 *  KaTeX with its chemistry pack is about 675 kilobytes of source, and the emoji
 *  table another 250; between them they were the largest thing in front of the app's
 *  first paint, because this package's entry point imported both outright. Most
 *  notes have neither a formula nor a `:shortcode:` in them, and a window that is
 *  not open yet has neither.
 *
 *  So they are held here instead, behind a dynamic import each, and asked for by
 *  whatever turns out to need one:
 *
 *  - a caller that can wait says `await loadFor(source)` before it renders. The
 *    reading view, a deck, an export and a hover preview are all already async, and
 *    that is the whole of what they have to do.
 *  - a caller that cannot wait - the clipboard's HTML flavour, written inside a copy
 *    event - renders what it can and starts the load, so the next one is right.
 *  - the editor draws a formula as soon as the engine lands and redraws a
 *    `:shortcode:` when the table does; see live-preview/render.ts and
 *    live-preview/decorate.ts.
 *  - the Worker that publishes a note keeps both imported outright, because a
 *    request is answered once and an isolate that waited would wait per request;
 *    see eager.ts.
 *
 *  Sync accessors rather than promises everywhere, because `renderMarkdown` is
 *  synchronous and has to stay so: one renderer serves the reading view, the canvas
 *  cards, the clipboard, the exports and the published page, and half of those have
 *  no await to give. */

import { door } from './door'

/** KaTeX, as this package uses it: the engine with the chemistry pack already applied.
 *  See maths.ts, which is the one place the two are put together. */
type Maths = (typeof import('./maths'))['default']

/** `node-emoji`, whole. `get` is what a `:shortcode:` is read with; the editor's
 *  own popup uses `search` off the same module. */
type Emoji = typeof import('node-emoji')

let maths: Maths | null = null
let emoji: Emoji | null = null

/** The two fetches, each kept once it has worked; see door.ts. */
const fetchMaths = door(async () => {
  useMaths((await import('./maths')).default)
})
const fetchEmoji = door(async () => {
  useEmoji(await import('node-emoji'))
})

/** The largest a formula may say one of its own parts is, in ems.
 *
 *  TeX lets the formula choose: `\rule`, `\kern`, `\raisebox` and their
 *  neighbours all take a length, and KaTeX honours whatever they ask for unless
 *  it is told a ceiling. A note is not always the reader's own - one arrives
 *  from a share, from a room, or is published to strangers from a domain shared
 *  with every other blog - so a single line of TeX could hand the reader a box
 *  tens of thousands of ems tall, which is a page nobody can read or scroll.
 *  Well past anything a real equation asks for; nothing legible is 100 lines
 *  tall. Macro depth needs no number here: KaTeX caps expansion by default.
 *
 *  Beside the engine rather than in the renderer, because the editor draws formulas
 *  with the engine directly and should not have to bring the renderer for a number. */
export const MOST_EMS = 100

const listeners = new Set<() => void>()

function landed() {
  for (const listen of [...listeners]) listen()
}

/** The formula engine, or null while it is still on its way. */
export function mathsEngine(): Maths | null {
  return maths
}

/** The emoji table, or null while it is still on its way. */
export function emojiTable(): Emoji | null {
  return emoji
}

/** Hands over an engine that was imported rather than loaded; see eager.ts. */
export function useMaths(engine: Maths) {
  maths = engine
  landed()
}

export function useEmoji(table: Emoji) {
  emoji = table
  landed()
}

/** Loads the formula engine. Idempotent, and the same promise for every caller:
 *  a note of thirty equations asks thirty times. */
export function loadMaths(): Promise<void> {
  return maths ? Promise.resolve() : fetchMaths()
}

/** Loads the emoji table. */
export function loadEmoji(): Promise<void> {
  return emoji ? Promise.resolve() : fetchEmoji()
}

/** A `$…$` or a `$$…$$` somewhere in the source. The dollar is the cheap half of
 *  the question and nearly always answers it: a note with no dollar in it has no
 *  formula in it, whatever else it has. */
function hasMaths(source: string): boolean {
  return source.includes('$')
}

/** A `:shortcode:`, written the way the renderer's own tokenizer reads one. */
const SHORTCODE = /:[a-z0-9_+-]+:/i

function hasEmoji(source: string): boolean {
  return source.includes(':') && SHORTCODE.test(source)
}

/** Whichever of the two this markdown needs, loaded. What a caller that can wait
 *  says before it renders.
 *
 *  A note that has neither costs one scan for a dollar and, at worst, one for a
 *  shortcode - both of which are nothing beside rendering the note. */
export function loadFor(source: string): Promise<void> {
  const wanted: Promise<void>[] = []
  if (!maths && hasMaths(source)) wanted.push(loadMaths())
  if (!emoji && hasEmoji(source)) wanted.push(loadEmoji())

  return wanted.length === 0 ? Promise.resolve() : Promise.all(wanted).then(() => undefined)
}

/** Told when an engine has arrived, so a surface that drew a note without one can
 *  draw it again. Hands back the way to stop listening.
 *
 *  Two callers: the editor's live preview, which has a `:shortcode:` on screen as
 *  the characters it is written with until the table lands, and the canvas, which
 *  keeps the HTML of every card it has drawn. */
export function onEngines(listen: () => void): () => void {
  listeners.add(listen)
  return () => listeners.delete(listen)
}
