import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const TAURI = fileURLToPath(new URL('../src-tauri', import.meta.url))

function rust(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return rust(path)
    return name.endsWith('.rs') ? [path] : []
  })
}

function tables(manifest: string): { header: string; body: string }[] {
  const out: { header: string; body: string }[] = []
  for (const line of manifest.split('\n')) {
    const last = out.at(-1)
    if (/^\[.*\]\s*$/.test(line)) out.push({ header: line, body: '' })
    else if (last) last.body += `${line}\n`
  }
  return out
}

function readOnMac(header: string): boolean {
  if (header === '[dependencies]' || header === '[build-dependencies]') return true
  const target = /^\[target\.'cfg\((.*)\)'\.(?:build-)?dependencies\]$/.exec(header)?.[1]
  if (target === undefined) return false
  return target.includes('target_os = "macos"') || /not\(.*target_os = "ios"/.test(target)
}

describe('a Mac build and the keychain', () => {
  test('no table a Mac build reads asks for the keyring crate', () => {
    const manifest = readFileSync(join(TAURI, 'Cargo.toml'), 'utf8')
    const keyring = tables(manifest).filter((one) => /^keyring\s*=/m.test(one.body))
    expect(keyring.length).toBeGreaterThan(0)
    for (const one of keyring) expect(readOnMac(one.header), one.header).toBe(false)
  })

  test('the crate reaches the keyring in one place, which a Mac build leaves out', () => {
    for (const path of rust(join(TAURI, 'src'))) {
      const text = readFileSync(path, 'utf8')
      const name = path.slice(TAURI.length + 1)
      if (name === 'src/secrets.rs') {
        const at = text.indexOf('use keyring::')
        expect(at, name).toBeGreaterThan(0)
        const before = text.slice(0, at)
        expect(before.slice(before.lastIndexOf('mod store')), name).not.toContain('}')
        expect(before.slice(before.lastIndexOf('#[cfg('))).toMatch(
          /^#\[cfg\(not\(target_os = "macos"\)\)\]\s*mod store/,
        )
        continue
      }
      expect(text, name).not.toMatch(/\bkeyring::/)
    }
  })

  test('nothing calls the keychain itself', () => {
    for (const path of rust(join(TAURI, 'src'))) {
      const text = readFileSync(path, 'utf8')
      const name = path.slice(TAURI.length + 1)
      expect(text, name).not.toMatch(
        /\bSecItem[A-Z]|\bSecKeychain|security_framework::(passwords|item|os::macos::keychain)/,
      )
    }
  })

  test('a Codex home of Orden’s keeps its login in a file on a Mac', () => {
    const home = readFileSync(join(TAURI, 'src/ai_cli/home.rs'), 'utf8')
    expect(home).toMatch(
      /#\[cfg\(target_os = "macos"\)\]\nconst CODEX_CONFIG: &str = "cli_auth_credentials_store = \\"file\\"\\n";/,
    )
  })
})
