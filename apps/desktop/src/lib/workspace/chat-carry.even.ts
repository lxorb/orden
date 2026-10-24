import type * as Real from './chat-carry'

/** The plugin's twin of chat-carry.ts: the glasses have no chats, so a pointer moved
 *  there is a file like any other, and nothing of the chats comes into the package. */
export const mayCarry: typeof Real.mayCarry = () => true

export const chatsCarried: typeof Real.chatsCarried = () => Promise.resolve()
