import { escape } from './html'
import { cardMarkup, iframeCard } from './web-embed'

const SCRIPTED = /<script\b[^>]*>[\s\S]*?<\/script\s*>/i

function isInteractiveHtml(html: string): boolean {
  return SCRIPTED.test(html)
}

const FIRST_HEIGHT = 180

export function htmlBlockCard(html: string): string | null {
  if (!isInteractiveHtml(html)) return null

  return cardMarkup({
    extra: 'embed-html',
    shape: FIRST_HEIGHT,
    data: ` data-srcdoc="${escape(html)}"`,
    mark: 'play',
    name: 'HTML',
    href: null,
  })
}

const ACTS =
  /<(?:script|iframe|frame|frameset|object|embed|applet|meta|base|link|portal)(?=[\s/>]|$)/i

function namesScript(html: string): boolean {
  const decoded = html.replace(
    /&#x([0-9a-f]+);?|&#([0-9]+);?|&(colon|tab|newline);?/gi,
    (whole, hex, decimal, name) => {
      if (name) return { colon: ':', tab: '\t', newline: '\n' }[String(name).toLowerCase()] ?? whole
      const code = hex ? Number.parseInt(String(hex), 16) : Number.parseInt(String(decimal), 10)
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole
    },
  )
  return /(?:java|vb)script:/i.test(decoded.replace(/[\s\p{Cc}\p{Cf}]/gu, ''))
}

export function ownMarkup(html: string): string {
  const carded = html
    .replace(/<\/iframe\s*>/gi, '')
    .replace(/<iframe\b[^>]*>/gi, (tag) => iframeCard(tag) ?? '')

  return ACTS.test(carded) || namesScript(carded) ? escape(html) : carded
}
