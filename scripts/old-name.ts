import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const WORD = /(?<![A-Za-z])nib(?![a-z])/gi

const KINDS: readonly (readonly [Kind, RegExp])[] = [
  ['package', /^@nib\//],
  ['identifier', /^ch[./]emilvinu[./]nib/i],
  ['scheme', /^nib:\/\//],
  ['key', /^nib:/],
  ['variable', /^NIB_/],
  ['dashed', /^nib-[A-Za-z0-9]/i],
  ['word', /^/],
]

export type Kind = 'package' | 'identifier' | 'scheme' | 'key' | 'variable' | 'dashed' | 'word'

export interface Found {
  path: string
  line: number
  kind: Kind
  name: string
}

function texts(): { path: string; text: string }[] {
  const listed = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  return listed
    .split('\0')
    .filter(Boolean)
    .flatMap((path) => {
      let text: string
      try {
        text = readFileSync(join(ROOT, path), 'utf8')
      } catch {
        return []
      }
      return text.includes('\0') ? [] : [{ path, text }]
    })
}

export function inText(path: string, text: string): Found[] {
  const out: Found[] = []
  for (const found of text.matchAll(WORD)) {
    const owner = /ch[./]emilvinu[./]$/i.exec(
      text.slice(Math.max(0, found.index - 12), found.index),
    )
    const from = owner
      ? found.index - owner[0].length
      : text[found.index - 1] === '@'
        ? found.index - 1
        : found.index
    const ahead = text.slice(from, from + 60)
    const inAddress = text[from] === '@' && /[/.]/.test(text[from - 1] ?? '')
    const [kind] = inAddress
      ? (['word'] as const)
      : (KINDS.find(([, shape]) => shape.test(ahead)) ?? ['word'])
    const line = text.slice(0, found.index).split('\n').length
    const name = /^[@\w./:-]+/.exec(ahead)?.[0] ?? 'nib'
    out.push({ path, line, kind, name })
  }
  return out
}

export function oldNames(leaving: readonly string[] = []): Found[] {
  return texts()
    .filter(({ path }) => !leaving.includes(path))
    .flatMap(({ path, text }) => inText(path, text))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const counts = new Map<Kind, number>()
  for (const one of oldNames()) counts.set(one.kind, (counts.get(one.kind) ?? 0) + 1)
  for (const [kind] of KINDS) console.log(`${kind.padEnd(10)} ${counts.get(kind) ?? 0}`)
}
