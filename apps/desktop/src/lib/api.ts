/** Typed client for the sync service. Every call carries the session token;
 *  nothing here touches cookies, so it works the same in the app and the web. */

export const BASE = import.meta.env.VITE_NIB_API ?? 'https://nibeditor.com'

export interface Account {
  id: string
  email: string
  /** Shown on anything the account publishes. Null until chosen. */
  name: string | null
}

export interface RemoteSpace {
  id: string
  name: string
  /** Where it sits in the rail, shared across machines. */
  position: number
  icon: string | null
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

export interface DnsRecord {
  type: string
  name: string
  value: string
  note: string
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
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  const text = await response.text()
  const parsed = text ? safeParse(text) : null

  if (!response.ok) {
    const message =
      (parsed as { error?: string } | null)?.error ?? `request failed (${response.status})`
    throw new ApiError(response.status, message, parsed)
  }

  return parsed as T
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
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

  /** Named by its own hash, so a repeat costs one request and no storage. */
  putBlob: async (token: string, hash: string, type: string, bytes: ArrayBuffer) => {
    const response = await fetch(`${BASE}/v1/blobs/${hash}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': type },
      body: bytes,
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}) as { error?: string })
      throw new ApiError(response.status, (body as { error?: string }).error ?? 'upload failed')
    }

    return response.json() as Promise<{ hash: string; stored: boolean }>
  },

  reorderSpaces: (token: string, order: string[]) =>
    request<{ ok: true }>('/v1/spaces/order', { method: 'PUT', token, body: { order } }),

  renameSpace: (token: string, id: string, name: string) =>
    request<{ space: RemoteSpace }>(`/v1/spaces/${id}`, { method: 'PATCH', token, body: { name } }),

  setSpaceIcon: (token: string, id: string, icon: string | null) =>
    request<{ space: RemoteSpace }>(`/v1/spaces/${id}`, { method: 'PATCH', token, body: { icon } }),

  deleteSpace: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/spaces/${id}`, { method: 'DELETE', token }),

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

  subdomainAvailable: (token: string, subdomain: string) =>
    request<{ available: boolean; reason?: string }>(`/v1/spaces/available/${subdomain}`, { token }),

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

  /** Whether a connector token exists. The secret itself is never handed back. */
  connector: (token: string) =>
    request<{ exists: boolean; readOnly: boolean; lastUsedAt: number | null }>('/v1/mcp/token', {
      token,
    }),

  issueConnector: (token: string, readOnly: boolean) =>
    request<{ token: string }>('/v1/mcp/token', { token, body: { readOnly } }),

  revokeConnector: (token: string) =>
    request<{ ok: true }>('/v1/mcp/token', { method: 'DELETE', token }),
}

/** Where an LLM client points to reach these notes. */
export const MCP_URL = `${BASE}/mcp`
