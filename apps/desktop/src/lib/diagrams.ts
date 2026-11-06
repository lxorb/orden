import { sequenceToMermaid } from '@orden/editor'
import { flowSource, keepSafeLinks } from '@orden/editor/flow'
import type { Scheme } from './theme.svelte'

const FONT = "'Geist', ui-sans-serif, system-ui, 'Segoe UI', sans-serif"

const PAGE_FONT = "ui-sans-serif, system-ui, 'Segoe UI', sans-serif"

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

export type DiagramFor = 'document' | 'page'

export async function drawDiagram(
  code: string,
  language: string,
  scheme: Scheme,
  where: DiagramFor = 'document',
): Promise<string> {
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
    ...(where === 'page' ? { htmlLabels: false } : {}),
  })

  const { svg } = await mermaid.render(`nib-export-${sequence++}`, code)
  return svg
}

async function drawFlowchart(code: string, scheme: Scheme): Promise<string> {
  const flowchart = (await import('flowchart.js')).default
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;'
  document.body.append(host)

  try {
    flowchart.parse(flowSource(code)).drawSVG(host, {
      'line-width': 1.5,
      'font-family': FONT,
      'font-size': 13,
      ...FLOW[scheme],
      'yes-text': 'yes',
      'no-text': 'no',
    })
    keepSafeLinks(host)

    return host.innerHTML
  } finally {
    host.remove()
  }
}
