// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { createEditor } from '../editor'
import { tableMenuAt } from './widget'
import { keptViews } from '../../test/views'

const open = keptViews()
const column = (text: string): string[] =>
  text
    .split('\n')
    .slice(2, 5)
    .map((row) => row.split('|')[1]?.trim() ?? '')
test('a column sorts both ways from its menu', async () => {
  const doc = '| a |\n| --- |\n| 2 |\n| 1 |\n| 3 |\n\nend'
  const view = createEditor({ parent: document.body, doc, selection: { anchor: doc.length } })
  open.push(view)
  const pick = (label: string) => {
    const entry = tableMenuAt(view.dom.querySelector('th'))?.entries.find((one) => one?.label === label)
    if (!entry) throw new Error(`the menu has no ${label}`)
    entry.run()
  }
  pick('Sort descending')
  await expect.poll(() => column(view.state.doc.toString())).toEqual(['3', '2', '1'])
  pick('Sort ascending')
  await expect.poll(() => column(view.state.doc.toString())).toEqual(['1', '2', '3'])
})
