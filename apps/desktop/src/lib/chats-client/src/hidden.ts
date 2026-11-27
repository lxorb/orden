import type { Message, Who } from '@orden/chats'

export type Seen = (message: Message) => Message | null
export const everything: Seen = (message) => message
export function seenBy(hides: (who: Who) => boolean): Seen {
  return (message) => {
    if (hides(message.author)) return null
    const reactions = Object.values(message.reactions).some((by) => by.some(hides))
      ? Object.fromEntries(
          Object.entries(message.reactions)
            .map(([emoji, by]) => [emoji, by.filter((who) => !hides(who))] as const)
            .filter(([, by]) => by.length > 0),
        )
      : message.reactions
    let poll = message.poll
    if (poll && (Object.keys(poll.votes) as Who[]).some(hides)) {
      const votes = Object.fromEntries((Object.entries(poll.votes) as [Who, number[]][]).filter(([who]) => !hides(who)))
      poll = { ...poll, votes }
    }
    if (reactions === message.reactions && poll === message.poll) return message
    return { ...message, reactions, ...(poll ? { poll } : {}) }
  }
}
