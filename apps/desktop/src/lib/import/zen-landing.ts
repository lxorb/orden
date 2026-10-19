/** Zen's spaces written into nib's: each into the space of its name, made where
 *  there is none, and an import that has been done before bringing only what is new.
 *
 *  A space of the same name is the same space. Somebody who imports their Zen,
 *  keeps browsing there for a week and imports again wants this week's tabs beside
 *  last week's, not a second `Work` beside the first: so a web note already in the
 *  space at the same place, pointing at the same page (where it is now, or where it
 *  was pinned), is not written again. A space made by this import also takes Zen's
 *  order, icon and colour; one that already existed keeps the order and the icon
 *  somebody gave it.
 *
 *  Each space is written the way every import is (import/apply.ts), so each is one
 *  thing to undo and the file list, the link index and sync all hear of it. See
 *  zen-plan.ts for what becomes what, and sidebar-landing.ts for the writing, which
 *  every browser's import shares. */

import { t } from '../i18n.svelte'
import type { Space } from '../workspace.svelte'
import { landSpaces } from './sidebar-landing'
import { zenProfiles, zenSession, type ZenProfile } from './zen-profiles'
import { zenImport } from './zen-plan'

export { zenProfiles, type ZenProfile }

/** The profile's spaces, written. Answers the first of them, to land in. */
export async function landZen(profile: ZenProfile): Promise<Space> {
  const { spaces, lost } = zenImport(await zenSession(profile), new Date())
  return landSpaces(spaces, lost, t('Zen’s tabs could not be read.'))
}
