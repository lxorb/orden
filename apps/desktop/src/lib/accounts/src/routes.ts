import { ApiError, BASE, request } from './client'
import { isRecord, isString, parsed } from '../../platform/src/api'
import type { Bookmark } from '../../workspace/bookmarks.svelte'
import type { GraphSettings } from '../../workspace/graph-settings.svelte'
import type { Avatar, Status } from './face'

export interface Account {
  id: string
  email: string
  name: string | null
  syncVersion?: number
  avatar?: Avatar | null
  pronouns?: string | null
  bio?: string | null
  status?: Status | null
  zone?: string | null
  hidden?: boolean
  nicks?: Record<string, string>
}

export type SpaceRole = 'owner' | 'write' | 'read'

export type GivenRole = 'write' | 'read'

export interface Guest {
  id: string
  name: string
}

export interface Member {
  id?: string | null
  avatar?: Avatar | null
  email: string | null
  guest: string | null
  name: string | null
  role: GivenRole
  pending: boolean
}

export interface ShareLink {
  url: string
  role: GivenRole
  mode: 'open' | 'approval'
}

interface JoinRequest {
  id?: string | null
  avatar?: Avatar | null
  email: string | null
  guest: string | null
  name: string | null
  role: GivenRole
  at: number
}

export interface Sharing {
  owner: {
    email: string
    name: string | null
    id?: string | null
    avatar?: Avatar | null
  }
  item: { id: string; path: string } | null
  members: Member[]
  requests: JoinRequest[]
  link: ShareLink | null
}

export interface SharedItem {
  id: string
  path: string
  name: string
  role: GivenRole
  updatedAt: number
  owner: { name: string }
  space: { id: string; name: string }
}

export interface Invitation {
  kind: 'invite' | 'link'
  space: string
  note: string | null
  role: GivenRole
  email: string | null
  asks: boolean
  from: string | null
}

export interface Joined {
  token?: string
  user?: Account
  guest?: Guest
  space?: RemoteSpace
  item?: SharedItem
  waiting?: boolean
  declined?: boolean
  second?: boolean
  holding?: string
}

export interface RemoteSpace {
  id: string
  name: string
  position: number
  icon: string | null
  tint?: string | null
  role: SpaceRole
  shared: boolean
  people?: string[]
  sharedItems?: string[]
  onceShared?: boolean
  onceSharedItems?: string[]
  notes: number
  bookmarks: Bookmark[]
  icons: Record<string, string>
  tints?: unknown
  graph: unknown
  excluded: unknown
  arranged: unknown
  archived?: unknown
  sort?: unknown
  createdAt: number
  updatedAt: number
  blog: {
    enabled: boolean
    subdomain: string | null
    domain: string | null
    title: string | null
    note: string | null
    dns: DnsRecord[]
    site: SiteSettings
  }
}

export interface FormAnswer {
  id: string
  note: string
  path: string
  at: number
  answers: Record<string, string>
}

export interface SiteSettings {
  rules: {
    include: string[]
    exclude: string[]
    otherwise: 'all' | 'none'
  }
  description?: string
  image?: string
  icon?: string
  theme?: { name: string; hash: string }
  analytics?: { url: string; domain?: string }
  password: boolean
}

export interface SiteChanges {
  pages: number
  bytes: number
  dressing: { css: boolean; js: boolean }
  before: number
  adds: string[]
  removes: string[]
  more: boolean
}

export interface RemoteNote {
  id: string
  path: string
  seq: number
  version: number
  updatedAt: number
  deleted: boolean
  size: number
  hash: string
}

export interface SecondState {
  on: boolean
  since: number | null
  codesLeft: number
  possible: boolean
}

export interface RemoteSession {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
  current: boolean
}

export interface RemoteVersion {
  at: number
  size: number
  by: string
  hash?: string
}

export interface SpaceFile {
  path: string
  hash: string
}

