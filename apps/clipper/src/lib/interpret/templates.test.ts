import { describe, expect, test } from 'vitest'
import {
  claims,
  named,
  readTemplates,
  TEMPLATE_PROBLEMS,
  templateFor,
  templatesOf,
  TEMPLATES,
} from './templates'

/** The templates the reader produced, or a failure that says which line. Every
 *  test below reads the text the options page would have held. */
function read(source: string) {
  const answer = readTemplates(source)
  if ('problem' in answer) throw new Error(`line ${answer.line}: ${answer.problem}`)

  return answer.templates
}

describe('the templates that ship', () => {
  test('read back as the six they are written as', () => {
    expect(read(TEMPLATES).map((one) => one.name)).toEqual([
      'Recipe',
      'Product',
      'Paper',
      'Thread',
      'Article',
      'Generic',
    ])
  })

  test('each fill in something', () => {
    for (const one of read(TEMPLATES)) expect(one.fields.length, one.name).toBeGreaterThan(2)
  })

  test('keep the words the model is given', () => {
    const article = named(read(TEMPLATES), 'Article')
    expect(article?.fields.map((one) => one.key)).toEqual([
      'title',
      'author',
      'published',
      'summary',
      'tags',
    ])
    expect(article?.fields.at(1)?.says).toBe('Who wrote it, as printed')
  })

  test('say which properties are lists', () => {
    const article = named(read(TEMPLATES), 'Article')
    expect(article?.fields.find((one) => one.key === 'tags')?.list).toBe(true)
    expect(article?.fields.find((one) => one.key === 'author')?.list).toBe(false)
  })

  test('leave the last one for a hand to pick', () => {
    expect(named(read(TEMPLATES), 'Generic')?.when).toEqual([])
  })

  test('name no property the clip writes for itself', () => {
    for (const one of read(TEMPLATES)) {
      for (const field of one.fields) {
        expect(['source', 'clipped'], one.name).not.toContain(field.key)
      }
    }
  })
})

describe('reading a template', () => {
  test('takes a name, the addresses it claims and its properties', () => {
    expect(
      read(`- name: Recipe
  when: '*/recipe/*, *cooking*'
  fields:
    servings: How many it serves
    tags[]: A few topics`),
    ).toEqual([
      {
        name: 'Recipe',
        when: ['*/recipe/*', '*cooking*'],
        fields: [
          { key: 'servings', says: 'How many it serves', list: false },
          { key: 'tags', says: 'A few topics', list: true },
        ],
      },
    ])
  })

  test('ignores blank lines and comments', () => {
    const one = read(`# what these are

- name: One

  # the one thing it fills in
  fields:
    title: The headline
`)

    expect(one).toHaveLength(1)
    expect(one[0]?.fields).toHaveLength(1)
  })

  test('takes the quotes off a value without reading what is inside them', () => {
    expect(read(`- name: 'One: and two'\n  fields:\n    a: "say: this"`)[0]).toEqual({
      name: 'One: and two',
      when: [],
      fields: [{ key: 'a', says: 'say: this', list: false }],
    })
  })

  test('reads a template with no properties as one with no properties', () => {
    expect(read('- name: Bare')[0]?.fields).toEqual([])
  })
})

