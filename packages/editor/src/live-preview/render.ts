import { MOST_EMS } from '@orden/markdown/engines'
import { chartFigure } from '@orden/markdown/chart'
import { DIAGRAM_LANGUAGES } from '@orden/markdown/diagrams'
import { loadMaths, mathsEngine } from '@orden/markdown/engines'
import type { BaseAsk, NoteIndex } from '../wikilink/notes'
import { NibWidget } from './widget'
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

abstract class PictureWidget extends NibWidget {
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
    host.className = this.block ? 'nib-math-block' : 'nib-math-inline'

    const body = this.number ? document.createElement('span') : host
    if (this.number) host.append(body)

    const engine = mathsEngine()
    if (engine) this.draw(engine, body)
    else void loadMaths().then(() => body.isConnected && this.draw(mathsEngine(), body))

    if (this.number) {
      const tag = document.createElement('span')
      tag.className = 'nib-math-number'
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
    host.className = 'nib-diagram'
    host.dataset.language = this.language
    void this.draw(host)
    return host
  }

  private async draw(host: HTMLElement) {
    try {
      if (this.language === 'flow') await drawFlowchart(host, this.code)
      else if (this.language === 'sequence') await drawMermaid(host, sequenceToMermaid(this.code))
      else await drawMermaid(host, this.code)
    } catch (error) {
      host.classList.add('nib-diagram-error')
      host.textContent = error instanceof Error ? error.message : String(error)
    }
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
    host.className = 'nib-chart'
    host.innerHTML = chartFigure(this.code) ?? ''
    return host
  }
}

export class QueryWidget extends NibWidget {
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
    host.className = 'nib-query-block'

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

export class BaseWidget extends NibWidget {
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
    host.className = 'nib-base-block'
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

async function drawMermaid(host: HTMLElement, code: string) {
  const { default: mermaid } = await import('mermaid')

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark',
    fontFamily: themeColour('--font-ui'),
  })

  const { svg } = await mermaid.render(`nib-diagram-${diagramSeq++}`, code)
  host.innerHTML = svg
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
