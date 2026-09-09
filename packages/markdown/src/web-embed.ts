/** The card a `![](https://youtube.com/watch?v=…)` becomes.
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
import { type WebEmbed, webEmbed } from './providers'

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
  // Sixteen by nine, or a height in pixels. The number is this file's own, not
  // the note's, so it goes into the attribute as it stands.
  const wide = provider.shape === 'video'
  const shape = wide ? '' : ` style="--embed-height: ${provider.shape}px"`
  const mark = iconMarkup(MARKS[provider.mark], 'embed-icon')

  return (
    `<span class="embed-web${wide ? ' embed-wide' : ''}"${shape}${frameData(embed)}>` +
    // `noreferrer` as well as `noopener`: the provider gets to know a reader
    // asked for this, and nothing about where they asked from.
    `<a class="embed-play" href="${attributeUrl(embed.href)}"` +
    ' target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer">' +
    `${mark}<span class="embed-name">${escape(provider.name)}</span></a></span>`
  )
}
