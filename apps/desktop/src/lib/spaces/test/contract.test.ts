import { describe, expect, test } from 'vitest'
import { render } from 'svelte/server'
import { providePort, registerSidebarPart, settingsPartsIn } from '@orden/contracts'
import { chatsUnreadBesides, chatsUnreadIn, publishSpace, SpaceBadge, spaceMenu } from '../src/api'

const SPACE = { id: 's', name: 'Notes', root: '/s' }
describe('the spaces', () => {
  test('offer to rename and delete a space of one’s own', () => {
    const labels = spaceMenu(SPACE).flatMap((one) => (one && 'label' in one ? [one.label] : []))
    expect(labels).toContain('Rename')
    expect(labels).toContain('Delete space')
    expect(labels).not.toContain('Leave space')
  })
  test('publish a space through the publishing port, and do nothing without one', async () => {
    await publishSpace(SPACE)
    const shown: string[] = []
    const stop = providePort('publishing', {
      show: (space) => {
        shown.push(space.root)
        return Promise.resolve()
      },
    })
    await publishSpace(SPACE)
    stop()
    expect(shown).toEqual(['/s'])
  })
  test('hold the archived spaces in a Settings section of their own', () => {
    const [part, ...more] = settingsPartsIn('archived')
    expect(more).toEqual([])
    expect(part?.shown()).toBe(true)
    expect(part?.places?.().map((one) => one.label)).toEqual(['Unarchive'])
  })
})
describe('the unread chats of a space', () => {
  const badge = (unread: number) =>
    /class="count[^"]*">([^<]*)</.exec(render(SpaceBadge, { props: { space: SPACE, unread } }).body)?.[1] ?? null
  test('sit at the corner of its icon, 99+ past 99 and nothing at 0', () => {
    expect(badge(5)).toBe('5')
    expect(badge(99)).toBe('99')
    expect(badge(120)).toBe('99+')
    expect(badge(0)).toBeNull()
  })
  test('are what the chats say, nothing without them, and the other spaces add up', () => {
    const spaces = [SPACE, { id: 't', name: 'Team', root: '/t' }, { id: 'u', name: 'Club', root: '/u' }]
    expect(chatsUnreadIn('/s')).toBe(0)
    const counts: Record<string, number> = { '/s': 2, '/t': 5, '/u': 1 }
    const drop = registerSidebarPart({ id: 'chats', unreadIn: (root) => counts[root] ?? 0 })
    expect(chatsUnreadIn('/t')).toBe(5)
    expect(chatsUnreadBesides(spaces, '/s')).toBe(6)
    expect(chatsUnreadBesides(spaces, '/t')).toBe(3)
    drop()
    expect(chatsUnreadBesides(spaces, '/s')).toBe(0)
  })
})
