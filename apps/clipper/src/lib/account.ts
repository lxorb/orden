/** The account, as far as the extension needs to know it: a token, an address,
 *  and the spaces a clip can go to.
 *
 *  The spaces are kept in storage between looks so that the popup has a list to
 *  draw the instant it opens, and the network only ever corrects it. */

import { api, type Space } from './api'
import { remember } from './settings'

export async function refreshSpaces(token: string): Promise<Space[]> {
  const spaces = await api.listSpaces(token)
  await remember({ spaces })

  return spaces
}

/** Where a clip goes when nobody has chosen: the first space in the rail, which
 *  is the one the app opens on. */
export function firstOf(spaces: Space[], chosen: string): string {
  return spaces.some((space) => space.id === chosen) ? chosen : (spaces[0]?.id ?? '')
}
