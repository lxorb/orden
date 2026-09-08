/** Typed client for the sync service. Every call carries the session token;
 *  nothing here touches cookies, so it works the same in the app and the web. */

import { isRecord, isString, parsed } from './stored'
import type { Bookmark } from './workspace/bookmarks.svelte'

export const BASE: string = import.meta.env.VITE_NIB_API ?? 'https://nibeditor.com'

export interface Account {
  id: string
  email: string
  /** Shown on anything the account publishes. Null until chosen. */
  name: string | null
}

/** What this account may do in a space: its own, one somebody shared to write
 *  in, or one shared to read. */
export type SpaceRole = 'owner' | 'write' | 'read'

/** A role a person can be given. The third is being the owner, which is not
 *  something anybody is given. */
export type GivenRole = 'write' | 'read'

/** One person a space was shared with. */
export interface Member {
  email: string
  /** The name on their account, once they have one and have chosen one. */
  name: string | null
  role: GivenRole
  /** Nobody has opened the space under that address yet. */
  pending: boolean
}

/** The one link a space has, when it has one. */
export interface ShareLink {
  url: string
  role: GivenRole
  /** `open` lets in anybody who has it; `approval` turns it into a request. */
  mode: 'open' | 'approval'
}

/** Somebody who followed a link that asks first. */
interface JoinRequest {
  email: string
  name: string | null
  role: GivenRole
  at: number
}

/** Who else may reach a space, which is the whole of what the Share sheet
 *  draws and what every change to it answers with. */
export interface Sharing {
  owner: { email: string; name: string | null }
  members: Member[]
  requests: JoinRequest[]
  link: ShareLink | null
}

/** What a link somebody was sent leads to, answered before there is a session,
 *  because it is what the page shows while they prove their address. */
export interface Invitation {
  kind: 'invite' | 'link'
  /** The space's name. */
  space: string
  role: GivenRole
  /** The address an invitation was written to, so the sign-in is filled in.
   *  Null for a link, which is for whoever has it. */
  email: string | null
  /** The link asks the owner before it lets anybody in. */
  asks: boolean
  /** What to call whoever shared it. */
  from: string | null
}

export interface RemoteSpace {
  id: string
  name: string
  /** Where it sits in the rail, shared across machines. */
  position: number
  icon: string | null
  /** What this account may do here. Everything the app offers in a space asks
   *  this first, so a reader is never shown a button that would be refused. */
  role: SpaceRole
  /** Whether anybody besides the owner is in it, which is the mark in the rail. */
  shared: boolean
  /** What is kept above the space's file list, in the order it appears. */
  bookmarks: Bookmark[]
  createdAt: number
  updatedAt: number
  blog: {
    enabled: boolean
    subdomain: string | null
    domain: string | null
    title: string | null
    note: string | null
    /** What to add at the registrar for a domain of one's own. Empty otherwise. */
    dns: DnsRecord[]
  }
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

/** A file a space keeps beside its notes: where it sits, and the blob holding
 *  its bytes. Today a PDF, so that a published note linking one can serve it. */
export interface SpaceFile {
  /** Relative to the space, `/`-separated. */
  path: string
  /** The hash of its contents, which is also the blob's name. */
  hash: string
}

/** What Recently deleted holds on the account. */
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

/** The settings that follow the account from machine to machine. Each is
 *  there once chosen; a missing one means the machine's own choice stands. */
export interface AccountSettings {
  /** How much of a note the ligature glyphs are drawn over. A boolean is what
   *  a build that had a switch here wrote, and still reads. */
  ligatures?: boolean | string
  /** How a note reaches the Even Realities glasses: `rendered` or `text`. A
   *  preference about reading, so it follows the account rather than the
   *  machine; see modes.svelte.ts. */
  glassesDisplay?: string
  /** Where a pasted picture is written; one of attachments.ts's three. */
  attachments?: string
  /** Keys the reader chose, by shortcut id, as differences from the defaults.
   *  Null where they took a key away. Only the differences travel: a full
   *  dump would freeze today's defaults into every account that ever saved
   *  one, and a default that changed later would never reach anybody. */
  shortcuts?: Record<string, string | null>
  /** Which keyboard the map above is: one of shortcuts/presets.ts, or
   *  `custom` for a map somebody put together themselves. */
  preset?: string
  /** Modal editing, which is a mode rather than a map: it can be on over any
   *  of the presets. */
  vim?: boolean
  /** Minutes between the versions kept while a note is being written in, and
   *  how many days a version is kept for. Zero minutes is off; see
   *  recovery.ts. */
  recoveryEvery?: number
  recoveryDays?: number
}

export interface DnsRecord {
  type: string
  name: string
  value: string
  /** Only when there is something to say - at the root of a domain, where
   *  a plain CNAME is not always allowed. */
  note?: string
}

/** How far along a domain of one's own is. `none` when the space has no
 *  domain; `unconfigured` when the server records domains but does not ask
 *  for certificates. `detail` is Cloudflare's own words, when it has some. */
export interface DomainStatus {
  domain: string | null
  state: 'none' | 'pending' | 'active' | 'error' | 'unconfigured'
  detail: string | null
  dns: DnsRecord[]
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message)
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })

  const body = parsed(await response.text())

  if (!response.ok) {
    // The server says why in `error` when it can. When it cannot - a proxy
    // between here and there, say - the status is all there is to go on.
    const said = isRecord(body) && isString(body.error) ? body.error : null
    throw new ApiError(response.status, said ?? `request failed (${response.status})`, body)
  }

  // The service is the other half of this repo and answers the shapes above;
  // checking each one field by field here would be a second copy of its types.
  return body as T
}

