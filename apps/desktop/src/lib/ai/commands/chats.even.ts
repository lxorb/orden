import type * as Real from './chats'

export const draftReply: typeof Real.draftReply = () => Promise.resolve(false)
export const reply: typeof Real.reply = () => Promise.resolve()
export const catchup: typeof Real.catchup = () => Promise.resolve()
