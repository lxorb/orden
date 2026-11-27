import { registerSidebarPart } from '@orden/contracts'
import { untrack } from 'svelte'
import { account } from '../../accounts/src/api'
import { hub } from '../../sync-client/src/api'
import { chatsOn } from '../../gates/src/api'
import { isMobile } from '../../platform/src/api'
import { places } from './where'
import { chats } from './store.svelte'
import { unreadIn } from './unread'
import { holdsIn } from './view/here'

$effect.root(() => {
  $effect(() => {
    const who = chatsOn() ? (account.user?.id ?? account.guest?.id ?? null) : null
    untrack(() => void chats.start(who))
  })
})
void places().then((where) =>
  where?.follow({
    seen: (root, paths) => chats.pointersSeen(root, paths),
    moved: (from, to) => void chats.pointerMoved(from, to),
    folderMoved: (from, to) => chats.folderMoved(from, to),
    lookAgain: () => void chats.lookAgain(),
  }),
)
registerSidebarPart({
  id: 'chats',
  unreadIn: (root) => (chatsOn() && account.accountToken ? unreadIn(chats.list, root, Date.now()) : 0),
  holdsIn: (root) => chatsOn() && !!account.accountToken && holdsIn(chats.list, root),
})
account.forgetWithSession(() => void chats.forget())
hub.on('chat', (frame) => chats.poked(frame.said))
hub.opened(() => void chats.reconnected())
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void chats.reconnected())
}
if (!isMobile && __ORDEN_APP__ === 'orden') void import('./notices')
