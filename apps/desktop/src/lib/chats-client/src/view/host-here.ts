import { webPages } from '@orden/contracts'
import { chatReplies } from '../../../ai-chat/src/api'
import { isRetiredChat } from '../../../documents/src/api'
import { hiddenKinds } from '../../../gates/src/api'
import { links } from '../../../link-index/src/api'
import { pickedLink } from '../../../link-format/src/api'
import { modes } from '../../../modes/src/api'
import { samePath } from '../../../platform/src/api'
import { protection } from '../../../protect/src/api'
import { canWriteAt } from '../../../sharing/src/api'
import { SidebarWidth } from '../../../sidebar/src/api'
import { draggedTab } from '../../../ui-kit/src/api'
import { followHref, followNoteFrom, workspace } from '../../../workspace/src/api'
import { chatsHere } from './here'
import { hostChats } from './host'
import { openChat } from './open'

const width = new SidebarWidth(() => 'right', 'orden:chat-members-width')
hostChats({
  here: (chats) => chatsHere(chats, workspace.activeSpace?.root),
  opens: (entry) => entry.path !== null,
  isOpen: (entry) => entry.path !== null && workspace.active?.path === entry.path,
  openEntry: (entry, message, how) => {
    if (entry.path) openChat(entry.path, how ?? {}, message)
  },
  showChat: (path, name, how) => {
    const open = workspace.tabHere((one) => one.kind === 'channel' && samePath(one.path, path))
    if (!open) {
      workspace.openView('', name, path, how, 'channel')
      return false
    }
    if (how.activate !== false) workspace.activeTabId = open.id
    return true
  },
  showChats: () => workspace.showPanel('chats'),
  activeRoot: () => workspace.activeSpace?.root ?? null,
  makesIn: () => {
    const root = workspace.activeSpace?.root
    return root && hiddenKinds.offers('chat') && canWriteAt(root) ? root : null
  },
  freeName: (dir, name) => workspace.freeName(dir, name),
  loadTree: () => void workspace.loadTree(),
  canWrite: (path) => canWriteAt(path),
  remove: (path) => workspace.remove(path, false),
  rename: (path, name) => workspace.rename(path, name),
  carried: (transfer) => {
    const notes = workspace.carriedNotes(transfer)
    if (notes.length) return { notes, address: null }
    const web = workspace.tabs.find((one) => one.id === draggedTab(transfer))
    const address = web && (webPages().addressOf(web.id) ?? web.address ?? workspace.webAddressOf(web))
    return { notes, address: address ?? null }
  },
  followHref: (href, press) => followHref(href, press),
  openRelative: (relative, from) => workspace.openRelative(relative, {}, from),
  rootHolding: (path) => workspace.rootHolding(path),
  linkTarget: (from, target) => links.targetOf(from, { kind: 'wikilink', target }),
  linksVersion: () => links.version,
  locksSeen: () => links.locksSeen(),
  noteIndex: (path) => links.index(path),
  noteOpener: (from) => followNoteFrom(from),
  writeLink: () => pickedLink,
  editorModes: () => modes.settings,
  noteLocked: (path) => protection.locked(path),
  noteText: (path) => workspace.noteText(path),
  openNote: (path) => void workspace.openAside(path),
  retired: (chat) => isRetiredChat(chat),
  membersWidth: () => width,
  keeps: (entry) => !entry?.path || canWriteAt(entry.path),
  saveAsNote: async (page, message, space) => (await import('./keep')).saveAsNote(page, message, space),
  addAsTask: (page, message, space) => void import('./keep').then((keep) => keep.addAsTask(page, message, space)),
  askOrden: async (chat, question, parent) => (await chatReplies()).askOrden(chat, question, parent),
})
