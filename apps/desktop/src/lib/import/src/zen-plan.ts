import { sidebarImport } from './sidebar-plan'
import type { ZenSession } from './zen'

const CONTAINERS = 'Containers stay in Zen'
export const zenImport = (session: ZenSession, now: Date) => sidebarImport(session, now, CONTAINERS)
