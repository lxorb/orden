import { describe, expect, test } from 'vitest'

import { notionPage, readNotion } from './notion'
import type { ImportPlan } from './plan'
import { sourceOf, type Source } from './sources'

const PLAN = '1a2b3c4d5e6f78901a2b3c4d5e6f7890'
const SUB = 'aaaabbbbccccddddeeeeffff00001111'
const TASKS = '99998888777766665555444433332222'
const ROW = '11112222333344445555666677778888'

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

function pathsOf(plan: ImportPlan): string[] {
  return plan.files.map((one) => one.path)
}

function noteAt(plan: ImportPlan, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  if (!found || found.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

describe('a Notion export', () => {
  test('loses the ids and lands as the tree it looked like', async () => {
    const plan = await readNotion([
      file(`Plan ${PLAN}.md`, `# Plan\n\nSee [Kit list](Plan%20${PLAN}/Kit%20list%20${SUB}.md).\n`),
      file(`Plan ${PLAN}/Kit list ${SUB}.md`, '# Kit list\n\nA tent.\n'),
      file(`Plan ${PLAN}/tent ${SUB}.png`, 'PNG'),
    ])

    expect(pathsOf(plan)).toEqual(['Plan.md', 'Plan/Kit list.md', 'Plan/tent.png'])
    // A note and a folder of the same name is how nib nests, so the page that
    // had pages under it still stands for them.
    expect(noteAt(plan, 'Plan.md')).toContain('[[Kit list]]')
  })

  test('a page keeps its properties as front matter', async () => {
    const plan = await readNotion([
      file(
        `Task ${PLAN}.md`,
        '# Task\nStatus: Done\nCreated: January 2, 2026\nLast edited time: March 4, 2026\nTags: work, urgent\n\nThe words.\n',
      ),
    ])

    const text = noteAt(plan, 'Task.md')
    expect(text).toContain('date: 2026-01-02')
    expect(text).toContain('updated: 2026-03-04')
    expect(text).toContain('tags: [work, urgent]')
    expect(text).toContain('status: Done')
    expect(text).toContain('# Task')
    expect(text).toContain('The words.')
    expect(text).not.toContain('Status: Done')
  })

  test('a database becomes its folder note, holding every row', async () => {
    const plan = await readNotion([
      file(`Tasks ${TASKS}.csv`, 'Name,Status\nOne,Done\n'),
      file(`Tasks ${TASKS}_all.csv`, 'Name,Status\nOne,Done\nTwo,Doing\n'),
      file(`Tasks ${TASKS}/One ${ROW}.md`, '# One\nStatus: Done\n\nWords.\n'),
    ])

    expect(pathsOf(plan)).toEqual(['Tasks.md', 'Tasks/One.md'])

    const table = noteAt(plan, 'Tasks.md')
    expect(table).toContain('| Name | Status |')
    expect(table).toContain('| Two | Doing |')
    expect(plan.lost[0]?.text).toContain('saved views')
  })

  test('a cell with a pipe or a paragraph in it does not break the table', async () => {
    const plan = await readNotion([
      file(`Tasks ${TASKS}_all.csv`, 'Name,Note\n"A | B","one\ntwo"\n'),
    ])

    const table = noteAt(plan, 'Tasks.md')
    expect(table).toContain('| A \\| B | one two |')
    // Three rows and no more: the newline inside the paragraph would otherwise
    // end the row it is in.
    expect(table.split('\n').filter((one) => one.startsWith('|'))).toHaveLength(3)
  })

  test('an HTML export is read as HTML rather than refused', async () => {
    const plan = await readNotion([
      file(`Plan ${PLAN}.html`, '<h1>Plan</h1><p>Words</p>'),
      file(`Plan ${PLAN}/Kit ${SUB}.html`, '<h1>Kit</h1>'),
    ])

    expect(pathsOf(plan)).toEqual(['Plan.md', 'Plan/Kit.md'])
    expect(plan.format).toBe('notion')
  })
})

describe('what counts as a page of properties', () => {
  test('is the block directly under the title, which is where Notion writes it', () => {
    // Every Notion export leaves a blank line between the title and the page's
    // own words, so words separated from the title are words.
    const text = '# Plan\n\nOne thing: it works.\n\nMore.\n'

    expect(notionPage(text).body).toBe(text)
    expect(notionPage(text).meta).toEqual({})
  })

  test('keeps a page that opens with its words', () => {
    const text = 'Just words, no title.\n'

    expect(notionPage(text).body).toBe(text)
  })

  test('reads a property block that is not followed by any words', () => {
    const said = notionPage('# Plan\nStatus: Done\n')

    expect(said.meta.extra).toEqual([['Status', 'Done']])
    expect(said.body.trim()).toBe('# Plan')
  })
})
