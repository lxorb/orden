import JSZip from 'jszip'
import { describe, expect, test } from 'vitest'

import { insideFolder, sourcesFrom, type Picked } from './sources'

const words = (body: string) => new TextEncoder().encode(body)

/** A file the browser hands over from a picked folder. */
function picked(path: string, bytes: Uint8Array): Picked {
  return {
    name: path.split('/').pop() ?? path,
    webkitRelativePath: path,
    arrayBuffer: async () => bytes.slice().buffer,
  }
}

/** A file picked on its own. */
function loose(name: string, bytes: Uint8Array): Picked {
  return { name, webkitRelativePath: '', arrayBuffer: async () => bytes.slice().buffer }
}

async function zipped(entries: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [path, body] of Object.entries(entries)) zip.file(path, body)
  return zip.generateAsync({ type: 'uint8array' })
}

describe('the files behind what was picked', () => {
  test('keep a zip whole beside the note that links it in a folder of markdown', async () => {
    const code = await zipped({ 'README.md': '# the code readme', 'src/index.md': 'code' })

    const sources = await sourcesFrom(
      insideFolder([
        picked('Notes/Notes.md', words('See [code](attachments/code.zip).')),
        picked('Notes/README.md', words('# my readme')),
        picked('Notes/attachments/code.zip', code),
      ]),
    )

    expect(sources.map((one) => one.path).sort()).toEqual([
      'Notes.md',
      'README.md',
      'attachments/code.zip',
    ])
  })

  test('keep a zip whole beside the note that links it in a zip of markdown', async () => {
    const code = await zipped({ 'README.md': '# the code readme', 'src/index.md': 'code' })
    const exported = await zipped({
      'Notes.md': 'See [code](attachments/code.zip).',
      'attachments/code.zip': code,
    })

    const sources = await sourcesFrom([loose('Export.zip', exported)])

    expect(sources.map((one) => one.path).sort()).toEqual(['Notes.md', 'attachments/code.zip'])
  })

  test('open the parts of a Notion export, zipped together or picked as a folder', async () => {
    const one = await zipped({ 'Plan.md': '# Plan' })
    const two = await zipped({ 'Kit.md': '# Kit' })
    const whole = await zipped({ 'Export-Part-1.zip': one, 'Export-Part-2.zip': two })

    const fromZip = await sourcesFrom([loose('Export.zip', whole)])
    const fromFolder = await sourcesFrom(
      insideFolder([
        picked('Export/Export-Part-1.zip', one),
        picked('Export/Export-Part-2.zip', two),
        picked('Export/.DS_Store', words('')),
      ]),
    )

    expect(fromZip.map((each) => each.path).sort()).toEqual(['Kit.md', 'Plan.md'])
    expect(fromFolder.map((each) => each.path).sort()).toEqual(['.DS_Store', 'Kit.md', 'Plan.md'])
  })
})
