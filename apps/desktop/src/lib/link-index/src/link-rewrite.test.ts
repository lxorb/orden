import { describe, expect, test } from 'vitest'
import { findLinks, type FoundLink } from '@orden/markdown/links'
import { rewriteLinks } from './link-rewrite'

const pointsAt = (wanted: string) => (link: FoundLink) =>
  link.target
    .replace(/\.(md|markdown)$/i, '')
    .toLowerCase()
    .endsWith(wanted.toLowerCase())

const move = { from: 'Plan.md', to: 'Roadmap.md' }

describe('rewriting a wikilink', () => {
  test('a bare name becomes the new bare name', () => {
    expect(rewriteLinks('see [[Plan]] now', 'Note.md', move, pointsAt('plan'))).toBe(
      'see [[Roadmap]] now',
    )
  })

  test('an alias, a heading and a block all survive', () => {
    const text = '[[Plan|the plan]] [[Plan#Today]] [[Plan#^abc]]'
    expect(rewriteLinks(text, 'Note.md', move, pointsAt('plan'))).toBe(
      '[[Roadmap|the plan]] [[Roadmap#Today]] [[Roadmap#^abc]]',
    )
  })

  test('a path-qualified link keeps its path, with the new one', () => {
    const deeper = { from: 'ideas/Plan.md', to: 'later/Roadmap.md' }
    expect(rewriteLinks('[[ideas/Plan]]', 'Note.md', deeper, pointsAt('plan'))).toBe(
      '[[later/Roadmap]]',
    )
  })

  test('an extension is kept when the link was written with one', () => {
    expect(rewriteLinks('[[Plan.md]]', 'Note.md', move, pointsAt('plan'))).toBe('[[Roadmap.md]]')
  })

  test('an embed is rewritten like any other link', () => {
    expect(rewriteLinks('![[Plan]]', 'Note.md', move, pointsAt('plan'))).toBe('![[Roadmap]]')
  })

  test('a name with spaces and unicode comes through', () => {
    const renamed = { from: 'Mémo für Später.md', to: 'Später/Mémo neu.md' }
    expect(rewriteLinks('[[Mémo für Später]]', 'Note.md', renamed, () => true)).toBe('[[Mémo neu]]')
  })

  test('a note with no link to it is left entirely alone', () => {
    expect(rewriteLinks('nothing here', 'Note.md', move, pointsAt('plan'))).toBeNull()
    expect(rewriteLinks('[[Other]]', 'Note.md', move, pointsAt('plan'))).toBeNull()
  })

  test('the words around a link are untouched, spaces and all', () => {
    const text = '  a\t[[Plan]]  b\n\n**bold**\n'
    expect(rewriteLinks(text, 'Note.md', move, pointsAt('plan'))).toBe(
      '  a\t[[Roadmap]]  b\n\n**bold**\n',
    )
  })

  test('a link in code is not a link and is not rewritten', () => {
    expect(rewriteLinks('`[[Plan]]`', 'Note.md', move, pointsAt('plan'))).toBeNull()
    expect(rewriteLinks('```\n[[Plan]]\n```', 'Note.md', move, pointsAt('plan'))).toBeNull()
  })

  test('several links on one line are all rewritten', () => {
    expect(rewriteLinks('[[Plan]] and [[Plan|again]]', 'Note.md', move, pointsAt('plan'))).toBe(
      '[[Roadmap]] and [[Roadmap|again]]',
    )
  })
})

