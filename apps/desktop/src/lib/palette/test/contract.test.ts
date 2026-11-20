import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { paletteKind } from '@orden/contracts'
import { candidates, resting } from '../src/kinds'
import { command, file, ROOT, tab, world } from '../src/world.fixture'
import { distinct } from '../src/scope'
import type { Row } from '../src/rows'

const SRC = join(import.meta.dirname, '..', 'src')
const sources = () =>
  readdirSync(SRC)
    .filter((name) => !name.includes('.test.') && !name.includes('.fixture.'))
    .map((name) => ({ name, text: readFileSync(join(SRC, name), 'utf8') }))
function pathOf(row: Row): string | null {
  if (row.kind === 'note') return row.entry.path
  if (row.kind === 'tab') return row.tab.path
  return row.kind === 'bookmark' ? row.path : null
}
describe('the kinds it reads from the registry', () => {
  test('offer nothing while no feature has registered them', async () => {
    expect(paletteKind('visits').list()).toEqual([])
    expect(paletteKind('hosts').wanted('ssh pi@example.com')).toBeNull()
    expect(await paletteKind('hosts').list()).toEqual([])
    expect(paletteKind('settings').rows()).toEqual([])
  })
})
describe('the open tabs it lists', () => {
  test('are the ones the workspace shows, so a tab of an archived space is not listed', () => {
    const reading = sources().filter(({ text }) => /\bworkspace\.tabs\b/.test(text))
    expect(reading.map(({ name }) => name)).toEqual([])
  })
})
describe('a chat', () => {
  test('is never a row: no chat file, no open chat, no bookmark of one, even when it was opened lately', () => {
    const chat = `${ROOT}/Team/Thesis.chat`
    const all = candidates(
      world({
        files: [file('Plan.md'), file('Team/Thesis.chat')],
        tabs: [tab('t1', 'Thesis', { kind: 'chat', path: chat }), tab('t2', 'Plan', { path: `${ROOT}/Plan.md` })],
        recent: [chat],
        bookmarks: [{ kind: 'block', path: 'Team/Thesis.chat#^01K6Z8', text: 'the figures' }],
      }),
    )
    const rows = [...all.map((one) => one.item), ...resting(all, { recent: [chat], active: null }, () => 1, 20)]
    const paths = rows.map(pathOf)
    expect(paths).toContain(`${ROOT}/Plan.md`)
    expect(paths.filter((one) => one?.endsWith('.chat'))).toEqual([])
  })
  test('nor a message of one: the palette asks no feature for messages', () => {
    const asking = sources().filter(({ text }) => /paletteKind\(\s*'messages'\s*\)|kind: 'message'/.test(text))
    expect(asking.map(({ name }) => name)).toEqual([])
  })
})
describe('the rows it lists', () => {
  const as = (id: string, checked = false): Row => ({ kind: 'command', command: command(id, 'Twice', { checked }) })
  const said = (row: Row) => (row.kind === 'command' ? row.command.label : row.kind)
  const seen = (rows: readonly Row[]) =>
    rows.map((one) => (one.kind === 'command' ? [one.command.id, one.command.checked] : []))
  test('hold one command once, the checked one, however often it is offered', () => {
    expect(seen(distinct([as('theme:contrast'), as('theme:contrast', true)], said))).toEqual([['theme:contrast', true]])
  })
  test('keep two commands that read the same, since each does its own thing', () => {
    expect(seen(distinct([as('ai-account:work'), as('ai-account:home')], said))).toEqual([
      ['ai-account:work', false],
      ['ai-account:home', false],
    ])
  })
})
