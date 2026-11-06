import { t } from '../i18n.svelte'

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
