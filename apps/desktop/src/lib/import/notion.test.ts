import { readBase } from '@nib/bases'
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
  if (found?.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

/** What a ` ```base ` fence in a note holds. */
function fenced(note: string): string {
  const found = /```base\n([\s\S]*?)\n```/.exec(note)
  if (!found) throw new Error('no base in the note')
  return found[1] ?? ''
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

  test('a database becomes its folder note, holding a base over its rows', async () => {
    const plan = await readNotion([
      file(`Tasks ${TASKS}.csv`, 'Name,Status\nOne,Done\n'),
      file(`Tasks ${TASKS}_all.csv`, 'Name,Status,Due\nOne,Done,\nTwo,Doing,"October 10, 2026"\n'),
      file(`Tasks ${TASKS}/One ${ROW}.md`, '# One\nStatus: Done\n\nWords.\n'),
    ])

    // Two, which has no page of its own in the export, is a note all the same,
    // so no row is in Notion's table and missing from nib's.
    expect(pathsOf(plan)).toEqual(['Tasks.md', 'Tasks/One.md', 'Tasks/Two.md'])

    const base = readBase(fenced(noteAt(plan, 'Tasks.md')))
    expect(base.filters).toEqual({ and: ['file.folder + ".md" == this.file.path'] })
    expect(base.views[0]?.order).toEqual(['file.name', 'note.status', 'note.due'])
    expect(base.properties['note.status']?.displayName).toBe('Status')
    expect(noteAt(plan, 'Tasks/Two.md')).toContain('due: 2026-10-10')
    expect(plan.lost[0]?.text).toContain('saved views')
  })

  test('a row is written as what its column holds', async () => {
    const plan = await readNotion([
      file(
        `Books ${TASKS}_all.csv`,
        [
          'Name,Pages,Read,Started,Genre,Author,Code,Note',
          `Dune,412,Yes,"January 2, 2026 3:30 PM","Sci-fi, Classic",Herbert (People%20${SUB}/Herbert%20${ROW}.md),007,"Long, and worth it"`,
          'Ubik,224,No,"March 4, 2026","Sci-fi",,12,Short',
        ].join('\n'),
      ),
      file(
        `Books ${TASKS}/Dune ${ROW}.md`,
        [
          '# Dune',
          'Pages: 412',
          'Read: Yes',
          'Started: January 2, 2026 3:30 PM',
          'Genre: Sci-fi, Classic',
          `Author: Herbert (People%20${SUB}/Herbert%20${ROW}.md)`,
          'Code: 007',
          'Note: Long, and worth it',
          '',
          'Words.',
        ].join('\n'),
      ),
      file(`Books ${TASKS}/Ubik ${ROW}.md`, '# Ubik\nPages: 224\nRead: No\nCode: 12\n\nWords.\n'),
    ])

    const dune = noteAt(plan, 'Books/Dune.md')
    expect(dune).toContain('pages: 412\n')
    expect(dune).toContain('read: true\n')
    expect(dune).toContain('started: 2026-01-02T15:30\n')
    expect(dune).toContain('genre: [Sci-fi, Classic]\n')
    expect(dune).toContain("author: ['[[Herbert]]']\n")
    // A leading zero is a code, and a column with one in it is words throughout.
    expect(dune).toContain("code: '007'\n")
    expect(dune).toContain('note: Long, and worth it\n')
    expect(noteAt(plan, 'Books/Ubik.md')).toContain('read: false\n')
    expect(noteAt(plan, 'Books/Ubik.md')).toContain("code: '12'\n")
  })

  test('a database with no pages at all still has every row', async () => {
    const plan = await readNotion([
      file(`Tasks ${TASKS}_all.csv`, 'Name,Note\n"A | B","one\ntwo"\n,Empty\n'),
    ])

    expect(pathsOf(plan)).toEqual(['Tasks.md', 'Tasks/A B.md', 'Tasks/Untitled.md'])
    expect(noteAt(plan, 'Tasks/A B.md')).toContain('note: one two')
  })

  test('lands as the workspace, not inside the folder Notion zipped it in', async () => {
    const wrap = 'Export-d2b14fbf-86de-4508-a1b2-6515ff8d7aab'
    const plan = await readNotion([
      file(`${wrap}/Plan ${PLAN}.md`, `# Plan\n\n[Kit](Plan%20${PLAN}/Kit%20${SUB}.md)\n`),
      // A large export comes in parts, each in a folder of its own.
      file(`${wrap}-Part-2/Plan ${PLAN}/Kit ${SUB}.md`, '# Kit\n'),
      file(`${wrap}/index.html`, '<ul><li>Plan</li></ul>'),
    ])

    // The index lists what the folders already hold, and is left behind.
    expect(pathsOf(plan)).toEqual(['Plan.md', 'Plan/Kit.md'])
    expect(noteAt(plan, 'Plan.md')).toContain('[[Kit]]')
  })

  test('a row reads its properties under the blank line Notion leaves below the title', async () => {
    const plan = await readNotion([
      file(`Habits ${TASKS}_all.csv`, 'Date,Ran today,📅 Due\n"@May 1, 2026 ",Yes,"May 2, 2026"\n'),
      file(
        `Habits ${TASKS}/@May 1, 2026 ${ROW}.md`,
        '# @May 1, 2026\n\nRan today: Yes\n📅 Due: May 2, 2026\n\nWords.\n',
      ),
      // A page that is not a row keeps a line like that as the words it is.
      file(`Plan ${PLAN}.md`, '# Plan\n\nOne thing: it works.\n'),
    ])

    const row = noteAt(plan, 'Habits/@May 1, 2026.md')
    expect(row).toContain('ran-today: true\n')
    expect(row).toContain('due: 2026-05-02\n')
    expect(row).not.toContain('Ran today: Yes')
    expect(row).toContain('Words.')
    expect(noteAt(plan, 'Plan.md')).toContain('One thing: it works.')
  })

  test('a row whose title was a date mention is the page named as it read that day', async () => {
    const plan = await readNotion([
      file(`Habits ${TASKS}_all.csv`, 'Date,Ran\n"@August 6, 2025 ","August 6, 2025 6:21 AM"\n'),
      file(`Habits ${TASKS}/@Today ${ROW}.md`, '# @Today\n\nRan: August 6, 2025 6:21 AM\n'),
    ])

    // One note, not the page and a second one made for a row with no page.
    expect(pathsOf(plan)).toEqual(['Habits.md', 'Habits/@Today.md'])
  })

  test('finds the rows in a folder named the way Notion names them now', async () => {
    const plan = await readNotion([
      file(`Specs ${TASKS}_all.csv`, 'Name,Method\nLogin,POST\n'),
      file(`Specs/Login ${ROW}.md`, '# Login\n\nMethod: POST\n'),
      file(`Features/Untitled ${PLAN}_Checkout ${SUB}_all.csv`, 'Name,Status\nTax,Done\n'),
      file(`Features/Untitled 1a2b-7890/Checkout/Tax ${ROW}.md`, '# Tax\n\nStatus: Done\n'),
    ])

    expect(pathsOf(plan)).toEqual([
      'Specs.md',
      'Specs/Login.md',
      'Features/Untitled 1a2b-7890/Checkout.md',
      'Features/Untitled 1a2b-7890/Checkout/Tax.md',
    ])
    expect(noteAt(plan, 'Specs/Login.md')).toContain('method: POST')
  })

  test('a link to a database goes to its folder note, and one to a linked view to its page', async () => {
    const plan = await readNotion([
      file(
        `Home ${PLAN}.md`,
        `# Home\n\n[Tasks](Home%20${PLAN}/Tasks%20${TASKS}.csv)\n\n[Mine](Home%20${PLAN}/Mine%20${SUB}.csv)\n`,
      ),
      file(`Home ${PLAN}/Tasks ${TASKS}.csv`, 'Name\nOne\n'),
      file(`Home ${PLAN}/Tasks ${TASKS}_all.csv`, 'Name\nOne\n'),
      file(`Home ${PLAN}/Mine ${SUB}.md`, '# Mine\n'),
    ])

    const home = noteAt(plan, 'Home.md')
    expect(home).toContain('[[Tasks]]')
    expect(home).toContain('[[Mine]]')
  })

  test('an HTML export keeps a row’s properties and its to-dos', async () => {
    const plan = await readNotion([
      file(
        `Gear ${PLAN}/Espresso ${SUB}.html`,
        [
          '<html><body><article><header><h1 class="page-title">Espresso</h1>',
          '<table class="properties"><tbody>',
          '<tr class="property-row property-row-multi_select"><th>Tags</th><td><span class="selected-value">home office</span><span class="selected-value">coffee</span></td></tr>',
          '<tr class="property-row property-row-checkbox"><th>Serviced</th><td><div class="checkbox checkbox-on"></div></td></tr>',
          '<tr class="property-row property-row-date"><th>Bought</th><td><time>@March 1, 2024</time></td></tr>',
          '<tr class="property-row property-row-number"><th>Price</th><td>67.3</td></tr>',
          '<tr class="property-row property-row-text"><th>Notes</th><td>Fast &amp; loud</td></tr>',
          '</tbody></table></header><div class="page-body">',
          '<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span class="to-do-children-checked">Descale</span></li></ul>',
          '<ul class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">Clean</span></li></ul>',
          '</div></article></body></html>',
        ].join(''),
      ),
      file(`Gear ${PLAN}.html`, '<h1>Gear</h1>'),
    ])

    const row = noteAt(plan, 'Gear/Espresso.md')
    expect(row).toContain('tags: [home-office, coffee]\n')
    expect(row).toContain('serviced: true\n')
    expect(row).toContain('bought: 2024-03-01\n')
    expect(row).toContain('price: 67.3\n')
    expect(row).toContain('notes: Fast & loud\n')
    expect(row).toContain('- [x] Descale')
    expect(row).toContain('- [ ] Clean')
    expect(row).not.toContain('Serviced |')
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
