/** What a clipped page is, and the properties worth filling in for it.
 *
 *  A template is a name, the addresses it claims, and a list of properties with
 *  a sentence each saying what the property is. The sentences are the prompt:
 *  `prompt.ts` writes them out and the model answers them, so editing a template
 *  is how somebody changes what the interpreter asks for. Nothing here talks to
 *  a provider and nothing here is async.
 *
 *  The six that ship are written below as the YAML the options page shows, and
 *  read back by the reader in this file rather than kept as a second copy in
 *  code: one source of truth, and the reader is exercised by the defaults on
 *  every run.
 *
 *  The format is a small, deliberate subset of YAML - a list of maps, one nested
 *  map of properties, single-line values - and this is not a YAML parser. A line
 *  it cannot read is reported with its number rather than skipped, because a
 *  template that silently lost a property would fill in less than the person
 *  asked for and say nothing about it. */

/** One property the interpreter fills.
 *
 *  `list` is written in the template as `tags[]`, and decides how the value is
 *  spelled in the front matter: a flow sequence rather than a scalar. */
export interface Field {
  key: string
  /** What the property is, in the words the model is given. */
  says: string
  list: boolean
}

export interface Template {
  /** Its name in the picker, and its identity: the remembered Interpret toggle
   *  and the chosen template are both keyed by it. */
  name: string
  /** The addresses it claims, in the order they were written. Empty means it is
   *  only ever chosen by hand. */
  when: string[]
  fields: Field[]
}

/** What the note writes itself and no model may touch. `title` and `tags` are
 *  deliberately not here: a template may fill them, and `note.ts` says what
 *  happens when it does. */
const RESERVED = ['source', 'clipped']

/** The templates that ship, as the text the options page opens on.
 *
 *  Order is priority: the first template whose pattern matches the page is the
 *  one offered, so the specific ones come before Article's `*`, and Generic
 *  claims nothing at all and is picked by hand. */
export const TEMPLATES = `# A template is a name, the addresses it claims, and the properties the
# interpreter fills in. The first template whose address matches the page is the
# one offered; * stands for any run of characters, and a template with no
# address is only ever chosen by hand. A property written as name[] takes a list.

- name: Recipe
  when: '*/recipe/*, */recipes/*, *allrecipes.com/*, *seriouseats.com/*'
  fields:
    title: The dish, as the page names it
    author: Who wrote the recipe
    servings: How many people it serves
    time: How long it takes altogether
    cuisine: The cooking it belongs to, in one word
    tags[]: Three to six topics, lowercase

- name: Product
  when: '*/dp/*, */product/*, */products/*, */itm/*'
  fields:
    title: The product, without the shop's name
    brand: Who makes it
    price: What the page asks for it, with its currency
    summary: What it is, in one sentence
    tags[]: Three to six topics, lowercase

- name: Paper
  when: '*arxiv.org/*, *doi.org/*, */doi/*, *biorxiv.org/*, *pubmed*'
  fields:
    title: The paper's own title
    authors[]: Everyone credited, in the order printed
    published: The day it appeared, as YYYY-MM-DD
    venue: The journal or conference it appeared in
    doi: Its DOI, digits and slashes only
    summary: What it found, in one sentence

- name: Thread
  when: '*x.com/*/status/*, *twitter.com/*/status/*, *bsky.app/profile/*/post/*'
  fields:
    author: Who posted it, by name
    handle: Their handle, the at sign included
    posted: The day it was posted, as YYYY-MM-DD
    summary: What it says, in one sentence
    tags[]: Three to six topics, lowercase

- name: Article
  when: '*'
  fields:
    title: The headline, without the site's name after it
    author: Who wrote it, as printed
    published: The day it was published, as YYYY-MM-DD
    summary: What it says, in one sentence
    tags[]: Three to six topics, lowercase

- name: Generic
  fields:
    title: What the page is about, in a few words
    summary: What it says, in one sentence
    tags[]: Three to six topics, lowercase
`

/** Everything the reader can refuse, as one sentence each. `{line}` is filled in
 *  where it is drawn, the way every other sentence in the extension is. */
export const TEMPLATE_PROBLEMS = {
  /** A line that is neither a comment, a template, a key nor a property. */
  badLine: 'Line {line} is not something a template says.',
  /** A property a clip already writes for itself. */
  reserved: 'Line {line} names a property the clip writes itself.',
  /** A template with no `name:`, which is the one key it cannot do without. */
  noName: 'The template on line {line} has no name.',
  /** Two templates called the same thing - the toggle is remembered by name -
   *  or one template saying the same property twice. */
  twice: 'Line {line} repeats a name that is already there.',
  /** Nothing at all, or nothing but comments. */
  empty: 'There is no template in there.',
} as const

/** What reading the text produced: the templates, or the first line that did not
 *  read and why. */
export type Read = { templates: Template[] } | { problem: string; line: number }

/** Well past any set of templates somebody maintains by hand, and a ceiling so a
 *  pasted file is refused rather than walked. */
const MOST_LINES = 500
const MOST_TEMPLATES = 32
const MOST_FIELDS = 24

/** Long enough for a sentence about a property, short enough that a prompt stays
 *  a prompt. */
const LONGEST_SAYS = 200
const LONGEST_PATTERN = 200

/** A `key: value` line, its indent and a trailing `[]` kept. */
const PAIR = /^([ \t]*)([A-Za-z_][\w-]*)(\[\])?[ \t]*:[ \t]*(.*)$/

