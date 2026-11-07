import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

function rules(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let at: string[] | null = null
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (/^\s/.test(line)) at?.push(line.trim())
    else out.set(line.trim(), (at = []))
  }
  return out
}

describe('the web app’s built files, which stay readable offline', () => {
  const headers = rules(read('../public/_headers'))

  test('are kept for a year, since a new build gives them new names', () => {
    const assets = headers.get('/assets/*') ?? []

    expect(assets).toContain('Cache-Control: public, max-age=31536000, immutable')
  })

  test('and nothing else is, so a new page and service worker still arrive', () => {
    expect([...headers.keys()]).toEqual(['/assets/*'])
  })

  test('are served from the files themselves, where the headers apply', () => {
    const wrangler = read('../../../services/sync/wrangler.jsonc')

    expect(wrangler).toContain('"run_worker_first": ["/*", "!/assets/*"]')
  })

  test('and the two channels never put different bytes under one name', () => {
    const channels = read('../../../scripts/web-channels.sh')

    expect(channels).toContain('differs between the two builds')
    expect(channels).toContain('! -name _headers')
  })

  test('and the glasses’ package, which no server reads them from, leaves them out', () => {
    expect(read('../../../scripts/even-stage.mjs')).toContain("'_headers',")
  })
})
