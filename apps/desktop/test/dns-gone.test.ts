import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const SKIP = /^(?:node_modules|target|dist|gen|\.[^.]+)$/

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.test(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, out)
    else out.push(path)
  }
  return out
}

const read = (path: string) => readFileSync(path, 'utf8')

const WORDS = /secure_dns|dns_chosen|dns_choose|dns_over_https|dns\.json|general\.dns|dns\.svelte/

describe('the DNS setting, gone', () => {
  test('no module, command or stored key of it remains in the app', () => {
    const src = join(ROOT, 'apps/desktop/src-tauri/src')
    const lib = read(join(src, 'lib.rs'))
    const kept = /remove_file\(config\.join\("dns\.json"\)\)/.exec(lib)?.[0] ?? ''
    expect(kept).not.toBe('')
    const named = files(src)
      .filter((path) => /dns/i.test(relative(src, path)))
      .map((path) => relative(ROOT, path))
    expect(named).toEqual([])
    const holding = files(src)
      .filter((path) => WORDS.test(read(path).replace(kept, '')))
      .map((path) => relative(ROOT, path))
    expect(holding).toEqual([])
  })

  test('the settings offer no section, field or search words for it', () => {
    const settings = join(ROOT, 'apps/desktop/src/lib/settings')
    const named = files(settings)
      .filter((path) => /dns/i.test(relative(settings, path)))
      .map((path) => relative(ROOT, path))
    expect(named).toEqual([])
    const holding = files(settings)
      .filter((path) => /\bDNS\b|general\.dns|'doh'|dns over https/i.test(read(path)))
      .map((path) => relative(ROOT, path))
    expect(holding).toEqual([])
  })

  test('no workflow or script drives it', () => {
    const driven = [
      ...files(join(ROOT, '.github/workflows')),
      ...files(join(ROOT, 'scripts')),
      ...files(join(ROOT, 'apps/desktop/test/e2e')),
    ]
      .filter((path) => /\.(?:ya?ml|sh|py|mjs|ts)$/.test(path))
      .filter((path) => /\bdns\b|\bdoh\b/i.test(relative(ROOT, path) + read(path)))
      .map((path) => relative(ROOT, path))
    expect(driven).toEqual([])
  })
})
