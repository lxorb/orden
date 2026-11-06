import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)

const SOURCES = [
  'apps/desktop/src/site/site.ts',
  'apps/desktop/src/lib/camera.ts',
  'apps/desktop/src/lib/graph.ts',
  'apps/desktop/src/lib/graph-layout.ts',
  'apps/desktop/src/lib/graph-paint.ts',
]

export function sourceHash(): string {
  const hash = createHash('sha256')
  for (const name of SOURCES) {
    hash.update(readFileSync(fileURLToPath(new URL(name, ROOT)), 'utf8'), 'utf8')
  }

  return hash.digest('hex').slice(0, 16)
}
