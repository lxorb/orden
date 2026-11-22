import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, test } from 'vitest'
import { ROOT } from '../../../../test/files'
import { COVERS } from './covers'

const LIB = join(ROOT, 'apps', 'desktop', 'src', 'lib')
const ONLY_A_PHONE_SHEET = new Set(['chats-client/src/view/MembersPanel.svelte'])
const MARK = new RegExp(`\\b(${COVERS.join('|')})\\b|data-covers`)
function svelteFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) svelteFiles(path, found)
    else if (entry.name.endsWith('.svelte')) found.push(path)
  }
  return found
}
function markup(path: string): string {
  return readFileSync(path, 'utf8').replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
}
test('every scrim the app draws comes with a mark on the box it stands behind, which a page is cut round', () => {
  const bare = svelteFiles(LIB)
    .map((path) => [relative(LIB, path).split('\\').join('/'), markup(path)] as const)
    .filter(([name, text]) => !ONLY_A_PHONE_SHEET.has(name) && /\borden-scrim\b/.test(text) && !MARK.test(text))
    .map(([name]) => name)
  expect(bare).toEqual([])
})
