import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'svelte/compiler'
import { expect, test } from 'vitest'

/** How long Svelte takes to compile each of the app's components.
 *
 *  The CI test job failed now and then with "Failed to start forks worker ... Timeout
 *  waiting for worker to respond", every test passing. A cold run compiles each module
 *  the first time a test asks for it, in the one Vitest process that hands every worker
 *  its modules; and SettingsPanel.svelte took 55 seconds to compile, all of it Svelte's
 *  style pruning answering one rule, `.sheet.phone .setting .name small` - four classes
 *  deep, through every snippet the panel renders and every component inside them. For
 *  that minute the process answered nobody, and a worker it was starting in the
 *  meantime had a minute to say it was ready. Measured: 1 second before #768 put a `?`
 *  in each written-out row, 55 after; 2 with the rule said child by child.
 *
 *  So every component is held to a ceiling far above the rest - the slowest besides the
 *  panel is a quarter of a second - and far below the minute a worker is given, so a
 *  rule or a template that sends the pruner down every path is a failing test with the
 *  file's name on it rather than a run that stalls somewhere else. */

const SOURCE = fileURLToPath(new URL('../src', import.meta.url))

/** Seconds any one component may take: ten times the slowest there is now, on a
 *  machine running the rest of the suite beside it. */
const MOST_SECONDS = 15

function components(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) components(path, found)
    else if (entry.name.endsWith('.svelte')) found.push(path)
  }
  return found
}

test('every component compiles in seconds, not a minute', () => {
  const slow: string[] = []
  for (const path of components(SOURCE)) {
    const started = performance.now()
    compile(readFileSync(path, 'utf8'), { filename: path, generate: 'client' })
    const seconds = (performance.now() - started) / 1000
    if (seconds > MOST_SECONDS) slow.push(`${path.slice(SOURCE.length)}: ${seconds.toFixed(1)} s`)
  }
  expect(slow).toEqual([])
}, 300_000)
