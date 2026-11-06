import { door } from '@orden/markdown/door'
import { deviceName } from './device'
import { isRecord, isString, parsed } from './stored'

export type {
  Account,
  SpaceRole,
  GivenRole,
  Guest,
  Member,
  Sharing,
  SharedItem,
  Invitation,
  Joined,
  RemoteSpace,
  FormAnswer,
  SiteSettings,
  SiteChanges,
  RemoteNote,
  SecondState,
  RemoteSession,
  SpaceFile,
  AccountSettings,
  KeyState,
  DnsRecord,
  DomainStatus,
} from './api/routes'

export const BASE: string = import.meta.env.VITE_NIB_API ?? 'https://orden.so'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message)
  }
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string; device?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`
  if (options.device) headers['x-nib-device'] = deviceName()

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })

  const body = parsed(await response.text())

  if (!response.ok) {
    const said = isRecord(body) && isString(body.error) ? body.error : null
    const otherwise =
      response.status >= 500
        ? 'could not reach the server - try again'
        : `request failed (${response.status})`

    throw new ApiError(response.status, said ?? otherwise, body)
  }

  return body as T
}

type Routes = (typeof import('./api/routes'))['routes']

let table: Routes | null = null

const routes = door(async () => (table = (await import('./api/routes')).routes))

export function warmCalls(): Promise<unknown> {
  return routes()
}

type Later<T> = {
  readonly [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => Promise<R>
    : never
}

function calling(name: keyof Routes) {
  return (...args: never[]): Promise<unknown> => {
    const call = (all: Routes) => (all[name] as (...args: never[]) => Promise<unknown>)(...args)
    return table ? call(table) : routes().then(call)
  }
}

export const api = new Proxy({} as Later<Routes>, {
  get: (_nothing, name) =>
    typeof name === 'string' && name !== 'then' ? calling(name as keyof Routes) : undefined,
})

export const MCP_URL = `${BASE}/mcp`
