import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const CRATE = fileURLToPath(new URL('../src-tauri/src', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return name.endsWith('.rs') ? [path] : []
  })
}

function commandSignatures(text: string): string[] {
  const out: string[] = []
  for (const found of text.matchAll(/#\[tauri::command[^\]]*\]/g)) {
    const from = found.index + found[0].length
    const body = text.indexOf('{', text.indexOf('fn ', from))
    out.push(text.slice(from, body))
  }
  return out
}

describe('a command the window calls', () => {
  test('takes the webview that asked, never a WebviewWindow, which a window of several webviews is not', () => {
    const offending = sources(CRATE).flatMap((path) =>
      commandSignatures(readFileSync(path, 'utf8'))
        .filter((signature) => /\bWebviewWindow\b/.test(signature))
        .map((signature) => `${relative(CRATE, path)}: ${signature.trim().split('\n')[0] ?? ''}`),
    )
    expect(offending).toEqual([])
  })

  test('is found by the walk', () => {
    const all = sources(CRATE).flatMap((path) => commandSignatures(readFileSync(path, 'utf8')))
    expect(all.some((one) => one.includes('fn owner_check'))).toBe(true)
  })
})
