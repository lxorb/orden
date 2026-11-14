import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)

const SOURCES = [
  'apps/desktop/src/site/site.ts',
  'apps/desktop/src/lib/camera/src/api.ts',
  'apps/desktop/src/lib/camera/src/camera.ts',
  'apps/desktop/src/lib/graph/src/api.ts',
  'apps/desktop/src/lib/graph/src/graph.ts',
  'apps/desktop/src/lib/graph/src/walk.ts',
  'apps/desktop/src/lib/graph-drawing/src/api.ts',
  'apps/desktop/src/lib/graph-drawing/src/layout.ts',
  'apps/desktop/src/lib/graph-drawing/src/paint.ts',
  'packages/markdown/src/note-name.ts',
]

export function sourceHash(): string {
  const hash = createHash('sha256')
  for (const name of SOURCES) {
    hash.update(readFileSync(fileURLToPath(new URL(name, ROOT)), 'utf8'), 'utf8')
  }

  return hash.digest('hex').slice(0, 16)
}
