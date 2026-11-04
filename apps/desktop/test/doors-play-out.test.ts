import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** A popup plays its way out, and a press in the middle of either way turns it round
 *  where it is (#1067).
 *
 *  Two ways that went wrong, each read out of the components rather than met one popup
 *  at a time. The list of spaces under the panel's header did both: it came in, and on
 *  the second tap simply vanished, one frame, with the chevron and the rows under it
 *  still moving; and a tap while it was coming in started the other movement from its
 *  far end.
 *
 *  - **A transition only plays for the block nearest it.** Fetched through a door with
 *    `{#if open}{#await door() then Thing}`, the `{#await}` is nearest, and the `{#if}`
 *    going false takes it down at once. Door.svelte puts the `{#if}` inside the fetch.
 *  - **`in:` and `out:` are two movements; `transition:` is one.** Stopped half-way,
 *    a pair starts the other from its end, and one transition turns round from where
 *    it is. A popup is pressed open and shut, so it is the one kind. */

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

/** A component's markup: no script, no style, no comments. */
function markup(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

/** Where a tag that opens at `from` ends, past every `{...}` inside it. */
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

/** The opening tags drawn at a component's top, outside every block and element:
 *  what is on the page the moment the component is, and goes with it. */
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

/** Still drawn the old way, in files other work has open at the moment; each comes
 *  through Door.svelte with its next change, and comes off this list with it. */
const NOT_YET = new Set([
  'lib/SettingsPanel.svelte: ./DeleteAccount.svelte',
  'lib/web-tab/WebTab.svelte: ../agents/ui/TakeoverBar.svelte',
  'lib/web-tab/WebTab.svelte: findBar',
])

/** The doors in surfaces.svelte.ts, by name, and the component each opens on. */
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
      // A latched door's `asked` stays: what it opens on is never taken down by it.
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
    const popup = /class="[^"]*\bnib-layer\b|role="(?:menu|dialog|listbox)"/
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
