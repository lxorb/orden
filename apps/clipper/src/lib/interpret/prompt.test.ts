import { describe, expect, test } from 'vitest'
import { excerpt, MOST_CHARACTERS, type Page, promptFor } from './prompt'
import type { Template } from './templates'

const PAGE: Page = {
  url: 'https://site.example/a',
  title: 'A headline | Site',
  text: 'The article itself.',
}

const TEMPLATE: Template = {
  name: 'Article',
  when: ['*'],
  fields: [
    { key: 'author', says: 'Who wrote it, as printed', list: false },
    { key: 'tags', says: 'Three to six topics', list: true },
  ],
}

describe('how much of an article is sent', () => {
  test('is all of it when there is not much of it', () => {
    expect(excerpt('One paragraph.')).toBe('One paragraph.')
  })

  test('leaves the blank runs a converted page is full of out of the count', () => {
    expect(excerpt('One.\n\n\n\n\nTwo.')).toBe('One.\n\nTwo.')
  })

  test('stops at a paragraph rather than in the middle of a sentence', () => {
    const text = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`

    expect(excerpt(text, 100)).toBe('a'.repeat(60))
  })

  test('takes the cut where it falls when there is no paragraph to take it at', () => {
    expect(excerpt('a'.repeat(200), 50)).toHaveLength(50)
  })

  test('is a few thousand characters, which is what the count beside the switch says', () => {
    expect(excerpt('a'.repeat(MOST_CHARACTERS * 2))).toHaveLength(MOST_CHARACTERS)
  })
})

describe('the prompt a template makes', () => {
  const { system, user } = promptFor(PAGE, TEMPLATE)

  test('asks for one object and nothing around it', () => {
    expect(system).toContain('one JSON object and nothing else')
    expect(system).toContain('no code fence')
  })

  test('says that a property nobody can find is left out rather than invented', () => {
    expect(system).toContain('never guess')
    expect(system).toContain('Leave one out when the page does not say it')
  })

  test('says what the page is and what it calls itself', () => {
    expect(user).toContain('Address: https://site.example/a')
    expect(user).toContain("Page's own title: A headline | Site")
  })

  test('asks for exactly the properties the template names, in its words', () => {
    expect(user).toContain('author: Who wrote it, as printed')
    expect(user).toContain('tags[]: Three to six topics')
  })

  test('marks a list so the answer comes back as one', () => {
    expect(system).toContain('name[] takes an')
    expect(user).not.toContain('author[]')
  })

  test('ends with the article, so what was trimmed is the last thing in it', () => {
    expect(user.endsWith('The article itself.')).toBe(true)
  })

  test('is the same words for every provider, which is the point of it being here', () => {
    expect(promptFor(PAGE, TEMPLATE)).toEqual({ system, user })
  })
})
