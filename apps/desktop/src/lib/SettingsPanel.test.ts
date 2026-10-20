import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** A segmented setting and the words in it.
 *
 *  The control was held to one width, fourteen rem, which is two words' room and
 *  not three: Front matter's Properties, Source and Hidden asked for ten pixels more
 *  than they were given, so the chosen half stood out past the groove at the right
 *  of the pane, and a longer language cut further into it. The halves cannot shrink
 *  below their words, so the groove has to grow to them; fourteen rem stays the
 *  least it is, which is what keeps two short words lined up with the column.
 *
 *  Read out of the component rather than measured, for the reason Editor.test.ts
 *  gives: scoped CSS is in the bundle, not in anything a server render hands back.
 *  What it looks like in forty languages is `scripts/locale-e2e.py`'s question. */

const SOURCE = readFileSync(
  fileURLToPath(new URL('./SettingsPanel.svelte', import.meta.url)),
  'utf8',
)

const RULE = /\.setting \.nib-segmented \{([^}]*)\}/.exec(SOURCE)?.[1]

describe('a segmented setting', () => {
  test('is never narrower than the column its short choices line up in', () => {
    expect(RULE).toMatch(/min-width:\s*14rem/)
  })

  test('and grows to its words rather than holding them to one width', () => {
    expect(RULE).not.toMatch(/(^|[\s;])width:/)
  })
})

/** A list keyed by its words is keyed by the reader's language, and two words that
 *  are two in English can be one word in another: Hausa says `Rubutu` for both Text
 *  and Writing, the Editor pane's first two groups. Svelte throws on the second, and
 *  the pane stays on whatever it showed before. */
describe('a generated pane', () => {
  test('keys its groups, rows and sides by something no translation can make equal', () => {
    expect(SOURCE.match(/\{#each [^}]*\(\w+\.(label|title)\)\}/g)).toBeNull()
  })
})
