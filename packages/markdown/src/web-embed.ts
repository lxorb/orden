import { attributeUrl, escape, safeHref } from './html'
import { iconMarkup, MARKS } from './icons'
import { type Shape, type WebEmbed, webEmbed } from './providers'

interface CardShell {
  extra: string
  shape: Shape
  data: string
  mark: 'play' | 'open'
  name: string
  href: string | null
}

export function cardMarkup(shell: CardShell): string {
  const wide = shell.shape === 'video'
  const classes = [
    'embed-web',
    ...(wide ? ['embed-wide'] : []),
    ...(shell.extra ? [shell.extra] : []),
  ]
  const shape = wide ? '' : ` style="--embed-height: ${shell.shape}px"`
  const label =
    iconMarkup(MARKS[shell.mark], 'embed-icon') +
    `<span class="embed-name">${escape(shell.name)}</span>`

  const inner =
    shell.href === null
      ? `<span class="embed-play" role="button" tabindex="0">${label}</span>`
      : `<a class="embed-play" href="${attributeUrl(shell.href)}"` +
        ' target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer">' +
        `${label}</a>`

  return `<span class="${classes.join(' ')}"${shape}${shell.data}>${inner}</span>`
}

function frameData(embed: WebEmbed): string {
  const { provider, frame } = embed
  const allow = provider.allow === undefined ? '' : ` data-allow="${escape(provider.allow)}"`

  return (
    ` data-provider="${escape(provider.id)}"` +
    ` data-frame="${attributeUrl(frame)}"` +
    ` data-sandbox="${escape(provider.sandbox)}"` +
    allow
  )
}

export function webCard(address: string): string | null {
  const embed = webEmbed(address)
  if (embed === null || !safeHref(embed.href)) return null

  const { provider } = embed
  return cardMarkup({
    extra: '',
    shape: provider.shape,
    data: frameData(embed),
    mark: provider.mark,
    name: provider.name,
    href: embed.href,
  })
}

const BY_HAND = 'allow-scripts'

function attribute(tag: string, name: string): string | null {
  const found = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>\`]+))`, 'i').exec(
    tag,
  )
  const value = found?.[1] ?? found?.[2] ?? found?.[3]
  if (value === undefined) return null

  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&amp;/gi, '&')
}

function askedHeight(tag: string): Shape {
  const written = Number(attribute(tag, 'height') ?? NaN)
  return Number.isInteger(written) && written >= 80 && written <= 1200 ? written : 'video'
}

function domainOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

const OPENING = /\s*<\/?iframe\b(?:"[^"]*"|'[^']*'|[^'">])*>?/iy

const CLOSING = /<\/iframe\s*>/gi

export function iframesAhead(html: string): { tags: string[]; rest: string } {
  const tags: string[] = []
  let at = 0
  let closers = true
  for (;;) {
    OPENING.lastIndex = at
    const opening = OPENING.exec(html)
    if (!opening) break

    let end = at + opening[0].length
    if (closers && !/^\s*<\//.test(opening[0])) {
      CLOSING.lastIndex = end
      const closing = CLOSING.exec(html)
      if (closing) end = closing.index + closing[0].length
      else closers = false
    }
    tags.push(html.slice(at, end))
    at = end
  }
  return { tags, rest: html.slice(at) }
}

export function iframeCard(tag: string): string | null {
  if (!/^\s*<iframe\b/i.test(tag)) return null

  const src = attribute(tag, 'src')
  if (src === null) return null

  let url: URL
  try {
    url = new URL(src.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null

  const address = url.toString()
  const known = webCard(address)
  if (known !== null) return known

  return cardMarkup({
    extra: 'embed-page',
    shape: askedHeight(tag),
    data:
      ' data-provider="page"' +
      ` data-frame="${attributeUrl(address)}"` +
      ` data-sandbox="${BY_HAND}"`,
    mark: 'play',
    name: domainOf(url),
    href: address,
  })
}
