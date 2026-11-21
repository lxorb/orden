import { sidebarPart } from '@orden/contracts'
import { account } from '../../accounts/src/api'
import { chatsOn } from '../../gates/src/api'
import { isRecord, Kept } from '../../platform/src/api'
import type { MenuEntry } from '../../ui-kit/src/api'

const kept = new Kept<Readonly<Record<string, boolean>>>('orden:space-chats', (saved) =>
  isRecord(saved)
    ? Object.fromEntries(Object.entries(saved).filter((one): one is [string, boolean] => typeof one[1] === 'boolean'))
    : {},
)
const allowed = () => chatsOn() && !!account.accountToken
export const chatsHere = (root?: string): boolean =>
  !!root && allowed() && (kept.value[root] ?? sidebarPart('chats')?.holdsIn?.(root) ?? false)
export const unreadHere = (root?: string): number =>
  root && chatsHere(root) ? (sidebarPart('chats')?.unreadIn?.(root) ?? 0) : 0
export function keepChats(root: string, on: boolean): void {
  kept.value = { ...kept.value, [root]: on }
  kept.write()
}
export const chatsRows = (root: string): MenuEntry[] =>
  allowed()
    ? [{ label: chatsHere(root) ? 'Turn chats off' : 'Turn chats on', run: () => keepChats(root, !chatsHere(root)) }]
    : []
