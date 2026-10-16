import { sequenceToMermaid } from '@nib/editor'
import type { Scheme } from './theme.svelte'

/** Drawn with the theme's face, which the document names in its stylesheet. */
const FONT = "'Geist', ui-sans-serif, system-ui, 'Segoe UI', sans-serif"

/** And the face a diagram bound for a published page is drawn with.
 *
 *  Geist is left out on purpose. A picture in an `<img>` fetches nothing, so the
 *  face named in it has to be one the reader's machine already has - and a
 *  published page does not serve Geist either, so its own prose falls back to the
 *  same stack. Naming a face the reader will not have would mean laying the boxes
 *  out here against Geist and drawing the words there in something else. */
const PAGE_FONT = "ui-sans-serif, system-ui, 'Segoe UI', sans-serif"

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

/** Whether the drawing is going into a document or into a file of its own.
 *
 *  A published page shows a diagram as an `<img>` pointing at an SVG the app drew
 *  and uploaded, which is a stricter place than the middle of a document: nothing
 *  in it may be fetched, and the only text a browser will lay out there is SVG
 *  text. So the labels stop being HTML in a `<foreignObject>` - which is what
 *  mermaid writes by default and what an image would show as an empty box - and
 *  the face is one the reader is certain to have. See site-diagrams.ts. */
export type DiagramFor = 'document' | 'page'

/** A diagram fence as SVG, drawn for the scheme the document will have
 *  rather than the one on screen: a dark diagram on white paper is unreadable,
 *  and the editor only knows the screen. Both renderers are heavy, so neither
 *  loads until a note has a diagram. */
export async function drawDiagram(
  code: string,
  language: string,
  scheme: Scheme,
  where: DiagramFor = 'document',
): Promise<string> {
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
  return drawMermaid(language === 'sequence' ? sequenceToMermaid(code) : code, scheme, where)
}

async function drawMermaid(code: string, scheme: Scheme, where: DiagramFor): Promise<string> {
  const { default: mermaid } = await import('mermaid')

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: scheme === 'light' ? 'default' : 'dark',
    fontFamily: where === 'page' ? PAGE_FONT : FONT,
    // Labels as SVG text rather than as HTML in a `<foreignObject>`, for a
    // drawing that has to stand on its own in an `<img>`; see `DiagramFor`.
    ...(where === 'page' ? { htmlLabels: false } : {}),
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
