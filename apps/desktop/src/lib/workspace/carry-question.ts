/** The question a chat's pointer carried into another space puts its owner
 *  (chat-leaving.ts, B542). Its own module so the plugin's twin of chat-leaving.ts need
 *  not stand in for it, and the sheet's test reads it without the workspace. */

import { t } from '../i18n.svelte'

/** The question a carry puts: whether the chats go with their pointers into `to`, or
 *  only the files do. The safe answer comes first and takes the keyboard, so Enter keeps
 *  the history where it is. */
export function carryQuestion(names: readonly string[], from: string, to: string) {
  return {
    title:
      names.length === 1
        ? t('Move the chat {name} to {space}?', { name: names[0] ?? '', space: to })
        : t('Move the chats {names} to {space}?', { names: names.join(', '), space: to }),
    detail: t(
      'Everyone in {space} can then read the whole history, and the people in {from} lose it.',
      {
        space: to,
        from,
      },
    ),
    options: [
      { id: 'file', label: t('Only the file'), primary: true, lands: true },
      { id: 'chat', label: t('Move the chat'), danger: true },
    ],
  }
}
