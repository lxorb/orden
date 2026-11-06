import type { Category, Grant, Scope, SiteRule } from '../verbs'

const NEEDS: Partial<Record<Scope, readonly Scope[]>> = {
  'notes.write': ['notes.read'],
  'chats.write': ['chats.read'],
  'workspace.focus': ['workspace'],
  'browser.network': ['browser', 'browser.reader'],
  'browser.script': ['browser', 'browser.reader'],
  'browser.storage': ['browser.reader'],
}

export const SCOPE_GROUPS = [
  { id: 'notes', scopes: ['notes.read', 'notes.write'] },
  { id: 'chats', scopes: ['chats.read', 'chats.write'] },
  { id: 'workspace', scopes: ['context', 'tree', 'workspace', 'workspace.focus'] },
  { id: 'browser', scopes: ['browser', 'browser.network'] },
  { id: 'tabs', scopes: ['browser.reader', 'browser.storage'] },
  { id: 'scripts', scopes: ['browser.script'] },
  { id: 'settings', scopes: ['settings'] },
  { id: 'terminal', scopes: ['terminal'] },
  { id: 'files', scopes: ['files'] },
  { id: 'processes', scopes: ['processes'] },
  { id: 'network', scopes: ['network'] },
  { id: 'clipboard', scopes: ['clipboard'] },
  { id: 'questions', scopes: ['ask'] },
  { id: 'editor', scopes: ['editor'] },
  { id: 'applications', scopes: ['applications'] },
  { id: 'helpers', scopes: ['agents'] },
] as const satisfies readonly { id: string; scopes: readonly Scope[] }[]

export type ScopeGroup = (typeof SCOPE_GROUPS)[number]['id']

const ALL_SCOPES: readonly Scope[] = [
  'context',
  'notes.read',
  'notes.write',
  'chats.read',
  'chats.write',
  'tree',
  'workspace',
  'workspace.focus',
  'browser',
  'browser.reader',
  'browser.script',
  'browser.network',
  'browser.storage',
  'settings',
  'terminal',
  'files',
  'processes',
  'network',
  'clipboard',
  'ask',
  'editor',
  'applications',
  'agents',
]

export const LIMITS = {
  tabs: { min: 1, max: 8, step: 1 },
  calls: { min: 60, max: 1200, step: 60 },
  navigations: { min: 10, max: 300, step: 10 },
  memory: { min: 0, max: 32768, step: 1024 },
} as const

export type Limit = keyof typeof LIMITS

export const LIMIT_NAMES: readonly Limit[] = ['tabs', 'calls', 'navigations', 'memory']

const holds = (scopes: readonly Scope[], scope: Scope) => scopes.includes(scope)

const reachable = (scopes: readonly Scope[], scope: Scope) =>
  (NEEDS[scope] ?? []).length === 0 || (NEEDS[scope] ?? []).some((one) => holds(scopes, one))

export function withScope(grant: Grant, scope: Scope, on: boolean): Grant {
  let scopes = grant.scopes.filter((one) => one !== scope)

  if (on) {
    scopes.push(scope)
    const needs = NEEDS[scope] ?? []
    const first = needs[0]
    if (first && !needs.some((one) => holds(scopes, one)))
      return withScope({ ...grant, scopes }, first, true)
  } else {
    let orphan = scopes.find((one) => !reachable(scopes, one))
    while (orphan !== undefined) {
      const gone = orphan
      scopes = scopes.filter((one) => one !== gone)
      orphan = scopes.find((one) => !reachable(scopes, one))
    }
  }

  return { ...grant, scopes: ALL_SCOPES.filter((one) => holds(scopes, one)) }
}

export const asks = (grant: Grant, category: Category): boolean => grant.asks[category] ?? true

const SIDEBAR = ['Orden · ', 'nib · ']

export const sidebars = (grant: Grant): boolean =>
  SIDEBAR.some((prefix) => grant.client.startsWith(prefix))

export const withName = (grant: Grant, name: string): Grant => {
  const trimmed = name.trim()
  return trimmed ? { ...grant, name: trimmed } : grant
}

export function withLimit(grant: Grant, limit: Limit, value: number): Grant {
  const { min, max, step } = LIMITS[limit]
  const stepped = Math.round((value - min) / step) * step + min
  return { ...grant, limits: { ...grant.limits, [limit]: Math.min(max, Math.max(min, stepped)) } }
}

export function withEverySpace(grant: Grant, every: boolean, spaces: readonly string[]): Grant {
  return { ...grant, spaces: every ? 'all' : [...spaces] }
}

export function withSpace(grant: Grant, space: string, on: boolean): Grant {
  if (grant.spaces === 'all') return grant
  const rest = grant.spaces.filter((one) => one !== space)
  return { ...grant, spaces: on ? [...rest, space] : rest }
}

export const reaches = (grant: Grant, space: string): boolean =>
  grant.spaces === 'all' || grant.spaces.includes(space)

export function withSite(grant: Grant, site: string, rule: SiteRule | null): Grant {
  const sites = Object.fromEntries(Object.entries(grant.sites).filter(([one]) => one !== site))
  return { ...grant, sites: rule === null ? sites : { ...sites, [site]: rule } }
}

export function withoutAlways(grant: Grant, site: string, category: Category): Grant {
  const left = (grant.always[site] ?? []).filter((one) => one !== category)
  const always = Object.fromEntries(Object.entries(grant.always).filter(([one]) => one !== site))
  return { ...grant, always: left.length ? { ...always, [site]: left } : always }
}

export function withListed(
  grant: Grant,
  list: 'scripts' | 'programs',
  word: string,
  on: boolean,
): Grant {
  const trimmed = word.trim()
  const rest = grant[list].filter((one) => one !== trimmed)
  return { ...grant, [list]: on && trimmed ? [...rest, trimmed] : rest }
}

export function sitesOf(
  grant: Grant,
): { site: string; rule: SiteRule | null; always: Category[] }[] {
  const names = [...new Set([...Object.keys(grant.sites), ...Object.keys(grant.always)])].sort()
  return names.map((site) => ({
    site,
    rule: grant.sites[site] ?? null,
    always: grant.always[site] ?? [],
  }))
}

export function trifecta(grant: Grant): boolean {
  const reads = holds(grant.scopes, 'notes.read') || holds(grant.scopes, 'context')
  const browses = holds(grant.scopes, 'browser') || holds(grant.scopes, 'browser.reader')
  return reads && browses
}

export function ownGrant(id: string, client: string, created: number): Grant {
  return {
    id,
    name: client,
    client,
    scopes: ALL_SCOPES.filter(
      (one) => !['browser.script', 'browser.storage', 'settings'].includes(one),
    ),
    spaces: 'all',
    sites: {},
    scripts: [],
    mode: 'unsupervised',
    asks: {},
    always: {},
    programs: [],
    limits: { tabs: 4, calls: 600, navigations: 60, memory: 0 },
    created,
  }
}

export function thirdPartyGrant(id: string, client: string, created: number): Grant {
  const own = ownGrant(id, client, created)
  return {
    ...own,
    scopes: own.scopes.filter(
      (one) =>
        ![
          'context',
          'browser.reader',
          'chats.read',
          'chats.write',
          'agents',
          'terminal',
          'files',
          'processes',
          'network',
          'clipboard',
          'ask',
          'editor',
          'applications',
        ].includes(one),
    ),
    mode: 'confirm',
  }
}
