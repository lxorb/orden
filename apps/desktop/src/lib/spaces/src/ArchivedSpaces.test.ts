import { expect, test } from 'vitest'
import { render } from 'svelte/server'

const { workspace } = await import('../../workspace/src/api')
const ArchivedSpaces = (await import('./ArchivedSpaces.svelte')).default
const buttons = (body: string) => [...body.matchAll(/<button[^>]*>\s*([^<]*?)\s*<\/button>/g)].map((one) => one[1])
test('an archived space offers to open it before unarchiving it, under no word about the switcher', () => {
  workspace.spaces = [
    { id: 'n', name: 'Notes', root: '/n' },
    { id: 'o', name: 'Old', root: '/o' },
  ]
  workspace.activeSpaceId = 'n'
  workspace.archivedSpaces.set('/o', true)
  const body = render(ArchivedSpaces, { props: {} }).body
  workspace.archivedSpaces.set('/o', false)
  expect(buttons(body).slice(0, 2)).toEqual(['Open', 'Unarchive'])
  expect(body).not.toContain('switcher')
})