describe('rewriting a markdown link', () => {
  test('gets a path relative to the note it is written in', () => {
    const renamed = { from: 'ideas/Plan.md', to: 'later/Roadmap.md' }
    expect(rewriteLinks('[the plan](ideas/Plan.md)', 'Note.md', renamed, pointsAt('plan'))).toBe(
      '[the plan](later/Roadmap.md)',
    )
  })

  test('climbs out of the folder it is written in when it has to', () => {
    const renamed = { from: 'ideas/Plan.md', to: 'Roadmap.md' }
    expect(rewriteLinks('[x](Plan.md)', 'ideas/Deep/Note.md', renamed, pointsAt('plan'))).toBe(
      '[x](../../Roadmap.md)',
    )
  })

  test('a name in the same folder is written on its own', () => {
    const renamed = { from: 'ideas/Plan.md', to: 'ideas/Roadmap.md' }
    expect(rewriteLinks('[x](Plan.md)', 'ideas/Note.md', renamed, pointsAt('plan'))).toBe(
      '[x](Roadmap.md)',
    )
  })

  test('a space in the new name is encoded rather than left to end the target', () => {
    const renamed = { from: 'Plan.md', to: 'The Road Map.md' }
    expect(rewriteLinks('[x](Plan.md)', 'Note.md', renamed, pointsAt('plan'))).toBe(
      '[x](The%20Road%20Map.md)',
    )
  })

  test('a hash in the new name cannot become a fragment', () => {
    const renamed = { from: 'Plan.md', to: 'C#.md' }
    expect(rewriteLinks('[x](Plan.md)', 'Note.md', renamed, pointsAt('plan'))).toBe('[x](C%23.md)')
  })

  test('a fragment on the link is left where it was', () => {
    expect(rewriteLinks('[x](Plan.md#today)', 'Note.md', move, pointsAt('plan'))).toBe(
      '[x](Roadmap.md#today)',
    )
  })

  test('a title is left where it was', () => {
    expect(rewriteLinks('[x](Plan.md "A title")', 'Note.md', move, pointsAt('plan'))).toBe(
      '[x](Roadmap.md "A title")',
    )
  })

  test('an angled target is replaced in place', () => {
    const renamed = { from: 'My Plan.md', to: 'Roadmap.md' }
    expect(rewriteLinks('[x](<My Plan.md>)', 'Note.md', renamed, () => true)).toBe(
      '[x](<Roadmap.md>)',
    )
  })
})

describe('code the page draws is never rewritten', () => {
  test('a fence in a callout, indented code, and code in a list item', () => {
    for (const note of [
      '> [!example] Linking\n> ```md\n> See [[Plan]] for more.\n> ```\n',
      'Write it like this:\n\n    [[Plan]]\n',
      '- step\n\n      [[Plan]]\n',
      '- step\n  ```\n  [[Plan]]\n  ```\n',
    ]) {
      expect(rewriteLinks(note, 'Note.md', move, pointsAt('Plan')), note).toBeNull()
    }
    expect(rewriteLinks('> See [[Plan]]\n', 'Note.md', move, pointsAt('Plan'))).toBe(
      '> See [[Roadmap]]\n',
    )
  })
})

describe('renaming a note to a name a wikilink cannot say', () => {
  const to = { from: 'Plan.md', to: 'f/C# basics.md' }

  test('turns the links to it into markdown links, keeping what they said', () => {
    expect(rewriteLinks('a [[Plan]] b', 'Note.md', to, pointsAt('plan'))).toBe(
      'a [C# basics](f/C%23%20basics.md) b',
    )
    expect(rewriteLinks('[[Plan|the plan]]', 'g/Note.md', to, pointsAt('plan'))).toBe(
      '[the plan](../f/C%23%20basics.md)',
    )
    expect(rewriteLinks('[[Plan#Some Part]]', 'Note.md', to, pointsAt('plan'))).toBe(
      '[C# basics](f/C%23%20basics.md#some-part)',
    )
    expect(rewriteLinks('[[Plan#^a1]]', 'Note.md', to, pointsAt('plan'))).toBe(
      '[C# basics](f/C%23%20basics.md#^a1)',
    )
    expect(rewriteLinks('![[Plan]]', 'Note.md', to, pointsAt('plan'))).toBe(
      '![C# basics](f/C%23%20basics.md)',
    )
  })

  test('leaves every other link and word alone', () => {
    expect(
      rewriteLinks('[[Other]] [[Plan]] [x](Other.md) `[[Plan]]`', 'Note.md', to, pointsAt('plan')),
    ).toBe('[[Other]] [C# basics](f/C%23%20basics.md) [x](Other.md) `[[Plan]]`')
  })

  test('a link the app wrote to such a name is found and renamed again', () => {
    const first = rewriteLinks('[[Plan]]', 'Note.md', to, pointsAt('plan')) ?? ''
    expect(
      rewriteLinks(
        first,
        'Note.md',
        { from: to.to, to: 'Road.md' },
        (link) => link.target === 'f/C# basics.md',
      ),
    ).toBe('[C# basics](Road.md)')
  })
})

