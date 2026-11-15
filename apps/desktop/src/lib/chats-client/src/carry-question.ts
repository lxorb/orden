export function carryQuestion(names: readonly string[], from: string, to: string) {
  return {
    title:
      names.length === 1
        ? `Move the chat ${names[0] ?? ''} to ${to}?`
        : `Move the chats ${names.join(', ')} to ${to}?`,
    detail: `Everyone in ${to} can then read the whole history, and the people in ${from} lose it.`,
    options: [
      { id: 'file', label: 'Only the file', primary: true, lands: true },
      { id: 'chat', label: 'Move the chat', danger: true },
    ],
  }
}
