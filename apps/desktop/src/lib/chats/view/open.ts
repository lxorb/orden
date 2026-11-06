import { chatLinkOf } from '@orden/chats/links'
import { account } from '../../account.svelte'
import { busy } from '../../busy.svelte'
import type { OpenHow } from '../../new-tab'
import { canWriteAt } from '../../sharing.svelte'
import { nameOf as fileName, samePath } from '../../space-paths'
import { workspace } from '../../workspace.svelte'
import { t } from '../../i18n.svelte'
import { store } from './source.svelte'

const jumps = new Map<string, string>()

export function takeJump(path: string): string | undefined {
  const message = jumps.get(path)
  jumps.delete(path)
  return message
}

export function chatName(path: string): string {
  return fileName(path).replace(/\.chat$/i, '')
}

export function openChat(path: string, how: OpenHow = {}, message?: string): void {
  if (message) jumps.set(path, message)
  const open = workspace.tabs.find((one) => one.kind === 'channel' && samePath(one.path, path))
  if (open) {
    if (how.activate !== false) workspace.activeTabId = open.id
    if (message) jumpOpen(path)
    return
  }
  workspace.openView('', chatName(path), path, how, 'channel')
}

export async function openChatLink(href: string, how: OpenHow = {}): Promise<void> {
  const link = chatLinkOf(href)
  if (!link) return
  const chats = store()
  for (let waited = 0; !chats.ready && waited < 8000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const path = chats.entry(link.chat)?.path
  if (path) openChat(path, how, link.message)
  else busy.failed(t('that link could not be followed'))
}

const hearers = new Set<(path: string) => void>()

export function hearJumps(hear: (path: string) => void): () => void {
  hearers.add(hear)
  return () => hearers.delete(hear)
}

function jumpOpen(path: string) {
  for (const hear of hearers) hear(path)
}

export async function makeChat(folder?: string, named?: string): Promise<void> {
  if (!account.accountToken) {
    account.ask()
    return
  }
  const dir = folder ?? workspace.activeSpace?.root
  if (!dir || !canWriteAt(dir)) return
  if (named === undefined) {
    workspace.showPanel('tree')
    if (workspace.startNaming('chat', dir)) return
  }

  const name = chatName(named ?? workspace.freeName(dir, `${t('Chat')}.chat`))
  const path = await store()
    .make(dir, name)
    .catch(() => null)
  if (!path) {
    busy.failed(t('{name} could not be written.', { name }))
    return
  }
  openChat(path)
  void workspace.loadTree()
}
