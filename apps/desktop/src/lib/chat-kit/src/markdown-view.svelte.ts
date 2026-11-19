import { DIAGRAM_LANGUAGES, fenceLanguages, RENDERED_LANGUAGES } from '@orden/editor'
import { renderMarkdown, type RenderOptions } from '@orden/markdown'
import { loadFor, loadMaths, mathsEngine, onEngines } from '@orden/markdown/engines'
import { dollarMaths, settled } from '@orden/markdown/streamed'
import { drawDiagram, fenceFrom } from '../../fences/src/api'
import { loadParsers, type Parser } from '../../highlight/src/api'
import { type Scheme, theme } from '../../theme/src/api'

let version = $state(0)
let bumping = false
function bump() {
  if (bumping) return
  bumping = true
  queueMicrotask(() => {
    bumping = false
    version++
  })
}
onEngines(bump)
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- told through `version`
const parsers = new Map<string, Parser>()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- told through `version`
const asked = new Set<string>()
const diagrams: Record<Scheme, Map<string, string>> = { light: new Map(), dark: new Map() }
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- told through `version`
const drawingNow = new Set<string>()
function landing(): number {
  return version
}
export const drawing = {
  get version(): number {
    return landing()
  },
}
export function warmRenderer() {
  void loadMaths().catch(() => undefined)
  void fenceLanguages().catch(() => undefined)
}
export function mathsWaiting(html: string): boolean {
  void landing()
  return mathsEngine() === null && html.includes('class="math-')
}
export interface ViewOptions {
  live?: boolean
  draws?: (code: string, language: string) => boolean
}
export function viewHtml(markdown: string, options: RenderOptions = {}, how: ViewOptions = {}): string {
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
      if (how.draws && !how.draws(code, language)) return null
      const key = `${language}\n${code}`
      if (!how.live && !drawn.has(key) && !drawingNow.has(`${scheme}\n${key}`)) draws.push({ code, language, key })
    } else if (language && !RENDERED_LANGUAGES.has(language) && !asked.has(language)) {
      wanted.push(language)
    }
    return known(code, language)
  }
  const html = renderMarkdown(source, { footnotes: true, ...options, code: fence })
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
    void drawDiagram(one.code, one.language, scheme, 'document', false)
      .catch(() => '')
      .then((svg) => {
        drawn.set(one.key, svg)
        drawingNow.delete(key)
        bump()
      })
  }
  return html
}
