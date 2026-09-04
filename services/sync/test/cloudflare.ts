import { vi } from 'vitest'

/** One custom hostname as Cloudflare's API describes it, trimmed to the
 *  fields the Worker reads. */
export interface FakeHostname {
  id: string
  hostname: string
  status: string
  ssl: {
    status: string
    method: string
    type: string
    validation_errors?: { message: string }[]
  }
  verification_errors?: string[]
}

interface Envelope {
  success: boolean
  errors: { code: number; message: string }[]
  messages: never[]
  result: unknown
}

function envelope(result: unknown, status = 200, errors: Envelope['errors'] = []): Response {
  const body: Envelope = { success: errors.length === 0, errors, messages: [], result }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const ZONE = 'zone-1'
export const TOKEN = 'test-token'

/** Cloudflare's custom-hostname API, kept in memory and installed over the
 *  global fetch. Anything else that reaches the network is thrown at, so a
 *  stray call cannot pass unnoticed. */
export function fakeCloudflare() {
  const base = `https://api.cloudflare.com/client/v4/zones/${ZONE}/custom_hostnames`
  const hostnames = new Map<string, FakeHostname>()
  /** Hostnames Cloudflare will not take, and what it says about each. */
  const refusals = new Map<string, string>()
  /** Every request, as `METHOD path`, in order. */
  const calls: string[] = []
  let next = 0

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)

    if (!url.href.startsWith(base)) throw new Error(`unexpected request ${method} ${url.href}`)
    calls.push(`${method} ${url.pathname.slice(base.length - url.origin.length)}${url.search}`)

    if (headers.get('authorization') !== `Bearer ${TOKEN}`) {
      return envelope(null, 403, [{ code: 10000, message: 'Authentication error' }])
    }

    const id = url.pathname.slice(new URL(base).pathname.length).replace(/^\//, '')

    if (method === 'GET' && !id) {
      const wanted = url.searchParams.get('hostname')
      const listed = [...hostnames.values()].filter((one) => !wanted || one.hostname === wanted)
      return envelope(listed)
    }

    if (method === 'POST' && !id) {
      const body = JSON.parse(String(init?.body)) as {
        hostname: string
        ssl: { method: string; type: string }
      }
      if (hostnames.has(body.hostname)) {
        return envelope(null, 409, [{ code: 1406, message: 'Duplicate custom hostname found.' }])
      }
      const refusal = refusals.get(body.hostname)
      if (refusal) return envelope(null, 400, [{ code: 1407, message: refusal }])
      const created: FakeHostname = {
        id: `ch-${++next}`,
        hostname: body.hostname,
        status: 'pending',
        ssl: { status: 'pending_validation', method: body.ssl.method, type: body.ssl.type },
      }
      hostnames.set(body.hostname, created)
      return envelope(created, 201)
    }

    const found = [...hostnames.values()].find((one) => one.id === id)
    if (!found) return envelope(null, 404, [{ code: 1436, message: 'Custom hostname not found.' }])

    if (method === 'GET') return envelope(found)
    if (method === 'DELETE') {
      hostnames.delete(found.hostname)
      return envelope({ id: found.id })
    }

    throw new Error(`unexpected request ${method} ${url.href}`)
  })

  return {
    hostnames,
    calls,
    install() {
      vi.stubGlobal('fetch', fetch)
    },
    /** Makes Cloudflare turn the hostname down when it is asked for. */
    refuse(hostname: string, message: string) {
      refusals.set(hostname, message)
    },
    /** What Cloudflare does once the CNAME is in place and the certificate is out. */
    activate(hostname: string) {
      const one = hostnames.get(hostname)!
      one.status = 'active'
      one.ssl.status = 'active'
    },
    /** What it reports while the CNAME is still missing. */
    complain(hostname: string, message: string) {
      hostnames.get(hostname)!.ssl.validation_errors = [{ message }]
    },
    /** What it reports when it has given up. */
    timeOut(hostname: string) {
      hostnames.get(hostname)!.ssl.status = 'validation_timed_out'
    },
    /** What it reports when the CNAME was taken away again. */
    move(hostname: string) {
      hostnames.get(hostname)!.status = 'moved'
    },
  }
}
