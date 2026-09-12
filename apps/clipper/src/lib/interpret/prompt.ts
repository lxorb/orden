/** What the model is asked, and how much of the page it is asked about.
 *
 *  One prompt for every provider: the request shapes differ, the words do not,
 *  so a template answered by Claude and the same template answered by a model on
 *  the machine are answering the same question. Pure, and the only reason this is
 *  its own file: what a person's own templates make the extension say is worth
 *  reading in one place.
 *
 *  The page goes in as the article the clip already is - what Readability kept
 *  and the converter turned into markdown - trimmed to a few thousand characters.
 *  Nothing else about the page is sent: not the navigation, not the comments, not
 *  the scripts. The count of what would go is shown beside the toggle, because a
 *  person about to hand a page to a provider should be told how much of it. */

import type { Field, Template } from './templates'

/** The page, as the prompt carries it. */
export interface Page {
  url: string
  /** What the page calls itself, before the interpreter has an opinion. */
  title: string
  /** The article, already trimmed by `excerpt`. */
  text: string
}

/** How much of an article goes to a provider. About three thousand tokens: long
 *  enough that the properties are in it for all but the longest essays, short
 *  enough to stay cheap and to fit a model running on somebody's laptop. */
export const MOST_CHARACTERS = 12000

/** The article as much of it as is sent: the blank runs collapsed, and the cut
 *  taken at the last paragraph break so the model is never handed half a
 *  sentence. */
export function excerpt(markdown: string, limit = MOST_CHARACTERS): string {
  const text = markdown.replace(/\n{3,}/g, '\n\n').trim()
  if (text.length <= limit) return text

  const cut = text.slice(0, limit)
  const paragraph = cut.lastIndexOf('\n\n')

  return (paragraph > limit / 2 ? cut.slice(0, paragraph) : cut).trim()
}

/** The one instruction, and it is mostly about what not to do: a property nobody
 *  can find on the page has to come back missing rather than invented, because an
 *  invented author is worse than none in a note somebody will read in a year. */
const SYSTEM = [
  'You fill in properties about a web page.',
  'Answer with one JSON object and nothing else: no prose, no code fence.',
  'Every property is optional. Leave one out when the page does not say it;',
  'never guess, and never state anything the page does not.',
  'Each value is one line of plain text. A property written as name[] takes an',
  'array of strings.',
].join(' ')

function asked(field: Field): string {
  return `${field.key}${field.list ? '[]' : ''}: ${field.says}`
}

/** The prompt for one page and one template, as the two halves every provider
 *  has a place for. */
export function promptFor(page: Page, template: Template): { system: string; user: string } {
  const user = [
    `Address: ${page.url}`,
    `Page's own title: ${page.title}`,
    '',
    'Fill in these properties:',
    ...template.fields.map(asked),
    '',
    'The page:',
    '',
    page.text,
  ].join('\n')

  return { system: SYSTEM, user }
}
