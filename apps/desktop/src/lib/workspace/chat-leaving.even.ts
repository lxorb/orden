import type * as Real from './chat-leaving'

/** The plugin's twin of chat-leaving.ts: the glasses have no chats, so a pointer moved
 *  there is a file like any other, and nothing of the chats comes into the package. */
export const chatsCarried: typeof Real.chatsCarried = () => Promise.resolve(() => Promise.resolve())
