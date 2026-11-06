import { shownName } from '../note-name'
import { canWriteAt } from '../sharing.svelte'
import { nameOf } from '../space-paths'
import type { Tab } from '../workspace/documents.svelte'
import { writeFile } from '../workspace/write-file'
import { aimWebloc, readWebFile, rewriteShortcut, writeShortcut } from '@orden/scan/shortcut'

export async function aimed(
  ws: { keep(id: string): void; persist(): void },
  tab: Tab,
  url: string,
): Promise<void> {
  ws.keep(tab.id)
  if (tab.kind !== 'web' || tab.path === null) return
  if (!canWriteAt(tab.path)) return

  const was = readWebFile(tab.path, tab.doc)
  if (was?.url === url) return

  const title = was?.title ?? shownName(nameOf(tab.path))
  const content = /\.webloc$/i.test(tab.path.trim())
    ? aimWebloc(tab.doc, url)
    : was
      ? rewriteShortcut(was, { url, title, when: new Date(), home: null, icon: null })
      : writeShortcut(url, title, new Date())
  tab.note.replace(content, false)

  await writeFile(tab.path, content).catch(() => undefined)
  ws.persist()
}
