import { menu } from '../menu.svelte'
import { prompt } from '../ui-kit/src/api'
import { canWriteAt } from '../sharing.svelte'
import { samePath, invoke } from '../platform/src/api'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { sitesSince } from './clearing'
import { keepNow } from './keep'
import { pages } from './pages.svelte'
import { withOwn } from './own-file'
import { readWebFile } from '@orden/scan/shortcut'
import { freshOwn, isCopying, ownStore, webData } from './web-data.svelte'

type Where = 'global' | 'separate'

const WHERE: readonly Where[] = ['global', 'separate']

async function textOf(path: string): Promise<string | null> {
  const open = workspace.documentAt(path)
  if (open) return open.text
  return invoke<string>('read_note', { path }).catch(() => null)
}

async function namedElsewhere(path: string, own: string): Promise<boolean> {
  if (isCopying(own)) return true
  const others = new Set<string>()
  for (const tab of workspace.tabs) {
    if (tab.kind === 'web' && tab.path !== null) others.add(tab.path)
  }
  for (const one of workspace.files) {
    if (/\.url$/i.test(one.path)) others.add(one.path)
  }
  for (const other of others) {
    if (samePath(other, path)) continue
    if (readWebFile(other, await textOf(other))?.own === own) return true
  }
  return false
}

export async function showWebData(path: string): Promise<void> {
  const text = await textOf(path)
  const now: Where = readWebFile(path, text)?.own ? 'separate' : 'global'
  const said: Record<Where, string> = { global: 'Global', separate: 'Separate' }
  menu.replace(
    WHERE.map((where) => ({
      label: said[where],
      checked: where === now,
      run: () => void choose(path, where),
    })),
  )
}

async function choose(path: string, where: Where): Promise<void> {
  if (!canWriteAt(path)) return
  keepNow(path)
  const text = await textOf(path)
  if (text === null) return
  const was = readWebFile(path, text)?.own ?? null
  if ((was !== null) === (where === 'separate')) return

  const shared = was !== null && where === 'global' && (await namedElsewhere(path, was))
  if (where === 'global' && !shared) {
    const sure = await prompt.confirm({
      title: 'Share this note’s web data again?',
      detail: 'What its pages are signed in to on this computer is deleted.',
      confirmLabel: 'Share again',
      danger: true,
    })
    if (!sure) return
  }

  const own = where === 'separate' ? freshOwn() : null
  const content = withOwn(path, text, own)
  if (content === null) return

  workspace.documentAt(path)?.replace(content, false)
  await writeFile(path, content)

  const said = own ? 'This note keeps its own web data now' : 'Back on the shared web data'
  for (const tab of workspace.tabs) {
    if (tab.kind !== 'web') continue
    const copy = !shared && tab.path === null && was !== null && tab.apart === was
    if (copy) tab.apart = own
    if (copy || tab.path === path) await pages.rehouse(tab.id, own, said)
  }

  if (was !== null && own === null && !shared) {
    await invoke('web_clear', {
      stores: [ownStore(was)],
      clearing: { since: 0, site: true, cache: true },
      sites: sitesSince([webData.history()], 0),
    }).catch(() => undefined)
  }
}
