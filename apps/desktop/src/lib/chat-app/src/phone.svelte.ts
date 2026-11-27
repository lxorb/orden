import type { PushQuiet } from '@orden/chats/push'
import type { ChatNav } from './nav.svelte'

export function watchPhone(
  nav: ChatNav,
  phone: { quiet: () => PushQuiet; tell: (quiet: PushQuiet) => unknown; clear: (chat: string) => unknown },
): () => void {
  return $effect.root(() => {
    $effect(() => {
      phone.tell(phone.quiet())
    })
    $effect(() => {
      if (nav.chat) phone.clear(nav.chat)
    })
  })
}
