import { describe, expect, test } from 'vitest'
import { render } from 'svelte/server'
import { providePort, settingsPartsIn } from '@orden/contracts'
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
  test('sit at the corner of its icon, 9+ past 9 on a desktop and nothing at 0', () => {
    expect(badge(5)).toBe('5')
    expect(badge(9)).toBe('9')
    expect(badge(120)).toBe('9+')
    expect(badge(0)).toBeNull()
  })
  test('are none while no chats are there to say any', () => {
    expect(chatsUnreadIn('/s')).toBe(0)
    expect(chatsUnreadBesides([SPACE, { id: 't', name: 'Team', root: '/t' }], '/s')).toBe(0)
  })
})
describe('the General part of a space in Settings', () => {
  test('comes first in the space section, in a card, and is found by its name and icon', () => {
    const general = settingsPartsIn('space').find((one) => one.title === 'General')
    expect(general).toMatchObject({ section: 'space', card: true, order: 0 })
    const said = general?.places?.().flatMap((one) => [one.label, ...one.text]) ?? []
    expect(said).toEqual(expect.arrayContaining(['Name', 'Rename', 'Icon']))
  })
})