export interface TrashListing {
  spaces: { id: string; name: string; deletedAt: number; purgeAt: number; notes: number }[]
  notes: {
    id: string
    spaceId: string
    spaceName: string
    path: string
    deletedAt: number
    purgeAt: number
  }[]
}

export interface AccountSettings {
  ligatures?: boolean | string
  look?: unknown
  glassesBreak?: number
  glassesLineNumbers?: boolean
  glassesVoice?: boolean
  glassesCompaction?: string
  glassesMarks?: Record<string, boolean>
  glassesWords?: Record<string, string>
  glassesSeen?: boolean
  mobileSeen?: boolean
  glassesModel?: string
  glassesEffort?: string
  attachments?: string
  remindBefore?: number
  undatedInToday?: boolean
  archivedSpaces?: string[]
  canvasTurns?: boolean
  canvasTurnSnaps?: boolean
  chatKeywords?: string[]
  chatHours?: { days: number[]; from: number; to: number } | null
  chatPreviews?: boolean
  chatSound?: boolean
  shortcuts?: Record<string, string | null>
  preset?: string
  toolbar?: string[] | null
  hiddenKinds?: string[] | null
  vim?: boolean
  recoveryEvery?: number
  recoveryDays?: number
  keepVersions?: number
  conflicts?: string
  highlightTone?: number | null
  hardBreaks?: boolean
  linkFormat?: string
  properties?: string
  quietMarks?: boolean
  silent?: boolean
  developer?: boolean
}

export interface KeyState {
  set: boolean
  tail: string
}

export interface DnsRecord {
  type: string
  name: string
  value: string
  note?: string
}

export interface DomainStatus {
  domain: string | null
  state: 'none' | 'unproved' | 'pending' | 'active' | 'error' | 'unconfigured'
  detail: string | null
  dns: DnsRecord[]
}

function about(item: string): string {
  return item ? `?item=${encodeURIComponent(item)}` : ''
}

const HEARD_WITHIN = 120_000

