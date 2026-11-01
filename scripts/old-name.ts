// What is left of the old name inside the repo (#367): every `nib` git keeps in a text
// file, by kind, with where it is.
//
//   node scripts/old-name.ts
//
// prints how many of each kind are left. apps/desktop/test/internal-name.test.ts reads
// the same list and holds the kinds already moved to staying moved; the rest are only
// counted here, since until a kind moves, its old name is still the one to write.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The old name as a word of its own, in any case: `nib`, `Nib`, `NIB_`, `@nib/`,
 *  `nib-row` - and not `nibble`. */
const WORD = /(?<![A-Za-z])nib(?![a-z])/gi

/** What each one is, by what is written from where it starts; the first that fits. */
const KINDS: readonly (readonly [Kind, RegExp])[] = [
  // The workspace's packages, `@nib/markdown`, and everything that imports them. Not a
  // handle inside an address, `tiktok.com/@nib/video/1`: see `inText`.
  ['package', /^@nib\//],
  // The app's identifier, `ch.emilvinu.nib`: folders, keychains, the phones' ids.
  ['identifier', /^ch[./]emilvinu[./]nib/i],
  // Events and addresses, `nib://agent`.
  ['scheme', /^nib:\/\//],
  // Stored keys, `nib:ai-sidebar`.
  ['key', /^nib:/],
  // Environment variables, `NIB_MCP_TOKEN`.
  ['variable', /^NIB_/],
  // Classes, files and names joined with a dash, `nib-row`, `nib-mcp.json`.
  ['dashed', /^nib-[A-Za-z0-9]/i],
  // Everything else: the crate and its binary, `nib mcp`, words in comments and docs.
  ['word', /^/],
]

export type Kind = 'package' | 'identifier' | 'scheme' | 'key' | 'variable' | 'dashed' | 'word'

export interface Found {
  path: string
  /** From one. */
  line: number
  kind: Kind
  /** What is written from where it starts, to the end of the name: `@nib/markdown`. */
  name: string
}

/** The files git keeps, as text: anything with a NUL in it is a picture or a font. */
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

/** Every one in one file's text. */
export function inText(path: string, text: string): Found[] {
  const out: Found[] = []
  for (const found of text.matchAll(WORD)) {
    // From the `@` of a package name, or the `ch.emilvinu.` of the identifier, which the
    // word itself leaves out.
    const owner = /ch[./]emilvinu[./]$/i.exec(
      text.slice(Math.max(0, found.index - 12), found.index),
    )
    const from = owner
      ? found.index - owner[0].length
      : text[found.index - 1] === '@'
        ? found.index - 1
        : found.index
    const ahead = text.slice(from, from + 60)
    // An `@nib/` after a `/` or a `.` is somebody's handle in an address, not a package.
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

/** Every one left, in the files git keeps but those `leaving` names. */
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
