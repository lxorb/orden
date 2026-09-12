/** Which files the script a published page runs is made of, and what they add
 *  up to.
 *
 *  Its own module so that the check on the generated bundle can import it: the
 *  generator itself reaches for vite, which the Worker's own typecheck knows
 *  nothing about, and a test that pulled that in would be a test that needs a
 *  bundler's types to compile. Here there is nothing but Node.
 *
 *  See scripts/site-js.ts, which writes the bundle, and
 *  services/sync/test/site-script.test.ts, which says the committed one is still
 *  what these files make. */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)

/** Every file the bundle is made of, for the staleness check: the entry and the
 *  app modules it imports. Named rather than walked, because a walk over every
 *  import of the app would be the app. */
const SOURCES = [
  'apps/desktop/src/site/site.ts',
  'apps/desktop/src/lib/camera.ts',
  'apps/desktop/src/lib/graph.ts',
  'apps/desktop/src/lib/graph-layout.ts',
  'apps/desktop/src/lib/graph-paint.ts',
]

/** What the sources add up to, so a generated module can say which ones it was
 *  built from and a test can say whether that is still true. */
export function sourceHash(): string {
  const hash = createHash('sha256')
  for (const name of SOURCES) {
    hash.update(readFileSync(fileURLToPath(new URL(name, ROOT)), 'utf8'), 'utf8')
  }

  return hash.digest('hex').slice(0, 16)
}
