import { BYTES_WITHIN, fetchInTime } from '../../platform/src/api'
export type FileFetcher = (input: string, init: RequestInit) => Promise<Response>

export class FileRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly told = false,
  ) {
    super(message)
    this.name = 'FileRefused'
  }
}

export interface FileApi {
  put(
    vault: string,
    item: string,
    file: string,
    part: number,
    parts: number,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<void>
  get(vault: string, item: string, file: string, part: number): Promise<Uint8Array<ArrayBuffer>>
  remove(vault: string, item: string, file: string): Promise<void>
}

async function refusal(response: Response): Promise<FileRefused> {
  let said = `request failed (${String(response.status)})`
  let told = false
  try {
    const body: unknown = JSON.parse(await response.text())
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const { error } = body
      if (typeof error === 'string') {
        told = true
        if (error !== '') said = error
      }
    }
  } catch {
    said = `request failed (${String(response.status)})`
  }
  return new FileRefused(response.status, said, told)
}

export function fileApi(
  base: string,
  token: string,
  fetcher: FileFetcher = (input, init) => fetchInTime(input, init, BYTES_WITHIN),
): FileApi {
  const at = (vault: string, item: string, file: string) =>
    `${base}/v2/pass/files/${[vault, item, file].map(encodeURIComponent).join('/')}`
  const authorization = `Bearer ${token}`
  return {
    async put(vault, item, file, part, parts, bytes) {
      const query = `?part=${String(part)}&parts=${String(parts)}`
      const response = await fetcher(`${at(vault, item, file)}${query}`, {
        method: 'PUT',
        headers: { authorization, 'content-type': 'application/octet-stream' },
        body: bytes,
      })
      if (!response.ok) throw await refusal(response)
    },

    async get(vault, item, file, part) {
      const response = await fetcher(`${at(vault, item, file)}?part=${String(part)}`, {
        method: 'GET',
        headers: { authorization },
      })
      if (!response.ok) throw await refusal(response)
      return new Uint8Array(await response.arrayBuffer())
    },

    async remove(vault, item, file) {
      const response = await fetcher(at(vault, item, file), {
        method: 'DELETE',
        headers: { authorization },
      })
      if (!response.ok && response.status !== 404) throw await refusal(response)
    },
  }
}
