/** The card a `![](https://youtube.com/watch?v=…)` becomes, and the same card for
 *  an `<iframe src="…">` a note wrote by hand.
 *
 *  Nothing is loaded from anybody else until the reader asks for it. Opening a
 *  note that mentions ten videos should tell ten companies nothing at all, and a
 *  note is read far more often than its videos are watched. So what the renderer
 *  writes is never the frame: it is a card the size the frame will be, saying
 *  whose page it stands for, and carrying the address in an attribute where
 *  nothing fetches it.
 *
 *  The card is a real link. That is what makes one piece of markup right on every
 *  surface: in the app a click swaps the frame in, and on a published page - which
 *  runs no script of any kind, and is not about to start - the same click takes
 *  the reader to the page itself. Neither reading needs the other to exist, and
 *  the page is honest without any script at all.
 *
 *  A `<span>` rather than a `<figure>`, so it is legal inside the paragraph a
 *  `![](…)` on its own line makes. The stylesheet gives it a block of its own. */

import { attributeUrl, escape, safeHref } from './html'
import { iconMarkup, MARKS } from './icons'
import { type Shape, type WebEmbed, webEmbed } from './providers'

/** What every card is: the room it takes, what pressing it does, and the
 *  attributes the app builds the frame from. */
interface CardShell {
  /** Classes beyond `embed-web`, for a kind of card the stylesheet or a drive
   *  has to be able to name. */
  extra: string
  shape: Shape
  /** The `data-` attributes, already escaped, that say what to frame. */
  data: string
  mark: 'play' | 'open'
  /** The one line the card says. A provider's name, a host, or what a block of
   *  the note's own markup is. */
  name: string
  /** Where a reader with no script goes instead. Null for a card that stands for
   *  the note's own HTML, which is nowhere else to be found: that one is a
   *  button, because a link to nothing is worse than no link. */
  href: string | null
}

/** The markup every card shares, so a second kind of card cannot drift into
 *  being a second design. */
export function cardMarkup(shell: CardShell): string {
  // Sixteen by nine, or a height in pixels. The number is never the note's own
  // beyond the reading below, so it goes into the attribute as it stands.
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
      : // `noreferrer` as well as `noopener`: the provider gets to know a reader
        // asked for this, and nothing about where they asked from.
        `<a class="embed-play" href="${attributeUrl(shell.href)}"` +
        ' target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer">' +
        `${label}</a>`

  return `<span class="${classes.join(' ')}"${shape}${shell.data}>${inner}</span>`
}

/** The attributes the card carries so the app can build the frame from it, and
 *  the reason each one is on the card rather than decided by the app: the sandbox
 *  and the permissions belong to the provider, and the provider is known here. */
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

/** The card for an address, or null when the address is a link like any other. */
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

/** The least a page nobody vouched for may have.
 *
 *  A provider's row can ask for more because the table promises what that frame
 *  needs; an address a note wrote by hand has promised nothing, so it gets
 *  scripts - without which most embeds are a blank box - and not one thing more.
 *  No `allow-same-origin`, no forms, no navigating the window it sits in. */
const BY_HAND = 'allow-scripts'

/** An attribute of a tag, with the entities a note may have written in it read
 *  back. Everything this hands out goes through `attributeUrl` or `escape`
 *  before it reaches the page again. */
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

/** The room an `<iframe>` asked for, when it asked in pixels and asked for
 *  something a page can spare. Anything else is sixteen by nine, which is what
 *  most of what anybody frames turns out to be. */
function askedHeight(tag: string): Shape {
  const written = Number(attribute(tag, 'height') ?? NaN)
  return Number.isInteger(written) && written >= 80 && written <= 1200 ? written : 'video'
}

/** The host as a reader would name it: lowercased, without `www.`. */
function domainOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

/** Whether a piece of raw HTML is an `<iframe>` tag, either half of one.
 *
 *  Asked because such a tag is the card or it is nothing: see the renderer's
 *  `html` in index.ts. A closing tag has to go the same way its opener did, or a
 *  card would be followed by a stray `</iframe>` - text on a published page, and
 *  a tag the parser silently drops in the app. */
export function isIframeTag(html: string): boolean {
  return /^\s*<\/?iframe\b/i.test(html)
}

/** The card an `<iframe src="…">` in a note becomes.
 *
 *  The same card, deliberately. A note that writes the tag by hand is asking for
 *  exactly what a provider's address asks for - that page, here - and it should
 *  not get a different bargain: nothing fetched until a tap, the frame sandboxed
 *  when it does arrive, and a link on any surface that cannot build one.
 *
 *  What the card says comes out of the address and nothing else. Asking the page
 *  for its title would be a request to a third party made because a note was
 *  opened, which is the thing this whole file exists to avoid; so the card says
 *  the domain, which the address already told us.
 *
 *  Only `https`, and null for everything else: a `javascript:` or `data:` frame
 *  is a document of the author's own running where the note is, a relative one is
 *  a page of this app's own inside the note, and an `http:` one is the page read
 *  over the reader's shoulder. What the renderer does with a null is drop the tag
 *  rather than keep it; see `html` in index.ts. */
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
  // An address one of the providers answers for is that row's card: a narrower
  // sandbox, the permissions its player needs, and a name rather than a host.
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
