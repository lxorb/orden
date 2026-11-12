import { sidebarImport } from './sidebar-plan'
import type { ZenSession } from './zen'

const CONTAINERS = 'Containers stay in Zen'

export function zenImport(session: ZenSession, now: Date) {
  return sidebarImport(session, now, CONTAINERS)
}
