import type { CommandExtension } from '@orden/contracts'
import type { EditorView } from '@orden/editor'
import { account } from '../../accounts/src/api'
import { chatsOn } from '../../gates/src/api'
import { workspace } from '../../workspace/src/api'

async function send(note: string, view: EditorView | undefined) {
  const range = view?.state.selection.main
  const { sendSelection, sendToChat } = await import('./send')
  if (view && range && !range.empty) {
    await sendSelection(note, view.state.doc.toString(), range.from, range.to)
  } else await sendToChat(note)
}
export function sendRows(view?: object): CommandExtension[] {
  const tab = workspace.active
  const note = tab?.kind === 'note' ? tab.path : null
  if (!note || !account.accountToken || !chatsOn()) return []
  return [
    {
      id: 'send-to-chat',
      label: 'Send to chat',
      run: () => void send(note, view as EditorView | undefined),
    },
  ]
}
