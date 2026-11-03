import { describe, expect, test } from 'vitest'
import { browse } from './browse'
import type { Row } from './rows'
import { command } from './world.fixture'

const COMMANDS = [
  command('print', 'Print'),
  command('new', 'New note'),
  command('reading', 'Reading'),
  command('split-right', 'Split right'),
  command('history', 'Version history'),
  command('feedback', 'Send feedback'),
]

const named = (row: Row) => (row.kind === 'command' ? row.command.label : row.kind)

describe('the palette with nothing typed', () => {
  test('follows what was used lately with the groups a menu has, each under its name', () => {
    const recent: Row[] = [{ kind: 'command', command: command('reopen', 'Reopen closed tab') }]
    const { rows, heads } = browse(recent, COMMANDS)

    expect(rows.map(named)).toEqual([
      'Reopen closed tab',
      ...['Version history', 'Print'],
      'Reading',
      'New note',
      'Send feedback',
    ])
    expect(Object.fromEntries(heads)).toEqual({
      1: 'This note',
      3: 'View',
      4: 'Create',
      5: 'Help',
    })
  })

  test('leaves out a group none of whose rows is there', () => {
    const { rows, heads } = browse([], [command('new', 'New note')])

    expect(rows.map(named)).toEqual(['New note'])
    expect(Object.fromEntries(heads)).toEqual({ 0: 'Create' })
  })
})

describe('Send feedback (#1049)', () => {
  test('is the last row of the menu the palette opens on, whatever else is there', () => {
    const { rows, heads } = browse([], [command('feedback', 'Send feedback')])
    expect(rows.map(named)).toEqual(['Send feedback'])
    expect(Object.fromEntries(heads)).toEqual({ 0: 'Help' })
  })
})
