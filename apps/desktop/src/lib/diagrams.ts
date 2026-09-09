import { sequenceToMermaid } from '@nib/editor'
import type { Scheme } from './theme.svelte'

/** Drawn with the theme's face, which the document names in its stylesheet. */
const FONT = "'Geist', ui-sans-serif, system-ui, 'Segoe UI', sans-serif"

/** flowchart.js takes colours rather than a theme; these are the surface,
 *  line and text tokens of each scheme. */
const FLOW = {
  light: {
    fill: '#f3f5f8',
    'line-color': '#8a93a2',
    'element-color': '#ccd4de',
    'font-color': '#1a1d23',
  },
  dark: {
    fill: '#1a1e25',
    'line-color': '#767e8c',
    'element-color': '#2f3641',
    'font-color': '#dde2ea',
  },
}

let sequence = 0

/** A diagram fence as SVG, drawn for the scheme the document will have
 *  rather than the one on screen: a dark diagram on white paper is unreadable,
 *  and the editor only knows the screen. Both renderers are heavy, so neither
 *  loads until a note has a diagram. */
export async function drawDiagram(code: string, language: string, scheme: Scheme): Promise<string> {
  // Not in the plugin. A diagram cannot be read on a panel of one font in one
  // size, and the two renderers that draw them are most of what the store's review
  // objected to: between them mermaid and flowchart.js brought twenty one URLs and
  // four copies of lodash's `Function('return this')`. Refused here rather than
  // left out further down, so the bundler takes both of them and everything they
  // reach; see vite.even.config.ts.
  //
  // What the reader sees is what `prepareFences` already does with a diagram that
  // will not draw: the fence stays as code, which beats an empty space.
  if (__EVEN_PLUGIN__) throw new Error('no diagrams in the Even Realities plugin')

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

/** Typora's legacy ` ```flow ` fences. flowchart.js measures its labels as
 *  it draws, which only works on a page: drawn into a loose element every
 *  word comes out zero wide. So it draws into a corner nobody can see. */
async function drawFlowchart(code: string, scheme: Scheme): Promise<string> {
  const flowchart = (await import('flowchart.js')).default
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;'
  document.body.append(host)

  try {
    flowchart.parse(code).drawSVG(host, {
      'line-width': 1.5,
      'font-family': FONT,
      'font-size': 13,
      ...FLOW[scheme],
      'yes-text': 'yes',
      'no-text': 'no',
    })

    return host.innerHTML
  } finally {
    host.remove()
  }
}
