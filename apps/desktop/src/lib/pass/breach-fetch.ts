import type { Fetcher } from '@orden/pass/breach'

export const fetcher: Fetcher = async (url, init) => {
  const response = await fetch(url, init)
  return { ok: response.ok, status: response.status, text: () => response.text() }
}
