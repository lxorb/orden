import { SAVE_AT_MOST, SAVE_DELAY } from '../backoff'
import { links } from '../link-index.svelte'
import { owes, writing } from '../parting'
import { canWriteAt } from '../sharing.svelte'
import { invoke } from '../tauri'
import { afterQuiet, type Later } from '../timing'
import { isWebAddress } from './address'
import { aimWebloc, readWebFile, rewriteShortcut, writeShortcut } from '@orden/scan/shortcut'

export interface Kept {
  path: string
  text: () => string
  url: string
  icon: string | null
  wrote: (text: string) => void
}

const waiting = new Map<string, { later: Later; write: () => void }>()

owes(() => {
  for (const path of [...waiting.keys()]) keepNow(path)
})

export function keepPage(kept: Kept) {
  if (!isWebAddress(kept.url)) return
  if (!canWriteAt(kept.path)) return

  const said = readWebFile(kept.path, kept.text())
  if (!said) return

  const home = said.home ?? said.url
  const icon = kept.icon ?? said.icon
  if (said.url === kept.url && (said.icon === icon || holdsPicture(said.icon))) return

  const held = waiting.get(kept.path)
  const write = () => {
    waiting.delete(kept.path)
    writing(writeFile(kept, home, icon))
  }
  if (held) {
    held.write = write
    held.later()
    return
  }

  const one = { later: afterQuiet(() => one.write(), SAVE_DELAY, SAVE_AT_MOST), write }
  waiting.set(kept.path, one)
  one.later()
}

function holdsPicture(icon: string | null): boolean {
  return icon?.startsWith('data:') === true
}

export function keepNow(path: string) {
  const held = waiting.get(path)
  if (!held) return
  held.later.cancel()
  held.write()
}

async function writeFile(kept: Kept, home: string | null, icon: string | null): Promise<void> {
  if (!canWriteAt(kept.path)) return
  const text = kept.text()
  const content = /\.webloc$/i.test(kept.path.trim())
    ? aimWebloc(text, kept.url)
    : shortcutFor(kept, text, home, icon)
  if (content === text) return

  kept.wrote(content)
  links.noteSaved(kept.path, content)
  await invoke('write_note', { path: kept.path, content }).catch(() => undefined)
}

function shortcutFor(kept: Kept, text: string, home: string | null, icon: string | null): string {
  const said = readWebFile(kept.path, text)
  if (!said) return writeShortcut(kept.url, '', new Date(), home, icon)

  return rewriteShortcut(said, { url: kept.url, home, icon })
}
