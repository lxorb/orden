import { Buffer } from 'buffer'
import { Readable } from './stream'

interface Asked {
  headers?: Record<string, string>
  responseType?: 'stream' | 'arraybuffer' | 'json' | 'text'
}

class FetchError extends Error {
  readonly isAxiosError = true

  constructor(
    message: string,
    readonly response?: { status: number; data: unknown },
  ) {
    super(message)
  }
}

async function answered(response: Response, asked: Asked) {
  if (!response.ok)
    throw new FetchError(`Request failed with status code ${response.status}`, {
      status: response.status,
      data: await response.text().catch(() => ''),
    })
  let data: unknown
  if (asked.responseType === 'stream' && response.body) data = Readable.fromWeb(response.body)
  else if (asked.responseType === 'arraybuffer') data = Buffer.from(await response.arrayBuffer())
  else {
    const text = await response.text()
    try {
      data = asked.responseType === 'text' ? text : JSON.parse(text)
    } catch {
      data = text
    }
  }
  return { status: response.status, data }
}

async function get(url: string, asked: Asked = {}) {
  const init: RequestInit = asked.headers ? { headers: asked.headers } : {}
  return answered(await fetch(url, init), asked)
}

async function post(url: string, body: BodyInit, asked: Asked = {}) {
  const init: RequestInit = { method: 'POST', body }
  if (asked.headers) init.headers = asked.headers
  return answered(await fetch(url, init), asked)
}

export function isAxiosError(error: unknown): boolean {
  return error instanceof FetchError
}

export default { get, post, isAxiosError }
