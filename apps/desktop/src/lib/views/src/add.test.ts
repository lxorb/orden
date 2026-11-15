import { expect, test, vi } from 'vitest'

vi.mock('../../workspace/src/api', () => ({ workspace: { spaces: [] } }))
vi.mock('../../rows/src/api', () => ({ rows: {} }))
vi.mock('./templates', () => ({}))

const { groupProperties } = await import('./add')

test('a note added in a group carries the group’s value, a truth or a date as much as a word', () => {
  expect(groupProperties({ property: 'note.status', key: 'Doing' })).toEqual({ status: 'Doing' })
  expect(groupProperties({ property: 'note.size', key: 3 })).toEqual({ size: 3 })
  expect(groupProperties({ property: 'note.done', key: true })).toEqual({ done: true })
  expect(groupProperties({ property: 'note.done', key: false })).toEqual({ done: false })
  expect(
    groupProperties({ property: 'note.due', key: { kind: 'date', iso: '2026-03-05' } }),
  ).toEqual({ due: '2026-03-05' })
})

test('a group of no value, or of a field that is not the note’s, gives nothing', () => {
  expect(groupProperties({ property: 'note.status', key: null })).toEqual({})
  expect(groupProperties({ property: 'file.folder', key: 'Books' })).toEqual({})
  expect(groupProperties(undefined)).toEqual({})
})

test('a note added in a tags group keeps the tag the base asks for beside the group’s', async () => {
  const { joinedProperties } = await import('./add')
  const place = { tags: ['project'], status: 'Open' }
  expect(joinedProperties(place, { tags: 'urgent' })).toEqual({
    tags: ['project', 'urgent'],
    status: 'Open',
  })
  expect(joinedProperties(place, {}, { tags: ['urgent'] })).toEqual({
    tags: ['project', 'urgent'],
    status: 'Open',
  })
  expect(joinedProperties(place, { tags: 'project' })).toEqual({
    tags: ['project'],
    status: 'Open',
  })
  expect(joinedProperties(place, { status: 'Doing' })).toEqual({
    tags: ['project'],
    status: 'Doing',
  })
})

test('a note added in a group of a link keeps the link', async () => {
  const { askedProperties } = await import('./add')
  const project = { kind: 'link' as const, target: 'Projects/X', display: 'X' }
  expect(groupProperties({ property: 'note.project', key: project })).toEqual({
    project: '[[Projects/X|X]]',
  })
  expect(groupProperties({ property: 'note.up', key: { kind: 'link', target: 'Home' } })).toEqual({
    up: '[[Home]]',
  })
  expect(askedProperties({ project, related: [project], size: 3 })).toEqual({
    project: '[[Projects/X|X]]',
    related: ['[[Projects/X|X]]'],
    size: 3,
  })
})

test('a note made from a template keeps the template’s own tags beside the group’s', async () => {
  const { withTemplate } = await import('./add')
  const words = '---\ntags: [project]\nstatus: Draft\n---\n\n# Plan\n'
  expect(withTemplate(words, { tags: ['urgent'], status: 'Open' })).toEqual({
    tags: ['project', 'urgent'],
    status: 'Open',
  })
  expect(withTemplate('tags: [project]\n', { tags: ['urgent'] })).toEqual({ tags: ['urgent'] })
  expect(withTemplate(words, { size: 3 })).toEqual({ size: 3 })
})
