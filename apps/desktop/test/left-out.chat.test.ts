import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, vi } from 'vitest'
import { portProvided } from '@orden/contracts'
import { leftOut } from '../app-build'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
const LIB = join(fileURLToPath(new URL('..', import.meta.url)), 'src', 'lib')
await import('../src/lib/sync-base-ports')
await import('../src/lib/no-workspace-ports')
const { chatsOn } = await import('../src/lib/gates/src/api')
describe('Orden Chat, which is the chats and nothing else (#2286)', () => {
  test('has chats on with no experiment to turn on', () => {
    expect(__ORDEN_APP__).toBe('chat')
    expect(chatsOn()).toBe(true)
  })
  test('has no files to place a chat in, no sync engine to ask for a device, and pairs no space', () => {
    for (const port of ['chats.places', 'chats', 'chats.demo', 'hub.device', 'sync.pairing'] as const) {
      expect(portProvided(port), port).toBe(false)
    }
  })
  test('gives its shell the store, the views and the host door, and keeps the full Orden’s loaders to the full Orden', async () => {
    const api = await import('../src/lib/chats-client/src/api')
    expect(typeof api.chatStore).toBe('function')
    expect(typeof api.chatHosting).toBe('function')
    for (const only of [api.chatPlaces, api.chatsDemo, api.chatContext, api.loadChatLinks, api.chatVerbs]) {
      await expect(only()).rejects.toThrow('only the full Orden keeps chats in files')
    }
    await expect(api.chatsCarried('/a', '/b')).rejects.toThrow('only the full Orden keeps chats in files')
    const text = readFileSync(join(LIB, 'chats-client', 'src', 'api.ts'), 'utf8')
    for (const file of ['places-here.svelte', 'demo', 'context', 'leaving', 'view/ChatLinks.svelte', 'agent-verbs']) {
      const at = text.indexOf(`import('./${file}')`)
      expect(at, file).toBeGreaterThan(-1)
      expect(text.slice(Math.max(0, at - 120), at), file).toContain("__ORDEN_APP__ === 'orden' ?")
    }
  })
  test('starts from its own entry on the ports that need no workspace, and starts the hub itself', () => {
    const entry = readFileSync(join(LIB, '..', 'chat.ts'), 'utf8')
    expect(entry).toContain("import './lib/no-workspace-ports'")
    expect(entry).toContain('hub.start()')
    expect(entry).toContain("watchPush('chat')")
    expect(entry).not.toMatch(/\/(workspace-ports|sync-ports|chat-ports|features|start)'/)
    expect(readFileSync(join(LIB, 'chats-client', 'src', 'start.svelte.ts'), 'utf8')).toContain(
      "if (!isMobile && __ORDEN_APP__ === 'orden') void import('./notices')",
    )
  })
  test('is named in the one list the build and the guard both read', () => {
    for (const name of [
      'workspace',
      'documents',
      'editor',
      'tab-strip',
      'panes',
      'terminal',
      'web-tab',
      'time',
      'tasks-views',
      'tasks-model',
      'sync-client',
      'sync-store',
      'link-index',
      'file-writes',
      'sidebar',
      'accounts-ui',
    ])
      expect(leftOut('chat'), name).toContain(name)
  })
})