describe('a link that changes spelling keeps what it could say', () => {
  const to = (name: string) => ({ from: 'Old.md', to: name })

  test('a bar in the name does not cut a table row', () => {
    expect(rewriteLinks('| [[Old]] | b |', 'N.md', to('a|b.md'), pointsAt('old'))).toBe(
      '| [a\\|b](a%7Cb.md) | b |',
    )
  })

  test('a table wikilink keeps its words without its backslash', () => {
    expect(rewriteLinks('| [[Old\\|see]] |', 'N.md', to('C#.md'), pointsAt('old'))).toBe(
      '| [see](C%23.md) |',
    )
  })

  test('a picture keeps its size, in the spelling Obsidian reads', () => {
    const png = { from: 'Old.png', to: 'C#.png' }
    const points = (link: FoundLink) => link.target === 'Old.png'
    expect(rewriteLinks('![[Old.png|100x200]]', 'N.md', png, points)).toBe(
      '![\\|100x200](C%23.png)',
    )
    expect(rewriteLinks('![[Old.png|300]]', 'N.md', png, points)).toBe('![\\|300](C%23.png)')
  })
})

describe('a link in quoted front matter', () => {
  const quoted = (to: string) => ({ from: 'Plan.md', to })

  test('a new name with an apostrophe moves a single-quoted value into double quotes', () => {
    const text = "---\nup: '[[Plan]]'\n---\nbody"
    expect(rewriteLinks(text, 'One.md', quoted("Bob's plan.md"), pointsAt('plan'))).toBe(
      '---\nup: "[[Bob\'s plan]]"\n---\nbody',
    )
  })

  test('a new name with quotes or backslashes moves a double-quoted value into single quotes', () => {
    const text = '---\nrel: "[[Plan]]"\nlist:\n  - "[[Plan|p]]"\n---\nbody'
    expect(rewriteLinks(text, 'One.md', quoted('Say "hi" \\ there.md'), pointsAt('plan'))).toBe(
      '---\nrel: \'[[Say "hi" \\ there]]\'\nlist:\n  - \'[[Say "hi" \\ there|p]]\'\n---\nbody',
    )
  })

  test('a value that cannot change its quotes escapes the new name as its quotes need', () => {
    const text = '---\nup: \'[[Plan]] "x"\'\nrel: "[[Plan]] it\'s"\n---\n'
    expect(rewriteLinks(text, 'One.md', quoted('Bob\'s "plan".md'), pointsAt('plan'))).toBe(
      '---\nup: \'[[Bob\'\'s "plan"]] "x"\'\nrel: "[[Bob\'s \\"plan\\"]] it\'s"\n---\n',
    )
  })

  test('an escaped new name is read back as the name and renamed again cleanly', () => {
    const text = '---\nup: \'[[Plan]] "x"\'\nrel: "[[Plan]] it\'s"\n---\n'
    const once = rewriteLinks(text, 'One.md', quoted('Bob\'s "plan".md'), pointsAt('plan')) ?? ''
    expect(findLinks(once).map((link) => link.target)).toEqual(['Bob\'s "plan"', 'Bob\'s "plan"'])
    const back = (link: FoundLink) => link.target === 'Bob\'s "plan"'
    expect(rewriteLinks(once, 'One.md', { from: 'Bob\'s "plan".md', to: 'Plan.md' }, back)).toBe(
      text,
    )
  })

  test('the same name in the body and in a plain value is written as it is', () => {
    const text = "---\nup: [[Plan]]\n---\n[[Plan]] 'x'"
    expect(rewriteLinks(text, 'One.md', quoted("Bob's plan.md"), pointsAt('plan'))).toBe(
      "---\nup: [[Bob's plan]]\n---\n[[Bob's plan]] 'x'",
    )
  })

  test('apostrophes in a plain value are words, not quotes', () => {
    const text = "---\nnote: Bob's [[Plan]] and Jim's\n---\n"
    expect(rewriteLinks(text, 'One.md', quoted("O'Neil.md"), pointsAt('plan'))).toBe(
      "---\nnote: Bob's [[O'Neil]] and Jim's\n---\n",
    )
  })

  test('each link of a flow list keeps to its own quotes', () => {
    const text = "---\nrel: ['[[Plan]]', \"[[Plan]]\", '[[Other]]']\n---\n"
    expect(rewriteLinks(text, 'One.md', quoted("It's.md"), pointsAt('plan'))).toBe(
      '---\nrel: ["[[It\'s]]", "[[It\'s]]", \'[[Other]]\']\n---\n',
    )
  })

  test('a name that needs no escaping leaves the quotes as they were', () => {
    const text = "---\nup: '[[Plan]]'\n---\n"
    expect(rewriteLinks(text, 'One.md', quoted('Roadmap.md'), pointsAt('plan'))).toBe(
      "---\nup: '[[Roadmap]]'\n---\n",
    )
  })
})

