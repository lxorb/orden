import { t } from '../i18n.svelte'
import type { Space } from '../workspace.svelte'
import { bringHistory, droppedLine, folderWords, takeEngine, withMarks } from './browser-extras'
import { landSpaces } from './sidebar-landing'
import { zenProfiles, zenSession, type ZenProfile } from './zen-profiles'
import { zenImport } from './zen-plan'

export { zenProfiles, type ZenProfile }

export async function landZen(profile: ZenProfile): Promise<Space> {
  const read = await zenSession(profile, folderWords())
  const sidebar = await withMarks(read.sidebar, 'zen', profile.path)
  const { spaces, lost } = zenImport(sidebar, new Date())
  const engine = await takeEngine(read.engine, 'Zen')
  const first = await landSpaces(
    spaces,
    [...lost, ...droppedLine(sidebar), ...engine],
    t('Zen’s tabs could not be read.'),
  )
  await bringHistory('zen', profile.path)
  return first
}
