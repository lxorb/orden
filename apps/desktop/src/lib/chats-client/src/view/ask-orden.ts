export async function askOrden(chat: string, question: string, parent?: string): Promise<void> {
  const [{ chat: panel }, { revealChat }, { draftReply }] = await Promise.all([
    import('../../../ai/sidebar/chat.svelte'),
    import('../../../ai/sidebar/reveal'),
    import('../../../ai/commands/chats'),
  ])
  revealChat()
  await draftReply(panel, panel.ensure(), chat, question, parent)
}
