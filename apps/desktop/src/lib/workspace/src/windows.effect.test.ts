import { describe, expect, test, vi } from 'vitest'
import { workspace } from './api'

function elsewhere(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new StorageEvent('storage', { key }))
}
describe('what another window writes', () => {
  test('shows here as soon as it is heard: icons, open folders and the notes opened lately', () => {
    elsewhere('orden:icons', { '/notes/Theirs': 'Book' })
    elsewhere('orden:expanded', { '/notes/Theirs/A': true })
    elsewhere('orden:recent', ['/notes/Theirs/Plan.md'])
    expect(workspace.device.iconOf('/notes/Theirs')).toBe('Book')
    expect(workspace.device.isExpanded('/notes/Theirs/A')).toBe(true)
    expect(workspace.device.recent).toEqual(['/notes/Theirs/Plan.md'])
  })
  test('archiving the space open here moves this window off it', async () => {
    workspace.spaces = [
      { id: 'mine', name: 'Mine', root: '/notes/Mine' },
      { id: 'stays', name: 'Stays', root: '/notes/Stays' },
    ]
    await workspace.showSpace('mine')
    elsewhere('orden:archived-spaces', ['/notes/Mine'])
    await vi.waitFor(() => expect(workspace.activeSpaceId).toBe('stays'))
  })
})