export const api = {
  requestCode: (email: string) =>
    request<{ ok: true; resendIn: number }>('/v1/auth/code', { body: { email } }),

  verifyCode: (email: string, code: string) =>
    request<{ token: string; user: Account }>('/v1/auth/verify', { body: { email, code } }),

  signOut: (token: string) => request<{ ok: true }>('/v1/auth/signout', { method: 'POST', token }),

  me: (token: string) => request<{ user: Account }>('/v1/me', { token }),

  /** An empty name takes it away again. */
  rename: (token: string, name: string) =>
    request<{ user: Account }>('/v1/me', { method: 'PATCH', token, body: { name } }),

  listSpaces: (token: string) =>
    request<{ spaces: RemoteSpace[]; deleted: string[] }>('/v1/spaces', { token }),

  createSpace: (token: string, name: string) =>
    request<{ space: RemoteSpace }>('/v1/spaces', { token, body: { name } }),

  usage: (token: string) => request<{ used: number; limit: number }>('/v1/usage', { token }),

  settings: (token: string) => request<{ settings: AccountSettings }>('/v1/settings', { token }),
  saveSettings: (token: string, patch: AccountSettings) =>
    request<{ settings: AccountSettings }>('/v1/settings', { method: 'PATCH', token, body: patch }),

  /** Named by its own hash, so a repeat costs one request and no storage. */
  putBlob: async (token: string, hash: string, type: string, bytes: ArrayBuffer) => {
    const response = await fetch(`${BASE}/v1/blobs/${hash}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': type },
      body: bytes,
    })

    const body = parsed(await response.text())

    if (!response.ok) {
      const said = isRecord(body) && isString(body.error) ? body.error : null
      throw new ApiError(response.status, said ?? 'upload failed')
    }

    return body as { hash: string; stored: boolean }
  },

  reorderSpaces: (token: string, order: string[]) =>
    request<{ ok: true }>('/v1/spaces/order', { method: 'PUT', token, body: { order } }),

  renameSpace: (token: string, id: string, name: string) =>
    request<{ space: RemoteSpace }>(`/v1/spaces/${id}`, { method: 'PATCH', token, body: { name } }),

  setSpaceIcon: (token: string, id: string, icon: string | null) =>
    request<{ space: RemoteSpace }>(`/v1/spaces/${id}`, { method: 'PATCH', token, body: { icon } }),

  /** The whole list of what a space keeps beside its notes. Answers which of the
   *  hashes the account has no blob for yet, so a thirty megabyte PDF is sent
   *  once rather than on every pass. */
  saveSpaceFiles: (token: string, id: string, files: SpaceFile[]) =>
    request<{ files: SpaceFile[]; missing: string[] }>(`/v1/spaces/${id}/files`, {
      method: 'PUT',
      token,
      body: { files },
    }),

  /** The whole list, in its order: reordering is a change to the list itself,
   *  so there is nothing smaller worth sending. */
  saveBookmarks: (token: string, id: string, bookmarks: Bookmark[]) =>
    request<{ bookmarks: Bookmark[] }>(`/v1/spaces/${id}/bookmarks`, {
      method: 'PUT',
      token,
      body: { bookmarks },
    }),

  deleteSpace: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/spaces/${id}`, { method: 'DELETE', token }),

  // Sharing a space. Every one of these answers with the whole of who may reach
  // it, so the sheet is drawn from what came back rather than from a guess
  // about what the change did.
  sharing: (token: string, id: string) => request<Sharing>(`/v1/spaces/${id}/share`, { token }),

  invite: (token: string, id: string, email: string, role: GivenRole) =>
    request<Sharing>(`/v1/spaces/${id}/share/invite`, { token, body: { email, role } }),

  setMemberRole: (token: string, id: string, email: string, role: GivenRole) =>
    request<Sharing>(`/v1/spaces/${id}/share/members/${encodeURIComponent(email)}`, {
      method: 'PATCH',
      token,
      body: { role },
    }),

  removeMember: (token: string, id: string, email: string) =>
    request<Sharing>(`/v1/spaces/${id}/share/members/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      token,
    }),

  setShareLink: (token: string, id: string, role: GivenRole, mode: ShareLink['mode']) =>
    request<Sharing>(`/v1/spaces/${id}/share/link`, { method: 'PUT', token, body: { role, mode } }),

  revokeShareLink: (token: string, id: string) =>
    request<Sharing>(`/v1/spaces/${id}/share/link`, { method: 'DELETE', token }),

  acceptRequest: (token: string, id: string, email: string) =>
    request<Sharing>(`/v1/spaces/${id}/share/requests/${encodeURIComponent(email)}`, {
      method: 'POST',
      token,
    }),

  declineRequest: (token: string, id: string, email: string) =>
    request<Sharing>(`/v1/spaces/${id}/share/requests/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      token,
    }),

  /** Letting yourself out of a space somebody shared. The owner's own space
   *  cannot be left, only deleted. */
  leaveSpace: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/spaces/${id}/share/me`, { method: 'DELETE', token }),

  /** What a link leads to. No session: this is what the page shows somebody who
   *  has not signed in, which is most of the people who follow one. */
  invitation: (key: string) => request<Invitation>(`/v1/join/${key}`),

  /** Walking through it, with the address already proved. Answers the space, or
   *  that the owner has been asked. */
  join: (token: string, key: string) =>
    request<{ space?: RemoteSpace; waiting?: boolean }>(`/v1/join/${key}`, {
      method: 'POST',
      token,
    }),

  changes: (token: string, spaceId: string, since: number) =>
    request<{ notes: RemoteNote[]; cursor: number; more: boolean }>(
      `/v1/spaces/${spaceId}/changes?since=${since}`,
      { token },
    ),

  createNote: (token: string, spaceId: string, path: string, content: string) =>
    request<{ note: RemoteNote }>(`/v1/spaces/${spaceId}/notes`, {
      token,
      body: { path, content },
    }),

  readNote: (token: string, id: string) =>
    request<{ note: RemoteNote; content: string }>(`/v1/notes/${id}`, { token }),

  writeNote: (token: string, id: string, path: string, content: string, baseVersion: number) =>
    request<{ note: RemoteNote }>(`/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { path, content, baseVersion },
    }),

  deleteNote: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/notes/${id}`, { method: 'DELETE', token }),

  // Recently deleted.
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

  /** `space` is the one being published: a name it already holds is free for
   *  it, and would otherwise read as taken by itself. */
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

  domainStatus: (token: string, spaceId: string) =>
    request<DomainStatus>(`/v1/spaces/${spaceId}/blog/domain`, { token }),

  /** The clients that signed in through the connector, and whether a pasted
   *  token exists. The secret itself is never handed back. */
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
}

/** Where an LLM client points to reach these notes. */
export const MCP_URL = `${BASE}/mcp`
