import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const LIB = fileURLToPath(new URL('../src/lib', import.meta.url))

const ENCODED =
  /\bbase64\s*[:,}]|toBase64\(|\[\.\.\.\s*(?:new Uint8Array|bytes\b)|Array\.from\(\s*(?:new Uint8Array|bytes\b)/

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((one) => {
    const path = join(dir, one.name)
    if (one.isDirectory()) return one.name === 'web' ? [] : sources(path)
    return /\.(ts|svelte)$/.test(one.name) && !/\.test\.ts$|\.fixture\.ts$/.test(one.name)
      ? [path]
      : []
  })
}

function closing(text: string, from: number): number {
  let depth = 0
  for (let at = from; at < text.length; at++) {
    const char = text[at]
    if (char === '{') depth++
    else if (char === '}' && --depth === 0) return at
  }
  return text.length
}

function encodedArguments(text: string): string[] {
  const found: string[] = []
  for (const call of text.matchAll(/\(\s*'([a-z][a-z0-9_]*)'\s*,\s*\{/g)) {
    const open = call.index + call[0].length - 1
    const args = text.slice(open, closing(text, open) + 1)
    if (ENCODED.test(args)) found.push(`${call[1]} ${args.replace(/\s+/g, ' ')}`)
  }
  return found
}

describe('bytes on their way to the crate', () => {
  test('are found where a command is handed them encoded', () => {
    expect(encodedArguments("invoke('a_b', { path, base64: toBase64(bytes) })")).toHaveLength(1)
    expect(encodedArguments("crate('a', { bytes: [...new Uint8Array(raw)] })")).toHaveLength(1)
    expect(encodedArguments("invoke('a', { id, bytes })")).toEqual([])
  })

  test('are never handed to a command as base64 or as an array of numbers', () => {
    const found = sources(LIB).flatMap((path) =>
      encodedArguments(readFileSync(path, 'utf8')).map((one) => `${relative(LIB, path)}: ${one}`),
    )
    expect(found).toEqual([])
  })
})
