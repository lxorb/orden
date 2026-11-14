import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { exporters, frontShut, loadExportSheet, picker, printNote, writtenPdf } from '../src/api'
const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const ROOT = join(HERE, '../../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts']

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

function pendingOf(): string[] {
  const json = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as { pending?: string[] }
  return json.pending ?? []
}

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const pending = pendingOf()
    const reaching = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap(
        (found) => {
          const target = resolve(dirname(file), found[1] ?? '')
          if (target.startsWith(SRC)) return []
          if (/\/[a-z-]+\/src\/api$/.test(target)) return []
          const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
          const named = path === undefined ? target : relative(ROOT, path)
          return pending.includes(named) ? [] : [`${relative(SRC, file)}: ${found[1]}`]
        },
      ),
    )
    expect(reaching).toEqual([])
  })

  test('the api loads with the sheet closed and every door a function', () => {
    expect(picker.open).toBe(false)
    for (const one of [frontShut, printNote, writtenPdf, exporters, loadExportSheet]) {
      expect(typeof one).toBe('function')
    }
  })
})

describe('the exporters behind their door', () => {
  test('find the pictures a page reads from disk and leave the web ones alone', async () => {
    const { localSources } = await exporters()
    expect(
      localSources(
        '<img src="a.png"><img src="https://orden.so/b.png"><img src="data:image/png;base64,AA">',
      ),
    ).toEqual(['a.png'])
  })

  test('let a printed sheet show the app assets and run no script', async () => {
    const { SHEET_POLICY } = await exporters()
    expect(SHEET_POLICY).toContain('img-src * data: blob: asset:')
    expect(SHEET_POLICY).toContain("script-src 'none'")
  })

  test('pack a zip file holding every entry', async () => {
    const { zipOf } = await exporters()
    const bytes = await zipOf([
      { path: 'note.md', body: '# Hello' },
      { path: 'a.png', body: new Uint8Array([1, 2, 3]) },
    ])
    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe('PK')
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('note.md')
    expect(text).toContain('a.png')
  })

  test('name every exporter the shell reaches', async () => {
    const kit = await exporters()
    for (const one of [kit.runExport, kit.exportPandoc, kit.importDocument, kit.printInFrame]) {
      expect(typeof one).toBe('function')
    }
  })
})
