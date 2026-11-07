import { MOST_EMS } from '@orden/markdown/engines'
import { chartFigure } from '@orden/markdown/chart'
import { DIAGRAM_LANGUAGES } from '@orden/markdown/diagrams'
import { loadMaths, mathsEngine } from '@orden/markdown/engines'
import type { BaseAsk, NoteIndex } from '../wikilink/notes'
import { OrdenWidget } from './widget'
import 'katex/dist/katex.min.css'
import { sequenceToMermaid } from './sequence'

const equationNumbers = new Map<string, number>()

export function resetEquationLabels() {
  equationNumbers.clear()
}

export function recordEquationLabel(tex: string, number: number) {
  const label = /\\label\s*\{([^}]+)\}/.exec(tex)?.[1]
  if (label !== undefined) equationNumbers.set(label, number)
}

export function prepare(tex: string): string {
  return tex
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(?:eq)?ref\s*\{([^}]+)\}/g, (whole, name: string) => {
      const number = equationNumbers.get(name)
      return number ? `(${number})` : whole
    })
}

abstract class PictureWidget extends OrdenWidget {
  override ignoreEvent() {
    return false
  }
}

export class MathWidget extends PictureWidget {
  constructor(
    private readonly tex: string,
    private readonly block: boolean,
    private readonly number?: number,
  ) {
    super()
  }

  override eq(other: MathWidget) {
    return other.tex === this.tex && other.block === this.block && other.number === this.number
  }

  override ignoreEvent() {
    return !this.block
  }

  toDOM() {
    const host = document.createElement(this.block ? 'div' : 'span')
    host.className = this.block ? 'orden-math-block' : 'orden-math-inline'

    const body = this.number ? document.createElement('span') : host
    if (this.number) host.append(body)

    const engine = mathsEngine()
    if (engine) this.draw(engine, body)
    else void loadMaths().then(() => body.isConnected && this.draw(mathsEngine(), body))

    if (this.number) {
      const tag = document.createElement('span')
      tag.className = 'orden-math-number'
      tag.textContent = `(${this.number})`
      host.append(tag)
    }

    return host
  }

  private draw(engine: ReturnType<typeof mathsEngine>, body: HTMLElement) {
    if (engine) drawMaths(engine, this.tex, this.block, body)
  }
}

export function drawMaths(
  engine: NonNullable<ReturnType<typeof mathsEngine>>,
  tex: string,
  block: boolean,
  host: HTMLElement,
  strict = false,
) {
  engine.render(prepare(tex), host, {
    displayMode: block,
    throwOnError: strict,
    errorColor: 'var(--danger)',
    output: 'html',
    trust: false,
    strict: false,
    maxSize: MOST_EMS,
  })
}

export { DIAGRAM_LANGUAGES }

export const RENDERED_LANGUAGES: ReadonlySet<string> = new Set([
  ...DIAGRAM_LANGUAGES,
  'chart',
  'query',
  'tasks',
  'base',
])

let diagramSeq = 0

export class DiagramWidget extends PictureWidget {
  constructor(
    private readonly code: string,
    private readonly language: string,
  ) {
    super()
  }

  override eq(other: DiagramWidget) {
    return other.code === this.code && other.language === this.language
  }

  toDOM() {
    const host = document.createElement('div')
    host.className = 'orden-diagram'
    host.dataset.language = this.language
    const key = drawnKey(this.code, this.language)
    const known = drawnDiagrams.get(key)
    if (known === undefined) void this.draw(host, key)
    else {
      drawnDiagrams.delete(key)
      drawnDiagrams.set(key, known)
      keepStylesShared()
      host.innerHTML = known
    }
    return host
  }

  private async draw(host: HTMLElement, key: string) {
    try {
      if (this.language === 'flow') await drawFlowchart(host, this.code)
      else if (this.language === 'sequence') {
        await drawMermaid(host, sequenceToMermaid(this.code), true)
      } else await drawMermaid(host, this.code, true)
      keepDrawn(key, host.innerHTML)
    } catch (error) {
      host.classList.add('orden-diagram-error')
      host.textContent = error instanceof Error ? error.message : String(error)
    }
  }
}

const drawnDiagrams = new Map<string, string>()

const MOST_DRAWN = 100

const MOST_DRAWN_LENGTH = 16_000_000

let drawnLength = 0

const DRAWN_WITH = ['--font-ui', '--surface-2', '--muted', '--line-strong', '--text']

function drawnKey(code: string, language: string): string {
  const root = document.documentElement
  const style = getComputedStyle(root)
  const said = DRAWN_WITH.map((name) => style.getPropertyValue(name).trim())
  return [language, root.dataset.theme ?? '', ...said, code].join('\n')
}

