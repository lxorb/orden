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

const DOH = 'https://cloudflare-dns.com/dns-query'

/** Cloudflare's custom-hostname API and its resolver, kept in memory and
 *  installed over the global fetch. Both, because they are the two things the
 *  Worker asks of the network about a domain: give me a certificate for this
 *  name, and does this name say it is ours. Anything else that reaches the
 *  network is thrown at, so a stray call cannot pass unnoticed. */
export function fakeCloudflare() {
  const base = `https://api.cloudflare.com/client/v4/zones/${ZONE}/custom_hostnames`
  const hostnames = new Map<string, FakeHostname>()
  /** Hostnames Cloudflare will not take, and what it says about each. */
  const refusals = new Map<string, string>()
  /** Every request, as `METHOD path`, in order. */
  const calls: string[] = []
  /** The TXT records people have added at their registrars, and every name that
   *  has been looked up. */
  const records = new Map<string, string[]>()
  const lookups: string[] = []
  let resolves = true
  let next = 0

  /** The resolver's answer, in the shape JSON DNS gives it: a status, and the
   *  strings quoted the way a zone file quotes them. */
  function resolved(name: string): Response {
    lookups.push(name)
    if (!resolves) return new Response('no', { status: 503 })

    const found = records.get(name)
    const body = {
      Status: found ? 0 : 3,
      Answer: (found ?? []).map((value) => ({
        name,
        type: 16,
        TTL: 300,
        data: JSON.stringify(value),
      })),
    }

    return new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/dns-json' },
    })
  }

  /** Cloudflare's answer, worked out without touching anything asynchronous;
   *  the stub below is what makes it look like a fetch. */
  function answer(input: RequestInfo | URL, init?: RequestInit): Response {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    )
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)

    if (`${url.origin}${url.pathname}` === DOH) {
      return resolved(url.searchParams.get('name') ?? '')
    }

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
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
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
  }

  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(answer(input, init)),
  )

  return {
    hostnames,
    calls,
    lookups,
    install() {
      vi.stubGlobal('fetch', fetch)
    },
    /** A record somebody added at their registrar. */
    txt(name: string, values: string[]) {
      records.set(name, values)
    },
    /** And the record taken away again, which is what a domain that has changed
     *  hands looks like. */
    forgetTxt(name: string) {
      records.delete(name)
    },
    /** A resolver that cannot be reached, which is not the same answer as a name
     *  with nothing on it. */
    dnsDown(down = true) {
      resolves = !down
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
