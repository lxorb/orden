import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ROOT } from './files'

const PLACES = ['apps/desktop/src', 'packages']
const SHARED = ['packages/markdown/src/note-name.ts', 'packages/markdown/src/shown.ts']
const PASSED = new Set(['node_modules', 'dist', 'test', 'e2e', 'target', 'coverage'])
const OWN_ENDING = '(?:md|markdown|mdown|mkd|canvas|term|chat|url|webloc|pages|base|application)'
const ENDING = `/\\\\\\.(?:\\((?:\\?:)?(?=[^()/]*\\b${OWN_ENDING}\\b)[^()/]*\\)|${OWN_ENDING}|\\[\\^[^\\]]*\\][+*])\\$/[a-z]*`
const STRIPPED = new RegExp(`\\.replace\\(\\s*${ENDING}\\s*,\\s*''\\s*\\)`, 'g')
const ENDING_CONST = new RegExp(`\\bconst\\s+([A-Z_][A-Z0-9_]*)\\s*=\\s*${ENDING}`, 'g')
const TAB_NAME = /\bname:\s*tab\.name\s*[,}\n]/g
const MARKUP_NAME = /\{(?:tab|entry)\.name\}/g
const PLATFORM_NAME_OF = /import\s*\{[^}]*\bnameOf\b[^}]*\}\s*from\s*'[^']*platform\/src\/api'/
const MARKUP_NAME_OF = /\{nameOf\(/g
const KEPT: Record<string, { most: number; why: string }> = {
  'apps/desktop/src/lib/link-index/src/links.svelte.ts': { most: 1, why: 'names compared to resolve links' },
  'packages/editor/src/wikilink/notes.ts': { most: 2, why: 'names compared and written as link paths' },
  'packages/editor/src/wikilink/complete.ts': {
    most: 1,
    why: 'the link name written for a block in a note the index lacks',
  },
  'packages/editor/src/wikilink/note-links.ts': {
    most: 1,
    why: 'the link name written for a path that is no note or file',
  },
  'packages/bases/src/link-context.ts': { most: 1, why: 'names compared to resolve links' },
  'packages/bases/src/expr/runtime.ts': {
    most: 1,
    why: 'link targets compared, as Obsidian resolves [[Plan]] to Plan.md',
  },
  'packages/bases/src/ids.ts': { most: 1, why: 'paths compared to order the rows that take an id' },
  'packages/scan/src/scan-note.ts': { most: 1, why: 'the name links resolve against in the index' },
  'packages/scan/src/indexed.ts': { most: 1, why: 'the name links resolve against in the index' },
  'apps/desktop/src/lib/agent-host/src/log.ts': { most: 1, why: 'a [[path]] link target' },
  'apps/desktop/src/lib/agent-host/src/tasks.ts': { most: 2, why: 'a template link compared to the rows it may name' },
  'apps/desktop/src/lib/agents/src/ui/session.ts': { most: 1, why: 'a [[path]] link target' },
  'apps/desktop/src/lib/views/src/board-menus.ts': { most: 1, why: 'a [[path]] link target' },
  'apps/desktop/src/lib/views/src/act.ts': { most: 1, why: 'a [[path]] link target to a task' },
  'apps/desktop/src/lib/views/src/ViewHead.svelte': { most: 1, why: 'a [[path]] link target to a template' },
  'apps/desktop/src/lib/views/src/templates.ts': { most: 3, why: 'names compared to find a template from its link' },
  'apps/desktop/src/lib/tasks-model/src/relink.ts': { most: 1, why: 'link targets compared' },
  'apps/desktop/src/lib/ai-chat/src/commands/helpers.ts': {
    most: 1,
    why: 'a [[path]] link target a batch helper is told',
  },
  'apps/desktop/src/lib/ai-chat/src/retrieve.ts': { most: 1, why: 'a [[path]] link target written into the answer' },
  'apps/desktop/src/lib/workspace/src/composing.ts': {
    most: 1,
    why: 'the new note named in the [[link]] a split or extract leaves behind',
  },
  'apps/desktop/src/lib/platform/src/space-paths.ts': {
    most: 2,
    why: 'md-only names links resolve against and paths are built from',
  },
}
const TO_MOVE: Record<string, number> = {
  'apps/desktop/src/lib/commands/src/insert-picture.ts': 1,
  'apps/desktop/src/lib/graph/src/graph.ts': 1,
  'apps/desktop/src/lib/import/src/apply.ts': 4,
  'apps/desktop/src/lib/import/src/bear.ts': 2,
  'apps/desktop/src/lib/import/src/convert.ts': 1,
  'apps/desktop/src/lib/import/src/document.ts': 1,
  'apps/desktop/src/lib/import/src/folder-name.ts': 1,
  'apps/desktop/src/lib/import/src/folder.ts': 1,
  'apps/desktop/src/lib/import/src/logseq.ts': 2,
  'apps/desktop/src/lib/import/src/notion-database.ts': 1,
  'apps/desktop/src/lib/import/src/notion.ts': 5,
  'apps/desktop/src/lib/import/src/rewrite.ts': 4,
  'apps/desktop/src/lib/import/src/shared.ts': 2,
  'apps/desktop/src/lib/import/src/tomboy.ts': 1,
  'apps/desktop/src/lib/tasks-views/src/carrying.svelte.ts': 1,
}
const RAW_KEPT: Record<string, { most: number; why: string }> = {
  'apps/desktop/src/lib/explorer/src/ExplorerColumn.svelte': {
    most: 1,
    why: "the system's own file names, as on disk",
  },
  'apps/desktop/src/lib/canvas/src/Canvas.svelte': { most: 2, why: 'the name an export takes its stem from' },
  'apps/desktop/src/lib/workspace/src/workspace.svelte.ts': { most: 1, why: 'written into the saved session' },
}
const RAW_TO_MOVE: Record<string, number> = {
  'apps/desktop/src/lib/time/src/sense.svelte.ts': 1,
  'apps/desktop/src/lib/sharing/src/protect/LockScreen.svelte': 1,
}
function walk(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found
  for (const name of readdirSync(dir)) {
    if (PASSED.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, found)
    else if (/\.(ts|svelte)$/.test(name) && !/\.(test|fixture)\./.test(name)) found.push(path)
  }
  return found
}
const sources = PLACES.flatMap((place) => walk(join(ROOT, place)))
  .map((path) => relative(ROOT, path).replace(/\\/g, '/'))
  .filter((path) => (path.startsWith('packages/') ? path.includes('/src/') : true))
  .filter((path) => !SHARED.includes(path))
const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length
const texts = new Map(sources.map((path) => [path, readFileSync(join(ROOT, path), 'utf8')]))
const endingConsts = new Set(
  [...texts.values()].flatMap((text) => [...text.matchAll(ENDING_CONST)].map((one) => one[1] ?? '')),
)
const IMPORTED = /import\s*\{([^}]*)\}\s*from/g
function strips(text: string): number {
  const own = [...text.matchAll(ENDING_CONST)].map((one) => one[1] ?? '')
  const brought = [...text.matchAll(IMPORTED)]
    .flatMap((one) => (one[1] ?? '').split(','))
    .map(
      (one) =>
        one
          .trim()
          .split(/\s+as\s+/)
          .pop() ?? '',
    )
    .filter((name) => endingConsts.has(name))
  return [...new Set([...own, ...brought])].reduce(
    (sum, name) => sum + count(text, new RegExp(`\\.replace\\(\\s*${name}\\s*,\\s*''\\s*\\)`, 'g')),
    count(text, STRIPPED),
  )
}
function raw(path: string, text: string): number {
  const markup = path.endsWith('.svelte')
    ? count(text, MARKUP_NAME) + (PLATFORM_NAME_OF.test(text) ? count(text, MARKUP_NAME_OF) : 0)
    : 0
  return count(text, TAB_NAME) + markup
}
function over(found: (path: string, text: string) => number, allowed: Record<string, number>): string[] {
  return sources.flatMap((path) => {
    const many = found(path, texts.get(path) ?? '')
    const most = allowed[path] ?? 0
    return many > most ? [`${path}: ${String(many)}, at most ${String(most)}`] : []
  })
}
const most = (kept: Record<string, { most: number }>, moving: Record<string, number>) => ({
  ...moving,
  ...Object.fromEntries(Object.entries(kept).map(([path, one]) => [path, one.most])),
})
describe("a name a reader is shown keeps no ending of Orden's own", () => {
  test('the walk reaches the app and its packages', () => {
    expect(sources.length).toBeGreaterThan(500)
    expect(sources).toContain('packages/markdown/src/links.ts')
  })
  test('is cut through shownName, shownPath or stemOf, never by a pattern of its own; the places left only grow fewer', () => {
    expect(over((_, text) => strips(text), most(KEPT, TO_MOVE))).toEqual([])
  })
  test('is never a tab or entry name drawn as it is; the places left only grow fewer', () => {
    expect(over(raw, most(RAW_KEPT, RAW_TO_MOVE))).toEqual([])
  })
  test('every place kept says why', () => {
    for (const one of [...Object.values(KEPT), ...Object.values(RAW_KEPT)]) expect(one.why.length).toBeGreaterThan(10)
  })
})