function keepDrawn(key: string, svg: string) {
  const before = drawnDiagrams.get(key)
  if (before !== undefined) drawnLength -= before.length
  drawnDiagrams.delete(key)
  if (svg.length > MOST_DRAWN_LENGTH / 4) return

  drawnDiagrams.set(key, svg)
  drawnLength += svg.length
  for (const [oldest, one] of drawnDiagrams) {
    if (drawnDiagrams.size <= MOST_DRAWN && drawnLength <= MOST_DRAWN_LENGTH) break
    drawnDiagrams.delete(oldest)
    drawnLength -= one.length
  }
}

export class ChartWidget extends PictureWidget {
  constructor(private readonly code: string) {
    super()
  }

  override eq(other: ChartWidget) {
    return other.code === this.code
  }

  toDOM() {
    const host = document.createElement('div')
    host.className = 'orden-chart'
    host.innerHTML = chartFigure(this.code) ?? ''
    return host
  }
}

export class QueryWidget extends OrdenWidget {
  constructor(
    private readonly code: string,
    private readonly index: NoteIndex,
    private readonly language = 'query',
  ) {
    super()
  }

  override eq(other: QueryWidget) {
    return (
      other.code === this.code && other.index === this.index && other.language === this.language
    )
  }

  toDOM() {
    const host = document.createElement('div')
    host.className = 'orden-query-block'

    host.addEventListener('mousedown', (event) => {
      if (this.index.pressRow?.(event.target) !== true) return

      event.preventDefault()
    })

    void this.draw(host)
    return host
  }

  private async draw(host: HTMLElement) {
    const html = await this.index.query?.(this.code, this.language)
    if (!host.isConnected || html === null || html === undefined) return

    host.innerHTML = html
  }
}

export class BaseWidget extends OrdenWidget {
  constructor(
    private readonly ask: BaseAsk,
    private readonly index: NoteIndex,
  ) {
    super()
  }

  override eq(other: BaseWidget) {
    return (
      JSON.stringify(other.ask) === JSON.stringify(this.ask) && other.index.path === this.index.path
    )
  }

  toDOM() {
    const host = document.createElement('div')
    host.className = 'orden-base-block'
    const mounted = this.index.mountBase?.(host, this.ask)
    if (mounted) this.onDestroy(host, mounted)
    return host
  }

  override ignoreEvent() {
    return true
  }
}

export async function diagramSvg(code: string, language: string): Promise<string> {
  const host = document.createElement('div')

  if (language === 'flow') await drawFlowchart(host, code)
  else await drawMermaid(host, language === 'sequence' ? sequenceToMermaid(code) : code)

  return host.innerHTML
}

function themeColour(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

async function drawMermaid(host: HTMLElement, code: string, shared = false) {
  const { default: mermaid } = await import('mermaid')

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark',
    fontFamily: themeColour('--font-ui'),
  })

  const id = `orden-diagram-${diagramSeq++}`
  const { svg } = await mermaid.render(id, code)
  host.innerHTML = svg
  if (shared) shareStyle(host.querySelector('svg'), id)
}

const sharedStyles = new Map<string, { name: string; style: HTMLStyleElement }>()

const MOST_SHARED_STYLES = 64

const OWN_ID = '\u0000'

function keepStylesShared() {
  for (const { style } of sharedStyles.values()) {
    if (!style.isConnected) document.head.append(style)
  }
}

function shareStyle(svg: SVGSVGElement | null, id: string) {
  const style = svg?.querySelector(':scope > style')
  if (!svg || !style) return

  const said = style.textContent.replace(new RegExp(`#${id}(?![\\w-])`, 'g'), OWN_ID)
  let shared = sharedStyles.get(said)
  if (shared === undefined) {
    if (sharedStyles.size >= MOST_SHARED_STYLES) return
    const name = `orden-diagram-style-${sharedStyles.size}`
    const made = document.createElement('style')
    made.textContent = said.split(OWN_ID).join(`:is(.${name}, #${name})`)
    shared = { name, style: made }
    sharedStyles.set(said, shared)
  }
  if (!shared.style.isConnected) document.head.append(shared.style)

  style.remove()
  svg.classList.add(shared.name)
}

async function drawFlowchart(host: HTMLElement, code: string) {
  const [{ default: flowchart }, { flowSource, keepSafeLinks }] = await Promise.all([
    import('flowchart.js'),
    import('./flow'),
  ])

  host.innerHTML = ''
  flowchart.parse(flowSource(code)).drawSVG(host, {
    'line-width': 1.5,
    'font-family': themeColour('--font-ui'),
    'font-size': 13,
    fill: themeColour('--surface-2'),
    'line-color': themeColour('--muted'),
    'element-color': themeColour('--line-strong'),
    'font-color': themeColour('--text'),
    'yes-text': 'yes',
    'no-text': 'no',
  })
  keepSafeLinks(host)
}
