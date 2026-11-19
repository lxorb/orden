import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { providePort, workspaceNotes } from '@orden/contracts'
import { pressQueryRow, queryRowsHtml, readsWords, serveLinks, spaceLinks } from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

const reachedApis = () =>
  sources(SRC).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'\.\.\/\.\.\/([a-z-]+)\/src\/api'/g)].map(
      (found) => found[1],
    ),
  )

test('the module stands on its own reads the workspace, the search, the reading view, the bases and the canvas through no file of theirs', () => {
  expect([...new Set(reachedApis())].sort()).toEqual([
    'graph',
    'launch',
    'link-format',
    'platform',
    'sharing',
    'ui-kit',
  ])
  const text = sources(SRC)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
  expect(text).not.toMatch(/(?:from |import\()'[^']*workspace/)
})

describe('the link index', () => {
  test('reads words out of notes, canvases, pages and web shortcuts only', () => {
    expect(['a.md', 'b.canvas', 'c.pages', 'd.url', 'e.png'].map(readsWords)).toEqual([true, true, true, true, false])
  })

  test('draws what a note shows through the services the app lends it', async () => {
    const asked: string[] = []
    serveLinks({
      html: (text, path) => Promise.resolve(`<p>${text} ${String(path)}</p>`),
      bases: () => Promise.resolve(() => () => void asked.push('base stopped')),
    })
    const index = spaceLinks().index(null)
    await expect(index.render?.('words', null)).resolves.toBe('<p>words null</p>')
    const stop = index.mountBase?.({} as HTMLElement, { code: 'filter' })
    await new Promise((resolve) => setTimeout(resolve))
    stop?.()
    expect(asked).toEqual(['base stopped'])
  })

  test('answers a query block from the search the app lends it, leaving out what the workspace leaves out', async () => {
    expect(pressQueryRow(null)).toBe(false)
    const asked: (readonly string[])[] = []
    const unbind = providePort('workspace.notes', {
      ...workspaceNotes(),
      activeRoot: '/s',
      leftOut: () => ['Archive'],
    })
    serveLinks({
      search: (_root, _query, _terms, _limit, found, excluded) => {
        asked.push(excluded)
        found({ hits: [] })
        return Promise.resolve()
      },
    })
    await expect(queryRowsHtml('tag:#plan', 'Nothing found')).resolves.toContain('Nothing found')
    unbind()
    expect(asked).toEqual([['Archive']])
  })

  test('moves nothing when a note keeps its place, and leaves the notes it cannot find open', async () => {
    const opened: string[] = []
    const unbind = providePort('workspace.notes', {
      ...workspaceNotes(),
      documentAt: (path) => {
        opened.push(path)
        return null
      },
    })
    await expect(spaceLinks().retarget('/s/A.md', '/s/A.md', '/s')).resolves.toBe(0)
    await expect(spaceLinks().nameBlock('Plan.md', 1, null)).resolves.toBeNull()
    unbind()
    expect(opened).toEqual([])
  })
})
