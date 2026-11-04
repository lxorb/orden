/** Markdown handed over as a string, drawn the way a note is read: a model's answer in
 *  the AI panel and in the quick question, and a message in a chat.
 *
 *  The same renderer the reading view stands on, with the same fences - a coloured
 *  block, a drawn diagram - through `fenceFrom` in before-render.ts, the same formula
 *  engine and the same stylesheet, so nothing about a table, a formula or a footnote is
 *  drawn one way in a note and another beside it. What differs is time. The reading
 *  view waits for whatever a note needs before it shows it; an answer is drawn as it
 *  arrives, a frame at a time, and a frame cannot wait. So this draws synchronously from
 *  whatever has landed, asks for whatever has not, and says so through `drawing.version`
 *  when it does land - which every surface drawing through here reads, so an answer
 *  already on the screen is drawn again then rather than staying as it was first drawn.
 *
 *  And the words are a model's, so they are spelled a note's way first (`dollarMaths`),
 *  and while they are still arriving what their last line left open is closed
 *  (`settled`); see @orden/markdown/streamed. */

import { DIAGRAM_LANGUAGES, fenceLanguages, RENDERED_LANGUAGES } from '@orden/editor'
import { renderMarkdown, type RenderOptions } from '@orden/markdown'
import { loadFor, loadMaths, mathsEngine, onEngines } from '@orden/markdown/engines'
import { dollarMaths, settled } from '@orden/markdown/streamed'
import { fenceFrom } from './before-render'
import { drawDiagram } from './diagrams'
import { loadParsers, type Parser } from './highlight'
import { theme, type Scheme } from './theme.svelte'

let version = $state(0)
let bumping = false

/** Once for every landing in one turn: a fence and the formula engine arriving
 *  together are one redraw. */
function bump() {
  if (bumping) return
  bumping = true
  queueMicrotask(() => {
    bumping = false
    version++
  })
}

onEngines(bump)

// The caches below are not state: what tells a surface that one of them grew is
// `version`, once per landing, rather than every write to each.
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- told through `version`
const parsers = new Map<string, Parser>()
/** Every language a parser has been asked for, found or not, so it is asked once. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- told through `version`
const asked = new Set<string>()
/** The diagrams drawn, by scheme and then by language and code; an empty string is
 *  one that would not draw, which stays the code it is. */
const diagrams: Record<Scheme, Map<string, string>> = { light: new Map(), dark: new Map() }
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- told through `version`
const drawingNow = new Set<string>()

/** Which landing this is, read wherever a draw depends on what has landed. */
function landing(): number {
  return version
}

export const drawing = {
  /** Which landing the surfaces are drawn from. Read by every draw below, so a
   *  component that draws through here in its template is drawn again by itself; a
   *  surface that writes its own HTML reads it as well, to know when to. */
  get version(): number {
    return landing()
  },
}

/** Fetches what an answer is most likely to want before it arrives: the formula engine
 *  and the list of fence languages. Asked by a surface as it opens, so the first frame
 *  of an answer is already drawn with them rather than drawn again once they land. */
export function warmRenderer() {
  void loadMaths().catch(() => undefined)
  void fenceLanguages().catch(() => undefined)
}

/** Whether a formula would be drawn as its source because the engine is still on its
 *  way: what a surface hides the formulas by until then, rather than show TeX. */
export function mathsWaiting(html: string): boolean {
  void landing()
  return mathsEngine() === null && html.includes('class="math-')
}

export interface ViewOptions {
  /** The words are still arriving. */
  live?: boolean
}

/** The markdown as HTML, now, from what has landed - and what has not is asked for. */
export function viewHtml(
  markdown: string,
  options: RenderOptions = {},
  how: ViewOptions = {},
): string {
  // Read so that whoever draws through here draws again when something lands.
  void landing()
  const scheme = theme.current
  const spelled = dollarMaths(markdown)
  const source = how.live ? settled(spelled) : spelled
  const drawn = diagrams[scheme]
  const known = fenceFrom({ parsers, diagrams: drawn })

  const wanted: string[] = []
  const draws: { code: string; language: string; key: string }[] = []
  const fence = (code: string, language: string) => {
    if (DIAGRAM_LANGUAGES.has(language)) {
      const key = `${language}\n${code}`
      // Not while the fence is still being written: a diagram half drawn is an error.
      if (!how.live && !drawn.has(key) && !drawingNow.has(`${scheme}\n${key}`))
        draws.push({ code, language, key })
    } else if (language && !RENDERED_LANGUAGES.has(language) && !asked.has(language)) {
      wanted.push(language)
    }
    return known(code, language)
  }

  const html = renderMarkdown(source, { footnotes: true, ...options, code: fence })

  // After the render rather than in it: what lands is a redraw, never a write inside one.
  void loadFor(source).catch(() => undefined)
  if (wanted.length) {
    for (const language of wanted) asked.add(language)
    void loadParsers(wanted)
      .then((found) => {
        for (const [language, parser] of found) parsers.set(language, parser)
        if (found.size) bump()
      })
      .catch(() => undefined)
  }
  for (const one of draws) {
    const key = `${scheme}\n${one.key}`
    drawingNow.add(key)
    void drawDiagram(one.code, one.language, scheme)
      .catch(() => '')
      .then((svg) => {
        drawn.set(one.key, svg)
        drawingNow.delete(key)
        if (svg) bump()
      })
  }

  return html
}
