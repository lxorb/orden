import { findLinks } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'
import { readBear } from './bear'
import { readLogseq } from './logseq'
import { valueAs } from './notion-database'
import { readRoam } from './roam'
import { sourceOf } from './sources'

const file = (path: string, text: string) => sourceOf(path, new TextEncoder().encode(text))

const textOf = (plan: { files: readonly unknown[] }, path: string) =>
  String((plan.files as { path: string; text?: string }[]).find((one) => one.path === path)?.text)

const reached = (text: string) => findLinks(text).map((one) => one.target)

describe('a page named with what a wikilink cannot hold', () => {
  test('is linked from Roam as a link that reaches it', async () => {
    const plan = await readRoam([
      file(
        'graph.json',
        JSON.stringify([
          { title: 'C#', children: [{ string: 'A language' }] },
          { title: 'Langs', children: [{ string: 'See [[C#]] and [it]([[C#]])' }] },
        ]),
      ),
    ])
    expect(reached(textOf(plan, 'Langs.md'))).toEqual(['C#.md', 'C#.md'])
  })

  test('is linked from Logseq as a link that reaches it', async () => {
    const plan = await readLogseq([file('pages/C#.md', '- A language\n'), file('pages/Langs.md', '- See [[C#]]\n')])
    expect(reached(textOf(plan, 'Langs.md'))).toEqual(['C#.md'])
  })

  test('is linked from Bear as a link that reaches it', async () => {
    const plan = await readBear([file('C#.md', '# C#\n'), file('Langs.md', '# Langs\nSee [[C#]]\n')])
    expect(reached(textOf(plan, 'Langs.md'))).toEqual(['C#.md'])
  })

  test('is a Notion relation that reaches it', () => {
    const value = valueAs('pages', 'C# basics (C%23%20basics%200123456789abcdef0123456789abcdef.md)')
    expect(reached(String(value))).toEqual(['C# basics.md'])
  })
})
