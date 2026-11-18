import { beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({ saved: [] as unknown[] }))

vi.mock('../../accounts/src/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../accounts/src/api')>()

  return {
    ...original,
    api: {
      saveSettings: (_token: string, patch: unknown) => {
        world.saved.push(patch)
        return Promise.resolve({ settings: {} })
      },
    },
  }
})

vi.stubGlobal('localStorage', memoryStorage())

import { DEFAULT_TOOLBAR, markFor, nameFor, toolbar, usable } from './toolbar.svelte'
import { memoryStorage } from '../../../../test/disk'

beforeEach(() => {
  world.saved = []
  localStorage.clear()
  toolbar.chosen = null
})

describe('the bar as it arrives', () => {
  test('is the nine it has always been', () => {
    expect(toolbar.ids).toEqual(DEFAULT_TOOLBAR)
    expect(toolbar.changed).toBe(false)
    expect(toolbar.ids[0]).toBe('format.bold')
  })

  test('and every one of them is a command something can press', () => {
    expect(usable([...DEFAULT_TOOLBAR])).toEqual([...DEFAULT_TOOLBAR])
  })
})

describe('putting one together', () => {
  test('adds to the end, and never twice', () => {
    toolbar.add('paragraph.task-list')
    expect(toolbar.ids.at(-1)).toBe('paragraph.task-list')
    expect(toolbar.changed).toBe(true)

    const held = [...toolbar.ids]
    toolbar.add('paragraph.task-list')
    expect(toolbar.ids).toEqual(held)
  })

  test('refuses what nothing can press', () => {
    toolbar.add('nothing.at.all')
    toolbar.add('fixed.escape')
    expect(toolbar.ids).toEqual(DEFAULT_TOOLBAR)
  })

  test('takes one off', () => {
    toolbar.remove('format.italic')
    expect(toolbar.ids).not.toContain('format.italic')
    expect(toolbar.ids.length).toBe(DEFAULT_TOOLBAR.length - 1)
  })

  test('moves one along, and a move off either end is the end', () => {
    toolbar.move(0, 2)
    expect(toolbar.ids.slice(0, 3)).toEqual([
      'format.italic',
      'format.strikethrough',
      'format.bold',
    ])

    toolbar.move(2, -4)
    expect(toolbar.ids[0]).toBe('format.bold')
    toolbar.move(0, 99)
    expect(toolbar.ids.at(-1)).toBe('format.bold')
  })

  test('and goes back to having chosen nothing', () => {
    toolbar.add('paragraph.table')
    toolbar.reset()

    expect(toolbar.ids).toEqual(DEFAULT_TOOLBAR)
    expect(toolbar.changed).toBe(false)
    expect(localStorage.getItem('orden:toolbar')).toBeNull()
  })
})

describe('what a stored or received list may be', () => {
  test('ids only, nothing twice, nothing this version cannot press', () => {
    expect(usable(['format.bold', 'format.bold', 7, 'nothing.here', 'paragraph.quote'])).toEqual([
      'format.bold',
      'paragraph.quote',
    ])
  })

  test('a bar with nothing on it is a bar somebody chose', () => {
    expect(usable([])).toEqual([])
  })

  test('and anything that is not a list at all is no choice', () => {
    expect(usable(null)).toBeNull()
    expect(usable('format.bold')).toBeNull()
    expect(usable({ 0: 'format.bold' })).toBeNull()
  })
})

describe('what a button wears', () => {
  test('its own mark where it has one', () => {
    expect(markFor('format.bold')).toBe('B')
    expect(markFor('paragraph.heading-2')).toBe('H')
    expect(markFor('paragraph.bullet-list')).toBe('•')
  })

  test('and the first letter of its name where it has none', () => {
    expect(markFor('app.settings')).toBe('S')
    expect(markFor('paragraph.table')).toBe('T')
  })

  test('and says what it is behind that', () => {
    expect(nameFor('format.bold')).toBe('Bold')
    expect(nameFor('nothing.at.all')).toBe('nothing.at.all')
  })
})

describe('the account', () => {
  test('is told when the list changes, and told null for the default', () => {
    toolbar.add('paragraph.table')
    toolbar.reset()

    expect(toolbar.ids).toEqual(DEFAULT_TOOLBAR)
  })

  test('takes over the list it holds', () => {
    toolbar.receive({ toolbar: ['format.bold', 'paragraph.quote'] })
    expect(toolbar.ids).toEqual(['format.bold', 'paragraph.quote'])

    toolbar.receive({ toolbar: null })
    expect(toolbar.ids).toEqual(DEFAULT_TOOLBAR)
  })

  test('and an account that has never been told anything leaves this one alone', () => {
    toolbar.add('paragraph.table')
    const held = [...toolbar.ids]

    toolbar.receive({})
    expect(toolbar.ids).toEqual(held)
  })
})

describe('a button this device cannot press yet', () => {
  test('stays on the bar, out of sight, through edits made here', () => {
    toolbar.receive({ toolbar: ['format.bold', 'app.new-window', 'format.italic'] })
    expect(toolbar.ids).toEqual(['format.bold', 'format.italic'])

    toolbar.move(1, 0)
    expect(toolbar.ids).toEqual(['format.italic', 'format.bold'])
    toolbar.add('paragraph.quote')
    toolbar.remove('format.bold')

    expect(toolbar.ids).toEqual(['format.italic', 'paragraph.quote'])
    expect(toolbar.chosen).toEqual(['format.italic', 'app.new-window', 'paragraph.quote'])
    expect(JSON.parse(localStorage.getItem('orden:toolbar') ?? 'null')).toEqual([
      'format.italic',
      'app.new-window',
      'paragraph.quote',
    ])
  })

  test('outlives a relaunch made before it could be pressed', () => {
    localStorage.setItem('orden:toolbar', JSON.stringify(['format.bold', 'app.new-window']))
    toolbar.restore()

    expect(toolbar.chosen).toEqual(['format.bold', 'app.new-window'])
    expect(toolbar.ids).toEqual(['format.bold'])
  })
})
