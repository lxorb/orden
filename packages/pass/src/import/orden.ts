import { envelopeIn, vaultMetaIn } from '../envelope'
import { EXPORT_FORMAT, isSealedExport } from '../export'
import { Collector, ImportError, itemOf, jsonOf, listOf, recordOf, stringOf } from './build'
import { folderPaths } from './content'
import type { Imported } from './types'

export function parseOrden(text: string): Imported {
  if (isSealedExport(text)) {
    throw new ImportError(
      'This export is sealed with a passphrase; open it with the passphrase first.',
    )
  }
  const root = recordOf(jsonOf(text))
  if (root.format !== EXPORT_FORMAT) throw new ImportError('This is not an Orden Pass export.')
  if (root.version !== 1) throw new ImportError('This export is from a newer Orden.')
  const into = new Collector('Imported')
  for (const [index, vault] of listOf(root.vaults).entries()) {
    const raw = recordOf(vault)
    const meta = vaultMetaIn(raw.meta)
    const named = meta?.name.trim() ?? ''
    const name = named === '' ? `Vault ${String(index + 1)}` : named
    if (meta === null) into.skip('The vault could not be read; its items came in anyway.', name)
    into.vault(name)
    const paths = folderPaths(meta?.folders ?? [])
    for (const one of listOf(raw.items)) {
      const envelope = envelopeIn(one)
      if (envelope === null) {
        const title = stringOf(recordOf(recordOf(one).content).title)
        into.skip('The item could not be read.', title)
        continue
      }
      into.add(
        itemOf(envelope.content, {
          created: envelope.created,
          modified: envelope.modified,
          pinned: envelope.pinned,
          trashed: envelope.trashed !== null,
          folder: envelope.folder === null ? null : (paths.get(envelope.folder) ?? null),
        }),
        name,
      )
    }
  }
  return into.result()
}