/** The `- ` that opens a template. What follows it is that template's first key,
 *  and its column is where the template's keys sit. */
const DASH = /^[ \t]*-[ \t]+/

/** Quotes around a whole value, which is how the patterns are written: a value
 *  opening with `*` is not a plain scalar in YAML. */
const QUOTED = /^(["'])([\s\S]*)\1$/

function unquoted(value: string): string {
  const said = value.trim()
  return QUOTED.exec(said)?.[2] ?? said
}

/** The addresses a `when:` claims: a comma list, each one trimmed. */
function patterns(value: string): string[] {
  return unquoted(value)
    .split(',')
    .map((one) => one.trim().slice(0, LONGEST_PATTERN))
    .filter(Boolean)
}

/** The templates the text says, or the first line that stopped it.
 *
 *  Two levels of key and no more: a template's own `name`, `when` and `fields`
 *  at one column, and the properties under `fields:` at a deeper one. */
export function readTemplates(source: string): Read {
  const lines = source.split(/\r?\n/)
  if (lines.length > MOST_LINES) return { problem: TEMPLATE_PROBLEMS.badLine, line: MOST_LINES }

  const templates: Template[] = []
  let open: Template | null = null
  /** Which line opened the template being read, so a nameless one is reported
   *  where it is rather than where the reader noticed. */
  let openedAt = 0
  let column = 0
  let inFields = false

  for (const [index, text] of lines.entries()) {
    const line = index + 1
    const said = text.trim()
    if (!said || said.startsWith('#')) continue

    const dash = DASH.exec(text)
    const pair = PAIR.exec(dash ? text.slice(dash[0].length) : text)
    if (!pair) return { problem: TEMPLATE_PROBLEMS.badLine, line }

    const [, indent = '', key = '', listed, value = ''] = pair
    const at = dash ? dash[0].length + indent.length : indent.length

    if (dash) {
      if (open && !open.name) return { problem: TEMPLATE_PROBLEMS.noName, line: openedAt }
      if (templates.length >= MOST_TEMPLATES) {
        return { problem: TEMPLATE_PROBLEMS.badLine, line }
      }

      open = { name: '', when: [], fields: [] }
      templates.push(open)
      openedAt = line
      column = at
      inFields = false
    }

    if (!open) return { problem: TEMPLATE_PROBLEMS.badLine, line }

    // Deeper than the template's own keys, which is where the properties are.
    if (at > column) {
      if (!inFields || open.fields.length >= MOST_FIELDS) {
        return { problem: TEMPLATE_PROBLEMS.badLine, line }
      }
      if (RESERVED.includes(key.toLowerCase())) {
        return { problem: TEMPLATE_PROBLEMS.reserved, line }
      }
      if (open.fields.some((one) => one.key === key)) {
        return { problem: TEMPLATE_PROBLEMS.twice, line }
      }

      open.fields.push({ key, says: unquoted(value).slice(0, LONGEST_SAYS), list: !!listed })
      continue
    }

    if (at < column || listed) return { problem: TEMPLATE_PROBLEMS.badLine, line }
    inFields = false

    if (key === 'name') {
      const name = unquoted(value)
      if (!name) return { problem: TEMPLATE_PROBLEMS.noName, line }
      if (templates.some((one) => one !== open && one.name === name)) {
        return { problem: TEMPLATE_PROBLEMS.twice, line }
      }

      open.name = name
    } else if (key === 'when') {
      open.when = patterns(value)
    } else if (key === 'fields') {
      if (unquoted(value)) return { problem: TEMPLATE_PROBLEMS.badLine, line }
      inFields = true
    } else {
      return { problem: TEMPLATE_PROBLEMS.badLine, line }
    }
  }

  if (open && !open.name) return { problem: TEMPLATE_PROBLEMS.noName, line: openedAt }
  if (!templates.length) return { problem: TEMPLATE_PROBLEMS.empty, line: 1 }

  return { templates }
}

/** The six that ship, read once. */
const BUILT_IN: Template[] = (() => {
  const read = readTemplates(TEMPLATES)
  return 'templates' in read ? read.templates : []
})()

/** The templates to use, whatever is stored.
 *
 *  A person's own text where it reads, the six that ship where it does not: a
 *  half-saved edit costs the interpreter its extra properties for the moment,
 *  never the clip. The options page is where a broken line is reported. */
export function templatesOf(source: string): Template[] {
  const read = readTemplates(source)
  return 'templates' in read ? read.templates : BUILT_IN
}

/** Whether an address pattern claims a URL. `*` is any run of characters and is
 *  the only thing that is not itself; both ends are anchored, so `*.png` claims
 *  what it looks like it claims. */
export function claims(pattern: string, url: string): boolean {
  const said = pattern.trim()
  if (!said) return false

  const shape = said
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\S]*')

  return new RegExp(`^${shape}$`, 'i').test(url)
}

/** The template a page gets by itself: the first one claiming its address, or
 *  the first in the list when none does, so there is always one to offer. */
export function templateFor(templates: readonly Template[], url: string): Template | null {
  return (
    templates.find((one) => one.when.some((pattern) => claims(pattern, url))) ??
    templates[0] ??
    null
  )
}

/** The template of that name, for a choice made by hand and remembered. */
export function named(templates: readonly Template[], name: string): Template | null {
  return templates.find((one) => one.name === name) ?? null
}