async function listen(
  token: string,
  wav: Uint8Array<ArrayBuffer>,
  query: string,
): Promise<{ said: string | null; language: string }> {
  const response = await fetch(`${BASE}/v1/ask/heard${query}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/wav' },
    body: wav,
    signal: AbortSignal.timeout(HEARD_WITHIN),
  })

  const body = parsed(await response.text())

  if (!response.ok) {
    const said = isRecord(body) && isString(body.error) ? body.error : null
    throw new ApiError(response.status, said ?? 'could not be heard')
  }

  return body as { said: string | null; language: string }
}

export const routes = {
  requestCode: (email: string) =>
    request<{ ok: true; resendIn: number }>('/v1/auth/code', { body: { email } }),

  verifyCode: (email: string, code: string, guest?: string) =>
    request<{ token?: string; user?: Account; second?: boolean; holding?: string }>(
      '/v1/auth/verify',
      { body: { email, code, ...(guest ? { guest } : {}) }, device: true },
    ),

  verifySecond: (holding: string, code: string) =>
    request<{ token: string; user: Account }>('/v1/auth/second', {
      body: { holding, code },
      device: true,
    }),

  signOut: (token: string) => request<{ ok: true }>('/v1/auth/signout', { method: 'POST', token }),

  second: (token: string) => request<SecondState>('/v1/second', { token }),

  beginSecond: (token: string) =>
    request<{ holding: string; secret: string; uri: string }>('/v1/second', {
      method: 'POST',
      token,
      body: {},
    }),

  confirmSecond: (token: string, holding: string, code: string) =>
    request<{ on: true; recovery: string[] }>('/v1/second/confirm', {
      method: 'POST',
      token,
      body: { holding, code },
    }),

  endSecond: (token: string, code: string) =>
    request<{ on: false }>('/v1/second', { method: 'DELETE', token, body: { code } }),

  freshRecovery: (token: string, code: string) =>
    request<{ recovery: string[] }>('/v1/second/recovery', {
      method: 'POST',
      token,
      body: { code },
    }),

  sessions: (token: string) => request<{ sessions: RemoteSession[] }>('/v1/sessions', { token }),

  endSession: (token: string, id: string) =>
    request<{ ok: boolean }>(`/v1/sessions/${id}`, { method: 'DELETE', token }),

  endOtherSessions: (token: string) =>
    request<{ ended: number }>('/v1/sessions', { method: 'DELETE', token }),

  me: (token: string) => request<{ user?: Account; guest?: Guest }>('/v1/me', { token }),

  rename: (token: string, name: string) =>
    request<{ user?: Account; guest?: Guest }>('/v1/me', {
      method: 'PATCH',
      token,
      body: { name },
    }),

  listSpaces: (token: string) =>
    request<{ spaces: RemoteSpace[]; deleted: string[] }>('/v1/spaces', { token }),

  createSpace: (token: string, name: string) =>
    request<{ space: RemoteSpace }>('/v1/spaces', { token, body: { name } }),

  usage: (token: string) => request<{ used: number; limit: number }>('/v1/usage', { token }),

  settings: (token: string) =>
    request<{ settings: AccountSettings; key: KeyState }>('/v1/settings', { token }),
  saveSettings: (token: string, patch: AccountSettings) =>
    request<{ settings: AccountSettings }>('/v1/settings', {
      method: 'PATCH',
      token,
      body: patch,
    }),

  setAskKey: (token: string, key: string) =>
    request<KeyState>('/v1/ask/key', { method: 'PUT', token, body: { key } }),

  removeAskKey: (token: string) => request<KeyState>('/v1/ask/key', { method: 'DELETE', token }),

  askModels: (token: string) => request<{ models: string[] }>('/v1/ask/models', { token }),

  ask: (token: string, question: string, model: string, effort: string) =>
    request<{ answer: string }>('/v1/ask', { token, body: { question, model, effort } }),

  warm: async (): Promise<void> => {
    await fetch(`${BASE}/health`, { method: 'GET', keepalive: true }).catch(() => undefined)
  },

  askHeard: (token: string, wav: Uint8Array<ArrayBuffer>, like = '') =>
    listen(token, wav, like ? `?like=${encodeURIComponent(like.slice(0, 300))}` : ''),

  askPiece: (token: string, wav: Uint8Array<ArrayBuffer>, like = '') =>
    listen(token, wav, `?piece=1${like ? `&like=${encodeURIComponent(like.slice(0, 300))}` : ''}`),

  putBlob: async (
    token: string,
    hash: string,
    type: string,
    bytes: ArrayBuffer,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(`${BASE}/v1/blobs/${hash}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': type, ...headers },
      body: bytes,
    })

    const body = parsed(await response.text())

    if (!response.ok) {
      const said = isRecord(body) && isString(body.error) ? body.error : null
      throw new ApiError(response.status, said ?? 'upload failed', body)
    }

    return body as { hash: string; stored: boolean }
  },

  holdPaper: (token: string, id: string, hash: string) =>
    request<{ paper: string }>(`/v1/notes/${id}/paper`, { method: 'PUT', token, body: { hash } }),

  notePaper: async (token: string, id: string): Promise<Uint8Array | null> => {
    const response = await fetch(`${BASE}/v1/notes/${id}/paper`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (response.status === 404) return null
    if (!response.ok) throw new ApiError(response.status, `paper not fetched (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  },

  reorderSpaces: (token: string, order: string[]) =>
    request<{ ok: true }>('/v1/spaces/order', { method: 'PUT', token, body: { order } }),

  renameSpace: (token: string, id: string, name: string) =>
    request<{ space: RemoteSpace }>(`/v1/spaces/${id}`, { method: 'PATCH', token, body: { name } }),

  setSpaceIcon: (token: string, id: string, icon: string | null, tint: string | null = null) =>
    request<{ space: RemoteSpace }>(`/v1/spaces/${id}`, {
      method: 'PATCH',
      token,
      body: { icon, tint },
    }),

  saveSpaceFiles: (token: string, id: string, files: SpaceFile[]) =>
    request<{ files: SpaceFile[]; missing: string[] }>(`/v1/spaces/${id}/files`, {
      method: 'PUT',
      token,
      body: { files },
    }),

  saveBookmarks: (token: string, id: string, bookmarks: Bookmark[]) =>
    request<{ bookmarks: Bookmark[] }>(`/v1/spaces/${id}/bookmarks`, {
      method: 'PUT',
      token,
      body: { bookmarks },
    }),

  saveFolderIcons: (
    token: string,
    id: string,
    icons: Record<string, string>,
    tints: Record<string, string>,
  ) =>
    request<{ icons: Record<string, string>; tints: Record<string, string> }>(
      `/v1/spaces/${id}/icons`,
      { method: 'PUT', token, body: { icons, tints } },
    ),

  saveGraphSettings: (token: string, id: string, graph: GraphSettings) =>
    request<{ graph: unknown }>(`/v1/spaces/${id}/graph`, {
      method: 'PUT',
      token,
      body: { graph },
    }),

  saveExcluded: (token: string, id: string, excluded: readonly string[]) =>
    request<{ excluded: string[] }>(`/v1/spaces/${id}/excluded`, {
      method: 'PUT',
      token,
      body: { excluded },
    }),

  saveArranged: (token: string, id: string, arranged: Record<string, readonly string[]>) =>
    request<{ arranged: Record<string, string[]> }>(`/v1/spaces/${id}/arranged`, {
      method: 'PUT',
      token,
      body: { arranged },
    }),

  saveSort: (token: string, id: string, sort: string) =>
    request<{ sort: string }>(`/v1/spaces/${id}/sort`, { method: 'PUT', token, body: { sort } }),

  saveArchived: (token: string, id: string, archived: Readonly<Record<string, number>>) =>
    request<{ archived: Record<string, number> }>(`/v1/spaces/${id}/archived`, {
      method: 'PUT',
      token,
      body: { archived },
    }),

  deleteSpace: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/spaces/${id}`, { method: 'DELETE', token }),

  sharing: (token: string, id: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share${about(item)}`, { token }),

  invite: (token: string, id: string, email: string, role: GivenRole, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/invite${about(item)}`, {
      token,
      body: { email, role },
    }),

  setMemberRole: (token: string, id: string, email: string, role: GivenRole, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/members/${encodeURIComponent(email)}${about(item)}`, {
      method: 'PATCH',
      token,
      body: { role },
    }),

  removeMember: (token: string, id: string, email: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/members/${encodeURIComponent(email)}${about(item)}`, {
      method: 'DELETE',
      token,
    }),

  setShareLink: (token: string, id: string, role: GivenRole, mode: ShareLink['mode'], item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/link${about(item)}`, {
      method: 'PUT',
      token,
      body: { role, mode },
    }),

  revokeShareLink: (token: string, id: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/link${about(item)}`, { method: 'DELETE', token }),

  acceptGuest: (token: string, id: string, guest: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/guests/${encodeURIComponent(guest)}${about(item)}`, {
      method: 'POST',
      token,
    }),

  setGuestRole: (token: string, id: string, guest: string, role: GivenRole, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/guests/${encodeURIComponent(guest)}${about(item)}`, {
      method: 'PATCH',
      token,
      body: { role },
    }),

  removeGuest: (token: string, id: string, guest: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/guests/${encodeURIComponent(guest)}${about(item)}`, {
      method: 'DELETE',
      token,
    }),

  acceptRequest: (token: string, id: string, email: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/requests/${encodeURIComponent(email)}${about(item)}`, {
      method: 'POST',
      token,
    }),

  declineRequest: (token: string, id: string, email: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/requests/${encodeURIComponent(email)}${about(item)}`, {
      method: 'DELETE',
      token,
    }),

  leaveSpace: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/spaces/${id}/share/me`, { method: 'DELETE', token }),

  trustSpace: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/spaces/${id}/share/trust`, { method: 'POST', token }),

  shared: (token: string) => request<{ shared: SharedItem[] }>('/v1/shared', { token }),

  leaveShared: (token: string, noteId: string) =>
    request<{ ok: true }>(`/v1/shared/${encodeURIComponent(noteId)}`, {
      method: 'DELETE',
      token,
    }),

  invitation: (key: string) => request<Invitation>(`/v1/join/${key}`),

  join: (
    key: string,
    options: {
      token?: string
      device?: string
      name?: string
      email?: string
      again?: boolean
    } = {},
  ) =>
    request<Joined>(`/v1/join/${key}`, {
      method: 'POST',
      ...(options.token ? { token: options.token } : {}),
      body: {
        ...(options.device ? { device: options.device } : {}),
        ...(options.name ? { name: options.name } : {}),
        ...(options.email ? { email: options.email } : {}),
        ...(options.again ? { again: true } : {}),
      },
    }),

  withdraw: (key: string, token: string) =>
    request<{ ok: true }>(`/v1/join/${key}`, { method: 'DELETE', token }),

  changes: (token: string, spaceId: string, since: number) =>
    request<{ notes: RemoteNote[]; cursor: number; more: boolean }>(
      `/v1/spaces/${spaceId}/changes?since=${since}`,
      { token },
    ),

  createNote: (token: string, spaceId: string, path: string, content: string) =>
    request<{ note: RemoteNote }>(`/v1/spaces/${spaceId}/notes`, {
      token,
      body: { path, content },
      device: true,
    }),

  readNote: (token: string, id: string) =>
    request<{ note: RemoteNote; content: string }>(`/v1/notes/${id}`, { token }),

  writeNote: (token: string, id: string, path: string, content: string, baseVersion: number) =>
    request<{ note: RemoteNote }>(`/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { path, content, baseVersion },
      device: true,
    }),

  noteVersions: (token: string, id: string) =>
    request<{ versions: RemoteVersion[] }>(`/v1/notes/${id}/versions`, { token }),

  noteVersion: (token: string, id: string, at: number) =>
    request<{ at: number; content: string }>(`/v1/notes/${id}/versions/${at}`, { token }),

  said: (token: string, notes: readonly { id: string; hash: string }[]) =>
    request<{ said: string[] }>('/v1/notes/said', { token, body: { notes } }),

  saidAs: (token: string, id: string, hash: string) =>
    request<{ content: string }>(`/v1/notes/${id}/said/${hash}`, { token }),

  rollback: (token: string, spaceId: string, at: number, under = '', dry = false) =>
    request<{
      notes: number
      paths?: string[]
      more?: boolean
      partial?: boolean
      left?: number
    }>(`/v1/spaces/${spaceId}/rollback`, {
      token,
      body: { at, under, dry },
      device: true,
    }),

  deleteNote: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/notes/${id}`, { method: 'DELETE', token }),

  trash: (token: string) => request<TrashListing>('/v1/trash', { token }),
  restoreNote: (token: string, id: string) =>
    request<{ note: RemoteNote }>(`/v1/trash/notes/${id}/restore`, { method: 'POST', token }),
  restoreSpace: (token: string, id: string) =>
    request<{ space: RemoteSpace }>(`/v1/trash/spaces/${id}/restore`, { method: 'POST', token }),
  purgeNote: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/trash/notes/${id}`, { method: 'DELETE', token }),
  purgeSpace: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/trash/spaces/${id}`, { method: 'DELETE', token }),
  emptyTrash: (token: string) => request<{ ok: true }>('/v1/trash', { method: 'DELETE', token }),

  subdomainAvailable: (token: string, subdomain: string, space?: string) =>
    request<{ available: boolean; reason?: string }>(
      `/v1/spaces/available/${subdomain}${space ? `?space=${encodeURIComponent(space)}` : ''}`,
      { token },
    ),

  publish: (
    token: string,
    spaceId: string,
    settings: { subdomain?: string; domain?: string; title?: string; note?: string | null },
  ) =>
    request<{ space: RemoteSpace; dns: DnsRecord[] }>(`/v1/spaces/${spaceId}/blog`, {
      method: 'PUT',
      token,
      body: settings,
    }),

  unpublish: (token: string, spaceId: string) =>
    request<{ ok: true }>(`/v1/spaces/${spaceId}/blog`, { method: 'DELETE', token }),

  site: (
    token: string,
    spaceId: string,
    settings: {
      rules?: SiteSettings['rules']
      description?: string
      image?: string
      icon?: string
      theme?: { name: string; hash: string } | null
      analytics?: { url: string; domain?: string } | null
      password?: string | null
    },
  ) =>
    request<{ space: RemoteSpace; site: SiteSettings }>(`/v1/spaces/${spaceId}/site`, {
      method: 'PUT',
      token,
      body: settings,
    }),

  answers: (token: string, spaceId: string) =>
    request<{
      answers: FormAnswer[]
      more: boolean
      keptDays?: number
      full?: boolean
    }>(`/v1/spaces/${spaceId}/answers`, { token }),

  answersCsv: async (token: string, spaceId: string) => {
    const response = await fetch(`${BASE}/v1/spaces/${spaceId}/answers.csv`, {
      headers: { authorization: `Bearer ${token}` },
    })

    if (!response.ok) throw new ApiError(response.status, 'could not read the answers')
    return response.text()
  },

  forgetAnswer: (token: string, spaceId: string, id: string) =>
    request<{ ok: true }>(`/v1/spaces/${spaceId}/answers/${id}`, { method: 'DELETE', token }),

  sitePreview: (token: string, spaceId: string, rules: SiteSettings['rules']) =>
    request<SiteChanges>(`/v1/spaces/${spaceId}/site/preview`, {
      method: 'POST',
      token,
      body: { rules },
    }),

  domainStatus: (token: string, spaceId: string) =>
    request<DomainStatus>(`/v1/spaces/${spaceId}/blog/domain`, { token }),

  verifyDomain: (token: string, spaceId: string) =>
    request<DomainStatus>(`/v1/spaces/${spaceId}/blog/domain/verify`, {
      method: 'POST',
      token,
    }),

  connector: (token: string) =>
    request<{
      exists: boolean
      readOnly: boolean
      lastUsedAt: number | null
      clients: {
        id: string
        name: string
        readOnly: boolean
        createdAt: number
        lastUsedAt: number | null
      }[]
    }>('/v1/mcp/token', { token }),

  disconnectClient: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/mcp/clients/${id}`, { method: 'DELETE', token }),

  issueConnector: (token: string, readOnly: boolean) =>
    request<{ token: string }>('/v1/mcp/token', { token, body: { readOnly } }),

  revokeConnector: (token: string) =>
    request<{ ok: true }>('/v1/mcp/token', { method: 'DELETE', token }),

  siteIcons: (token: string) => request<{ sites: SiteIcon[] }>('/v2/site-icons', { token }),

  sawSite: (
    token: string,
    site: { site: string; label: string; icon: string | null; seen: number },
  ) => request<{ site: SiteIcon | null }>('/v2/site-icons', { token, body: site }),

  forgetSites: (token: string, which: { sites: string[] } | { since: number }) =>
    request<{ ok: true }>('/v2/site-icons', { method: 'DELETE', token, body: which }),

  siteIconPicture: async (token: string, site: string): Promise<string | null> => {
    const response = await fetch(`${BASE}/v2/site-icons/${encodeURIComponent(site)}/picture`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!response.ok) return null

    const type = response.headers.get('content-type') ?? 'image/png'
    if (!type.startsWith('image/')) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    let text = ''
    for (let at = 0; at < bytes.length; at += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
    }
    return `data:${type};base64,${btoa(text)}`
  },
}

export interface SiteIcon {
  site: string
  label: string
  seen: number
  hash: string | null
}