describe('a link in plain front matter', () => {
  const renamed = (to: string) => ({ from: 'Plan.md', to: `${to}.md` })

  test.each(['@Alice', 'a{b}', '%20', '*x', 'a, b', 'a: b'])(
    'a new name %s that plain YAML cannot hold is quoted, in a value and in a list',
    (name) => {
      const text = '---\nup: [[Plan]]\nlist:\n  - [[Plan]]\n---\n[[Plan]]'
      const out = rewriteLinks(text, 'One.md', renamed(name), pointsAt('plan')) ?? ''
      expect(out).toBe(`---\nup: "[[${name}]]"\nlist:\n  - "[[${name}]]"\n---\n[[${name}]]`)
      expect(findLinks(out).map((link) => link.target)).toEqual([name, name, name])
    },
  )

  test('a link written as markdown for a name with a hash is quoted', () => {
    const text = '---\nup: [[Plan]]\nnote: see [[Plan]] first\n---\n'
    expect(rewriteLinks(text, 'One.md', renamed('Issue #12'), pointsAt('plan'))).toBe(
      '---\nup: "[Issue #12](Issue%20%2312.md)"\nnote: "see [Issue #12](Issue%20%2312.md) first"\n---\n',
    )
  })

  test('a quoted name with double quotes takes single quotes', () => {
    const text = '---\nup: [[Plan]]\n---\n'
    expect(rewriteLinks(text, 'One.md', renamed('@"x"'), pointsAt('plan'))).toBe(
      '---\nup: \'[[@"x"]]\'\n---\n',
    )
  })

  test('a name plain YAML holds stays plain', () => {
    const text = '---\nup: [[Plan]]\nlist:\n  - [[Plan|p]]\n---\n'
    expect(rewriteLinks(text, 'One.md', renamed('Road map 2'), pointsAt('plan'))).toBe(
      '---\nup: [[Road map 2]]\nlist:\n  - [[Road map 2|p]]\n---\n',
    )
  })

  test('a value that was not plain YAML before is left as it was', () => {
    const text = '---\nrel: [[[Plan]], [[Other]]]\ntext: |\n  see [[Plan]]\n---\n'
    expect(rewriteLinks(text, 'One.md', renamed('@Alice'), pointsAt('plan'))).toBe(
      '---\nrel: [[[@Alice]], [[Other]]]\ntext: |\n  see [[@Alice]]\n---\n',
    )
  })
})

describe('a new name that reads as a file a tab opens', () => {
  test.each(['Ideas.canvas', 'Report.pdf', 'Book.pages', 'Site.url', 'Table.base'])(
    'a wikilink to a note renamed %s.md keeps the .md that makes it a note',
    (name) => {
      const text = 'see [[Plan]], [[Plan|p]] and [p](Plan.md)'
      expect(
        rewriteLinks(text, 'One.md', { from: 'Plan.md', to: `${name}.md` }, pointsAt('plan')),
      ).toBe(`see [[${name}.md]], [[${name}.md|p]] and [p](${name}.md)`)
    },
  )
})
