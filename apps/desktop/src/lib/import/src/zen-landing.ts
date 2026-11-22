import type { Space } from '../../workspace/src/api'
import type { Landed } from './run.svelte'
import { bringHistory, droppedLine, takeEngine, withMarks } from './browser-extras'
import { landSpaces } from './sidebar-landing'
import { zenSession, type ZenProfile } from './zen-profiles'
import { zenImport } from './zen-plan'

export async function landZen(profile: ZenProfile, told?: Landed): Promise<Space> {
  const read = await zenSession(profile)
  const sidebar = await withMarks(read.sidebar, 'zen', profile.path)
  const { spaces, lost } = zenImport(sidebar, new Date())
  const engine = await takeEngine(read.engine, 'Zen')
  const first = await landSpaces(
    spaces,
    [...lost, ...droppedLine(sidebar), ...engine],
    'Zen’s tabs could not be read.',
    told,
  )
  const history = () => bringHistory('zen', profile.path)
  if (told) told.later.push(history)
  else await history()
  return first
}
