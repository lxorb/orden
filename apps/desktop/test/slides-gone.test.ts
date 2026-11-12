import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const APP = join(ROOT, 'apps/desktop')
const CRATE = join(APP, 'src-tauri')

function files(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name === 'gen') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...files(path, keep))
    else if (keep(path)) out.push(path)
  }
  return out
}

const read = (path: string) => readFileSync(path, 'utf8')

const CODE = /\.(ts|svelte|rs|css|json|html|py)$/

const source = (dir: string) =>
  files(
    dir,
    (path) =>
      CODE.test(path) &&
      !path.endsWith('.test.ts') &&
      !/[\\/]locales[\\/]/.test(path) &&
      !/[\\/]src-tauri[\\/](linux|windows)[\\/]/.test(path),
  )

const OFFERS =
  /isDeck|deckOf|slideAt|insertSlideBreak|setDeck|orden-deck|orden-slide-break|slidesStage|slides\/present|presenter_open|orden-presenter|orden:presenter|'app\.present'|'slides-html'|'slides-pdf'|'slide-break'|'new-slide'|'next-slide'|'previous-slide'|revealjs|DECK_LAYOUT|slidesCss|SLIDES_CSS|@orden\/markdown\/(slides|deck|slide-breaks)|presenter\.html|lib\/slides\//

const GONE = [
  'apps/desktop/presenter.html',
  'apps/desktop/src/presenter.ts',
  'apps/desktop/src/lib/Slides.svelte',
  'apps/desktop/src/lib/slides',
  'apps/desktop/src-tauri/src/presenter.rs',
  'packages/markdown/src/slides.ts',
  'packages/markdown/src/deck.ts',
  'packages/markdown/src/slide-breaks.ts',
  'packages/themes/src/slides.css',
]

describe('slides and presenting (#2096)', () => {
  test('none of their files is left', () => {
    expect(GONE.filter((path) => existsSync(join(ROOT, path)))).toEqual([])
  })

  test('no command, menu row, shortcut, export, setting or crate command reaches them', () => {
    const roots = [
      join(APP, 'src'),
      join(APP, 'test'),
      join(APP, 'index.html'),
      join(CRATE, 'src'),
      join(CRATE, 'capabilities'),
      join(CRATE, 'tauri.conf.json'),
      join(ROOT, 'packages/markdown/src'),
      join(ROOT, 'packages/editor/src'),
      join(ROOT, 'packages/themes/src'),
      join(ROOT, 'services/sync/src'),
      join(ROOT, 'scripts'),
    ]
    const found = roots
      .flatMap((root) => (statSync(root).isDirectory() ? source(root) : [root]))
      .filter((path) => OFFERS.test(read(path)))
      .map((path) => path.slice(ROOT.length))
    expect(found).toEqual([])
  })

  test('the window asks for no monitor, since nothing opens on a second screen', () => {
    const granted = JSON.parse(read(join(CRATE, 'capabilities/default.json'))) as {
      permissions: string[]
    }
    expect(granted.permissions.filter((one) => one.includes('monitor'))).toEqual([])
  })
})
