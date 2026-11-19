import { describe, expect, test, vi } from 'vitest'

vi.mock('../../platform/src/tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'obsidian_vault_files') {
      return Promise.resolve([
        { path: 'Attachments/locked.png', size: 4 },
        { path: 'Home.md', size: 6 },
        { path: 'Café.md', size: 4 },
        { path: 'Wide.md', size: 6 },
      ])
    }
    if (command === 'read_obsidian_file' && args.path === 'Home.md') {
      return Promise.resolve(btoa('# Home'))
    }
    if (command === 'read_obsidian_file' && args.path === 'Café.md') {
      return Promise.resolve(btoa('Caf\xe9'))
    }
    if (command === 'read_obsidian_file' && args.path === 'Wide.md') {
      return Promise.resolve(btoa('\xff\xfeW\x00\xe9\x00'))
    }
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    return Promise.reject(`/home/me/Brain/${String(args.path)} could not be read: Permission denied`)
  },
  isDesktop: true,
}))
const { vaultSources } = await import('./vaults')
describe('a vault read where it is', () => {
  test('names the file it could not read', async () => {
    const sources = await vaultSources({ name: 'Brain', path: '/home/me/Brain' })
    const [locked, home] = sources
    await expect(home?.text()).resolves.toBe('# Home')
    await expect(locked?.bytes()).rejects.toThrow('Attachments/locked.png could not be read.')
  })
  test('reads a note written in another encoding as the words it holds', async () => {
    const [, , cafe, wide] = await vaultSources({ name: 'Brain', path: '/home/me/Brain' })
    await expect(cafe?.text()).resolves.toBe('Café')
    await expect(wide?.text()).resolves.toBe('Wé')
  })
})
