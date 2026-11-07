import { newKey } from '@orden/pass/crypto'
import type { Item } from '@orden/pass/types'
import type { LinkRow } from '@orden/pass/wire'
import { linkUrl, newLinkId, sealedLink } from './link-seal'
import type { ShareApi } from './share-api'

const HOUR = 3600e3
const DAY = 24 * HOUR

export const LINK_LIVES = [HOUR, DAY, 7 * DAY, 14 * DAY, 30 * DAY] as const

export type LinkLife = (typeof LINK_LIVES)[number]

export interface LinkOptions {
  expires: LinkLife
  views: number | null
}

export interface MadeLink {
  url: string
  link: LinkRow
}

export async function madeLink(
  api: ShareApi,
  origin: string,
  item: Pick<Item, 'id' | 'vault' | 'content'>,
  options: LinkOptions,
  now: number = Date.now(),
): Promise<MadeLink> {
  const key = newKey()
  const id = newLinkId()
  const body = await sealedLink(key, id, item.content)
  const link = await api.createLink({
    id,
    vault: item.vault,
    item: item.id,
    body,
    expires: now + options.expires,
    views: options.views,
  })
  return { url: linkUrl(origin, id, key), link }
}
