import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const APP = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = join(APP, 'src')

const OLD_NAME = /(?<![A-Za-z])(?:Nib|[Nn]ib[Ee]ditor)(?![A-Za-z])/g

function identifier(text: string, at: number, length: number): boolean {
  const before = text[at - 1] ?? ''
  const after = text.slice(at + length)
  return (
    /[\\/]/.test(before) || /^(?:[\\/]|\.[A-Za-z]|-(?:Added|Home|Icon|Data|Chosen)\b)/.test(after)
  )
}

const NAMED: Record<string, string[]> = {
  'lib/welcome.ts': ['# Welcome to Nib', '# Welcome to nibeditor'],
  'lib/web/commands.ts': ['Nib'],
}

const SENT: string[] = ['set an OpenAI key in nibeditor’s settings first']

const renaming = (text: string) => text.includes('Orden')

function literals(code: string): string[] {
  const found: string[] = []
  const open: number[] = []
  let depth = 0
  let at = 0

  function quoted(quote: string): string {
    const start = ++at
    while (at < code.length && code[at] !== quote && code[at] !== '\n') {
      at += code[at] === '\\' ? 2 : 1
    }
    return code.slice(start, at++)
  }

  function run(): string {
    const start = at
    while (at < code.length) {
      if (code[at] === '\\') at += 2
      else if (code[at] === '`') return code.slice(start, at++)
      else if (code[at] === '$' && code[at + 1] === '{') {
        open.push(depth)
        depth = 0
        at += 2
        return code.slice(start, at - 2)
      } else at++
    }
    return code.slice(start)
  }

  while (at < code.length) {
    const one = code[at]
    const next = code[at + 1]

    if (one === '/' && next === '/') {
      const end = code.indexOf('\n', at)
      at = end < 0 ? code.length : end
    } else if (one === '/' && next === '*') {
      const end = code.indexOf('*/', at + 2)
      at = end < 0 ? code.length : end + 2
    } else if (one === "'" || one === '"') {
      found.push(quoted(one))
    } else if (one === '`') {
      at++
      found.push(run())
    } else if (one === '}' && depth === 0 && open.length > 0) {
      depth = open.pop() ?? 0
      at++
      found.push(run())
    } else {
      if (one === '{') depth++
      if (one === '}') depth--
      at++
    }
  }

  return found
}

function readable(path: string, source: string): string[] {
  if (!path.endsWith('.svelte')) return literals(source)

  const scripts = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1] ?? '',
  )
  const markup = source
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  return [...scripts.flatMap(literals), markup]
}

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sources(path, found)
    else if (/\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      found.push(path)
    }
  }

  return found
}

function oldNames(text: string): number[] {
  return [...text.matchAll(OLD_NAME)]
    .filter((match) => !identifier(text, match.index, match[0].length))
    .map((match) => match.index)
}

describe('reading a script for its strings', () => {
  test('finds each kind of string and no comment', () => {
    const code = [
      "const a = 'one' // 'not this'",
      '/* "nor this" */ const b = "two"',
      "const c = `three ${d ? `four` : 'five'} six`",
      "const e = { f: 'se\\'ven' }",
    ].join('\n')

    expect(literals(code)).toEqual(['one', 'two', 'three ', 'four', 'five', ' six', "se\\'ven"])
  })
})

describe('the name a reader sees', () => {
  test('is Orden in every string of the app and every catalogue', () => {
    const offenders: string[] = []

    for (const path of sources(SOURCE)) {
      const where = relative(SOURCE, path).replace(/\\/g, '/')
      const named = [...(NAMED[where] ?? []), ...(where.startsWith('locales/') ? SENT : [])]

      for (const text of readable(path, readFileSync(path, 'utf8'))) {
        if (named.includes(text) || renaming(text)) continue
        for (const at of oldNames(text)) {
          offenders.push(`${where}: ${text.slice(Math.max(0, at - 50), at + 50).trim()}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  test('is Orden in the pages the app is served in and on its manifests', () => {
    for (const name of [
      'index.html',
      'presenter.html',
      'quick-add.html',
      'even.html',
      'handoff.html',
      'public/manifest.webmanifest',
      'even.app.json',
    ]) {
      const text = readFileSync(join(APP, name), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
      expect(oldNames(text), name).toEqual([])
      expect(text, name).toContain('Orden')
    }
  })

  test('tells an identifier from the name', () => {
    expect(oldNames('Documents/Nib')).toEqual([])
    expect(oldNames('C:\\Users\\a\\AppData\\Local\\Nib\\nib.exe')).toEqual([])
    expect(oldNames('/Applications/Nib.app')).toEqual([])
    expect(oldNames('Orden-Icon=https://a.example/favicon.ico')).toEqual([])
    expect(oldNames('Orden-Data=3f9a0c17e2b4d685')).toEqual([])
    expect(oldNames('Orden-Chosen-Icon=rocket')).toEqual([])
    expect(oldNames('https://nibeditor.com/handoff')).toEqual([])
    expect(oldNames('Notes from nibeditor.com')).toEqual([])
    expect(oldNames('github.com/lxorb/nibeditor')).toEqual([])

    expect(oldNames('Welcome to Nib')).toEqual([11])
    expect(oldNames('Nib-E-Mail')).toEqual([0])
    expect(oldNames('Nibનું')).toEqual([0])
    expect(oldNames('Welcome to nibeditor')).toEqual([11])
    expect(oldNames('NibEditor is now Orden')).toEqual([0])
    expect(oldNames('nibeditor-E-Mail')).toEqual([0])
    expect(oldNames('nibeditor가')).toEqual([0])
    expect(oldNames('Orden')).toEqual([])
  })
})
