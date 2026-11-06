import type * as Real from './chat-leaving'

export const chatsCarried: typeof Real.chatsCarried = () => Promise.resolve(() => Promise.resolve())
