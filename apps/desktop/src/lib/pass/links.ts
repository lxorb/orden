import type { Item } from '@orden/pass/types'
import type { LinkRow } from '@orden/pass/wire'
import type { LinkOptions, MadeLink } from './link-make'
import { madeLink } from './link-make'
import { signedSharing } from './share-call'

export { LINK_LIVES, type LinkLife, type LinkOptions, type MadeLink } from './link-make'

export async function createLink(item: Item, options: LinkOptions): Promise<MadeLink> {
  const { api, origin } = signedSharing()
  return await madeLink(api, origin, item, options)
}

export async function links(): Promise<LinkRow[]> {
  return await signedSharing().api.links()
}

export async function removeLink(id: string): Promise<void> {
  await signedSharing().api.removeLink(id)
}

export async function removeExpired(): Promise<number> {
  return await signedSharing().api.removeExpired()
}
