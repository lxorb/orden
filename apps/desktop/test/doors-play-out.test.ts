import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const LIB = join(SOURCE, 'lib')

function components(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.svelte')) out.push(path)
    }
  }
  walk(SOURCE)
  return out
}

function markup(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

function tagEnd(text: string, from: number): number {
  let depth = 0
  for (let at = from; at < text.length; at++) {
    const one = text[at]
    if (one === '{') depth++
    else if (one === '}') depth--
    else if (one === '>' && depth === 0) return at
  }
  return text.length
}

function rootTags(text: string): string[] {
  const body = markup(text)
  const roots: string[] = []
  let elements = 0
  let blocks = 0

  for (let at = 0; at < body.length; at++) {
    if (body.startsWith('{#', at)) blocks++
    else if (body.startsWith('{/', at)) blocks--
    else if (body[at] === '<' && /[a-zA-Z]/.test(body[at + 1] ?? '')) {
      const end = tagEnd(body, at)
      const tag = body.slice(at, end + 1)
      if (elements === 0 && blocks === 0) roots.push(tag)
      if (!tag.endsWith('/>') && !/^<(input|br|hr|img|meta|link|path|circle|rect|line)\b/.test(tag))
        elements++
      at = end
    } else if (body.startsWith('</', at)) {
      elements--
      at = tagEnd(body, at)
    }
  }

  return roots
}

const MOVES = /\s(?:transition|in|out):/

const NOT_YET = new Set([
  'lib/settings/src/SettingsPanel.svelte: ./DeleteAccount.svelte',
  'lib/web-tab/src/WebTab.svelte: findBar',
])

function doors(): Map<string, string> {
  const text = readFileSync(join(LIB, 'surfaces.svelte.ts'), 'utf8')
  const found = new Map<string, string>()
  const each = /export const (\w+) = (?:held|latched)\(([\s\S]*?)\n(?=export|\/\*\*|$)/g
  for (const [, name, body] of text.matchAll(each)) {
    const file = /import\('(\.\/[^']+\.svelte)'\)/.exec(body ?? '')?.[1]
    if (name && file) found.set(name, join(LIB, file))
  }
  return found
}

describe('a component fetched through a door', () => {
  test('that moves as it goes is drawn through Door.svelte, so its way out plays', () => {
    const named = doors()
    const wrong: string[] = []

    for (const file of components()) {
      const body = markup(readFileSync(file, 'utf8'))
      const awaits = /\{#await\s+(?:(\w+)\(\)|import\('([^']+\.svelte)'\))\s+then\b/g
      for (const [, door, path] of body.matchAll(awaits)) {
        const opened = door ? named.get(door) : path ? resolve(dirname(file), path) : undefined
        if (!opened) continue
        const said = `${relative(SOURCE, file)}: ${door ?? path}`
        if (NOT_YET.has(said)) continue
        if (rootTags(readFileSync(opened, 'utf8')).some((tag) => MOVES.test(tag))) wrong.push(said)
      }
    }

    expect(wrong).toEqual([])
  })

  test('which is what the list of spaces is', () => {
    const switcher = readFileSync(join(LIB, 'SpaceSwitcher.svelte'), 'utf8')
    expect(switcher).toMatch(/<Door \{open\} load=\{\(\) => spacesMenu\(\)\}>/)
    expect(rootTags(readFileSync(join(LIB, 'SpaceMenu.svelte'), 'utf8')).join('\n')).toMatch(
      /transition:arrive/,
    )
  })
})

describe('a popup', () => {
  test('moves as one transition, which turns round where it is', () => {
    const popup = /class="[^"]*\borden-layer\b|role="(?:menu|dialog|listbox)"/
    const wrong: string[] = []

    for (const file of components()) {
      const body = markup(readFileSync(file, 'utf8'))
      for (const match of body.matchAll(/<[a-zA-Z][\w-]*/g)) {
        const tag = body.slice(match.index, tagEnd(body, match.index) + 1)
        if (popup.test(tag) && /\s(?:in|out):/.test(tag)) {
          wrong.push(`${relative(SOURCE, file)}: ${tag.split('\n')[0]}`)
        }
      }
    }

    expect(wrong).toEqual([])
  })
})

describe('reading a component', () => {
  test('finds what is at its top and nothing under it', () => {
    const roots = rootTags(
      '<script>let a = 1 > 0</script>\n<div class="a" onclick={() => (x = y > z)} in:fade>' +
        '<span transition:fly></span></div>\n{#if open}<p transition:fade></p>{/if}<hr />',
    )
    expect(roots).toEqual(['<div class="a" onclick={() => (x = y > z)} in:fade>', '<hr />'])
  })
})
