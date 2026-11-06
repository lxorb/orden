import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { isWebUrl } from '@orden/online/urls'

export const OPEN_SOCKET = '/run/nibd/open.sock'

const MOST_BODY = 16 * 1024

const OPENS_A_MINUTE = 10

export interface Opener {
  open(url: string, session: string): boolean
}

function bodyOf(request: IncomingMessage): Promise<string | null> {
  return new Promise((settle) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
      if (body.length > MOST_BODY) {
        settle(null)
        request.destroy()
      }
    })
    request.on('end', () => {
      settle(body)
    })
    request.on('error', () => {
      settle(null)
    })
  })
}

export function askedOf(body: string | null): { url: string; session: string } | null {
  if (body === null) return null
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { url, session } = value as { url?: unknown; session?: unknown }
  if (!isWebUrl(url)) return null
  return { url, session: typeof session === 'string' ? session : '' }
}

export function serveOpener(opener: Opener, now: () => number = Date.now): Server {
  let minute = 0
  let count = 0
  const answer = (response: ServerResponse, status: number, words: string) => {
    response.writeHead(status, { 'content-type': 'text/plain' }).end(words)
  }

  return createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/open') {
      answer(response, 404, 'nib-open only opens addresses\n')
      return
    }
    void bodyOf(request).then((body) => {
      const asked = askedOf(body)
      if (!asked) {
        answer(response, 400, 'only http and https addresses open on your computer\n')
        return
      }
      const thisMinute = Math.floor(now() / 60_000)
      if (thisMinute !== minute) {
        minute = thisMinute
        count = 0
      }
      count += 1
      if (count > OPENS_A_MINUTE) {
        answer(response, 429, 'too many addresses this minute\n')
        return
      }
      if (!opener.open(asked.url, asked.session)) {
        answer(response, 503, 'no nib is connected to this machine\n')
        return
      }
      answer(response, 202, '')
    })
  })
}

export function listenOpener(server: Server, path = OPEN_SOCKET): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o755 })
    rmSync(path, { force: true })
  } catch {
    // A folder that cannot be made is a listen that fails, said below.
  }
  server.on('error', () => {
    // No browser for this machine's programs; everything else goes on.
  })
  server.listen(path, () => {
    try {
      chmodSync(path, 0o666)
    } catch {
      // Windows, in a developer's run: nothing to set.
    }
  })
}
