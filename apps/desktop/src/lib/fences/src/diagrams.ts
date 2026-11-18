import { mermaidSvg, sequenceToMermaid } from '@orden/editor'
import { flowSource, keepSafeLinks } from '@orden/editor/flow'
import type { Scheme } from '../../theme/src/api'

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
  pictures = true,
): Promise<string> {
  if (__EVEN_PLUGIN__) throw new Error('no diagrams in the Even Realities plugin')

  if (language === 'flow') return drawFlowchart(code, scheme)
  const mermaid = language === 'sequence' ? sequenceToMermaid(code) : code
  return drawMermaid(pictures ? mermaid : withoutPictures(mermaid), scheme, where, pictures)
}

const PICTURE_TAGS =
  /<\/?(?:img|image|picture|source|video|audio|track|input|feimage|iframe|object|embed)\b[^>]*>/gi

const LOADING_ATTRIBUTE = /\s(?:src|srcset|poster|background)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi

const STYLE_LINE = /^.*\b(?:classDef|style|linkStyle|Update\w*Style)\b.*$/gim

const REACHES_OUT = /url|image|@|\\|expression/i

const PICTURE_SHAPE = /\bimg\b|\\[xuU]/i

const ACTOR_PROPERTIES = /^[ \t]*properties\b.*$/gim

const AWAY_URL = /url\s*\(\s*(?!['"]?#)[^)]*\)/gi

function withoutPictures(code: string): string {
  if (code.includes('@{') && PICTURE_SHAPE.test(code)) {
    throw new Error('a picture shape from elsewhere')
  }
  return code
    .replace(STYLE_LINE, (line) => (REACHES_OUT.test(line) ? '' : line))
    .replace(ACTOR_PROPERTIES, '')
}

const OWN_SECURE = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'suppressErrorRendering',
  'maxEdges',
]

const HELD_SECURE = [
  ...OWN_SECURE,
  'dompurifyConfig',
  'htmlLabels',
  'themeCSS',
  'themeVariables',
  'fontFamily',
  'altFontFamily',
]

const HELD = {
  ALLOWED_TAGS: [
    'a',
    'b',
    'br',
    'code',
    'del',
    'div',
    'em',
    'hr',
    'i',
    'ins',
    'kbd',
    'li',
    'mark',
    'ol',
    'p',
    'pre',
    's',
    'small',
    'span',
    'strong',
    'sub',
    'sup',
    'u',
    'ul',
  ],
  FORBID_ATTR: ['style', 'src', 'srcset', 'background', 'poster'],
}

async function drawMermaid(
  code: string,
  scheme: Scheme,
  where: DiagramFor,
  pictures: boolean,
): Promise<string> {
  const svg = await mermaidSvg(`orden-export-${sequence++}`, code, {
    startOnLoad: false,
    securityLevel: 'strict',
    secure: pictures ? OWN_SECURE : HELD_SECURE,
    theme: scheme === 'light' ? 'default' : 'dark',
    fontFamily: where === 'page' ? PAGE_FONT : FONT,
    htmlLabels: where !== 'page',
    dompurifyConfig: pictures ? {} : HELD,
  })
  return pictures
    ? svg
    : svg.replace(PICTURE_TAGS, '').replace(LOADING_ATTRIBUTE, '').replace(AWAY_URL, 'none')
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
