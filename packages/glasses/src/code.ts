/** A fence's code, told apart into token kinds.
 *
 *  The same parsers the editor colours a fence with and the same groups it
 *  colours them into, so a fence on the glasses is the fence on screen. The
 *  groups appear three times in this repo now - `code-theme.ts` turns them into
 *  colours, `highlight.ts` in the app turns them into classes for an exported
 *  document, and this turns them into roles for a panel that has no colours -
 *  because each has a different thing to say about them. A group added in one
 *  belongs in all three. */

import { LanguageDescription, type LanguageSupport } from '@codemirror/language'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import { fenceLanguages } from '@nib/editor'
import type { CodeRole } from './grey'

export type Parser = LanguageSupport['language']['parser']

/** One stretch of a code line and what kind of token it is. */
export interface CodeSpan {
  text: string
  role: CodeRole
}

/** The tag groups, named by the role each becomes. */
const roles = tagHighlighter([
  { tag: tags.keyword, class: 'keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'comment' },
  // The key in a key=value fence, and a name where it is given. Above the
  // function rule so a function's name stays a function; see code-theme.ts.
  { tag: tags.definition(tags.variableName), class: 'property' },
  { tag: [tags.function(tags.variableName), tags.labelName], class: 'function' },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'type' },
  { tag: [tags.operator, tags.punctuation], class: 'punctuation' },
  { tag: tags.propertyName, class: 'property' },
  { tag: tags.invalid, class: 'invalid' },
  { tag: tags.inserted, class: 'inserted' },
  { tag: tags.deleted, class: 'deleted' },
])

const ROLES = new Set<string>([
  'keyword',
  'string',
  'number',
  'comment',
  'property',
  'function',
  'type',
  'punctuation',
  'invalid',
  'inserted',
  'deleted',
])

/** The role a highlighter's class string names. It joins the classes of every
 *  tag that matched with a space, and the first is the most specific one. */
function roleOf(classes: string): CodeRole {
  const first = classes.split(' ')[0] ?? ''
  return ROLES.has(first) ? (first as CodeRole) : 'text'
}

/** A parser for each language named, loaded once. The list is the editor's own,
 *  so a fence coloured on screen is coloured here: a fence may name a language,
 *  spell it the short way, or use its file extension. A language nothing is
 *  known about is simply absent and its code stays plain. */
export async function loadFenceParsers(names: Iterable<string>): Promise<Map<string, Parser>> {
  const parsers = new Map<string, Parser>()

  await Promise.all(
    [...new Set(names)].filter(Boolean).map(async (name) => {
      const description =
        LanguageDescription.matchLanguageName(fenceLanguages, name, true) ??
        LanguageDescription.matchFilename(fenceLanguages, `code.${name}`)
      if (!description) return

      const support = await description.load().catch(() => null)
      if (support) parsers.set(name, support.language.parser)
    }),
  )

  return parsers
}

/** The code as one span list per source line. A fence with no parser comes back
 *  as plain lines, which is what an unknown language should look like.
 *
 *  Split by line rather than handed over whole because a page break may fall
 *  between two lines of a fence and never inside one; see layout.ts. */
export function fenceSpans(code: string, parser?: Parser): CodeSpan[][] {
  const lines = code.split('\n')
  if (!parser) return lines.map((line) => (line ? [{ text: line, role: 'text' as const }] : []))

  // Offsets of every line start, so a span found in the whole text knows which
  // line it belongs to without counting newlines again.
  const starts: number[] = []
  let at = 0
  for (const line of lines) {
    starts.push(at)
    at += line.length + 1
  }

  const out: CodeSpan[][] = lines.map(() => [])
  let last = 0

  const put = (from: number, to: number, role: CodeRole) => {
    if (to <= from) return

    // A token may straddle a newline - a block comment, a template string - so
    // it is cut at every line it crosses.
    for (let line = 0; line < lines.length; line++) {
      const start = starts[line] ?? 0
      const end = start + (lines[line]?.length ?? 0)
      const cutFrom = Math.max(from, start)
      const cutTo = Math.min(to, end)
      if (cutTo <= cutFrom) continue

      out[line]?.push({ text: code.slice(cutFrom, cutTo), role })
    }
  }

  highlightTree(parser.parse(code), roles, (from, to, classes) => {
    put(last, from, 'text')
    put(from, to, roleOf(classes))
    last = to
  })
  put(last, code.length, 'text')

  return out
}
