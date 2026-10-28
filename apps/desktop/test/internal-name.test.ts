import { describe, expect, test } from 'vitest'
import { inText, oldNames } from '../../../scripts/old-name'

/** The old name, inside the repo (#367).
 *
 *  The product is Orden; product-name.test.ts holds what a reader sees to that. Inside,
 *  `nib` is still in packages, classes, keys, variables, files and comments, and it goes
 *  a kind at a time - a package at a time, to begin with. What has moved stays moved:
 *  writing it under the old name again fails here, at the line it is written on. What
 *  has not moved yet is not held to anything, since its old name is still the one to
 *  write; `node scripts/old-name.ts` counts what is left of each kind. */

/** The workspace's packages already named `@orden/…`, by the name after the scope. One
 *  is added in the change that moves it. */
const MOVED_PACKAGES: readonly string[] = []

/** This file, and the counter, which say the old names they look for. */
const SAYING = ['apps/desktop/test/internal-name.test.ts', 'scripts/old-name.ts']

describe('the old name inside the repo', () => {
  test('a package moved to @orden is never written under its old name again', () => {
    const written = oldNames(SAYING)
      .filter((one) => one.kind === 'package')
      .flatMap(({ path, line, name }) => {
        const moved = MOVED_PACKAGES.find((pkg) => new RegExp(`^@nib/${pkg}(?![\\w-])`).test(name))
        return moved
          ? [`${path}:${line}: ${name} is @orden/${moved}${name.slice(5 + moved.length)} now`]
          : []
      })
    expect(written, written.join('\n')).toEqual([])
  })

  test('is told apart by what is written around it', () => {
    const text = [
      "import { readTask } from '@nib/markdown/task-line'",
      "const KEY = 'nib:ai-sidebar' // stored by nib's own window",
      'listen(\'nib://agent\'); env.NIB_MCP_TOKEN; class="nib-row"; ch.emilvinu.nib',
      'a nibble is not one',
    ].join('\n')
    expect(inText('a.ts', text).map(({ line, kind, name }) => [line, kind, name])).toEqual([
      [1, 'package', '@nib/markdown/task-line'],
      [2, 'key', 'nib:ai-sidebar'],
      [2, 'word', 'nib'],
      [3, 'scheme', 'nib://agent'],
      [3, 'variable', 'NIB_MCP_TOKEN'],
      [3, 'dashed', 'nib-row'],
      [3, 'identifier', 'ch.emilvinu.nib'],
    ])
  })
})
