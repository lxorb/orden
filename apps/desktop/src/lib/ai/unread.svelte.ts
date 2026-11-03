/** Whether any chat of the AI panel has an answer the reader has not seen (#1064), for
 *  the ✦ tab's dot: the panel's store sets it (sidebar/chat.svelte.ts), and the side
 *  reads it without loading the panel. */

export const chatsUnread = $state({ any: false })
