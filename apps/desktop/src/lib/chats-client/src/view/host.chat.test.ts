import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import type { ChatEntry } from '../shapes'

const CHAT = `c_${'1'.repeat(32)}`
const entry = { id: CHAT, space: 'space-1', root: null, path: null, name: 'Plans' } as ChatEntry
vi.mock('./source.svelte', () => ({
  store: () => ({ ready: true, entry: (id: string) => (id === CHAT ? entry : null) }),
}))
const { host, hostChats } = await import('./host')
const { openChatLink } = await import('./open')
const { bodyHtml } = await import('./body')
const { chatRowMenu } = await import('./row-menu')
let undo: (() => void) | null = null
afterEach(() => {
  undo?.()
  undo = null
})
test('with no host every chat is here, nothing is a file, and nothing offers what needs the workspace', () => {
  expect(host().here([entry])).toEqual([entry])
  expect([host().opens(entry), host().isOpen(entry), host().makesIn(), host().activeRoot()]).toEqual([
    false,
    false,
    null,
    null,
  ])
  expect([host().saveAsNote, host().addAsTask, host().askOrden]).toEqual([null, null, null])
  expect(chatRowMenu(entry)).toEqual([])
})
test('a note link in a message is drawn as words where no note can be found', () => {
  expect(bodyHtml('See [[Plans]] today')).toContain('Plans')
  expect(bodyHtml('See [[Plans]] today')).not.toContain('href="Plans')
})
test('a chat link opens the chat by what the host says, with no path to go by', async () => {
  const opened: [string, string | undefined][] = []
  undo = hostChats({ opens: () => true, openEntry: (one, message) => opened.push([one.id, message]) })
  await openChatLink(`orden://chat/${CHAT}/m7`)
  expect(opened).toEqual([[CHAT, 'm7']])
})
test('the host given goes away again when it is taken back', () => {
  hostChats({ activeRoot: () => '/here' })()
  expect(host().activeRoot()).toBeNull()
})
test('no view file reaches the workspace, its tabs, files or links but the one that hosts the full Orden', () => {
  const kept = [
    'workspace',
    'documents',
    'file-writes',
    'file-ops',
    'sidebar',
    'link-index',
    'link-format',
    'sync-store',
  ]
  const beside = new Set(['host-here.ts', 'keep.ts', 'ChatLinks.svelte'])
  const reaching = readdirSync(import.meta.dirname)
    .filter((name) => /\.(ts|svelte)$/.test(name) && !name.includes('.test.') && !beside.has(name))
    .filter((name) => {
      const text = readFileSync(join(import.meta.dirname, name), 'utf8')
      return kept.some((module) =>
        new RegExp(`^\\s*import (?!type ).*'\\.\\./\\.\\./\\.\\./${module}/src/api'`, 'm').test(text),
      )
    })
  expect(reaching).toEqual([])
})