describe('a line that does not read', () => {
  test('is reported with its number rather than skipped', () => {
    expect(readTemplates(`- name: One\n  fields:\n    a: b\n  nonsense\n`)).toEqual({
      problem: TEMPLATE_PROBLEMS.badLine,
      line: 4,
    })
  })

  test('is a key the template has no place for', () => {
    expect(readTemplates(`- name: One\n  colour: red\n`)).toEqual({
      problem: TEMPLATE_PROBLEMS.badLine,
      line: 2,
    })
  })

  test('is a property outside any template', () => {
    expect(readTemplates(`  title: nowhere\n`)).toEqual({
      problem: TEMPLATE_PROBLEMS.badLine,
      line: 1,
    })
  })

  test('is a property the clip writes itself', () => {
    expect(readTemplates(`- name: One\n  fields:\n    source: where it came from\n`)).toEqual({
      problem: TEMPLATE_PROBLEMS.reserved,
      line: 3,
    })
    expect(readTemplates(`- name: One\n  fields:\n    clipped: when\n`)).toEqual({
      problem: TEMPLATE_PROBLEMS.reserved,
      line: 3,
    })
  })

  test('is a template with nothing to call it', () => {
    expect(readTemplates(`- fields:\n    title: The headline\n`)).toEqual({
      problem: TEMPLATE_PROBLEMS.noName,
      line: 1,
    })
    expect(readTemplates(`- name:\n`)).toEqual({ problem: TEMPLATE_PROBLEMS.noName, line: 1 })
  })

  test('points at the template that has no name, not at the one after it', () => {
    expect(readTemplates(`- name: One\n\n- when: '*'\n\n- name: Three\n`)).toEqual({
      problem: TEMPLATE_PROBLEMS.noName,
      line: 3,
    })
  })

  test('is a name that is already taken', () => {
    expect(readTemplates(`- name: One\n- name: One\n`)).toEqual({
      problem: TEMPLATE_PROBLEMS.twice,
      line: 2,
    })
  })

  test('is a property said twice, which would otherwise be asked for twice', () => {
    expect(readTemplates(`- name: One\n  fields:\n    a: one\n    a: two\n`)).toEqual({
      problem: TEMPLATE_PROBLEMS.twice,
      line: 4,
    })
  })

  test('is nothing at all', () => {
    expect(readTemplates('')).toEqual({ problem: TEMPLATE_PROBLEMS.empty, line: 1 })
    expect(readTemplates('# only a comment\n')).toEqual({
      problem: TEMPLATE_PROBLEMS.empty,
      line: 1,
    })
  })

  test('is a properties block with a value on its own line', () => {
    expect(readTemplates(`- name: One\n  fields: title\n`)).toEqual({
      problem: TEMPLATE_PROBLEMS.badLine,
      line: 2,
    })
  })
})

describe('what the clipper uses whatever is stored', () => {
  test('is the text where it reads', () => {
    expect(templatesOf('- name: Mine\n').map((one) => one.name)).toEqual(['Mine'])
  })

  test('is the six that ship where it does not, so a clip never waits on a typo', () => {
    expect(templatesOf('nonsense').map((one) => one.name)).toEqual(
      read(TEMPLATES).map((one) => one.name),
    )
    expect(templatesOf('')).toHaveLength(6)
  })
})

describe('an address pattern', () => {
  test('claims what it says and nothing around it', () => {
    expect(claims('*arxiv.org/*', 'https://arxiv.org/abs/2401.00001')).toBe(true)
    expect(claims('*arxiv.org/*', 'https://notarxiv.example/arxiv')).toBe(false)
  })

  test('reads a star as any run of characters and everything else as itself', () => {
    expect(claims('*/dp/*', 'https://shop.example/dp/B000')).toBe(true)
    expect(claims('*/dp/*', 'https://shop.example/dpx/B000')).toBe(false)
    expect(claims('*x.com/*/status/*', 'https://x.com/someone/status/12')).toBe(true)
  })

  test('does not read a dot as any character, which a regular expression would', () => {
    expect(claims('*doi.org/*', 'https://doixorg.example/10.1/a')).toBe(false)
  })

  test('is anchored at both ends', () => {
    expect(claims('https://site.example/a', 'https://site.example/a')).toBe(true)
    expect(claims('https://site.example/a', 'https://site.example/ab')).toBe(false)
  })

  test('minds neither case nor a pattern padded with blanks', () => {
    expect(claims('  *ARXIV.org/*  ', 'https://arxiv.org/abs/1')).toBe(true)
  })

  test('claims nothing when it says nothing', () => {
    expect(claims('', 'https://site.example/a')).toBe(false)
  })
})

describe('the template a page gets by itself', () => {
  const templates = read(TEMPLATES)

  test('is the first one claiming its address', () => {
    expect(templateFor(templates, 'https://arxiv.org/abs/2401.1')?.name).toBe('Paper')
    expect(templateFor(templates, 'https://x.com/a/status/1')?.name).toBe('Thread')
    expect(templateFor(templates, 'https://shop.example/dp/B01')?.name).toBe('Product')
  })

  test('is Article for a page that says nothing else about itself', () => {
    expect(templateFor(templates, 'https://blog.example/hello')?.name).toBe('Article')
  })

  test('is the first in the list when nothing claims the address at all', () => {
    const own = read('- name: Only\n  fields:\n    title: What it is')
    expect(templateFor(own, 'https://site.example/a')?.name).toBe('Only')
  })

  test('is nothing when there are no templates to offer', () => {
    expect(templateFor([], 'https://site.example/a')).toBe(null)
  })
})
