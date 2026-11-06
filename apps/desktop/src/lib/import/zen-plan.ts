import { key } from '../i18n.svelte'
import type { Lost } from './plan'
import { sidebarImport } from './sidebar-plan'
import type { ZenSession } from './zen'

const CONTAINERS: Lost = { text: key('Containers stay in Zen') }

export function zenImport(session: ZenSession, now: Date) {
  return sidebarImport(session, now, CONTAINERS)
}
