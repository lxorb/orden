import { sequenceToMermaid } from '@nib/editor'
import type { Scheme } from './theme.svelte'

/** Drawn with the theme's face, which the document names in its stylesheet. */
const FONT = "'Geist', ui-sans-serif, system-ui, 'Segoe UI', sans-serif"

/** flowchart.js takes colours rather than a theme; these are the surface,
 *  line and text tokens of each scheme. */
const FLOW = {
  light: { fill: '#f3f5f8', 'line-color': '#8a93a2', 'element-color': '#ccd4de', 'font-color': '#1a1d23' },
  dark: { fill: '#1a1e25', 'line-color': '#767e8c', 'element-color': '#2f3641', 'font-color': '#dde2ea' },
}

let sequence = 0

/** A diagram fence as SVG, drawn for the scheme the document will have
 *  rather than the one on screen: a dark diagram on white paper is unreadable,
 *  and the editor only knows the screen. Both renderers are heavy, so neither
 *  loads until a note has a diagram. */
export async function drawDiagram(code: string, language: string, scheme: Scheme): Promise<string> {
  if (language === 'flow') return drawFlowchart(code, scheme)
  return drawMermaid(language === 'sequence' ? sequenceToMermaid(code) : code, scheme)
}

async function drawMermaid(code: string, scheme: Scheme): Promise<string> {
  const { default: mermaid } = await import('mermaid')

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: scheme === 'light' ? 'default' : 'dark',
    fontFamily: FONT,
  })

  const { svg } = await mermaid.render(`nib-export-${sequence++}`, code)
  return svg
}

/** Typora's legacy ` ```flow ` fences. */
async function drawFlowchart(code: string, scheme: Scheme): Promise<string> {
  const flowchart = (await import('flowchart.js')).default
  const host = document.createElement('div')

  flowchart.parse(code).drawSVG(host, {
    'line-width': 1.5,
    'font-family': FONT,
    'font-size': 13,
    ...FLOW[scheme],
    'yes-text': 'yes',
    'no-text': 'no',
  })

  return host.innerHTML
}
